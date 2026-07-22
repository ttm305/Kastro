import { useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react'
import { lockBodyScroll, unlockBodyScroll } from '../lib/scrollLock'

interface Props {
  /** Whether the panel should be in its fully-open (on-screen) position. */
  open: boolean
  isRTL: boolean
  onRequestClose: () => void
  children: ReactNode
}

// Apple's own push/pop transition curve — the exact ease that makes iOS
// navigation (and Plato's profile transition, which is built on the same
// idiom) feel the way it does. Used for both the panel slide and the scrim
// fade so they read as one coordinated motion instead of two separate
// animations.
const CURVE = 'cubic-bezier(0.32, 0.72, 0, 1)'
const DURATION = '0.38s'

/**
 * Hosts <ProfileScreen> as a persistent, lazily-mounted slide-over layer on
 * top of Home. "Persistent" is the key property: once mounted (first open),
 * it is never unmounted again — closing only animates it off-screen via
 * `transform`, so a) Home underneath never loses its own mount/scroll state
 * (this component doesn't touch Home at all, it just draws on top of it),
 * and b) reopening Profile is instant with zero refetch, matching the "no
 * duplicate rendering / no unnecessary remount / preserve state" requirement.
 *
 * Two independently-animated layers, matching real iOS/Plato-style sheets:
 *  - a full-screen scrim that fades in/out under the panel (dims Home)
 *  - the panel itself, which slides via `translate3d` (GPU-accelerated,
 *    hardware-composited — never animates layout-affecting properties)
 *
 * Gesture support: dragging horizontally anywhere on the open panel tracks
 * the finger 1:1 (transitions disabled mid-drag for zero lag); releasing
 * past ~35% of the panel's width completes the close, otherwise it snaps
 * back open — the same "interactive pop" feel as a native push navigation.
 * A drag that turns out to be more vertical than horizontal is treated as
 * the user scrolling Profile's own content and is released immediately, so
 * normal scrolling inside Profile is never hijacked.
 */
export default function ProfileOverlayHost({ open, isRTL, onRequestClose, children }: Props) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [dragPx, setDragPx] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const draggingRef = useRef(false)
  const startXRef = useRef(0)
  const startYRef = useRef(0)
  const widthRef = useRef(typeof window !== 'undefined' ? window.innerWidth : 400)

  // Structural fix (not a visual tweak): while Profile is the foreground
  // page, Home's own document/body must be fully taken out of the
  // scrollable/touchable flow — see src/lib/scrollLock.ts for why a plain
  // `overflow: hidden` on body is not sufficient on iOS Safari/WKWebView.
  // This is what makes Home "frozen" (no scroll, no rubber-band, no
  // touch-chaining) and, on close, land back at the exact scroll offset it
  // was left at.
  useEffect(() => {
    if (!open) return
    lockBodyScroll()
    return () => unlockBodyScroll()
  }, [open])

  // LTR: panel lives off-screen to the right when closed, drags rightward to close.
  // RTL: panel lives off-screen to the left when closed, drags leftward to close.
  const closedPct = isRTL ? -100 : 100

  function onTouchStart(e: TouchEvent) {
    if (!open) return
    const t = e.touches[0]
    startXRef.current = t.clientX
    startYRef.current = t.clientY
    widthRef.current = panelRef.current?.offsetWidth || window.innerWidth
    draggingRef.current = true
  }

  function onTouchMove(e: TouchEvent) {
    if (!draggingRef.current) return
    const t = e.touches[0]
    const dx = t.clientX - startXRef.current
    const dy = t.clientY - startYRef.current
    if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
      // Vertical intent (scrolling Profile's own content) — release the
      // gesture entirely rather than fighting the page's own scroll.
      draggingRef.current = false
      setIsDragging(false)
      setDragPx(0)
      return
    }
    if (Math.abs(dx) > 4) setIsDragging(true)
    // Only allow dragging toward "closed" — can't drag past fully-open.
    const closingDx = isRTL ? Math.min(0, dx) : Math.max(0, dx)
    setDragPx(closingDx)
  }

  function onTouchEnd() {
    if (!draggingRef.current) return
    draggingRef.current = false
    setIsDragging(false)
    const width = widthRef.current || 1
    const progress = Math.abs(dragPx) / width
    setDragPx(0)
    if (progress > 0.35) onRequestClose()
  }

  const dragProgress = isDragging ? Math.min(1, Math.abs(dragPx) / (widthRef.current || 1)) : 0
  const translatePct = open ? dragProgress * closedPct : closedPct
  const scrimOpacity = open ? 0.42 * (1 - dragProgress) : 0
  const liveTransition = isDragging ? 'none' : `transform ${DURATION} ${CURVE}`
  const scrimTransition = isDragging ? 'none' : `opacity ${DURATION} ${CURVE}`

  return (
    <>
      <div
        aria-hidden="true"
        onClick={open ? onRequestClose : undefined}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 499,
          background: '#000',
          opacity: scrimOpacity,
          pointerEvents: open ? 'auto' : 'none',
          transition: scrimTransition,
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 500,
          transform: `translate3d(${translatePct}%, 0, 0)`,
          willChange: 'transform',
          transition: liveTransition,
          pointerEvents: open ? 'auto' : 'none',
          background: 'var(--background)',
          boxShadow: open ? (isRTL ? '8px 0 40px rgba(0,0,0,0.35)' : '-8px 0 40px rgba(0,0,0,0.35)') : 'none',
          // The panel itself is ProfileScreen's ONLY scroll container — this
          // is the other half of the structural fix. ProfileScreen's content
          // (built like every other screen in this app: normal document flow,
          // no scroll wrapper of its own) now scrolls inside this fixed,
          // full-viewport box instead of relying on the document, so vertical
          // swipes anywhere on Profile move Profile and nothing else.
          overflowY: 'auto',
          overflowX: 'hidden',
          WebkitOverflowScrolling: 'touch',
          overscrollBehavior: 'contain',
          touchAction: 'pan-y',
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        {children}
      </div>
    </>
  )
}
