/**
 * Barrel for the app's shared safe-area-aware layout primitives, per the
 * global safe-area audit. Six pieces, all safe-area-aware out of the box:
 *
 *  - SafeAreaScreen — root screen wrapper (left/right insets + 100dvh)
 *  - AppHeader      — standard sticky page header (alias for the existing
 *                      TopBar.tsx, used by 10 screens — fixed in place
 *                      rather than duplicated, so every consumer inherits
 *                      the fix with no per-screen changes)
 *  - GameHeader      — compact in-round header for the quick mini-games
 *                      (Emoji Decode, Color Blitz, and future ones built
 *                      the same way)
 *  - SafeBottomNav   — the 5-tab bottom nav (alias for the existing
 *                      BottomNav.tsx, now with left/right insets)
 *  - SafeModal       — centered/full-screen-scrim dialog
 *  - SafeBottomSheet — bottom-docked sheet with rounded top corners
 *
 * Import from here (or straight from the individual files) for any new
 * screen/modal so it inherits safe-area handling automatically instead of
 * hand-rolling env() math again.
 */
export { default as SafeAreaScreen } from './SafeAreaScreen'
export { default as SafeModal } from './SafeModal'
export { default as SafeBottomSheet } from './SafeBottomSheet'
export { default as GameHeader } from '../GameHeader'
export { default as AppHeader } from '../TopBar'
export { default as SafeBottomNav } from '../BottomNav'
