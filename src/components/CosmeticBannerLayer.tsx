import { useEffect, useRef, useState } from 'react'
import type { CosmeticItem } from '../lib/api'
import { bannerBackground } from '../lib/cosmetics'

interface Props {
  /** The equipped banner cosmetic (or null — renders the fallback gradient). */
  banner: CosmeticItem | null
  /** CSS gradient used when there's no banner, or as the last-resort fallback
   * if a video/image asset fails to load. */
  fallbackGradient: string
}

const FILL: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  objectFit: 'cover',
}

/**
 * Renders an equipped banner/header cosmetic as an absolutely-positioned
 * layer that fills its parent (parent must be position:relative + overflow
 * hidden, same as the existing custom-header-photo layer this sits next to
 * on every profile-surface screen).
 *
 * Three render paths, in priority order:
 *   1. is_animated + video_url + poster_url -> real <video> loop (the fix
 *      for "items labeled Animated were completely static" — previously
 *      style.animated was a dead JSON flag nothing ever read).
 *   2. image_url only -> static <img>.
 *   3. Neither -> the existing CSS gradient (bannerBackground), unchanged
 *      behavior for every non-animated banner already in the shop.
 *
 * If the video fails to load/decode, it falls back to poster_url (or the
 * gradient if there's no poster) instead of leaving a broken/blank area.
 */
export default function CosmeticBannerLayer({ banner, fallbackGradient }: Props) {
  const [videoFailed, setVideoFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const isIntersectingRef = useRef(true)

  const canPlayVideo = !!(banner?.is_animated && banner.video_url && banner.poster_url && !videoFailed)

  // Reset the failure flag whenever the equipped banner changes (e.g. the
  // player equips a different animated item) so a previous failure doesn't
  // permanently block a different, valid video.
  useEffect(() => { setVideoFailed(false) }, [banner?.id])

  // Battery/perf: pause the loop while it's scrolled off-screen, resume when
  // it's back in view. Also resume on tab/app foreground — iOS Safari and
  // backgrounded tabs both silently pause <video>, and autoplay alone won't
  // restart it without an explicit play() call from a user-visible context.
  useEffect(() => {
    if (!canPlayVideo) return
    const videoEl = videoRef.current
    const wrapEl = wrapRef.current
    if (!videoEl || !wrapEl) return

    // Some older iOS Safari versions only honor the legacy attribute name;
    // React's `playsInline` prop covers modern Safari/Chrome/Firefox already.
    videoEl.setAttribute('webkit-playsinline', 'true')

    const observer = new IntersectionObserver(
      ([entry]) => {
        isIntersectingRef.current = entry.isIntersecting
        if (entry.isIntersecting) {
          videoEl.play().catch(() => { /* autoplay may be blocked until user interaction; harmless */ })
        } else {
          videoEl.pause()
        }
      },
      { threshold: 0.1 },
    )
    observer.observe(wrapEl)

    const onVisibility = () => {
      if (document.visibilityState === 'visible' && isIntersectingRef.current) {
        videoEl.play().catch(() => {})
      }
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [canPlayVideo, banner?.video_url])

  if (canPlayVideo) {
    return (
      <div ref={wrapRef} style={{ position: 'absolute', inset: 0 }}>
        <video
          ref={videoRef}
          src={banner!.video_url!}
          poster={banner!.poster_url!}
          autoPlay
          muted
          loop
          playsInline
          preload="metadata"
          disablePictureInPicture
          disableRemotePlayback
          controls={false}
          style={FILL}
          onError={() => setVideoFailed(true)}
        />
      </div>
    )
  }

  const imageUrl = banner?.image_url || (banner?.is_animated ? banner?.poster_url : null)
  if (imageUrl) {
    return <img src={imageUrl} alt="" style={FILL} onError={(e) => { e.currentTarget.style.display = 'none' }} />
  }

  return <div style={{ position: 'absolute', inset: 0, background: bannerBackground(banner, fallbackGradient) }} />
}
