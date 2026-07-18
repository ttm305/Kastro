import { supabase } from './supabaseClient'
import type { Tables, TablesInsert, TablesUpdate } from './database.types'

// =============================================================================
// Admin Dashboard data access — every function here is only reachable by an
// authenticated user whose profiles.role = 'owner'; the underlying RPCs all
// call private.require_owner() server-side, so even if this file were
// mis-wired, a non-owner caller gets a 403 from Postgres, not just a hidden
// button. See migrations 010/011 for the RPC implementations.
// =============================================================================

// -----------------------------------------------------------------------------
// Error translation — a raw Postgres/PostgREST error (a dropped-overload
// signature like "function ... is not unique", a column-type mismatch, a
// constraint name, a connection failure, etc.) must never reach the admin
// UI verbatim. Every admin_* RPC in this app raises its own deliberate,
// human-authored validation messages using errcode '22023' as an app-level
// convention (see private.require_owner() and every "raise exception ...
// using errcode = '22023'" in the RPC definitions) — those are short,
// curated, and safe to show as-is (e.g. "English name is required",
// "The owner account cannot be suspended"). Anything else is replaced with
// the GENERIC_ADMIN_ERROR sentinel; UI call sites swap that sentinel for a
// localized "please try again" message (see describeAdminError in
// AdminDashboardScreen.tsx). The real error is always logged to the
// console here so it's still visible during development/debugging.
// -----------------------------------------------------------------------------
export const GENERIC_ADMIN_ERROR = '__generic_admin_error__'

function toAdminError(
  error: { message: string; code?: string } | null | undefined,
  context = 'admin'
): string | null {
  if (!error) return null
  console.error(`[admin:${context}]`, error)
  if (error.code === '22023') return error.message
  return GENERIC_ADMIN_ERROR
}

export async function adminGetOverviewStats() {
  const { data, error } = await supabase.rpc('admin_get_overview_stats')
  if (error) { console.error('[admin:overview]', error); return null }
  return (data as any[] | null)?.[0] ?? null
}

export async function adminGetDau(days = 14) {
  const { data, error } = await supabase.rpc('admin_get_dau', { p_days: days })
  if (error) { console.error('[admin:dau]', error); return [] }
  return ((data as { active_users: number }[] | null) ?? []).map((d) => d.active_users)
}

export async function adminGetGameAnalytics() {
  const { data, error } = await supabase.rpc('admin_get_game_analytics')
  if (error) { console.error('[admin:games]', error); return [] }
  return data ?? []
}

export async function adminGetUsers() {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
  if (error) { console.error('[admin:users]', error); return [] }
  // Attach badge names + games/avg-score + branch (name_en/name_ar/code) for
  // the user detail sheet. Branches are read directly here (not via
  // getBranches()) so the owner sees a user's branch even if that branch
  // has since been deactivated — getBranches() intentionally only returns
  // active branches, which is correct for the signup dropdown but would
  // hide a deactivated branch from an existing user's profile. The owner's
  // `branches_select_owner_all` RLS policy (see migration
  // dynamic_branch_management) is what makes this direct read return every
  // row, active or not, for an owner caller.
  const ids = data?.map((u) => u.id) ?? []
  if (!ids.length) return []
  const [{ data: badges }, { data: sessions }, { data: branchRows }] = await Promise.all([
    supabase.from('user_achievements').select('user_id, achievement_id, achievements(name)').in('user_id', ids),
    supabase.from('game_sessions').select('user_id, score').eq('status', 'completed').in('user_id', ids),
    supabase.from('branches').select('id, name_en, name_ar, code'),
  ])
  const badgeMap = new Map<string, string[]>()
  const badgeIdMap = new Map<string, string[]>()
  for (const b of badges ?? []) {
    const name = (b as any).achievements?.name
    if (name) badgeMap.set(b.user_id, [...(badgeMap.get(b.user_id) ?? []), name])
    badgeIdMap.set(b.user_id, [...(badgeIdMap.get(b.user_id) ?? []), b.achievement_id])
  }
  const gameStats = new Map<string, { count: number; total: number }>()
  for (const s of sessions ?? []) {
    const cur = gameStats.get(s.user_id) ?? { count: 0, total: 0 }
    cur.count += 1
    cur.total += s.score ?? 0
    gameStats.set(s.user_id, cur)
  }
  const branchMap = new Map((branchRows ?? []).map((b) => [b.id, b]))
  return data.map((u) => {
    const branch = u.branch_id ? branchMap.get(u.branch_id) : undefined
    return {
      ...u,
      badges: badgeMap.get(u.id) ?? [],
      badgeIds: badgeIdMap.get(u.id) ?? [],
      gamesPlayed: gameStats.get(u.id)?.count ?? 0,
      avgScore: gameStats.get(u.id)?.count ? Math.round(gameStats.get(u.id)!.total / gameStats.get(u.id)!.count) : 0,
      branchName: branch?.name_en ?? null,
      branchNameAr: branch?.name_ar ?? null,
      branchSlug: branch?.code ?? null,
    }
  })
}

