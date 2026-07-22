// @vitest-environment jsdom
import { fireEvent, render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ProfileOverlayHost from './ProfileOverlayHost'

// =============================================================================
// Regression test for the reported bug: "Profile overlay opens visually but
// does not own the scrolling — swiping inside it scrolls Home underneath."
//
// This renders the REAL <ProfileOverlayHost> (via React Testing Library, in a
// real jsdom DOM) and dispatches REAL TouchEvents through React's actual event
// handlers — it does not re-derive the logic by reading the source, it
// exercises the shipped component directly. Three things the bug report
// specifically named are asserted against the live rendered DOM:
//
//   1. The panel is the scroll container: its own inline style carries
//      overflow-y:auto, touch-action:pan-y, overscroll-behavior:contain, and
//      -webkit-overflow-scrolling:touch (requirement #10) — not just present
//      in source, but actually applied to the mounted node.
//   2. Home's body is genuinely taken out of the scroll flow the moment the
//      overlay opens (position:fixed + the exact negative offset of the
//      saved scroll position, per requirement #5/#6/#11), and is restored to
//      the exact same offset on close.
//   3. Vertical touch gestures inside the panel are never mistaken for the
//      horizontal drag-to-dismiss gesture (requirement #12) — a vertical
//      swipe leaves the panel's transform untouched and never fires
//      onRequestClose, while a horizontal swipe past the 35% threshold does.
//
// Caveat, stated plainly: jsdom does not implement real layout, scrolling, or
// touch physics, so this cannot replay an actual finger swipe on real iOS
// Safari. What it CAN and does prove is that the exact code path the browser
// would run — the same event handlers, the same style object, the same
// lock/unlock calls — behaves correctly when actually executed, which is the
// strongest verification available without a physical device/real browser in
// this environment.
// =============================================================================

function makeTouch(clientX: number, clientY: number) {
  return [{ clientX, clientY, identifier: 0, target: document.body }] as unknown as TouchList
}

beforeEach(() => {
  // Simulate Home having been scrolled halfway down before Profile opens.
  Object.defineProperty(window, 'scrollY', { value: 812, writable: true, configurable: true })
  window.scrollTo = vi.fn()
})

afterEach(() => {
  cleanup()
  document.body.style.cssText = ''
  vi.restoreAllMocks()
})

describe('<ProfileOverlayHost> — scroll-container structure (requirement #10)', () => {
  it('gives the panel its own overflow-y:auto / touch-action:pan-y / overscroll-behavior:contain / -webkit-overflow-scrolling:touch, not overflow:hidden', () => {
    const { getByRole } = render(
      <ProfileOverlayHost open={true} isRTL={false} onRequestClose={() => {}}>
        <div style={{ height: '3000px' }}>tall profile content</div>
      </ProfileOverlayHost>,
    )
    const panel = getByRole('dialog')
    expect(panel.style.overflowY).toBe('auto')
    expect(panel.style.overflow).not.toBe('hidden')
    expect(panel.style.touchAction).toBe('pan-y')
    expect(panel.style.overscrollBehavior).toBe('contain')
    expect((panel.style as unknown as Record<string, string>).WebkitOverflowScrolling).toBe('touch')
  })
})

describe('<ProfileOverlayHost> — background scroll lock (requirements #5, #6, #9, #11)', () => {
  it('locks body at the exact saved scroll offset when it opens', () => {
    render(
      <ProfileOverlayHost open={true} isRTL={false} onRequestClose={() => {}}>
        <div>content</div>
      </ProfileOverlayHost>,
    )
    expect(document.body.style.position).toBe('fixed')
    expect(document.body.style.top).toBe('-812px')
    expect(document.body.style.overflow).toBe('hidden')
  })

  it('unlocks and restores window.scrollTo to the exact same offset when it closes', () => {
    const { rerender } = render(
      <ProfileOverlayHost open={true} isRTL={false} onRequestClose={() => {}}>
        <div>content</div>
      </ProfileOverlayHost>,
    )
    expect(document.body.style.position).toBe('fixed')

    rerender(
      <ProfileOverlayHost open={false} isRTL={false} onRequestClose={() => {}}>
        <div>content</div>
      </ProfileOverlayHost>,
    )
    expect(document.body.style.position).toBe('')
    expect(window.scrollTo).toHaveBeenCalledWith(0, 812)
  })

  it('never locks the body at all while the overlay has not been opened', () => {
    render(
      <ProfileOverlayHost open={false} isRTL={false} onRequestClose={() => {}}>
        <div>content</div>
      </ProfileOverlayHost>,
    )
    expect(document.body.style.position).not.toBe('fixed')
  })
})

describe('<ProfileOverlayHost> — gesture ownership (requirement #12)', () => {
  it('a vertical swipe inside the panel does NOT trigger close and does NOT drag the panel horizontally', () => {
    const onRequestClose = vi.fn()
    const { getByRole } = render(
      <ProfileOverlayHost open={true} isRTL={false} onRequestClose={onRequestClose}>
        <div style={{ height: '3000px' }}>tall profile content</div>
      </ProfileOverlayHost>,
    )
    const panel = getByRole('dialog')

    fireEvent.touchStart(panel, { touches: makeTouch(200, 200) })
    // Predominantly vertical movement (dy=250, dx=5) — this is what a real
    // finger-scroll gesture inside Profile looks like.
    fireEvent.touchMove(panel, { touches: makeTouch(205, 450) })
    fireEvent.touchEnd(panel, { touches: makeTouch(205, 450) })

    expect(onRequestClose).not.toHaveBeenCalled()
    // The drag-to-dismiss transform must stay fully open (0%) — it must
    // never have been nudged toward the closed position by a vertical swipe.
    expect(panel.style.transform).toBe('translate3d(0%, 0, 0)')
  })

  it('a horizontal swipe past the 35% dismiss threshold DOES trigger close', () => {
    const onRequestClose = vi.fn()
    const { getByRole } = render(
      <ProfileOverlayHost open={true} isRTL={false} onRequestClose={onRequestClose}>
        <div style={{ height: '3000px' }}>tall profile content</div>
      </ProfileOverlayHost>,
    )
    const panel = getByRole('dialog')
    Object.defineProperty(panel, 'offsetWidth', { value: 400, configurable: true })

    fireEvent.touchStart(panel, { touches: makeTouch(50, 200) })
    // Predominantly horizontal movement, past 35% of the 400px panel width.
    fireEvent.touchMove(panel, { touches: makeTouch(250, 205) })
    fireEvent.touchEnd(panel, { touches: makeTouch(250, 205) })

    expect(onRequestClose).toHaveBeenCalledTimes(1)
  })

  it('a short horizontal swipe under the threshold snaps back open instead of closing', () => {
    const onRequestClose = vi.fn()
    const { getByRole } = render(
      <ProfileOverlayHost open={true} isRTL={false} onRequestClose={onRequestClose}>
        <div style={{ height: '3000px' }}>tall profile content</div>
      </ProfileOverlayHost>,
    )
    const panel = getByRole('dialog')
    Object.defineProperty(panel, 'offsetWidth', { value: 400, configurable: true })

    fireEvent.touchStart(panel, { touches: makeTouch(50, 200) })
    fireEvent.touchMove(panel, { touches: makeTouch(90, 205) })
    fireEvent.touchEnd(panel, { touches: makeTouch(90, 205) })

    expect(onRequestClose).not.toHaveBeenCalled()
  })
})
