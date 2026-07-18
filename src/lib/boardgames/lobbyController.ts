import { useCallback, useEffect, useState } from 'react'
import {
  getBoardGameRoom, getBoardGamePlayers, getBoardGameSpectatorCount,
  setBoardGameReady, startBoardGameRoom, leaveBoardGameRoom, joinBoardGameRoom,
  subscribeToBoardGameRoom, type BoardGameRoom,
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
    return () => { cancelled = true; unsubscribe() }
  }, [roomId, refresh])

  const myPlayer = players.find((p) => p.user_id === userId) ?? null
  const isHost = !!room && room.host_id === userId
  const allReady = players.length > 0 && players.every((p) => p.is_ready)
  const canStart = isHost && !!room && players.length >= room.min_players && allReady

  const setReady = useCallback(
    (ready: boolean) => (roomId ? setBoardGameReady(roomId, ready) : Promise.resolve({ error: 'no room' })),
    [roomId]
  )
  const startMatch = useCallback(
    () => (roomId ? startBoardGameRoom(roomId) : Promise.resolve({ error: 'no room', room: null })),
    [roomId]
  )
  const leave = useCallback(() => (roomId ? leaveBoardGameRoom(roomId) : Promise.resolve()), [roomId])

  return { loading, room, players, spectatorCount, myPlayer, isHost, allReady, canStart, setReady, startMatch, leave }
}
