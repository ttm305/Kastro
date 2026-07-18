-- Root cause of "Playing Emoji Decode" showing for a user who isn't
-- actually playing: match_room_players had no heartbeat/staleness concept
-- at all, and the only path that ever set left_at was an explicit
-- "leave" button click in the frontend (EmojiDecodeScreen/ColorBlitzScreen's
-- handleLeave) — never a useEffect cleanup on unmount, navigation away,
-- app close, or logout. A player who left the game screen any other way
-- (bottom-nav tap, back gesture, closing the tab, backgrounding on
-- mobile) stayed "in that game" in the database forever, and
-- get_presence() had no way to know the row was stale. Live-confirmed:
-- ea3e80f5-... (T) had a match_room_players row for emoji_decode with
-- status='in_progress', left_at IS NULL, joined over a day before this
-- fix — exactly reproducing the report.

-- 1. Heartbeat columns, mirroring conversation_participants'
--    last_heartbeat_at pattern.
alter table public.match_room_players add column if not exists last_heartbeat_at timestamptz not null default now();
alter table public.board_game_players add column if not exists last_heartbeat_at timestamptz not null default now();

-- 2. Heartbeat RPCs — called every ~20s from the frontend while a match
--    screen is mounted and visible. match_room_players had no heartbeat
--    RPC at all before this; board_game_heartbeat existed but only ever
--    touched the boolean is_connected flag, not a timestamp, so staleness
--    could never be computed from it.
create or replace function public.heartbeat_match_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update public.match_room_players
  set last_heartbeat_at = now()
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
end;
$$;
revoke all on function public.heartbeat_match_room(uuid) from public, anon;
grant execute on function public.heartbeat_match_room(uuid) to authenticated;

create or replace function public.board_game_heartbeat(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update public.board_game_players
  set is_connected = true, last_heartbeat_at = now()
  where room_id = p_room_id and user_id = auth.uid();
end;
$$;

-- 3. Server-side sweep (pg_cron, every minute — same cadence as the
--    existing stale-conversation-viewer sweep) as the reliable backstop:
--    even if a client never gets a chance to signal "I'm leaving" at all
--    (crash, force-quit, killed background tab), a lapsed heartbeat alone
--    is enough to clear the stale row within ~90s. This is what makes
--    "session disconnects" and "closing the app where possible" work even
--    when no explicit leave/unload signal ever fires.
create or replace function private.sweep_stale_match_room_players()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update public.match_room_players
  set left_at = now()
  where left_at is null
    and last_heartbeat_at < now() - interval '90 seconds';
end;
$$;

create or replace function private.sweep_stale_board_game_players()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update public.board_game_players
  set is_connected = false
  where is_connected = true
    and left_at is null
    and last_heartbeat_at < now() - interval '90 seconds';
end;
$$;

create or replace function private.sweep_stale_game_presence()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  perform private.sweep_stale_match_room_players();
  perform private.sweep_stale_board_game_players();
end;
$$;

select cron.schedule(
  'sweep-stale-game-presence',
  '* * * * *',
  $$select private.sweep_stale_game_presence();$$
) where not exists (select 1 from cron.job where jobname = 'sweep-stale-game-presence');

-- 4. get_presence() now requires a *fresh* heartbeat, not just an
--    unclosed row — this is the fix that makes the frontend's presence
--    display never trust a stale row even in the up-to-90s window before
--    the sweep above catches it (belt and suspenders: server-computed
--    freshness, not something the client has to remember to check).
create or replace function public.get_presence(p_ids uuid[])
returns table(id uuid, is_online boolean, last_seen_at timestamptz, is_in_game boolean, game_name text, game_name_ar text)
language sql
stable
security definer
set search_path = public, private
as $$
  select p.id, p.is_online, p.last_seen_at,
    (bg.user_id is not null or mr.user_id is not null),
    coalesce(g1.name, g2.name), coalesce(g1.name_ar, g2.name_ar)
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

-- 5. Explicit, immediate clear on logout — the sweep above would catch it
--    within ~90s anyway, but "clear game activity immediately when...
--    logging out" is an explicit requirement, so the frontend's sign-out
--    flow now calls this first.
create or replace function public.clear_my_game_presence()
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  update public.match_room_players set left_at = now()
  where user_id = auth.uid() and left_at is null;
  update public.board_game_players set is_connected = false
  where user_id = auth.uid() and left_at is null;
end;
$$;
revoke all on function public.clear_my_game_presence() from public, anon;
grant execute on function public.clear_my_game_presence() to authenticated;

-- 6. Backfill: clear every currently-stale row right now (the exact rows
--    that were causing today's live "Playing Emoji Decode" report), not
--    just prevent new staleness going forward.
update public.match_room_players
set left_at = now()
where left_at is null
  and last_heartbeat_at < now() - interval '90 seconds';

update public.board_game_players
set is_connected = false
where is_connected = true
  and left_at is null
  and last_heartbeat_at < now() - interval '90 seconds';
