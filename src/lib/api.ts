import { supabase, uploadChatMediaWithProgress } from './supabaseClient'
import type { Tables } from './database.types'
import { diagLog } from './diagnostics'

// =============================================================================
// CareerXP data access layer. Every mutation with anti-cheat or economy
// implications goes through a SECURITY DEFINER RPC (see the Supabase
// migrations) — nothing here writes xp/score/points directly to a table.
// =============================================================================

export type Game = Tables<'games'>
export type Achievement = Tables<'achievements'>
export type Announcement = Tables<'announcements'>
export type CosmeticItem = Tables<'cosmetic_items'>
export type PublicProfile = {
  id: string
  username: string
  display_name: string | null
  level: number
  xp: number
  streak_count: number
  weekly_streak_count: number
  equipped_frame_id: string | null
  equipped_banner_id: string | null
  equipped_title_id: string | null
  equipped_decoration_id: string | null
  avatar_url: string | null
  header_url: string | null
  is_online: boolean
  created_at: string
  bio: string | null
  branch_id: string | null
  branch_name: string | null
  branch_name_ar: string | null
}

export type PublicAchievement = {
  achievement_id: string
  unlocked_at: string
  name: string
  name_ar: string
  icon: string
  color: string
  rarity: string
  category: string
}

export type Profile = Tables<'profiles'>

/**
 * Built-in avatar presets — a gradient + icon combo identified by a
 * `builtin:<id>` string stored directly in profiles.avatar_url. No Storage
 * upload involved; the <Avatar> component recognizes the prefix and renders
 * the matching preset. Uploaded photos are stored as real Storage URLs and
 * are told apart from these simply by not starting with "builtin:".
 */
export const BUILTIN_AVATARS = [
  { id: 'aurora',  gradient: 'linear-gradient(135deg, #7c3aed, #00d4ff)' },
  { id: 'ember',   gradient: 'linear-gradient(135deg, #ff6b35, #ffd700)' },
  { id: 'rose',    gradient: 'linear-gradient(135deg, #ff4785, #7c3aed)' },
  { id: 'emerald', gradient: 'linear-gradient(135deg, #00e676, #00d4ff)' },
  { id: 'violet',  gradient: 'linear-gradient(135deg, #9d6fff, #5b21b6)' },
  { id: 'sunset',  gradient: 'linear-gradient(135deg, #f59e0b, #ff4785)' },
  { id: 'ocean',   gradient: 'linear-gradient(135deg, #00d4ff, #5b21b6)' },
  { id: 'gold',    gradient: 'linear-gradient(135deg, #ffd700, #ff6b35)' },
] as const
export type BuiltinAvatarId = typeof BUILTIN_AVATARS[number]['id']

export type Branch = Tables<'branches'>

/**
 * Branch options shown at registration and in the profile editor — a real,
 * owner-managed lookup table (see migration dynamic_branch_management)
 * rather than a hardcoded list, so CareerXP can grow to more branches/
 * administrations later without a frontend change: the owner adds/edits/
 * reorders/retires branches from the Branch Management admin screen (see
 * adminApi.ts), and every device picks the change up on next load — no
 * app update required.
 *
 * Each row carries a permanent, human-readable `code` (e.g.
 * 'evaluation_branch') alongside the uuid `id` used as the actual FK from
 * profiles.branch_id — `code` is immutable once created (only name_en/
 * name_ar are owner-editable), for anywhere a stable identifier is more
 * useful than the uuid (logs, config, future integrations).
 *
 * This is called from the registration screen *before* the user has an
 * authenticated session — the `branches_select_active` RLS policy grants
 * anon + authenticated SELECT on active branches for exactly this reason
 * (a second policy, `branches_select_owner_all`, additionally lets the
 * owner see inactive branches too, for Branch Management). Do not
 * tighten `branches_select_active` to authenticated-only without also
 * moving this call to run after sign-in, or the registration dropdown
 * will silently go empty again (zero rows, not an error).
 *
 * Returns `{ error, data }` rather than swallowing failures into an empty
 * array — the registration screen needs to tell "the request failed, show
 * Retry" apart from "the request succeeded and there are genuinely zero
 * active branches, block signup and show an admin-contact message".
 * Collapsing both into `[]` (the old behavior) made that distinction
 * impossible and is exactly what made the original empty-dropdown bug
 * silent instead of loud.
 */
export async function getBranches(): Promise<{ error: string | null; data: Branch[] }> {
  const { data, error } = await supabase.from('branches').select('*').eq('is_active', true).order('sort_order')
  if (error) { logErr('getBranches', error); return { error: error.message, data: [] } }
  return { error: null, data: data ?? [] }
}

function logErr(scope: string, error: unknown) {
  // eslint-disable-next-line no-console
  console.error(`[careerxp:${scope}]`, error)
}

// ---------------------------------------------------------------------------
// Games catalog
// ---------------------------------------------------------------------------
export async function getGames(): Promise<Game[]> {
  const { data, error } = await supabase.from('games').select('*').order('sort_order')
  if (error) { logErr('getGames', error); return [] }
  return data ?? []
}

/** A single game's catalog row (name/tagline/color), for screens that only know a gameId. */
export async function getGameById(gameId: string): Promise<Pick<Game, 'name' | 'name_ar' | 'accent_color' | 'base_xp'> | null> {
  const { data, error } = await supabase.from('games').select('name, name_ar, accent_color, base_xp').eq('id', gameId).maybeSingle()
  if (error) { logErr('getGameById', error); return null }
  return data
}

/** This player's hearted games, for the new image-first Games page. Own-row-only RLS (user_favorite_games_own). */
export async function getFavoriteGameIds(userId: string): Promise<string[]> {
  const { data, error } = await supabase.from('user_favorite_games').select('game_id').eq('user_id', userId)
  if (error) { logErr('getFavoriteGameIds', error); return [] }
  return (data ?? []).map((r) => r.game_id)
}

