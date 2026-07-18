import { useState, useEffect, useRef, useCallback } from 'react'
import {
  getMatchRoom, getRoomPlayers, getCurrentRound, subscribeToRoom, advanceRoom, getRoundReveal,
  type MatchRoom, type MatchRoomPlayer, type MatchRound,
} from './api'

export type EnginePhase = 'lobby' | 'get_ready' | 'playing' | 'reveal' | 'results'

export interface RoomPlayerWithProfile extends MatchRoomPlayer {
  profile?: { id: string; username: string; avatar_url: string | null; level: number }
}

export interface RoundRevealRow {
  user_id: string
  is_correct: boolean
  points_awarded: number
  time_taken_ms: number | null
  correct_answer: Record<string, unknown>
}

/**
 * Drives the entire room → round → reveal → results lifecycle for any game
 * built on the shared match engine (match_rooms/match_rounds/...). Fully
 * game-agnostic — EmojiDecodeScreen and ColorBlitzScreen both consume this
 * hook and only differ in how they render `round.payload` and what shape of
 * `answer` object they submit. Timing is derived from the server-authoritative
 * `starts_at`/`ends_at` on each round, ticked locally so timer bars stay
 * smooth without a network round-trip every frame.
 */
export function useMatchEngine(roomId: string | null) {
  const [room, setRoom] = useState<MatchRoom | null>(null)
  const [players, setPlayers] = useState<RoomPlayerWithProfile[]>([])
  const [round, setRound] = useState<MatchRound | null>(null)
  const [reveal, setReveal] = useState<RoundRevealRow[] | null>(null)
  const [nowMs, setNowMs] = useState(() => Date.now())
  // Distinguishes "the room/players query actually failed" (permission error,
  // network drop, etc — must be shown to the player) from "this room simply
  // has no players yet" (which is never true for the room's own creator, but
  // can't be told apart from a swallowed error without this). This is what
  // fixes the "0/0 ready, empty room, no visible error" class of bug: a
  // failed fetch now surfaces here instead of silently rendering as an empty
  // lobby forever.
  const [fetchError, setFetchError] = useState<string | null>(null)
  const advancedForRoundRef = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    if (!roomId) return
    const [{ room: r, error: roomErr }, { players: ps, error: playersErr }, rd] = await Promise.all([
      getMatchRoom(roomId), getRoomPlayers(roomId), getCurrentRound(roomId),
    ])
    const err = roomErr ?? playersErr ?? null
    setFetchError(err)
    // On a failed fetch, keep whatever we last successfully had rather than
    // wiping the screen to a false "0 players" — the error banner (driven by
    // fetchError) is what tells the player something's actually wrong.
    if (!roomErr) setRoom(r)
    if (!playersErr) setPlayers(ps as RoomPlayerWithProfile[])
    setRound((prev) => (rd && prev && rd.id === prev.id ? prev : rd))
  }, [roomId])

  useEffect(() => {
    setRoom(null); setPlayers([]); setRound(null); setReveal(null); setFetchError(null); advancedForRoundRef.current = null
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  useEffect(() => {
    if (!roomId) return
    const unsub = subscribeToRoom(roomId, refresh)

    // Defense-in-depth, mirroring the same fix already proven necessary for
    // the board-game (Ludo) lobby controller (see lobbyController.ts): even
    // with the realtime publication gap fixed (migration 20260718090000),
    // iOS/Safari PWAs can suspend a realtime socket across a background→
    // foreground cycle without ever firing a client-visible "closed" event,
    // silently leaving a screen frozen on stale data. A direct refetch on
    // foreground/online, plus a short-lived poll fallback while this hook is
    // mounted, makes room/player/round state self-heal regardless of
    // realtime socket health — cheap (three small selects) and bounded to
    // only while a match screen is actually open.
    const onForeground = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('online', onForeground)
    window.addEventListener('focus', onForeground)
    const pollId = window.setInterval(refresh, 4000)

    return () => {
      unsub()
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('online', onForeground)
      window.removeEventListener('focus', onForeground)
      window.clearInterval(pollId)
    }
  }, [roomId, refresh])

  // Local ticking clock — drives every timer bar / phase transition without polling the server.
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 100)
    return () => clearInterval(id)
  }, [])

  const phase: EnginePhase = (() => {
    if (!room) return 'lobby'
    if (room.status === 'completed' || room.status === 'abandoned') return 'results'
    if (room.status !== 'in_progress') return 'lobby'
    if (!round) return 'get_ready'
    const startsAt = new Date(round.starts_at).getTime()
    const endsAt = new Date(round.ends_at).getTime()
    if (nowMs < startsAt) return 'get_ready'
    if (nowMs < endsAt) return 'playing'
    return 'reveal'
  })()

  // Once a round's window has closed, advance the room (idempotent server-side)
  // and fetch the reveal exactly once per round id.
  useEffect(() => {
    if (phase !== 'reveal' || !round || !roomId) return
    if (advancedForRoundRef.current === round.id) return
    advancedForRoundRef.current = round.id
    setReveal(null)
    let cancelled = false
    ;(async () => {
      await advanceRoom(roomId)
      let rv = await getRoundReveal(round.id)
      if (!rv.length) {
        // small buffer against client/server clock skew, then one retry
        await new Promise((r) => setTimeout(r, 400))
        rv = await getRoundReveal(round.id)
      }
      if (!cancelled) setReveal(rv as unknown as RoundRevealRow[])
      setTimeout(() => { if (!cancelled) refresh() }, 1500)
    })()
    return () => { cancelled = true }
  }, [phase, round, roomId, refresh])

  const roundTimeLeftMs = round ? Math.max(0, new Date(round.ends_at).getTime() - nowMs) : 0
  const roundTimePct = round && round.duration_ms ? Math.min(1, Math.max(0, roundTimeLeftMs / round.duration_ms)) : 0
  const roundOpensInMs = round ? Math.max(0, new Date(round.starts_at).getTime() - nowMs) : 0

  return { room, players, round, reveal, phase, nowMs, roundTimeLeftMs, roundTimePct, roundOpensInMs, refresh, fetchError }
}
