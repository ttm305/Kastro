import type { CSSProperties } from 'react'

/**
 * Single source of truth for iOS safe-area math across the whole app.
 * Every fixed/sticky header, bottom bar, modal, and bottom sheet should pull
 * its inset padding from here instead of hand-rolling `env(...)` strings —
 * that's what let the Profile "Customize" button (and, on inspection, the
 * same absolute-positioned-controls pattern elsewhere) ship with zero
 * safe-area handling: every screen was free to reinvent it, and one didn't.
 *
 * Never hardcode a spacing value for one iPhone model. `env(safe-area-inset-*)`
 * already resolves to 0px on devices without a notch/Dynamic Island/home
 * indicator (older iPhones, Android, desktop), so `max(base, env(...))`
 * degrades to plain `base` there with no extra empty space — the base value
 * is the padding designers actually want when there's no notch to clear.
 */

export const TAP_MIN = 44

/** CSS env() expressions, exported individually for cases that need to
 * compose them into a larger calc() (e.g. GameHeader's timer chip). */
export const ENV_TOP = 'env(safe-area-inset-top, 0px)'
export const ENV_BOTTOM = 'env(safe-area-inset-bottom, 0px)'
export const ENV_LEFT = 'env(safe-area-inset-left, 0px)'
export const ENV_RIGHT = 'env(safe-area-inset-right, 0px)'

export const safeTop = (base = 0) => `max(${base}px, ${ENV_TOP})`
export const safeBottom = (base = 0) => `max(${base}px, ${ENV_BOTTOM})`
export const safeLeft = (base = 0) => `max(${base}px, ${ENV_LEFT})`
export const safeRight = (base = 0) => `max(${base}px, ${ENV_RIGHT})`

/**
 * Expands a visually-small control to a >=44x44 hit area WITHOUT growing its
 * on-screen footprint or shifting surrounding layout — same trick already
 * used for the Ludo back button: pad the box out to the minimum, then pull
 * it back in with an equal negative margin. Spread this onto a <button>/
 * clickable <div>'s style alongside `display: 'inline-flex', alignItems:
 * 'center', justifyContent: 'center'`.
 */
export function tapTarget(visibleW: number, visibleH: number = visibleW): CSSProperties {
  const padX = Math.max(0, (TAP_MIN - visibleW) / 2)
  const padY = Math.max(0, (TAP_MIN - visibleH) / 2)
  if (padX === 0 && padY === 0) return {}
  return { padding: `${padY}px ${padX}px`, margin: `${-padY}px ${-padX}px` }
}

/** Same idea as `tapTarget`, but for text/pill buttons whose width already
 * comfortably clears 44px (it grows with the label) and only the height is
 * short — pads/negative-margins vertically only, leaving horizontal spacing
 * (and therefore the button's visual width) completely untouched. */
export function tapTargetMinHeight(visibleH: number): CSSProperties {
  const pad = Math.max(0, (TAP_MIN - visibleH) / 2)
  if (pad === 0) return {}
  return { paddingTop: pad, paddingBottom: pad, marginTop: -pad, marginBottom: -pad }
}

/** Standard header horizontal padding: a base gutter plus whatever the
 * device's left/right notch/rounded-corner insets add (relevant mostly in
 * landscape on notched phones — the notch sits on one side). RTL-safe
 * because `paddingLeft`/`paddingRight` are physical, and the visual notch
 * side doesn't flip with document direction. */
export function safeHeaderPaddingX(base = 20): CSSProperties {
  return { paddingLeft: safeLeft(base), paddingRight: safeRight(base) }
}
