-- ─────────────────────────────────────────────────────────────────────────
-- Ludo — server-authoritative turn timer, missed-turn elimination, and
-- resume-active-match flow. Fixes three production issues surfaced by a
-- real two-account match:
--
--  1. Turn timer expiring froze the match — the old "auto-move on timeout"
--     logic lived entirely on the TIMED-OUT PLAYER's OWN client (see
--     src/lib/boardgames/onlineController.ts). If that device was closed,
--     backgrounded, locked, or offline, nothing ever fired and neither
--     player could act again. This migration moves timeout resolution
--     fully server-side: board_game_rooms.turn_deadline_at is now the one
--     authoritative deadline, and any authenticated participant's client
--     (whichever one happens to be open) can trigger resolution just by
--     reading the match — no cooperation from the timed-out player's
--     device required.
--
--  2. Exiting the Ludo screen mid-match (LudoScreen's `onExit` for
--     phase 'online-play') called leave_board_game_room, which is fine —
--     the room and seat survive — but the CLIENT then discarded its own
--     roomId, so there was no way to find the match again short of a
--     manual invite code. get_active_ludo_match() gives the client
--     something to query for on every visit to the Ludo screen.
--
--  3. There was no consequence for a player who simply never returns, so
--     a match with one absent player could never resolve. Three
--     CONSECUTIVE missed turns (tracked per seat, reset by any valid
--     action on that seat's turn) now ends the match by forfeit and
--     awards the remaining player the win through the existing
--     finalize_ludo_match → finalize_board_game payout pipeline — nothing
--     new to duplicate there, the forfeited seat is simply left out of
--     finishedOrder same as any other loss.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Schema additions ───────────────────────────────────────────────────

alter table public.board_game_rooms
  add column if not exists turn_deadline_at timestamptz,
  add column if not exists rewards_granted_at timestamptz;

alter table public.board_game_players
  add column if not exists consecutive_missed_turns int not null default 0,
  add column if not exists eliminated_at timestamptz,
  add column if not exists elimination_reason text,
  add column if not exists last_action_at timestamptz;

comment on column public.board_game_rooms.turn_deadline_at is
  'Authoritative deadline for the current turn_seat_index. Client countdowns are a visual read of this value only — the server, not any client, decides when a turn has expired.';
comment on column public.board_game_players.consecutive_missed_turns is
  'Consecutive server-confirmed EXPIRED turns for this seat. Reset to 0 by any valid action (roll/move/pass) that seat takes on its own turn. Three in a row eliminates the seat.';

-- ── Core resolver: atomically fast-forwards past any expired turn(s) ──────
--
-- Safe to call redundantly and concurrently: every step is done under
-- SELECT ... FOR UPDATE on board_game_rooms (and board_game_state) for
-- this room, so two callers racing each other simply serialize — the
-- second one's re-read after acquiring the lock will find the deadline
-- already advanced and no-op. Bounded to 20 iterations per call so a
-- room that's been untouched for a very long time (many missed turns in a
-- row) still resolves fully in one call instead of requiring 20 separate
-- round trips.
create or replace function private.ludo_resolve_expired_turns(p_room_id uuid)
returns jsonb
language plpgsql
set search_path to 'public', 'private'
as $$
declare
  v_room public.board_game_rooms;
  v_state_row public.board_game_state;
  v_state jsonb;
  v_seat int;
  v_active jsonb;
  v_player public.board_game_players;
  v_eliminated_this_pass boolean;
  v_next_seat int;
  v_remaining_active int;
  v_winner_seat int;
  v_finished jsonb;
  v_move_number int;
  v_iterations int := 0;
  v_events jsonb := '[]'::jsonb;
