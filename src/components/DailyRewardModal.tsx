import { useState } from 'react'
import { safeBottom, safeLeft, safeRight, safeTop } from '../lib/safeArea'

interface Props {
  onClaim: (xp: number) => void
  onClose: () => void
  lang: 'en' | 'ar'
  streak: number
}

// SVG reward icons
const RewardIcon = ({ day, size = 28 }: { day: number; size?: number }) => {
  const color = day === 7 ? '#ffd700' : day >= 5 ? '#ff6b35' : day >= 3 ? '#9d6fff' : '#00d4ff'
  const paths: Record<number, React.ReactNode> = {
    1: <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/></svg>,
    2: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/><polygon points="12,5 14.09,9.76 19,10.27 15.5,13.64 16.18,18.52 12,16.27 7.82,18.52 8.5,13.64 5,10.27 9.91,9.76" fill={color}/></svg>,
    3: <svg width={size} height={size} viewBox="0 0 24 24" fill={color}><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>,
    4: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M8 21h8m-4-4v4M5 3h14v8a7 7 0 0 1-14 0V3z"/><path d="M5 7H2a2 2 0 0 0 0 4h3M19 7h3a2 2 0 0 1 0 4h-3"/></svg>,
    5: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="6"/><path d="M15.477 12.89L17 22l-5-3-5 3 1.523-9.11"/></svg>,
    6: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,12 20,22 4,22 4,12"/><rect x="2" y="7" width="20" height="5" rx="1"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z"/></svg>,
    7: <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/><circle cx="12" cy="12" r="3" fill={color} stroke="none"/></svg>,
  }
  return <>{paths[day] || paths[1]}</>
}

const FireSVG = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
    <path d="M12 2C12 2 8 6 8 10C8 12.2 9.8 14 12 14C14.2 14 16 12.2 16 10C16 8 14 5 14 5C14 5 15 8 13 9C13 9 14 6 12 2Z" fill="#ff6b35"/>
    <path d="M12 8C12 8 10 10 10 12.5C10 13.3 10.5 14 12 14C13.5 14 14 13.3 14 12.5C14 10 12 8 12 8Z" fill="#ffd700" opacity="0.8"/>
  </svg>
)

const REWARDS = [
  { day: 1, xp: 50,  label: '50 XP',            labelAr: '٥٠ XP' },
  { day: 2, xp: 100, label: '100 XP',            labelAr: '١٠٠ XP' },
  { day: 3, xp: 150, label: '150 XP',            labelAr: '١٥٠ XP' },
  { day: 4, xp: 200, label: '200 XP',            labelAr: '٢٠٠ XP' },
  { day: 5, xp: 300, label: '300 XP',            labelAr: '٣٠٠ XP' },
  { day: 6, xp: 400, label: '400 XP',            labelAr: '٤٠٠ XP' },
  { day: 7, xp: 700, label: '700 XP + Badge',    labelAr: '٧٠٠ XP + شارة', special: true },
]

