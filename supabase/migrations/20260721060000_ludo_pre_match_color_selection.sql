-- ─────────────────────────────────────────────────────────────────────────
-- Ludo — pre-match color selection (round 3, new feature).
--
-- DESIGN: this codebase already ties a seat's board color directly to its
-- seat_index (geometry.ts: SEAT_COLORS = [Red, Green, Yellow, Blue] indexed
-- 0-3, and every rules function — start offsets, capture math, safe cells —
-- is keyed by seatIndex). Rather than bolt on a separate `color` column
-- that would need to be kept in sync with seat_index everywhere colors are
-- rendered, seat_index simply BECOMES the explicitly-chosen color: 0=Red,
-- 1=Green, 2=Yellow, 3=Blue. This is the minimal-risk option — it touches
-- zero rules/rendering code (SEAT_COLORS[seatIndex] lookups keep working
-- exactly as before) and only changes WHEN/HOW seat_index gets assigned:
-- previously automatic (first free slot on join), now an explicit player
-- choice made in the lobby before the host can start.
--
-- The one real consequence: seat_index values are no longer guaranteed
-- contiguous (a 2-player match could end up as seats {0,3} — Red vs Blue —
-- if that's what both players picked, skipping Green/Blue entirely). Two
-- functions assumed contiguous 0..numSeats-1 and are fixed here:
-- private.ludo_initial_state (now takes the actual claimed seat array) and
-- finalize_ludo_match (now ranks over the actual seat indices present in
-- state.pieces, not 0..numSeats-1). Everything else — activeSeatIndices,
-- ludo_next_active_seat, elimination, the deadlock fix applied earlier this
-- round — already operates on arbitrary index sets with no contiguity
-- assumption, verified during the same audit pass.
--
-- SCHEMA: seat_index becomes nullable (an unclaimed color) and the old
-- unconditional UNIQUE(room_id, seat_index) is replaced with a PARTIAL
-- unique index that only applies to currently-active claims (seat_index is
-- not null AND left_at is null). This is what makes "leaving the lobby
-- releases your color" and "changing your mind releases the old color"
-- both true for free: a left/changed row simply falls outside the index's
-- WHERE clause, so the color becomes claimable again immediately — no
-- separate release step needed.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.board_game_players alter column seat_index drop not null;

alter table public.board_game_players
  drop constraint if exists board_game_players_room_id_seat_index_key;

create unique index if not exists board_game_players_room_seat_active_uidx
  on public.board_game_players (room_id, seat_index)
  where seat_index is not null and left_at is null;

-- join_board_game_room_internal: for Ludo, join with NO color yet (the
-- player must explicitly claim one via claim_ludo_color before the host can
-- start). Every other current/future game keeps the old immediate
-- auto-assign-next-seat behavior untouched.
create or replace function private.join_board_game_room_internal(p_room_id uuid)
returns setof public.board_game_players
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
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

  if v_room.game_id = 'ludo' then
    -- No auto-assigned seat/color — inserted unseated, chosen explicitly
    -- afterward via claim_ludo_color.
    insert into public.board_game_players (room_id, user_id, seat_index, is_ready, is_connected, last_heartbeat_at)
    values (p_room_id, auth.uid(), null, false, true, now());
  else
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
  end if;

  return query select * from public.board_game_players
  where room_id = p_room_id and user_id = auth.uid();
end;
$function$;

-- Claims (or, with p_color null, releases) a color for the caller in a
-- waiting Ludo lobby. Atomic and race-safe: the partial unique index above
-- is the actual source of truth — a concurrent double-claim of the same
-- color always leaves exactly one winner, and the loser gets a clean error
-- instead of silently overwriting the other player's pick.
create or replace function public.claim_ludo_color(p_room_id uuid, p_color integer)
returns setof public.board_game_players
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_room public.board_game_rooms;
  v_player public.board_game_players;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'Room not found' using errcode = '22023'; end if;
  if v_room.game_id <> 'ludo' then raise exception 'Not a Ludo room' using errcode = '22023'; end if;
  if v_room.status <> 'waiting' then
    raise exception 'Colors are locked once the match has started' using errcode = '22023';
  end if;

  if p_color is not null and (p_color < 0 or p_color > 3) then
    raise exception 'Invalid color' using errcode = '22023';
  end if;

  select * into v_player from public.board_game_players
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_player.id is null then
    raise exception 'You are not seated in this room' using errcode = '42501';
  end if;

  begin
    update public.board_game_players
    set seat_index = p_color
    where id = v_player.id;
  exception when unique_violation then
    raise exception 'That color has just been taken — pick another' using errcode = '22023';
  end;

  return query select * from public.board_game_players where id = v_player.id;
end;
$function$;

grant execute on function public.claim_ludo_color(uuid, integer) to authenticated;
revoke execute on function public.claim_ludo_color(uuid, integer) from public, anon;

-- start_board_game_room: for Ludo, additionally require every seated player
-- to have explicitly claimed a color before the host can start, and build
-- the actual (possibly non-contiguous) set of claimed seats to seed the
-- match state with.
create or replace function public.start_board_game_room(p_room_id uuid)
returns setof public.board_game_rooms
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_room record;
  v_seated_count int;
  v_unready_count int;
  v_uncolored_count int;
  v_first_seat int;
  v_seats int[];
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

  if v_room.game_id = 'ludo' then
    select count(*) into v_uncolored_count from public.board_game_players
    where room_id = p_room_id and left_at is null and seat_index is null;
    if v_uncolored_count > 0 then
      raise exception 'Waiting for everyone to choose a color' using errcode = '22023';
    end if;

    select array_agg(seat_index order by seat_index) into v_seats
    from public.board_game_players
    where room_id = p_room_id and left_at is null;

    select min(seat_index) into v_first_seat from public.board_game_players
    where room_id = p_room_id and left_at is null;
  else
    select min(seat_index) into v_first_seat from public.board_game_players
    where room_id = p_room_id and left_at is null;
  end if;

  update public.board_game_rooms
  set status = 'active', started_at = now(), turn_seat_index = v_first_seat, turn_started_at = now(),
      turn_deadline_at = now() + (v_room.turn_timer_seconds * interval '1 second')
  where id = p_room_id;

  if v_room.game_id = 'ludo' then
    update public.board_game_state
    set state = private.ludo_initial_state(v_seats, v_first_seat), version = 1, updated_at = now()
    where room_id = p_room_id;
  end if;

  return query select * from public.board_game_rooms where id = p_room_id;
end;
$function$;

-- The old (integer, integer) signature is a different overload as far as
-- Postgres is concerned — CREATE OR REPLACE with a new parameter list would
-- just add a second overload instead of replacing it, so drop it explicitly.
drop function if exists private.ludo_initial_state(integer, integer);

create or replace function private.ludo_initial_state(p_seats integer[], p_first_seat integer)
returns jsonb
language plpgsql
immutable
set search_path to 'public', 'private'
as $$
declare
  v_pieces jsonb := '[]'::jsonb;
  v_active jsonb := '[]'::jsonb;
  v_lost jsonb := '{}'::jsonb;
  s int;
  p int;
begin
  foreach s in array p_seats loop
    v_active := v_active || to_jsonb(s);
    v_lost := jsonb_set(v_lost, array[s::text], to_jsonb(0));
    for p in 0 .. 3 loop
      v_pieces := v_pieces || jsonb_build_object('seatIndex', s, 'pieceIndex', p, 'pathPos', -1);
    end loop;
  end loop;
  return jsonb_build_object(
    'numSeats', coalesce(array_length(p_seats, 1), 0),
    'pieces', v_pieces,
    'turnSeatIndex', p_first_seat,
    'diceValue', null,
    'consecutiveSixes', 0,
    'finishedOrder', '[]'::jsonb,
    'activeSeatIndices', v_active,
    'gameOver', false,
    'piecesLostCount', v_lost
  );
end;
$$;

-- finalize_ludo_match: rank over the actual seat indices present in
-- state.pieces (now possibly sparse, e.g. {0,3}) instead of assuming a
-- contiguous 0..numSeats-1 range.
create or replace function public.finalize_ludo_match(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_room public.board_game_rooms;
  v_state jsonb;
  v_is_member boolean;
  v_finished_order jsonb;
  v_seats int[];
  v_rankings jsonb := '{}'::jsonb;
  v_scores jsonb := '{}'::jsonb;
  v_meta jsonb := '{}'::jsonb;
  v_seat int;
  v_rank int;
  v_score int;
  v_lost int;
  v_seat_pieces int;
  v_seat_home int;
  v_advance int;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then return; end if;
  if v_room.game_id <> 'ludo' then
    raise exception 'Not a Ludo room' using errcode = '22023';
  end if;
  if v_room.status <> 'active' then
    return;
  end if;

  select exists(
    select 1 from public.board_game_players
    where room_id = p_room_id and user_id = auth.uid() and left_at is null
  ) or v_room.host_id = auth.uid() into v_is_member;
  if not v_is_member then
    raise exception 'Not a participant in this match' using errcode = '42501';
  end if;

  select state into v_state from public.board_game_state where room_id = p_room_id;
  if v_state is null or not coalesce((v_state->>'gameOver')::boolean, false) then
    raise exception 'Match has not actually finished yet' using errcode = '22023';
  end if;

  v_finished_order := coalesce(v_state->'finishedOrder', '[]'::jsonb);
  select array_agg(distinct (x->>'seatIndex')::int) into v_seats
  from jsonb_array_elements(v_state->'pieces') x;

  foreach v_seat in array coalesce(v_seats, array[]::int[]) loop
    v_rank := null;
    select (ord) into v_rank
    from jsonb_array_elements(v_finished_order) with ordinality as t(elem, ord)
    where (elem #>> '{}')::int = v_seat;
    if v_rank is null then v_rank := jsonb_array_length(v_finished_order) + 1; end if;

    select count(*) into v_seat_home from jsonb_array_elements(v_state->'pieces') x where (x->>'seatIndex')::int = v_seat and (x->>'pathPos')::int = 56;
    select coalesce(sum(greatest(0, (x->>'pathPos')::int)), 0) into v_advance from jsonb_array_elements(v_state->'pieces') x where (x->>'seatIndex')::int = v_seat;
    v_score := v_seat_home * 25 + v_advance;

    select count(*) into v_seat_pieces from jsonb_array_elements(v_state->'pieces') x where (x->>'seatIndex')::int = v_seat;
    v_lost := coalesce(((v_state->'piecesLostCount')->>v_seat::text)::int, 0);

    v_rankings := jsonb_set(v_rankings, array[v_seat::text], to_jsonb(v_rank));
    v_scores := jsonb_set(v_scores, array[v_seat::text], to_jsonb(v_score));
    v_meta := jsonb_set(v_meta, array[v_seat::text], jsonb_build_object(
      'no_pieces_lost', v_lost = 0,
      'all_pieces_home', v_seat_pieces > 0 and v_seat_home = v_seat_pieces
    ));
  end loop;

  perform public.finalize_board_game(p_room_id, v_rankings, v_scores, v_meta);
end;
$function$;
