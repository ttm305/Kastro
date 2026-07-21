-- Explicit idempotency marker for match completion/rewards, in addition to
-- the existing implicit guard (finalize_board_game's `where status <>
-- 'completed' for update` — a second call simply finds no row and returns).
-- board_game_rooms.rewards_granted_at gives that guarantee an auditable
-- timestamp of its own, satisfying "match completion and reward
-- idempotency identifiers" explicitly rather than only implicitly via
-- status.

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

  update public.board_game_rooms set status = 'completed', completed_at = now(), rewards_granted_at = now() where id = p_room_id;
end; $function$;
