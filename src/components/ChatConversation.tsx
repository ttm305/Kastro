import { useEffect, useRef, useState, useCallback } from 'react'
import type { Lang } from '../App'
import Avatar from './Avatar'
import { useAuth } from '../lib/auth'
import {
  getMessages,
  sendMessage,
  openConversation,
  heartbeatConversation,
  leaveConversation,
  saveDraft,
  getDraft,
  subscribeToConversation,
  subscribeToTyping,
  getPresence,
  toggleSaveMessage,
  type ChatMessage,
} from '../lib/api'
import { activeConversation, setActiveConversation } from '../lib/chatPresence'
import { formatPresence } from '../lib/presenceFormat'

function timeShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

// crypto.randomUUID() requires a secure context and a modern browser
// (Safari 15.4+). If it's ever unavailable — an older WebView, an
// HTTP-served dev build, etc. — calling it throws synchronously, and if
// that throw happens before handleSend's try block even starts, it's
// uncaught: no optimistic message, no error shown, input untouched, which
// looks exactly like "pressing Send does nothing." This fallback and the
// try block below being moved to wrap UUID generation too make that
// specific failure mode impossible either way.
function safeRandomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    try { return crypto.randomUUID() } catch { /* fall through to manual generation */ }
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

// Hard cap for how long a send is allowed to stay "in flight" before the
// UI treats it as failed, independent of api.ts's own AbortController
// timeout — belt and suspenders. Background tabs on iOS Safari can throttle
// or fully suspend JS timers (including the AbortController's own
// setTimeout), so relying on a single timeout mechanism isn't safe; this
// second check runs specifically on the app coming back to the
// foreground, when timers resume, and force-clears a send that's been
// stuck since before backgrounding.
const SEND_STUCK_MS = 20000

interface OtherUser {
  id: string
  username: string
  avatar_url?: string | null
}

interface Props {
  conversationId: string
  otherUser: OtherUser
  lang: Lang
  /** Renders as a compact overlay panel (in-game) instead of a full-screen sheet (normal chat). */
  variant?: 'full' | 'panel'
  onClose: () => void
}

/**
 * The single shared 1:1 conversation surface — used both for normal private
 * chat and (Phase 4) in-game chat, since both resolve to the same
 * conversation row. Owns the entire disappearing-message lifecycle from the
 * client side: open marks read, heartbeat keeps "still viewing" alive,
 * unmount/close triggers the permanent server-side deletion sweep for
 * whatever this user has already read.
 */
