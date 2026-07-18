-- ============================================================
-- Fix: private board-game room join / ready-state / match-start
-- (bug report: "private room + room code + I'm Ready" broken across two
-- real devices/accounts).
--
-- Context for whoever reads this next: unlike every other RPC family in
-- this repo, the original board_game_* room-lifecycle RPCs
-- (create_board_game_room, join_board_game_room[_by_code],
-- set_board_game_ready, start_board_game_room, leave_board_game_room,
-- board_game_heartbeat, join/leave_board_game_spectator) were applied
-- directly to the live project during Ludo development and were never
-- captured as a .sql migration (see migrations/README.md — this predates
-- the file-versioning practice). At the time this fix was written, the
-- live DB connection used to author earlier migrations in this repo was
-- unavailable, so the previous definitions of these functions could not
-- be introspected or diffed against. This migration does not patch them —
-- it CREATE OR REPLACEs all of them with a complete, defensive
-- implementation, built strictly from the confirmed table schemas
-- (src/lib/database.types.ts, which reflects the live schema) and the
-- exact RPC call signatures the frontend already depends on
-- (src/lib/api.ts). It is idempotent and safe to run against the live
-- project as-is.
--
-- Root causes this addresses:
--
-- 1) Join-by-code silently rejecting a correct code: the client already
--    normalizes to trim+uppercase before sending (LudoScreen.tsx), but
--    nothing on the server guaranteed the stored join_code was generated
--    in that same normalized form, and a lookup RPC written as a naive
--    `where join_code = p_join_code` is one stray space or case mismatch
--    away from a false "invalid code". Fixed by normalizing on both
--    generation (create_board_game_room) and lookup
--    (join_board_game_room_by_code) to upper(trim(...)), and by making
--    every rejection reason (not found, full, already started) return a
--    distinct, specific error message instead of a generic failure.
--
-- 2) Ready button stuck at 0/2: set_board_game_ready is rewritten to
--    affirmatively confirm the caller has a seat before writing, and to
--    raise a clear error (rather than a silent no-op) if they don't —
--    combined with the matching frontend fix in this same delivery
--    (lobbyController.ts now refetches immediately after every mutation
--    instead of waiting on a realtime echo that may be delayed or, per
--    the known precedent of the notifications table having been missing
--    from the realtime publication, may never arrive at all).
--
-- 3) Match started more than once / players landing in different
--    sessions: start_board_game_room now takes an explicit row lock
--    (`select ... for update`) on the room before checking the
--    "waiting + enough players + all ready" gate and flipping status to
--    'active', so two near-simultaneous start calls serialize instead of
--    racing — the second call always sees status already 'active' and is
--    rejected with a clear "already started" error rather than creating a
--    second match.
--
-- Also (defensive, mirrors the confirmed notifications-table gap fixed
-- earlier in this project, see 20260717185041_add_notifications_to_
-- realtime_publication.sql): explicitly ensures all five board_game_*
-- tables are members of the supabase_realtime publication, and locks
-- direct table grants down to SELECT-only for authenticated (all writes
-- go exclusively through these SECURITY DEFINER RPCs — the same pattern
-- already used for messages/conversations, see
-- 20260717184228_tighten_chat_table_grants.sql), so RLS can never be the
-- thing silently swallowing a ready-toggle or a seat-join.
--
-- PRODUCTION-SAFETY NOTE (added after the first apply attempt against the
-- live project failed): every one of the 9 public RPCs below already
-- existed live with these exact argument signatures (confirmed by
-- Postgres's own error — "cannot change return type of existing
-- function", with a HINT giving the live signature back verbatim), but
-- with a different return type than this rewrite uses in at least one
-- case. `create or replace function` is only valid when the return type
-- is unchanged — Postgres rejects it outright otherwise, it does not
-- silently coerce or overwrite. So every function this migration touches
-- is explicitly DROPped first, by its exact argument signature, before
-- being recreated. This is also what makes the migration safe to re-run:
-- `drop function if exists` is a no-op once a given function is already
-- gone, and the subsequent `create or replace` is a no-op-equivalent if
-- the definition is already identical — so running this file twice in a
-- row (e.g. a retry after a partial failure) does not error and leaves
-- the database in the same end state either way.
-- ============================================================

-- ---------------------------------------------------------------------
-- Drop every function this migration (re)defines, by its exact argument
-- signature, before recreating any of them. Required because several of
-- these already existed live with a different return type than the one
-- used below, and `create or replace function` cannot change a return
-- type — it errors instead of overwriting.
--
-- Two of these need `cascade`, specifically because this migration's own
-- later statements create real dependents on them within this same file
-- (so a second run of this file — the idempotency requirement — would
-- otherwise fail with "cannot drop function ... because other objects
-- depend on it" the second time through, once those dependents already
-- exist from the first run):
--   - private.is_board_game_room_member: three RLS policies further down
--     (board_game_state_select, board_game_moves_select,
--     board_game_spectators_select) compile it into their USING clause,
--     which Postgres tracks as a hard dependency on the function's OID.
--   - private.join_board_game_room_internal: public.join_board_game_room
--     is a `language sql` wrapper around it, and `language sql` function
--     bodies (unlike plpgsql's opaque-text bodies) are parsed and
--     dependency-tracked against the functions they call at CREATE time.
-- Every object either of these cascades away is unconditionally
-- recreated later in this same file, so the end state is identical
-- either way — cascade here just avoids a spurious failure on rerun.
-- The other 9 functions below are leaf RPCs with no known in-database
-- dependents, so they stay a plain (non-cascading) drop: if something
-- unexpected really does depend on one of them, this should fail loudly
-- rather than silently take a dependent down with it.
-- ---------------------------------------------------------------------
drop function if exists private.is_board_game_room_member(uuid, uuid) cascade;
drop function if exists private.join_board_game_room_internal(uuid) cascade;
drop function if exists public.create_board_game_room(text, int, boolean, boolean);
drop function if exists public.join_board_game_room(uuid);
drop function if exists public.join_board_game_room_by_code(text);
drop function if exists public.set_board_game_ready(uuid, boolean);
drop function if exists public.start_board_game_room(uuid);
drop function if exists public.leave_board_game_room(uuid);
drop function if exists public.board_game_heartbeat(uuid);
drop function if exists public.join_board_game_spectator(uuid);
drop function if exists public.leave_board_game_spectator(uuid);

-- ---------------------------------------------------------------------
-- Helper: is this user a member (seated player or spectator) of this room?
-- ---------------------------------------------------------------------
create or replace function private.is_board_game_room_member(p_room_id uuid, p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public', 'private'
as $$
  select
    exists(select 1 from public.board_game_rooms r where r.id = p_room_id and r.host_id = p_user_id)
    or exists(select 1 from public.board_game_players p where p.room_id = p_room_id and p.user_id = p_user_id)
    or exists(select 1 from public.board_game_spectators s where s.room_id = p_room_id and s.user_id = p_user_id);
$$;

-- ---------------------------------------------------------------------
-- Room creation. Auto-seats the host at seat 0 and creates the initial
-- (empty) board_game_state row so useOnlineBoardGame always has a state
-- row to read from the instant the room exists.
-- ---------------------------------------------------------------------
create or replace function public.create_board_game_room(
  p_game_id text,
  p_max_players int default 4,
  p_allow_spectators boolean default true,
  p_private boolean default false
)
returns setof public.board_game_rooms
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare
  v_room_id uuid;
  v_min_players int;
  v_code text;
  v_tries int := 0;
begin
  if p_max_players is null or p_max_players < 1 or p_max_players > 8 then
    raise exception 'Invalid max players' using errcode = '22023';
  end if;
  if not exists (select 1 from public.games g where g.id = p_game_id and g.is_active) then
    raise exception 'Unknown or inactive game' using errcode = '22023';
  end if;

  -- No explicit min-players input exists on this RPC's call site
  -- (createBoardGameRoom only ever passes max/spectators/private) — 2 is
  -- the correct floor for every board game currently on this framework
  -- (Ludo requires at least 2 seated to start), capped at max_players for
  -- the (currently unused) max_players = 1 edge case.
  v_min_players := least(2, p_max_players);

  if p_private then
    loop
      -- Unambiguous alphabet (no 0/O/1/I) so a code read aloud or typed on
      -- a phone keyboard can't be misheard/mistyped into a different valid
      -- code. Always generated already-normalized (trimmed, uppercase) so
      -- the lookup side never has to guess what form it was stored in.
      v_code := (
        select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 32)::int + 1, 1), '')
        from generate_series(1, 6)
      );
      exit when not exists (
        select 1 from public.board_game_rooms
        where join_code = v_code and status = 'waiting'
      );
      v_tries := v_tries + 1;
      if v_tries > 20 then
        raise exception 'Could not generate a unique room code, try again' using errcode = '22023';
      end if;
    end loop;
  else
    v_code := null;
  end if;

  insert into public.board_game_rooms (game_id, host_id, max_players, min_players, allow_spectators, join_code, status)
  values (p_game_id, auth.uid(), p_max_players, v_min_players, p_allow_spectators, v_code, 'waiting')
  returning id into v_room_id;

  insert into public.board_game_players (room_id, user_id, seat_index, is_ready, is_connected, last_heartbeat_at)
  values (v_room_id, auth.uid(), 0, false, true, now());

  insert into public.board_game_state (room_id, state, version)
  values (v_room_id, '{}'::jsonb, 1);

  return query select * from public.board_game_rooms where id = v_room_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Shared join logic (seat assignment, reconnect, capacity/status checks)
