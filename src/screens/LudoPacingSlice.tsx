import { useCallback, useMemo, useRef, useState } from 'react'
import type { Screen, Lang } from '../App'
import { primeSound } from '../lib/sound'
import { LudoEngine, type LudoState, type LudoPiece } from '../lib/boardgames/ludo/engine'
import { createLudoAI } from '../lib/boardgames/ludo/ai'
import { ludoSound } from '../lib/boardgames/ludo/sound'
import {
  BOARD_VIEWBOX, SEAT_COLORS, SEAT_COLORS_DARK, SEAT_LABELS_EN, SEAT_LABELS_AR,
  piecePixelPosition, yardRect, pathCells, homeStretchCells, centerTriangles,
} from '../lib/boardgames/ludo/geometry'
import { getPacing, loadLudoSpeed, saveLudoSpeed, sleep, type LudoSpeed, type LudoPacingTable } from '../lib/boardgames/ludo/pacing'
import type { BoardGameSeat } from '../lib/boardgames/types'

/**
 * Vertical slice — ONE complete, polished turn (dice → selection → move →
 * landing → capture/extra-turn feedback), running entirely on the real,
 * already-audited Ludo rules engine and AI. This exists to let the pacing
 * and visual language be approved on real devices (Safari included) before
 * the full board/match rebuild touches LudoScreen.tsx.
 *
 * Nothing here modifies engine.ts, ai.ts, or geometry.ts — this screen only
 * *drives* them through two hand-built board positions (same technique as
 * the engine's own test harness) so a capture + extra turn, and a genuine
 * AI piece choice, are both guaranteed to happen every run instead of
 * depending on luck.
 */

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
}

type Phase =
  | 'idle'
  | 'turnChange'
  | 'diceAnticipation'
  | 'diceRolling'
  | 'diceResult'
  | 'awaitingSelection'
  | 'aiThinking'
  | 'highlight'
  | 'moving'
  | 'landed'
  | 'capture'
  | 'homeEntry'
  | 'extraTurn'
  | 'nextTurnDelay'
  | 'finished'

interface DemoSeat {
  seatIndex: number
  isAI: boolean
}

interface RenderState {
  phase: Phase
  pieces: LudoPiece[]
  seats: DemoSeat[]
  activeSeatIndex: number
  diceValue: number | null
  eligible: string[]
  selectedPieceId: string | null
  captureSeatIndex: number | null
  extraTurn: boolean
  homeEntry: boolean
  finished: boolean
  log: string[]
}

const INITIAL_RENDER: RenderState = {
  phase: 'idle',
  pieces: [],
  seats: [
    { seatIndex: 0, isAI: false },
    { seatIndex: 1, isAI: true },
  ],
  activeSeatIndex: 0,
  diceValue: null,
  eligible: [],
  selectedPieceId: null,
  captureSeatIndex: null,
  extraTurn: false,
  homeEntry: false,
  finished: false,
  log: [],
}

function demoSeats(): BoardGameSeat[] {
  return [
    { seatIndex: 0, userId: 'you', displayName: 'You', isAI: false, token: '0' },
    { seatIndex: 1, userId: null, displayName: 'Player 2', isAI: true, aiDifficulty: 'medium', token: '1' },
  ]
}

/** Hand-built starting position: seat 0 one square from capturing seat 1 on a 3. Same construction technique the engine's own audit scripts use. */
function buildHumanScenario(): { state: LudoState; targetRoll: number } {
  const base = LudoEngine.createInitialState(demoSeats())
  const pieces: LudoPiece[] = [
    { seatIndex: 0, pieceIndex: 0, pathPos: 4 },
    { seatIndex: 0, pieceIndex: 1, pathPos: -1 },
    { seatIndex: 0, pieceIndex: 2, pathPos: -1 },
    { seatIndex: 0, pieceIndex: 3, pathPos: -1 },
    { seatIndex: 1, pieceIndex: 0, pathPos: 46 },
    { seatIndex: 1, pieceIndex: 1, pathPos: -1 },
    { seatIndex: 1, pieceIndex: 2, pathPos: -1 },
    { seatIndex: 1, pieceIndex: 3, pathPos: -1 },
  ]
  return { state: { ...base, pieces, turnSeatIndex: 0 }, targetRoll: 3 }
}

