-- =========================================================================
-- Fix: registration Branch dropdown showing empty options.
--
-- ROOT CAUSE: the registration screen calls getBranches() before the user
-- has an authenticated session (they aren't signed in yet — that's the
-- whole point of the flow). The only existing SELECT policy on
-- public.branches, `branches_select_authenticated`, requires
-- auth.role() = 'authenticated'. An unauthenticated (anon) client
-- therefore got zero rows back — not an error, just silently zero rows —
-- which rendered as an empty <select>. Confirmed live:
--   set role anon; select * from public.branches;  ->  returned 0 rows.
--
-- This migration:
--   1. Adds a stable, human-readable slug (e.g. 'evaluation_branch') so
--      the app has a permanent machine key independent of the display
--      name — the id (uuid) remains the actual FK used by profiles.branch_id,
--      this is additive, not a schema-breaking change.
--   2. Grants anon SELECT on *active* branches only (inactive/deprecated
--      branches stay invisible to unauthenticated registration traffic;
--      authenticated users, including the admin panel, keep seeing all
--      branches via the pre-existing policy).
--   3. Normalizes seed data so the dropdown shows exactly the one branch
--      currently in scope ("Evaluation Branch"), by deactivating the
--      other placeholder row rather than deleting it — is_active is
--      exactly the mechanism this schema already provides for "ready to
--      add more branches later" without another migration.
-- =========================================================================

alter table public.branches add column if not exists slug text;

update public.branches set slug = 'evaluation_branch' where name = 'Evaluation Branch' and slug is null;
update public.branches set slug = 'human_resources'   where name = 'Human Resources'   and slug is null;
-- Safety net for any other pre-existing rows that don't match the two
-- known names above (none expected today, but keeps the NOT NULL below
-- from ever failing on unexpected data).
update public.branches set slug = lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '_', 'g'))
where slug is null;

alter table public.branches alter column slug set not null;
alter table public.branches add constraint branches_slug_key unique (slug);

-- Exactly one active branch for now: Evaluation Branch. Human Resources
-- (seed/test data from an earlier phase) is deactivated, not deleted, so
-- it can be re-enabled later and any profile already pointing at it via
-- branch_id keeps working.
update public.branches set is_active = false where slug = 'human_resources';
update public.branches set is_active = true  where slug = 'evaluation_branch';

-- Allow unauthenticated (pre-signup) clients to read active branches only.
drop policy if exists branches_select_anon_active on public.branches;
create policy branches_select_anon_active
  on public.branches for select
  to anon
  using (is_active = true);
