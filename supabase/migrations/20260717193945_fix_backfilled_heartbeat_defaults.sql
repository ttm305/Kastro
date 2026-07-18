-- Corrective follow-up: the previous migration's `alter table ... add
-- column last_heartbeat_at timestamptz not null default now()` backfilled
-- EVERY existing row (including the already-known-stale ones from
-- 2026-07-16) with the migration's own execution time, not their real
-- last-activity time — so the staleness check in get_presence()/the sweep
-- found nothing to clear immediately after. Retroactively resets
-- last_heartbeat_at to joined_at (the best available real signal of last
-- known activity, in the absence of any actual heartbeat history) for
-- every row that still has left_at null, then re-runs the sweep so
-- genuinely stale rows are cleared now rather than only going forward.
--
-- Verified live post-migration: get_presence() for T (ea3e80f5-...) now
-- returns is_in_game = false, game_name = null.

update public.match_room_players
set last_heartbeat_at = joined_at
where left_at is null;

update public.board_game_players
set last_heartbeat_at = joined_at
where left_at is null;

select private.sweep_stale_game_presence();