export async function toggleFavoriteGame(userId: string, gameId: string, favorite: boolean): Promise<{ error: string | null }> {
  if (favorite) {
    const { error } = await supabase.from('user_favorite_games').upsert({ user_id: userId, game_id: gameId })
    if (error) { logErr('toggleFavoriteGame:add', error); return { error: error.message } }
    return { error: null }
  }
  const { error } = await supabase.from('user_favorite_games').delete().eq('user_id', userId).eq('game_id', gameId)
  if (error) { logErr('toggleFavoriteGame:remove', error); return { error: error.message } }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Gameplay (anti-cheat: server validates everything)
// ---------------------------------------------------------------------------
export async function startGameSession(gameId: string, context: 'practice' | 'challenge' | 'tournament' = 'practice', contextRefId?: string) {
  const { data, error } = await supabase.rpc('start_game_session', { p_game_id: gameId, p_context: context, p_context_ref_id: contextRefId ?? undefined })
  if (error) { logErr('startGameSession', error); return null }
  return data as string // session id
}

export async function getGameQuestions(gameId: string) {
  const { data, error } = await supabase.rpc('get_game_questions', { p_game_id: gameId })
  if (error) { logErr('getGameQuestions', error); return [] }
  return data ?? []
}

export async function submitAnswer(sessionId: string, questionId: string, selectedOption: number, timeTakenMs: number) {
  const { data, error } = await supabase.rpc('submit_answer', {
    p_session_id: sessionId, p_question_id: questionId, p_selected_option: selectedOption, p_time_taken_ms: timeTakenMs,
  })
  if (error) { logErr('submitAnswer', error); return null }
  return (data as any[] | null)?.[0] ?? null
}

export async function completeGameSession(sessionId: string, moves?: number, timeLeftSeconds?: number) {
  const { data, error } = await supabase.rpc('complete_game_session', {
    p_session_id: sessionId, p_moves: moves, p_time_left_seconds: timeLeftSeconds,
  })
  if (error) { logErr('completeGameSession', error); return null }
  return (data as any[] | null)?.[0] ?? null
}

// ---------------------------------------------------------------------------
// Daily reward
// ---------------------------------------------------------------------------
export async function claimDailyReward() {
  const { data, error } = await supabase.rpc('claim_daily_reward')
  if (error) return { error: error.message }
  return { data: (data as any[] | null)?.[0] ?? null, error: null }
}

// ---------------------------------------------------------------------------
// Power hour / global events
// ---------------------------------------------------------------------------
export async function getActivePowerHour() {
  const { data, error } = await supabase
    .from('global_events')
    .select('*')
    .eq('type', 'power_hour')
    .eq('is_active', true)
    .lte('starts_at', new Date().toISOString())
    .gte('ends_at', new Date().toISOString())
    .maybeSingle()
  if (error) { logErr('getActivePowerHour', error); return null }
  return data
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------
export async function getAchievementsWithStatus(userId: string) {
  const [{ data: all, error: e1 }, { data: mine, error: e2 }] = await Promise.all([
    supabase.from('achievements').select('*').order('sort_order'),
    supabase.from('user_achievements').select('achievement_id, unlocked_at').eq('user_id', userId),
  ])
  if (e1) logErr('getAchievements', e1)
  if (e2) logErr('getUserAchievements', e2)
  const unlockedMap = new Map((mine ?? []).map((m) => [m.achievement_id, m.unlocked_at]))
  return (all ?? []).map((a) => ({ ...a, unlocked: unlockedMap.has(a.id), unlockedAt: unlockedMap.get(a.id) ?? null }))
}

export async function getRecentAchievements(userId: string, limit = 3) {
  const { data, error } = await supabase
    .from('user_achievements')
    .select('unlocked_at, achievements(*)')
    .eq('user_id', userId)
    .order('unlocked_at', { ascending: false })
    .limit(limit)
  if (error) { logErr('getRecentAchievements', error); return [] }
  return data ?? []
}

// ---------------------------------------------------------------------------
// Profile stats / activity
// ---------------------------------------------------------------------------
export async function getProfileStats(userId: string) {
  const [sessions, achievements, friendCount] = await Promise.all([
    supabase.from('game_sessions').select('id, score, xp_awarded, status').eq('user_id', userId).eq('status', 'completed'),
    supabase.from('user_achievements').select('achievement_id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('friendships').select('id', { count: 'exact', head: true }).or(`user_a.eq.${userId},user_b.eq.${userId}`),
  ])
  const gamesPlayed = sessions.data?.length ?? 0
  const avgScore = gamesPlayed ? Math.round((sessions.data!.reduce((s, r) => s + (r.score ?? 0), 0) / gamesPlayed)) : 0
  const wins = sessions.data?.filter((s) => (s.score ?? 0) > 0).length ?? 0
  return {
    gamesPlayed,
    avgScore,
    wins,
    badgeCount: achievements.count ?? 0,
    friendCount: friendCount.count ?? 0,
  }
}

/**
 * The user's most-played game by completed session count, with real totals —
 * replaces what used to be a hardcoded placeholder. Returns null (render
 * nothing) rather than a fabricated game for players who haven't completed
 * a session yet.
 */
export async function getFavoriteGame(userId: string) {
  const { data, error } = await supabase
    .from('game_sessions')
    .select('game_id, xp_awarded')
    .eq('user_id', userId)
    .eq('status', 'completed')
  if (error) { logErr('getFavoriteGame', error); return null }
  if (!data || data.length === 0) return null

  const byGame = new Map<string, { sessions: number; xp: number }>()
  for (const row of data) {
    if (!row.game_id) continue
    const cur = byGame.get(row.game_id) ?? { sessions: 0, xp: 0 }
    cur.sessions += 1
    cur.xp += row.xp_awarded ?? 0
    byGame.set(row.game_id, cur)
  }
  if (byGame.size === 0) return null

  const [topGameId, agg] = [...byGame.entries()].sort((a, b) => b[1].sessions - a[1].sessions)[0]
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .select('name, name_ar, accent_color')
    .eq('id', topGameId)
    .maybeSingle()
  if (gameErr || !game) { if (gameErr) logErr('getFavoriteGame:game', gameErr); return null }

  return { en: game.name, ar: game.name_ar, xp: agg.xp, sessions: agg.sessions, color: game.accent_color }
}

/**
 * Per-game statistics — one row per (user, game) automatically populated by
 * private.record_game_played()/record_game_result() every time any game
 * (solo, multiplayer, tournament, challenge) is completed. New games get
 * this for free the moment they call those two functions — no per-game
 * frontend or backend special-casing needed.
 */
export type GameStat = Tables<'user_game_stats'> & {
  game: Pick<Game, 'id' | 'name' | 'name_ar' | 'icon_key' | 'accent_color' | 'category'> | null
}

export async function getGameStats(userId: string): Promise<GameStat[]> {
  const { data, error } = await supabase
    .from('user_game_stats')
    .select('*, game:games(id, name, name_ar, icon_key, accent_color, category)')
    .eq('user_id', userId)
    .order('last_played_at', { ascending: false })
  if (error) { logErr('getGameStats', error); return [] }
  return (data ?? []) as unknown as GameStat[]
}

export async function getActivityLog(userId: string, limit = 10) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .or(`user_id.eq.${userId},is_global.eq.true`)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { logErr('getActivityLog', error); return [] }
  return data ?? []
}

export async function getGlobalActivity(limit = 12) {
  const { data, error } = await supabase
    .from('activity_log')
    .select('*')
    .eq('is_global', true)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { logErr('getGlobalActivity', error); return [] }
  return data ?? []
}

/** This-week aggregate progress, used to back the "Weekly Goals" widget with real numbers. */
export async function getWeeklyGoalsProgress(userId: string) {
  const since = new Date()
  since.setDate(since.getDate() - since.getDay())
  since.setHours(0, 0, 0, 0)

  const [{ data: sessions }, { data: responses }] = await Promise.all([
    supabase.from('game_sessions').select('id').eq('user_id', userId).eq('status', 'completed').gte('started_at', since.toISOString()),
    supabase
      .from('question_responses')
      .select('is_correct, game_sessions!inner(user_id, started_at)')
      .eq('game_sessions.user_id', userId)
      .gte('game_sessions.started_at', since.toISOString()),
  ])

  const gamesThisWeek = sessions?.length ?? 0
  const correctThisWeek = (responses ?? []).filter((r) => r.is_correct).length

  return { gamesThisWeek, correctThisWeek }
}

// ---------------------------------------------------------------------------
// Cosmetics — profile equip slots (frame / banner / nameplate / avatar
// decoration). "owned" includes both purchased items and free "default"
// starter items; equip itself is validated server-side by the
// private.guard_cosmetic_equip() trigger, so a client can never equip
// something it doesn't actually own.
// ---------------------------------------------------------------------------
export async function getCosmetics(userId: string) {
  const [{ data: all, error: e1 }, { data: mine, error: e2 }] = await Promise.all([
    supabase.from('cosmetic_items').select('*').order('sort_order'),
    supabase.from('user_cosmetic_unlocks').select('item_id').eq('user_id', userId),
  ])
  if (e1) logErr('getCosmetics', e1)
  if (e2) logErr('getUserCosmetics', e2)
  const owned = new Set((mine ?? []).map((m) => m.item_id))
  const items = (all ?? []).map((c) => ({ ...c, owned: owned.has(c.id) || (c.unlock_criteria as any)?.type === 'default' }))
  return {
    frames: items.filter((c) => c.type === 'frame'),
    banners: items.filter((c) => c.type === 'banner'),
    titles: items.filter((c) => c.type === 'title'),
    decorations: items.filter((c) => c.type === 'avatar_decoration'),
  }
}

export type EquipSlot = 'frame' | 'banner' | 'title' | 'decoration'

const EQUIP_COLUMN: Record<EquipSlot, string> = {
  frame: 'equipped_frame_id',
  banner: 'equipped_banner_id',
  title: 'equipped_title_id',
  decoration: 'equipped_decoration_id',
}

export async function equipCosmetic(kind: EquipSlot, itemId: string | null) {
  const field = EQUIP_COLUMN[kind]
  const { error } = await supabase.from('profiles').update({ [field]: itemId } as any).eq('id', (await supabase.auth.getUser()).data.user?.id ?? '')
  if (error) return { error: error.message }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Cosmetics Shop — Coins-only, cosmetic items exclusively. Nothing sold here
// is ever exchangeable for real-world value, and purchasing never touches
// xp/level/rank/achievements — purchase_cosmetic_item() only grants
// ownership of a display item and spends Coins via the same anti-cheat-safe
// ledger primitive every other coin award/spend uses.
// ---------------------------------------------------------------------------
export type ShopItem = CosmeticItem & { owned: boolean; equipped: boolean; lockedSeasonal: boolean }

const EQUIP_FIELD_BY_TYPE: Record<string, string> = {
  frame: 'equipped_frame_id',
  banner: 'equipped_banner_id',
  title: 'equipped_title_id',
  avatar_decoration: 'equipped_decoration_id',
}

export async function getShopCatalog(userId: string): Promise<ShopItem[]> {
  const [{ data: all, error: e1 }, { data: mine, error: e2 }, { data: profile, error: e3 }] = await Promise.all([
    supabase.from('cosmetic_items').select('*').not('price_coins', 'is', null).order('sort_order'),
    supabase.from('user_cosmetic_unlocks').select('item_id').eq('user_id', userId),
    supabase.from('profiles').select('equipped_frame_id, equipped_banner_id, equipped_title_id, equipped_decoration_id').eq('id', userId).single(),
  ])
  if (e1) logErr('getShopCatalog', e1)
  if (e2) logErr('getShopOwned', e2)
  if (e3) logErr('getShopProfile', e3)
  const owned = new Set((mine ?? []).map((m) => m.item_id))
  const now = Date.now()
  return (all ?? []).map((c) => {
    const equipField = EQUIP_FIELD_BY_TYPE[c.type]
    const equipped = !!equipField && !!profile && (profile as any)[equipField] === c.id
    const lockedSeasonal = !!(
      (c.seasonal_start && now < new Date(c.seasonal_start).getTime()) ||
      (c.seasonal_end && now > new Date(c.seasonal_end).getTime())
    )
    return { ...c, owned: owned.has(c.id), equipped, lockedSeasonal }
  })
}

export async function purchaseCosmeticItem(itemId: string) {
  const { data, error } = await supabase.rpc('purchase_cosmetic_item', { p_item_id: itemId })
  if (error) return { error: error.message, data: null }
  return { error: null, data: (data as any[] | null)?.[0] ?? null }
}

export async function getWeeklyCoinsEarned(userId: string): Promise<number> {
  const since = new Date()
  since.setDate(since.getDate() - since.getDay())
  since.setHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('coin_ledger')
    .select('delta')
    .eq('user_id', userId)
    .gt('delta', 0)
    .gte('created_at', since.toISOString())
  if (error) { logErr('getWeeklyCoinsEarned', error); return 0 }
  return (data ?? []).reduce((sum, r) => sum + (r.delta ?? 0), 0)
}

// ---------------------------------------------------------------------------
// XP Engine — level curve + history. private.xp_to_level() on the server
// uses the same formula (500 xp/level, linear); mirrored here so the UI can
// compute progress without a round-trip. Keep these two in sync if the
// curve ever changes (single source of truth: migration comment on
// private.xp_to_level).
// ---------------------------------------------------------------------------
const XP_PER_LEVEL = 500

export function xpForLevel(level: number): number {
  return Math.max(0, level - 1) * XP_PER_LEVEL
}

export function levelProgress(xp: number) {
  const level = Math.max(1, Math.floor(xp / XP_PER_LEVEL) + 1)
  const xpIntoLevel = xp - xpForLevel(level)
  const xpForNext = XP_PER_LEVEL
  return { level, xpIntoLevel, xpForNext, pct: Math.min(1, xpIntoLevel / xpForNext) }
}

export type XpLedgerEntry = Tables<'xp_ledger'>

/** Full XP audit trail for the "XP History" view — every award and its reason. */
export async function getXpHistory(userId: string, limit = 50): Promise<XpLedgerEntry[]> {
  const { data, error } = await supabase
    .from('xp_ledger')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { logErr('getXpHistory', error); return [] }
  return data ?? []
}

/** Real XP earned since the start of this week (Sun 00:00 local), from the xp_ledger audit trail. */
export async function getWeeklyXpEarned(userId: string): Promise<number> {
  const since = new Date()
  since.setDate(since.getDate() - since.getDay())
  since.setHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('xp_ledger')
    .select('delta')
    .eq('user_id', userId)
    .gt('delta', 0)
    .gte('created_at', since.toISOString())
  if (error) { logErr('getWeeklyXpEarned', error); return 0 }
  return (data ?? []).reduce((sum, r) => sum + (r.delta ?? 0), 0)
}

// ---------------------------------------------------------------------------
// Leaderboard
// ---------------------------------------------------------------------------
export async function getLeaderboard(period: 'weekly' | 'monthly' | 'quarterly' | 'yearly' = 'weekly', limit = 50) {
  const { data, error } = await supabase.rpc('get_leaderboard', { p_period: period, p_limit: limit })
  if (error) { logErr('getLeaderboard', error); return [] }
  return data ?? []
}

export type LeaderboardScope = 'overall' | 'branch' | 'game' | 'friends' | 'season'

/**
 * Multi-dimension leaderboard. `filter` is scope-dependent: branch_id for
 * 'branch', game_id for 'game', season_id for 'season' (omit for the
 * currently active season). Ignored for 'overall'/'friends'.
 */
export async function getLeaderboardV2(
  scope: LeaderboardScope,
  period: 'weekly' | 'monthly' | 'quarterly' | 'yearly' | 'all' = 'weekly',
  filter?: string | null,
  limit = 50
) {
  const { data, error } = await supabase.rpc('get_leaderboard_v2', {
    p_scope: scope, p_period: period, p_filter: filter ?? undefined, p_limit: limit,
  })
  if (error) { logErr('getLeaderboardV2', error); return [] }
  // get_leaderboard_v2 has always returned avatar_url (see the DB migration
  // that added it to get_public_profiles/get_leaderboard) — it just wasn't
  // declared in this cast, so it was silently dropped before ever reaching
  // LeaderboardScreen, which is why uploaded avatars rendered everywhere
  // except the leaderboard. equipped_banner_id/equipped_title_id/
  // equipped_decoration_id are the same story for cosmetics — the RPC now
  // returns them (see cosmetics_propagate_equipped_to_public_rpcs
  // migration), they just weren't declared here.
  return (data as { rank: number; user_id: string; username: string; points: number; level: number; streak_count: number; equipped_frame_id: string | null; equipped_banner_id: string | null; equipped_title_id: string | null; equipped_decoration_id: string | null; avatar_url: string | null }[] | null) ?? []
}

// ---------------------------------------------------------------------------
// Season pass
// ---------------------------------------------------------------------------
export async function getActiveSeason() {
  const { data, error } = await supabase.from('seasons').select('*').eq('is_active', true).maybeSingle()
  if (error) { logErr('getActiveSeason', error); return null }
  return data
}

/** Every past season, most recently ended first — for the "Previous Seasons" archive view. */
export async function getPreviousSeasons() {
  const { data, error } = await supabase.from('seasons').select('*').eq('is_active', false).order('ends_at', { ascending: false })
  if (error) { logErr('getPreviousSeasons', error); return [] }
  return data ?? []
}

export async function getSeasonTrack(seasonId: string, userId: string) {
  const [{ data: nodes, error: e1 }, { data: progress, error: e2 }, { data: claims, error: e3 }] = await Promise.all([
    supabase.from('season_pass_nodes').select('*').eq('season_id', seasonId).order('level'),
    supabase.from('user_season_progress').select('*').eq('season_id', seasonId).eq('user_id', userId).maybeSingle(),
    supabase.from('user_season_claims').select('node_id').eq('user_id', userId),
  ])
  if (e1) logErr('getSeasonNodes', e1)
  if (e2) logErr('getSeasonProgress', e2)
  if (e3) logErr('getSeasonClaims', e3)
  const claimedSet = new Set((claims ?? []).map((c) => c.node_id))
  const currentLevel = progress?.current_level ?? 1
  return {
    nodes: (nodes ?? []).map((n) => ({
      ...n,
      claimed: claimedSet.has(n.id),
      current: n.level === currentLevel && !claimedSet.has(n.id),
      locked: n.level > currentLevel,
    })),
    progress: progress ?? { current_level: 1, season_xp: 0 },
  }
}

export async function claimSeasonReward(nodeId: string) {
  const { data, error } = await supabase.rpc('claim_season_reward', { p_node_id: nodeId })
  if (error) return { error: error.message }
  return { error: null, data: (data as any[] | null)?.[0] ?? null }
}

// ---------------------------------------------------------------------------
// Tournament
// ---------------------------------------------------------------------------
export async function getActiveTournament() {
  const { data, error } = await supabase
    .from('tournaments')
    .select('*, tournament_prizes(*)')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) { logErr('getActiveTournament', error); return null }
  return data
}

export async function getTournamentBracket(tournamentId: string) {
  const { data, error } = await supabase
    .from('tournament_rounds')
    .select('*, tournament_matches(*)')
    .eq('tournament_id', tournamentId)
    .order('round_order')
  if (error) { logErr('getTournamentBracket', error); return [] }
  return data ?? []
}

export async function getMyTournamentRegistration(tournamentId: string, userId: string) {
  const { data, error } = await supabase
    .from('tournament_participants')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) { logErr('getMyTournamentRegistration', error); return null }
  return data
}

export async function registerForTournament(tournamentId: string) {
  const { data, error } = await supabase.rpc('register_for_tournament', { p_tournament_id: tournamentId })
  if (error) return { error: error.message }
  return { error: null, id: data as string }
}

// ---------------------------------------------------------------------------
// Challenges — one generic system covering daily/weekly/monthly/seasonal
// cadences (public.challenges.period_type). Adding a new cadence is a data
// change (insert a challenges row with a new period_type), never a schema
// or frontend change.
// ---------------------------------------------------------------------------
export type ChallengePeriod = 'daily' | 'weekly' | 'monthly' | 'seasonal'

export async function getCurrentChallenge(periodType: ChallengePeriod) {
  const nowIso = new Date().toISOString()
  const { data, error } = await supabase
    .from('challenges')
    .select('*, challenge_prizes(*)')
    .eq('period_type', periodType)
    .lte('starts_at', nowIso)
    .gte('ends_at', nowIso)
    .order('starts_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) { logErr('getCurrentChallenge', error); return null }
  return data
}

export async function getChallengeParticipants(challengeId: string, limit = 20) {
  const { data, error } = await supabase
    .from('challenge_participants')
    .select('*, profiles(username, level, avatar_url)')
    .eq('challenge_id', challengeId)
    .order('score', { ascending: false })
    .limit(limit)
  if (error) { logErr('getChallengeParticipants', error); return [] }
  return (data as unknown as (Tables<'challenge_participants'> & {
    profiles: { username: string; level: number; avatar_url: string | null } | null
  })[]) ?? []
}

export async function getMyChallengeParticipation(challengeId: string, userId: string) {
  const { data, error } = await supabase
    .from('challenge_participants')
    .select('*')
    .eq('challenge_id', challengeId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) { logErr('getMyChallengeParticipation', error); return null }
  return data
}

export async function joinChallenge(challengeId: string) {
  const { data, error } = await supabase.rpc('join_challenge', { p_challenge_id: challengeId })
  if (error) return { error: error.message }
  return { error: null, id: data as string }
}

// ---------------------------------------------------------------------------
// Friends
// ---------------------------------------------------------------------------
export async function getFriends(userId: string) {
  const { data, error } = await supabase.from('friendships').select('user_a, user_b').or(`user_a.eq.${userId},user_b.eq.${userId}`)
  if (error) { logErr('getFriends', error); return [] }
  const otherIds = (data ?? []).map((f) => (f.user_a === userId ? f.user_b : f.user_a))
  if (!otherIds.length) return []
  const { data: profiles, error: e2 } = await supabase.rpc('get_public_profiles', { p_ids: otherIds })
  if (e2) { logErr('getFriendsProfiles', e2); return [] }
  return (profiles as PublicProfile[] | null) ?? []
}

export async function getIncomingFriendRequests(userId: string) {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('id, requester_id, created_at')
    .eq('recipient_id', userId)
    .eq('status', 'pending')
  if (error) { logErr('getIncomingFriendRequests', error); return [] }
  if (!data?.length) return []
  const { data: profiles } = await supabase.rpc('get_public_profiles', { p_ids: data.map((r) => r.requester_id) })
  const map = new Map((profiles as PublicProfile[] | null ?? []).map((p) => [p.id, p]))
  return data.map((r) => ({ ...r, profile: map.get(r.requester_id) }))
}

/** Full profile card for the Friends → "view profile" screen — level, streaks, branch, bio. */
export async function getPublicProfile(userId: string): Promise<PublicProfile | null> {
  const { data, error } = await supabase.rpc('get_public_profiles', { p_ids: [userId] })
  if (error) { logErr('getPublicProfile', error); return null }
  return (data as PublicProfile[] | null)?.[0] ?? null
}

/** Batch profile lookup keyed by id — used to enrich lists (e.g. the Chats tab, which only gets other_user_id back from get_my_conversations). */
export async function getPublicProfilesMap(userIds: string[]): Promise<Map<string, PublicProfile>> {
  if (!userIds.length) return new Map()
  const { data, error } = await supabase.rpc('get_public_profiles', { p_ids: userIds })
  if (error) { logErr('getPublicProfilesMap', error); return new Map() }
  return new Map((data as PublicProfile[] | null ?? []).map((p) => [p.id, p]))
}

/** A user's unlocked badges, newest first — used alongside getPublicProfile() for the friend profile view. */
export async function getUserPublicAchievements(userId: string): Promise<PublicAchievement[]> {
  const { data, error } = await supabase.rpc('get_user_public_achievements', { p_user_id: userId })
  if (error) { logErr('getUserPublicAchievements', error); return [] }
  return (data as PublicAchievement[] | null) ?? []
}

// profiles RLS only allows a row's owner to SELECT it directly (profiles_select_self_or_owner),
// so both discovery paths below go through search_profiles_for_friends() — a SECURITY DEFINER
// RPC exposing just id/username/level/avatar_url for any authenticated employee, same "public
// within CareerXP" model as get_public_profiles(). A direct `.from('profiles')` query here would
// silently return zero rows for anyone but the current user.
export async function searchUsers(query: string, excludeIds: string[]) {
  if (!query.trim()) return []
  const { data, error } = await supabase.rpc('search_profiles_for_friends', { p_query: query, p_exclude_ids: excludeIds, p_limit: 10 })
  if (error) { logErr('searchUsers', error); return [] }
  return (data as { id: string; username: string; level: number; avatar_url: string | null }[] | null) ?? []
}

/** "People you may know" — a small unfiltered sample of other employees, for the Discover tab's default state. */
export async function getSuggestedUsers(excludeIds: string[], limit = 5) {
  const { data, error } = await supabase.rpc('search_profiles_for_friends', { p_query: null, p_exclude_ids: excludeIds, p_limit: limit })
  if (error) { logErr('getSuggestedUsers', error); return [] }
  return (data as { id: string; username: string; level: number; avatar_url: string | null }[] | null) ?? []
}

export async function sendFriendRequest(recipientId: string) {
  const { error } = await supabase.rpc('send_friend_request', { p_recipient_id: recipientId })
  return { error: error?.message ?? null }
}

export async function respondFriendRequest(requestId: string, accept: boolean) {
  const { error } = await supabase.rpc('respond_friend_request', { p_request_id: requestId, p_accept: accept })
  return { error: error?.message ?? null }
}

export async function removeFriend(otherUserId: string) {
  const { error } = await supabase.rpc('remove_friend', { p_other_user_id: otherUserId })
  return { error: error?.message ?? null }
}

/** The requests *I* sent that are still pending — the missing half of the Requests tab (incoming vs sent). */
export async function getSentFriendRequests(userId: string) {
  const { data, error } = await supabase
    .from('friend_requests')
    .select('id, recipient_id, created_at')
    .eq('requester_id', userId)
    .eq('status', 'pending')
  if (error) { logErr('getSentFriendRequests', error); return [] }
  if (!data?.length) return []
  const { data: profiles } = await supabase.rpc('get_public_profiles', { p_ids: data.map((r) => r.recipient_id) })
  const map = new Map((profiles as PublicProfile[] | null ?? []).map((p) => [p.id, p]))
  return data.map((r) => ({ ...r, profile: map.get(r.recipient_id) }))
}

export async function cancelFriendRequest(requestId: string) {
  const { error } = await supabase.rpc('cancel_friend_request', { p_request_id: requestId })
  return { error: error?.message ?? null }
}

// ---------------------------------------------------------------------------
// Blocking & reporting
// ---------------------------------------------------------------------------
export async function blockUser(blockedId: string) {
  const { error } = await supabase.rpc('block_user', { p_blocked_id: blockedId })
  return { error: error?.message ?? null }
}

export async function unblockUser(blockedId: string) {
  const { error } = await supabase.rpc('unblock_user', { p_blocked_id: blockedId })
  return { error: error?.message ?? null }
}

export async function getBlockedUsers(userId: string) {
  const { data, error } = await supabase.from('blocks').select('blocked_id, created_at').eq('blocker_id', userId)
  if (error) { logErr('getBlockedUsers', error); return [] }
  if (!data?.length) return []
  const { data: profiles } = await supabase.rpc('get_public_profiles', { p_ids: data.map((r) => r.blocked_id) })
  const map = new Map((profiles as PublicProfile[] | null ?? []).map((p) => [p.id, p]))
  return data.map((r) => ({ ...r, profile: map.get(r.blocked_id) }))
}

/** Am I blocked by, or have I blocked, this user? Used to gate the Message/Invite actions on a friend card. */
export async function getBlockStatus(otherUserId: string, myUserId: string) {
  const { data, error } = await supabase
    .from('blocks')
    .select('blocker_id, blocked_id')
    .or(`and(blocker_id.eq.${myUserId},blocked_id.eq.${otherUserId}),and(blocker_id.eq.${otherUserId},blocked_id.eq.${myUserId})`)
  if (error) { logErr('getBlockStatus', error); return { blockedByMe: false, blockedMe: false } }
  const rows = data ?? []
  return {
    blockedByMe: rows.some((r) => r.blocker_id === myUserId),
    blockedMe: rows.some((r) => r.blocker_id === otherUserId),
  }
}

export async function reportUser(reportedUserId: string, conversationId: string | null, reason: string) {
  const { error } = await supabase.rpc('report_user', { p_reported_user_id: reportedUserId, p_conversation_id: conversationId, p_reason: reason })
  return { error: error?.message ?? null }
}

// ---------------------------------------------------------------------------
// Presence — is_online/last_seen_at are heartbeat-maintained (touchPresence,
// called periodically while the app is foregrounded); "away" itself is never
// persisted, it's derived client-side from idle time + a Realtime Presence
// channel. is_in_game is server-derived from live room membership, so it
// can't be spoofed by a client claiming a status it isn't in.
// ---------------------------------------------------------------------------
export type FriendPresence = { id: string; is_online: boolean; last_seen_at: string | null; is_in_game: boolean; game_name: string | null; game_name_ar: string | null }

export async function touchPresence() {
  await supabase.rpc('touch_presence')
}

export async function markOffline() {
  await supabase.rpc('mark_offline')
}

export async function getPresence(userIds: string[]): Promise<FriendPresence[]> {
  if (!userIds.length) return []
  const { data, error } = await supabase.rpc('get_presence', { p_ids: userIds })
  if (error) { logErr('getPresence', error); return [] }
  return (data as FriendPresence[] | null) ?? []
}

// ---------------------------------------------------------------------------
// Private 1:1 chat — ephemeral by design. See migrations for the full
// read/leave/delete lifecycle; the client only ever calls these RPCs, it
// never deletes or marks-read by writing to `messages` directly.
// ---------------------------------------------------------------------------
export type ChatMessage = Tables<'messages'>
/** Per-conversation disappearing-message setting — see set_conversation_disappearing_mode's migration comment for exact semantics of each mode. 'read_leave' is the default and matches the app's original (pre-this-feature) hardcoded behavior exactly. */
export type DisappearingMode = 'keep_forever' | 'delete_24h' | 'read_leave'
export type ConversationSummary = {
  conversation_id: string
  other_user_id: string
  last_message_body: string | null
  last_message_at: string | null
  last_message_from_me: boolean
  last_message_saved: boolean
  unread_count: number
  other_is_viewing: boolean
  disappearing_mode: DisappearingMode
  last_message_type: string | null
}

/** Gets (or lazily creates) the single conversation between me and a confirmed friend — never duplicated, and reused as-is for in-game chat. */
export async function getOrCreateConversation(otherUserId: string): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('get_or_create_conversation', { p_other_user_id: otherUserId })
  return { id: (data as string) ?? null, error: error?.message ?? null }
}

export async function getMyConversations(): Promise<ConversationSummary[]> {
  const { data, error } = await supabase.rpc('get_my_conversations')
  if (error) { logErr('getMyConversations', error); return [] }
  return (data as ConversationSummary[] | null) ?? []
}

/**
 * Drives the Chats-tab inbox + nav badge live: any message/read/leave
 * activity touching one of my conversations.
 *
 * `tag` MUST be unique per independent call site — this is called from
 * both App.tsx (the nav badge) and FriendsScreen (the Chats tab)
 * simultaneously whenever the Friends screen is open, and two channels
 * built from the same topic string collide (see subscribeToNewNotifications'
 * doc comment for the full explanation of why that throws and crashes the
 * app). Wrapped in try/catch for the same reason: a realtime failure here
 * must degrade to "badge/list just doesn't live-update" rather than
 * crashing anything that called it.
 */
export function subscribeToMyConversations(userId: string, onChange: () => void, tag = 'default') {
  try {
    const channel = supabase
      .channel(`my-conversations:${userId}:${tag}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_participants', filter: `user_id=eq.${userId}` }, onChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversations' }, onChange)
      .subscribe()
    return () => {
      try { supabase.removeChannel(channel) } catch (err) { logErr('subscribeToMyConversations:cleanup', err) }
    }
  } catch (err) {
    logErr('subscribeToMyConversations:init', err)
    return () => {}
  }
}

/** Live message stream for one open conversation — INSERT for new messages, DELETE for the disappearing-message sweep (both the interactive leave and the pg_cron stale-viewer sweep fire real DELETEs the client must react to). */
export function subscribeToConversation(conversationId: string, onInsert: (m: ChatMessage) => void, onDelete: (id: string) => void, onUpdate?: (m: ChatMessage) => void) {
  const channel = supabase
    .channel(`conversation:${conversationId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => onInsert(payload.new as ChatMessage))
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => onDelete((payload.old as { id: string }).id))
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'messages', filter: `conversation_id=eq.${conversationId}` }, (payload) => onUpdate?.(payload.new as ChatMessage))
    .subscribe()
  return () => supabase.removeChannel(channel)
}

