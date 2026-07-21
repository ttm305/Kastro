import type { BoardGameEngine, BoardGameEvent, BoardGameResult, BoardGameSeat } from '../types'

/**
 * Ludo rules engine — a pure, deterministic module implementing the shared
 * BoardGameEngine<LudoState, LudoMove> contract. Nothing here knows about
 * React, Supabase, or rendering; it only knows Ludo's rules. This is the
 * template future board games (UNO, Chess, Checkers, Connect 4,
 * Backgammon…) follow: one file like this + one AI module + one screen.
 *
 * BOARD MODEL
 * ───────────
 * Each seat's piece has a single `pathPos` number:
 *   -1        piece is still in its base (yard), not yet in play
 *   0..50     on the shared 52-cell outer ring, 51 steps of travel
 *             (global ring cell = (seat's start offset + pathPos) % 52)
 *   51..56    in that seat's private 6-cell home stretch (never shared)
 *   57        finished (home) — piece is out of play, safe forever
 *
 * Seat start offsets are spaced 13 apart around the 52-cell ring (52 / 4),
 * matching a standard Ludo board's 4 colored entry points. Safe cells are
 * the 4 entry points plus 4 "star" cells 8 steps after each — the standard
 * 8-square safe-cell layout.
 */

export const LUDO_RING_LENGTH = 52
export const LUDO_HOME_STRETCH = 6

// Path length: 51 ring steps (0..50) + 6 home-stretch cells (51..56) = piece
// is "finished" once pathPos reaches 56. Kept as a named constant so the
// off-by-one is defined in exactly one place.
export const LUDO_FINISHED = 56

const START_OFFSETS = [0, 13, 26, 39] // ring cell where each seat's pieces enter
const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47])
const PIECES_PER_SEAT = 4
const MAX_CONSECUTIVE_SIXES = 3

export interface LudoPiece {
  seatIndex: number
  pieceIndex: number // 0..3, this seat's piece slot
  pathPos: number // -1 base, 0..50 ring, 51..56 home stretch/finished
}

export interface LudoState {
  numSeats: number
  pieces: LudoPiece[] // numSeats * 4
  turnSeatIndex: number
  diceValue: number | null
  consecutiveSixes: number
  finishedOrder: number[] // seatIndex, in the order they completed all 4 pieces
  activeSeatIndices: number[] // seats still playing (not yet finished, not eliminated)
  rngState: number
  gameOver: boolean
  /**
   * Per-seat count of pieces sent back to base by an opponent, tracked
   * deterministically in state (never capped/dropped, unlike the UI's
   * animation event stream) so it's safe to use for match-end facts like a
   * "won without losing a single piece" achievement.
   */
  piecesLostCount: Record<number, number>
}

export type LudoMove = { type: 'roll' } | { type: 'move'; pieceId: string }

export function pieceId(seatIndex: number, pieceIndex: number) {
  return `${seatIndex}:${pieceIndex}`
}

function nextRng(state: number): { value: number; next: number } {
  // Small deterministic LCG — good enough for a dice roll, and keeps the
  // engine pure (same seed always replays identically, which matters once
  // Phase B needs server-authoritative moves and Phase C wants replay/match
  // history). Math.imul keeps the multiply inside 32-bit integer math —
  // plain `*` silently loses precision here (state * 1103515245 exceeds
  // Number.MAX_SAFE_INTEGER's exact-integer range) and produces a
  // degenerate, barely-random sequence.
  const next = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff
  return { value: next, next }
}

function rollDie(rngState: number): { die: number; next: number } {
  const { value, next } = nextRng(rngState)
  return { die: (value % 6) + 1, next }
}

function globalRingCell(seatIndex: number, pathPos: number): number | null {
  if (pathPos < 0 || pathPos > 50) return null
  return (START_OFFSETS[seatIndex] + pathPos) % LUDO_RING_LENGTH
}

