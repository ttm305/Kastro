-- =============================================================================
-- Games Library redesign: visual cover-image system + richer taxonomy +
-- per-user favorites, in support of the new image-first Games page.
--
-- 1. New games columns: cover_image_url, thumbnail_image_url (admin-uploaded
--    artwork, nullable — the frontend falls back to the existing hand-built
--    SVG "world" art when null, so nothing looks broken before an owner
--    uploads real covers), is_new, is_multiplayer (both real, derived from
--    actual game data below — not placeholders).
-- 2. Widens games_category_check from ('work','casual') to the richer set
--    the new UI's category chips filter on: work, card, board, puzzle,
--    quick. Existing RLS/XP/routing logic never branches on the literal
--    string value of `category` (verified by repo-wide grep — only
--    GamesLibraryScreen's own tab filter and the admin dropdown read it),
--    so widening it is safe. IMPORTANT ordering note: the old constraint
--    must be dropped BEFORE the data is reclassified, since
--    `alter table ... add constraint` validates immediately against
--    current row data, not at commit time — the new constraint is only
--    added back once every row already satisfies it.
-- 3. is_multiplayer is set from each game's real target_screen: 'lobby'
--    routes to the shared realtime GameLobbyScreen (multiplayer), while
--    'workgame'/'casualgame' route to solo-practice screens. emoji_decode /
--    color_blitz / ludo all have their own dedicated multiplayer quiz-room
--    / board-game-room systems (built in earlier phases of this project),
--    so they're marked multiplayer too.
-- 4. New 'game-covers' storage bucket: public read, owner-only write —
--    identical policy shape to the existing 'profile-headers' bucket, so an
--    owner can upload/replace game cover art from the Admin Dashboard
--    without any code change or redeploy.
-- 5. New user_favorite_games table: lets a player heart a game on the new
--    Games page. Simple owning-user-only RLS, same shape as other
--    per-user tables in this schema.
-- =============================================================================

alter table public.games
  add column if not exists cover_image_url text,
  add column if not exists thumbnail_image_url text,
  add column if not exists is_new boolean not null default false,
  add column if not exists is_multiplayer boolean not null default false;

alter table public.games drop constraint if exists games_category_check;

-- Category reclassification: existing 2-value taxonomy ('work'/'casual')
-- widened into the richer set the new UI's category chips filter on.
update public.games set category = 'card'   where id = 'cg1';
update public.games set category = 'puzzle' where id in ('cg2', 'emoji_decode');
update public.games set category = 'quick'  where id = 'color_blitz';
update public.games set category = 'board'  where id = 'ludo';
-- wg1..wg8 already have category = 'work'; no change needed.

alter table public.games add constraint games_category_check
  check (category = any (array['work','card','board','puzzle','quick']));

-- Multiplayer flag, set from each game's real target_screen: 'lobby' routes
-- to the shared realtime GameLobbyScreen (multiplayer), while
-- 'workgame'/'casualgame' route to solo-practice screens. emoji_decode /
-- color_blitz / ludo all have their own dedicated multiplayer quiz-room /
-- board-game-room systems, so they're marked multiplayer too.
update public.games set is_multiplayer = true
  where id in ('wg2', 'wg3', 'wg4', 'wg5', 'wg6', 'wg7', 'emoji_decode', 'color_blitz', 'ludo');

-- "New" flag — carried over from the existing free-text tag='new' markers,
-- now a proper structured boolean the admin can toggle per game.
update public.games set is_new = true where id in ('wg2', 'cg2');

-- ---------------------------------------------------------------------
-- game-covers storage bucket: public read, owner-only write — identical
-- policy shape to the existing 'profile-headers' bucket.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-covers', 'game-covers', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists game_covers_select on storage.objects;
create policy game_covers_select on storage.objects for select
  using (bucket_id = 'game-covers');

drop policy if exists game_covers_owner_write on storage.objects;
create policy game_covers_owner_write on storage.objects for all
  using (bucket_id = 'game-covers' and current_role_is_owner())
  with check (bucket_id = 'game-covers' and current_role_is_owner());

-- ---------------------------------------------------------------------
-- user_favorite_games — lets a player heart a game on the new Games page.
-- ---------------------------------------------------------------------
create table if not exists public.user_favorite_games (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  game_id    text not null references public.games(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, game_id)
);

alter table public.user_favorite_games enable row level security;

drop policy if exists user_favorite_games_own on public.user_favorite_games;
create policy user_favorite_games_own on public.user_favorite_games for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
