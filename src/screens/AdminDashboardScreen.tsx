// =============================================================================
// DESIGN LOCKED — v1.0 Final  |  2025-07-15
// Layout · Spacing · Typography · Colors · Components are frozen.
// Do not change visual structure unless a real usability issue is discovered.
// Next step: wire API endpoints; replace SAMPLE_* constants with live data.
// =============================================================================
// ANIMATION SPEC (implement in production):
//   • Tab switch      → fade-in 150ms ease-out  (opacity 0→1)
//   • Sheet open      → slide-up 280ms cubic-bezier(0.32,0.72,0,1)
//   • Sheet close     → slide-down 220ms ease-in
//   • Toast           → slide-up + fade 250ms ease-out, auto-dismiss 2s
//   • Skeleton        → opacity pulse 1.4s infinite (already wired)
//   • Copy button     → color swap 200ms ease + checkmark scale 0→1.2→1
//   • Stat card hover → translateY(-2px) 150ms ease
//   • Bar fill        → width 0→final 600ms ease-out on mount
// =============================================================================

import React, { useState, useEffect, useCallback } from 'react'
import type { Screen, Lang } from '../App'
import Avatar from '../components/Avatar'
import { supabase } from '../lib/supabaseClient'
import type { Tables } from '../lib/database.types'
import { getActiveSeason } from '../lib/api'
import { getDiagEntries, subscribeDiag, clearDiagEntries, type DiagEntry } from '../lib/diagnostics'
import {
  adminGetOverviewStats,
  adminGetDau,
  adminGetGameAnalytics,
  adminGetUsers,
  adminSetUserStatus,
  adminDeleteUser,
  adminAdjustXp,
  adminResetUserXp,
  adminSetUserXp,
  adminAdjustCoins,
  adminSetUserCoins,
  adminResetUserCoins,
  adminGiveBadge,
  adminRemoveBadge,
  adminSetCustomTitle,
  adminCorrectUserGameStats,
  adminGetUserGameStats,
  adminResetPlayerProgress,
  adminGetUserHistory,
  type GameStatCorrection,
  adminSendPasswordReset,
  adminGetAccessCodes,
  adminCreateAccessCode,
  adminToggleAccessCode,
  adminDeleteAccessCode,
  adminGetUsersByCode,
  adminGetBranches,
  adminCreateBranch,
  adminUpdateBranch,
  adminSetBranchActive,
  adminReorderBranches,
  adminDeleteBranch,
  type AdminBranch,
  adminGetAnnouncements,
  adminCreateAnnouncement,
  adminDeleteAnnouncement,
  adminGetLog,
  adminGetAllAchievements,
  adminGetAllAchievementsFull,
  adminGetAllGames,
  adminUpsertGame,
  adminSetGameActive,
  adminDeleteGame,
  adminUpsertAchievement,
  adminDeleteAchievement,
  adminGetAllTournaments,
  adminCreateTournament,
  adminUpdateTournament,
  adminDeleteTournament,
  adminGenerateTournamentBracket,
  adminGetAllChallenges,
  adminCreateChallenge,
  adminDeleteChallenge,
  adminUpdateChallengeRewards,
  adminGetCoinRewardConfig,
  adminSetCoinReward,
  type CoinRewardConfig,
  adminEndSeasonAndStartNew,
  adminGetAllCosmeticsFull,
  adminUpsertCosmeticItem,
  adminSetCosmeticAvailable,
  adminDeleteCosmeticItem,
  GENERIC_ADMIN_ERROR,
} from '../lib/adminApi'

// adminApi.ts never lets a raw Postgres/PostgREST error (a dropped-overload
// signature, a column-type mismatch, an internal constraint name, etc.)
// leave the API layer — every mutation function there returns either a
// curated, already-safe validation message (our own RPCs' errcode '22023'
// messages, e.g. "English name is required") or the GENERIC_ADMIN_ERROR
// sentinel. This is the one place that turns that sentinel into the
// localized, generic message the owner actually sees; every other error
// string is already safe to show verbatim.
function describeAdminError(error: string, ar: boolean): string {
  if (error === GENERIC_ADMIN_ERROR) {
    return ar ? 'تعذر حفظ التغيير. يرجى المحاولة مرة أخرى.' : 'The change could not be saved. Please try again.'
  }
  return error
}

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  setLang: (l: Lang) => void
  userEmail: string
}

type AdminTab = 'overview' | 'users' | 'codes' | 'branches' | 'games' | 'content' | 'announcements' | 'log' | 'diagnostics'

interface SampleUser {
  id: string
  username: string
  email: string
  role: 'player' | 'owner'
  status: 'active' | 'suspended'
  isOnline: boolean
  level: number
  xp: number
  coins: number
  customTitle: string | null
  customTitleAr: string | null
  branch: string | null
  branchAr: string | null
  branchSlug: string | null
  loginCount: number
  lastActive: string
  registeredAt: string
  accessCode: string
  badges: string[]
  badgeIds: string[]
  gamesPlayed: number
  avgScore: number
  avatarUrl: string | null
}

interface AccessCode {
  id: string
  code: string
  note: string
  maxUses: number | 'unlimited'
  uses: number
  status: 'active' | 'disabled'
  createdAt: string
  expiresAt: string | 'never'
  createdBy: string
}

interface AdminLogEntry {
  id: string
  timestamp: string
  action: string
  category: string
  target: string
  detail: string
  targetUserId: string | null
  oldValue: string | null
  newValue: string | null
}

interface Announcement {
  id: string
  title: string
  body: string
  createdAt: string
  pinned: boolean
  scheduledAt: string | null
  expiresAt: string | null
}

interface GameRow {
  id: string
  name: string
  nameAr: string
  plays: number
  avgScore: number
  avgTime: string
  hardestQ: string
  failedTopic: string
  uniquePlayers: number
  completion: number
  questions: { textEn: string; textAr: string; correct: number; attempts: number }[]
}

interface Achievement { id: string; name: string; nameAr?: string }

// ── Live data (fetched from Supabase — see loaders in root component) ────────
// The shapes below (SampleUser/AccessCode/AdminLogEntry/Announcement/GameRow)
// intentionally mirror the original mock shapes so every downstream render
// below needs zero changes — only these mapper functions change what feeds
// them.

function toDisplayUser(u: any, codeMap: Map<string, string>): SampleUser {
  return {
    id: u.id,
    username: u.username,
    email: u.email,
    role: u.role === 'owner' ? 'owner' : 'player',
    status: u.status,
    isOnline: !!u.is_online,
    level: u.level,
    xp: u.xp,
    coins: u.coins ?? 0,
    customTitle: u.custom_title ?? null,
    customTitleAr: u.custom_title_ar ?? null,
    branch: u.branchName ?? null,
    branchAr: u.branchNameAr ?? null,
    branchSlug: u.branchSlug ?? null,
    loginCount: u.login_count,
    lastActive: u.last_login_at ? String(u.last_login_at).slice(0, 10) : '—',
    registeredAt: u.created_at ? String(u.created_at).slice(0, 10) : '—',
    accessCode: u.access_code_id ? (codeMap.get(u.access_code_id) ?? '—') : '—',
    badges: u.badges ?? [],
    badgeIds: u.badgeIds ?? [],
    gamesPlayed: u.gamesPlayed ?? 0,
    avgScore: u.avgScore ?? 0,
    avatarUrl: u.avatar_url ?? null,
  }
}

function toDisplayCode(c: any, userMap: Map<string, { username: string; email: string }>): AccessCode {
  return {
    id: c.id,
    code: c.code,
    note: c.note ?? '',
    maxUses: c.max_uses == null ? 'unlimited' : c.max_uses,
    uses: c.uses,
    status: c.status,
    createdAt: c.created_at ? String(c.created_at).slice(0, 10) : '—',
    expiresAt: c.expires_at ? String(c.expires_at).slice(0, 10) : 'never',
    createdBy: c.created_by ? (userMap.get(c.created_by)?.email ?? c.created_by) : '—',
  }
}

function toDisplayLog(e: any): AdminLogEntry {
  return {
    id: e.id,
    timestamp: e.created_at ? new Date(e.created_at).toLocaleString() : '',
    action: e.action,
    category: e.category,
    target: e.target,
    detail: e.detail,
    targetUserId: e.target_user_id ?? null,
    oldValue: e.old_value ?? null,
    newValue: e.new_value ?? null,
  }
}

function toDisplayAnnouncement(a: any): Announcement {
  return {
    id: a.id,
    title: a.title,
    body: a.body,
    createdAt: a.created_at ? String(a.created_at).slice(0, 10) : '',
    pinned: a.pinned,
    scheduledAt: a.scheduled_at ? String(a.scheduled_at).slice(0, 10) : null,
    expiresAt: a.expires_at ? String(a.expires_at).slice(0, 10) : null,
  }
}

// Splits a chronological (oldest→newest) daily-active-users series into
// fixed-size buckets and sums each bucket. There is no dedicated
// distinct-weekly/monthly-actives RPC on the backend (only daily), so this
// is used as an activity-volume proxy for the "Weekly/Monthly Active"
// charts — it can overcount a user active on multiple days within the same
// bucket, unlike a true unique-reach metric. Documented judgement call.
function chunkSum(series: number[], bucketSize: number): number[] {
  const out: number[] = []
  for (let i = 0; i < series.length; i += bucketSize) {
    out.push(series.slice(i, i + bucketSize).reduce((a, b) => a + b, 0))
  }
  return out
}

function formatAvgDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return '—'
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}m ${s}s`
}

// Genuine client-side CSV export of already-fetched in-memory rows — no export
// backend exists, so this builds the CSV string locally and triggers a
// download via Blob + a temporary <a> link.
function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return
  const headers = Object.keys(rows[0])
  const csv = [headers.join(','), ...rows.map(r=>headers.map(h=>`"${String(r[h] ?? '').replace(/"/g,'""')}"`).join(','))].join('\n')
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click(); document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

// GAME_DATA replacement: admin_get_game_analytics() gives plays/avgScore/
// uniquePlayers/completion directly, but has no columns for avg session
// time, "hardest question", or "topic" (the schema has no topic/category
// concept on questions at all). Those three fields are derived here from
// real tables the owner is allowed to read (game_sessions, questions,
// question_responses) rather than left as fabricated mock text:
//   • avgTime     — avg(completed_at - started_at) over completed sessions
//   • hardestQ    — the question in that game with the lowest correct rate
//   • failedTopic — schema has no topic grouping, so this reuses the same
//                   hardest-question text as the closest real proxy for
//                   "what players struggle with most" (documented judgement
//                   call — not a fabricated topic taxonomy).
async function loadGameAnalytics(): Promise<GameRow[]> {
  const [base, sessionsRes, questionsRes, responsesRes] = await Promise.all([
    adminGetGameAnalytics(),
    supabase.from('game_sessions').select('game_id, started_at, completed_at').eq('status', 'completed'),
    supabase.from('questions').select('id, game_id, question_text, question_text_ar, sort_order'),
    supabase.from('question_responses').select('question_id, is_correct'),
  ])

  const sessions = sessionsRes.data ?? []
  const questions = questionsRes.data ?? []
  const responses = responsesRes.data ?? []

  // avg session duration per game
  const durTotals = new Map<string, { total: number; count: number }>()
  for (const s of sessions as any[]) {
    if (!s.started_at || !s.completed_at) continue
    const secs = (new Date(s.completed_at).getTime() - new Date(s.started_at).getTime()) / 1000
    if (secs <= 0) continue
    const cur = durTotals.get(s.game_id) ?? { total: 0, count: 0 }
    cur.total += secs
    cur.count += 1
    durTotals.set(s.game_id, cur)
  }

  // per-question attempts/correct%
  const qStats = new Map<string, { attempts: number; correct: number }>()
  for (const r of responses as any[]) {
    const cur = qStats.get(r.question_id) ?? { attempts: 0, correct: 0 }
    cur.attempts += 1
    if (r.is_correct) cur.correct += 1
    qStats.set(r.question_id, cur)
  }

  // group questions per game
  const questionsByGame = new Map<string, any[]>()
  for (const q of questions as any[]) {
    const list = questionsByGame.get(q.game_id) ?? []
    list.push(q)
    questionsByGame.set(q.game_id, list)
  }
  for (const list of questionsByGame.values()) list.sort((a, b) => a.sort_order - b.sort_order)

  return (base as any[]).map((g) => {
    const gid = g.game_id
    const dur = durTotals.get(gid)
    const avgTime = dur ? formatAvgDuration(dur.total / dur.count) : '—'
    const gameQuestions = questionsByGame.get(gid) ?? []
    const withStats = gameQuestions.map((q) => {
      const st = qStats.get(q.id) ?? { attempts: 0, correct: 0 }
      const correct = st.attempts > 0 ? Math.round((st.correct / st.attempts) * 100) : 0
      return { textEn: q.question_text, textAr: q.question_text_ar, correct, attempts: st.attempts }
    })
    const attempted = withStats.filter((q) => q.attempts > 0)
    const hardest = attempted.length ? [...attempted].sort((a, b) => a.correct - b.correct)[0] : null
    return {
      id: gid,
      name: g.name,
      nameAr: g.name_ar,
      plays: Number(g.plays) || 0,
      avgScore: Number(g.avg_score) || 0,
      avgTime,
      hardestQ: hardest ? hardest.textEn : '—',
      failedTopic: hardest ? hardest.textEn : '—',
      uniquePlayers: Number(g.unique_players) || 0,
      completion: Number(g.completion_pct) || 0,
      questions: withStats,
    }
  })
}

// ── Icons ─────────────────────────────────────────────────────────────────────

const IcoUsers = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
const IcoKey   = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="7.5" cy="15.5" r="5.5"/><path d="M21 2l-9.6 9.6"/><path d="M15.5 7.5l3 3L22 7l-3-3"/></svg>
const IcoBar   = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
const IcoMega  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 11l19-9-9 19-2-8-8-2z"/></svg>
const IcoLog   = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1" ry="1"/></svg>
const IcoBug   = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="8" y="6" width="8" height="12" rx="4"/><path d="M12 6V3m-4 4-2-2m12 2 2-2M4 12h4m8 0h4M6 18l-2 2m16-2 2 2m-10-1v3m0-14a4 4 0 0 0-4 4"/></svg>
const IcoGrid  = () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
const IcoBranch= () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 21h18"/><path d="M5 21V9l7-6 7 6v12"/><path d="M9 21v-6h6v6"/></svg>
const IcoUp    = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
const IcoDown2 = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
const IcoSearch= () => <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
const IcoCopy  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
const IcoCheck = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
const IcoDown  = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
const IcoRefresh=() => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
const IcoX     = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
const IcoBack  = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
const IcoPin   = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V6h1a2 2 0 0 0 0-4H8a2 2 0 0 0 0 4h1v4.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24Z"/></svg>
const IcoClock = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
const IcoLayers= () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></svg>
const IcoPencil= () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z"/></svg>
const IcoTrash = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M8.5 6V4a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v2"/></svg>
const IcoTrophy= () => <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/></svg>

// ── Design tokens ─────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  card:    { background:'rgba(var(--fg-rgb),0.04)', border:'1px solid rgba(var(--fg-rgb),0.08)', borderRadius:12, padding:'14px 16px' },
  pill:    { display:'inline-flex', alignItems:'center', gap:4, padding:'3px 10px', borderRadius:20, fontSize:11, fontWeight:600, letterSpacing:0.4 },
  primary: { display:'inline-flex', alignItems:'center', gap:6, padding:'9px 16px', borderRadius:8, border:'none', background:'linear-gradient(135deg,#7c3aed,#9d6fff)', color:'#fff', fontSize:13, fontWeight:600, cursor:'pointer', flexShrink:0 },
  ghost:   { display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:8, border:'1px solid rgba(var(--fg-rgb),0.12)', background:'transparent', color:'rgba(var(--fg2-rgb),0.75)', fontSize:13, fontWeight:600, cursor:'pointer', flexShrink:0 },
  danger:  { display:'inline-flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:8, border:'1px solid rgba(255,71,133,0.4)', background:'transparent', color:'#ff4785', fontSize:13, fontWeight:600, cursor:'pointer', flexShrink:0 },
  input:   { width:'100%', background:'rgba(var(--fg-rgb),0.05)', border:'1px solid rgba(var(--fg-rgb),0.1)', borderRadius:8, padding:'10px 12px', color:'var(--foreground)', fontSize:13, outline:'none', boxSizing:'border-box' as const },
  sheet:   { position:'fixed' as const, inset:0, background:'rgba(3,3,15,0.88)', zIndex:9000, display:'flex', alignItems:'flex-end', justifyContent:'center' },
  sheetIn: { background:'#0d0d1f', borderRadius:'20px 20px 0 0', width:'100%', maxWidth:480, maxHeight:'88dvh', overflowY:'auto' as const, padding:'20px 18px 36px' },
  dialog:  { position:'fixed' as const, inset:0, background:'rgba(3,3,15,0.92)', zIndex:9100, display:'flex', alignItems:'center', justifyContent:'center', padding:24 },
  dbox:    { background:'#0d0d1f', borderRadius:16, padding:24, maxWidth:320, width:'100%', border:'1px solid rgba(var(--fg-rgb),0.1)' },
  handle:  { width:36, height:4, borderRadius:2, background:'rgba(var(--fg-rgb),0.15)', margin:'0 auto 16px' },
  label:   { fontSize:11, color:'rgba(var(--fg2-rgb),0.45)', marginBottom:4, display:'block' as const },
  sectionHead: { fontSize:11, fontWeight:700, color:'rgba(var(--fg2-rgb),0.45)', textTransform:'uppercase' as const, letterSpacing:0.8, marginBottom:10 },
}

// ── Skeleton ──────────────────────────────────────────────────────────────────

function Skeleton({ h=14, w='100%', mb=0 }: { h?:number; w?:string|number; mb?:number }) {
  return (
    <div style={{ height:h, width:w, borderRadius:6, background:'rgba(var(--fg-rgb),0.06)', marginBottom:mb,
      animation:'skeleton-pulse 1.4s ease-in-out infinite',
    }}/>
  )
}

function SkeletonCard() {
  return (
    <div style={{...S.card, display:'flex', flexDirection:'column', gap:8}}>
      <div style={{display:'flex', alignItems:'center', gap:10}}>
        <Skeleton h={38} w={38}/>
        <div style={{flex:1}}>
          <Skeleton h={12} w="60%" mb={6}/>
          <Skeleton h={10} w="80%"/>
        </div>
        <Skeleton h={12} w={40}/>
      </div>
    </div>
  )
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ msg, visible, color='#00e676' }: { msg:string; visible:boolean; color?:string }) {
  if (!visible) return null
  return (
    <div style={{ position:'fixed', bottom:88, left:'50%', transform:'translateX(-50%)',
      background:color, color: color==='#00e676'?'#03030f':'#fff',
      padding:'9px 20px', borderRadius:10, fontSize:12, fontWeight:700, zIndex:9200,
      boxShadow:'0 4px 20px rgba(0,0,0,0.4)',
      animation:'toast-in 0.25s ease-out',
    }}>
      {msg}
    </div>
  )
}

// ── Empty state ───────────────────────────────────────────────────────────────

function Empty({ icon, title, sub }: { icon:string; title:string; sub:string }) {
  return (
    <div style={{ textAlign:'center', padding:'40px 20px' }}>
      <div style={{ fontSize:40, marginBottom:12, opacity:0.5 }}>{icon}</div>
      <div style={{ fontSize:14, fontWeight:700, color:'rgba(var(--fg2-rgb),0.55)', marginBottom:6 }}>{title}</div>
      <div style={{ fontSize:12, color:'rgba(var(--fg2-rgb),0.35)' }}>{sub}</div>
    </div>
  )
}

// ── Mini bar chart ────────────────────────────────────────────────────────────

function MiniBarChart({ data, color, height=40 }: { data:number[]; color:string; height?:number }) {
  const max = Math.max(...data)
  return (
    <div style={{ display:'flex', alignItems:'flex-end', gap:3, height }}>
      {data.map((v,i) => (
        <div key={i} style={{ flex:1, height:`${(v/max)*100}%`, background:color, borderRadius:'3px 3px 0 0', opacity:0.7+0.3*(v/max), minWidth:4 }}/>
      ))}
    </div>
  )
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, color }: { label:string; value:string; color:string }) {
  return (
    <div style={{ ...S.card, textAlign:'center', padding:'16px 12px' }}>
      <div style={{ fontSize:26, fontWeight:800, color, fontFamily:"'Exo 2',sans-serif", lineHeight:1 }}>{value}</div>
      <div style={{ fontSize:11, color:'rgba(var(--fg2-rgb),0.5)', marginTop:4, lineHeight:1.3 }}>{label}</div>
    </div>
  )
}

// ── Overview ──────────────────────────────────────────────────────────────────

interface OverviewStatsRow {
  total_users: number
  online_count: number
  registrations_today: number
  suspended_count: number
  active_this_week: number
  total_sessions: number
}

function OverviewTab({ lang, loading, users, games, stats, dau }: { lang:Lang; loading:boolean; users:SampleUser[]; games:GameRow[]; stats:OverviewStatsRow|null; dau:number[] }) {
  const ar = lang === 'ar'

  // Derived from live data fetched at the root of the dashboard.
  const totalUsers    = stats?.total_users ?? users.length
  const onlineCount   = stats?.online_count ?? users.filter(u=>u.isOnline).length
  const suspendedCount= stats?.suspended_count ?? users.filter(u=>u.status==='suspended').length
  const emptyGame: GameRow = { id:'', name:'—', nameAr:'—', plays:0, avgScore:0, avgTime:'—', hardestQ:'—', failedTopic:'—', uniquePlayers:0, completion:0, questions:[] }
  const mostPlayed    = games.length ? [...games].sort((a,b)=>b.plays-a.plays)[0] : emptyGame
  const lowestTopic   = games.length ? [...games].sort((a,b)=>a.avgScore-b.avgScore)[0] : emptyGame
  const mostActive    = users.length ? [...users].sort((a,b)=>b.loginCount-a.loginCount)[0] : { username:'—' } as SampleUser

  const exportCsv = (rows: Record<string, unknown>[], filename: string) => {
    if (!rows.length) return
    const headers = Object.keys(rows[0])
    const csv = [headers.join(','), ...rows.map(r=>headers.map(h=>`"${String(r[h] ?? '').replace(/"/g,'""')}"`).join(','))].join('\n')
    const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = filename
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  if (loading) return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        {[...Array(6)].map((_,i)=><Skeleton key={i} h={72}/>)}
      </div>
      <Skeleton h={160}/>
    </div>
  )
  return (
    <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
      {/* Stats — live aggregates from admin_get_overview_stats() */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:10 }}>
        <StatCard label={ar?'إجمالي المستخدمين':'Total Users'}       value={String(totalUsers)}     color="#9d6fff"/>
        <StatCard label={ar?'متصلون الآن':'Currently Online'}         value={String(onlineCount)}    color="#00e676"/>
        <StatCard label={ar?'تسجيلات اليوم':'Registrations Today'}    value={String(stats?.registrations_today ?? '—')} color="#00d4ff"/>
        <StatCard label={ar?'حسابات موقوفة':'Suspended Accounts'}     value={String(suspendedCount)} color="#ff4785"/>
        <StatCard label={ar?'نشطون هذا الأسبوع':'Active This Week'}   value={String(stats?.active_this_week ?? '—')} color="#ffd700"/>
        <StatCard label={ar?'إجمالي الجلسات':'Total Sessions'}         value={String(stats?.total_sessions ?? '—')} color="#ff6b35"/>
      </div>

      {/* Quick insights — computed from live users/games data */}
      <div style={S.card}>
        <div style={S.sectionHead}>{ar?'رؤى سريعة':'Quick Insights'}</div>
        {[
          { label:ar?'أكثر لعبة تُلعب':'Most Played Game',         value:ar?mostPlayed.nameAr:mostPlayed.name,  color:'#9d6fff' },
          { label:ar?'أصعب موضوع':'Lowest-Scoring Topic',           value:lowestTopic.failedTopic,               color:'#ff4785' },
          { label:ar?'المستخدم الأكثر نشاطاً':'Most Active Player', value:users.length?`@${mostActive.username}`:mostActive.username, color:'#ffd700' },
          { label:ar?'متوسط مدة الجلسة':'Avg Session Length',       value:'—',                                   color:'#00d4ff' },
        ].map(r=>(
          <div key={r.label} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingBottom:8, marginBottom:8, borderBottom:'1px solid rgba(var(--fg-rgb),0.05)' }}>
            <span style={{ fontSize:12, color:'rgba(var(--fg2-rgb),0.65)' }}>{r.label}</span>
            <span style={{ fontSize:12, fontWeight:700, color:r.color }}>{r.value}</span>
          </div>
        ))}
      </div>

      {/* DAU chart — bar fill animates 0→value on mount (see animation spec) */}
      <div style={S.card}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
          <div style={S.sectionHead}>{ar?'المستخدمون النشطون يومياً (14 يوماً)':'Daily Active Users — Last 14 Days'}</div>
        </div>
        <MiniBarChart data={dau.length?dau:[0]} color="#9d6fff" height={52}/>
        <div style={{ display:'flex', justifyContent:'space-between', marginTop:4, fontSize:10, color:'rgba(var(--fg2-rgb),0.35)' }}>
          <span>{ar?'قبل 14 يوم':'14d ago'}</span><span>{ar?'اليوم':'Today'}</span>
        </div>
      </div>

      {/* Exports — genuine client-side CSV of the live users/games data (no export backend exists) */}
      <div style={{ display:'flex', gap:8 }}>
        <button style={{ ...S.ghost, flex:1, justifyContent:'center', fontSize:12 }} onClick={()=>exportCsv(users as unknown as Record<string,unknown>[], 'kastro-users.csv')}><IcoDown/> {ar?'تصدير CSV':'Export CSV'}</button>
        <button style={{ ...S.ghost, flex:1, justifyContent:'center', fontSize:12 }} onClick={()=>exportCsv(games as unknown as Record<string,unknown>[], 'kastro-games.csv')}><IcoDown/> {ar?'تصدير Excel':'Export Excel'}</button>
      </div>
    </div>
  )
}

