import type { CSSProperties } from 'react'
import { BUILTIN_AVATARS } from '../lib/api'

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
  style?: CSSProperties
}

/**
 * Renders a user's avatar consistently everywhere it appears (Profile,
 * Home, Leaderboard, Friends, Tournament, Admin). Three states:
 *  - real Storage URL → circular <img>, cover-cropped
 *  - "builtin:<id>" → the matching gradient preset with a person icon
 *  - null/unrecognized → the original generic gradient placeholder, so
 *    every screen that never had avatars before still looks the same.
 */
export default function Avatar({ url, size, alt = '', className, style }: AvatarProps) {
  const base: CSSProperties = {
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

  if (url && !url.startsWith('builtin:') && (url.startsWith('http://') || url.startsWith('https://'))) {
    return (
      <div className={className} style={base}>
        <img
          src={url}
          alt={alt}
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    )
  }

  const builtinId = url?.startsWith('builtin:') ? url.slice('builtin:'.length) : null
  const preset = builtinId ? BUILTIN_AVATARS.find((a) => a.id === builtinId) : null
  const gradient = preset?.gradient ?? DEFAULT_GRADIENT

  return (
    <div className={className} style={{ ...base, background: gradient }}>
      <PersonSilhouette size={size} />
    </div>
  )
}
