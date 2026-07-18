// Rules verification harness — imports the REAL production engine.ts
// directly (its only import is `import type`, which is erased at runtime,
// so no bundler is needed) and drives it through hand-built board
// positions to prove specific rules, rather than relying on random play.
import { LudoEngine, type LudoState, type LudoPiece, LUDO_FINISHED } from '../src/lib/boardgames/ludo/engine.ts'
import type { BoardGameSeat } from '../src/lib/boardgames/types.ts'

let pass = 0, fail = 0
function check(name: string, cond: boolean) {
  if (cond) { pass++; console.log('  ok  ', name) }
  else { fail++; console.log('  FAIL', name) }
}

function seats(n = 2): BoardGameSeat[] {
  return Array.from({ length: n }, (_, i) => ({ seatIndex: i, isAI: false } as BoardGameSeat))
}

function piece(seatIndex: number, pieceIndex: number, pathPos: number): LudoPiece {
  return { seatIndex, pieceIndex, pathPos }
}

function baseState(overrides: Partial<LudoState>): LudoState {
  const s = LudoEngine.createInitialState(seats(2))
  return { ...s, ...overrides }
}

console.log('=== Rule: must roll a 6 to leave base ===')
{
  const s = baseState({ turnSeatIndex: 0, diceValue: 3, pieces: seats(2).flatMap((seat) => [0, 1, 2, 3].map((p) => piece(seat.seatIndex, p, -1))) })
  const moves = LudoEngine.getValidMoves(s, 0)
  check('dice=3, all pieces in base -> zero valid moves', moves.length === 0)
  const s6 = { ...s, diceValue: 6 }
  const moves6 = LudoEngine.getValidMoves(s6, 0)
  check('dice=6, all pieces in base -> 4 valid moves (any piece can leave)', moves6.length === 4)
}

console.log('=== Rule: rolling a 6 grants another turn ===')
{
  const pieces = [piece(0, 0, 10), piece(0, 1, -1), piece(0, 2, -1), piece(0, 3, -1), piece(1, 0, -1), piece(1, 1, -1), piece(1, 2, -1), piece(1, 3, -1)]
  const s = baseState({ turnSeatIndex: 0, diceValue: 6, activeSeatIndices: [0, 1], pieces })
  const { state: next } = LudoEngine.applyMove(s, 0, { type: 'move', pieceId: '0:0' })
  check('after moving on a rolled 6, turn stays with seat 0', next.turnSeatIndex === 0)
}

console.log('=== Rule: capturing grants another turn (even without a 6) — the bug this audit fixed ===')
{
  // Seat 0's piece at pathPos 10 -> global cell 10. Seat 1 (offset 13) piece
  // sitting at pathPos so its global cell is also 10: (13+p)%52=10 -> p = -3 mod 52 = 49...
  // simpler: pick seat0 piece at pathPos 5 (global cell 5, non-safe), dice=2 -> lands global cell 7 (non-safe, not in SAFE_CELLS {0,8,13,21,26,34,39,47}).
  // Seat1 piece needs global cell 7: (13+p)%52=7 -> p = 7-13 = -6 -> +52 = 46. pathPos 46 is a valid ring position (<=50).
  const pieces = [
    piece(0, 0, 5), piece(0, 1, -1), piece(0, 2, -1), piece(0, 3, -1),
    piece(1, 0, 46), piece(1, 1, -1), piece(1, 2, -1), piece(1, 3, -1),
  ]
  const s = baseState({ turnSeatIndex: 0, diceValue: 2, activeSeatIndices: [0, 1], pieces })
  const { state: next, events } = LudoEngine.applyMove(s, 0, { type: 'move', pieceId: '0:0' })
  const captured = events.some((e) => e.type === 'pieceCaptured')
  check('move with dice=2 (not a 6) captures seat 1\'s piece', captured)
  check('captured piece sent back to base (pathPos -1)', next.pieces.find((p) => p.seatIndex === 1 && p.pieceIndex === 0)?.pathPos === -1)
  check('turn stays with seat 0 after a non-six capturing move (extra turn earned)', next.turnSeatIndex === 0)
}

console.log('=== Rule: non-six, non-capture move passes the turn normally ===')
{
  const pieces = [piece(0, 0, 5), piece(0, 1, -1), piece(0, 2, -1), piece(0, 3, -1), piece(1, 0, -1), piece(1, 1, -1), piece(1, 2, -1), piece(1, 3, -1)]
  const s = baseState({ turnSeatIndex: 0, diceValue: 2, activeSeatIndices: [0, 1], pieces })
  const { state: next, events } = LudoEngine.applyMove(s, 0, { type: 'move', pieceId: '0:0' })
  check('no capture happened', !events.some((e) => e.type === 'pieceCaptured'))
  check('turn passes to seat 1', next.turnSeatIndex === 1)
}

