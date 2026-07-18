-- =========================================================================
-- ROOT-CAUSE FIX: private.log_admin_action(...) overload ambiguity
--
-- REPORTED SYMPTOM: Admin Content controls (Create Challenge, Create
-- Tournament, Create/End Season, Save Coin Economy values) all failed with
-- "function private.log_admin_action(uuid, unknown, unknown, text, text)
-- is not unique" (or an equivalent 5-positional-arg variant). This is not a
-- frontend/permission bug — it is a genuine Postgres function-overload
-- resolution failure.
--
-- ROOT CAUSE: two overloads of private.log_admin_action currently exist:
--   1. log_admin_action(p_actor uuid, p_action text, p_category text,
--        p_target text, p_detail text default '')                  -- 5 args
--   2. log_admin_action(p_actor uuid, p_action text, p_category text,
--        p_target text, p_detail text default '',
--        p_target_user_id uuid default null, p_old_value text default null,
--        p_new_value text default null)                            -- 8 args
-- Overload 2's first five parameters are identical to overload 1's full
-- parameter list, and its remaining three all have defaults. Any call site
-- passing exactly 5 positional arguments is therefore genuinely ambiguous
-- to Postgres's overload resolver — it cannot tell whether the caller means
-- "overload 1, called fully" or "overload 2, called with its last 3
-- defaulted" — and raises "function ... is not unique" at call time. This
-- was previously diagnosed once (see
-- 20260717172013_fix_admin_reorder_branches_log_call_ambiguity.sql) but
-- fixed only at that single call site by padding the call to 8 explicit
-- args, leaving overload 1 in place and every *other* 5-arg call site
-- (Challenge, Tournament, Season, Coin Economy, Access Codes, Announcements,
-- Password Reset — 12 RPCs total, see below) still broken.
--
-- FIX:
--   1. Drop overload 1 entirely. It is a strict, lossless prefix of
--      overload 2 (every column overload 1 writes, overload 2 also writes,
--      with 3 extra nullable columns) — admin_log's schema and every
--      existing caller's column semantics are completely unaffected.
--      Overload 2 becomes the single canonical log_admin_action, so no
--      5-arg call can ever be ambiguous again, regardless of argument
--      typing.
--   2. Re-create the canonical function with tightened grants (no public/
--      anon execute; it is only ever invoked from other SECURITY DEFINER
--      owner-gated RPCs, never directly from the client/PostgREST).
--   3. Defense-in-depth: update every RPC that calls log_admin_action to
--      pass all 8 arguments explicitly, with nullable arguments explicitly
--      cast (NULL::uuid / NULL::text) rather than left as untyped literals.
--      This is not required for correctness once step 1 lands (a single
--      remaining overload cannot be ambiguous), but matches the requested
--      standard of never relying on Postgres's `unknown`-type literal
--      resolution.
--
-- CALLERS AUDITED AND FIXED IN THIS MIGRATION (12 RPCs previously calling
-- log_admin_action with exactly 5 positional args — i.e. actually broken):
--   admin_create_challenge, admin_create_tournament,
--   admin_end_season_and_start_new, admin_generate_bracket,
--   admin_set_coin_reward, admin_update_challenge_rewards,
--   admin_create_access_code, admin_delete_access_code,
--   admin_create_announcement, admin_delete_announcement,
--   admin_log_password_reset, admin_toggle_access_code
--
-- CALLERS AUDITED AND CONFIRMED ALREADY SAFE (already passed 8 args, only
-- touched here to cast bare `null` literals for defense-in-depth):
--   admin_create_branch, admin_delete_branch, admin_reorder_branches,
--   admin_delete_user, admin_give_badge, admin_remove_badge
--
-- CALLERS AUDITED AND CONFIRMED ALREADY SAFE, NO CHANGE NEEDED (already
-- passed 8 explicit, already-typed args):
--   private.admin_set_user_coins, private.admin_set_user_xp,
--   admin_adjust_coins, admin_adjust_xp, admin_correct_user_game_stats,
--   admin_reset_player_progress, admin_set_branch_active,
--   admin_set_custom_title, admin_set_user_status, admin_update_branch
--
-- Full caller list was produced by querying pg_proc for every function
-- whose body contains "log_admin_action(", not by guessing filenames —
-- this covers Challenge, Tournament, Season, Coin Economy, Access Codes,
-- User administration, Announcements, Badges, Branches, Reset Progress,
-- Statistics correction, and Password Reset in full.
-- =========================================================================

