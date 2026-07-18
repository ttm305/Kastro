import { useEffect, useState, useRef } from 'react'
import type { Lang } from '../App'
import Avatar from './Avatar'
import { useAuth } from '../lib/auth'
import { subscribeToNewNotifications, markNotificationRead, getPublicProfilesMap, type Notification } from '../lib/api'
import { activeConversation } from '../lib/chatPresence'

interface ToastItem {
  id: string
  conversationId: string
  fromUserId: string
  fromUsername: string
  preview: string
  avatarUrl?: string | null
}

/**
 * Mounted once at the app shell (mirrors AchievementOverlayHost's pattern):
 * pops a lightweight, auto-dismissing toast the instant a "new_message"
 * notification lands for me, no matter which screen I'm on. Two things
 * this deliberately gets right per spec:
 *  - if I'm already looking at that exact conversation, no toast fires —
 *    checked against the live `activeConversation` ref that
 *    ChatConversation keeps updated, so the message I can already see on
 *    screen doesn't also interrupt me.
 *  - tapping the toast opens that exact conversation, wherever I am.
 *
 * Regression fix: this used to call subscribeToNewNotifications() with no
 * tag, which built the exact same realtime channel topic
 * (`notifications-insert:${userId}`) that AchievementOverlayHost was
 * already subscribing to. Two channels sharing one topic collide — the
 * second `.channel()` call gets back a channel that's already mid-
 * subscribe, and calling `.on('postgres_changes', ...)` on it throws
 * "tried to add postgres_changes callbacks after subscribe()", which
 * crashed the whole app since nothing caught it. Fixed by giving this
 * host its own tag ('chat-toast') so it gets an independent channel, plus
 * defensive guards below so a realtime failure of any kind degrades to
 * "no toast" instead of ever throwing into render.
 */
export default function ChatToastHost({ lang, onOpenChat }: {
  lang: Lang
  onOpenChat: (conversationId: string, otherUser: { id: string; username: string; avatar_url?: string | null }) => void
}) {
  const { profile } = useAuth()
  const isAr = lang === 'ar'
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<string, number>>(new Map())
  // Read from the callback instead of putting `isAr` in the effect's
  // dependency array — a language toggle shouldn't tear down and rebuild
  // the realtime subscription, just change how the *next* toast is
  // worded. Kept current via a plain ref, updated every render.
  const isArRef = useRef(isAr)
  isArRef.current = isAr
  // Guards against ever having two live subscriptions open at once for
  // this host specifically — e.g. React StrictMode's dev-only double
  // mount/cleanup/mount, or a fast profile.id change mid-cleanup. The
  // effect's own cleanup already unsubscribes before a new one is
  // created, but this ref makes that invariant explicit and prevents the
  // subscribe branch from ever running twice without an intervening
  // cleanup.
  const subscribedRef = useRef(false)

  useEffect(() => {
    if (!profile?.id) return
    if (subscribedRef.current) return
    subscribedRef.current = true

    // subscribeToNewNotifications() itself never throws (see its doc
    // comment in api.ts) — it swallows realtime init failures internally
    // and returns a no-op unsubscribe. This try/catch is a second,
    // belt-and-suspenders layer specifically around this component's own
    // onInsert callback logic, so a bug in *this* file can equally never
    // crash the app shell.
    let unsub = () => {}
    try {
      unsub = subscribeToNewNotifications(profile.id, async (n: Notification) => {
        try {
          if (n.type !== 'new_message') return
          const data = (n.data as Record<string, unknown>) ?? {}
          const conversationId = data.conversation_id as string | undefined
          const fromUserId = data.from_user_id as string | undefined
          const fromUsername = (data.from_username as string | undefined) ?? (isArRef.current ? 'شخص ما' : 'Someone')
          if (!conversationId || !fromUserId) return
          // Already looking at this exact conversation — it's rendering
          // the message live already, don't also pop a toast on top of it.
          if (activeConversation.current === conversationId) return

          let avatarUrl: string | null | undefined
          try {
            const map = await getPublicProfilesMap([fromUserId])
            avatarUrl = map.get(fromUserId)?.avatar_url
          } catch { /* toast still works without an avatar */ }

          const preview = isArRef.current ? (n.body_ar ?? n.body ?? '') : (n.body ?? n.body_ar ?? '')
          const toastId = n.id
          setToasts((prev) => (prev.some((x) => x.id === toastId) ? prev : [...prev, { id: toastId, conversationId, fromUserId, fromUsername, preview, avatarUrl }]))
          const t = window.setTimeout(() => dismiss(toastId), 5000)
          timersRef.current.set(toastId, t)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[kastro:ChatToastHost] failed to handle notification', err)
        }
      }, 'chat-toast')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[kastro:ChatToastHost] failed to subscribe', err)
    }

    return () => {
      subscribedRef.current = false
      try { unsub() } catch { /* already torn down */ }
      timersRef.current.forEach((t) => window.clearTimeout(t))
      timersRef.current.clear()
    }
  }, [profile?.id])

  function dismiss(id: string) {
    const t = timersRef.current.get(id)
    if (t) { window.clearTimeout(t); timersRef.current.delete(id) }
    setToasts((prev) => prev.filter((x) => x.id !== id))
  }

  function handleTap(t: ToastItem) {
    dismiss(t.id)
    markNotificationRead(t.id).catch(() => {})
    onOpenChat(t.conversationId, { id: t.fromUserId, username: t.fromUsername, avatar_url: t.avatarUrl })
  }

  if (!toasts.length) return null

  return (
    <div style={{ position: 'fixed', top: 'max(12px, env(safe-area-inset-top))', left: 0, right: 0, zIndex: 600, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, pointerEvents: 'none' }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => handleTap(t)}
          className="glass"
          style={{
            pointerEvents: 'auto', cursor: 'pointer', width: 'min(92vw, 380px)', display: 'flex', alignItems: 'center', gap: 10,
            padding: '10px 14px', borderRadius: 14, boxShadow: '0 8px 24px rgba(0,0,0,0.35)', border: '1px solid rgba(124,58,237,0.25)',
          }}
        >
          <Avatar url={t.avatarUrl} size={34} style={{ flexShrink: 0, border: '1.5px solid rgba(124,58,237,0.4)' }} />
          <div style={{ flex: 1, minWidth: 0, textAlign: isAr ? 'right' : 'left' }}>
            <p style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: 'var(--foreground)' }}>@{t.fromUsername}</p>
            <p style={{ margin: '1px 0 0', fontSize: 11.5, color: 'rgba(var(--fg-rgb),0.55)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t.preview}</p>
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); dismiss(t.id) }}
            style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 8, background: 'rgba(var(--fg-rgb),0.08)', border: 'none', cursor: 'pointer', fontSize: 11, color: 'rgba(var(--fg-rgb),0.5)' }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
