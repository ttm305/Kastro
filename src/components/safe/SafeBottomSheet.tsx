import type { ReactNode, CSSProperties } from 'react'
import { safeLeft, safeRight } from '../../lib/safeArea'

interface Props {
  onClose: () => void
  children: ReactNode
  maxWidth?: number
  /** Content padding (all sides get this as a base; bottom/left/right are
   * additionally floored by the matching safe-area inset). Defaults match
   * the existing FriendProfileSheet/badge-detail-sheet panels. */
  padding?: string
  zIndex?: number
  style?: CSSProperties
}

/**
 * Standard bottom sheet: fixed full-viewport scrim, panel docked to the
 * bottom edge with rounded top corners, safe-area-aware bottom/left/right
 * padding so content and action buttons never land on the home indicator
 * or (in landscape) a side notch/rounded corner. Modeled on the two
 * instances of this pattern that already existed and already got it right
 * — FriendProfileSheet's panel and ProfileScreen's badge-detail sheet
 * (`max(Npx, calc(24px + env(safe-area-inset-bottom)))`) — pulled into one
 * place so every future bottom sheet (badge details, match-detail sheets,
 * confirmation sheets, etc.) inherits the same safe-area handling instead
 * of each screen re-deriving it (or, as with the pre-fix Profile top
 * controls, not deriving it at all).
 */
export default function SafeBottomSheet({ onClose, children, maxWidth = 480, padding = '24px 20px 40px', zIndex = 200, style }: Props) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(3,3,15,0.88)', zIndex, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%', maxWidth, background: 'var(--surface-2)', borderRadius: '24px 24px 0 0',
          border: '1px solid rgba(var(--fg-rgb),0.08)', maxHeight: '88dvh', overflowY: 'auto',
          padding,
          paddingBottom: `max(40px, calc(24px + env(safe-area-inset-bottom, 0px)))`,
          paddingLeft: safeLeft(20), paddingRight: safeRight(20),
          ...style,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
