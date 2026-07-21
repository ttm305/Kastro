-- The client needs the server-computed event stream (diceRolled, pieceMoved,
-- pieceCaptured, pieceHome, threeSixesForfeit, noMovesAvailable, gameOver)
-- to drive animations and the required on-screen messages ("Rolled 6",
-- "Captured opponent", "Three consecutive sixes — turn lost.", "No legal
-- move") — the client can no longer compute these locally since it no
-- longer runs the rules engine itself. Widen ludo_submit_move's return
-- value from the bare board_game_state row to a jsonb envelope that also
-- carries the events this specific call produced. Return type changes
-- require drop+recreate, not create-or-replace.

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
  v_next_turn int;
  v_rolled_six boolean;
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

  select * into v_state_row from public.board_game_state where room_id = p_room_id for update;
  if v_state_row.room_id is null then
    raise exception 'Room state not found' using errcode = '22023';
  end if;
  if v_state_row.version <> p_expected_version then
    raise exception 'Stale state — refetch and retry' using errcode = '40001';
  end if;

  select seat_index into v_seat_index
  from public.board_game_players
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_seat_index is null then
    raise exception 'You are not seated in this room' using errcode = '42501';
  end if;

  v_state := v_state_row.state;
  v_turn_seat := (v_state->>'turnSeatIndex')::int;
  v_game_over := coalesce((v_state->>'gameOver')::boolean, false);
  v_dice := (v_state->>'diceValue')::int;
  v_consecutive_sixes := coalesce((v_state->>'consecutiveSixes')::int, 0);
  v_active_seats := coalesce(v_state->'activeSeatIndices', '[]'::jsonb);

  if v_game_over then
    raise exception 'Match already finished' using errcode = '22023';
  end if;
  if v_turn_seat <> v_seat_index then
    raise exception 'Not your turn' using errcode = '42501';
  end if;

  v_move_type := coalesce(p_move->>'type', 'pass');

  select coalesce(max(move_number), 0) + 1 into v_move_number from public.board_game_moves where room_id = p_room_id;

  if v_move_type = 'roll' then
    if v_dice is not null then
      raise exception 'Already rolled — move a piece first' using errcode = '22023';
    end if;

    v_die := floor(random() * 6)::int + 1;
    v_events := v_events || jsonb_build_object('type', 'diceRolled', 'seatIndex', v_seat_index, 'value', v_die);

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
    v_rolled_six := (v_dice = 6);
    v_state := jsonb_set(v_state, '{diceValue}', 'null'::jsonb);
    if v_rolled_six and v_consecutive_sixes < 3 then
      null;
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
  set turn_seat_index = (v_state->>'turnSeatIndex')::int, turn_started_at = now()
  where id = p_room_id;

  return jsonb_build_object(
    'room_id', v_state_row.room_id,
    'state', v_state_row.state,
    'version', v_state_row.version,
    'updated_at', v_state_row.updated_at,
    'events', v_events
  );
end;
$function$;

grant execute on function public.ludo_submit_move(uuid, integer, jsonb) to authenticated;
