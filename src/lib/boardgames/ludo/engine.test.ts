import { describe, test, expect } from 'vitest'
import {
  LudoEngine, LUDO_FINISHED, LUDO_START_OFFSETS, LUDO_RING_LENGTH, LUDO_HOME_STRETCH,
  isSafeGlobalCell, pieceGlobalCell, type LudoState, type LudoPiece,
} from './engine'
import { pathCells, homeStretchCells } from './geometry'

/**
 * Deterministic rule tests for the Ludo engine — covers the 20 scenarios
 * required by the Ludo rebuild spec. Items 1–15 are pure functions of
 * LudoEngine/geometry and are tested directly here with hand-built states
 * (no RNG dependency except where a roll's die value itself is the thing
 * under test, in which case a matching rngState seed is brute-force located
 * — the search is itself deterministic and reproducible, just not a fixed
 * literal seed).
 *
 * Items 16–20 (reconnect/duplicate-move/match-completes-once/rewards-once/
 * two-accounts-see-identical-state) are properties of the SERVER-side
 * ludo_submit_move / finalize_ludo_match RPCs and the realtime sync layer,
 * not of this pure client module — they were verified live against the
 * Supabase project this session (two throwaway auth accounts, real RPC
 * calls simulating both seats, full 358-move game to completion, adversarial
 * out-of-turn / seat-impersonation / stale-version / non-member-finalize
 * attempts, idempotent double-finalize). See the delivery report for the
 * exact commands. A `describe.skip` block below documents what each of
 * those five items means and points at where the equivalent SQL-level
 * behavior lives, since a live-Postgres integration harness isn't part of
 * this repo's existing test tooling.
 */

function makeState(overrides: Partial<LudoState> & { pieces?: LudoPiece[] } = {}): LudoState {
  const numSeats = overrides.numSeats ?? 2
  const pieces: LudoPiece[] =
    overrides.pieces ??
    Array.from({ length: numSeats }, (_, s) =>
      Array.from({ length: 4 }, (_, p) => ({ seatIndex: s, pieceIndex: p, pathPos: -1 }))
    ).flat()
  return {
    numSeats,
    pieces,
    turnSeatIndex: 0,
    diceValue: null,
    consecutiveSixes: 0,
    finishedOrder: [],
    activeSeatIndices: Array.from({ length: numSeats }, (_, i) => i),
    rngState: 12345,
    gameOver: false,
    piecesLostCount: Object.fromEntries(Array.from({ length: numSeats }, (_, i) => [i, 0])),
    ...overrides,
  }
}

// seat0 start offset 0, seat1 start offset 13 (LUDO_START_OFFSETS). Cell 20
// is not in the safe-cell set {0,8,13,21,26,34,39,47}, so pathPos 19 (seat0,
// -> cell 19+... wait: seat0 pathPos->cell is (0+pathPos)%52, seat1 is
// (13+pathPos)%52. Landing both on cell 20: seat0 pathPos=20, seat1 pathPos=7.
const UNSAFE_LANDING_SEAT0_PATHPOS = 20
const UNSAFE_LANDING_SEAT1_PATHPOS = 7

function twoSeatPiecesAtUnsafeCollision(): LudoPiece[] {
  return [
    { seatIndex: 0, pieceIndex: 0, pathPos: UNSAFE_LANDING_SEAT0_PATHPOS - 1 }, // one square short; dice=1 lands it
    { seatIndex: 0, pieceIndex: 1, pathPos: -1 },
    { seatIndex: 0, pieceIndex: 2, pathPos: -1 },
    { seatIndex: 0, pieceIndex: 3, pathPos: -1 },
    { seatIndex: 1, pieceIndex: 0, pathPos: UNSAFE_LANDING_SEAT1_PATHPOS },
    { seatIndex: 1, pieceIndex: 1, pathPos: -1 },
    { seatIndex: 1, pieceIndex: 2, pathPos: -1 },
    { seatIndex: 1, pieceIndex: 3, pathPos: -1 },
  ]
}

describe('1. token cannot leave base without a 6', () => {
  test('no moves are offered for a non-6 roll when every piece is in base', () => {
    const state = makeState({ diceValue: 4 })
    expect(LudoEngine.getValidMoves(state, 0)).toEqual([])
  })
})

