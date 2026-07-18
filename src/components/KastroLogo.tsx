/**
 * KASTRO brand mark — a hexagonal "K" monogram crowned with a castle
 * crenellation accent (a nod to "Kastro," Greek for castle/fortress).
 * Used on Login, TopBar, Splash, and wherever the brand needs anchoring.
 */

interface Props {
  size?: number
  /** Show the wordmark next to the icon */
  wordmark?: boolean
  lang?: 'en' | 'ar'
  /** Animated glow pulse */
  animated?: boolean
}

export default function KastroLogo({ size = 36, wordmark = false, animated = false }: Props) {
  const s = size

  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: Math.round(s * 0.28) }}>
      {/* Hex + crown mark */}
      <svg
        width={s}
        height={s}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        style={animated ? { animation: 'animate-glow-pulse 2.4s ease-in-out infinite', filter: 'drop-shadow(0 0 8px rgba(157,111,255,0.55))' } : { filter: 'drop-shadow(0 0 6px rgba(157,111,255,0.45))' }}
      >
        <defs>
          <linearGradient id="kz-hex" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#9d6fff" />
            <stop offset="100%" stopColor="#00d4ff" />
          </linearGradient>
          <linearGradient id="kz-crown" x1="0" y1="0" x2="0.6" y2="1">
            <stop offset="0%" stopColor="#ffd700" />
            <stop offset="100%" stopColor="#ff6b35" />
          </linearGradient>
          <linearGradient id="kz-k" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#ffffff" />
            <stop offset="100%" stopColor="#dcd6ff" />
          </linearGradient>
        </defs>

        {/* Crenellation / crown accent */}
        <g fill="url(#kz-crown)">
          <rect x="73" y="40" width="13" height="17" rx="2" />
          <rect x="93.5" y="32" width="13" height="25" rx="2" />
          <rect x="114" y="40" width="13" height="17" rx="2" />
        </g>

        {/* Outer hexagon */}
        <polygon
          points="100,42 153.7,71 153.7,129 100,158 46.3,129 46.3,71"
          fill="none"
          stroke="url(#kz-hex)"
          strokeWidth="4.5"
          strokeLinejoin="round"
        />

        {/* Inner hexagon (smaller, filled) */}
        <polygon
          points="100,52 144,76 144,124 100,148 56,124 56,76"
          fill="rgba(124,58,237,0.16)"
          stroke="url(#kz-hex)"
          strokeWidth="1.5"
          strokeLinejoin="round"
          opacity="0.5"
        />

        {/* K monogram */}
        <path
          d="M78,72 L78,128 M78,101 L124,72 M78,101 L124,128"
          fill="none"
          stroke="url(#kz-k)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* Wordmark */}
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
            KAS<span style={{
              background: 'linear-gradient(135deg, #ffd700, #ff6b35)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
            }}>TRO</span>
          </span>
          <span style={{
            fontFamily: "'Inter', sans-serif",
            fontWeight: 600,
            fontSize: Math.round(s * 0.25),
            color: 'rgba(var(--fg2-rgb),0.45)',
            letterSpacing: '0.12em',
            textTransform: 'uppercase',
          }}>
            Performance
          </span>
        </div>
      )}
    </div>
  )
}
