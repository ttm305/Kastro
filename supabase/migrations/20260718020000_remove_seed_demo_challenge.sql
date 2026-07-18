-- Removes the leftover seed/demo weekly challenge ("Procedure Mastery
-- Quiz", id 33333333-3333-3333-3333-333333333333) and its fake "SAR Gift
-- Card" prize tiers. This was placeholder content inserted during initial
-- schema seeding and was never replaced with a real admin-created
-- challenge — it was the only row in `challenges` at all, so it kept
-- showing up indefinitely on the Weekly Challenge screen since its
-- starts_at/ends_at window happened to still be current.
--
-- WeeklyChallengeScreen.tsx is already fully data-driven (no hardcoded
-- title/prize text anywhere in the component) and already renders a
-- proper "No active <period> challenge right now" empty state whenever
-- getCurrentChallenge() returns null — so removing this row is the
-- complete fix; no frontend change is needed for the fallback state.
--
-- One participant (T, ea3e80f5-7f1e-4a2a-a587-bc6a92204a31) had joined
-- with score 0 / questions_completed 0 / rewarded = false — no real
-- progress or payout to preserve.
--
-- The real Generic Challenge system (period types, admin CRUD in
-- AdminDashboardScreen's Content tab, join/score/prize RPCs) is fully
-- implemented and untouched by this migration — an owner creating a real
-- challenge from the admin console immediately replaces this empty state.

delete from public.challenge_participants
where challenge_id = '33333333-3333-3333-3333-333333333333';

delete from public.challenge_prizes
where challenge_id = '33333333-3333-3333-3333-333333333333';

delete from public.challenges
where id = '33333333-3333-3333-3333-333333333333';