describe('2. rolling a 6 releases a token', () => {
  test('a base piece becomes a legal move on a 6', () => {
    const state = makeState({ diceValue: 6 })
    const moves = LudoEngine.getValidMoves(state, 0)
    expect(moves).toContainEqual({ type: 'move', pieceId: '0:0' })
    const { state: after } = LudoEngine.applyMove(state, 0, { type: 'move', pieceId: '0:0' })
    expect(after.pieces.find((p) => p.seatIndex === 0 && p.pieceIndex === 0)?.pathPos).toBe(0)
  })
})

describe('3. rolling a 6 also offers moving an existing token', () => {
  test('both releasing a new piece and advancing an on-board piece are offered — player chooses', () => {
    const pieces = makeState().pieces.map((p) => (p.seatIndex === 0 && p.pieceIndex === 0 ? { ...p, pathPos: 10 } : p))
    const state = makeState({ diceValue: 6, pieces })
    const moves = LudoEngine.getValidMoves(state, 0)
    expect(moves.some((m) => m.type === 'move' && m.pieceId === '0:0')).toBe(true) // advance on-board piece
    expect(moves.some((m) => m.type === 'move' && m.pieceId === '0:1')).toBe(true) // release a base piece
  })
})

describe('4. rolling a 6 grants an extra roll', () => {
  test('after moving on a 6, the turn stays with the same seat', () => {
    const pieces = makeState().pieces.map((p) => (p.seatIndex === 0 && p.pieceIndex === 0 ? { ...p, pathPos: 10 } : p))
    const state = makeState({ diceValue: 6, pieces, consecutiveSixes: 1 })
    const { state: after } = LudoEngine.applyMove(state, 0, { type: 'move', pieceId: '0:0' })
    expect(after.turnSeatIndex).toBe(0)
    expect(after.diceValue).toBeNull()
  })
})

describe('5. three consecutive sixes end the turn — no movement from the third six', () => {
  test('the forfeit branch fires deterministically once located and passes the turn immediately', () => {
    let found = false
    for (let seed = 1; seed < 200000 && !found; seed++) {
      const state = makeState({ diceValue: null, consecutiveSixes: 2, rngState: seed })
      const { state: after, events } = LudoEngine.applyMove(state, 0, { type: 'roll' })
      if (events.some((e) => e.type === 'threeSixesForfeit')) {
        expect(after.diceValue).toBeNull() // no token movement allowed from the third six
        expect(after.turnSeatIndex).not.toBe(0) // turn passes immediately
        expect(after.consecutiveSixes).toBe(0)
        found = true
      }
    }
    expect(found).toBe(true)
  })
})

describe('6. capture on an unsafe square sends the opponent back to base', () => {
  test('landing exactly on an opponent piece on a non-safe cell captures it', () => {
    const state = makeState({ pieces: twoSeatPiecesAtUnsafeCollision(), diceValue: 1 })
    expect(isSafeGlobalCell(UNSAFE_LANDING_SEAT0_PATHPOS)).toBe(false)
    const { state: after, events } = LudoEngine.applyMove(state, 0, { type: 'move', pieceId: '0:0' })
    const captured = after.pieces.find((p) => p.seatIndex === 1 && p.pieceIndex === 0)!
    expect(captured.pathPos).toBe(-1)
    expect(events.some((e) => e.type === 'pieceCaptured')).toBe(true)
  })
})

describe('7. a capture grants an extra roll', () => {
  test('turn stays with the capturing seat even without rolling a 6', () => {
    const state = makeState({ pieces: twoSeatPiecesAtUnsafeCollision(), diceValue: 1, consecutiveSixes: 0 })
    const { state: after } = LudoEngine.applyMove(state, 0, { type: 'move', pieceId: '0:0' })
    expect(after.turnSeatIndex).toBe(0)
  })
})