// ── Users ─────────────────────────────────────────────────────────────────────

// Collapsible card used to keep the user-details panel from becoming one
// long undifferentiated list (spec requirement) — each control group gets
// its own named, independently-expandable section.
function Section({ title, open, onToggle, children, accent }: { title:string; open:boolean; onToggle:()=>void; children:React.ReactNode; accent?:string }) {
  return (
    <div style={{...S.card, marginBottom:10, padding:0, overflow:'hidden'}}>
      <button
        onClick={onToggle}
        style={{
          width:'100%', display:'flex', alignItems:'center', justifyContent:'space-between',
          background:'none', border:'none', cursor:'pointer', padding:'13px 14px',
          color: accent || 'var(--foreground)', textAlign:'start',
        }}
      >
        <span style={{fontSize:12.5, fontWeight:700, letterSpacing:0.3}}>{title}</span>
        <span style={{display:'flex', transition:'transform 0.18s', transform:open?'rotate(180deg)':'rotate(0deg)', color:'rgba(var(--fg2-rgb),0.4)'}}><IcoDown/></span>
      </button>
      {open && <div style={{padding:'0 14px 14px'}}>{children}</div>}
    </div>
  )
}

function UsersTab({ lang, loading, users, achievements, games, refetchUsers, refetchLog }: { lang:Lang; loading:boolean; users:SampleUser[]; achievements:Achievement[]; games:GameRow[]; refetchUsers:()=>Promise<void>; refetchLog:()=>Promise<void> }) {
  const ar = lang === 'ar'
  type FK = 'all'|'active'|'suspended'|'newest'|'oldest'|'mostactive'|'leastactive'|'level'|'xp'|'lastlogin'
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<FK>('all')
  const [selected, setSelected] = useState<SampleUser|null>(null)
  const [openSections, setOpenSections] = useState<Set<string>>(new Set(['overview']))
  const [confirm, setConfirm] = useState<{type:'suspend'|'activate'|'delete'|'resetxp'|'resetcoins';user:SampleUser}|null>(null)
  const [valueDialog, setValueDialog] = useState<{kind:'xp'|'coins'; mode:'add'|'remove'|'set'; user:SampleUser; val:string; reason:string}|null>(null)
  const [badgeModal, setBadgeModal] = useState<{user:SampleUser; tab:'give'|'remove'; selectedId:string}|null>(null)
  const [titleDraft, setTitleDraft] = useState<{title:string; titleAr:string}|null>(null)
  const [statsForm, setStatsForm] = useState<{gameId:string; gp:string; wins:string; cs:string; bs:string; tc:string; tq:string; bsc:string}|null>(null)
  const [userGameStats, setUserGameStats] = useState<Awaited<ReturnType<typeof adminGetUserGameStats>>>([])
  const [history, setHistory] = useState<AdminLogEntry[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [resetModal, setResetModal] = useState<{user:SampleUser; typed:string; preserveBadges:boolean; preserveCosmetics:boolean}|null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{msg:string;color?:string}|null>(null)

  const flash = (msg:string, color?:string) => { setToast({msg,color}); setTimeout(()=>setToast(null),2000) }
  const toggleSection = (key:string) => setOpenSections(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key); else next.add(key)
    return next
  })

  // Keep the open detail sheet in sync with the freshest fetched row (e.g. after XP/status changes).
  useEffect(() => {
    if (!selected) return
    const fresh = users.find(u=>u.id===selected.id)
    if (fresh) setSelected(fresh)
  }, [users])

  // Load this user's per-game stats + account history whenever a new user is opened.
  useEffect(() => {
    if (!selected) { setHistory([]); setUserGameStats([]); return }
    let cancelled = false
    setHistoryLoading(true)
    Promise.all([adminGetUserHistory(selected.id), adminGetUserGameStats(selected.id)]).then(([h, s]) => {
      if (cancelled) return
      setHistory(h.map(toDisplayLog))
      setUserGameStats(s)
      setHistoryLoading(false)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected?.id])

  const chips: {key:FK;label:string}[] = [
    {key:'all',        label:ar?'الكل':'All'},
    {key:'active',     label:ar?'نشط':'Active'},
    {key:'suspended',  label:ar?'موقوف':'Suspended'},
    {key:'newest',     label:ar?'الأحدث':'Newest'},
    {key:'oldest',     label:ar?'الأقدم':'Oldest'},
    {key:'mostactive', label:ar?'الأكثر نشاطاً':'Most Active'},
    {key:'leastactive',label:ar?'الأقل نشاطاً':'Least Active'},
    {key:'level',      label:ar?'المستوى':'Level'},
    {key:'xp',         label:'XP'},
    {key:'lastlogin',  label:ar?'آخر دخول':'Last Login'},
  ]

  const sorted = [...users]
    .filter(u => !search || u.username.toLowerCase().includes(search.toLowerCase()) || u.email.toLowerCase().includes(search.toLowerCase()))
    .filter(u => filter==='active'?u.status==='active':filter==='suspended'?u.status==='suspended':true)
    .sort((a,b) => {
      if (filter==='newest')     return b.registeredAt.localeCompare(a.registeredAt)
      if (filter==='oldest')     return a.registeredAt.localeCompare(b.registeredAt)
      if (filter==='mostactive') return b.loginCount-a.loginCount
      if (filter==='leastactive')return a.loginCount-b.loginCount
      if (filter==='level')      return b.level-a.level
      if (filter==='xp')         return b.xp-a.xp
      if (filter==='lastlogin')  return b.lastActive.localeCompare(a.lastActive)
      return 0
    })

  const isOwnerTarget = (u:SampleUser) => u.role === 'owner'

  const exec = async (type:'suspend'|'activate'|'delete'|'resetxp'|'resetcoins', user:SampleUser) => {
    setBusy(true)
    const { error } =
      type==='delete'      ? await adminDeleteUser(user.id) :
      type==='resetxp'     ? await adminResetUserXp(user.id) :
      type==='resetcoins'  ? await adminResetUserCoins(user.id) :
      await adminSetUserStatus(user.id, type==='suspend'?'suspended':'active')
    setBusy(false)
    setConfirm(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    if (type==='delete') setSelected(null)
    await Promise.all([refetchUsers(), refetchLog()])
    if (selected) adminGetUserHistory(selected.id).then((h)=>setHistory(h.map(toDisplayLog)))
    if (type==='suspend')    flash(ar?'تم تعليق الحساب':'Account suspended','#ff4785')
    if (type==='activate')   flash(ar?'تم تفعيل الحساب':'Account activated')
    if (type==='delete')     flash(ar?'تم حذف الحساب':'Account deleted','#ff4785')
    if (type==='resetxp')    flash(ar?'تمت إعادة تعيين XP إلى 0':'XP reset to 0','#ff4785')
    if (type==='resetcoins') flash(ar?'تمت إعادة تعيين العملات':'Coins reset','#ff4785')
  }

  const applyValueDialog = async () => {
    if (!valueDialog) return
    const n = parseInt(valueDialog.val, 10)
    if (isNaN(n)) { setValueDialog(null); return }
    setBusy(true)
    let error: string | null = null
    if (valueDialog.kind === 'xp') {
      if (valueDialog.mode === 'set') ({ error } = await adminSetUserXp(valueDialog.user.id, n, valueDialog.reason))
      else ({ error } = await adminAdjustXp(valueDialog.user.id, valueDialog.mode==='remove' ? -Math.abs(n) : Math.abs(n), valueDialog.reason))
    } else {
      if (valueDialog.mode === 'set') ({ error } = await adminSetUserCoins(valueDialog.user.id, n, valueDialog.reason))
      else ({ error } = await adminAdjustCoins(valueDialog.user.id, valueDialog.mode==='remove' ? -Math.abs(n) : Math.abs(n), valueDialog.reason))
    }
    setBusy(false)
    setValueDialog(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await Promise.all([refetchUsers(), refetchLog()])
    if (selected) adminGetUserHistory(selected.id).then((h)=>setHistory(h.map(toDisplayLog)))
    flash(ar?'تم الحفظ':'Saved')
  }

  const applyBadgeGive = async (achievementId:string) => {
    if (!badgeModal) return
    setBusy(true)
    const { error } = await adminGiveBadge(badgeModal.user.id, achievementId)
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await Promise.all([refetchUsers(), refetchLog()])
    if (selected) { adminGetUserHistory(selected.id).then((h)=>setHistory(h.map(toDisplayLog))) }
    flash(ar?`تم منح شارة لـ @${badgeModal.user.username}`:`Badge awarded to @${badgeModal.user.username}`,'#ffd700')
  }

  const applyBadgeRemove = async (achievementId:string) => {
    if (!badgeModal) return
    setBusy(true)
    const { error } = await adminRemoveBadge(badgeModal.user.id, achievementId)
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await Promise.all([refetchUsers(), refetchLog()])
    if (selected) { adminGetUserHistory(selected.id).then((h)=>setHistory(h.map(toDisplayLog))) }
    flash(ar?'تمت إزالة الشارة':'Badge removed','#ff4785')
  }

  const saveTitle = async () => {
    if (!selected || !titleDraft) return
    setBusy(true)
    const { error } = await adminSetCustomTitle(selected.id, titleDraft.title.trim(), titleDraft.titleAr.trim())
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await Promise.all([refetchUsers(), refetchLog()])
    if (selected) adminGetUserHistory(selected.id).then((h)=>setHistory(h.map(toDisplayLog)))
    flash(ar?'تم حفظ اللقب':'Title saved')
  }

  const saveStats = async () => {
    if (!selected || !statsForm || !statsForm.gameId) return
    const correction: GameStatCorrection = {
      gamesPlayed: parseInt(statsForm.gp,10)||0,
      wins: parseInt(statsForm.wins,10)||0,
      currentStreak: parseInt(statsForm.cs,10)||0,
      bestStreak: parseInt(statsForm.bs,10)||0,
      totalCorrect: parseInt(statsForm.tc,10)||0,
      totalQuestions: parseInt(statsForm.tq,10)||0,
      bestScore: parseInt(statsForm.bsc,10)||0,
    }
    setBusy(true)
    const { error } = await adminCorrectUserGameStats(selected.id, statsForm.gameId, correction)
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    const fresh = await adminGetUserGameStats(selected.id)
    setUserGameStats(fresh)
    await refetchLog()
    adminGetUserHistory(selected.id).then((h)=>setHistory(h.map(toDisplayLog)))
    flash(ar?'تم تصحيح الإحصائيات':'Statistics corrected')
  }

  const doResetProgress = async () => {
    if (!resetModal || resetModal.typed !== 'RESET') return
    setBusy(true)
    const { error } = await adminResetPlayerProgress(resetModal.user.id, {
      preserveBadges: resetModal.preserveBadges,
      preserveCosmetics: resetModal.preserveCosmetics,
    })
    setBusy(false)
    setResetModal(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await Promise.all([refetchUsers(), refetchLog()])
    if (selected) {
      const [h, s] = await Promise.all([adminGetUserHistory(selected.id), adminGetUserGameStats(selected.id)])
      setHistory(h.map(toDisplayLog)); setUserGameStats(s)
    }
    flash(ar?'تم إعادة ضبط تقدم اللاعب':'Player progress reset','#ff4785')
  }

  const resetPassword = async (user:SampleUser) => {
    setBusy(true)
    const { error } = await adminSendPasswordReset(user.id, user.email)
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await refetchLog()
    if (selected) adminGetUserHistory(selected.id).then((h)=>setHistory(h.map(toDisplayLog)))
    flash(ar?'تم إرسال رابط إعادة التعيين':'Password reset sent')
  }

  if (loading) return <div style={{display:'flex',flexDirection:'column',gap:10}}>{[...Array(4)].map((_,i)=><SkeletonCard key={i}/>)}</div>

  const ownedBadgeSet = new Set(selected?.badgeIds ?? [])
  const givableBadges = achievements.filter(a=>!ownedBadgeSet.has(a.id))
  const removableBadges = achievements.filter(a=>ownedBadgeSet.has(a.id))

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Search */}
      <div style={{position:'relative'}}>
        <span style={{position:'absolute',top:'50%',transform:'translateY(-50%)',left:11,color:'rgba(var(--fg2-rgb),0.4)',pointerEvents:'none',display:'flex'}}><IcoSearch/></span>
        <input style={{...S.input,paddingLeft:32}} placeholder={ar?'بحث باسم المستخدم أو البريد…':'Search username or email…'} value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      {/* Filter chips */}
      <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:2,scrollbarWidth:'none'}}>
        {chips.map(f=>(
          <button key={f.key} onClick={()=>setFilter(f.key)} style={{flexShrink:0,padding:'5px 13px',borderRadius:20,border:'none',cursor:'pointer',fontSize:11,fontWeight:600,transition:'all 0.15s',background:filter===f.key?'linear-gradient(135deg,#7c3aed,#9d6fff)':'rgba(var(--fg-rgb),0.06)',color:filter===f.key?'#fff':'rgba(var(--fg2-rgb),0.6)'}}>
            {f.label}
          </button>
        ))}
      </div>

      {/* Count */}
      <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)'}}>{sorted.length} {ar?'مستخدم':'users'}</div>

      {/* Empty state */}
      {sorted.length===0 && <Empty icon="👤" title={ar?'لا يوجد مستخدمون':'No users found'} sub={ar?'جرب تعديل فلتر البحث':'Try adjusting your search or filter'}/>}

      {/* User rows */}
      {sorted.map(u=>(
        <div key={u.id} style={{...S.card,cursor:'pointer',transition:'background 0.15s'}} onClick={()=>{setSelected(u); setOpenSections(new Set(['overview']))}}>
          <div style={{display:'flex',alignItems:'center',gap:10}}>
            <div style={{position:'relative',flexShrink:0}}>
              <Avatar url={u.avatarUrl} size={40}/>
              {u.isOnline && <div style={{position:'absolute',bottom:1,right:1,width:9,height:9,borderRadius:'50%',background:'#00e676',border:'2px solid #0d0d1f'}}/>}
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                <span style={{fontSize:13,fontWeight:700,color:'var(--foreground)'}}>@{u.username}</span>
                {u.customTitle && <span style={{...S.pill,background:'rgba(255,215,0,0.12)',color:'#ffd700'}}>{lang==='ar'&&u.customTitleAr?u.customTitleAr:u.customTitle}</span>}
                <span style={{...S.pill,background:u.status==='active'?'rgba(0,230,118,0.12)':'rgba(255,71,133,0.12)',color:u.status==='active'?'#00e676':'#ff4785'}}>
                  {u.status==='active'?(ar?'نشط':'Active'):(ar?'موقوف':'Suspended')}
                </span>
              </div>
              <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'90%'}}>{u.email}</div>
            </div>
            <div style={{textAlign:ar?'left':'right',flexShrink:0}}>
              <div style={{fontSize:12,fontWeight:700,color:'#9d6fff'}}>Lv {u.level}</div>
              <div style={{fontSize:10,color:'rgba(var(--fg2-rgb),0.4)'}}>{(u.xp/1000).toFixed(1)}k XP</div>
            </div>
          </div>
        </div>
      ))}

      {/* User detail sheet */}
      {selected && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setSelected(null)}}>
          <div style={{...S.sheetIn, paddingBottom:'max(36px, env(safe-area-inset-bottom))'}}>
            <div style={S.handle}/>

            {/* Header */}
            <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:16}}>
              <div style={{position:'relative'}}>
                <Avatar url={selected.avatarUrl} size={56}/>
                {selected.isOnline && <div style={{position:'absolute',bottom:2,right:2,width:11,height:11,borderRadius:'50%',background:'#00e676',border:'2px solid #0d0d1f'}}/>}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:17,fontWeight:800,color:'var(--foreground)',fontFamily:"'Exo 2',sans-serif"}}>@{selected.username}</div>
                <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.45)',marginTop:1}}>{selected.email}</div>
                <div style={{display:'flex',gap:6,marginTop:6,flexWrap:'wrap'}}>
                  <span style={{...S.pill,background:selected.status==='active'?'rgba(0,230,118,0.12)':'rgba(255,71,133,0.12)',color:selected.status==='active'?'#00e676':'#ff4785'}}>
                    {selected.status==='active'?(ar?'نشط':'Active'):(ar?'موقوف':'Suspended')}
                  </span>
                  <span style={{...S.pill,background:'rgba(157,111,255,0.12)',color:'#9d6fff'}}>{selected.role==='owner'?(ar?'مالك':'Owner'):(ar?'لاعب':'Player')}</span>
                  {selected.customTitle && <span style={{...S.pill,background:'rgba(255,215,0,0.12)',color:'#ffd700'}}>{lang==='ar'&&selected.customTitleAr?selected.customTitleAr:selected.customTitle}</span>}
                </div>
              </div>
            </div>

            {/* ── Account Overview ──────────────────────────────────────── */}
            <Section title={ar?'نظرة عامة على الحساب':'Account Overview'} open={openSections.has('overview')} onToggle={()=>toggleSection('overview')}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                {[
                  {l:ar?'المستوى':'Level',           v:selected.level},
                  {l:ar?'نقاط XP':'XP',              v:selected.xp.toLocaleString()},
                  {l:ar?'العملات':'Coins',           v:selected.coins.toLocaleString()},
                  {l:ar?'عدد الجلسات':'Login Count',  v:selected.loginCount},
                  {l:ar?'كود التسجيل':'Access Code',  v:selected.accessCode},
                  {l:ar?'تاريخ التسجيل':'Registered', v:selected.registeredAt},
                  {l:ar?'ألعاب مكتملة':'Games Played',v:selected.gamesPlayed},
                  {l:ar?'متوسط النتيجة':'Avg Score',  v:`${selected.avgScore}%`},
                  {l:ar?'الفرع':'Branch',             v:selected.branch ? (ar && selected.branchAr ? selected.branchAr : selected.branch) : (ar?'—':'—')},
                ].map(s=>(
                  <div key={s.l} style={{background:'rgba(var(--fg-rgb),0.04)',borderRadius:8,padding:'9px 10px'}}>
                    <div style={{fontSize:10,color:'rgba(var(--fg2-rgb),0.4)',marginBottom:3}}>{s.l}</div>
                    <div style={{fontSize:13,fontWeight:700,color:'var(--foreground)'}}>{String(s.v)}</div>
                  </div>
                ))}
              </div>
            </Section>

            {/* ── Status and Access ─────────────────────────────────────── */}
            <Section title={ar?'الحالة والوصول':'Status and Access'} open={openSections.has('status')} onToggle={()=>toggleSection('status')}>
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {selected.status==='active'
                  ?<button style={{...S.danger,justifyContent:'center',width:'100%'}} disabled={busy||isOwnerTarget(selected)} onClick={()=>setConfirm({type:'suspend',user:selected})}>{ar?'تعليق الحساب':'Suspend Account'}</button>
                  :<button style={{...S.ghost,justifyContent:'center',width:'100%',color:'#00e676',border:'1px solid rgba(0,230,118,0.3)'}} disabled={busy} onClick={()=>setConfirm({type:'activate',user:selected})}>{ar?'تفعيل الحساب':'Activate Account'}</button>
                }
                {isOwnerTarget(selected) && <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'لا يمكن تعليق حساب المالك.':'The owner account cannot be suspended.'}</div>}
                <button style={{...S.ghost,justifyContent:'center',width:'100%'}} disabled={busy} onClick={()=>resetPassword(selected)}>{ar?'إرسال رابط إعادة تعيين كلمة المرور':'Send Password Reset'}</button>
              </div>
            </Section>

            {/* ── XP, Level and Coins ───────────────────────────────────── */}
            <Section title={ar?'XP والمستوى والعملات':'XP, Level and Coins'} open={openSections.has('econ')} onToggle={()=>toggleSection('econ')}>
              <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.45)',marginBottom:8}}>{ar?`الحالي: ${selected.xp.toLocaleString()} XP · المستوى ${selected.level}`:`Current: ${selected.xp.toLocaleString()} XP · Level ${selected.level}`}</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8,marginBottom:10}}>
                <button style={S.ghost} disabled={busy} onClick={()=>setValueDialog({kind:'xp',mode:'add',user:selected,val:'',reason:''})}>{ar?'إضافة XP':'Add XP'}</button>
                <button style={S.ghost} disabled={busy} onClick={()=>setValueDialog({kind:'xp',mode:'remove',user:selected,val:'',reason:''})}>{ar?'خصم XP':'Remove XP'}</button>
                <button style={S.ghost} disabled={busy} onClick={()=>setValueDialog({kind:'xp',mode:'set',user:selected,val:String(selected.xp),reason:''})}>{ar?'تحديد قيمة XP':'Set Exact XP'}</button>
                <button style={{...S.ghost,color:'#ff4785',borderColor:'rgba(255,71,133,0.3)'}} disabled={busy} onClick={()=>setConfirm({type:'resetxp',user:selected})}>{ar?'إعادة تعيين XP إلى 0':'Reset XP to 0'}</button>
              </div>
              <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.45)',margin:'12px 0 8px'}}>{ar?`رصيد العملات الحالي: ${selected.coins.toLocaleString()}`:`Current coin balance: ${selected.coins.toLocaleString()}`}</div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:8}}>
                <button style={S.ghost} disabled={busy} onClick={()=>setValueDialog({kind:'coins',mode:'add',user:selected,val:'',reason:''})}>{ar?'إضافة عملات':'Add Coins'}</button>
                <button style={S.ghost} disabled={busy} onClick={()=>setValueDialog({kind:'coins',mode:'remove',user:selected,val:'',reason:''})}>{ar?'خصم عملات':'Remove Coins'}</button>
                <button style={S.ghost} disabled={busy} onClick={()=>setValueDialog({kind:'coins',mode:'set',user:selected,val:String(selected.coins),reason:''})}>{ar?'تحديد رصيد دقيق':'Set Exact Coins'}</button>
                <button style={{...S.ghost,color:'#ff4785',borderColor:'rgba(255,71,133,0.3)'}} disabled={busy} onClick={()=>setConfirm({type:'resetcoins',user:selected})}>{ar?'إعادة تعيين العملات إلى 0':'Reset Coins to 0'}</button>
              </div>
            </Section>

            {/* ── Statistics ─────────────────────────────────────────────── */}
            <Section title={ar?'الإحصائيات':'Statistics'} open={openSections.has('stats')} onToggle={()=>toggleSection('stats')}>
              <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)',marginBottom:10,lineHeight:1.5}}>
                {ar?'الفوز/الخسارة والمتوسط تُحسب دائماً من هذه القيم — لا تُخزَّن بشكل منفصل، لذا تصحيحها هنا يبقيها متسقة في كل مكان.':'Losses and average score are always derived from these values, never stored separately — correcting them here keeps every other screen consistent.'}
              </div>
              <select
                style={{...S.input,marginBottom:10}}
                value={statsForm?.gameId ?? ''}
                onChange={e=>{
                  const gameId = e.target.value
                  const row = userGameStats.find(r=>r.game_id===gameId)
                  setStatsForm({
                    gameId,
                    gp: String(row?.games_played ?? 0),
                    wins: String(row?.wins ?? 0),
                    cs: String(row?.current_streak ?? 0),
                    bs: String(row?.best_streak ?? 0),
                    tc: String(row?.total_correct ?? 0),
                    tq: String(row?.total_questions ?? 0),
                    bsc: String(row?.best_score ?? 0),
                  })
                }}
              >
                <option value="">{ar?'اختر لعبة للتصحيح…':'Select a game to correct…'}</option>
                {games.map(g=><option key={g.id} value={g.id}>{ar?g.nameAr:g.name}</option>)}
              </select>

              {statsForm && statsForm.gameId && (() => {
                const row = userGameStats.find(r=>r.game_id===statsForm.gameId)
                const losses = Math.max(0, (parseInt(statsForm.gp,10)||0) - (parseInt(statsForm.wins,10)||0))
                const tq = parseInt(statsForm.tq,10)||0
                const tc = parseInt(statsForm.tc,10)||0
                const avg = tq>0 ? Math.round((tc/tq)*100) : 0
                return (
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {!row && <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'لا توجد إحصائيات مسجلة لهذه اللعبة بعد — التصحيح سينشئ سجلاً جديداً.':'No stats recorded for this game yet — correcting will create a new row.'}</div>}
                    {[
                      {k:'gp',  l:ar?'ألعاب مكتملة':'Games Played'},
                      {k:'wins',l:ar?'فوز':'Wins'},
                      {k:'cs',  l:ar?'التتابع الحالي':'Current Streak'},
                      {k:'bs',  l:ar?'أفضل تتابع':'Best Streak'},
                      {k:'tc',  l:ar?'إجابات صحيحة':'Total Correct'},
                      {k:'tq',  l:ar?'إجمالي الأسئلة':'Total Questions'},
                      {k:'bsc', l:ar?'أفضل نتيجة':'Best Score'},
                    ].map(f=>(
                      <div key={f.k} style={{display:'flex',alignItems:'center',gap:8}}>
                        <label style={{flex:1,fontSize:12,color:'rgba(var(--fg2-rgb),0.6)'}}>{f.l}</label>
                        <input
                          style={{...S.input,width:90}}
                          type="number"
                          value={(statsForm as any)[f.k]}
                          onChange={e=>setStatsForm({...statsForm,[f.k]:e.target.value})}
                        />
                      </div>
                    ))}
                    <div style={{display:'flex',gap:16,fontSize:11,color:'rgba(var(--fg2-rgb),0.45)',marginTop:2}}>
                      <span>{ar?'الخسائر (مُشتقة):':'Losses (derived):'} <strong style={{color:'var(--foreground)'}}>{losses}</strong></span>
                      <span>{ar?'المتوسط (مُشتق):':'Average (derived):'} <strong style={{color:'var(--foreground)'}}>{avg}%</strong></span>
                    </div>
                    <button style={{...S.primary,justifyContent:'center',marginTop:6}} disabled={busy} onClick={saveStats}>{ar?'حفظ التصحيح':'Save Correction'}</button>
                  </div>
                )
              })()}
            </Section>

            {/* ── Roles and Custom Title ────────────────────────────────── */}
            <Section title={ar?'الأدوار واللقب المخصص':'Roles and Custom Title'} open={openSections.has('role')} onToggle={()=>{toggleSection('role'); if(!titleDraft) setTitleDraft({title:selected.customTitle??'', titleAr:selected.customTitleAr??''})}}>
              <div style={{marginBottom:14}}>
                <div style={S.label}>{ar?'وصول النظام':'System access'}</div>
                <div style={{fontSize:13,fontWeight:700,color:'var(--foreground)'}}>{selected.role==='owner'?(ar?'مالك':'Owner'):(ar?'لاعب':'Player')}</div>
                <div style={{fontSize:10,color:'rgba(var(--fg2-rgb),0.35)',marginTop:2}}>{ar?'محمي على مستوى قاعدة البيانات — لا يمكن تغييره من هذه الواجهة.':'Database-enforced — cannot be changed from this screen.'}</div>
              </div>
              <div>
                <div style={S.label}>{ar?'اللقب المخصص (إنجليزي)':'Custom title (English)'}</div>
                <input style={{...S.input,marginBottom:8}} placeholder={ar?'مثال: قائد الفريق':'e.g. Team Leader'} value={titleDraft?.title ?? ''} onChange={e=>setTitleDraft({title:e.target.value, titleAr:titleDraft?.titleAr ?? ''})} maxLength={40}/>
                <div style={S.label}>{ar?'اللقب المخصص (عربي)':'Custom title (Arabic)'}</div>
                <input style={{...S.input,marginBottom:10}} placeholder="مثال: قائد الفريق" value={titleDraft?.titleAr ?? ''} onChange={e=>setTitleDraft({title:titleDraft?.title ?? '', titleAr:e.target.value})} maxLength={40}/>
                <button style={{...S.primary,justifyContent:'center',width:'100%'}} disabled={busy} onClick={saveTitle}>{ar?'حفظ اللقب':'Save Title'}</button>
              </div>
            </Section>

            {/* ── Badges and Achievements ───────────────────────────────── */}
            <Section title={ar?'الشارات والإنجازات':'Badges and Achievements'} open={openSections.has('badges')} onToggle={()=>toggleSection('badges')}>
              {selected.badges.length>0
                ? <div style={{display:'flex',gap:6,flexWrap:'wrap',marginBottom:12}}>
                    {selected.badges.map(b=><span key={b} style={{...S.pill,background:'rgba(157,111,255,0.12)',color:'#9d6fff'}}>{b}</span>)}
                  </div>
                : <div style={{marginBottom:12,fontSize:12,color:'rgba(var(--fg2-rgb),0.3)'}}>{ar?'لا توجد شارات بعد.':'No badges yet.'}</div>
              }
              <button style={{...S.ghost,justifyContent:'center',width:'100%',color:'#ffd700',border:'1px solid rgba(255,215,0,0.25)'}} disabled={busy} onClick={()=>setBadgeModal({user:selected,tab:'give',selectedId:''})}>{ar?'إدارة الشارات':'Manage Badges'}</button>
            </Section>

            {/* ── Account History ────────────────────────────────────────── */}
            <Section title={ar?'سجل الحساب':'Account History'} open={openSections.has('history')} onToggle={()=>toggleSection('history')}>
              {historyLoading && <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.35)'}}>{ar?'جارٍ التحميل…':'Loading…'}</div>}
              {!historyLoading && history.length===0 && (
                <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.35)'}}>{ar?'لا توجد أحداث حديثة.':'No recent account events recorded.'}</div>
              )}
              {!historyLoading && history.length>0 && (
                <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:280,overflowY:'auto'}}>
                  {history.map(h=>(
                    <div key={h.id} style={{background:'rgba(var(--fg-rgb),0.03)',borderRadius:8,padding:'8px 10px'}}>
                      <div style={{display:'flex',justifyContent:'space-between',gap:8}}>
                        <span style={{fontSize:12,fontWeight:700,color:'var(--foreground)'}}>{h.action}</span>
                        <span style={{fontSize:10,color:'rgba(var(--fg2-rgb),0.35)',flexShrink:0}}>{h.timestamp}</span>
                      </div>
                      {h.detail && <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.5)',marginTop:2}}>{h.detail}</div>}
                      {(h.oldValue || h.newValue) && (
                        <div style={{fontSize:10,color:'rgba(var(--fg2-rgb),0.4)',marginTop:2}}>
                          {h.oldValue ?? '—'} → {h.newValue ?? '—'}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {/* ── Reset and Destructive Actions ─────────────────────────── */}
            <Section title={ar?'إعادة الضبط والإجراءات الحساسة':'Reset and Destructive Actions'} open={openSections.has('danger')} onToggle={()=>toggleSection('danger')} accent="#ff4785">
              {isOwnerTarget(selected) ? (
                <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.45)'}}>{ar?'لا يمكن إعادة ضبط أو حذف حساب المالك.':'The owner account cannot be reset or deleted.'}</div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  <button style={{...S.danger,justifyContent:'center',width:'100%'}} disabled={busy} onClick={()=>setResetModal({user:selected,typed:'',preserveBadges:false,preserveCosmetics:false})}>{ar?'إعادة ضبط تقدم اللاعب':'Reset Player Progress'}</button>
                  <button style={{...S.danger,justifyContent:'center',width:'100%'}} disabled={busy} onClick={()=>setConfirm({type:'delete',user:selected})}>{ar?'حذف الحساب':'Delete Account'}</button>
                </div>
              )}
            </Section>

            <button style={{...S.ghost,width:'100%',justifyContent:'center',marginTop:4}} onClick={()=>setSelected(null)}>{ar?'إغلاق':'Close'}</button>
          </div>
        </div>
      )}

      {/* Confirm dialog — status / delete / XP+coin resets */}
      {confirm && (
        <div style={S.dialog}>
          <div style={S.dbox}>
            <div style={{fontSize:15,fontWeight:700,color:confirm.type==='activate'?'#00e676':'#ff4785',marginBottom:8}}>
              {confirm.type==='delete'?(ar?'تأكيد الحذف':'Confirm Delete')
                :confirm.type==='suspend'?(ar?'تأكيد التعليق':'Confirm Suspend')
                :confirm.type==='resetxp'?(ar?'تأكيد إعادة تعيين XP':'Confirm XP Reset')
                :confirm.type==='resetcoins'?(ar?'تأكيد إعادة تعيين العملات':'Confirm Coin Reset')
                :(ar?'تأكيد التفعيل':'Confirm Activate')}
            </div>
            <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.55)',lineHeight:1.5,marginBottom:20}}>
              {confirm.type==='delete'
                ?(ar?`سيتم حذف حساب "@${confirm.user.username}" نهائياً. لا يمكن التراجع عن هذا الإجراء.`:`"@${confirm.user.username}"'s account will be permanently deleted. This cannot be undone.`)
                :confirm.type==='suspend'
                ?(ar?`سيتم تعليق حساب "@${confirm.user.username}". سيتم الحفاظ على تقدمهم.`:`"@${confirm.user.username}" will be suspended. Their progress will be preserved.`)
                :confirm.type==='resetxp'
                ?(ar?`سيتم تعيين XP لـ "@${confirm.user.username}" إلى 0.`:`Reset this user's XP to 0?`)
                :confirm.type==='resetcoins'
                ?(ar?`سيتم تعيين رصيد عملات "@${confirm.user.username}" إلى الرصيد الافتراضي.`:`Reset this user's coins to the starting balance?`)
                :(ar?`سيتم إعادة تفعيل حساب "@${confirm.user.username}".`:`"@${confirm.user.username}"'s account will be reactivated.`)}
            </div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} disabled={busy} onClick={()=>setConfirm(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button
                style={{...(confirm.type==='activate'?{...S.ghost,color:'#00e676',border:'1px solid rgba(0,230,118,0.3)'}:S.danger),flex:1,justifyContent:'center'}}
                disabled={busy}
                onClick={()=>exec(confirm.type,confirm.user)}>
                {confirm.type==='delete'?(ar?'حذف':'Delete')
                  :confirm.type==='suspend'?(ar?'تعليق':'Suspend')
                  :confirm.type==='resetxp'?(ar?'إعادة التعيين':'Reset')
                  :confirm.type==='resetcoins'?(ar?'إعادة التعيين':'Reset')
                  :(ar?'تفعيل':'Activate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add/Remove/Set XP or Coins dialog */}
      {valueDialog && (
        <div style={S.dialog}>
          <div style={S.dbox}>
            <div style={{fontSize:15,fontWeight:700,color:'var(--foreground)',marginBottom:4}}>
              {valueDialog.kind==='xp'
                ? (valueDialog.mode==='set' ? (ar?'تحديد قيمة XP':'Set Exact XP') : valueDialog.mode==='add' ? (ar?'إضافة XP':'Add XP') : (ar?'خصم XP':'Remove XP'))
                : (valueDialog.mode==='set' ? (ar?'تحديد رصيد العملات':'Set Exact Coins') : valueDialog.mode==='add' ? (ar?'إضافة عملات':'Add Coins') : (ar?'خصم عملات':'Remove Coins'))
              }
            </div>
            <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.4)',marginBottom:12}}>
              {ar?`الحالي: `:`Current: `}{valueDialog.kind==='xp' ? valueDialog.user.xp.toLocaleString() : valueDialog.user.coins.toLocaleString()}{valueDialog.kind==='xp'?' XP':(ar?' عملة':' coins')}
            </div>
            <input
              style={{...S.input,marginBottom:10}}
              type="number"
              min={0}
              placeholder={valueDialog.mode==='set' ? (ar?'القيمة الجديدة':'New value') : (ar?'المقدار':'Amount')}
              value={valueDialog.val}
              onChange={e=>setValueDialog({...valueDialog,val:e.target.value})}
              autoFocus
            />
            <input
              style={{...S.input,marginBottom:14}}
              placeholder={ar?'السبب (اختياري)':'Reason (optional)'}
              value={valueDialog.reason}
              onChange={e=>setValueDialog({...valueDialog,reason:e.target.value})}
            />
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} disabled={busy} onClick={()=>setValueDialog(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy || !valueDialog.val} onClick={applyValueDialog}>{ar?'تطبيق':'Apply'}</button>
            </div>
          </div>
        </div>
      )}

      {/* Give / Remove badge — tabbed */}
      {badgeModal && (
        <div style={S.dialog}>
          <div style={S.dbox}>
            <div style={{fontSize:15,fontWeight:700,color:'var(--foreground)',marginBottom:4}}>{ar?'إدارة الشارات':'Manage Badges'}</div>
            <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.4)',marginBottom:12}}>@{badgeModal.user.username}</div>

            <div style={{display:'flex',gap:6,marginBottom:14,background:'rgba(var(--fg-rgb),0.05)',borderRadius:8,padding:3}}>
              <button
                onClick={()=>setBadgeModal({...badgeModal,tab:'give',selectedId:''})}
                style={{flex:1,padding:'7px 0',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:700,background:badgeModal.tab==='give'?'linear-gradient(135deg,#7c3aed,#9d6fff)':'transparent',color:badgeModal.tab==='give'?'#fff':'rgba(var(--fg2-rgb),0.6)'}}
              >{ar?'منح شارة':'Give Badge'}</button>
              <button
                onClick={()=>setBadgeModal({...badgeModal,tab:'remove',selectedId:''})}
                style={{flex:1,padding:'7px 0',borderRadius:6,border:'none',cursor:'pointer',fontSize:12,fontWeight:700,background:badgeModal.tab==='remove'?'linear-gradient(135deg,#ff4785,#ff6fa5)':'transparent',color:badgeModal.tab==='remove'?'#fff':'rgba(var(--fg2-rgb),0.6)'}}
              >{ar?'سحب شارة':'Remove Badge'}</button>
            </div>

            {badgeModal.tab==='give' ? (
              givableBadges.length===0 ? (
                <Empty icon="🏅" title={ar?'لا توجد شارات لمنحها':'No badges to give'} sub={ar?'يملك هذا المستخدم كل الشارات المتاحة بالفعل.':'This user already owns every available badge.'}/>
              ) : (
                <>
                  <select style={{...S.input,marginBottom:14}} value={badgeModal.selectedId} onChange={e=>setBadgeModal({...badgeModal,selectedId:e.target.value})}>
                    <option value="">{ar?'اختر شارة…':'Select a badge…'}</option>
                    {givableBadges.map(a=><option key={a.id} value={a.id}>{lang==='ar'&&a.nameAr?a.nameAr:a.name}</option>)}
                  </select>
                  <div style={{display:'flex',gap:8}}>
                    <button style={{...S.ghost,flex:1,justifyContent:'center'}} disabled={busy} onClick={()=>setBadgeModal(null)}>{ar?'إلغاء':'Cancel'}</button>
                    <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy||!badgeModal.selectedId} onClick={()=>applyBadgeGive(badgeModal.selectedId)}>{ar?'منح':'Give'}</button>
                  </div>
                </>
              )
            ) : (
              removableBadges.length===0 ? (
                <Empty icon="🏅" title={ar?'لا توجد شارات لسحبها':'No badges to remove'} sub={ar?'لا يملك هذا المستخدم أي شارات بعد.':'This user does not own any badges yet.'}/>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {removableBadges.map(a=>(
                    <div key={a.id} style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,background:'rgba(var(--fg-rgb),0.04)',borderRadius:8,padding:'8px 10px'}}>
                      <span style={{fontSize:13,color:'var(--foreground)'}}>{lang==='ar'&&a.nameAr?a.nameAr:a.name}</span>
                      <button style={{...S.danger,padding:'5px 10px',fontSize:11}} disabled={busy} onClick={()=>applyBadgeRemove(a.id)}>{ar?'سحب':'Remove'}</button>
                    </div>
                  ))}
                  <button style={{...S.ghost,justifyContent:'center',marginTop:4}} disabled={busy} onClick={()=>setBadgeModal(null)}>{ar?'إغلاق':'Close'}</button>
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* Reset Player Progress — serious, type-to-confirm */}
      {resetModal && (
        <div style={S.dialog}>
          <div style={{...S.dbox,maxWidth:360}}>
            <div style={{fontSize:15,fontWeight:700,color:'#ff4785',marginBottom:8}}>{ar?'إعادة ضبط تقدم اللاعب':'Reset Player Progress'}</div>
            <div style={{fontSize:12.5,color:'rgba(var(--fg2-rgb),0.6)',lineHeight:1.6,marginBottom:12}}>
              {ar
                ? `سيتم إعادة تعيين XP والمستوى والعملات والإحصائيات وتقدم التحديات والمواسم لـ "@${resetModal.user.username}" إلى حالة لاعب جديد. سيتم الاحتفاظ بالحساب والبريد الإلكتروني واسم المستخدم وتاريخ التسجيل والفرع. لا يمكن التراجع عن هذا الإجراء.`
                : `XP, level, coins, statistics, challenge progress, and season progress for "@${resetModal.user.username}" will be reset to a fresh-player state. The account, email, username, registration date, and branch are preserved. This cannot be undone.`}
            </div>
            <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'rgba(var(--fg2-rgb),0.6)',marginBottom:8,cursor:'pointer'}}>
              <input type="checkbox" checked={resetModal.preserveBadges} onChange={e=>setResetModal({...resetModal,preserveBadges:e.target.checked})}/>
              {ar?'الاحتفاظ بالشارات المكتسبة':'Preserve earned badges'}
            </label>
            <label style={{display:'flex',alignItems:'center',gap:8,fontSize:12,color:'rgba(var(--fg2-rgb),0.6)',marginBottom:14,cursor:'pointer'}}>
              <input type="checkbox" checked={resetModal.preserveCosmetics} onChange={e=>setResetModal({...resetModal,preserveCosmetics:e.target.checked})}/>
              {ar?'الاحتفاظ بمقتنيات المظهر':'Preserve cosmetic inventory'}
            </label>
            <div style={S.label}>{ar?'اكتب RESET للتأكيد':'Type RESET to confirm'}</div>
            <input style={{...S.input,marginBottom:14}} value={resetModal.typed} onChange={e=>setResetModal({...resetModal,typed:e.target.value})} placeholder="RESET" autoFocus/>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} disabled={busy} onClick={()=>setResetModal(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.danger,flex:1,justifyContent:'center'}} disabled={busy || resetModal.typed!=='RESET'} onClick={doResetProgress}>{ar?'إعادة الضبط':'Reset Progress'}</button>
            </div>
          </div>
        </div>
      )}

      <Toast msg={toast?.msg||''} visible={!!toast} color={toast?.color}/>
    </div>
  )
}