/** Typing indicator — ephemeral Realtime Broadcast, never touches Postgres. */
export function subscribeToTyping(conversationId: string, myUserId: string, onTyping: (fromUserId: string) => void) {
  const channel = supabase.channel(`typing:${conversationId}`)
  channel.on('broadcast', { event: 'typing' }, (payload) => {
    const fromUserId = payload.payload?.userId as string | undefined
    if (fromUserId && fromUserId !== myUserId) onTyping(fromUserId)
  }).subscribe()
  return {
    sendTyping: () => channel.send({ type: 'broadcast', event: 'typing', payload: { userId: myUserId } }),
    unsubscribe: () => supabase.removeChannel(channel),
  }
}

export async function getMessages(conversationId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
  if (error) { logErr('getMessages', error); return [] }
  return data ?? []
}

/**
 * `clientMessageId` is a client-generated uuid — sending the same one twice
 * (e.g. a retried request after a dropped ack) returns the original message
 * instead of creating a duplicate.
 *
 * Root-caused bug: on mobile Safari/WKWebView, a fetch that's in-flight
 * when the tab is backgrounded (app switched away, screen locked, etc.)
 * can be suspended by the OS and never resolve OR reject — the returned
 * promise just hangs forever. Without a hard cap, `await sendMessage(...)`
 * in the caller never returns, `sending` never gets released, and every
 * subsequent tap of Send does nothing because the double-submit guard
 * (`if (sending) return`) silently blocks it — this exactly matches
 * "pressing Send does nothing, typed message stays in the input." Fixed
 * with an explicit AbortController timeout: after 15s with no response,
 * the request is aborted client-side and this returns a clear timeout
 * error instead of hanging indefinitely.
 *
 * Also logs the exact request payload and the raw Supabase
 * response/error (not a summarized version) for debugging — required so
 * a real failure's exact cause is visible instead of guessed at.
 */
