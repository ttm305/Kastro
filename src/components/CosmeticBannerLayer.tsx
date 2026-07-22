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
 * Four render paths, in priority order:
 *   1. is_animated + media_type='animated_svg' + image_url + poster_url ->
 *      the SVG markup is inlined directly into the DOM (not used as an
 *      <img src>) so its embedded CSS @keyframes actually run AND so this
 *      component can pause them the same way it pauses <video>: toggling a
 *      wrapper class that flips `animation-play-state` off/on via
 *      IntersectionObserver + document visibilitychange. This is a real,
 *      visibly-moving asset — not a gradient or static SVG mislabeled as
 *      animated.
 *   2. is_animated + video_url + poster_url -> real <video> loop.
 *   3. image_url only -> static <img>.
 *   4. Neither -> the existing CSS gradient (bannerBackground), unchanged
 *      behavior for every non-animated banner already in the shop.
 *
 * If the video fails to load/decode, it falls back to poster_url (or the
 * gradient if there's no poster) instead of leaving a broken/blank area.
 *
 * Respects `prefers-reduced-motion: reduce` — when set, neither the video
 * nor the animated SVG ever plays (not even a single autoplay frame) and
 * the static poster image is shown instead. Tracked live via a matchMedia
 * listener so toggling the OS setting while the app is open takes effect
 * immediately, no reload required. (The animated-SVG markup also carries
 * its own `@media (prefers-reduced-motion: reduce)` rule as a second,
 * independent guard.)
 */
export default function CosmeticBannerLayer({ banner, fallbackGradient }: Props) {
  const [videoFailed, setVideoFailed] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(
    () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
  )
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgWrapRef = useRef<HTMLDivElement | null>(null)
  const isIntersectingRef = useRef(true)

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const onChange = () => setReducedMotion(mq.matches)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [])

  const canPlaySvg = !!(
    banner?.is_animated && banner.media_type === 'animated_svg' && banner.image_url && banner.poster_url && !reducedMotion
  )
  const canPlayVideo = !!(
    !canPlaySvg && banner?.is_animated && banner.media_type === 'video' && banner.video_url && banner.poster_url && !videoFailed && !reducedMotion
  )

  // Pause/resume the inline animated SVG the same way the video below is
  // paused: off-screen (IntersectionObserver) and app-backgrounded
  // (visibilitychange). The SVG's own CSS listens for the
  // `.careerxp-anim-paused` class on this wrapper (see the markup generated
  // for banner_bahrain_waving) and sets `animation-play-state: paused`.
  useEffect(() => {
    if (!canPlaySvg) return
    const el = svgWrapRef.current
    if (!el) return

    const setPaused = (paused: boolean) => el.classList.toggle('careerxp-anim-paused', paused)

    const observer = new IntersectionObserver(
      ([entry]) => {
        isIntersectingRef.current = entry.isIntersecting
        setPaused(!entry.isIntersecting || document.visibilityState !== 'visible')
      },
      { threshold: 0.1 },
    )
    observer.observe(el)

    const onVisibility = () => {
      setPaused(document.visibilityState !== 'visible' || !isIntersectingRef.current)
    }
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [canPlaySvg, banner?.image_url])

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

  if (canPlaySvg) {
    return (
      <div
        ref={svgWrapRef}
        style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
        // The markup here is authored entirely by us (seeded via migration
        // into cosmetic_items.image_url for media_type='animated_svg' rows
        // — never user-submitted), which is why inlining it is safe. It has
        // to be inlined rather than used as <img src> so its embedded CSS
        // @keyframes actually run and can be paused via the class above.
        dangerouslySetInnerHTML={{ __html: banner!.image_url! }}
      />
    )
  }

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

  // For 'animated_svg' items, `image_url` holds raw <svg> markup (not a
  // loadable URL) — it's only valid via the inline dangerouslySetInnerHTML
  // path above. If that path isn't active (reduced motion, or the item
  // failed the canPlaySvg checks), fall back to the real static poster
  // image instead of trying to point an <img> at raw markup text.
  const imageUrl =
    banner?.media_type === 'animated_svg'
      ? banner?.poster_url ?? null
      : banner?.image_url || (banner?.is_animated ? banner?.poster_url : null)
  if (imageUrl) {
    return <img src={imageUrl} alt="" style={FILL} onError={(e) => { e.currentTarget.style.display = 'none' }} />
  }

  return <div style={{ position: 'absolute', inset: 0, background: bannerBackground(banner, fallbackGradient) }} />
}
