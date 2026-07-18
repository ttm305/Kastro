import { useEffect, useState } from 'react'
import type { Screen, Lang } from '../App'
import TopBar from '../components/TopBar'
import Avatar from '../components/Avatar'
import { useAuth } from '../lib/auth'
import { getLeaderboardV2, getGames, type LeaderboardScope, type Game } from '../lib/api'

interface Props {
  // Kept optional for compatibility with the caller in App.tsx, which still
  // passes it — this screen no longer navigates anywhere itself and gets
  // the current user via useAuth() instead of a prop.
  onNavigate?: (s: Screen) => void
  lang: Lang
  setLang: (l: Lang) => void
}

type Period = 'weekly' | 'monthly' | 'quarterly' | 'yearly'

interface LBPlayer {
  user_id: string
  name: string
  nameAr: string
  pts: number
  level: number
  streak: number
  change: string
  isMe: boolean
  rank: number
  avatar_url: string | null
}

const TIER = {
  1: { color: '#ffd700', glowClass: 'podium-glow-1', bg: 'linear-gradient(135deg, rgba(255,215,0,0.2), rgba(255,165,0,0.08))', border: 'rgba(255,215,0,0.4)', label: '1ST' },
  2: { color: '#00d4ff', glowClass: 'podium-glow-2', bg: 'linear-gradient(135deg, rgba(0,212,255,0.14), rgba(0,100,200,0.06))', border: 'rgba(0,212,255,0.3)', label: '2ND' },
  3: { color: '#ff6b35', glowClass: 'podium-glow-3', bg: 'linear-gradient(135deg, rgba(255,107,53,0.14), rgba(200,60,0,0.06))', border: 'rgba(255,107,53,0.28)', label: '3RD' },
} as const