// ── Access Codes ──────────────────────────────────────────────────────────────

function CodesTab({ lang, loading, codes, refetchCodes, refetchLog, userEmail }: { lang:Lang; loading:boolean; codes:AccessCode[]; refetchCodes:()=>Promise<void>; refetchLog:()=>Promise<void>; userEmail:string }) {
  const ar = lang === 'ar'
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({note:'',maxUses:'50',unlimited:false,expiry:'never' as 'never'|'7d'|'30d'|'custom',customDate:'',code:''})
  const [created, setCreated] = useState<AccessCode|null>(null)
  const [confirmDisable, setConfirmDisable] = useState<AccessCode|null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AccessCode|null>(null)
  const [viewUsers, setViewUsers] = useState<AccessCode|null>(null)
  const [viewUsersList, setViewUsersList] = useState<{id:string;username:string;email:string;status:'active'|'suspended';avatarUrl:string|null}[]|null>(null)
  const [viewUsersLoading, setViewUsersLoading] = useState(false)
  const [copiedId, setCopiedId] = useState<string|null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{msg:string;color?:string}|null>(null)

  const flash = (msg:string,color?:string) => { setToast({msg,color}); setTimeout(()=>setToast(null),2000) }

  const randCode = () => {
    const c='ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s=''
    for(let i=0;i<8;i++) s+=c[Math.floor(Math.random()*c.length)]
    return s
  }

  const handleCopy = (code:string, id:string) => {
    navigator.clipboard.writeText(code).catch(()=>{})
    setCopiedId(id)
    flash(ar?'تم نسخ الكود!':'Code copied!')
    setTimeout(()=>setCopiedId(null),2000)
  }

  useEffect(() => {
    if (!viewUsers) { setViewUsersList(null); return }
    let cancelled = false
    setViewUsersLoading(true)
    adminGetUsersByCode(viewUsers.code).then(rows => {
      if (cancelled) return
      setViewUsersList((rows as any[]).map(u => ({ id:u.id, username:u.username, email:u.email, status:u.status, avatarUrl:u.avatar_url ?? null })))
      setViewUsersLoading(false)
    })
    return () => { cancelled = true }
  }, [viewUsers])

  const create = async () => {
    const exp = form.expiry==='never'?null:form.expiry==='7d'?new Date(Date.now()+7*86400000).toISOString().slice(0,10):form.expiry==='30d'?new Date(Date.now()+30*86400000).toISOString().slice(0,10):(form.customDate||null)
    const maxUses = form.unlimited?null:(parseInt(form.maxUses)||50)
    setBusy(true)
    const { error, data } = await adminCreateAccessCode(form.note, maxUses, exp, form.code || undefined)
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setShowCreate(false)
    setForm({note:'',maxUses:'50',unlimited:false,expiry:'never',customDate:'',code:''})
    await Promise.all([refetchCodes(), refetchLog()])
    if (data) {
      const d = data as any
      setCreated({
        id:d.id, code:d.code, note:d.note ?? '',
        maxUses:d.max_uses==null?'unlimited':d.max_uses, uses:d.uses ?? 0, status:d.status,
        createdAt:d.created_at?String(d.created_at).slice(0,10):new Date().toISOString().slice(0,10),
        expiresAt:d.expires_at?String(d.expires_at).slice(0,10):'never',
        createdBy:userEmail,
      })
    }
  }

  const toggle = async (c:AccessCode) => {
    setBusy(true)
    const { error } = await adminToggleAccessCode(c.id)
    setBusy(false)
    setConfirmDisable(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await Promise.all([refetchCodes(), refetchLog()])
    flash(c.status==='active'?(ar?'تم تعطيل الكود':'Code disabled'):(ar?'تم تفعيل الكود':'Code enabled'))
  }
  const del = async (c:AccessCode) => {
    setBusy(true)
    const { error } = await adminDeleteAccessCode(c.id)
    setBusy(false)
    setConfirmDelete(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await Promise.all([refetchCodes(), refetchLog()])
    flash(ar?'تم حذف الكود':'Code deleted','#ff4785')
  }

  if (loading) return <div style={{display:'flex',flexDirection:'column',gap:10}}>{[...Array(3)].map((_,i)=><Skeleton key={i} h={120}/>)}</div>

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <button style={{...S.primary,alignSelf:'flex-start'}} onClick={()=>setShowCreate(true)}>
        + {ar?'إنشاء كود جديد':'Create New Code'}
      </button>

      {codes.length===0 && <Empty icon="🔑" title={ar?'لا توجد أكواد':'No access codes'} sub={ar?'أنشئ كوداً للسماح للمستخدمين بالتسجيل':'Create a code to allow user registration'}/>}

      {codes.map(c=>{
        const rem = c.maxUses==='unlimited'?null:(c.maxUses as number)-c.uses
        const pct = c.maxUses==='unlimited'?0:Math.round((c.uses/(c.maxUses as number))*100)
        const isCopied = copiedId===c.id
        return (
          <div key={c.id} style={S.card}>
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
              <span style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,fontWeight:800,color:'#00d4ff',letterSpacing:2,flex:1}}>{c.code}</span>
              <span style={{...S.pill,background:c.status==='active'?'rgba(0,230,118,0.12)':'rgba(255,71,133,0.12)',color:c.status==='active'?'#00e676':'#ff4785'}}>
                {c.status==='active'?(ar?'نشط':'Active'):(ar?'معطل':'Disabled')}
              </span>
              <button
                onClick={()=>handleCopy(c.code,c.id)}
                style={{background:isCopied?'rgba(0,230,118,0.15)':'rgba(var(--fg-rgb),0.05)',border:`1px solid ${isCopied?'rgba(0,230,118,0.3)':'rgba(var(--fg-rgb),0.1)'}`,borderRadius:6,padding:'5px 8px',cursor:'pointer',color:isCopied?'#00e676':'rgba(var(--fg2-rgb),0.55)',display:'flex',alignItems:'center',gap:4,fontSize:11,fontWeight:600,transition:'all 0.2s',flexShrink:0}}>
                {isCopied?<><IcoCheck/> {ar?'تم':'Done'}</>:<><IcoCopy/> {ar?'نسخ':'Copy'}</>}
              </button>
            </div>

            {c.note && <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.55)',marginBottom:8}}>{c.note}</div>}

            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,fontSize:11,marginBottom:8}}>
              <div><span style={{color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'الاستخدامات:':'Uses:'} </span><b style={{color:'var(--foreground)'}}>{c.uses} / {c.maxUses==='unlimited'?'∞':c.maxUses}</b></div>
              {rem!==null && <div><span style={{color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'المتبقي:':'Remaining:'} </span><b style={{color:rem<=5?'#ff4785':rem<=15?'#ffd700':'#00e676'}}>{rem}</b></div>}
              <div><span style={{color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'ينتهي:':'Expires:'} </span><b style={{color:'var(--foreground)'}}>{c.expiresAt==='never'?(ar?'لا ينتهي':'Never'):c.expiresAt}</b></div>
              <div><span style={{color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'أُنشئ:':'Created:'} </span><b style={{color:'var(--foreground)'}}>{c.createdAt}</b></div>
              <div style={{gridColumn:'1/-1'}}><span style={{color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'بواسطة:':'By:'} </span><b style={{color:'rgba(var(--fg2-rgb),0.7)',fontSize:10}}>{c.createdBy}</b></div>
            </div>

            {c.maxUses!=='unlimited' && (
              <div style={{height:4,background:'rgba(var(--fg-rgb),0.07)',borderRadius:2,overflow:'hidden',marginBottom:10}}>
                <div style={{height:'100%',width:'100%',transform:`scaleX(${pct/100})`,transformOrigin:ar?'right center':'left center',background:pct>=90?'#ff4785':pct>=60?'#ffd700':'#00e676',borderRadius:2,transition:'transform 0.4s'}}/>
              </div>
            )}

            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              <button style={{...S.ghost,fontSize:11,padding:'6px 12px'}} onClick={()=>setViewUsers(c)}>{ar?'عرض المستخدمين':'View Users'} ({c.uses})</button>
              <button style={{...S.ghost,fontSize:11,padding:'6px 12px'}} onClick={()=>setConfirmDisable(c)}>
                {c.status==='active'?(ar?'تعطيل':'Disable'):(ar?'تفعيل':'Enable')}
              </button>
              <button style={{...S.danger,fontSize:11,padding:'6px 12px'}} onClick={()=>setConfirmDelete(c)}>{ar?'حذف':'Delete'}</button>
            </div>
          </div>
        )
      })}

      {/* Create sheet */}
      {showCreate && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setShowCreate(false)}}>
          <div style={S.sheetIn}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:18}}>{ar?'إنشاء كود وصول':'Create Access Code'}</div>
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <span style={S.label}>{ar?'ملاحظة (اختياري)':'Note (optional)'}</span>
                <input style={S.input} placeholder={ar?'مثال: فريق الموارد البشرية':'e.g. HR Department batch'} value={form.note} onChange={e=>setForm(f=>({...f,note:e.target.value}))}/>
              </div>
              <div>
                <span style={S.label}>{ar?'الكود (فارغ = توليد تلقائي)':'Code (blank = auto-generate)'}</span>
                <div style={{display:'flex',gap:8}}>
                  <input style={{...S.input,fontFamily:"'JetBrains Mono',monospace",letterSpacing:2}} placeholder="ABC12345" value={form.code} onChange={e=>setForm(f=>({...f,code:e.target.value.toUpperCase()}))}/>
                  <button style={{...S.ghost,padding:'10px 12px',flexShrink:0}} onClick={()=>setForm(f=>({...f,code:randCode()}))} title="Generate"><IcoRefresh/></button>
                </div>
              </div>
              <div>
                <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer',marginBottom:8}}>
                  <input type="checkbox" checked={form.unlimited} onChange={e=>setForm(f=>({...f,unlimited:e.target.checked}))}/>
                  <span style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.65)'}}>{ar?'استخدامات غير محدودة':'Unlimited uses'}</span>
                </label>
                {!form.unlimited && (
                  <>
                    <span style={S.label}>{ar?'الحد الأقصى للاستخدام':'Max Uses'}</span>
                    <input style={S.input} type="number" min="1" placeholder="50" value={form.maxUses} onChange={e=>setForm(f=>({...f,maxUses:e.target.value}))}/>
                  </>
                )}
              </div>
              <div>
                <span style={S.label}>{ar?'تاريخ الانتهاء':'Expiry'}</span>
                <div style={{display:'flex',gap:6}}>
                  {(['never','7d','30d','custom'] as const).map(e=>(
                    <button key={e} onClick={()=>setForm(f=>({...f,expiry:e}))} style={{flex:1,padding:'7px 4px',borderRadius:8,border:'none',cursor:'pointer',fontSize:11,fontWeight:600,background:form.expiry===e?'linear-gradient(135deg,#7c3aed,#9d6fff)':'rgba(var(--fg-rgb),0.06)',color:form.expiry===e?'#fff':'rgba(var(--fg2-rgb),0.55)'}}>
                      {e==='never'?(ar?'لا ينتهي':'Never'):e==='custom'?(ar?'مخصص':'Custom'):e}
                    </button>
                  ))}
                </div>
                {form.expiry==='custom' && <input style={{...S.input,marginTop:8}} type="date" value={form.customDate} onChange={e=>setForm(f=>({...f,customDate:e.target.value}))}/>}
              </div>
              {/* Live preview — updates as user edits the form */}
              <div style={{ background:'rgba(157,111,255,0.07)', border:'1px solid rgba(157,111,255,0.25)', borderRadius:10, padding:'12px 14px' }}>
                <div style={{ fontSize:10, fontWeight:700, letterSpacing:1, color:'rgba(157,111,255,0.6)', marginBottom:10, textTransform:'uppercase' }}>{ar?'معاينة الكود':'Code Preview'}</div>
                <div style={{ fontFamily:"'JetBrains Mono',monospace", fontSize:20, fontWeight:800, letterSpacing:3, color:'#9d6fff', marginBottom:8 }}>
                  {form.code ? form.code : <span style={{ opacity:0.4 }}>{ar?'سيُولَّد تلقائياً':'AUTO-GENERATED'}</span>}
                </div>
                <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                  <span style={{ ...S.pill, background:'rgba(0,212,255,0.12)', color:'#00d4ff' }}>
                    {form.unlimited ? (ar?'غير محدود':'Unlimited') : `${form.maxUses||50} ${ar?'استخدام':'uses'}`}
                  </span>
                  <span style={{ ...S.pill, background:'rgba(var(--fg-rgb),0.06)', color:'rgba(var(--fg2-rgb),0.7)' }}>
                    {ar?'ينتهي:':'Expires:'}{' '}
                    {form.expiry==='never'?(ar?'لا ينتهي':'Never'):form.expiry==='7d'?(ar?'7 أيام':'7 days'):form.expiry==='30d'?(ar?'30 يوماً':'30 days'):form.customDate||'—'}
                  </span>
                  {form.note.trim() && (
                    <span style={{ ...S.pill, background:'rgba(var(--fg-rgb),0.06)', color:'rgba(var(--fg2-rgb),0.55)', maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                      {form.note}
                    </span>
                  )}
                </div>
              </div>

              <div style={{display:'flex',gap:8,paddingTop:4}}>
                <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setShowCreate(false)}>{ar?'إلغاء':'Cancel'}</button>
                <button style={{...S.primary,flex:1,justifyContent:'center'}} onClick={create} disabled={busy}>{ar?'إنشاء الكود':'Create Code'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Success dialog */}
      {created && (
        <div style={S.dialog}>
          <div style={{...S.dbox,border:'1px solid rgba(0,230,118,0.2)',textAlign:'center'}}>
            <div style={{width:52,height:52,borderRadius:'50%',background:'rgba(0,230,118,0.12)',border:'2px solid #00e676',display:'flex',alignItems:'center',justifyContent:'center',margin:'0 auto 14px'}}><IcoCheck/></div>
            <div style={{fontSize:15,fontWeight:700,color:'var(--foreground)',marginBottom:10}}>{ar?'تم إنشاء الكود!':'Code Created!'}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:24,fontWeight:900,color:'#00d4ff',letterSpacing:5,background:'rgba(0,212,255,0.08)',padding:'12px 16px',borderRadius:10,marginBottom:18}}>{created.code}</div>
            <div style={{display:'flex',gap:8,marginBottom:10}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>handleCopy(created.code,created.id)}><IcoCopy/> {ar?'نسخ':'Copy'}</button>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>navigator.share?.({title:'Access Code',text:created.code}).catch(()=>{})}>{ar?'مشاركة':'Share'}</button>
            </div>
            <button style={{...S.primary,width:'100%',justifyContent:'center'}} onClick={()=>setCreated(null)}>{ar?'تم':'Done'}</button>
          </div>
        </div>
      )}

      {/* Disable confirm */}
      {confirmDisable && (
        <div style={S.dialog}>
          <div style={S.dbox}>
            <div style={{fontSize:15,fontWeight:700,color:'var(--foreground)',marginBottom:8}}>
              {confirmDisable.status==='active'?(ar?'تعطيل الكود؟':'Disable Code?'):(ar?'تفعيل الكود؟':'Enable Code?')}
            </div>
            <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.55)',lineHeight:1.5,marginBottom:18}}>
              {confirmDisable.status==='active'
                ?(ar?'لن يتمكن المستخدمون الجدد من التسجيل بهذا الكود. المستخدمون الحاليون المسجلون لن يتأثروا.':"New users won't be able to register with this code. Existing registered users will not be affected.")
                :(ar?'سيتمكن المستخدمون الجدد من التسجيل بهذا الكود مجدداً.':"New users will be able to register with this code again.")}
            </div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setConfirmDisable(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.primary,flex:1,justifyContent:'center'}} onClick={()=>toggle(confirmDisable)} disabled={busy}>
                {confirmDisable.status==='active'?(ar?'تعطيل':'Disable'):(ar?'تفعيل':'Enable')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div style={S.dialog}>
          <div style={{...S.dbox,border:'1px solid rgba(255,71,133,0.15)'}}>
            <div style={{fontSize:15,fontWeight:700,color:'#ff4785',marginBottom:8}}>{ar?'حذف الكود؟':'Delete Code?'}</div>
            <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.55)',lineHeight:1.5,marginBottom:18}}>
              {ar?`سيتم حذف الكود "${confirmDelete.code}" نهائياً. المستخدمون المسجلون لن يتأثروا.`:`Code "${confirmDelete.code}" will be permanently deleted. Registered users won't be affected.`}
            </div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setConfirmDelete(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.danger,flex:1,justifyContent:'center'}} onClick={()=>del(confirmDelete)} disabled={busy}>{ar?'حذف':'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      {/* View users sheet */}
      {viewUsers && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setViewUsers(null)}}>
          <div style={S.sheetIn}>
            <div style={S.handle}/>
            <div style={{fontSize:15,fontWeight:700,color:'var(--foreground)',marginBottom:4}}>{ar?`مستخدمو الكود:`:'Users registered with:'}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:16,color:'#00d4ff',letterSpacing:2,marginBottom:16}}>{viewUsers.code}</div>
            {viewUsersLoading
              ?<div style={{display:'flex',flexDirection:'column',gap:8}}>{[...Array(2)].map((_,i)=><Skeleton key={i} h={56}/>)}</div>
              :!viewUsersList || viewUsersList.length===0
              ?<Empty icon="👤" title={ar?'لا يوجد مستخدمون':'No users yet'} sub={ar?'لم يستخدم أحد هذا الكود بعد.':'Nobody has used this code yet.'}/>
              :viewUsersList.map(u=>(
                <div key={u.id} style={{...S.card,marginBottom:8,display:'flex',alignItems:'center',gap:10}}>
                  <Avatar url={u.avatarUrl} size={34}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:13,fontWeight:700,color:'var(--foreground)'}}>@{u.username}</div>
                    <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{u.email}</div>
                  </div>
                  <span style={{...S.pill,background:u.status==='active'?'rgba(0,230,118,0.12)':'rgba(255,71,133,0.12)',color:u.status==='active'?'#00e676':'#ff4785',flexShrink:0}}>
                    {u.status==='active'?(ar?'نشط':'Active'):(ar?'موقوف':'Suspended')}
                  </span>
                </div>
              ))
            }
            <button style={{...S.ghost,width:'100%',justifyContent:'center',marginTop:12}} onClick={()=>setViewUsers(null)}>{ar?'إغلاق':'Close'}</button>
          </div>
        </div>
      )}

      <Toast msg={toast?.msg||''} visible={!!toast} color={toast?.color}/>
    </div>
  )
}

