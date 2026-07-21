import { useEffect, useMemo, useRef, useState } from 'react'
import type { Screen, Lang } from '../App'
import { useAuth } from '../lib/auth'
import { primeSound } from '../lib/sound'
import { useLocalBoardGame } from '../lib/boardgames/localController'
import { useOnlineBoardGame } from '../lib/boardgames/onlineController'
import { useBoardGameLobby } from '../lib/boardgames/lobbyController'
import type { BoardGameSeat, AIDifficulty, BoardGameResult, BoardGameEvent } from '../lib/boardgames/types'
import { LudoEngine, LUDO_FINISHED, LUDO_START_OFFSETS, isSafeGlobalCell, type LudoState, type LudoMove } from '../lib/boardgames/ludo/engine'
import { createLudoAI } from '../lib/boardgames/ludo/ai'
import { ludoSound } from '../lib/boardgames/ludo/sound'
import {
  BOARD_VIEWBOX, CELL, CENTER, SEAT_COLORS, SEAT_COLORS_DARK, SEAT_LABELS_EN, SEAT_LABELS_AR,
  piecePixelPosition, yardRect, pathCells, homeStretchCells, centerTriangles,
} from '../lib/boardgames/ludo/geometry'
import {
  createBoardGameRoom, joinBoardGameRoomByCode, quickMatchBoardGame, joinBoardGameSpectator,
  leaveBoardGameSpectator, leaveBoardGameRoom, getSpectatableBoardGameRooms, type BoardGameRoom,
  getMyBoardGameHistory, getBoardGameMatchDetail, type BoardGameHistoryEntry, type BoardGameMatchDetail,
  submitLudoMove, finalizeLudoMatch, checkLudoTimeout, getActiveLudoMatch, forfeitLudoMatch, type ActiveLudoMatch,
} from '../lib/api'
import MatchChat from '../components/boardgames/MatchChat'

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
}

type SeatConfig = { kind: 'human' | 'ai'; difficulty: AIDifficulty }
type Phase = 'setup' | 'play' | 'online-menu' | 'online-lobby' | 'online-play' | 'online-spectate' | 'history' | 'replay'

/**
 * Ludo — Phase A (local pass-and-play + AI) and Phase B (online rooms:
 * matchmaking, private invite codes, spectating, reconnect). Built entirely
 * on the generic board-game framework in src/lib/boardgames/: this screen
 * only supplies setup/lobby UI, board rendering, and input handling. Turn
 * order, AI moves, auto-passing, win detection, realtime sync, presence,
 * and turn timers all come from useLocalBoardGame / useOnlineBoardGame /
 * useBoardGameLobby + LudoEngine — exactly the pattern a future
 * UNO/Chess/Checkers/Connect 4/Backgammon screen would follow.
 *
 * Everything visual/audible, on the other hand, is Ludo's OWN identity,
 * deliberately not reused from the quiz games or from any other board
 * game: its own dice rattle/slide/capture/victory sounds
 * (lib/boardgames/ludo/sound.ts), its own amber-and-jewel board felt
 * backdrop, its own lobby artwork, its own 3D-tumbling die, its own
 * confetti victory sequence. The rule going forward is: shared plumbing,
 * distinct game skin — every future board game gets its own version of
 * this file's "identity" half, never a copy of Ludo's.
 */
