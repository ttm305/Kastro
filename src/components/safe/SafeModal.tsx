import type { ReactNode } from 'react'
import { safeTop, safeBottom, safeLeft, safeRight } from '../../lib/safeArea'

interface Props {
  onClose: () => void
  children: ReactNode
  /** Max width of the centered card. Defaults to 420, matching the app's
   * existing centered dialogs (HeaderPickerModal, AvatarPickerModal, etc). */
  maxWidth?: number
  zIndex?: number
}

/**
 * Standard centered/full-screen-scrim modal: fixed full-viewport scrim,
 * centered content card, click-outside-to-close. Every one of this app's
 * `position: fixed, inset: 0` centered dialogs (HeaderPickerModal,
 * AvatarPickerModal, DailyRewardModal, LevelUpOverlay, BadgeUnlockOverlay,
 * confirmation dialogs, etc.) follows this same shape by hand today, each
 * with its own copy of the scrim/centering/click-outside logic and — before
 * this pass — none of them accounting for iOS safe-area insets on the
 * scrim's own padding. A centered card is lower-risk than an edge-anchored
 * header (it's rarely pinned directly under the notch or over the home
 * indicator), but on a short/landscape viewport or a very tall card it can
 * still butt up against the status bar, home indicator, or a device's
 * rounded corners — so the scrim's padding uses `max(base, env(...))` on
 * all four sides rather than a flat `16`.
 *
 * New full-screen dialogs should use this instead of hand-rolling the
 * fixed/inset:0/centering boilerplate again.
 */
export default function SafeModal({ onClose, children, maxWidth = 420, zIndex = 9000 }: Props) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex,
        background: 'rgba(3,3,15,0.9)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 16,
        paddingTop: safeTop(16), paddingBottom: safeBottom(16), paddingLeft: safeLeft(16), paddingRight: safeRight(16),
        overflowY: 'auto',
      }}
    >
      {/* Purely a sizing/stopPropagation box — no visual styling of its own,
          so it composes with any existing card className/background/border
          the caller already uses (they're not identical across modals). */}
      <div
        style={{ width: '100%', maxWidth, maxHeight: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
