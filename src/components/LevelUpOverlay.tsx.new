import { useEffect, useState } from 'react'

interface Props {
  level: number
  onDismiss: () => void
  lang: 'en' | 'ar'
}

const COLORS = ['#ffd700', '#7c3aed', '#00d4ff', '#ff6b35', '#00e676', '#ff4785', '#c084fc']

export default function LevelUpOverlay({ level, onDismiss, lang }: Props) {
  const [show, setShow] = useState(false)
  const [confetti] = useState(() =>
    Array.from({ length: 32 }, (_, i) => ({
      id: i,
      x: 5 + (i / 32) * 90,
      color: COLORS[i % COLORS.length],
      delay: (i * 0.055).toFixed(2),
      dur: (1.4 + (i % 5) * 0.25).toFixed(2),
      drift: -40 + (i % 7) * 14,
      size: 5 + (i % 3) * 3,
      round: i % 4 === 0,
    }))
  )
  const isAr = lang === 'ar'

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(3,3,15,0.88)',
        backdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 24,
        opacity: show ? 1 : 0,
        transition: 'opacity 0.3s ease',
      }}
    >
      {/* Confetti */}
      <div className="confetti-wrap">
        {confetti.map((c) => (
          <div
            key={c.id}
            className="confetti-piece"
            style={{
              left: `${c.x}%`,
              width: c.size,
              height: c.size,
              background: c.color,
              borderRadius: c.round ? '50%' : '2px',
              '--dur': `${c.dur}s`,
              '--delay': `${c.delay}s`,
              '--drift': `${c.drift}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      <div
        className="card animate-level-burst"
        style={{
          maxWidth: 340, width: '100%', padding: '40px 28px', textAlign: 'center',
          background: 'linear-gradient(160deg, rgba(124,58,237,0.22) 0%, rgba(0,212,255,0.1) 100%)',
          border: '1px solid rgba(124,58,237,0.4)',
          boxShadow: '0 0 80px rgba(124,58,237,0.3), 0 0 160px rgba(124,58,237,0.08)',
          position: 'relative', overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Background glow */}
        <div style={{ position: 'absolute', top: '30%', left: '50%', transform: 'translate(-50%,-50%)', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle, rgba(124,58,237,0.3) 0%, transparent 70%)', pointerEvents: 'none' }} />

        {/* Level badge */}
        <div style={{ position: 'relative', width: 100, height: 100, margin: '0 auto 24px' }}>
          {/* Spinning outer ring */}
          <div style={{ position: 'absolute', inset: -10, borderRadius: '50%', border: '2px solid transparent', borderTopColor: '#7c3aed', borderRightColor: '#00d4ff', animation: 'star-spin 3s linear infinite' }} />
          {/* Static ring */}
          <div style={{ position: 'absolute', inset: -5, borderRadius: '50%', border: '1px solid rgba(157,111,255,0.2)' }} />

          <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'linear-gradient(135deg, #7c3aed, #00d4ff)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 40px rgba(124,58,237,0.5)' }}>
            <svg width="40" height="40" viewBox="0 0 24 24" fill="#ffd700">
              <polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>
            </svg>
          </div>

          {/* Pulse ring */}
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(157,111,255,0.4)', animation: 'pulse-ring 1.8s ease-out infinite' }} />
        </div>

        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'rgba(157,111,255,0.9)', marginBottom: 8 }}>
          {isAr ? 'ترقية المستوى!' : 'LEVEL UP!'}
        </div>

        <div
          className="font-display"
          style={{
            fontSize: 72, fontWeight: 900, lineHeight: 1,
            background: 'linear-gradient(135deg, #ffd700, #ff6b35)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            marginBottom: 8,
            animation: 'badge-live-pulse 2s ease-in-out infinite',
          }}
        >
          {level}
        </div>

        <p className={isAr ? 'font-cairo' : ''} style={{ fontSize: 18, fontWeight: 700, color: 'var(--foreground)', marginBottom: 4 }}>
          {isAr ? `وصلت إلى المستوى ${level}` : `You reached Level ${level}`}
        </p>
        <p style={{ fontSize: 13, color: 'rgba(var(--fg2-rgb),0.6)', marginBottom: 24, lineHeight: 1.5 }}>
          {isAr ? 'مهارات جديدة فُتحت! واصل التقدم.' : 'New skills unlocked! Keep pushing.'}
        </p>

        {/* Unlocks */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 24 }}>
          {[
            { color: '#ffd700', label: isAr ? 'تحديات جديدة' : 'New Challenges', icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ffd700" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 21h8m-4-4v4M5 3h14v8a7 7 0 0 1-14 0V3z"/><path d="M5 7H2a2 2 0 0 0 0 4h3M19 7h3a2 2 0 0 1 0 4h-3"/>
              </svg>
            )},
            { color: '#9d6fff', label: isAr ? 'مكافأة XP' : 'XP Bonus', icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="#9d6fff">
                <polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/>
              </svg>
            )},
            { color: '#00d4ff', label: isAr ? 'إطار جديد' : 'New Frame', icon: (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 21V9"/>
              </svg>
            )},
          ].map((u) => (
            <div key={u.label} style={{ flex: 1, background: `${u.color}10`, border: `1px solid ${u.color}25`, borderRadius: 14, padding: '12px 6px', textAlign: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 6 }}>{u.icon}</div>
              <div style={{ fontSize: 10, color: u.color, fontWeight: 600, lineHeight: 1.3 }}>{u.label}</div>
            </div>
          ))}
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%', fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit', gap: 10 }}
          onClick={onDismiss}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          {isAr ? 'استمر في رحلتك' : 'Continue Your Journey'}
        </button>
      </div>
    </div>
  )
}
