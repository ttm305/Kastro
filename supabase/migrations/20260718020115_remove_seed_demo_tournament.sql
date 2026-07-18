-- Same category of leftover seed content as the demo weekly challenge
-- removed in the previous migration, found while investigating that
-- issue: a demo tournament ("Procedure Championship Q3 2025", id
-- 22222222-2222-2222-2222-222222222222) with four fake "SAR Gift Card"
-- prize tiers, still in status = 'registration_open' with a starts_at/
-- ends_at window that happens to still be current. It was the only row
-- in `tournaments`, 0 real participants, 0 rounds — pure seed data, never
-- replaced with a real admin-created tournament.
--
-- TournamentScreen.tsx is already fully data-driven and already renders a
-- proper "No active tournament right now" empty state whenever
-- getActiveTournament() returns null, so — same as the challenge fix —
-- removing this row is the complete fix; no frontend change needed.

delete from public.tournament_prizes
where tournament_id = '22222222-2222-2222-2222-222222222222';

delete from public.tournament_participants
where tournament_id = '22222222-2222-2222-2222-222222222222';

delete from public.tournament_rounds
where tournament_id = '22222222-2222-2222-2222-222222222222';

delete from public.tournaments
where id = '22222222-2222-2222-2222-222222222222';