export async function sendMessage(conversationId: string, body: string, clientMessageId: string, timeoutMs = 15000) {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs)
  const requestPayload = { p_conversation_id: conversationId, p_body: body, p_client_message_id: clientMessageId }
  // eslint-disable-next-line no-console
  console.debug('[careerxp:sendMessage] request', requestPayload)
  try {
    const { data, error } = await supabase
      .rpc('send_message', requestPayload)
      .abortSignal(controller.signal)
    // eslint-disable-next-line no-console
    console.debug('[careerxp:sendMessage] response', { data, error })
    if (error) {
      logErr('sendMessage', error)
      return { id: null, error: error.message }
    }
    return { id: (data as string) ?? null, error: null }
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError'
    const message = aborted
      ? `Request timed out after ${Math.round(timeoutMs / 1000)}s (connection may have been suspended in the background)`
      : err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error('[careerxp:sendMessage] threw', { aborted, err })
    return { id: null, error: message }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

/** Marks visible messages read and flags me as actively viewing — call on mount. */
export async function openConversation(conversationId: string) {
  const { error } = await supabase.rpc('open_conversation', { p_conversation_id: conversationId })
  return { error: error?.message ?? null }
}

/** Keeps my "still viewing" flag alive — call every ~10s while the chat screen is open. */
export async function heartbeatConversation(conversationId: string) {
  await supabase.rpc('heartbeat_conversation', { p_conversation_id: conversationId })
}

/** Call on unmount/back/close — triggers the permanent server-side deletion of everything I've already read (only actually deletes anything when the conversation's mode is 'read_leave' — see set_conversation_disappearing_mode). */
export async function leaveConversation(conversationId: string) {
  const { error } = await supabase.rpc('leave_conversation', { p_conversation_id: conversationId })
  return { error: error?.message ?? null }
}

/** Reads a single conversation's current disappearing-message mode — RLS already lets either participant SELECT the conversations row directly, same as getMessages does for messages, so no RPC round trip is needed just to read it. */
export async function getConversationDisappearingMode(conversationId: string): Promise<DisappearingMode | null> {
  const { data, error } = await supabase.from('conversations').select('disappearing_mode').eq('id', conversationId).maybeSingle()
  if (error) { logErr('getConversationDisappearingMode', error); return null }
  return (data?.disappearing_mode as DisappearingMode | undefined) ?? null
}

/** Sets this conversation's disappearing-message mode — Keep Forever / Delete After 24 Hours / Delete After Read + Leave, exactly like Snapchat's per-conversation setting. Either participant may change it; it applies to the whole shared conversation, not per-user. */
export async function setConversationDisappearingMode(conversationId: string, mode: DisappearingMode) {
  const { error } = await supabase.rpc('set_conversation_disappearing_mode', { p_conversation_id: conversationId, p_mode: mode })
  return { error: error?.message ?? null }
}

/** Save/unsave a message so it survives the ephemeral read-then-delete cleanup. Either participant may call this on any message in their shared conversation; the RPC re-checks membership server-side. */
export async function toggleSaveMessage(messageId: string, save: boolean): Promise<{ message: ChatMessage | null; error: string | null }> {
  const { data, error } = await supabase.rpc('toggle_save_message', { p_message_id: messageId, p_save: save })
  if (error) { logErr('toggleSaveMessage', error); return { message: null, error: error.message } }
  return { message: (data as ChatMessage) ?? null, error: null }
}

/** Debounced draft-text persistence so a half-typed message survives closing the chat panel (in-game especially). */
export async function saveDraft(conversationId: string, userId: string, text: string) {
  const { error } = await supabase.from('conversation_participants').update({ draft_text: text || null }).eq('conversation_id', conversationId).eq('user_id', userId)
  if (error) logErr('saveDraft', error)
}

export async function getDraft(conversationId: string, userId: string): Promise<string> {
  const { data, error } = await supabase.from('conversation_participants').select('draft_text').eq('conversation_id', conversationId).eq('user_id', userId).maybeSingle()
  if (error) { logErr('getDraft', error); return '' }
  return data?.draft_text ?? ''
}

// ---------------------------------------------------------------------------
// Chat media (voice/image/video attachments) — separate from the plain-text
// send path above (sendMessage/send_message) on purpose: that RPC is
// working production code and is never touched by any of this. Media lives
// in the private 'chat-media' storage bucket (RLS-gated to the two
// conversation participants, see the chat_media_storage_bucket_and_rls
// migration), never a public bucket like every other bucket in this app.
// ---------------------------------------------------------------------------
export type ChatAttachmentType = 'image' | 'video' | 'voice'

export const CHAT_MEDIA_MAX_BYTES: Record<ChatAttachmentType, number> = {
  image: 8 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  voice: 10 * 1024 * 1024,
}

// Canonical (post-normalization) mime types only — the client always
// normalizes before validating/uploading (see normalizeMediaMime), and the
// send_media_message RPC + the chat-media bucket's own allowed_mime_types
// both independently re-check against this exact same set server-side, so
// all three layers agree. Do not add codec-suffixed variants here; add them
// to normalizeMediaMime's stripping logic instead so every layer benefits.
const MEDIA_ALLOWED_MIME: Record<ChatAttachmentType, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  voice: ['audio/webm', 'audio/mp4', 'audio/m4a', 'audio/aac', 'audio/mpeg', 'audio/ogg'],
}

/**
 * Real-world MediaRecorder output is never as clean as `audio/webm` —
 * Chrome/Android report `audio/webm;codecs=opus`, some browsers report it
 * with a space (`audio/webm; codecs=opus`), and mixed casing shows up too.
 * A plain `===`/`.includes()` check against a fixed list rejects all of
 * these, which was the actual root cause of "Unsupported file type:
 * audio/webm; codecs=opus" on mobile — the recording itself was fine, only
 * the string comparison was too strict.
 *
 * This strips everything from the first `;` onward (codec/profile
 * parameters), trims whitespace, lowercases, and folds a couple of known
 * device aliases onto their canonical form — used identically by
 * validateChatMedia, the actual upload (the Blob is re-wrapped with this
 * normalized type before it's sent, so the real Content-Type Storage sees
 * always matches the bucket's plain allowlist too), and mirrored in SQL
 * inside send_media_message so the server never trusts the client's word
 * for it.
 */
export function normalizeMediaMime(raw: string): string {
  const base = (raw || '').split(';')[0].trim().toLowerCase()
  if (base === 'audio/x-m4a' || base === 'audio/mp4a-latm') return 'audio/m4a'
  return base
}

/** File extension derived from the normalized mime — never trust the original filename/mime string directly, since "audio/webm;codecs=opus" or an unexpected alias could otherwise produce a nonsensical or unsafe extension. Falls back to a sane per-type default if the normalized mime isn't one we recognize. */
export function chatMediaExtension(type: ChatAttachmentType, mime: string): string {
  const normalized = normalizeMediaMime(mime)
  const byMime: Record<string, string> = {
    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
    'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
    'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/aac': 'aac', 'audio/mpeg': 'mp3', 'audio/ogg': 'ogg',
  }
  return byMime[normalized] ?? (type === 'image' ? 'jpg' : type === 'video' ? 'mp4' : 'webm')
}

export type ChatMediaValidationError = 'unsupported_type' | 'empty' | 'too_large'

/**
 * Client-side pre-flight validation — a real defense-in-depth layer
 * alongside the bucket's own size/mime allowlist and the
 * send_media_message RPC's server-side checks, not a replacement for
 * either; it just gives an instant, specific error before spending any
 * upload bandwidth.
 *
 * Returns an error *code*, not a message — this file has no access to the
 * app's EN/AR language state (that lives in the component), and showing the
 * raw mime string straight to the user is neither friendly nor
 * translatable. Callers map the code to a localized, non-technical string
 * (see ChatConversation.tsx's mediaErrorMessage).
 */
export function validateChatMedia(type: ChatAttachmentType, mime: string, sizeBytes: number): ChatMediaValidationError | null {
  const normalized = normalizeMediaMime(mime)
  if (!MEDIA_ALLOWED_MIME[type].includes(normalized)) return 'unsupported_type'
  if (sizeBytes <= 0) return 'empty'
  if (sizeBytes > CHAT_MEDIA_MAX_BYTES[type]) return 'too_large'
  return null
}

