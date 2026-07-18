-- =========================================================================
-- Owner admin expansion — Part 3: badge removal + custom title RPCs
-- =========================================================================

create or replace function public.admin_remove_badge(p_user_id uuid, p_achievement_id text)
returns void
language plpgsql
security definer
set search_path = public, private
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
    'Badge "' || v_badge.name || '" removed', p_user_id, v_badge.name, null
  );
end; $$;

revoke all on function public.admin_remove_badge(uuid, text) from public, anon;
grant execute on function public.admin_remove_badge(uuid, text) to authenticated;
revoke all on function public.admin_give_badge(uuid, text) from public, anon;
grant execute on function public.admin_give_badge(uuid, text) to authenticated;

-- Give-badge re-declared only to route its log line through the richer
-- log_admin_action overload (target_user_id/old_value/new_value) and to
-- guard against granting a badge the user already has with a clear error
-- instead of a silent on-conflict no-op.
create or replace function public.admin_give_badge(p_user_id uuid, p_achievement_id text)
returns void
language plpgsql
security definer
set search_path = public, private
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
    'Badge "' || v_badge.name || '" awarded', p_user_id, null, v_badge.name
  );
end; $$;

-- ---------------------------------------------------------------------
-- Custom (display) title — purely cosmetic, never read by any permission
-- check. system_role (profiles.role) is untouched by this function and
-- stays governed exclusively by the enum type + the existing privileged-
-- fields trigger + on_auth_user_created.
-- ---------------------------------------------------------------------
create or replace function public.admin_set_custom_title(
  p_user_id uuid, p_title text, p_title_ar text default null, p_reason text default ''
) returns void
language plpgsql
security definer
set search_path = public, private
as $$
declare v_username text; v_old text; v_new_title text; begin
  perform private.require_owner();
  select username, custom_title into v_username, v_old from public.profiles where id = p_user_id;
  if v_username is null then raise exception 'User not found' using errcode='22023'; end if;

  v_new_title := nullif(trim(coalesce(p_title, '')), '');
  if v_new_title is not null and length(v_new_title) > 40 then
    raise exception 'Title must be 40 characters or fewer' using errcode = '22023';
  end if;

  perform set_config('app.bypass_profile_guard', 'on', true);
  update public.profiles
  set custom_title = v_new_title,
      custom_title_ar = nullif(trim(coalesce(p_title_ar, '')), '')
  where id = p_user_id;

  perform private.log_admin_action(
    auth.uid(), 'Set Custom Title', 'titles', v_username,
    p_reason, p_user_id, v_old, v_new_title
  );
end; $$;

revoke all on function public.admin_set_custom_title(uuid, text, text, text) from public, anon;
grant execute on function public.admin_set_custom_title(uuid, text, text, text) to authenticated;
