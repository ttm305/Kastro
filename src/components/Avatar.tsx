import type { CSSProperties, ReactNode } from 'react'
import { BUILTIN_AVATARS, type CosmeticItem } from '../lib/api'
import { FRAME_OVERHANG_SCALE } from '../lib/avatarFrameStandard'

const DEFAULT_GRADIENT = 'linear-gradient(135deg, #7c3aed, #00d4ff)'

/**
 * Shared geometry standard for every image-overlay frame (frame.image_url
 * set). The photo is NEVER resized for a frame -- it renders at exactly the
 * same diameter as Solar Frame's photo (100% of the avatar box, zero
 * shrink), so there is never a visible size difference between an avatar
 * wearing Solar Frame and one wearing any other frame.
 *
 * That means the frame's inner boundary and the photo's true edge are the
 * *same circle* (radius = size/2, zero gap by definition -- there's no
 * space between "photo edge" and "frame inner edge" because they're the
 * identical line). For the frame to draw anything without painting over
 * the photo, every frame pixel must fall strictly outside that circle --
 * which means the frame image is deliberately rendered in a container
 * larger than the avatar box (FRAME_OVERHANG_SCALE), overhanging outward
 * around the plain avatar circle the same way a badge/decoration sits
 * around a Discord-style avatar. The avatar's own layout footprint (what
 * other flex/grid code measures) is untouched -- only the frame <img>
 * visually extends past it, with pointer-events:none so it never affects
 * hit-testing or spacing.
 *
 * Solar Frame itself is untouched: it has no `image_url`, so it never
 * enters this path and keeps using its own CSS ring exactly as before.
 *
 * Every new frame SVG asset must match this exactly: fully transparent for
 * radius < PHOTO_RADIUS (in the shared AVATAR_DIAMETER-unit coordinate
 * space centered on the avatar), with the *inner edge* of every solid
 * shape -- not just its center -- at radius >= PHOTO_RADIUS. Decoration
 * may extend from there out to FRAME_OUTER_RADIUS_MAX. These numbers are
 * NOT redefined here -- FRAME_OVERHANG_SCALE is imported directly from
 * src/lib/avatarFrameStandard.ts, the single source of truth documented in
 * /AVATAR_FRAME_STANDARD.md. Do not reintroduce a local copy of this
 * constant or any frame-specific sizing/offset logic in this file.
 */

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
 * an absolutely-positioned image centered on the avatar, sized to
 * `size * FRAME_OVERHANG_SCALE` (larger than the avatar box) so its
 * decorations have room to extend outward from the photo's true edge
 * without ever drawing inside it. The photo itself is never resized.
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

  // The photo always renders at the full avatar box size -- identical to
  // Solar Frame, identical to no-frame-equipped. Frames never change how
  // large the photo appears.
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

  // Real frame artwork present: strip any conflicting ring styling -- the
  // frame overlay below draws its own ring entirely outside the photo, so a
  // CSS border here would be redundant/conflicting.
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
      style={{ position: 'relative', width: size, height: size, aspectRatio: '1 / 1', flexShrink: 0, overflow: 'visible' }}
    >
      {/* Layer 1+2: avatar background + image — always exactly `size`, never resized for a frame */}
      <div style={inner}>{photo}</div>

      {/* Layer 3: frame overlay — centered on the same point as the avatar
          but rendered at size*FRAME_OVERHANG_SCALE (larger than the photo
          box) so decorations have room to extend outward from the photo's
          true edge without ever drawing inside it. pointer-events:none so
          the overhang never affects clicks/hit-testing; the layout box
          other code measures (the outer `size x size` div above) is
          unchanged, only this image visually overflows it. */}
      {frameOverlayUrl && (
        <img
          src={frameOverlayUrl}
          alt=""
          aria-hidden="true"
          draggable={false}
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            width: `${FRAME_OVERHANG_SCALE * 100}%`,
            height: `${FRAME_OVERHANG_SCALE * 100}%`,
            transform: 'translate(-50%, -50%)',
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
