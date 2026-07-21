-- ─────────────────────────────────────────────────────────────────────────
-- Ludo — server-authoritative move engine.
--
-- Root cause being fixed: submit_board_game_move previously accepted a
-- complete CLIENT-COMPUTED board state (p_new_state jsonb) and a
-- client-claimed p_seat_index, writing them verbatim after only an
-- optimistic-concurrency version check. Dice values were rolled inside the
-- browser. Any authenticated player could therefore roll their own sixes,
-- teleport pieces, or fabricate captures, and the server had no way to
-- detect it. finalize_board_game had the same problem for match results:
-- it trusted client-supplied rankings/scores with no membership check at
-- all (even `anon`/PUBLIC held EXECUTE on both functions).
--
-- This migration ports the Ludo rules engine (src/lib/boardgames/ludo/
-- engine.ts) into plpgsql so the server rolls the die itself, computes the
-- legal-move set itself, and applies capture/pair-protection/home/win/
-- extra-turn logic itself — the client only ever sends an intent
-- ({"type":"roll"} / {"type":"move","pieceId":"S:P"} / {"type":"pass"}) and
-- displays whatever the server returns. Every state mutation happens inside
-- one atomic, row-locked transaction per RPC call, keyed by the existing
-- board_game_state.version optimistic-concurrency column (which also
-- serves as the per-turn sequence number that rejects stale/replayed
-- submissions) plus board_game_moves.move_number as a durable audit trail.
-- ─────────────────────────────────────────────────────────────────────────

-- ── Pure helpers (private schema — not exposed via PostgREST) ─────────────

create or replace function private.ludo_global_cell(p_seat int, p_path_pos int)
returns int
language sql
immutable
as $$
  select case
    when p_path_pos < 0 or p_path_pos > 50 then null
    else ((array[0,13,26,39])[p_seat + 1] + p_path_pos) % 52
  end;
$$;

create or replace function private.ludo_is_safe_cell(p_cell int)
returns boolean
language sql
immutable
as $$
  select p_cell = any(array[0,8,13,21,26,34,39,47]);
$$;

-- Next seat in turn order after p_from, cycling through the still-active
-- seat list (mirrors nextActiveSeat in engine.ts).
create or replace function private.ludo_next_active_seat(p_active jsonb, p_from int)
returns int
language plpgsql
immutable
as $$
declare
  v_arr int[];
  v_idx int;
  v_n int;