/** Builds the storage object path for a new upload — "{conversationId}/{senderId}/{uuid}.{ext}", matching the folder convention every chat_media_* RLS policy on storage.objects relies on. */
export function buildChatMediaPath(conversationId: string, senderId: string, ext: string): string {
  const uuid = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${conversationId}/${senderId}/${uuid}.${ext}`
}

/** Uploads a chat attachment with real progress + cancellation (see uploadChatMediaWithProgress's doc comment for why this bypasses the storage-js client's own upload()). Returns the object path on success — pass it straight into sendMediaMessage. */
export function uploadChatMedia(path: string, file: Blob, onProgress?: (fraction: number) => void) {
  return uploadChatMediaWithProgress(path, file, onProgress)
}

/** Records a media message after its upload has completed. Mirrors sendMessage's idempotency contract (retrying with the same clientMessageId returns the original message instead of duplicating it) and the same conversation-membership/blocked checks — see send_media_message's definition. */
export async function sendMediaMessage(params: {
  conversationId: string
  messageType: ChatAttachmentType
  mediaPath: string
  mediaMime: string
  mediaSizeBytes: number
  clientMessageId: string
  caption?: string
  durationSeconds?: number
  width?: number
  height?: number
  thumbPath?: string
}): Promise<{ id: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('send_media_message', {
    p_conversation_id: params.conversationId,
    p_message_type: params.messageType,
    p_media_path: params.mediaPath,
    p_media_mime: params.mediaMime,
    p_media_size_bytes: params.mediaSizeBytes,
    p_client_message_id: params.clientMessageId,
    p_caption: params.caption || null,
    p_media_duration_seconds: params.durationSeconds ?? null,
    p_media_width: params.width ?? null,
    p_media_height: params.height ?? null,
    p_media_thumb_path: params.thumbPath ?? null,
  })
  if (error) { logErr('sendMediaMessage', error); return { id: null, error: error.message } }
  return { id: (data as string) ?? null, error: null }
}

// Short-lived in-memory cache so re-rendering the same bubble/preview many
// times (scroll, re-render, half-swipe re-open) doesn't re-request a signed
// URL every time; entries are simply dropped and re-fetched once expired.
const mediaUrlCache = new Map<string, { url: string; expiresAt: number }>()

/** Private bucket, so playback/viewing needs a signed URL (getPublicUrl() would 400 — the bucket has public=false), scoped to the requesting user by the same chat_media_select RLS policy that already gates who can even generate one. */
export async function getChatMediaUrl(path: string, expiresInSeconds = 3600): Promise<string | null> {
  const cached = mediaUrlCache.get(path)
  if (cached && cached.expiresAt > Date.now() + 30_000) return cached.url
  const { data, error } = await supabase.storage.from('chat-media').createSignedUrl(path, expiresInSeconds)
  if (error || !data) { logErr('getChatMediaUrl', error); return null }
  mediaUrlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + expiresInSeconds * 1000 })
  return data.signedUrl
}

// ---------------------------------------------------------------------------
// Notifications — a typed, per-user inbox. `type` distinguishes the kind
// (friend_request / friend_accept / badge_unlocked / level_up /
// weekly_challenge / tournament / admin_announcement / ...); `data` carries
// whatever ref ids that kind needs. All writes happen server-side via
// private.notify()/notify_all_active() — the client only ever reads its own
// rows and marks them read.
// ---------------------------------------------------------------------------
export type Notification = Tables<'notifications'>

export async function getNotifications(userId: string, limit = 30) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { logErr('getNotifications', error); return [] }
  return data ?? []
}

export async function getUnreadNotificationCount(userId: string) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false)
  if (error) { logErr('getUnreadNotificationCount', error); return 0 }
  return count ?? 0
}

export async function markNotificationRead(id: string) {
  const { error } = await supabase.rpc('mark_notification_read', { p_id: id })
  return { error: error?.message ?? null }
}

export async function markAllNotificationsRead() {
  const { error } = await supabase.rpc('mark_all_notifications_read')
  return { error: error?.message ?? null }
}

/** Live-updates the bell the instant a new notification lands, no polling. */
export function subscribeToNotifications(userId: string, onChange: () => void) {
  const channel = supabase
    .channel(`notifications:${userId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

/**
 * Fires with the freshly-inserted row itself — used to pop celebratory
 * overlays (level-up / badge-unlock) and the chat message toast the
 * instant they happen, on whatever screen the player is on.
 *
 * `tag` MUST be unique per independent call site. Realtime channel topics
 * are global per socket connection — two channels created with the exact
 * same topic string (e.g. two components both calling this with no tag,
 * both resolving to `notifications-insert:${userId}`) collide: the second
 * `.channel(sameTopic)` call receives a channel that's already mid-
 * subscribe from the first caller, and calling `.on('postgres_changes', ...)`
 * on it throws "tried to add postgres_changes callbacks after subscribe()"
 * — which then propagates as an uncaught error up through whichever
 * component happened to call it second, crashing the whole app if nothing
 * catches it. This is exactly what happened when a second consumer
 * (ChatToastHost) started calling this function with the same default
 * topic AchievementOverlayHost was already using. Every call site now
 * passes a distinct tag so each gets its own channel.
 *
 * The whole body is wrapped in try/catch so a realtime failure (network
 * down, socket not ready, etc.) can never throw synchronously into a
 * caller's render/effect — it degrades to "no live notifications" rather
 * than crashing the app, and returns a safe no-op unsubscribe either way.
 */
export function subscribeToNewNotifications(userId: string, onInsert: (n: Notification) => void, tag = 'default') {
  try {
    const channel = supabase
      .channel(`notifications-insert:${userId}:${tag}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` }, (payload) => {
        onInsert(payload.new as Notification)
      })
      .subscribe()
    return () => {
      try { supabase.removeChannel(channel) } catch (err) { logErr('subscribeToNewNotifications:cleanup', err) }
    }
  } catch (err) {
    logErr('subscribeToNewNotifications:init', err)
    return () => {}
  }
}

// ---------------------------------------------------------------------------
// Push notifications (Web Push / VAPID) — the client only ever registers or
// removes its own subscription; the actual send happens server-side (the
// send-push Edge Function, woken by send_message() via pg_net). See
// src/lib/push.ts for the browser-side subscribe/unsubscribe flow.
// ---------------------------------------------------------------------------
export async function registerPushSubscription(endpoint: string, p256dh: string, auth: string, userAgent?: string) {
  const { error } = await supabase.rpc('register_push_subscription', { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_user_agent: userAgent ?? null })
  return { error: error?.message ?? null }
}

export async function unregisterPushSubscription(endpoint: string) {
  const { error } = await supabase.rpc('unregister_push_subscription', { p_endpoint: endpoint })
  return { error: error?.message ?? null }
}

/** Whether the server has *any* push subscription on file for me (Web Push or native) — used to render the toggle's initial state before the (slower, permission-gated) local platform check resolves. */
export async function hasPushSubscription(): Promise<boolean> {
  const { data, error } = await supabase.rpc('has_push_subscription')
  if (error) { logErr('hasPushSubscription', error); return false }
  return !!data
}

// ---------------------------------------------------------------------------
// Native push (FCM, Capacitor-wrapped iOS/Android builds only) — parallel to
// the Web Push pair above. See src/lib/nativePush.ts for the
// PushNotifications.register()-driven client flow that calls these.
// ---------------------------------------------------------------------------
export async function registerNativePushToken(platform: 'ios' | 'android', token: string) {
  const { error } = await supabase.rpc('register_native_push_token', { p_platform: platform, p_token: token })
  return { error: error?.message ?? null }
}

export async function unregisterNativePushToken(token: string) {
  const { error } = await supabase.rpc('unregister_native_push_token', { p_token: token })
  return { error: error?.message ?? null }
}

// ---------------------------------------------------------------------------
// Realtime multiplayer lobby (legacy, single-shared-room-per-game model) —
// still used by WorkGameScreen/GameLobbyScreen's "Safety Protocol" quiz.
// The underlying tables were renamed to match_rooms/match_room_players
// (migration 036) for the new Phase 4 match engine below; these RPCs were
// updated in migration 046 to point at the renamed tables/columns while
// keeping their original names/signatures, so only the direct `.from()`
// queries here needed touching up.
// ---------------------------------------------------------------------------
export async function getOrCreateLobby(gameId: string) {
  const { data, error } = await supabase.rpc('get_or_create_lobby', { p_game_id: gameId })
  if (error) { logErr('getOrCreateLobby', error); return null }
  return data as string
}

export async function setLobbyReady(lobbyId: string, ready: boolean) {
  const { data, error } = await supabase.rpc('set_lobby_ready', { p_lobby_id: lobbyId, p_ready: ready })
  if (error) { logErr('setLobbyReady', error); return null }
  return (data as any[] | null)?.[0] ?? null
}

export async function leaveLobby(lobbyId: string) {
  // .then(undefined, ...) instead of .catch(...) — the postgrest builder
  // is only PromiseLike (exposes .then), not a full Promise.
  await supabase.rpc('leave_lobby', { p_lobby_id: lobbyId }).then(undefined, () => {})
}

export async function getLobbyPlayers(lobbyId: string) {
  const { data, error } = await supabase.from('match_room_players').select('*').eq('room_id', lobbyId)
  if (error) { logErr('getLobbyPlayers', error); return [] }
  if (!data.length) return []
  const { data: profiles } = await supabase.rpc('get_public_profiles', { p_ids: data.map((p) => p.user_id) })
  const map = new Map((profiles as PublicProfile[] | null ?? []).map((p) => [p.id, p]))
  return data.map((p) => ({ ...p, profile: map.get(p.user_id) }))
}

export function subscribeToLobby(lobbyId: string, onChange: () => void) {
  const channel = supabase
    .channel(`lobby:${lobbyId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_room_players', filter: `room_id=eq.${lobbyId}` }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_rooms', filter: `id=eq.${lobbyId}` }, onChange)
    .subscribe()
  return () => supabase.removeChannel(channel)
}

// ---------------------------------------------------------------------------
// Phase 4 match engine — reusable room/round system shared by every
// multiplayer game (Emoji Decode, Color Blitz, and future titles). A room
// (`match_rooms`) always has a `mode`: 'solo' | 'private' | 'matchmaking'.
// Round content/timing is fully server-authoritative (private.generate_round);
// correct answers live in match_round_secrets, which has RLS enabled with
// zero policies — no client role can ever read it directly.
// ---------------------------------------------------------------------------
export type MatchRoom = Tables<'match_rooms'>
export type MatchRoomPlayer = Tables<'match_room_players'>
export type MatchRound = Tables<'match_rounds'>
export type MatchRoundAnswer = Tables<'match_round_answers'>

/** Solo practice: an instant, single-player room. First round is generated immediately. */
export async function startSoloPractice(gameId: string) {
  const { data, error } = await supabase.rpc('start_solo_practice', { p_game_id: gameId })
  if (error) { logErr('startSoloPractice', error); return null }
  return data as string // room id
}

/** Creates a private room with a shareable join code. Returns null on failure. */
export async function createPrivateRoom(gameId: string, maxPlayers = 8) {
  const { data, error } = await supabase.rpc('create_private_room', { p_game_id: gameId, p_max_players: maxPlayers })
  if (error) { logErr('createPrivateRoom', error); diagLog('match-room', 'create_private_room FAILED', { gameId, error: error.message, code: error.code }); return null }
  const row = (data as any[] | null)?.[0] as { room_id: string; join_code: string } | undefined
  diagLog('match-room', 'create_private_room ok', { gameId, roomId: row?.room_id, joinCode: row?.join_code })
  return row ?? null
}

export async function joinRoomByCode(joinCode: string) {
  diagLog('match-room', 'join_room_by_code →', { joinCode })
  const { data, error } = await supabase.rpc('join_room_by_code', { p_join_code: joinCode })
  if (error) { diagLog('match-room', 'join_room_by_code FAILED', { joinCode, error: error.message, code: error.code }); return { error: error.message, roomId: null } }
  diagLog('match-room', 'join_room_by_code ok', { joinCode, roomId: data })
  return { error: null, roomId: data as string }
}

/** Finds (or opens) an open matchmaking room for this game/capacity. */
export async function joinMatchmaking(gameId: string, maxPlayers = 8) {
  const { data, error } = await supabase.rpc('join_matchmaking', { p_game_id: gameId, p_max_players: maxPlayers })
  if (error) { logErr('joinMatchmaking', error); diagLog('match-room', 'join_matchmaking FAILED', { gameId, error: error.message }); return null }
  diagLog('match-room', 'join_matchmaking ok', { gameId, roomId: data })
  return data as string // room id
}

export async function leaveRoom(roomId: string) {
  await supabase.rpc('leave_room', { p_room_id: roomId }).then(undefined, () => {})
}

/** Keeps my presence "fresh" while I'm actually in a quick-game match (Emoji Decode/Color Blitz) — call every ~20s while the game screen is mounted and visible. Without this, get_presence() treats the room as stale after 90s and stops showing "Playing X" for me, which is intentional: a lapsed heartbeat is exactly how staleness is detected server-side. */
export async function heartbeatMatchRoom(roomId: string) {
  await supabase.rpc('heartbeat_match_room', { p_room_id: roomId }).then(undefined, () => {})
}

/** Immediately marks every match/board-game room I'm currently in as left — called on sign-out so "Playing X" clears right away instead of waiting for the ~90s staleness sweep. */
export async function clearMyGamePresence() {
  await supabase.rpc('clear_my_game_presence').then(undefined, () => {})
}

/** Marks the caller ready; once every player in the room is ready, the room starts and round 1 is generated server-side. */
export async function setRoomReady(roomId: string, ready: boolean) {
  diagLog('match-room', 'set_room_ready →', { roomId, ready })
  const { data, error } = await supabase.rpc('set_room_ready', { p_room_id: roomId, p_ready: ready })
  if (error) { logErr('setRoomReady', error); diagLog('match-room', 'set_room_ready FAILED', { roomId, ready, error: error.message, code: error.code }); return null }
  const row = ((data as any[] | null)?.[0] as { all_ready: boolean; started: boolean } | undefined) ?? null
  diagLog('match-room', 'set_room_ready ok', { roomId, ready, result: row })
  return row
}

/**
 * Returns { room, error } rather than throwing/swallowing — a failed fetch
 * (e.g. an RLS/permission error) must be visibly distinguishable from "this
 * room genuinely doesn't exist", otherwise the lobby silently renders as
 * empty with no players and no way to tell a real bug from a fresh room.
 * See useMatchEngine.ts's `fetchError` state, which is what actually
 * surfaces this to the player.
 */
export async function getMatchRoom(roomId: string): Promise<{ room: MatchRoom | null; error: string | null }> {
  const { data, error } = await supabase.from('match_rooms').select('*').eq('id', roomId).maybeSingle()
  if (error) { logErr('getMatchRoom', error); diagLog('match-room', 'getMatchRoom FAILED', { roomId, error: error.message, code: error.code }); return { room: null, error: error.message } }
  return { room: data, error: null }
}

/** Same error-visibility contract as getMatchRoom — see its comment. */
export async function getRoomPlayers(roomId: string): Promise<{ players: (MatchRoomPlayer & { profile?: PublicProfile })[]; error: string | null }> {
  const { data, error } = await supabase.from('match_room_players').select('*').eq('room_id', roomId).is('left_at', null)
  if (error) { logErr('getRoomPlayers', error); diagLog('match-room', 'getRoomPlayers FAILED', { roomId, error: error.message, code: error.code }); return { players: [], error: error.message } }
  diagLog('match-room', 'getRoomPlayers ok', {
    roomId, playerCount: data.length, readyCount: data.filter((p) => p.is_ready).length,
    playerRowIds: data.map((p) => p.id), userIds: data.map((p) => p.user_id),
  })
  if (!data.length) return { players: [], error: null }
  const { data: profiles, error: profErr } = await supabase.rpc('get_public_profiles', { p_ids: data.map((p) => p.user_id) })
  if (profErr) diagLog('match-room', 'getRoomPlayers get_public_profiles FAILED (players still returned, unenriched)', { roomId, error: profErr.message })
  const map = new Map((profiles as PublicProfile[] | null ?? []).map((p) => [p.id, p]))
  return { players: data.map((p) => ({ ...p, profile: map.get(p.user_id) })), error: null }
}

/** The current (latest) round for a room — payload has no secret fields, safe to render directly. */
export async function getCurrentRound(roomId: string): Promise<MatchRound | null> {
  const { data, error } = await supabase
    .from('match_rounds')
    .select('*')
    .eq('room_id', roomId)
    .order('round_number', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) { logErr('getCurrentRound', error); return null }
  return data
}

/** Submits the player's answer/tap for the current round. Timing + correctness are validated entirely server-side. */
export async function submitRoundAnswer(roomId: string, roundId: string, answer: Record<string, unknown>) {
  const { data, error } = await supabase.rpc('submit_round_answer', { p_room_id: roomId, p_round_id: roundId, p_answer: answer })
  if (error) return { error: error.message, data: null }
  return { error: null, data: ((data as any[] | null)?.[0] as { is_correct: boolean; points_awarded: number } | undefined) ?? null }
}

/** Called once a round's timer has actually elapsed — generates the next round, or finalizes the match if it was the last one. Idempotent. */
export async function advanceRoom(roomId: string) {
  const { error } = await supabase.rpc('advance_room', { p_room_id: roomId })
  if (error) logErr('advanceRoom', error)
}

/** Per-player breakdown for a round that has ended — who answered what, how fast, and the correct answer. Only resolves once the round's ends_at has passed. */
export async function getRoundReveal(roundId: string) {
  const { data, error } = await supabase.rpc('get_round_reveal', { p_round_id: roundId })
  if (error) { logErr('getRoundReveal', error); return [] }
  return (data as any[] | null) ?? []
}

/** Live-updates the room/round/players the instant anything changes — new rounds appearing, players joining/leaving, ready-state flips, room status transitions. */
export function subscribeToRoom(roomId: string, onChange: () => void) {
  diagLog('match-room-realtime', 'subscribing', { roomId })
  const channel = supabase
    .channel(`room:${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_rooms', filter: `id=eq.${roomId}` }, (payload) => {
      diagLog('match-room-realtime', 'match_rooms change', { roomId, eventType: payload.eventType })
      onChange()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_room_players', filter: `room_id=eq.${roomId}` }, (payload) => {
      diagLog('match-room-realtime', 'match_room_players change', { roomId, eventType: payload.eventType })
      onChange()
    })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'match_rounds', filter: `room_id=eq.${roomId}` }, (payload) => {
      diagLog('match-room-realtime', 'match_rounds change', { roomId, eventType: payload.eventType })
      onChange()
    })
    .subscribe((status, err) => {
      diagLog('match-room-realtime', `channel status: ${status}`, { roomId, error: err ? String(err) : undefined })
    })
  return () => { diagLog('match-room-realtime', 'unsubscribing', { roomId }); supabase.removeChannel(channel) }
}

