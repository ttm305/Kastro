-- =========================================================================
-- Dynamic, owner-managed Branch Management.
--
-- Converts the branches table into the shape specified for full owner CRUD
-- (code/name_ar/name_en/is_active/sort_order/created_at/updated_at) and
-- adds SECURITY DEFINER RPCs for every owner mutation (create/edit/
-- activate-deactivate/reorder/delete-with-guard/list-with-user-counts),
-- following the same private.require_owner() + admin_log pattern used by
-- every other owner action in this app — RLS alone is defense-in-depth,
-- the RPCs are the real, audited entry point the frontend uses.
--
-- NOTE: admin_reorder_branches below has a known bug (ambiguous overload
-- resolution calling private.log_admin_action with 5 args) that is fixed
-- by the very next migration, 20260717172013_fix_admin_reorder_branches_
-- log_call_ambiguity.sql. Both are kept, file-versioned, in their original
-- applied form for an accurate history — apply both, in order.
-- =========================================================================

-- ---------------------------------------------------------------------
-- 1. Schema: name -> name_en, slug -> code, add updated_at (+ trigger).
-- ---------------------------------------------------------------------
alter table public.branches rename column name to name_en;
alter table public.branches rename column slug to code;

alter table public.branches add column if not exists updated_at timestamptz;
update public.branches set updated_at = created_at where updated_at is null;
alter table public.branches alter column updated_at set default now();
alter table public.branches alter column updated_at set not null;

drop trigger if exists branches_set_updated_at on public.branches;
create trigger branches_set_updated_at
  before update on public.branches
  for each row execute function public.set_updated_at();

alter table public.branches drop constraint if exists branches_code_format_check;
alter table public.branches add constraint branches_code_format_check
  check (code ~ '^[a-z0-9_]+$');

alter table public.branches drop constraint if exists branches_name_en_not_blank;
alter table public.branches add constraint branches_name_en_not_blank check (length(trim(name_en)) > 0);
alter table public.branches drop constraint if exists branches_name_ar_not_blank;
alter table public.branches add constraint branches_name_ar_not_blank check (length(trim(name_ar)) > 0);

comment on table public.branches is
  'Owner-managed org branches. code is a permanent, immutable machine key
   (e.g. evaluation_branch); name_en/name_ar are the owner-editable
   bilingual display labels; id (uuid) is the actual FK used by
   profiles.branch_id.';

-- ---------------------------------------------------------------------
-- 2. admin_log: allow the new 'branches' category.
-- ---------------------------------------------------------------------
alter table public.admin_log drop constraint if exists admin_log_category_check;
alter table public.admin_log add constraint admin_log_category_check
  check (category = any (array[
    'users','codes','xp','badges','security','announcements',
    'tournaments','seasons','challenges','coin_reward_config',
    'coins','stats','titles','reset','branches'
  ]));

-- ---------------------------------------------------------------------
-- 3. RLS: normal players (anon or authenticated non-owner) may only read
--    active branches. The owner additionally sees inactive ones — needed
--    for the Branch Management screen. Mutations remain owner-only via
--    the pre-existing branches_owner_write ALL policy (unchanged) AND,
--    as the actual app entry point, the RPCs below.
-- ---------------------------------------------------------------------
drop policy if exists branches_select_authenticated on public.branches;
drop policy if exists branches_select_anon_active on public.branches;

create policy branches_select_active
  on public.branches for select
  to public
  using (is_active = true);

create policy branches_select_owner_all
  on public.branches for select
  to public
  using (public.current_role_is_owner());

-- ---------------------------------------------------------------------
-- 4. Owner RPCs.
-- ---------------------------------------------------------------------

-- List every branch with a live count of linked user accounts, for the
-- Branch Management screen (owner-only — this is the only place inactive
-- branches and per-branch user counts are exposed).
create or replace function public.admin_get_branches()
returns table(
  id uuid, code text, name_ar text, name_en text,
  is_active boolean, sort_order integer,
  created_at timestamptz, updated_at timestamptz,
  user_count bigint
)
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.require_owner();
  return query
    select b.id, b.code, b.name_ar, b.name_en, b.is_active, b.sort_order,
           b.created_at, b.updated_at,
           coalesce(count(p.id), 0) as user_count
    from public.branches b
    left join public.profiles p on p.branch_id = b.id
    group by b.id
    order by b.sort_order, b.created_at;
end;
$$;

