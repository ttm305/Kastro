-- ============================================================
-- Fix: Friends screen shows accounts as "Online" long after they've
-- actually closed the app (bug report: "Presence status is false and
-- not live").
--
-- ROOT CAUSE (confirmed by reading the code, not guessed): this project
-- has two entirely separate presence mechanisms that were never
-- consolidated:
--
--   1. `record_login` / `record_logout` — called once each from
--      src/lib/auth.tsx, at session start and at explicit Sign Out. These
--      are pre-file-versioning RPCs (not in any migration in this repo,
--      same situation as the board_game_* RPCs fixed earlier in this
--      delivery) that most likely flip profiles.is_online straight to
--      true/false with no further involvement.
--   2. `touch_presence` / `mark_offline` (20260716200757_friends_chat_
--      functions.sql) — a proper heartbeat-shaped pair that already sets
--      last_seen_at = now() correctly. These ARE fully correct and
--      already versioned. The bug is NOT in these functions — it's that
--      nothing in the frontend ever called them. grep across the entire
--      src tree confirms `touchPresence()`/`markOffline()` (src/lib/
--      api.ts) were dead code with zero call sites before this fix.
--
-- Net effect: `profiles.is_online` gets set to `true` exactly once, at
-- login (via record_login), and then never changes again until the user
-- explicitly presses Sign Out (record_logout) — which normal app closure
-- (backgrounding, force-quit, losing connection, locking the phone,
-- killing a PWA) never triggers. get_presence() (redefined below) then
-- compounds this by trusting that stored boolean directly with no
-- freshness check at all, so a user who force-quit the app three days
-- ago still shows "Online" to their friends indefinitely.
--
-- THE FIX has two parts, matching the two root causes:
--   1. Frontend (src/lib/presenceHeartbeat.ts, wired from App.tsx): a
--      real heartbeat loop now calls the already-correct touch_presence()
--      every 20s while the tab/app is visible, plus immediately on
--      visibilitychange-to-visible and on the 'online' network event, and
--      calls mark_offline() on pagehide/beforeunload/visibilitychange-to-
--      hidden/the 'offline' event where each is supported — see that file
--      for the full lifecycle. This does NOT touch or replace
--      record_login/record_logout (left exactly as-is, no DB risk).
--   2. Database (this migration): get_presence() is changed to compute
--      is_online purely from last_seen_at freshness — `last_seen_at >
--      now() - interval '45 seconds'` — completely ignoring the stored
--      is_online column. This is the server-authoritative half of the
--      fix: even if a device never gets the chance to signal it's
--      closing at all (crash, force-quit, killed background process,
--      airplane mode), presence self-corrects within 45 seconds of the
--      last heartbeat with no reliance on a graceful close signal ever
--      firing. 45s = a little over two missed 20s heartbeats, so one
--      dropped beat from normal network jitter doesn't flap someone's
--      status, but a genuinely closed app disappears within a "very
--      short, clearly defined timeout" as required.
--
-- SAFE TO RE-APPLY: get_presence's signature/return type is unchanged
-- (same `table(id uuid, is_online boolean, last_seen_at timestamptz,
-- is_in_game boolean, game_name text, game_name_ar text)` as the version
-- already live from 20260717193802_fix_stale_game_presence.sql), so this
-- is a plain `create or replace` with no return-type conflict — no DROP
-- needed here, unlike the board-game-room migration earlier in this
-- delivery. record_login/record_logout/touch_presence/mark_offline are
-- not touched by this migration at all.
-- ============================================================

create or replace function public.get_presence(p_ids uuid[])
returns table(
  id uuid,
  is_online boolean,
  last_seen_at timestamptz,
  is_in_game boolean,
  game_name text,
  game_name_ar text
)
language sql
stable
security definer
set search_path = public, private
as $$
  select
    p.id,
    (p.last_seen_at is not null and p.last_seen_at > now() - interval '45 seconds'),
    p.last_seen_at,
    (bg.user_id is not null or mr.user_id is not null),
    coalesce(g1.name, g2.name),
    coalesce(g1.name_ar, g2.name_ar)
  from public.profiles p
  left join lateral (
    select bgp.user_id, bgr.game_id from public.board_game_players bgp
    join public.board_game_rooms bgr on bgr.id = bgp.room_id and bgr.status = 'active'
    where bgp.user_id = p.id and bgp.left_at is null
      and bgp.last_heartbeat_at > now() - interval '90 seconds'
    limit 1
  ) bg on true
  left join lateral (
    select mrp.user_id, mr2.game_id from public.match_room_players mrp
    join public.match_rooms mr2 on mr2.id = mrp.room_id and mr2.status in ('active','in_progress')
    where mrp.user_id = p.id and mrp.left_at is null
      and mrp.last_heartbeat_at > now() - interval '90 seconds'
    limit 1
  ) mr on true
  left join public.games g1 on g1.id = bg.game_id
  left join public.games g2 on g2.id = mr.game_id
  where p.id = any(p_ids);
$$;

revoke all on function public.get_presence(uuid[]) from public, anon;
grant execute on function public.get_presence(uuid[]) to authenticated;
