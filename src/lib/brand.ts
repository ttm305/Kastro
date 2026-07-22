// -----------------------------------------------------------------------
// Single source of truth for the CareerXP brand name/tagline across the
// whole app (in-app UI, TopBar identity check, push notification/email
// fallback text, CSV export filenames, etc.).
//
// The VISUAL mark is intentionally NOT part of this file. Per direction,
// the app keeps its current placeholder logo (see AppLogo.tsx — the old
// KASTRO hex+K monogram, unchanged) until final CareerXP brand assets are
// supplied. When those arrive, the swap is:
//   1. Replace the SVG markup inside AppLogo.tsx (and the files in
//      public/: favicon.svg/png, apple-touch-icon.png, icon-192.png,
//      icon-512.png) with the new artwork.
//   2. Nothing else needs to change — every screen/component that shows
//      the app name already reads it from APP_NAME below, not a literal
//      string, and every screen that shows the mark renders <AppLogo>,
//      not inline SVG of its own.
// -----------------------------------------------------------------------

export const APP_NAME = 'CareerXP'

/** Shown under the wordmark on Splash/Login/Reset — matches the brand's
 * reference tagline. Plain text only; not part of the visual mark. */
export const APP_TAGLINE = 'Play · Grow · Achieve'
