import type { ReactNode, CSSProperties } from 'react'
import { safeLeft, safeRight } from '../../lib/safeArea'

interface Props {
  children: ReactNode
  className?: string
  style?: CSSProperties
}

/**
 * Root wrapper for a full screen's outer `<div>`. Applies left/right iOS
 * safe-area insets (relevant in landscape on a notched/Dynamic-Island
 * phone, where the notch/rounded corner sits to one physical side of the
 * screen) and `min-height: 100dvh`. Deliberately does NOT apply top/bottom
 * padding — that's AppHeader/GameHeader's job at the top and .pb-nav /
 * SafeBottomSheet/SafeModal's job at the bottom, so a screen using both
 * never double-pads. On a non-notched device, older iPhone, Android, or
 * desktop this is a no-op (0px insets) — no extra empty space anywhere.
 *
 * Usage: wrap a screen's outermost element, e.g.
 *   <SafeAreaScreen className="screen bg-mesh"><AppHeader .../>...</SafeAreaScreen>
 */
export default function SafeAreaScreen({ children, className, style }: Props) {
  return (
    <div
      className={className}
      style={{
        minHeight: '100dvh',
        paddingLeft: safeLeft(0),
        paddingRight: safeRight(0),
        ...style,
      }}
    >
      {children}
    </div>
  )
}