export default function LudoScreen({ onNavigate, lang }: Props) {
  const { profile } = useAuth()
  const isAr = lang === 'ar'
  const labels = isAr ? SEAT_LABELS_AR : SEAT_LABELS_EN
  const myName = profile?.username ?? (isAr ? 'أنت' : 'You')
  const userId = profile?.id ?? ''

  const [phase, setPhase] = useState<Phase>('setup')
  const [numPlayers, setNumPlayers] = useState(4)
  const [seatConfigs, setSeatConfigs] = useState<SeatConfig[]>([
    { kind: 'human', difficulty: 'medium' },
    { kind: 'ai', difficulty: 'medium' },
    { kind: 'ai', difficulty: 'medium' },
    { kind: 'ai', difficulty: 'medium' },
  ])
  const [onlineRoomId, setOnlineRoomId] = useState<string | null>(null)
  const [spectateRoomId, setSpectateRoomId] = useState<string | null>(null)
  const [replayRoomId, setReplayRoomId] = useState<string | null>(null)

  // Resume-active-match: checked whenever the player lands on a screen where
  // starting something NEW would be a mistake if they already have a match
  // in flight (setup, online-menu, online-lobby). get_active_ludo_match also
  // resolves any timeout that expired while nobody was looking, so this can
  // legitimately come back null even for a match that *was* active a moment
  // ago (elimination) or come back with a lower turn_deadline than expected.
  const [activeMatch, setActiveMatch] = useState<ActiveLudoMatch | null>(null)
  useEffect(() => {
    if (!userId) return
    if (phase !== 'setup' && phase !== 'online-menu' && phase !== 'online-lobby') return
    let cancelled = false
    getActiveLudoMatch().then((m) => { if (!cancelled) setActiveMatch(m) })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, phase])

  const resumeActiveMatch = () => {
    if (!activeMatch) return
    primeSound()
    setOnlineRoomId(activeMatch.room_id)
    setPhase('online-play')
  }

  const seats: BoardGameSeat[] = useMemo(() => {
    return Array.from({ length: numPlayers }, (_, i) => {
      const cfg = seatConfigs[i]
      return {
        seatIndex: i,
        userId: i === 0 ? (profile?.id ?? 'you') : null,
        displayName: i === 0 ? myName : cfg.kind === 'ai' ? `${isAr ? 'ذكاء اصطناعي' : 'AI'} (${labels[i]})` : `${isAr ? 'لاعب' : 'Player'} ${i + 1}`,
        isAI: cfg.kind === 'ai',
        aiDifficulty: cfg.difficulty,
        token: String(i),
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const ais = useMemo(() => {
    const map: Record<number, ReturnType<typeof createLudoAI>> = {}
    seats.forEach((s) => { if (s.isAI) map[s.seatIndex] = createLudoAI(s.aiDifficulty ?? 'medium') })
    return map
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  const backLabel = phase === 'play' || phase === 'online-menu' ? (isAr ? 'محلي وضد الذكاء الاصطناعي' : 'Local pass-and-play & vs AI')
    : phase === 'online-lobby' ? (isAr ? 'غرفة الانتظار' : 'Waiting room')
    : phase === 'online-play' ? (isAr ? 'مباراة مباشرة' : 'Live match')
    : phase === 'online-spectate' ? (isAr ? 'مشاهدة' : 'Spectating')
    : phase === 'history' ? (isAr ? 'سجل المباريات' : 'Match History')
    : phase === 'replay' ? (isAr ? 'إعادة المباراة' : 'Match Replay')
    : (isAr ? 'محلي وضد الذكاء الاصطناعي' : 'Local pass-and-play & vs AI')

  const goBack = () => {
    if (phase === 'play' || phase === 'online-menu' || phase === 'history') { setPhase('setup'); return }
    if (phase === 'online-lobby') {
      if (onlineRoomId) leaveBoardGameRoom(onlineRoomId).catch(() => {})
      setOnlineRoomId(null); setPhase('online-menu'); return
    }
    if (phase === 'online-play') {
      // Not a real "leave" — see the OnlineLudoMatch onExit comment below.
      // The room/seat must survive so Resume Match can find it again.
      setOnlineRoomId(null); setPhase('online-menu'); return
    }
    if (phase === 'online-spectate') {
      if (spectateRoomId) leaveBoardGameSpectator(spectateRoomId).catch(() => {})
      setSpectateRoomId(null); setPhase('online-menu'); return
    }
    if (phase === 'replay') { setReplayRoomId(null); setPhase('history'); return }
    onNavigate('games')
  }

  return (
    <div style={{
      minHeight: '100dvh', paddingBottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
      background: 'radial-gradient(ellipse 120% 60% at 50% -10%, rgba(124,58,237,0.16), transparent 55%), var(--background)',
    }}>
      {/* iOS Safari/WKWebView draws the status bar/notch over anything at the
          very top of the viewport unless it's pushed down — env(safe-area-inset-top)
          is 0 on non-notched devices/browsers, so max(18px, ...) is a no-op
          there and only kicks in where it's actually needed. Matches the
          same pattern already used by TopBar.tsx. */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '18px 16px 10px', paddingTop: 'max(18px, env(safe-area-inset-top, 0px))',
      }}>
        {/* 44x44 is the platform-standard minimum comfortable tap target
            (Apple HIG / Material both specify it) — the icon stays visually
            small, but the actual clickable button area is padded out to
            meet it so the back button is reliably tappable next to the
            status bar/notch instead of needing pixel-precision. */}
        <button
          onClick={goBack}
          aria-label={isAr ? 'رجوع' : 'Back'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 44, height: 44, margin: '-12px 0', flexShrink: 0,
          }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points={isAr ? '9,18 15,12 9,6' : '15,18 9,12 15,6'} />
          </svg>
        </button>
        <div>
          <p style={{ margin: 0, fontFamily: "'Exo 2', sans-serif", fontSize: 18, fontWeight: 900, color: 'var(--foreground)' }}>
            {isAr ? 'لودو' : 'Ludo'}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.45)' }}>
            {backLabel}
          </p>
        </div>
        {phase === 'setup' && (
          <button
            onClick={() => onNavigate('ludopacing')}
            style={{
              marginInlineStart: 'auto', background: 'rgba(0,212,255,0.12)', border: '1px solid rgba(0,212,255,0.3)',
              borderRadius: 10, padding: '7px 12px', cursor: 'pointer', fontSize: 11, fontWeight: 800, color: '#67e8f9',
            }}
          >
            {isAr ? 'معاينة الإيقاع الجديد' : 'Preview new pacing'}
          </button>
        )}
      </div>

      {activeMatch && (phase === 'setup' || phase === 'online-menu' || phase === 'online-lobby') && (
        <div style={{ padding: '0 16px', maxWidth: 480, margin: '0 auto 14px' }}>
          <style>{`@keyframes ludoResumePulse { 0%,100% { box-shadow: 0 0 0 0 rgba(46,213,115,0.35); } 50% { box-shadow: 0 0 0 8px rgba(46,213,115,0); } }`}</style>
          <div style={{
            padding: '14px 16px', borderRadius: 16, border: '1.5px solid rgba(46,213,115,0.4)',
            background: 'linear-gradient(135deg, rgba(46,213,115,0.14), rgba(46,213,115,0.05))',
            display: 'flex', alignItems: 'center', gap: 12, animation: 'ludoResumePulse 2.2s ease-in-out infinite',
          }}>
            <span style={{ fontSize: 22 }}>🎲</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: 'var(--foreground)' }}>
                {isAr ? 'يوجد مباراة نشطة' : 'Active match found'}
              </p>
              <p style={{ margin: '2px 0 0', fontSize: 11.5, color: 'rgba(var(--fg2-rgb),0.55)' }}>
                {isAr ? 'لديك مباراة لودو لم تنته بعد' : 'You have an unfinished Ludo match'}
              </p>
            </div>
            <button
              onClick={resumeActiveMatch}
              style={{
                background: '#2ed573', border: 'none', borderRadius: 12, padding: '9px 16px',
                fontSize: 12.5, fontWeight: 800, color: '#06210f', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {isAr ? 'استئناف المباراة' : 'Resume Match'}
            </button>
          </div>
        </div>
      )}

      <style>{`@keyframes ludoPhaseFadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div key={phase} style={{ animation: 'ludoPhaseFadeIn 260ms ease-out' }}>
      {phase === 'setup' && (
        <LudoSetup
          isAr={isAr}
          numPlayers={numPlayers}
          setNumPlayers={setNumPlayers}
          seatConfigs={seatConfigs}
          setSeatConfigs={setSeatConfigs}
          labels={labels}
          onStart={() => { primeSound(); setPhase('play') }}
          onPlayOnline={() => { primeSound(); setPhase('online-menu') }}
          onOpenHistory={() => { primeSound(); setPhase('history') }}
        />
      )}

      {phase === 'play' && (
        <LudoMatch key={seats.map((s) => `${s.isAI}${s.aiDifficulty}`).join('|') + numPlayers} seats={seats} ais={ais} isAr={isAr} onExit={() => setPhase('setup')} />
      )}

      {phase === 'online-menu' && (
        <LudoOnlineMenu
          isAr={isAr}
          onEnterLobby={(roomId) => { primeSound(); setOnlineRoomId(roomId); setPhase('online-lobby') }}
          onSpectate={(roomId) => { primeSound(); setSpectateRoomId(roomId); setPhase('online-spectate') }}
        />
      )}

      {phase === 'online-lobby' && onlineRoomId && (
        <LudoOnlineLobby
          isAr={isAr}
          roomId={onlineRoomId}
          userId={userId}
          myName={myName}
          onMatchStart={() => setPhase('online-play')}
          onExit={() => { setOnlineRoomId(null); setPhase('online-menu') }}
        />
      )}

      {phase === 'online-play' && onlineRoomId && (
        <OnlineLudoMatch
          roomId={onlineRoomId}
          userId={userId}
          isAr={isAr}
          // Deliberately NOT calling leaveBoardGameRoom here — this is a
          // mid-match exit, not actually leaving the game. The room/seat
          // must survive so get_active_ludo_match can find it again and
          // offer Resume Match. Only the pre-start lobby (above) and the
          // spectator flow (below) treat "exit" as "leave" for real.
          onExit={() => { setOnlineRoomId(null); setPhase('online-menu') }}
        />
      )}

      {phase === 'online-spectate' && spectateRoomId && (
        <LudoSpectateMatch
          roomId={spectateRoomId}
          userId={userId}
          isAr={isAr}
          onExit={() => { leaveBoardGameSpectator(spectateRoomId).catch(() => {}); setSpectateRoomId(null); setPhase('online-menu') }}
        />
      )}

      {phase === 'history' && (
        <LudoHistoryScreen
          isAr={isAr}
          userId={userId}
          onWatchReplay={(roomId) => { primeSound(); setReplayRoomId(roomId); setPhase('replay') }}
        />
      )}

      {phase === 'replay' && replayRoomId && (
        <LudoReplayScreen
          isAr={isAr}
          roomId={replayRoomId}
          onExit={() => { setReplayRoomId(null); setPhase('history') }}
        />
      )}
      </div>
    </div>
  )
}

// ── Lobby artwork — Ludo's own hero illustration, not shared with any other game ──

function LudoHeroArt() {
  return (
    <svg viewBox="0 0 300 130" width="100%" style={{ maxWidth: 320, display: 'block', margin: '0 auto' }}>
      <defs>
        <radialGradient id="ludoHeroGlow" cx="50%" cy="45%"><stop offset="0%" stopColor="#7c3aed40" /><stop offset="100%" stopColor="#7c3aed00" /></radialGradient>
      </defs>
      <ellipse cx="150" cy="65" rx="140" ry="60" fill="url(#ludoHeroGlow)" />
      {/* Four colored pawns fanned out */}
      {SEAT_COLORS.map((c, i) => {
        const angle = -30 + i * 20
        const x = 150 + Math.sin((angle * Math.PI) / 180) * 46
        const y = 92 - Math.cos((angle * Math.PI) / 180) * 10
        return (
          <g key={c} transform={`translate(${x},${y}) rotate(${angle})`}>
            <ellipse cx="0" cy="20" rx="13" ry="4" fill="#000" opacity="0.18" />
            <path d="M -9 18 Q -9 -2 0 -6 Q 9 -2 9 18 Z" fill={c} stroke="#fff" strokeWidth="1.5" />
            <circle cx="0" cy="-10" r="7" fill={c} stroke="#fff" strokeWidth="1.5" />
          </g>
        )
      })}
      {/* Tumbling die */}
      <g transform="translate(150,32) rotate(-8)">
        <rect x="-20" y="-20" width="40" height="40" rx="9" fill="#16162c" stroke="#7c3aed" strokeWidth="2" />
        {[[-9, -9], [9, -9], [-9, 0], [9, 0], [-9, 9], [9, 9]].map(([cx, cy], i) => (
          <circle key={i} cx={cx} cy={cy} r="3.4" fill="#9d6fff" />
        ))}
      </g>
    </svg>
  )
}

// ── Setup ─────────────────────────────────────────────────────────────────

function LudoSetup({
  isAr, numPlayers, setNumPlayers, seatConfigs, setSeatConfigs, labels, onStart, onPlayOnline, onOpenHistory,
}: {
  isAr: boolean
  numPlayers: number
  setNumPlayers: (n: number) => void
  seatConfigs: SeatConfig[]
  setSeatConfigs: (fn: (prev: SeatConfig[]) => SeatConfig[]) => void
  labels: string[]
  onStart: () => void
  onPlayOnline: () => void
  onOpenHistory: () => void
}) {
  return (
    <div style={{ padding: '8px 16px', maxWidth: 480, margin: '0 auto' }}>
      <LudoHeroArt />

      <button
        onClick={onOpenHistory}
        style={{
          width: '100%', marginTop: 8, marginBottom: 10, padding: '11px 16px', borderRadius: 14, border: '1px solid rgba(var(--fg-rgb),0.1)',
          background: 'rgba(var(--fg-rgb),0.03)', color: 'var(--foreground)',
          fontWeight: 700, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 15 }}>📜</span>
          {isAr ? 'سجل المباريات' : 'Match History'}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)' }}>{isAr ? 'إحصائيات · إعادة ←' : 'Stats · Replays →'}</span>
      </button>

      <button
        onClick={onPlayOnline}
        style={{
          width: '100%', marginTop: 8, marginBottom: 18, padding: '14px 16px', borderRadius: 16, border: '1.5px solid rgba(124,58,237,0.4)',
          background: 'linear-gradient(135deg, rgba(124,58,237,0.16), rgba(157,111,255,0.08))', color: 'var(--foreground)',
          fontWeight: 800, fontSize: 14, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 18 }}>🌐</span>
          {isAr ? 'العب أونلاين' : 'Play Online'}
        </span>
        <span style={{ fontSize: 11, fontWeight: 700, color: '#9d6fff' }}>
          {isAr ? 'مباراة سريعة · غرف خاصة · مشاهدة ←' : 'Quick match · Private rooms · Spectate →'}
        </span>
      </button>

      <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '10px 2px' }}>
        {isAr ? 'عدد اللاعبين' : 'Number of Players'}
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 18 }}>
        {[2, 3, 4].map((n) => (
          <button
            key={n}
            onClick={() => setNumPlayers(n)}
            style={{
              flex: 1, padding: '12px 0', borderRadius: 14, border: n === numPlayers ? '1.5px solid #7c3aed' : '1px solid rgba(var(--fg-rgb),0.1)',
              background: n === numPlayers ? 'rgba(124,58,237,0.12)' : 'rgba(var(--fg-rgb),0.03)', color: n === numPlayers ? '#7c3aed' : 'var(--foreground)',
              fontWeight: 800, fontSize: 16, cursor: 'pointer',
            }}
          >
            {n}
          </button>
        ))}
      </div>

      <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '10px 2px' }}>
        {isAr ? 'المقاعد' : 'Seats'}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {Array.from({ length: numPlayers }, (_, i) => i).map((i) => (
          <div key={i} className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${SEAT_COLORS[i]}30` }}>
            <div style={{ width: 12, height: 12, borderRadius: 4, background: SEAT_COLORS[i], flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
                {i === 0 ? (isAr ? 'أنت' : 'You') : `${isAr ? 'مقعد' : 'Seat'} ${i + 1}`} <span style={{ color: 'rgba(var(--fg2-rgb),0.4)', fontWeight: 500 }}>· {labels[i]}</span>
              </p>
            </div>
            {i === 0 ? (
              <span style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)' }}>{isAr ? 'دائمًا أنت' : 'Always you'}</span>
            ) : (
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => setSeatConfigs((prev) => prev.map((c, idx) => (idx === i ? { ...c, kind: 'human' } : c)))}
                  style={{
                    padding: '6px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                    background: seatConfigs[i].kind === 'human' ? '#7c3aed' : 'rgba(var(--fg-rgb),0.06)', color: seatConfigs[i].kind === 'human' ? '#fff' : 'rgba(var(--fg2-rgb),0.55)',
                  }}
                >
                  {isAr ? 'لاعب محلي' : 'Local'}
                </button>
                {(['easy', 'medium', 'hard'] as AIDifficulty[]).map((d) => (
                  <button
                    key={d}
                    onClick={() => setSeatConfigs((prev) => prev.map((c, idx) => (idx === i ? { kind: 'ai', difficulty: d } : c)))}
                    style={{
                      padding: '6px 10px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 11, fontWeight: 700,
                      background: seatConfigs[i].kind === 'ai' && seatConfigs[i].difficulty === d ? '#00d4ff' : 'rgba(var(--fg-rgb),0.06)',
                      color: seatConfigs[i].kind === 'ai' && seatConfigs[i].difficulty === d ? '#04222b' : 'rgba(var(--fg2-rgb),0.55)',
                    }}
                  >
                    {d === 'easy' ? (isAr ? 'سهل' : 'Easy') : d === 'medium' ? (isAr ? 'متوسط' : 'Medium') : (isAr ? 'صعب' : 'Hard')}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      <button
        onClick={onStart}
        style={{ width: '100%', marginTop: 22, padding: '15px 0', borderRadius: 16, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#9d6fff)', color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 6px 18px rgba(124,58,237,0.35)' }}
      >
        {isAr ? 'ابدأ اللعبة' : 'Start Game'}
      </button>

      <p style={{ marginTop: 14, fontSize: 11, lineHeight: 1.6, color: 'rgba(var(--fg2-rgb),0.4)', textAlign: 'center', padding: '0 8px' }}>
        {isAr
          ? 'يلعب اللاعبون المحليون بالتناوب على نفس الجهاز.'
          : 'Local players take turns on this device.'}
      </p>
    </div>
  )
}

// ── Online menu — matchmaking, private invite codes, spectate ──────────────

type OnlineTab = 'quick' | 'private' | 'join' | 'watch'

function LudoOnlineMenu({ isAr, onEnterLobby, onSpectate }: {
  isAr: boolean
  onEnterLobby: (roomId: string) => void
  onSpectate: (roomId: string) => void
}) {
  const [tab, setTab] = useState<OnlineTab>('quick')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [maxPlayers, setMaxPlayers] = useState(4)
  const [allowSpectators, setAllowSpectators] = useState(true)
  const [joinCode, setJoinCode] = useState('')
  const [watchRooms, setWatchRooms] = useState<BoardGameRoom[]>([])
  const [watchLoading, setWatchLoading] = useState(false)

  useEffect(() => {
    if (tab !== 'watch') return
    let cancelled = false
    setWatchLoading(true)
    getSpectatableBoardGameRooms('ludo').then((rooms) => {
      if (!cancelled) { setWatchRooms(rooms); setWatchLoading(false) }
    })
    return () => { cancelled = true }
  }, [tab])

  const tabs: { key: OnlineTab; label: string }[] = [
    { key: 'quick', label: isAr ? 'مباراة سريعة' : 'Quick Match' },
    { key: 'private', label: isAr ? 'غرفة خاصة' : 'Private Room' },
    { key: 'join', label: isAr ? 'انضمام برمز' : 'Join by Code' },
    { key: 'watch', label: isAr ? 'مشاهدة' : 'Watch' },
  ]

  const handleQuickMatch = async () => {
    setBusy(true); setError(null)
    const { error: err, roomId } = await quickMatchBoardGame('ludo', maxPlayers)
    setBusy(false)
    if (err || !roomId) { setError(err ?? (isAr ? 'تعذر إيجاد مباراة' : 'Could not find a match')); return }
    onEnterLobby(roomId)
  }

  const handleCreatePrivate = async () => {
    setBusy(true); setError(null)
    const room = await createBoardGameRoom('ludo', maxPlayers, allowSpectators, true)
    setBusy(false)
    if (!room) { setError(isAr ? 'تعذر إنشاء الغرفة' : 'Could not create the room'); return }
    onEnterLobby(room.id)
  }

  const handleJoinCode = async () => {
    if (!joinCode.trim()) return
    setBusy(true); setError(null)
    const { error: err, player } = await joinBoardGameRoomByCode(joinCode.trim())
    setBusy(false)
    if (err || !player) { setError(err ?? (isAr ? 'رمز غير صالح' : 'Invalid or expired code')); return }
    onEnterLobby(player.room_id)
  }

  const handleWatch = async (roomId: string) => {
    setBusy(true); setError(null)
    const { error: err } = await joinBoardGameSpectator(roomId)
    setBusy(false)
    if (err) { setError(err); return }
    onSpectate(roomId)
  }

  return (
    <div style={{ padding: '8px 16px', maxWidth: 480, margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: 6, marginBottom: 18, overflowX: 'auto' }}>
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setError(null) }}
            style={{
              flex: '1 0 auto', padding: '10px 12px', borderRadius: 12, border: tab === t.key ? '1.5px solid #7c3aed' : '1px solid rgba(var(--fg-rgb),0.1)',
              background: tab === t.key ? 'rgba(124,58,237,0.12)' : 'rgba(var(--fg-rgb),0.03)', color: tab === t.key ? '#7c3aed' : 'var(--foreground)',
              fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(255,71,87,0.12)', border: '1px solid rgba(255,71,87,0.3)', color: '#ff4757', fontSize: 12.5, fontWeight: 600, marginBottom: 14 }}>
          {error}
        </div>
      )}

      {(tab === 'quick' || tab === 'private') && (
        <div style={{ marginBottom: 18 }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '10px 2px' }}>
            {isAr ? 'الحد الأقصى للاعبين' : 'Max Players'}
          </p>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            {[2, 3, 4].map((n) => (
              <button
                key={n}
                onClick={() => setMaxPlayers(n)}
                style={{
                  flex: 1, padding: '11px 0', borderRadius: 12, border: n === maxPlayers ? '1.5px solid #7c3aed' : '1px solid rgba(var(--fg-rgb),0.1)',
                  background: n === maxPlayers ? 'rgba(124,58,237,0.12)' : 'rgba(var(--fg-rgb),0.03)', color: n === maxPlayers ? '#7c3aed' : 'var(--foreground)',
                  fontWeight: 800, fontSize: 15, cursor: 'pointer',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>
      )}

      {tab === 'quick' && (
        <>
          <p style={{ fontSize: 12.5, lineHeight: 1.6, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 16 }}>
            {isAr ? 'سننضم إلى غرفة عامة مفتوحة، أو ننشئ واحدة جديدة إذا لم توجد.' : "We'll drop you into an open public room, or start a fresh one if none has space."}
          </p>
          <button onClick={handleQuickMatch} disabled={busy} style={onlinePrimaryBtnStyle}>
            {busy ? (isAr ? 'جارٍ البحث...' : 'Finding a match…') : (isAr ? 'مباراة سريعة' : 'Quick Match')}
          </button>
        </>
      )}

      {tab === 'private' && (
        <>
          <button
            onClick={() => setAllowSpectators((v) => !v)}
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', padding: '12px 14px', borderRadius: 12, border: '1px solid rgba(var(--fg-rgb),0.1)', background: 'rgba(var(--fg-rgb),0.03)', marginBottom: 16, cursor: 'pointer' }}
          >
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>{isAr ? 'السماح للمشاهدين' : 'Allow spectators'}</span>
            <span style={{ width: 38, height: 22, borderRadius: 11, background: allowSpectators ? '#7c3aed' : 'rgba(var(--fg-rgb),0.15)', position: 'relative', transition: 'background 150ms' }}>
              <span style={{ position: 'absolute', top: 2, insetInlineStart: allowSpectators ? 18 : 2, width: 18, height: 18, borderRadius: 9, background: '#fff', transition: 'inset-inline-start 150ms' }} />
            </span>
          </button>
          <button onClick={handleCreatePrivate} disabled={busy} style={onlinePrimaryBtnStyle}>
            {busy ? (isAr ? 'جارٍ الإنشاء...' : 'Creating…') : (isAr ? 'إنشاء غرفة خاصة' : 'Create Private Room')}
          </button>
        </>
      )}

      {tab === 'join' && (
        <>
          <input
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder={isAr ? 'أدخل رمز الدعوة' : 'Enter invite code'}
            maxLength={8}
            style={{ width: '100%', padding: '14px 16px', borderRadius: 14, border: '1px solid rgba(var(--fg-rgb),0.15)', background: 'rgba(var(--fg-rgb),0.03)', color: 'var(--foreground)', fontSize: 18, fontWeight: 800, letterSpacing: '0.15em', textAlign: 'center', marginBottom: 14, textTransform: 'uppercase' }}
          />
          <button onClick={handleJoinCode} disabled={busy || !joinCode.trim()} style={onlinePrimaryBtnStyle}>
            {busy ? (isAr ? 'جارٍ الانضمام...' : 'Joining…') : (isAr ? 'انضم' : 'Join Room')}
          </button>
        </>
      )}

      {tab === 'watch' && (
        <div>
          {watchLoading ? (
            <p style={{ textAlign: 'center', fontSize: 12.5, color: 'rgba(var(--fg2-rgb),0.5)', padding: '20px 0' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>
          ) : watchRooms.length === 0 ? (
            <p style={{ textAlign: 'center', fontSize: 12.5, color: 'rgba(var(--fg2-rgb),0.5)', padding: '20px 0' }}>{isAr ? 'لا توجد مباريات مباشرة الآن' : 'No live matches right now'}</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {watchRooms.map((r) => (
                <div key={r.id} className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🎲</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>{isAr ? 'مباراة لودو مباشرة' : 'Live Ludo Match'}</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.45)' }}>{isAr ? `حتى ${r.max_players} لاعبين` : `Up to ${r.max_players} players`}</p>
                  </div>
                  <button onClick={() => handleWatch(r.id)} disabled={busy} style={{ padding: '8px 14px', borderRadius: 10, border: 'none', background: '#7c3aed', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>
                    {isAr ? 'شاهد' : 'Watch'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const onlinePrimaryBtnStyle: React.CSSProperties = {
  width: '100%', padding: '15px 0', borderRadius: 16, border: 'none', background: 'linear-gradient(135deg,#7c3aed,#9d6fff)',
  color: '#fff', fontWeight: 800, fontSize: 15, cursor: 'pointer', boxShadow: '0 6px 18px rgba(124,58,237,0.35)',
}

// ── Online lobby — ready-up, invite code, host-gated start ─────────────────

function LudoOnlineLobby({ isAr, roomId, userId, myName, onMatchStart, onExit }: {
  isAr: boolean
  roomId: string
  userId: string
  myName: string
  onMatchStart: () => void
  onExit: () => void
}) {
  const { loading, room, players, spectatorCount, myPlayer, isHost, canStart, setReady, startMatch, claimColor, leave } = useBoardGameLobby(roomId, userId)
  const [starting, setStarting] = useState(false)
  const [copied, setCopied] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const [readyBusy, setReadyBusy] = useState(false)
  const [readyError, setReadyError] = useState<string | null>(null)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [colorBusy, setColorBusy] = useState<number | null>(null)
  const [colorError, setColorError] = useState<string | null>(null)

  // The instant the room flips to 'active' (any client can be the one to
  // detect it, not just the host — everyone's realtime subscription sees the
  // same update), run a synchronized 3-2-1-GO beat before actually handing
  // off to the match screen, instead of just snapping straight into it.
  useEffect(() => {
    if (room?.status === 'active' && countdown === null) setCountdown(3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room?.status])

  useEffect(() => {
    if (countdown === null) return
    if (countdown === 0) {
      ludoSound.matchStart()
      const t = setTimeout(() => onMatchStart(), 320)
      return () => clearTimeout(t)
    }
    ludoSound.countdownTick()
    // Shortened from 700ms/tick (~2.6s total) to 420ms/tick (~1.6s total) —
    // still a readable synchronized beat across both clients, just far
    // less of a forced wait before the match everyone's already looking at
    // actually starts.
    const t = setTimeout(() => setCountdown((c) => (c ?? 1) - 1), 420)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown])

  // canStart is a client-side UX nicety only — start_board_game_room enforces
  // the real "everyone ready" gate server-side, so a stale/optimistic client
  // read (or a start attempt right as someone un-readies) can still be
  // rejected. Surface that instead of failing silently.
  const handleStart = async () => {
    setStarting(true)
    setStartError(null)
    const { error } = await startMatch()
    setStarting(false)
    if (error) setStartError(error)
  }

  const handleToggleReady = async () => {
    const next = !myPlayer?.is_ready
    setReadyBusy(true)
    setReadyError(null)
    const { error } = await setReady(next)
    setReadyBusy(false)
    if (error) { setReadyError(error); return }
    ;(next ? ludoSound.ready : ludoSound.unready)()
  }

  const handleCopyCode = () => {
    if (!room?.join_code) return
    navigator.clipboard?.writeText(room.join_code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  // Instant, optimistic-feeling color pick: claim_ludo_color is atomic
  // server-side (a race with another player claiming the same color a
  // moment earlier comes back as a clean error, never a silent overwrite),
  // and useBoardGameLobby refetches immediately on return so this client's
  // own screen updates without waiting on the realtime echo. Re-clicking my
  // own already-selected color is a no-op (nothing to claim).
  const handlePickColor = async (color: number) => {
    if (myPlayer?.seat_index === color) return
    setColorBusy(color)
    setColorError(null)
    const { error } = await claimColor(color)
    setColorBusy(null)
    if (error) { setColorError(error); return }
    ludoSound.ready()
  }

  const colorOwners = new Map<number, typeof players[number]>()
  for (const p of players) if (p.seat_index !== null) colorOwners.set(p.seat_index, p)

  if (loading || !room) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'rgba(var(--fg2-rgb),0.5)', fontSize: 13 }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</div>
  }

  return (
    <div style={{ padding: '8px 16px', maxWidth: 480, margin: '0 auto' }}>
      {room.join_code && (
        <button onClick={handleCopyCode} className="card" style={{ width: '100%', padding: 16, textAlign: 'center', marginBottom: 16, border: '1px solid rgba(124,58,237,0.3)', cursor: 'pointer' }}>
          <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.5)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {isAr ? 'رمز الدعوة' : 'Invite Code'}
          </p>
          <p style={{ margin: 0, fontSize: 28, fontWeight: 900, letterSpacing: '0.12em', color: '#7c3aed', fontFamily: "'Exo 2', sans-serif" }}>
            {room.join_code}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)' }}>
            {copied ? (isAr ? 'تم النسخ!' : 'Copied!') : (isAr ? 'اضغط للنسخ' : 'Tap to copy')}
          </p>
        </button>
      )}

      <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '10px 2px 8px' }}>
        {isAr ? 'اختر لونك' : 'Choose Your Color'}
      </p>
      {/* Colors can only be claimed once — the first player to tap a swatch
          reserves it immediately (no page reload, no confirm step) and it's
          disabled for everyone else the instant that lands. Changing your
          mind before the match starts releases your previous color right
          away (see claim_ludo_color). Once the host starts the match,
          room.status flips off 'waiting' and the server rejects any further
          claim, so this grid effectively locks itself — no separate
          "locked" flag needed client-side. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 10 }}>
        {SEAT_COLORS.map((hex, i) => {
          const owner = colorOwners.get(i)
          const mine = owner?.user_id === userId
          const takenByOther = !!owner && !mine
          const busy = colorBusy === i
          const label = isAr ? SEAT_LABELS_AR[i] : SEAT_LABELS_EN[i]
          const ownerName = owner ? (owner.user_id === userId ? myName : owner.profile?.username ?? label) : null
          return (
            <button
              key={i}
              onClick={() => handlePickColor(i)}
              disabled={takenByOther || busy || room.status !== 'waiting'}
              style={{
                position: 'relative', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '12px 4px 10px', borderRadius: 16, border: mine ? `2px solid ${hex}` : '2px solid transparent',
                background: mine ? `${hex}1c` : 'rgba(var(--fg-rgb),0.04)',
                cursor: takenByOther || room.status !== 'waiting' ? 'not-allowed' : 'pointer',
                opacity: takenByOther ? 0.45 : 1,
                transform: mine ? 'scale(1.04)' : 'scale(1)',
                transition: 'transform 200ms cubic-bezier(0.22,1,0.36,1), border-color 200ms, background 200ms, opacity 200ms',
                boxShadow: mine ? `0 4px 16px ${hex}40` : 'none',
              }}
            >
              <span style={{
                width: 30, height: 30, borderRadius: '50%', background: hex, flexShrink: 0,
                boxShadow: mine ? `0 0 0 3px ${hex}33` : 'none', transition: 'box-shadow 200ms',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {mine && <span style={{ color: '#fff', fontSize: 14, fontWeight: 900, lineHeight: 1 }}>✓</span>}
                {busy && !mine && <span style={{ width: 10, height: 10, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.6)', borderTopColor: '#fff', animation: 'ludoSpin 700ms linear infinite' }} />}
              </span>
              <span style={{ fontSize: 10.5, fontWeight: 800, color: mine ? hex : 'rgba(var(--fg2-rgb),0.55)' }}>{label}</span>
              <span style={{ fontSize: 9, fontWeight: 600, color: 'rgba(var(--fg2-rgb),0.4)', minHeight: 11, textAlign: 'center', lineHeight: 1.2 }}>
                {takenByOther ? ownerName : mine ? (isAr ? 'أنت' : 'You') : ''}
              </span>
            </button>
          )
        })}
      </div>
      <style>{`@keyframes ludoSpin { to { transform: rotate(360deg); } }`}</style>
      {colorError && (
        <div style={{ padding: '9px 14px', borderRadius: 12, background: 'rgba(255,71,87,0.12)', border: '1px solid rgba(255,71,87,0.3)', color: '#ff4757', fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
          {colorError}
        </div>
      )}

      <p style={{ fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '10px 2px' }}>
        {isAr ? `اللاعبون (${players.length}/${room.max_players})` : `Players (${players.length}/${room.max_players})`}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
        {players.map((p) => {
          const hasColor = p.seat_index !== null
          const color = hasColor ? SEAT_COLORS[p.seat_index as number] : 'rgba(var(--fg-rgb),0.2)'
          return (
            <div key={p.id} className="card" style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${hasColor ? `${color}30` : 'rgba(var(--fg-rgb),0.1)'}` }}>
              {hasColor
                ? <div style={{ width: 12, height: 12, borderRadius: 4, background: color, flexShrink: 0 }} />
                : <div style={{ width: 12, height: 12, borderRadius: '50%', border: '1.5px dashed rgba(var(--fg2-rgb),0.35)', flexShrink: 0 }} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
                  {p.user_id === userId ? myName : p.profile?.username ?? (isAr ? 'لاعب' : 'Player')}
                  {room.host_id === p.user_id && <span style={{ marginInlineStart: 6, fontSize: 10, color: '#f9ca24' }}>★ {isAr ? 'المضيف' : 'Host'}</span>}
                </p>
                {!hasColor && (
                  <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'rgba(var(--fg2-rgb),0.4)' }}>{isAr ? 'يختار لونًا...' : 'Choosing a color…'}</p>
                )}
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: p.is_ready ? '#2ed573' : 'rgba(var(--fg2-rgb),0.4)' }}>
                {p.is_ready ? (isAr ? 'جاهز' : 'Ready') : (isAr ? 'بالانتظار' : 'Waiting')}
              </span>
            </div>
          )
        })}
        {Array.from({ length: Math.max(0, room.max_players - players.length) }, (_, i) => (
          <div key={`empty-${i}`} style={{ padding: '12px 14px', borderRadius: 14, border: '1px dashed rgba(var(--fg-rgb),0.12)', color: 'rgba(var(--fg2-rgb),0.35)', fontSize: 12, fontWeight: 600, textAlign: 'center' }}>
            {isAr ? 'مقعد فارغ' : 'Open seat'}
          </div>
        ))}
      </div>

      {spectatorCount > 0 && (
        <p style={{ fontSize: 11.5, color: 'rgba(var(--fg2-rgb),0.45)', textAlign: 'center', marginBottom: 14 }}>
          👁 {spectatorCount} {isAr ? 'يشاهدون' : spectatorCount === 1 ? 'watching' : 'watching'}
        </p>
      )}

      <button
        onClick={handleToggleReady}
        disabled={readyBusy || !myPlayer}
        style={{ width: '100%', padding: '13px 0', borderRadius: 14, border: `1.5px solid ${myPlayer?.is_ready ? '#2ed573' : '#7c3aed'}`, background: myPlayer?.is_ready ? 'rgba(46,213,115,0.12)' : 'rgba(124,58,237,0.12)', color: myPlayer?.is_ready ? '#2ed573' : '#7c3aed', fontWeight: 800, fontSize: 14, cursor: readyBusy || !myPlayer ? 'not-allowed' : 'pointer', opacity: readyBusy || !myPlayer ? 0.6 : 1, marginBottom: 10, transition: 'background 200ms, border-color 200ms, color 200ms' }}
      >
        {readyBusy ? (isAr ? 'جارٍ التحديث...' : 'Updating…') : myPlayer?.is_ready ? (isAr ? '✓ جاهز' : '✓ Ready') : (isAr ? 'استعد' : 'Ready Up')}
      </button>

      {readyError && (
        <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(255,71,87,0.12)', border: '1px solid rgba(255,71,87,0.3)', color: '#ff4757', fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>
          {readyError}
        </div>
      )}

      {isHost && startError && (
        <div style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(255,71,87,0.12)', border: '1px solid rgba(255,71,87,0.3)', color: '#ff4757', fontSize: 12.5, fontWeight: 600, marginBottom: 10 }}>
          {startError}
        </div>
      )}

      {isHost && (
        <button
          onClick={handleStart}
          disabled={!canStart || starting}
          style={{ width: '100%', padding: '15px 0', borderRadius: 16, border: 'none', background: canStart ? 'linear-gradient(135deg,#7c3aed,#9d6fff)' : 'rgba(var(--fg-rgb),0.08)', color: canStart ? '#fff' : 'rgba(var(--fg2-rgb),0.35)', fontWeight: 800, fontSize: 15, cursor: canStart ? 'pointer' : 'not-allowed', marginBottom: 10 }}
        >
          {starting ? (isAr ? 'جارٍ البدء...' : 'Starting…') : (isAr ? 'ابدأ المباراة' : 'Start Match')}
        </button>
      )}
      {isHost && !canStart && (
        <p style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)', textAlign: 'center', marginBottom: 10 }}>
          {players.length < room.min_players
            ? (isAr ? `بحاجة إلى ${room.min_players} لاعبين على الأقل` : `Need at least ${room.min_players} players`)
            : players.some((p) => p.seat_index === null)
              ? (isAr ? 'بانتظار اختيار الجميع للألوان' : 'Waiting for everyone to choose a color')
              : (isAr ? 'بانتظار استعداد الجميع' : 'Waiting for everyone to be ready')}
        </p>
      )}
      {!isHost && (
        <p style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)', textAlign: 'center', marginBottom: 10 }}>
          {isAr ? 'بانتظار المضيف لبدء المباراة' : 'Waiting for the host to start the match'}
        </p>
      )}

      {/* Pre-match lobby only (room.status is still 'waiting' here) — leaving
          never counts as a loss or a win for anyone: leave_board_game_room
          only ever touches left_at/host reassignment while status='waiting',
          it never writes eliminated_at, final_rank, or any reward. Host and
          guest get distinct labels for clarity; the underlying action is the
          same safe pre-match leave either way. Once the match actually
          starts, this screen is gone — Forfeit Match (above) is the only
          "give up" action from then on. */}
      <button
        onClick={() => { leave(); onExit() }}
        style={{ width: '100%', padding: '11px 0', borderRadius: 14, border: '1px solid rgba(var(--fg-rgb),0.1)', background: 'transparent', color: 'rgba(var(--fg2-rgb),0.6)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
      >
        {isHost ? (isAr ? 'إلغاء الغرفة' : 'Cancel Room') : (isAr ? 'مغادرة الغرفة' : 'Leave Room')}
      </button>

      {countdown !== null && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,3,15,0.9)', zIndex: 9300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <style>{`@keyframes ludoCountdownPop { 0% { transform: scale(0.4); opacity: 0; } 55% { transform: scale(1.15); opacity: 1; } 100% { transform: scale(1); opacity: 1; } }`}</style>
          <span
            key={countdown}
            style={{
              fontSize: countdown === 0 ? 56 : 96, fontWeight: 900, fontFamily: "'Exo 2', sans-serif",
              color: countdown === 0 ? '#2ed573' : '#9d6fff', animation: 'ludoCountdownPop 550ms cubic-bezier(0.34,1.56,0.64,1)',
              textShadow: `0 0 40px ${countdown === 0 ? 'rgba(46,213,115,0.5)' : 'rgba(157,111,255,0.5)'}`,
            }}
          >
            {countdown === 0 ? (isAr ? 'ابدأ!' : 'GO!') : countdown}
          </span>
        </div>
      )}
    </div>
  )
}

// ── Match (local) ────────────────────────────────────────────────────────

function LudoMatch({ seats, ais, isAr, onExit }: { seats: BoardGameSeat[]; ais: Record<number, ReturnType<typeof createLudoAI>>; isAr: boolean; onExit: () => void }) {
  // Wrap the per-seat AI lookup in the single BoardGameAI the generic
  // controller expects — LudoEngine handles routing per-seat internally via
  // seatIndex, so one adapter object is enough regardless of how many AI
  // seats there are.
  const combinedAI = useMemo(() => ({
    difficulty: 'medium' as AIDifficulty,
    chooseMove: (state: Parameters<typeof LudoEngine.applyMove>[0], seatIndex: number, validMoves: LudoMove[]) => {
      const ai = ais[seatIndex]
      return ai ? ai.chooseMove(state, seatIndex, validMoves) : validMoves[0]
    },
  }), [ais])

  const { state, currentSeatIndex, currentSeat, validMoves, events, result, submitMove } = useLocalBoardGame({
    engine: LudoEngine, seats, ai: combinedAI, aiThinkDelayMs: 700,
  })

  const isMyTurn = !!currentSeat && !currentSeat.isAI

  return (
    <LudoBoard
      seats={seats}
      state={state}
      currentSeatIndex={currentSeatIndex}
      currentSeat={currentSeat}
      validMoves={validMoves}
      events={events}
      result={result}
      isMyTurn={isMyTurn}
      meSeatIndex={0}
      isAr={isAr}
      onMove={submitMove}
      onExit={onExit}
    />
  )
}

// ── Match (online) ──────────────────────────────────────────────────────────

function OnlineLudoMatch({ roomId, userId, isAr, onExit }: { roomId: string; userId: string; isAr: boolean; onExit: () => void }) {
  const {
    loading, room, seats, state, currentSeatIndex, currentSeat, mySeatIndex, isMyTurn,
    validMoves, events, result, spectatorCount, turnTimeLeftMs, submitMove, forfeit, actionError,
  } = useOnlineBoardGame({
    engine: LudoEngine, roomId, userId,
    // Ludo is server-authoritative: the client only ever sends an intent
    // ({"type":"roll"} / {"type":"move","pieceId":...} / {"type":"pass"});
    // the server rolls the die, validates the move, and computes the
    // resulting state. See ludo_submit_move / finalize_ludo_match.
    serverSubmitMove: submitLudoMove,
    serverFinalize: finalizeLudoMatch,
    // Server-side turn-timer watchdog — see checkLudoTimeout / onlineController's
    // serverCheckTimeout. Neither player's own device is relied on for this.
    serverCheckTimeout: checkLudoTimeout,
    // Real "give up now" action — server-authoritative, see forfeitLudoMatch.
    serverForfeit: forfeitLudoMatch,
  })

  const [toast, setToast] = useState<{ text: string; kind: 'in' | 'out' } | null>(null)
  const prevConnRef = useRef<Map<number, boolean>>(new Map())

  // Reconnect/disconnect toast — diff each seat's is_connected against what we
  // saw last render. Skipped on the very first render (nothing to compare
  // against yet) so joining a match doesn't spam a toast for every seat.
  useEffect(() => {
    const prev = prevConnRef.current
    if (prev.size > 0) {
      for (const s of seats) {
        if (s.hasLeft) continue
        const was = prev.get(s.seatIndex)
        if (was !== undefined && was !== s.isConnected) {
          if (s.isConnected) { ludoSound.reconnected(); setToast({ text: isAr ? `${s.displayName} عاد للاتصال` : `${s.displayName} reconnected`, kind: 'in' }) }
          else { ludoSound.disconnected(); setToast({ text: isAr ? `${s.displayName} انقطع الاتصال` : `${s.displayName} disconnected`, kind: 'out' }) }
        }
      }
    }
    prevConnRef.current = new Map(seats.map((s) => [s.seatIndex, !!s.isConnected]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seats])

  // A rejected roll/move (stale version, "already rolled," "not your turn,"
  // etc.) used to fail completely silently — indistinguishable from a
  // freeze. Now it surfaces as a toast and onlineController immediately
  // resyncs from the server (see submitMove's refresh() call on error), so
  // the player sees SOMETHING happened instead of nothing, and self-heals
  // within a moment rather than sitting on stale local state.
  useEffect(() => {
    if (!actionError) return
    const friendly = /stale state|version/i.test(actionError)
      ? (isAr ? 'إعادة المزامنة...' : 'Syncing…')
      : (isAr ? 'لم يتم قبول هذا الإجراء' : "That action wasn't accepted")
    setToast({ text: friendly, kind: 'out' })
  }, [actionError, isAr])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 3000)
    return () => clearTimeout(t)
  }, [toast])

  if (loading || !state) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'rgba(var(--fg2-rgb),0.5)', fontSize: 13 }}>{isAr ? 'جارٍ الاتصال...' : 'Connecting…'}</div>
  }

  return (
    <div>
      <LudoBoard
        seats={seats}
        state={state}
        currentSeatIndex={currentSeatIndex}
        currentSeat={currentSeat}
        validMoves={validMoves}
        events={events}
        result={result}
        isMyTurn={isMyTurn}
        meSeatIndex={mySeatIndex}
        isAr={isAr}
        online
        turnTimeLeftMs={turnTimeLeftMs}
        turnTimerTotalMs={room?.turn_timer_seconds ? room.turn_timer_seconds * 1000 : null}
        spectatorCount={spectatorCount}
        onMove={(m) => submitMove(m)}
        onExit={onExit}
        onForfeit={forfeit}
        canForfeit={mySeatIndex !== null && !result}
      />
      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 9250, pointerEvents: 'none' }}>
          <style>{`@keyframes ludoToastIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          <div style={{
            padding: '9px 16px', borderRadius: 99, fontSize: 12.5, fontWeight: 700, color: '#fff', whiteSpace: 'nowrap',
            background: toast.kind === 'in' ? 'rgba(46,213,115,0.92)' : 'rgba(255,71,87,0.92)',
            boxShadow: '0 6px 20px rgba(0,0,0,0.35)', animation: 'ludoToastIn 220ms ease-out',
          }}>
            {toast.kind === 'in' ? '🟢' : '🔴'} {toast.text}
          </div>
        </div>
      )}
      <MatchChat roomId={roomId} userId={userId} isAr={isAr} />
    </div>
  )
}

// ── Match (spectator — read-only) ───────────────────────────────────────────

function LudoSpectateMatch({ roomId, userId, isAr, onExit }: { roomId: string; userId: string; isAr: boolean; onExit: () => void }) {
  const {
    loading, room, seats, state, currentSeatIndex, currentSeat, validMoves, events, result, spectatorCount, turnTimeLeftMs,
  } = useOnlineBoardGame({
    engine: LudoEngine, roomId, userId: userId || 'spectator', autoJoinAsPlayer: false,
    serverFinalize: finalizeLudoMatch,
    serverCheckTimeout: checkLudoTimeout,
  })

  if (loading || !state) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'rgba(var(--fg2-rgb),0.5)', fontSize: 13 }}>{isAr ? 'جارٍ الاتصال...' : 'Connecting…'}</div>
  }

  return (
    <div>
      <LudoBoard
        seats={seats}
        state={state}
        currentSeatIndex={currentSeatIndex}
        currentSeat={currentSeat}
        validMoves={validMoves}
        events={events}
        result={result}
        isMyTurn={false}
        meSeatIndex={null}
        isAr={isAr}
        online
        spectating
        turnTimeLeftMs={turnTimeLeftMs}
        turnTimerTotalMs={room?.turn_timer_seconds ? room.turn_timer_seconds * 1000 : null}
        spectatorCount={spectatorCount}
        onMove={() => {}}
        onExit={onExit}
      />
      {userId && <MatchChat roomId={roomId} userId={userId} isAr={isAr} />}
    </div>
  )
}

// ── Board — the shared presentational renderer behind local play, online
// play, and spectating. Whether a piece/roll is clickable is gated purely
// by `isMyTurn`, computed differently by each caller: local play treats any
// non-AI seat's turn as "mine" (pass-and-play, one shared device); online
// play means the seat actually belongs to this signed-in user; spectating
// is always false. Everything else about the board — rendering, sounds,
// animations, victory sequence — is identical across all three modes. ──────

interface OnlineSeatLike extends BoardGameSeat {
  isConnected?: boolean
  hasLeft?: boolean
}

// Static board-background geometry — computed once at module load since it
// never depends on game state, just the fixed classic Ludo layout.
const TRACK_CELLS = pathCells(isSafeGlobalCell, LUDO_START_OFFSETS)
const HOME_STRETCH_CELLS = homeStretchCells()
const CENTER_TRIANGLES = centerTriangles()
const BASE_SEAT_ORDER = [0, 1, 2, 3]

function LudoBoard({
  seats, state, currentSeatIndex, currentSeat, validMoves, events, result, isMyTurn, meSeatIndex, isAr, onMove, onExit,
  online = false, spectating = false, turnTimeLeftMs = null, turnTimerTotalMs = null, spectatorCount = 0, modeLabel,
  onForfeit, canForfeit = false,
}: {
  seats: OnlineSeatLike[]
  state: LudoState
  currentSeatIndex: number | null
  currentSeat: OnlineSeatLike | null
  validMoves: LudoMove[]
  events: BoardGameEvent[]
  result: BoardGameResult | null
  isMyTurn: boolean
  meSeatIndex: number | null
  isAr: boolean
  onMove: (move: LudoMove) => void
  onExit: () => void
  online?: boolean
  spectating?: boolean
  turnTimeLeftMs?: number | null
  turnTimerTotalMs?: number | null
  spectatorCount?: number
  /** Overrides the default "Spectating" badge text — used by the replay viewer to say "Replay" instead. */
  modeLabel?: string
  /** Real "give up now" action (Ludo online only) — see forfeitLudoMatch. Omitted for local/spectate/replay. */
  onForfeit?: () => void
  /** Whether the Forfeit Match option should be shown at all — a seated online player, mid-match, not already finished. */
  canForfeit?: boolean
}) {
  const [showMatchMenu, setShowMatchMenu] = useState(false)
  const [showForfeitConfirm, setShowForfeitConfirm] = useState(false)
  const [rolling, setRolling] = useState(false)
  const [displayDice, setDisplayDice] = useState<number | null>(null)
  const [bursts, setBursts] = useState<{ id: number; x: number; y: number; colors: string[] }[]>([])
  const burstIdRef = useRef(0)
  // "Camera emphasis" on capture — a brief board-wide impact pulse (scale +
  // tiny shake), the same beat mobile games use to sell a big hit landing.
  const [capturePulse, setCapturePulse] = useState(0)

  // The active-turn indicator's "last known" seat — currentSeatIndex goes
  // null the instant the game ends (engine.currentSeatIndex returns null
  // once state.gameOver is true), but the indicator itself must never
  // vanish; it just dims in place instead of losing its position. See
  // PlayerCardsRail below.
  const [lastActiveSeat, setLastActiveSeat] = useState(0)
  useEffect(() => {
    if (currentSeatIndex !== null) setLastActiveSeat(currentSeatIndex)
  }, [currentSeatIndex])

  // Required on-screen rule messages: why an extra roll was granted ("Rolled
  // 6" / "Captured opponent"), the three-sixes forfeit, and "No legal move" —
  // driven off the exact same server-authoritative (or local-engine) event
  // stream everything else below already reacts to, so there's no separate
  // source of truth to desync from.
  const [ruleMessage, setRuleMessage] = useState<{ text: string; kind: 'info' | 'warn' } | null>(null)
  useEffect(() => {
    if (!ruleMessage) return
    const t = setTimeout(() => setRuleMessage(null), 2600)
    return () => clearTimeout(t)
  }, [ruleMessage])

  // Ludo's own event → sound/animation mapping — none of these reuse the
  // quiz games' correct/wrong/win cues; see lib/boardgames/ludo/sound.ts.
  useEffect(() => {
    const last = events[events.length - 1]
    if (!last) return
    if (last.type === 'diceRolled' && last.value === 6) {
      setRuleMessage({ text: isAr ? '🎲 حصلت على 6 — رمية إضافية!' : '🎲 Rolled a 6 — extra roll!', kind: 'info' })
    }
    if (last.type === 'pieceCaptured') {
      setRuleMessage({ text: isAr ? '💥 أسرت قطعة الخصم — رمية إضافية!' : '💥 Captured opponent — extra roll!', kind: 'info' })
    }
    if (last.type === 'threeSixesForfeit') {
      setRuleMessage({ text: isAr ? '⚠ ثلاث سداسيات متتالية — خسرت الدور.' : '⚠ Three consecutive sixes — turn lost.', kind: 'warn' })
    }
    if (last.type === 'noMovesAvailable') {
      setRuleMessage({ text: isAr ? '🚫 لا توجد حركة قانونية' : '🚫 No legal move', kind: 'warn' })
    }
    // Server-resolved turn timeout / elimination — see private.ludo_resolve_expired_turns.
    // These never depend on the timed-out player's own device: whichever
    // client is open (either player's) receives them from checkLudoTimeout
    // or from the events bundled into its own next move.
    if (last.type === 'turnMissed') {
      const isMe = (last.seatIndex as number) === meSeatIndex
      setRuleMessage({
        text: isMe ? (isAr ? '⏱ فاتك دورك' : '⏱ Turn missed') : (isAr ? '⏱ فات خصمك دوره' : "⏱ Opponent missed their turn"),
        kind: 'warn',
      })
    }
    if (last.type === 'playerEliminated' && (last.seatIndex as number) === meSeatIndex) {
      setRuleMessage({ text: isAr ? '❌ تم إقصاؤك بعد تفويت 3 أدوار متتالية' : '❌ Eliminated after missing 3 turns', kind: 'warn' })
    }
    if (last.type === 'gameOver' && last.reason === 'forfeit' && last.winnerSeatIndex === meSeatIndex && meSeatIndex !== null) {
      setRuleMessage({ text: isAr ? '🏆 انسحب الخصم — أنت الفائز' : '🏆 Opponent eliminated — You win', kind: 'info' })
    }
    // Voluntary Forfeit Match action (distinct from the missed-turns
    // elimination above) — see forfeit_ludo_match. 'playerForfeited' fires
    // for the forfeiting seat's own device; the paired 'gameOver'
    // reason:'player_forfeit' event fires the winner's message on the
    // opponent's device.
    if (last.type === 'playerForfeited') {
      const isMe = (last.seatIndex as number) === meSeatIndex
      setRuleMessage({
        text: isMe ? (isAr ? '🏳 لقد انسحبت من المباراة.' : '🏳 You forfeited the match.') : (isAr ? '⚠ انسحب الخصم من المباراة.' : '⚠ Opponent forfeited the match.'),
        kind: 'warn',
      })
    }
    if (last.type === 'gameOver' && last.reason === 'player_forfeit' && last.winnerSeatIndex === meSeatIndex && meSeatIndex !== null) {
      setRuleMessage({ text: isAr ? '🏆 انسحب الخصم — أنت الفائز' : '🏆 Opponent forfeited — You win', kind: 'info' })
    }
    if (last.type === 'diceRolled') {
      setRolling(true)
      let ticks = 0
      // Shortened from 7 ticks @ 60ms (420ms) to 5 ticks @ 50ms (250ms) —
      // the real dice value is already resolved server-side before this
      // purely cosmetic tumble even starts, so a snappier reveal doesn't
      // cost any correctness, it just feels faster.
      const iv = setInterval(() => {
        setDisplayDice(1 + Math.floor(Math.random() * 6))
        ludoSound.diceRattle()
        ticks++
        if (ticks > 4) {
          clearInterval(iv)
          setDisplayDice(last.value as number)
          setRolling(false)
          ludoSound.diceSettle(last.value as number)
        }
      }, 50)
      return () => clearInterval(iv)
    }
    if (last.type === 'pieceMoved') {
      if (last.from === -1) ludoSound.pieceEnter()
      else ludoSound.pieceSlide()
    }
    if (last.type === 'pieceCaptured') {
      ludoSound.pieceCaptured()
      const atCell = last.atCell as number
      const capturedSeatIndex = last.capturedSeatIndex as number
      const cell = TRACK_CELLS[atCell]
      if (cell) {
        const id = ++burstIdRef.current
        setBursts((b) => [...b, { id, x: cell.x, y: cell.y, colors: [SEAT_COLORS[capturedSeatIndex], '#fff', SEAT_COLORS_DARK[capturedSeatIndex]] }])
        setTimeout(() => setBursts((b) => b.filter((p) => p.id !== id)), 700)
      }
      setCapturePulse((n) => n + 1)
    }
    if (last.type === 'pieceHome') ludoSound.pieceHome()
    if (last.type === 'seatFinished') ludoSound.seatFinished()
    if (last.type === 'gameOver') ludoSound.victory()
    if (last.type === 'noMovesAvailable' || last.type === 'threeSixesForfeit' || last.type === 'turnMissed') ludoSound.turnPass()
  }, [events])

  // "Your turn" — fires once per transition into isMyTurn (never on mount,
  // so joining a match that's already your turn doesn't spam a toast).
  const wasMyTurnRef = useRef(isMyTurn)
  useEffect(() => {
    if (isMyTurn && !wasMyTurnRef.current && !result) {
      setRuleMessage({ text: isAr ? '🎯 دورك الآن' : '🎯 Your turn', kind: 'info' })
    }
    wasMyTurnRef.current = isMyTurn
  }, [isMyTurn, result, isAr])

  const movablePieceIds = useMemo(() => new Set(validMoves.filter((m): m is Extract<LudoMove, { type: 'move' }> => m.type === 'move').map((m) => m.pieceId)), [validMoves])
  const canRoll = isMyTurn && validMoves.length === 1 && validMoves[0]?.type === 'roll'
  const waitingOnAI = !online && (currentSeat?.isAI ?? false)
  const turnSecondsLeft = turnTimeLeftMs !== null ? Math.ceil(turnTimeLeftMs / 1000) : null

  return (
    <div style={{ padding: '4px 14px 0', maxWidth: 520, margin: '0 auto', fontFamily: "'Exo 2', 'Cairo', sans-serif" }}>
      {online && (spectatorCount > 0 || spectating || modeLabel || canForfeit) && (
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, marginBottom: 6 }}>
          {spectatorCount > 0 && (
            <span key={spectatorCount} style={{ fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', animation: 'ludoSpectatorPop 350ms cubic-bezier(0.34,1.56,0.64,1)' }}>
              <style>{`@keyframes ludoSpectatorPop { 0% { transform: scale(1.5); opacity: 0.4; } 100% { transform: scale(1); opacity: 1; } }`}</style>
              👁 {spectatorCount}
            </span>
          )}
          {(spectating || modeLabel) && (
            <span style={{ fontSize: 11, fontWeight: 700, color: '#9d6fff' }}>{modeLabel ?? (isAr ? 'وضع المشاهدة' : 'Spectating')}</span>
          )}
          {canForfeit && onForfeit && (
            <div style={{ position: 'absolute', insetInlineEnd: 0, top: -2 }}>
              <button
                onClick={() => setShowMatchMenu((v) => !v)}
                aria-label={isAr ? 'خيارات المباراة' : 'Match options'}
                style={{
                  width: 30, height: 30, borderRadius: 10, border: '1px solid rgba(var(--fg-rgb),0.12)',
                  background: 'rgba(var(--fg-rgb),0.05)', color: 'var(--foreground)', cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 900, lineHeight: 1,
                }}
              >
                ⋮
              </button>
              {showMatchMenu && (
                <>
                  <div onClick={() => setShowMatchMenu(false)} style={{ position: 'fixed', inset: 0, zIndex: 9299 }} />
                  <div style={{
                    position: 'absolute', top: 36, insetInlineEnd: 0, zIndex: 9300, minWidth: 168,
                    background: 'rgba(20,18,38,0.98)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 14,
                    boxShadow: '0 12px 30px rgba(0,0,0,0.4)', overflow: 'hidden',
                  }}>
                    <button
                      onClick={() => { setShowMatchMenu(false); setShowForfeitConfirm(true) }}
                      style={{
                        width: '100%', padding: '11px 14px', background: 'none', border: 'none', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5, fontWeight: 700, color: '#ff6b7a', textAlign: 'start',
                      }}
                    >
                      🏳 {isAr ? 'الانسحاب من المباراة' : 'Forfeit Match'}
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {showForfeitConfirm && onForfeit && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,3,15,0.75)', backdropFilter: 'blur(4px)', zIndex: 9310, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div style={{
            background: 'linear-gradient(165deg, rgba(24,22,46,0.98), rgba(13,13,31,0.99))', borderRadius: 20, padding: '22px 20px',
            maxWidth: 320, width: '100%', border: '1px solid rgba(255,107,122,0.35)', boxShadow: '0 24px 60px rgba(0,0,0,0.5)', textAlign: 'center',
          }}>
            <p style={{ margin: '0 0 8px', fontSize: 15, fontWeight: 800, color: '#fff' }}>
              {isAr ? 'هل أنت متأكد من رغبتك في الانسحاب من هذه المباراة؟' : 'Are you sure you want to forfeit this match?'}
            </p>
            <p style={{ margin: '0 0 20px', fontSize: 12.5, color: 'rgba(255,255,255,0.55)' }}>
              {isAr ? 'سيتم إعلان الخصم فائزًا.' : 'The opponent will be declared the winner.'}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => setShowForfeitConfirm(false)}
                style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: '1px solid rgba(255,255,255,0.14)', background: 'rgba(255,255,255,0.04)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}
              >
                {isAr ? 'إلغاء' : 'Cancel'}
              </button>
              <button
                onClick={() => { setShowForfeitConfirm(false); onForfeit() }}
                style={{ flex: 1, padding: '11px 0', borderRadius: 12, border: 'none', background: '#ff4757', color: '#fff', fontWeight: 800, fontSize: 13, cursor: 'pointer' }}
              >
                {isAr ? 'الانسحاب' : 'Forfeit'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* The single, deterministic source of truth for "whose turn is it" — always rendered,
          never conditionally unmounted. Every seat's card exists on every render; only the
          active card's styling changes, so the highlight animates via CSS transitions instead
          of popping in/out, and it can never desync from a separate floating banner because
          there is no separate banner anymore. */}
      <PlayerCardsRail
        seats={seats}
        activeSeatIndex={lastActiveSeat}
        isTurnLive={currentSeatIndex !== null && !result}
        meSeatIndex={meSeatIndex}
        isAr={isAr}
        online={online}
        rolling={rolling}
        waitingOnAI={waitingOnAI}
        turnSecondsLeft={!result ? turnSecondsLeft : null}
        turnTimerTotalMs={turnTimerTotalMs}
      />

      {ruleMessage && (
        <div style={{ display: 'flex', justifyContent: 'center', margin: '2px 0 10px' }}>
          <style>{`@keyframes ludoRuleMsgIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: translateY(0); } }`}</style>
          <span style={{
            padding: '7px 14px', borderRadius: 99, fontSize: 12, fontWeight: 700, textAlign: 'center',
            color: ruleMessage.kind === 'warn' ? '#ff4757' : '#8b5cf6',
            background: ruleMessage.kind === 'warn' ? 'rgba(255,71,87,0.12)' : 'rgba(139,92,246,0.14)',
            border: `1px solid ${ruleMessage.kind === 'warn' ? 'rgba(255,71,87,0.35)' : 'rgba(139,92,246,0.35)'}`,
            animation: 'ludoRuleMsgIn 200ms ease-out',
          }}>
            {ruleMessage.text}
          </span>
        </div>
      )}

      {/* Board stage — a deep glass tray the board "floats" in, premium-mobile-game treatment rather than a flat card */}
      <div style={{
        display: 'flex', justifyContent: 'center', margin: '14px 0', padding: 16, borderRadius: 32,
        background: 'radial-gradient(circle at 50% 38%, rgba(157,111,255,0.16), rgba(0,0,0,0) 65%), linear-gradient(165deg, rgba(255,255,255,0.05), rgba(0,0,0,0.16))',
        border: '1px solid rgba(255,255,255,0.09)', boxShadow: 'inset 0 2px 22px rgba(0,0,0,0.32), 0 20px 50px rgba(0,0,0,0.28)',
        backdropFilter: 'blur(6px)',
      }}>
        {/* "Camera emphasis" on capture — a brief board-wide impact pulse. Alternates between two
            identically-defined keyframe names (A/B) by parity rather than using a React `key`:
            changing `animation-name` restarts a CSS animation instantly, while a `key` would
            unmount/remount the entire SVG (every piece, every transition) on each capture —
            exactly the kind of jank this redesign is trying to eliminate, not reintroduce. */}
        <svg
          viewBox={`0 0 ${BOARD_VIEWBOX} ${BOARD_VIEWBOX}`} width="100%"
          style={{
            maxWidth: 420, aspectRatio: '1/1', filter: 'drop-shadow(0 14px 32px rgba(0,0,0,0.4))',
            animation: capturePulse > 0 ? `${capturePulse % 2 === 0 ? 'ludoCameraHitA' : 'ludoCameraHitB'} 380ms cubic-bezier(0.22,1,0.36,1)` : undefined,
          }}
        >
            <defs>
              <linearGradient id="ludoBoardBg" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#fffaf0" />
                <stop offset="55%" stopColor="#f7ecd6" />
                <stop offset="100%" stopColor="#ecdfc2" />
              </linearGradient>
              <radialGradient id="ludoCenterGlow" cx="50%" cy="50%" r="60%">
                <stop offset="0%" stopColor="#ffffff" stopOpacity={0.9} />
                <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
              </radialGradient>
              {SEAT_COLORS.map((c, i) => (
                <linearGradient key={`base-grad-${i}`} id={`ludoBaseGrad-${i}`} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor={c} stopOpacity={1} />
                  <stop offset="100%" stopColor={SEAT_COLORS_DARK[i]} stopOpacity={1} />
                </linearGradient>
              ))}
              {SEAT_COLORS.map((c, i) => (
                <radialGradient key={`piece-body-${i}`} id={`ludoPieceBody-${i}`} cx="34%" cy="28%" r="80%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={0.65} />
                  <stop offset="28%" stopColor={c} stopOpacity={1} />
                  <stop offset="100%" stopColor={SEAT_COLORS_DARK[i]} stopOpacity={1} />
                </radialGradient>
              ))}
              {SEAT_COLORS.map((c, i) => (
                <radialGradient key={`piece-glow-${i}`} id={`ludoPieceGrad-${i}`} cx="35%" cy="30%" r="75%">
                  <stop offset="0%" stopColor="#ffffff" stopOpacity={0.85} />
                  <stop offset="35%" stopColor={c} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={c} stopOpacity={0} />
                </radialGradient>
              ))}
            </defs>

            {/* Board base — a warm layered glass-and-wood face with a soft inner bevel for real depth */}
            <rect x={0} y={0} width={BOARD_VIEWBOX} height={BOARD_VIEWBOX} rx={26} fill="url(#ludoBoardBg)" />
            <rect x={3} y={3} width={BOARD_VIEWBOX - 6} height={BOARD_VIEWBOX - 6} rx={23} fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={2} />
            <rect x={0} y={0} width={BOARD_VIEWBOX} height={BOARD_VIEWBOX} rx={26} fill="none" stroke="rgba(0,0,0,0.14)" strokeWidth={2} />

            {/* Four colored home bases — glossy gradient plates with a frosted inset yard holding 4 piece slots */}
            {BASE_SEAT_ORDER.map((seatIndex) => {
              const r = yardRect(seatIndex)
              const inset = r.w * 0.15
              return (
                <g key={`base-${seatIndex}`}>
                  <rect x={r.x + 4} y={r.y + 4} width={r.w - 8} height={r.h - 8} rx={22} fill={`url(#ludoBaseGrad-${seatIndex})`} />
                  <rect x={r.x + 4} y={r.y + 4} width={r.w - 8} height={(r.h - 8) * 0.45} rx={22} fill="rgba(255,255,255,0.16)" />
                  <rect x={r.x + inset} y={r.y + inset} width={r.w - inset * 2} height={r.h - inset * 2} rx={16} fill="rgba(255,255,255,0.94)" stroke="rgba(0,0,0,0.06)" />
                  {[0, 1, 2, 3].map((pieceIndex) => {
                    const slot = piecePixelPosition(seatIndex, pieceIndex, -1)
                    return (
                      <circle key={pieceIndex} cx={slot.x} cy={slot.y} r={r.w * 0.105} fill={`${SEAT_COLORS[seatIndex]}22`} stroke={`${SEAT_COLORS[seatIndex]}50`} strokeWidth={1.5} strokeDasharray="3 2.5" />
                    )
                  })}
                </g>
              )
            })}

            {/* The 52-cell shared ring track — rounded glossy tiles, entry squares tinted per-color, star cells marked safe */}
            {TRACK_CELLS.map((c) => {
              const size = CELL - 5
              const fill = c.isEntry ? `${SEAT_COLORS[c.seatIndex]}d9` : c.isSafe ? '#fff1bd' : '#fffdf6'
              const stroke = c.isEntry ? SEAT_COLORS_DARK[c.seatIndex] : 'rgba(0,0,0,0.1)'
              return (
                <g key={`track-${c.index}`}>
                  <rect x={c.x - size / 2} y={c.y - size / 2 + 1.5} width={size} height={size} rx={9} fill="rgba(0,0,0,0.06)" />
                  <rect x={c.x - size / 2} y={c.y - size / 2} width={size} height={size} rx={9} fill={fill} stroke={stroke} strokeWidth={c.isEntry ? 1.5 : 1} />
                  <rect x={c.x - size / 2 + 2} y={c.y - size / 2 + 2} width={size - 4} height={size * 0.4} rx={7} fill="rgba(255,255,255,0.35)" />
                  {c.isSafe && (
                    <text x={c.x} y={c.y + 4.5} textAnchor="middle" fontSize={14} fill={c.isEntry ? '#ffffff' : '#c9950c'} style={{ filter: 'drop-shadow(0 1px 1px rgba(0,0,0,0.15))' }}>★</text>
                  )}
                </g>
              )
            })}

            {/* Each seat's private 6-cell home stretch, running from the ring into the center */}
            {HOME_STRETCH_CELLS.map((c) => {
              const size = CELL - 5
              return (
                <g key={`home-${c.seatIndex}-${c.stretchIndex}`}>
                  <rect x={c.x - size / 2} y={c.y - size / 2 + 1.5} width={size} height={size} rx={9} fill="rgba(0,0,0,0.05)" />
                  <rect
                    x={c.x - size / 2} y={c.y - size / 2} width={size} height={size} rx={9}
                    fill={c.isFinishCell ? `url(#ludoBaseGrad-${c.seatIndex})` : `${SEAT_COLORS[c.seatIndex]}4a`}
                    stroke={SEAT_COLORS_DARK[c.seatIndex]} strokeWidth={c.isFinishCell ? 1.5 : 1}
                  />
                </g>
              )
            })}

            {/* Center "home" pinwheel — 4 glossy wedges meeting at the true board center, with a soft glow and a gem-like finish marker */}
            <circle cx={CENTER.x} cy={CENTER.y} r={62} fill="url(#ludoCenterGlow)" />
            {CENTER_TRIANGLES.map((t) => (
              <polygon key={`wedge-${t.seatIndex}`} points={t.points} fill={`url(#ludoBaseGrad-${t.seatIndex})`} stroke="rgba(255,255,255,0.7)" strokeWidth={2} />
            ))}
            <circle cx={CENTER.x} cy={CENTER.y} r={13} fill="#fffdf6" stroke="rgba(0,0,0,0.15)" strokeWidth={1.5} />
            <circle cx={CENTER.x} cy={CENTER.y} r={13} fill="none" stroke="#ffffff" strokeWidth={3} opacity={0.5}>
              <animate attributeName="r" values="13;17;13" dur="2.4s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.5;0;0.5" dur="2.4s" repeatCount="indefinite" />
            </circle>
            <text x={CENTER.x} y={CENTER.y + 5} textAnchor="middle" fontSize={15}>🏆</text>

            {/* Soft radial glow under every piece, so pieces read as glossy tokens rather than flat dots */}
            {state.pieces.map((piece) => {
              const pos = piecePixelPosition(piece.seatIndex, piece.pieceIndex, piece.pathPos)
              return (
                <circle
                  key={`glow-${piece.seatIndex}:${piece.pieceIndex}`}
                  cx={pos.x} cy={pos.y} r={16} fill={`url(#ludoPieceGrad-${piece.seatIndex})`}
                  style={{ transition: 'cx 260ms cubic-bezier(0.22,1,0.36,1), cy 260ms cubic-bezier(0.22,1,0.36,1)' }}
                />
              )
            })}

            {/* Capture particle bursts — a short radiating sparkle where a piece was just sent home */}
            {bursts.map((b) => (
              <g key={b.id}>
                {Array.from({ length: 10 }, (_, i) => {
                  const angle = (i / 10) * Math.PI * 2
                  return (
                    <circle
                      key={i} cx={b.x} cy={b.y} r={3.5} fill={b.colors[i % b.colors.length]}
                      style={{ transformOrigin: `${b.x}px ${b.y}px`, animation: `ludoBurstFly 650ms ease-out forwards`, ['--bx' as string]: `${Math.cos(angle) * 34}px`, ['--by' as string]: `${Math.sin(angle) * 34}px` }}
                    />
                  )
                })}
              </g>
            ))}
            <style>{`
              @keyframes ludoBurstFly { 0% { transform: translate(0,0) scale(1); opacity: 1; } 100% { transform: translate(var(--bx),var(--by)) scale(0.2); opacity: 0; } }
              @keyframes ludoCameraHitA { 0% { transform: scale(1) rotate(0deg); } 30% { transform: scale(1.035) rotate(-0.6deg); } 60% { transform: scale(0.985) rotate(0.4deg); } 100% { transform: scale(1) rotate(0deg); } }
              @keyframes ludoCameraHitB { 0% { transform: scale(1) rotate(0deg); } 30% { transform: scale(1.035) rotate(0.6deg); } 60% { transform: scale(0.985) rotate(-0.4deg); } 100% { transform: scale(1) rotate(0deg); } }
            `}</style>

            {/* Pieces — stacked pieces sharing a cell fan out slightly instead of perfectly overlapping */}
          {state.pieces.map((piece) => {
            const pos = piecePixelPosition(piece.seatIndex, piece.pieceIndex, piece.pathPos)
            const isMine = piece.seatIndex === currentSeatIndex
            const pid = `${piece.seatIndex}:${piece.pieceIndex}`
            const movable = isMine && movablePieceIds.has(pid) && isMyTurn
            const finished = piece.pathPos === LUDO_FINISHED
            const stackMates = piece.pathPos === -1 ? [] : state.pieces.filter(
              (p) => p.pathPos === piece.pathPos && p.seatIndex === piece.seatIndex && p !== piece,
            )
            const stackFan = stackMates.length > 0
              ? { x: (piece.pieceIndex % 2 === 0 ? -1 : 1) * 5, y: (piece.pieceIndex < 2 ? -1 : 1) * 5 }
              : { x: 0, y: 0 }
            const lastEvent = events[events.length - 1]
            const justMoved = lastEvent?.type === 'pieceMoved' && (lastEvent.pieceId as string) === pid
            return (
              <g
                key={pid}
                transform={`translate(${pos.x + stackFan.x},${pos.y + stackFan.y})`}
                // Shortened from 460ms — this is the transition users feel
                // most directly as "piece movement," and nothing gates
                // interaction on it finishing, so a snappier slide reads as
                // more responsive without losing legibility.
                style={{ transition: 'transform 260ms cubic-bezier(0.22,1,0.36,1)', cursor: movable ? 'pointer' : 'default' }}
                onClick={() => movable && onMove({ type: 'move', pieceId: pid })}
              >
                {movable && <circle r={16} fill="none" stroke={SEAT_COLORS[piece.seatIndex]} strokeWidth={2.5} opacity={0.9}>
                  <animate attributeName="r" values="14;18;14" dur="1s" repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0.9;0.35;0.9" dur="1s" repeatCount="indefinite" />
                </circle>}
                <g style={justMoved ? { animation: 'ludoPieceLand 240ms cubic-bezier(0.34,1.56,0.64,1)' } : undefined}>
                  <ellipse cx={0.5} cy={9} rx={9.5} ry={3.2} fill="rgba(0,0,0,0.32)" />
                  <circle r={11.5} fill={finished ? SEAT_COLORS_DARK[piece.seatIndex] : `url(#ludoPieceBody-${piece.seatIndex})`} stroke="#fff" strokeWidth={2} />
                  <circle r={11.5} fill="none" stroke="rgba(0,0,0,0.12)" strokeWidth={1} />
                  <circle cx={-3.2} cy={-3.8} r={3.6} fill="rgba(255,255,255,0.75)" />
                  <circle cx={-3.2} cy={-3.8} r={1.4} fill="rgba(255,255,255,0.95)" />
                </g>
              </g>
            )
          })}
          <style>{`@keyframes ludoPieceLand { 0% { transform: scale(0.6); } 55% { transform: scale(1.22); } 100% { transform: scale(1); } }`}</style>
        </svg>
      </div>

      {/* Dice tray — a floating glass panel, the die and roll affordance grouped as one premium unit.
          The glass blur lives on a separate, absolutely-positioned backdrop layer BEHIND the content
          rather than on the container that wraps the die directly: Safari/WebKit has real
          (not just spec-edge-case) bugs where a `backdrop-filter` ancestor can flatten or clip a
          descendant's `preserve-3d` subtree, which is exactly the class of artifact (flicker,
          partial invisibility, clipping) this file previously suffered from. Keeping the 3D die
          entirely outside any filtered ancestor removes that risk category outright. */}
      <div style={{ position: 'relative', margin: '0 auto 20px', maxWidth: 340 }}>
        <div style={{
          position: 'absolute', inset: 0, borderRadius: 24, background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(14px)', WebkitBackdropFilter: 'blur(14px)',
          boxShadow: '0 10px 30px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.08)',
        } as React.CSSProperties} />
        <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, padding: '14px 20px' }}>
        <Die value={displayDice ?? state.diceValue} rolling={rolling} />
        {canRoll && (
          <button
            onClick={() => onMove({ type: 'roll' } as LudoMove)}
            style={{
              padding: '12px 24px', borderRadius: 16, border: 'none', background: 'linear-gradient(135deg,#8b5cf6,#c084fc)', color: '#fff',
              fontWeight: 800, fontSize: 14, letterSpacing: '0.01em', cursor: 'pointer', boxShadow: '0 8px 22px rgba(139,92,246,0.45), inset 0 1px 0 rgba(255,255,255,0.3)',
              animation: 'ludoRollPulse 1.8s ease-in-out infinite',
            }}
          >
            {isAr ? 'ارمِ النرد' : 'Roll Dice'}
          </button>
        )}
        {isMyTurn && !canRoll && validMoves.length > 0 && (
          <span style={{ fontSize: 12.5, color: 'rgba(var(--fg2-rgb),0.6)', fontWeight: 600, textAlign: 'center' }}>
            {isAr ? 'اختر قطعة للتحريك' : 'Tap a highlighted piece to move'}
          </span>
        )}
        <style>{`@keyframes ludoRollPulse { 0%, 100% { box-shadow: 0 8px 22px rgba(139,92,246,0.45), inset 0 1px 0 rgba(255,255,255,0.3); } 50% { box-shadow: 0 8px 30px rgba(139,92,246,0.7), inset 0 1px 0 rgba(255,255,255,0.3); } }`}</style>
        </div>
      </div>

      {result && <LudoResultModal isAr={isAr} seats={seats} result={result} meSeatIndex={meSeatIndex} onExit={onExit} />}
    </div>
  )
}

/** A compact circular countdown — replaces a plain "⏱ Ns" text with an actual depleting ring, colored amber then red as time runs low. */
function TurnTimerRing({ secondsLeft, totalMs, size = 30, hideLabel = false }: { secondsLeft: number; totalMs: number | null; size?: number; hideLabel?: boolean }) {
  const totalSeconds = totalMs !== null ? totalMs / 1000 : 30
  const pct = Math.max(0, Math.min(1, secondsLeft / totalSeconds))
  const stroke = size < 36 ? 3 : 3.5
  const r = (size - stroke) / 2
  const circumference = 2 * Math.PI * r
  const urgent = secondsLeft <= 5
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(var(--fg-rgb),0.1)" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={r} fill="none"
          stroke={urgent ? '#ff4757' : '#9d6fff'} strokeWidth={stroke} strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - pct)}
          style={{ transition: 'stroke-dashoffset 200ms linear, stroke 200ms' }}
        />
      </svg>
      {!hideLabel && (
        <span style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 10.5, fontWeight: 800, color: urgent ? '#ff4757' : 'rgba(var(--fg2-rgb),0.6)',
        }}>
          {secondsLeft}
        </span>
      )}
    </div>
  )
}

/**
 * The single, deterministic "whose turn is it" surface. Every seat gets a
 * permanent card — none are ever conditionally unmounted — so the active
 * highlight is purely a style computed from `activeSeatIndex` and can only
 * ever move smoothly between fixed slots via CSS transitions, never pop in,
 * pop out, or land in the wrong place. `isTurnLive` (false only once the
 * match has actually ended) dims the whole indicator instead of hiding it.
 */
function PlayerCardsRail({
  seats, activeSeatIndex, isTurnLive, meSeatIndex, isAr, online, rolling, waitingOnAI, turnSecondsLeft, turnTimerTotalMs,
}: {
  seats: OnlineSeatLike[]
  activeSeatIndex: number
  isTurnLive: boolean
  meSeatIndex: number | null
  isAr: boolean
  online: boolean
  rolling: boolean
  waitingOnAI: boolean
  turnSecondsLeft: number | null
  turnTimerTotalMs: number | null
}) {
  const n = Math.max(seats.length, 1)
  return (
    <div style={{ position: 'relative', display: 'flex', gap: 6, padding: '10px 8px 12px', marginBottom: 6, borderRadius: 22, background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)', backdropFilter: 'blur(14px)', boxShadow: '0 8px 24px rgba(0,0,0,0.2), inset 0 1px 0 rgba(255,255,255,0.06)' }}>
      {seats.map((s) => {
        const active = s.seatIndex === activeSeatIndex && isTurnLive
        const isMe = s.seatIndex === meSeatIndex
        const color = SEAT_COLORS[s.seatIndex]
        const statusText = !active ? null
          : waitingOnAI ? (rolling ? (isAr ? 'يرمي...' : 'Rolling…') : (isAr ? 'يفكر...' : 'Thinking…'))
          : isMe ? (isAr ? 'دورك!' : 'Your turn!')
          : online ? (isAr ? 'يلعب الآن' : 'Playing…')
          : (isAr ? 'مرر الجهاز' : 'pass device')
        return (
          <div
            key={s.seatIndex}
            style={{
              position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
              padding: '8px 4px', borderRadius: 16,
              background: active ? `linear-gradient(160deg, ${color}2e, ${color}0a)` : 'transparent',
              border: `1.5px solid ${active ? `${color}80` : 'transparent'}`,
              boxShadow: active ? `0 0 0 1px ${color}30, 0 6px 18px ${color}35` : 'none',
              transform: active ? 'translateY(-2px) scale(1.04)' : 'translateY(0) scale(1)',
              opacity: s.hasLeft ? 0.4 : 1,
              transition: 'all 220ms cubic-bezier(0.22,1,0.36,1)',
            }}
          >
            <div style={{ position: 'relative', width: 42, height: 42 }}>
              {active && turnSecondsLeft !== null && (
                <div style={{ position: 'absolute', inset: -5 }}>
                  <TurnTimerRing secondsLeft={turnSecondsLeft} totalMs={turnTimerTotalMs} size={52} hideLabel />
                </div>
              )}
              {active && (
                <div style={{ position: 'absolute', inset: -3, borderRadius: '50%', border: `2px solid ${color}`, animation: 'ludoActivePulse 1.6s ease-in-out infinite' }} />
              )}
              <div style={{
                width: 42, height: 42, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `linear-gradient(145deg, ${color}, ${SEAT_COLORS_DARK[s.seatIndex]})`,
                border: '2px solid rgba(255,255,255,0.85)', boxShadow: `0 4px 12px ${color}50, inset 0 1px 2px rgba(255,255,255,0.4)`,
                fontSize: 15, fontWeight: 900, color: '#fff', textShadow: '0 1px 2px rgba(0,0,0,0.25)',
              }}>
                {s.isAI ? '🤖' : (s.displayName?.[0] ?? '?').toUpperCase()}
              </div>
              {online && (
                <span style={{
                  position: 'absolute', bottom: -1, right: -1, width: 12, height: 12, borderRadius: '50%',
                  background: s.hasLeft ? '#6b7280' : s.isConnected === false ? '#f9ca24' : '#2ed573',
                  border: '2px solid var(--background, #100f22)',
                }} />
              )}
            </div>
            <span style={{ fontSize: 10.5, fontWeight: 800, color: 'var(--foreground)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {isMe ? (isAr ? 'أنت' : 'You') : s.displayName}
            </span>
            <span style={{ fontSize: 8.5, fontWeight: 700, color: active ? color : 'transparent', height: 11, letterSpacing: '0.01em' }}>
              {statusText ?? '·'}
            </span>
          </div>
        )
      })}
      {/* Sliding indicator bar — the second, structurally-linked confirmation of whose turn it is; purely a transform driven by activeSeatIndex */}
      <div style={{
        position: 'absolute', bottom: 4, left: `${(activeSeatIndex / n) * 100}%`, width: `${100 / n}%`, height: 3, borderRadius: 3,
        padding: '0 14px', pointerEvents: 'none', transition: 'left 240ms cubic-bezier(0.22,1,0.36,1)', opacity: isTurnLive ? 1 : 0.25,
      }}>
        <div style={{ height: '100%', borderRadius: 3, background: `linear-gradient(90deg, ${SEAT_COLORS[activeSeatIndex]}, ${SEAT_COLORS_DARK[activeSeatIndex]})`, boxShadow: `0 0 8px ${SEAT_COLORS[activeSeatIndex]}90` }} />
      </div>
      <style>{`@keyframes ludoActivePulse { 0%, 100% { opacity: 0.9; transform: scale(1); } 50% { opacity: 0.3; transform: scale(1.12); } }`}</style>
    </div>
  )
}

/** Ludo's own 3D-tumbling die — a real cube rotation while rolling, not just a wobble. */
/** Ludo's own glossy 3D die — a real cube tumble while rolling plus a spring-settle bounce when it lands, ivory-premium rather than the old flat dark cube. */
const DIE_PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
}

/** One face's pip content — shared by both the 3D cube faces and the 2D fallback. */
function DiePips({ value }: { value: number | null }) {
  const pips = value ? DIE_PIP_LAYOUTS[value] ?? [] : []
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gridTemplateRows: 'repeat(3,1fr)', padding: 10 }}>
      {pips.map(([cx, cy], i) => (
        <span key={i} style={{
          gridColumn: cx + 2, gridRow: cy + 2, width: 9, height: 9, borderRadius: '50%', justifySelf: 'center', alignSelf: 'center',
          background: 'radial-gradient(circle at 35% 30%, #a78bfa, #6d28d9)', boxShadow: '0 1px 2px rgba(0,0,0,0.3), inset 0 1px 1px rgba(255,255,255,0.4)',
        }} />
      ))}
    </div>
  )
}

const DIE_FACE_BASE: React.CSSProperties = {
  position: 'absolute', inset: 0, borderRadius: 17,
  background: 'linear-gradient(155deg, #ffffff 0%, #f1ecff 55%, #e2d8ff 100%)',
  border: '1px solid rgba(139,92,246,0.25)',
  boxShadow: '0 2px 4px rgba(0,0,0,0.12), inset 0 2px 0 rgba(255,255,255,0.9), inset 0 -3px 6px rgba(139,92,246,0.12)',
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
} as React.CSSProperties

/**
 * Ludo's own die. Renders as a REAL 6-face 3D cube (each face its own
 * plane, positioned via translateZ + rotate to form a cube, with
 * backface-visibility:hidden so only camera-facing faces ever render) —
 * never a single flat card being rotated. A flat plane goes edge-on-blank
 * every half turn, which is exactly the "flickers / thin white strip" bug
 * this replaces: a true cube always presents an opaque face (or a
 * correctly-foreshortened edge, never nothing) from any angle.
 *
 * The front face's pips track the live rolled value; the other five keep
 * fixed decorative numbers so the cube always looks like a real die from
 * every angle mid-tumble, without needing per-value orientation math.
 *
 * Three render modes, chosen once and then stable for the component's
 * lifetime (never flip-flops mid-animation):
 *  - 3D cube (default, capable browsers, no motion-reduction preference)
 *  - reduced-motion: a single flat 2D face with a simple rotate+scale spin
 *  - runtime fallback: same flat 2D path, entered automatically if 3D
 *    transform support is missing OR the roll animation visibly drops
 *    frames (measured via requestAnimationFrame deltas)
 */
function Die({ value, rolling }: { value: number | null; rolling: boolean }) {
  const [justSettled, setJustSettled] = useState(false)
  const wasRolling = useRef(false)
  useEffect(() => {
    if (rolling) { wasRolling.current = true; return }
    if (wasRolling.current) {
      wasRolling.current = false
      setJustSettled(true)
      const t = setTimeout(() => setJustSettled(false), 260)
      return () => clearTimeout(t)
    }
  }, [rolling])

  // Mode selection: reduced-motion preference or missing 3D-transform
  // support locks in the safe 2D path immediately, before any animation
  // is attempted.
  const [safe2D, setSafe2D] = useState(() => {
    if (typeof window === 'undefined') return false
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const supports3D = typeof CSS !== 'undefined' && CSS.supports
      ? CSS.supports('transform-style', 'preserve-3d') && CSS.supports('backface-visibility', 'hidden')
      : false
    return reduced || !supports3D
  })

  // Runtime jank guard: while a 3D roll is in flight, watch frame deltas.
  // A handful of frames slower than ~45ms (≈22fps) means the device is
  // struggling with the 3D layer — fall back to the 2D path for the rest
  // of the session rather than keep fighting a stuttering animation.
  const jankFramesRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  useEffect(() => {
    if (safe2D || !rolling) return
    let last = performance.now()
    const tick = (now: number) => {
      const delta = now - last
      last = now
      if (delta > 45) {
        jankFramesRef.current += 1
        if (jankFramesRef.current >= 4) { setSafe2D(true); return }
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current !== null) cancelAnimationFrame(rafRef.current) }
  }, [safe2D, rolling])

  if (safe2D) {
    return (
      <div style={{ position: 'relative' }}>
        <div style={{ position: 'absolute', left: '50%', bottom: -6, width: 40, height: 10, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,0,0,0.4), transparent 70%)', transform: 'translateX(-50%)' }} />
        <div style={{
          width: 58, height: 58, position: 'relative',
          animation: rolling ? 'ludoDieSpin2D 260ms linear infinite' : undefined,
          transform: !rolling ? (justSettled ? 'scale(1.14)' : 'scale(1)') : undefined,
          transition: !rolling ? 'transform 220ms cubic-bezier(0.34,1.56,0.64,1)' : undefined,
          willChange: 'transform',
        }}>
          <div style={DIE_FACE_BASE}><DiePips value={value} /></div>
        </div>
        <style>{`@keyframes ludoDieSpin2D { 0% { transform: rotate(0deg) scale(1.08); } 50% { transform: rotate(180deg) scale(1.14); } 100% { transform: rotate(360deg) scale(1.08); } }`}</style>
      </div>
    )
  }

  return (
    <div style={{
      perspective: 340, WebkitPerspective: 340, position: 'relative', zIndex: 1,
    } as React.CSSProperties}>
      <div style={{ position: 'absolute', left: '50%', bottom: -6, width: 40, height: 10, borderRadius: '50%', background: 'radial-gradient(ellipse, rgba(0,0,0,0.4), transparent 70%)', transform: 'translateX(-50%)' }} />
      <div style={{
        width: 58, height: 58, position: 'relative',
        transformStyle: 'preserve-3d', WebkitTransformStyle: 'preserve-3d',
        transformOrigin: 'center center',
        willChange: 'transform',
        animation: rolling ? 'ludoDieTumble3D 280ms linear infinite' : undefined,
        transform: !rolling
          ? (justSettled ? 'rotateX(0deg) rotateY(0deg) scale(1.16)' : 'rotateX(0deg) rotateY(0deg) scale(1)')
          : undefined,
        transition: !rolling ? 'transform 240ms cubic-bezier(0.34,1.56,0.64,1)' : undefined,
      } as React.CSSProperties}>
        {/* Front face — always shows the live rolled value, so the die "lands" on the right number with zero orientation math. */}
        <div style={{ ...DIE_FACE_BASE, transform: 'translateZ(29px)' } as React.CSSProperties}>
          <DiePips value={value} />
          <div style={{ position: 'absolute', top: 3, left: 3, right: '55%', bottom: '55%', borderRadius: 12, background: 'linear-gradient(135deg, rgba(255,255,255,0.85), transparent)', pointerEvents: 'none' }} />
        </div>
        {/* Five decorative faces — fixed numbers so the cube reads as a real die from every angle mid-tumble. */}
        <div style={{ ...DIE_FACE_BASE, transform: 'rotateY(180deg) translateZ(29px)' } as React.CSSProperties}><DiePips value={6} /></div>
        <div style={{ ...DIE_FACE_BASE, transform: 'rotateY(90deg) translateZ(29px)' } as React.CSSProperties}><DiePips value={2} /></div>
        <div style={{ ...DIE_FACE_BASE, transform: 'rotateY(-90deg) translateZ(29px)' } as React.CSSProperties}><DiePips value={5} /></div>
        <div style={{ ...DIE_FACE_BASE, transform: 'rotateX(90deg) translateZ(29px)' } as React.CSSProperties}><DiePips value={3} /></div>
        <div style={{ ...DIE_FACE_BASE, transform: 'rotateX(-90deg) translateZ(29px)' } as React.CSSProperties}><DiePips value={4} /></div>
      </div>
      <style>{`
        @keyframes ludoDieTumble3D {
          0%   { transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg); }
          25%  { transform: rotateX(180deg) rotateY(90deg) rotateZ(10deg); }
          50%  { transform: rotateX(360deg) rotateY(180deg) rotateZ(0deg); }
          75%  { transform: rotateX(540deg) rotateY(270deg) rotateZ(-10deg); }
          100% { transform: rotateX(720deg) rotateY(360deg) rotateZ(0deg); }
        }
      `}</style>
    </div>
  )
}

/** A short confetti burst for Ludo's victory moment — its own effect, not shared with any quiz game's win screen. */
function LudoConfetti({ colors }: { colors: string[] }) {
  const pieces = useMemo(() => Array.from({ length: 34 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    delay: Math.random() * 0.4,
    duration: 1.5 + Math.random() * 1.2,
    color: colors[i % colors.length],
    size: 5 + Math.random() * 6,
    shape: i % 4 === 0 ? 'star' : 'rect',
  })), [colors])
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', borderRadius: 26 }}>
      <style>{`
        @keyframes ludoConfettiFall { 0% { transform: translateY(-20px) rotate(0deg); opacity: 1; } 100% { transform: translateY(380px) rotate(620deg); opacity: 0; } }
        @keyframes ludoRingPulse { 0% { transform: scale(0.6); opacity: 0.8; } 100% { transform: scale(2.4); opacity: 0; } }
      `}</style>
      {[0, 0.35, 0.7].map((d) => (
        <span key={d} style={{
          position: 'absolute', top: '38%', left: '50%', width: 90, height: 90, marginLeft: -45, marginTop: -45,
          borderRadius: '50%', border: `2px solid ${colors[0]}80`, animation: `ludoRingPulse 1.8s ease-out ${d}s infinite`,
        }} />
      ))}
      {pieces.map((p) => (
        <span key={p.id} style={{
          position: 'absolute', top: 0, left: `${p.left}%`,
          width: p.shape === 'star' ? p.size * 1.4 : p.size, height: p.shape === 'star' ? p.size * 1.4 : p.size * 0.6,
          background: p.shape === 'star' ? 'transparent' : p.color,
          color: p.color, fontSize: p.size * 1.4, lineHeight: 1,
          borderRadius: 2,
          animation: `ludoConfettiFall ${p.duration}s ease-in ${p.delay}s forwards`,
        }}>{p.shape === 'star' ? '✦' : ''}</span>
      ))}
    </div>
  )
}

function LudoResultModal({ isAr, seats, result, meSeatIndex, onExit }: { isAr: boolean; seats: OnlineSeatLike[]; result: BoardGameResult; meSeatIndex: number | null; onExit: () => void }) {
  const ranked = [...seats].sort((a, b) => (result.rankings[a.seatIndex] ?? 99) - (result.rankings[b.seatIndex] ?? 99))
  const medal = (rank: number) => (rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : '🏅')
  const winnerColor = SEAT_COLORS[ranked[0].seatIndex]
  const winnerColorDark = SEAT_COLORS_DARK[ranked[0].seatIndex]
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,3,15,0.82)', backdropFilter: 'blur(6px)', zIndex: 9200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div style={{
        position: 'relative', background: 'linear-gradient(165deg, rgba(24,22,46,0.96), rgba(13,13,31,0.98))', borderRadius: 26,
        padding: '32px 26px 26px', maxWidth: 340, width: '100%', border: `1px solid ${winnerColor}45`,
        boxShadow: `0 0 0 1px rgba(255,255,255,0.04), 0 30px 70px rgba(0,0,0,0.5), 0 0 90px ${winnerColor}30`,
        textAlign: 'center', overflow: 'hidden', fontFamily: "'Exo 2', 'Cairo', sans-serif",
      }}>
        <div style={{ position: 'absolute', top: -60, left: '50%', transform: 'translateX(-50%)', width: 240, height: 200, background: `radial-gradient(ellipse, ${winnerColor}35, transparent 70%)`, pointerEvents: 'none' }} />
        <LudoConfetti colors={SEAT_COLORS} />
        <div style={{
          position: 'relative', width: 84, height: 84, margin: '0 auto 14px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 42, background: `linear-gradient(160deg, ${winnerColor}, ${winnerColorDark})`,
          boxShadow: `0 10px 28px ${winnerColor}55, inset 0 2px 4px rgba(255,255,255,0.4)`,
          border: '3px solid rgba(255,255,255,0.85)',
          animation: 'ludoMedalPop 700ms cubic-bezier(0.34,1.56,0.64,1)',
        }}>
          <style>{`@keyframes ludoMedalPop { 0% { transform: scale(0) rotate(-25deg); opacity: 0; } 70% { transform: scale(1.15) rotate(6deg); opacity: 1; } 100% { transform: scale(1) rotate(0); } }`}</style>
          {medal(result.rankings[ranked[0].seatIndex])}
        </div>
        <p style={{ position: 'relative', margin: '0 0 4px', fontSize: 21, fontWeight: 900, letterSpacing: '0.01em', color: '#fff' }}>
          {ranked[0].seatIndex === meSeatIndex ? (isAr ? 'فزت!' : 'You Won!') : `${ranked[0].displayName} ${isAr ? 'فاز' : 'Wins'}`}
        </p>
        <p style={{ position: 'relative', margin: '0 0 22px', fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.4)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          {isAr ? 'النتائج النهائية' : 'Final Standings'}
        </p>
        <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 7, marginBottom: 24 }}>
          {ranked.map((s) => {
            const isWinner = s.seatIndex === ranked[0].seatIndex
            return (
              <div key={s.seatIndex} style={{
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 14,
                background: isWinner ? `linear-gradient(90deg, ${SEAT_COLORS[s.seatIndex]}22, transparent)` : 'rgba(255,255,255,0.04)',
                border: `1px solid ${isWinner ? `${SEAT_COLORS[s.seatIndex]}45` : 'rgba(255,255,255,0.06)'}`,
              }}>
                <span style={{ fontSize: 13, fontWeight: 800, width: 20, color: isWinner ? SEAT_COLORS[s.seatIndex] : 'rgba(255,255,255,0.35)' }}>#{result.rankings[s.seatIndex]}</span>
                <div style={{
                  width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                  background: `linear-gradient(145deg, ${SEAT_COLORS[s.seatIndex]}, ${SEAT_COLORS_DARK[s.seatIndex]})`,
                  border: '1.5px solid rgba(255,255,255,0.7)',
                }} />
                <span style={{ flex: 1, textAlign: 'start', fontSize: 13, fontWeight: 700, color: '#fff' }}>{s.seatIndex === meSeatIndex ? (isAr ? 'أنت' : 'You') : s.displayName}</span>
              </div>
            )
          })}
        </div>
        <button
          onClick={onExit}
          style={{
            position: 'relative', width: '100%', padding: '14px 0', borderRadius: 16, border: 'none',
            background: 'linear-gradient(135deg,#8b5cf6,#c084fc)', color: '#fff', fontWeight: 800, fontSize: 14.5,
            cursor: 'pointer', boxShadow: '0 10px 26px rgba(139,92,246,0.45), inset 0 1px 0 rgba(255,255,255,0.3)',
          }}
        >
          {isAr ? 'العب مرة أخرى' : 'Play Again'}
        </button>
      </div>
    </div>
  )
}

