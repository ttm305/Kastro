// @vitest-environment jsdom
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import Avatar from './Avatar'
import { frameAvatarStyle } from '../lib/cosmetics'
import type { CosmeticItem } from '../lib/api'

// =============================================================================
// Regression test: "the latest implementation broke the default avatar
// state" -- reported as an unwanted black ring on Profile and an unwanted
// blue ring on Home when no frame is equipped.
//
// This renders the REAL <Avatar> component (via React Testing Library, in
// a real jsdom DOM) for the three required states and asserts on the
// actual rendered DOM, not a hand-drawn approximation of it:
//   1. no frame equipped      -> pixel-identical to the original clean avatar
//   2. Solar Frame equipped   -> the existing correct CSS-ring look
//   3. a custom frame equipped -> Solar's exact photo geometry, decoration
//                                  only extends outward (Avatar.tsx's
//                                  FRAME_OVERHANG_SCALE architecture)
// =============================================================================

const solarFrame: CosmeticItem = {
  id: 'frame_solar',
  type: 'frame',
  label: 'Solar Frame',
  style: { ring: '#ffd700', glow: true },
  image_url: null,
} as unknown as CosmeticItem

const customFrame: CosmeticItem = {
  id: 'frame_bahrain',
  type: 'frame',
  label: 'Bahrain Ring',
  style: {},
  image_url: 'https://example.com/frame_bahrain.svg',
} as unknown as CosmeticItem

describe('<Avatar> -- default (unframed) state', () => {
  it('renders with no border and no boxShadow when no frame is equipped', () => {
    const { container } = render(<Avatar url={null} size={64} style={frameAvatarStyle(null)} frame={null} />)
    const inner = container.firstElementChild as HTMLElement
    expect(inner.style.border).toBe('')
    expect(inner.style.boxShadow).toBe('')
  })

  it('renders no frame overlay <img> when no frame is equipped', () => {
    const { container } = render(<Avatar url={null} size={64} style={frameAvatarStyle(null)} frame={null} />)
    expect(container.querySelector('img[aria-hidden="true"]')).toBeNull()
  })

  it('does not apply any decoration/effect/indicator layer when none is passed', () => {
    const { container } = render(<Avatar url={null} size={64} style={frameAvatarStyle(null)} frame={null} />)
    // No frame, no effect, no indicator -> Avatar takes the simple
    // single-div render path (see Avatar.tsx's `if (!frameOverlayUrl && !effect && !indicator)` branch).
    expect(container.children.length).toBe(1)
  })
})

describe('<Avatar> -- Solar Frame equipped', () => {
  it('renders the existing correct CSS ring (no overlay <img>, no overhang container)', () => {
    const { container } = render(<Avatar url={null} size={64} style={frameAvatarStyle(solarFrame)} frame={solarFrame} />)
    expect(container.querySelector('img[aria-hidden="true"]')).toBeNull()
    const inner = container.firstElementChild as HTMLElement
    expect(inner.style.border).toBe('3px solid #ffd700')
    expect(inner.style.boxShadow).toContain('#ffd70088')
  })
})

describe('<Avatar> -- custom SVG-overlay frame equipped', () => {
  it('keeps the photo at the full avatar size (Solar geometry) with no border of its own', () => {
    const { container } = render(<Avatar url={null} size={64} style={frameAvatarStyle(customFrame)} frame={customFrame} />)
    const photoLayer = container.querySelector('div > div') as HTMLElement
    expect(photoLayer.style.width).toBe('64px')
    expect(photoLayer.style.height).toBe('64px')
    expect(photoLayer.style.border).toBe('none')
  })

  it('renders the frame overlay <img> sized via FRAME_OVERHANG_SCALE only (no per-frame custom scale)', () => {
    const { container } = render(<Avatar url={null} size={64} style={frameAvatarStyle(customFrame)} frame={customFrame} />)
    const overlay = container.querySelector('img[aria-hidden="true"]') as HTMLImageElement
    expect(overlay).not.toBeNull()
    expect(overlay.getAttribute('src')).toBe(customFrame.image_url)
    expect(overlay.style.width).toBe('120%')
    expect(overlay.style.height).toBe('120%')
  })
})
