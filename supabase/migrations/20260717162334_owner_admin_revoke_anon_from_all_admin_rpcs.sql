-- =========================================================================
-- Owner admin expansion — Part 6: blanket security sweep
--
-- Several admin_* functions that pre-dated this expansion still had EXECUTE
-- granted to anon (harmless in practice, since every one of them calls
-- private.require_owner() internally and rejects non-owners with a 42501/
-- 22023 error — but it did not match "revoke execution from unauthorized
-- roles" as a defense-in-depth requirement). This migration is a blanket,
-- self-discovering sweep: it walks every public.admin_* function and
-- revokes EXECUTE from anon/public regardless of when the function was
-- created, so no future admin_* function is accidentally left exposed.
-- Confirmed after running: only postgres/authenticated/service_role hold
-- EXECUTE on any public.admin_* routine — zero anon/public grants remain.
-- =========================================================================

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'admin\_%'
  loop
    execute format('revoke all on function %s from public, anon;', r.sig);
    execute format('grant execute on function %s to authenticated;', r.sig);
  end loop;
end;
$$;