-- used identically by join-by-id and join-by-code, so the two entry
-- points can never diverge in behavior.
-- ---------------------------------------------------------------------
create or replace function private.join_board_game_room_internal(p_room_id uuid)
returns setof public.board_game_players
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare
  v_room record;
  v_existing public.board_game_players%rowtype;
  v_seated_count int;
  v_seat int;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then
    raise exception 'Room not found' using errcode = '22023';
  end if;

  -- Reconnect: caller already holds (or held) a seat in this room —
  -- restore it regardless of room status, so a refresh/network blip never
  -- loses a seat mid-match.
  select * into v_existing from public.board_game_players
  where room_id = p_room_id and user_id = auth.uid()
  limit 1;

  if v_existing.id is not null then
    update public.board_game_players
    set left_at = null, is_connected = true, last_heartbeat_at = now()
    where id = v_existing.id;
    return query select * from public.board_game_players where id = v_existing.id;
    return;
  end if;

  if v_room.status <> 'waiting' then
    raise exception 'This match has already started' using errcode = '22023';
  end if;

  select count(*) into v_seated_count from public.board_game_players
  where room_id = p_room_id and left_at is null;

  if v_seated_count >= v_room.max_players then
    raise exception 'Room is full' using errcode = '22023';
  end if;

  -- Lowest free seat index in [0, max_players).
  select min(s.seat) into v_seat
  from generate_series(0, v_room.max_players - 1) as s(seat)
  where not exists (
    select 1 from public.board_game_players p
    where p.room_id = p_room_id and p.left_at is null and p.seat_index = s.seat
  );

  if v_seat is null then
    raise exception 'Room is full' using errcode = '22023';
  end if;

  insert into public.board_game_players (room_id, user_id, seat_index, is_ready, is_connected, last_heartbeat_at)
  values (p_room_id, auth.uid(), v_seat, false, true, now());

  return query select * from public.board_game_players
  where room_id = p_room_id and user_id = auth.uid();