begin
  loop
    exit when v_iterations >= 20;
    v_iterations := v_iterations + 1;

    select * into v_room from public.board_game_rooms where id = p_room_id for update;
    if v_room.id is null or v_room.status <> 'active' then exit; end if;
    if v_room.turn_deadline_at is null or v_room.turn_deadline_at > now() then exit; end if;

    select * into v_state_row from public.board_game_state where room_id = p_room_id for update;
    if v_state_row.room_id is null then exit; end if;
    v_state := v_state_row.state;
    if coalesce((v_state->>'gameOver')::boolean, false) then exit; end if;

    v_events := v_events || jsonb_build_object('type', 'turnMissed', 'seatIndex', v_room.turn_seat_index);

    v_seat := v_room.turn_seat_index;
    if v_seat is null then exit; end if;

    v_active := coalesce(v_state->'activeSeatIndices', '[]'::jsonb);
    v_eliminated_this_pass := false;
    v_winner_seat := null;

    select * into v_player from public.board_game_players
      where room_id = p_room_id and seat_index = v_seat
      order by joined_at desc limit 1
      for update;

    if v_player.id is not null and not v_player.is_ai and v_player.eliminated_at is null then
      update public.board_game_players
      set consecutive_missed_turns = consecutive_missed_turns + 1
      where id = v_player.id
      returning * into v_player;

      if v_player.consecutive_missed_turns >= 3 then
        update public.board_game_players
        set eliminated_at = now(), elimination_reason = 'missed_turns'
        where id = v_player.id;
        v_eliminated_this_pass := true;
        v_events := v_events || jsonb_build_object('type', 'playerEliminated', 'seatIndex', v_seat, 'reason', 'missed_turns');
      end if;
    end if;

    -- Next-seat rotation must use the array as it stood BEFORE removing an
    -- eliminated seat, or ludo_next_active_seat can't find p_from's
    -- position and falls back to returning p_from itself (the seat that
    -- was just eliminated) instead of advancing.
    v_next_seat := private.ludo_next_active_seat(v_active, v_seat);

    if v_eliminated_this_pass then
      v_active := (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(v_active) x where (x #>> '{}')::int <> v_seat);
    end if;

    v_state := jsonb_set(v_state, '{activeSeatIndices}', v_active);
    v_state := jsonb_set(v_state, '{diceValue}', 'null'::jsonb);
    v_state := jsonb_set(v_state, '{consecutiveSixes}', '0'::jsonb);

    select count(*) into v_remaining_active
    from jsonb_array_elements(v_active) x
    join public.board_game_players bp on bp.room_id = p_room_id and bp.seat_index = (x #>> '{}')::int
    where bp.eliminated_at is null;

    if v_remaining_active <= 1 then
      select (x #>> '{}')::int into v_winner_seat
      from jsonb_array_elements(v_active) x
      join public.board_game_players bp on bp.room_id = p_room_id and bp.seat_index = (x #>> '{}')::int
      where bp.eliminated_at is null
      limit 1;

      v_state := jsonb_set(v_state, '{gameOver}', 'true'::jsonb);
      if v_winner_seat is not null then
        v_finished := coalesce(v_state->'finishedOrder', '[]'::jsonb);
        if not (v_finished @> to_jsonb(v_winner_seat)) then
          v_state := jsonb_set(v_state, '{finishedOrder}', v_finished || to_jsonb(v_winner_seat));
        end if;
      end if;
      v_events := v_events || jsonb_build_object('type', 'gameOver', 'winnerSeatIndex', v_winner_seat, 'reason', 'forfeit');
    else
      v_state := jsonb_set(v_state, '{turnSeatIndex}', to_jsonb(v_next_seat));
    end if;

    select coalesce(max(move_number), 0) + 1 into v_move_number from public.board_game_moves where room_id = p_room_id;
    insert into public.board_game_moves (room_id, move_number, seat_index, move, resulting_state)
    values (
      p_room_id, v_move_number, v_seat,
      jsonb_build_object(
        'type', 'timeout', 'seatIndex', v_seat,
        'eliminated', v_eliminated_this_pass,
        'gameOver', coalesce((v_state->>'gameOver')::boolean, false)
      ),
      v_state
    );

    update public.board_game_state
    set state = v_state, version = version + 1, updated_at = now()
    where room_id = p_room_id;

    if v_remaining_active <= 1 then
      update public.board_game_rooms
      set turn_deadline_at = null, turn_started_at = now()
      where id = p_room_id;
      exit; -- match is over, nothing left to schedule
    else
      update public.board_game_rooms
      set turn_seat_index = v_next_seat, turn_started_at = now(),
          turn_deadline_at = now() + (v_room.turn_timer_seconds * interval '1 second')
      where id = p_room_id;
    end if;
  end loop;

  return v_events;
end;
$$;

-- ── Public entry point: any participant can trigger resolution ────────────
--
-- Called by the client on mount, on tab focus/visibility change, on a
-- polling interval, and implicitly at the top of ludo_submit_move — i.e.
-- exactly "whenever either client opens, focuses, reconnects, polls,
-- rolls, or fetches the match" per spec. Returns the (possibly just
-- resolved) authoritative state so the caller can repaint immediately
-- without waiting for a separate Realtime round trip.
create or replace function public.check_ludo_timeout(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_room public.board_game_rooms;
  v_state_row public.board_game_state;
  v_is_member boolean;
  v_events jsonb;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id;
  if v_room.id is null then
    raise exception 'Room not found' using errcode = '22023';
  end if;
  if v_room.game_id <> 'ludo' then
    raise exception 'Not a Ludo room' using errcode = '22023';
  end if;

  select exists(
    select 1 from public.board_game_players where room_id = p_room_id and user_id = auth.uid()
  ) or exists(
    select 1 from public.board_game_spectators where room_id = p_room_id and user_id = auth.uid()
  ) or v_room.host_id = auth.uid() into v_is_member;
  if not v_is_member then
    raise exception 'Not a participant in this match' using errcode = '42501';
  end if;

  select private.ludo_resolve_expired_turns(p_room_id) into v_events;

  select * into v_room from public.board_game_rooms where id = p_room_id;
  select * into v_state_row from public.board_game_state where room_id = p_room_id;

  return jsonb_build_object(
    'room_id', p_room_id,
    'state', v_state_row.state,
    'version', v_state_row.version,
    'events', coalesce(v_events, '[]'::jsonb),
    'updated_at', v_state_row.updated_at,
    'turn_seat_index', v_room.turn_seat_index,
    'turn_deadline_at', v_room.turn_deadline_at,
    'turn_started_at', v_room.turn_started_at,
    'status', v_room.status
  );
end;
$function$;

grant execute on function public.check_ludo_timeout(uuid) to authenticated;
revoke execute on function public.check_ludo_timeout(uuid) from public, anon;

-- ── Resume: find any active, non-eliminated Ludo match for the caller ─────
create or replace function public.get_active_ludo_match()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_room_id uuid;
  v_row record;
begin
  select p.room_id into v_room_id
  from public.board_game_players p
  join public.board_game_rooms r on r.id = p.room_id
  where p.user_id = auth.uid() and r.game_id = 'ludo' and r.status = 'active' and p.eliminated_at is null
  order by r.started_at desc nulls last
  limit 1;

  if v_room_id is null then return null; end if;

  -- Resolve first — a deadline that expired while nobody was looking might
  -- eliminate the caller (or end the match) on this very check.
  perform private.ludo_resolve_expired_turns(v_room_id);

  select r.id as room_id, r.status, r.turn_seat_index, r.turn_deadline_at, r.turn_timer_seconds,
         p.seat_index, p.eliminated_at
  into v_row
  from public.board_game_players p
  join public.board_game_rooms r on r.id = p.room_id
  where p.user_id = auth.uid() and p.room_id = v_room_id;

  if v_row.room_id is null or v_row.status <> 'active' or v_row.eliminated_at is not null then
    return null;
  end if;

  return jsonb_build_object(
    'room_id', v_row.room_id,
    'seat_index', v_row.seat_index,
    'turn_seat_index', v_row.turn_seat_index,
    'turn_deadline_at', v_row.turn_deadline_at,
    'turn_timer_seconds', v_row.turn_timer_seconds
  );
end;
$function$;

grant execute on function public.get_active_ludo_match() to authenticated;
revoke execute on function public.get_active_ludo_match() from public, anon;

-- ── Guard: one active Ludo match per player at a time ──────────────────────
create or replace function private.ludo_guard_single_active_match(p_exclude_room_id uuid)
returns void
language plpgsql
set search_path to 'public', 'private'
as $$
declare
  v_other record;
begin
  for v_other in
    select p.room_id from public.board_game_players p
    join public.board_game_rooms r on r.id = p.room_id
    where p.user_id = auth.uid() and r.game_id = 'ludo' and r.status = 'active' and p.eliminated_at is null
      and (p_exclude_room_id is null or p.room_id <> p_exclude_room_id)
  loop
    perform private.ludo_resolve_expired_turns(v_other.room_id);
  end loop;

  if exists (
    select 1 from public.board_game_players p
    join public.board_game_rooms r on r.id = p.room_id
    where p.user_id = auth.uid() and r.game_id = 'ludo' and r.status = 'active' and p.eliminated_at is null
      and (p_exclude_room_id is null or p.room_id <> p_exclude_room_id)
  ) then
    raise exception 'You already have an active Ludo match — resume it before starting another' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.create_board_game_room(p_game_id text, p_max_players integer DEFAULT 4, p_allow_spectators boolean DEFAULT true, p_private boolean DEFAULT false)
 RETURNS SETOF board_game_rooms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_room_id uuid;
  v_min_players int;
  v_code text;
  v_tries int := 0;
begin
  if p_max_players is null or p_max_players < 1 or p_max_players > 8 then
    raise exception 'Invalid max players' using errcode = '22023';
  end if;
  if not exists (select 1 from public.games g where g.id = p_game_id and g.is_active) then
    raise exception 'Unknown or inactive game' using errcode = '22023';
  end if;

  if p_game_id = 'ludo' then
    perform private.ludo_guard_single_active_match(null);
  end if;

  v_min_players := least(2, p_max_players);

  if p_private then
    loop
      v_code := (
        select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 32)::int + 1, 1), '')
        from generate_series(1, 6)
      );
      exit when not exists (
        select 1 from public.board_game_rooms
        where join_code = v_code and status = 'waiting'
      );
      v_tries := v_tries + 1;
      if v_tries > 20 then
        raise exception 'Could not generate a unique room code, try again' using errcode = '22023';
      end if;
    end loop;
  else
    v_code := null;
  end if;

  insert into public.board_game_rooms (game_id, host_id, max_players, min_players, allow_spectators, join_code, status)
  values (p_game_id, auth.uid(), p_max_players, v_min_players, p_allow_spectators, v_code, 'waiting')
  returning id into v_room_id;

  insert into public.board_game_players (room_id, user_id, seat_index, is_ready, is_connected, last_heartbeat_at)
  values (v_room_id, auth.uid(), 0, false, true, now());

  insert into public.board_game_state (room_id, state, version)
  values (v_room_id, '{}'::jsonb, 1);

  return query select * from public.board_game_rooms where id = v_room_id;
end;
$function$;

create or replace function private.join_board_game_room_internal(p_room_id uuid)
 RETURNS SETOF board_game_players
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_room record;
  v_existing public.board_game_players%rowtype;
  v_seated_count int;
  v_seat int;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then
    raise exception 'Room not found' using errcode = '22023';
  end if;

  select * into v_existing from public.board_game_players
  where room_id = p_room_id and user_id = auth.uid()
  limit 1;

  if v_existing.id is not null then
    if v_existing.eliminated_at is not null then
      raise exception 'You have been eliminated from this match' using errcode = '42501';
    end if;
    update public.board_game_players
    set left_at = null, is_connected = true, last_heartbeat_at = now()
    where id = v_existing.id;
    return query select * from public.board_game_players where id = v_existing.id;
    return;
  end if;

  if v_room.game_id = 'ludo' then
    perform private.ludo_guard_single_active_match(p_room_id);
  end if;

  if v_room.status <> 'waiting' then
    raise exception 'This match has already started' using errcode = '22023';
  end if;

  select count(*) into v_seated_count from public.board_game_players
  where room_id = p_room_id and left_at is null;

  if v_seated_count >= v_room.max_players then
    raise exception 'Room is full' using errcode = '22023';
  end if;

  select min(s.seat) into v_seat
  from generate_series(0, v_room.max_players - 1) as s(seat)
  where not exists (
    select 1 from public.board_game_players p
    where p.room_id = p_room_id and p.left_at is null and p.seat_index = s.seat
  );

  if v_seat is null then
    raise exception 'Room is full' using errcode = '22023';
  end if;

  insert into public.board_game_players (room_id, user_id, seat_index, is_ready, is_connected, last_heartbeat_at)
  values (p_room_id, auth.uid(), v_seat, false, true, now());

  return query select * from public.board_game_players
  where room_id = p_room_id and user_id = auth.uid();
end;
$function$;

-- ── start_board_game_room: seed the first turn_deadline_at too ────────────
create or replace function public.start_board_game_room(p_room_id uuid)
 RETURNS SETOF board_game_rooms
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_room record;
  v_seated_count int;
  v_unready_count int;
  v_first_seat int;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then
    raise exception 'Room not found' using errcode = '22023';
  end if;
  if v_room.host_id <> auth.uid() then
    raise exception 'Only the host can start the match' using errcode = '42501';
  end if;
  if v_room.status <> 'waiting' then
    raise exception 'This match has already started' using errcode = '22023';
  end if;

  select count(*) into v_seated_count from public.board_game_players
  where room_id = p_room_id and left_at is null;
  if v_seated_count < v_room.min_players then
    raise exception 'Need at least % players', v_room.min_players using errcode = '22023';
  end if;

  select count(*) into v_unready_count from public.board_game_players
  where room_id = p_room_id and left_at is null and not is_ready and not is_ai;
  if v_unready_count > 0 then
    raise exception 'Waiting for everyone to be ready' using errcode = '22023';
  end if;

  select min(seat_index) into v_first_seat from public.board_game_players
  where room_id = p_room_id and left_at is null;

  update public.board_game_rooms
  set status = 'active', started_at = now(), turn_seat_index = v_first_seat, turn_started_at = now(),
      turn_deadline_at = now() + (v_room.turn_timer_seconds * interval '1 second')
  where id = p_room_id;

  if v_room.game_id = 'ludo' then
    update public.board_game_state
    set state = private.ludo_initial_state(v_seated_count, v_first_seat), version = 1, updated_at = now()
    where room_id = p_room_id;
  end if;

  return query select * from public.board_game_rooms where id = p_room_id;
end;
$function$;
