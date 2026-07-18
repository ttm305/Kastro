import { useEffect, useMemo, useState } from 'react'
import type { Lang } from '../../App'
import Avatar from '../Avatar'
import type { MatchRoom, MatchResultRow } from '../../lib/api'
import { sound } from '../../lib/sound'

interface Props {
  room: MatchRoom
  results: MatchResultRow[]
  myUserId: string
  myCoinDelta: number
  lang: Lang
  accentColor: string
  nameEn: string
  nameAr: string
  onPlayAgain: () => void
  onBackToGames: () => void
}

const CONFETTI_COLORS = ['#7c3aed', '#00d4ff', '#ffd700', '#ff4785', '#00e676', '#ff6b35']

function Confetti() {
  const pieces = useMemo(() => Array.from({ length: 28 }).map((_, i) => ({
    id: i,
    left: Math.random() * 100,
    color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
    dur: 1.8 + Math.random() * 1.4,
    delay: Math.random() * 0.5,
    drift: (Math.random() - 0.5) * 120,
  })), [])
  return (
    <div className="confetti-wrap">
      {pieces.map((p) => (
        <div key={p.id} className="confetti-piece" style={{ left: `${p.left}%`, background: p.color, ['--dur' as string]: `${p.dur}s`, ['--delay' as string]: `${p.delay}s`, ['--drift' as string]: `${p.drift}px` }} />
      ))}
    </div>
  )
}

export default function MatchResults({ room, results, myUserId, myCoinDelta, lang, accentColor, nameEn, nameAr, onPlayAgain, onBackToGames }: Props) {
  const isAr = lang === 'ar'
  const me = results.find((r) => r.user_id === myUserId)
  const isMultiplayer = results.length > 1
  const won = isMultiplayer ? me?.final_rank === 1 : true
  const [showConfetti, setShowConfetti] = useState(false)

  useEffect(() => {
    if (won) { sound.win(); setShowConfetti(true) } else { sound.matchEnd() }
    if (myCoinDelta > 0) setTimeout(() => sound.coin(), 500)
    const t = setTimeout(() => setShowConfetti(false), 3200)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const rankMedal = (rank: number | null) => {
    if (rank === 1) return '🥇'
    if (rank === 2) return '🥈'
    if (rank === 3) return '🥉'
    return null
  }

  return (
    <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 18px', position: 'relative' }}>
      {showConfetti && <Confetti />}

      <div className="animate-scale-in" style={{ fontSize: 60, marginBottom: 6 }}>
        {won ? (isMultiplayer ? '🏆' : '🎉') : '👏'}
      </div>
      <h2 className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 24, fontWeight: 900, color: won ? '#ffd700' : 'var(--foreground)', margin: '0 0 2px', textAlign: 'center' }}>
        {isMultiplayer
          ? (won ? (isAr ? 'فزت بالمباراة!' : 'You Won!') : (isAr ? `المركز ${me?.final_rank ?? '-'}` : `You Placed #${me?.final_rank ?? '-'}`))
          : (isAr ? 'اكتملت الجولة!' : 'Match Complete!')}
      </h2>
      <p style={{ margin: '0 0 4px', fontSize: 13, color: 'rgba(var(--fg-rgb),0.45)' }}>{isAr ? nameAr : nameEn}</p>
      <p style={{ margin: '0 0 20px', fontSize: 11, color: 'rgba(var(--fg-rgb),0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {room.mode === 'solo' ? (isAr ? 'تدريب فردي' : 'Solo Practice') : room.mode === 'private' ? (isAr ? 'غرفة خاصة' : 'Private Room') : (isAr ? 'مباراة سريعة' : 'Quick Match')}
      </p>

      {/* XP / Coins / Score breakdown */}
      <div className="card animate-slide-up" style={{ width: '100%', maxWidth: 420, padding: '18px 16px', marginBottom: 16, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, border: `1px solid ${accentColor}30` }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 22, fontWeight: 800, color: accentColor }}>{(me?.final_score ?? 0).toLocaleString()}</div>
          <div style={{ fontSize: 9.5, color: 'rgba(var(--fg-rgb),0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{isAr ? 'النقاط' : 'Score'}</div>
        </div>
        <div style={{ textAlign: 'center', borderLeft: '1px solid rgba(var(--fg-rgb),0.07)', borderRight: '1px solid rgba(var(--fg-rgb),0.07)' }}>
          <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 22, fontWeight: 800, color: '#a78bfa' }}>+{me?.xp_awarded ?? 0}</div>
          <div style={{ fontSize: 9.5, color: 'rgba(var(--fg-rgb),0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>XP</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 22, fontWeight: 800, color: '#ffd700' }}>+{myCoinDelta}</div>
          <div style={{ fontSize: 9.5, color: 'rgba(var(--fg-rgb),0.4)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 2 }}>{isAr ? 'عملات' : 'Coins'}</div>
        </div>
      </div>

      {/* Standings */}
      {isMultiplayer && (
        <div className="card animate-slide-up" style={{ width: '100%', maxWidth: 420, padding: '14px 14px', marginBottom: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, padding: '0 4px' }}>
            {isAr ? 'الترتيب النهائي' : 'Final Standings'}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {results.map((r) => {
              const mine = r.user_id === myUserId
              const medal = rankMedal(r.final_rank)
              return (
                <div
                  key={r.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 12,
                    background: mine ? `${accentColor}12` : 'rgba(var(--fg-rgb),0.03)',
                    border: `1px solid ${mine ? accentColor + '40' : 'rgba(var(--fg-rgb),0.06)'}`,
                  }}
                >
                  <div style={{ width: 22, textAlign: 'center', fontSize: 14, fontWeight: 800, color: 'rgba(var(--fg-rgb),0.5)' }}>
                    {medal ?? `#${r.final_rank ?? '-'}`}
                  </div>
                  <Avatar url={r.profile?.avatar_url} size={30} />
                  <span className="truncate" style={{ flex: 1, fontSize: 13, fontWeight: mine ? 800 : 600, color: mine ? accentColor : 'var(--foreground)' }}>
                    @{r.profile?.username ?? '…'}{mine ? ` (${isAr ? 'أنت' : 'You'})` : ''}
                  </span>
                  <span style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 14, fontWeight: 800, color: 'var(--foreground)' }}>{r.final_score.toLocaleString()}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div style={{ width: '100%', maxWidth: 420, display: 'flex', gap: 10, marginTop: isMultiplayer ? 0 : 8 }}>
        <button className="btn-ghost" style={{ flex: 1, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit' }} onClick={onBackToGames}>
          {isAr ? 'الألعاب' : 'Games'}
        </button>
        <button className="btn-primary" style={{ flex: 1, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit' }} onClick={onPlayAgain}>
          {isAr ? '🔄 العب مجدداً' : '🔄 Play Again'}
        </button>
      </div>
    </div>
  )
}
