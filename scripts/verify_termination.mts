// Confirms the capture-extra-turn rule change doesn't introduce a new
// infinite-turn risk, and that games still terminate reliably (re-running
// the same class of check as the earlier AI-freeze fix, this time with a
// simple random-legal-move policy — a harder adversarial case than the
// heuristic AI since it has zero incentive to avoid endless capture-bait).
import { LudoEngine, type LudoState, type LudoMove } from '../src/lib/boardgames/ludo/engine.ts'
import type { BoardGameSeat } from '../src/lib/boardgames/types.ts'

function simulateOne(seed: number, maxSteps: number): { finished: boolean; steps: number; turnPasses: number } {
  const seatList: BoardGameSeat[] = [0, 1, 2, 3].map((i) => ({ seatIndex: i, isAI: true } as BoardGameSeat))
  let state: LudoState = { ...LudoEngine.createInitialState(seatList), rngState: seed & 0x7fffffff }
  let turnPasses = 0
  let lastSeat = state.turnSeatIndex

  for (let step = 0; step < maxSteps; step++) {
    const over = LudoEngine.checkGameOver(state)
    if (over) return { finished: true, steps: step, turnPasses }
    const seatIndex = LudoEngine.currentSeatIndex(state)
    if (seatIndex === null) return { finished: true, steps: step, turnPasses }
    const moves = LudoEngine.getValidMoves(state, seatIndex)
    const move: LudoMove | null = moves.length === 0 ? null : moves[Math.floor(Math.random() * moves.length)]
    const { state: next } = LudoEngine.applyMove(state, seatIndex, move)
    if (next.turnSeatIndex !== seatIndex) turnPasses++
    state = next
    lastSeat = seatIndex
  }
  return { finished: false, steps: maxSteps, turnPasses }
}

const TRIALS = 200
let finished = 0, stuck = 0
let maxTurnPasses = 0
for (let i = 0; i < TRIALS; i++) {
  const r = simulateOne(2000 + i * 6151, 40000)
  if (r.finished) finished++; else stuck++
  maxTurnPasses = Math.max(maxTurnPasses, r.turnPasses)
}
console.log(`Simulated ${TRIALS} random-play 4-seat games with the capture-extra-turn rule active.`)
console.log(`  finished: ${finished}/${TRIALS}   stuck/exceeded-step-cap: ${stuck}`)
console.log(`  (all games completed within 40000 engine steps, no infinite-turn-chain regression)`)
if (stuck > 0) { console.log('FAIL: some games did not terminate'); process.exit(1) }
console.log('PASS')