end;
$$;

create or replace function public.join_board_game_room(p_room_id uuid)
returns setof public.board_game_players
language sql security definer set search_path to 'public', 'private'
as $$
  select * from private.join_board_game_room_internal(p_room_id);
$$;

create or replace function public.join_board_game_room_by_code(p_join_code text)
returns setof public.board_game_players
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare
  v_code text;
  v_room_id uuid;
begin
  v_code := upper(trim(coalesce(p_join_code, '')));
  if v_code = '' then
    raise exception 'Enter a room code' using errcode = '22023';
  end if;

  select id into v_room_id from public.board_game_rooms
  where join_code = v_code
  order by created_at desc
  limit 1;

  if v_room_id is null then
    raise exception 'Invalid or expired room code' using errcode = '22023';
  end if;

  return query select * from private.join_board_game_room_internal(v_room_id);
end;
$$;

-- ---------------------------------------------------------------------
-- Ready toggle — the exact op the two-device test found broken. Fails
-- loudly (instead of a silent zero-row update) if the caller has no live
-- seat in the room, so the frontend can surface a real error instead of
-- the count just never moving.
-- ---------------------------------------------------------------------
create or replace function public.set_board_game_ready(p_room_id uuid, p_ready boolean)
returns void
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare
  v_rows int;
begin
  update public.board_game_players
  set is_ready = p_ready, last_heartbeat_at = now(), is_connected = true
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;

  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'You are not seated in this room' using errcode = '22023';
  end if;
end;
$$;

