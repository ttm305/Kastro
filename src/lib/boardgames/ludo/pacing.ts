/**
 * Ludo gameplay pacing — the single source of truth for every timing value
 * used by the turn sequencer (LudoPacingSlice today; the full LudoScreen
 * match loop once the vertical slice is approved). Values are picked from
 * the middle of each required range so both Normal and Fast stay inside
 * spec without per-call rounding drift.
 *
 * Fast mode is a flat ~40% speed-up (0.6× duration) applied uniformly, per
 * the requirement that it "must remain readable and never skip movement" —
 * every phase still runs, just compressed, rather than removing steps.
 */

export type LudoSpeed = 'normal' | 'fast'

const SPEED_STORAGE_KEY = 'kastro-ludo-speed'

export function loadLudoSpeed(): LudoSpeed {
  try {
    return localStorage.getItem(SPEED_STORAGE_KEY) === 'fast' ? 'fast' : 'normal'
  } catch {
    return 'normal'
  }
}

export function saveLudoSpeed(speed: LudoSpeed) {
  try {
    localStorage.setItem(SPEED_STORAGE_KEY, speed)
  } catch {
    // localStorage unavailable (private mode, etc.) — speed just won't persist.
  }
}

export interface LudoPacingTable {
  /** Turn-change banner announcing whose turn it is. */
  turnChange: number
  /** Die "getting ready" wobble before it starts tumbling. */
  diceAnticipation: number
  /** Die tumble animation. */
  diceRoll: number
  /** Final die face held clearly visible before anything else happens. */
  diceResultHold: number
  /** AI-only: pause before the AI selects a piece, so its decision reads as deliberate. */
  aiThinkPause: number
  /** Selected piece highlighted before it starts moving. */
  selectHighlight: number
  /** One board square of movement. */
  perSquare: number
  /** Pause after a piece finishes landing, before any capture/home/extra-turn feedback. */
  landingPause: number
  /** Capture animation + "sent home" feedback. */
  captureFeedback: number
  /** Home-entry animation + feedback. */
  homeEntryFeedback: number
  /** "Extra turn!" message. */
  extraTurnMessage: number
  /** Pause before control passes to the next player. */
  nextTurnDelay: number
}

const NORMAL: LudoPacingTable = {
  turnChange: 800,
  diceAnticipation: 300,
  diceRoll: 1350,
  diceResultHold: 720,
  aiThinkPause: 750,
  selectHighlight: 300,
  perSquare: 200,
  landingPause: 500,
  captureFeedback: 950,
  homeEntryFeedback: 800,
  extraTurnMessage: 800,
  nextTurnDelay: 850,
}

const FAST_FACTOR = 0.6 // ~40% faster than Normal

const FAST: LudoPacingTable = Object.fromEntries(
  (Object.entries(NORMAL) as [keyof LudoPacingTable, number][]).map(([key, ms]) => [key, Math.round(ms * FAST_FACTOR)]),
) as unknown as LudoPacingTable

export const LUDO_PACING: Record<LudoSpeed, LudoPacingTable> = { normal: NORMAL, fast: FAST }

export function getPacing(speed: LudoSpeed): LudoPacingTable {
  return LUDO_PACING[speed]
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