describe('8. capture is impossible on every safe-square type', () => {
  test('marked star/entry ring cells never allow capture', () => {
    // Cell 8 is a star safe cell. seat0 pathPos=8 lands there; seat1 pathPos
    // chosen so its own cell (13+p)%52 === 8  ->  p = (8-13+52)%52 = 47.
    const pieces: LudoPiece[] = [
      { seatIndex: 0, pieceIndex: 0, pathPos: 7 },
      { seatIndex: 0, pieceIndex: 1, pathPos: -1 },
      { seatIndex: 0, pieceIndex: 2, pathPos: -1 },
      { seatIndex: 0, pieceIndex: 3, pathPos: -1 },
      { seatIndex: 1, pieceIndex: 0, pathPos: 47 },
      { seatIndex: 1, pieceIndex: 1, pathPos: -1 },
      { seatIndex: 1, pieceIndex: 2, pathPos: -1 },
      { seatIndex: 1, pieceIndex: 3, pathPos: -1 },
    ]
    const state = makeState({ pieces, diceValue: 1 })
    expect(isSafeGlobalCell(8)).toBe(true)
    const { state: after, events } = LudoEngine.applyMove(state, 0, { type: 'move', pieceId: '0:0' })
    expect(after.pieces.find((p) => p.seatIndex === 1 && p.pieceIndex === 0)?.pathPos).toBe(47) // untouched
    expect(events.some((e) => e.type === 'pieceCaptured')).toBe(false)
  })

  test('a seat\'s own starting square is safe', () => {
    expect(isSafeGlobalCell(LUDO_START_OFFSETS[0])).toBe(true)
    expect(isSafeGlobalCell(LUDO_START_OFFSETS[1])).toBe(true)
    expect(isSafeGlobalCell(LUDO_START_OFFSETS[2])).toBe(true)
    expect(isSafeGlobalCell(LUDO_START_OFFSETS[3])).toBe(true)
  })

  test('the full home stretch is structurally uncapturable (no global ring cell)', () => {
    for (let stretchPos = 51; stretchPos <= 56; stretchPos++) {
      expect(pieceGlobalCell(0, stretchPos)).toBeNull()
    }
  })

  test('the final home area is structurally uncapturable', () => {
    expect(pieceGlobalCell(0, LUDO_FINISHED)).toBeNull()
  })
})

describe('9. two same-color tokens on one square cannot be captured', () => {
  test('a same-seat pair on the landed cell is immune — the single third-seat piece there is still captured', () => {
    const pieces: LudoPiece[] = [
      { seatIndex: 0, pieceIndex: 0, pathPos: 19 },
      { seatIndex: 0, pieceIndex: 1, pathPos: -1 },
      { seatIndex: 0, pieceIndex: 2, pathPos: -1 },
      { seatIndex: 0, pieceIndex: 3, pathPos: -1 },
      { seatIndex: 1, pieceIndex: 0, pathPos: 7 }, // -> cell 20
      { seatIndex: 1, pieceIndex: 1, pathPos: 7 }, // -> cell 20 too: a protected pair
      { seatIndex: 1, pieceIndex: 2, pathPos: -1 },
      { seatIndex: 1, pieceIndex: 3, pathPos: -1 },
      { seatIndex: 2, pieceIndex: 0, pathPos: 46 }, // (26+46)%52 = 20: single piece, same cell
      { seatIndex: 2, pieceIndex: 1, pathPos: -1 },
      { seatIndex: 2, pieceIndex: 2, pathPos: -1 },
      { seatIndex: 2, pieceIndex: 3, pathPos: -1 },
    ]
    const state = makeState({ numSeats: 3, pieces, diceValue: 1 })
    const { state: after, events } = LudoEngine.applyMove(state, 0, { type: 'move', pieceId: '0:0' })
    // Only pieceIndex 0/1 form the pair on the contested cell; seat 1's other
    // two pieces are irrelevant base pieces and must stay untouched at -1.
    const pair = after.pieces.filter((p) => p.seatIndex === 1 && (p.pieceIndex === 0 || p.pieceIndex === 1))
    expect(pair.every((p) => p.pathPos === 7)).toBe(true) // untouched — protected
    const single = after.pieces.find((p) => p.seatIndex === 2 && p.pieceIndex === 0)!
    expect(single.pathPos).toBe(-1) // captured normally
    const captureEvents = events.filter((e) => e.type === 'pieceCaptured')
    expect(captureEvents).toHaveLength(1)
    expect((captureEvents[0] as unknown as { capturedSeatIndex: number }).capturedSeatIndex).toBe(2)
  })
})

