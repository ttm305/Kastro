// send-push: delivers a push notification to every device a user has
// registered — both Web Push (VAPID, browser/installed-PWA) and native
// (FCM, Capacitor-wrapped iOS/Android). Invoked internally, via pg_net,
// from three places:
//   - private.send_push_notification(user_id, ...)  — single recipient
//     (new chat message, friend request)
//   - private.send_push_broadcast(...)               — every active user
//     (tournament created, challenge created)
// Request body is either `{user_id, title, title_ar, body, body_ar, data}`
// or `{broadcast: true, title, title_ar, body, body_ar, data}`.
//
// Auth model: this function is NOT a public API endpoint. verify_jwt is
// disabled (there is no end-user JWT for a server-to-server DB->function
// call), and instead every request must carry the shared secret in
// `x-internal-secret`, matching private.app_secrets.push_internal_secret.
// Anything else is rejected with 403 before any Postgres or push-service
// call is made.
//
// Required Edge Function secrets (set via `supabase secrets set` or the
// Dashboard — NOT settable from this delivery, see migration README):
//   PUSH_INTERNAL_SECRET     - must exactly match private.app_secrets.push_internal_secret
//   VAPID_PUBLIC_KEY         - must exactly match the key embedded in the frontend (src/lib/push.ts)
//   VAPID_PRIVATE_KEY        - the matching VAPID private key, kept server-side only
//   VAPID_SUBJECT            - a mailto: or https: contact URI required by the Web Push spec
//   FCM_PROJECT_ID           - the Firebase project ID backing the Capacitor native build
//   FCM_SERVICE_ACCOUNT_JSON - full JSON key for a Firebase service account with the
//                              "Firebase Cloud Messaging API" role, as a single-line string secret
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are auto-injected by the
// platform into every Edge Function — no manual setup needed for those.
//
// Web Push and native (FCM) delivery are independent: if only one of the
// two secret groups is configured, that channel is skipped with a log
// line rather than failing the whole request — a user with only a native
// token registered must still get notified even before VAPID is set up,
// and vice versa.

import { createClient } from 'jsr:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'
import { GoogleAuth } from 'npm:google-auth-library@9'

const INTERNAL_SECRET = Deno.env.get('PUSH_INTERNAL_SECRET') ?? ''
const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') ?? ''
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@careerxp.app'

const FCM_PROJECT_ID = Deno.env.get('FCM_PROJECT_ID') ?? ''
const FCM_SERVICE_ACCOUNT_JSON = Deno.env.get('FCM_SERVICE_ACCOUNT_JSON') ?? ''

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

let cachedFcmAuth: InstanceType<typeof GoogleAuth> | null = null
function getFcmAuth() {
  if (!cachedFcmAuth) {
    cachedFcmAuth = new GoogleAuth({
      credentials: JSON.parse(FCM_SERVICE_ACCOUNT_JSON),
      scopes: ['https://www.googleapis.com/auth/firebase.messaging'],
    })
  }
  return cachedFcmAuth
}

