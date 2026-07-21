import { useCallback, useEffect, useRef, useState } from 'react'
import type { BoardGameEngine, BoardGameEvent, BoardGameResult, BoardGameSeat } from './types'
import {
  getBoardGameRoom, getBoardGamePlayers, getBoardGameState, joinBoardGameRoom,
  submitBoardGameMove, finalizeBoardGame, boardGameHeartbeat, leaveBoardGameRoom,
  getBoardGameSpectatorCount, subscribeToBoardGameRoom,
  type BoardGameRoom,
} from '../api'

/** A seated player plus the online-only presence info the local controller has no concept of. */
export interface OnlineSeat extends BoardGameSeat {
  isConnected: boolean
  hasLeft: boolean
  consecutiveMissedTurns: number
  eliminatedAt: string | null
  eliminationReason: string | null
}

/**
 * Generic ONLINE match controller — the Phase B counterpart to
 * useLocalBoardGame. Same BoardGameEngine<TState,TMove> module, same shape
 * of returned values (state, currentSeatIndex, currentSeat, validMoves,
 * events, result, submitMove) — but state now lives in board_game_state and
 * is synced across every seated player + spectator via Supabase Realtime
 * instead of local React state. A game screen already built against
 * useLocalBoardGame can be pointed at this hook instead with minimal
 * changes, per the framework's "write the engine once, run it local or
 * online" design.
 *
 * Move model is client-authoritative (matches submit_board_game_move's RPC
 * comments): whichever client's turn it is computes the new state locally
 * via engine.applyMove and pushes it; the server only enforces optimistic
 * concurrency (version check) + logs the move + advances the turn clock. On
 * a version conflict — another update raced ahead of ours — the optimistic
 * local state is simply never committed, and the next Realtime tick resyncs
 * this client to the authoritative row.
 *
 * Also handles what a local match never needs to: reconnect-on-mount,
 * presence heartbeats, a shared turn timer, auto-move on timeout so a
 * disconnected player can't stall the room forever, and idempotent
 * match-finalization (host-triggered, but safe if raced).
 */
