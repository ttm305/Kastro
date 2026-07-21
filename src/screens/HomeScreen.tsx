import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { Screen, Lang } from '../App'
import TopBar from '../components/TopBar'
import DailyRewardModal from '../components/DailyRewardModal'
import Avatar from '../components/Avatar'
import { useAuth } from '../lib/auth'
import type { Tables } from '../lib/database.types'
import {
  getGames,
  getActivePowerHour,
  getGlobalActivity,
  getWeeklyGoalsProgress,
  getRecentAchievements,
  getCurrentChallenge,
  getProfileStats,
  getLeaderboard,
  getFriends,
  claimDailyReward,
  getBranches,
  levelProgress,
  type Game,
  type Achievement,
  type Branch,
  type CosmeticItem,
} from '../lib/api'
import { getCosmeticCatalog, resolveCosmetics, frameAvatarStyle } from '../lib/cosmetics'
import CosmeticBannerLayer from '../components/CosmeticBannerLayer'

interface Props {
  onNavigate: (s: Screen) => void
  onNavigateToGame: (s: Screen, gameId?: string) => void
  lang: Lang
  setLang: (l: Lang) => void
}

type ActivityLogRow = Tables<'activity_log'>
type ActivePowerHour = { multiplier: number; starts_at: string; ends_at: string }
type WeeklyChallenge = Tables<'challenges'>
type ProfileStats = { gamesPlayed: number; avgScore: number; wins: number; badgeCount: number; friendCount: number }
type FriendProfile = { id: string; username: string; is_online: boolean; avatar_url: string | null }
type RecentAchievement = { unlocked_at: string; achievement: Achievement }

// Static goal copy — only the "progress" numerator is backed by real data (see fetch effect below).
const WEEKLY_GOALS_META = [
  { en: 'Complete 5 game sessions', ar: 'أكمل ٥ جلسات ألعاب', total: 5, color: '#9d6fff' },
  { en: 'Score 80%+ in two games', ar: 'احصل على ٨٠٪+ في لعبتين', total: 2, color: '#00d4ff' },
  { en: 'Win one daily challenge', ar: 'افز بتحدٍّ يومي واحد', total: 1, color: '#ffd700' },
]

// Achievement rarity strings come from the DB in English (e.g. "Common"/"Rare"/"Epic"/"Legendary");
// there's no Arabic column for it, so translate the known enum values here (same pattern as ProfileScreen).
const RARITY_AR: Record<string, string> = { Legendary: 'أسطوري', Epic: 'ملحمي', Rare: 'نادر', Common: 'عادي' }

// "Playing Now" friends have no per-friend accent color or rank in the schema — cycle a fixed palette
// for the avatar ring instead of inventing per-user colors.
const FRIEND_COLORS = ['#7c3aed', '#00d4ff', '#ff4785', '#00e676', '#f59e0b']

// SVG icon primitives
const FireIcon = ({ size = 20 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <path d="M12 2C12 2 8 6 8 10C8 12.2 9.8 14 12 14C14.2 14 16 12.2 16 10C16 8 14 5 14 5C14 5 15 8 13 9C13 9 14 6 12 2Z" fill="#ff6b35" opacity="0.9"/>
    <path d="M12 14C9 14 6 16.5 6 20H18C18 16.5 15 14 12 14Z" fill="#ff6b3530"/>
    <path d="M12 8C12 8 10 10 10 12.5C10 13.3 10.5 14 12 14C13.5 14 14 13.3 14 12.5C14 10 12 8 12 8Z" fill="#ffd700" opacity="0.8"/>
  </svg>
)

const StarIcon = ({ color = '#ffd700' }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill={color}>
    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
  </svg>
)

const PlayIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
    <polygon points="5,3 19,12 5,21"/>
  </svg>
)

