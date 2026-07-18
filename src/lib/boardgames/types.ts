/**
 * ─────────────────────────────────────────────────────────────────────────
 * Generic board-game framework — shared contract every board game (Ludo,
 * and later UNO, Chess, Checkers, Connect 4, Backgammon, …) implements.
 *
 * WHAT'S SHARED vs WHAT'S PER-GAME
 * ─────────────────────────────────
 * Shared (this file + localController.ts + the future online-room backend):
 *   - Room/seat/turn bookkeeping, turn timers, reconnect, spectators
 *   - The local pass-and-play + vs-AI match loop
 *   - Wiring match results into Coins / XP / Statistics / Achievements /
 *     Leaderboards / Cosmetics / Match History (via the same universal
 *     private.record_game_played / record_game_result / apply_xp_delta /
 *     apply_coin_delta primitives already used by every quiz game)
 *
 * Per-game (one small module per game, e.g. src/lib/boardgames/ludo/*):
 *   - The actual rules: initial state, legal moves, applying a move,
 *     detecting game-over + final rankings
 *   - The AI opponent's move-choosing heuristic
 *   - The board UI/rendering
 *
 * Adding a new board game means writing ONE engine module + ONE AI module +
 * ONE screen. Everything else — rooms, matchmaking, timers, spectators,
 * reconnect, rewards, stats, achievements, leaderboards, cosmetics, match
 * history — is reused with zero new code, by design.
 * ─────────────────────────────────────────────────────────────────────────
 */

/** A seat at the table. `userId` is null for an empty seat or an AI seat. */
export interface BoardGameSeat {
  seatIndex: number
  userId: string | null
  displayName: string
  isAI: boolean
  aiDifficulty?: AIDifficulty
  /** Stable per-game identity for this seat — e.g. Ludo's 4 colors. Assigned by the engine at setup. */
  token: string
}

export type AIDifficulty = 'easy' | 'medium' | 'hard'

/** Outcome of a finished match, ready to hand to the universal reward pipeline. */
export interface BoardGameResult {
  /** Seat → final rank, 1 = winner. Ties share a rank. Omit seats that never finished (e.g. abandoned). */
  rankings: Record<number /* seatIndex */, number>
  /** Optional per-seat score for leaderboards/best-score stats, if the game has a meaningful numeric score. */
  scores?: Record<number, number>
}

/**
 * The contract every board game's rules module implements. `TState` and
 * `TMove` are opaque JSON-serializable shapes owned entirely by the game —
 * the shared framework never inspects their contents, only calls these
 * methods.
 */
export interface BoardGameEngine<TState, TMove> {
  /** Unique key, e.g. 'ludo'. Matches the `games.id` row once seeded server-side. */
  gameKey: string
  minPlayers: number
  maxPlayers: number
  /** Build the starting state for a fresh match given the seated players (in seat order). */
  createInitialState(seats: BoardGameSeat[]): TState
  /** Whose turn is it? Returns null once the game is over. */
  currentSeatIndex(state: TState): number | null
  /** All legal moves the current player may make. Empty array means "must pass" — the engine handles the pass itself in applyMove with a null move. */
  getValidMoves(state: TState, seatIndex: number): TMove[]
  /** Apply a move (or `null` to pass, only ever called when getValidMoves was empty) and return the new state plus any events the UI may want to animate/announce. */
  applyMove(state: TState, seatIndex: number, move: TMove | null): { state: TState; events: BoardGameEvent[] }
  /** Null while the game is ongoing; the final result once it's over. */
  checkGameOver(state: TState): BoardGameResult | null
  /**
   * Optional per-seat "match facts" the game wants to report at finalize
   * time — for achievements/records that can't be derived from aggregate
   * stats (e.g. "won without losing a piece"). Purely a black box to the
   * shared framework: it's collected and forwarded to finalize_board_game's
   * p_meta as-is, never inspected. Omit if a game has nothing to report.
   */
  getMatchMeta?(state: TState): Record<number, Record<string, unknown>>
}

/** Lightweight event stream so the UI can animate/announce things (dice roll, capture, piece home, etc.) without the engine knowing about React. */
export interface BoardGameEvent {
  type: string
  [key: string]: unknown
}

/** The contract an AI opponent implements — one per game, since move quality depends entirely on that game's rules. */
export interface BoardGameAI<TState, TMove> {
  difficulty: AIDifficulty
  chooseMove(state: TState, seatIndex: number, validMoves: TMove[]): TMove
}