/** Hand-built position giving seat 1 (AI) two genuinely legal pieces to choose between. */
function buildAIScenario(): { state: LudoState; targetRoll: number } {
  const base = LudoEngine.createInitialState(demoSeats())
  const pieces: LudoPiece[] = [
    { seatIndex: 0, pieceIndex: 0, pathPos: -1 },
    { seatIndex: 0, pieceIndex: 1, pathPos: -1 },
    { seatIndex: 0, pieceIndex: 2, pathPos: -1 },
    { seatIndex: 0, pieceIndex: 3, pathPos: -1 },
    { seatIndex: 1, pieceIndex: 0, pathPos: 10 },
    { seatIndex: 1, pieceIndex: 1, pathPos: 20 },
    { seatIndex: 1, pieceIndex: 2, pathPos: -1 },
    { seatIndex: 1, pieceIndex: 3, pathPos: -1 },
  ]
  return { state: { ...base, pieces, turnSeatIndex: 1 }, targetRoll: 3 }
}

/** Rolls for real via the engine's own applyMove('roll') path, searching rngState seeds until the target face comes up — so the demo is deterministic without bypassing the real roll logic. */
function scriptedRoll(state: LudoState, seatIndex: number, target: number) {
  for (let seed = 0; seed < 8000; seed++) {
    const { state: rolled, events } = LudoEngine.applyMove({ ...state, rngState: seed, diceValue: null }, seatIndex, { type: 'roll' })
    const rollEvent = events.find((e) => e.type === 'diceRolled') as { value: number } | undefined
    if (rollEvent?.value === target) return { state: rolled, value: target }
  }
  const { state: rolled, events } = LudoEngine.applyMove({ ...state, diceValue: null }, seatIndex, { type: 'roll' })
  const rollEvent = events.find((e) => e.type === 'diceRolled') as unknown as { value: number }
  return { state: rolled, value: rollEvent.value }
}

const T = {
  en: {
    title: 'Ludo pacing preview', subtitle: 'One real turn at a time — testing pacing and visuals before the full rebuild',
    scenarioHuman: 'Human turn', scenarioHumanSub: 'Capture + extra turn',
    scenarioAI: 'AI turn', scenarioAISub: 'Piece selection pacing',
    speed: 'Speed', normal: 'Normal', fast: 'Fast', replay: 'Replay',
    you: 'You', player2: 'Player 2', ai: 'AI',
    yourTurn: 'Your turn', aiTurnLabel: "Player 2's turn",
    rolling: 'Rolling…', chooseAPiece: 'Choose a piece to move', aiChoosing: 'Player 2 is choosing…',
    moving: 'Moving…', landed: 'Landed', captured: 'Captured!', extraTurnMsg: 'Extra turn!', homeMsg: 'Home!',
    log: 'What happened',
  },
  ar: {
    title: 'معاينة إيقاع لودو', subtitle: 'دور حقيقي واحد في كل مرة — لاختبار الإيقاع والشكل قبل إعادة البناء الكاملة',
    scenarioHuman: 'دور اللاعب', scenarioHumanSub: 'أسر + دور إضافي',
    scenarioAI: 'دور الذكاء الاصطناعي', scenarioAISub: 'إيقاع اختيار القطعة',
    speed: 'السرعة', normal: 'عادية', fast: 'سريعة', replay: 'إعادة',
    you: 'أنت', player2: 'اللاعب 2', ai: 'ذكاء اصطناعي',
    yourTurn: 'دورك', aiTurnLabel: 'دور اللاعب 2',
    rolling: 'يرمي النرد…', chooseAPiece: 'اختر قطعة للتحريك', aiChoosing: 'اللاعب 2 يختار…',
    moving: 'تتحرك…', landed: 'وصلت', captured: 'أسر!', extraTurnMsg: 'دور إضافي!', homeMsg: 'وصلت للمنزل!',
    log: 'ماذا حدث',
  },
}