export default function ChatConversation({ conversationId, otherUser, lang, variant = 'full', onClose }: Props) {
  const { profile } = useAuth()
  const isAr = lang === 'ar'
  const myId = profile?.id ?? ''

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  const [otherTyping, setOtherTyping] = useState(false)
  const [otherOnline, setOtherOnline] = useState(false)
  const [otherLastSeenAt, setOtherLastSeenAt] = useState<string | null>(null)
  const [otherInGame, setOtherInGame] = useState<{ name: string; nameAr: string } | null>(null)
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null)
  const [savePending, setSavePending] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const typingTimeoutRef = useRef<number | null>(null)
  const draftTimerRef = useRef<number | null>(null)
  const sendTypingRef = useRef<(() => void) | null>(null)
  const lastTypingSentAtRef = useRef(0)
  const longPressTimerRef = useRef<number | null>(null)
  const longPressFiredRef = useRef(false)
  const sendStartedAtRef = useRef<number | null>(null)

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
    })
  }, [])

  // Mount: mark read, load history, subscribe to live changes. Unmount: leave
  // (permanent-delete sweep for whatever I've already read) and tear down channels.
  useEffect(() => {
    if (!conversationId || !myId) return
    let cancelled = false
    setActiveConversation(conversationId)

    ;(async () => {
      setLoading(true)
      await openConversation(conversationId)
      const [msgs, draft] = await Promise.all([getMessages(conversationId), getDraft(conversationId, myId)])
      if (cancelled) return
      setMessages(msgs)
      setInput(draft)
      setLoading(false)
      scrollToBottom()
    })()

    const unsubMessages = subscribeToConversation(
      conversationId,
      (m) => {
        setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]))
        scrollToBottom()
        // A message arriving while I'm actively viewing should be marked read immediately
        // (mirrors "if both users present simultaneously, messages stay until reader exits").
        if (m.sender_id !== myId) openConversation(conversationId)
      },
      (deletedId) => setMessages((prev) => prev.filter((x) => x.id !== deletedId)),
      (updated) => setMessages((prev) => prev.map((x) => (x.id === updated.id ? updated : x)))
    )

    const typing = subscribeToTyping(conversationId, myId, () => {
      setOtherTyping(true)
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current)
      typingTimeoutRef.current = window.setTimeout(() => setOtherTyping(false), 3000)
    })
    sendTypingRef.current = typing.sendTyping

    const heartbeat = window.setInterval(() => heartbeatConversation(conversationId), 10000)

    const handleLeaveSignals = () => { leaveConversation(conversationId).catch(() => {}) }
    const handleVisibility = () => { if (document.visibilityState === 'hidden') handleLeaveSignals() }
    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleLeaveSignals)

    return () => {
      cancelled = true
      window.clearInterval(heartbeat)
      if (typingTimeoutRef.current) window.clearTimeout(typingTimeoutRef.current)
      if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current)
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleLeaveSignals)
      unsubMessages()
      typing.unsubscribe()
      leaveConversation(conversationId).catch(() => {})
      if (activeConversation.current === conversationId) setActiveConversation(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, myId])

  // Presence for the header (online/away + server-verified "currently playing").
  useEffect(() => {
    if (!otherUser.id) return
    let cancelled = false
    const poll = async () => {
      const [p] = await getPresence([otherUser.id])
      if (!cancelled && p) {
        setOtherOnline(p.is_online)
        setOtherLastSeenAt(p.last_seen_at)
        setOtherInGame(p.is_in_game ? { name: p.game_name ?? 'a game', nameAr: p.game_name_ar ?? 'لعبة' } : null)
      }
    }
    poll()
    // 15s poll matched to the presence heartbeat's own 20s interval (see
    // src/lib/presenceHeartbeat.ts) plus the 45s server-side freshness
    // window in get_presence() — frequent enough that "just went offline"
    // shows up within about one poll cycle, not tied to any Realtime
    // subscription that could silently stop firing. Also re-polls
    // immediately on foreground so reopening this chat after backgrounding
    // the app never shows a stale Online carried over from before.
    const id = window.setInterval(poll, 15000)
    const onForeground = () => { if (document.visibilityState === 'visible') poll() }
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('focus', onForeground)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('focus', onForeground)
    }
  }, [otherUser.id])

  function handleInputChange(v: string) {
    setInput(v)
    if (sendError) setSendError(null)
    if (draftTimerRef.current) window.clearTimeout(draftTimerRef.current)
    draftTimerRef.current = window.setTimeout(() => saveDraft(conversationId, myId, v), 500)
    const now = Date.now()
    if (v.trim() && now - lastTypingSentAtRef.current > 2000) {
      lastTypingSentAtRef.current = now
      sendTypingRef.current?.()
    }
  }

  // Watchdog: if a send has been "in flight" since before the app was
  // backgrounded, force-clear it the moment we're foregrounded again.
  // Root cause this specifically targets: on mobile Safari/WKWebView, a
  // fetch in flight when the tab backgrounds can be suspended by the OS
  // and never resolve or reject — and the JS timer inside api.ts's own
  // AbortController timeout can ALSO be suspended along with everything
  // else while backgrounded, so it isn't guaranteed to fire either. This
  // is the second, independent layer: it runs on the 'visible' transition
  // specifically, which is exactly when suspended timers/promises resume
  // or can be safely given up on. Without this, `sending` can stay stuck
  // true forever and every subsequent tap of Send does nothing — which is
  // the exact symptom reported.
  useEffect(() => {
    function handleVisible() {
      if (document.visibilityState !== 'visible') return
      if (!sending || sendStartedAtRef.current === null) return
      const elapsed = Date.now() - sendStartedAtRef.current
      if (elapsed > SEND_STUCK_MS) {
        if (import.meta.env.DEV) console.warn('[chat] send: watchdog force-reset stuck send', { elapsedMs: elapsed })
        setSending(false)
        sendStartedAtRef.current = null
        setSendError(isAr ? 'انتهت مهلة الإرسال. حاول مرة أخرى.' : 'Send timed out. Please try again.')
      }
    }
    document.addEventListener('visibilitychange', handleVisible)
    return () => document.removeEventListener('visibilitychange', handleVisible)
  }, [sending, isAr])

  // Handles the actual send RPC plus every failure mode around it:
  // - guarded against double-submit by `sending`, but `sending` is *always*
  //   released in `finally` so a thrown exception (flaky network, tab
  //   backgrounded mid-request on mobile, etc.) can never permanently wedge
  //   the Send button the way it used to.
  // - api.ts's sendMessage() now hard-times-out after 15s via
  //   AbortController, and the visibility watchdog above is a second,
  //   independent layer against the same "request silently hangs forever
  //   on mobile" failure mode — together these make it structurally
  //   impossible for `sending` to stay stuck true indefinitely.
  // - the input is only cleared once the server has confirmed the message
  //   was actually persisted; on any failure the typed text is restored so
  //   nothing is silently lost. Never a fake/optimistic-only success.
  // - failures always surface the exact underlying error text, not just a
  //   generic message, so the real cause is visible rather than guessed at.
  // - everything, including UUID generation, is inside the try block, so
  //   even an unexpected synchronous throw (e.g. crypto.randomUUID
  //   unavailable in some browser context) can never silently no-op the
  //   button — it always reaches the catch block and shows an error.
  async function handleSend() {
    const body = input.trim()
    if (!body || sending) return
    setSending(true)
    setSendError(null)
    sendStartedAtRef.current = Date.now()

    try {
      const clientMessageId = safeRandomUUID()
      // Optimistic append so the sender never waits on round-trip latency;
      // the real row (with a real id) replaces it once the RPC resolves,
      // and the realtime INSERT-dedup-by-id above no-ops if it arrives first.
      const optimistic: ChatMessage = {
        id: `pending-${clientMessageId}`,
        conversation_id: conversationId,
        sender_id: myId,
        body,
        client_message_id: clientMessageId,
        source: variant === 'panel' ? 'game' : 'chat',
        created_at: new Date().toISOString(),
        delivered_at: new Date().toISOString(),
        read_at: null,
        is_saved: false,
        saved_at: null,
        saved_by: null,
      }
      setMessages((prev) => [...prev, optimistic])
      scrollToBottom()

      // Debug logging (temporary, per explicit request): the exact
      // request being sent, and who/what conversation it's for.
      // eslint-disable-next-line no-console
      console.debug('[kastro:chat] send: start', {
        conversationId,
        clientMessageId,
        myId,
        otherUserId: otherUser.id,
        bodyLength: body.length,
      })

      const { id, error } = await sendMessage(conversationId, body, clientMessageId)

      if (error || !id) {
        // eslint-disable-next-line no-console
        console.warn('[kastro:chat] send: rpc returned error', error)
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
        setInput(body)
        // Shows the exact underlying error text alongside a friendly
        // prefix, per explicit requirement — never just a generic
        // "something went wrong" with the real cause hidden.
        setSendError(
          (isAr ? 'تعذّر إرسال الرسالة: ' : 'Message failed to send: ') + (error || (isAr ? 'خطأ غير معروف' : 'unknown error'))
        )
        return
      }

      // eslint-disable-next-line no-console
      console.debug('[kastro:chat] send: confirmed', { id })
      setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? { ...m, id } : m)))
      // Only clear the input / draft now that the send is actually confirmed.
      setInput('')
      saveDraft(conversationId, myId, '')
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[kastro:chat] send: threw', err)
      // Remove only the optimistic (still-pending) message(s) — there is
      // at most one in flight at a time thanks to the `sending` guard, so
      // this can never touch already-confirmed real messages.
      setMessages((prev) => prev.filter((m) => !m.id.startsWith('pending-')))
      setInput(body)
      const raw = err instanceof Error ? err.message : String(err)
      setSendError((isAr ? 'حدث خطأ: ' : 'An error occurred: ') + raw)
    } finally {
      // Always released, even on a thrown exception — this is the fix for
      // "Send stays disabled forever after pressing it once."
      setSending(false)
      sendStartedAtRef.current = null
    }
  }

  // Long-press (mobile) or click-and-hold (desktop) on a real (non-pending)
  // message opens the Save/Unsave action sheet. A short tap or a drag/scroll
  // never fires it (guarded by longPressFiredRef + a 500ms threshold).
  function handlePressStart(m: ChatMessage) {
    if (m.id.startsWith('pending-')) return
    longPressFiredRef.current = false
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current)
    longPressTimerRef.current = window.setTimeout(() => {
      longPressFiredRef.current = true
      setActionMessage(m)
    }, 500)
  }
  function handlePressEnd() {
    if (longPressTimerRef.current) { window.clearTimeout(longPressTimerRef.current); longPressTimerRef.current = null }
  }

  async function handleToggleSave() {
    if (!actionMessage || savePending) return
    const target = actionMessage
    const nextSaved = !target.is_saved
    setSavePending(true)
    if (import.meta.env.DEV) console.debug('[chat] toggleSave: start', { id: target.id, nextSaved })
    try {
      const { message, error } = await toggleSaveMessage(target.id, nextSaved)
      if (error || !message) {
        if (import.meta.env.DEV) console.warn('[chat] toggleSave: failed', error)
        setSendError(isAr ? 'تعذّر تحديث حالة الحفظ. حاول مرة أخرى.' : 'Could not update saved status. Try again.')
      } else {
        setMessages((prev) => prev.map((x) => (x.id === message.id ? message : x)))
      }
    } catch (err) {
      if (import.meta.env.DEV) console.error('[chat] toggleSave: threw', err)
      setSendError(isAr ? 'حدث خطأ في الاتصال.' : 'A connection error occurred.')
    } finally {
      setSavePending(false)
      setActionMessage(null)
    }
  }

  const isPanel = variant === 'panel'

  return (
    <div
      style={
        isPanel
          ? { display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--surface-1)', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(var(--fg-rgb),0.1)' }
          : { position: 'fixed', inset: 0, zIndex: 400, background: 'var(--background)', display: 'flex', flexDirection: 'column' }
      }
    >
      {/* Header */}
      <div className="glass" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: isPanel ? '10px 14px' : '14px 16px', flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '1px solid rgba(var(--fg-rgb),0.1)', borderRadius: 10, width: 34, height: 34, cursor: 'pointer', fontSize: 15, color: 'var(--foreground)' }}>
          {isPanel ? '✕' : (isAr ? '→' : '←')}
        </button>
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <Avatar url={otherUser.avatar_url} size={isPanel ? 32 : 40} style={{ border: '2px solid rgba(124,58,237,0.3)' }} />
          <div style={{ position: 'absolute', bottom: 0, right: isAr ? 'auto' : 0, left: isAr ? 0 : 'auto', width: 11, height: 11, borderRadius: '50%', background: otherOnline ? '#10b981' : '#4b5563', border: '2px solid var(--surface-1)' }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{otherUser.username}</p>
          <p style={{ margin: 0, fontSize: 11, color: otherOnline ? '#10b981' : 'rgba(var(--fg-rgb),0.35)' }}>
            {otherTyping
              ? (isAr ? 'يكتب الآن…' : 'typing…')
              : otherInGame
                ? (isAr ? `يلعب الآن: ${otherInGame.nameAr}` : `Playing ${otherInGame.name}`)
                : formatPresence(otherOnline, otherLastSeenAt, isAr)}
          </p>
        </div>
      </div>

      {/* Messages */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
        {loading && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)', margin: '20px 0' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>
        )}
        {!loading && messages.length === 0 && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(var(--fg-rgb),0.35)', margin: '30px 0' }}>
            {isAr ? 'لا توجد رسائل بعد. قل مرحبًا!' : 'No messages yet. Say hi!'}
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === myId
          return (
            <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
              <div
                onPointerDown={() => handlePressStart(m)}
                onPointerUp={handlePressEnd}
                onPointerLeave={handlePressEnd}
                onPointerCancel={handlePressEnd}
                onContextMenu={(e) => { if (!m.id.startsWith('pending-')) { e.preventDefault(); setActionMessage(m) } }}
                style={{
                  maxWidth: '76%',
                  padding: '9px 13px',
                  borderRadius: mine ? '16px 16px 4px 16px' : '16px 16px 16px 4px',
                  background: mine ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(var(--fg-rgb),0.06)',
                  color: mine ? '#fff' : 'var(--foreground)',
                  border: m.is_saved ? '1px solid rgba(250,204,21,0.55)' : mine ? 'none' : '1px solid rgba(var(--fg-rgb),0.08)',
                  direction: /[؀-ۿ]/.test(m.body) ? 'rtl' : 'ltr',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  touchAction: 'manipulation',
                  cursor: 'pointer',
                }}
              >
                <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.4, wordBreak: 'break-word' }}>{m.body}</p>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'flex-end', marginTop: 3 }}>
                  {m.is_saved && <span title={isAr ? 'محفوظة' : 'Saved'} style={{ fontSize: 9.5, opacity: 0.8 }}>📌</span>}
                  <span style={{ fontSize: 9.5, opacity: 0.65 }}>{timeShort(m.created_at)}</span>
                  {mine && <span style={{ fontSize: 9.5, opacity: 0.65 }}>{m.read_at ? '✓✓' : '✓'}</span>}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Save / Unsave action sheet — long-press (mobile) or right-click (desktop) on any real message */}
      {actionMessage && (
        <div
          onClick={() => setActionMessage(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 500, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="glass"
            style={{ width: '100%', maxWidth: 420, borderRadius: '18px 18px 0 0', padding: '10px 0 max(10px, env(safe-area-inset-bottom))' }}
          >
            <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(var(--fg-rgb),0.2)', margin: '4px auto 10px' }} />
            <button
              onClick={handleToggleSave}
              disabled={savePending}
              style={{
                width: '100%', textAlign: isAr ? 'right' : 'left', padding: '13px 20px', background: 'none', border: 'none',
                fontSize: 14, fontWeight: 600, color: 'var(--foreground)', cursor: savePending ? 'default' : 'pointer', opacity: savePending ? 0.6 : 1,
              }}
            >
              {actionMessage.is_saved
                ? (isAr ? 'إلغاء الحفظ' : 'Unsave from Chat')
                : (isAr ? 'حفظ في المحادثة' : 'Save in Chat')}
            </button>
            <button
              onClick={() => setActionMessage(null)}
              style={{ width: '100%', textAlign: 'center', padding: '13px 20px', background: 'none', border: 'none', borderTop: '1px solid rgba(var(--fg-rgb),0.08)', fontSize: 13.5, color: 'rgba(var(--fg-rgb),0.5)', cursor: 'pointer', marginTop: 4 }}
            >
              {isAr ? 'إلغاء' : 'Cancel'}
            </button>
          </div>
        </div>
      )}

      {/* Send error */}
      {sendError && (
        <div style={{ padding: '6px 14px', flexShrink: 0 }}>
          <p style={{ margin: 0, fontSize: 11.5, color: '#f87171', textAlign: isAr ? 'right' : 'left' }}>{sendError}</p>
        </div>
      )}

      {/* Composer */}
      <div style={{ display: 'flex', gap: 8, padding: isPanel ? '8px 10px' : '10px 14px', borderTop: '1px solid rgba(var(--fg-rgb),0.08)', flexShrink: 0 }}>
        <input
          type="text"
          value={input}
          placeholder={isAr ? 'اكتب رسالة…' : 'Type a message…'}
          onChange={(e) => handleInputChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') handleSend() }}
          style={{ flex: 1, fontSize: 13.5 }}
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || sending}
          style={{
            padding: '0 16px', borderRadius: 10, border: 'none', cursor: input.trim() ? 'pointer' : 'default',
            background: input.trim() ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(var(--fg-rgb),0.08)',
            color: input.trim() ? '#fff' : 'rgba(var(--fg-rgb),0.3)', fontSize: 13, fontWeight: 700,
          }}
        >
          {isAr ? 'إرسال' : 'Send'}
        </button>
      </div>
    </div>
  )
}