function PlayerAvatar({ size, color, isMe }: { size: number; color: string; isMe: boolean }) {
  return (
    <div style={{ width: size, height: size, borderRadius: '50%', background: isMe ? `linear-gradient(135deg, ${color}, #00d4ff)` : `rgba(${color === '#ffd700' ? '255,215,0' : color === '#00d4ff' ? '0,212,255' : '255,107,53'},0.15)`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke={isMe ? '#fff' : color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="4"/>
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
      </svg>
    </div>
  )
}

function RankDelta({ change }: { change: string }) {
  if (change === '0') return <span className="rank-same">—</span>
  const up = change.startsWith('+')
  return (
    <span className={up ? 'rank-up' : 'rank-down'}>
      {up
        ? <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,4 20,20 4,20"/></svg>
        : <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,20 4,4 20,4"/></svg>
      }
      {change.replace('+', '').replace('-', '')}
    </span>
  )
}

function Confetti({ active }: { active: boolean }) {
  if (!active) return null
  const COLORS = ['#ffd700', '#9d6fff', '#00d4ff', '#ff4785', '#00e676', '#ff6b35']
  const pieces = Array.from({ length: 22 })
  return (
    <div className="confetti-wrap" style={{ pointerEvents: 'none' }}>
      {pieces.map((_, i) => (
        <div
          key={i}
          className="confetti-piece"
          style={{
            left: `${10 + (i / pieces.length) * 80}%`,
            background: COLORS[i % COLORS.length],
            width: i % 3 === 0 ? 6 : 8,
            height: i % 3 === 0 ? 6 : 5,
            borderRadius: i % 4 === 0 ? '50%' : '2px',
            '--dur': `${1.4 + (i % 4) * 0.3}s`,
            '--delay': `${(i * 0.07).toFixed(2)}s`,
            '--drift': `${-30 + (i % 5) * 15}px`,
          } as React.CSSProperties}
        />
      ))}
    </div>
  )
}

const SCOPES: { key: LeaderboardScope; en: string; ar: string }[] = [
  { key: 'overall', en: 'Overall', ar: 'عام' },
  { key: 'branch', en: 'Branch', ar: 'الفرع' },
  { key: 'game', en: 'By Game', ar: 'حسب اللعبة' },
  { key: 'friends', en: 'Friends', ar: 'الأصدقاء' },
  { key: 'season', en: 'Season', ar: 'الموسم' },
]

export default function LeaderboardScreen({ lang, setLang }: Props) {
  const { profile } = useAuth()
  const [period, setPeriod] = useState<Period>('weekly')
  const [scope, setScope] = useState<LeaderboardScope>('overall')
  const [games, setGames] = useState<Game[]>([])
  const [selectedGameId, setSelectedGameId] = useState<string>('')
  const [confetti, setConfetti] = useState(false)
  const [players, setPlayers] = useState<LBPlayer[]>([])
  const [loading, setLoading] = useState(true)
  const isAr = lang === 'ar'

  useEffect(() => {
    getGames().then((gs) => {
      setGames(gs)
      if (gs.length > 0) setSelectedGameId((cur) => cur || gs[0].id)
    })
  }, [])

  const filter = scope === 'branch' ? (profile?.branch_id ?? null) : scope === 'game' ? (selectedGameId || null) : null

  useEffect(() => {
    if (scope === 'game' && !filter) return
    let cancelled = false
    setLoading(true)
    getLeaderboardV2(scope, period, filter, 50).then((rows) => {
      if (cancelled) return
      const mapped: LBPlayer[] = [...rows]
        .sort((a, b) => a.rank - b.rank)
        .map((r) => ({
          user_id: r.user_id,
          name: r.username,
          nameAr: r.username,
          pts: r.points,
          level: r.level,
          streak: r.streak_count,
          // TODO: track rank deltas once historical snapshots exist
          change: '0',
          isMe: r.user_id === profile?.id,
          rank: r.rank,
          avatar_url: r.avatar_url,
        }))
      setPlayers(mapped)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [scope, period, filter, profile?.id])

  const periodLabels: Record<Period, { en: string; ar: string }> = {
    weekly: { en: 'Week', ar: 'أسبوع' },
    monthly: { en: 'Month', ar: 'شهر' },
    quarterly: { en: 'Quarter', ar: 'ربعي' },
    yearly: { en: 'Year', ar: 'سنة' },
  }

  if (loading && players.length === 0) {
    return (
      <div className="screen bg-game">
        <TopBar title="Leaderboard" titleAr="المتصدرون" lang={lang} setLang={setLang} />
        <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.45)' }}>
          {isAr ? 'جارٍ التحميل...' : 'Loading…'}
        </div>
      </div>
    )
  }

  const top3 = players.slice(0, 3)
  const rest = players.slice(3)

  const myRow = players.find((p) => p.isMe)
  // Row one rank above the current user — their "overtake" target. Absent if
  // they're already #1, or if they weren't found within the fetched page
  // (limit=50 above). Consider raising the limit or adding a dedicated
  // "my rank" RPC if pagination becomes an issue.
  const aboveRow = myRow ? players.find((p) => p.rank === myRow.rank - 1) : undefined
  const gapToAbove = myRow && aboveRow ? aboveRow.pts - myRow.pts : null

  return (
    <div className="screen bg-game">
      <Confetti active={confetti} />
      <TopBar title="Leaderboard" titleAr="المتصدرون" lang={lang} setLang={setLang} />

      <div className="pb-nav" style={{ padding: '14px 16px' }}>

        {/* Scope tabs */}
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, overflowX: 'auto', paddingBottom: 2 }}>
          {SCOPES.map((s) => (
            <button
              key={s.key}
              onClick={() => setScope(s.key)}
              style={{
                padding: '7px 13px', borderRadius: 99, border: `1px solid ${scope === s.key ? 'rgba(0,212,255,0.4)' : 'rgba(var(--fg-rgb),0.08)'}`, cursor: 'pointer',
                fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
                background: scope === s.key ? 'rgba(0,212,255,0.15)' : 'rgba(var(--fg-rgb),0.04)',
                color: scope === s.key ? '#67e8f9' : 'rgba(var(--fg2-rgb),0.5)',
                fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif",
              }}
            >
              {isAr ? s.ar : s.en}
            </button>
          ))}
        </div>

        {/* Game selector (scope=game only) */}
        {scope === 'game' && games.length > 0 && (
          <select
            value={selectedGameId}
            onChange={(e) => setSelectedGameId(e.target.value)}
            style={{
              width: '100%', marginBottom: 12, fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif",
              background: 'rgba(var(--fg-rgb),0.05)', border: '1px solid rgba(var(--fg-rgb),0.1)',
              borderRadius: 10, padding: '10px 12px', fontSize: 13, color: 'var(--foreground)',
            }}
          >
            {games.map((g) => <option key={g.id} value={g.id}>{isAr ? g.name_ar : g.name}</option>)}
          </select>
        )}

        {scope === 'branch' && !profile?.branch_id && (
          <p style={{ fontSize: 12, color: 'rgba(255,180,80,0.8)', marginBottom: 12 }}>
            {isAr ? 'لم يتم تعيين فرع لملفك الشخصي بعد' : 'No branch set on your profile yet'}
          </p>
        )}

        {/* Period tabs — only meaningful for time-scoped rankings */}
        {(scope === 'overall' || scope === 'branch' || scope === 'friends') && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
            {(Object.keys(periodLabels) as Period[]).map((p) => (
              <button
                key={p}
                onClick={() => setPeriod(p)}
                style={{
                  flex: 1, padding: '9px 4px', borderRadius: 12, border: 'none', cursor: 'pointer',
                  fontSize: isAr ? 11 : 12, fontWeight: 700, transition: 'all 0.2s ease',
                  background: period === p ? 'linear-gradient(135deg, #7c3aed, #5b21b6)' : 'rgba(var(--fg-rgb),0.05)',
                  color: period === p ? 'white' : 'rgba(var(--fg2-rgb),0.5)',
                  fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif",
                  boxShadow: period === p ? '0 4px 14px rgba(124,58,237,0.35)' : 'none',
                }}
              >
                {isAr ? periodLabels[p].ar : periodLabels[p].en}
              </button>
            ))}
          </div>
        )}

        {/* ── Podium top 3 ── */}
        <div
          className="card"
          style={{
            padding: '24px 16px 20px',
            marginBottom: 16,
            background: 'linear-gradient(180deg, rgba(124,58,237,0.12) 0%, rgba(0,0,0,0) 100%)',
            border: '1px solid rgba(124,58,237,0.18)',
            position: 'relative', overflow: 'hidden',
          }}
        >
          {/* Starburst rays */}
          <div style={{ position: 'absolute', inset: 0, opacity: 0.4 }}>
            <svg width="100%" height="100%" viewBox="0 0 400 160" preserveAspectRatio="xMidYMid slice">
              <defs>
                <radialGradient id="lb-burst" cx="50%" cy="30%">
                  <stop offset="0%" stopColor="#9d6fff" stopOpacity="0.35"/>
                  <stop offset="100%" stopColor="#9d6fff" stopOpacity="0"/>
                </radialGradient>
              </defs>
              <ellipse cx="200" cy="30" rx="180" ry="100" fill="url(#lb-burst)"/>
              <ellipse cx="200" cy="80" rx="200" ry="60" fill="none" stroke="#9d6fff" strokeWidth="0.5" opacity="0.15"/>
              <ellipse cx="200" cy="80" rx="140" ry="40" fill="none" stroke="#00d4ff" strokeWidth="0.5" opacity="0.1"/>
            </svg>
          </div>

          {/* Champion banner */}
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16, position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 16px', background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.22)', borderRadius: 99 }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffd700" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 21h8m-4-4v4M5 3h14v8a7 7 0 0 1-14 0V3z"/>
                <path d="M5 7H2a2 2 0 0 0 0 4h3M19 7h3a2 2 0 0 1 0 4h-3"/>
              </svg>
              <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 12, fontWeight: 800, color: '#ffd700', letterSpacing: '0.08em' }}>
                {isAr ? `المتصدرون · ${periodLabels[period].ar}` : `Top Performers · ${periodLabels[period].en}`}
              </span>
            </div>
          </div>

          {/* Podium slots: 2nd | 1st | 3rd */}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, position: 'relative', zIndex: 1 }}>
            {[top3[1], top3[0], top3[2]].map((p, idx) => {
              const rank = idx === 1 ? 1 : idx === 0 ? 2 : 3
              const tier = TIER[rank as 1 | 2 | 3]
              const isFirst = rank === 1
              // Fewer than 3 real users on the leaderboard (expected early in
              // the pilot) leaves some podium slots empty — render a dimmed
              // placeholder instead of crashing on undefined.
              if (!p) {
                return (
                  <div key={rank} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, opacity: 0.35 }}>
                    <div style={{ borderRadius: '50%' }}>
                      <PlayerAvatar size={isFirst ? 62 : 50} color={tier.color} isMe={false} />
                    </div>
                    <div style={{ textAlign: 'center' }}>
                      <p style={{ margin: '0 0 2px', fontSize: isFirst ? 13 : 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.4)' }}>—</p>
                      <p style={{ margin: '0 0 4px', fontFamily: "'Exo 2', sans-serif", fontSize: isFirst ? 15 : 13, fontWeight: 800, color: 'rgba(var(--fg2-rgb),0.3)' }}>—</p>
                    </div>
                    <div style={{
                      width: '100%',
                      height: isFirst ? 52 : rank === 2 ? 38 : 28,
                      background: 'rgba(var(--fg-rgb),0.03)',
                      border: '1px solid rgba(var(--fg-rgb),0.08)',
                      borderRadius: '12px 12px 0 0',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontFamily: "'Exo 2', sans-serif", fontSize: 14, fontWeight: 900, color: 'rgba(var(--fg2-rgb),0.25)',
                    }}>
                      {tier.label}
                    </div>
                  </div>
                )
              }
              return (
                <div
                  key={rank}
                  style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}
                >
                  {/* Crown for #1 */}
                  {isFirst && (
                    <div style={{ fontSize: 22, animation: 'crown-float 2.5s ease-in-out infinite' }}>
                      <svg width="24" height="20" viewBox="0 0 24 20" fill="#ffd700">
                        <path d="M2 18L4 8L9 14L12 4L15 14L20 8L22 18H2Z" filter="url(#crown-glow)"/>
                        <circle cx="2" cy="8" r="2" fill="#ffd700"/>
                        <circle cx="12" cy="4" r="2" fill="#ffd700"/>
                        <circle cx="22" cy="8" r="2" fill="#ffd700"/>
                      </svg>
                    </div>
                  )}

                  {/* Avatar */}
                  <div
                    className={tier.glowClass}
                    style={{ borderRadius: '50%', animation: isFirst ? 'badge-live-pulse 2s ease-in-out infinite' : 'none' }}
                    onClick={() => { if (isFirst) { setConfetti(true); setTimeout(() => setConfetti(false), 2500) } }}
                  >
                    <Avatar url={p.avatar_url} size={isFirst ? 62 : 50} alt={p.name} />
                  </div>

                  {/* Name + points */}
                  <div style={{ textAlign: 'center' }}>
                    <p style={{ margin: '0 0 2px', fontSize: isFirst ? 13 : 11, fontWeight: 800, color: 'var(--foreground)', lineHeight: 1.2 }}>
                      @{isAr ? p.nameAr : p.name}
                    </p>
                    <p style={{ margin: '0 0 4px', fontFamily: "'Exo 2', sans-serif", fontSize: isFirst ? 15 : 13, fontWeight: 900, color: tier.color }}>
                      {p.pts.toLocaleString()}
                    </p>
                    <RankDelta change={p.change} />
                  </div>

                  {/* Podium base */}
                  <div style={{
                    width: '100%',
                    height: isFirst ? 52 : rank === 2 ? 38 : 28,
                    background: tier.bg,
                    border: `1px solid ${tier.border}`,
                    borderRadius: '12px 12px 0 0',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontFamily: "'Exo 2', sans-serif", fontSize: 14, fontWeight: 900, color: tier.color,
                  }}>
                    {tier.label}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Tap #1 hint ── */}
        <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.35)', marginBottom: 12, fontStyle: 'italic' }}>
          {isAr ? 'اضغط على المركز الأول للاحتفال' : 'Tap #1 to celebrate'}
        </p>

        {/* ── My position callout ── */}
        <div
          className="card"
          style={{
            padding: '14px 16px',
            marginBottom: 12,
            background: 'linear-gradient(135deg, rgba(124,58,237,0.18), rgba(0,212,255,0.08))',
            border: '1px solid rgba(124,58,237,0.3)',
            display: 'flex', alignItems: 'center', gap: 12,
          }}
        >
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: 'linear-gradient(135deg, #7c3aed, #00d4ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 1px', fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
              {isAr ? `موقعك الحالي: المرتبة #${myRow ? myRow.rank : '—'}` : `Your position: Rank #${myRow ? myRow.rank : '—'}`}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.55)' }}>
              {myRow && aboveRow
                ? (isAr ? `تحتاج ${gapToAbove} نقطة للوصول للمرتبة #${aboveRow.rank}` : `${gapToAbove} pts to reach Rank #${aboveRow.rank} — keep going!`)
                : '—'}
            </p>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
            <span className="rank-up"><svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><polygon points="12,4 20,20 4,20"/></svg>0</span>
            <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)' }}>
              {isAr ? 'هذا الأسبوع' : 'this week'}
            </span>
          </div>
        </div>

        {/* ── Full list (4–8) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rest.map((p, i) => {
            const rank = i + 4
            const isUp = p.change.startsWith('+') && p.change !== '+0'
            const isDown = p.change.startsWith('-')
            return (
              <div
                key={rank}
                className={`card${isUp ? ' animate-rank-up' : isDown ? ' animate-rank-down' : ''}`}
                style={{
                  padding: '12px 16px',
                  display: 'flex', alignItems: 'center', gap: 12,
                  background: p.isMe ? 'linear-gradient(135deg, rgba(124,58,237,0.15), rgba(0,212,255,0.06))' : 'rgba(var(--fg-rgb),0.04)',
                  border: p.isMe ? '1px solid rgba(124,58,237,0.28)' : '1px solid rgba(var(--fg-rgb),0.06)',
                  animationDelay: `${i * 0.07}s`,
                }}
              >
                <div style={{ width: 28, textAlign: 'center', flexShrink: 0 }}>
                  <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 14, fontWeight: 900, color: p.isMe ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.4)' }}>
                    #{rank}
                  </span>
                </div>

                <div className={p.isMe ? 'aura-diamond' : ''} style={{ borderRadius: '50%', flexShrink: 0 }}>
                  <Avatar url={p.avatar_url} size={36} alt={p.name} />
                </div>

                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: p.isMe ? 800 : 600, color: p.isMe ? 'var(--foreground)' : 'rgba(var(--fg2-rgb),0.85)' }}>
                    @{isAr ? p.nameAr : p.name}
                    {p.isMe && <span style={{ marginInlineStart: 6, fontSize: 10, color: '#9d6fff', fontWeight: 700 }}>({isAr ? 'أنت' : 'you'})</span>}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 10, color: 'rgba(var(--fg2-rgb),0.45)' }}>LV {p.level}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 10 }}>
                      <svg width="8" height="8" viewBox="0 0 24 24" fill="#ff6b35"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>
                      <span style={{ color: 'rgba(var(--fg2-rgb),0.45)' }}>{p.streak}d</span>
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                  <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 13, fontWeight: 800, color: p.isMe ? '#9d6fff' : 'var(--foreground)' }}>
                    {p.pts.toLocaleString()}
                  </span>
                  <RankDelta change={p.change} />
                </div>
              </div>
            )
          })}
        </div>

        {/* Overtake event preview */}
        <div
          className="card event-banner"
          style={{
            marginTop: 16,
            background: 'linear-gradient(135deg, rgba(157,111,255,0.1) 0%, rgba(0,212,255,0.06) 100%)',
            border: '1px solid rgba(157,111,255,0.2)',
            padding: '14px 16px',
            display: 'flex', alignItems: 'center', gap: 12,
          }}
        >
          <div style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(157,111,255,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#9d6fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="23,6 13.5,15.5 8.5,10.5 1,18"/>
              <polyline points="17,6 23,6 23,12"/>
            </svg>
          </div>
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
              {myRow && aboveRow
                ? (isAr ? `@${aboveRow.nameAr} يسبقك في الترتيب!` : `@${aboveRow.name} is just ahead of you!`)
                : '—'}
            </p>
            <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.55)' }}>
              {myRow && aboveRow
                ? (isAr ? `تحتاج ${gapToAbove} نقطة لتجاوزه` : `${gapToAbove} pts to overtake them`)
                : '—'}
            </p>
          </div>
          <span className="rank-up" style={{ fontSize: 14 }}>{myRow && aboveRow ? `#${aboveRow.rank}` : '—'}</span>
        </div>

      </div>
    </div>
  )
}
