# Avatar Frame Standard

This is the permanent, non-negotiable geometry standard for every avatar frame in KASTRO — current and future. It exists because every earlier version of this feature broke one of two rules: frame artwork painted over the user's photo, or a visible gap appeared between the photo and the frame. Both are now structurally impossible if this document (and the tooling it describes) is followed.

**Solar Frame is the reference.** Every number below is derived from Solar Frame's actual rendering — a plain CSS ring drawn directly on the full-size avatar photo, with zero shrink and zero gap. Every other frame must reproduce that same relationship between "where the photo is" and "where the frame starts," exactly, using shared constants instead of frame-specific numbers.

## The exact measurements

All frame SVGs are authored in one shared coordinate space, defined in [`src/lib/avatarFrameStandard.ts`](src/lib/avatarFrameStandard.ts):

| Constant | Value | Meaning |
|---|---|---|
| `AVATAR_DIAMETER` | 200 | The photo's diameter, in SVG units. This *is* Solar Frame's photo size — the avatar box, unscaled. |
| `PHOTO_RADIUS` | 100 | Half of the above. The photo's true, immovable edge. |
| `FRAME_INNER_RADIUS` | 100 | Where a frame's own artwork must begin. Always equals `PHOTO_RADIUS` — there is no such thing as a frame-specific inner radius. |
| `FRAME_OVERHANG` | 1.2 | How much larger the frame's render container is than the avatar box. This is the only thing that gives decoration room — the photo itself never resizes. |
| `FRAME_OUTER_RADIUS_MAX` | 120 | `PHOTO_RADIUS * FRAME_OVERHANG`. The furthest out any artwork may reach before risking clipping. |
| `FRAME_CANVAS_SIZE` | 240 | `AVATAR_DIAMETER * FRAME_OVERHANG`. Every frame SVG's `viewBox` must be exactly this size, square. |
| `FRAME_CANVAS_PADDING` | 20 | Padding added to each side to go from `AVATAR_DIAMETER` to `FRAME_CANVAS_SIZE`. This is why every frame's `viewBox` is `-20 -20 240 240`. |
| `CENTER` | 100 | Every frame's artwork must be centered on this point (in photo-relative coordinates). |

In plain terms: **gap = 0, inward overlap = 0, decoration only extends outward from radius 100 to at most radius 120.** These aren't goals to approximate — they're checked by an automated tool (below) that fails the build if violated.

### No per-frame geometry overrides — ever

**No individual frame may define its own radius, scale, padding, offset, transform, or overhang.** Every number that describes geometry — canvas size, canvas origin, inner radius, outer budget, overhang ratio — comes from `avatarFrameStandard.ts` and only from there. A frame SVG is allowed to differ from every other frame in exactly one respect: its artwork (colors, ornament shapes, gradients). If a frame "needs" a different radius, scale, or offset to look right, the frame is wrong, not the standard — the fix is to change the artwork so it fits the fixed geometry, never to add a geometry override.

This is enforced structurally, not just by convention. The validator rejects a frame outright if:

- its viewBox origin isn't exactly `-20 -20` (`-FRAME_CANVAS_PADDING` on both axes) — a frame cannot shift its own canvas to fake a different center;
- its viewBox size isn't exactly `240 240` (`FRAME_CANVAS_SIZE`) — a frame cannot resize its own canvas;
- the root `<svg>` carries a `width` or `height` attribute — those would rescale the whole frame independent of viewBox, a second way to sneak in a custom scale;
- any element anywhere uses `scale()`, `translate()`, `matrix()`, `skewX()`, or `skewY()` — the only transform a frame may ever use is `rotate(angle, cx, cy)`, and only to orient outward decoration (it cannot resize or reposition geometry relative to CENTER).

A new frame that requires changing any of the above is, by definition, invalid — it must fail validation rather than be accommodated with a special case.

## How this is enforced at runtime

The photo is never resized for any frame — [`Avatar.tsx`](src/components/Avatar.tsx) always renders the photo at the full avatar box size, identical to Solar Frame. A frame's `<img>` overlay is rendered at `size * FRAME_OVERHANG` (imported directly from `avatarFrameStandard.ts`, not redefined locally), absolutely centered over the same box, with the avatar's outer wrapper set to `overflow: visible`. This means the frame image can only ever draw *outside* the photo's footprint — there is no code path that lets a frame shrink, offset, or rescale the photo. Every screen that renders an avatar (Profile, Home, Leaderboard, Friends, Lobby, Admin, Shop preview, chat) goes through this one shared component; nothing hand-rolls its own frame positioning.