export async function adminSetUserStatus(userId: string, status: 'active' | 'suspended') {
  const { error } = await supabase.rpc('admin_set_user_status', { p_user_id: userId, p_status: status })
  return { error: toAdminError(error) }
}

export async function adminDeleteUser(userId: string) {
  const { error } = await supabase.rpc('admin_delete_user', { p_user_id: userId })
  return { error: toAdminError(error) }
}

export async function adminAdjustXp(userId: string, delta: number, reason = '') {
  const { data, error } = await supabase.rpc('admin_adjust_xp', { p_user_id: userId, p_delta: delta, p_reason: reason })
  return { error: toAdminError(error), newXp: data as number | null }
}

export async function adminGiveBadge(userId: string, achievementId: string) {
  const { error } = await supabase.rpc('admin_give_badge', { p_user_id: userId, p_achievement_id: achievementId })
  return { error: toAdminError(error) }
}

export async function adminSendPasswordReset(userId: string, email: string) {
  const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin })
  if (resetError) return { error: toAdminError(resetError, 'sendPasswordReset') }
  const { error } = await supabase.rpc('admin_log_password_reset', { p_user_id: userId })
  return { error: toAdminError(error) }
}

export async function adminGetAccessCodes() {
  const { data, error } = await supabase.from('access_codes').select('*').order('created_at', { ascending: false })
  if (error) { console.error('[admin:codes]', error); return [] }
  return data ?? []
}

export async function adminCreateAccessCode(note: string, maxUses: number | null, expiresAt: string | null, code?: string) {
  const { data, error } = await supabase.rpc('admin_create_access_code', {
    p_note: note, p_max_uses: maxUses, p_expires_at: expiresAt, p_code: code || undefined,
  })
  if (error) return { error: toAdminError(error, 'createAccessCode'), data: null }
  return { error: null, data }
}

export async function adminToggleAccessCode(codeId: string) {
  const { data, error } = await supabase.rpc('admin_toggle_access_code', { p_code_id: codeId })
  return { error: toAdminError(error), data }
}

export async function adminDeleteAccessCode(codeId: string) {
  const { error } = await supabase.rpc('admin_delete_access_code', { p_code_id: codeId })
  return { error: toAdminError(error) }
}

// =============================================================================
// Branch Management — owner-only CRUD over public.branches. Every mutation
// goes through a SECURITY DEFINER RPC that re-checks owner status server
// side (private.require_owner()); RLS on the table is defense-in-depth,
// not the actual gate. See migration dynamic_branch_management.
// =============================================================================

export type AdminBranch = {
  id: string
  code: string
  name_ar: string
  name_en: string
  is_active: boolean
  sort_order: number
  created_at: string
  updated_at: string
  user_count: number
}

export async function adminGetBranches(): Promise<{ error: string | null; data: AdminBranch[] }> {
  const { data, error } = await supabase.rpc('admin_get_branches')
  if (error) return { error: toAdminError(error, 'getBranches'), data: [] }
  return { error: null, data: ((data ?? []) as any[]).map((b) => ({ ...b, user_count: Number(b.user_count) })) }
}

export async function adminCreateBranch(code: string, nameAr: string, nameEn: string, isActive = true) {
  const { data, error } = await supabase.rpc('admin_create_branch', {
    p_code: code, p_name_ar: nameAr, p_name_en: nameEn, p_is_active: isActive,
  })
  return { error: toAdminError(error), data: data ?? null }
}

