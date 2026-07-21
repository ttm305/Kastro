import { safeTop, safeLeft, safeRight, tapTarget } from '../lib/safeArea'

interface Props {
  accent: string
  isAr: boolean
  nameEn: string
  nameAr: string
  round: number
  totalRounds: number
  score: number
  onExit: () => void
}

/**
 * Shared in-round header for the round-based mini-games (Emoji Decode,
 * Color Blitz, and any future one built the same way): exit/close button,
 * centered title + round counter, live score. Extracted from what used to
 * be two byte-for-byte-identical local `GameHeader` functions (one in
 * EmojiDecodeScreen.tsx, one in ColorBlitzScreen.tsx) — neither had any
 * safe-area handling, so on a notched/Dynamic-Island phone the exit button
 * and title (this is the FIRST element of the screen — no TopBar, nothing
 * above it) could render under the status bar, and the 32x32 exit button
 * was below the 44x44 minimum tap target. Fixed once here instead of twice
 * (and now automatically covers any future game built on this pattern).
 *
 * Not the same component as Ludo's own header (LudoScreen.tsx renders its
 * own, richer header with a resume-match banner etc.) — this one is
 * intentionally the plain, compact variant for the quick round-based games.
 */
export default function GameHeader({ accent, isAr, nameEn, nameAr, round, totalRounds, score, onExit }: Props) {
  return (
    <div
      className="glass"
      style={{
        padding: '12px 16px', paddingTop: safeTop(12), paddingLeft: safeLeft(16), paddingRight: safeRight(16),
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}
    >
      <button
        onClick={onExit}
        aria-label={isAr ? 'خروج' : 'Exit'}
        style={{
          background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10,
          width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center',
          cursor: 'pointer', fontSize: 13, color: 'var(--foreground)',
          // Visible box stays 32x32; clickable box padded to 44x44 minimum.
          ...tapTarget(32, 32),
        }}
      >
        ✕
      </button>
      <div style={{ textAlign: 'center' }}>
        <div className={isAr ? 'font-cairo' : 'font-display'} style={{ fontSize: 13.5, fontWeight: 800, color: 'var(--foreground)' }}>{isAr ? nameAr : nameEn}</div>
        <div style={{ fontSize: 10.5, color: accent }}>{isAr ? `جولة ${round}/${totalRounds}` : `Round ${round}/${totalRounds}`}</div>
      </div>
      <div style={{ textAlign: 'center', minWidth: 46 }}>
        <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 16, fontWeight: 800, color: accent }}>{score}</div>
        <div style={{ fontSize: 9, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'النقاط' : 'Score'}</div>
      </div>
    </div>
  )
}
