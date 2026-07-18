-- =========================================================================
-- Owner admin expansion — Part 1: schema extensions
--   * profiles.custom_title / custom_title_ar — owner-editable display
--     title, fully separate from profiles.role (system_role). Guarded by
--     the same privileged-fields trigger as role/xp/status so a player can
--     never set their own title via a direct table update.
--   * admin_log gains structured target_user_id / old_value / new_value
--     columns so "Account History" can render real before/after data
--     instead of only a free-text detail string.
--   * admin_log_category_check extended with the new action categories
--     this expansion introduces (coins, stats, titles, reset).
--   * coin_reward_config gains a 'player_reset_starting_balance' row so
--     "Reset Player Progress" has a single, owner-editable source of
--     truth for what a freshly-reset player's coin balance should be,
--     instead of a hardcoded 0 in application code.
-- =========================================================================

alter table public.profiles
  add column if not exists custom_title text,
  add column if not exists custom_title_ar text;

comment on column public.profiles.custom_title is
  'Owner-editable display title (e.g. "Team Leader"). Cosmetic only — never
   read by any permission check. Not to be confused with profiles.role
   (the real, security-relevant system role).';

alter table public.admin_log
  add column if not exists target_user_id uuid references public.profiles(id) on delete set null,
  add column if not exists old_value text,
  add column if not exists new_value text;

create index if not exists admin_log_target_user_idx on public.admin_log (target_user_id, created_at desc);

alter table public.admin_log drop constraint if exists admin_log_category_check;
alter table public.admin_log add constraint admin_log_category_check
  check (category = any (array[
    'users','codes','xp','badges','security','announcements',
    'tournaments','seasons','challenges','coin_reward_config',
    'coins','stats','titles','reset'
  ]));

insert into public.coin_reward_config (key, amount, label, label_ar)
values ('player_reset_starting_balance', 0, 'Starting coin balance after a progress reset', 'رصيد العملات عند إعادة ضبط تقدم اللاعب')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- Extend the privileged-fields guard so custom_title/custom_title_ar can
-- only ever change through a trusted SECURITY DEFINER RPC (same bypass-GUC
-- mechanism already protecting role/xp/level/status/login_count/
-- access_code_id/username) — never through a direct client-side update to
-- their own row, even though RLS otherwise allows self-updates.
-- ---------------------------------------------------------------------
create or replace function public.guard_profile_privileged_fields()
returns trigger language plpgsql
set search_path = public
as $$
begin
  if coalesce(current_setting('app.bypass_profile_guard', true), 'off') = 'on' then
    return new;
  end if;
  new.role := old.role;
  new.xp := old.xp;
  new.level := old.level;
  new.status := old.status;
  new.login_count := old.login_count;
  new.access_code_id := old.access_code_id;
  new.username := old.username;
  new.custom_title := old.custom_title;
  new.custom_title_ar := old.custom_title_ar;
  new.coins := old.coins;
  return new;
end;
$$;