## SVG authoring rules

Every frame SVG must:

1. Use `viewBox="-20 -20 240 240"` — exactly `FRAME_CANVAS_SIZE` (240×240), square (1:1).
2. Be centered on `(100, 100)` — the photo's center in this coordinate space.
3. Keep every filled/stroked shape's closest point to `(100,100)` at radius ≥ 100. Nothing may render at a smaller radius — that's the photo area.
4. Have *something* whose inner edge sits at (or very close to) radius 100 — otherwise there's a visible transparent gap between the photo and the frame's decoration.
5. Keep every shape's farthest point at radius ≤ 120. Beyond that risks being clipped by the canvas edge or by `Avatar.tsx`'s overhang container.
6. Never define a custom size, inner radius, offset, or scale. If a frame "needs" one, the fix is to change the outward decoration, never the geometry.

### The two correct ways to build the base ring

**A stroked `<circle>`** (most frames use this): pick a `stroke-width`, then set `r = 100 + stroke-width / 2` so the inner edge lands exactly on 100. Example (`stroke-width="14"`, so `r="107.0"`):

```xml
<circle cx="100" cy="100" r="107.0" fill="none" stroke="url(#ring)" stroke-width="14"/>
```

**An evenodd donut via `<path>`** (`frame_bahrain.svg` uses this, for a flag-accurate ring): two circular subpaths — one at `r=120`, one at `r=100` — combined with `fill-rule="evenodd"` to punch out the inner disc:

```xml
<path fill-rule="evenodd" fill="#DA291C" d="
  M -20,100 a 120,120 0 1,0 240,0 a 120,120 0 1,0 -240,0 Z
  M 0,100 a 100,100 0 1,1 200,0 a 100,100 0 1,1 -200,0 Z
"/>
```

Both are recognized and correctly validated by `frameValidator.ts` — don't invent a third way without extending the validator first (see its `unsupported-path-command` warning).

### Outward decoration

Petals, gems, dots, serrations, laurel leaves, sparks — anything ornamental — must stay within `[100, 120]`. The standard pattern for repeating an ornament around the ring is: author it once, then give each copy `transform="rotate(angle cx cy)"` where `(cx, cy)` is **that copy's own final position on the ring** (or, if every copy shares one base shape, the ring's true center `(100,100)`) — never a mismatched pivot. Getting this wrong is a real bug class, not a hypothetical one: an earlier version of `frame_fire_elemental.svg` rotated all 14 flame petals around one petal's own point instead of the ring center, which silently clustered every petal at a single spot on the ring instead of surrounding it. The validator's centering check exists specifically to catch this.

### Transparent-center rule

The area inside radius 100 must be fully transparent in every frame SVG. Never fill it, even faintly, even with `opacity`. The photo underneath is what shows there — a frame draws only the ring and outward from it.

## Naming rules

- File: `src/assets/frames/frame_<id>.svg`, where `<id>` matches the cosmetic's database `id` (e.g. `frame_solar`, `frame_bahrain`).
- Gradient/pattern `<defs>` ids should be short and namespaced per frame (e.g. `#mtring` for Mythic Realm) to avoid collisions when multiple frame SVGs are inlined on the same page.
- `TEMPLATE.svg` is the starting point for new frames — copy it, don't reference it directly as a real frame (it's excluded from the validation script on purpose, see below).

## Validation

Run:

```
npm run validate:frames
```

(or `pnpm validate:frames`, same script) — a standalone script at [`scripts/validate-frames.ts`](scripts/validate-frames.ts) that checks every `*.svg` in `src/assets/frames/` (except `TEMPLATE.svg`) against this standard and exits non-zero if anything fails. It's also wired into `npm run build`, so a broken frame **cannot** reach a deployed build — `"build": "npm run validate:frames && tsc -b && vite build"`.

The validator (in [`src/lib/frameValidator.ts`](src/lib/frameValidator.ts)) rejects a frame when:

- **artwork enters the photo area** — any shape's closest point to center is below `FRAME_INNER_RADIUS` (`overlap`)
- **a visible gap exists** — nothing comes within 2 units of `FRAME_INNER_RADIUS`, meaning there's a transparent ring between the photo and the decoration (`gap`)
- **the frame is not centered** — the artwork's centroid drifts more than 3% of `PHOTO_RADIUS` from `CENTER` (`not-centered`)
- **the canvas ratio is not 1:1**, isn't exactly `FRAME_CANVAS_SIZE`, or its origin isn't exactly `-FRAME_CANVAS_PADDING` on both axes (`canvas-ratio`)
- **ornaments are clipped** — any shape's farthest point exceeds `FRAME_OUTER_RADIUS_MAX` (`clipped`)
- **a per-frame geometry override is present** — a `scale()`/`translate()`/`matrix()`/`skewX()`/`skewY()` transform anywhere, or a `width`/`height` attribute on the root `<svg>` (`illegal-transform`)

It understands `<circle>`, `<ellipse>`, `<line>`, `<polygon>`, `<path>` (M/L/Q/A/Z commands, plus the evenodd-donut idiom above), and per-element `rotate(angle, cx, cy)` transforms — it actually applies rotation math rather than reading raw pre-transform coordinates, which is what caught the fire-elemental petal-clustering bug during this standard's rollout. Any `<path>` command it doesn't understand (C/S/T/H/V) produces a `unsupported-path-command` **warning** rather than a silent pass — a warning means "a human should look at this," not "this is fine."

### Example: correct frame

`frame_cute_cozy.svg` — ring `r="107.0"` with `stroke-width="14"` (inner edge exactly 100), 12 dots at radius 116 with `r="4.2"` (reaching 120.2, comfortably inside budget). Validates clean: `min radius 100.0, max radius 120.2`.

### Examples: incorrect frames (from this standard's own rollout — all now fixed)

- **Inward overlap**: an early version of the frame system placed a ring's *outer* edge flush with the photo, but the stroke width meant the ring's paint still extended inward past radius 100 — pixels literally drawn over the photo. Fixed by computing `r = 100 + stroke-width/2` so the *inner* edge (not a visual approximation of it) lands on 100.
- **Visible gap**: several frames (`frame_mythic_realm`, `frame_nature_weather`, `frame_space_celestial`) had their base ring's radius left at `107.0` after their `stroke-width` was changed from 14 to something thinner (6 or 8) for visual variety, without recomputing `r` — leaving a 3–4 unit transparent gap between the photo and the ring. Fixed by recomputing `r` for each ring's actual stroke width.
- **Wrong rotation pivot**: `frame_fire_elemental.svg`'s 14 flame petals all used `transform="rotate(angle, 214, 100)"` — rotating each petal around *that specific petal's own coordinate* instead of the ring's center `(100,100)`. Every petal ended up clustered near the 3 o'clock position instead of surrounding the ring. Fixed by using the ring's true center as the pivot.
- **Exceeding the outer budget**: `frame_mythic_realm`'s gem ring and `frame_nature_weather`/`frame_royal_luxury`'s petal rings originally reached radius 122–125.5, past the `FRAME_OUTER_RADIUS_MAX` of 120. Fixed by pulling the ornament ring inward (and, for wizard_school's sparkle dots, slightly shrinking dot radius) until every shape's farthest point cleared the budget.

## Adding a new frame

1. Copy [`src/assets/frames/TEMPLATE.svg`](src/assets/frames/TEMPLATE.svg) to `src/assets/frames/frame_<id>.svg`.
2. Change only the gradient colors and the outward decoration. Leave the `viewBox`, the ring's `r`/`stroke-width` relationship, and the center point untouched.
3. Run `npm run validate:frames`. Fix whatever it flags — don't loosen a tolerance to make it pass.
4. Add the row to `cosmetic_items` with `image_url`/`thumbnail_url` pointing at the new asset. No frontend code changes are needed — `Avatar.tsx` and every screen that renders it already handle any frame with an `image_url` automatically, using the shared constants.

No frame may define its own avatar size, inner radius, offset, or scale. If you find yourself wanting to, the geometry belongs in `avatarFrameStandard.ts`, applied to every frame — not bolted onto one.
