-- =========================================================================
-- Owner admin expansion — Part 2: XP + Coins owner-only RPCs
--
-- ROOT CAUSE OF THE ORIGINAL "Reset XP to 0" BUG, for the record:
-- admin_reset_user_xp() computed `-v_current` where v_current is
-- `profiles.xp%TYPE` = bigint, then passed that bigint expression directly
-- into private.apply_xp_delta(uuid, integer, ...)'s p_delta parameter.
-- Postgres does not implicitly narrow bigint -> integer when resolving
-- which function overload to call, so it could not find a matching
-- private.apply_xp_delta signature and raised exactly the reported error:
-- "function private.apply_xp_delta(uuid, bigint, unknown, unknown,
-- unknown, uuid) does not exist". A second, latent bug sat behind it:
-- the same call passed source='admin_reset', which is not one of the
-- values allowed by xp_ledger_source_check — so even a naive type-cast
-- fix alone would have traded one error for another on first use.
--
-- Fix: a dedicated, explicitly-typed private.admin_set_user_xp() (and its
-- coins equivalent) that computes its own bounded, explicitly-cast integer
-- delta and always uses the already-whitelisted 'admin_adjustment' source.
-- admin_reset_user_xp is kept (existing frontend/back-compat) but now just
-- forwards to the new function with new_xp = 0.
-- =========================================================================

-- Extend the admin action logger with optional structured fields, fully
-- backward compatible: every existing 5-positional-arg call site keeps
-- working unchanged since the three new parameters default to null.
create or replace function private.log_admin_action(
  p_actor uuid, p_action text, p_category text, p_target text, p_detail text default '',
  p_target_user_id uuid default null, p_old_value text default null, p_new_value text default null
) returns void
language sql security definer set search_path = public, private as $$
  insert into public.admin_log (actor_id, action, category, target, detail, target_user_id, old_value, new_value)
  values (p_actor, p_action, p_category, p_target, p_detail, p_target_user_id, p_old_value, p_new_value);
$$;