// ---------------------------------------------------------------------------
// Coins — a separate, spendable-only currency. Never affects xp/level.
// Every award/spend is server-authoritative via private.apply_coin_delta;
// the client only ever reads profiles.coins and the coin_ledger history.
// ---------------------------------------------------------------------------
export type CoinLedgerEntry = Tables<'coin_ledger'>

/** Full coin transaction history for the "Coin History" view. */
export async function getCoinHistory(limit = 50): Promise<CoinLedgerEntry[]> {
  const { data, error } = await supabase.rpc('get_coin_history', { p_limit: limit })
  if (error) { logErr('getCoinHistory', error); return [] }
  return (data as CoinLedgerEntry[] | null) ?? []
}

/** The coin delta a specific match awarded the caller — reads the single ledger row written by private.apply_coin_delta at finalize_match time. */
export async function getMyCoinDeltaForRoom(roomId: string, userId: string): Promise<number> {
  const { data, error } = await supabase
    .from('coin_ledger')
    .select('delta')
    .eq('source', 'multiplayer_match')
    .eq('ref_id', roomId)
    .eq('user_id', userId)
    .maybeSingle()
  if (error) { logErr('getMyCoinDeltaForRoom', error); return 0 }
  return data?.delta ?? 0
}

export type MatchResultRow = MatchRoomPlayer & {
  profile?: { id: string; username: string; avatar_url: string | null; level: number }
  xp_awarded: number
}

/** Final standings for a completed (or in-progress) room, joined with public profiles and each player's xp_awarded — everything the results screen needs in one call. */
export async function getMatchResults(roomId: string): Promise<{ room: MatchRoom | null; results: MatchResultRow[] }> {
  const [{ room }, { players }] = await Promise.all([getMatchRoom(roomId), getRoomPlayers(roomId)])
  if (!players.length) return { room, results: [] }
  const sessionIds = players.map((p) => p.session_id).filter((s): s is string => !!s)
  const { data: sessions } = sessionIds.length
    ? await supabase.from('game_sessions').select('id, xp_awarded').in('id', sessionIds)
    : { data: [] as { id: string; xp_awarded: number }[] }
  const xpMap = new Map((sessions ?? []).map((s) => [s.id, s.xp_awarded]))
  const results: MatchResultRow[] = players
    .map((p) => ({ ...p, xp_awarded: p.session_id ? xpMap.get(p.session_id) ?? 0 : 0 }))
    .sort((a, b) => (a.final_rank ?? 999) - (b.final_rank ?? 999) || b.final_score - a.final_score)
  return { room, results }
}

// ---------------------------------------------------------------------------
// Profile editing — bio/branch_id/avatar_url/header_url/display_name are NOT
// among the fields the profiles_guard_privileged trigger clamps (only
// role/xp/level/status/login_count/access_code_id/username/custom_title/
// custom_title_ar/coins are), so a direct self-row update is enough and
// already permitted by RLS (profiles_update_self_or_owner). Username goes
// through the update_username RPC instead, since it IS clamped and requires
// the server-side length/uniqueness rules — display_name has no uniqueness
// requirement (by design, multiple users may share one), so it needs no
// equivalent RPC; the DB-side `profiles_display_name_length` check
// constraint (<=40 chars) is the only server-side guard it needs.
// ---------------------------------------------------------------------------
export async function updateProfile(
  userId: string,
  patch: Partial<Pick<Profile, 'bio' | 'branch_id' | 'avatar_url' | 'header_url' | 'display_name'>>
) {
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId)
  return { error: error?.message ?? null }
}

export async function updateUsername(newUsername: string) {
  const { data, error } = await supabase.rpc('update_username', { p_new_username: newUsername })
  if (error) return { error: error.message, data: null }
  return { error: null, data }
}

/**
 * Uploads a cropped avatar image (expects a square PNG/JPEG blob, already
 * cropped client-side) to the public `avatars` Storage bucket under the
 * user's own folder, and returns its permanent public URL. Storage RLS only
 * allows a user to write inside `{their own id}/...`, so this must always
 * be called with the caller's own userId.
 */
export async function uploadAvatar(userId: string, blob: Blob): Promise<{ url: string | null; error: string | null }> {
  const path = `${userId}/avatar-${Date.now()}.png`
  const { error: uploadError } = await supabase.storage.from('avatars').upload(path, blob, {
    contentType: 'image/png',
    upsert: true,
  })
  if (uploadError) return { url: null, error: uploadError.message }
  const { data } = supabase.storage.from('avatars').getPublicUrl(path)
  return { url: data.publicUrl, error: null }
}

/**
 * Uploads a cropped + compressed cover/header image (a single JPEG blob,
 * already cropped and re-encoded client-side by HeaderPickerModal) to the
 * public `profile-headers` Storage bucket. Unlike uploadAvatar's timestamped
 * filenames, this always writes to the SAME fixed path per user
 * (`{userId}/header.jpg`, upsert: true) — replacing a header overwrites the
 * previous file in place instead of leaving it behind as orphaned storage,
 * satisfying "replacing a header must delete or overwrite the previous
 * file" without needing a separate list+delete round trip. Because the path
 * never changes, a `?v=<timestamp>` cache-busting query string is appended
 * to the returned URL so the new image is what actually gets displayed
 * (and re-fetched by other users) instead of a stale cached copy at the
 * same URL. Storage RLS only allows writing inside `{their own id}/...`,
 * so this must always be called with the caller's own userId.
 */
export async function uploadHeader(userId: string, blob: Blob): Promise<{ url: string | null; error: string | null }> {
  const path = `${userId}/header.jpg`
  const { error: uploadError } = await supabase.storage.from('profile-headers').upload(path, blob, {
    contentType: 'image/jpeg',
    upsert: true,
  })
  if (uploadError) return { url: null, error: uploadError.message }
  const { data } = supabase.storage.from('profile-headers').getPublicUrl(path)
  return { url: `${data.publicUrl}?v=${Date.now()}`, error: null }
}

/** Deletes the caller's header file from Storage (if any) and clears profiles.header_url. Safe to call even if no header was ever uploaded. */
export async function removeHeader(userId: string): Promise<{ error: string | null }> {
  const { error: removeError } = await supabase.storage.from('profile-headers').remove([`${userId}/header.jpg`])
  if (removeError) logErr('removeHeader (storage)', removeError)
  const { error } = await updateProfile(userId, { header_url: null })
  return { error }
}

// ---------------------------------------------------------------------------
// Board games — shared online-room infrastructure reused by every board
// game (Ludo now; UNO/Chess/Checkers/Connect 4/Backgammon later). Mirrors
// the Phase 4 match-engine pattern above: rooms/players/state/moves tables,
// SECURITY DEFINER RPCs for every write, Realtime for live sync. Moves are
// client-authoritative (each game's own rules engine computes the new
// state/move payloads); these functions only move opaque JSON blobs in and
// out of the shared tables plus handle optimistic concurrency.
// ---------------------------------------------------------------------------
export type BoardGameRoom = Tables<'board_game_rooms'>
export type BoardGamePlayer = Tables<'board_game_players'>
export type BoardGameStateRow = Tables<'board_game_state'>
export type BoardGameMove = Tables<'board_game_moves'>
export type BoardGameSpectator = Tables<'board_game_spectators'>