// ── Branch Management ────────────────────────────────────────────────────────
// Owner-only. Every mutation below calls a SECURITY DEFINER RPC that
// re-checks owner status server-side (private.require_owner()) — nothing
// here is a hidden-button-only restriction. See migration
// dynamic_branch_management for admin_get_branches/admin_create_branch/
// admin_update_branch/admin_set_branch_active/admin_reorder_branches/
// admin_delete_branch.

function BranchesTab({ lang, refetchLog }: { lang:Lang; refetchLog:()=>Promise<void> }) {
  const ar = lang === 'ar'
  const [branches, setBranches] = useState<AdminBranch[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{msg:string;color?:string}|null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [createForm, setCreateForm] = useState({code:'',nameEn:'',nameAr:'',isActive:true})
  const [editing, setEditing] = useState<AdminBranch|null>(null)
  const [editForm, setEditForm] = useState({nameEn:'',nameAr:''})
  const [confirmToggle, setConfirmToggle] = useState<AdminBranch|null>(null)
  const [confirmDelete, setConfirmDelete] = useState<AdminBranch|null>(null)

  const flash = (msg:string,color?:string) => { setToast({msg,color}); setTimeout(()=>setToast(null),2500) }

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    const { error, data } = await adminGetBranches()
    setLoading(false)
    if (error) { setLoadError(error); return }
    setBranches(data)
  }, [])

  useEffect(() => { load() }, [load])

  const create = async () => {
    if (!createForm.code.trim() || !createForm.nameEn.trim() || !createForm.nameAr.trim()) return
    setBusy(true)
    const { error } = await adminCreateBranch(createForm.code, createForm.nameAr, createForm.nameEn, createForm.isActive)
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setShowCreate(false)
    setCreateForm({code:'',nameEn:'',nameAr:'',isActive:true})
    await Promise.all([load(), refetchLog()])
    flash(ar?'تم إنشاء الفرع':'Branch created')
  }

  const startEdit = (b:AdminBranch) => { setEditing(b); setEditForm({nameEn:b.name_en,nameAr:b.name_ar}) }

  const saveEdit = async () => {
    if (!editing || !editForm.nameEn.trim() || !editForm.nameAr.trim()) return
    setBusy(true)
    const { error } = await adminUpdateBranch(editing.id, editForm.nameAr, editForm.nameEn)
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setEditing(null)
    await Promise.all([load(), refetchLog()])
    flash(ar?'تم تحديث الفرع':'Branch updated')
  }

  const toggleActive = async (b:AdminBranch) => {
    setBusy(true)
    const { error } = await adminSetBranchActive(b.id, !b.is_active)
    setBusy(false)
    setConfirmToggle(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await Promise.all([load(), refetchLog()])
    flash(b.is_active?(ar?'تم إلغاء تفعيل الفرع':'Branch deactivated'):(ar?'تم تفعيل الفرع':'Branch activated'))
  }

  const reorder = async (index:number, direction:-1|1) => {
    const target = index + direction
    if (target < 0 || target >= branches.length) return
    const next = [...branches]
    ;[next[index], next[target]] = [next[target], next[index]]
    setBranches(next) // optimistic — reflects instantly, corrected by load() below regardless
    setBusy(true)
    const { error } = await adminReorderBranches(next.map(b=>b.id))
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); await load(); return }
    await Promise.all([load(), refetchLog()])
  }

  const del = async (b:AdminBranch) => {
    setBusy(true)
    const { error } = await adminDeleteBranch(b.id)
    setBusy(false)
    setConfirmDelete(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await Promise.all([load(), refetchLog()])
    flash(ar?'تم حذف الفرع':'Branch deleted','#ff4785')
  }

  if (loading) return <div style={{display:'flex',flexDirection:'column',gap:10}}>{[...Array(3)].map((_,i)=><Skeleton key={i} h={110}/>)}</div>

  if (loadError) {
    return (
      <div style={{...S.card,textAlign:'center'}}>
        <div style={{fontSize:13,color:'#ff4785',marginBottom:12,lineHeight:1.5}}>
          {ar?'تعذّر تحميل الفروع.':'Could not load branches.'}
        </div>
        <button style={{...S.primary,justifyContent:'center'}} onClick={load}>{ar?'إعادة المحاولة':'Retry'}</button>
      </div>
    )
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)',lineHeight:1.5}}>
        {ar
          ? 'الفروع النشطة تظهر فوراً في نموذج التسجيل لكل المستخدمين والأجهزة — لا حاجة لإصدار تحديث للتطبيق.'
          : 'Active branches appear immediately in the registration form for every user and device — no app update required.'}
      </div>

      <button style={{...S.primary,alignSelf:'flex-start'}} onClick={()=>setShowCreate(true)}>
        + {ar?'إضافة فرع':'Add Branch'}
      </button>

      {branches.length===0 && <Empty icon="🏢" title={ar?'لا توجد فروع':'No branches'} sub={ar?'أضف فرعاً ليظهر في نموذج التسجيل':'Add a branch to make it available at registration'}/>}

      {branches.map((b,i)=>(
        <div key={b.id} style={S.card}>
          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:8}}>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:14,fontWeight:700,color:'var(--foreground)'}}>{ar?b.name_ar:b.name_en}</div>
              <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:10,color:'rgba(var(--fg2-rgb),0.4)',marginTop:2}}>{b.code}</div>
            </div>
            <span style={{...S.pill,background:b.is_active?'rgba(0,230,118,0.12)':'rgba(255,71,133,0.12)',color:b.is_active?'#00e676':'#ff4785'}}>
              {b.is_active?(ar?'نشط':'Active'):(ar?'غير نشط':'Inactive')}
            </span>
          </div>

          <div style={{display:'flex',gap:16,fontSize:11,color:'rgba(var(--fg2-rgb),0.45)',marginBottom:10}}>
            <span>{ar?'المستخدمون:':'Users:'} <b style={{color:'var(--foreground)'}}>{b.user_count}</b></span>
            <span>{ar?'الترتيب:':'Order:'} <b style={{color:'var(--foreground)'}}>{i+1}</b></span>
          </div>

          <div style={{display:'flex',gap:6,flexWrap:'wrap',alignItems:'center'}}>
            <button style={{...S.ghost,fontSize:11,padding:'6px 12px'}} disabled={busy} onClick={()=>startEdit(b)}>{ar?'تعديل':'Edit'}</button>
            <button style={{...S.ghost,fontSize:11,padding:'6px 12px'}} disabled={busy} onClick={()=>setConfirmToggle(b)}>
              {b.is_active?(ar?'إلغاء التفعيل':'Deactivate'):(ar?'تفعيل':'Activate')}
            </button>
            <button
              style={{...S.danger,fontSize:11,padding:'6px 12px',opacity:b.user_count>0?0.4:1,cursor:b.user_count>0?'not-allowed':'pointer'}}
              disabled={busy||b.user_count>0}
              title={b.user_count>0?(ar?'لا يمكن الحذف — يوجد مستخدمون مرتبطون بهذا الفرع':'Cannot delete — users are linked to this branch'):undefined}
              onClick={()=>setConfirmDelete(b)}
            >
              {ar?'حذف':'Delete'}
            </button>
            <div style={{display:'flex',gap:2,marginInlineStart:'auto'}}>
              <button style={{...S.ghost,padding:'6px 8px'}} disabled={busy||i===0} onClick={()=>reorder(i,-1)} title={ar?'تحريك لأعلى':'Move up'}><IcoUp/></button>
              <button style={{...S.ghost,padding:'6px 8px'}} disabled={busy||i===branches.length-1} onClick={()=>reorder(i,1)} title={ar?'تحريك لأسفل':'Move down'}><IcoDown2/></button>
            </div>
          </div>
          {b.user_count>0 && (
            <div style={{fontSize:10,color:'rgba(var(--fg2-rgb),0.35)',marginTop:8,lineHeight:1.4}}>
              {ar?'إلغاء التفعيل بدلاً من الحذف — لا يمكن حذف فرع لديه حسابات مستخدمين مرتبطة.':'Deactivate instead of deleting — a branch with linked user accounts cannot be deleted.'}
            </div>
          )}
        </div>
      ))}

      {/* Create sheet */}
      {showCreate && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setShowCreate(false)}}>
          <div style={S.sheetIn}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:18}}>{ar?'إضافة فرع جديد':'Add New Branch'}</div>
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <span style={S.label}>{ar?'الرمز (حروف إنجليزية صغيرة وأرقام و_ فقط)':'Code (lowercase letters, numbers, and _ only)'}</span>
                <input
                  style={{...S.input,fontFamily:"'JetBrains Mono',monospace"}}
                  placeholder="north_branch"
                  value={createForm.code}
                  onChange={e=>setCreateForm(f=>({...f,code:e.target.value.toLowerCase().replace(/[^a-z0-9_]/g,'')}))}
                />
                <div style={{fontSize:10,color:'rgba(var(--fg2-rgb),0.35)',marginTop:4}}>
                  {ar?'دائم بعد الإنشاء — لا يمكن تغييره لاحقاً.':'Permanent once created — cannot be changed later.'}
                </div>
              </div>
              <div>
                <span style={S.label}>{ar?'الاسم بالإنجليزية':'English Name'}</span>
                <input style={S.input} placeholder="North Branch" value={createForm.nameEn} onChange={e=>setCreateForm(f=>({...f,nameEn:e.target.value}))}/>
              </div>
              <div>
                <span style={S.label}>{ar?'الاسم بالعربية':'Arabic Name'}</span>
                <input style={{...S.input,fontFamily:"'Cairo',sans-serif"}} dir="rtl" placeholder="الفرع الشمالي" value={createForm.nameAr} onChange={e=>setCreateForm(f=>({...f,nameAr:e.target.value}))}/>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                <input type="checkbox" checked={createForm.isActive} onChange={e=>setCreateForm(f=>({...f,isActive:e.target.checked}))}/>
                <span style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.65)'}}>{ar?'نشط فور الإنشاء':'Active immediately'}</span>
              </label>
              <div style={{display:'flex',gap:8,paddingTop:4}}>
                <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setShowCreate(false)}>{ar?'إلغاء':'Cancel'}</button>
                <button
                  style={{...S.primary,flex:1,justifyContent:'center'}}
                  disabled={busy||!createForm.code.trim()||!createForm.nameEn.trim()||!createForm.nameAr.trim()}
                  onClick={create}
                >
                  {ar?'إضافة الفرع':'Add Branch'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Edit sheet */}
      {editing && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setEditing(null)}}>
          <div style={S.sheetIn}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:4}}>{ar?'تعديل الفرع':'Edit Branch'}</div>
            <div style={{fontFamily:"'JetBrains Mono',monospace",fontSize:11,color:'rgba(var(--fg2-rgb),0.4)',marginBottom:18}}>{editing.code}</div>
            <div style={{display:'flex',flexDirection:'column',gap:14}}>
              <div>
                <span style={S.label}>{ar?'الاسم بالإنجليزية':'English Name'}</span>
                <input style={S.input} value={editForm.nameEn} onChange={e=>setEditForm(f=>({...f,nameEn:e.target.value}))}/>
              </div>
              <div>
                <span style={S.label}>{ar?'الاسم بالعربية':'Arabic Name'}</span>
                <input style={{...S.input,fontFamily:"'Cairo',sans-serif"}} dir="rtl" value={editForm.nameAr} onChange={e=>setEditForm(f=>({...f,nameAr:e.target.value}))}/>
              </div>
              <div style={{display:'flex',gap:8,paddingTop:4}}>
                <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setEditing(null)}>{ar?'إلغاء':'Cancel'}</button>
                <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy||!editForm.nameEn.trim()||!editForm.nameAr.trim()} onClick={saveEdit}>
                  {ar?'حفظ':'Save'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Activate/deactivate confirm */}
      {confirmToggle && (
        <div style={S.dialog}>
          <div style={S.dbox}>
            <div style={{fontSize:15,fontWeight:700,color:'var(--foreground)',marginBottom:8}}>
              {confirmToggle.is_active?(ar?'إلغاء تفعيل هذا الفرع؟':'Deactivate this branch?'):(ar?'تفعيل هذا الفرع؟':'Activate this branch?')}
            </div>
            <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.55)',lineHeight:1.5,marginBottom:18}}>
              {confirmToggle.is_active
                ? (ar?'لن يظهر هذا الفرع بعد الآن في نموذج التسجيل. المستخدمون الحاليون المرتبطون به لن يتأثروا.':"This branch will no longer appear in the registration form. Existing users linked to it are not affected.")
                : (ar?'سيظهر هذا الفرع مجدداً في نموذج التسجيل لكل المستخدمين والأجهزة.':'This branch will appear again in the registration form for every user and device.')}
            </div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setConfirmToggle(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy} onClick={()=>toggleActive(confirmToggle)}>
                {confirmToggle.is_active?(ar?'إلغاء التفعيل':'Deactivate'):(ar?'تفعيل':'Activate')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm — the Delete button itself is already disabled
          when user_count > 0, this is the last-resort server-side guard's
          UI counterpart, not the only check. */}
      {confirmDelete && (
        <div style={S.dialog}>
          <div style={{...S.dbox,border:'1px solid rgba(255,71,133,0.15)'}}>
            <div style={{fontSize:15,fontWeight:700,color:'#ff4785',marginBottom:8}}>{ar?'حذف الفرع؟':'Delete Branch?'}</div>
            <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.55)',lineHeight:1.5,marginBottom:18}}>
              {ar?`سيتم حذف الفرع "${confirmDelete.name_ar}" نهائياً. هذا الإجراء لا يمكن التراجع عنه.`:`Branch "${confirmDelete.name_en}" will be permanently deleted. This cannot be undone.`}
            </div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setConfirmDelete(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.danger,flex:1,justifyContent:'center'}} disabled={busy} onClick={()=>del(confirmDelete)}>{ar?'حذف':'Delete'}</button>
            </div>
          </div>
        </div>
      )}

      <Toast msg={toast?.msg||''} visible={!!toast} color={toast?.color}/>
    </div>
  )
}

