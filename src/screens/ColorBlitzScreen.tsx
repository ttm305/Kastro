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
import { sound } from '../lib/sound'
import { diagLog } from '../lib/diagnostics'

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  gameId: string | null
}

const GAME_ID = 'color_blitz'
const DEFAULT_ACCENT = '#06d6a0'
const LOCKOUT_MS = 550

type ColorPayload = { grid_size: number; tiles: number[] }

export default function ColorBlitzScreen({ onNavigate, lang }: Props) {
  const { session, refreshProfile } = useAuth()
  const myUserId = session?.user.id ?? ''
  const isAr = lang === 'ar'

  const [gameMeta, setGameMeta] = useState<{ name: string; name_ar: string; accent_color: string } | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [confirmedTotal, setConfirmedTotal] = useState(0)
  const [roundPoints, setRoundPoints] = useState(0)
  const [lockedIndex, setLockedIndex] = useState<number | null>(null) // the tile the player is committed to this round (correct)
  const [wrongIndex, setWrongIndex] = useState<number | null>(null)
  const [lockedOut, setLockedOut] = useState(false)
  const [isCorrect, setIsCorrect] = useState(false)
  const [lastPoints, setLastPoints] = useState<number | null>(null)
  const [results, setResults] = useState<{ room: MatchRoom | null; rows: MatchResultRow[]; coinDelta: number } | null>(null)
  const [readyBusy, setReadyBusy] = useState(false)
  const [readyError, setReadyError] = useState<string | null>(null)
  const lastRoundIdRef = useRef<string | null>(null)
  const resultsFetchedRef = useRef(false)

  const accent = gameMeta?.accent_color ?? DEFAULT_ACCENT
  const nameEn = gameMeta?.name ?? 'Color Blitz'
  const nameAr = gameMeta?.name_ar ?? 'صراع الألوان'

  useEffect(() => {
    let cancelled = false
    getGameById(GAME_ID).then((g) => { if (!cancelled && g) setGameMeta({ name: g.name, name_ar: g.name_ar, accent_color: g.accent_color }) })
    return () => { cancelled = true }
  }, [])

  const { room, players, round, reveal, phase, roundTimeLeftMs, roundTimePct, refresh } = useMatchEngine(roomId)

  // Presence lifecycle fix: this used to only mark me "left" this room when
  // I tapped the explicit in-lobby leave button — never on unmount, so
  // navigating away any other way (bottom nav, back gesture, closing the
  // tab, backgrounding until the browser kills the tab) left the
  // match_room_players row open forever and get_presence() kept reporting
  // "Playing Color Blitz" indefinitely. Now: a heartbeat every 20s keeps
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

  useEffect(() => {
    if (!round || round.id === lastRoundIdRef.current) return
    lastRoundIdRef.current = round.id
    setConfirmedTotal((t) => t + roundPoints)
    setRoundPoints(0)
    setLockedIndex(null)
    setWrongIndex(null)
    setLockedOut(false)
    setIsCorrect(false)
    setLastPoints(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round])

  const prevPhaseRef = useRef<string | null>(null)
  useEffect(() => {
    if (phase === 'playing' && prevPhaseRef.current !== 'playing') sound.roundStart()
    if (phase === 'reveal' && prevPhaseRef.current === 'playing' && !isCorrect) sound.timeUp()
    prevPhaseRef.current = phase
  }, [phase, isCorrect])

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
    const { data } = await submitRoundAnswer(room.id, round.id, { tapped_index: idx })
    if (!data) return
    if (data.is_correct) {
      setIsCorrect(true)
      setLockedIndex(idx)
      setLastPoints(data.points_awarded)
      setRoundPoints(data.points_awarded)
      sound.correct()
      if (navigator.vibrate) navigator.vibrate(30)
    } else {
      setWrongIndex(idx)
      setRoundPoints(data.points_awarded)
      setLockedOut(true)
      sound.wrong()
      if (navigator.vibrate) navigator.vibrate([20, 30, 20])
      setTimeout(() => { setLockedOut(false); setWrongIndex(null) }, LOCKOUT_MS)
    }
  }, [room, round, phase, isCorrect, lockedOut])

  // Same fix as EmojiDecodeScreen: await the RPC, surface any error instead
  // of swallowing it, and force an immediate refresh() so this device's own
  // tap reflects instantly instead of depending solely on realtime (which
  // was silently never firing before migration 20260718090000).
  const handleReady = useCallback(async (ready: boolean) => {
    if (!room) return
    setReadyBusy(true)
    setReadyError(null)
    diagLog('match-room-ready', 'tap', { roomId: room.id, ready })
    const result = await setRoomReady(room.id, ready)
    setReadyBusy(false)
    if (!result) {
      const msg = isAr ? 'تعذر تحديث حالة الاستعداد. حاول مرة أخرى.' : 'Could not update ready status. Please try again.'
      setReadyError(msg)
      diagLog('match-room-ready', 'FAILED (see match-room scope for RPC error)', { roomId: room.id, ready })
      return
    }
    diagLog('match-room-ready', 'ok, forcing refresh', { roomId: room.id, ready, result })
    await refresh()
  }, [room, isAr, refresh])

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

  if (!roomId) {
    return <MatchModeSelect gameId={GAME_ID} nameEn={nameEn} nameAr={nameAr} accentColor={accent} lang={lang} onBack={() => onNavigate('games')} onRoomReady={setRoomId} />
  }

  if (!room) {
    return (
      <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="live-dot" style={{ background: accent }} />
      </div>
    )
  }

  if (phase === 'lobby') {
    return (
      <MatchLobby
        room={room} players={players} myUserId={myUserId} lang={lang} accentColor={accent} nameEn={nameEn} nameAr={nameAr}
        onReady={handleReady}
        busy={readyBusy}
        error={readyError}
        onLeave={handleLeave}
      />
    )
  }

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

  if (phase === 'get_ready' || !round) {
    return (
      <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <GameHeader accent={accent} isAr={isAr} nameEn={nameEn} nameAr={nameAr} round={room.current_round} totalRounds={room.round_count} score={liveScore} onExit={handleLeave} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <div className="animate-get-ready" style={{ width: 64, height: 64, borderRadius: '50%', background: `${accent}22`, border: `2px solid ${accent}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26 }}>🎨</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(var(--fg-rgb),0.5)', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
            {isAr ? 'استعد…' : 'Get Ready…'}
          </div>
        </div>
      </div>
    )
  }

  const payload = round.payload as unknown as ColorPayload
  const timerColor = roundTimePct > 0.5 ? '#10b981' : roundTimePct > 0.25 ? '#f59e0b' : '#ef4444'
  const targetIndex = (reveal?.[0]?.correct_answer as { target_index?: number } | undefined)?.target_index

  if (phase === 'reveal') {
    const myReveal = reveal?.find((r) => r.user_id === myUserId)
    return (
      <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
        <GameHeader accent={accent} isAr={isAr} nameEn={nameEn} nameAr={nameAr} round={room.current_round} totalRounds={room.round_count} score={liveScore} onExit={handleLeave} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 24px', gap: 16 }}>
          <div className="animate-pop" style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 44, marginBottom: 6 }}>{isCorrect ? '🎯' : '⏱️'}</div>
            <div style={{ fontSize: 22, fontWeight: 900, color: isCorrect ? '#10b981' : (myReveal?.points_awarded ?? 0) < 0 ? '#ef4444' : 'var(--foreground)', fontFamily: "'Exo 2', sans-serif" }}>
              {isCorrect ? (isAr ? `أصبت! +${lastPoints}` : `Nailed it! +${lastPoints}`) : (isAr ? 'الوقت انتهى' : "Time's Up")}
            </div>
          </div>

          {typeof targetIndex === 'number' && payload && (
            <MiniGrid gridSize={payload.grid_size} tiles={payload.tiles} targetIndex={targetIndex} />
          )}

          {players.length > 1 && reveal && (
            <div className="card animate-slide-up" style={{ width: '100%', maxWidth: 340, padding: '10px 12px' }}>
              {reveal.slice().sort((a, b) => b.points_awarded - a.points_awarded).map((r) => {
                const p = players.find((pl) => pl.user_id === r.user_id)
                return (
                  <div key={r.user_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 4px' }}>
                    <span className="truncate" style={{ flex: 1, fontSize: 11.5, color: 'var(--foreground)' }}>@{p?.profile?.username ?? '…'}</span>
                    <span style={{ fontSize: 11.5, color: r.points_awarded > 0 ? '#10b981' : r.points_awarded < 0 ? '#ef4444' : 'rgba(var(--fg-rgb),0.35)' }}>
                      {r.points_awarded > 0 ? '+' : ''}{r.points_awarded}
                    </span>
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

      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '16px 20px', gap: 16 }}>
        <div style={{ fontSize: 12.5, color: 'rgba(var(--fg-rgb),0.5)', fontWeight: 600 }}>
          {isAr ? 'انقر على البلاطة المختلفة' : 'Tap the tile that stands out'}
        </div>
        <div
          key={round.id}
          style={{
            display: 'grid', gridTemplateColumns: `repeat(${payload.grid_size}, 1fr)`, gap: 8,
            width: '100%', maxWidth: 340, aspectRatio: '1',
          }}
        >
          {payload.tiles.map((hue, idx) => {
            const isWrongTap = wrongIndex === idx
            const isLocked = lockedIndex === idx
            return (
              <button
                key={idx}
                disabled={isCorrect || lockedOut || phase !== 'playing'}
                onClick={() => handleTap(idx)}
                className={isLocked ? 'animate-correct-pop' : isWrongTap ? 'animate-wrong-shake' : 'animate-tile-reveal'}
                style={{
                  borderRadius: 12,
                  background: `hsl(${hue}, 70%, 55%)`,
                  border: isLocked ? '3px solid #10b981' : isWrongTap ? '3px solid #ef4444' : '2px solid rgba(var(--fg-rgb),0.12)',
                  boxShadow: isLocked ? '0 0 16px rgba(16,185,129,0.6)' : 'none',
                  cursor: isCorrect || lockedOut ? 'default' : 'pointer',
                  transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
                }}
              />
            )
          })}
        </div>

        {lockedOut && (
          <div className="animate-slide-up" style={{ fontSize: 12, color: '#ef4444', fontWeight: 600 }}>
            {isAr ? 'خطأ! -150 نقطة' : 'Wrong! -150 pts'}
          </div>
        )}
        {isCorrect && (
          <div className="animate-slide-up" style={{ fontSize: 12, color: '#10b981', fontWeight: 600 }}>
            {isAr ? 'ممتاز! بانتظار انتهاء الجولة…' : 'Great! Waiting for the round to end…'}
          </div>
        )}
      </div>
    </div>
  )
}

/** Small static replay of the round's grid in the reveal screen, highlighting the correct tile. */
function MiniGrid({ gridSize, tiles, targetIndex }: { gridSize: number; tiles: number[]; targetIndex: number }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${gridSize}, 1fr)`, gap: 5, width: '100%', maxWidth: 200, aspectRatio: '1' }}>
      {tiles.map((hue, idx) => (
        <div
          key={idx}
          style={{
            borderRadius: 6, background: `hsl(${hue}, 70%, 55%)`,
            border: idx === targetIndex ? '2px solid #ffd700' : '1px solid rgba(var(--fg-rgb),0.1)',
            boxShadow: idx === targetIndex ? '0 0 10px rgba(255,215,0,0.7)' : 'none',
          }}
        />
      ))}
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