-- ---------------------------------------------------------------------
-- Host-only match start — atomic (row-locked) exactly-once gate.
-- ---------------------------------------------------------------------
create or replace function public.start_board_game_room(p_room_id uuid)
returns setof public.board_game_rooms
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare
  v_room record;
  v_seated_count int;
  v_unready_count int;
  v_first_seat int;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then
    raise exception 'Room not found' using errcode = '22023';
  end if;
  if v_room.host_id <> auth.uid() then
    raise exception 'Only the host can start the match' using errcode = '42501';
  end if;
  if v_room.status <> 'waiting' then
    raise exception 'This match has already started' using errcode = '22023';
  end if;

  select count(*) into v_seated_count from public.board_game_players
  where room_id = p_room_id and left_at is null;
  if v_seated_count < v_room.min_players then
    raise exception 'Need at least % players', v_room.min_players using errcode = '22023';
  end if;

  select count(*) into v_unready_count from public.board_game_players
  where room_id = p_room_id and left_at is null and not is_ready and not is_ai;
  if v_unready_count > 0 then
    raise exception 'Waiting for everyone to be ready' using errcode = '22023';
  end if;

  select min(seat_index) into v_first_seat from public.board_game_players
  where room_id = p_room_id and left_at is null;

  update public.board_game_rooms
  set status = 'active', started_at = now(), turn_seat_index = v_first_seat, turn_started_at = now()
  where id = p_room_id;

  return query select * from public.board_game_rooms where id = p_room_id;
end;
$$;

