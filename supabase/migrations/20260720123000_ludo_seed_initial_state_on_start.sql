-- Second root cause found while live-testing the server-authoritative path:
-- start_board_game_room flipped a room to 'active' but never touched
-- board_game_state — it stayed the '{}' placeholder inserted at room
-- creation forever. The client's engine.currentSeatIndex({}) then returns
-- undefined, getValidMoves({}, undefined) calls `state.pieces.filter(...)`
-- on undefined and throws, crashing OnlineLudoMatch the instant a match
-- started. This seeds a real LudoState in the SAME atomic transaction as
-- the status flip, so there is never a window where status='active' but
-- state is still empty.

create or replace function private.ludo_initial_state(p_num_seats int, p_first_seat int)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_pieces jsonb := '[]'::jsonb;
  v_active jsonb := '[]'::jsonb;
  v_lost jsonb := '{}'::jsonb;
  s int;
  p int;
begin
  for s in 0 .. p_num_seats - 1 loop
    v_active := v_active || to_jsonb(s);
    v_lost := jsonb_set(v_lost, array[s::text], to_jsonb(0));
    for p in 0 .. 3 loop
      v_pieces := v_pieces || jsonb_build_object('seatIndex', s, 'pieceIndex', p, 'pathPos', -1);
    end loop;
  end loop;
  return jsonb_build_object(
    'numSeats', p_num_seats,
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
  set status = 'active', started_at = now(), turn_seat_index = v_first_seat, turn_started_at = now()
  where id = p_room_id;

  if v_room.game_id = 'ludo' then
    update public.board_game_state
    set state = private.ludo_initial_state(v_seated_count, v_first_seat), version = 1, updated_at = now()
    where room_id = p_room_id;
  end if;

  return query select * from public.board_game_rooms where id = p_room_id;
end;
$function$;
