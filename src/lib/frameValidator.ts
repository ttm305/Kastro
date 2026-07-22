/**
 * Reusable avatar-frame geometry validator.
 *
 * Enforces AVATAR_FRAME_STANDARD (see avatarFrameStandard.ts and
 * /AVATAR_FRAME_STANDARD.md) against a frame's raw SVG markup. This module
 * has no React import and no side effects so it can run both in the app
 * (e.g. an admin "preview my custom frame" check, if ever added) and in
 * the standalone build-time script (scripts/validate-frames.ts).
 *
 * What it checks, per AVATAR_FRAME_STANDARD.md's validation-tool spec:
 *   1. artwork enters the photo area          -> "overlap" issues
 *   2. a visible gap exists                    -> "gap" issue
 *   3. the frame is not centered               -> "not-centered" issue
 *   4. the inner radius does not match Solar    -> covered by (1)+(2):
 *      FRAME_INNER_RADIUS is a fixed constant, not something a frame can
 *      set, so "doesn't match Solar" can only manifest as overlap or gap.
 *   5. the canvas ratio is not 1:1              -> "canvas-ratio" issue
 *   6. ornaments are clipped                    -> "clipped" issue
 *
 * NO PER-FRAME GEOMETRY OVERRIDES, enforced structurally (not just by
 * convention):
 *   - the viewBox's origin AND size must match FRAME_CANVAS_PADDING /
 *     FRAME_CANVAS_SIZE exactly -- a frame cannot shift or resize its own
 *     canvas ("custom padding/offset") -> "canvas-ratio" issue
 *   - the root <svg> may not carry `width`/`height` attributes -- only
 *     the shared viewBox may define scale when the SVG is embedded ->
 *     "illegal-transform" issue
 *   - no element anywhere may use `scale(...)`, `translate(...)`,
 *     `matrix(...)`, or `skew[XY](...)` -- these are exactly the
 *     mechanisms a frame could use to sneak in a custom scale/offset.
 *     `rotate(...)` is the ONLY transform allowed (orientation of
 *     outward decoration only -- it can't resize or reposition the
 *     frame's geometry relative to CENTER) -> "illegal-transform" issue
 * A frame that needs any of the above to "fit" is not valid -- the fix is
 * always to change the artwork, never to add a geometry override.
 *
 * Known limitation (documented, not hidden): path (`<path d="...">`)
 * parsing supports the M/L/Q/A commands (and Z), which is everything this
 * app's frame generator produces. Any other path command (C/S/T/H/V) is
 * reported as an "unsupported-path-command" WARNING rather than silently
 * trusted -- a frame that trips this warning needs a human look, because
 * the validator cannot vouch for geometry it can't parse.
 */

// NOTE: explicit ".ts" extension required here (not just a style choice) --
// this file is imported both by Vite (which resolves it fine either way,
// via tsconfig's allowImportingTsExtensions) and by the standalone
// scripts/validate-frames.ts CLI via `node --experimental-strip-types`,
// which requires explicit extensions on relative specifiers. Keep it.
import {
  CENTER,
  FRAME_CANVAS_PADDING,
  FRAME_CANVAS_SIZE,
  FRAME_INNER_RADIUS,
  FRAME_OUTER_RADIUS_MAX,
  VALIDATION,
} from './avatarFrameStandard.ts'

export type FrameIssueCode =
  | 'overlap'
  | 'gap'
  | 'not-centered'
  | 'canvas-ratio'
  | 'clipped'
  | 'no-viewbox'
  | 'illegal-transform'
  | 'unsupported-path-command'
  | 'parse-error'

export interface FrameIssue {
  code: FrameIssueCode
  severity: 'error' | 'warning'
  message: string
}

export interface FrameValidationResult {
  valid: boolean
  issues: FrameIssue[]
  /** Diagnostic detail, useful in the CLI report and in tests. */
  minRadiusFound: number | null
  maxRadiusFound: number | null
  centroid: { x: number; y: number } | null
}

