// Standalone verification harness (not part of the app). Node's ESM loader
// can't resolve this project's extensionless relative TS imports without a
// bundler, so the real engine.ts + ai.ts source is inlined verbatim below
// (copy-pasted, not reimplemented) rather than imported, purely to sidestep
// module resolution. The harness itself replicates exactly what
// localController.ts's two effects do — including React's shallow
// dependency-array comparison — once with the OLD dependency arrays (bug)
// and once with the NEW ones (fix), across many randomized AI-vs-AI games.

// ============ BEGIN: verbatim copy of src/lib/boardgames/ludo/engine.ts (logic only, types stripped by node --experimental-strip-types) ============
const LUDO_HOME_STRETCH_UNUSED = 6
const LUDO_FINISHED = 56
const LUDO_RING_LENGTH = 52
const START_OFFSETS = [0, 13, 26, 39]
const SAFE_CELLS = new Set([0, 8, 13, 21, 26, 34, 39, 47])
const PIECES_PER_SEAT = 4
const MAX_CONSECUTIVE_SIXES = 3

function pieceId(seatIndex: number, pieceIndex: number) {
  return `${seatIndex}:${pieceIndex}`
}

function nextRng(state: number) {
  const next = (Math.imul(state, 1103515245) + 12345) & 0x7fffffff
  return { value: next, next }
}

function rollDie(rngState: number) {
  const { value, next } = nextRng(rngState)
  return { die: (value % 6) + 1, next }
}

function globalRingCell(seatIndex: number, pathPos: number): number | null {
  if (pathPos < 0 || pathPos > 50) return null
  return (START_OFFSETS[seatIndex] + pathPos) % LUDO_RING_LENGTH
}

function nextActiveSeat(state: any, from: number): number {
  const order = state.activeSeatIndices
  if (order.length === 0) return from
  const idx = order.indexOf(from)
  const nextIdx = (idx + 1) % order.length
  return order[nextIdx]
}

function seatFinishedAllPieces(state: any, seatIndex: number): boolean {
  return state.pieces.filter((p: any) => p.seatIndex === seatIndex).every((p: any) => p.pathPos === LUDO_FINISHED)
}

function clonePieces(pieces: any[]) {
  return pieces.map((p) => ({ ...p }))
}