// ── Match History ────────────────────────────────────────────────────────

function LudoHistoryScreen({ isAr, userId, onWatchReplay }: {
  isAr: boolean
  userId: string
  onWatchReplay: (roomId: string) => void
}) {
  const [entries, setEntries] = useState<BoardGameHistoryEntry[] | null>(null)
  const [detail, setDetail] = useState<BoardGameMatchDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailOpen, setDetailOpen] = useState(false)

  useEffect(() => {
    let cancelled = false
    getMyBoardGameHistory(userId, 'ludo', 30).then((rows) => { if (!cancelled) setEntries(rows) })
    return () => { cancelled = true }
  }, [userId])

  const openDetail = async (roomId: string) => {
    setDetailOpen(true)
    setDetailLoading(true)
    const d = await getBoardGameMatchDetail(roomId)
    setDetailLoading(false)
    setDetail(d)
  }

  if (entries === null) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'rgba(var(--fg2-rgb),0.5)', fontSize: 13 }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</div>
  }

  return (
    <div style={{ padding: '8px 16px', maxWidth: 480, margin: '0 auto' }}>
      {entries.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px' }}>
          <p style={{ fontSize: 34, margin: '0 0 10px' }}>🎲</p>
          <p style={{ fontSize: 13, color: 'rgba(var(--fg2-rgb),0.5)', fontWeight: 600, lineHeight: 1.6 }}>
            {isAr ? 'لا توجد مباريات بعد.\nالعب أونلاين لبدء سجلك!' : 'No matches yet.\nPlay online to start your history!'}
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {entries.map((e) => {
            const won = e.player.final_rank === 1
            const dateStr = e.room.completed_at
              ? new Date(e.room.completed_at).toLocaleDateString(isAr ? 'ar' : 'en', { month: 'short', day: 'numeric' })
              : ''
            return (
              <button
                key={e.room.id}
                onClick={() => openDetail(e.room.id)}
                className="card"
                style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, textAlign: 'start', cursor: 'pointer', border: `1px solid ${won ? 'rgba(46,213,115,0.3)' : 'rgba(var(--fg-rgb),0.08)'}`, width: '100%' }}
              >
                <div style={{
                  width: 40, height: 40, borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  background: won ? 'rgba(46,213,115,0.14)' : 'rgba(var(--fg-rgb),0.05)', fontSize: 17, fontWeight: 900,
                  color: won ? '#2ed573' : 'rgba(var(--fg2-rgb),0.5)',
                }}>
                  {won ? '🥇' : `#${e.player.final_rank ?? '—'}`}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
                    {isAr ? 'مباراة لودو' : 'Ludo Match'} · {e.opponents.length + 1} {isAr ? 'لاعبين' : 'players'}
                  </p>
                  <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.45)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {isAr ? 'ضد' : 'vs'} {e.opponents.map((o) => o.displayName).join(', ') || (isAr ? 'لا أحد' : 'no one')} · {dateStr}
                  </p>
                </div>
                <div style={{ textAlign: 'end', flexShrink: 0 }}>
                  {e.coinsEarned > 0 && <p style={{ margin: 0, fontSize: 12, fontWeight: 800, color: '#f9ca24' }}>+{e.coinsEarned} 🪙</p>}
                  {e.xpEarned > 0 && <p style={{ margin: 0, fontSize: 10.5, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.5)' }}>+{e.xpEarned} XP</p>}
                </div>
              </button>
            )
          })}
        </div>
      )}

      {detailOpen && (
        <LudoMatchDetailModal
          isAr={isAr}
          loading={detailLoading}
          detail={detail}
          onClose={() => { setDetailOpen(false); setDetail(null) }}
          onWatchReplay={(roomId) => { setDetailOpen(false); setDetail(null); onWatchReplay(roomId) }}
        />
      )}
    </div>
  )
}

