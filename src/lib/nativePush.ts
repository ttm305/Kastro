// Native push notifications for a Capacitor-wrapped iOS/Android build.
// Parallel to src/lib/push.ts (Web Push/VAPID, used by plain browser tabs
// and installed PWAs) — the two are mutually exclusive at runtime via
// isNativePlatform() and never both active for the same session, but both
// register against the same server-side notification pipeline
// (send_message() -> private.send_push_for_new_message() -> send-push
// Edge Function), just into different tables (native_push_tokens vs.
// push_subscriptions).
//
// @capacitor/core ships a web-safe implementation — Capacitor.isNativePlatform()
// correctly returns false in a plain browser tab too, so importing this
// module is always safe; it's the *calls into it* (register(), etc.) that
// are native-only and guarded below.
import { Capacitor } from '@capacitor/core'
import { PushNotifications, type ActionPerformed } from '@capacitor/push-notifications'
import { registerNativePushToken, unregisterNativePushToken } from './api'

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform()
  } catch {
    return false
  }
}

function currentPlatform(): 'ios' | 'android' | null {
  try {
    const p = Capacitor.getPlatform()
    return p === 'ios' || p === 'android' ? p : null
  } catch {
    return null
  }
}

// The most recently registered token this session, kept only so
// disableNativePush() can unregister the exact same value without a
// server round-trip to look it up first.
let lastToken: string | null = null

/**
 * Requests permission (if not already decided) and registers this device
 * for native push, wiring the resulting token to the server. Mirrors
 * enablePush() in src/lib/push.ts — same return shape, same
 * never-throws contract. No-ops with `unsupported` outside a native
 * Capacitor build.
 */
export async function enableNativePush(): Promise<{ error: string | null }> {
  if (!isNativePlatform()) return { error: 'not_supported' }
  const platform = currentPlatform()
  if (!platform) return { error: 'not_supported' }

  try {
    let status = await PushNotifications.checkPermissions()
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') {
      status = await PushNotifications.requestPermissions()
    }
    if (status.receive !== 'granted') return { error: 'permission_denied' }

    return await new Promise((resolve) => {
      // register() itself resolves immediately; the actual APNs/FCM token
      // arrives asynchronously via the 'registration' listener (or
      // 'registrationError' on failure) — both must be wired before
      // calling register(), matching the same "listeners before
      // subscribe" ordering rule this app already applies to Supabase
      // Realtime channels for the same underlying reason (a race between
      // the event firing and the listener existing).
      let settled = false
      PushNotifications.addListener('registration', async (token) => {
        if (settled) return
        settled = true
        lastToken = token.value
        const { error } = await registerNativePushToken(platform, token.value)
        resolve({ error })
      })
      PushNotifications.addListener('registrationError', (err) => {
        if (settled) return
        settled = true
        resolve({ error: err.error || 'registration_failed' })
      })
      PushNotifications.register()
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown_error' }
  }
}

/** Unregisters this device's token both locally and server-side. */
export async function disableNativePush(): Promise<{ error: string | null }> {
  if (!isNativePlatform()) return { error: 'not_supported' }
  try {
    if (lastToken) {
      const { error } = await unregisterNativePushToken(lastToken)
      lastToken = null
      return { error }
    }
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown_error' }
  }
}

/**
 * Wires the tap-to-open-chat deep link for a notification tapped while the
 * app is backgrounded or freshly launched from a killed state — the
 * native equivalent of public/sw.js's `notificationclick` handler for Web
 * Push. Call once near app startup; returns an unsubscribe function.
 * `onOpenChat` receives the same (conversationId, fromUserId,
 * fromUsername) triple App.tsx already knows how to consume from the
 * `?open_chat=` URL param / service-worker postMessage path, so both
 * delivery mechanisms converge on one navigation code path.
 */
export function listenForNotificationTaps(
  onOpenChat: (conversationId: string, fromUserId: string, fromUsername: string) => void
): () => void {
  if (!isNativePlatform()) return () => {}

  let removed = false
  let handle: { remove: () => void } | null = null

  PushNotifications.addListener('pushNotificationActionPerformed', (action: ActionPerformed) => {
    const data = action.notification.data || {}
    if (data.conversation_id) {
      onOpenChat(data.conversation_id, data.from_user_id || '', data.from_username || '')
    }
  }).then((h) => {
    if (removed) h.remove()
    else handle = h
  })

  return () => {
    removed = true
    handle?.remove()
  }
}
