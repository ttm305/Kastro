import { APP_TAGLINE } from '../lib/brand'

/**
 * CareerXP brand mark — PLACEHOLDER.
 *
 * This is still the original KASTRO hex+K monogram (a nod to "Kastro,"
 * Greek for castle/fortress) — the mark itself was intentionally left
 * unchanged during the CareerXP rebrand per direction: don't finalize the
 * logo yet, keep the current one as a stand-in, and structure things so
 * swapping in the final CareerXP artwork later only means replacing the
 * SVG markup below (and the icon files in public/) — no other file in the
 * app needs to change, since every screen renders <AppLogo> rather than
 * drawing its own copy of the mark, and every screen reads the app name
 * from src/lib/brand.ts rather than a hardcoded string.
 *
 * Used on Login, TopBar, Splash, Reset Password, and wherever the brand
 * needs anchoring.
 */

interface Props {
  size?: number
  /** Show the wordmark next to the icon */
  wordmark?: boolean
  lang?: 'en' | 'ar'
  /** Animated glow pulse */
  animated?: boolean
}

export default function AppLogo({ size = 36, wordmark = false, animated = false }: Props) {
  const s = size

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(s * 0.28) }}>
      {/* Hex + crown mark — placeholder, see file header */}
      <svg
        width={s}
        height={s}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={animated ? { animation: 'animate-glow-pulse 2.4s ease-in-out infinite', filter: 'drop-shadow(0 0 8px rgba(157,111,255,0.55))' } : { filter: 'drop-shadow(0 0 6px rgba(157,111,255,0.45))' }}
      >
        <defs>
          <linearGradient id="cxp-hex" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9d6fff" />
            <stop offset="100%" stopColor="#00d4ff" />
          </linearGradient>
          <linearGradient id="cxp-crown" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#ffd700" />
            <stop offset="100%" stopColor="#ff6b35" />
          </linearGradient>
          <linearGradient id="cxp-k" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#dcd6ff" />
          </linearGradient>
        </defs>

        {/* Crenellation / crown accent */}
        <g fill="url(#cxp-crown)">
          <rect x="73" y="40" width="13" height="17" rx="2" />
          <rect x="93.5" y="32" width="13" height="25" rx="2" />
          <rect x="114" y="40" width="13" height="17" rx="2" />
        </g>

        {/* Outer hexagon */}
        <polygon
          points="100,42 153.7,71 153.7,129 100,158 46.3,129 46.3,71"
          fill="none"
          stroke="url(#cxp-hex)"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />

        {/* Inner hexagon (smaller, filled) */}
        <polygon
          points="100,52 144,76 144,124 100,148 56,124 56,76"
          fill="rgba(124,58,237,0.16)"
          stroke="url(#cxp-hex)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          opacity="0.5"
        />

        {/* K monogram — placeholder, unrelated to "CareerXP" letters; kept
            unchanged intentionally (see file header) until real artwork
            replaces this whole SVG. */}
        <path
          d="M78,72 L78,128 M78,101 L124,72 M78,101 L124,128"
          fill="none"
          stroke="url(#cxp-k)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Wordmark — "Career" / "XP" two-tone split mirrors the same
          gradient technique the old "KAS"/"TRO" split used, and happens to
          land naturally on the CareerXP name itself. */}
      {wordmark && (
        <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1 }}>
          <span style={{
            fontFamily: "'Exo 2', sans-serif",
            fontWeight: 900,
            fontSize: Math.round(s * 0.55),
            letterSpacing: '0.04em',
            background: 'linear-gradient(135deg, #c4b5fd 0%, #00d4ff 100%)',
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
            backgroundClip: 'text',
          }}>
            Career<span style={{
              background: 'linear-gradient(135deg, #ffd700, #ff6b35)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>XP</span>
          </span>
          <span style={{
            fontFamily: "'Inter', sans-serif",
            fontWeight: 600,
            fontSize: Math.round(s * 0.25),
            color: 'rgba(var(--fg2-rgb),0.45)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}>
            {APP_TAGLINE}
          </span>
        </div>
      )}
    </div>
  )
}