interface Point {
  x: number
  y: number
  /** Extra radius to pad this point by (stroke-width/2, or an arc's own
   * rx/ry as a conservative bulge allowance). */
  pad: number
}

/** A shape's contribution to the frame's overall min/max distance-from-
 * CENTER envelope, already resolved to a concrete [rMin, rMax] interval
 * (not just a point+pad) -- see the circle handling below for why this
 * matters: a point+pad approximation is wrong for a ring shape whose own
 * center sits at or near CENTER. */
interface RadialContribution {
  rMin: number
  rMax: number
  /** Shape's own reference position, used only for the centroid/centering
   * check. */
  x: number
  y: number
}

function pointToContribution(p: Point, originX: number, originY: number): RadialContribution {
  const dx = p.x - originX
  const dy = p.y - originY
  const dist = Math.sqrt(dx * dx + dy * dy)
  return { rMin: Math.max(0, dist - p.pad), rMax: dist + p.pad, x: p.x, y: p.y }
}

/**
 * Resolves a circle (possibly an unfilled ring, i.e. an annulus) into its
 * true [rMin, rMax] distance-from-CENTER envelope. This is NOT the same
 * as treating the circle as "a point at (cx,cy) padded by r" -- that
 * approximation silently breaks for exactly the shape this validator most
 * needs to get right: a ring whose own center coincides with CENTER. In
 * that case a point+pad approach reports rMin as a large NEGATIVE number
 * (nonsense) instead of the ring's real inner edge (r - strokeWidth/2),
 * which would hide real gap/overlap bugs. This uses the standard
 * point-to-annulus distance formula instead:
 *   - point outside the annulus's outer edge: rMin = D - rOut
 *   - point inside the annulus's inner hole:  rMin = rIn - D
 *   - point within the ring material itself:  rMin = 0
 * with rMax = D + rOut in every case (the farthest point on the far side).
 */
function circleToContribution(
  cx: number,
  cy: number,
  rIn: number,
  rOut: number,
  originX: number,
  originY: number,
): RadialContribution {
  const dx = cx - originX
  const dy = cy - originY
  const d = Math.sqrt(dx * dx + dy * dy)
  let rMin: number
  if (d >= rOut) rMin = d - rOut
  else if (d <= rIn) rMin = rIn - d
  else rMin = 0
  const rMax = d + rOut
  return { rMin, rMax, x: cx, y: cy }
}

/**
 * Scans the WHOLE document for any transform that could rescale, reposition,
 * or skew geometry relative to CENTER -- `scale()`, `translate()`,
 * `matrix()`, `skewX()`/`skewY()`. Per-element `rotate(angle, cx, cy)` is
 * the only transform this app's frames may use (it reorients a decoration
 * in place; it cannot change size or move the geometry's relationship to
 * CENTER), so anything else found here is, by definition, an attempt at a
 * per-frame geometry override -- exactly what AVATAR_FRAME_STANDARD.md
 * forbids. This also catches transform LISTS that mix rotate with
 * something else (e.g. `rotate(30) scale(1.1)`), since those still
 * contain a banned function name.
 */