-- Create. sort_order defaults to "last" (max existing + 1) unless given.
create or replace function public.admin_create_branch(
  p_code text, p_name_ar text, p_name_en text,
  p_is_active boolean default true, p_sort_order integer default null
) returns public.branches
language plpgsql
security definer
set search_path = public, private
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
    'code=' || v_row.code, null, null, to_jsonb(v_row)::text);

  return v_row;
end; $$;

-- Edit names only — code is a permanent machine key once created, exactly
-- like every other stable identifier in this schema (achievement ids,
-- game ids); changing it out from under existing references would be the
-- kind of silent breakage this whole feature exists to avoid.
create or replace function public.admin_update_branch(
  p_branch_id uuid, p_name_ar text, p_name_en text
) returns public.branches
language plpgsql
security definer
set search_path = public, private
as $$
declare v_old public.branches; v_new public.branches; begin
  perform private.require_owner();
  select * into v_old from public.branches where id = p_branch_id;
  if v_old.id is null then raise exception 'Branch not found' using errcode = '22023'; end if;
  if trim(coalesce(p_name_en, '')) = '' then raise exception 'English name is required' using errcode = '22023'; end if;
  if trim(coalesce(p_name_ar, '')) = '' then raise exception 'Arabic name is required' using errcode = '22023'; end if;

  update public.branches set name_ar = trim(p_name_ar), name_en = trim(p_name_en)
  where id = p_branch_id returning * into v_new;

  perform private.log_admin_action(auth.uid(), 'Edit Branch', 'branches', v_new.name_en,
    'code=' || v_new.code, null, to_jsonb(v_old)::text, to_jsonb(v_new)::text);

  return v_new;
end; $$;

-- Activate / deactivate.
create or replace function public.admin_set_branch_active(
  p_branch_id uuid, p_is_active boolean
) returns public.branches
language plpgsql
security definer
set search_path = public, private
as $$
declare v_row public.branches; begin
  perform private.require_owner();
  update public.branches set is_active = p_is_active where id = p_branch_id returning * into v_row;
  if v_row.id is null then raise exception 'Branch not found' using errcode = '22023'; end if;

  perform private.log_admin_action(
    auth.uid(), case when p_is_active then 'Activate Branch' else 'Deactivate Branch' end,
    'branches', v_row.name_en, 'code=' || v_row.code, null,
    (not p_is_active)::text, p_is_active::text
  );
  return v_row;
end; $$;

-- Reorder: the owner UI sends the full list of branch ids in the desired
-- display order; sort_order is assigned as each id's 1-based position.
create or replace function public.admin_reorder_branches(p_ordered_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public, private
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

  perform private.log_admin_action(auth.uid(), 'Reorder Branches', 'branches', 'branches',
    array_length(p_ordered_ids, 1)::text || ' branches reordered');
end; $$;

-- Delete: hard-blocked if any profile still points at this branch — never
-- silently orphans a user's branch_id.
create or replace function public.admin_delete_branch(p_branch_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
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
    'code=' || v_row.code, null, to_jsonb(v_row)::text, null);
end; $$;

revoke all on function public.admin_get_branches() from public, anon;
revoke all on function public.admin_create_branch(text, text, text, boolean, integer) from public, anon;
revoke all on function public.admin_update_branch(uuid, text, text) from public, anon;
revoke all on function public.admin_set_branch_active(uuid, boolean) from public, anon;
revoke all on function public.admin_reorder_branches(uuid[]) from public, anon;
revoke all on function public.admin_delete_branch(uuid) from public, anon;
grant execute on function public.admin_get_branches() to authenticated;
grant execute on function public.admin_create_branch(text, text, text, boolean, integer) to authenticated;
grant execute on function public.admin_update_branch(uuid, text, text) to authenticated;
grant execute on function public.admin_set_branch_active(uuid, boolean) to authenticated;
grant execute on function public.admin_reorder_branches(uuid[]) to authenticated;
grant execute on function public.admin_delete_branch(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 5. Existing-user data safety: any profile with a null branch_id (should
--    not exist in practice, since branch is required at registration, but
--    this is a defensive backfill for any pre-existing/edge-case rows) is
--    pointed at the evaluation_branch branch rather than left dangling.
-- ---------------------------------------------------------------------
update public.profiles p
set branch_id = b.id
from public.branches b
where p.branch_id is null and b.code = 'evaluation_branch';
