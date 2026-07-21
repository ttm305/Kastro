-- =============================================================================
-- Cosmetic pipeline fix, part 1 (DB): the equip write path already worked
-- (equipCosmetic() correctly updates profiles.equipped_*), but the READ
-- path was broken for anyone other than the profile owner — get_public_
-- profiles() only ever returned equipped_frame_id/equipped_banner_id (never
-- equipped_title_id/equipped_decoration_id), and get_leaderboard_v2() only
-- ever returned equipped_frame_id (missing all three others). Every screen
-- that shows OTHER players (Friend Profile, match lobby, leaderboard) reads
-- through one of these two RPCs, so cosmetics equipped by one player could
-- never actually reach another player's screen no matter what the frontend
-- did with them. This migration widens both RPCs' return shape; the actual
-- frontend rendering fix is a separate, non-DB change.
--
-- Both functions' argument signatures are unchanged (only the RETURNS TABLE
-- shape grows), so per this project's established convention: drop with the
-- exact existing signature, then recreate — CREATE OR REPLACE cannot change
-- a function's return type.
-- =============================================================================

drop function if exists public.get_public_profiles(uuid[]);

create function public.get_public_profiles(p_ids uuid[] default null::uuid[])
returns table(
  id uuid, username text, level integer, xp bigint, streak_count integer,
  weekly_streak_count integer, equipped_frame_id text, equipped_banner_id text,
  equipped_title_id text, equipped_decoration_id text,
  avatar_url text, header_url text, is_online boolean, created_at timestamptz, bio text,
  branch_id uuid, branch_name text, branch_name_ar text
)
language sql
stable security definer
set search_path = public
as $$
  select p.id, p.username, p.level, p.xp, p.streak_count,
         p.weekly_streak_count, p.equipped_frame_id, p.equipped_banner_id,
         p.equipped_title_id, p.equipped_decoration_id,
         p.avatar_url, p.header_url, p.is_online, p.created_at,
         p.bio, p.branch_id, b.name_en, b.name_ar
  from public.profiles p
  left join public.branches b on b.id = p.branch_id
  where p_ids is null or p.id = any(p_ids);
$$;

grant execute on function public.get_public_profiles(uuid[]) to authenticated, anon;

drop function if exists public.get_leaderboard_v2(text, text, text, integer);

create function public.get_leaderboard_v2(p_scope text default 'overall'::text, p_period text default 'weekly'::text, p_filter text default null::text, p_limit integer default 50)
returns table(
  user_id uuid, username text, points bigint, level integer, streak_count integer,
  equipped_frame_id text, equipped_banner_id text, equipped_title_id text, equipped_decoration_id text,
  avatar_url text, rank bigint
)
language plpgsql
stable security definer
set search_path = public, private
as $$
declare
  v_since timestamptz;
  v_season_id uuid;
begin
  if p_scope not in ('overall','branch','game','friends','season') then
    raise exception 'Invalid scope' using errcode = '22023';
  end if;

  v_since := case p_period
    when 'weekly' then date_trunc('week', now())
    when 'monthly' then date_trunc('month', now())
    when 'quarterly' then date_trunc('quarter', now())
    when 'yearly' then date_trunc('year', now())
    else null
  end;

  if p_scope = 'game' then
    if p_filter is null then raise exception 'game scope requires p_filter=game_id' using errcode = '22023'; end if;
    return query
      select p.id, p.username,
             coalesce(sum(gs.xp_awarded), 0)::bigint as points,
             p.level, p.streak_count, p.equipped_frame_id, p.equipped_banner_id, p.equipped_title_id, p.equipped_decoration_id, p.avatar_url,
             row_number() over (order by coalesce(sum(gs.xp_awarded), 0) desc, p.id) as rank
      from public.profiles p
      join public.game_sessions gs on gs.user_id = p.id and gs.game_id = p_filter and gs.status = 'completed'
      where p.status = 'active'
      group by p.id
      order by points desc
      limit p_limit;
    return;
  end if;

  if p_scope = 'season' then
    v_season_id := nullif(p_filter, '')::uuid;
    if v_season_id is null then
      select id into v_season_id from public.seasons where is_active = true limit 1;
    end if;
    if v_season_id is null then return; end if;
    return query
      select p.id, p.username,
             coalesce(usp.season_xp, 0)::bigint as points,
             p.level, p.streak_count, p.equipped_frame_id, p.equipped_banner_id, p.equipped_title_id, p.equipped_decoration_id, p.avatar_url,
             row_number() over (order by coalesce(usp.season_xp, 0) desc, p.id) as rank
      from public.profiles p
      join public.user_season_progress usp on usp.user_id = p.id and usp.season_id = v_season_id
      where p.status = 'active'
      order by points desc
      limit p_limit;
    return;
  end if;

  return query
    select p.id, p.username,
           case when v_since is null then p.xp
                else coalesce((select sum(greatest(l.delta,0)) from public.xp_ledger l where l.user_id = p.id and l.created_at >= v_since), 0)
           end::bigint as points,
           p.level, p.streak_count, p.equipped_frame_id, p.equipped_banner_id, p.equipped_title_id, p.equipped_decoration_id, p.avatar_url,
           row_number() over (order by
             case when v_since is null then p.xp
                  else coalesce((select sum(greatest(l.delta,0)) from public.xp_ledger l where l.user_id = p.id and l.created_at >= v_since), 0)
             end desc, p.id) as rank
    from public.profiles p
    where p.status = 'active'
      and (
        p_scope = 'overall'
        or (p_scope = 'branch' and p.branch_id = nullif(p_filter,'')::uuid)
        or (p_scope = 'friends' and (
              p.id = auth.uid()
              or exists (select 1 from public.friendships f where (f.user_a = auth.uid() and f.user_b = p.id) or (f.user_b = auth.uid() and f.user_a = p.id))
            ))
      )
    order by points desc
    limit p_limit;
end;
$$;

grant execute on function public.get_leaderboard_v2(text, text, text, integer) to authenticated, anon;
