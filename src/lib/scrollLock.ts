// -----------------------------------------------------------------------
// Body scroll lock, iOS-Safari/PWA-safe.
//
// Why this exists: `document.body.style.overflow = 'hidden'` does NOT stop
// touch-driven scrolling on iOS Safari/WKWebView — it only blocks
// wheel/keyboard scrolling. iOS still lets a touch-drag scroll the page
// underneath a `position: fixed` overlay unless the body itself is taken
// out of the scrollable flow entirely. This app has no router/per-screen
// scroll containers (every screen relies on the document itself growing
// taller than the viewport — see `.screen { min-height: 100dvh }` in
// index.css with no overflow rule), so "the background" here specifically
// means the whole document/body.
//
// The fix is the standard technique: capture the current scroll offset,
// pin `body` with `position: fixed; top: -{offset}px`, then on unlock
// restore `position` and scroll back to the exact same offset. This is
// what makes the background genuinely unscrollable/untouchable (not just
// visually covered) while a full-screen overlay — right now, the Profile
// slide-over — is open, and is why Home reliably reappears at the exact
// scroll position it was left at rather than jumping to the top.
//
// Reference-counted so nested/overlapping lock requests (unlikely today,
// but cheap to make safe) don't unlock each other's background prematurely.
// -----------------------------------------------------------------------

let lockCount = 0
let savedScrollY = 0

export function lockBodyScroll() {
  if (lockCount === 0) {
    savedScrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0
    const body = document.body
    body.style.position = 'fixed'
    body.style.top = `-${savedScrollY}px`
    body.style.left = '0'
    body.style.right = '0'
    body.style.width = '100%'
    // Belt-and-suspenders: also blocks any residual wheel/keyboard scroll
    // and, combined with `position: fixed` above, is what actually
    // prevents touch-drag scroll chaining through to the document on iOS.
    body.style.overflow = 'hidden'
  }
  lockCount++
}

export function unlockBodyScroll() {
  lockCount = Math.max(0, lockCount - 1)
  if (lockCount === 0) {
    const body = document.body
    body.style.position = ''
    body.style.top = ''
    body.style.left = ''
    body.style.right = ''
    body.style.width = ''
    body.style.overflow = ''
    // Restore instantly (no smooth-scroll) — this is a structural
    // "put it back exactly where it was" restore, not a user-triggered
    // navigation, so it must not animate.
    window.scrollTo(0, savedScrollY)
  }
}