// ── Analytics ─────────────────────────────────────────────────────────────────

function GamesTab({ lang, loading, games, wau, mau }: { lang:Lang; loading:boolean; games:GameRow[]; wau:number[]; mau:number[] }) {
  const ar = lang === 'ar'
  const [sel, setSel] = useState<GameRow|null>(null)

  if (loading) return <div style={{display:'flex',flexDirection:'column',gap:10}}>{[...Array(3)].map((_,i)=><Skeleton key={i} h={160}/>)}</div>

  const maxPlays = games.length ? Math.max(...games.map(g=>g.plays)) : 0

  const exportGames = () => downloadCsv(games.map(g=>({
    name:g.name, nameAr:g.nameAr, plays:g.plays, avgScore:g.avgScore, avgTime:g.avgTime,
    uniquePlayers:g.uniquePlayers, completion:g.completion, hardestQuestion:g.hardestQ,
  })), 'kastro-game-analytics.csv')

  return (
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      {/* Engagement charts — derived from admin_get_dau() via chunkSum rollups (see loader) */}
      <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
        <div style={S.card}>
          <div style={S.sectionHead}>{ar?'نشاط أسبوعي':'Weekly Active'}</div>
          <MiniBarChart data={wau.length?wau:[0]} color="#9d6fff" height={44}/>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:10,color:'rgba(var(--fg2-rgb),0.35)'}}>
            <span>6w</span><span>{ar?'هذا الأسبوع':'This week'}</span>
          </div>
        </div>
        <div style={S.card}>
          <div style={S.sectionHead}>{ar?'نشاط شهري':'Monthly Active'}</div>
          <MiniBarChart data={mau.length?mau:[0]} color="#00d4ff" height={44}/>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:4,fontSize:10,color:'rgba(var(--fg2-rgb),0.35)'}}>
            <span>4m</span><span>{ar?'هذا الشهر':'This month'}</span>
          </div>
        </div>
      </div>

      {games.length===0 && <Empty icon="🎮" title={ar?'لا توجد بيانات ألعاب':'No game data yet'} sub={ar?'ستظهر التحليلات بعد أول جلسات اللعب.':'Analytics will appear once games have been played.'}/>}

      {games.length>0 && <>
      {/* Most played — horizontal bar */}
      <div style={S.card}>
        <div style={S.sectionHead}>{ar?'أكثر الألعاب لعباً':'Most Played Games'}</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[...games].sort((a,b)=>b.plays-a.plays).map(g=>(
            <div key={g.id}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
                <span style={{color:'rgba(var(--fg2-rgb),0.65)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'70%'}}>{ar?g.nameAr:g.name}</span>
                <span style={{color:'#9d6fff',fontWeight:700,flexShrink:0}}>{g.plays}</span>
              </div>
              <div style={{height:5,background:'rgba(var(--fg-rgb),0.06)',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:'100%',transform:`scaleX(${maxPlays?(g.plays/maxPlays):0})`,transformOrigin:ar?'right center':'left center',background:'linear-gradient(90deg,#7c3aed,#9d6fff)',borderRadius:3,transition:'transform 0.4s'}}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Avg scores */}
      <div style={S.card}>
        <div style={S.sectionHead}>{ar?'متوسط النتائج':'Average Scores'}</div>
        <div style={{display:'flex',flexDirection:'column',gap:8}}>
          {[...games].sort((a,b)=>b.avgScore-a.avgScore).map(g=>(
            <div key={g.id}>
              <div style={{display:'flex',justifyContent:'space-between',fontSize:11,marginBottom:3}}>
                <span style={{color:'rgba(var(--fg2-rgb),0.65)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',maxWidth:'70%'}}>{ar?g.nameAr:g.name}</span>
                <span style={{color:g.avgScore>=80?'#00e676':g.avgScore>=65?'#ffd700':'#ff4785',fontWeight:700,flexShrink:0}}>{g.avgScore}%</span>
              </div>
              <div style={{height:5,background:'rgba(var(--fg-rgb),0.06)',borderRadius:3,overflow:'hidden'}}>
                <div style={{height:'100%',width:`${g.avgScore}%`,background:g.avgScore>=80?'linear-gradient(90deg,#00b854,#00e676)':g.avgScore>=65?'linear-gradient(90deg,#cc8800,#ffd700)':'linear-gradient(90deg,#cc1f55,#ff4785)',borderRadius:3}}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Per-game cards */}
      <div style={S.sectionHead}>{ar?'تفاصيل كل لعبة':'Game Details'}</div>
      {games.map(g=>(
        <div key={g.id} style={{...S.card,cursor:'pointer'}} onClick={()=>setSel(g)}>
          <div style={{fontSize:14,fontWeight:700,color:'var(--foreground)',marginBottom:8}}>{ar?g.nameAr:g.name}</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:6,fontSize:11,marginBottom:8}}>
            {[
              {l:ar?'عدد المرات':'Plays',          v:g.plays,              c:'#9d6fff'},
              {l:ar?'متوسط النتيجة':'Avg Score',    v:`${g.avgScore}%`,     c:g.avgScore>=80?'#00e676':g.avgScore>=65?'#ffd700':'#ff4785'},
              {l:ar?'متوسط الوقت':'Avg Time',       v:g.avgTime,            c:'#00d4ff'},
              {l:ar?'لاعبون فريدون':'Unique Players',v:g.uniquePlayers,     c:'#ff6b35'},
              {l:ar?'معدل الإكمال':'Completion',    v:`${g.completion}%`,   c:'#ffd700'},
            ].map(s=><div key={s.l}><span style={{color:'rgba(var(--fg2-rgb),0.4)'}}>{s.l}: </span><span style={{fontWeight:700,color:s.c}}>{s.v}</span></div>)}
          </div>
          <div style={{fontSize:11,marginBottom:2}}><span style={{color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'أصعب سؤال:':'Hardest Q:'} </span><span style={{color:'#ff4785',fontWeight:600}}>{g.hardestQ}</span></div>
          <div style={{fontSize:11}}><span style={{color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'أصعب موضوع:':'Hardest Topic:'} </span><span style={{color:'#ffd700',fontWeight:600}}>{g.failedTopic}</span></div>
          <div style={{fontSize:11,color:'#00d4ff',marginTop:6}}>{ar?'اضغط للتفاصيل ←':'Tap for question-level detail →'}</div>
        </div>
      ))}
      </>}

      {/* Exports — genuine client-side CSV of the live game analytics */}
      <div style={{display:'flex',gap:8}}>
        <button style={{...S.ghost,flex:1,justifyContent:'center',fontSize:12}} onClick={exportGames}><IcoDown/> CSV</button>
        <button style={{...S.ghost,flex:1,justifyContent:'center',fontSize:12}} onClick={exportGames}><IcoDown/> Excel</button>
      </div>

      {/* Question detail sheet — real per-question stats from admin_get_game_analytics()'s
          underlying question_responses join (see loadGameAnalytics) */}
      {sel && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setSel(null)}}>
          <div style={S.sheetIn}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:4}}>{ar?sel.nameAr:sel.name}</div>
            <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)',marginBottom:16}}>{ar?'تفاصيل مستوى الأسئلة — مجهولة الهوية':'Question-level detail — anonymized'}</div>
            {sel.questions.length===0 && <Empty icon="❓" title={ar?'لا توجد بيانات بعد':'No responses yet'} sub={ar?'لم يُجب أحد على أسئلة هذه اللعبة بعد.':'Nobody has answered this game\'s questions yet.'}/>}
            {sel.questions.map((q,i)=>(
              <div key={i} style={{...S.card,marginBottom:10}}>
                <div style={{fontSize:12,color:'var(--foreground)',marginBottom:8,lineHeight:1.4}}>{ar?q.textAr:q.textEn}</div>
                <div style={{display:'flex',gap:16,fontSize:11,marginBottom:6}}>
                  <span style={{color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'محاولات:':'Attempts:'} <b style={{color:'var(--foreground)'}}>{q.attempts}</b></span>
                  <span style={{color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'صحيح:':'Correct:'} <b style={{color:q.correct>=70?'#00e676':q.correct>=50?'#ffd700':'#ff4785'}}>{q.correct}%</b></span>
                </div>
                <div style={{height:5,background:'rgba(var(--fg-rgb),0.06)',borderRadius:3}}>
                  <div style={{height:'100%',width:`${q.correct}%`,background:q.correct>=70?'linear-gradient(90deg,#00b854,#00e676)':q.correct>=50?'linear-gradient(90deg,#cc8800,#ffd700)':'linear-gradient(90deg,#cc1f55,#ff4785)',borderRadius:3}}/>
                </div>
              </div>
            ))}
            <button style={{...S.ghost,width:'100%',justifyContent:'center',marginTop:4}} onClick={()=>setSel(null)}>{ar?'إغلاق':'Close'}</button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Announcements ─────────────────────────────────────────────────────────────

function AnnouncementsTab({ lang, loading, items, refetchAnnouncements, refetchLog }: { lang:Lang; loading:boolean; items:Announcement[]; refetchAnnouncements:()=>Promise<void>; refetchLog:()=>Promise<void> }) {
  const ar = lang === 'ar'
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({title:'',body:'',pinned:false,scheduledAt:'',expiresAt:''})
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState<{msg:string;color?:string}|null>(null)

  const flash = (msg:string,color?:string) => { setToast({msg,color}); setTimeout(()=>setToast(null),2000) }

  const post = async () => {
    if (!form.title.trim()) return
    setBusy(true)
    const { error } = await adminCreateAnnouncement(form.title, form.body, form.pinned, form.scheduledAt||null, form.expiresAt||null)
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setForm({title:'',body:'',pinned:false,scheduledAt:'',expiresAt:''})
    setShowForm(false)
    await Promise.all([refetchAnnouncements(), refetchLog()])
    flash(ar?'تم نشر الإعلان!':'Announcement published!')
  }

  const remove = async (id:string) => {
    const { error } = await adminDeleteAnnouncement(id)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await Promise.all([refetchAnnouncements(), refetchLog()])
    flash(ar?'تم حذف الإعلان':'Announcement deleted','#ff4785')
  }

  if (loading) return <div style={{display:'flex',flexDirection:'column',gap:10}}>{[...Array(2)].map((_,i)=><Skeleton key={i} h={100}/>)}</div>

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <button style={{...S.primary,alignSelf:'flex-start'}} onClick={()=>setShowForm(true)}>
        + {ar?'إعلان جديد':'New Announcement'}
      </button>

      {items.length===0 && <Empty icon="📢" title={ar?'لا توجد إعلانات':'No announcements'} sub={ar?'أنشئ أول إعلان للاعبين':'Create your first player announcement'}/>}

      {items.map(a=>{
        const isScheduled = a.scheduledAt && a.scheduledAt > new Date().toISOString().slice(0,10)
        const isExpired = a.expiresAt && a.expiresAt < new Date().toISOString().slice(0,10)
        return (
          <div key={a.id} style={{...S.card, borderLeft:`3px solid ${a.pinned?'#ffd700':isScheduled?'#9d6fff':isExpired?'rgba(var(--fg-rgb),0.1)':'transparent'}`, opacity:isExpired?0.55:1}}>
            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:6,flexWrap:'wrap'}}>
              {a.pinned && <span style={{...S.pill,background:'rgba(255,215,0,0.12)',color:'#ffd700',gap:3}}><IcoPin/>{ar?'مثبت':'Pinned'}</span>}
              {isScheduled && <span style={{...S.pill,background:'rgba(157,111,255,0.12)',color:'#9d6fff',gap:3}}><IcoClock/>{ar?`مجدول: ${a.scheduledAt}`:`Scheduled: ${a.scheduledAt}`}</span>}
              {isExpired && <span style={{...S.pill,background:'rgba(var(--fg-rgb),0.06)',color:'rgba(var(--fg2-rgb),0.4)'}}>{ar?'منتهي':'Expired'}</span>}
              {a.expiresAt && !isExpired && <span style={{...S.pill,background:'rgba(255,107,53,0.1)',color:'#ff6b35',gap:3}}><IcoClock/>{ar?`ينتهي: ${a.expiresAt}`:`Expires: ${a.expiresAt}`}</span>}
              <span style={{fontSize:10,color:'rgba(var(--fg2-rgb),0.35)',marginInlineStart:'auto'}}>{a.createdAt}</span>
              <button style={{background:'none',border:'none',cursor:'pointer',color:'rgba(var(--fg2-rgb),0.4)',padding:2,display:'flex'}} onClick={()=>remove(a.id)}><IcoX/></button>
            </div>
            <div style={{fontSize:14,fontWeight:700,color:'var(--foreground)',marginBottom:4}}>{a.title}</div>
            <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.6)',lineHeight:1.5}}>{a.body}</div>
          </div>
        )
      })}

      {/* Create sheet */}
      {showForm && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setShowForm(false)}}>
          <div style={{...S.sheetIn,maxHeight:'90dvh'}}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:18}}>{ar?'إعلان جديد':'New Announcement'}</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <span style={S.label}>{ar?'العنوان':'Title'}</span>
                <input style={S.input} placeholder={ar?'عنوان الإعلان…':'Announcement title…'} value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))} autoFocus/>
              </div>
              <div>
                <span style={S.label}>{ar?'النص':'Body'}</span>
                <textarea style={{...S.input,minHeight:88,resize:'vertical'}} placeholder={ar?'نص الإعلان…':'Announcement body…'} value={form.body} onChange={e=>setForm(f=>({...f,body:e.target.value}))}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div>
                  <span style={S.label}>{ar?'جدولة النشر (اختياري)':'Schedule for (optional)'}</span>
                  <input style={S.input} type="date" value={form.scheduledAt} onChange={e=>setForm(f=>({...f,scheduledAt:e.target.value}))}/>
                </div>
                <div>
                  <span style={S.label}>{ar?'تاريخ الانتهاء (اختياري)':'Expiry date (optional)'}</span>
                  <input style={S.input} type="date" value={form.expiresAt} onChange={e=>setForm(f=>({...f,expiresAt:e.target.value}))}/>
                </div>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:8,cursor:'pointer'}}>
                <input type="checkbox" checked={form.pinned} onChange={e=>setForm(f=>({...f,pinned:e.target.checked}))}/>
                <span style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.65)'}}>{ar?'تثبيت الإعلان':'Pin announcement'}</span>
              </label>
              <div style={{display:'flex',gap:8,paddingTop:4}}>
                <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setShowForm(false)}>{ar?'إلغاء':'Cancel'}</button>
                <button style={{...S.primary,flex:1,justifyContent:'center'}} onClick={post} disabled={!form.title.trim()||busy}>{ar?'نشر':'Post'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      <Toast msg={toast?.msg||''} visible={!!toast} color={toast?.color}/>
    </div>
  )
}

// ── Content (games / badges / tournaments / challenges / season) ──────────────
// The catalog tables (games, achievements, tournaments, challenges) all have
// owner-only RLS policies already (see adminApi.ts header comment), so every
// mutation below is a plain insert/update/upsert/delete — Postgres is the real
// gate, this UI is just a convenient front end for it. No games are seeded or
// created here; this only builds the tooling admins will use once real games
// are designed in a later phase.

type GameFull = Tables<'games'>
type AchievementFull = Tables<'achievements'>
type TournamentFull = Tables<'tournaments'>
type ChallengeFull = Tables<'challenges'>
type SeasonFull = Tables<'seasons'>
type CosmeticItemFull = Tables<'cosmetic_items'>

const RARITIES = ['common','uncommon','rare','epic','legendary'] as const
const BADGE_CATEGORIES = ['gameplay','progression','consistency','social','general'] as const
const CRITERIA_TYPES = ['manual','games_played','total_xp','streak','weekly_streak','level','perfect_score'] as const
const rarityColor: Record<string,string> = { common:'#9ca3af', uncommon:'#34d399', rare:'#60a5fa', epic:'#c084fc', legendary:'#ffd700' }

// Cosmetics Shop catalog — separate 5-tier rarity scale (Common → Mythic) from
// the achievement-badge RARITIES above, per the explicit requirement that
// purchasable shop collectibles stay a distinct system from earned badges.
const SHOP_RARITIES = ['common','rare','epic','legendary','mythic'] as const
const shopRarityColor: Record<string,string> = { common:'#9ca3af', rare:'#60a5fa', epic:'#c084fc', legendary:'#ffd700', mythic:'#ff3d68' }
const COSMETIC_TYPES = ['frame','banner','title','avatar_decoration','badge_collectible','trophy','victory_animation','emote','seasonal'] as const
const cosmeticTypeLabel: Record<string,{en:string;ar:string}> = {
  frame: { en:'Frame', ar:'إطار' },
  banner: { en:'Background', ar:'خلفية' },
  title: { en:'Nameplate', ar:'لقب' },
  avatar_decoration: { en:'Decoration', ar:'زخرفة' },
  badge_collectible: { en:'Badge', ar:'ميدالية' },
  trophy: { en:'Trophy', ar:'كأس' },
  victory_animation: { en:'Victory FX', ar:'حركة انتصار' },
  emote: { en:'Emote', ar:'تعبير' },
  seasonal: { en:'Seasonal', ar:'موسمي' },
}

function slugify(s: string) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'').slice(0,40)
}

