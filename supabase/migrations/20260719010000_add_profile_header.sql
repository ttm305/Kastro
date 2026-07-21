-- ============================================================
-- Profile header / cover image system.
--
-- WHAT THIS ADDS:
--   1. profiles.header_url (text, nullable) — mirrors avatar_url exactly:
--      a plain Storage public URL, or null for "no custom header, show the
--      default". Not clamped by the profiles_guard_privileged trigger (that
--      trigger only ever checks role/xp/level/status/login_count/
--      access_code_id/username by name — see the comment on updateProfile()
--      in src/lib/api.ts from an earlier phase; a brand-new column it has
--      never heard of cannot be part of any check written against fixed
--      column names), so a direct self-row UPDATE via existing RLS
--      (profiles_update_self_or_owner) is enough — no new RPC needed,
--      exactly like avatar_url/bio/branch_id already work.
--   2. A new public Storage bucket `profile-headers`, sized and MIME-typed
--      for a compressed cover photo, with the same "write only your own
--      folder, read by anyone" shape the (out-of-band, pre-file-versioning)
--      `avatars` bucket already uses in production — this project has never
--      had a migration that created the `avatars` bucket either, so there
--      is no existing migration to mirror line-for-line; this follows
--      standard Supabase Storage RLS conventions instead.
--   3. public.get_public_profiles(uuid[]) gains a header_url output column
--      so a viewed user's header is visible to any authenticated caller
--      (Friends sheet, etc.) through the exact same "public within KASTRO"
--      RPC every other public-profile field already goes through — no
--      separate read path, no separate RLS surface to get wrong.
--
-- Adding an output column to a `returns table(...)` function IS a return-
-- type change, so — per the standing rule in this project (see
-- 20260718050000_fix_board_game_room_lobby.sql's header comment for the
-- original incident) — this DROPs the function with its exact existing
-- argument signature before recreating it, instead of a plain
-- `create or replace` (which would fail with 42P13, exactly like the
-- board-game-room migration failure earlier in this engagement).
-- Confirmed via grep across every migration in this repo: nothing else
-- calls get_public_profiles from inside another SQL function body, so a
-- plain DROP (no CASCADE) is safe here — there is nothing for it to take
-- down with it.
--
-- SAFE TO RE-APPLY: `alter table ... add column if not exists`, the
-- storage.buckets upsert, and `drop policy if exists` + `create policy`
-- are all idempotent; the DROP+CREATE FUNCTION pair is deterministic and
-- produces the same end state on every run.
--
-- EXPLICITLY NOT TOUCHED: multiplayer (match_rooms/board_game_*), presence
-- (get_presence/touch_presence/mark_offline), the RLS-helper EXECUTE
-- grants fixed in 20260718100000, and notifications. This migration only
-- adds a column, a bucket, its policies, and widens one existing RPC's
-- output — nothing here alters an existing policy's logic or an existing
-- RPC's write behavior.
-- ============================================================

-- ---------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------
alter table public.profiles add column if not exists header_url text;

-- ---------------------------------------------------------------------
-- 2. Storage bucket + RLS
--
-- 5 MB limit is generous headroom above what the client ever actually
-- uploads (HeaderPickerModal always re-compresses to a single JPEG before
-- upload — see src/components/HeaderPickerModal.tsx — typically well under
-- 1 MB for a 1200x400 cover photo), kept server-side as defense in depth
-- since a client-side check alone is trivially bypassable by anyone
-- calling the Storage API directly with their own access token.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-headers', 'profile-headers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Read: anyone (the bucket is public — a viewed user's header must be
-- visible to every other authenticated KASTRO user, same visibility model
-- avatar_url already has). Write: only inside your own `{auth.uid()}/...`
-- folder, so one user can never overwrite or delete another user's header.
drop policy if exists profile_headers_select on storage.objects;
create policy profile_headers_select on storage.objects for select
  using (bucket_id = 'profile-headers');

drop policy if exists profile_headers_insert_own on storage.objects;
create policy profile_headers_insert_own on storage.objects for insert
  with check (bucket_id = 'profile-headers' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists profile_headers_update_own on storage.objects;
create policy profile_headers_update_own on storage.objects for update
  using (bucket_id = 'profile-headers' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'profile-headers' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists profile_headers_delete_own on storage.objects;
create policy profile_headers_delete_own on storage.objects for delete
  using (bucket_id = 'profile-headers' and (storage.foldername(name))[1] = (select auth.uid())::text);

-- ---------------------------------------------------------------------
-- 3. get_public_profiles: add header_url
-- ---------------------------------------------------------------------
drop function if exists public.get_public_profiles(uuid[]);

create function public.get_public_profiles(p_ids uuid[] default null::uuid[])
returns table(
  id uuid, username text, level integer, xp bigint, streak_count integer,
  weekly_streak_count integer, equipped_frame_id text, equipped_banner_id text,
  avatar_url text, header_url text, is_online boolean, created_at timestamptz, bio text,
  branch_id uuid, branch_name text, branch_name_ar text
)
language sql
stable security definer
set search_path = public
as $$
  select p.id, p.username, p.level, p.xp, p.streak_count,
         p.weekly_streak_count, p.equipped_frame_id, p.equipped_banner_id,
         p.avatar_url, p.header_url, p.is_online, p.created_at,
         p.bio, p.branch_id, b.name_en, b.name_ar
  from public.profiles p
  left join public.branches b on b.id = p.branch_id
  where p_ids is null or p.id = any(p_ids);
$$;

-- The function has never had an explicit grant statement in this project
-- (it has always relied on Postgres's default EXECUTE-to-PUBLIC on newly
-- created functions) — DROP+CREATE produces a fresh function object with
-- that same default, so this explicit grant is not a behavior change, only
-- making the previously-implicit contract explicit and immune to some
-- future migration ever revoking it by accident, the exact failure class
-- fixed in 20260718100000.
grant execute on function public.get_public_profiles(uuid[]) to authenticated;