export async function adminUpdateBranch(branchId: string, nameAr: string, nameEn: string) {
  const { data, error } = await supabase.rpc('admin_update_branch', {
    p_branch_id: branchId, p_name_ar: nameAr, p_name_en: nameEn,
  })
  return { error: toAdminError(error), data: data ?? null }
}

export async function adminSetBranchActive(branchId: string, isActive: boolean) {
  const { data, error } = await supabase.rpc('admin_set_branch_active', {
    p_branch_id: branchId, p_is_active: isActive,
  })
  return { error: toAdminError(error), data: data ?? null }
}

export async function adminReorderBranches(orderedIds: string[]) {
  const { error } = await supabase.rpc('admin_reorder_branches', { p_ordered_ids: orderedIds })
  return { error: toAdminError(error) }
}

export async function adminDeleteBranch(branchId: string) {
  const { error } = await supabase.rpc('admin_delete_branch', { p_branch_id: branchId })
  return { error: toAdminError(error) }
}

export async function adminGetUsersByCode(code: string) {
  const { data: codeRow } = await supabase.from('access_codes').select('id').eq('code', code).maybeSingle()
  if (!codeRow) return []
  const { data, error } = await supabase.from('profiles').select('*').eq('access_code_id', codeRow.id)
  if (error) { console.error('[admin:codeUsers]', error); return [] }
  return data ?? []
}

export async function adminGetAnnouncements() {
  const { data, error } = await supabase.from('announcements').select('*').order('created_at', { ascending: false })
  if (error) { console.error('[admin:announcements]', error); return [] }
  return data ?? []
}

export async function adminCreateAnnouncement(title: string, body: string, pinned: boolean, scheduledAt: string | null, expiresAt: string | null) {
  const { data, error } = await supabase.rpc('admin_create_announcement', {
    p_title: title, p_body: body, p_pinned: pinned, p_scheduled_at: scheduledAt, p_expires_at: expiresAt,
  })
  return { error: toAdminError(error), data }
}

export async function adminDeleteAnnouncement(id: string) {
  const { error } = await supabase.rpc('admin_delete_announcement', { p_id: id })
  return { error: toAdminError(error) }
}

export async function adminGetLog(limit = 200) {
  const { data, error } = await supabase.from('admin_log').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) { console.error('[admin:log]', error); return [] }
  return data ?? []
}

export async function adminGetAllAchievements() {
  const { data, error } = await supabase.from('achievements').select('id, name, name_ar').order('sort_order')
  if (error) { console.error('[admin:achievements]', error); return [] }
  return data ?? []
}

/** Full achievement rows (all columns) for the Content admin tab editor — the trimmed
 *  `adminGetAllAchievements()` above stays as-is since UsersTab's badge-give picker only needs id/name. */
export async function adminGetAllAchievementsFull() {
  const { data, error } = await supabase.from('achievements').select('*').order('sort_order')
  if (error) { console.error('[admin:achievementsFull]', error); return [] }
  return data ?? []
}

export async function adminGetAllGames() {
  const { data, error } = await supabase.from('games').select('*').order('sort_order')
  if (error) { console.error('[admin:games]', error); return [] }
  return data ?? []
}

export async function adminGenerateTournamentBracket(tournamentId: string) {
  const { error } = await supabase.rpc('admin_generate_bracket', { p_tournament_id: tournamentId })
  return { error: toAdminError(error) }
}

export async function adminEndSeasonAndStartNew(name: string, nameAr: string, startsAt: string, endsAt: string) {
  const { data, error } = await supabase.rpc('admin_end_season_and_start_new', {
    p_new_name: name, p_new_name_ar: nameAr, p_starts_at: startsAt, p_ends_at: endsAt,
  })
  return { error: toAdminError(error), data }
}

export async function adminResetUserXp(userId: string) {
  const { data, error } = await supabase.rpc('admin_reset_user_xp', { p_user_id: userId })
  return { error: toAdminError(error), newXp: data as number | null }
}