export default function DailyRewardModal({ onClaim, onClose, lang, streak }: Props) {
  const [claimed, setClaimed] = useState(false)
  const [exploding, setExploding] = useState(false)
  const isAr = lang === 'ar'
  const today = Math.min(streak, 7)
  const todayReward = REWARDS[today - 1] || REWARDS[0]

  const handleClaim = () => {
    setExploding(true)
    setTimeout(() => { setClaimed(true); onClaim(todayReward.xp) }, 600)
    setTimeout(onClose, 2400)
  }

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(3,3,15,0.9)',
        backdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        // Bottom-docked (flex-end), so the panel — and the "Claim" button
        // inside it — sits close to the real screen edge. Was a flat
        // '0 16px 32px' with no safe-area awareness; the 32px alone doesn't
        // clear the home indicator on a notched iPhone.
        padding: '0 16px 32px',
        paddingTop: safeTop(0), paddingBottom: safeBottom(32), paddingLeft: safeLeft(16), paddingRight: safeRight(16),
      }}
    >
      <div
        className="card animate-slide-up"
        style={{
          width: '100%', maxWidth: 420, padding: '26px 22px',
          background: 'linear-gradient(160deg, rgba(255,215,0,0.09) 0%, rgba(124,58,237,0.07) 100%)',
          border: '1px solid rgba(255,215,0,0.18)',
          boxShadow: '0 -20px 80px rgba(255,215,0,0.06)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 22 }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, background: 'rgba(255,107,53,0.12)', border: '1px solid rgba(255,107,53,0.22)', borderRadius: 99, padding: '5px 14px', marginBottom: 12 }}>
            <FireSVG />
            <span style={{ fontSize: 13, fontWeight: 700, color: '#ff6b35', fontFamily: "'Exo 2', sans-serif" }}>
              {isAr ? `${streak} أيام متتالية` : `${streak}-Day Streak`}
            </span>
          </div>
          <h2 className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 21, fontWeight: 800, color: 'var(--foreground)', margin: '0 0 4px' }}>
            {isAr ? 'مكافأة تسجيل الدخول' : 'Daily Login Reward'}
          </h2>
          <p style={{ fontSize: 12, color: 'rgba(var(--fg2-rgb),0.55)', margin: 0 }}>
            {isAr ? 'عد كل يوم لمكافآت أكبر' : 'Return every day for bigger rewards'}
          </p>
        </div>

        {/* 7-day strip */}
        <div style={{ display: 'flex', gap: 5, marginBottom: 22 }}>
          {REWARDS.map((r) => {
            const isClaimed = r.day < today
            const isToday = r.day === today
            const isLocked = r.day > today
            return (
              <div
                key={r.day}
                style={{
                  flex: 1, textAlign: 'center', padding: '8px 3px',
                  borderRadius: 12,
                  background: isClaimed ? 'rgba(124,58,237,0.15)' : isToday ? 'linear-gradient(135deg, rgba(255,215,0,0.18), rgba(255,107,53,0.09))' : 'rgba(var(--fg-rgb),0.04)',
                  border: `1px solid ${isClaimed ? 'rgba(124,58,237,0.28)' : isToday ? 'rgba(255,215,0,0.38)' : 'rgba(var(--fg-rgb),0.07)'}`,
                  boxShadow: isToday ? '0 0 14px rgba(255,215,0,0.18)' : 'none',
                  opacity: isLocked ? 0.4 : 1,
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 3, ...(isToday && exploding ? { animation: 'level-burst 0.6s ease' } : {}) }}>
                  {isClaimed
                    ? <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9d6fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
                    : <RewardIcon day={r.day} size={isToday ? 20 : 16} />
                  }
                </div>
                <div style={{ fontSize: 8, fontWeight: 700, color: isClaimed ? '#9d6fff' : isToday ? '#ffd700' : 'rgba(var(--fg-rgb),0.3)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  {isAr ? r.day : r.day}
                </div>
              </div>
            )
          })}
        </div>

        {/* Today's reward */}
        <div style={{ textAlign: 'center', marginBottom: 20, padding: '18px 16px', background: 'rgba(255,215,0,0.06)', borderRadius: 18, border: '1px solid rgba(255,215,0,0.13)' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10, ...(exploding ? { animation: 'level-burst 0.6s ease' } : {}) }}>
            <RewardIcon day={today} size={48} />
          </div>
          <div className="font-display" style={{ fontSize: 26, fontWeight: 900, background: 'linear-gradient(135deg, #ffd700, #ff6b35)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', marginBottom: 4 }}>
            {isAr ? todayReward.labelAr : todayReward.label}
          </div>
          {todayReward.special && (
            <span className="badge badge-boost">{isAr ? 'مكافأة خاصة!' : 'SPECIAL BONUS!'}</span>
          )}
        </div>

        {!claimed ? (
          <button
            className="btn btn-gold"
            style={{ width: '100%', fontSize: 15, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit', gap: 10 }}
            onClick={handleClaim}
          >
            {exploding ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#03030f" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
                {isAr ? 'تم الاستلام!' : 'Claimed!'}
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#03030f" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20,12 20,22 4,22 4,12"/><rect x="2" y="7" width="20" height="5" rx="1"/><line x1="12" y1="22" x2="12" y2="7"/>
                </svg>
                {isAr ? `احصل على ${todayReward.labelAr}` : `Claim ${todayReward.label}`}
              </>
            )}
          </button>
        ) : (
          <div style={{ textAlign: 'center', padding: '14px', fontSize: 15, fontWeight: 700, color: '#00e676', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00e676" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20,6 9,17 4,12"/></svg>
            {isAr ? 'تم! عد غداً للمزيد' : 'Done! Come back tomorrow'}
          </div>
        )}

      </div>
    </div>
  )
}