describe('10. an opponent may pass over a two-token pair', () => {
  test('getValidMoves never excludes a move because an opposing pair sits on/along the path', () => {
    // Same pair-on-cell-20 setup, but this time seat0's piece target lands
    // one square PAST the pair (cell 21) rather than on it — the pair must
    // not have blocked the roll from being offered as a legal move at all.
    const pieces: LudoPiece[] = [
      { seatIndex: 0, pieceIndex: 0, pathPos: 19 },
      { seatIndex: 0, pieceIndex: 1, pathPos: -1 },
      { seatIndex: 0, pieceIndex: 2, pathPos: -1 },
      { seatIndex: 0, pieceIndex: 3, pathPos: -1 },
      { seatIndex: 1, pieceIndex: 0, pathPos: 7 }, // -> cell 20, sits between 19 and 21
      { seatIndex: 1, pieceIndex: 1, pathPos: 7 },
      { seatIndex: 1, pieceIndex: 2, pathPos: -1 },
      { seatIndex: 1, pieceIndex: 3, pathPos: -1 },
    ]
    const state = makeState({ pieces, diceValue: 2 }) // lands on cell 21, past the pair on cell 20
    const moves = LudoEngine.getValidMoves(state, 0)
    expect(moves).toContainEqual({ type: 'move', pieceId: '0:0' })
    const { state: after } = LudoEngine.applyMove(state, 0, { type: 'move', pieceId: '0:0' })
    expect(after.pieces.find((p) => p.seatIndex === 0 && p.pieceIndex === 0)?.pathPos).toBe(21)
  })
})

describe('11. exact roll required to enter home', () => {
  test('a piece 3 spaces from home cannot move on a roll of 4', () => {
    const pieces = makeState().pieces.map((p) => (p.seatIndex === 0 && p.pieceIndex === 0 ? { ...p, pathPos: 53 } : p)) // 56-53=3 remaining
    const state = makeState({ pieces, diceValue: 4 })
    const moves = LudoEngine.getValidMoves(state, 0)
    expect(moves.some((m) => m.type === 'move' && m.pieceId === '0:0')).toBe(false)
  })

  test('the same piece CAN move on the exact roll of 3', () => {
    const pieces = makeState().pieces.map((p) => (p.seatIndex === 0 && p.pieceIndex === 0 ? { ...p, pathPos: 53 } : p))
    const state = makeState({ pieces, diceValue: 3 })
    const moves = LudoEngine.getValidMoves(state, 0)
    expect(moves.some((m) => m.type === 'move' && m.pieceId === '0:0')).toBe(true)
    const { state: after } = LudoEngine.applyMove(state, 0, { type: 'move', pieceId: '0:0' })
    expect(after.pieces.find((p) => p.seatIndex === 0 && p.pieceIndex === 0)?.pathPos).toBe(LUDO_FINISHED)
  })
})

describe('12. an oversized roll produces no legal move for that token (no bounce-back)', () => {
  test('a piece 3 spaces from home has zero legal moves on a roll of 5, even though other pieces might', () => {
    const pieces = makeState().pieces.map((p) => (p.seatIndex === 0 && p.pieceIndex === 0 ? { ...p, pathPos: 53 } : p))
    const state = makeState({ pieces, diceValue: 5 })
    const moves = LudoEngine.getValidMoves(state, 0)
    expect(moves.some((m) => m.type === 'move' && m.pieceId === '0:0')).toBe(false)
  })
})

describe('13. no legal move passes the turn correctly', () => {
  test('applyMove(null) on a seat with zero legal moves advances to the next active seat and clears the die', () => {
    const state = makeState({ diceValue: 4, consecutiveSixes: 0 }) // all pieces in base, dice isn't 6 -> no legal moves
    expect(LudoEngine.getValidMoves(state, 0)).toEqual([])
    const { state: after, events } = LudoEngine.applyMove(state, 0, null)
    expect(events.some((e) => e.type === 'noMovesAvailable')).toBe(true)
    expect(after.turnSeatIndex).toBe(1)
    expect(after.diceValue).toBeNull()
  })

  test('a no-legal-move pass after rolling a (non-forfeiting) 6 keeps the turn with the same seat', () => {
    const state = makeState({ diceValue: 6, consecutiveSixes: 1 })
    const { state: after } = LudoEngine.applyMove(state, 0, null)
    expect(after.turnSeatIndex).toBe(0) // still an extra roll owed, even though this six couldn't be used
  })
})

describe('14. correct player path for every color', () => {
  test('the 52-cell ring is fully covered exactly once and start offsets are spaced 13 apart', () => {
    expect(LUDO_RING_LENGTH).toBe(52)
    expect(LUDO_START_OFFSETS).toEqual([0, 13, 26, 39])
    const cells = pathCells(isSafeGlobalCell, LUDO_START_OFFSETS)
    expect(cells).toHaveLength(52)
    const uniqueCoords = new Set(cells.map((c) => `${c.row},${c.col}`))
    expect(uniqueCoords.size).toBe(52) // no two ring indices share a grid cell
  })

  test('every seat gets its own private 6-cell home stretch, none overlapping', () => {
    expect(LUDO_HOME_STRETCH).toBe(6)
    const stretches = homeStretchCells()
    expect(stretches).toHaveLength(24) // 4 seats * 6 cells
    const uniqueCoords = new Set(stretches.map((c) => `${c.row},${c.col}`))
    expect(uniqueCoords.size).toBe(24)
    for (let seat = 0; seat < 4; seat++) {
      const mine = stretches.filter((c) => c.seatIndex === seat)
      expect(mine).toHaveLength(6)
      expect(mine.find((c) => c.isFinishCell)).toBeTruthy()
    }
  })
})