-- ---------------------------------------------------------------------
-- XP: set to an exact value (used by both "Set exact XP" and "Reset XP
-- to 0" — reset is just this function called with p_new_xp = 0).
-- ---------------------------------------------------------------------
create or replace function private.admin_set_user_xp(
  p_target_user_id uuid, p_new_xp bigint, p_reason text default 'Admin XP correction'
) returns table(old_xp bigint, new_xp bigint, new_level int)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_username text;
  v_old bigint;
  v_delta bigint;
  v_applied bigint;
begin
  perform private.require_owner();

  if p_new_xp < 0 then
    raise exception 'XP cannot be negative' using errcode = '22023';
  end if;

  select username, xp into v_username, v_old from public.profiles where id = p_target_user_id;
  if v_username is null then raise exception 'User not found' using errcode = '22023'; end if;

  v_delta := p_new_xp - v_old;
  if v_delta > 2147483647 or v_delta < -2147483648 then
    raise exception 'XP change is too large to apply in a single step' using errcode = '22023';
  end if;

  if v_delta = 0 then
    v_applied := v_old;
  else
    v_applied := private.apply_xp_delta(p_target_user_id, v_delta::integer, p_reason, 'admin_adjustment', null, auth.uid());
  end if;

  perform private.log_admin_action(
    auth.uid(), case when p_new_xp = 0 then 'Reset XP' else 'Set XP' end, 'xp', v_username,
    p_reason, p_target_user_id, v_old::text, v_applied::text
  );

  return query select v_old, v_applied, (select level from public.profiles where id = p_target_user_id);
end;
$$;

revoke all on function private.admin_set_user_xp(uuid, bigint, text) from public, anon, authenticated;
grant execute on function private.admin_set_user_xp(uuid, bigint, text) to authenticated;

-- admin_reset_user_xp kept as a thin, backward-compatible wrapper — the
-- existing frontend call site (adminResetUserXp) keeps working unchanged.
create or replace function public.admin_reset_user_xp(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, private
as $$
declare v_new bigint; begin
  select new_xp into v_new from private.admin_set_user_xp(p_user_id, 0, 'Admin reset');
  return v_new;
end; $$;

-- ---------------------------------------------------------------------
-- XP: relative add/remove — admin_adjust_xp already existed and already
-- worked (integer p_delta end to end); re-declared here only to route
-- its audit entry through the richer log_admin_action signature and to
-- tighten grants to match the rest of this migration.
-- ---------------------------------------------------------------------
create or replace function public.admin_adjust_xp(p_user_id uuid, p_delta integer, p_reason text default '')
returns bigint
language plpgsql
security definer
set search_path = public, private
as $$
declare v_username text; v_old bigint; v_new bigint; begin
  perform private.require_owner();
  select username, xp into v_username, v_old from public.profiles where id = p_user_id;
  if v_username is null then raise exception 'User not found' using errcode='22023'; end if;

  v_new := private.apply_xp_delta(p_user_id, p_delta, coalesce(nullif(p_reason,''), 'Admin adjustment'), 'admin_adjustment', null, auth.uid());

  perform private.log_admin_action(auth.uid(), 'Adjust XP', 'xp', v_username,
    p_reason, p_user_id, v_old::text, v_new::text);
  return v_new;
end; $$;

revoke all on function public.admin_reset_user_xp(uuid) from public, anon;
revoke all on function public.admin_adjust_xp(uuid, integer, text) from public, anon;
grant execute on function public.admin_reset_user_xp(uuid) to authenticated;
grant execute on function public.admin_adjust_xp(uuid, integer, text) to authenticated;

-- ---------------------------------------------------------------------
-- Coins: no owner-facing per-user coin control existed before this —
-- admin_set_coin_reward() only edits the catalog of reward *amounts*,
-- never a specific player's balance. These three are new.
-- ---------------------------------------------------------------------
create or replace function private.admin_set_user_coins(
  p_target_user_id uuid, p_new_coins bigint, p_reason text default 'Admin coin correction'
) returns table(old_coins bigint, new_coins bigint)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_username text;
  v_old bigint;
  v_delta bigint;
  v_applied bigint;
begin
  perform private.require_owner();

  if p_new_coins < 0 then
    raise exception 'Coins cannot be negative' using errcode = '22023';
  end if;

  select username, coins into v_username, v_old from public.profiles where id = p_target_user_id;
  if v_username is null then raise exception 'User not found' using errcode = '22023'; end if;

  v_delta := p_new_coins - v_old;
  if v_delta > 2147483647 or v_delta < -2147483648 then
    raise exception 'Coin change is too large to apply in a single step' using errcode = '22023';
  end if;

  if v_delta = 0 then
    v_applied := v_old;
  else
    v_applied := private.apply_coin_delta(p_target_user_id, v_delta::integer, p_reason, 'admin_adjustment', null, auth.uid());
  end if;

  perform private.log_admin_action(
    auth.uid(), case when p_new_coins = 0 then 'Reset Coins' else 'Set Coins' end, 'coins', v_username,
    p_reason, p_target_user_id, v_old::text, v_applied::text
  );

  return query select v_old, v_applied;
end;
$$;

create or replace function public.admin_adjust_coins(p_user_id uuid, p_delta integer, p_reason text default '')
returns bigint
language plpgsql
security definer
set search_path = public, private
as $$
declare v_username text; v_old bigint; v_new bigint; begin
  perform private.require_owner();
  select username, coins into v_username, v_old from public.profiles where id = p_user_id;
  if v_username is null then raise exception 'User not found' using errcode='22023'; end if;

  v_new := private.apply_coin_delta(p_user_id, p_delta, coalesce(nullif(p_reason,''), 'Admin adjustment'), 'admin_adjustment', null, auth.uid());

  perform private.log_admin_action(auth.uid(), 'Adjust Coins', 'coins', v_username,
    p_reason, p_user_id, v_old::text, v_new::text);
  return v_new;
end; $$;

create or replace function public.admin_set_user_coins(p_user_id uuid, p_new_coins bigint, p_reason text default '')
returns bigint
language plpgsql
security definer
set search_path = public, private
as $$
declare v_new bigint; begin
  select new_coins into v_new from private.admin_set_user_coins(p_user_id, p_new_coins, coalesce(nullif(p_reason,''), 'Admin coin correction'));
  return v_new;
end; $$;

create or replace function public.admin_reset_user_coins(p_user_id uuid)
returns bigint
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_target bigint;
  v_new bigint;
begin
  select amount into v_target from public.coin_reward_config where key = 'player_reset_starting_balance';
  select new_coins into v_new from private.admin_set_user_coins(p_user_id, coalesce(v_target, 0), 'Admin reset to starting balance');
  return v_new;
end; $$;

revoke all on function private.admin_set_user_coins(uuid, bigint, text) from public, anon, authenticated;
grant execute on function private.admin_set_user_coins(uuid, bigint, text) to authenticated;
revoke all on function public.admin_adjust_coins(uuid, integer, text) from public, anon;
revoke all on function public.admin_set_user_coins(uuid, bigint, text) from public, anon;
revoke all on function public.admin_reset_user_coins(uuid) from public, anon;
grant execute on function public.admin_adjust_coins(uuid, integer, text) to authenticated;
grant execute on function public.admin_set_user_coins(uuid, bigint, text) to authenticated;
grant execute on function public.admin_reset_user_coins(uuid) to authenticated;