-- ---------------------------------------------------------------------
-- Step 1 + 2: drop the obsolete 5-arg overload, re-affirm the canonical
-- 8-arg function with tightened grants.
-- ---------------------------------------------------------------------
drop function if exists private.log_admin_action(uuid, text, text, text, text);

create or replace function private.log_admin_action(
  p_actor uuid,
  p_action text,
  p_category text,
  p_target text,
  p_detail text default '',
  p_target_user_id uuid default null,
  p_old_value text default null,
  p_new_value text default null
) returns void
language sql
security definer
set search_path = 'public', 'private'
as $$
  insert into public.admin_log (actor_id, action, category, target, detail, target_user_id, old_value, new_value)
  values (p_actor, p_action, p_category, p_target, p_detail, p_target_user_id, p_old_value, p_new_value);
$$;

revoke all on function private.log_admin_action(uuid, text, text, text, text, uuid, text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Step 3a: the 12 previously-broken (5-arg) callers.
-- ---------------------------------------------------------------------

create or replace function public.admin_create_challenge(p_period_type text, p_title text, p_title_ar text, p_game_id text, p_question_count integer, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone, p_xp_reward integer default null::integer, p_coin_reward integer default null::integer)
returns challenges
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_row public.challenges; begin
  perform private.require_owner();
  if p_period_type not in ('daily','weekly','monthly','seasonal') then
    raise exception 'Invalid period_type' using errcode = '22023';
  end if;

  insert into public.challenges (period_type, title, title_ar, game_id, question_count, starts_at, ends_at, xp_reward, coin_reward)
  values (
    p_period_type, p_title, p_title_ar, nullif(p_game_id,''), coalesce(p_question_count,10), p_starts_at, p_ends_at,
    coalesce(p_xp_reward, case p_period_type when 'daily' then 30 when 'weekly' then 100 when 'monthly' then 250 else 400 end),
    coalesce(p_coin_reward, case p_period_type when 'daily' then 15 when 'weekly' then 30 when 'monthly' then 60 else 100 end)
  )
  returning * into v_row;

  perform private.notify_all_active(p_period_type || '_challenge', p_title, p_title_ar,
    'A new challenge just started', 'بدأ تحدٍ جديد', jsonb_build_object('challenge_id', v_row.id));

  perform private.log_admin_action(auth.uid(), 'Create Challenge', 'challenges', p_title, p_period_type, null::uuid, null::text, null::text);
  return v_row;
end; $$;

create or replace function public.admin_create_tournament(p_name text, p_name_ar text, p_qualification_rule text, p_qualification_rule_ar text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
returns tournaments
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_row public.tournaments; begin
  perform private.require_owner();
  insert into public.tournaments (name, name_ar, qualification_rule, qualification_rule_ar, starts_at, ends_at, status)
  values (p_name, p_name_ar, coalesce(p_qualification_rule,''), coalesce(p_qualification_rule_ar,''), p_starts_at, p_ends_at, 'upcoming')
  returning * into v_row;

  perform private.notify_all_active('tournament', 'New tournament: ' || p_name, 'بطولة جديدة: ' || p_name_ar,
    'Registration is now open', 'التسجيل مفتوح الآن', jsonb_build_object('tournament_id', v_row.id));

  perform private.log_admin_action(auth.uid(), 'Create Tournament', 'tournaments', p_name, 'Created', null::uuid, null::text, null::text);
  return v_row;
end; $$;

create or replace function public.admin_end_season_and_start_new(p_new_name text, p_new_name_ar text, p_starts_at timestamp with time zone, p_ends_at timestamp with time zone)
returns seasons
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_new public.seasons;
begin
  perform private.require_owner();

  update public.seasons set is_active = false, ended_at = now() where is_active = true;

  insert into public.seasons (name, name_ar, starts_at, ends_at, is_active)
  values (p_new_name, p_new_name_ar, p_starts_at, p_ends_at, true)
  returning * into v_new;

  perform private.notify_all_active('season', 'New season has begun!', 'بدأ موسم جديد!',
    p_new_name, p_new_name_ar, jsonb_build_object('season_id', v_new.id));

  perform private.log_admin_action(auth.uid(), 'New Season', 'seasons', v_new.name, 'Started season "' || v_new.name || '"', null::uuid, null::text, null::text);
  return v_new;
end;
$$;

create or replace function public.admin_generate_bracket(p_tournament_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_round_id uuid;
  v_participants uuid[];
  v_i int;
  v_seed int := 0;
begin
  perform private.require_owner();

  select array_agg(user_id order by registered_at) into v_participants
  from public.tournament_participants where tournament_id = p_tournament_id;

  if v_participants is null or array_length(v_participants,1) < 2 then
    raise exception 'Not enough registered participants' using errcode = '22023';
  end if;

  for v_i in 1 .. array_length(v_participants,1) loop
    update public.tournament_participants set seed = v_i
    where tournament_id = p_tournament_id and user_id = v_participants[v_i];
  end loop;

  insert into public.tournament_rounds (tournament_id, name, name_ar, round_order, status)
  values (p_tournament_id, 'Round 1', 'الجولة 1', 1, 'live')
  returning id into v_round_id;

  v_i := 1;
  while v_i <= array_length(v_participants,1) loop
    v_seed := v_seed + 1;
    if v_i + 1 <= array_length(v_participants,1) then
      insert into public.tournament_matches (round_id, match_order, participant1_id, participant2_id)
      values (v_round_id, v_seed, v_participants[v_i], v_participants[v_i+1]);
    else
      -- odd one out: automatic bye
      insert into public.tournament_matches (round_id, match_order, participant1_id, winner_id, completed_at)
      values (v_round_id, v_seed, v_participants[v_i], v_participants[v_i], now());
    end if;
    v_i := v_i + 2;
  end loop;

  update public.tournaments set status = 'active' where id = p_tournament_id;
  perform private.log_admin_action(auth.uid(), 'Generate Bracket', 'users', 'Tournament', array_length(v_participants,1) || ' participants seeded', null::uuid, null::text, null::text);
end; $$;

create or replace function public.admin_set_coin_reward(p_key text, p_amount integer)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
begin
  perform private.require_owner();
  if p_amount < 0 then
    raise exception 'Amount cannot be negative' using errcode = '22023';
  end if;
  update public.coin_reward_config set amount = p_amount, updated_at = now() where key = p_key;
  if not found then
    raise exception 'Unknown reward key' using errcode = '22023';
  end if;
  perform private.log_admin_action(auth.uid(), 'Set Coin Reward', 'coin_reward_config', p_key, p_amount::text, null::uuid, null::text, null::text);
end;
$$;

create or replace function public.admin_update_challenge_rewards(p_id uuid, p_xp_reward integer, p_coin_reward integer)
returns challenges
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_row public.challenges; begin
  perform private.require_owner();
  if p_xp_reward < 0 or p_coin_reward < 0 then
    raise exception 'Rewards cannot be negative' using errcode = '22023';
  end if;
  update public.challenges set xp_reward = p_xp_reward, coin_reward = p_coin_reward
  where id = p_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'Challenge not found' using errcode = '22023';
  end if;
  perform private.log_admin_action(auth.uid(), 'Update Challenge Rewards', 'challenges', v_row.title,
    p_xp_reward::text || ' XP / ' || p_coin_reward::text || ' Coins', null::uuid, null::text, null::text);
  return v_row;
end; $$;

create or replace function public.admin_create_access_code(p_note text, p_max_uses integer, p_expires_at timestamp with time zone, p_code text default null::text)
returns access_codes
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_code text;
  v_row public.access_codes;
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
begin
  perform private.require_owner();

  v_code := upper(coalesce(nullif(trim(p_code), ''), (
    select string_agg(substr(v_chars, (floor(random()*length(v_chars))+1)::int, 1), '')
    from generate_series(1,8)
  )));

  insert into public.access_codes (code, note, max_uses, expires_at, created_by)
  values (v_code, coalesce(p_note,''), p_max_uses, p_expires_at, auth.uid())
  returning * into v_row;

  perform private.log_admin_action(auth.uid(), 'Create Code', 'codes', v_row.code, 'New access code created, max ' || coalesce(p_max_uses::text,'unlimited') || ' uses', null::uuid, null::text, null::text);
  return v_row;
end;
$$;

create or replace function public.admin_delete_access_code(p_code_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_code text; begin
  perform private.require_owner();
  select code into v_code from public.access_codes where id = p_code_id;
  delete from public.access_codes where id = p_code_id;
  perform private.log_admin_action(auth.uid(), 'Delete Code', 'codes', coalesce(v_code,p_code_id::text), 'Access code deleted', null::uuid, null::text, null::text);
end; $$;

create or replace function public.admin_create_announcement(p_title text, p_body text, p_pinned boolean default false, p_scheduled_at timestamp with time zone default null::timestamp with time zone, p_expires_at timestamp with time zone default null::timestamp with time zone)
returns announcements
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_row public.announcements; begin
  perform private.require_owner();
  insert into public.announcements (title, body, pinned, scheduled_at, expires_at, created_by)
  values (p_title, coalesce(p_body,''), coalesce(p_pinned,false), p_scheduled_at, p_expires_at, auth.uid())
  returning * into v_row;

  perform private.notify_all_active('admin_announcement', p_title, p_title, coalesce(p_body,''), coalesce(p_body,''), jsonb_build_object('announcement_id', v_row.id));

  perform private.log_admin_action(auth.uid(), 'Announcement', 'announcements', 'All Players', 'Posted: "' || p_title || '"', null::uuid, null::text, null::text);
  return v_row;
end; $$;

create or replace function public.admin_delete_announcement(p_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_title text; begin
  perform private.require_owner();
  select title into v_title from public.announcements where id = p_id;
  delete from public.announcements where id = p_id;
  perform private.log_admin_action(auth.uid(), 'Delete Announcement', 'announcements', coalesce(v_title,p_id::text), 'Announcement removed', null::uuid, null::text, null::text);
end; $$;

create or replace function public.admin_log_password_reset(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_username text; begin
  perform private.require_owner();
  select username into v_username from public.profiles where id = p_user_id;
  perform private.log_admin_action(auth.uid(), 'Password Reset', 'security', v_username, 'Reset link sent', null::uuid, null::text, null::text);
end; $$;

create or replace function public.admin_toggle_access_code(p_code_id uuid)
returns access_codes
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_row public.access_codes; begin
  perform private.require_owner();
  update public.access_codes set status = case when status='active' then 'disabled' else 'active' end
  where id = p_code_id returning * into v_row;
  perform private.log_admin_action(auth.uid(), case when v_row.status='active' then 'Enable Code' else 'Disable Code' end, 'codes', v_row.code, 'Access code ' || v_row.status, null::uuid, null::text, null::text);
  return v_row;
end; $$;

-- ---------------------------------------------------------------------
-- Step 3b: already-safe (8-arg) callers — only bare `null` literals are
-- cast explicitly here, for defense-in-depth. No behavioral change.
-- ---------------------------------------------------------------------

create or replace function public.admin_create_branch(p_code text, p_name_ar text, p_name_en text, p_is_active boolean default true, p_sort_order integer default null::integer)
returns branches
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_code text;
  v_sort integer;
  v_row public.branches;
begin
  perform private.require_owner();

  v_code := lower(trim(coalesce(p_code, '')));
  if v_code = '' then raise exception 'Branch code is required' using errcode = '22023'; end if;
  if v_code !~ '^[a-z0-9_]+$' then
    raise exception 'Branch code may only contain lowercase letters, numbers, and underscores' using errcode = '22023';
  end if;
  if trim(coalesce(p_name_en, '')) = '' then raise exception 'English name is required' using errcode = '22023'; end if;
  if trim(coalesce(p_name_ar, '')) = '' then raise exception 'Arabic name is required' using errcode = '22023'; end if;
  if exists (select 1 from public.branches where code = v_code) then
    raise exception 'A branch with this code already exists' using errcode = '22023';
  end if;

  if p_sort_order is not null then
    v_sort := p_sort_order;
  else
    select coalesce(max(sort_order), 0) + 1 into v_sort from public.branches;
  end if;

  insert into public.branches (code, name_ar, name_en, is_active, sort_order)
  values (v_code, trim(p_name_ar), trim(p_name_en), coalesce(p_is_active, true), v_sort)
  returning * into v_row;

  perform private.log_admin_action(auth.uid(), 'Create Branch', 'branches', v_row.name_en,
    'code=' || v_row.code, null::uuid, null::text, to_jsonb(v_row)::text);

  return v_row;
end; $$;

create or replace function public.admin_delete_branch(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_row public.branches;
  v_linked bigint;
begin
  perform private.require_owner();
  select * into v_row from public.branches where id = p_branch_id;
  if v_row.id is null then raise exception 'Branch not found' using errcode = '22023'; end if;

  select count(*) into v_linked from public.profiles where branch_id = p_branch_id;
  if v_linked > 0 then
    raise exception 'Cannot delete a branch with % linked user account(s) — deactivate it instead', v_linked
      using errcode = '22023';
  end if;

  delete from public.branches where id = p_branch_id;

  perform private.log_admin_action(auth.uid(), 'Delete Branch', 'branches', v_row.name_en,
    'code=' || v_row.code, null::uuid, to_jsonb(v_row)::text, null::text);
end; $$;

create or replace function public.admin_reorder_branches(p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare
  v_id uuid;
  v_pos integer := 0;
begin
  perform private.require_owner();
  if p_ordered_ids is null or array_length(p_ordered_ids, 1) is null then
    raise exception 'No branch order supplied' using errcode = '22023';
  end if;

  foreach v_id in array p_ordered_ids loop
    v_pos := v_pos + 1;
    update public.branches set sort_order = v_pos where id = v_id;
  end loop;

  perform private.log_admin_action(
    auth.uid(), 'Reorder Branches', 'branches', 'branches',
    array_length(p_ordered_ids, 1)::text || ' branches reordered',
    null::uuid, null::text, null::text
  );
end; $$;

create or replace function public.admin_delete_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_username text; v_role public.user_role; begin
  perform private.require_owner();
  if p_user_id = auth.uid() then raise exception 'Cannot delete your own account' using errcode='22023'; end if;
  select username, role into v_username, v_role from public.profiles where id = p_user_id;
  if v_username is null then raise exception 'User not found' using errcode='22023'; end if;
  if v_role = 'owner' then raise exception 'The owner account cannot be deleted' using errcode = '22023'; end if;

  perform private.log_admin_action(auth.uid(), 'Delete User', 'users', v_username, 'Account removed by owner', p_user_id, v_username, null::text);
  delete from auth.users where id = p_user_id;
end; $$;

create or replace function public.admin_give_badge(p_user_id uuid, p_achievement_id text)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_username text; v_badge record; v_has boolean; begin
  perform private.require_owner();
  select username into v_username from public.profiles where id = p_user_id;
  if v_username is null then raise exception 'User not found' using errcode='22023'; end if;

  select * into v_badge from public.achievements where id = p_achievement_id;
  if v_badge.id is null then raise exception 'Unknown achievement' using errcode='22023'; end if;

  select exists(select 1 from public.user_achievements where user_id = p_user_id and achievement_id = p_achievement_id) into v_has;
  if v_has then
    raise exception 'User already has this badge' using errcode = '22023';
  end if;

  insert into public.user_achievements (user_id, achievement_id) values (p_user_id, p_achievement_id);
  insert into public.activity_log (user_id, event_type, message, message_ar)
  values (p_user_id, 'achievement_unlocked', 'Unlocked achievement: ' || v_badge.name, 'تم فتح الإنجاز');

  perform private.notify(p_user_id, 'badge_unlocked',
    'Badge unlocked!', 'تم فتح شارة!',
    v_badge.name, v_badge.name_ar,
    jsonb_build_object('achievement_id', v_badge.id, 'icon', v_badge.icon, 'rarity', v_badge.rarity, 'color', v_badge.color, 'category', v_badge.category));

  perform private.log_admin_action(
    auth.uid(), 'Give Badge', 'badges', v_username,
    'Badge "' || v_badge.name || '" awarded', p_user_id, null::text, v_badge.name
  );
end; $$;

create or replace function public.admin_remove_badge(p_user_id uuid, p_achievement_id text)
returns void
language plpgsql
security definer
set search_path = 'public', 'private'
as $$
declare v_username text; v_badge record; v_had boolean; begin
  perform private.require_owner();
  select username into v_username from public.profiles where id = p_user_id;
  if v_username is null then raise exception 'User not found' using errcode='22023'; end if;

  select * into v_badge from public.achievements where id = p_achievement_id;
  if v_badge.id is null then raise exception 'Unknown achievement' using errcode='22023'; end if;

  select exists(select 1 from public.user_achievements where user_id = p_user_id and achievement_id = p_achievement_id) into v_had;
  if not v_had then
    raise exception 'User does not have this badge' using errcode = '22023';
  end if;

  delete from public.user_achievements where user_id = p_user_id and achievement_id = p_achievement_id;

  perform private.log_admin_action(
    auth.uid(), 'Remove Badge', 'badges', v_username,
    'Badge "' || v_badge.name || '" removed', p_user_id, v_badge.name, null::text
  );
end; $$;
