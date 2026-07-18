import { touchPresence, markOffline } from './api'
import { diagLog } from './diagnostics'

/**
 * Real, live presence heartbeat — the actual fix for "Friends screen shows
 * accounts as Online even though those users have completely closed the
 * app." See 20260718080000_fix_live_presence.sql for the server-side half
 * (get_presence() computing is_online from last_seen_at freshness instead
 * of trusting a stored boolean forever).
 *
 * Root cause this replaces: touch_presence()/mark_offline() (both fully
 * correct, already-versioned RPCs) had zero call sites anywhere in the
 * frontend before this file existed — is_online was only ever set once, at
 * login (via the separate record_login RPC in auth.tsx, untouched here),
 * and then never updated again short of an explicit Sign Out. This module
 * is what actually calls the heartbeat RPCs, on every lifecycle signal the
 * bug report asked for:
 *   - a 20s interval while the tab/app is visible (short enough that the
 *     45s server-side freshness window in get_presence() tolerates one
 *     missed beat without flapping, but still reads as "genuinely live")
 *   - visibilitychange: immediately re-beat on becoming visible; immediately
 *     mark offline on becoming hidden (per the explicit requirement "the
 *     user should become Online only while the app is actively open and
 *     visible" — backgrounding is treated the same as closing, not as a
 *     grace-period case)
 *   - pagehide (the reliable "actually navigating away/closing" signal on
 *     iOS Safari and installed PWAs, unlike beforeunload) and beforeunload
 *     where it fires
 *   - the 'offline' network event: stop trying to beat (there's no
 *     connection to reach the server with) and let the server-side
 *     staleness window take over instead of erroring in a retry loop
 *   - the 'online' network event: resume immediately if still visible
 *
 * Every call here is best-effort/fire-and-forget by design (a presence
 * ping must never throw into the rest of the app or block navigation) —
 * but every one is also run through diagLog so a failure is still visible
 * in the temporary diagnostics panel while this is being tested, instead
 * of silently vanishing into a swallowed promise.
 */
const HEARTBEAT_INTERVAL_MS = 20000

export function startPresenceHeartbeat(): () => void {
  let intervalId: number | null = null

  const beat = () => {
    touchPresence()
      .then(() => diagLog('presence', 'touch_presence ok'))
      .catch((err) => diagLog('presence', 'touch_presence FAILED', { error: String(err) }))
  }

  const goOffline = () => {
    markOffline()
      .then(() => diagLog('presence', 'mark_offline ok'))
      .catch((err) => diagLog('presence', 'mark_offline FAILED', { error: String(err) }))
  }

  const startInterval = () => {
    if (intervalId !== null) return
    intervalId = window.setInterval(beat, HEARTBEAT_INTERVAL_MS)
  }
  const stopInterval = () => {
    if (intervalId !== null) { window.clearInterval(intervalId); intervalId = null }
  }

  const onVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      diagLog('presence', 'visible → beat + resume interval')
      beat()
      startInterval()
    } else {
      diagLog('presence', 'hidden → mark offline + pause interval')
      stopInterval()
      goOffline()
    }
  }

  const onPageHide = () => { diagLog('presence', 'pagehide → mark offline'); stopInterval(); goOffline() }
  const onBeforeUnload = () => { goOffline() }
  const onOffline = () => { diagLog('presence', 'network offline → pause interval (staleness window takes over)'); stopInterval() }
  const onOnline = () => {
    if (document.visibilityState === 'visible') {
      diagLog('presence', 'network online → beat + resume interval')
      beat()
      startInterval()
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', onPageHide)
  window.addEventListener('beforeunload', onBeforeUnload)
  window.addEventListener('offline', onOffline)
  window.addEventListener('online', onOnline)

  // Kick off immediately on mount (session already established by the time
  // App.tsx wires this up).
  beat()
  if (document.visibilityState === 'visible') startInterval()

  return () => {
    stopInterval()
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', onPageHide)
    window.removeEventListener('beforeunload', onBeforeUnload)
    window.removeEventListener('offline', onOffline)
    window.removeEventListener('online', onOnline)
  }
}
