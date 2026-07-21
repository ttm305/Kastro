-- ─────────────────────────────────────────────────────────────────────────
-- Ludo — real Forfeit Match action, resolver hardening against NULL
-- turn_deadline_at, and an owner-only cleanup RPC for already-stuck rooms.
--
-- ROOT CAUSE of "the old frozen match is still permanently active for both
-- accounts, blocking new matches": both stuck rooms were created and
-- started BEFORE yesterday's timer migration existed, so their
-- turn_deadline_at is NULL (the pre-migration start_board_game_room never
-- set it). private.ludo_resolve_expired_turns's expiry check is
-- `if v_room.turn_deadline_at is null or v_room.turn_deadline_at > now()
-- then exit;` — NULL always satisfies that OR and the function silently
-- no-ops, every single call, forever. Since ludo_guard_single_active_match
-- calls the resolver and then blocks room creation if anything is still
-- active afterward, a NULL-deadline room can never be resolved away and
-- permanently blocks both seated users from starting anything new. This
-- migration (1) heals that specific anomaly so it can never recur, and
-- (2) provides a real "give up now" action (forfeit) instead of only ever
-- relying on the timer, and (3) actually fixes the two live rooms found
-- stuck in the project right now (room d318867f... and a52fe250...,
-- players "test1" and "T") via the new admin RPC, run at the end of this
-- migration.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Harden the resolver: NULL turn_deadline_at is an anomaly, not a
--       "never expires" state. Heal it by starting the clock now instead of
--       silently no-op-ing on every call forever. ─────────────────────────
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

    -- Anomalous state: an active room with no deadline at all. This can
    -- only happen for a room that started before turn_deadline_at existed
    -- (or some other out-of-band state). NULL can never satisfy a
    -- "< now()" expiry check, so left alone this room would stay "active"
    -- forever with zero consequence for an absent player, and would
    -- permanently block ludo_guard_single_active_match from ever letting
    -- either seated player start a new match. Heal it by starting the
    -- clock now — the normal missed-turn flow then applies from here on.
    if v_room.turn_deadline_at is null then
      update public.board_game_rooms
      set turn_deadline_at = now() + (v_room.turn_timer_seconds * interval '1 second'), turn_started_at = now()
      where id = p_room_id;
      exit;
    end if;

    if v_room.turn_deadline_at > now() then exit; end if;

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

