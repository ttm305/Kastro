import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardGameAI, BoardGameEngine, BoardGameEvent, BoardGameResult, BoardGameSeat } from './types'

/**
 * Generic local match controller — drives ANY BoardGameEngine through a full
 * match for local pass-and-play and/or vs-AI play, with zero game-specific
 * code. This is the reusable "Phase A" runtime every board game plugs into;
 * the online-room version (Phase B) wraps the same engine + AI modules
 * around realtime state sync instead of local React state, so a game only
 * ever needs to be taught to this hook once and both modes work.
 *
 * Responsibilities shared across all games:
 *  - advancing turns
 *  - auto-playing AI seats (with a short "thinking" delay so it doesn't
 *    feel instant/robotic)
 *  - auto-passing a seat that has zero legal moves
 *  - collecting the event stream for the UI to animate
 *  - surfacing the final BoardGameResult once the game ends
 */
export function useLocalBoardGame<TState, TMove>(args: {
  engine: BoardGameEngine<TState, TMove>
  seats: BoardGameSeat[]
  ai?: BoardGameAI<TState, TMove>
  aiThinkDelayMs?: number
}) {
  const { engine, seats, ai, aiThinkDelayMs = 650 } = args

  const [state, setState] = useState<TState>(() => engine.createInitialState(seats))
  const [events, setEvents] = useState<BoardGameEvent[]>([])
  const [result, setResult] = useState<BoardGameResult | null>(null)
  const [turnCount, setTurnCount] = useState(0)
  const aiTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const currentSeatIndex = engine.currentSeatIndex(state)
  const currentSeat = currentSeatIndex !== null ? seats[currentSeatIndex] : null
  const validMoves = currentSeatIndex !== null ? engine.getValidMoves(state, currentSeatIndex) : []

  const reset = useCallback(() => {
    if (aiTimerRef.current) clearTimeout(aiTimerRef.current)
    setState(engine.createInitialState(seats))
    setEvents([])
    setResult(null)
    setTurnCount(0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const commitMove = useCallback((seatIndex: number, move: TMove | null) => {
    setState((prev) => {
      const { state: next, events: newEvents } = engine.applyMove(prev, seatIndex, move)
      setEvents((e) => [...e, ...newEvents].slice(-40))
      const over = engine.checkGameOver(next)
      if (over) setResult(over)
      return next
    })
    setTurnCount((t) => t + 1)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Called by the UI when a human player picks a move. Ignored if it isn't actually their turn or the move isn't legal. */
  const submitMove = useCallback((move: TMove) => {
    if (currentSeatIndex === null || result) return
    const seat = seats[currentSeatIndex]
    if (seat.isAI) return
    const legal = engine.getValidMoves(state, currentSeatIndex)
    const isLegal = legal.some((m) => JSON.stringify(m) === JSON.stringify(move))
    if (!isLegal) return
    commitMove(currentSeatIndex, move)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSeatIndex, seats, state, result, commitMove])

  // Auto-pass a seat with zero legal moves (human or AI) — no game needs to
  // special-case this on its own.
  //
  // `turnCount` is included purely as a "decision changed" signal: it
  // increments on every single commitMove call, so it's guaranteed to
  // differ across any two distinct game states. Without it, two DIFFERENT
  // decision points that happen to share the same (currentSeatIndex,
  // validMoves.length, result) triple — e.g. a roll-phase with exactly one
  // legal move (the roll itself) immediately followed by a move-phase with
  // exactly one legal move (a single forced piece) — are indistinguishable
  // to React's dependency comparison, so the effect silently fails to
  // re-fire and the turn freezes forever. This bit any AI or auto-pass
  // seat, not just Ludo, since it lives in the shared local-match
  // controller.
  useEffect(() => {
    if (result || currentSeatIndex === null) return
    if (validMoves.length === 0) {
      const t = setTimeout(() => commitMove(currentSeatIndex, null), 400)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSeatIndex, validMoves.length, result, turnCount])

  // Auto-play AI seats. See the comment above the auto-pass effect for why
  // `turnCount` must be a dependency here too.
  useEffect(() => {
    if (result || currentSeatIndex === null || !currentSeat?.isAI) return
    if (validMoves.length === 0) return // handled by the auto-pass effect above
    if (!ai) return
    aiTimerRef.current = setTimeout(() => {
      const move = ai.chooseMove(state, currentSeatIndex, validMoves)
      commitMove(currentSeatIndex, move)
    }, aiThinkDelayMs)
    return () => { if (aiTimerRef.current) clearTimeout(aiTimerRef.current) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSeatIndex, currentSeat?.isAI, validMoves.length, result, aiThinkDelayMs, turnCount])

  return {
    state,
    seats,
    currentSeatIndex,
    currentSeat,
    validMoves,
    events,
    result,
    turnCount,
    submitMove,
    reset,
  }
}
