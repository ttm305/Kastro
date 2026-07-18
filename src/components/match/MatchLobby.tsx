import { useState } from 'react'
import type { Lang } from '../../App'
import Avatar from '../Avatar'
import type { MatchRoom } from '../../lib/api'
import type { RoomPlayerWithProfile } from '../../lib/useMatchEngine'

interface Props {
  room: MatchRoom
  players: RoomPlayerWithProfile[]
  myUserId: string
  lang: Lang
  accentColor: string
  nameEn: string
  nameAr: string
  onReady: (ready: boolean) => void
  onLeave: () => void
}

export default function MatchLobby({ room, players, myUserId, lang, accentColor, nameEn, nameAr, onReady, onLeave }: Props) {
  const isAr = lang === 'ar'
  const [readying, setReadying] = useState(false)
  const me = players.find((p) => p.user_id === myUserId)
  const iAmReady = me?.is_ready ?? false
  const readyCount = players.filter((p) => p.is_ready).length
  const canStart = players.length >= room.min_players
  const [copied, setCopied] = useState(false)

  const handleReady = () => {
    setReadying(true)
    onReady(!iAmReady)
    setTimeout(() => setReadying(false), 400)
  }

  const copyCode = () => {
    if (!room.join_code) return
    navigator.clipboard?.writeText(room.join_code).catch(() => {})
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div className="glass" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 16, fontWeight: 800, color: 'var(--foreground)' }}>{isAr ? nameAr : nameEn}</div>
          <div style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)' }}>
            {room.mode === 'matchmaking' ? (isAr ? 'مباراة سريعة' : 'Quick Match') : isAr ? 'غرفة خاصة' : 'Private Room'}
          </div>
        </div>
        <button onClick={onLeave} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10, width: 34, height: 34, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--foreground)' }}>✕</button>
      </div>

      <div style={{ padding: '20px 18px', maxWidth: 480, margin: '0 auto', width: '100%', flex: 1 }}>
        {room.join_code && (
          <div className="card animate-scale-in" style={{ padding: '18px 20px', marginBottom: 16, textAlign: 'center', border: `1px solid ${accentColor}35`, background: `${accentColor}0c` }}>
            <div style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.5)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              {isAr ? 'شارك هذا الرمز مع أصدقائك' : 'Share this code with friends'}
            </div>
            <button
              onClick={copyCode}
              style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 10, padding: 0 }}
            >
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 32, fontWeight: 800, letterSpacing: '0.2em', color: accentColor }}>
                {room.join_code}
              </span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            </button>
            {copied && <div style={{ fontSize: 11, color: '#00e676', marginTop: 6 }}>{isAr ? 'تم النسخ!' : 'Copied!'}</div>}
          </div>
        )}

        {room.mode === 'matchmaking' && !canStart && (
          <div className="card" style={{ padding: '12px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${accentColor}25` }}>
            <div className="live-dot" style={{ background: accentColor }} />
            <span style={{ fontSize: 12.5, color: 'rgba(var(--fg-rgb),0.6)' }}>{isAr ? 'جارٍ البحث عن لاعبين…' : 'Finding opponents…'}</span>
          </div>
        )}

        <div className="card" style={{ padding: '14px 16px', marginBottom: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.5)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {isAr ? 'اللاعبون' : 'Players'}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: accentColor }}>{readyCount}/{players.length} {isAr ? 'جاهز' : 'ready'}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {players.map((p) => {
              const mine = p.user_id === myUserId
              const username = p.profile?.username ?? '…'
              return (
                <div key={p.id} className="animate-slide-up" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', background: 'rgba(var(--fg-rgb),0.03)', borderRadius: 12, border: `1px solid ${mine ? accentColor + '40' : 'rgba(var(--fg-rgb),0.06)'}` }}>
                  <Avatar url={p.profile?.avatar_url} size={36} style={{ border: `2px solid ${p.is_ready ? '#10b981' : 'rgba(var(--fg-rgb),0.15)'}` }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span className="truncate" style={{ fontSize: 13, fontWeight: mine ? 800 : 600, color: mine ? accentColor : 'var(--foreground)' }}>@{username}</span>
                      {p.is_host && <span title={isAr ? 'المضيف' : 'Host'}>👑</span>}
                    </div>
                    <span style={{ fontSize: 10.5, color: 'rgba(var(--fg-rgb),0.35)' }}>{isAr ? `مستوى ${p.profile?.level ?? 1}` : `Level ${p.profile?.level ?? 1}`}</span>
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: p.is_ready ? '#10b981' : 'rgba(var(--fg-rgb),0.3)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    {p.is_ready ? '✓' : '○'} {p.is_ready ? (isAr ? 'جاهز' : 'Ready') : (isAr ? 'انتظار' : 'Waiting')}
                  </div>
                </div>
              )
            })}
            {players.length < room.min_players && Array.from({ length: room.min_players - players.length }).map((_, i) => (
              <div key={`empty-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 10px', borderRadius: 12, border: '1px dashed rgba(var(--fg-rgb),0.1)' }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: 'rgba(var(--fg-rgb),0.04)' }} />
                <span style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.25)' }}>{isAr ? 'بانتظار لاعب…' : 'Waiting for player…'}</span>
              </div>
            ))}
          </div>
        </div>

        <button
          className="btn-primary"
          disabled={readying || !canStart}
          onClick={handleReady}
          style={{
            width: '100%', fontSize: 16, opacity: canStart ? 1 : 0.5,
            background: iAmReady ? 'linear-gradient(135deg, #10b981, #059669)' : undefined,
            fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit',
          }}
        >
          {!canStart
            ? (isAr ? 'بانتظار المزيد من اللاعبين…' : 'Waiting for more players…')
            : iAmReady
              ? (isAr ? '✓ أنت جاهز! اضغط للإلغاء' : "✓ You're ready! Tap to cancel")
              : (isAr ? 'أنا جاهز!' : "I'm Ready!")}
        </button>
      </div>
    </div>
  )
}
