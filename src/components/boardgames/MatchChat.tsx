import { useCallback, useEffect, useRef, useState } from 'react'
import {
  getBoardGameMessages, sendBoardGameMessage, subscribeToBoardGameMessages,
  type BoardGameMessage,
} from '../../lib/api'

interface Props {
  roomId: string
  userId: string
  /** true while this match is currently the visible/foreground screen — used only to decide whether new messages bump the unread badge while collapsed. Presence for push-suppression is computed server-side from board_game_players heartbeats, not from this. */
  isAr: boolean
}

/**
 * Per-match chat, scoped strictly to one board_game_rooms row (seated
 * players + spectators of THIS room only — see board_game_messages RLS).
 * Deliberately not built on the friends 1:1 `messages`/`conversations`
 * system: opponents in a match are not necessarily friends, and match
 * chat must not inherit that system's disappearing-on-leave retention.
 *
 * Starts collapsed (a small floating toggle) so it never covers the
 * board/dice/turn controls underneath it — only expands into a bottom
 * sheet with its own composer when the player opens it, and that sheet
 * tracks visualViewport so the composer stays above the iOS keyboard
 * instead of getting pushed off-screen or covering itself.
 */
export default function MatchChat({ roomId, userId, isAr }: Props) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<BoardGameMessage[]>([])
  const [unread, setUnread] = useState(0)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [keyboardInset, setKeyboardInset] = useState(0)
  const listRef = useRef<HTMLDivElement | null>(null)
  const stickToBottomRef = useRef(true)
  const openRef = useRef(open)
  openRef.current = open

  // Initial history + live inserts. Runs for the lifetime of the match
  // screen (not just while the sheet is open) so the unread badge stays
  // accurate even when collapsed.
  useEffect(() => {
    let cancelled = false
    getBoardGameMessages(roomId).then((rows) => { if (!cancelled) setMessages(rows) })
    const unsubscribe = subscribeToBoardGameMessages(roomId, (row) => {
      setMessages((prev) => (prev.some((m) => m.id === row.id) ? prev : [...prev, row]))
      if (row.sender_id !== userId && !openRef.current) setUnread((n) => n + 1)
    })
    return () => { cancelled = true; unsubscribe() }
  }, [roomId, userId])

  useEffect(() => {
    if (open) setUnread(0)
  }, [open])

  // Auto-scroll to the newest message — but only when the reader was
  // already at (or near) the bottom, so someone scrolling up to read
  // earlier chat isn't yanked back down by an incoming message.
  useEffect(() => {
    if (!open) return
    const el = listRef.current
    if (!el) return
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight
  }, [messages, open])

  const handleScroll = useCallback(() => {
    const el = listRef.current
    if (!el) return
    stickToBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60
  }, [])

  // Keep the composer above the iOS keyboard in both installed-PWA and
  // regular Safari: visualViewport shrinks (and its offsetTop can move)
  // when the keyboard opens, but layout viewport / 100dvh does not
  // reliably follow that on iOS, so the gap has to be measured and
  // applied explicitly rather than assumed away by CSS alone.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const onResize = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
      setKeyboardInset(inset)
    }
    onResize()
    vv.addEventListener('resize', onResize)
    vv.addEventListener('scroll', onResize)
    return () => {
      vv.removeEventListener('resize', onResize)
      vv.removeEventListener('scroll', onResize)
    }
  }, [])

  const handleSend = async () => {
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setDraft('')
    const clientMessageId = crypto.randomUUID()
    // Optimistic append so sending feels instant; the realtime echo above
    // de-dupes by id and simply no-ops when it arrives.
    const optimistic: BoardGameMessage = {
      id: `pending-${clientMessageId}`, room_id: roomId, sender_id: userId,
      body, client_message_id: clientMessageId, created_at: new Date().toISOString(),
    }
    setMessages((prev) => [...prev, optimistic])
    stickToBottomRef.current = true
    const { error, id } = await sendBoardGameMessage(roomId, body, clientMessageId)
    setSending(false)
    if (error || !id) {
      // Roll back the optimistic bubble and hand the text back so nothing
      // is silently lost.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id))
      setDraft(body)
      return
    }
    setMessages((prev) => prev.map((m) => (m.id === optimistic.id ? { ...m, id } : m)))
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label={isAr ? 'فتح الدردشة' : 'Open chat'}
        style={{
          position: 'fixed', bottom: 'max(20px, calc(env(safe-area-inset-bottom) + 12px))',
          insetInlineEnd: 16, zIndex: 9200,
          width: 50, height: 50, borderRadius: '50%',
          background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
          border: 'none', cursor: 'pointer', fontSize: 20,
          boxShadow: '0 4px 18px rgba(124,58,237,0.45)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        💬
        {unread > 0 && (
          <span style={{
            position: 'absolute', top: -2, insetInlineEnd: -2, minWidth: 18, height: 18, borderRadius: 9,
            background: '#ff4757', color: '#fff', fontSize: 10.5, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px',
            border: '2px solid rgba(11,11,18,0.9)',
          }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 9200,
        height: 'min(58dvh, 460px)', display: 'flex', flexDirection: 'column',
        background: 'rgba(13,13,22,0.98)', borderRadius: '18px 18px 0 0',
        border: '1px solid rgba(124,58,237,0.25)', borderBottom: 'none',
        boxShadow: '0 -8px 30px rgba(0,0,0,0.45)',
        transform: `translateY(-${keyboardInset}px)`, transition: 'transform 150ms ease-out',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
        <p style={{ margin: 0, fontSize: 13, fontWeight: 800, color: '#fff' }}>
          {isAr ? 'دردشة المباراة' : 'Match Chat'}
        </p>
        <button
          onClick={() => setOpen(false)}
          aria-label={isAr ? 'إغلاق' : 'Collapse'}
          style={{ width: 28, height: 28, borderRadius: 14, border: 'none', background: 'rgba(255,255,255,0.08)', color: 'rgba(255,255,255,0.7)', cursor: 'pointer', fontSize: 14 }}
        >
          ✕
        </button>
      </div>

      <div ref={listRef} onScroll={handleScroll} style={{ flex: 1, overflowY: 'auto', padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8, WebkitOverflowScrolling: 'touch' }}>
        {messages.length === 0 && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(255,255,255,0.35)', marginTop: 20 }}>
            {isAr ? 'لا رسائل بعد — قل مرحبًا!' : 'No messages yet — say hi!'}
          </p>
        )}
        {messages.map((m) => {
          const mine = m.sender_id === userId
          return (
            <div key={m.id} style={{ display: 'flex', flexDirection: 'column', alignItems: mine ? 'flex-end' : 'flex-start' }}>
              {!mine && (
                <span style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,255,255,0.4)', margin: '0 4px 2px' }}>
                  {m.username ?? (isAr ? 'لاعب' : 'Player')}
                </span>
              )}
              <div style={{
                maxWidth: '78%', padding: '8px 12px', borderRadius: mine ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                background: mine ? 'linear-gradient(135deg,#7c3aed,#6d28d9)' : 'rgba(255,255,255,0.08)',
                color: '#fff', fontSize: 13.5, lineHeight: 1.4, wordBreak: 'break-word', whiteSpace: 'pre-wrap',
                direction: /[؀-ۿ]/.test(m.body) ? 'rtl' : 'ltr', textAlign: 'start',
              }}>
                {m.body}
              </div>
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 8, padding: '10px 12px max(10px, env(safe-area-inset-bottom))', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend() } }}
          placeholder={isAr ? 'اكتب رسالة...' : 'Type a message…'}
          dir="auto"
          maxLength={500}
          style={{
            flex: 1, padding: '10px 14px', borderRadius: 20, border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.06)', color: '#fff', fontSize: 14, outline: 'none',
          }}
        />
        <button
          onClick={handleSend}
          disabled={!draft.trim() || sending}
          style={{
            width: 40, height: 40, borderRadius: 20, border: 'none', flexShrink: 0,
            background: draft.trim() && !sending ? 'linear-gradient(135deg,#7c3aed,#6d28d9)' : 'rgba(255,255,255,0.08)',
            color: '#fff', fontSize: 16, cursor: draft.trim() && !sending ? 'pointer' : 'not-allowed',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}
          aria-label={isAr ? 'إرسال' : 'Send'}
        >
          {isAr ? '◀' : '▶'}
        </button>
      </div>
    </div>
  )
}