const TrophyIcon = ({ color = '#ffd700', size = 16 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M8 21h8m-4-4v4M5 3h14v8a7 7 0 0 1-14 0V3z"/>
    <path d="M5 7H2a2 2 0 0 0 0 4h3M19 7h3a2 2 0 0 1 0 4h-3"/>
  </svg>
)

const CheckIcon = ({ color = '#00e676' }: { color?: string }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20,6 9,17 4,12"/>
  </svg>
)

const GiftIcon = ({ size = 26 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#ffd700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20,12 20,22 4,22 4,12"/>
    <rect x="2" y="7" width="20" height="5" rx="1"/>
    <line x1="12" y1="22" x2="12" y2="7"/>
    <path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/>
    <path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/>
  </svg>
)

const ZapIcon = ({ color = '#ffd700', size = 16 }: { color?: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill={color}>
    <polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>
  </svg>
)

export default function HomeScreen({ onNavigate, onNavigateToGame, lang, setLang }: Props) {
  const isAr = lang === 'ar'
  const { profile, refreshProfile } = useAuth()

  const [showDailyReward, setShowDailyReward] = useState(false)
  const [claimedToday, setClaimedToday] = useState(false)
  const [xpFlash, setXpFlash] = useState(false)

  const [quickPlayGames, setQuickPlayGames] = useState<Game[]>([])
  const [activePowerHour, setActivePowerHour] = useState<ActivePowerHour | null>(null)
  const [powerMin, setPowerMin] = useState(0)
  const [globalActivity, setGlobalActivity] = useState<ActivityLogRow[]>([])
  const [weeklyProgress, setWeeklyProgress] = useState({ gamesThisWeek: 0, correctThisWeek: 0 })
  const [recentAchievements, setRecentAchievements] = useState<RecentAchievement[]>([])
  const [weeklyChallenge, setWeeklyChallenge] = useState<WeeklyChallenge | null>(null)
  const [countdown, setCountdown] = useState({ d: 0, h: 0, m: 0, s: 0 })
  const [profileStats, setProfileStats] = useState<ProfileStats | null>(null)
  const [rank, setRank] = useState<number | null>(null)
  const [friendsOnline, setFriendsOnline] = useState<FriendProfile[]>([])
  const [branches, setBranches] = useState<Branch[]>([])
  const [catalog, setCatalog] = useState<CosmeticItem[]>([])

  useEffect(() => { getBranches().then(({ data }) => setBranches(data)) }, [])
  // Own equipped cosmetics — read fresh from `profile` (which itself comes
  // from Supabase via useAuth/refreshProfile), same resolver every other
  // screen uses, so this card always matches what everyone else sees.
  useEffect(() => { getCosmeticCatalog().then(setCatalog) }, [])
  const myBranch = branches.find((b) => b.id === profile?.branch_id)

  // Keep the "Daily Reward Ready" card in sync with the server's record of the last claim,
  // rather than a local flag that would reset on every mount.
  useEffect(() => {
    if (!profile) return
    const today = new Date().toISOString().slice(0, 10)
    setClaimedToday(profile.last_claimed_reward_date === today)
  }, [profile?.last_claimed_reward_date])

  useEffect(() => {
    if (!profile) return
    let cancelled = false
    ;(async () => {
      const [games, powerHourEvent, activity, progress, achievements, challenge, stats, leaderboard, friends] = await Promise.all([
        getGames(),
        getActivePowerHour(),
        getGlobalActivity(),
        getWeeklyGoalsProgress(profile.id),
        getRecentAchievements(profile.id, 3),
        getCurrentChallenge('weekly'),
        getProfileStats(profile.id),
        getLeaderboard('weekly'),
        getFriends(profile.id),
      ])
      if (cancelled) return

      // Quick Play previously curated 4 fixed games; there's no "quick play" concept in the
      // schema, so take the first 4 active games in catalog order as a reasonable stand-in.
      setQuickPlayGames(games.filter((g) => g.is_active).slice(0, 4))

      setActivePowerHour(powerHourEvent as ActivePowerHour | null)
      setGlobalActivity(activity)
      setWeeklyProgress(progress)

      const normalizedAchievements: RecentAchievement[] = (achievements as any[])
        .map((r) => ({ unlocked_at: r.unlocked_at, achievement: Array.isArray(r.achievements) ? r.achievements[0] : r.achievements }))
        .filter((r): r is RecentAchievement => !!r.achievement)
      setRecentAchievements(normalizedAchievements)

      setWeeklyChallenge(challenge as WeeklyChallenge | null)
      setProfileStats(stats)

      const me = (leaderboard as any[]).find((r) => r.user_id === profile.id)
      setRank(me ? me.rank : null)

      setFriendsOnline((friends as FriendProfile[]).filter((f) => f.is_online))
    })()
    return () => { cancelled = true }
  }, [profile?.id])

  // Countdown for the active weekly challenge, driven by its real end time.
  useEffect(() => {
    if (!weeklyChallenge) return
    const update = () => {
      const diff = Math.max(0, new Date(weeklyChallenge.ends_at).getTime() - Date.now())
      setCountdown({
        d: Math.floor(diff / 86400000),
        h: Math.floor((diff % 86400000) / 3600000),
        m: Math.floor((diff % 3600000) / 60000),
        s: Math.floor((diff % 60000) / 1000),
      })
    }
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [weeklyChallenge])

  // Minutes remaining in the active Power Hour, driven by its real end time.
  useEffect(() => {
    if (!activePowerHour) { setPowerMin(0); return }
    const update = () => {
      const diff = Math.max(0, new Date(activePowerHour.ends_at).getTime() - Date.now())
      setPowerMin(Math.round(diff / 60000))
    }
    update()
    const t = setInterval(update, 60000)
    return () => clearInterval(t)
  }, [activePowerHour])

  const xp = profile?.xp ?? 0
  const progress = levelProgress(xp)
  const xpPct = progress.pct * 100
  const fmt = (n: number) => String(n).padStart(2, '0')

  const weeklyGoals = WEEKLY_GOALS_META.map((g, i) => ({
    ...g,
    // Only "games played this week" has a real backend counter (game_sessions this week).
    // "Score 80%+ in two games" and "win one daily challenge" aren't tracked by any existing
    // RPC/table, so they render at 0 rather than a fabricated number.
    // TODO: back these two with real data once score-threshold / daily-challenge tracking exists.
    progress: i === 0 ? Math.min(weeklyProgress.gamesThisWeek, g.total) : 0,
  }))

  // Dev-only: previews the level-up overlay. Gated so a real user tapping their streak
  // button in production can't trigger a fake level-up animation.
  if (!profile) return null

  const equipped = resolveCosmetics(catalog, profile)

  return (
    <div className="screen bg-game">
      {showDailyReward && (
        <DailyRewardModal
          lang={lang} streak={profile.streak_count}
          onClaim={async () => {
            const { error } = await claimDailyReward()
            if (!error) {
              await refreshProfile()
              setClaimedToday(true)
              setXpFlash(true)
              setTimeout(() => setXpFlash(false), 800)
            }
          }}
          onClose={() => setShowDailyReward(false)}
        />
      )}

      <TopBar title="KASTRO" lang={lang} setLang={setLang} />

      {/* Live ticker */}
      <div style={{ background: 'rgba(0,212,255,0.05)', borderBottom: '1px solid rgba(0,212,255,0.1)', padding: '7px 0', overflow: 'hidden' }}>
        <div style={{ display: 'flex', gap: 48, whiteSpace: 'nowrap', animation: 'ticker 32s linear infinite' }}>
          {[...globalActivity, ...globalActivity].map((a, i) => (
            <span key={i} style={{ fontSize: 11, color: 'rgba(0,212,255,0.7)', fontWeight: 500, flexShrink: 0 }}>
              <span style={{ marginInlineEnd: 8, color: 'rgba(0,212,255,0.35)' }}>◆</span>
              {isAr ? a.message_ar : a.message}
            </span>
          ))}
        </div>
      </div>

      <div className="pb-nav" style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>

        {/* ─ 1. PLAYER IDENTITY ─────────────────────── */}
        {/* Reuses the same profile.header_url as ProfileScreen's hero and
            FriendProfileSheet's header band — one image, three places. When
            set, it becomes this card's background (object-fit: cover, fixed
            center focal point, never stretched) under a dark gradient
            overlay strong enough to keep the avatar/username/branch/level/
            XP/streak text readable over an arbitrarily bright photo. With
            no custom header, the card falls back to the exact original
            premium gradient + starfield — unchanged. */}
        <div
          className="card"
          style={{
            padding: '20px',
            background: profile.header_url || equipped.banner ? undefined : 'linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(0,212,255,0.09) 100%)',
            border: '1px solid rgba(124,58,237,0.28)',
            position: 'relative', overflow: 'hidden',
          }}
        >
          {profile.header_url ? (
            <>
              <img
                src={profile.header_url}
                alt=""
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
              />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(10,6,30,0.82) 0%, rgba(10,6,30,0.68) 55%, rgba(10,6,30,0.85) 100%)' }} />
            </>
          ) : equipped.banner ? (
            <>
              <CosmeticBannerLayer banner={equipped.banner} fallbackGradient="linear-gradient(135deg, rgba(124,58,237,0.2) 0%, rgba(0,212,255,0.09) 100%)" />
              <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(135deg, rgba(10,6,30,0.82) 0%, rgba(10,6,30,0.68) 55%, rgba(10,6,30,0.85) 100%)' }} />
            </>
          ) : (
            <div className="bg-stars" style={{ position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none' }} />
          )}

          {/* Power Hour */}
          {activePowerHour && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, padding: '7px 12px', background: 'rgba(255,215,0,0.09)', border: '1px solid rgba(255,215,0,0.22)', borderRadius: 10 }}>
              <ZapIcon size={14} color="#ffd700" />
              <span style={{ fontSize: 12, fontWeight: 700, color: '#ffd700' }}>
                {isAr ? `ساعة القوة: XP مضاعف — ${powerMin} دقيقة` : `POWER HOUR: ${activePowerHour.multiplier}× XP — ${powerMin}m left`}
              </span>
              <div className="live-dot" style={{ marginInlineStart: 'auto' }} />
            </div>
          )}

          {/* Player row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14, position: 'relative', zIndex: 1 }}>
            <div style={{ position: 'relative', flexShrink: 0 }}>
              <Avatar url={profile.avatar_url} size={64} className="aura-diamond" style={frameAvatarStyle(equipped.frame, '3px solid transparent')} />
              {equipped.decoration && (
                <span style={{ position: 'absolute', top: -8, right: isAr ? 'auto' : -8, left: isAr ? -8 : 'auto', fontSize: 20, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))', pointerEvents: 'none', zIndex: 2 }}>
                  {equipped.decoration.icon}
                </span>
              )}
              <div style={{ position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)', background: 'linear-gradient(135deg, #ffd700, #f59e0b)', borderRadius: 99, padding: '2px 8px', fontSize: 10, fontWeight: 900, color: '#03030f', border: '2px solid var(--background)', zIndex: 2, fontFamily: "'Exo 2', sans-serif", whiteSpace: 'nowrap' }}>
                LV {profile.level}
              </div>
            </div>

            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 1px', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.55)' }}>
                {isAr ? 'مرحباً،' : 'Welcome back,'}
              </p>
              <h2 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: '0 0 4px', fontSize: 21, fontWeight: 800, color: 'var(--foreground)' }}>
                @{profile.username}
              </h2>
              {equipped.title && (
                <p style={{ margin: '0 0 4px', fontSize: 11.5, fontWeight: 700, color: '#9d6fff' }}>
                  {equipped.title.icon} {isAr ? (equipped.title.label_ar || equipped.title.label) : equipped.title.label}
                </p>
              )}
              {myBranch && (
                <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)' }}>
                  {isAr ? myBranch.name_ar : myBranch.name_en}
                </p>
              )}
            </div>

            {/* Streak */}
            <div
              style={{ background: 'rgba(255,107,53,0.1)', textAlign: 'center', flexShrink: 0, padding: '4px 8px', borderRadius: 12 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', filter: 'drop-shadow(0 0 8px rgba(255,107,53,0.6))' }}>
                <FireIcon size={28} />
              </div>
              <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 18, fontWeight: 900, color: '#ff6b35', lineHeight: 1 }}>{profile.streak_count}</div>
              <div style={{ fontSize: 9, color: 'rgba(255,107,53,0.6)', fontWeight: 600, textTransform: 'uppercase' }}>{isAr ? 'يوم' : 'days'}</div>
            </div>
          </div>

          {/* XP bar */}
          <div style={{ marginTop: 16, position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
              <span style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.55)' }}>
                {progress.xpIntoLevel.toLocaleString()} / {progress.xpForNext.toLocaleString()} XP {isAr ? `للمستوى ${progress.level + 1}` : `to Level ${progress.level + 1}`}
              </span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#9d6fff', fontFamily: "'Exo 2', sans-serif" }}>
                {Math.round(xpPct)}%
              </span>
            </div>
            <div className={`xp-track${xpFlash ? ' xp-fill-burst' : ''}`} style={{ height: 8 }}>
              <div className="xp-fill" style={{ ['--xp-pct' as string]: xpPct / 100 } as CSSProperties} />
            </div>
          </div>
        </div>

        {/* Quick stats row */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6 }}>
          {[
            { Icon: () => <TrophyIcon size={14} color="#ffd700" />, val: rank != null ? `#${rank}` : '—', label: isAr ? 'ترتيب' : 'Rank', color: '#ffd700' },
            { Icon: () => <svg width="14" height="14" viewBox="0 0 24 24" fill="#9d6fff"><circle cx="12" cy="12" r="10"/><text x="12" y="16" textAnchor="middle" fontSize="9" fontWeight="900" fill="white">XP</text></svg>, val: xp.toLocaleString(), label: 'XP', color: '#9d6fff' },
            { Icon: () => <svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#ffd700"/><text x="12" y="16.5" textAnchor="middle" fontSize="10" fontWeight="900" fill="#7a5200">$</text></svg>, val: (profile.coins ?? 0).toLocaleString(), label: isAr ? 'عملات' : 'Coins', color: '#ffd700' },
            { Icon: () => <PlayIcon size={14} />, val: String(profileStats?.gamesPlayed ?? 0), label: isAr ? 'ألعاب' : 'Games', color: '#00d4ff' },
            { Icon: () => <CheckIcon color="#00e676" />, val: String(profileStats?.wins ?? 0), label: isAr ? 'فوز' : 'Wins', color: '#00e676' },
          ].map((s, i) => (
            <div key={i} className="card" style={{ padding: '11px 4px', textAlign: 'center', minWidth: 0 }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 3, color: s.color }}><s.Icon /></div>
              <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 15, fontWeight: 900, color: s.color, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.val}</div>
              <div style={{ fontSize: 8.5, color: 'rgba(var(--fg2-rgb),0.45)', marginTop: 1, textTransform: 'uppercase', letterSpacing: '0.02em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* ─ 2. WEEKLY CHALLENGE ────────────────────── */}
        <div
          className="card card-hover"
          style={{
            padding: '18px 20px',
            background: 'linear-gradient(135deg, rgba(157,111,255,0.15) 0%, rgba(0,212,255,0.08) 100%)',
            border: '1px solid rgba(157,111,255,0.28)',
            boxShadow: '0 0 32px rgba(157,111,255,0.08)',
          }}
          onClick={() => onNavigate('weekly')}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <TrophyIcon color="#9d6fff" size={18} />
              <span className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 15, fontWeight: 800, color: 'var(--foreground)' }}>
                {isAr ? 'التحدي الأسبوعي' : 'Weekly Challenge'}
              </span>
            </div>
            <span className="badge badge-live">
              <span className="live-dot" style={{ width: 5, height: 5 }} />
              {isAr ? 'مباشر' : 'LIVE'}
            </span>
          </div>

          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.65)', lineHeight: 1.5 }}>
            {isAr ? 'تحدي دورة التقييم — هذا الأسبوع' : 'Evaluation Cycle Challenge — This Week'}
          </p>

          {/* Countdown */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {[
              { v: fmt(countdown.d), l: isAr ? 'يوم' : 'D' },
              { v: fmt(countdown.h), l: isAr ? 'ساعة' : 'H' },
              { v: fmt(countdown.m), l: isAr ? 'دقيقة' : 'M' },
              { v: fmt(countdown.s), l: isAr ? 'ثانية' : 'S' },
            ].map(({ v, l }) => (
              <div key={l} style={{ flex: 1, textAlign: 'center', padding: '8px 4px', background: 'rgba(0,0,0,0.25)', borderRadius: 10, border: '1px solid rgba(157,111,255,0.2)' }}>
                <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 20, fontWeight: 900, color: '#9d6fff' }}>{v}</div>
                <div style={{ fontSize: 9, color: 'rgba(var(--fg2-rgb),0.4)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 1 }}>{l}</div>
              </div>
            ))}
          </div>

          {/* Prize strip */}
          <div style={{ display: 'flex', gap: 6 }}>
            {[
              { rank: '1st', en: 'Gold Badge + Reward', ar: 'شارة ذهبية + مكافأة', color: '#ffd700' },
              { rank: '2nd', en: 'Silver Badge', ar: 'شارة فضية', color: '#c0c0c0' },
              { rank: '3rd', en: 'Bronze Badge', ar: 'شارة برونزية', color: '#cd7f32' },
            ].map((p) => (
              <div key={p.rank} style={{ flex: 1, background: `${p.color}12`, border: `1px solid ${p.color}25`, borderRadius: 10, padding: '7px 6px', textAlign: 'center' }}>
                <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 11, fontWeight: 800, color: p.color }}>{p.rank}</div>
                <div style={{ fontSize: 9, color: 'rgba(var(--fg2-rgb),0.55)', marginTop: 2 }}>{isAr ? p.ar : p.en}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ─ 3. DAILY REWARD ────────────────────────── */}
        {!claimedToday && (
          <div
            className="card card-hover"
            style={{
              padding: '16px 20px',
              background: 'linear-gradient(135deg, rgba(255,215,0,0.1) 0%, rgba(255,107,53,0.07) 100%)',
              border: '1px solid rgba(255,215,0,0.22)',
              display: 'flex', alignItems: 'center', gap: 14,
              boxShadow: '0 0 28px rgba(255,215,0,0.08)',
            }}
            onClick={() => setShowDailyReward(true)}
          >
            <div style={{ width: 48, height: 48, borderRadius: 14, background: 'linear-gradient(135deg, #ffd700, #ff6b35)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 20px rgba(255,215,0,0.35)', animation: 'float 2.5s ease-in-out infinite', flexShrink: 0 }}>
              <GiftIcon size={24} />
            </div>
            <div style={{ flex: 1 }}>
              <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 800, color: '#ffd700' }}>
                {isAr ? 'مكافأة اليوم جاهزة!' : 'Daily Reward Ready!'}
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'rgba(var(--fg2-rgb),0.6)' }}>
                {isAr ? 'يوم ٧ · مكافأة خاصة — انقر للمطالبة' : 'Day 7 · Special reward — tap to claim'}
              </p>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(255,215,0,0.6)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points={isAr ? '15,18 9,12 15,6' : '9,18 15,12 9,6'}/>
            </svg>
          </div>
        )}

        {/* ─ 4. QUICK PLAY ──────────────────────────── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {isAr ? 'العب الآن' : 'Quick Play'}
            </h3>
            <button onClick={() => onNavigate('games')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9d6fff', fontWeight: 600 }}>
              {isAr ? 'عرض الكل' : 'See all'} →
            </button>
          </div>
          <div className="scroll-x" style={{ gap: 10 }}>
            {quickPlayGames.map((g) => (
              <div
                key={g.id}
                className="card card-hover"
                style={{ flexShrink: 0, width: 130, padding: '14px 12px', cursor: 'pointer', borderColor: `${g.accent_color}25`, position: 'relative', overflow: 'hidden' }}
                onClick={() => onNavigateToGame(g.target_screen as Screen, g.id)}
              >
                {/* Accent top bar */}
                <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: g.accent_color, opacity: 0.7 }} />
                {/* Star field deco */}
                <div style={{ position: 'absolute', top: 6, right: 8 }}>
                  <StarIcon color={g.accent_color} />
                </div>
                <div style={{ width: 36, height: 36, borderRadius: 12, background: `${g.accent_color}18`, border: `1px solid ${g.accent_color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 10 }}>
                  <PlayIcon size={16} />
                </div>
                <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.3 }}>
                  {isAr ? g.name_ar : g.name}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <ZapIcon color={g.accent_color} size={10} />
                  <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 11, fontWeight: 800, color: g.accent_color }}>+{g.base_xp} XP</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ─ 5. WEEKLY GOALS ────────────────────────── */}
        <div>
          <h3 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 800, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {isAr ? 'أهداف الأسبوع' : 'Weekly Goals'}
          </h3>
          <div className="card" style={{ padding: '16px' }}>
            {weeklyGoals.map((g, i) => {
              const pct = Math.round((g.progress / g.total) * 100)
              const done = g.progress >= g.total
              return (
                <div key={i} style={{ marginBottom: i < weeklyGoals.length - 1 ? 14 : 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {done
                        ? <div style={{ width: 18, height: 18, borderRadius: '50%', background: '#00e67620', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><CheckIcon /></div>
                        : <div style={{ width: 18, height: 18, borderRadius: '50%', background: `${g.color}18`, border: `1px solid ${g.color}30`, flexShrink: 0 }} />
                      }
                      <span style={{ fontSize: 12, color: done ? 'rgba(var(--fg2-rgb),0.9)' : 'rgba(var(--fg2-rgb),0.75)', fontWeight: done ? 700 : 500, lineHeight: 1.3 }}>
                        {isAr ? g.ar : g.en}
                      </span>
                    </div>
                    <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 12, fontWeight: 800, color: g.color, marginInlineStart: 8, flexShrink: 0 }}>
                      {g.progress}/{g.total}
                    </span>
                  </div>
                  <div className="xp-track" style={{ height: 5 }}>
                    <div className="xp-fill" style={{ ['--xp-pct' as string]: pct / 100, background: `linear-gradient(90deg, ${g.color}, ${g.color}88)` } as CSSProperties} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ─ 6. PLAYING NOW ─────────────────────────── */}
        <div>
          <h3 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: '0 0 10px', fontSize: 14, fontWeight: 800, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {isAr ? 'يلعبون الآن' : 'Playing Now'}
          </h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {friendsOnline.map((f, i) => {
              const color = FRIEND_COLORS[i % FRIEND_COLORS.length]
              return (
                <div key={f.id} className="card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, border: `1px solid ${color}18` }}>
                  <Avatar url={f.avatar_url} size={38} style={{ background: `${color}18`, border: `1px solid ${color}35` }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>@{f.username}</p>
                    {/* "Currently playing" (which game) isn't tracked anywhere yet — show a neutral online status instead of a fabricated game name. */}
                    <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.55)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isAr ? 'متصل الآن' : 'Online now'}</p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                    <div className="live-dot" style={{ width: 6, height: 6 }} />
                    {/* No per-friend rank data available yet — avoid showing a fabricated number. */}
                    <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 12, fontWeight: 800, color }}>—</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ─ 7. RECENT ACHIEVEMENTS ─────────────────── */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
            <h3 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'var(--foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {isAr ? 'الإنجازات الأخيرة' : 'Recent Achievements'}
            </h3>
            <button onClick={() => onNavigate('achievements')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9d6fff', fontWeight: 600 }}>
              {isAr ? 'عرض الكل' : 'See all'} →
            </button>
          </div>
          <div className="scroll-x">
            {recentAchievements.map((r) => {
              const a = r.achievement
              return (
                <div key={a.id} className="card" style={{ flexShrink: 0, width: 100, padding: '14px 10px', textAlign: 'center', background: `${a.color}20`, border: `1px solid ${a.color}25` }}>
                  <div style={{ width: 40, height: 40, borderRadius: 14, background: `${a.color}20`, border: `1px solid ${a.color}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 8px' }}>
                    <StarIcon color={a.color} />
                  </div>
                  <p style={{ margin: '0 0 4px', fontSize: 11, fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.3 }}>{isAr ? a.name_ar : a.name}</p>
                  <span className={`rarity-${a.rarity.toLowerCase()}`}>{isAr ? (RARITY_AR[a.rarity] ?? a.rarity) : a.rarity}</span>
                </div>
              )
            })}
          </div>
        </div>

      </div>
    </div>
  )
}
