import { useCallback, useEffect, useState } from 'react'
import {
  getBoardGameRoom, getBoardGamePlayers, getBoardGameSpectatorCount,
  setBoardGameReady, startBoardGameRoom, leaveBoardGameRoom, joinBoardGameRoom,
  claimLudoColor, subscribeToBoardGameRoom, type BoardGameRoom,
} from '../api'

/**
 * Generic pre-match lobby controller — the waiting room every board game
 * shares: seated players, ready-up, invite code, spectator count, and a
 * host-gated "start match" once the minimum seat count is filled and
 * everyone's ready. No game engine involved yet — board_game_state is still
 * the empty placeholder row created at room-creation time. Once
 * start_board_game_room flips the room to 'active', the game screen should
 * swap this hook out for useOnlineBoardGame (see onlineController.ts) to
 * actually play.
 *
 * Reusable as-is by every future board game's lobby screen — nothing here
 * is Ludo-specific.
 */
export function useBoardGameLobby(roomId: string | null, userId: string) {
  const [loading, setLoading] = useState(true)
  const [room, setRoom] = useState<BoardGameRoom | null>(null)
  const [players, setPlayers] = useState<Awaited<ReturnType<typeof getBoardGamePlayers>>>([])
  const [spectatorCount, setSpectatorCount] = useState(0)

  const refresh = useCallback(async () => {
    if (!roomId) return
    const [r, p, spec] = await Promise.all([
      getBoardGameRoom(roomId),
      getBoardGamePlayers(roomId), // lobby view — departed players drop off the ready-up list
      getBoardGameSpectatorCount(roomId),
    ])
    setRoom(r)
    setPlayers(p)
    setSpectatorCount(spec)
    setLoading(false)
  }, [roomId])

  useEffect(() => {
    if (!roomId) return
    let cancelled = false
    // Reconnect-aware: harmless if the caller already holds their seat (e.g. came
    // straight from createBoardGameRoom/joinBoardGameRoom), essential if they're
    // returning to a lobby they'd already joined in an earlier session.
    joinBoardGameRoom(roomId).finally(() => { if (!cancelled) refresh() })
    const unsubscribe = subscribeToBoardGameRoom(roomId, () => { if (!cancelled) refresh() })

    // Realtime channels don't survive every Safari/PWA background→foreground
    // cycle cleanly (iOS can suspend the socket without ever firing a client
    // "closed" event), and a stale channel that never fires again would leave
    // the lobby stuck on whatever it last saw — e.g. permanently "0/2 ready"
    // even though the other device is happily 2/2. Force a direct refetch
    // (bypassing realtime entirely) whenever the tab/app comes back to the
    // foreground or the network comes back, so state self-heals regardless of
    // whether the realtime socket itself recovered.
    const onForeground = () => { if (!cancelled && document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('online', onForeground)
    window.addEventListener('focus', onForeground)

    // Realtime is the fast path; this is the guaranteed-correct fallback so a
    // dropped/never-fired event can't leave two devices looking at different
    // ready counts indefinitely. Cheap (three small selects) and short-lived —
    // only runs while a lobby screen is actually mounted.
    const pollId = window.setInterval(() => { if (!cancelled) refresh() }, 4000)

    return () => {
      cancelled = true
      unsubscribe()
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('online', onForeground)
      window.removeEventListener('focus', onForeground)
      window.clearInterval(pollId)
    }
  }, [roomId, refresh])

  const myPlayer = players.find((p) => p.user_id === userId) ?? null
  const isHost = !!room && room.host_id === userId
  const allReady = players.length > 0 && players.every((p) => p.is_ready)
  // Ludo players no longer get a seat/color auto-assigned on join — they
  // must explicitly claim one (see claimColor below). For every other game
  // seat_index is still auto-assigned at join time, so this is always true
  // for them and never blocks starting. The host can't start until every
  // currently-seated player has a color, same as the "everyone ready" gate.
  const allColored = players.length > 0 && players.every((p) => p.seat_index !== null)
  const canStart = isHost && !!room && players.length >= room.min_players && allReady && allColored

  // Every mutation refetches immediately on success instead of waiting on the
  // realtime echo to come back around — that's what made the Ready button
  // look broken: the write could succeed while the UI only ever moved if/when
  // a postgres_changes event happened to arrive. Now the acting client's own
  // screen updates instantly regardless of realtime health, and errors (e.g.
  // "You are not seated in this room") are returned to the caller instead of
  // being swallowed.
  const setReady = useCallback(
    async (ready: boolean) => {
      if (!roomId) return { error: 'no room' }
      const result = await setBoardGameReady(roomId, ready)
      await refresh()
      return result
    },
    [roomId, refresh]
  )
  const startMatch = useCallback(
    async () => {
      if (!roomId) return { error: 'no room', room: null }
      const result = await startBoardGameRoom(roomId)
      await refresh()
      return result
    },
    [roomId, refresh]
  )
  const leave = useCallback(async () => {
    if (!roomId) return
    await leaveBoardGameRoom(roomId)
  }, [roomId])

  // Ludo-only (claim_ludo_color itself rejects non-Ludo rooms server-side) —
  // claims or, with color=null, releases a color for the caller. Same
  // instant-refetch pattern as setReady/startMatch: the acting client's own
  // screen updates immediately instead of waiting on the realtime echo.
  const claimColor = useCallback(
    async (color: number | null) => {
      if (!roomId) return { error: 'no room' }
      const result = await claimLudoColor(roomId, color)
      await refresh()
      return result
    },
    [roomId, refresh]
  )

  return { loading, room, players, spectatorCount, myPlayer, isHost, allReady, allColored, canStart, setReady, startMatch, claimColor, leave }
}
