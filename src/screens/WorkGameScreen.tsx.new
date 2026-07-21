import { useState, useEffect, useRef } from 'react'
import type { Screen, Lang } from '../App'
import { useAuth } from '../lib/auth'
import { startGameSession, getGameQuestions, submitAnswer, completeGameSession } from '../lib/api'

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  gameId: string | null
  context?: { type: 'practice' | 'challenge' | 'tournament'; refId?: string } | null
}

interface QuizQuestion {
  id: string
  question_text: string
  question_text_ar: string
  options: string[]
  options_ar: string[]
  difficulty: string
  sort_order: number
}

const QUESTION_SECONDS = 30

export default function WorkGameScreen({ onNavigate, lang, gameId, context }: Props) {
  const { refreshProfile } = useAuth()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [questions, setQuestions] = useState<QuizQuestion[]>([])
  const [loading, setLoading] = useState(true)
  const [qIndex, setQIndex] = useState(0)
  const [selected, setSelected] = useState<number | null>(null)
  const [correctIndex, setCorrectIndex] = useState<number | null>(null)
  const [timeLeft, setTimeLeft] = useState(QUESTION_SECONDS)
  const [score, setScore] = useState(0)
  const [answered, setAnswered] = useState<boolean[]>([])
  const [gameOver, setGameOver] = useState(false)
  const [finalXp, setFinalXp] = useState(0)
  const [combo, setCombo] = useState(0)
  const [comboBonusFlash, setComboBonusFlash] = useState<number | null>(null)
  const questionStartRef = useRef<number>(Date.now())
  const isAr = lang === 'ar'
  const q = questions[qIndex]

  const startGame = async () => {
    setLoading(true)
    const gid = gameId ?? 'wg1'
    const [sid, qs] = await Promise.all([
      startGameSession(gid, context?.type ?? 'practice', context?.refId),
      getGameQuestions(gid),
    ])
    setSessionId(sid)
    setQuestions(qs as unknown as QuizQuestion[])
    setQIndex(0)
    setScore(0)
    setSelected(null)
    setCorrectIndex(null)
    setTimeLeft(QUESTION_SECONDS)
    setAnswered([])
    setGameOver(false)
    setFinalXp(0)
    setCombo(0)
    setComboBonusFlash(null)
    questionStartRef.current = Date.now()
    setLoading(false)
  }

  useEffect(() => {
    startGame()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  useEffect(() => {
    if (loading || selected !== null || gameOver) return
    if (timeLeft <= 0) {
      handleAnswer(-1)
      return
    }
    const t = setTimeout(() => setTimeLeft((prev) => prev - 1), 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeLeft, selected, gameOver, loading])

  const handleAnswer = async (idx: number) => {
    if (selected !== null || !q || !sessionId) return
    setSelected(idx)
    const timeTakenMs = Date.now() - questionStartRef.current

    const result = await submitAnswer(sessionId, q.id, idx, timeTakenMs)
    if (result) {
      setCorrectIndex(result.correct_option_index)
      if (result.is_correct) setScore((s) => s + result.points_awarded)
      setAnswered((prev) => [...prev, result.is_correct])
      setCombo(result.combo ?? 0)
      if (result.combo_bonus) {
        setComboBonusFlash(result.combo_bonus)
        setTimeout(() => setComboBonusFlash(null), 1400)
      }
    }

    setTimeout(() => {
      if (qIndex + 1 >= questions.length) {
        ;(async () => {
          const summary = sessionId ? await completeGameSession(sessionId) : null
          if (summary) {
            setScore(summary.total_score)
            setFinalXp(summary.xp_awarded)
          }
          await refreshProfile()
          setGameOver(true)
        })()
      } else {
        setQIndex((i) => i + 1)
        setSelected(null)
        setCorrectIndex(null)
        setTimeLeft(QUESTION_SECONDS)
        questionStartRef.current = Date.now()
      }
    }, 1400)
  }

  if (loading || !q) {
    return (
      <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="live-dot" />
      </div>
    )
  }

  if (gameOver) {
    const correctCount = answered.filter(Boolean).length
    const accuracy = answered.length ? Math.round((correctCount / answered.length) * 100) : 0
    const medal = accuracy === 100 ? '🥇' : accuracy >= 70 ? '🥈' : accuracy >= 40 ? '🥉' : '🎯'
    return (
      <div className="screen bg-mesh" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px', minHeight: '100dvh' }}>
        <div className="glass-card animate-scale-in" style={{ width: '100%', maxWidth: 420, padding: '32px 24px', textAlign: 'center' }}>
          <div style={{ fontSize: 64, marginBottom: 16 }} className="animate-float">
            {medal}
          </div>
          <h2 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: '0 0 6px', fontSize: 28, fontWeight: 800, color: '#fbbf24' }}>
            {isAr ? (accuracy === 100 ? 'إجابات مثالية!' : 'أحسنت!') : (accuracy === 100 ? 'Perfect Round!' : 'Nice Work!')}
          </h2>
          <p style={{ margin: '0 0 24px', color: 'rgba(var(--fg-rgb),0.5)', fontSize: 14 }}>
            {isAr ? 'انتهى التحدي · بروتوكول السلامة' : 'Challenge Complete · Safety Protocol'}
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 24 }}>
            {[
              { label: isAr ? 'نقاطك' : 'Your Score', value: score.toLocaleString(), color: '#fbbf24' },
              { label: isAr ? 'الدقة' : 'Accuracy', value: `${accuracy}%`, color: '#a78bfa' },
              { label: isAr ? 'XP مكتسب' : 'XP Earned', value: `+${finalXp}`, color: '#06b6d4' },
            ].map((s) => (
              <div key={s.label} style={{ background: 'rgba(var(--fg-rgb),0.05)', borderRadius: 14, padding: '14px 8px' }}>
                <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
                <div style={{ fontSize: 10, color: 'rgba(var(--fg-rgb),0.4)', marginTop: 3 }}>{s.label}</div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn-secondary" style={{ flex: 1, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit' }} onClick={() => onNavigate('games')}>
              {isAr ? 'العاب أخرى' : 'More Games'}
            </button>
            <button className="btn-primary" style={{ flex: 1, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit' }} onClick={() => { startGame() }}>
              {isAr ? '🔄 إعادة اللعب' : '🔄 Play Again'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const timePct = (timeLeft / 30) * 100
  const timerColor = timeLeft > 15 ? '#10b981' : timeLeft > 8 ? '#f59e0b' : '#ef4444'

  return (
    <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      {/* Game Header */}
      <div className="glass" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <button onClick={() => onNavigate('games')} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, color: 'var(--foreground)' }}>
            ✕
          </button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)', fontFamily: "'Rajdhani', sans-serif" }}>
              {isAr ? `السؤال ${qIndex + 1}/${questions.length}` : `Q ${qIndex + 1} of ${questions.length}`}
            </div>
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginTop: 4 }}>
              {questions.map((_, i) => (
                <div key={i} style={{ width: 28, height: 4, borderRadius: 2, background: i < qIndex ? '#10b981' : i === qIndex ? '#a78bfa' : 'rgba(var(--fg-rgb),0.15)', transition: 'background 0.3s ease' }} />
              ))}
            </div>
          </div>
          <div style={{ textAlign: isAr ? 'left' : 'right' }}>
            <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 18, fontWeight: 800, color: '#fbbf24' }}>{score}</div>
            <div style={{ fontSize: 10, color: 'rgba(var(--fg-rgb),0.4)' }}>pts</div>
          </div>
        </div>
        {combo >= 2 && (
          <div style={{ display: 'flex', justifyContent: 'center', paddingBottom: 8 }}>
            <span style={{ fontSize: 11, fontWeight: 800, color: '#ff6b35', background: 'rgba(255,107,53,0.12)', border: '1px solid rgba(255,107,53,0.3)', borderRadius: 99, padding: '3px 10px' }}>
              🔥 {isAr ? `متتالية ${combo}` : `${combo}x combo`}
            </span>
          </div>
        )}
        {comboBonusFlash !== null && (
          <div style={{ position: 'fixed', top: '40%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 200, pointerEvents: 'none' }} className="animate-scale-in">
            <span style={{ fontSize: 24, fontWeight: 900, color: '#ffd700', fontFamily: "'Rajdhani', sans-serif", textShadow: '0 0 20px rgba(255,215,0,0.6)' }}>
              +{comboBonusFlash} {isAr ? 'مكافأة التتالي!' : 'COMBO BONUS!'}
            </span>
          </div>
        )}
      </div>

      <div style={{ flex: 1, padding: '16px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        {/* Timer */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)' }}>⏱️ {isAr ? 'الوقت المتبقي' : 'Time left'}</span>
            <span style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 18, fontWeight: 800, color: timerColor }}>{timeLeft}s</span>
          </div>
          <div className="xp-bar" style={{ height: 6, overflow: 'hidden', borderRadius: 99 }}>
            <div style={{
              width: '100%', height: '100%', borderRadius: 99, background: timerColor,
              transform: `scaleX(${timePct / 100})`, transformOrigin: isAr ? 'right center' : 'left center',
              transition: 'transform 1s linear, background 0.3s ease',
            }} />
          </div>
        </div>

        {/* Question */}
        <div className="glass-card" style={{ padding: '20px', background: 'rgba(var(--fg-rgb),0.06)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <span style={{ fontSize: 16 }}>🛡️</span>
            <span style={{ fontSize: 11, color: '#a78bfa', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              {isAr ? 'بروتوكول السلامة' : 'Safety Protocol'}
            </span>
          </div>
          <p className={isAr ? 'font-cairo' : ''} style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.5 }}>
            {isAr ? q.question_text_ar : q.question_text}
          </p>
        </div>

        {/* Options */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {(isAr ? q.options_ar : q.options).map((opt, i) => {
            let bg = 'rgba(var(--fg-rgb),0.05)'
            let border = 'rgba(var(--fg-rgb),0.08)'
            let color = 'var(--foreground)'
            if (selected !== null && correctIndex !== null) {
              if (i === correctIndex) { bg = 'rgba(16,185,129,0.15)'; border = '#10b981'; color = '#10b981' }
              else if (i === selected && i !== correctIndex) { bg = 'rgba(239,68,68,0.15)'; border = '#ef4444'; color = '#ef4444' }
            } else if (selected === null) {
              // no highlight
            }
            return (
              <button
                key={i}
                onClick={() => handleAnswer(i)}
                disabled={selected !== null}
                style={{
                  width: '100%', padding: '16px', borderRadius: 14, border: `1px solid ${border}`,
                  background: bg, color, fontSize: 14, fontWeight: 600, cursor: selected === null ? 'pointer' : 'default',
                  textAlign: isAr ? 'right' as const : 'left' as const,
                  transition: 'all 0.3s ease',
                  fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit',
                  display: 'flex', alignItems: 'center', gap: 12,
                }}
              >
                <span style={{
                  width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
                  background: selected !== null && correctIndex !== null && i === correctIndex ? '#10b981' : selected === i && correctIndex !== null && i !== correctIndex ? '#ef4444' : 'rgba(var(--fg-rgb),0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 13, fontWeight: 800, color: selected !== null && correctIndex !== null && (i === correctIndex || i === selected) ? 'white' : 'rgba(var(--fg-rgb),0.5)',
                  transition: 'all 0.3s ease',
                }}>
                  {selected !== null && correctIndex !== null && i === correctIndex ? '✓' : selected === i && correctIndex !== null && i !== correctIndex ? '✕' : ['A', 'B', 'C', 'D'][i]}
                </span>
                {opt}
              </button>
            )
          })}
        </div>

        {/* Live accuracy — real, derived from this session's actual answers */}
        {answered.length > 0 && (
          <div className="glass-card" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {isAr ? '✅ الدقة حتى الآن' : '✅ Accuracy so far'}
            </span>
            <span style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 16, fontWeight: 800, color: '#10b981' }}>
              {Math.round((answered.filter(Boolean).length / answered.length) * 100)}%
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