export default function LudoPacingSlice({ onNavigate, lang }: Props) {
  const isAr = lang === 'ar'
  const t = T[isAr ? 'ar' : 'en']
  const labels = isAr ? SEAT_LABELS_AR : SEAT_LABELS_EN

  const [speed, setSpeed] = useState<LudoSpeed>(() => loadLudoSpeed())
  const [running, setRunning] = useState(false)
  const [r, setR] = useState<RenderState>(INITIAL_RENDER)
  const selectionResolver = useRef<((pieceId: string) => void) | null>(null)

  const pacing: LudoPacingTable = useMemo(() => getPacing(speed), [speed])

  const changeSpeed = (s: LudoSpeed) => {
    setSpeed(s)
    saveLudoSpeed(s)
  }

  const runTurn = useCallback(async (initial: LudoState, seatIndex: number, isAI: boolean, targetRoll: number) => {
    const color = isAr ? labels[seatIndex] : labels[seatIndex]
    const seatName = seatIndex === 0 ? t.you : `${t.player2} (${t.ai})`

    setR({
      ...INITIAL_RENDER,
      phase: 'turnChange',
      pieces: initial.pieces,
      activeSeatIndex: seatIndex,
      log: [`${seatName} — ${isAr ? 'يبدأ الدور' : 'turn begins'}`],
    })
    await sleep(pacing.turnChange)

    setR((s) => ({ ...s, phase: 'diceAnticipation' }))
    await sleep(pacing.diceAnticipation)

    setR((s) => ({ ...s, phase: 'diceRolling' }))
    ludoSound.diceRattle()
    await sleep(pacing.diceRoll)

    const { state: rolledState, value: dice } = scriptedRoll(initial, seatIndex, targetRoll)
    ludoSound.diceSettle(dice)
    setR((s) => ({ ...s, phase: 'diceResult', diceValue: dice, log: [...s.log, `${seatName} ${isAr ? 'رمى' : 'rolled a'} ${dice}`] }))
    await sleep(pacing.diceResultHold)

    const validMoves = LudoEngine.getValidMoves(rolledState, seatIndex).filter((m) => m.type === 'move') as { type: 'move'; pieceId: string }[]
    const eligibleIds = validMoves.map((m) => m.pieceId)

    let chosenId: string
    if (isAI) {
      setR((s) => ({ ...s, phase: 'aiThinking', eligible: eligibleIds, log: [...s.log, `${seatName} ${isAr ? 'يفكر' : 'is thinking'}…`] }))
      await sleep(pacing.aiThinkPause)
      const move = createLudoAI('medium').chooseMove(rolledState, seatIndex, validMoves) as { type: 'move'; pieceId: string }
      chosenId = move.pieceId
    } else {
      setR((s) => ({ ...s, phase: 'awaitingSelection', eligible: eligibleIds }))
      chosenId = await new Promise<string>((resolve) => { selectionResolver.current = resolve })
    }

    const pIdx = Number(chosenId.split(':')[1])
    setR((s) => ({ ...s, phase: 'highlight', selectedPieceId: chosenId, log: [...s.log, `${seatName} ${isAr ? 'اختار قطعة' : 'selected piece'} ${pIdx + 1}`] }))
    await sleep(pacing.selectHighlight)

    const piece = rolledState.pieces.find((p) => p.seatIndex === seatIndex && p.pieceIndex === pIdx)!
    const fromBase = piece.pathPos === -1
    const path: number[] = fromBase ? [0] : Array.from({ length: dice }, (_, i) => piece.pathPos + i + 1)

    setR((s) => ({ ...s, phase: 'moving' }))
    for (const step of path) {
      ludoSound.pieceSlide()
      setR((s) => ({ ...s, pieces: s.pieces.map((p) => (p.seatIndex === seatIndex && p.pieceIndex === pIdx ? { ...p, pathPos: step } : p)) }))
      await sleep(pacing.perSquare)
    }

    const { state: nextState, events } = LudoEngine.applyMove(rolledState, seatIndex, { type: 'move', pieceId: chosenId })

    setR((s) => ({ ...s, phase: 'landed', log: [...s.log, `${seatName} ${isAr ? 'وصل إلى المربع' : 'landed on square'} ${path[path.length - 1]}`] }))
    await sleep(pacing.landingPause)

    const captureEvent = events.find((e) => e.type === 'pieceCaptured') as { capturedSeatIndex: number } | undefined
    const homeEvent = events.some((e) => e.type === 'pieceHome')
    const extraTurnGranted = nextState.turnSeatIndex === seatIndex && !nextState.gameOver

    if (captureEvent) {
      ludoSound.pieceCaptured()
      const capturedName = isAr ? labels[captureEvent.capturedSeatIndex] : labels[captureEvent.capturedSeatIndex]
      setR((s) => ({
        ...s, phase: 'capture', pieces: nextState.pieces, captureSeatIndex: captureEvent.capturedSeatIndex,
        log: [...s.log, `${isAr ? 'أسر قطعة' : 'Captured'} ${capturedName} — ${isAr ? 'عادت للمنزل' : 'sent home'}`],
      }))
      await sleep(pacing.captureFeedback)
    } else {
      setR((s) => ({ ...s, pieces: nextState.pieces }))
    }

    if (homeEvent) {
      ludoSound.pieceHome()
      setR((s) => ({ ...s, phase: 'homeEntry', log: [...s.log, `${seatName} ${isAr ? 'قطعة وصلت للمنزل' : 'reached home'}!`] }))
      await sleep(pacing.homeEntryFeedback)
    }

    if (extraTurnGranted) {
      setR((s) => ({ ...s, phase: 'extraTurn', extraTurn: true, log: [...s.log, `${seatName} ${isAr ? 'يحصل على دور إضافي — بسبب الأسر' : 'earns an extra turn — from the capture'}`] }))
      await sleep(pacing.extraTurnMessage)
    }

    setR((s) => ({ ...s, phase: 'nextTurnDelay' }))
    await sleep(pacing.nextTurnDelay)

    setR((s) => ({ ...s, phase: 'finished', finished: true }))
    setRunning(false)
    void color
  }, [isAr, labels, pacing, t.ai, t.player2, t.you])

  const play = useCallback(async (kind: 'human' | 'ai') => {
    if (running) return
    setRunning(true)
    if (kind === 'human') {
      const { state, targetRoll } = buildHumanScenario()
      await runTurn(state, 0, false, targetRoll)
    } else {
      const { state, targetRoll } = buildAIScenario()
      await runTurn(state, 1, true, targetRoll)
    }
  }, [running, runTurn])

  const selectPiece = (pieceId: string) => {
    if (r.phase !== 'awaitingSelection' || !r.eligible.includes(pieceId)) return
    selectionResolver.current?.(pieceId)
    selectionResolver.current = null
  }

  const statusText = (() => {
    switch (r.phase) {
      case 'diceAnticipation':
      case 'diceRolling': return t.rolling
      case 'awaitingSelection': return t.chooseAPiece
      case 'aiThinking': return t.aiChoosing
      case 'moving': return t.moving
      case 'landed': return t.landed
      case 'capture': return t.captured
      case 'extraTurn': return t.extraTurnMsg
      case 'homeEntry': return t.homeMsg
      default: return r.activeSeatIndex === 0 ? t.yourTurn : t.aiTurnLabel
    }
  })()

  return (
    <div style={{
      minHeight: '100dvh', paddingBottom: 32,
      background: 'radial-gradient(ellipse 120% 60% at 50% -10%, rgba(124,58,237,0.16), transparent 55%), var(--background)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '18px 16px 10px' }}>
        <button onClick={() => onNavigate('ludo')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground)', display: 'flex', padding: 6 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points={isAr ? '9,18 15,12 9,6' : '15,18 9,12 15,6'} />
          </svg>
        </button>
        <div>
          <p className={isAr ? 'font-cairo' : undefined} style={{ margin: 0, fontFamily: isAr ? undefined : "'Exo 2', sans-serif", fontSize: 18, fontWeight: 900, color: 'var(--foreground)' }}>
            {t.title}
          </p>
          <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)' }}>{t.subtitle}</p>
        </div>
      </div>

      <div style={{ padding: '0 16px', display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <ScenarioButton
          label={t.scenarioHuman} sub={t.scenarioHumanSub} color={SEAT_COLORS[0]}
          disabled={running} onClick={() => play('human')}
        />
        <ScenarioButton
          label={t.scenarioAI} sub={t.scenarioAISub} color={SEAT_COLORS[1]}
          disabled={running} onClick={() => play('ai')}
        />
        <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)' }}>{t.speed}</span>
          <SpeedPill active={speed === 'normal'} onClick={() => changeSpeed('normal')} label={t.normal} />
          <SpeedPill active={speed === 'fast'} onClick={() => changeSpeed('fast')} label={t.fast} />
        </div>
      </div>

      {r.phase !== 'idle' && (
        <div style={{ padding: '0 16px', display: 'flex', gap: 8, marginBottom: 14 }}>
          {r.seats.map((seat) => (
            <TurnRailCard
              key={seat.seatIndex}
              name={seat.seatIndex === 0 ? t.you : `${t.player2} (${t.ai})`}
              color={SEAT_COLORS[seat.seatIndex]}
              active={r.activeSeatIndex === seat.seatIndex}
              status={r.activeSeatIndex === seat.seatIndex ? statusText : ''}
            />
          ))}
        </div>
      )}

      <div style={{ padding: '0 16px', display: 'grid', gridTemplateColumns: 'minmax(0,1fr)', gap: 14 }}>
        <div dir="ltr" style={{ position: 'relative', maxWidth: 480, margin: '0 auto', width: '100%' }}>
          <LudoBoardMini pieces={r.pieces} selectedPieceId={r.selectedPieceId} eligible={r.eligible} phase={r.phase} onSelectPiece={selectPiece} />

          {(r.phase === 'diceAnticipation' || r.phase === 'diceRolling' || r.phase === 'diceResult') && (
            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)' }}>
              <PremiumDie value={r.diceValue} phase={r.phase === 'diceResult' ? 'result' : r.phase === 'diceRolling' ? 'rolling' : 'anticipation'} />
            </div>
          )}

          <FeedbackBanner phase={r.phase} isAr={isAr} activeColor={SEAT_COLORS[r.activeSeatIndex]} t={t} />
        </div>

        <LogPanel title={t.log} lines={r.log} />
      </div>

      {r.finished && (
        <div style={{ padding: '14px 16px 0', textAlign: 'center' }}>
          <button
            onClick={() => play(r.activeSeatIndex === 1 && r.seats.some((s) => s.isAI) ? 'ai' : 'human')}
            style={{
              background: 'rgba(124,58,237,0.18)', border: '1px solid rgba(124,58,237,0.35)', borderRadius: 12,
              padding: '10px 20px', color: '#c4b5fd', fontWeight: 700, fontSize: 13, cursor: 'pointer',
            }}
            onMouseDown={() => primeSound()}
          >
            {t.replay}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Small presentational pieces ──────────────────────────────────────────

function ScenarioButton({ label, sub, color, disabled, onClick }: { label: string; sub: string; color: string; disabled: boolean; onClick: () => void }) {
  return (
    <button
      disabled={disabled}
      onClick={() => { primeSound(); onClick() }}
      style={{
        flex: '1 1 200px', textAlign: 'start', background: 'rgba(255,255,255,0.04)', border: `1px solid ${color}55`,
        borderRadius: 14, padding: '12px 14px', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
        <span style={{ width: 10, height: 10, borderRadius: 999, background: color, display: 'inline-block' }} />
        <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--foreground)' }}>{label}</span>
      </div>
      <span style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.55)' }}>{sub}</span>
    </button>
  )
}

function SpeedPill({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11, fontWeight: 700, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
        background: active ? 'rgba(0,212,255,0.18)' : 'rgba(255,255,255,0.04)',
        border: `1px solid ${active ? 'rgba(0,212,255,0.4)' : 'rgba(var(--fg-rgb),0.1)'}`,
        color: active ? '#67e8f9' : 'rgba(var(--fg2-rgb),0.6)',
      }}
    >
      {label}
    </button>
  )
}

function TurnRailCard({ name, color, active, status }: { name: string; color: string; active: boolean; status: string }) {
  const initials = name.trim().slice(0, 1).toUpperCase()
  return (
    <div style={{
      flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 14,
      background: active ? `${color}1a` : 'rgba(255,255,255,0.03)',
      border: `1px solid ${active ? `${color}66` : 'rgba(var(--fg-rgb),0.08)'}`,
      transition: 'background 200ms ease, border-color 200ms ease',
    }}>
      <div style={{
        width: 34, height: 34, borderRadius: '50%', background: color, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, fontWeight: 900, color: '#0a0a18', flexShrink: 0,
        boxShadow: active ? `0 0 0 3px ${color}33` : 'none',
      }}>
        {initials}
      </div>
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</p>
        <p style={{ margin: 0, fontSize: 11, color: active ? color : 'rgba(var(--fg2-rgb),0.4)', minHeight: 14 }}>{active ? status : ''}</p>
      </div>
    </div>
  )
}

function LogPanel({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(var(--fg-rgb),0.08)', borderRadius: 14,
      padding: '12px 14px', maxWidth: 480, margin: '0 auto', width: '100%',
    }}>
      <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'rgba(var(--fg2-rgb),0.45)' }}>{title}</p>
      {lines.length === 0 ? (
        <p style={{ margin: 0, fontSize: 12, color: 'rgba(var(--fg2-rgb),0.4)' }}>—</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 160, overflowY: 'auto' }}>
          {lines.map((line, i) => (
            <p key={i} style={{ margin: 0, fontSize: 12, color: 'rgba(var(--fg2-rgb),0.75)' }}>{line}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function FeedbackBanner({ phase, isAr, activeColor, t }: { phase: Phase; isAr: boolean; activeColor: string; t: typeof T['en'] }) {
  let text: string | null = null
  if (phase === 'turnChange') text = null // turn rail already communicates this; avoid double banner noise
  if (phase === 'capture') text = t.captured
  if (phase === 'extraTurn') text = t.extraTurnMsg
  if (phase === 'homeEntry') text = t.homeMsg
  if (!text) return null
  return (
    <div
      key={phase}
      style={{
        position: 'absolute', top: 10, left: '50%', transform: 'translateX(-50%)',
        background: `${activeColor}22`, border: `1px solid ${activeColor}88`, color: 'var(--foreground)',
        borderRadius: 999, padding: '6px 16px', fontSize: 13, fontWeight: 800,
        animation: 'ludoSliceBannerIn 220ms ease-out', direction: isAr ? 'rtl' : 'ltr',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
      <style>{'@keyframes ludoSliceBannerIn { from { opacity:0; transform:translate(-50%,-6px);} to { opacity:1; transform:translate(-50%,0);} }'}</style>
    </div>
  )
}

// ── Board (real geometry, fresh premium skin) ────────────────────────────

function LudoBoardMini({
  pieces, selectedPieceId, eligible, phase, onSelectPiece,
}: {
  pieces: LudoPiece[]
  selectedPieceId: string | null
  eligible: string[]
  phase: Phase
  onSelectPiece: (pieceId: string) => void
}) {
  const cells = useMemo(() => pathCells((i) => SAFE.has(i), [0, 13, 26, 39]), [])
  const stretches = useMemo(() => homeStretchCells(), [])
  const triangles = useMemo(() => centerTriangles(), [])

  return (
    <svg viewBox={`0 0 ${BOARD_VIEWBOX} ${BOARD_VIEWBOX}`} style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 20, overflow: 'visible' }}>
      <defs>
        <radialGradient id="ludoSliceBoardBg" cx="50%" cy="30%" r="80%">
          <stop offset="0%" stopColor="#2a2440" />
          <stop offset="100%" stopColor="#161226" />
        </radialGradient>
        {SEAT_COLORS.map((c, i) => (
          <radialGradient key={i} id={`ludoSlicePiece${i}`} cx="35%" cy="30%" r="70%">
            <stop offset="0%" stopColor={lighten(c)} />
            <stop offset="100%" stopColor={SEAT_COLORS_DARK[i]} />
          </radialGradient>
        ))}
      </defs>

      <rect x={0} y={0} width={BOARD_VIEWBOX} height={BOARD_VIEWBOX} rx={24} fill="url(#ludoSliceBoardBg)" />

      {[0, 1, 2, 3].map((seatIndex) => {
        const rect = yardRect(seatIndex)
        return (
          <rect key={seatIndex} x={rect.x + 4} y={rect.y + 4} width={rect.w - 8} height={rect.h - 8} rx={16}
            fill={`${SEAT_COLORS[seatIndex]}1f`} stroke={`${SEAT_COLORS[seatIndex]}55`} strokeWidth={1.5} />
        )
      })}

      {cells.map((c) => (
        <g key={c.index}>
          <rect x={c.x - 17} y={c.y - 17} width={34} height={34} rx={8}
            fill={c.isSafe ? 'rgba(255,215,0,0.12)' : 'rgba(255,255,255,0.05)'}
            stroke={c.isSafe ? 'rgba(255,215,0,0.4)' : 'rgba(255,255,255,0.08)'} strokeWidth={1} />
          {c.isSafe && (
            <text x={c.x} y={c.y + 4} textAnchor="middle" fontSize={14} fill="rgba(255,215,0,0.75)">★</text>
          )}
        </g>
      ))}

      {stretches.map((c, i) => (
        <rect key={i} x={c.x - 17} y={c.y - 17} width={34} height={34} rx={8}
          fill={`${SEAT_COLORS[c.seatIndex]}33`} stroke={`${SEAT_COLORS[c.seatIndex]}66`} strokeWidth={1} />
      ))}

      {triangles.map((tri) => (
        <polygon key={tri.seatIndex} points={tri.points} fill={`${SEAT_COLORS[tri.seatIndex]}44`} stroke={`${SEAT_COLORS[tri.seatIndex]}77`} strokeWidth={1} />
      ))}

      {pieces.map((p) => {
        const id = `${p.seatIndex}:${p.pieceIndex}`
        const pos = piecePixelPosition(p.seatIndex, p.pieceIndex, p.pathPos)
        const isEligible = eligible.includes(id) && (phase === 'awaitingSelection')
        const isSelected = selectedPieceId === id && (phase === 'highlight' || phase === 'moving')
        return (
          <g
            key={id}
            transform={`translate(${pos.x},${pos.y})`}
            style={{ transition: 'transform 180ms ease', cursor: isEligible ? 'pointer' : 'default' }}
            onClick={() => isEligible && onSelectPiece(id)}
          >
            {isEligible && (
              <circle r={15} fill="none" stroke={SEAT_COLORS[p.seatIndex]} strokeWidth={2} opacity={0.8}>
                <animate attributeName="r" values="13;17;13" dur="1.1s" repeatCount="indefinite" />
                <animate attributeName="opacity" values="0.9;0.15;0.9" dur="1.1s" repeatCount="indefinite" />
              </circle>
            )}
            {isSelected && <circle r={16} fill="none" stroke="#fff" strokeWidth={2} opacity={0.9} />}
            <ellipse cx={0} cy={9} rx={9} ry={3.5} fill="rgba(0,0,0,0.35)" />
            <path d={domePath(11)} fill={`url(#ludoSlicePiece${p.seatIndex})`} stroke="rgba(0,0,0,0.25)" strokeWidth={0.75} />
            <ellipse cx={-3.5} cy={-6} rx={3.2} ry={2} fill="rgba(255,255,255,0.55)" />
          </g>
        )
      })}
    </svg>
  )
}

const SAFE = new Set([0, 8, 13, 21, 26, 34, 39, 47])

function domePath(r: number): string {
  const baseW = r * 0.62
  const baseY = r * 0.98
  return `M ${-r} 0 A ${r} ${r} 0 0 1 ${r} 0 L ${baseW} ${baseY} A ${baseW} ${r * 0.3} 0 0 1 ${-baseW} ${baseY} Z`
}

function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16)
  const r = Math.min(255, ((n >> 16) & 255) + 60)
  const g = Math.min(255, ((n >> 8) & 255) + 60)
  const b = Math.min(255, (n & 255) + 60)
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`
}

// ── Premium die: real 6-face cube, WebKit-safe, with 2D fallback ─────────

const DIE_PIP_LAYOUTS: Record<number, [number, number][]> = {
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
}

function DiePips({ value }: { value: number }) {
  const pips = DIE_PIP_LAYOUTS[value] ?? []
  return (
    <>
      {pips.map(([px, py], i) => (
        <div key={i} style={{
          position: 'absolute', width: 8, height: 8, borderRadius: '50%',
          background: 'radial-gradient(circle at 35% 30%, #b8863a, #7a5320)',
          left: `calc(50% + ${px * 13}px - 4px)`, top: `calc(50% + ${py * 13}px - 4px)`,
        }} />
      ))}
    </>
  )
}

const DIE_FACE_BASE: React.CSSProperties = {
  position: 'absolute', width: 48, height: 48, borderRadius: 8,
  background: 'linear-gradient(135deg, #fdf8ec, #f0e6cf)',
  border: '1px solid rgba(0,0,0,0.08)',
  boxShadow: 'inset 0 1px 3px rgba(255,255,255,0.6), inset 0 -2px 4px rgba(0,0,0,0.06)',
  backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden',
}

function PremiumDie({ value, phase }: { value: number | null; phase: 'anticipation' | 'rolling' | 'result' }) {
  const [safe2D] = useState<boolean>(() => {
    try {
      const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      const supports = typeof CSS !== 'undefined' && CSS.supports?.('transform-style', 'preserve-3d') && CSS.supports?.('backface-visibility', 'hidden')
      return !!reduced || !supports
    } catch {
      return true
    }
  })

  const rolling = phase === 'rolling'
  const shown = value ?? 1

  if (safe2D) {
    return (
      <div style={{
        width: 52, height: 52, borderRadius: 10, background: 'linear-gradient(135deg, #fdf8ec, #f0e6cf)',
        border: '1px solid rgba(0,0,0,0.08)', boxShadow: '0 6px 14px rgba(0,0,0,0.35)', position: 'relative',
        animation: rolling ? 'ludoSliceDie2DSpin 480ms linear infinite' : phase === 'anticipation' ? 'ludoSliceDieWobble 300ms ease-in-out infinite' : undefined,
      }}>
        <DiePips value={shown} />
        <style>{`
          @keyframes ludoSliceDie2DSpin { from { transform: rotate(0deg) scale(1); } to { transform: rotate(360deg) scale(1); } }
          @keyframes ludoSliceDieWobble { 0%,100% { transform: rotate(-4deg); } 50% { transform: rotate(4deg); } }
        `}</style>
      </div>
    )
  }

  return (
    <div style={{ width: 52, height: 52, perspective: 300, WebkitPerspective: 300 }}>
      <div style={{
        position: 'relative', width: 48, height: 48, margin: '2px auto',
        transformStyle: 'preserve-3d', WebkitTransformStyle: 'preserve-3d', willChange: 'transform',
        animation: rolling ? 'ludoSliceDieTumble 620ms linear infinite' : phase === 'anticipation' ? 'ludoSliceDieWobble3D 300ms ease-in-out infinite' : undefined,
        transform: !rolling && phase === 'result' ? 'rotateX(0deg) rotateY(0deg)' : undefined,
        transition: !rolling ? 'transform 220ms ease-out' : undefined,
      }}>
        <div style={{ ...DIE_FACE_BASE, transform: 'translateZ(24px)' }}><DiePips value={shown} /></div>
        <div style={{ ...DIE_FACE_BASE, transform: 'rotateY(180deg) translateZ(24px)' }}><DiePips value={7 - shown} /></div>
        <div style={{ ...DIE_FACE_BASE, transform: 'rotateY(90deg) translateZ(24px)' }}><DiePips value={2} /></div>
        <div style={{ ...DIE_FACE_BASE, transform: 'rotateY(-90deg) translateZ(24px)' }}><DiePips value={5} /></div>
        <div style={{ ...DIE_FACE_BASE, transform: 'rotateX(90deg) translateZ(24px)' }}><DiePips value={3} /></div>
        <div style={{ ...DIE_FACE_BASE, transform: 'rotateX(-90deg) translateZ(24px)' }}><DiePips value={4} /></div>
      </div>
      <style>{`
        @keyframes ludoSliceDieTumble { from { transform: rotateX(0) rotateY(0); } to { transform: rotateX(720deg) rotateY(1080deg); } }
        @keyframes ludoSliceDieWobble3D { 0%,100% { transform: rotateZ(-3deg); } 50% { transform: rotateZ(3deg); } }
      `}</style>
    </div>
  )
}
