-- Second finding from this delivery's security review pass (section 8):
-- messages/conversations/conversation_participants carried the default
-- broad table-level grants (SELECT/INSERT/UPDATE/DELETE/TRUNCATE/
-- REFERENCES/TRIGGER to both anon and authenticated) from whenever they
-- were first created, even though RLS on all three only ever defines a
-- SELECT policy (plus an UPDATE policy scoped to self on
-- conversation_participants). Postgres RLS denies-by-default any command
-- type with no matching policy, so INSERT/UPDATE/DELETE were already
-- unreachable in practice for every role — but TRUNCATE is NOT subject to
-- RLS at all (it bypasses row security entirely), so anon nominally
-- retaining TRUNCATE on all three tables was a real, if not practically
-- reachable through the standard Supabase client/PostgREST (which doesn't
-- expose TRUNCATE), latent risk. This tightens every grant on these three
-- tables down to exactly what RLS actually uses: SELECT only for anon and
-- authenticated (UPDATE where a real UPDATE policy exists), with
-- everything else — INSERT/DELETE/TRUNCATE/REFERENCES/TRIGGER — revoked
-- from both. All real mutations continue to go exclusively through the
-- SECURITY DEFINER RPCs, which are unaffected (they run as the function
-- owner, not as anon/authenticated, and already have their own grants
-- locked down as of the previous migration in this delivery). Verified
-- live post-migration: authenticated direct SELECT on messages (mirrors
-- getMessages()) and direct UPDATE on conversation_participants (mirrors
-- saveDraft()) both still work unchanged.
--
-- Also enables RLS (with no policies, i.e. deny-all for any non-owner
-- role) on private.app_secrets for defense in depth — it already had zero
-- grants to anon/authenticated and lives in a schema PostgREST never
-- exposes, so this changes nothing reachable, just removes the one
-- "relrowsecurity = false" outlier among the tables touched in this
-- delivery.

revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;

revoke all on public.conversations from anon, authenticated;
grant select on public.conversations to authenticated;

revoke all on public.conversation_participants from anon, authenticated;
grant select, update on public.conversation_participants to authenticated;

alter table private.app_secrets enable row level security;