/** Exact-set XP (also used for "Reset to 0" — resetXp just calls this with 0). */
export async function adminSetUserXp(userId: string, newXp: number, reason = '') {
  const { data, error } = await supabase.rpc('admin_set_user_xp', { p_user_id: userId, p_new_xp: newXp, p_reason: reason })
  return { error: toAdminError(error), newXp: data as number | null }
}

// ---------------------------------------------------------------------------
// Coins — per-user balance control. Distinct from adminSetCoinReward()
// above, which only edits the catalog of reward *amounts*, never a
// specific player's balance.
// ---------------------------------------------------------------------------
export async function adminAdjustCoins(userId: string, delta: number, reason = '') {
  const { data, error } = await supabase.rpc('admin_adjust_coins', { p_user_id: userId, p_delta: delta, p_reason: reason })
  return { error: toAdminError(error), newCoins: data as number | null }
}

export async function adminSetUserCoins(userId: string, newCoins: number, reason = '') {
  const { data, error } = await supabase.rpc('admin_set_user_coins', { p_user_id: userId, p_new_coins: newCoins, p_reason: reason })
  return { error: toAdminError(error), newCoins: data as number | null }
}

export async function adminResetUserCoins(userId: string) {
  const { data, error } = await supabase.rpc('admin_reset_user_coins', { p_user_id: userId })
  return { error: toAdminError(error), newCoins: data as number | null }
}

export async function adminRemoveBadge(userId: string, achievementId: string) {
  const { error } = await supabase.rpc('admin_remove_badge', { p_user_id: userId, p_achievement_id: achievementId })
  return { error: toAdminError(error) }
}

export async function adminSetCustomTitle(userId: string, title: string, titleAr: string, reason = '') {
  const { error } = await supabase.rpc('admin_set_custom_title', {
    p_user_id: userId, p_title: title || null, p_title_ar: titleAr || null, p_reason: reason,
  })
  return { error: toAdminError(error) }
}

export interface GameStatCorrection {
  gamesPlayed: number
  wins: number
  currentStreak: number
  bestStreak: number
  totalCorrect: number
  totalQuestions: number
  bestScore: number
}

export async function adminCorrectUserGameStats(userId: string, gameId: string, s: GameStatCorrection, reason = '') {
  const { data, error } = await supabase.rpc('admin_correct_user_game_stats', {
    p_user_id: userId, p_game_id: gameId,
    p_games_played: s.gamesPlayed, p_wins: s.wins,
    p_current_streak: s.currentStreak, p_best_streak: s.bestStreak,
    p_total_correct: s.totalCorrect, p_total_questions: s.totalQuestions,
    p_best_score: s.bestScore, p_reason: reason,
  })
  return { error: toAdminError(error), data }
}

export async function adminGetUserGameStats(userId: string) {
  const { data, error } = await supabase.from('user_game_stats').select('*').eq('user_id', userId)
  if (error) { console.error('[admin:userGameStats]', error); return [] }
  return data ?? []
}

/**
 * Transactional full progress reset. Preserves auth identity (account,
 * email, username, id, registration date, branch, access-code record) —
 * wipes everything derived from gameplay (XP/level/coins back to the
 * configured starting balance, stats, XP+coin ledgers, challenge
 * progress, season progress, daily-reward streak). Badges and cosmetics
 * are wiped too unless explicitly preserved.
 */
export async function adminResetPlayerProgress(
  userId: string,
  opts: { preserveBadges?: boolean; preserveCosmetics?: boolean; reason?: string } = {}
) {
  const { data, error } = await supabase.rpc('admin_reset_player_progress', {
    p_user_id: userId,
    p_confirm: 'RESET',
    p_preserve_badges: opts.preserveBadges ?? false,
    p_preserve_cosmetics: opts.preserveCosmetics ?? false,
    p_reason: opts.reason ?? 'Player progress reset',
  })
  return { error: toAdminError(error), data }
}

