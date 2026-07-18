import { useState, useEffect, useRef } from 'react'
import type { Screen, Lang } from '../App'
import TopBar from '../components/TopBar'
import Avatar from '../components/Avatar'
import { useAuth } from '../lib/auth'
import { getOrCreateLobby, getLobbyPlayers, setLobbyReady, leaveLobby, subscribeToLobby } from '../lib/api'

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  setLang: (l: Lang) => void
  gameId: string | null
}

type LobbyPlayer = Awaited<ReturnType<typeof getLobbyPlayers>>[number]

export default function GameLobbyScreen({ onNavigate, lang, setLang, gameId }: Props) {
  const { session } = useAuth()
  const [loading, setLoading] = useState(true)
  const [lobbyId, setLobbyId] = useState<string | null>(null)
  const [players, setPlayers] = useState<LobbyPlayer[]>([])
  const [ready, setReady] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const isAr = lang === 'ar'
  const navigatedRef = useRef(false)
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const isMe = (p: LobbyPlayer) => !!session && p.user_id === session.user.id

  // Join/create the real-time lobby row for this game on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const gid = gameId ?? 'wg2'
      const lid = await getOrCreateLobby(gid)
      if (cancelled) return
      setLobbyId(lid)
      if (lid) {
        const ps = await getLobbyPlayers(lid)
        if (!cancelled) setPlayers(ps)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  // Live subscription: refresh the roster whenever any player's ready state changes.
  useEffect(() => {
    if (!lobbyId) return
    const unsubscribe = subscribeToLobby(lobbyId, () => {
      getLobbyPlayers(lobbyId).then(setPlayers)
    })
    return () => { unsubscribe() }
  }, [lobbyId])

  // Leave the lobby if we navigate away before the match actually starts.
  useEffect(() => {
    return () => {
      if (lobbyId && !navigatedRef.current) {
        leaveLobby(lobbyId)
      }
      if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
    }
  }, [lobbyId])

  const startCountdown = () => {
    if (navigatedRef.current || countdown !== null) return
    navigatedRef.current = true
    let c = 3
    setCountdown(c)
    countdownIntervalRef.current = setInterval(() => {
      c--
      if (c <= 0) {
        if (countdownIntervalRef.current) clearInterval(countdownIntervalRef.current)
        setCountdown(null)
        onNavigate('workgame')
      } else {
        setCountdown(c)
      }
    }, 1000)
  }

  // Once we're ready, watch the roster: if everyone (2+ players) is ready, launch the countdown.
  useEffect(() => {
    if (!ready || navigatedRef.current) return
    const allReady = players.length >= 2 && players.every((p) => isMe(p) || p.is_ready)
    if (allReady) startCountdown()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, ready])

  const handleReady = async () => {
    if (!lobbyId || ready) return
    setReady(true)
    const result = await setLobbyReady(lobbyId, true)
    const fresh = await getLobbyPlayers(lobbyId)
    setPlayers(fresh)
    if (result?.all_ready) startCountdown()
  }

  if (loading) {
    return (
      <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="live-dot" />
      </div>
    )
  }

  return (
    <div className="screen bg-mesh">
      <TopBar title="Game Lobby" titleAr="غرفة الانتظار" lang={lang} setLang={setLang} onBack={() => onNavigate('games')} />

      <div style={{ padding: '16px 16px', maxWidth: 480, margin: '0 auto' }}>
        {/* Game info */}
        <div
          className="glass-card"
          style={{
            padding: '24px 20px',
            marginBottom: 16,
            background: 'linear-gradient(135deg, rgba(124,58,237,0.25) 0%, rgba(6,182,212,0.1) 100%)',
            border: '1px solid rgba(124,58,237,0.3)',
            textAlign: 'center',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {countdown !== null && (
            <div style={{
              position: 'absolute', inset: 0, background: 'rgba(7,7,26,0.8)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              zIndex: 10, backdropFilter: 'blur(8px)',
            }}>
              <div style={{
                fontFamily: "'Rajdhani', sans-serif", fontSize: 80, fontWeight: 800,
                color: '#a78bfa', lineHeight: 1,
                textShadow: '0 0 40px rgba(124,58,237,0.6)',
              }}>
                {countdown}
              </div>
            </div>
          )}

          <div style={{ width: 80, height: 80, borderRadius: 24, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 16px', boxShadow: '0 0 30px rgba(124,58,237,0.4)' }}>
            🛡️
          </div>

          <h2 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 800, color: 'var(--foreground)' }}>
            {isAr ? 'بروتوكول السلامة' : 'Safety Protocol'}
          </h2>
          <p style={{ margin: '0 0 16px', fontSize: 13, color: 'rgba(var(--fg-rgb),0.5)' }}>
            {isAr ? 'منافسة متعددة اللاعبين · ٢٠ سؤالاً · ٤ لاعبين' : 'Multiplayer · 20 Questions · 4 Players'}
          </p>

          {/* Game rules pills */}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
            {[
              { icon: '⏱️', label: isAr ? '٣٠ ثانية/سؤال' : '30s per question' },
              { icon: '💎', label: isAr ? '+٢٠٠ XP' : '+200 XP' },
              { icon: '🏆', label: isAr ? 'جائزة الأسبوع' : 'Weekly Prize' },
            ].map((r) => (
              <div key={r.label} style={{ background: 'rgba(var(--fg-rgb),0.08)', borderRadius: 99, padding: '6px 14px', fontSize: 12, color: 'rgba(var(--fg-rgb),0.7)', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>{r.icon}</span>
                <span>{r.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Players in lobby */}
        <div className="glass-card" style={{ padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>
              {isAr ? '👥 اللاعبون في الغرفة' : '👥 Players in Lobby'}
            </h3>
            <span style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)' }}>
              {players.filter((p) => p.is_ready || (isMe(p) && ready)).length}/4 {isAr ? 'جاهز' : 'ready'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {players.map((p) => {
              const mine = isMe(p)
              const isReady = p.is_ready || (mine && ready)
              const username = p.profile?.username ?? (isAr ? 'لاعب' : 'Player')
              const displayName = p.profile?.username ? `@${username}` : username
              const level = p.profile?.level ?? 1
              return (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 12px', background: 'rgba(var(--fg-rgb),0.04)', borderRadius: 14, border: `1px solid ${mine ? 'rgba(124,58,237,0.3)' : 'rgba(var(--fg-rgb),0.06)'}` }}>
                  <Avatar
                    url={p.profile?.avatar_url}
                    size={44}
                    style={{ border: `2px solid ${isReady ? '#10b981' : 'rgba(var(--fg-rgb),0.15)'}`, transition: 'border-color 0.3s ease' }}
                  />
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: mine ? 700 : 600, color: mine ? '#a78bfa' : 'var(--foreground)' }}>
                      {mine ? (isAr ? `${displayName} (أنت)` : `${displayName} (You)`) : displayName}
                    </p>
                    <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg-rgb),0.35)' }}>{isAr ? `المستوى ${level}` : `Level ${level}`}</p>
                  </div>
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    fontSize: 12, fontWeight: 600,
                    color: isReady ? '#10b981' : 'rgba(var(--fg-rgb),0.3)',
                  }}>
                    <span>{isReady ? '✓' : '○'}</span>
                    <span>{isReady ? (isAr ? 'جاهز' : 'Ready') : (isAr ? 'انتظار' : 'Waiting')}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Ready button */}
        {!ready ? (
          <button
            className="btn-primary"
            style={{ width: '100%', fontSize: 16, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit' }}
            onClick={handleReady}
          >
            {isAr ? '✓ أنا جاهز!' : '✓ I\'m Ready!'}
          </button>
        ) : (
          <div
            style={{
              width: '100%', padding: '16px', borderRadius: 14,
              background: 'rgba(16,185,129,0.15)',
              border: '1px solid rgba(16,185,129,0.3)',
              textAlign: 'center', fontSize: 15, fontWeight: 700, color: '#10b981',
              fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit',
            }}
          >
            ✓ {isAr ? 'أنت جاهز! في انتظار اللاعبين الآخرين…' : "You're ready! Waiting for others…"}
          </div>
        )}
      </div>
    </div>
  )
}