export function useOnlineBoardGame<TState, TMove>(args: {
  engine: BoardGameEngine<TState, TMove>
  roomId: string
  userId: string
  /**
   * Re-asserts the caller's own seat on mount (idempotent, reconnect-aware —
   * see join_board_game_room). Leave this on for players so reopening the
   * app/tab mid-match reconnects automatically. Spectators must pass false:
   * they have no seat, and this would otherwise try to seat them as a
   * player.
   */
  autoJoinAsPlayer?: boolean
  /**
   * When provided, switches this hook into server-authoritative mode: moves
   * are never computed client-side — only the raw intent (move ?? {type:
   * 'pass'}) is sent to this function, and whatever state it returns is
   * trusted verbatim. Omit for the legacy client-authoritative generic path
   * (submitBoardGameMove); Ludo always passes this (see submitLudoMove).
   */
  serverSubmitMove?: (
    roomId: string,
    expectedVersion: number,
    move: TMove | Record<string, unknown>
  ) => Promise<{ error: string | null; conflict: boolean; result: { state: unknown; version: number; events?: BoardGameEvent[] } | null }>
  /**
   * When provided, match completion calls this instead of computing
   * rankings/scores from the client's own engine.checkGameOver() and posting
   * them to finalize_board_game — the server derives everything from its own
   * authoritative state instead. Omit for the legacy generic path.
   */
  serverFinalize?: (roomId: string) => Promise<{ error: string | null }>
  /**
   * Server-side turn-timer watchdog (Ludo only). When provided, the timer
   * is no longer resolved client-side at all — the timed-out player's own
   * device is never relied on. Instead this is called on mount, on tab
   * focus/visibility, and on a short interval, so the deadline gets
   * resolved by whichever participant's client happens to be open,
   * including the OTHER player's. See checkLudoTimeout.
   */
  serverCheckTimeout?: (roomId: string) => Promise<{
    error: string | null
    result: { state: unknown; version: number; events?: BoardGameEvent[] } | null
  }>
  /**
   * Real "give up now" action (Ludo only). Server-authoritative: verifies
   * the caller holds an active seat, resolves any already-expired turn
   * first, computes the winner from the remaining active seats, and
   * finalizes rewards in the same transaction — the client never decides
   * who wins or when. See forfeitLudoMatch.
   */
  serverForfeit?: (roomId: string) => Promise<{
    error: string | null
    result: { state: unknown; version: number; events?: BoardGameEvent[] } | null
  }>
}) {
  const { engine, roomId, userId, autoJoinAsPlayer = true, serverSubmitMove, serverFinalize, serverCheckTimeout, serverForfeit } = args

  const [loading, setLoading] = useState(true)
  const [room, setRoom] = useState<BoardGameRoom | null>(null)
  const [players, setPlayers] = useState<Awaited<ReturnType<typeof getBoardGamePlayers>>>([])
  const [stateRow, setStateRow] = useState<{ state: TState; version: number } | null>(null)
  const [spectatorCount, setSpectatorCount] = useState(0)
  const [events, setEvents] = useState<BoardGameEvent[]>([])
  const [nowMs, setNowMs] = useState(() => Date.now())
  const finalizedRef = useRef(false)
  const autoActedKeyRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    const [r, p, s, spec] = await Promise.all([
      getBoardGameRoom(roomId),
      getBoardGamePlayers(roomId, true), // includeLeft=true — seat roster must stay stable mid-match, see function doc
      getBoardGameState(roomId),
      getBoardGameSpectatorCount(roomId),
    ])
    setRoom(r)
    setPlayers(p)
    if (s) setStateRow({ state: s.state as unknown as TState, version: s.version })
    setSpectatorCount(spec)
    setLoading(false)
  }, [roomId])

  // Initial load + reconnect (players only) + realtime subscription.
  useEffect(() => {
    let cancelled = false
    const start = autoJoinAsPlayer ? joinBoardGameRoom(roomId) : Promise.resolve()
    start.finally(() => { if (!cancelled) refresh() })
    const unsubscribe = subscribeToBoardGameRoom(roomId, () => { if (!cancelled) refresh() })
    return () => { cancelled = true; unsubscribe() }
  }, [roomId, refresh, autoJoinAsPlayer])

  // Presence heartbeat so other clients' connected/disconnected badges stay accurate. Spectators don't hold a seat, so they don't heartbeat.
  useEffect(() => {
    if (!autoJoinAsPlayer) return
    const interval = setInterval(() => { boardGameHeartbeat(roomId) }, 12000)
    return () => clearInterval(interval)
  }, [roomId, autoJoinAsPlayer])

  // Smooth local clock for the turn timer, mirroring useMatchEngine's pattern —
  // avoids a network round-trip just to tick a countdown UI.
  useEffect(() => {
    const interval = setInterval(() => setNowMs(Date.now()), 200)
    return () => clearInterval(interval)
  }, [])

  const seats: OnlineSeat[] = players
    .map((p) => ({
      seatIndex: p.seat_index,
      userId: p.user_id,
      displayName: p.is_ai ? 'AI' : p.profile?.username ?? `Player ${p.seat_index + 1}`,
      isAI: p.is_ai,
      aiDifficulty: (p.ai_difficulty as BoardGameSeat['aiDifficulty']) ?? undefined,
      token: String(p.seat_index),
      isConnected: p.is_connected,
      hasLeft: !!p.left_at,
      consecutiveMissedTurns: p.consecutive_missed_turns ?? 0,
      eliminatedAt: p.eliminated_at ?? null,
      eliminationReason: p.elimination_reason ?? null,
    }))
    .sort((a, b) => a.seatIndex - b.seatIndex)

  const state = stateRow?.state ?? null
  const currentSeatIndex = state !== null ? engine.currentSeatIndex(state) : null
  const currentSeat = currentSeatIndex !== null ? seats[currentSeatIndex] ?? null : null
  const mySeatIndex = seats.find((s) => s.userId === userId)?.seatIndex ?? null
  const isMyTurn = mySeatIndex !== null && currentSeatIndex === mySeatIndex
  const validMoves = state !== null && currentSeatIndex !== null ? engine.getValidMoves(state, currentSeatIndex) : []
  const result: BoardGameResult | null = state !== null ? engine.checkGameOver(state) : null

  // Server-authoritative deadline (Ludo): turn_deadline_at is the one true
  // clock — this is purely a visual read of it, never a value the client
  // computes or decides on its own. Legacy client-authoritative games
  // (no serverCheckTimeout) fall back to the older turn_started_at +
  // turn_timer_seconds derivation, unchanged.
  const turnTimeLeftMs = serverCheckTimeout
    ? (room?.turn_deadline_at ? Math.max(0, new Date(room.turn_deadline_at).getTime() - nowMs) : null)
    : (room?.turn_started_at
        ? Math.max(0, room.turn_timer_seconds * 1000 - (nowMs - new Date(room.turn_started_at).getTime()))
        : null)

  /** Pushes a move (or `null` to pass — only used internally for auto-pass) to the server. No-ops if it isn't actually this player's turn. */
  const submitMove = useCallback((move: TMove | null) => {
    if (!state || !stateRow || mySeatIndex === null || currentSeatIndex !== mySeatIndex || result) return
    if (move !== null) {
      const legal = engine.getValidMoves(state, mySeatIndex)
      const isLegal = legal.some((m) => JSON.stringify(m) === JSON.stringify(move))
      if (!isLegal) return
    }
    const expectedVersion = stateRow.version

    if (serverSubmitMove) {
      // Server-authoritative path (Ludo): the server rolls, validates, and
      // computes the resulting state itself — the client sends only the
      // intent and trusts whatever comes back verbatim. On error/conflict we
      // don't touch local state; the next Realtime tick or poll resyncs us.
      serverSubmitMove(roomId, expectedVersion, move ?? { type: 'pass' }).then((res) => {
        if (!res.error && res.result) {
          setStateRow({ state: res.result.state as TState, version: res.result.version })
          if (res.result.events?.length) setEvents((e) => [...e, ...res.result!.events!].slice(-40))
        }
      })
      return
    }

    const { state: next, events: newEvents } = engine.applyMove(state, mySeatIndex, move)
    setEvents((e) => [...e, ...newEvents].slice(-40))
    const nextTurn = engine.currentSeatIndex(next)
    submitBoardGameMove(
      roomId,
      expectedVersion,
      next as unknown as Record<string, unknown>,
      (move ?? {}) as unknown as Record<string, unknown>,
      mySeatIndex,
      nextTurn ?? undefined
    ).then((res) => {
      // Only commit locally once the server confirms — on conflict/error we simply
      // don't apply it, and the next Realtime tick resyncs us to the true state.
      if (!res.error) setStateRow({ state: next, version: res.state?.version ?? expectedVersion + 1 })
    })
  }, [state, stateRow, mySeatIndex, currentSeatIndex, result, engine, roomId, serverSubmitMove])

  // Auto-pass when it's my turn and I have zero legal moves — same rule useLocalBoardGame applies locally.
  useEffect(() => {
    if (result || !isMyTurn || !state || !stateRow) return
    if (validMoves.length > 0) return
    const key = `pass:${roomId}:${currentSeatIndex}:${stateRow.version}`
    if (autoActedKeyRef.current === key) return
    autoActedKeyRef.current = key
    const t = setTimeout(() => submitMove(null), 400)
    return () => clearTimeout(t)
  }, [result, isMyTurn, state, stateRow, validMoves.length, roomId, currentSeatIndex, submitMove])

  // Auto-move on timeout — LEGACY client-authoritative path only. This
  // relies on the timed-out player's own device to notice and act, which
  // is exactly the bug server-side timeout resolution (below) fixes for
  // Ludo — so this is skipped entirely whenever serverCheckTimeout is
  // wired up, and the server-side watchdog owns timeout handling instead.
  useEffect(() => {
    if (serverCheckTimeout) return
    if (result || !isMyTurn || !state || !stateRow || turnTimeLeftMs === null) return
    if (turnTimeLeftMs > 0 || validMoves.length === 0) return
    const key = `timeout:${roomId}:${currentSeatIndex}:${stateRow.version}`
    if (autoActedKeyRef.current === key) return
    autoActedKeyRef.current = key
    submitMove(validMoves[0])
  }, [result, isMyTurn, state, stateRow, turnTimeLeftMs, validMoves, roomId, currentSeatIndex, submitMove, serverCheckTimeout])

  // Server-side turn-timer watchdog (Ludo). Any participant's client —
  // not just the timed-out player's — triggers resolution just by having
  // this match open: on mount, whenever the tab regains focus/visibility,
  // and on a short interval as a fallback for backgrounded/throttled tabs.
  // check_ludo_timeout is a no-op if nothing has actually expired, so this
  // is cheap and safe to call redundantly and concurrently.
  useEffect(() => {
    if (!serverCheckTimeout) return
    let cancelled = false
    const run = () => {
      serverCheckTimeout(roomId).then((res) => {
        if (cancelled || res.error || !res.result) return
        setStateRow((prev) => {
          if (prev && res.result!.version <= prev.version) return prev
          return { state: res.result!.state as TState, version: res.result!.version }
        })
        if (res.result.events?.length) setEvents((e) => [...e, ...res.result!.events!].slice(-40))
        refresh() // also pulls the fresh turn_deadline_at / turn_seat_index / players (elimination) onto `room`/`players`
      })
    }
    run()
    const interval = setInterval(run, 5000)
    const onVisible = () => { if (document.visibilityState === 'visible') run() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', run)
    return () => {
      cancelled = true
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', run)
    }
  }, [roomId, serverCheckTimeout, refresh])

  // Finalizes the match once the engine reports it's over — finalize_board_game
  // (and finalize_ludo_match) are idempotent server-side, so even a race
  // between multiple clients calling it is harmless. Server-authoritative
  // matches (Ludo) let ANY seated player trigger this, not just the host:
  // a forfeit-by-elimination match can very plausibly end with the host
  // being the eliminated (and likely absent) player, in which case a
  // host-only gate would mean nobody ever finalizes it. The legacy
  // client-authoritative path keeps the host-only gate unchanged.
  useEffect(() => {
    if (!result || !room || room.status !== 'active' || finalizedRef.current) return
    const canFinalize = serverFinalize ? mySeatIndex !== null : room.host_id === userId
    if (!canFinalize) return
    finalizedRef.current = true
    if (serverFinalize) {
      // Server-authoritative path (Ludo): rankings/scores/meta are derived
      // entirely from the server's own authoritative state — nothing
      // client-computed is sent.
      serverFinalize(roomId)
      return
    }
    const meta = (state ? engine.getMatchMeta?.(state) : undefined) ?? {}
    finalizeBoardGame(
      roomId,
      result.rankings as unknown as Record<string, number>,
      (result.scores ?? {}) as unknown as Record<string, number>,
      meta as unknown as Record<string, unknown>
    )
  }, [result, room, roomId, userId, state, engine, serverFinalize, mySeatIndex])

  const leave = useCallback(() => leaveBoardGameRoom(roomId), [roomId])

  // Real "give up now" action (Ludo only) — server-authoritative, same
  // result-application pattern as submitMove/serverCheckTimeout: whatever
  // state/events the server returns is applied verbatim, never computed
  // client-side. A no-op if serverForfeit wasn't provided or nothing is
  // seated for this player to give up.
  const forfeit = useCallback(() => {
    if (!serverForfeit) return
    serverForfeit(roomId).then((res) => {
      if (res.error || !res.result) return
      setStateRow((prev) => {
        if (prev && res.result!.version <= prev.version) return prev
        return { state: res.result!.state as TState, version: res.result!.version }
      })
      if (res.result.events?.length) setEvents((e) => [...e, ...res.result!.events!].slice(-40))
      refresh() // pulls the fresh room.status / players.eliminated_at onto `room`/`players`
    })
  }, [roomId, serverForfeit, refresh])

  return {
    loading,
    room,
    players,
    seats,
    state,
    currentSeatIndex,
    currentSeat,
    mySeatIndex,
    isMyTurn,
    validMoves,
    events,
    result,
    spectatorCount,
    turnTimeLeftMs,
    submitMove,
    leave,
    forfeit,
  }
}