function nextActiveSeat(state: LudoState, from: number): number {
  const order = state.activeSeatIndices
  if (order.length === 0) return from
  const idx = order.indexOf(from)
  const nextIdx = (idx + 1) % order.length
  return order[nextIdx]
}

function seatFinishedAllPieces(state: LudoState, seatIndex: number): boolean {
  return state.pieces.filter((p) => p.seatIndex === seatIndex).every((p) => p.pathPos === LUDO_FINISHED)
}

function clonePieces(pieces: LudoPiece[]): LudoPiece[] {
  return pieces.map((p) => ({ ...p }))
}

export const LudoEngine: BoardGameEngine<LudoState, LudoMove> = {
  gameKey: 'ludo',
  minPlayers: 2,
  maxPlayers: 4,

  createInitialState(seats: BoardGameSeat[]): LudoState {
    // Build pieces/activeSeatIndices from each seat's ACTUAL seatIndex
    // value, not its position in the array. For local pass-and-play these
    // are always identical (seats are auto-assigned 0..n-1 in order), so
    // this is a no-op there. It matters for the online match replay viewer,
    // which calls this with `seats` derived from the real (now possibly
    // sparse — e.g. {0,3} if that's what both players picked as their
    // colors) claimed seat_index values from board_game_players — using
    // array position there would silently reconstruct the wrong seats for
    // the pre-first-move replay frame. Same class of bug as the deadlock
    // fix earlier this round; fixed the same way, by using the real index
    // instead of a loop/array position.
    const numSeats = seats.length
    const pieces: LudoPiece[] = []
    for (const seat of seats) {
      for (let p = 0; p < PIECES_PER_SEAT; p++) {
        pieces.push({ seatIndex: seat.seatIndex, pieceIndex: p, pathPos: -1 })
      }
    }
    return {
      numSeats,
      pieces,
      turnSeatIndex: seats[0]?.seatIndex ?? 0,
      diceValue: null,
      consecutiveSixes: 0,
      finishedOrder: [],
      activeSeatIndices: seats.map((s) => s.seatIndex),
      rngState: Date.now() & 0x7fffffff,
      gameOver: false,
      piecesLostCount: Object.fromEntries(seats.map((s) => [s.seatIndex, 0])),
    }
  },

  currentSeatIndex(state) {
    return state.gameOver ? null : state.turnSeatIndex
  },

  getValidMoves(state, seatIndex) {
    if (state.gameOver || state.turnSeatIndex !== seatIndex) return []

    if (state.diceValue === null) {
      return [{ type: 'roll' }]
    }

    const dice = state.diceValue
    const myPieces = state.pieces.filter((p) => p.seatIndex === seatIndex)
    const moves: LudoMove[] = []
    for (const piece of myPieces) {
      if (piece.pathPos === LUDO_FINISHED) continue
      if (piece.pathPos === -1) {
        if (dice === 6) moves.push({ type: 'move', pieceId: pieceId(seatIndex, piece.pieceIndex) })
        continue
      }
      const target = piece.pathPos + dice
      if (target > LUDO_FINISHED) continue // must land exactly on home, can't overshoot
      moves.push({ type: 'move', pieceId: pieceId(seatIndex, piece.pieceIndex) })
    }
    return moves
  },

  applyMove(state, seatIndex, move) {
    const events: BoardGameEvent[] = []

    // A null move only ever arrives when getValidMoves() returned [] — the
    // shared localController auto-passes in that case. Two ways we can get
    // here: dice was rolled but nothing could move, or (shouldn't happen)
    // the roll step itself was skipped.
    if (move === null) {
      const rolledSix = state.diceValue === 6
      events.push({ type: 'noMovesAvailable', seatIndex })
      const next: LudoState = { ...state, pieces: clonePieces(state.pieces), diceValue: null }
      if (rolledSix && state.consecutiveSixes < MAX_CONSECUTIVE_SIXES) {
        next.turnSeatIndex = seatIndex // extra roll from the 6, even though it couldn't be used
      } else {
        next.turnSeatIndex = nextActiveSeat(state, seatIndex)
        next.consecutiveSixes = 0
      }
      return { state: next, events }
    }

    if (move.type === 'roll') {
      const { die, next: rngNext } = rollDie(state.rngState)
      events.push({ type: 'diceRolled', seatIndex, value: die })
      const consecutiveSixes = die === 6 ? state.consecutiveSixes + 1 : 0

      if (die === 6 && consecutiveSixes >= MAX_CONSECUTIVE_SIXES) {
        // Three sixes in a row forfeits the turn immediately (standard rule).
        events.push({ type: 'threeSixesForfeit', seatIndex })
        return {
          state: {
            ...state,
            pieces: clonePieces(state.pieces),
            rngState: rngNext,
            diceValue: null,
            consecutiveSixes: 0,
            turnSeatIndex: nextActiveSeat(state, seatIndex),
          },
          events,
        }
      }

      return {
        state: { ...state, pieces: clonePieces(state.pieces), rngState: rngNext, diceValue: die, consecutiveSixes },
        events,
      }
    }

    // move.type === 'move'
    const [pSeat, pIndexStr] = move.pieceId.split(':')
    const pIndex = Number(pIndexStr)
    const pieces = clonePieces(state.pieces)
    const piece = pieces.find((p) => p.seatIndex === Number(pSeat) && p.pieceIndex === pIndex)!
    const dice = state.diceValue ?? 0

    const fromBase = piece.pathPos === -1
    piece.pathPos = fromBase ? 0 : piece.pathPos + dice
    events.push({ type: 'pieceMoved', seatIndex, pieceId: move.pieceId, from: fromBase ? -1 : piece.pathPos - dice, to: piece.pathPos })

    // Capture check — only on the shared ring, never in a home stretch, and
    // never on a safe cell. Opposing pieces are grouped by seat first: two
    // (or more) of the SAME opponent's pieces sharing this cell form a
    // protected pair — they cannot be captured, though the rest of this
    // move's landing still succeeds and other seats' single pieces on the
    // same cell are still captured normally. This is deliberately NOT the
    // traditional Ludo "block" rule: a protected pair never prevented this
    // piece from landing here or from moving through the cell earlier in
    // its path — only capture is suppressed.
    const landedCell = globalRingCell(seatIndex, piece.pathPos)
    const piecesLostCount = { ...state.piecesLostCount }
    if (landedCell !== null && !SAFE_CELLS.has(landedCell)) {
      const byOpponentSeat = new Map<number, LudoPiece[]>()
      for (const other of pieces) {
        if (other.seatIndex === seatIndex) continue
        if (globalRingCell(other.seatIndex, other.pathPos) === landedCell) {
          const group = byOpponentSeat.get(other.seatIndex) ?? []
          group.push(other)
          byOpponentSeat.set(other.seatIndex, group)
        }
      }
      for (const [otherSeatIndex, group] of byOpponentSeat) {
        if (group.length >= 2) continue // protected pair — immune to capture
        for (const other of group) {
          other.pathPos = -1
          piecesLostCount[otherSeatIndex] = (piecesLostCount[otherSeatIndex] ?? 0) + 1
          events.push({ type: 'pieceCaptured', capturedSeatIndex: otherSeatIndex, byPieceId: move.pieceId, atCell: landedCell })
        }
      }
    }

    let finishedOrder = state.finishedOrder
    let activeSeatIndices = state.activeSeatIndices
    let gameOver = state.gameOver

    if (piece.pathPos === LUDO_FINISHED) {
      events.push({ type: 'pieceHome', seatIndex, pieceId: move.pieceId })
      if (seatFinishedAllPieces({ ...state, pieces }, seatIndex) && !finishedOrder.includes(seatIndex)) {
        finishedOrder = [...finishedOrder, seatIndex]
        activeSeatIndices = activeSeatIndices.filter((s) => s !== seatIndex)
        events.push({ type: 'seatFinished', seatIndex, place: finishedOrder.length })
      }
    }

    if (activeSeatIndices.length <= 1) {
      gameOver = true
      if (activeSeatIndices.length === 1 && !finishedOrder.includes(activeSeatIndices[0])) {
        finishedOrder = [...finishedOrder, activeSeatIndices[0]]
      }
      events.push({ type: 'gameOver' })
    }

    const rolledSix = dice === 6
    // A six and a capture each independently earn another turn (standard
    // Ludo rule — verified against the official ruleset). They combine
    // with OR, not by stacking: landing a capture on a rolled six still
    // grants exactly one extra turn, not two. The three-consecutive-sixes
    // cap applies only to the six-streak itself; captures are never capped
    // since they're inherently bounded by opponent pieces actually being
    // on the board to capture.
    const captured = events.some((e) => e.type === 'pieceCaptured')
    const earnsExtraTurn = (rolledSix && state.consecutiveSixes < MAX_CONSECUTIVE_SIXES) || captured
    // IMPORTANT: rotate using `state` (the ORIGINAL, unmutated activeSeatIndices),
    // not the local `activeSeatIndices` var — that one may have already had
    // `seatIndex` filtered out a few lines up if this move just finished the
    // seat's last piece. nextActiveSeat() finds "the next seat after `from`"
    // by looking up `from`'s position in the array; if `seatIndex` has
    // already been removed, indexOf() can't find it and rotation breaks
    // (in a 3-4 seat game this silently jumps to the wrong seat instead of
    // correctly continuing the rotation — found during the round-3 turn-flow
    // audit, matching the equivalent bug fixed in ludo_apply_piece_move on
    // the server). The pre-move `state.activeSeatIndices` always still
    // contains `seatIndex`, so lookups against it are always correct.
    const nextTurn = gameOver
      ? state.turnSeatIndex
      : earnsExtraTurn && activeSeatIndices.includes(seatIndex)
        ? seatIndex
        : nextActiveSeat(state, seatIndex)

    return {
      state: {
        ...state,
        pieces,
        diceValue: null,
        turnSeatIndex: nextTurn,
        finishedOrder,
        activeSeatIndices,
        gameOver,
        consecutiveSixes: gameOver ? state.consecutiveSixes : (rolledSix ? state.consecutiveSixes : 0),
        piecesLostCount,
      },
      events,
    }
  },

  checkGameOver(state): BoardGameResult | null {
    if (!state.gameOver) return null
    const rankings: Record<number, number> = {}
    state.finishedOrder.forEach((seatIndex, i) => { rankings[seatIndex] = i + 1 })
    // Any seat somehow not in finishedOrder (shouldn't normally happen) gets last place.
    for (let s = 0; s < state.numSeats; s++) {
      if (!(s in rankings)) rankings[s] = state.finishedOrder.length + 1
    }
    const scores: Record<number, number> = {}
    for (let s = 0; s < state.numSeats; s++) {
      scores[s] = state.pieces.filter((p) => p.seatIndex === s && p.pathPos === LUDO_FINISHED).length * 25
        + state.pieces.filter((p) => p.seatIndex === s).reduce((sum, p) => sum + Math.max(0, p.pathPos), 0)
    }
    return { rankings, scores }
  },

  getMatchMeta(state) {
    const meta: Record<number, Record<string, unknown>> = {}
    for (let s = 0; s < state.numSeats; s++) {
      const seatPieces = state.pieces.filter((p) => p.seatIndex === s)
      meta[s] = {
        no_pieces_lost: (state.piecesLostCount[s] ?? 0) === 0,
        all_pieces_home: seatPieces.length > 0 && seatPieces.every((p) => p.pathPos === LUDO_FINISHED),
      }
    }
    return meta
  },
}

export function isSafeGlobalCell(cell: number) {
  return SAFE_CELLS.has(cell)
}

export function pieceGlobalCell(seatIndex: number, pathPos: number): number | null {
  return globalRingCell(seatIndex, pathPos)
}

export { START_OFFSETS as LUDO_START_OFFSETS }