/** Creates a new room for a board game. Private rooms get a shareable join code; public rooms are discoverable via getPublicBoardGameRooms/quickMatchBoardGame. Caller is auto-seated at seat 0. */
export async function createBoardGameRoom(
  gameId: string,
  maxPlayers = 4,
  allowSpectators = true,
  isPrivate = false
): Promise<BoardGameRoom | null> {
  const { data, error } = await supabase.rpc('create_board_game_room', {
    p_game_id: gameId,
    p_max_players: maxPlayers,
    p_allow_spectators: allowSpectators,
    p_private: isPrivate,
  })
  if (error) { logErr('createBoardGameRoom', error); return null }
  return ((Array.isArray(data) ? data[0] : data) as BoardGameRoom | undefined) ?? null
}

/** Joins an open seat, or reconnects to the caller's existing seat if they were already in it (works even mid-game). */
export async function joinBoardGameRoom(roomId: string) {
  const { data, error } = await supabase.rpc('join_board_game_room', { p_room_id: roomId })
  if (error) { diagLog('board-game-room', 'join_board_game_room FAILED', { roomId, error: error.message, code: error.code }); return { error: error.message, player: null } }
  const player = ((Array.isArray(data) ? data[0] : data) as BoardGamePlayer | undefined) ?? null
  diagLog('board-game-room', 'join_board_game_room ok', { roomId, playerId: player?.id })
  return { error: null, player }
}

/** Joins a private room by its shareable invite code. */
export async function joinBoardGameRoomByCode(joinCode: string) {
  const { data, error } = await supabase.rpc('join_board_game_room_by_code', { p_join_code: joinCode })
  if (error) return { error: error.message, player: null }
  return { error: null, player: ((Array.isArray(data) ? data[0] : data) as BoardGamePlayer | undefined) ?? null }
}

export async function setBoardGameReady(roomId: string, ready: boolean) {
  diagLog('board-game-room', 'set_board_game_ready →', { roomId, ready })
  const { error } = await supabase.rpc('set_board_game_ready', { p_room_id: roomId, p_ready: ready })
  if (error) diagLog('board-game-room', 'set_board_game_ready FAILED', { roomId, ready, error: error.message, code: error.code })
  else diagLog('board-game-room', 'set_board_game_ready ok', { roomId, ready })
  return { error: error?.message ?? null }
}

/** Host-only: starts the match once enough seats are filled. */
export async function startBoardGameRoom(roomId: string) {
  const { data, error } = await supabase.rpc('start_board_game_room', { p_room_id: roomId })
  if (error) return { error: error.message, room: null }
  return { error: null, room: ((Array.isArray(data) ? data[0] : data) as BoardGameRoom | undefined) ?? null }
}

export async function getBoardGameRoom(roomId: string): Promise<BoardGameRoom | null> {
  const { data, error } = await supabase.from('board_game_rooms').select('*').eq('id', roomId).maybeSingle()
  if (error) { logErr('getBoardGameRoom', error); return null }
  return data
}

/**
 * `includeLeft`: pass true once a match is underway — seat assignments must
 * stay stable for the engine's `seats[seatIndex]` lookups even after someone
 * leaves (they become a "disconnected" seat, not a vacated one). Lobby
 * screens (pre-game) should leave this false so departed players vanish
 * from the ready-up list.
 */
export async function getBoardGamePlayers(roomId: string, includeLeft = false) {
  let query = supabase.from('board_game_players').select('*').eq('room_id', roomId)
  if (!includeLeft) query = query.is('left_at', null)
  const { data, error } = await query.order('seat_index')
  if (error) { logErr('getBoardGamePlayers', error); return [] }
  if (!data.length) return []
  const humanIds = data.filter((p) => !p.is_ai && p.user_id).map((p) => p.user_id as string)
  const map = new Map<string, { id: string; username: string; avatar_url: string | null; level: number }>()
  if (humanIds.length) {
    const { data: profiles } = await supabase.rpc('get_public_profiles', { p_ids: humanIds })
    for (const p of (profiles as { id: string; username: string; avatar_url: string | null; level: number }[] | null) ?? []) map.set(p.id, p)
  }
  return data.map((p) => ({ ...p, profile: p.user_id ? map.get(p.user_id) : undefined }))
}

/** The room's current authoritative state blob + optimistic-concurrency version. Each game's own controller decodes `state` per its own TState shape. */
export async function getBoardGameState(roomId: string): Promise<BoardGameStateRow | null> {
  const { data, error } = await supabase.from('board_game_state').select('*').eq('room_id', roomId).maybeSingle()
  if (error) { logErr('getBoardGameState', error); return null }
  return data
}

/**
 * Submits a move: the calling client's own rules engine has already computed
 * the new state (client-authoritative moves — see migration RPC comments);
 * the server only does optimistic concurrency (version check) + bookkeeping
 * (move log, turn clock). On a version conflict — another player's move
 * landed first — the RPC raises errcode 40001 and this returns
 * `{ conflict: true }` so the caller can refetch state and retry.
 */
export async function submitBoardGameMove(
  roomId: string,
  expectedVersion: number,
  newState: Record<string, unknown>,
  move: Record<string, unknown>,
  seatIndex: number,
  nextTurnSeatIndex?: number
) {
  const { data, error } = await supabase.rpc('submit_board_game_move', {
    p_room_id: roomId,
    p_expected_version: expectedVersion,
    p_new_state: newState,
    p_move: move,
    p_seat_index: seatIndex,
    p_next_turn_seat_index: nextTurnSeatIndex ?? null,
  })
  if (error) {
    const conflict = error.code === '40001' || /concurrently|version/i.test(error.message)
    return { error: error.message, conflict, state: null }
  }
  return { error: null, conflict: false, state: ((Array.isArray(data) ? data[0] : data) as BoardGameStateRow | undefined) ?? null }
}

/**
 * Ends the match: pays Coins/XP via the same reward pipeline every game
 * shares, records match history + stats, checks aggregate + per-match-fact
 * achievements, and marks the room completed. Idempotent — safe to call
 * from multiple clients. `meta` is an optional per-seat bag of match facts
 * (e.g. Ludo's "no pieces lost") for achievements the server can't derive
 * from aggregate stats alone — see BoardGameEngine.getMatchMeta.
 */
export async function finalizeBoardGame(
  roomId: string,
  rankings: Record<string, number>,
  scores: Record<string, number> = {},
  meta: Record<string, unknown> = {}
) {
  const { error } = await supabase.rpc('finalize_board_game', { p_room_id: roomId, p_rankings: rankings, p_scores: scores, p_meta: meta })
  return { error: error?.message ?? null }
}

/**
 * Ludo's dedicated, server-authoritative move path — replaces
 * submitBoardGameMove for this game. The client sends only an intent
 * ({"type":"roll"} / {"type":"move","pieceId":"S:P"} / {"type":"pass"});
 * the server rolls the die, validates turn ownership and move legality, and
 * computes the resulting state itself (see migration
 * 20260720120000_ludo_server_authoritative_engine.sql). The client never
 * computes or sends board state.
 */
export interface LudoMoveResult {
  room_id: string
  state: unknown
  version: number
  updated_at: string
  events: { type: string; [key: string]: unknown }[]
}

export async function submitLudoMove(roomId: string, expectedVersion: number, move: Record<string, unknown>) {
  const { data, error } = await supabase.rpc('ludo_submit_move', {
    p_room_id: roomId,
    p_expected_version: expectedVersion,
    p_move: move,
  })
  if (error) {
    const conflict = error.code === '40001' || /stale state/i.test(error.message)
    return { error: error.message, conflict, result: null }
  }
  return { error: null, conflict: false, result: (data as unknown as LudoMoveResult | null) ?? null }
}

/** Ludo's dedicated finalize path — rankings/scores/meta are derived entirely server-side from the authoritative board_game_state, never from client input. See finalize_ludo_match. */
export async function finalizeLudoMatch(roomId: string) {
  const { error } = await supabase.rpc('finalize_ludo_match', { p_room_id: roomId })
  return { error: error?.message ?? null }
}

export interface LudoTimeoutCheckResult {
  room_id: string
  state: unknown
  version: number
  events: { type: string; [key: string]: unknown }[]
  updated_at: string
  turn_seat_index: number | null
  turn_deadline_at: string | null
  turn_started_at: string | null
  status: string
}

/**
 * The server-side turn-timer watchdog. Atomically resolves any already-
 * expired turn (missed-turn increment, dice/move state cleared, turn
 * advanced, possibly elimination/forfeit) before returning the current
 * authoritative state — safe and cheap to call redundantly. The client
 * calls this on mount, on tab focus/visibility, and on a short interval
 * while an online Ludo match is open, so a stalled timer resolves the
 * instant ANY participant's client is looking at the match — never
 * dependent on the timed-out player's own device. See
 * private.ludo_resolve_expired_turns / public.check_ludo_timeout.
 */
export async function checkLudoTimeout(roomId: string) {
  const { data, error } = await supabase.rpc('check_ludo_timeout', { p_room_id: roomId })
  if (error) return { error: error.message, result: null }
  return { error: null, result: (data as unknown as LudoTimeoutCheckResult | null) ?? null }
}

export interface ActiveLudoMatch {
  room_id: string
  seat_index: number
  turn_seat_index: number | null
  turn_deadline_at: string | null
  turn_timer_seconds: number
}

/**
 * Finds any Ludo room where the caller is still an active, non-eliminated
 * seated player — used to power the "Active match found — Resume Match"
 * card on the Ludo entry screen. Returns null if there's nothing to
 * resume (never started one, already finished, or eliminated). Also
 * resolves any expired timeout on that room first, so a deadline that
 * quietly ran out while the app was closed is reflected immediately
 * (including eliminating the caller, if that's what actually happened).
 */
export async function getActiveLudoMatch() {
  const { data, error } = await supabase.rpc('get_active_ludo_match')
  if (error) { logErr('getActiveLudoMatch', error); return null }
  return (data as unknown as ActiveLudoMatch | null) ?? null
}

export interface LudoForfeitResult {
  room_id: string
  state: unknown
  version: number
  updated_at: string
  events: { type: string; [key: string]: unknown }[]
  forfeited: boolean
}

/**
 * Ends the match right now by forfeit — server-authoritative: the caller
 * only asserts "I give up", the server verifies seat ownership, resolves
 * any already-expired turn first, computes the winner from the remaining
 * active seats, and finalizes rewards in the same transaction (idempotent,
 * exactly-once — see finalize_board_game's status<>'completed' guard).
 * The client never decides who wins. See forfeit_ludo_match.
 */
export async function forfeitLudoMatch(roomId: string) {
  const { data, error } = await supabase.rpc('forfeit_ludo_match', { p_room_id: roomId })
  if (error) return { error: error.message, result: null }
  return { error: null, result: (data as unknown as LudoForfeitResult | null) ?? null }
}

/**
 * Pre-match color selection (round 3). Ludo no longer auto-assigns a seat/
 * color on join — every player must explicitly claim one of the 4 classic
 * colors (0=Red, 1=Green, 2=Yellow, 3=Blue) before the host can start.
 * Claiming is atomic and race-safe server-side (a partial unique index is
 * the real source of truth); a conflict — someone else claimed it a moment
 * earlier — comes back as a clean error, not a silent overwrite. Passing
 * `color: null` releases the caller's current color without claiming a new
 * one. Colors lock automatically the instant the match starts (claim_ludo_
 * color rejects any call once room.status is no longer 'waiting'), and
 * leaving the lobby releases a held color immediately (see
 * leave_board_game_room / the partial index in migration
 * 20260721060000_ludo_pre_match_color_selection.sql).
 */
export async function claimLudoColor(roomId: string, color: number | null) {
  const { data, error } = await supabase.rpc('claim_ludo_color', { p_room_id: roomId, p_color: color })
  if (error) return { error: error.message, player: null }
  return { error: null, player: ((Array.isArray(data) ? data[0] : data) as BoardGamePlayer | undefined) ?? null }
}

export async function leaveBoardGameRoom(roomId: string) {
  await supabase.rpc('leave_board_game_room', { p_room_id: roomId }).then(undefined, () => {})
}

/** Periodic presence ping — call every ~10-15s while in a room so other clients' reconnect/disconnect UI stays accurate. */
export async function boardGameHeartbeat(roomId: string) {
  await supabase.rpc('board_game_heartbeat', { p_room_id: roomId }).then(undefined, () => {})
}

export async function joinBoardGameSpectator(roomId: string) {
  const { error } = await supabase.rpc('join_board_game_spectator', { p_room_id: roomId })
  return { error: error?.message ?? null }
}

export async function leaveBoardGameSpectator(roomId: string) {
  await supabase.rpc('leave_board_game_spectator', { p_room_id: roomId }).then(undefined, () => {})
}

