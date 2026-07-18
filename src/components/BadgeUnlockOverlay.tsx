import { useEffect, useState } from 'react'

interface Props {
  name: string
  nameAr: string
  rarity: string
  color: string
  category: string
  onDismiss: () => void
  lang: 'en' | 'ar'
}

const COLORS = ['#ffd700', '#7c3aed', '#00d4ff', '#ff6b35', '#00e676', '#ff4785', '#c084fc']

const CATEGORY_LABEL: Record<string, { en: string; ar: string }> = {
  gameplay:    { en: 'Gameplay',    ar: 'اللعب' },
  progression: { en: 'Progression', ar: 'التقدم' },
  consistency: { en: 'Consistency', ar: 'المواظبة' },
  social:      { en: 'Social',      ar: 'اجتماعي' },
  general:     { en: 'Achievement', ar: 'إنجاز' },
}

export default function BadgeUnlockOverlay({ name, nameAr, rarity, color, category, onDismiss, lang }: Props) {
  const [show, setShow] = useState(false)
  const [confetti] = useState(() =>
    Array.from({ length: 26 }, (_, i) => ({
      id: i,
      x: 5 + (i / 26) * 90,
      c: COLORS[i % COLORS.length],
      delay: (i * 0.06).toFixed(2),
      dur: (1.3 + (i % 5) * 0.22).toFixed(2),
      drift: -36 + (i % 7) * 12,
      size: 4 + (i % 3) * 3,
      round: i % 3 === 0,
    }))
  )
  const isAr = lang === 'ar'
  const catLabel = CATEGORY_LABEL[category] ?? CATEGORY_LABEL.general

  useEffect(() => {
    const t = setTimeout(() => setShow(true), 50)
    return () => clearTimeout(t)
  }, [])

  return (
    <div
      onClick={onDismiss}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(3,3,15,0.88)', backdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        opacity: show ? 1 : 0, transition: 'opacity 0.3s ease',
      }}
    >
      <div className="confetti-wrap">
        {confetti.map((c) => (
          <div
            key={c.id}
            className="confetti-piece"
            style={{
              left: `${c.x}%`, width: c.size, height: c.size, background: c.c,
              borderRadius: c.round ? '50%' : '2px',
              '--dur': `${c.dur}s`, '--delay': `${c.delay}s`, '--drift': `${c.drift}px`,
            } as React.CSSProperties}
          />
        ))}
      </div>

      <div
        className="card animate-level-burst"
        style={{
          maxWidth: 340, width: '100%', padding: '40px 28px', textAlign: 'center',
          background: `linear-gradient(160deg, ${color}22 0%, rgba(0,212,255,0.08) 100%)`,
          border: `1px solid ${color}55`,
          boxShadow: `0 0 80px ${color}30, 0 0 160px ${color}10`,
          position: 'relative', overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ position: 'absolute', top: '28%', left: '50%', transform: 'translate(-50%,-50%)', width: 200, height: 200, borderRadius: '50%', background: `radial-gradient(circle, ${color}40 0%, transparent 70%)`, pointerEvents: 'none' }} />

        <div style={{ position: 'relative', width: 100, height: 100, margin: '0 auto 22px' }}>
          <div style={{ position: 'absolute', inset: -10, borderRadius: '50%', border: '2px solid transparent', borderTopColor: color, borderRightColor: '#00d4ff', animation: 'star-spin 3s linear infinite' }} />
          <div style={{ position: 'absolute', inset: -5, borderRadius: '50%', border: `1px solid ${color}30` }} />
          <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: `linear-gradient(135deg, ${color}, #7c3aed)`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 40px ${color}60` }}>
            <svg width="42" height="42" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="6" />
              <path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11" />
            </svg>
          </div>
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: `2px solid ${color}50`, animation: 'pulse-ring 1.8s ease-out infinite' }} />
        </div>

        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.3em', textTransform: 'uppercase', color, marginBottom: 8 }}>
          {isAr ? 'شارة جديدة!' : 'BADGE UNLOCKED!'}
        </div>

        <p className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 24, fontWeight: 900, color: 'var(--foreground)', margin: '0 0 6px' }}>
          {isAr ? nameAr : name}
        </p>

        <div style={{ display: 'flex', gap: 6, justifyContent: 'center', marginBottom: 22 }}>
          <span style={{ fontSize: 10, fontWeight: 700, color, background: `${color}18`, border: `1px solid ${color}35`, borderRadius: 99, padding: '3px 10px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            {rarity}
          </span>
          <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.55)', background: 'rgba(var(--fg-rgb),0.06)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 99, padding: '3px 10px' }}>
            {isAr ? catLabel.ar : catLabel.en}
          </span>
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%', fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit', gap: 10 }}
          onClick={onDismiss}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
          {isAr ? 'رائع!' : 'Awesome!'}
        </button>
      </div>
    </div>
  )
}