function findIllegalTransforms(svg: string): string[] {
  const found: string[] = []
  const transformAttrs = svg.match(/transform\s*=\s*["'][^"']*["']/gi) ?? []
  const bannedFn = /(scale|translate|matrix|skewx|skewy)\s*\(/i
  for (const attr of transformAttrs) {
    if (bannedFn.test(attr)) found.push(attr)
  }
  return found
}

/** The root `<svg>` element may not carry `width`/`height` attributes --
 * when an SVG is embedded via `<img>`, explicit root width/height (as
 * opposed to the viewBox) is a second, independent way to rescale the
 * whole frame, which would let a frame silently override
 * FRAME_CANVAS_SIZE without touching viewBox at all. Only the shared
 * viewBox may define the frame's canvas size. */
function rootSvgHasSizeOverride(svg: string): boolean {
  const rootTag = svg.match(/<svg\b[^>]*>/i)?.[0] ?? ''
  return /\bwidth\s*=\s*["'][^"']+["']/.test(rootTag) || /\bheight\s*=\s*["'][^"']+["']/.test(rootTag)
}

function parseViewBox(svg: string): { minX: number; minY: number; width: number; height: number } | null {
  const m = svg.match(/viewBox\s*=\s*["']([^"']+)["']/)
  if (!m) return null
  const parts = m[1].trim().split(/[\s,]+/).map(Number)
  if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return null
  const [minX, minY, width, height] = parts
  return { minX, minY, width, height }
}

function numbers(s: string): number[] {
  const m = s.match(/-?\d*\.?\d+(?:e-?\d+)?/gi)
  return m ? m.map(Number) : []
}

function strokeWidthOf(tag: string): number {
  const m = tag.match(/stroke-width\s*=\s*["']([^"']+)["']/)
  return m ? parseFloat(m[1]) : 0
}

function isStrokedOnly(tag: string): boolean {
  const fillNone = /fill\s*=\s*["']none["']/.test(tag)
  const hasStroke = /stroke\s*=\s*["'](?!none)[^"']+["']/.test(tag)
  return fillNone && hasStroke
}

interface RotateTransform {
  angleDeg: number
  cx: number
  cy: number
}

/** Parses a per-element `transform="rotate(angle [cx cy])"` (the only
 * transform this app's frame generator uses -- individual ornaments are
 * authored once and spun around a pivot to distribute copies around the
 * ring, or to reorient a single copy in place). Applying this correctly
 * matters: frame_fire_elemental.svg had a real bug where every petal
 * rotated around its own coordinate instead of the ring's center, which
 * silently clustered all 14 petals at one spot instead of spreading them
 * around the ring -- a bug that only shows up if you actually apply the
 * transform math, not just read the raw path coordinates. */
function parseRotateTransform(tag: string): RotateTransform | null {
  const m = tag.match(/transform\s*=\s*["']\s*rotate\(\s*(-?[\d.]+)(?:[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+))?\s*\)\s*["']/)
  if (!m) return null
  return {
    angleDeg: parseFloat(m[1]),
    cx: m[2] !== undefined ? parseFloat(m[2]) : 0,
    cy: m[3] !== undefined ? parseFloat(m[3]) : 0,
  }
}

/** Applies a rotate() transform to a point, per the SVG spec's rotation
 * matrix (rotate(a, cx, cy) == translate(cx,cy) rotate(a) translate(-cx,-cy)). */
function rotatePoint(x: number, y: number, rot: RotateTransform | null): { x: number; y: number } {
  if (!rot) return { x, y }
  const rad = (rot.angleDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const dx = x - rot.cx
  const dy = y - rot.cy
  return { x: rot.cx + dx * cos - dy * sin, y: rot.cy + dx * sin + dy * cos }
}

/** Extracts every risk point (with its stroke/arc pad) from every
 * non-circle shape this validator understands (ellipse, line, polygon,
 * path). Points are in the SVG's own local coordinate system -- caller
 * must offset by the viewBox origin before computing distance from
 * CENTER. Circles are handled separately by extractCircleContributions,
 * because a point+pad approximation is wrong for annulus/ring shapes --
 * see circleToContribution's doc comment. */
function extractPoints(svg: string, issues: FrameIssue[]): Point[] {
  const points: Point[] = []

  for (const tag of svg.match(/<ellipse\b[^>]*>/gi) ?? []) {
    const cx = parseFloat(tag.match(/cx\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    const cy = parseFloat(tag.match(/cy\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    const rx = parseFloat(tag.match(/\brx\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    const ry = parseFloat(tag.match(/\bry\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    if ([cx, cy, rx, ry].some(Number.isNaN)) continue
    const sw = isStrokedOnly(tag) ? strokeWidthOf(tag) : 0
    const rot = parseRotateTransform(tag)
    const center = rotatePoint(cx, cy, rot)
    // Rotation-agnostic conservative pad: an ellipse's boundary can never
    // get further from its OWN center than max(rx,ry), regardless of the
    // ellipse's own orientation. We still rotate the center itself above
    // (a rotate() can move the ellipse's center when its pivot isn't that
    // same center -- see royal_luxury/nature_weather's petal-ring pattern
    // where it usually is, but this must not be assumed).
    const pad = Math.max(rx, ry) + sw / 2
    points.push({ x: center.x, y: center.y, pad })
  }

  for (const tag of svg.match(/<line\b[^>]*>/gi) ?? []) {
    const x1 = parseFloat(tag.match(/x1\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    const y1 = parseFloat(tag.match(/y1\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    const x2 = parseFloat(tag.match(/x2\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    const y2 = parseFloat(tag.match(/y2\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    if ([x1, y1, x2, y2].some(Number.isNaN)) continue
    const sw = strokeWidthOf(tag)
    const rot = parseRotateTransform(tag)
    const p1 = rotatePoint(x1, y1, rot)
    const p2 = rotatePoint(x2, y2, rot)
    points.push({ x: p1.x, y: p1.y, pad: sw / 2 })
    points.push({ x: p2.x, y: p2.y, pad: sw / 2 })
  }

  for (const tag of svg.match(/<polygon\b[^>]*>/gi) ?? []) {
    const ptsAttr = tag.match(/points\s*=\s*["']([^"']+)["']/)?.[1]
    if (!ptsAttr) continue
    const nums = numbers(ptsAttr)
    const sw = strokeWidthOf(tag)
    const rot = parseRotateTransform(tag)
    for (let i = 0; i + 1 < nums.length; i += 2) {
      const p = rotatePoint(nums[i], nums[i + 1], rot)
      points.push({ x: p.x, y: p.y, pad: sw / 2 })
    }
  }

  const SUPPORTED = new Set(['M', 'L', 'Q', 'A', 'Z'])
  for (const tag of svg.match(/<path\b[^>]*>/gi) ?? []) {
    const d = tag.match(/\sd\s*=\s*["']([^"']+)["']/)?.[1]
    if (!d) continue
    // A path built entirely from the "M + two circular arcs" idiom (the
    // standard way to draw a filled circle/ring via <path>, as opposed to
    // a plain <circle>) is handled separately by
    // extractPathCircleContributions -- skip it here so it isn't
    // double-counted or mishandled by the generic point+pad fallback
    // below (which is far too conservative for a full-radius circular
    // arc; see tryDetectCircleDonutPath's doc comment).
    if (tryDetectCircleDonutPath(d)) continue
    const sw = isStrokedOnly(tag) ? strokeWidthOf(tag) : 0
    const rot = parseRotateTransform(tag)

    const tokens = d.match(/[MLQAZmlqaz][^MLQAZmlqaz]*/g) ?? []
    let cur = { x: 0, y: 0 }
    let start = { x: 0, y: 0 }
    let first = true

    for (const tok of tokens) {
      const cmd = tok[0]
      const upper = cmd.toUpperCase()
      const isRelative = cmd !== upper && !first // a leading 'm' is treated as absolute
      const args = numbers(tok.slice(1))

      if (!SUPPORTED.has(upper)) {
        issues.push({
          code: 'unsupported-path-command',
          severity: 'warning',
          message: `<path> uses command "${cmd}" which this validator doesn't parse -- geometry here was NOT checked. Stick to M/L/Q/A/Z (see AVATAR_FRAME_STANDARD.md) or extend frameValidator.ts.`,
        })
        break
      }

      if (upper === 'M' || upper === 'L') {
        for (let i = 0; i + 1 < args.length; i += 2) {
          const dx = args[i], dy = args[i + 1]
          cur = isRelative ? { x: cur.x + dx, y: cur.y + dy } : { x: dx, y: dy }
          if (first) { start = cur; first = false }
          const p = rotatePoint(cur.x, cur.y, rot)
          points.push({ x: p.x, y: p.y, pad: sw / 2 })
        }
      } else if (upper === 'Q') {
        for (let i = 0; i + 3 < args.length; i += 4) {
          const cx = args[i], cy = args[i + 1], ex = args[i + 2], ey = args[i + 3]
          const ctrl = isRelative ? { x: cur.x + cx, y: cur.y + cy } : { x: cx, y: cy }
          const end = isRelative ? { x: cur.x + ex, y: cur.y + ey } : { x: ex, y: ey }
          const pc = rotatePoint(ctrl.x, ctrl.y, rot)
          const pe = rotatePoint(end.x, end.y, rot)
          points.push({ x: pc.x, y: pc.y, pad: sw / 2 })
          points.push({ x: pe.x, y: pe.y, pad: sw / 2 })
          cur = end
        }
      } else if (upper === 'A') {
        for (let i = 0; i + 6 < args.length; i += 7) {
          const rx = args[i], ry = args[i + 1]
          const ex = args[i + 5], ey = args[i + 6]
          const end = isRelative ? { x: cur.x + ex, y: cur.y + ey } : { x: ex, y: ey }
          const pe = rotatePoint(end.x, end.y, rot)
          // Conservative: an arc can bulge outward from the chord by up
          // to roughly max(rx,ry); pad by that in addition to any stroke.
          points.push({ x: pe.x, y: pe.y, pad: sw / 2 + Math.max(rx, ry) })
          cur = end
        }
      } else if (upper === 'Z') {
        cur = start
      }
    }
  }

  return points
}

/**
 * Detects the "M start-point, then two circular arcs back to start" idiom
 * -- the standard way to draw a full circle (or, with fill-rule="evenodd"
 * and two nested circles in one <path>, a ring/annulus) using <path>
 * instead of <circle>. frame_bahrain.svg's ring is built exactly this
 * way: two subpaths (r=120 and r=100), combined via evenodd, form a
 * donut identical in effect to a stroked <circle>.
 *
 * A naive point+pad reading of these arcs is badly wrong: treating a
 * 120-radius arc's endpoint as "a point padded by its own 120-unit
 * radius" balloons the estimated reach to 240+ units. This function
 * instead recovers the *true* circle each subpath describes (center +
 * radius), the same way circleToContribution expects, so evenodd
 * ring-via-path gets exactly the same correct handling as a stroked
 * <circle> does.
 *
 * Returns null (falls back to generic point-based handling) for any
 * <path> that doesn't cleanly match "one M, exactly two same-radius
 * circular arcs, closing back to the start point" per subpath -- i.e.
 * this only ever recognizes the specific idiom above, never guesses.
 */
function tryDetectCircleDonutPath(d: string): { cx: number; cy: number; r: number }[] | null {
  const subpaths = d.trim().split(/(?=[Mm])/).map((s) => s.trim()).filter(Boolean)
  if (subpaths.length === 0) return null
  const circles: { cx: number; cy: number; r: number }[] = []

  for (const sub of subpaths) {
    const tokens = sub.match(/[MLQAZmlqaz][^MLQAZmlqaz]*/g) ?? []
    if (tokens.length < 3) return null

    const mTok = tokens[0]
    if (!mTok || mTok[0].toUpperCase() !== 'M') return null
    const mArgs = numbers(mTok.slice(1))
    if (mArgs.length < 2) return null
    const start = { x: mArgs[0], y: mArgs[1] }

    const rest = tokens.slice(1).filter((t) => t[0].toUpperCase() !== 'Z')
    if (rest.length !== 2) return null

    let cur = start
    let mid: { x: number; y: number } | null = null
    const radii: number[] = []

    for (let i = 0; i < 2; i++) {
      const tok = rest[i]
      const upper = tok[0].toUpperCase()
      if (upper !== 'A') return null
      const isRelative = tok[0] !== upper
      const args = numbers(tok.slice(1))
      if (args.length < 7) return null
      const rx = args[0], ry = args[1]
      if (Math.abs(rx - ry) > 0.5) return null // must be a circular (not elliptical) arc
      const ex = args[5], ey = args[6]
      const end = isRelative ? { x: cur.x + ex, y: cur.y + ey } : { x: ex, y: ey }
      radii.push(rx)
      if (i === 0) mid = end
      cur = end
    }
    if (!mid) return null

    const closeDist = Math.hypot(cur.x - start.x, cur.y - start.y)
    if (closeDist > 1) return null // two arcs didn't close back to start -> not a clean full circle
    if (Math.abs(radii[0] - radii[1]) > 0.5) return null

    const cx = (start.x + mid.x) / 2
    const cy = (start.y + mid.y) / 2
    const r = radii[0]
    // Sanity check: the start point should actually sit on this circle.
    if (Math.abs(Math.hypot(start.x - cx, start.y - cy) - r) > 1) return null

    circles.push({ cx, cy, r })
  }

  return circles.length > 0 ? circles : null
}

/** Resolves every <path> built from the circle-donut idiom (see
 * tryDetectCircleDonutPath) into proper annulus/disc contributions --
 * mirrors extractCircleContributions but for <circle>-equivalent <path>
 * elements. A path with fill-rule="evenodd" and exactly two concentric
 * detected circles becomes one annulus (rIn = smaller, rOut = larger,
 * matching what the evenodd subtraction actually paints); anything else
 * detected becomes one filled disc per circle found (still far more
 * accurate than the point+pad fallback). */
function extractPathCircleContributions(svg: string, originX: number, originY: number): RadialContribution[] {
  const contribs: RadialContribution[] = []
  for (const tag of svg.match(/<path\b[^>]*>/gi) ?? []) {
    const d = tag.match(/\sd\s*=\s*["']([^"']+)["']/)?.[1]
    if (!d) continue
    const detected = tryDetectCircleDonutPath(d)
    if (!detected) continue

    const isEvenodd = /fill-rule\s*=\s*["']evenodd["']/.test(tag)
    const rot = parseRotateTransform(tag)
    if (detected.length === 2 && isEvenodd) {
      const [a, b] = detected
      const centerDist = Math.hypot(a.cx - b.cx, a.cy - b.cy)
      if (centerDist < 1) {
        const rIn = Math.min(a.r, b.r)
        const rOut = Math.max(a.r, b.r)
        const center = rotatePoint((a.cx + b.cx) / 2, (a.cy + b.cy) / 2, rot)
        contribs.push(circleToContribution(center.x, center.y, rIn, rOut, originX, originY))
        continue
      }
    }
    for (const c of detected) {
      const center = rotatePoint(c.cx, c.cy, rot)
      contribs.push(circleToContribution(center.x, center.y, 0, c.r, originX, originY))
    }
  }
  return contribs
}

/** Extracts every <circle> tag's proper annulus/disc contribution, given
 * the already-known viewBox origin (circles need the origin up front,
 * unlike extractPoints's shapes, because the point-to-annulus formula
 * depends on distance-from-origin, not just the shape's own geometry). */
function extractCircleContributions(svg: string, originX: number, originY: number): RadialContribution[] {
  const contribs: RadialContribution[] = []
  for (const tag of svg.match(/<circle\b[^>]*>/gi) ?? []) {
    const cx = parseFloat(tag.match(/cx\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    const cy = parseFloat(tag.match(/cy\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    const r = parseFloat(tag.match(/\br\s*=\s*["']([^"']+)["']/)?.[1] ?? 'NaN')
    if ([cx, cy, r].some(Number.isNaN)) continue
    const sw = strokeWidthOf(tag)
    const rOut = r + sw / 2
    const rIn = isStrokedOnly(tag) ? Math.max(0, r - sw / 2) : 0
    const rot = parseRotateTransform(tag)
    const center = rotatePoint(cx, cy, rot)
    contribs.push(circleToContribution(center.x, center.y, rIn, rOut, originX, originY))
  }
  return contribs
}

export function validateFrameSvg(svg: string, sourceName = 'frame'): FrameValidationResult {
  const issues: FrameIssue[] = []

  const vb = parseViewBox(svg)
  if (!vb) {
    issues.push({ code: 'no-viewbox', severity: 'error', message: `${sourceName}: missing or unparsable viewBox attribute.` })
    return { valid: false, issues, minRadiusFound: null, maxRadiusFound: null, centroid: null }
  }

  if (Math.abs(vb.width - vb.height) > 0.01) {
    issues.push({
      code: 'canvas-ratio',
      severity: 'error',
      message: `${sourceName}: viewBox is ${vb.width}x${vb.height} -- canvas must be exactly square (1:1). Required: ${FRAME_CANVAS_SIZE}x${FRAME_CANVAS_SIZE}.`,
    })
  }
  if (Math.abs(vb.width - FRAME_CANVAS_SIZE) > 0.01) {
    issues.push({
      code: 'canvas-ratio',
      severity: 'error',
      message: `${sourceName}: viewBox size is ${vb.width} -- must be exactly FRAME_CANVAS_SIZE (${FRAME_CANVAS_SIZE}). No frame may define its own canvas size.`,
    })
  }
  // Size alone isn't enough -- a frame could keep a 240x240 viewBox but
  // shift its origin (e.g. "0 0 240 240" instead of "-20 -20 240 240"),
  // which would silently move CENTER away from (100,100) without ever
  // touching a number this validator would otherwise flag as "custom."
  // The origin is exactly as fixed as the size: it must always be
  // -FRAME_CANVAS_PADDING on both axes.
  if (Math.abs(vb.minX - -FRAME_CANVAS_PADDING) > 0.01 || Math.abs(vb.minY - -FRAME_CANVAS_PADDING) > 0.01) {
    issues.push({
      code: 'canvas-ratio',
      severity: 'error',
      message: `${sourceName}: viewBox origin is "${vb.minX} ${vb.minY}" -- must be exactly "-${FRAME_CANVAS_PADDING} -${FRAME_CANVAS_PADDING}" so CENTER lands on (100,100). No frame may define its own padding/offset.`,
    })
  }

  if (rootSvgHasSizeOverride(svg)) {
    issues.push({
      code: 'illegal-transform',
      severity: 'error',
      message: `${sourceName}: root <svg> has a width/height attribute -- only the shared viewBox may define the frame's canvas size. Remove width/height from the root element.`,
    })
  }

  for (const t of findIllegalTransforms(svg)) {
    issues.push({
      code: 'illegal-transform',
      severity: 'error',
      message: `${sourceName}: found ${t} -- scale/translate/matrix/skew transforms are never allowed (they're exactly how a frame would sneak in a custom radius/scale/offset). Only rotate(angle, cx, cy) is permitted, for orienting outward decoration.`,
    })
  }

  // Shift every point into CENTER-relative space: the SVG's local (0,0)
  // corresponds to (viewBox.minX, viewBox.minY); CENTER is defined
  // relative to the *photo*, whose own local origin is always
  // (viewBox.minX + FRAME_CANVAS_PADDING, viewBox.minY + FRAME_CANVAS_PADDING)
  // per the standard -- but since every frame's photo is centered in its
  // own viewBox by construction, the simplest and most robust check is
  // just: the photo center is the viewBox's own center.
  const originX = vb.minX + vb.width / 2
  const originY = vb.minY + vb.height / 2

  const rawPoints = extractPoints(svg, issues)
  const circleContribs = extractCircleContributions(svg, originX, originY)
  const pathCircleContribs = extractPathCircleContributions(svg, originX, originY)
  const contribs: RadialContribution[] = [
    ...rawPoints.map((p) => pointToContribution(p, originX, originY)),
    ...circleContribs,
    ...pathCircleContribs,
  ]

  if (contribs.length === 0) {
    issues.push({ code: 'parse-error', severity: 'warning', message: `${sourceName}: no recognizable shapes found -- nothing was validated.` })
    return { valid: issues.every((i) => i.severity !== 'error'), issues, minRadiusFound: null, maxRadiusFound: null, centroid: null }
  }

  let minRadius = Infinity
  let maxRadius = -Infinity
  let sumX = 0
  let sumY = 0

  for (const c of contribs) {
    if (c.rMin < minRadius) minRadius = c.rMin
    if (c.rMax > maxRadius) maxRadius = c.rMax
    sumX += c.x
    sumY += c.y
  }

  const centroid = { x: sumX / contribs.length, y: sumY / contribs.length }

  // 1. Overlap: nothing may render closer to CENTER than FRAME_INNER_RADIUS.
  if (minRadius < FRAME_INNER_RADIUS - VALIDATION.overlapToleranceUnits) {
    issues.push({
      code: 'overlap',
      severity: 'error',
      message: `${sourceName}: artwork reaches radius ${minRadius.toFixed(1)}, which is inside FRAME_INNER_RADIUS (${FRAME_INNER_RADIUS}) -- this will paint over the photo. Move it outward.`,
    })
  }

  // 2. Gap: something must actually touch FRAME_INNER_RADIUS -- otherwise
  // there's a visible transparent ring between the photo and the frame.
  if (minRadius > FRAME_INNER_RADIUS + VALIDATION.gapToleranceUnits) {
    issues.push({
      code: 'gap',
      severity: 'error',
      message: `${sourceName}: closest artwork is at radius ${minRadius.toFixed(1)}, which is ${(minRadius - FRAME_INNER_RADIUS).toFixed(1)} units outside FRAME_INNER_RADIUS (${FRAME_INNER_RADIUS}) -- this leaves a visible gap between the photo and the frame. Something must touch radius ${FRAME_INNER_RADIUS} exactly.`,
    })
  }

  // 3. Clipped: nothing may exceed the canvas's usable radius.
  if (maxRadius > FRAME_OUTER_RADIUS_MAX + VALIDATION.clipToleranceUnits) {
    issues.push({
      code: 'clipped',
      severity: 'error',
      message: `${sourceName}: artwork reaches radius ${maxRadius.toFixed(1)}, beyond FRAME_OUTER_RADIUS_MAX (${FRAME_OUTER_RADIUS_MAX}) -- it will be clipped by the canvas edge (or clipped by Avatar.tsx's overhang container). Pull it inward or reduce its size.`,
    })
  }

  // 4. Centered: the shape centroid shouldn't drift from CENTER.
  const centroidDx = centroid.x - originX
  const centroidDy = centroid.y - originY
  const centroidDrift = Math.sqrt(centroidDx * centroidDx + centroidDy * centroidDy)
  if (centroidDrift > FRAME_INNER_RADIUS * VALIDATION.centeringToleranceRatio) {
    issues.push({
      code: 'not-centered',
      severity: 'error',
      message: `${sourceName}: artwork's centroid drifts ${centroidDrift.toFixed(1)} units from center -- frame is not symmetric/centered on the photo.`,
    })
  }

  const valid = issues.every((i) => i.severity !== 'error')
  return { valid, issues, minRadiusFound: minRadius, maxRadiusFound: maxRadius, centroid }
}

/** Small helper re-exported for callers that already have CENTER handy
 * and want to sanity-check a single point without building a full SVG. */
export function distanceFromCenter(x: number, y: number): number {
  return Math.sqrt((x - CENTER) ** 2 + (y - CENTER) ** 2)
}
