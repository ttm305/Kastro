import { useState } from 'react'
import type { Lang } from '../../App'
import { startSoloPractice, createPrivateRoom, joinRoomByCode, joinMatchmaking } from '../../lib/api'
import { primeSound, sound } from '../../lib/sound'

interface Props {
  gameId: string
  nameEn: string
  nameAr: string
  accentColor: string
  lang: Lang
  onBack: () => void
  onRoomReady: (roomId: string) => void
}

type Busy = null | 'solo' | 'private' | 'join' | 'matchmaking'

export default function MatchModeSelect({ gameId, nameEn, nameAr, accentColor, lang, onBack, onRoomReady }: Props) {
  const isAr = lang === 'ar'
  const [busy, setBusy] = useState<Busy>(null)
  const [joinOpen, setJoinOpen] = useState(false)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = async (which: Busy, fn: () => Promise<string | null>) => {
    primeSound()
    setError(null)
    setBusy(which)
    try {
      const roomId = await fn()
      if (roomId) { sound.ready(); onRoomReady(roomId) }
      else setError(isAr ? 'تعذر بدء اللعبة. حاول مجدداً.' : "Couldn't start the game. Please try again.")
    } catch {
      setError(isAr ? 'حدث خطأ غير متوقع.' : 'Something went wrong.')
    } finally {
      setBusy(null)
    }
  }

  const handleJoin = async () => {
    if (code.trim().length < 4) return
    primeSound()
    setError(null)
    setBusy('join')
    const { error: err, roomId } = await joinRoomByCode(code.trim())
    setBusy(null)
    if (err || !roomId) {
      setError(isAr ? 'الرمز غير صحيح أو الغرفة ممتلئة.' : 'Invalid code, or that room is full/already started.')
      sound.wrong()
      return
    }
    sound.ready()
    onRoomReady(roomId)
  }

  const options = [
    {
      key: 'solo' as const,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
        </svg>
      ),
      title: isAr ? 'تدريب فردي' : 'Solo Practice',
      subtitle: isAr ? 'العب بمفردك، اكسب XP وعملات' : 'Play solo, earn XP & coins',
      onClick: () => run('solo', () => startSoloPractice(gameId)),
    },
    {
      key: 'private' as const,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      ),
      title: isAr ? 'إنشاء غرفة خاصة' : 'Create Private Room',
      subtitle: isAr ? 'احصل على رمز لدعوة الأصدقاء' : 'Get a code to invite friends',
      onClick: () => run('private', async () => {
        const r = await createPrivateRoom(gameId)
        return r?.room_id ?? null
      }),
    },
    {
      key: 'matchmaking' as const,
      icon: (
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z" />
        </svg>
      ),
      title: isAr ? 'مباراة سريعة' : 'Quick Match',
      subtitle: isAr ? 'ابحث عن لاعبين الآن' : 'Find opponents now',
      onClick: () => run('matchmaking', () => joinMatchmaking(gameId)),
    },
  ]

  return (
    <div className="screen bg-mesh" style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column' }}>
      <div className="glass" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
        <button onClick={onBack} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10, width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', color: 'var(--foreground)' }}>
          {isAr ? '→' : '←'}
        </button>
        <div>
          <div className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 17, fontWeight: 800, color: 'var(--foreground)' }}>{isAr ? nameAr : nameEn}</div>
          <div style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'اختر طريقة اللعب' : 'Choose how to play'}</div>
        </div>
      </div>

      <div style={{ flex: 1, padding: '20px 18px', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 480, margin: '0 auto', width: '100%' }}>
        {options.map((opt) => (
          <button
            key={opt.key}
            disabled={busy !== null}
            onClick={opt.onClick}
            className="card card-hover animate-slide-up"
            style={{
              display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', textAlign: isAr ? 'right' : 'left',
              border: `1px solid ${accentColor}30`, opacity: busy && busy !== opt.key ? 0.4 : 1, cursor: busy ? 'wait' : 'pointer',
            }}
          >
            <div style={{ width: 46, height: 46, borderRadius: 14, background: `${accentColor}18`, border: `1px solid ${accentColor}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              {busy === opt.key ? <div className="live-dot" style={{ background: accentColor }} /> : opt.icon}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--foreground)', fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif" }}>{opt.title}</div>
              <div style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.45)', marginTop: 2 }}>{opt.subtitle}</div>
            </div>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg-rgb),0.25)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isAr ? 'scaleX(-1)' : undefined }}>
              <polyline points="9,6 15,12 9,18" />
            </svg>
          </button>
        ))}

        {/* Join by code — expandable */}
        <div className="card animate-slide-up" style={{ padding: '16px 18px', border: `1px solid ${accentColor}30` }}>
          <button
            onClick={() => setJoinOpen((o) => !o)}
            disabled={busy !== null}
            style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 14, padding: 0, textAlign: isAr ? 'right' : 'left' }}
          >
            <div style={{ width: 46, height: 46, borderRadius: 14, background: `${accentColor}18`, border: `1px solid ${accentColor}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={accentColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3-3.5 3.5zm-.5-.5l1.5-1.5" />
              </svg>
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--foreground)', fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif" }}>{isAr ? 'الانضمام برمز' : 'Join with Code'}</div>
              <div style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.45)', marginTop: 2 }}>{isAr ? 'أدخل رمز غرفة صديقك' : "Enter a friend's room code"}</div>
            </div>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg-rgb),0.3)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ transform: joinOpen ? 'rotate(180deg)' : undefined, transition: 'transform 0.2s ease' }}>
              <polyline points="6,9 12,15 18,9" />
            </svg>
          </button>
          {joinOpen && (
            <div className="animate-slide-up" style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 8))}
                placeholder={isAr ? 'رمز الغرفة' : 'ROOM CODE'}
                style={{ flex: 1, textAlign: 'center', letterSpacing: '0.25em', fontWeight: 800, fontFamily: "'JetBrains Mono', monospace" }}
                maxLength={8}
              />
              <button className="btn-primary btn-sm" disabled={busy !== null || code.trim().length < 4} onClick={handleJoin} style={{ opacity: code.trim().length < 4 ? 0.5 : 1 }}>
                {isAr ? 'انضم' : 'Join'}
              </button>
            </div>
          )}
        </div>

        {error && (
          <div className="animate-shake" style={{ padding: '10px 14px', borderRadius: 12, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.3)', color: '#ff8080', fontSize: 12, textAlign: 'center' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
