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
}) {
  const { engine, roomId, userId, autoJoinAsPlayer = true } = args

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
    }))
    .sort((a, b) => a.seatIndex - b.seatIndex)

  const state = stateRow?.state ?? null
  const currentSeatIndex = state !== null ? engine.currentSeatIndex(state) : null
  const currentSeat = currentSeatIndex !== null ? seats[currentSeatIndex] ?? null : null
  const mySeatIndex = seats.find((s) => s.userId === userId)?.seatIndex ?? null
  const isMyTurn = mySeatIndex !== null && currentSeatIndex === mySeatIndex
  const validMoves = state !== null && currentSeatIndex !== null ? engine.getValidMoves(state, currentSeatIndex) : []
  const result: BoardGameResult | null = state !== null ? engine.checkGameOver(state) : null

  const turnTimeLeftMs = room?.turn_started_at
    ? Math.max(0, room.turn_timer_seconds * 1000 - (nowMs - new Date(room.turn_started_at).getTime()))
    : null

  /** Pushes a move (or `null` to pass — only used internally for auto-pass) to the server. No-ops if it isn't actually this player's turn. */
  const submitMove = useCallback((move: TMove | null) => {
    if (!state || !stateRow || mySeatIndex === null || currentSeatIndex !== mySeatIndex || result) return
    if (move !== null) {
      const legal = engine.getValidMoves(state, mySeatIndex)
      const isLegal = legal.some((m) => JSON.stringify(m) === JSON.stringify(move))
      if (!isLegal) return
    }
    const { state: next, events: newEvents } = engine.applyMove(state, mySeatIndex, move)
    setEvents((e) => [...e, ...newEvents].slice(-40))
    const nextTurn = engine.currentSeatIndex(next)
    const expectedVersion = stateRow.version
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
  }, [state, stateRow, mySeatIndex, currentSeatIndex, result, engine, roomId])

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

  // Auto-move on timeout — if my turn's clock runs out and I haven't acted (e.g. I'm
  // disconnected or just slow), play the first legal move for me so the room can't stall forever.
  useEffect(() => {
    if (result || !isMyTurn || !state || !stateRow || turnTimeLeftMs === null) return
    if (turnTimeLeftMs > 0 || validMoves.length === 0) return
    const key = `timeout:${roomId}:${currentSeatIndex}:${stateRow.version}`
    if (autoActedKeyRef.current === key) return
    autoActedKeyRef.current = key
    submitMove(validMoves[0])
  }, [result, isMyTurn, state, stateRow, turnTimeLeftMs, validMoves, roomId, currentSeatIndex, submitMove])

  // The host finalizes the match once the engine reports it's over — finalize_board_game
  // is idempotent server-side, so even a race between two clients calling it is harmless.
  useEffect(() => {
    if (!result || !room || room.status !== 'active' || room.host_id !== userId || finalizedRef.current) return
    finalizedRef.current = true
    const meta = (state ? engine.getMatchMeta?.(state) : undefined) ?? {}
    finalizeBoardGame(
      roomId,
      result.rankings as unknown as Record<string, number>,
      (result.scores ?? {}) as unknown as Record<string, number>,
      meta as unknown as Record<string, unknown>
    )
  }, [result, room, roomId, userId, state, engine])

  const leave = useCallback(() => leaveBoardGameRoom(roomId), [roomId])

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
  }
}