function ContentTab({ lang }: { lang:Lang }) {
  const ar = lang === 'ar'
  const [section, setSection] = useState<'games'|'badges'|'cosmetics'|'coins'|'tournaments'|'challenges'|'season'>('games')
  const [loading, setLoading] = useState(true)
  const [gamesFull, setGamesFull] = useState<GameFull[]>([])
  const [achievementsFull, setAchievementsFull] = useState<AchievementFull[]>([])
  const [cosmeticsFull, setCosmeticsFull] = useState<CosmeticItemFull[]>([])
  const [coinConfig, setCoinConfig] = useState<CoinRewardConfig[]>([])
  const [tournamentsFull, setTournamentsFull] = useState<TournamentFull[]>([])
  const [challengesFull, setChallengesFull] = useState<ChallengeFull[]>([])
  const [activeSeason, setActiveSeason] = useState<SeasonFull|null>(null)
  const [toast, setToast] = useState<{msg:string;color?:string}|null>(null)
  const flash = (msg:string,color?:string) => { setToast({msg,color}); setTimeout(()=>setToast(null),2200) }

  const refetchAll = useCallback(async () => {
    const [g,a,cos,cc,t,c,s] = await Promise.all([
      adminGetAllGames(), adminGetAllAchievementsFull(), adminGetAllCosmeticsFull(), adminGetCoinRewardConfig(), adminGetAllTournaments(), adminGetAllChallenges(), getActiveSeason(),
    ])
    setGamesFull(g as GameFull[]); setAchievementsFull(a as AchievementFull[]); setCosmeticsFull(cos as CosmeticItemFull[]); setCoinConfig(cc)
    setTournamentsFull(t as TournamentFull[]); setChallengesFull(c as ChallengeFull[]); setActiveSeason(s as SeasonFull|null)
  }, [])

  useEffect(() => { let cancelled=false; (async () => { setLoading(true); await refetchAll(); if(!cancelled) setLoading(false) })(); return ()=>{cancelled=true} }, [refetchAll])

  const sections: {key:typeof section;en:string;ar:string}[] = [
    {key:'games',       en:'Games',       ar:'الألعاب'},
    {key:'badges',      en:'Badges',      ar:'الشارات'},
    {key:'cosmetics',   en:'Cosmetics Shop', ar:'متجر المظاهر'},
    {key:'coins',       en:'Coins Economy', ar:'اقتصاد الكوينز'},
    {key:'tournaments', en:'Tournaments', ar:'البطولات'},
    {key:'challenges',  en:'Challenges',  ar:'التحديات'},
    {key:'season',      en:'Season',      ar:'الموسم'},
  ]

  return (
    <div style={{display:'flex',flexDirection:'column',gap:14}}>
      <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:2,scrollbarWidth:'none'}}>
        {sections.map(s=>(
          <button key={s.key} onClick={()=>setSection(s.key)} style={{flexShrink:0,padding:'6px 14px',borderRadius:20,border:'none',cursor:'pointer',fontSize:12,fontWeight:600,transition:'all 0.15s',background:section===s.key?'linear-gradient(135deg,#7c3aed,#9d6fff)':'rgba(var(--fg-rgb),0.06)',color:section===s.key?'#fff':'rgba(var(--fg2-rgb),0.6)'}}>
            {ar?s.ar:s.en}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{display:'flex',flexDirection:'column',gap:10}}>{[...Array(3)].map((_,i)=><SkeletonCard key={i}/>)}</div>
      ) : (
        <>
          {section==='games'       && <GamesSection       lang={lang} games={gamesFull} refetch={refetchAll} flash={flash}/>}
          {section==='badges'      && <BadgesSection       lang={lang} items={achievementsFull} refetch={refetchAll} flash={flash}/>}
          {section==='cosmetics'   && <CosmeticsSection    lang={lang} items={cosmeticsFull} refetch={refetchAll} flash={flash}/>}
          {section==='coins'       && <CoinsSection         lang={lang} items={coinConfig} refetch={refetchAll} flash={flash}/>}
          {section==='tournaments' && <TournamentsSection  lang={lang} items={tournamentsFull} refetch={refetchAll} flash={flash}/>}
          {section==='challenges'  && <ChallengesSection   lang={lang} items={challengesFull} games={gamesFull} refetch={refetchAll} flash={flash}/>}
          {section==='season'      && <SeasonSection       lang={lang} activeSeason={activeSeason} refetch={refetchAll} flash={flash}/>}
        </>
      )}

      <Toast msg={toast?.msg||''} visible={!!toast} color={toast?.color}/>
    </div>
  )
}

// ── Content: Games ──────────────────────────────────────────────────────────

function emptyGameForm(): GameFull {
  return { id:'', name:'', name_ar:'', category:'work', target_screen:'workgame', icon_key:'', accent_color:'#9d6fff', tagline:'', tagline_ar:'', base_xp:50, tag:null, world:null, sort_order:0, is_active:true, is_featured:false, is_coming_soon:true }
}

