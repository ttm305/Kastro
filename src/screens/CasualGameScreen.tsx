import { useState, useEffect, useCallback, useRef } from 'react'
import type { Screen, Lang } from '../App'
import { useAuth } from '../lib/auth'
import { startGameSession, completeGameSession, getGameById } from '../lib/api'

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  setLang?: (l: Lang) => void
  gameId: string | null
  context?: { type: 'practice' | 'challenge' | 'tournament'; refId?: string } | null
}

// Card Clash: flip cards to find matching pairs
const CARD_EMOJIS = ['🌟', '🎯', '🔥', '💎', '⚡', '🏆', '🎮', '🚀']
const CARDS = [...CARD_EMOJIS, ...CARD_EMOJIS]
  .map((e, i) => ({ id: i, emoji: e, matched: false }))
  .sort(() => Math.random() - 0.5)

export default function CasualGameScreen({ onNavigate, lang, gameId, context }: Props) {
  const { refreshProfile } = useAuth()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [cards, setCards] = useState(CARDS.map((c) => ({ ...c })))
  const [flipped, setFlipped] = useState<number[]>([])
  const [matched, setMatched] = useState<number[]>([])
  const [moves, setMoves] = useState(0)
  const [timeLeft, setTimeLeft] = useState(90)
  const [gameOver, setGameOver] = useState(false)
  const [won, setWon] = useState(false)
  const [finalScore, setFinalScore] = useState<number | null>(null)
  const [finalXp, setFinalXp] = useState<number | null>(null)
  const [gameTitle, setGameTitle] = useState<{ en: string; ar: string } | null>(null)
  const completedRef = useRef(false)
  const isAr = lang === 'ar'
  // Falls back to "Card Clash" (the mechanic every casual game currently
  // uses) whenever a game's real catalog name hasn't loaded yet or gameId
  // is unset — so the header never sits blank, but always prefers the real
  // name once known instead of hardcoding one game's title for all of them.
  const titleEn = gameTitle?.en ?? 'Card Clash'
  const titleAr = gameTitle?.ar ?? 'صراع البطاقات'

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const sid = await startGameSession(gameId ?? 'cg1', context?.type ?? 'practice', context?.refId)
      if (!cancelled) setSessionId(sid)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  // The card-matching mechanic is shared by every casual game for now, but the
  // header should still show whichever game the player actually chose from
  // the library (e.g. "Puzzle Rush") rather than a hardcoded "Card Clash".
  useEffect(() => {
    let cancelled = false
    getGameById(gameId ?? 'cg1').then((g) => { if (!cancelled && g) setGameTitle({ en: g.name, ar: g.name_ar }) })
    return () => { cancelled = true }
  }, [gameId])

  useEffect(() => {
    if (gameOver || won) return
    if (timeLeft <= 0) { setGameOver(true); return }
    const t = setTimeout(() => setTimeLeft((p) => p - 1), 1000)
    return () => clearTimeout(t)
  }, [timeLeft, gameOver, won])

  useEffect(() => {
    if (matched.length === CARD_EMOJIS.length * 2) {
      setWon(true)
    }
  }, [matched])

  // Once the round ends, ask the server to recompute the authoritative score/XP
  // from the clamped moves/time-left inputs (client values are just an optimistic preview).
  useEffect(() => {
    if (!(gameOver || won) || !sessionId || completedRef.current) return
    completedRef.current = true
    ;(async () => {
      const summary = await completeGameSession(sessionId, moves, timeLeft)
      if (summary) {
        setFinalScore(summary.total_score)
        setFinalXp(summary.xp_awarded)
      }
      await refreshProfile()
    })()
  }, [gameOver, won, sessionId, moves, timeLeft, refreshProfile])

  const handleFlip = useCallback((id: number) => {
    if (flipped.length === 2) return
    if (flipped.includes(id) || matched.includes(id)) return

    const newFlipped = [...flipped, id]
    setFlipped(newFlipped)

    if (newFlipped.length === 2) {
      setMoves((m) => m + 1)
      const [a, b] = newFlipped
      const cardA = cards.find((c) => c.id === a)
      const cardB = cards.find((c) => c.id === b)

      if (cardA && cardB && cardA.emoji === cardB.emoji) {
        setMatched((prev) => [...prev, a, b])
        setFlipped([])
      } else {
        setTimeout(() => setFlipped([]), 900)
      }
    }
  }, [flipped, matched, cards])

  const reset = () => {
    const newCards = [...CARD_EMOJIS, ...CARD_EMOJIS]
      .map((e, i) => ({ id: i, emoji: e, matched: false }))
      .sort(() => Math.random() - 0.5)
    setCards(newCards)
    setFlipped([])
    setMatched([])
    setMoves(0)
    setTimeLeft(90)
    setGameOver(false)
    setWon(false)
    setFinalScore(null)
    setFinalXp(null)
    completedRef.current = false
    setSessionId(null)
    startGameSession(gameId ?? 'cg1', 'practice').then(setSessionId)
  }

  const score = won ? Math.max(0, timeLeft * 20 + (16 - moves) * 50 + 500) : 0
  const displayScore = finalScore ?? score
  const displayXp = finalXp ?? Math.floor(score / 10)
  const timePct = (timeLeft / 90) * 100
  const timerColor = timeLeft > 45 ? '#10b981' : timeLeft > 20 ? '#f59e0b' : '#ef4444'

  if (gameOver || won) {
    return (
      <div className="screen bg-mesh" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', minHeight: '100dvh' }}>
        <div className="glass-card animate-scale-in" style={{ width: '100%', maxWidth: 420, padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }} className="animate-float">
            {won ? '🎉' : '⏰'}
          </div>
          <h2 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 800, color: won ? '#fbbf24' : '#ef4444' }}>
            {won ? (isAr ? 'رائع!' : 'Excellent!') : (isAr ? 'انتهى الوقت' : 'Time\'s Up!')}
          </h2>
          <p style={{ margin: '0 0 24px', color: 'rgba(var(--fg-rgb),0.5)', fontSize: 14 }}>
            {isAr ? titleAr : titleEn}
          </p>

          {won && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
              {[
                { label: isAr ? 'نقاطك' : 'Score', value: displayScore.toLocaleString(), color: '#fbbf24' },
                { label: isAr ? 'الحركات' : 'Moves', value: String(moves), color: '#a78bfa' },
                { label: isAr ? 'XP' : 'XP', value: `+${displayXp}`, color: '#06b6d4' },
              ].map((s) => (
                <div key={s.label} style={{ background: 'rgba(var(--fg-rgb),0.05)', borderRadius: 14, padding: '14px 8px' }}>
                  <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
                  <div style={{ fontSize: 10, color: 'rgba(var(--fg-rgb),0.4)', marginTop: 3 }}>{s.label}</div>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" style={{ flex: 1, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit' }} onClick={() => onNavigate('games')}>
              {isAr ? 'الألعاب' : 'Games'}
            </button>
            <button className="btn-primary" style={{ flex: 1, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit' }} onClick={reset}>
              {isAr ? '🔄 مجدداً' : '🔄 Play Again'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div className="glass" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <button onClick={() => onNavigate('games')} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, color: 'var(--foreground)' }}>
            ✕
          </button>
          <div style={{ textAlign: 'center' }}>
            <div className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 15, fontWeight: 800, color: 'var(--foreground)' }}>
              {isAr ? titleAr : titleEn}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 16 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 16, fontWeight: 800, color: timerColor }}>{timeLeft}s</div>
              <div style={{ fontSize: 9, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'الوقت' : 'Time'}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 16, fontWeight: 800, color: '#a78bfa' }}>{moves}</div>
              <div style={{ fontSize: 9, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'حركة' : 'Moves'}</div>
            </div>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 16, fontWeight: 800, color: '#fbbf24' }}>{matched.length / 2}/{CARD_EMOJIS.length}</div>
              <div style={{ fontSize: 9, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'أزواج' : 'Pairs'}</div>
            </div>
          </div>
        </div>
        <div className="xp-bar" style={{ height: 4 }}>
          <div style={{
            width: '100%', height: '100%', borderRadius: 99, background: timerColor,
            transform: `scaleX(${timePct / 100})`, transformOrigin: isAr ? 'right center' : 'left center',
            transition: 'transform 1s linear, background 0.3s ease',
          }} />
        </div>
      </div>

      {/* Card Grid */}
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, width: '100%', maxWidth: 360 }}>
          {cards.map((card) => {
            const isFlipped = flipped.includes(card.id) || matched.includes(card.id)
            const isMatchedCard = matched.includes(card.id)
            return (
              <button
                key={card.id}
                onClick={() => handleFlip(card.id)}
                disabled={isFlipped}
                style={{
                  aspectRatio: '1',
                  borderRadius: 16,
                  border: isMatchedCard ? '2px solid rgba(16,185,129,0.5)' : isFlipped ? '2px solid rgba(124,58,237,0.5)' : '1px solid rgba(var(--fg-rgb),0.08)',
                  background: isMatchedCard
                    ? 'linear-gradient(135deg, rgba(16,185,129,0.15), rgba(16,185,129,0.08))'
                    : isFlipped
                    ? 'rgba(124,58,237,0.15)'
                    : 'rgba(var(--fg-rgb),0.05)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: 28,
                  cursor: isFlipped ? 'default' : 'pointer',
                  transition: 'all 0.2s ease',
                  transform: isFlipped ? 'scale(1)' : 'scale(1)',
                  boxShadow: isMatchedCard ? '0 0 12px rgba(16,185,129,0.3)' : isFlipped ? '0 0 12px rgba(124,58,237,0.2)' : 'none',
                }}
              >
                {isFlipped ? card.emoji : (
                  <div style={{ fontSize: 20, color: 'rgba(var(--fg-rgb),0.15)' }}>❓</div>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Bottom hint */}
      <div style={{ padding: '12px 16px', textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 12, color: 'rgba(var(--fg-rgb),0.3)' }}>
          {isAr ? 'اقلب البطاقات للعثور على الأزواج المتطابقة' : 'Flip cards to find matching pairs'}
        </p>
      </div>
    </div>
  )
}
