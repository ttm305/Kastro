import { registerPushSubscription, unregisterPushSubscription } from './api'

// This is the *public* half of the VAPID key pair generated for this
// project — public by design (it's literally called the "application
// server key" in the Push API spec and is meant to ship in client code).
// It has no security value on its own; only the matching private key
// (server-side only, in the send-push Edge Function's secrets) can
// actually sign push messages. If the VAPID keys are ever rotated, this
// constant and the VAPID_PUBLIC_KEY Edge Function secret must be updated
// together, or every existing subscription breaks silently.
const VAPID_PUBLIC_KEY = 'BKUQXoS3k9nIw2rKVyhAZoYiEv1Wihkh2dgkaRf6Q7sjLRiU4dPk_Dem6cJeywjTcnFVX48ur9my5uUiOX1b1tM'

// Returned type is deliberately widened to BufferSource — newer @types/web
// distinguishes Uint8Array<ArrayBufferLike> from the ArrayBufferView<ArrayBuffer>
// that PushSubscriptionOptionsInit.applicationServerKey expects, which a
// plain `new Uint8Array(n)` (backed by a real ArrayBuffer, never a
// SharedArrayBuffer, at runtime) satisfies but doesn't structurally match.
function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i)
  return outputArray as BufferSource
}

/** Web Push requires Service Worker + Push API + Notification API. iOS Safari only exposes these once the site has been added to the Home Screen (iOS 16.4+) — an ordinary Safari tab will fail this check. */
export function isPushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission
}

async function getRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/')
  if (existing) return existing
  return navigator.serviceWorker.register('/sw.js')
}

/** Requests permission (if not already decided), subscribes this browser to Web Push, and registers the subscription server-side. Returns an error string on failure — never throws. */
export async function enablePush(): Promise<{ error: string | null }> {
  if (!isPushSupported()) return { error: 'not_supported' }

  try {
    let permission = Notification.permission
    if (permission === 'default') permission = await Notification.requestPermission()
    if (permission !== 'granted') return { error: 'permission_denied' }

    const registration = await getRegistration()
    let subscription = await registration.pushManager.getSubscription()
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }

    const json = subscription.toJSON()
    const p256dh = json.keys?.p256dh
    const auth = json.keys?.auth
    if (!p256dh || !auth) return { error: 'invalid_subscription' }

    const { error } = await registerPushSubscription(subscription.endpoint, p256dh, auth, navigator.userAgent)
    return { error }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown_error' }
  }
}

/** Unsubscribes this browser and removes its server-side registration. */
export async function disablePush(): Promise<{ error: string | null }> {
  if (!isPushSupported()) return { error: 'not_supported' }
  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    const subscription = await registration?.pushManager.getSubscription()
    if (subscription) {
      const endpoint = subscription.endpoint
      await subscription.unsubscribe()
      const { error } = await unregisterPushSubscription(endpoint)
      return { error }
    }
    return { error: null }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'unknown_error' }
  }
}

/** Whether this exact browser currently holds a live push subscription (independent of what the server thinks — the two can drift if permission was revoked outside the app, e.g. via OS settings). */
export async function isPushSubscribedLocally(): Promise<boolean> {
  if (!isPushSupported()) return false
  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    const subscription = await registration?.pushManager.getSubscription()
    return !!subscription
  } catch {
    return false
  }
}