/** Per-user account history for the "Account History" section of the user details panel. */
export async function adminGetUserHistory(userId: string, limit = 100) {
  const { data, error } = await supabase
    .from('admin_log')
    .select('*')
    .eq('target_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) { console.error('[admin:userHistory]', error); return [] }
  return data ?? []
}

// ---------------------------------------------------------------------------
// Direct catalog CRUD — games / achievements / tournaments / challenges all
// have owner-only ALL row-level-security policies already, so the database
// is the real permission gate here, not this file. Plain insert/update/
// upsert/delete calls are enough; a non-owner caller gets a clean RLS
// rejection from Postgres regardless of what this client code does.
// ---------------------------------------------------------------------------
export async function adminUpsertGame(game: TablesInsert<'games'>) {
  const { error } = await supabase.from('games').upsert(game)
  return { error: toAdminError(error) }
}

export async function adminSetGameActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('games').update({ is_active: isActive }).eq('id', id)
  return { error: toAdminError(error) }
}

export async function adminDeleteGame(id: string) {
  const { error } = await supabase.from('games').delete().eq('id', id)
  if (error) {
    const friendly = /foreign key|violates/i.test(error.message)
      ? 'This game has existing play history and cannot be deleted — disable it instead.'
      : toAdminError(error, 'delete')
    return { error: friendly }
  }
  return { error: null }
}

export async function adminUpsertAchievement(a: TablesInsert<'achievements'>) {
  const { error } = await supabase.from('achievements').upsert(a)
  return { error: toAdminError(error) }
}

export async function adminDeleteAchievement(id: string) {
  const { error } = await supabase.from('achievements').delete().eq('id', id)
  if (error) {
    const friendly = /foreign key|violates/i.test(error.message)
      ? 'Players have already unlocked this badge — it cannot be deleted.'
      : toAdminError(error, 'delete')
    return { error: friendly }
  }
  return { error: null }
}

export async function adminUpdateTournament(id: string, patch: TablesUpdate<'tournaments'>) {
  const { error } = await supabase.from('tournaments').update(patch).eq('id', id)
  return { error: toAdminError(error) }
}

export async function adminDeleteTournament(id: string) {
  const { error } = await supabase.from('tournaments').delete().eq('id', id)
  return { error: toAdminError(error) }
}

export async function adminCreateTournament(
  name: string, nameAr: string, qualificationRule: string, qualificationRuleAr: string, startsAt: string, endsAt: string
) {
  const { data, error } = await supabase.rpc('admin_create_tournament', {
    p_name: name, p_name_ar: nameAr, p_qualification_rule: qualificationRule, p_qualification_rule_ar: qualificationRuleAr,
    p_starts_at: startsAt, p_ends_at: endsAt,
  })
  return { error: toAdminError(error), data }
}

export async function adminGetAllTournaments() {
  const { data, error } = await supabase.from('tournaments').select('*').order('created_at', { ascending: false })
  if (error) { console.error('[admin:tournaments]', error); return [] }
  return data ?? []
}

export async function adminCreateChallenge(
  periodType: 'daily' | 'weekly' | 'monthly' | 'seasonal', title: string, titleAr: string,
  gameId: string | null, questionCount: number, startsAt: string, endsAt: string,
  xpReward?: number, coinReward?: number
) {
  const { data, error } = await supabase.rpc('admin_create_challenge', {
    p_period_type: periodType, p_title: title, p_title_ar: titleAr, p_game_id: gameId ?? '',
    p_question_count: questionCount, p_starts_at: startsAt, p_ends_at: endsAt,
    p_xp_reward: xpReward ?? null, p_coin_reward: coinReward ?? null,
  })
  return { error: toAdminError(error), data }
}

export async function adminDeleteChallenge(id: string) {
  const { error } = await supabase.from('challenges').delete().eq('id', id)
  return { error: toAdminError(error) }
}

// Editing an existing challenge's XP/Coin reward goes through this RPC
// rather than a direct table update — keeps the same server-validated,
// auditable write path used everywhere else in the admin console.
export async function adminUpdateChallengeRewards(id: string, xpReward: number, coinReward: number) {
  const { error } = await supabase.rpc('admin_update_challenge_rewards', {
    p_id: id, p_xp_reward: xpReward, p_coin_reward: coinReward,
  })
  return { error: toAdminError(error) }
}

export async function adminGetAllChallenges() {
  const { data, error } = await supabase.from('challenges').select('*').order('starts_at', { ascending: false })
  if (error) { console.error('[admin:challenges]', error); return [] }
  return data ?? []
}