console.log('=== Rule: six + capture combined still grants exactly ONE extra turn (no double-advance) ===')
{
  // seat0 piece at pathPos 4 (global cell 4), dice=6 -> lands global cell 10 (non-safe).
  // seat1 piece needs global cell 10: (13+p)%52=10 -> p=-3+52=49.
  const pieces = [piece(0, 0, 4), piece(0, 1, -1), piece(0, 2, -1), piece(0, 3, -1), piece(1, 0, 49), piece(1, 1, -1), piece(1, 2, -1), piece(1, 3, -1)]
  const s = baseState({ turnSeatIndex: 0, diceValue: 6, consecutiveSixes: 1, activeSeatIndices: [0, 1], pieces })
  const { state: next, events } = LudoEngine.applyMove(s, 0, { type: 'move', pieceId: '0:0' })
  check('capture happened on a six', events.some((e) => e.type === 'pieceCaptured'))
  check('turn stays with seat 0 exactly once (not skipped to seat 1 or beyond)', next.turnSeatIndex === 0)
}

console.log('=== Rule: safe cells cannot be captured on ===')
{
  // global cell 8 is a safe star cell. seat0 piece landing there via dice=3 from pathPos5 -> global cell 8.
  const pieces = [piece(0, 0, 5), piece(0, 1, -1), piece(0, 2, -1), piece(0, 3, -1), piece(1, 0, 47), piece(1, 1, -1), piece(1, 2, -1), piece(1, 3, -1)] // seat1 p0: (13+47)%52=60%52=8
  const s = baseState({ turnSeatIndex: 0, diceValue: 3, activeSeatIndices: [0, 1], pieces })
  const { events } = LudoEngine.applyMove(s, 0, { type: 'move', pieceId: '0:0' })
  check('landing on safe cell 8 with an opponent already there does NOT capture', !events.some((e) => e.type === 'pieceCaptured'))
}

console.log('=== Rule: triple-six forfeits the turn ===')
{
  const s = baseState({ turnSeatIndex: 0, diceValue: null, consecutiveSixes: 2, activeSeatIndices: [0, 1] })
  // Force the RNG to produce a 6 by brute-searching a seed (deterministic LCG).
  let seed = 1
  let found = false
  for (let i = 0; i < 5000; i++) {
    const test = { ...s, rngState: i }
    const { state: rolled, events } = LudoEngine.applyMove(test, 0, { type: 'roll' })
    if (events.some((e) => e.type === 'diceRolled' && (e as any).value === 6)) {
      seed = i; found = true
      check('3rd consecutive six forfeits turn immediately', events.some((e) => e.type === 'threeSixesForfeit') && rolled.turnSeatIndex === 1)
      check('consecutiveSixes resets to 0 after forfeit', rolled.consecutiveSixes === 0)
      break
    }
  }
  check('found a seed producing a 6 for this test', found)
}

console.log('=== Rule: exact roll required to finish (overshoot forbidden) ===')
{
  const pieces = [piece(0, 0, 54), piece(0, 1, -1), piece(0, 2, -1), piece(0, 3, -1), piece(1, 0, -1), piece(1, 1, -1), piece(1, 2, -1), piece(1, 3, -1)]
  const s = baseState({ turnSeatIndex: 0, diceValue: 5, activeSeatIndices: [0, 1], pieces }) // 54+5=59 > 56, overshoot
  const moves = LudoEngine.getValidMoves(s, 0)
  check('overshoot move (54+5=59 > 56) excluded from valid moves', !moves.some((m) => m.type === 'move' && m.pieceId === '0:0'))
  const s2 = { ...s, diceValue: 2 } // 54+2=56, exact finish
  const moves2 = LudoEngine.getValidMoves(s2, 0)
  check('exact-landing move (54+2=56) IS a valid move', moves2.some((m) => m.type === 'move' && m.pieceId === '0:0'))
  const { state: next } = LudoEngine.applyMove(s2, 0, { type: 'move', pieceId: '0:0' })
  check('piece pathPos becomes exactly LUDO_FINISHED', next.pieces.find((p) => p.seatIndex === 0 && p.pieceIndex === 0)?.pathPos === LUDO_FINISHED)
}

console.log('=== Rule: home stretch is never subject to capture (per-player exclusive) ===')
{
  // Two different seats' pieces both deep in their OWN home stretches can never collide because pathPos is seat-relative and globalRingCell returns null for pathPos>50.
  const pieces = [piece(0, 0, 52), piece(0, 1, -1), piece(0, 2, -1), piece(0, 3, -1), piece(1, 0, 52), piece(1, 1, -1), piece(1, 2, -1), piece(1, 3, -1)]
  const s = baseState({ turnSeatIndex: 0, diceValue: 1, activeSeatIndices: [0, 1], pieces })
  const { events } = LudoEngine.applyMove(s, 0, { type: 'move', pieceId: '0:0' })
  check('moving within home stretch never triggers a capture event, even with another seat "numerically" at the same pathPos', !events.some((e) => e.type === 'pieceCaptured'))
}

console.log('=== Rule: turn order cycles only through active (non-finished) seats ===')
{
  const s = baseState({ turnSeatIndex: 0, activeSeatIndices: [0, 2], numSeats: 3, diceValue: null })
  const moves = LudoEngine.getValidMoves(s, 0)
  check('seat 0 can act (roll) when active', moves.length === 1 && moves[0].type === 'roll')
  check('seat 1 (not in activeSeatIndices) has no valid moves even if it were asked', LudoEngine.getValidMoves(s, 1).length === 0)
}

console.log(`\n=== RESULT: ${pass} passed, ${fail} failed ===`)
if (fail > 0) process.exit(1)
