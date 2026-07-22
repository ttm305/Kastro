/**
 * AVATAR FRAME STANDARD -- the single source of truth for every avatar
 * frame's geometry, in this app, forever.
 *
 * Full rationale and examples: /AVATAR_FRAME_STANDARD.md at the repo root.
 * Read that file before creating or editing any frame asset.
 *
 * The short version: the avatar photo is Solar Frame's photo -- same
 * diameter, same center, always. A frame never resizes it. A frame's
 * artwork begins exactly where the photo ends (FRAME_INNER_RADIUS ===
 * PHOTO_RADIUS, enforced below, not just documented) and may only extend
 * outward, into the overhang band, never inward.
 *
 * THIS FILE HAS NO REACT IMPORT AND NO SIDE EFFECTS ON PURPOSE: it is
 * imported by the React app (Avatar.tsx and everything that renders an
 * avatar) *and* by the standalone Node validation script
 * (scripts/validate-frames.ts, run via `npm run validate:frames`) via
 * Node's native TypeScript support. Keep it that way -- no JSX, no DOM
 * APIs, no imports from anywhere else in the app.
 *
 * Every number below is derived from exactly one input: the photo's
 * diameter. Nothing here may be overridden per-frame. If a future frame
 * seems to need a different number, the fix is almost always "extend the
 * artwork further outward," never "change one of these constants."
 */

/**
 * The photo's diameter, in the shared coordinate space every frame SVG is
 * authored in. This *is* "100% of Solar Frame's photo diameter" --  Solar
 * Frame has no image_url and renders its photo at the avatar's full box
 * size, so this constant is that same box, expressed as SVG units. A
 * frame's viewBox must map this many units to the avatar's actual on-screen
 * diameter (before the overhang padding below is added).
 */
export const AVATAR_DIAMETER = 200

/** Half of AVATAR_DIAMETER. The photo's true edge -- the one immovable
 * line every frame is built around. */
export const PHOTO_RADIUS = AVATAR_DIAMETER / 2 // 100

/**
 * The radius at which a frame's own artwork must begin. This is defined
 * as *exactly* PHOTO_RADIUS, not "approximately" or "close to" -- gap and
 * overlap both mean this number stopped equaling PHOTO_RADIUS. There is
 * no such thing as a frame with its own FRAME_INNER_RADIUS; every frame
 * inherits this one.
 */
export const FRAME_INNER_RADIUS = PHOTO_RADIUS // 100

/**
 * How much larger a frame's own render container is than the avatar box,
 * as a ratio. The photo never changes size (see PHOTO_RADIUS), so this is
 * the *only* lever a frame has for giving its decorations room: the frame
 * <img> and the frame SVG's canvas are both drawn FRAME_OVERHANG times
 * larger than the avatar, centered on the same point, so decoration can
 * extend into that extra margin without ever needing to shrink the photo
 * or touch it.
 *
 * Avatar.tsx must import this value directly (not redefine its own copy)
 * for the frame <img>'s width/height. See FRAME_OVERHANG_SCALE below,
 * which is the same number under the name Avatar.tsx uses.
 */
export const FRAME_OVERHANG = 1.2

/** Alias of FRAME_OVERHANG for call sites (Avatar.tsx) that render the
 * frame overlay via a CSS percentage -- same number, same meaning. */
export const FRAME_OVERHANG_SCALE = FRAME_OVERHANG

/**
 * The absolute outer radius decoration may reach before risking being
 * clipped by the frame's own canvas edge. Derived, not chosen: it's just
 * PHOTO_RADIUS scaled by the overhang ratio.
 */
export const FRAME_OUTER_RADIUS_MAX = PHOTO_RADIUS * FRAME_OVERHANG // 120

/**
 * Every frame SVG's viewBox must be exactly this size (square, so the
 * canvas ratio is always 1:1) -- AVATAR_DIAMETER expanded by the overhang
 * padding on every side. A viewBox of any other size fails validation.
 */
export const FRAME_CANVAS_SIZE = AVATAR_DIAMETER * FRAME_OVERHANG // 240

/** The padding added to each side of the photo canvas to reach
 * FRAME_CANVAS_SIZE. This is also the required viewBox min-x/min-y (as a
 * negative offset) when a frame is authored with (0,0) at the photo's
 * own top-left corner -- see AVATAR_FRAME_STANDARD.md's SVG rules. */
export const FRAME_CANVAS_PADDING = (FRAME_CANVAS_SIZE - AVATAR_DIAMETER) / 2 // 20

/** Every frame's ring/decoration must be centered on this point, in the
 * photo-relative coordinate space (i.e. treating the photo's own center
 * as (CENTER, CENTER), independent of whatever viewBox origin offset the
 * SVG markup uses). */
export const CENTER = PHOTO_RADIUS // 100

/**
 * Tolerances used only by the validator (scripts/validate-frames.ts), not
 * by rendering code. Rendering must hit these numbers exactly; validation
 * allows a small margin for floating-point rounding and anti-aliasing.
 */
export const VALIDATION = {
  /** Nothing may render closer to CENTER than FRAME_INNER_RADIUS minus
   * this many units. Catches inward overlap. */
  overlapToleranceUnits: 0.5,
  /** At least one shape's inner edge must land within this many units of
   * FRAME_INNER_RADIUS. Catches a frame whose ring is pushed outward,
   * leaving a visible transparent gap between the photo and the artwork
   * (the exact bug an earlier version of every frame in this app had). */
  gapToleranceUnits: 2,
  /** Nothing may render further from CENTER than FRAME_OUTER_RADIUS_MAX
   * plus this many units. Catches ornaments clipped by the canvas edge
   * (or, more precisely here, ornaments placed so close to the edge that
   * they risk being clipped -- see AVATAR_FRAME_STANDARD.md). */
  clipToleranceUnits: 0.5,
  /** How far a shape's centroid may drift from CENTER (as a fraction of
   * PHOTO_RADIUS) before the frame is considered "not centered." */
  centeringToleranceRatio: 0.03,
} as const

export interface AvatarFrameStandard {
  AVATAR_DIAMETER: number
  PHOTO_RADIUS: number
  FRAME_INNER_RADIUS: number
  FRAME_OVERHANG: number
  FRAME_OUTER_RADIUS_MAX: number
  FRAME_CANVAS_SIZE: number
  FRAME_CANVAS_PADDING: number
  CENTER: number
}

/** Convenience bundle -- pass this around instead of importing eight
 * separate named constants when a function needs "the whole standard." */
export const AVATAR_FRAME_STANDARD: AvatarFrameStandard = {
  AVATAR_DIAMETER,
  PHOTO_RADIUS,
  FRAME_INNER_RADIUS,
  FRAME_OVERHANG,
  FRAME_OUTER_RADIUS_MAX,
  FRAME_CANVAS_SIZE,
  FRAME_CANVAS_PADDING,
  CENTER,
}