const LudoEngine = {
  createInitialState(seats: any[]) {
    const numSeats = seats.length
    const pieces: any[] = []
    for (let s = 0; s < numSeats; s++) {
      for (let p = 0; p < PIECES_PER_SEAT; p++) {
        pieces.push({ seatIndex: s, pieceIndex: p, pathPos: -1 })
      }
    }
    return {
      numSeats,
      pieces,
      turnSeatIndex: 0,
      diceValue: null,
      consecutiveSixes: 0,
      finishedOrder: [],
      activeSeatIndices: seats.map((_: any, i: number) => i),
      rngState: Date.now() & 0x7fffffff,
      gameOver: false,
      piecesLostCount: Object.fromEntries(seats.map((_: any, i: number) => [i, 0])),
    }
  },

  currentSeatIndex(state: any) {
    return state.gameOver ? null : state.turnSeatIndex
  },

  getValidMoves(state: any, seatIndex: number) {
    if (state.gameOver || state.turnSeatIndex !== seatIndex) return []
    if (state.diceValue === null) return [{ type: 'roll' }]
    const dice = state.diceValue
    const myPieces = state.pieces.filter((p: any) => p.seatIndex === seatIndex)
    const moves: any[] = []
    for (const piece of myPieces) {
      if (piece.pathPos === LUDO_FINISHED) continue
      if (piece.pathPos === -1) {
        if (dice === 6) moves.push({ type: 'move', pieceId: pieceId(seatIndex, piece.pieceIndex) })
        continue
      }
      const target = piece.pathPos + dice
      if (target > LUDO_FINISHED) continue
      moves.push({ type: 'move', pieceId: pieceId(seatIndex, piece.pieceIndex) })
    }
    return moves
  },

  applyMove(state: any, seatIndex: number, move: any) {
    const events: any[] = []

    if (move === null) {
      const rolledSix = state.diceValue === 6
      events.push({ type: 'noMovesAvailable', seatIndex })
      const next: any = { ...state, pieces: clonePieces(state.pieces), diceValue: null }
      if (rolledSix && state.consecutiveSixes < MAX_CONSECUTIVE_SIXES) {
        next.turnSeatIndex = seatIndex
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

    const [pSeat, pIndexStr] = move.pieceId.split(':')
    const pIndex = Number(pIndexStr)
    const pieces = clonePieces(state.pieces)
    const piece = pieces.find((p: any) => p.seatIndex === Number(pSeat) && p.pieceIndex === pIndex)!
    const dice = state.diceValue ?? 0

    const fromBase = piece.pathPos === -1
    piece.pathPos = fromBase ? 0 : piece.pathPos + dice
    events.push({ type: 'pieceMoved', seatIndex, pieceId: move.pieceId, from: fromBase ? -1 : piece.pathPos - dice, to: piece.pathPos })

    const landedCell = globalRingCell(seatIndex, piece.pathPos)
    const piecesLostCount = { ...state.piecesLostCount }
    if (landedCell !== null && !SAFE_CELLS.has(landedCell)) {
      for (const other of pieces) {
        if (other.seatIndex === seatIndex) continue
        if (globalRingCell(other.seatIndex, other.pathPos) === landedCell) {
          other.pathPos = -1
          piecesLostCount[other.seatIndex] = (piecesLostCount[other.seatIndex] ?? 0) + 1
          events.push({ type: 'pieceCaptured', capturedSeatIndex: other.seatIndex, byPieceId: move.pieceId, atCell: landedCell })
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
        activeSeatIndices = activeSeatIndices.filter((s: number) => s !== seatIndex)
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
    const nextTurn = gameOver
      ? state.turnSeatIndex
      : rolledSix && state.consecutiveSixes < MAX_CONSECUTIVE_SIXES && activeSeatIndices.includes(seatIndex)
        ? seatIndex
        : nextActiveSeat({ ...state, activeSeatIndices }, seatIndex)

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

  checkGameOver(state: any) {
    if (!state.gameOver) return null
    const rankings: Record<number, number> = {}
    state.finishedOrder.forEach((seatIndex: number, i: number) => { rankings[seatIndex] = i + 1 })
    for (let s = 0; s < state.numSeats; s++) {
      if (!(s in rankings)) rankings[s] = state.finishedOrder.length + 1
    }
    return { rankings }
  },
}

function isSafeGlobalCell(cell: number) {
  return SAFE_CELLS.has(cell)
}
function pieceGlobalCell(seatIndex: number, pathPos: number) {
  return globalRingCell(seatIndex, pathPos)
}
// ============ END engine.ts inline copy ============

// ============ BEGIN: verbatim copy of src/lib/boardgames/ludo/ai.ts (logic only) ============
const RANDOM_MOVE_CHANCE: Record<string, number> = { easy: 0.55, medium: 0.22, hard: 0.05 }

function scoreMove(state: any, seatIndex: number, move: any): number {
  if (move.type === 'roll') return 0
  const { state: after, events } = LudoEngine.applyMove(state, seatIndex, move)
  let score = 0
  const captures = events.filter((e: any) => e.type === 'pieceCaptured').length
  score += captures * 60
  const wentHome = events.some((e: any) => e.type === 'pieceHome')
  if (wentHome) score += 45
  const [pSeatStr, pIndexStr] = move.pieceId.split(':')
  const beforePiece = state.pieces.find((p: any) => p.seatIndex === Number(pSeatStr) && p.pieceIndex === Number(pIndexStr))!
  const afterPiece = after.pieces.find((p: any) => p.seatIndex === Number(pSeatStr) && p.pieceIndex === Number(pIndexStr))!
  const leftBase = beforePiece.pathPos === -1 && afterPiece.pathPos !== -1
  if (leftBase) score += 25
  const cell = pieceGlobalCell(seatIndex, afterPiece.pathPos)
  if (cell !== null) {
    if (isSafeGlobalCell(cell)) score += 8
    else score -= 3
  }
  score += Math.max(0, afterPiece.pathPos) * 0.3
  return score
}

function createLudoAI(difficulty: string) {
  return {
    difficulty,
    chooseMove(state: any, seatIndex: number, validMoves: any[]) {
      if (validMoves.length === 1) return validMoves[0]
      if (validMoves[0]?.type === 'roll') return validMoves[0]
      if (Math.random() < RANDOM_MOVE_CHANCE[difficulty]) {
        return validMoves[Math.floor(Math.random() * validMoves.length)]
      }
      let best = validMoves[0]
      let bestScore = -Infinity
      for (const move of validMoves) {
        const s = scoreMove(state, seatIndex, move)
        if (s > bestScore) { bestScore = s; best = move }
      }
      return best
    },
  }
}
// ============ END ai.ts inline copy ============

// ============ Harness: replicates localController.ts's two effects exactly ============
type Deps = unknown[]
function depsEqual(a: Deps, b: Deps) {
  return a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
}

function simulateOneGame(seed: number, useTurnCountFix: boolean, maxSteps: number) {
  const seats = [
    { seatIndex: 0, isAI: true },
    { seatIndex: 1, isAI: true },
    { seatIndex: 2, isAI: true },
    { seatIndex: 3, isAI: true },
  ]

  let state: any = LudoEngine.createInitialState(seats)
  state = { ...state, rngState: seed & 0x7fffffff }

  const ai = createLudoAI('medium')
  let turnCount = 0
  let result: any = null

  const derive = (s: any) => {
    const currentSeatIndex = LudoEngine.currentSeatIndex(s)
    const currentSeat = currentSeatIndex !== null ? seats[currentSeatIndex] : null
    const validMoves = currentSeatIndex !== null ? LudoEngine.getValidMoves(s, currentSeatIndex) : []
    return { currentSeatIndex, currentSeat, validMoves }
  }

  const commit = (seatIndex: number, move: any) => {
    const { state: next } = LudoEngine.applyMove(state, seatIndex, move)
    state = next
    turnCount += 1
    const over = LudoEngine.checkGameOver(state)
    if (over) result = over
  }

  let prevPassDeps: Deps | null = null
  let prevAiDeps: Deps | null = null

  for (let step = 0; step < maxSteps; step++) {
    if (result) return { finished: true, steps: step }

    const { currentSeatIndex, currentSeat, validMoves } = derive(state)
    if (currentSeatIndex === null) return { finished: true, steps: step }

    const passDeps: Deps = useTurnCountFix
      ? [currentSeatIndex, validMoves.length, result, turnCount]
      : [currentSeatIndex, validMoves.length, result]
    const passWouldFire = prevPassDeps === null || !depsEqual(prevPassDeps, passDeps)
    prevPassDeps = passDeps

    if (validMoves.length === 0) {
      if (!passWouldFire) return { finished: false, steps: step, stuckReason: 'auto-pass effect did not re-fire (stale deps)' }
      commit(currentSeatIndex, null)
      continue
    }

    if (currentSeat && (currentSeat as any).isAI) {
      const aiDeps: Deps = useTurnCountFix
        ? [currentSeatIndex, (currentSeat as any).isAI, validMoves.length, result, turnCount]
        : [currentSeatIndex, (currentSeat as any).isAI, validMoves.length, result]
      const aiWouldFire = prevAiDeps === null || !depsEqual(prevAiDeps, aiDeps)
      prevAiDeps = aiDeps

      if (!aiWouldFire) return { finished: false, steps: step, stuckReason: 'AI auto-play effect did not re-fire (stale deps)' }
      const move = ai.chooseMove(state, currentSeatIndex, validMoves)
      commit(currentSeatIndex, move)
      continue
    }

    return { finished: false, steps: step, stuckReason: 'unexpected human turn' }
  }

  return { finished: false, steps: maxSteps, stuckReason: 'exceeded maxSteps without finishing' }
}

function runBatch(useTurnCountFix: boolean, trials: number) {
  let stuck = 0
  let finished = 0
  const stuckReasons: Record<string, number> = {}
  for (let i = 0; i < trials; i++) {
    const r: any = simulateOneGame(1000 + i * 7919, useTurnCountFix, 20000)
    if (r.finished) finished++
    else {
      stuck++
      stuckReasons[r.stuckReason ?? 'unknown'] = (stuckReasons[r.stuckReason ?? 'unknown'] ?? 0) + 1
    }
  }
  return { finished, stuck, stuckReasons }
}

const TRIALS = 300
console.log(`Simulating ${TRIALS} AI-vs-AI games (4 seats) with OLD (buggy) effect deps...`)
const before = runBatch(false, TRIALS)
console.log('  finished:', before.finished, '/', TRIALS, ' stuck:', before.stuck, before.stuckReasons)

console.log(`\nSimulating ${TRIALS} AI-vs-AI games (4 seats) with NEW (fixed) effect deps...`)
const after = runBatch(true, TRIALS)
console.log('  finished:', after.finished, '/', TRIALS, ' stuck:', after.stuck, after.stuckReasons)

console.log('\n=== VERDICT ===')
console.log('Bug reproduced with old deps:', before.stuck > 0 ? 'YES' : 'NO (unexpected)')
console.log('Fix eliminates the hang:', after.stuck === 0 ? 'YES' : 'NO (still stuck!)')
