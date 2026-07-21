import type { BoardGameAI, AIDifficulty } from '../types'
import { LudoEngine, isSafeGlobalCell, pieceGlobalCell, LUDO_FINISHED, type LudoState, type LudoMove } from './engine'

/**
 * Ludo AI opponent — deterministic priority-order move selection, per the
 * exact spec:
 *   1. Capture an opponent
 *   2. Finish a token at home
 *   3. Enter the safe home lane
 *   4. Move to a safe square
 *   5. Release a new token after rolling 6, when no higher-priority move exists
 *   6. Move the most advanced token
 *   7. Otherwise, choose a valid move
 *
 * No randomness is involved at any difficulty — the spec defines one
 * authoritative policy, not a tunable strength curve. `difficulty` is kept
 * on the returned object only because the shared BoardGameAI<TState,TMove>
 * contract requires it and the seat-setup UI labels AI seats by it; it no
 * longer perturbs move choice.
 *
 * This module is Ludo-specific by design — a future game's AI (Chess,
 * Checkers, …) would live in its own file with its own strategy. Only the
 * BoardGameAI<TState, TMove> shape is shared.
 */

interface ClassifiedMove {
  move: LudoMove
  tier: number // 1 = highest priority (capture) … 6 = fallback (most-advanced / otherwise)
  pathPosBefore: number
}

function classify(state: LudoState, seatIndex: number, move: Extract<LudoMove, { type: 'move' }>): ClassifiedMove {
  const [pSeatStr, pIndexStr] = move.pieceId.split(':')
  const before = state.pieces.find((p) => p.seatIndex === Number(pSeatStr) && p.pieceIndex === Number(pIndexStr))!
  const { state: after, events } = LudoEngine.applyMove(state, seatIndex, move)
  const afterPiece = after.pieces.find((p) => p.seatIndex === Number(pSeatStr) && p.pieceIndex === Number(pIndexStr))!

  const captured = events.some((e) => e.type === 'pieceCaptured')
  const finished = afterPiece.pathPos === LUDO_FINISHED
  const enteredHomeLane = before.pathPos < 51 && afterPiece.pathPos >= 51 && !finished
  const landedCell = pieceGlobalCell(seatIndex, afterPiece.pathPos)
  const landedSafe = landedCell !== null && isSafeGlobalCell(landedCell)
  const releasedFromBase = before.pathPos === -1 && afterPiece.pathPos !== -1

  let tier = 6 // "most advanced token" / "otherwise" fallback
  if (captured) tier = 1
  else if (finished) tier = 2
  else if (enteredHomeLane) tier = 3
  else if (landedSafe) tier = 4
  else if (releasedFromBase) tier = 5

  return { move, tier, pathPosBefore: before.pathPos }
}

export function createLudoAI(difficulty: AIDifficulty): BoardGameAI<LudoState, LudoMove> {
  return {
    difficulty,
    chooseMove(state, seatIndex, validMoves) {
      if (validMoves.length === 1) return validMoves[0]
      if (validMoves[0]?.type === 'roll') return validMoves[0]

      // Every remaining validMoves entry is a 'move' (Ludo never mixes 'roll'
      // with 'move' options in the same getValidMoves call — the 'roll'
      // case above already returned), so this narrowing is safe.
      const moveOnly = validMoves.filter((m): m is Extract<LudoMove, { type: 'move' }> => m.type === 'move')
      const classified = moveOnly.map((m) => classify(state, seatIndex, m))
      const bestTier = Math.min(...classified.map((c) => c.tier))
      const candidates = classified.filter((c) => c.tier === bestTier)

      // Tie-break within a tier (and resolve tier 6's "most advanced token /
      // otherwise" together) by preferring the piece furthest along its path
      // — a stable, deterministic choice with no randomness.
      candidates.sort((a, b) => b.pathPosBefore - a.pathPosBefore)
      return candidates[0].move
    },
  }
}
