-- =========================================================================
-- Owner admin expansion — Part 5: sole-owner protection + full
-- transactional "Reset Player Progress"
--
-- admin_set_user_status / admin_delete_user are re-declared only to add a
-- hard DB-level guard preventing the sole owner account from ever being
-- suspended or deleted, even if the frontend is manipulated — the check
-- lives inside the SECURITY DEFINER function itself, not in the UI.
--
-- admin_reset_player_progress is new: it deletes/zeroes every piece of
-- progression data (gameplay history, XP/coin ledgers, challenge/season
-- progress, daily-reward claims, and — unless explicitly preserved —
-- badges/cosmetics) while leaving identity completely untouched (auth
-- user row, email, username, profile id, registration date/created_at,
-- department/branch, access_code_id, role). It is gated on the literal
-- confirmation string 'RESET', runs as a single transaction (a plpgsql
-- function body is implicitly one transaction — any exception rolls back
-- every delete/update), and is fully audited with a before/after snapshot.
-- It is intentionally a separate function from admin_delete_user, matching
-- the spec's requirement to keep "Reset Progress" and "Delete Account"
-- as distinct, non-overlapping actions.
-- =========================================================================

create or replace function public.admin_set_user_status(p_user_id uuid, p_status public.user_status)
returns public.profiles
language plpgsql
security definer
set search_path = public, private
as $$
declare v_row public.profiles; v_old public.user_status; v_role public.user_role; begin
  perform private.require_owner();
  select status, role into v_old, v_role from public.profiles where id = p_user_id;
  if v_old is null then raise exception 'User not found' using errcode='22023'; end if;
  if v_role = 'owner' and p_status = 'suspended' then
    raise exception 'The owner account cannot be suspended' using errcode = '22023';
  end if;

  perform set_config('app.bypass_profile_guard','on', true);
  update public.profiles set status = p_status where id = p_user_id returning * into v_row;
  perform private.log_admin_action(
    auth.uid(), case when p_status='suspended' then 'Suspend User' else 'Activate User' end, 'security',
    v_row.username, 'Account ' || p_status, p_user_id, v_old::text, p_status::text
  );
  return v_row;
end; $$;

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare v_username text; v_role public.user_role; begin
  perform private.require_owner();
  if p_user_id = auth.uid() then raise exception 'Cannot delete your own account' using errcode='22023'; end if;
  select username, role into v_username, v_role from public.profiles where id = p_user_id;
  if v_username is null then raise exception 'User not found' using errcode='22023'; end if;
  if v_role = 'owner' then raise exception 'The owner account cannot be deleted' using errcode = '22023'; end if;

  perform private.log_admin_action(auth.uid(), 'Delete User', 'users', v_username, 'Account removed by owner', p_user_id, v_username, null);
  delete from auth.users where id = p_user_id;
end; $$;

revoke all on function public.admin_set_user_status(uuid, public.user_status) from public, anon;
revoke all on function public.admin_delete_user(uuid) from public, anon;
grant execute on function public.admin_set_user_status(uuid, public.user_status) to authenticated;
grant execute on function public.admin_delete_user(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- Reset Player Progress
-- ---------------------------------------------------------------------
create or replace function public.admin_reset_player_progress(
  p_user_id uuid,
  p_confirm text,
  p_preserve_badges boolean default false,
  p_preserve_cosmetics boolean default false,
  p_reason text default 'Player progress reset'
) returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_username text;
  v_role public.user_role;
  v_starting_coins bigint;
  v_before jsonb;
begin
  perform private.require_owner();

  if p_confirm is distinct from 'RESET' then
    raise exception 'Confirmation text must be exactly RESET' using errcode = '22023';
  end if;

  select username, role into v_username, v_role from public.profiles where id = p_user_id;
  if v_username is null then raise exception 'User not found' using errcode = '22023'; end if;
  if v_role = 'owner' then raise exception 'The owner account cannot be reset' using errcode = '22023'; end if;

  select amount into v_starting_coins from public.coin_reward_config where key = 'player_reset_starting_balance';
  v_starting_coins := coalesce(v_starting_coins, 0);

  select jsonb_build_object(
    'xp', xp, 'level', level, 'coins', coins, 'streak_count', streak_count
  ) into v_before from public.profiles where id = p_user_id;

  -- Gameplay history + derived stats. Identity columns (id, email via
  -- auth.users, username, created_at, department/branch, access_code_id,
  -- role) are never touched below.
  delete from public.game_sessions where user_id = p_user_id;               -- question_responses cascades
  delete from public.user_game_stats where user_id = p_user_id;
  delete from public.xp_ledger where user_id = p_user_id;
  delete from public.coin_ledger where user_id = p_user_id;
  delete from public.challenge_participants where user_id = p_user_id;
  delete from public.user_season_progress where user_id = p_user_id;
  delete from public.daily_reward_claims where user_id = p_user_id;

  if not p_preserve_badges then
    delete from public.user_achievements where user_id = p_user_id;
  end if;

  if not p_preserve_cosmetics then
    delete from public.user_cosmetic_unlocks where user_id = p_user_id;
  end if;

  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles set
    xp = 0,
    level = 1,
    coins = v_starting_coins,
    streak_count = 0,
    weekly_streak_count = 0,
    last_claimed_reward_date = null,
    last_active_week = null,
    equipped_frame_id = case when p_preserve_cosmetics then equipped_frame_id else null end,
    equipped_banner_id = case when p_preserve_cosmetics then equipped_banner_id else null end,
    equipped_title_id = case when p_preserve_cosmetics then equipped_title_id else null end,
    equipped_decoration_id = case when p_preserve_cosmetics then equipped_decoration_id else null end,
    pinned_badge_ids = case when p_preserve_badges then pinned_badge_ids else '{}' end
  where id = p_user_id;

  perform private.log_admin_action(
    auth.uid(), 'Reset Player Progress', 'reset', v_username,
    p_reason || ' (badges ' || (case when p_preserve_badges then 'preserved' else 'reset' end) ||
    ', cosmetics ' || (case when p_preserve_cosmetics then 'preserved' else 'reset' end) || ')',
    p_user_id, v_before::text, '{"xp":0,"level":1,"coins":' || v_starting_coins || ',"streak_count":0}'
  );

  return jsonb_build_object('user_id', p_user_id, 'starting_coins', v_starting_coins, 'preserved_badges', p_preserve_badges, 'preserved_cosmetics', p_preserve_cosmetics);
end; $$;

revoke all on function public.admin_reset_player_progress(uuid, text, boolean, boolean, text) from public, anon;
grant execute on function public.admin_reset_player_progress(uuid, text, boolean, boolean, text) to authenticated;
