-- ─────────────────────────────────────────────────────────────────────────
-- Ludo color selection — fix a gap caught live while verifying the previous
-- migration: create_board_game_room seats the HOST directly (it doesn't go
-- through join_board_game_room_internal, which is only used by the second+
-- player joining), and it still hard-coded seat_index=0 for the host.
-- Reproduced live: created a room as the host, and their player row came
-- back with seat_index=0 already set — meaning the host silently got
-- Red auto-assigned again, exactly the "do not assign colors automatically
-- anymore" behavior this feature is supposed to remove. Fixed the same way
-- as join_board_game_room_internal: for game_id='ludo', the host is seated
-- with no color yet and must claim one via claim_ludo_color like everyone
-- else. Every other game keeps seating the host at seat 0 immediately.
-- ─────────────────────────────────────────────────────────────────────────

create or replace function public.create_board_game_room(p_game_id text, p_max_players integer DEFAULT 4, p_allow_spectators boolean DEFAULT true, p_private boolean DEFAULT false)
returns setof public.board_game_rooms
language plpgsql
security definer
set search_path to 'public', 'private'
as $function$
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

  if p_game_id = 'ludo' then
    insert into public.board_game_players (room_id, user_id, seat_index, is_ready, is_connected, last_heartbeat_at)
    values (v_room_id, auth.uid(), null, false, true, now());
  else
    insert into public.board_game_players (room_id, user_id, seat_index, is_ready, is_connected, last_heartbeat_at)
    values (v_room_id, auth.uid(), 0, false, true, now());
  end if;

  insert into public.board_game_state (room_id, state, version)
  values (v_room_id, '{}'::jsonb, 1);

  return query select * from public.board_game_rooms where id = v_room_id;
end;
$function$;