function LudoMatchDetailModal({ isAr, loading, detail, onClose, onWatchReplay }: {
  isAr: boolean
  loading: boolean
  detail: BoardGameMatchDetail | null
  onClose: () => void
  onWatchReplay: (roomId: string) => void
}) {
  const players = detail?.players ?? []
  const ranked = [...players].sort((a, b) => (a.final_rank ?? 99) - (b.final_rank ?? 99))
  const durationMin = detail?.room.started_at && detail?.room.completed_at
    ? Math.max(1, Math.round((new Date(detail.room.completed_at).getTime() - new Date(detail.room.started_at).getTime()) / 60000))
    : null

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(3,3,15,0.85)', zIndex: 9200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }} onClick={onClose}>
      <div
        style={{ background: '#0d0d1f', borderRadius: 20, padding: '24px 22px', maxWidth: 380, width: '100%', border: '1px solid rgba(124,58,237,0.3)', maxHeight: '80vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {loading || !detail ? (
          <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.5)', padding: '30px 0' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>
        ) : (
          <>
            <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 900, fontFamily: "'Exo 2', sans-serif", color: 'var(--foreground)' }}>
              {isAr ? 'تفاصيل المباراة' : 'Match Details'}
            </p>
            <p style={{ margin: '0 0 16px', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.45)' }}>
              {detail.room.completed_at
                ? new Date(detail.room.completed_at).toLocaleString(isAr ? 'ar' : 'en', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
                : ''}
              {durationMin !== null && ` · ${durationMin} ${isAr ? 'دقيقة' : 'min'}`}
              {' · '}{detail.moves.length} {isAr ? 'حركة' : 'moves'}
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 18 }}>
              {ranked.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', borderRadius: 12, background: p.final_rank === 1 ? 'rgba(249,202,36,0.1)' : 'rgba(var(--fg-rgb),0.04)' }}>
                  <span style={{ fontSize: 13, fontWeight: 800, width: 22, color: p.final_rank === 1 ? '#f9ca24' : 'rgba(var(--fg2-rgb),0.5)' }}>#{p.final_rank ?? '—'}</span>
                  <span style={{ width: 8, height: 8, borderRadius: 3, background: SEAT_COLORS[(p.seat_index ?? 0) % SEAT_COLORS.length] }} />
                  <span style={{ flex: 1, fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>{p.is_ai ? 'AI' : p.profile?.username ?? `${isAr ? 'لاعب' : 'Player'} ${(p.seat_index ?? 0) + 1}`}</span>
                  <span style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.45)' }}>{p.final_score ?? 0} {isAr ? 'نقطة' : 'pts'}</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => onWatchReplay(detail.room.id)}
                disabled={detail.moves.length === 0}
                style={{ flex: 1, padding: '12px 0', borderRadius: 14, border: 'none', background: detail.moves.length ? 'linear-gradient(135deg,#7c3aed,#9d6fff)' : 'rgba(var(--fg-rgb),0.08)', color: detail.moves.length ? '#fff' : 'rgba(var(--fg2-rgb),0.35)', fontWeight: 800, fontSize: 13, cursor: detail.moves.length ? 'pointer' : 'not-allowed' }}
              >
                {isAr ? '▶ مشاهدة الإعادة' : '▶ Watch Replay'}
              </button>
              <button onClick={onClose} style={{ padding: '12px 18px', borderRadius: 14, border: '1px solid rgba(var(--fg-rgb),0.12)', background: 'transparent', color: 'rgba(var(--fg2-rgb),0.6)', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                {isAr ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Match Replay — reconstructs the whole match frame-by-frame from the
// resulting_state snapshot stored on every move (see submit_board_game_move),
// so it never depends on the engine's RNG/logic staying identical forever.
// Reuses the exact same LudoBoard renderer as live play — the whole point of
// building it as a presentational component. ───────────────────────────────

function LudoReplayScreen({ isAr, roomId, onExit }: { isAr: boolean; roomId: string; onExit: () => void }) {
  const [detail, setDetail] = useState<BoardGameMatchDetail | null>(null)
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    let cancelled = false
    getBoardGameMatchDetail(roomId).then((d) => { if (!cancelled) setDetail(d) })
    return () => { cancelled = true }
  }, [roomId])

  const seats: BoardGameSeat[] = useMemo(() => {
    if (!detail) return []
    // A completed match's players always have a claimed (non-null) color —
    // seat_index only goes null pre-match, in the lobby (round-3 color
    // selection) — so the ?? 0 fallback below never actually triggers here.
    return [...detail.players]
      .sort((a, b) => (a.seat_index ?? 0) - (b.seat_index ?? 0))
      .map((p) => ({
        seatIndex: p.seat_index ?? 0,
        userId: p.user_id,
        displayName: p.is_ai ? 'AI' : p.profile?.username ?? `${isAr ? 'لاعب' : 'Player'} ${(p.seat_index ?? 0) + 1}`,
        isAI: p.is_ai,
        token: String(p.seat_index ?? 0),
      }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail])

  const frames = useMemo(() => {
    if (!detail || !seats.length) return [] as LudoState[]
    const initial = LudoEngine.createInitialState(seats)
    const rest = detail.moves
      .map((m) => m.resulting_state as unknown as LudoState)
      .filter((s): s is LudoState => !!s)
    return [initial, ...rest]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail, seats])

  const maxIndex = Math.max(0, frames.length - 1)
  const clampedIndex = Math.min(frameIndex, maxIndex)
  const state = frames[clampedIndex]

  useEffect(() => {
    if (!playing) return
    if (clampedIndex >= maxIndex) { setPlaying(false); return }
    const t = setTimeout(() => setFrameIndex((i) => Math.min(i + 1, maxIndex)), 900 / speed)
    return () => clearTimeout(t)
  }, [playing, clampedIndex, maxIndex, speed])

  if (!detail || !state) {
    return <div style={{ padding: 60, textAlign: 'center', color: 'rgba(var(--fg2-rgb),0.5)', fontSize: 13 }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</div>
  }

  const currentSeatIndex = LudoEngine.currentSeatIndex(state)
  const currentSeat = currentSeatIndex !== null ? seats[currentSeatIndex] ?? null : null
  const isLastFrame = clampedIndex === maxIndex
  const result = isLastFrame ? LudoEngine.checkGameOver(state) : null

  return (
    <div>
      <LudoBoard
        seats={seats}
        state={state}
        currentSeatIndex={currentSeatIndex}
        currentSeat={currentSeat}
        validMoves={[]}
        events={[]}
        result={result}
        isMyTurn={false}
        meSeatIndex={null}
        isAr={isAr}
        online
        modeLabel={isAr ? 'إعادة' : 'Replay'}
        onMove={() => {}}
        onExit={onExit}
      />
      <div style={{ maxWidth: 420, margin: '0 auto', padding: '0 14px 24px' }}>
        <input
          type="range"
          min={0}
          max={maxIndex}
          value={clampedIndex}
          onChange={(e) => { setPlaying(false); setFrameIndex(Number(e.target.value)) }}
          style={{ width: '100%', marginBottom: 10, accentColor: '#7c3aed' }}
        />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
          <button onClick={() => { setPlaying(false); setFrameIndex((i) => Math.max(0, i - 1)) }} style={replayBtnStyle}>⏮</button>
          <button onClick={() => setPlaying((p) => !p)} style={{ ...replayBtnStyle, width: 52, background: '#7c3aed', color: '#fff', border: 'none' }}>
            {playing ? '⏸' : '▶'}
          </button>
          <button onClick={() => { setPlaying(false); setFrameIndex((i) => Math.min(maxIndex, i + 1)) }} style={replayBtnStyle}>⏭</button>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            style={{ marginInlineStart: 8, padding: '8px 10px', borderRadius: 10, border: '1px solid rgba(var(--fg-rgb),0.15)', background: 'rgba(var(--fg-rgb),0.03)', color: 'var(--foreground)', fontSize: 12, fontWeight: 700 }}
          >
            {[0.5, 1, 2, 4].map((s) => <option key={s} value={s}>{s}×</option>)}
          </select>
        </div>
        <p style={{ textAlign: 'center', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)', marginTop: 8 }}>
          {isAr ? `الحركة ${clampedIndex} من ${maxIndex}` : `Move ${clampedIndex} of ${maxIndex}`}
        </p>
      </div>
    </div>
  )
}

const replayBtnStyle: React.CSSProperties = {
  width: 42, height: 42, borderRadius: '50%', border: '1px solid rgba(var(--fg-rgb),0.12)', background: 'rgba(var(--fg-rgb),0.04)',
  color: 'var(--foreground)', fontSize: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}
