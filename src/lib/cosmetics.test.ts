import { describe, expect, it } from 'vitest'
import { frameAvatarStyle, resolveCosmetics } from './cosmetics'
import type { CosmeticItem } from './api'

// =============================================================================
// Regression test for "default avatar shows an unwanted black/blue ring"
// (reported against ProfileScreen and HomeScreen). Root cause: this file's
// frameAvatarStyle() used to unconditionally return `{ border: baseBorder }`
// even when no frame was equipped, so every call site's own baseBorder
// argument (e.g. '3px solid var(--background)' on Profile, which renders
// as a near-black ring in dark mode) always painted a ring — the cosmetic
// frame system was never actually opt-in.
//
// The fix: frameAvatarStyle(frame) with no second argument returns `{}`
// (no border, no boxShadow, nothing) whenever there's no equipped frame or
// the equipped frame has no `style.ring`. `baseBorder` is now optional and
// reserved for the one legitimate non-cosmetic use (GameLobbyScreen's
// ready/not-ready indicator, which must always show regardless of frame).
// =============================================================================

const solarFrame: CosmeticItem = {
  id: 'frame_solar',
  type: 'frame',
  label: 'Solar Frame',
  style: { ring: '#ffd700', glow: true },
  image_url: null,
} as unknown as CosmeticItem

const imageOverlayFrame: CosmeticItem = {
  id: 'frame_bahrain',
  type: 'frame',
  label: 'Bahrain Ring',
  style: {},
  image_url: 'https://example.com/frame_bahrain.svg',
} as unknown as CosmeticItem

describe('frameAvatarStyle -- opt-in cosmetic frame system', () => {
  it('no frame equipped -> returns a completely empty style (zero ring)', () => {
    expect(frameAvatarStyle(null)).toEqual({})
  })

  it('no frame equipped, called with no baseBorder -> still empty, never falls back to a default ring', () => {
    // This is the exact regression: a caller must NOT be able to get a
    // border out of this function just by omitting/misusing arguments.
    expect(frameAvatarStyle(null, undefined)).toEqual({})
  })

  it('an equipped frame with no ring style (e.g. malformed catalog row) -> still empty, not a fabricated ring', () => {
    const brokenFrame = { ...solarFrame, style: {} } as CosmeticItem
    expect(frameAvatarStyle(brokenFrame)).toEqual({})
  })

  it('Solar Frame (style.ring set) -> the existing correct ring look, unaffected by the fix', () => {
    const result = frameAvatarStyle(solarFrame)
    expect(result.border).toBe('3px solid #ffd700')
    expect(result.boxShadow).toBe('0 0 14px #ffd70088')
  })

  it('image-overlay custom frame (no style.ring) -> also empty; Avatar.tsx alone is responsible for drawing its ring', () => {
    expect(frameAvatarStyle(imageOverlayFrame)).toEqual({})
  })

  it('baseBorder is only honored when there is truly no ring to show, and only if a caller explicitly opts into it (GameLobbyScreen readiness indicator)', () => {
    expect(frameAvatarStyle(null, '2px solid #10b981')).toEqual({ border: '2px solid #10b981' })
  })

  it('a real ring always wins over a caller-supplied baseBorder', () => {
    const result = frameAvatarStyle(solarFrame, '2px solid #10b981')
    expect(result.border).toBe('3px solid #ffd700')
  })
})

describe('resolveCosmetics -- never fabricates a fallback frame', () => {
  const catalog: CosmeticItem[] = [solarFrame, imageOverlayFrame]

  it('null equipped_frame_id -> frame is null, never defaults to Solar Frame or the first catalog item', () => {
    const resolved = resolveCosmetics(catalog, { equipped_frame_id: null })
    expect(resolved.frame).toBeNull()
  })

  it('undefined equipped_frame_id -> frame is null', () => {
    const resolved = resolveCosmetics(catalog, {})
    expect(resolved.frame).toBeNull()
  })

  it('equipped_frame_id pointing at a removed/unknown item -> frame is null, not a guess', () => {
    const resolved = resolveCosmetics(catalog, { equipped_frame_id: 'frame_does_not_exist' })
    expect(resolved.frame).toBeNull()
  })

  it('a real equipped_frame_id resolves to that exact catalog item', () => {
    const resolved = resolveCosmetics(catalog, { equipped_frame_id: 'frame_solar' })
    expect(resolved.frame?.id).toBe('frame_solar')
  })
})