begin
  select array_agg((elem #>> '{}')::int order by ord)
  into v_arr
  from jsonb_array_elements(p_active) with ordinality as t(elem, ord);

  v_n := coalesce(array_length(v_arr, 1), 0);
  if v_n = 0 then return p_from; end if;

  v_idx := array_position(v_arr, p_from);
  if v_idx is null then return p_from; end if;

  return v_arr[(v_idx % v_n) + 1];
end;
$$;

-- Every legal "S:P" pieceId for p_seat given the state's current diceValue.
-- Mirrors LudoEngine.getValidMoves's move-construction loop exactly
-- (exact-number-to-finish, base needs a 6, already-finished pieces skipped).
create or replace function private.ludo_legal_piece_ids(p_state jsonb, p_seat int)
returns text[]
language plpgsql
immutable
as $$
declare
  v_dice int := (p_state->>'diceValue')::int;
  v_piece jsonb;
  v_path int;
  v_target int;
  v_out text[] := array[]::text[];
begin
  if v_dice is null then return v_out; end if;

  for v_piece in select * from jsonb_array_elements(p_state->'pieces')
  loop
    if (v_piece->>'seatIndex')::int <> p_seat then continue; end if;
    v_path := (v_piece->>'pathPos')::int;
    if v_path = 56 then continue; end if;
    if v_path = -1 then
      if v_dice = 6 then
        v_out := v_out || (p_seat::text || ':' || (v_piece->>'pieceIndex'));
      end if;
      continue;
    end if;
    v_target := v_path + v_dice;
    if v_target > 56 then continue; end if;
    v_out := v_out || (p_seat::text || ':' || (v_piece->>'pieceIndex'));
  end loop;

  return v_out;
end;
$$;

-- Applies one piece's move: relocation, protected-pair-aware capture,
-- home/win detection, and extra-turn/next-seat resolution. Returns the full
-- new state jsonb plus a scratch `_lastEvents` key the caller extracts and
-- strips before persisting. Mirrors LudoEngine.applyMove's 'move' branch.
create or replace function private.ludo_apply_piece_move(
  p_state jsonb, p_seat int, p_piece_index int, p_dice int, p_piece_id text
) returns jsonb
language plpgsql
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
  -- Relocate the moved piece.
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

  -- Capture check — never on a safe cell; opposing pieces are grouped by
  -- seat first so a same-seat pair (2+) is left untouched (protected pair,
  -- NOT the traditional blocking rule — this piece still landed here fine).
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
        continue; -- protected pair — immune to capture
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

  -- Home / win detection.
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

  -- A six and a capture each independently earn another turn (OR, not
  -- stacked); the three-consecutive-sixes cap only applies to the six
  -- streak itself. Mirrors engine.ts's earnsExtraTurn exactly.
  v_earns_extra := (v_rolled_six and v_prev_consecutive < 3) or v_captured;
  if v_game_over then
    v_next_turn := (p_state->>'turnSeatIndex')::int;
  elsif v_earns_extra and (v_active @> to_jsonb(p_seat)) then
    v_next_turn := p_seat;
  else
    v_next_turn := private.ludo_next_active_seat(v_active, p_seat);
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

-- ── The one write path for Ludo moves ──────────────────────────────────
--
-- p_move is one of:
--   {"type":"roll"}
--   {"type":"move","pieceId":"<seatIndex>:<pieceIndex>"}
--   {"type":"pass"}   -- only honored if the server itself finds zero legal moves
--
-- The caller's seat is derived from auth.uid() — never trusted from input.
-- Turn ownership, dice-rolled-state, and move legality are all
-- re-validated server-side against the authoritative row, which this
-- function locks with SELECT ... FOR UPDATE for the duration of the call.
create or replace function public.ludo_submit_move(
  p_room_id uuid,
  p_expected_version integer,
  p_move jsonb
) returns board_game_state
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

  return v_state_row;
end;
$function$;

-- ── Ludo match finalization — rankings/scores derived server-side ─────────
--
-- Replaces the client-supplied p_rankings/p_scores/p_meta path for Ludo:
-- reads the authoritative board_game_state itself (only valid once its own
-- gameOver flag is true) and derives every payout input from it, then
-- delegates to the existing finalize_board_game payout/achievement pipeline
-- so that logic isn't duplicated. A client can no longer influence its own
-- rank or score by what it sends — there is nothing left to send.
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
  v_num_seats int;
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
    return; -- already completed (or never started) — idempotent no-op
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
  v_num_seats := coalesce((v_state->>'numSeats')::int, 0);

  for v_seat in 0 .. v_num_seats - 1 loop
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

-- ── Harden the generic (non-Ludo) primitives as defense in depth ──────────
-- These previously had zero auth checks and were even executable by `anon`.
-- finalize_board_game keeps accepting explicit rankings (future non-Ludo
-- games may still use it that way) but now requires the caller to actually
-- be a participant. submit_board_game_move now requires the caller to own
-- the seat they claim and (for active matches) that it's actually their
-- turn — it still trusts the client-computed p_new_state for any future
-- non-Ludo game built on this generic path, which is a known limitation of
-- the shared framework; Ludo itself no longer uses this function at all.

create or replace function public.finalize_board_game(p_room_id uuid, p_rankings jsonb, p_scores jsonb DEFAULT '{}'::jsonb, p_meta jsonb DEFAULT '{}'::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_room public.board_game_rooms;
  v_game_name text;
  v_game_name_ar text;
  v_player record;
  v_rank int;
  v_score int;
  v_coins int;
  v_base int;
  v_coin_key text;
  v_is_multiplayer boolean;
  v_total_players int;
  v_seat_meta jsonb;
  v_is_member boolean;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id and status <> 'completed' for update;
  if v_room.id is null then return; end if;

  select exists(
    select 1 from public.board_game_players
    where room_id = p_room_id and user_id = auth.uid() and left_at is null
  ) or v_room.host_id = auth.uid() into v_is_member;
  if not v_is_member then
    raise exception 'Not a participant in this match' using errcode = '42501';
  end if;

  select name, name_ar into v_game_name, v_game_name_ar from public.games where id = v_room.game_id;

  select count(*) into v_total_players from public.board_game_players where room_id = p_room_id and left_at is null and user_id is not null;
  v_is_multiplayer := v_total_players > 1;

  for v_player in
    select * from public.board_game_players where room_id = p_room_id and user_id is not null and left_at is null
  loop
    v_rank := coalesce((p_rankings ->> v_player.seat_index::text)::int, v_total_players);
    v_score := coalesce((p_scores ->> v_player.seat_index::text)::int, 0);
    v_seat_meta := coalesce(p_meta -> v_player.seat_index::text, '{}'::jsonb);

    update public.board_game_players set final_rank = v_rank, final_score = v_score where id = v_player.id;

    v_coin_key := case
      when not v_is_multiplayer then 'practice_completed'
      when v_rank = 1 then 'match_win_1st'
      when v_rank = 2 then 'match_win_2nd'
      when v_rank = 3 then 'match_win_3rd'
      else 'match_played'
    end;
    select amount into v_coins from public.coin_reward_config where key = v_coin_key;
    v_coins := coalesce(v_coins, 0);
    if v_is_multiplayer and v_rank <= 3 then
      select amount into v_base from public.coin_reward_config where key = 'match_played';
      v_coins := v_coins + coalesce(v_base, 0);
    end if;
    if v_coins > 0 then
      perform private.apply_coin_delta(v_player.user_id, v_coins, coalesce(v_game_name, v_room.game_id) || ' — finished #' || v_rank, 'board_game', p_room_id, null);
    end if;

    perform private.apply_xp_delta(v_player.user_id, greatest(20, 120 - (v_rank - 1) * 25), coalesce(v_game_name, v_room.game_id) || ' — board game finished', 'board_game', p_room_id, null);

    perform private.record_game_played(v_player.user_id, v_room.game_id, v_score, null, null, null);
    if v_is_multiplayer then
      perform private.record_game_result(v_player.user_id, v_room.game_id, v_rank = 1);
    end if;

    perform private.check_and_award_achievements(v_player.user_id);

    if v_rank = 1 then
      if coalesce((v_seat_meta->>'no_pieces_lost')::boolean, false) then
        perform private.grant_match_flag_achievement(v_player.user_id, v_room.game_id || '_no_pieces_lost');
      end if;
      if coalesce((v_seat_meta->>'all_pieces_home')::boolean, false) then
        perform private.grant_match_flag_achievement(v_player.user_id, v_room.game_id || '_grand_slam');
      end if;
    end if;

    if v_is_multiplayer then
      perform private.notify(v_player.user_id, 'match_result',
        coalesce(v_game_name, v_room.game_id) || ' finished', coalesce(v_game_name_ar, v_room.game_id) || ' انتهت',
        'You finished #' || v_rank, 'أنهيت في المركز ' || v_rank,
        jsonb_build_object('room_id', p_room_id, 'game_id', v_room.game_id, 'rank', v_rank));
    end if;
  end loop;

  update public.board_game_rooms set status = 'completed', completed_at = now() where id = p_room_id;
end; $function$;

create or replace function public.submit_board_game_move(p_room_id uuid, p_expected_version integer, p_new_state jsonb, p_move jsonb, p_seat_index integer, p_next_turn_seat_index integer DEFAULT NULL::integer)
 RETURNS board_game_state
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'private'
AS $function$
declare
  v_state public.board_game_state;
  v_room public.board_game_rooms;
  v_move_number int;
  v_caller_seat int;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then raise exception 'Room not found' using errcode = '22023'; end if;

  select seat_index into v_caller_seat
  from public.board_game_players
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
  if v_caller_seat is null or v_caller_seat <> p_seat_index then
    raise exception 'You do not hold this seat' using errcode = '42501';
  end if;
  if v_room.status = 'active' and v_room.turn_seat_index is not null and v_room.turn_seat_index <> p_seat_index then
    raise exception 'Not your turn' using errcode = '42501';
  end if;

  select * into v_state from public.board_game_state where room_id = p_room_id for update;
  if v_state.room_id is null then raise exception 'Room state not found' using errcode = '22023'; end if;
  if v_state.version <> p_expected_version then
    raise exception 'Stale state — refetch and retry' using errcode = '40001';
  end if;

  select coalesce(max(move_number), 0) + 1 into v_move_number from public.board_game_moves where room_id = p_room_id;
  insert into public.board_game_moves (room_id, move_number, seat_index, move, resulting_state)
  values (p_room_id, v_move_number, p_seat_index, p_move, p_new_state);

  update public.board_game_state
  set state = p_new_state, version = version + 1, updated_at = now()
  where room_id = p_room_id
  returning * into v_state;

  if p_next_turn_seat_index is not null then
    update public.board_game_rooms set turn_seat_index = p_next_turn_seat_index, turn_started_at = now() where id = p_room_id;
  end if;

  return v_state;
end; $function$;

revoke execute on function public.submit_board_game_move(uuid, integer, jsonb, jsonb, integer, integer) from public, anon;
revoke execute on function public.finalize_board_game(uuid, jsonb, jsonb, jsonb) from public, anon;

grant execute on function public.ludo_submit_move(uuid, integer, jsonb) to authenticated;
grant execute on function public.finalize_ludo_match(uuid) to authenticated;