export async function getBoardGameSpectatorCount(roomId: string): Promise<number> {
  const { count, error } = await supabase
    .from('board_game_spectators')
    .select('*', { count: 'exact', head: true })
    .eq('room_id', roomId)
  if (error) { logErr('getBoardGameSpectatorCount', error); return 0 }
  return count ?? 0
}

/** Public, joinable rooms for matchmaking browse: waiting, not private (join_code is null), with open seats. */
export async function getPublicBoardGameRooms(gameId: string): Promise<(BoardGameRoom & { seatedCount: number })[]> {
  const { data: rooms, error } = await supabase
    .from('board_game_rooms')
    .select('*')
    .eq('game_id', gameId)
    .eq('status', 'waiting')
    .is('join_code', null)
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) { logErr('getPublicBoardGameRooms', error); return [] }
  if (!rooms.length) return []
  const { data: players } = await supabase
    .from('board_game_players')
    .select('room_id')
    .in('room_id', rooms.map((r) => r.id))
    .is('left_at', null)
  const counts = new Map<string, number>()
  for (const p of players ?? []) counts.set(p.room_id, (counts.get(p.room_id) ?? 0) + 1)
  return rooms
    .map((r) => ({ ...r, seatedCount: counts.get(r.id) ?? 0 }))
    .filter((r) => r.seatedCount < r.max_players)
}

/** Active, in-progress rooms that allow spectators — for a "watch a live match" browse list. */
export async function getSpectatableBoardGameRooms(gameId: string): Promise<BoardGameRoom[]> {
  const { data, error } = await supabase
    .from('board_game_rooms')
    .select('*')
    .eq('game_id', gameId)
    .eq('status', 'active')
    .eq('allow_spectators', true)
    .order('started_at', { ascending: false })
    .limit(20)
  if (error) { logErr('getSpectatableBoardGameRooms', error); return [] }
  return data ?? []
}

/** Quick match: joins the first open public room for this game, or opens a fresh public one if none has space. */
export async function quickMatchBoardGame(gameId: string, maxPlayers = 4): Promise<{ error: string | null; roomId: string | null }> {
  const open = await getPublicBoardGameRooms(gameId)
  const target = open.find((r) => r.max_players === maxPlayers) ?? open[0]
  if (target) {
    const { error } = await joinBoardGameRoom(target.id)
    if (!error) return { error: null, roomId: target.id }
  }
  const room = await createBoardGameRoom(gameId, maxPlayers, true, false)
  if (!room) return { error: 'Could not create a match', roomId: null }
  return { error: null, roomId: room.id }
}

export interface BoardGameHistoryEntry {
  room: BoardGameRoom
  player: BoardGamePlayer
  coinsEarned: number
  xpEarned: number
  opponents: { seatIndex: number; displayName: string; isAi: boolean; finalRank: number | null }[]
}

/** This player's completed board-game matches (any game, or filtered to one) for the Match History view — enriched with what was earned and who they played against. */
export async function getMyBoardGameHistory(userId: string, gameId?: string, limit = 20): Promise<BoardGameHistoryEntry[]> {
  const { data: myPlayers, error } = await supabase.from('board_game_players').select('*').eq('user_id', userId)
  if (error) { logErr('getMyBoardGameHistory', error); return [] }
  if (!myPlayers.length) return []
  let roomQuery = supabase
    .from('board_game_rooms')
    .select('*')
    .in('id', myPlayers.map((p) => p.room_id))
    .not('completed_at', 'is', null)
  if (gameId) roomQuery = roomQuery.eq('game_id', gameId)
  const { data: rooms, error: roomsError } = await roomQuery.order('completed_at', { ascending: false }).limit(limit)
  if (roomsError) { logErr('getMyBoardGameHistory', roomsError); return [] }
  if (!rooms.length) return []

  const roomIds = rooms.map((r) => r.id)
  const playerByRoom = new Map(myPlayers.map((p) => [p.room_id, p]))

  const [{ data: allPlayers }, { data: coinRows }, { data: xpRows }] = await Promise.all([
    supabase.from('board_game_players').select('*').in('room_id', roomIds),
    supabase.from('coin_ledger').select('ref_id, delta').eq('user_id', userId).eq('source', 'board_game').in('ref_id', roomIds),
    supabase.from('xp_ledger').select('ref_id, delta').eq('user_id', userId).eq('source', 'board_game').in('ref_id', roomIds),
  ])

  const coinsByRoom = new Map<string, number>()
  for (const c of coinRows ?? []) if (c.ref_id) coinsByRoom.set(c.ref_id, (coinsByRoom.get(c.ref_id) ?? 0) + c.delta)
  const xpByRoom = new Map<string, number>()
  for (const x of xpRows ?? []) if (x.ref_id) xpByRoom.set(x.ref_id, (xpByRoom.get(x.ref_id) ?? 0) + x.delta)

  const playersByRoom = new Map<string, BoardGamePlayer[]>()
  for (const p of allPlayers ?? []) {
    const arr = playersByRoom.get(p.room_id) ?? []
    arr.push(p)
    playersByRoom.set(p.room_id, arr)
  }

  const opponentIds = Array.from(new Set((allPlayers ?? []).filter((p) => p.user_id && p.user_id !== userId).map((p) => p.user_id as string)))
  const profileMap = new Map<string, { username: string }>()
  if (opponentIds.length) {
    const { data: profiles } = await supabase.rpc('get_public_profiles', { p_ids: opponentIds })
    for (const p of (profiles as { id: string; username: string }[] | null) ?? []) profileMap.set(p.id, p)
  }

  return rooms.map((room) => {
    const opponents = (playersByRoom.get(room.id) ?? []).filter((p) => p.user_id !== userId)
    return {
      room,
      player: playerByRoom.get(room.id)!,
      coinsEarned: coinsByRoom.get(room.id) ?? 0,
      xpEarned: xpByRoom.get(room.id) ?? 0,
      // seat_index is nullable pre-match now (round-3 color selection), but
      // history/opponent rows only ever come from rooms that already
      // finished, i.e. every seat was colored before start_board_game_room
      // would let it start — the ?? 0 fallback is unreachable in practice.
      opponents: opponents.map((p) => ({
        seatIndex: p.seat_index ?? 0,
        displayName: p.is_ai ? 'AI' : profileMap.get(p.user_id ?? '')?.username ?? `Player ${(p.seat_index ?? 0) + 1}`,
        isAi: p.is_ai,
        finalRank: p.final_rank,
      })),
    }
  })
}

export interface BoardGameMatchDetail {
  room: BoardGameRoom
  players: Awaited<ReturnType<typeof getBoardGamePlayers>>
  /** Full ordered move log with a resulting_state snapshot per move — everything a replay viewer needs, no engine re-simulation required. */
  moves: BoardGameMove[]
}

/** Full detail for one completed (or in-progress) match: room, stable player roster, and the complete replay-ready move log. */
export async function getBoardGameMatchDetail(roomId: string): Promise<BoardGameMatchDetail | null> {
  const [room, players, movesRes] = await Promise.all([
    getBoardGameRoom(roomId),
    getBoardGamePlayers(roomId, true),
    supabase.from('board_game_moves').select('*').eq('room_id', roomId).order('move_number', { ascending: true }),
  ])
  if (!room) return null
  if (movesRes.error) logErr('getBoardGameMatchDetail', movesRes.error)
  return { room, players, moves: movesRes.data ?? [] }
}

/** Live-updates everything about a room the instant it changes — players joining/leaving/reconnecting, ready-state, room status, state/version bumps, new moves, spectator count. */
/**
 * Realtime is a nice-to-have fast path here, not the source of truth — the
 * turn-timer watchdog (5s poll + focus/visibility triggers, see
 * onlineController.ts) independently resolves and resyncs state regardless
 * of Realtime's health. But a dropped websocket (very common on mobile:
 * iOS Safari/WKWebView suspends open sockets when backgrounded, and
 * Supabase's client does not automatically resubscribe a channel that
 * reports CHANNEL_ERROR/TIMED_OUT/CLOSED) previously meant `onChange()`
 * just silently stopped firing on data changes until something else
 * (a poll tick or a manual refresh) happened to run. Now any non-SUBSCRIBED
 * terminal status tears down and recreates the channel after a short delay,
 * so live updates recover on their own instead of requiring the slower
 * poll-only fallback to carry the whole match.
 */
export function subscribeToBoardGameRoom(roomId: string, onChange: () => void) {
  let cancelled = false
  let channel: ReturnType<typeof supabase.channel> | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryDelayMs = 1000

  const connect = () => {
    if (cancelled) return
    diagLog('board-game-realtime', 'subscribing', { roomId })
    const wrap = (table: string) => (payload: { eventType: string }) => {
      diagLog('board-game-realtime', `${table} change`, { roomId, eventType: payload.eventType })
      onChange()
    }
    channel = supabase
      .channel(`board-game-room:${roomId}:${Date.now()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_game_rooms', filter: `id=eq.${roomId}` }, wrap('board_game_rooms'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_game_players', filter: `room_id=eq.${roomId}` }, wrap('board_game_players'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_game_state', filter: `room_id=eq.${roomId}` }, wrap('board_game_state'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_game_moves', filter: `room_id=eq.${roomId}` }, wrap('board_game_moves'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'board_game_spectators', filter: `room_id=eq.${roomId}` }, wrap('board_game_spectators'))
      .subscribe((status, err) => {
        diagLog('board-game-realtime', `channel status: ${status}`, { roomId, error: err ? String(err) : undefined })
        if (cancelled) return
        if (status === 'SUBSCRIBED') {
          retryDelayMs = 1000 // healthy connection — reset backoff
          onChange() // pick up anything that changed while the channel was down/connecting
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          if (channel) { try { supabase.removeChannel(channel) } catch { /* already gone */ } }
          channel = null
          if (retryTimer) clearTimeout(retryTimer)
          retryTimer = setTimeout(() => { retryDelayMs = Math.min(retryDelayMs * 2, 15000); connect() }, retryDelayMs)
        }
      })
  }
  connect()

  return () => {
    cancelled = true
    diagLog('board-game-realtime', 'unsubscribing', { roomId })
    if (retryTimer) clearTimeout(retryTimer)
    if (channel) supabase.removeChannel(channel)
  }
}

// ---------------------------------------------------------------------
// Board game match chat — scoped strictly to one room (players +
// spectators of that match), never mixed with the friends 1:1 messages
// table. See 20260718060000_board_game_match_chat.sql for the schema/RLS/
// retention rationale.
// ---------------------------------------------------------------------
export type BoardGameMessage = Tables<'board_game_messages'> & { username?: string; avatar_url?: string | null }

/** Recent match-chat history for a room, oldest first, enriched with sender display info. Only room members can call this (RLS). */
export async function getBoardGameMessages(roomId: string, limit = 50): Promise<BoardGameMessage[]> {
  const { data, error } = await supabase
    .from('board_game_messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { logErr('getBoardGameMessages', error); return [] }
  const rows = (data ?? []).slice().reverse()
  if (!rows.length) return rows
  const senderIds = Array.from(new Set(rows.map((m) => m.sender_id)))
  const { data: profiles } = await supabase.rpc('get_public_profiles', { p_ids: senderIds })
  const map = new Map<string, { username: string; avatar_url: string | null }>()
  for (const p of (profiles as { id: string; username: string; avatar_url: string | null }[] | null) ?? []) map.set(p.id, p)
  return rows.map((m) => ({ ...m, username: map.get(m.sender_id)?.username, avatar_url: map.get(m.sender_id)?.avatar_url ?? null }))
}

/** Sends a match-chat message. client_message_id lets a retried call after a dropped network response resolve to the same row instead of double-posting. */
export async function sendBoardGameMessage(roomId: string, body: string, clientMessageId: string) {
  const { data, error } = await supabase.rpc('send_board_game_message', {
    p_room_id: roomId, p_body: body, p_client_message_id: clientMessageId,
  })
  if (error) return { error: error.message, id: null }
  return { error: null, id: data as string }
}

/** Live new-message updates for one room's chat — separate channel from subscribeToBoardGameRoom so a busy chat doesn't force a full room/players refetch on every message. */
export function subscribeToBoardGameMessages(roomId: string, onInsert: (row: BoardGameMessage) => void) {
  const channel = supabase
    .channel(`board-game-chat:${roomId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'board_game_messages', filter: `room_id=eq.${roomId}` }, (payload) => {
      onInsert(payload.new as BoardGameMessage)
    })
    .subscribe()
  return () => supabase.removeChannel(channel)
}

export { supabase }