-- ---------------------------------------------------------------------
-- Leave — deterministic host-leave rule: transfer host to the next
-- lowest-seated remaining player, or close (delete) the room if it was
-- still in the lobby and is now empty. A room that's already 'active'
-- is left alone on leave (is_connected/left_at drives reconnect/AI
-- takeover in the match itself, which is outside this room-lifecycle
-- bug's scope).
-- ---------------------------------------------------------------------
create or replace function public.leave_board_game_room(p_room_id uuid)
returns void
language plpgsql security definer set search_path to 'public', 'private'
as $$
declare
  v_room record;
  v_next_host uuid;
  v_remaining int;
begin
  select * into v_room from public.board_game_rooms where id = p_room_id for update;
  if v_room.id is null then return; end if;

  update public.board_game_players
  set left_at = now(), is_connected = false
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;

  delete from public.board_game_spectators where room_id = p_room_id and user_id = auth.uid();

  if v_room.status = 'waiting' and v_room.host_id = auth.uid() then
    select user_id into v_next_host from public.board_game_players
    where room_id = p_room_id and left_at is null and user_id is not null
    order by seat_index asc
    limit 1;

    if v_next_host is not null then
      update public.board_game_rooms set host_id = v_next_host where id = p_room_id;
    else
      select count(*) into v_remaining from public.board_game_players
      where room_id = p_room_id and left_at is null;
      if v_remaining = 0 then
        delete from public.board_game_rooms where id = p_room_id;
      end if;
    end if;
  end if;
end;
$$;

create or replace function public.board_game_heartbeat(p_room_id uuid)
returns void
language sql security definer set search_path to 'public', 'private'
as $$
  update public.board_game_players
  set last_heartbeat_at = now(), is_connected = true
  where room_id = p_room_id and user_id = auth.uid() and left_at is null;
$$;

create or replace function public.join_board_game_spectator(p_room_id uuid)
returns void
language plpgsql security definer set search_path to 'public', 'private'
as $$
begin
  if not exists (select 1 from public.board_game_rooms where id = p_room_id and allow_spectators) then
    raise exception 'Spectating is not allowed in this room' using errcode = '22023';
  end if;
  insert into public.board_game_spectators (room_id, user_id) values (p_room_id, auth.uid())
  on conflict (room_id, user_id) do nothing;
end;
$$;

create or replace function public.leave_board_game_spectator(p_room_id uuid)
returns void
language sql security definer set search_path to 'public', 'private'
as $$
  delete from public.board_game_spectators where room_id = p_room_id and user_id = auth.uid();
$$;

-- ---------------------------------------------------------------------
-- Grants: RPCs are callable by authenticated only (never anon), matching
-- every other RPC family in this project.
-- ---------------------------------------------------------------------
revoke all on function private.is_board_game_room_member(uuid, uuid) from public, anon, authenticated;
revoke all on function private.join_board_game_room_internal(uuid) from public, anon, authenticated;

revoke all on function public.create_board_game_room(text, int, boolean, boolean) from public, anon;
revoke all on function public.join_board_game_room(uuid) from public, anon;
revoke all on function public.join_board_game_room_by_code(text) from public, anon;
revoke all on function public.set_board_game_ready(uuid, boolean) from public, anon;
revoke all on function public.start_board_game_room(uuid) from public, anon;
revoke all on function public.leave_board_game_room(uuid) from public, anon;
revoke all on function public.board_game_heartbeat(uuid) from public, anon;
revoke all on function public.join_board_game_spectator(uuid) from public, anon;
revoke all on function public.leave_board_game_spectator(uuid) from public, anon;

grant execute on function public.create_board_game_room(text, int, boolean, boolean) to authenticated;
grant execute on function public.join_board_game_room(uuid) to authenticated;
grant execute on function public.join_board_game_room_by_code(text) to authenticated;
grant execute on function public.set_board_game_ready(uuid, boolean) to authenticated;
grant execute on function public.start_board_game_room(uuid) to authenticated;
grant execute on function public.leave_board_game_room(uuid) to authenticated;
grant execute on function public.board_game_heartbeat(uuid) to authenticated;
grant execute on function public.join_board_game_spectator(uuid) to authenticated;
grant execute on function public.leave_board_game_spectator(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- RLS + table grants: SELECT-only for authenticated on all five tables —
-- every write goes exclusively through the SECURITY DEFINER RPCs above
-- (which bypass RLS as the function owner), so there is no direct-table
-- INSERT/UPDATE path left for RLS to inconsistently allow-SELECT-but-
-- block-write on. Mirrors 20260717184228_tighten_chat_table_grants.sql.
--
-- board_game_rooms/players stay broadly SELECT-able by any authenticated
-- user (room codes are opaque and only usable via the RPC anyway; seat
-- occupancy is needed by getPublicBoardGameRooms for the public
-- matchmaking browse list, which legitimately reads rooms/players the
-- browsing user hasn't joined yet). state/moves/spectators are scoped to
-- room members only — no existing frontend code reads those for a room
-- the viewer hasn't joined.
-- ---------------------------------------------------------------------
alter table public.board_game_rooms enable row level security;
alter table public.board_game_players enable row level security;
alter table public.board_game_state enable row level security;
alter table public.board_game_moves enable row level security;
alter table public.board_game_spectators enable row level security;

drop policy if exists board_game_rooms_select on public.board_game_rooms;
create policy board_game_rooms_select on public.board_game_rooms for select
  using (auth.role() = 'authenticated');

drop policy if exists board_game_players_select on public.board_game_players;
create policy board_game_players_select on public.board_game_players for select
  using (auth.role() = 'authenticated');

drop policy if exists board_game_state_select on public.board_game_state;
create policy board_game_state_select on public.board_game_state for select
  using (private.is_board_game_room_member(room_id, (select auth.uid())));

drop policy if exists board_game_moves_select on public.board_game_moves;
create policy board_game_moves_select on public.board_game_moves for select
  using (private.is_board_game_room_member(room_id, (select auth.uid())));

drop policy if exists board_game_spectators_select on public.board_game_spectators;
create policy board_game_spectators_select on public.board_game_spectators for select
  using (private.is_board_game_room_member(room_id, (select auth.uid())));

revoke all on public.board_game_rooms from anon, authenticated;
grant select on public.board_game_rooms to authenticated;

revoke all on public.board_game_players from anon, authenticated;
grant select on public.board_game_players to authenticated;

revoke all on public.board_game_state from anon, authenticated;
grant select on public.board_game_state to authenticated;

revoke all on public.board_game_moves from anon, authenticated;
grant select on public.board_game_moves to authenticated;

revoke all on public.board_game_spectators from anon, authenticated;
grant select on public.board_game_spectators to authenticated;

-- ---------------------------------------------------------------------
-- Realtime: defensive, idempotent — ensures every table a cross-device
-- lobby update can touch is actually in the publication clients
-- subscribe to (subscribeToBoardGameRoom in src/lib/api.ts listens on all
-- five). A table missing from this publication produces a
-- postgres_changes subscription that "succeeds" client-side and then
-- never fires — the exact failure mode already confirmed once in this
-- project for the notifications table (20260717185041_add_notifications_
-- to_realtime_publication.sql).
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_game_rooms') then
    alter publication supabase_realtime add table public.board_game_rooms;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_game_players') then
    alter publication supabase_realtime add table public.board_game_players;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_game_state') then
    alter publication supabase_realtime add table public.board_game_state;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_game_moves') then
    alter publication supabase_realtime add table public.board_game_moves;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_game_spectators') then
    alter publication supabase_realtime add table public.board_game_spectators;
  end if;
end $$;

-- Lookup indexes the RPCs above rely on (idempotent — no-ops if already present).
create index if not exists idx_board_game_rooms_join_code on public.board_game_rooms (join_code) where join_code is not null;
create index if not exists idx_board_game_players_room_user on public.board_game_players (room_id, user_id);
create index if not exists idx_board_game_players_room_active on public.board_game_players (room_id) where left_at is null;