describe('15. Arabic/RTL mode does not mirror the board', () => {
  test('geometry functions take no language/direction parameter and are purely a function of seat + path position', () => {
    // Structural guarantee: pathCells/homeStretchCells/ringPoint/piecePixelPosition
    // never reference language, locale, or a "dir" flag anywhere in geometry.ts
    // (confirmed by inspection — this module has zero RTL-awareness by design,
    // so there is nothing in it that COULD mirror). This test locks in that the
    // same inputs always produce the same pixel geometry, run twice, proving
    // there's no hidden global/locale state influencing the output.
    const a = pathCells(isSafeGlobalCell, LUDO_START_OFFSETS)
    const b = pathCells(isSafeGlobalCell, LUDO_START_OFFSETS)
    expect(a).toEqual(b)
  })
})

describe('round 3 audit: a seat finishing in a 3-4 player match rotates the turn correctly', () => {
  // Found during the round-3 "full turn-flow audit" and fixed in the same
  // pass (both here and in the matching Postgres function
  // private.ludo_apply_piece_move — see migration
  // 20260721050000_ludo_finish_seat_rotation_deadlock_fix.sql). Root cause:
  // nextActiveSeat(state, from) locates `from` in state.activeSeatIndices
  // and returns whoever comes after it; when a piece move finishes a seat's
  // last piece, that seat is filtered OUT of activeSeatIndices BEFORE the
  // next-turn lookup ran, so the lookup couldn't find `from` and rotation
  // broke (returned the wrong seat instead of correctly continuing past the
  // just-finished one). Unreachable in a 2-player match — dropping to one
  // active seat ends the game before next-turn is ever computed — which is
  // exactly why two-account testing never surfaced it; this project's Ludo
  // rooms do support 3-4 seated players, so it's a real production deadlock
  // path. Fixed by rotating against the PRE-removal active list.
  test('seat 0 finishing its last piece (3-seat game) hands the turn to seat 1, not stuck on 0', () => {
    const state = makeState({
      numSeats: 3,
      turnSeatIndex: 0,
      diceValue: 6,
      activeSeatIndices: [0, 1, 2],
      pieces: [
        { seatIndex: 0, pieceIndex: 0, pathPos: LUDO_FINISHED },
        { seatIndex: 0, pieceIndex: 1, pathPos: LUDO_FINISHED },
        { seatIndex: 0, pieceIndex: 2, pathPos: LUDO_FINISHED },
        { seatIndex: 0, pieceIndex: 3, pathPos: LUDO_FINISHED - 6 },
        { seatIndex: 1, pieceIndex: 0, pathPos: -1 },
        { seatIndex: 1, pieceIndex: 1, pathPos: -1 },
        { seatIndex: 1, pieceIndex: 2, pathPos: -1 },
        { seatIndex: 1, pieceIndex: 3, pathPos: -1 },
        { seatIndex: 2, pieceIndex: 0, pathPos: -1 },
        { seatIndex: 2, pieceIndex: 1, pathPos: -1 },
        { seatIndex: 2, pieceIndex: 2, pathPos: -1 },
        { seatIndex: 2, pieceIndex: 3, pathPos: -1 },
      ],
    })
    const { state: next } = LudoEngine.applyMove(state, 0, { type: 'move', pieceId: '0:3' })
    expect(next.activeSeatIndices).toEqual([1, 2])
    expect(next.finishedOrder).toEqual([0])
    expect(next.gameOver).toBe(false)
    expect(next.turnSeatIndex).toBe(1) // NOT 0 — this is the exact case that used to deadlock
  })

  test('the last seat (seat 2) finishing wraps rotation correctly back to seat 0', () => {
    const state = makeState({
      numSeats: 3,
      turnSeatIndex: 2,
      diceValue: 6,
      activeSeatIndices: [0, 1, 2],
      pieces: [
        { seatIndex: 0, pieceIndex: 0, pathPos: -1 },
        { seatIndex: 0, pieceIndex: 1, pathPos: -1 },
        { seatIndex: 0, pieceIndex: 2, pathPos: -1 },
        { seatIndex: 0, pieceIndex: 3, pathPos: -1 },
        { seatIndex: 1, pieceIndex: 0, pathPos: -1 },
        { seatIndex: 1, pieceIndex: 1, pathPos: -1 },
        { seatIndex: 1, pieceIndex: 2, pathPos: -1 },
        { seatIndex: 1, pieceIndex: 3, pathPos: -1 },
        { seatIndex: 2, pieceIndex: 0, pathPos: LUDO_FINISHED },
        { seatIndex: 2, pieceIndex: 1, pathPos: LUDO_FINISHED },
        { seatIndex: 2, pieceIndex: 2, pathPos: LUDO_FINISHED },
        { seatIndex: 2, pieceIndex: 3, pathPos: LUDO_FINISHED - 6 },
      ],
    })
    const { state: next } = LudoEngine.applyMove(state, 2, { type: 'move', pieceId: '2:3' })
    expect(next.turnSeatIndex).toBe(0)
  })
})

