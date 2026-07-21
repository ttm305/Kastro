-- ludo_submit_move now: (1) resolves any already-expired turn FIRST, inside
-- the same atomic transaction, before looking at the caller's own intent —
-- so a stale timer is fixed the instant anyone touches the room, not just
-- when the timed-out player happens to act; (2) rejects eliminated callers
-- outright; (3) resets the acting seat's consecutive_missed_turns and
-- last_action_at on every successful action, per "a valid action resets
-- the counter". If resolving the expired turn means it's no longer the
-- caller's turn (or the match just ended by forfeit), their intent is
-- simply not applied — no exception, no rollback of the resolution — the
-- caller just gets back the resolved state and sees why via its events.

drop function if exists public.ludo_submit_move(uuid, integer, jsonb);

create or replace function public.ludo_submit_move(
  p_room_id uuid,
  p_expected_version integer,
  p_move jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
declare
  v_room public.board_game_rooms;
  v_state_row public.board_game_state;
  v_state jsonb;
  v_seat_index int;
  v_player public.board_game_players;
  v_move_type text;
  v_piece_id text;
  v_move_seat int;
  v_move_piece_idx int;
  v_dice int;
  v_consecutive_sixes int;
  v_turn_seat int;
  v_game_over boolean;
  v_active_seats jsonb;
  v_legal_piece_ids text[];
  v_die int;
  v_move_number int;
  v_events jsonb := '[]'::jsonb;
  v_timeout_events jsonb;
  v_next_turn int;
  v_rolled_six boolean;
  v_acted boolean := false;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then
    raise exception 'Room not found' using errcode = '22023';
  end if;
  if v_room.game_id <> 'ludo' then
    raise exception 'Not a Ludo room' using errcode = '22023';
  end if;
  if v_room.status <> 'active' then
    raise exception 'Match is not active' using errcode = '22023';
  end if;

  -- Snapshot the version BEFORE resolving anything. This is what
  -- p_expected_version is validated against — not the post-resolution
  -- version. If we compared against the post-resolution version instead,
  -- a resolution that legitimately changed the version out from under an
  -- otherwise-perfectly-current request would raise "stale state", and
  -- since that error rolls back this whole transaction (Postgres has no
  -- implicit sub-transaction around the resolver call), it would undo the
  -- resolution too — reintroducing the exact freeze this migration exists
  -- to fix, just one call later. (Caught live: two accounts, forced-expiry
  -- test, second actor's next move raised 40001 and the timeout it had
  -- just resolved silently vanished.)
  select * into v_state_row from public.board_game_state where room_id = p_room_id for update;
  if v_state_row.room_id is null then
    raise exception 'Room state not found' using errcode = '22023';
  end if;
  if v_state_row.version <> p_expected_version then
    raise exception 'Stale state — refetch and retry' using errcode = '40001';
  end if;

  -- Resolve any already-expired turn before anything else. This can change
  -- turn_seat_index, turn_deadline_at, board_game_state.version, and even
  -- flip the match to gameOver — all committed as part of THIS transaction.
  select private.ludo_resolve_expired_turns(p_room_id) into v_timeout_events;
  v_events := v_events || coalesce(v_timeout_events, '[]'::jsonb);

  select * into v_room from public.board_game_rooms where id = p_room_id;
  select * into v_state_row from public.board_game_state where room_id = p_room_id for update;

  select * into v_player
  from public.board_game_players
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_player.id is null then
    raise exception 'You are not seated in this room' using errcode = '42501';
  end if;
  v_seat_index := v_player.seat_index;

  v_state := v_state_row.state;
  v_turn_seat := (v_state->>'turnSeatIndex')::int;
  v_game_over := coalesce((v_state->>'gameOver')::boolean, false);

  -- The resolver above may have just ended the match, moved the turn away
  -- from the caller, or (this exact call) eliminated the caller outright.
  -- Any of those means there's nothing left for THIS intent to do — return
  -- the resolved state as-is rather than raising, so the resolution itself
  -- is never rolled back by an intent that no longer applies. This is also
  -- the ordinary, expected way an elimination surfaces to the eliminated
  -- player's own client: not an error, just a resolved state showing them
  -- eliminated_at set and gameOver possibly true.
  if v_game_over or v_turn_seat <> v_seat_index or v_player.eliminated_at is not null then
    return jsonb_build_object(
      'room_id', v_state_row.room_id, 'state', v_state_row.state, 'version', v_state_row.version,
      'updated_at', v_state_row.updated_at, 'events', v_events
    );
  end if;

  v_dice := (v_state->>'diceValue')::int;
  v_consecutive_sixes := coalesce((v_state->>'consecutiveSixes')::int, 0);
  v_active_seats := coalesce(v_state->'activeSeatIndices', '[]'::jsonb);

  v_move_type := coalesce(p_move->>'type', 'pass');

  select coalesce(max(move_number), 0) + 1 into v_move_number from public.board_game_moves where room_id = p_room_id;

  if v_move_type = 'roll' then
    if v_dice is not null then
      raise exception 'Already rolled — move a piece first' using errcode = '22023';
    end if;

    v_die := floor(random() * 6)::int + 1;
    v_events := v_events || jsonb_build_object('type', 'diceRolled', 'seatIndex', v_seat_index, 'value', v_die);
    v_acted := true;

    if v_die = 6 then
      v_consecutive_sixes := v_consecutive_sixes + 1;
    else
      v_consecutive_sixes := 0;
    end if;

    if v_die = 6 and v_consecutive_sixes >= 3 then
      v_events := v_events || jsonb_build_object('type', 'threeSixesForfeit', 'seatIndex', v_seat_index);
      v_next_turn := private.ludo_next_active_seat(v_active_seats, v_seat_index);
      v_state := jsonb_set(v_state, '{diceValue}', 'null'::jsonb);
      v_state := jsonb_set(v_state, '{consecutiveSixes}', '0'::jsonb);
      v_state := jsonb_set(v_state, '{turnSeatIndex}', to_jsonb(v_next_turn));
    else
      v_state := jsonb_set(v_state, '{diceValue}', to_jsonb(v_die));
      v_state := jsonb_set(v_state, '{consecutiveSixes}', to_jsonb(v_consecutive_sixes));
    end if;

  elsif v_move_type = 'pass' then
    if v_dice is null then
      raise exception 'Nothing to pass — roll first' using errcode = '22023';
    end if;
    v_legal_piece_ids := private.ludo_legal_piece_ids(v_state, v_seat_index);
    if array_length(v_legal_piece_ids, 1) > 0 then
      raise exception 'A legal move exists' using errcode = '22023';
    end if;

    v_events := v_events || jsonb_build_object('type', 'noMovesAvailable', 'seatIndex', v_seat_index);
    v_acted := true;
    v_rolled_six := (v_dice = 6);
    v_state := jsonb_set(v_state, '{diceValue}', 'null'::jsonb);
    if v_rolled_six and v_consecutive_sixes < 3 then
      null; -- stays with the same seat (extra roll from the 6, even though unused)
    else
      v_next_turn := private.ludo_next_active_seat(v_active_seats, v_seat_index);
      v_state := jsonb_set(v_state, '{turnSeatIndex}', to_jsonb(v_next_turn));
      v_state := jsonb_set(v_state, '{consecutiveSixes}', '0'::jsonb);
    end if;

  elsif v_move_type = 'move' then
    if v_dice is null then
      raise exception 'Roll before moving' using errcode = '22023';
    end if;
    v_piece_id := p_move->>'pieceId';
    if v_piece_id is null or v_piece_id = '' then
      raise exception 'Missing pieceId' using errcode = '22023';
    end if;
    v_move_seat := split_part(v_piece_id, ':', 1)::int;
    v_move_piece_idx := split_part(v_piece_id, ':', 2)::int;
    if v_move_seat <> v_seat_index then
      raise exception 'Cannot move another seat''s piece' using errcode = '42501';
    end if;

    v_legal_piece_ids := private.ludo_legal_piece_ids(v_state, v_seat_index);
    if not (v_piece_id = any(v_legal_piece_ids)) then
      raise exception 'Illegal move' using errcode = '22023';
    end if;

    v_state := private.ludo_apply_piece_move(v_state, v_seat_index, v_move_piece_idx, v_dice, v_piece_id);
    v_events := v_events || coalesce(v_state->'_lastEvents', '[]'::jsonb);
    v_state := v_state - '_lastEvents';
    v_acted := true;

  else
    raise exception 'Unknown move type' using errcode = '22023';
  end if;

  insert into public.board_game_moves (room_id, move_number, seat_index, move, resulting_state)
  values (p_room_id, v_move_number, v_seat_index, coalesce(p_move, '{}'::jsonb) || jsonb_build_object('_events', v_events), v_state);

  update public.board_game_state
  set state = v_state, version = version + 1, updated_at = now()
  where room_id = p_room_id
  returning * into v_state_row;

  update public.board_game_rooms
  set turn_seat_index = (v_state->>'turnSeatIndex')::int,
      turn_started_at = now(),
      turn_deadline_at = case
        when coalesce((v_state->>'gameOver')::boolean, false) then null
        else now() + (v_room.turn_timer_seconds * interval '1 second')
      end
  where id = p_room_id;

  if v_acted then
    update public.board_game_players
    set consecutive_missed_turns = 0, last_action_at = now()
    where room_id = p_room_id and seat_index = v_seat_index;
  end if;

  return jsonb_build_object(
    'room_id', v_state_row.room_id,
    'state', v_state_row.state,
    'version', v_state_row.version,
    'updated_at', v_state_row.updated_at,
    'events', v_events
  );
end;
$function$;

revoke execute on function public.ludo_submit_move(uuid, integer, jsonb) from public, anon;
grant execute on function public.ludo_submit_move(uuid, integer, jsonb) to authenticated;