function GamesSection({ lang, games, refetch, flash }: { lang:Lang; games:GameFull[]; refetch:()=>Promise<void>; flash:(m:string,c?:string)=>void }) {
  const ar = lang === 'ar'
  const [form, setForm] = useState<GameFull|null>(null)
  const [isNew, setIsNew] = useState(true)
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<GameFull|null>(null)

  const openNew = () => { setForm(emptyGameForm()); setIsNew(true) }
  const openEdit = (g:GameFull) => { setForm({...g}); setIsNew(false) }

  const save = async () => {
    if (!form) return
    const id = isNew ? slugify(form.id || form.name) : form.id
    if (!id || !form.name.trim() || !form.name_ar.trim()) { flash(ar?'الاسم والمعرّف مطلوبان':'Name and ID are required','#ff4785'); return }
    setBusy(true)
    const { error } = await adminUpsertGame({ ...form, id })
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setForm(null)
    await refetch()
    flash(isNew?(ar?'تم إنشاء اللعبة':'Game created'):(ar?'تم حفظ التعديلات':'Changes saved'))
  }

  const toggleActive = async (g:GameFull) => {
    const { error } = await adminSetGameActive(g.id, !g.is_active)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await refetch()
    if (g.is_active) flash(ar?'تم تعطيل اللعبة':'Game disabled','#ff4785')
    else flash(ar?'تم تفعيل اللعبة':'Game enabled')
  }

  const remove = async () => {
    if (!del) return
    setBusy(true)
    const { error } = await adminDeleteGame(del.id)
    setBusy(false); setDel(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await refetch()
    flash(ar?'تم حذف اللعبة':'Game deleted','#ff4785')
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <button style={{...S.primary,alignSelf:'flex-start'}} onClick={openNew}>+ {ar?'لعبة جديدة':'New Game'}</button>

      {games.length===0 && <Empty icon="🎮" title={ar?'لا توجد ألعاب بعد':'No games yet'} sub={ar?'المنصة جاهزة — أضف أول لعبة عندما تكون جاهزاً':'The platform is ready — add your first game whenever it exists'}/>}

      {games.map(g=>(
        <div key={g.id} style={{...S.card,display:'flex',gap:10,alignItems:'flex-start',opacity:g.is_active?1:0.55}}>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:4}}>
              <span style={{fontSize:14,fontWeight:700,color:'var(--foreground)'}}>{ar?g.name_ar:g.name}</span>
              <span style={{...S.pill,background:'rgba(157,111,255,0.12)',color:'#9d6fff'}}>{g.category}</span>
              {g.is_featured && <span style={{...S.pill,background:'rgba(255,215,0,0.12)',color:'#ffd700'}}>{ar?'مميزة':'Featured'}</span>}
              {g.is_coming_soon && <span style={{...S.pill,background:'rgba(var(--fg-rgb),0.06)',color:'rgba(var(--fg2-rgb),0.5)'}}>{ar?'قريباً':'Coming Soon'}</span>}
              <span style={{...S.pill,background:g.is_active?'rgba(0,230,118,0.12)':'rgba(255,71,133,0.12)',color:g.is_active?'#00e676':'#ff4785'}}>{g.is_active?(ar?'مفعّلة':'Active'):(ar?'معطّلة':'Disabled')}</span>
            </div>
            <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)'}}>{g.id} · {g.target_screen} · {g.base_xp} XP</div>
          </div>
          <div style={{display:'flex',gap:6,flexShrink:0}}>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'rgba(var(--fg2-rgb),0.5)',padding:4,display:'flex'}} onClick={()=>toggleActive(g)} title={g.is_active?'Disable':'Enable'}><IcoRefresh/></button>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'rgba(var(--fg2-rgb),0.5)',padding:4,display:'flex'}} onClick={()=>openEdit(g)}><IcoPencil/></button>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'#ff4785',padding:4,display:'flex'}} onClick={()=>setDel(g)}><IcoTrash/></button>
          </div>
        </div>
      ))}

      {form && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setForm(null)}}>
          <div style={{...S.sheetIn,maxHeight:'92dvh'}}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:18}}>{isNew?(ar?'لعبة جديدة':'New Game'):(ar?'تعديل اللعبة':'Edit Game')}</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <span style={S.label}>{ar?'المعرّف (id)':'ID (slug)'}</span>
                <input style={S.input} placeholder="e.g. trivia_blitz" value={form.id} disabled={!isNew} onChange={e=>setForm(f=>f&&({...f,id:slugify(e.target.value)}))}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'الاسم (En)':'Name (En)'}</span><input style={S.input} value={form.name} onChange={e=>setForm(f=>f&&({...f,name:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'الاسم (Ar)':'Name (Ar)'}</span><input style={S.input} value={form.name_ar} onChange={e=>setForm(f=>f&&({...f,name_ar:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'الفئة':'Category'}</span>
                  <select style={S.input} value={form.category} onChange={e=>setForm(f=>f&&({...f,category:e.target.value}))}>
                    <option value="work">work</option><option value="casual">casual</option>
                  </select>
                </div>
                <div><span style={S.label}>{ar?'شاشة اللعب':'Target Screen'}</span>
                  <select style={S.input} value={form.target_screen} onChange={e=>setForm(f=>f&&({...f,target_screen:e.target.value}))}>
                    <option value="workgame">workgame</option><option value="casualgame">casualgame</option>
                  </select>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'الوصف القصير (En)':'Tagline (En)'}</span><input style={S.input} value={form.tagline} onChange={e=>setForm(f=>f&&({...f,tagline:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'الوصف القصير (Ar)':'Tagline (Ar)'}</span><input style={S.input} value={form.tagline_ar} onChange={e=>setForm(f=>f&&({...f,tagline_ar:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'رمز الأيقونة':'Icon Key'}</span><input style={S.input} value={form.icon_key} onChange={e=>setForm(f=>f&&({...f,icon_key:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'اللون':'Accent Color'}</span><input style={S.input} type="color" value={form.accent_color||'#9d6fff'} onChange={e=>setForm(f=>f&&({...f,accent_color:e.target.value}))}/></div>
                <div><span style={S.label}>XP</span><input style={S.input} type="number" value={form.base_xp} onChange={e=>setForm(f=>f&&({...f,base_xp:parseInt(e.target.value)||0}))}/></div>
              </div>
              <div style={{display:'flex',gap:16,flexWrap:'wrap'}}>
                <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'rgba(var(--fg2-rgb),0.65)'}}><input type="checkbox" checked={form.is_active} onChange={e=>setForm(f=>f&&({...f,is_active:e.target.checked}))}/>{ar?'مفعّلة':'Active'}</label>
                <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'rgba(var(--fg2-rgb),0.65)'}}><input type="checkbox" checked={form.is_featured} onChange={e=>setForm(f=>f&&({...f,is_featured:e.target.checked}))}/>{ar?'مميزة':'Featured'}</label>
                <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'rgba(var(--fg2-rgb),0.65)'}}><input type="checkbox" checked={form.is_coming_soon} onChange={e=>setForm(f=>f&&({...f,is_coming_soon:e.target.checked}))}/>{ar?'قريباً':'Coming Soon'}</label>
              </div>
              <div style={{display:'flex',gap:8,paddingTop:4}}>
                <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setForm(null)}>{ar?'إلغاء':'Cancel'}</button>
                <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy} onClick={save}>{ar?'حفظ':'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {del && (
        <div style={S.dialog}>
          <div style={{...S.dbox,border:'1px solid rgba(255,71,133,0.15)'}}>
            <div style={{fontSize:15,fontWeight:700,color:'#ff4785',marginBottom:8}}>{ar?'تأكيد الحذف':'Confirm Delete'}</div>
            <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.55)',lineHeight:1.5,marginBottom:20}}>{ar?`سيتم حذف "${del.name_ar}" نهائياً.`:`"${del.name}" will be permanently deleted.`}</div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setDel(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.danger,flex:1,justifyContent:'center'}} onClick={remove}>{ar?'حذف':'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Content: Badges ─────────────────────────────────────────────────────────

function emptyBadgeForm(): AchievementFull {
  return { id:'', name:'', name_ar:'', description:'', description_ar:'', icon:'🏆', color:'#9d6fff', rarity:'common', category:'general', xp_reward:0, coin_reward:0, sort_order:0, unlock_criteria:{type:'manual'} }
}

function BadgesSection({ lang, items, refetch, flash }: { lang:Lang; items:AchievementFull[]; refetch:()=>Promise<void>; flash:(m:string,c?:string)=>void }) {
  const ar = lang === 'ar'
  const [form, setForm] = useState<AchievementFull|null>(null)
  const [isNew, setIsNew] = useState(true)
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<AchievementFull|null>(null)

  const criteriaType = ((form?.unlock_criteria as any)?.type as string) || 'manual'
  const criteriaValue = ((form?.unlock_criteria as any)?.value as number|undefined) ?? 0
  const needsValue = !['manual','perfect_score'].includes(criteriaType)

  const setCriteria = (patch: Partial<{type:string;value:number}>) => {
    setForm(f => f && ({ ...f, unlock_criteria: { ...(f.unlock_criteria as any), ...patch } }))
  }

  const openNew = () => { setForm(emptyBadgeForm()); setIsNew(true) }
  const openEdit = (a:AchievementFull) => { setForm({...a}); setIsNew(false) }

  const save = async () => {
    if (!form) return
    const id = isNew ? slugify(form.id || form.name) : form.id
    if (!id || !form.name.trim() || !form.name_ar.trim()) { flash(ar?'الاسم والمعرّف مطلوبان':'Name and ID are required','#ff4785'); return }
    const criteria = needsValue ? { type:criteriaType, value:criteriaValue } : { type:criteriaType }
    setBusy(true)
    const { error } = await adminUpsertAchievement({ ...form, id, unlock_criteria: criteria })
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setForm(null)
    await refetch()
    flash(isNew?(ar?'تم إنشاء الشارة':'Badge created'):(ar?'تم حفظ التعديلات':'Changes saved'))
  }

  const remove = async () => {
    if (!del) return
    setBusy(true)
    const { error } = await adminDeleteAchievement(del.id)
    setBusy(false); setDel(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await refetch()
    flash(ar?'تم حذف الشارة':'Badge deleted','#ff4785')
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <button style={{...S.primary,alignSelf:'flex-start'}} onClick={openNew}>+ {ar?'شارة جديدة':'New Badge'}</button>

      {items.length===0 && <Empty icon="🏅" title={ar?'لا توجد شارات':'No badges yet'} sub={ar?'أنشئ أول شارة':'Create your first badge'}/>}

      {items.map(a=>(
        <div key={a.id} style={{...S.card,display:'flex',gap:10,alignItems:'center'}}>
          <div style={{fontSize:22,flexShrink:0,width:32,textAlign:'center'}}>{a.icon}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:3}}>
              <span style={{fontSize:13,fontWeight:700,color:'var(--foreground)'}}>{ar?a.name_ar:a.name}</span>
              <span style={{...S.pill,background:`${rarityColor[a.rarity]}20`,color:rarityColor[a.rarity]||'#9d6fff'}}>{a.rarity}</span>
              <span style={{...S.pill,background:'rgba(157,111,255,0.1)',color:'#9d6fff'}}>{a.category}</span>
            </div>
            <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)'}}>{a.id} · {(a.unlock_criteria as any)?.type ?? 'manual'} · +{a.xp_reward} XP</div>
          </div>
          <div style={{display:'flex',gap:6,flexShrink:0}}>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'rgba(var(--fg2-rgb),0.5)',padding:4,display:'flex'}} onClick={()=>openEdit(a)}><IcoPencil/></button>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'#ff4785',padding:4,display:'flex'}} onClick={()=>setDel(a)}><IcoTrash/></button>
          </div>
        </div>
      ))}

      {form && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setForm(null)}}>
          <div style={{...S.sheetIn,maxHeight:'92dvh'}}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:18}}>{isNew?(ar?'شارة جديدة':'New Badge'):(ar?'تعديل الشارة':'Edit Badge')}</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <span style={S.label}>{ar?'المعرّف (id)':'ID (slug)'}</span>
                <input style={S.input} placeholder="e.g. first_win" value={form.id} disabled={!isNew} onChange={e=>setForm(f=>f&&({...f,id:slugify(e.target.value)}))}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'الاسم (En)':'Name (En)'}</span><input style={S.input} value={form.name} onChange={e=>setForm(f=>f&&({...f,name:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'الاسم (Ar)':'Name (Ar)'}</span><input style={S.input} value={form.name_ar} onChange={e=>setForm(f=>f&&({...f,name_ar:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'الوصف (En)':'Description (En)'}</span><input style={S.input} value={form.description} onChange={e=>setForm(f=>f&&({...f,description:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'الوصف (Ar)':'Description (Ar)'}</span><input style={S.input} value={form.description_ar} onChange={e=>setForm(f=>f&&({...f,description_ar:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'أيقونة (إيموجي)':'Icon (emoji)'}</span><input style={S.input} value={form.icon} onChange={e=>setForm(f=>f&&({...f,icon:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'اللون':'Color'}</span><input style={S.input} type="color" value={form.color||'#9d6fff'} onChange={e=>setForm(f=>f&&({...f,color:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'مكافأة XP':'XP Reward'}</span><input style={S.input} type="number" value={form.xp_reward} onChange={e=>setForm(f=>f&&({...f,xp_reward:parseInt(e.target.value)||0}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'الندرة':'Rarity'}</span>
                  <select style={S.input} value={form.rarity} onChange={e=>setForm(f=>f&&({...f,rarity:e.target.value}))}>
                    {RARITIES.map(r=><option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
                <div><span style={S.label}>{ar?'الفئة':'Category'}</span>
                  <select style={S.input} value={form.category} onChange={e=>setForm(f=>f&&({...f,category:e.target.value}))}>
                    {BADGE_CATEGORIES.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:needsValue?'1fr 1fr':'1fr',gap:10}}>
                <div><span style={S.label}>{ar?'شرط الفتح':'Unlock Criteria'}</span>
                  <select style={S.input} value={criteriaType} onChange={e=>setCriteria({type:e.target.value})}>
                    {CRITERIA_TYPES.map(c=><option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                {needsValue && (
                  <div><span style={S.label}>{ar?'القيمة المطلوبة':'Required Value'}</span>
                    <input style={S.input} type="number" value={criteriaValue} onChange={e=>setCriteria({value:parseInt(e.target.value)||0})}/>
                  </div>
                )}
              </div>
              <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.35)',lineHeight:1.5}}>
                {ar?'"يدوي" يعني أن الإدارة تمنح الشارة يدوياً فقط. الأنواع الأخرى تُفتح تلقائياً عند بلوغ القيمة المطلوبة.':'"manual" means the badge is only ever granted by an admin. Other types auto-unlock once the player crosses the required value.'}
              </div>
              <div style={{display:'flex',gap:8,paddingTop:4}}>
                <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setForm(null)}>{ar?'إلغاء':'Cancel'}</button>
                <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy} onClick={save}>{ar?'حفظ':'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {del && (
        <div style={S.dialog}>
          <div style={{...S.dbox,border:'1px solid rgba(255,71,133,0.15)'}}>
            <div style={{fontSize:15,fontWeight:700,color:'#ff4785',marginBottom:8}}>{ar?'تأكيد الحذف':'Confirm Delete'}</div>
            <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.55)',lineHeight:1.5,marginBottom:20}}>{ar?`سيتم حذف "${del.name_ar}" نهائياً.`:`"${del.name}" will be permanently deleted.`}</div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setDel(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.danger,flex:1,justifyContent:'center'}} onClick={remove}>{ar?'حذف':'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Content: Cosmetics Shop ─────────────────────────────────────────────────
// Every price, rarity, translation, availability flag, and seasonal window
// for the Coins-only cosmetics shop lives in cosmetic_items and is editable
// here — no code change or redeploy needed to rebalance the economy or run a
// seasonal event. Purchases themselves never touch this table; they only
// insert into user_cosmetic_unlocks via the purchase_cosmetic_item() RPC.

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n:number) => String(n).padStart(2,'0')
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function emptyCosmeticForm(): CosmeticItemFull {
  return {
    id:'', type:'frame', rarity:'common', label:'', label_ar:'', description:'', description_ar:'',
    icon:'🎁', price_coins:1000, is_available:true, seasonal_start:null, seasonal_end:null,
    sort_order:0, style:{}, unlock_criteria:{type:'purchase'},
  } as CosmeticItemFull
}

function CosmeticsSection({ lang, items, refetch, flash }: { lang:Lang; items:CosmeticItemFull[]; refetch:()=>Promise<void>; flash:(m:string,c?:string)=>void }) {
  const ar = lang === 'ar'
  const [form, setForm] = useState<CosmeticItemFull|null>(null)
  const [isNew, setIsNew] = useState(true)
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<CosmeticItemFull|null>(null)
  const [typeFilter, setTypeFilter] = useState<string>('all')

  const criteriaType = ((form?.unlock_criteria as any)?.type as string) || 'purchase'
  const setCriteriaType = (t:string) => setForm(f => f && ({ ...f, unlock_criteria: { type: t }, price_coins: t==='purchase' ? (f.price_coins ?? 1000) : null }))

  const openNew = () => { setForm(emptyCosmeticForm()); setIsNew(true) }
  const openEdit = (c:CosmeticItemFull) => { setForm({...c}); setIsNew(false) }

  const filtered = typeFilter==='all' ? items : items.filter(c=>c.type===typeFilter)

  const save = async () => {
    if (!form) return
    const id = isNew ? slugify(form.id || form.label) : form.id
    if (!id || !form.label.trim() || !form.label_ar.trim()) { flash(ar?'الاسم والمعرّف مطلوبان':'Name and ID are required','#ff4785'); return }
    if (criteriaType==='purchase' && (!form.price_coins || form.price_coins <= 0)) { flash(ar?'سعر الكوينز مطلوب للعناصر القابلة للشراء':'Coin price is required for purchasable items','#ff4785'); return }
    setBusy(true)
    const { error } = await adminUpsertCosmeticItem({
      ...form, id,
      seasonal_start: form.seasonal_start ? new Date(form.seasonal_start).toISOString() : null,
      seasonal_end: form.seasonal_end ? new Date(form.seasonal_end).toISOString() : null,
    })
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setForm(null)
    await refetch()
    flash(isNew?(ar?'تم إنشاء العنصر':'Item created'):(ar?'تم حفظ التعديلات':'Changes saved'))
  }

  const toggleAvailable = async (c:CosmeticItemFull) => {
    const { error } = await adminSetCosmeticAvailable(c.id, !c.is_available)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await refetch()
    flash(c.is_available?(ar?'تم إخفاء العنصر من المتجر':'Item hidden from shop'):(ar?'تم إظهار العنصر في المتجر':'Item shown in shop'))
  }

  const remove = async () => {
    if (!del) return
    setBusy(true)
    const { error } = await adminDeleteCosmeticItem(del.id)
    setBusy(false); setDel(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await refetch()
    flash(ar?'تم حذف العنصر':'Item deleted','#ff4785')
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:8,flexWrap:'wrap'}}>
        <button style={{...S.primary,alignSelf:'flex-start'}} onClick={openNew}>+ {ar?'عنصر جديد':'New Item'}</button>
        <select style={{...S.input,width:'auto',flexShrink:0}} value={typeFilter} onChange={e=>setTypeFilter(e.target.value)}>
          <option value="all">{ar?'كل الأنواع':'All types'}</option>
          {COSMETIC_TYPES.map(t=><option key={t} value={t}>{ar?cosmeticTypeLabel[t].ar:cosmeticTypeLabel[t].en}</option>)}
        </select>
      </div>

      {filtered.length===0 && <Empty icon="🎨" title={ar?'لا توجد عناصر':'No items yet'} sub={ar?'أضف أول عنصر في المتجر':'Add the first shop item'}/>}

      {filtered.map(c=>(
        <div key={c.id} style={{...S.card,display:'flex',gap:10,alignItems:'center',opacity:c.is_available?1:0.55}}>
          <div style={{fontSize:22,flexShrink:0,width:32,textAlign:'center'}}>{c.icon}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:3}}>
              <span style={{fontSize:13,fontWeight:700,color:'var(--foreground)'}}>{ar?c.label_ar:c.label}</span>
              <span style={{...S.pill,background:`${shopRarityColor[c.rarity]}20`,color:shopRarityColor[c.rarity]||'#9d6fff'}}>{c.rarity}</span>
              <span style={{...S.pill,background:'rgba(157,111,255,0.1)',color:'#9d6fff'}}>{ar?cosmeticTypeLabel[c.type]?.ar:cosmeticTypeLabel[c.type]?.en ?? c.type}</span>
              {!c.is_available && <span style={{...S.pill,background:'rgba(255,71,133,0.12)',color:'#ff4785'}}>{ar?'مخفي':'Hidden'}</span>}
            </div>
            <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)'}}>
              {c.id} · {c.price_coins ? `${c.price_coins.toLocaleString()} 🪙` : (ar?'غير قابل للشراء':'not purchasable')}
              {c.seasonal_start && ` · ${ar?'من':'from'} ${new Date(c.seasonal_start).toLocaleDateString()}`}
              {c.seasonal_end && ` ${ar?'إلى':'to'} ${new Date(c.seasonal_end).toLocaleDateString()}`}
            </div>
          </div>
          <div style={{display:'flex',gap:6,flexShrink:0}}>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'rgba(var(--fg2-rgb),0.5)',padding:4,display:'flex'}} onClick={()=>toggleAvailable(c)} title={c.is_available?'Hide':'Show'}><IcoRefresh/></button>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'rgba(var(--fg2-rgb),0.5)',padding:4,display:'flex'}} onClick={()=>openEdit(c)}><IcoPencil/></button>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'#ff4785',padding:4,display:'flex'}} onClick={()=>setDel(c)}><IcoTrash/></button>
          </div>
        </div>
      ))}

      {form && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setForm(null)}}>
          <div style={{...S.sheetIn,maxHeight:'92dvh'}}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:18}}>{isNew?(ar?'عنصر جديد':'New Item'):(ar?'تعديل العنصر':'Edit Item')}</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div>
                <span style={S.label}>{ar?'المعرّف (id)':'ID (slug)'}</span>
                <input style={S.input} placeholder="e.g. frame_prism" value={form.id} disabled={!isNew} onChange={e=>setForm(f=>f&&({...f,id:slugify(e.target.value)}))}/>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'الاسم (En)':'Name (En)'}</span><input style={S.input} value={form.label} onChange={e=>setForm(f=>f&&({...f,label:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'الاسم (Ar)':'Name (Ar)'}</span><input style={S.input} value={form.label_ar} onChange={e=>setForm(f=>f&&({...f,label_ar:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'الوصف (En)':'Description (En)'}</span><input style={S.input} value={form.description} onChange={e=>setForm(f=>f&&({...f,description:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'الوصف (Ar)':'Description (Ar)'}</span><input style={S.input} value={form.description_ar} onChange={e=>setForm(f=>f&&({...f,description_ar:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'أيقونة (إيموجي)':'Icon (emoji)'}</span><input style={S.input} value={form.icon} onChange={e=>setForm(f=>f&&({...f,icon:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'النوع':'Type'}</span>
                  <select style={S.input} value={form.type} onChange={e=>setForm(f=>f&&({...f,type:e.target.value}))}>
                    {COSMETIC_TYPES.map(t=><option key={t} value={t}>{ar?cosmeticTypeLabel[t].ar:cosmeticTypeLabel[t].en}</option>)}
                  </select>
                </div>
                <div><span style={S.label}>{ar?'الندرة':'Rarity'}</span>
                  <select style={S.input} value={form.rarity} onChange={e=>setForm(f=>f&&({...f,rarity:e.target.value}))}>
                    {SHOP_RARITIES.map(r=><option key={r} value={r}>{r}</option>)}
                  </select>
                </div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:criteriaType==='purchase'?'1fr 1fr':'1fr',gap:10}}>
                <div><span style={S.label}>{ar?'طريقة الحصول عليه':'Acquisition'}</span>
                  <select style={S.input} value={criteriaType} onChange={e=>setCriteriaType(e.target.value)}>
                    <option value="purchase">{ar?'شراء بالكوينز':'Purchase with Coins'}</option>
                    <option value="default">{ar?'مجاني (افتراضي)':'Free (default)'}</option>
                    <option value="season_pass">{ar?'بطاقة الموسم':'Season Pass'}</option>
                  </select>
                </div>
                {criteriaType==='purchase' && (
                  <div><span style={S.label}>{ar?'السعر (كوينز)':'Price (Coins)'}</span>
                    <input style={S.input} type="number" min={1} value={form.price_coins ?? ''} onChange={e=>setForm(f=>f&&({...f,price_coins:parseInt(e.target.value)||0}))}/>
                  </div>
                )}
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'متاح للبيع من (اختياري)':'Available from (optional)'}</span>
                  <input style={S.input} type="datetime-local" value={toLocalInput(form.seasonal_start)} onChange={e=>setForm(f=>f&&({...f,seasonal_start:e.target.value?new Date(e.target.value).toISOString():null}))}/>
                </div>
                <div><span style={S.label}>{ar?'متاح للبيع حتى (اختياري)':'Available until (optional)'}</span>
                  <input style={S.input} type="datetime-local" value={toLocalInput(form.seasonal_end)} onChange={e=>setForm(f=>f&&({...f,seasonal_end:e.target.value?new Date(e.target.value).toISOString():null}))}/>
                </div>
              </div>
              <label style={{display:'flex',alignItems:'center',gap:6,cursor:'pointer',fontSize:12,color:'rgba(var(--fg2-rgb),0.65)'}}>
                <input type="checkbox" checked={form.is_available} onChange={e=>setForm(f=>f&&({...f,is_available:e.target.checked}))}/>
                {ar?'ظاهر في المتجر':'Visible in shop'}
              </label>
              <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.35)',lineHeight:1.5}}>
                {ar?'هذه العناصر تجميلية فقط — شراؤها لا يغيّر أبداً الخبرة أو المستوى أو الترتيب أو الإنجازات.':'These items are purely cosmetic — purchasing one never changes XP, level, rank, or achievements.'}
              </div>
              <div style={{display:'flex',gap:8,paddingTop:4}}>
                <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setForm(null)}>{ar?'إلغاء':'Cancel'}</button>
                <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy} onClick={save}>{ar?'حفظ':'Save'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {del && (
        <div style={S.dialog}>
          <div style={{...S.dbox,border:'1px solid rgba(255,71,133,0.15)'}}>
            <div style={{fontSize:15,fontWeight:700,color:'#ff4785',marginBottom:8}}>{ar?'تأكيد الحذف':'Confirm Delete'}</div>
            <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.55)',lineHeight:1.5,marginBottom:20}}>{ar?`سيتم حذف "${del.label_ar}" نهائياً.`:`"${del.label}" will be permanently deleted.`}</div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setDel(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.danger,flex:1,justifyContent:'center'}} onClick={remove}>{ar?'حذف':'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Content: Tournaments ────────────────────────────────────────────────────

const TOURNAMENT_STATUSES = ['upcoming','registration_open','active','completed'] as const

function TournamentsSection({ lang, items, refetch, flash }: { lang:Lang; items:TournamentFull[]; refetch:()=>Promise<void>; flash:(m:string,c?:string)=>void }) {
  const ar = lang === 'ar'
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({name:'',name_ar:'',qualification_rule:'',qualification_rule_ar:'',starts_at:'',ends_at:''})
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<TournamentFull|null>(null)

  const create = async () => {
    if (!form.name.trim()||!form.name_ar.trim()||!form.starts_at||!form.ends_at) { flash(ar?'الحقول المطلوبة ناقصة':'Required fields missing','#ff4785'); return }
    setBusy(true)
    const { error } = await adminCreateTournament(form.name, form.name_ar, form.qualification_rule, form.qualification_rule_ar, new Date(form.starts_at).toISOString(), new Date(form.ends_at).toISOString())
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setForm({name:'',name_ar:'',qualification_rule:'',qualification_rule_ar:'',starts_at:'',ends_at:''})
    setShowForm(false)
    await refetch()
    flash(ar?'تم إنشاء البطولة':'Tournament created')
  }

  const setStatus = async (t:TournamentFull, status:string) => {
    const { error } = await adminUpdateTournament(t.id, { status })
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await refetch()
    flash(ar?'تم تحديث الحالة':'Status updated')
  }

  const genBracket = async (t:TournamentFull) => {
    const { error } = await adminGenerateTournamentBracket(t.id)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await refetch()
    flash(ar?'تم إنشاء شجرة البطولة':'Bracket generated')
  }

  const remove = async () => {
    if (!del) return
    setBusy(true)
    const { error } = await adminDeleteTournament(del.id)
    setBusy(false); setDel(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await refetch()
    flash(ar?'تم حذف البطولة':'Tournament deleted','#ff4785')
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <button style={{...S.primary,alignSelf:'flex-start'}} onClick={()=>setShowForm(true)}>+ {ar?'بطولة جديدة':'New Tournament'}</button>

      {items.length===0 && <Empty icon="🏆" title={ar?'لا توجد بطولات':'No tournaments'} sub={ar?'أنشئ أول بطولة':'Create your first tournament'}/>}

      {items.map(t=>(
        <div key={t.id} style={S.card}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,marginBottom:6}}>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:'var(--foreground)'}}>{ar?t.name_ar:t.name}</div>
              <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)',marginTop:2}}>{t.starts_at?new Date(t.starts_at).toLocaleDateString():'—'} → {t.ends_at?new Date(t.ends_at).toLocaleDateString():'—'}</div>
            </div>
            <button style={{background:'none',border:'none',cursor:'pointer',color:'#ff4785',padding:4,display:'flex',flexShrink:0}} onClick={()=>setDel(t)}><IcoTrash/></button>
          </div>
          <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.55)',marginBottom:10}}>{ar?t.qualification_rule_ar:t.qualification_rule}</div>
          <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
            <select style={{...S.input,width:'auto',padding:'6px 10px',fontSize:11}} value={t.status} onChange={e=>setStatus(t,e.target.value)}>
              {TOURNAMENT_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
            </select>
            <button style={{...S.ghost,fontSize:11,padding:'6px 12px'}} onClick={()=>genBracket(t)}><IcoTrophy/> {ar?'إنشاء الشجرة':'Generate Bracket'}</button>
          </div>
        </div>
      ))}

      {showForm && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setShowForm(false)}}>
          <div style={{...S.sheetIn,maxHeight:'90dvh'}}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:18}}>{ar?'بطولة جديدة':'New Tournament'}</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'الاسم (En)':'Name (En)'}</span><input style={S.input} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'الاسم (Ar)':'Name (Ar)'}</span><input style={S.input} value={form.name_ar} onChange={e=>setForm(f=>({...f,name_ar:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'شرط التأهل (En)':'Qualification Rule (En)'}</span><input style={S.input} value={form.qualification_rule} onChange={e=>setForm(f=>({...f,qualification_rule:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'شرط التأهل (Ar)':'Qualification Rule (Ar)'}</span><input style={S.input} value={form.qualification_rule_ar} onChange={e=>setForm(f=>({...f,qualification_rule_ar:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'يبدأ':'Starts At'}</span><input style={S.input} type="datetime-local" value={form.starts_at} onChange={e=>setForm(f=>({...f,starts_at:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'ينتهي':'Ends At'}</span><input style={S.input} type="datetime-local" value={form.ends_at} onChange={e=>setForm(f=>({...f,ends_at:e.target.value}))}/></div>
              </div>
              <div style={{display:'flex',gap:8,paddingTop:4}}>
                <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setShowForm(false)}>{ar?'إلغاء':'Cancel'}</button>
                <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy} onClick={create}>{ar?'إنشاء':'Create'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {del && (
        <div style={S.dialog}>
          <div style={{...S.dbox,border:'1px solid rgba(255,71,133,0.15)'}}>
            <div style={{fontSize:15,fontWeight:700,color:'#ff4785',marginBottom:8}}>{ar?'تأكيد الحذف':'Confirm Delete'}</div>
            <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.55)',lineHeight:1.5,marginBottom:20}}>{ar?`سيتم حذف "${del.name_ar}" نهائياً.`:`"${del.name}" will be permanently deleted.`}</div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setDel(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.danger,flex:1,justifyContent:'center'}} onClick={remove}>{ar?'حذف':'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Content: Challenges ─────────────────────────────────────────────────────

// ── Content: Coins Economy ───────────────────────────────────────────────────
// Every Coin amount awarded anywhere in the game (Solo, Multiplayer,
// Tournaments, daily rewards) lives in coin_reward_config as a single
// key→amount catalog, edited here through admin_set_coin_reward() — the same
// server-validated, auditable write path used for every other admin table.
// This is also where the owner enforces "Solo stays the lowest tier" by
// eye — the list is sorted by amount so the hierarchy is visible at a glance.

const COIN_KEY_LABELS: Record<string,{en:string;ar:string}> = {
  practice_completed:    { en:'Solo / Practice completed', ar:'إكمال التدريب الفردي' },
  match_played:          { en:'Multiplayer match played',  ar:'مباراة جماعية ملعوبة' },
  match_win_1st:         { en:'Multiplayer — 1st place bonus', ar:'مكافأة المركز الأول' },
  match_win_2nd:         { en:'Multiplayer — 2nd place bonus', ar:'مكافأة المركز الثاني' },
  match_win_3rd:         { en:'Multiplayer — 3rd place bonus', ar:'مكافأة المركز الثالث' },
  tournament_match_played:{ en:'Tournament match played',  ar:'مباراة بطولة ملعوبة' },
  tournament_match_win:  { en:'Tournament match won',       ar:'فوز في مباراة بطولة' },
}

function CoinsSection({ lang, items, refetch, flash }: { lang:Lang; items:CoinRewardConfig[]; refetch:()=>Promise<void>; flash:(m:string,c?:string)=>void }) {
  const ar = lang === 'ar'
  const [drafts, setDrafts] = useState<Record<string, number>>({})
  const [busyKey, setBusyKey] = useState<string|null>(null)

  const sorted = [...items].sort((a,b) => a.amount - b.amount)
  const valueFor = (k:string, fallback:number) => drafts[k] ?? fallback

  const save = async (key: string, fallback: number) => {
    const amount = valueFor(key, fallback)
    setBusyKey(key)
    const { error } = await adminSetCoinReward(key, amount)
    setBusyKey(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setDrafts(d => { const n = {...d}; delete n[key]; return n })
    await refetch()
    flash(ar?'تم تحديث المكافأة':'Reward updated')
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.5)',lineHeight:1.5,padding:'0 2px'}}>
        {ar
          ? 'يجب أن يبقى الوضع الفردي أقل مصدر للكوينز؛ يجب أن تظل الجماعية والبطولات دائمًا الأعلى.'
          : 'Solo should stay the lowest Coin source — Multiplayer and Tournaments should always sit highest.'}
      </div>

      {items.length===0 && <Empty icon="🪙" title={ar?'لا توجد إعدادات':'No reward config'} sub={ar?'لم يتم تحميل جدول المكافآت':'Coin reward table not loaded'}/>}

      {sorted.map(item => {
        const meta = COIN_KEY_LABELS[item.key]
        const label = meta ? (ar?meta.ar:meta.en) : (ar?item.label_ar:item.label) || item.key
        const dirty = drafts[item.key] !== undefined && drafts[item.key] !== item.amount
        return (
          <div key={item.key} style={S.card}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:'var(--foreground)'}}>{label}</div>
                <div style={{fontSize:10.5,color:'rgba(var(--fg2-rgb),0.4)',marginTop:2,fontFamily:'monospace'}}>{item.key}</div>
              </div>
              <input
                style={{...S.input,width:90,textAlign:'center'}}
                type="number" min={0}
                value={valueFor(item.key, item.amount)}
                onChange={e=>setDrafts(d=>({...d,[item.key]:Math.max(0,parseInt(e.target.value)||0)}))}
              />
              <button
                style={{...S.primary,opacity:dirty?1:0.4,cursor:dirty?'pointer':'default'}}
                disabled={!dirty || busyKey===item.key}
                onClick={()=>save(item.key, item.amount)}
              >
                {ar?'حفظ':'Save'}
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

const CHALLENGE_PERIODS = ['daily','weekly','monthly','seasonal'] as const

function ChallengesSection({ lang, items, games, refetch, flash }: { lang:Lang; items:ChallengeFull[]; games:GameFull[]; refetch:()=>Promise<void>; flash:(m:string,c?:string)=>void }) {
  const ar = lang === 'ar'
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({period_type:'weekly' as typeof CHALLENGE_PERIODS[number],title:'',title_ar:'',game_id:'',question_count:10,starts_at:'',ends_at:'',xp_reward:100,coin_reward:30})
  const [busy, setBusy] = useState(false)
  const [del, setDel] = useState<ChallengeFull|null>(null)
  const [editRewards, setEditRewards] = useState<ChallengeFull|null>(null)
  const [rewardDraft, setRewardDraft] = useState({xp_reward:0, coin_reward:0})

  // Defaults follow the same period-type tiers the DB uses when a challenge
  // is created without explicit amounts, so the form starts sensible.
  const REWARD_DEFAULTS: Record<typeof CHALLENGE_PERIODS[number], {xp:number; coin:number}> = {
    daily: {xp:30, coin:15}, weekly: {xp:100, coin:30}, monthly: {xp:250, coin:60}, seasonal: {xp:400, coin:100},
  }

  const create = async () => {
    if (!form.title.trim()||!form.title_ar.trim()||!form.starts_at||!form.ends_at) { flash(ar?'الحقول المطلوبة ناقصة':'Required fields missing','#ff4785'); return }
    setBusy(true)
    const { error } = await adminCreateChallenge(form.period_type, form.title, form.title_ar, form.game_id||null, form.question_count, new Date(form.starts_at).toISOString(), new Date(form.ends_at).toISOString(), form.xp_reward, form.coin_reward)
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setForm({period_type:'weekly',title:'',title_ar:'',game_id:'',question_count:10,starts_at:'',ends_at:'',xp_reward:100,coin_reward:30})
    setShowForm(false)
    await refetch()
    flash(ar?'تم إنشاء التحدي':'Challenge created')
  }

  const remove = async () => {
    if (!del) return
    setBusy(true)
    const { error } = await adminDeleteChallenge(del.id)
    setBusy(false); setDel(null)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    await refetch()
    flash(ar?'تم حذف التحدي':'Challenge deleted','#ff4785')
  }

  const saveRewards = async () => {
    if (!editRewards) return
    setBusy(true)
    const { error } = await adminUpdateChallengeRewards(editRewards.id, rewardDraft.xp_reward, rewardDraft.coin_reward)
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setEditRewards(null)
    await refetch()
    flash(ar?'تم تحديث المكافآت':'Rewards updated')
  }

  const gameName = (id:string|null) => id ? (games.find(g=>g.id===id) ? (ar?games.find(g=>g.id===id)!.name_ar:games.find(g=>g.id===id)!.name) : id) : (ar?'أي لعبة':'Any game')

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <button style={{...S.primary,alignSelf:'flex-start'}} onClick={()=>setShowForm(true)}>+ {ar?'تحدٍ جديد':'New Challenge'}</button>

      {items.length===0 && <Empty icon="⚡" title={ar?'لا توجد تحديات':'No challenges'} sub={ar?'أنشئ أول تحدٍ':'Create your first challenge'}/>}

      {items.map(c=>(
        <div key={c.id} style={S.card}>
          <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',gap:8,marginBottom:6}}>
            <div>
              <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:2}}>
                <span style={{fontSize:14,fontWeight:700,color:'var(--foreground)'}}>{ar?c.title_ar:c.title}</span>
                <span style={{...S.pill,background:'rgba(157,111,255,0.12)',color:'#9d6fff'}}>{c.period_type}</span>
              </div>
              <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)'}}>{gameName(c.game_id)} · {c.question_count} {ar?'أسئلة':'questions'}</div>
              <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)',marginTop:2}}>{new Date(c.starts_at).toLocaleString()} → {new Date(c.ends_at).toLocaleString()}</div>
            </div>
            <div style={{display:'flex',gap:4,flexShrink:0}}>
              <button style={{background:'none',border:'none',cursor:'pointer',color:'#9d6fff',padding:4,display:'flex'}} onClick={()=>{setEditRewards(c); setRewardDraft({xp_reward:c.xp_reward, coin_reward:c.coin_reward})}}><IcoPencil/></button>
              <button style={{background:'none',border:'none',cursor:'pointer',color:'#ff4785',padding:4,display:'flex'}} onClick={()=>setDel(c)}><IcoTrash/></button>
            </div>
          </div>
          <div style={{display:'flex',gap:6,marginTop:6}}>
            <span style={{...S.pill,background:'rgba(255,215,0,0.12)',color:'#ffd700'}}>+{c.xp_reward} XP</span>
            <span style={{...S.pill,background:'rgba(255,193,7,0.12)',color:'#ffc107'}}>+{c.coin_reward} {ar?'كوينز':'Coins'}</span>
          </div>
        </div>
      ))}

      {showForm && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setShowForm(false)}}>
          <div style={{...S.sheetIn,maxHeight:'90dvh'}}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:18}}>{ar?'تحدٍ جديد':'New Challenge'}</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div><span style={S.label}>{ar?'النوع':'Period'}</span>
                <select style={S.input} value={form.period_type} onChange={e=>{
                  const p = e.target.value as typeof CHALLENGE_PERIODS[number]
                  setForm(f=>({...f,period_type:p,xp_reward:REWARD_DEFAULTS[p].xp,coin_reward:REWARD_DEFAULTS[p].coin}))
                }}>
                  {CHALLENGE_PERIODS.map(p=><option key={p} value={p}>{p}</option>)}
                </select>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'العنوان (En)':'Title (En)'}</span><input style={S.input} value={form.title} onChange={e=>setForm(f=>({...f,title:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'العنوان (Ar)':'Title (Ar)'}</span><input style={S.input} value={form.title_ar} onChange={e=>setForm(f=>({...f,title_ar:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'اللعبة (اختياري)':'Game (optional)'}</span>
                  <select style={S.input} value={form.game_id} onChange={e=>setForm(f=>({...f,game_id:e.target.value}))}>
                    <option value="">{ar?'أي لعبة':'Any game'}</option>
                    {games.map(g=><option key={g.id} value={g.id}>{ar?g.name_ar:g.name}</option>)}
                  </select>
                </div>
                <div><span style={S.label}>{ar?'عدد الأسئلة':'Question Count'}</span><input style={S.input} type="number" value={form.question_count} onChange={e=>setForm(f=>({...f,question_count:parseInt(e.target.value)||10}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'يبدأ':'Starts At'}</span><input style={S.input} type="datetime-local" value={form.starts_at} onChange={e=>setForm(f=>({...f,starts_at:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'ينتهي':'Ends At'}</span><input style={S.input} type="datetime-local" value={form.ends_at} onChange={e=>setForm(f=>({...f,ends_at:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'مكافأة XP':'XP Reward'}</span><input style={S.input} type="number" min={0} value={form.xp_reward} onChange={e=>setForm(f=>({...f,xp_reward:Math.max(0,parseInt(e.target.value)||0)}))}/></div>
                <div><span style={S.label}>{ar?'مكافأة الكوينز':'Coin Reward'}</span><input style={S.input} type="number" min={0} value={form.coin_reward} onChange={e=>setForm(f=>({...f,coin_reward:Math.max(0,parseInt(e.target.value)||0)}))}/></div>
              </div>
              <div style={{display:'flex',gap:8,paddingTop:4}}>
                <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setShowForm(false)}>{ar?'إلغاء':'Cancel'}</button>
                <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy} onClick={create}>{ar?'إنشاء':'Create'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {editRewards && (
        <div style={S.dialog}>
          <div style={S.dbox}>
            <div style={{fontSize:15,fontWeight:700,color:'var(--foreground)',marginBottom:12}}>{ar?'تعديل المكافآت':'Edit Rewards'}</div>
            <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10,marginBottom:20}}>
              <div><span style={S.label}>{ar?'مكافأة XP':'XP Reward'}</span><input style={S.input} type="number" min={0} value={rewardDraft.xp_reward} onChange={e=>setRewardDraft(d=>({...d,xp_reward:Math.max(0,parseInt(e.target.value)||0)}))}/></div>
              <div><span style={S.label}>{ar?'مكافأة الكوينز':'Coin Reward'}</span><input style={S.input} type="number" min={0} value={rewardDraft.coin_reward} onChange={e=>setRewardDraft(d=>({...d,coin_reward:Math.max(0,parseInt(e.target.value)||0)}))}/></div>
            </div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setEditRewards(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy} onClick={saveRewards}>{ar?'حفظ':'Save'}</button>
            </div>
          </div>
        </div>
      )}

      {del && (
        <div style={S.dialog}>
          <div style={{...S.dbox,border:'1px solid rgba(255,71,133,0.15)'}}>
            <div style={{fontSize:15,fontWeight:700,color:'#ff4785',marginBottom:8}}>{ar?'تأكيد الحذف':'Confirm Delete'}</div>
            <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.55)',lineHeight:1.5,marginBottom:20}}>{ar?`سيتم حذف "${del.title_ar}" نهائياً.`:`"${del.title}" will be permanently deleted.`}</div>
            <div style={{display:'flex',gap:8}}>
              <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setDel(null)}>{ar?'إلغاء':'Cancel'}</button>
              <button style={{...S.danger,flex:1,justifyContent:'center'}} onClick={remove}>{ar?'حذف':'Delete'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Content: Season ──────────────────────────────────────────────────────────

function SeasonSection({ lang, activeSeason, refetch, flash }: { lang:Lang; activeSeason:SeasonFull|null; refetch:()=>Promise<void>; flash:(m:string,c?:string)=>void }) {
  const ar = lang === 'ar'
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({name:'',name_ar:'',starts_at:'',ends_at:''})
  const [busy, setBusy] = useState(false)

  const endAndStart = async () => {
    if (!form.name.trim()||!form.name_ar.trim()||!form.starts_at||!form.ends_at) { flash(ar?'الحقول المطلوبة ناقصة':'Required fields missing','#ff4785'); return }
    setBusy(true)
    const { error } = await adminEndSeasonAndStartNew(form.name, form.name_ar, new Date(form.starts_at).toISOString(), new Date(form.ends_at).toISOString())
    setBusy(false)
    if (error) { flash(describeAdminError(error, ar),'#ff4785'); return }
    setForm({name:'',name_ar:'',starts_at:'',ends_at:''})
    setShowForm(false)
    await refetch()
    flash(ar?'تم بدء موسم جديد':'New season started')
  }

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      <div style={S.card}>
        <div style={S.sectionHead}>{ar?'الموسم الحالي':'Current Season'}</div>
        {activeSeason ? (
          <>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:4}}>{ar?activeSeason.name_ar:activeSeason.name}</div>
            <div style={{fontSize:12,color:'rgba(var(--fg2-rgb),0.5)'}}>{new Date(activeSeason.starts_at).toLocaleDateString()} → {new Date(activeSeason.ends_at).toLocaleDateString()}</div>
          </>
        ) : (
          <div style={{fontSize:13,color:'rgba(var(--fg2-rgb),0.45)'}}>{ar?'لا يوجد موسم نشط':'No active season'}</div>
        )}
      </div>

      <button style={{...S.primary,alignSelf:'flex-start'}} onClick={()=>setShowForm(true)}>
        {activeSeason?(ar?'إنهاء الموسم وبدء موسم جديد':'End Season & Start New'):(ar?'بدء موسم جديد':'Start New Season')}
      </button>

      <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.35)',lineHeight:1.5}}>
        {ar?'إنهاء الموسم الحالي يؤرشفه في "المواسم السابقة" ويبدأ موسماً جديداً فوراً. تقدم اللاعبين الموسمي يُعاد ضبطه تلقائياً.':'Ending the current season archives it under "Previous Seasons" and starts a new one immediately. Players\' season-scoped progress resets automatically.'}
      </div>

      {showForm && (
        <div style={S.sheet} onClick={e=>{if(e.target===e.currentTarget)setShowForm(false)}}>
          <div style={{...S.sheetIn,maxHeight:'90dvh'}}>
            <div style={S.handle}/>
            <div style={{fontSize:16,fontWeight:700,color:'var(--foreground)',marginBottom:18}}>{ar?'موسم جديد':'New Season'}</div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'الاسم (En)':'Name (En)'}</span><input style={S.input} value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'الاسم (Ar)':'Name (Ar)'}</span><input style={S.input} value={form.name_ar} onChange={e=>setForm(f=>({...f,name_ar:e.target.value}))}/></div>
              </div>
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                <div><span style={S.label}>{ar?'يبدأ':'Starts At'}</span><input style={S.input} type="datetime-local" value={form.starts_at} onChange={e=>setForm(f=>({...f,starts_at:e.target.value}))}/></div>
                <div><span style={S.label}>{ar?'ينتهي':'Ends At'}</span><input style={S.input} type="datetime-local" value={form.ends_at} onChange={e=>setForm(f=>({...f,ends_at:e.target.value}))}/></div>
              </div>
              <div style={{display:'flex',gap:8,paddingTop:4}}>
                <button style={{...S.ghost,flex:1,justifyContent:'center'}} onClick={()=>setShowForm(false)}>{ar?'إلغاء':'Cancel'}</button>
                <button style={{...S.primary,flex:1,justifyContent:'center'}} disabled={busy} onClick={endAndStart}>{ar?'تأكيد':'Confirm'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Activity Log ──────────────────────────────────────────────────────────────

function LogTab({ lang, loading, log }: { lang:Lang; loading:boolean; log:AdminLogEntry[] }) {
  const ar = lang === 'ar'
  type LogCat = 'all'|'users'|'codes'|'xp'|'badges'|'security'|'announcements'
  const [search, setSearch] = useState('')
  const [catFilter, setCatFilter] = useState<LogCat>('all')

  const catColors: Record<string,string> = {
    'users':'#9d6fff','codes':'#00d4ff','xp':'#ffd700','badges':'#ff6b35','security':'#ff4785','announcements':'#00e676',
  }
  const catIcons: Record<string,string> = {
    'users':'👤','codes':'🔑','xp':'⭐','badges':'🏆','security':'🔒','announcements':'📢',
  }

  const cats: {key:LogCat;label:string}[] = [
    {key:'all',           label:ar?'الكل':'All'},
    {key:'users',         label:ar?'المستخدمون':'Users'},
    {key:'codes',         label:ar?'الأكواد':'Codes'},
    {key:'xp',            label:'XP'},
    {key:'badges',        label:ar?'الشارات':'Badges'},
    {key:'security',      label:ar?'الأمان':'Security'},
    {key:'announcements', label:ar?'الإعلانات':'Announcements'},
  ]

  const filtered = log
    .filter(e => catFilter==='all' || e.category===catFilter)
    .filter(e => !search || e.action.toLowerCase().includes(search.toLowerCase()) || e.target.toLowerCase().includes(search.toLowerCase()) || e.detail.toLowerCase().includes(search.toLowerCase()))

  if (loading) return <div style={{display:'flex',flexDirection:'column',gap:10}}>{[...Array(4)].map((_,i)=><Skeleton key={i} h={70}/>)}</div>

  return (
    <div style={{display:'flex',flexDirection:'column',gap:12}}>
      {/* Search */}
      <div style={{position:'relative'}}>
        <span style={{position:'absolute',top:'50%',transform:'translateY(-50%)',left:11,color:'rgba(var(--fg2-rgb),0.4)',pointerEvents:'none',display:'flex'}}><IcoSearch/></span>
        <input style={{...S.input,paddingLeft:32}} placeholder={ar?'بحث في السجل…':'Search log…'} value={search} onChange={e=>setSearch(e.target.value)}/>
      </div>

      {/* Category filters */}
      <div style={{display:'flex',gap:6,overflowX:'auto',paddingBottom:2,scrollbarWidth:'none'}}>
        {cats.map(c=>(
          <button key={c.key} onClick={()=>setCatFilter(c.key)} style={{flexShrink:0,padding:'5px 13px',borderRadius:20,border:'none',cursor:'pointer',fontSize:11,fontWeight:600,transition:'all 0.15s',background:catFilter===c.key?'linear-gradient(135deg,#7c3aed,#9d6fff)':'rgba(var(--fg-rgb),0.06)',color:catFilter===c.key?'#fff':'rgba(var(--fg2-rgb),0.6)'}}>
            {c.label}
          </button>
        ))}
      </div>

      {/* Export — genuine client-side CSV of the (filtered) live admin log */}
      <button style={{...S.ghost,alignSelf:'flex-start',fontSize:12}} onClick={()=>downloadCsv(filtered.map(e=>({timestamp:e.timestamp,action:e.action,category:e.category,target:e.target,detail:e.detail})),'kastro-admin-log.csv')}><IcoDown/> {ar?'تصدير السجل':'Export Log'}</button>

      {/* Count */}
      <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.4)'}}>{filtered.length} {ar?'حدث':'events'}</div>

      {/* Empty */}
      {filtered.length===0 && <Empty icon="📋" title={ar?'لا توجد نتائج':'No results'} sub={ar?'جرب تغيير البحث أو الفلتر':'Try a different search or filter'}/>}

      {/* Entries */}
      {filtered.map(e=>(
        <div key={e.id} style={{...S.card,display:'flex',gap:12,alignItems:'flex-start'}}>
          <div style={{fontSize:15,lineHeight:1,marginTop:1,flexShrink:0,width:20,textAlign:'center'}}>{catIcons[e.category]||'📋'}</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:8,marginBottom:3}}>
              <span style={{fontSize:12,fontWeight:700,color:catColors[e.category]||'#9d6fff'}}>{e.action}</span>
              <span style={{fontSize:10,color:'rgba(var(--fg2-rgb),0.35)',fontFamily:"'JetBrains Mono',monospace",flexShrink:0,whiteSpace:'nowrap'}}>{e.timestamp}</span>
            </div>
            <div style={{fontSize:12,color:'var(--foreground)',marginBottom:2}}>{e.target}</div>
            <div style={{fontSize:11,color:'rgba(var(--fg2-rgb),0.45)',lineHeight:1.4}}>{e.detail}</div>
          </div>
        </div>
      ))}
    </div>
  )
}

// TEMPORARY, owner-only diagnostics viewer — see src/lib/diagnostics.ts.
// Was previously a floating 🐞 button + full-screen overlay shown on every
// page for owner accounts; that was flagged as unacceptable production UI
// (visible on all normal screens, not hidden by default) and has been
// removed from App.tsx entirely. This is its replacement: a plain tab here
// in Admin Dashboard, only ever visible to someone who already navigated
// here (owner-only route) and clicked this specific tab — nothing floats
// or overlays outside of it. Every diagLog(...) call across the app
// (presence heartbeat, match-room/board-game RPCs, realtime channel
// status) still feeds the same in-memory ring buffer regardless of whether
// this tab is ever opened; this is just a read-only viewer into it.
function DiagnosticsTab({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const [entries, setEntries] = useState<DiagEntry[]>(getDiagEntries())
  const [filter, setFilter] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => subscribeDiag(setEntries), [])

  const filtered = filter.trim()
    ? entries.filter(e => `${e.scope} ${e.message}`.toLowerCase().includes(filter.trim().toLowerCase()))
    : entries

  const copyAll = () => {
    const text = filtered
      .map(e => `${new Date(e.at).toISOString()} [${e.scope}] ${e.message}${e.data !== undefined ? ' ' + JSON.stringify(e.data) : ''}`)
      .join('\n')
    navigator.clipboard?.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }).catch(() => {})
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11.5, color: 'rgba(var(--fg2-rgb),0.45)', lineHeight: 1.5 }}>
        {ar
          ? 'سجل تشخيصي مؤقت في الذاكرة فقط — الحضور، غرف اللعب الجماعي، وحالة القنوات المباشرة. غير مرئي لأي مستخدم آخر.'
          : 'Temporary, in-memory diagnostics — presence, multiplayer rooms, and realtime channel status. Never visible to any non-owner account.'}
      </div>

      <div style={{ position: 'relative' }}>
        <span style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', left: 11, color: 'rgba(var(--fg2-rgb),0.4)', pointerEvents: 'none', display: 'flex' }}><IcoSearch/></span>
        <input style={{ ...S.input, paddingLeft: 32 }} placeholder={ar ? 'تصفية (مثال: presence, room, ready, realtime)' : 'Filter (e.g. presence, room, ready, realtime)'} value={filter} onChange={e => setFilter(e.target.value)} />
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button style={{ ...S.ghost, fontSize: 12 }} onClick={copyAll}>{copied ? (ar ? 'تم النسخ!' : 'Copied!') : (ar ? 'نسخ الكل' : 'Copy All')}</button>
        <button style={{ ...S.ghost, fontSize: 12 }} onClick={clearDiagEntries}>{ar ? 'مسح' : 'Clear'}</button>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)', alignSelf: 'center' }}>{filtered.length}/{entries.length}</div>
      </div>

      {filtered.length === 0 && <Empty icon="🐞" title={ar ? 'لا سجلات بعد' : 'No log entries yet'} sub={ar ? 'ابدأ استخدام الغرف/الدردشة/الحضور من أي جهاز' : 'Start using rooms/chat/presence from any device'} />}

      {filtered.map(e => (
        <div key={e.id} style={{ ...S.card, padding: '10px 12px' }}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'baseline', marginBottom: 3 }}>
            <span style={{ fontSize: 10, color: 'rgba(var(--fg2-rgb),0.35)', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>{new Date(e.at).toLocaleTimeString()}</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#67e8f9' }}>[{e.scope}]</span>
          </div>
          <div style={{ fontSize: 12, color: /fail|error|denied|forbidden/i.test(e.message) ? '#ff4757' : 'var(--foreground)' }}>{e.message}</div>
          {e.data !== undefined && (
            <pre style={{ margin: '4px 0 0', fontSize: 10.5, color: 'rgba(var(--fg2-rgb),0.55)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: "'JetBrains Mono',monospace" }}>
              {typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}
            </pre>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Root ──────────────────────────────────────────────────────────────────────

export default function AdminDashboardScreen({ onNavigate, lang, setLang, userEmail }: Props) {
  const [tab, setTab] = useState<AdminTab>('overview')
  const [loading, setLoading] = useState(true)
  const ar = lang === 'ar'

  // Raw rows as returned by adminApi — kept separate from the display shapes
  // (SampleUser/AccessCode) because users need to resolve access_code_id →
  // code, and codes need to resolve created_by → admin email, which requires
  // cross-referencing both fetched sets.
  const [rawUsers, setRawUsers] = useState<any[]>([])
  const [rawCodes, setRawCodes] = useState<any[]>([])
  const [games, setGames] = useState<GameRow[]>([])
  const [stats, setStats] = useState<OverviewStatsRow|null>(null)
  const [dauLong, setDauLong] = useState<number[]>([]) // 120 days, oldest→newest
  const [announcements, setAnnouncements] = useState<Announcement[]>([])
  const [log, setLog] = useState<AdminLogEntry[]>([])
  const [achievements, setAchievements] = useState<Achievement[]>([])

  const codeMap = React.useMemo(() => new Map(rawCodes.map((c:any) => [c.id, c.code])), [rawCodes])
  const userMap = React.useMemo(() => new Map(rawUsers.map((u:any) => [u.id, { username:u.username, email:u.email }])), [rawUsers])
  const users = React.useMemo(() => rawUsers.map((u:any) => toDisplayUser(u, codeMap)), [rawUsers, codeMap])
  const codes = React.useMemo(() => rawCodes.map((c:any) => toDisplayCode(c, userMap)), [rawCodes, userMap])

  // Derived engagement series — see chunkSum() doc comment for the
  // documented judgement call behind using DAU rollups as a WAU/MAU proxy.
  const dau = dauLong.slice(-14)
  const wau = chunkSum(dauLong.slice(-42), 7)
  const mau = chunkSum(dauLong, 30)

  const refetchUsers = useCallback(async () => { setRawUsers(await adminGetUsers()) }, [])
  const refetchCodes = useCallback(async () => { setRawCodes(await adminGetAccessCodes()) }, [])
  const refetchAnnouncements = useCallback(async () => { setAnnouncements((await adminGetAnnouncements()).map(toDisplayAnnouncement)) }, [])
  const refetchLog = useCallback(async () => { setLog((await adminGetLog()).map(toDisplayLog)) }, [])

  useEffect(() => {
    let cancelled = false
    async function loadAll() {
      const [statsRes, dauRes, gamesRes, usersRes, codesRes, announcementsRes, logRes, achievementsRes] = await Promise.all([
        adminGetOverviewStats(),
        adminGetDau(120),
        loadGameAnalytics(),
        adminGetUsers(),
        adminGetAccessCodes(),
        adminGetAnnouncements(),
        adminGetLog(),
        adminGetAllAchievements(),
      ])
      if (cancelled) return
      setStats(statsRes as OverviewStatsRow|null)
      setDauLong(dauRes)
      setGames(gamesRes)
      setRawUsers(usersRes)
      setRawCodes(codesRes)
      setAnnouncements(announcementsRes.map(toDisplayAnnouncement))
      setLog(logRes.map(toDisplayLog))
      setAchievements((achievementsRes as any[]).map((a) => ({ id: a.id, name: a.name, nameAr: a.name_ar })))
      setLoading(false)
    }
    loadAll()
    return () => { cancelled = true }
  }, [])

  const tabs: {key:AdminTab;en:string;ar:string;Icon:()=>React.ReactElement}[] = [
    {key:'overview',      en:'Overview', ar:'نظرة عامة',  Icon:IcoGrid},
    {key:'users',         en:'Users',    ar:'المستخدمون', Icon:IcoUsers},
    {key:'codes',         en:'Codes',    ar:'الأكواد',    Icon:IcoKey},
    {key:'branches',      en:'Branch Management', ar:'إدارة الفروع', Icon:IcoBranch},
    {key:'games',         en:'Analytics',ar:'التحليلات',  Icon:IcoBar},
    {key:'content',       en:'Content',  ar:'المحتوى',    Icon:IcoLayers},
    {key:'announcements', en:'Announce', ar:'الإعلانات',  Icon:IcoMega},
    {key:'log',           en:'Log',      ar:'السجل',      Icon:IcoLog},
    {key:'diagnostics',   en:'Diagnostics', ar:'التشخيص', Icon:IcoBug},
  ]

  return (
    <div style={{minHeight:'100dvh',background:'var(--background)',color:'var(--foreground)',display:'flex',flexDirection:'column'}}>
      <style>{`
        @keyframes skeleton-pulse { 0%,100%{opacity:0.5} 50%{opacity:1} }
        @keyframes toast-in { from{opacity:0;transform:translate(-50%,8px)} to{opacity:1;transform:translate(-50%,0)} }
      `}</style>

      {/* Top bar */}
      <div style={{padding:'14px 16px 10px',background:'rgba(255,71,133,0.05)',borderBottom:'1px solid rgba(255,71,133,0.12)',display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
        <button onClick={()=>onNavigate('profile')} style={{background:'none',border:'none',cursor:'pointer',color:'rgba(var(--fg2-rgb),0.55)',padding:4,display:'flex',borderRadius:6}}><IcoBack/></button>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:14,fontWeight:800,color:'#ff4785',fontFamily:"'Exo 2',sans-serif",letterSpacing:0.5}}>{ar?'لوحة الإدارة':'Admin Dashboard'}</div>
          <div style={{fontSize:10,color:'rgba(var(--fg2-rgb),0.35)',marginTop:1,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{userEmail}</div>
        </div>
        <button onClick={()=>setLang(lang==='en'?'ar':'en')} style={{background:'rgba(var(--fg-rgb),0.05)',border:'1px solid rgba(var(--fg-rgb),0.1)',borderRadius:6,padding:'5px 9px',color:'rgba(var(--fg2-rgb),0.6)',fontSize:11,fontWeight:700,cursor:'pointer',flexShrink:0}}>
          {lang==='en'?'ع':'EN'}
        </button>
      </div>

      {/* Tab bar */}
      <div style={{display:'flex',overflowX:'auto',background:'rgba(var(--fg-rgb),0.02)',borderBottom:'1px solid rgba(var(--fg-rgb),0.06)',flexShrink:0,scrollbarWidth:'none'}}>
        {tabs.map(t=>(
          <button key={t.key} onClick={()=>setTab(t.key)} style={{
            flexShrink:0, display:'flex', flexDirection:'column', alignItems:'center', gap:3,
            padding:'10px 14px', border:'none', cursor:'pointer', background:'none',
            borderBottom:`2px solid ${tab===t.key?'#ff4785':'transparent'}`,
            color:tab===t.key?'#ff4785':'rgba(var(--fg2-rgb),0.4)',
            transition:'color 0.15s',
          }}>
            <t.Icon/>
            <span style={{fontSize:9,fontWeight:700,letterSpacing:0.4}}>{ar?t.ar:t.en}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{flex:1,overflowY:'auto',padding:'16px 16px 40px'}}>
        {tab==='overview'      && <OverviewTab      lang={lang} loading={loading} users={users} games={games} stats={stats} dau={dau}/>}
        {tab==='users'         && <UsersTab         lang={lang} loading={loading} users={users} achievements={achievements} games={games} refetchUsers={refetchUsers} refetchLog={refetchLog}/>}
        {tab==='codes'         && <CodesTab         lang={lang} loading={loading} codes={codes} refetchCodes={refetchCodes} refetchLog={refetchLog} userEmail={userEmail}/>}
        {tab==='branches'      && <BranchesTab      lang={lang} refetchLog={refetchLog}/>}
        {tab==='games'         && <GamesTab         lang={lang} loading={loading} games={games} wau={wau} mau={mau}/>}
        {tab==='content'       && <ContentTab       lang={lang}/>}
        {tab==='announcements' && <AnnouncementsTab lang={lang} loading={loading} items={announcements} refetchAnnouncements={refetchAnnouncements} refetchLog={refetchLog}/>}
        {tab==='log'           && <LogTab           lang={lang} loading={loading} log={log}/>}
        {tab==='diagnostics'   && <DiagnosticsTab   lang={lang}/>}
      </div>
    </div>
  )
}
