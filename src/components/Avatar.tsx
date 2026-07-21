import type { CSSProperties, ReactNode } from 'react'
import { BUILTIN_AVATARS, type CosmeticItem } from '../lib/api'

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #7c3aed, #00d4ff)'

/** How far a frame's decorative artwork is allowed to extend past the
 * circular avatar photo, as a fraction of `size`. Real collectible frames
 * (rings, laurels, gem clusters) are designed to sit slightly outside the
 * photo edge rather than being cropped to it — but this stays purely
 * visual: the overlay is `position: absolute` inside a `position: relative`
 * wrapper, so it never grows Avatar's contribution to surrounding flex/grid
 * layout (every existing call site keeps its exact `size x size` footprint
 * whether or not a frame is equipped). */
const FRAME_OVERHANG = 0.16

function PersonSilhouette({ size }: { size: number }) {
  return (
    <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  )
}

interface AvatarProps {
  /** profiles.avatar_url — a real image URL, a "builtin:<id>" preset id, or null/undefined for the generic fallback. */
  url?: string | null
  size: number
  alt?: string
  className?: string
  /** Applied to the inner circular photo/gradient layer — same as before
   * `frame` existed. Still how the legacy CSS-ring frame look (border +
   * glow, via cosmetics.ts's frameAvatarStyle()) is applied for any
   * cosmetic that has no real overlay artwork yet. */
  style?: CSSProperties
  /** The equipped avatar-frame cosmetic (or null/undefined for none). When
   * it has real overlay artwork (`image_url` — a raster/SVG/PNG frame asset
   * with a transparent center), Avatar renders it as a proper layered
   * frame: avatar photo/gradient underneath, frame art on top, extending
   * slightly past the photo edge like a real collectible frame — not a
   * flat border color. Purely additive: omit this prop (or equip a legacy
   * ring-only frame with no `image_url`) and rendering is byte-identical
   * to before this prop existed. */
  frame?: CosmeticItem | null
}

/**
 * Renders a user's avatar consistently everywhere it appears (Profile,
 * Home, Leaderboard, Friends, Tournament, Admin). Three photo/gradient
 * states:
 *  - real Storage URL → circular <img>, cover-cropped
 *  - "builtin:<id>" → the matching gradient preset with a person icon
 *  - null/unrecognized → the original generic gradient placeholder, so
 *    every screen that never had avatars before still looks the same.
 *
 * Layered on top, in order (per the cosmetics-expansion frame-rendering
 * spec): 1) avatar background/gradient, 2) avatar image, 3) frame overlay
 * artwork (this component's `frame` prop), 4)/5) effect + status-dot layers
 * are left to callers (e.g. LeaderboardScreen already renders its own
 * online-dot after Avatar) since those vary per screen.
 */
export default function Avatar({ url, size, alt = '', className, style, frame }: AvatarProps) {
  const inner: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    overflow: 'hidden',
    ...style,
  }

  const isRealPhoto = !!(url && !url.startsWith('builtin:') && (url.startsWith('http://') || url.startsWith('https://')))

  let photo: ReactNode
  if (isRealPhoto) {
    photo = (
      <img
        src={url as string}
        alt={alt}
        width={size}
        height={size}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    )
  } else {
    const builtinId = url?.startsWith('builtin:') ? url.slice('builtin:'.length) : null
    const preset = builtinId ? BUILTIN_AVATARS.find((a) => a.id === builtinId) : null
    inner.background = preset?.gradient ?? DEFAULT_GRADIENT
    photo = <PersonSilhouette size={size} />
  }

  const frameOverlayUrl = frame?.image_url || null

  // No frame artwork: render exactly as before this prop existed (the
  // caller's own `style` — e.g. the legacy CSS ring from frameAvatarStyle()
  // — is already applied to `inner` above via spread).
  if (!frameOverlayUrl) {
    return <div className={className} style={inner}>{photo}</div>
  }

  // Real frame artwork: outer wrapper stays exactly `size x size` for
  // layout purposes (so nothing shifts in surrounding flex/grid rows
  // whether or not a frame is equipped) — the overlay image is absolutely
  // positioned and allowed to visually extend past that box without
  // affecting layout, the same "grow visually, not in flow" technique used
  // for expanded tap targets elsewhere in the app.
  const overhang = Math.round(size * FRAME_OVERHANG)
  return (
    <div className={className} style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <div style={inner}>{photo}</div>
      <img
        src={frameOverlayUrl}
        alt=""
        aria-hidden="true"
        draggable={false}
        style={{
          position: 'absolute',
          top: -overhang, left: -overhang, right: -overhang, bottom: -overhang,
          width: size + overhang * 2, height: size + overhang * 2,
          objectFit: 'contain',
          pointerEvents: 'none',
          zIndex: 2,
        }}
        onError={(e) => { e.currentTarget.style.display = 'none' }}
      />
    </div>
  )
}
