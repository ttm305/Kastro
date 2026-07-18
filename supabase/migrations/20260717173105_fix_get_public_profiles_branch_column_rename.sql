-- Regression found during post-migration verification of
-- dynamic_branch_management: get_public_profiles() selected b.name, which
-- no longer exists after branches.name was renamed to branches.name_en.
-- This function is used by HomeScreen/ProfileScreen to resolve another
-- user's branch label and would have raised "column b.name does not
-- exist" on every call. Fixed by pointing at b.name_en; the function's
-- own output column is left named branch_name (unchanged, external
-- contract with the frontend's PublicProfile type in api.ts is preserved
-- — only the internal source column changed).
create or replace function public.get_public_profiles(p_ids uuid[] default null::uuid[])
returns table(
  id uuid, username text, level integer, xp bigint, streak_count integer,
  weekly_streak_count integer, equipped_frame_id text, equipped_banner_id text,
  avatar_url text, is_online boolean, created_at timestamptz, bio text,
  branch_id uuid, branch_name text, branch_name_ar text
)
language sql
stable security definer
set search_path = public
as $$
  select p.id, p.username, p.level, p.xp, p.streak_count,
         p.weekly_streak_count, p.equipped_frame_id, p.equipped_banner_id,
         p.avatar_url, p.is_online, p.created_at,
         p.bio, p.branch_id, b.name_en, b.name_ar
  from public.profiles p
  left join public.branches b on b.id = p.branch_id
  where p_ids is null or p.id = any(p_ids);
$$;
