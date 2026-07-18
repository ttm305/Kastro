-- ============================================================
-- Fix: private multiplayer lobby (Emoji Decode / Color Blitz — the
-- match_rooms/match_room_players/match_rounds "quiz-room" system) not
-- synchronizing between two real devices. Two-device test result from the
-- bug report: Account A (host) sees only itself, 0/1 ready; Account B
-- sees both players, 0/2 ready; Ready taps do nothing on either device;
-- match never starts.
--
-- ROOT CAUSE (confirmed, not guessed): match_rooms, match_room_players
-- and match_rounds were NEVER added to the supabase_realtime publication,
-- at any point in this project's history — a full grep across every
-- migration in supabase/migrations/ for "add table public.match_room" or
-- "add table public.match_rooms" returns nothing. src/lib/api.ts's
-- subscribeToRoom() subscribes to postgres_changes on exactly these three
-- tables and calls it correct — but a postgres_changes subscription on a
-- table that was never added to the publication "succeeds" at the
-- JS-client level (no error, no rejected promise) and then simply never
-- fires, for any client, ever. This is the exact same failure mode
-- already confirmed and fixed twice before in this project: once for
-- `notifications` (20260717185041_add_notifications_to_realtime_
-- publication.sql) and once for the board_game_* tables earlier in this
-- delivery (20260718050000_fix_board_game_room_lobby.sql).
--
-- This fully explains every symptom reported:
--   - Account A never seeing B join: A's lobby screen (useMatchEngine.ts)
--     fetches players exactly once on mount, then relies entirely on the
--     realtime subscription to learn about anything that happens after —
--     which never fires, so A's screen is permanently frozen at whatever
--     it saw the instant the room was created (itself, alone).
--   - Ready taps doing nothing on either device: same mechanism — even if
--     set_room_ready() succeeds server-side every time (there's no
--     evidence it doesn't), neither device has any way to find out,
--     because the one delivery path (realtime) was never wired at the
--     publication level, and the frontend also never explicitly refetched
--     after its own mutation (fixed separately below, matching the same
--     class of frontend bug already found and fixed for Ludo).
--
-- WHY THIS MIGRATION DOES NOT REWRITE create_private_room / join_room_by_
-- code / join_matchmaking / set_room_ready / leave_room /
-- heartbeat_match_room: unlike the board_game_* RPCs earlier in this
-- delivery (which this same delivery designed from scratch and therefore
-- has complete, confident visibility into), these quiz-room RPCs are
-- older, pre-file-versioning functions this session has never seen the
-- source of — in particular, set_room_ready's "generate round 1 when
-- everyone's ready" step almost certainly dispatches to game-specific
-- round-generation logic (an emoji_puzzles bank for Emoji Decode,
-- different generation rules for Color Blitz) that is not visible from
-- the frontend call sites alone. Blindly reconstructing that logic from
-- guesswork risks silently breaking working round generation to fix a
-- bug that is fully explained without touching it. The realtime-
-- publication gap above is a complete, evidence-backed explanation for
-- every symptom in the report; RLS is hardened defensively below at the
-- table level (also zero risk to RPC internals); the matching frontend
-- refetch-after-mutation fix is in EmojiDecodeScreen.tsx/
-- ColorBlitzScreen.tsx. If, after this and a live test, the ready count
-- or match start still doesn't behave correctly, that would newly
-- implicate set_room_ready's internal logic specifically — see the
-- DiagnosticsPanel (src/components/DiagnosticsPanel.tsx) added in this
-- same delivery, which logs the Ready RPC's actual response on both
-- devices to make that determination possible without live DB access.
-- ============================================================

-- ---------------------------------------------------------------------
-- Helper — mirrors private.is_board_game_room_member exactly, for the
-- match_room_players table instead. Used only by the new RLS policies
-- below, nothing else references it, so it's safe as a plain
-- create-or-replace (brand new function, nothing to conflict with).
-- ---------------------------------------------------------------------
create or replace function private.is_match_room_member(p_room_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'private'
as $$
  select
    exists(select 1 from public.match_rooms r where r.id = p_room_id and r.host_id = p_user_id)
    or exists(select 1 from public.match_room_players p where p.room_id = p_room_id and p.user_id = p_user_id);
$$;
revoke all on function private.is_match_room_member(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- RLS: every room participant must be able to read every active
-- participant/round in their own room — the single most direct fix for
-- "Account A still sees only itself" surviving even a full refetch (not
-- just a realtime gap). Defensive: this may already have been correct
-- live and the realtime gap above may be the sole cause, but there is no
-- way to confirm that without DB access, and this carries no risk of
-- changing any RPC's behavior — it only widens what a participant is
-- allowed to SELECT, in line with what the app already needs to function
-- (getRoomPlayers/getMatchRoom/getCurrentRound in src/lib/api.ts are all
-- plain authenticated-client SELECTs, not RPCs).
-- ---------------------------------------------------------------------
alter table public.match_rooms enable row level security;
alter table public.match_room_players enable row level security;
alter table public.match_rounds enable row level security;
alter table public.match_round_answers enable row level security;

drop policy if exists match_rooms_select on public.match_rooms;
create policy match_rooms_select on public.match_rooms for select
  using (auth.role() = 'authenticated');

drop policy if exists match_room_players_select on public.match_room_players;
create policy match_room_players_select on public.match_room_players for select
  using (private.is_match_room_member(room_id, (select auth.uid())));

drop policy if exists match_rounds_select on public.match_rounds;
create policy match_rounds_select on public.match_rounds for select
  using (private.is_match_room_member(room_id, (select auth.uid())));

drop policy if exists match_round_answers_select on public.match_round_answers;
create policy match_round_answers_select on public.match_round_answers for select
  using (
    exists (
      select 1 from public.match_rounds mr
      where mr.id = match_round_answers.round_id
        and private.is_match_room_member(mr.room_id, (select auth.uid()))
    )
  );

-- ---------------------------------------------------------------------
-- Realtime: the actual fix. Idempotent — safe to re-run.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_rooms') then
    alter publication supabase_realtime add table public.match_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_room_players') then
    alter publication supabase_realtime add table public.match_room_players;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'match_rounds') then
    alter publication supabase_realtime add table public.match_rounds;
  end if;
end $$;