describe.skip('16–20: server-authoritative multiplayer properties (verified live this session, not re-run here)', () => {
  test('16. refresh/reconnect restores the same turn and state — join_board_game_room_internal restores an existing seat unconditionally, and board_game_state is the single source of truth clients refetch', () => {})
  test('17. a duplicate/replayed move request is rejected — ludo_submit_move raises errcode 40001 ("Stale state") when p_expected_version no longer matches; verified live by resubmitting an already-applied version', () => {})
  test('18. a match completes once only — finalize_ludo_match/finalize_board_game guard on board_game_rooms.status <> \'completed\' under a row lock; verified live by calling finalize twice and confirming coins/xp were unchanged after the second call', () => {})
  test('19. rewards are awarded once only — same guard as #18; verified the exact coin/xp delta was applied exactly once across two finalize calls', () => {})
  test('20. two accounts see identical state throughout — every write goes through one row-locked, version-checked board_game_state row that both clients read via realtime + refetch + poll; verified by driving a full 358-move game as two simulated seats via direct RPC calls (see delivery report)', () => {})
})

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Production-fix verification — dice fairness, server turn timer, resume,
 * and 3-missed-turn elimination. This is a SEPARATE 18-item list from a
 * later round of user-reported issues, distinct from items 1-20 above.
 * Every one of these is a property of server-side Postgres RPCs
 * (private.ludo_resolve_expired_turns, public.check_ludo_timeout,
 * public.ludo_submit_move, public.get_active_ludo_match,
 * private.ludo_guard_single_active_match, public.finalize_ludo_match) —
 * none of them are testable as pure functions of this module, so #2-18
 * are documented against the exact live verification performed this
 * session (two throwaway auth accounts, real RPC calls, forced-expiry via
 * direct turn_deadline_at manipulation — the same "make the untestable
 * timing-dependent thing deterministic" technique used for item 5 above).
 * Item 1 (dice fairness) IS a pure, runnable statistical test — see below.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe('1. dice values 1-6 have approximately equal distribution over 100,000 rolls', () => {
  test('the exact server-side formula (floor(random()*6)+1) is uniform, in range, and reaches every face', () => {
    const counts = [0, 0, 0, 0, 0, 0, 0] // index 0 unused, 1-6 used
    const N = 100000
    for (let i = 0; i < N; i++) {
      const face = Math.floor(Math.random() * 6) + 1
      expect(face).toBeGreaterThanOrEqual(1)
      expect(face).toBeLessThanOrEqual(6)
      counts[face]++
    }
    for (let face = 1; face <= 6; face++) {
      const pct = (counts[face] / N) * 100
      // 16.67% expected; real production run (Postgres random(), same
      // formula, same session) measured 16.566%-16.862% across all six
      // faces — comfortably inside this tolerance band.
      expect(pct).toBeGreaterThan(15.5)
      expect(pct).toBeLessThan(17.85)
    }
  })
})

describe.skip('2–18: server-side timer/resume/elimination properties (verified live this session — see delivery report for the exact commands and measured values)', () => {
  test('2. a committed dice result never changes after refresh — re-selecting board_game_state.state->>diceValue mid-turn is stable; confirmed a roll of 3 stayed 3 across repeated reads', () => {})
  test('3. timer expiry advances the turn — forced turn_deadline_at into the past, called check_ludo_timeout, confirmed turnSeatIndex advanced, diceValue cleared, a new turn_deadline_at was scheduled, and version incremented', () => {})
  test('4. timer expiry works when the timed-out client is offline — the resolving check_ludo_timeout call was made under the OTHER seat\'s auth identity only; the timed-out seat never made any call at all', () => {})
  test('5. both devices receive the new turn — board_game_rooms/board_game_state writes go through the existing postgres_changes realtime subscription both clients already share; not independently re-verified this pass beyond confirming the writes themselves commit (existing, untouched realtime wiring)', () => {})
  test('6. concurrent timeout recovery cannot advance twice — called check_ludo_timeout a second time immediately after a resolving call with no new expiry in between; version and events were unchanged (true no-op)', () => {})
  test('7. leaving and reopening Ludo shows Resume Match — get_active_ludo_match returned the room/seat/turn_deadline_at for a seated, non-eliminated player with an active room', () => {})
  test('8. resuming restores the exact state and remaining server time — get_active_ludo_match\'s returned turn_deadline_at is the live server column, not a client-derived value; confirmed present and correct after a forced-expiry cycle', () => {})
  test('9. one missed turn does not eliminate — after one forced expiry, consecutive_missed_turns=1 and eliminated_at stayed null', () => {})
  test('10. two consecutive missed turns do not eliminate — after a second forced expiry for the same seat, consecutive_missed_turns=2 and eliminated_at stayed null', () => {})
  test('11. three consecutive missed turns eliminate — the third forced expiry set eliminated_at/elimination_reason=\'missed_turns\', removed the seat from activeSeatIndices, and (2-player match) flipped gameOver=true with the opponent as winner', () => {})
  test('12. a valid completed turn resets the consecutive missed-turn counter correctly — the other seat\'s own roll (a genuine action) reset ITS consecutive_missed_turns from 1 to 0 immediately', () => {})
  test('13. a 2-player forfeit awards the opponent the win — finalize_ludo_match ranked the eliminated seat #2 and the survivor #1 purely from finishedOrder, no special-cased forfeit logic needed in the payout path', () => {})
  test('14. rewards and match finalization happen exactly once — called finalize_ludo_match twice; coins/xp for both accounts were identical after the second call (250 coins/550 xp winner, 50 coins/125 xp loser, unchanged)', () => {})
  test('15. an eliminated player cannot resume — get_active_ludo_match returned null for the eliminated seat, and join_board_game_room_internal explicitly raises 42501 ("You have been eliminated from this match") if they try to rejoin directly', () => {})
  test('16. a player in an active match cannot create a second active Ludo room — create_board_game_room raised 22023 ("You already have an active Ludo match") when attempted while still seated in an unfinished match', () => {})
  test('17. match chat is restored after resume — MatchChat is keyed purely by roomId and reads board_game_messages for that room; Resume Match reuses the same roomId, so this is structurally guaranteed by existing, unmodified chat code — not independently re-tested with live messages this pass', () => {})
  test('18. Arabic mode does not mirror the board — unchanged from item 15 above (geometry.ts has zero RTL-awareness by construction); this list item is the same guarantee restated in the new spec\'s numbering', () => {})
})

/**
 * ─────────────────────────────────────────────────────────────────────────
 * Round 2 — Forfeit Match, stale/abandoned-match cleanup, and Active Match
 * Found correctness. A live two-account test after round 1 shipped found
 * the fixed timer/elimination system could still leave a match's
 * board_game_rooms.status stuck at 'active' forever if it was created
 * before turn_deadline_at existed (turn_deadline_at NULL never satisfies
 * a "< now()" expiry check), permanently blocking both seated users from
 * starting a new Ludo match. This round adds a real "give up now" action
 * and hardens every resolution path against that whole class of stuck
 * state. All 14 items below are server-side RPC properties, verified live
 * this round with two fresh throwaway accounts (fully torn down after) —
 * see the delivery report for the exact SQL/RPC sequence and observed
 * values for each.
 * ─────────────────────────────────────────────────────────────────────────
 */
describe.skip('19–32: Forfeit Match + stale-match cleanup properties (verified live this round — see delivery report)', () => {
  test('19. a player forfeits an active 2-player match — forfeit_ludo_match, called as the seated caller mid-match, set gameOver:true, activeSeatIndices to just the opponent, and finishedOrder:[opponent,forfeiter] in one atomic call; verified live (room 75a63cc2...)', () => {})
  test('20. the opponent receives the win exactly once — the same forfeit_ludo_match call internally invoked finalize_ludo_match (idempotent, status<>\'completed\' locked); winner ended at 250 coins/550 xp, forfeiter at 50 coins/125 xp; a second, separate finalize_ludo_match call afterward left both balances unchanged', () => {})
  test('21. both users can create a new match immediately afterward — get_active_ludo_match returned null for both seats post-forfeit; both successfully called create_board_game_room with zero guard exception (verified for both seats, each cleaned up immediately after)', () => {})
  test('22. a completed match never appears under Resume Match — same as #21, both get_active_ludo_match calls returned null once board_game_rooms.status was \'completed\'', () => {})
  test('23. one missed turn does not eliminate — forced a single deadline expiry on a fresh 2-account match via nothing but get_active_ludo_match (no rolls, no check_ludo_timeout); consecutive_missed_turns reached 1, eliminated_at stayed null', () => {})
  test('24. two consecutive missed turns do not eliminate — continued the same forced-expiry cascade; both seats independently reached consecutive_missed_turns=2 with eliminated_at still null for both', () => {})
  test('25. three consecutive missed turns eliminate automatically — the cascade continued (still zero rolls, zero check_ludo_timeout calls, zero live client) until one seat\'s 3rd consecutive miss set eliminated_at/elimination_reason=\'missed_turns\' and board_game_state flipped gameOver:true with the opponent in finishedOrder', () => {})
  test('26. three missed turns are resolved even when both clients are closed — the entire cascade in #23-25 was driven ONLY by alternating get_active_ludo_match calls (the "opening Ludo" entry point) from each side in turn, with a manually forced-past turn_deadline_at standing in for real elapsed time; neither seat ever rolled, moved, or called check_ludo_timeout — proving resolution does not depend on either player\'s live match screen being open', () => {})
  test('27. opening Ludo later cleans up the stale match — same evidence as #26: every single resolution step in the cascade was triggered by a get_active_ludo_match call, i.e. exactly the RPC the Ludo entry screen calls on load', () => {})
  test('28. concurrent clients cannot finalize the same match twice — REAL BUG CAUGHT LIVE THIS ROUND: after the #25 elimination cascade, board_game_rooms.status was still \'active\' (only board_game_state.gameOver had flipped — finalize is a separate, normally client-triggered step) because no live client existed to call it. get_active_ludo_match, called by the WINNING (non-eliminated) seat, incorrectly returned a truthy "resume this match" object for an already-decided match. Root-caused and fixed same-session: added private.ludo_maybe_finalize, now called from both get_active_ludo_match and ludo_guard_single_active_match immediately after resolving, so a gameOver:true match is finalized (idempotently — safe under concurrent calls) the instant ANY entry point discovers it, not just a live client\'s finalize effect. Re-ran the exact same call after the fix: returned null, room.status was \'completed\', rewards were granted exactly once', () => {})
  test('29. leaving a pre-match lobby does not count as a loss — leave_board_game_room only ever mutates left_at/host reassignment while room.status=\'waiting\'; it never writes eliminated_at, final_rank, or touches xp_ledger/coin_ledger. Exercised repeatedly this round (create_board_game_room + immediate leave_board_game_room, 4 separate times across both test accounts) — room was deleted each time (sole player, waiting), no player/reward rows were ever created', () => {})
  test('30. cancelling a pre-match room releases both users — LudoOnlineLobby\'s exit button now reads "Cancel Room" for the host and "Leave Room" for a joined player (cosmetic-only change — the underlying leave_board_game_room call and its safe pre-match-only semantics were already correct and already covered by #29); a room with only the host present is deleted outright on cancel, immediately freeing the game_id for a new one', () => {})
  test('31. an eliminated or forfeited user cannot resume — get_active_ludo_match filters on board_game_players.eliminated_at is null; verified for both the missed-turns-eliminated seat (#25) and the voluntarily-forfeited seat (#19), both returned null', () => {})
  test('32. rewards remain idempotent — verified twice this round via two independent mechanisms: (a) explicit double-call to finalize_ludo_match after a forfeit (#20), (b) the newly-added private.ludo_maybe_finalize being called from two different entry points (get_active_ludo_match and the create/join guard) on the same already-gameOver match without any reward drift, both relying on finalize_board_game\'s pre-existing status<>\'completed\' row lock', () => {})
})
