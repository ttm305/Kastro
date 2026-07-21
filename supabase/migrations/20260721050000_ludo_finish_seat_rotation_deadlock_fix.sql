-- ─────────────────────────────────────────────────────────────────────────
-- Ludo — fix a genuine server-side deadlock found during this round's full
-- turn-flow audit (task: "audit reconnect/timeout/extra-turn/forfeit/
-- elimination/stale/resume; server and client must never disagree whose
-- turn it is").
--
-- BUG (ludo_apply_piece_move): when a piece move finishes a seat's LAST
-- piece (all 4 home), the seat is removed from activeSeatIndices BEFORE the
-- "who goes next" lookup runs. ludo_next_active_seat(active, from) finds
-- `from`'s position in `active` and returns whoever is next in that array;
-- if `from` (the seat that just finished) was already filtered OUT of
-- `active`, the lookup fails (position not found) and the function falls
-- back to returning `from` unchanged — parking turnSeatIndex on a seat that
-- has zero pieces left on the board and is no longer in activeSeatIndices.
--
-- In a 2-player match this is unreachable: finishing drops activeSeatIndices
-- to length 1, which the very next check turns into gameOver=true before
-- next-turn is ever computed — so two-account testing this round could not
-- have surfaced it. But this project's Ludo rooms support up to 4 seated
-- players (confirmed live: board_game_rooms rows exist with max_players=4),
-- and in any 3-4 player match where one seat finishes before the others,
-- turnSeatIndex gets stuck on the just-finished seat permanently: that
-- player has no legal moves ever again (ludo_legal_piece_ids correctly
-- returns none for an all-home seat), nobody else can ever roll, and even
-- the timeout resolver can't recover — it looks up the seat by
-- turn_seat_index, increments its missed-turn counter, and computes the
-- "next" seat the exact same broken way (also fixed below), so it loops on
-- the same dead seat instead of eliminating past it. This is a genuine,
-- previously-undetected deadlock, exactly the class of bug this round's
-- audit was commissioned to find — not a client-side symptom, a real gap
-- in server turn-authority.
--
-- FIX: compute the "next seat" lookup against the PRE-removal active list
-- (which still contains the finishing seat, so the position lookup always
-- succeeds), matching the pattern already used correctly elsewhere
-- (ludo_resolve_expired_turns and forfeit_ludo_match both already compute
-- next-seat before filtering the departing seat out of the active list).
-- The identical bug was also found and fixed in the client-side TS engine
-- (src/lib/boardgames/ludo/engine.ts, used for local pass-and-play/AI
-- matches) in the same pass.
--
-- SECONDARY FIX (forfeit_ludo_match): forfeiting was unconditionally
-- resetting turn_deadline_at to a fresh full timer, even when the
-- forfeiting player was NOT the seat currently on the clock. That silently
-- extended the actual turn-holder's remaining time on every forfeit by any
-- other seated player — not a deadlock, but a real "server and client
-- disagree about the deadline" gap worth closing while turn_deadline_at is
-- being audited as the single source of truth. Now the deadline is only
-- reset when the forfeit actually changed whose turn it is (or ended the
-- game); otherwise the existing deadline is left untouched.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function private.ludo_apply_piece_move(p_state jsonb, p_seat integer, p_piece_index integer, p_dice integer, p_piece_id text)
returns jsonb
language plpgsql
set search_path to 'public', 'private'
as $$
declare
  v_pieces jsonb := p_state->'pieces';
  v_new_pieces jsonb;
  v_piece jsonb;
  v_other jsonb;
  v_from_pos int;
  v_to_pos int;
  v_from_base boolean;
  v_events jsonb := '[]'::jsonb;
  v_landed_cell int;
  v_pieces_lost jsonb := coalesce(p_state->'piecesLostCount', '{}'::jsonb);
  v_finished_order jsonb := coalesce(p_state->'finishedOrder', '[]'::jsonb);
  v_active jsonb := coalesce(p_state->'activeSeatIndices', '[]'::jsonb);
  v_active_before_finish jsonb := coalesce(p_state->'activeSeatIndices', '[]'::jsonb);
  v_game_over boolean := coalesce((p_state->>'gameOver')::boolean, false);
  v_num_seats int := (p_state->>'numSeats')::int;
  v_by_seat jsonb := '{}'::jsonb;
  v_seat_key text;
  v_group jsonb;
  v_captured boolean := false;
  v_rolled_six boolean := (p_dice = 6);
  v_prev_consecutive int := coalesce((p_state->>'consecutiveSixes')::int, 0);
  v_earns_extra boolean;
  v_next_turn int;
  v_seat_pieces int;
  v_seat_home int;
begin
  v_new_pieces := '[]'::jsonb;
  for v_piece in select * from jsonb_array_elements(v_pieces)
  loop
    if (v_piece->>'seatIndex')::int = p_seat and (v_piece->>'pieceIndex')::int = p_piece_index then
      v_from_pos := (v_piece->>'pathPos')::int;
      v_from_base := (v_from_pos = -1);
      v_to_pos := case when v_from_base then 0 else v_from_pos + p_dice end;
      v_piece := jsonb_set(v_piece, '{pathPos}', to_jsonb(v_to_pos));
      v_events := v_events || jsonb_build_object(
        'type', 'pieceMoved', 'seatIndex', p_seat, 'pieceId', p_piece_id,
        'from', case when v_from_base then -1 else v_from_pos end, 'to', v_to_pos
      );
    end if;
    v_new_pieces := v_new_pieces || v_piece;
  end loop;
  v_pieces := v_new_pieces;

  v_landed_cell := private.ludo_global_cell(p_seat, v_to_pos);
  if v_landed_cell is not null and not private.ludo_is_safe_cell(v_landed_cell) then
    for v_other in select * from jsonb_array_elements(v_pieces)
    loop
      if (v_other->>'seatIndex')::int = p_seat then continue; end if;
      if private.ludo_global_cell((v_other->>'seatIndex')::int, (v_other->>'pathPos')::int) = v_landed_cell then
        v_seat_key := v_other->>'seatIndex';
        v_by_seat := jsonb_set(
          v_by_seat, array[v_seat_key],
          coalesce(v_by_seat->v_seat_key, '[]'::jsonb) || jsonb_build_array(v_other)
        );
      end if;
    end loop;

    for v_seat_key in select jsonb_object_keys(v_by_seat)
    loop
      v_group := v_by_seat->v_seat_key;
      if jsonb_array_length(v_group) >= 2 then
        continue;
      end if;

      v_new_pieces := '[]'::jsonb;
      for v_piece in select * from jsonb_array_elements(v_pieces)
      loop
        if (v_piece->>'seatIndex') = (v_group->0->>'seatIndex')
           and (v_piece->>'pieceIndex') = (v_group->0->>'pieceIndex') then
          v_piece := jsonb_set(v_piece, '{pathPos}', to_jsonb(-1));
          v_captured := true;
          v_pieces_lost := jsonb_set(
            v_pieces_lost, array[v_seat_key],
            to_jsonb(coalesce((v_pieces_lost->>v_seat_key)::int, 0) + 1)
          );
          v_events := v_events || jsonb_build_object(
            'type', 'pieceCaptured', 'capturedSeatIndex', v_seat_key::int,
            'byPieceId', p_piece_id, 'atCell', v_landed_cell
          );
        end if;
        v_new_pieces := v_new_pieces || v_piece;
      end loop;
      v_pieces := v_new_pieces;
    end loop;
  end if;

  if v_to_pos = 56 then
    v_events := v_events || jsonb_build_object('type', 'pieceHome', 'seatIndex', p_seat, 'pieceId', p_piece_id);
    select count(*) into v_seat_pieces from jsonb_array_elements(v_pieces) x where (x->>'seatIndex')::int = p_seat;
    select count(*) into v_seat_home from jsonb_array_elements(v_pieces) x where (x->>'seatIndex')::int = p_seat and (x->>'pathPos')::int = 56;
    if v_seat_pieces = v_seat_home and not (v_finished_order @> to_jsonb(p_seat)) then
      v_finished_order := v_finished_order || to_jsonb(p_seat);
      v_active := (select coalesce(jsonb_agg(x), '[]'::jsonb) from jsonb_array_elements(v_active) x where (x #>> '{}')::int <> p_seat);
      v_events := v_events || jsonb_build_object('type', 'seatFinished', 'seatIndex', p_seat, 'place', jsonb_array_length(v_finished_order));
    end if;
  end if;

  if jsonb_array_length(v_active) <= 1 then
    v_game_over := true;
    if jsonb_array_length(v_active) = 1 and not (v_finished_order @> (v_active->0)) then
      v_finished_order := v_finished_order || (v_active->0);
    end if;
    v_events := v_events || jsonb_build_object('type', 'gameOver');
  end if;

  v_earns_extra := (v_rolled_six and v_prev_consecutive < 3) or v_captured;
  if v_game_over then
    v_next_turn := (p_state->>'turnSeatIndex')::int;
  elsif v_earns_extra and (v_active @> to_jsonb(p_seat)) then
    v_next_turn := p_seat;
  else
    -- Use the PRE-finish active list so p_seat's position is always found,
    -- even when this move just removed p_seat from v_active above. See
    -- migration header — this is the deadlock fix.
    v_next_turn := private.ludo_next_active_seat(v_active_before_finish, p_seat);
  end if;

  return jsonb_build_object(
    'numSeats', v_num_seats,
    'pieces', v_pieces,
    'turnSeatIndex', v_next_turn,
    'diceValue', null,
    'consecutiveSixes', case when v_rolled_six then v_prev_consecutive else 0 end,
    'finishedOrder', v_finished_order,
    'activeSeatIndices', v_active,
    'gameOver', v_game_over,
    'piecesLostCount', v_pieces_lost,
    '_lastEvents', v_events
  );
end;
$$;

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
  v_turn_changed boolean := false;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'Room not found' using errcode = '22023'; end if;
  if v_room.game_id <> 'ludo' then raise exception 'Not a Ludo room' using errcode = '22023'; end if;
  if v_room.status <> 'active' then
    raise exception 'Match is not active' using errcode = '22023';
  end if;

  select * into v_state_row from public.board_game_state where room_id = p_room_id for update;
  if v_state_row.room_id is null then raise exception 'Room state not found' using errcode = '22023'; end if;

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
    select (x #>> '{}')::int into v_winner_seat
    from jsonb_array_elements(v_active_after) x
    join public.board_game_players bp on bp.room_id = p_room_id and bp.seat_index = (x #>> '{}')::int
    where bp.eliminated_at is null
    limit 1;

    v_state := jsonb_set(v_state, '{diceValue}', 'null'::jsonb);
    v_state := jsonb_set(v_state, '{consecutiveSixes}', '0'::jsonb);
    v_state := jsonb_set(v_state, '{gameOver}', 'true'::jsonb);
    v_turn_changed := true;

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
    v_state := jsonb_set(v_state, '{diceValue}', 'null'::jsonb);
    v_state := jsonb_set(v_state, '{consecutiveSixes}', '0'::jsonb);
    v_state := jsonb_set(v_state, '{turnSeatIndex}', to_jsonb(v_next_seat));
    v_turn_changed := true;
  end if;

  select coalesce(max(move_number), 0) + 1 into v_move_number from public.board_game_moves where room_id = p_room_id;
  insert into public.board_game_moves (room_id, move_number, seat_index, move, resulting_state)
  values (p_room_id, v_move_number, v_seat_index, jsonb_build_object('type', 'forfeit', 'seatIndex', v_seat_index), v_state);

  update public.board_game_state
  set state = v_state, version = version + 1, updated_at = now()
  where room_id = p_room_id
  returning * into v_state_row;

  -- Only touch turn_deadline_at when this forfeit actually ended the game
  -- or actually moved the turn off the forfeiting seat. If it was someone
  -- else's turn, that seat's already-ticking deadline is left exactly as
  -- it was — a forfeit by a different player must never hand the current
  -- turn-holder extra time. See migration header.
  update public.board_game_rooms
  set turn_deadline_at = case
                            when coalesce((v_state->>'gameOver')::boolean, false) then null
                            when v_turn_changed then now() + (v_room.turn_timer_seconds * interval '1 second')
                            else turn_deadline_at
                          end,
      turn_seat_index = (v_state->>'turnSeatIndex')::int
  where id = p_room_id;

  if coalesce((v_state->>'gameOver')::boolean, false) then
    perform public.finalize_ludo_match(p_room_id);
  end if;

  return jsonb_build_object(
    'room_id', v_state_row.room_id, 'state', v_state_row.state, 'version', v_state_row.version,
    'updated_at', v_state_row.updated_at, 'events', v_events, 'forfeited', true
  );
end;
$function$;