// ---------------------------------------------------------------------------
// Coins economy — reward amounts are catalog data (owner-only ALL RLS +
// authenticated SELECT, same pattern as games/achievements) but go through
// admin_set_coin_reward() rather than a direct upsert so every change is
// server-validated and there is a single, auditable write path for a value
// that directly affects game economy.
// ---------------------------------------------------------------------------
export type CoinRewardConfig = Tables<'coin_reward_config'>

export async function adminGetCoinRewardConfig(): Promise<CoinRewardConfig[]> {
  const { data, error } = await supabase.from('coin_reward_config').select('*').order('key')
  if (error) { console.error('[admin:coinRewardConfig]', error); return [] }
  return data ?? []
}

export async function adminSetCoinReward(key: string, amount: number) {
  const { error } = await supabase.rpc('admin_set_coin_reward', { p_key: key, p_amount: amount })
  return { error: toAdminError(error) }
}

// ---------------------------------------------------------------------------
// Emoji Decode puzzle bank — owner-only ALL RLS + authenticated SELECT, same
// direct-CRUD pattern as games/achievements. `is_active` lets the owner
// retire a puzzle without deleting its history (rounds already played still
// reference it via match_rounds.payload).
// ---------------------------------------------------------------------------
export type EmojiPuzzle = Tables<'emoji_puzzles'>

export async function adminGetAllEmojiPuzzles(): Promise<EmojiPuzzle[]> {
  const { data, error } = await supabase.from('emoji_puzzles').select('*').order('created_at', { ascending: false })
  if (error) { console.error('[admin:emojiPuzzles]', error); return [] }
  return data ?? []
}

export async function adminUpsertEmojiPuzzle(puzzle: TablesInsert<'emoji_puzzles'>) {
  const { error } = await supabase.from('emoji_puzzles').upsert(puzzle)
  return { error: toAdminError(error) }
}

export async function adminSetEmojiPuzzleActive(id: string, isActive: boolean) {
  const { error } = await supabase.from('emoji_puzzles').update({ is_active: isActive }).eq('id', id)
  return { error: toAdminError(error) }
}

export async function adminDeleteEmojiPuzzle(id: string) {
  const { error } = await supabase.from('emoji_puzzles').delete().eq('id', id)
  if (error) {
    const friendly = /foreign key|violates/i.test(error.message)
      ? 'This puzzle has already been used in a match and cannot be deleted — disable it instead.'
      : toAdminError(error, 'delete')
    return { error: friendly }
  }
  return { error: null }
}

// ---------------------------------------------------------------------------
// Cosmetics shop catalog — owner-only ALL RLS + authenticated SELECT, same
// direct-CRUD pattern as games/achievements/emoji puzzles. Every price,
// rarity, translation, availability flag, and seasonal date lives here so
// the owner can rebalance the shop without a code change or redeploy.
// Purchases themselves go through the server-side purchase_cosmetic_item()
// RPC (see api.ts) — this file only ever touches the catalog, never a
// player's coin balance or ownership rows.
// ---------------------------------------------------------------------------
export type CosmeticItemFull = Tables<'cosmetic_items'>

export async function adminGetAllCosmeticsFull(): Promise<CosmeticItemFull[]> {
  const { data, error } = await supabase.from('cosmetic_items').select('*').order('type').order('sort_order')
  if (error) { console.error('[admin:cosmetics]', error); return [] }
  return data ?? []
}

export async function adminUpsertCosmeticItem(item: TablesInsert<'cosmetic_items'>) {
  const { error } = await supabase.from('cosmetic_items').upsert(item)
  return { error: toAdminError(error) }
}

export async function adminSetCosmeticAvailable(id: string, isAvailable: boolean) {
  const { error } = await supabase.from('cosmetic_items').update({ is_available: isAvailable }).eq('id', id)
  return { error: toAdminError(error) }
}

export async function adminDeleteCosmeticItem(id: string) {
  const { error } = await supabase.from('cosmetic_items').delete().eq('id', id)
  if (error) {
    const friendly = /foreign key|violates/i.test(error.message)
      ? 'Players already own this item — disable it instead of deleting it.'
      : toAdminError(error, 'delete')
    return { error: friendly }
  }
  return { error: null }
}
