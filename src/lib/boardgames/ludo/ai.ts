import type { BoardGameAI, AIDifficulty } from '../types'
import { LudoEngine, isSafeGlobalCell, pieceGlobalCell, type LudoState, type LudoMove } from './engine'

/**
 * Ludo AI opponent — a heuristic move-scorer, not a search algorithm (Ludo's
 * dice randomness makes deep search low-value). Each difficulty tunes how
 * often the AI picks the best-scored move vs. a random legal one, which is
 * a simple, cheap way to get a believable difficulty curve without
 * maintaining three separate strategies.
 *
 * This module is Ludo-specific by design — a future game's AI (Chess,
 * Checkers, …) would live in its own file with its own strategy. Only the
 * BoardGameAI<TState, TMove> shape is shared.
 */

const RANDOM_MOVE_CHANCE: Record<AIDifficulty, number> = { easy: 0.55, medium: 0.22, hard: 0.05 }

function scoreMove(state: LudoState, seatIndex: number, move: LudoMove): number {
  if (move.type === 'roll') return 0 // rolling is never optional, scoring is irrelevant

  const { state: after, events } = LudoEngine.applyMove(state, seatIndex, move)
  let score = 0

  const captures = events.filter((e) => e.type === 'pieceCaptured').length
  score += captures * 60

  const wentHome = events.some((e) => e.type === 'pieceHome')
  if (wentHome) score += 45

  const [pSeatStr, pIndexStr] = move.pieceId.split(':')
  const beforePiece = state.pieces.find((p) => p.seatIndex === Number(pSeatStr) && p.pieceIndex === Number(pIndexStr))!
  const afterPiece = after.pieces.find((p) => p.seatIndex === Number(pSeatStr) && p.pieceIndex === Number(pIndexStr))!

  const leftBase = beforePiece.pathPos === -1 && afterPiece.pathPos !== -1
  if (leftBase) score += 25

  // Prefer landing on a safe cell; mildly avoid sitting exposed on the ring.
  const cell = pieceGlobalCell(seatIndex, afterPiece.pathPos)
  if (cell !== null) {
    if (isSafeGlobalCell(cell)) score += 8
    else score -= 3
  }

  // Small bias toward advancing the piece that's furthest along, so the AI
  // doesn't dither between pieces forever.
  score += Math.max(0, afterPiece.pathPos) * 0.3

  // Being captured this turn is impossible to predict without opponents'
  // exact future rolls, so we don't attempt threat modeling here — kept
  // deliberately simple per Phase A scope.
  return score
}

export function createLudoAI(difficulty: AIDifficulty): BoardGameAI<LudoState, LudoMove> {
  return {
    difficulty,
    chooseMove(state, seatIndex, validMoves) {
      if (validMoves.length === 1) return validMoves[0]
      if (validMoves[0]?.type === 'roll') return validMoves[0]

      if (Math.random() < RANDOM_MOVE_CHANCE[difficulty]) {
        return validMoves[Math.floor(Math.random() * validMoves.length)]
      }

      let best: LudoMove = validMoves[0]
      let bestScore = -Infinity
      for (const move of validMoves) {
        const s = scoreMove(state, seatIndex, move)
        if (s > bestScore) { bestScore = s; best = move }
      }
      return best
    },
  }
}
