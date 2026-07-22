// Deprecated during the CareerXP rebrand — superseded by ./AppLogo.tsx
// (same component, renamed; the visual mark itself is unchanged, still a
// placeholder pending final CareerXP brand assets). Kept as a re-export
// shim rather than deleted because this sandbox's tools can't delete files
// in this connected folder; every real call site in the app has already
// been updated to import AppLogo directly, so this file is unused dead
// code — safe to delete by hand whenever convenient.
export { default } from './AppLogo'