-- ── 2. Forfeit Match — server-authoritative, atomic, real "give up now" ───
--
-- Resolves any already-expired turn FIRST (same discipline as
-- ludo_submit_move — every entry point resolves expired deadlines before
-- doing its own thing). If that resolution already ended the match or
-- eliminated the caller, forfeiting is moot and this is a graceful no-op
-- returning the resolved state. Otherwise: marks the caller eliminated
-- with reason='forfeit', removes them from play, ends the match
-- immediately if only one active seat remains (always true for a 2-player
-- match), and finalizes rewards in the SAME transaction — the match is
-- fully COMPLETED, not just flagged, the instant this call returns. Client
-- never decides the winner: winnerSeatIndex/finishedOrder/rankings are all
-- computed here from board_game_players/board_game_state, never from
-- client input.
create or replace function public.forfeit_ludo_match(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_room public.board_game_rooms;
  v_state_row public.board_game_state;
  v_state jsonb;
  v_player public.board_game_players;
  v_seat_index int;
  v_active_before jsonb;
  v_active_after jsonb;
  v_events jsonb := '[]'::jsonb;
  v_timeout_events jsonb;
  v_move_number int;
  v_finished jsonb;
  v_next_seat int;
  v_remaining_active int;
  v_winner_seat int;
  v_turn_seat int;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'Room not found' using errcode = '22023'; end if;
  if v_room.game_id <> 'ludo' then raise exception 'Not a Ludo room' using errcode = '22023'; end if;
  if v_room.status <> 'active' then
    raise exception 'Match is not active' using errcode = '22023';
  end if;

  select * into v_state_row from public.board_game_state where room_id = p_room_id for update;
  if v_state_row.room_id is null then raise exception 'Room state not found' using errcode = '22023'; end if;

  -- Version-check-ordering lesson from the timeout fix applies here too:
  -- resolve BEFORE re-deriving anything from state, and never raise after
  -- a resolution that already committed real writes.
  select private.ludo_resolve_expired_turns(p_room_id) into v_timeout_events;
  v_events := v_events || coalesce(v_timeout_events, '[]'::jsonb);

  select * into v_room from public.board_game_rooms where id = p_room_id;
  select * into v_state_row from public.board_game_state where room_id = p_room_id for update;
  v_state := v_state_row.state;

  select * into v_player from public.board_game_players
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_player.id is null then
    raise exception 'You are not seated in this room' using errcode = '42501';
  end if;
  v_seat_index := v_player.seat_index;

  if coalesce((v_state->>'gameOver')::boolean, false) or v_player.eliminated_at is not null then
    -- The resolution above already ended the match (or eliminated the
    -- caller by timeout in this very call) — nothing left for a forfeit to
    -- do. Return the resolved state as-is rather than double-ending it.
    return jsonb_build_object(
      'room_id', v_state_row.room_id, 'state', v_state_row.state, 'version', v_state_row.version,
      'updated_at', v_state_row.updated_at, 'events', v_events, 'forfeited', false
    );
  end if;

  v_turn_seat := (v_state->>'turnSeatIndex')::int;
  v_active_before := coalesce(v_state->'activeSeatIndices', '[]'::jsonb);
  v_next_seat := private.ludo_next_active_seat(v_active_before, v_seat_index);

  update public.board_game_players
  set eliminated_at = now(), elimination_reason = 'forfeit'
  where id = v_player.id;

  v_active_after := (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(v_active_before) x where (x #>> '{}')::int <> v_seat_index);

  select count(*) into v_remaining_active
  from jsonb_array_elements(v_active_after) x
  join public.board_game_players bp on bp.room_id = p_room_id and bp.seat_index = (x #>> '{}')::int
  where bp.eliminated_at is null;

  v_state := jsonb_set(v_state, '{activeSeatIndices}', v_active_after);
  v_events := v_events || jsonb_build_object('type', 'playerForfeited', 'seatIndex', v_seat_index);

  if v_remaining_active <= 1 then
    -- The standard (and, for a 2-player match, only possible) case: the
    -- match ends right here, right now.
    select (x #>> '{}')::int into v_winner_seat
    from jsonb_array_elements(v_active_after) x
    join public.board_game_players bp on bp.room_id = p_room_id and bp.seat_index = (x #>> '{}')::int
    where bp.eliminated_at is null
    limit 1;

    v_state := jsonb_set(v_state, '{diceValue}', 'null'::jsonb);
    v_state := jsonb_set(v_state, '{consecutiveSixes}', '0'::jsonb);
    v_state := jsonb_set(v_state, '{gameOver}', 'true'::jsonb);

    v_finished := coalesce(v_state->'finishedOrder', '[]'::jsonb);
    if v_winner_seat is not null and not (v_finished @> to_jsonb(v_winner_seat)) then
      v_finished := v_finished || to_jsonb(v_winner_seat);
    end if;
    if not (v_finished @> to_jsonb(v_seat_index)) then
      v_finished := v_finished || to_jsonb(v_seat_index);
    end if;
    v_state := jsonb_set(v_state, '{finishedOrder}', v_finished);

    v_events := v_events || jsonb_build_object('type', 'gameOver', 'winnerSeatIndex', v_winner_seat, 'reason', 'player_forfeit');
  elsif v_turn_seat = v_seat_index then
    -- >2-player room, forfeiting player's own turn — pass it on cleanly.
    v_state := jsonb_set(v_state, '{diceValue}', 'null'::jsonb);
    v_state := jsonb_set(v_state, '{consecutiveSixes}', '0'::jsonb);
    v_state := jsonb_set(v_state, '{turnSeatIndex}', to_jsonb(v_next_seat));
  end if;
  -- else: >2-player room, not the forfeiting player's turn — turn/dice
  -- untouched, only activeSeatIndices shrinks.

  select coalesce(max(move_number), 0) + 1 into v_move_number from public.board_game_moves where room_id = p_room_id;
  insert into public.board_game_moves (room_id, move_number, seat_index, move, resulting_state)
  values (p_room_id, v_move_number, v_seat_index, jsonb_build_object('type', 'forfeit', 'seatIndex', v_seat_index), v_state);

  update public.board_game_state
  set state = v_state, version = version + 1, updated_at = now()
  where room_id = p_room_id
  returning * into v_state_row;

  update public.board_game_rooms
  set turn_deadline_at = case when coalesce((v_state->>'gameOver')::boolean, false) then null
                          else now() + (v_room.turn_timer_seconds * interval '1 second') end,
      turn_seat_index = (v_state->>'turnSeatIndex')::int
  where id = p_room_id;

  -- Finalize immediately — idempotent (finalize_board_game locks on
  -- `status <> 'completed'`), so this makes forfeit fully self-contained:
  -- the match is COMPLETED, rewards granted exactly once, the instant this
  -- call returns, rather than waiting on a separate client-side effect.
  if coalesce((v_state->>'gameOver')::boolean, false) then
    perform public.finalize_ludo_match(p_room_id);
  end if;

  return jsonb_build_object(
    'room_id', v_state_row.room_id, 'state', v_state_row.state, 'version', v_state_row.version,
    'updated_at', v_state_row.updated_at, 'events', v_events, 'forfeited', true
  );
end;
$function$;

revoke execute on function public.forfeit_ludo_match(uuid) from public, anon;
grant execute on function public.forfeit_ludo_match(uuid) to authenticated;

-- ── 3. Owner-only cleanup for rooms that are stuck active despite a long-
--       expired (or, as with the two rooms found live, entirely missing)
--       deadline. Never awards rewards for a force-closed room — it's
--       marked 'abandoned', a status the reward-granting path never
--       touches, not 'completed'. ─────────────────────────────────────────
create or replace function public.admin_force_close_ludo_room(p_room_id uuid, p_reason text default 'Abandoned — force-closed by owner')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $$
declare
  v_room public.board_game_rooms;
  i int;
begin
  perform private.require_owner();

  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'Room not found' using errcode = '22023'; end if;
  if v_room.game_id <> 'ludo' then raise exception 'Not a Ludo room' using errcode = '22023'; end if;
  if v_room.status in ('completed', 'abandoned') then
    return jsonb_build_object('room_id', v_room.id, 'status', v_room.status, 'action', 'already_closed');
  end if;

  -- Give the legitimate resolver every chance to resolve this from its own
  -- stored timestamps first (repeated in case the room's already-expired
  -- deadline needs more than one 20-iteration pass to fully cascade).
  for i in 1..5 loop
    perform private.ludo_resolve_expired_turns(p_room_id);
    select * into v_room from public.board_game_rooms where id = p_room_id;
    exit when v_room.status <> 'active';
  end loop;

  if v_room.status = 'completed' then
    perform private.log_admin_action(auth.uid(), 'Resolved stale Ludo match', 'reset', p_room_id::text,
      'Resolved via stored missed-turn timestamps', null, 'active', 'completed');
    return jsonb_build_object('room_id', p_room_id, 'status', 'completed', 'action', 'resolved_via_missed_turns');
  end if;

  if v_room.status <> 'active' then
    return jsonb_build_object('room_id', p_room_id, 'status', v_room.status, 'action', 'already_closed');
  end if;

  -- Still active after exhausting legitimate resolution — genuinely
  -- abandoned (no real missed-turn history to resolve from, e.g. a
  -- pre-migration room with no deadline ever recorded). Force-close
  -- WITHOUT awarding rewards to anyone.
  update public.board_game_players
  set eliminated_at = coalesce(eliminated_at, now()), elimination_reason = coalesce(elimination_reason, 'admin_abandoned')
  where room_id = p_room_id and left_at is null and eliminated_at is null;

  update public.board_game_rooms
  set status = 'abandoned', completed_at = now(), turn_deadline_at = null
  where id = p_room_id;

  -- Note: admin_log's category CHECK constraint has a closed allow-list
  -- with no 'board_game' value — 'reset' is the closest existing category
  -- (see the Reset Player Progress RPC) rather than widening that
  -- constraint for one new action.
  perform private.log_admin_action(auth.uid(), 'Force-closed abandoned Ludo match', 'reset', p_room_id::text,
    coalesce(p_reason, ''), null, 'active', 'abandoned');

  return jsonb_build_object('room_id', p_room_id, 'status', 'abandoned', 'action', 'force_closed_no_rewards');
end;
$$;

revoke all on function public.admin_force_close_ludo_room(uuid, text) from public, anon, authenticated;
grant execute on function public.admin_force_close_ludo_room(uuid, text) to authenticated;
