import type { CSSProperties, ReactNode } from 'react'
import { BUILTIN_AVATARS, type CosmeticItem } from '../lib/api'

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #7c3aed, #00d4ff)'

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
  /** Applied to the inner circular photo/gradient layer. When `frame` has
   * real overlay artwork (`image_url`), any `border`/`boxShadow` in this
   * style is stripped before use — see the note above `frameHasOverlay`
   * below for why. For legacy ring-only frames (no `image_url`) this is
   * still how the CSS-ring look (border + glow, from cosmetics.ts's
   * frameAvatarStyle()) gets applied, unchanged from before. */
  style?: CSSProperties
  /** The equipped avatar-frame cosmetic (or null/undefined for none). */
  frame?: CosmeticItem | null
  /** Layer 4 (optional animation/effect) and layer 5 (online indicator /
   * edit button), per the shared avatar-frame component's mandated 5-layer
   * order: 1) avatar background 2) avatar image 3) frame overlay 4) effect
   * 5) indicator. Rendered inside the same sized/positioned box as the
   * frame overlay so callers never need their own absolute-positioning math
   * on top of Avatar. */
  effect?: ReactNode
  indicator?: ReactNode
}

/**
 * Renders a user's avatar consistently everywhere it appears (Profile,
 * Home, Leaderboard, Friends, Tournament, Admin, shop preview). This is the
 * one shared, reusable avatar-frame component — every screen that shows an
 * avatar with a possible frame must render through this component rather
 * than hand-rolling its own overlay/positioning.
 *
 * Photo/gradient states (layers 1–2):
 *  - real Storage URL → circular <img>, cover-cropped
 *  - "builtin:<id>" → the matching gradient preset with a person icon
 *  - null/unrecognized → the original generic gradient placeholder
 *
 * Frame overlay (layer 3): when `frame.image_url` is set, it's rendered as
 * an absolutely-positioned image using exactly `position: absolute; inset:
 * 0; width: 100%; height: 100%; object-fit: contain; pointer-events: none`
 * over the *same* `size x size` box as the avatar — same center point, same
 * square container, 1:1 aspect ratio, no per-frame margins/transforms, no
 * overhang past the box. Frame art must be authored to the photo's edge,
 * not beyond it.
 *
 * Critical: when a real overlay image is used, any legacy `border`/
 * `boxShadow` passed via `style` is intentionally dropped from the inner
 * photo layer. Applying both at once was the root cause of misaligned/
 * "sticker" frames — an opaque CSS border (e.g. `3px solid var(--surface-1)`)
 * shrinks the *visible photo circle* by 2×borderWidth (global `box-sizing:
 * border-box`), while frame artwork is authored assuming the photo fills
 * the full box — producing a visible seam/gap between photo and frame. The
 * two rendering paths (legacy CSS ring vs. image overlay) are mutually
 * exclusive by construction here so callers can't reintroduce this bug.
 */
export default function Avatar({ url, size, alt = '', className, style, frame, effect, indicator }: AvatarProps) {
  const frameOverlayUrl = frame?.image_url || null

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

  // Real frame artwork present: strip any conflicting ring styling so the
  // photo renders at full size with nothing but the frame overlay drawing
  // the ring on top of it.
  if (frameOverlayUrl) {
    inner.border = 'none'
    inner.boxShadow = 'none'
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

  // No frame artwork and no extra layers: render exactly as before this
  // prop existed (the caller's own `style` — e.g. the legacy CSS ring from
  // frameAvatarStyle() — is already applied to `inner` above via spread).
  if (!frameOverlayUrl && !effect && !indicator) {
    return <div className={className} style={inner}>{photo}</div>
  }

  return (
    <div
      className={className}
      style={{ position: 'relative', width: size, height: size, aspectRatio: '1 / 1', flexShrink: 0 }}
    >
      {/* Layer 1+2: avatar background + image */}
      <div style={inner}>{photo}</div>

      {/* Layer 3: frame overlay — same box as the avatar, no overhang, no per-frame margins/transforms */}
      {frameOverlayUrl && (
        <img
          src={frameOverlayUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: 'contain',
            pointerEvents: 'none',
            zIndex: 2,
          }}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      )}

      {/* Layer 4: optional animation/effect */}
      {effect && (
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 3 }}>{effect}</div>
      )}

      {/* Layer 5: online indicator / edit button — callers position within this box as needed */}
      {indicator && (
        <div style={{ position: 'absolute', inset: 0, zIndex: 4 }}>{indicator}</div>
      )}
    </div>
  )
}
