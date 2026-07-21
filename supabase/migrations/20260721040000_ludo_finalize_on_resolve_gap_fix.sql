-- ─────────────────────────────────────────────────────────────────────────
-- Ludo — close the "match ended but nobody's client is open to finalize it"
-- gap, caught live during this session's testing.
--
-- private.ludo_resolve_expired_turns flips board_game_state.state->>gameOver
-- to true the moment a 3rd consecutive missed turn eliminates the last
-- opposing seat, but it deliberately does NOT flip board_game_rooms.status
-- to 'completed' itself — that's finalize_board_game's job (it also grants
-- rewards, so it needs its own row lock discipline and idempotency guard,
-- not duplicated logic inside the resolver). Normally that's fine: whichever
-- client is open sees `result` become non-null from the new gameOver state
-- and its own finalize effect calls finalize_ludo_match within moments.
--
-- But when the match was abandoned by BOTH players (the exact scenario this
-- round's "3 missed turns, both clients closed" requirement describes),
-- NOBODY's client is open to do that. Reproduced live: forced three
-- consecutive missed turns via nothing but get_active_ludo_match calls (no
-- rolls, no check_ludo_timeout, no live match screen open at all) — the
-- match correctly reached gameOver:true with a winner in
-- board_game_state, but board_game_rooms.status was STILL 'active' because
-- finalize_ludo_match had never been called by anyone. Two real
-- consequences followed, both confirmed live:
--
--   1. get_active_ludo_match, called by the WINNING (non-eliminated) seat,
--      returned a truthy "resume this match" object for a match that had
--      already ended — exactly the false-positive "Active match found"
--      the fix requirements warn against.
--   2. ludo_guard_single_active_match (used by both create_board_game_room
--      and join_board_game_room_internal) would have kept blocking that
--      same winning player from starting a new match, for the same reason.
--
-- Fix: both entry points now finalize the match themselves, right after
-- resolving, whenever the resolution left it at gameOver:true. finalize_
-- ludo_match/finalize_board_game are already idempotent (locked on
-- status <> 'completed'), so calling this opportunistically is always safe
-- — it either genuinely closes out an abandoned match on the spot, or is a
-- harmless no-op if some other path already did.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function private.ludo_maybe_finalize(p_room_id uuid)
returns void
language plpgsql
set search_path to 'public', 'private'
as $$
declare
  v_room_status text;
  v_game_over boolean;
begin
  select r.status, coalesce((s.state->>'gameOver')::boolean, false)
  into v_room_status, v_game_over
  from public.board_game_rooms r
  join public.board_game_state s on s.room_id = r.id
  where r.id = p_room_id;

  if v_room_status = 'active' and v_game_over then
    perform public.finalize_ludo_match(p_room_id);
  end if;
end;
$$;

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
  -- If that resolution (or an earlier one nobody was around to act on)
  -- already left the match at gameOver:true, finalize it now rather than
  -- reporting it as still-resumable — see migration header.
  perform private.ludo_maybe_finalize(v_room_id);

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
    perform private.ludo_maybe_finalize(v_other.room_id);
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
