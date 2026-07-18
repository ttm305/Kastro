import { useState, useEffect, useRef, useCallback } from 'react'
import type { Screen, Lang } from '../App'
import { useAuth } from '../lib/auth'
import { useMatchEngine } from '../lib/useMatchEngine'
import {
  submitRoundAnswer, leaveRoom, heartbeatMatchRoom, setRoomReady, getMyCoinDeltaForRoom, getMatchResults, getGameById,
  type MatchResultRow, type MatchRoom,
} from '../lib/api'
import MatchModeSelect from '../components/match/MatchModeSelect'
import MatchLobby from '../components/match/MatchLobby'
import MatchResults from '../components/match/MatchResults'
import Avatar from '../components/Avatar'
import { sound } from '../lib/sound'

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  gameId: string | null
}

const GAME_ID = 'emoji_decode'
const DEFAULT_ACCENT = '#ffb703'
const LOCKOUT_MS = 1100

type EmojiPayload = { puzzle_id: string; emoji: string; options_en: string[]; options_ar: string[] }

export default function EmojiDecodeScreen({ onNavigate, lang }: Props) {
  const { session, refreshProfile } = useAuth()
  const myUserId = session?.user.id ?? ''
  const isAr = lang === 'ar'

  const [gameMeta, setGameMeta] = useState<{ name: string; name_ar: string; accent_color: string } | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [confirmedTotal, setConfirmedTotal] = useState(0)
  const [roundPoints, setRoundPoints] = useState(0)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [isCorrect, setIsCorrect] = useState(false)
  const [wrongIndex, setWrongIndex] = useState<number | null>(null)
  const [lockedOut, setLockedOut] = useState(false)
  const [lastPoints, setLastPoints] = useState<number | null>(null)
  const [results, setResults] = useState<{ room: MatchRoom | null; rows: MatchResultRow[]; coinDelta: number } | null>(null)
  const lastRoundIdRef = useRef<string | null>(null)
  const resultsFetchedRef = useRef(false)

  const accent = gameMeta?.accent_color ?? DEFAULT_ACCENT
  const nameEn = gameMeta?.name ?? 'Emoji Decode'
  const nameAr = gameMeta?.name_ar ?? 'فك رموز الإيموجي'

  useEffect(() => {
    let cancelled = false
    getGameById(GAME_ID).then((g) => { if (!cancelled && g) setGameMeta({ name: g.name, name_ar: g.name_ar, accent_color: g.accent_color }) })
    return () => { cancelled = true }
  }, [])

  const { room, players, round, reveal, phase, roundTimeLeftMs, roundTimePct } = useMatchEngine(roomId)

  // Presence lifecycle fix: this used to only mark me "left" this room when
  // I tapped the explicit in-lobby leave button — never on unmount, so
  // navigating away any other way (bottom nav, back gesture, closing the
  // tab, backgrounding until the browser kills the tab) left the
  // match_room_players row open forever and get_presence() kept reporting
  // "Playing Emoji Decode" indefinitely. Now: a heartbeat every 20s keeps
  // the row fresh while this screen is actually mounted (get_presence()
  // and a server-side sweep both treat a lapsed heartbeat as stale after
  // 90s), beforeunload covers a hard tab close, and — the actual fix for
  // "leaving the game screen" / "navigating back" — the effect's own
  // cleanup calls leaveRoom() unconditionally on unmount, which fires the
  // instant App.tsx swaps this screen out for any reason.
  useEffect(() => {
    if (!roomId) return
    const heartbeat = window.setInterval(() => heartbeatMatchRoom(roomId), 20000)
    const handleUnload = () => { leaveRoom(roomId).catch(() => {}) }
    window.addEventListener('beforeunload', handleUnload)
    return () => {
      window.clearInterval(heartbeat)
      window.removeEventListener('beforeunload', handleUnload)
      leaveRoom(roomId).catch(() => {})
    }
  }, [roomId])

  // Reset per-round UI state whenever the round actually changes, folding the
  // previous round's final points into the confirmed running total first.
  useEffect(() => {
    if (!round || round.id === lastRoundIdRef.current) return
    lastRoundIdRef.current = round.id
    setConfirmedTotal((t) => t + roundPoints)
    setRoundPoints(0)
    setSelectedIndex(null)
    setIsCorrect(false)
    setWrongIndex(null)
    setLockedOut(false)
    setLastPoints(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  // Play a subtle cue the instant a round becomes tappable.
  const prevPhaseRef = useRef<string | null>(null)
  useEffect(() => {
    if (phase === 'playing' && prevPhaseRef.current !== 'playing') sound.roundStart()
    if (phase === 'reveal' && prevPhaseRef.current === 'playing' && !isCorrect) sound.timeUp()
    prevPhaseRef.current = phase
  }, [phase, isCorrect])

  // Fetch final standings once the match completes.
  useEffect(() => {
    if (phase !== 'results' || !room || resultsFetchedRef.current) return
    resultsFetchedRef.current = true
    ;(async () => {
      const [{ results: rows }, coinDelta] = await Promise.all([
        getMatchResults(room.id),
        getMyCoinDeltaForRoom(room.id, myUserId),
      ])
      setResults({ room, rows, coinDelta })
      await refreshProfile()
    })()
  }, [phase, room, myUserId, refreshProfile])

  const handleTap = useCallback(async (idx: number) => {
    if (!room || !round || phase !== 'playing' || isCorrect || lockedOut) return
    setSelectedIndex(idx)
    const { data } = await submitRoundAnswer(room.id, round.id, { selected_index: idx })
    if (!data) return
    if (data.is_correct) {
      setIsCorrect(true)
      setLastPoints(data.points_awarded)
      setRoundPoints(data.points_awarded)
      sound.correct()
    } else {
      setWrongIndex(idx)
      setLockedOut(true)
      sound.wrong()
      setTimeout(() => { setLockedOut(false); setWrongIndex(null); setSelectedIndex(null) }, LOCKOUT_MS)
    }
  }, [room, round, phase, isCorrect, lockedOut])

  const handleLeave = useCallback(() => {
    if (room) leaveRoom(room.id)
    onNavigate('games')
  }, [room, onNavigate])

  const handlePlayAgain = () => {
    setRoomId(null)
    setResults(null)
    resultsFetchedRef.current = false
    setConfirmedTotal(0)
    setRoundPoints(0)
    lastRoundIdRef.current = null
  }

  const liveScore = confirmedTotal + roundPoints

  // ── Mode select ──
  if (!roomId) {
    return <MatchModeSelect gameId={GAME_ID} nameEn={nameEn} nameAr={nameAr} accentColor={accent} lang={lang} onBack={() => onNavigate('games')} onRoomReady={setRoomId} />
  }

  // ── Loading ──
  if (!room) {
    return (
      <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="live-dot" style={{ background: accent }} />
      </div>
    )
  }

  // ── Lobby ──
  if (phase === 'lobby') {
    return (
      <MatchLobby
        room={room} players={players} myUserId={myUserId} lang={lang} accentColor={accent} nameEn={nameEn} nameAr={nameAr}
        onReady={(ready) => setRoomReady(room.id, ready)}
        onLeave={handleLeave}
      />
    )
  }

  // ── Results ──
  if (phase === 'results') {
    if (!results) {
      return (
        <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="live-dot" style={{ background: accent }} />
        </div>
      )
    }
    return (
      <MatchResults
        room={results.room ?? room} results={results.rows} myUserId={myUserId} myCoinDelta={results.coinDelta}
        lang={lang} accentColor={accent} nameEn={nameEn} nameAr={nameAr}
        onPlayAgain={handlePlayAgain} onBackToGames={() => onNavigate('games')}
      />
    )
  }

  // ── Get ready ──
  if (phase === 'get_ready' || !round) {
    return (
      <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <GameHeader accent={accent} isAr={isAr} nameEn={nameEn} nameAr={nameAr} round={room.current_round} totalRounds={room.round_count} score={liveScore} onExit={handleLeave} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div className="animate-get-ready" style={{ width: 64, height: 64, borderRadius: '50%', background: `${accent}22`, border: `2px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🧩</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(var(--fg-rgb),0.5)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {isAr ? 'استعد…' : 'Get Ready…'}
          </div>
        </div>
      </div>
    )
  }

  const payload = round.payload as unknown as EmojiPayload
  const options = isAr ? payload.options_ar : payload.options_en
  const timerColor = roundTimePct > 0.5 ? '#10b981' : roundTimePct > 0.25 ? '#f59e0b' : '#ef4444'

  // ── Reveal ──
  if (phase === 'reveal') {
    return (
      <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <GameHeader accent={accent} isAr={isAr} nameEn={nameEn} nameAr={nameAr} round={room.current_round} totalRounds={room.round_count} score={liveScore} onExit={handleLeave} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', gap: 18 }}>
          <div className="animate-scale-in" style={{ fontSize: 48 }}>{payload.emoji}</div>
          <div className="animate-pop" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: isCorrect ? '#10b981' : '#ef4444', fontFamily: "'Exo 2', sans-serif" }}>
              {isCorrect ? (isAr ? `صحيح! +${lastPoints}` : `Correct! +${lastPoints}`) : (isAr ? 'الوقت انتهى' : "Time's Up")}
            </div>
            {!isCorrect && (
              <div style={{ fontSize: 13, color: 'rgba(var(--fg-rgb),0.5)', marginTop: 6 }}>
                {isAr ? 'الإجابة الصحيحة:' : 'Correct answer:'}{' '}
                <b style={{ color: accent }}>
                  {(() => {
                    const ci = (reveal?.[0]?.correct_answer as { correct_index?: number } | undefined)?.correct_index
                    return typeof ci === 'number' ? options[ci] : ''
                  })()}
                </b>
              </div>
            )}
          </div>

          {players.length > 1 && reveal && (
            <div className="card animate-slide-up" style={{ width: '100%', maxWidth: 340, padding: '10px 12px' }}>
              {reveal
                .slice()
                .sort((a, b) => b.points_awarded - a.points_awarded)
                .map((r) => {
                  const p = players.find((pl) => pl.user_id === r.user_id)
                  return (
                    <div key={r.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px' }}>
                      <Avatar url={p?.profile?.avatar_url} size={22} />
                      <span className="truncate" style={{ flex: 1, fontSize: 11.5, color: 'var(--foreground)' }}>@{p?.profile?.username ?? '…'}</span>
                      <span style={{ fontSize: 11.5, color: r.is_correct ? '#10b981' : 'rgba(var(--fg-rgb),0.35)' }}>{r.is_correct ? `✓ +${r.points_awarded}` : '✕'}</span>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </div>
    )
  }

  // ── Playing ──
  return (
    <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <GameHeader accent={accent} isAr={isAr} nameEn={nameEn} nameAr={nameAr} round={room.current_round} totalRounds={room.round_count} score={liveScore} onExit={handleLeave} />

      <div style={{ padding: '0 16px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="xp-bar" style={{ height: 5, flex: 1 }}>
          <div style={{ width: '100%', height: '100%', borderRadius: 99, background: timerColor, transform: `scaleX(${roundTimePct})`, transformOrigin: isAr ? 'right center' : 'left center', transition: 'transform 0.1s linear, background 0.3s ease' }} />
        </div>
        <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, color: timerColor, minWidth: 30, textAlign: isAr ? 'left' : 'right' }}>
          {(roundTimeLeftMs / 1000).toFixed(1)}s
        </span>
      </div>

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '20px 20px', gap: 28 }}>
        <div key={round.id} className="animate-pop" style={{ fontSize: 56, letterSpacing: 4, textAlign: 'center' }}>{payload.emoji}</div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: 400 }}>
          {options.map((opt, idx) => {
            const isSelected = selectedIndex === idx
            const isWrongTap = wrongIndex === idx
            const showCorrect = isCorrect && isSelected
            return (
              <button
                key={idx}
                disabled={isCorrect || lockedOut || phase !== 'playing'}
                onClick={() => handleTap(idx)}
                className={showCorrect ? 'animate-correct-pop' : isWrongTap ? 'animate-wrong-shake' : undefined}
                style={{
                  padding: '18px 12px', borderRadius: 16, textAlign: 'center', fontSize: 14.5, fontWeight: 700, cursor: isCorrect || lockedOut ? 'default' : 'pointer',
                  color: showCorrect ? '#10b981' : isWrongTap ? '#ef4444' : 'var(--foreground)',
                  background: showCorrect ? 'rgba(16,185,129,0.15)' : isWrongTap ? 'rgba(239,68,68,0.15)' : 'rgba(var(--fg-rgb),0.05)',
                  border: `1.5px solid ${showCorrect ? 'rgba(16,185,129,0.5)' : isWrongTap ? 'rgba(239,68,68,0.5)' : 'rgba(var(--fg-rgb),0.09)'}`,
                  transition: 'all 0.15s ease', fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit',
                }}
              >
                {opt}
              </button>
            )
          })}
        </div>

        {lockedOut && (
          <div className="animate-slide-up" style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
            {isAr ? 'إجابة خاطئة — حاول مجدداً…' : 'Wrong — try again…'}
          </div>
        )}
        {isCorrect && (
          <div className="animate-slide-up" style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>
            {isAr ? 'أحسنت! بانتظار انتهاء الجولة…' : 'Nice! Waiting for the round to end…'}
          </div>
        )}
      </div>
    </div>
  )
}

function GameHeader({ accent, isAr, nameEn, nameAr, round, totalRounds, score, onExit }: {
  accent: string; isAr: boolean; nameEn: string; nameAr: string; round: number; totalRounds: number; score: number; onExit: () => void
}) {
  return (
    <div className="glass" style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <button onClick={onExit} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10, width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 13, color: 'var(--foreground)' }}>✕</button>
      <div style={{ textAlign: 'center' }}>
        <div className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--foreground)' }}>{isAr ? nameAr : nameEn}</div>
        <div style={{ fontSize: 10.5, color: accent }}>{isAr ? `جولة ${round}/${totalRounds}` : `Round ${round}/${totalRounds}`}</div>
      </div>
      <div style={{ textAlign: 'center', minWidth: 46 }}>
        <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 16, fontWeight: 800, color: accent }}>{score}</div>
        <div style={{ fontSize: 9, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'النقاط' : 'Score'}</div>
      </div>
    </div>
  )
}