async function sendFcm(token: string, title: string, body: string, data: Record<string, unknown>, badge: number) {
  const auth = getFcmAuth()
  const client = await auth.getClient()
  const accessToken = (await client.getAccessToken()).token as string

  // FCM's `data` payload values must all be strings — everything the
  // client (src/App.tsx's pushNotificationActionPerformed listener) reads
  // out of it is re-parsed there.
  const stringData: Record<string, string> = {}
  for (const [k, v] of Object.entries(data)) stringData[k] = v == null ? '' : String(v)

  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${FCM_PROJECT_ID}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        notification: { title, body },
        data: stringData,
        android: { priority: 'high', notification: { sound: 'default' } },
        apns: { payload: { aps: { sound: 'default', badge, 'content-available': 1 } } },
      },
    }),
  })

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}))
    const status = errBody?.error?.status
    const err = new Error(`FCM send failed: ${status ?? res.status}`)
    ;(err as { fcmStatus?: string }).fcmStatus = status
    throw err
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (!INTERNAL_SECRET || req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  let payload: { user_id?: string; broadcast?: boolean; title?: string; title_ar?: string; body?: string; body_ar?: string; data?: Record<string, unknown> }
  try {
    payload = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const { user_id, broadcast, title, body, data } = payload
  if (!user_id && !broadcast) {
    return new Response(JSON.stringify({ error: 'user_id or broadcast required' }), { status: 400, headers: { 'Content-Type': 'application/json' } })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const webPushConfigured = !!(VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY)
  const fcmConfigured = !!(FCM_PROJECT_ID && FCM_SERVICE_ACCOUNT_JSON)
  if (!webPushConfigured) console.warn('send-push: VAPID keys not configured, skipping Web Push')
  if (!fcmConfigured) console.warn('send-push: FCM_PROJECT_ID/FCM_SERVICE_ACCOUNT_JSON not configured, skipping native push')
  if (!webPushConfigured && !fcmConfigured) {
    return new Response(JSON.stringify({ sent: 0, removed: 0, skipped: 'not_configured' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let sent = 0
  let removed = 0
  const notificationPayload = JSON.stringify({ title: title || 'CareerXP', body: body || '', data: data ?? {} })

  if (webPushConfigured) {
    webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)

    // Broadcast: every subscription belonging to a currently-active user.
    // Single recipient: just that user's rows. Same shape either way past
    // this point, so the send/prune logic below doesn't need to branch.
    const subsQuery = broadcast
      ? supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth, profiles!inner(status)').eq('profiles.status', 'active')
      : supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth').eq('user_id', user_id)

    const { data: subs, error } = await subsQuery

    if (error) {
      console.error('send-push: push_subscriptions query failed', error)
    } else if (subs && subs.length > 0) {
      const staleIds: string[] = []

      await Promise.all(
        (subs as { id: string; endpoint: string; p256dh: string; auth: string }[]).map(async (s) => {
          try {
            await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, notificationPayload)
            sent++
          } catch (err) {
            const statusCode = (err as { statusCode?: number })?.statusCode
            // 404/410 mean the browser/OS has permanently invalidated this
            // subscription (uninstalled, permission revoked, etc.) —
            // remove it so we stop paying the round-trip cost forever.
            if (statusCode === 404 || statusCode === 410) {
              staleIds.push(s.id)
            } else {
              console.error('send-push: web push delivery failed', s.id, statusCode, err)
            }
          }
        })
      )

      if (staleIds.length) {
        await supabase.from('push_subscriptions').delete().in('id', staleIds)
        removed += staleIds.length
      }
    }
  }

  // ── Native push (Capacitor iOS/Android via FCM) ──
  if (fcmConfigured) {
    const tokensQuery = broadcast
      ? supabase.from('native_push_tokens').select('id, token, user_id, profiles!inner(status)').eq('profiles.status', 'active')
      : supabase.from('native_push_tokens').select('id, token, user_id').eq('user_id', user_id)

    const { data: tokens, error } = await tokensQuery

    if (error) {
      console.error('send-push: native_push_tokens query failed', error)
    } else if (tokens && tokens.length > 0) {
      // Badge count = each recipient's current unread in-app notification
      // count. For a single-recipient call this is one query; for a
      // broadcast, batch-fetch unread counts for every distinct recipient
      // up front rather than one query per token.
      const recipientIds = [...new Set((tokens as { user_id: string }[]).map((t) => t.user_id))]
      const badgeByUser = new Map<string, number>()
      await Promise.all(
        recipientIds.map(async (uid) => {
          const { count } = await supabase
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', uid)
            .eq('is_read', false)
          badgeByUser.set(uid, count ?? 0)
        })
      )

      const staleIds: string[] = []

      await Promise.all(
        (tokens as { id: string; token: string; user_id: string }[]).map(async (t) => {
          try {
            await sendFcm(t.token, title || 'CareerXP', body || '', data ?? {}, badgeByUser.get(t.user_id) ?? 0)
            sent++
          } catch (err) {
            const fcmStatus = (err as { fcmStatus?: string })?.fcmStatus
            // UNREGISTERED = uninstalled/token rotated; INVALID_ARGUMENT
            // on a well-formed request body almost always means the token
            // itself is malformed/stale. Both are permanent — prune them.
            if (fcmStatus === 'UNREGISTERED' || fcmStatus === 'INVALID_ARGUMENT' || fcmStatus === 'NOT_FOUND') {
              staleIds.push(t.id)
            } else {
              console.error('send-push: native push delivery failed', t.id, fcmStatus, err)
            }
          }
        })
      )

      if (staleIds.length) {
        await supabase.from('native_push_tokens').delete().in('id', staleIds)
        removed += staleIds.length
      }
    }
  }

  return new Response(JSON.stringify({ sent, removed }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
