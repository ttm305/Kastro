import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { Screen, Lang } from '../App'
import TopBar from '../components/TopBar'
import Avatar from '../components/Avatar'
import ChatConversation from '../components/ChatConversation'
import { useAuth } from '../lib/auth'
import {
  getFriends,
  getIncomingFriendRequests,
  getSentFriendRequests,
  cancelFriendRequest,
  searchUsers,
  getSuggestedUsers,
  sendFriendRequest,
  respondFriendRequest,
  removeFriend,
  blockUser,
  getMyConversations,
  subscribeToMyConversations,
  getOrCreateConversation,
  getPublicProfilesMap,
  getPresence,
  getMessages,
  type PublicProfile,
  type ConversationSummary,
  type FriendPresence,
  type ChatMessage,
} from '../lib/api'
import FriendProfileSheet from '../components/FriendProfileSheet'
import FriendGamingActionSheet from '../components/FriendGamingActionSheet'
import { formatPresence } from '../lib/presenceFormat'

interface Props {
  // Friends is a top-level nav tab (like Games/Leaderboard) so it has no
  // back-navigation of its own; kept optional for call-site compatibility
  // with the other nav screens' shared prop shape.
  onNavigate?: (s: Screen) => void
  lang: Lang
  setLang: (l: Lang) => void
  /** Set by App.tsx when a chat toast (or any other cross-screen entry point) is tapped — opens that exact conversation as soon as this screen mounts. */
  pendingOpenChat?: { conversationId: string; otherUser: { id: string; username: string; avatar_url?: string | null } } | null
  onPendingOpenChatConsumed?: () => void
  /** Wired through to the Friends Gaming Action Sheet's Join Game/Spectate actions — see App.tsx's openLudoTarget. */
  onOpenLudoTarget?: (mode: 'join' | 'spectate', roomId: string) => void
}

type FriendsTab = 'chats' | 'friends' | 'requests' | 'discover'
type IncomingRequest = Awaited<ReturnType<typeof getIncomingFriendRequests>>[number]
type SentRequest = Awaited<ReturnType<typeof getSentFriendRequests>>[number]
// Both searchUsers() and getSuggestedUsers() go through search_profiles_for_friends()
// (see api.ts), so they share this shape — level/avatar_url are always present.
type SuggestedUser = { id: string; username: string; level?: number; avatar_url?: string | null }

const LAST_TAB_KEY = 'kastro_friends_last_tab'

function timeAgo(iso: string, isAr: boolean): string {
  const diffMs = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diffMs / 60000)
  if (mins < 1) return isAr ? 'الآن' : 'now'
  if (mins < 60) return isAr ? `منذ ${mins} د` : `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return isAr ? `منذ ${hrs} س` : `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return isAr ? `منذ ${days} ي` : `${days}d ago`
}

export default function FriendsScreen({ lang, setLang, pendingOpenChat, onPendingOpenChatConsumed, onOpenLudoTarget }: Props) {
  const { profile } = useAuth()
  const isAr = lang === 'ar'
  const myId = profile?.id ?? ''

  const [tab, setTab] = useState<FriendsTab>('friends')
  const [tabResolved, setTabResolved] = useState(false)

  const [friends, setFriends] = useState<PublicProfile[]>([])
  const [friendPresence, setFriendPresence] = useState<Map<string, FriendPresence>>(new Map())
  const [requests, setRequests] = useState<IncomingRequest[]>([])
  const [sentRequests, setSentRequests] = useState<SentRequest[]>([])
  const [suggestions, setSuggestions] = useState<SuggestedUser[]>([])
  const [sentTo, setSentTo] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [chatSearch, setChatSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [actionSheetTarget, setActionSheetTarget] = useState<{ friendId: string; relationship: 'friend' | 'incoming_request' | 'sent_request'; requestId?: string } | null>(null)

  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [conversationProfiles, setConversationProfiles] = useState<Map<string, PublicProfile>>(new Map())
  const [conversationsLoaded, setConversationsLoaded] = useState(false)
  const [openChat, setOpenChat] = useState<{ conversationId: string; otherUser: { id: string; username: string; avatar_url?: string | null } } | null>(null)

  // --- Half-swipe preview (Snapchat-style) ---
  // A partial horizontal drag on a Chats-tab row progressively reveals an
  // expanding panel underneath it, showing the actual last few messages of
  // that conversation (bottom-anchored, like a real chat) growing in height
  // as the drag continues — never a static "last message" snippet. Height
  // and horizontal follow-offset are bound directly to the live pointer
  // position every frame (no fetch, no navigation) so it tracks the finger
  // exactly. This NEVER calls openConversation/subscribeToConversation/
  // heartbeatConversation — getMessages() is a plain read-only select (see
  // its definition in api.ts), so previewing never marks anything read,
  // never flips is_viewing, and never changes the unread badge. Releasing
  // the finger — at any drag distance — always animates the panel closed
  // and never opens the conversation.
  const SWIPE_REVEAL_PX = 140 // horizontal drag distance for a fully-open preview
  const SWIPE_MAX_HEIGHT = 216 // px of revealed message-preview panel at full drag
  const SWIPE_FOLLOW_PX = 20 // subtle horizontal "follow the finger" offset on the row itself
  const SWIPE_TAP_GUARD_MS = 250 // ignore taps on a row for this long after a real drag on it ends

  const [swipePreview, setSwipePreview] = useState<{ id: string; progress: number; followPx: number; live: boolean } | null>(null)
  const swipeStartRef = useRef<{ id: string; x: number; y: number; dragging: boolean; pointerId: number } | null>(null)
  const swipeCloseTimerRef = useRef<number | null>(null)
  // Per-row cooldown: a drag that ended on this row suppresses the tap that
  // the browser fires right after pointerup, AND any other genuine tap that
  // lands within the guard window — covers "during or immediately after".
  const lastSwipeEndRef = useRef<Map<string, number>>(new Map())
  // Cache of recent messages per conversation, loaded lazily the first time
  // that row is actually dragged (not on every tap) and reused for the rest
  // of the session so re-swiping the same row is instant.
  const [previewMessagesByConv, setPreviewMessagesByConv] = useState<Map<string, ChatMessage[]>>(new Map())
  const [previewLoadingIds, setPreviewLoadingIds] = useState<Set<string>>(new Set())

  function ensurePreviewMessagesLoaded(conversationId: string) {
    if (previewMessagesByConv.has(conversationId) || previewLoadingIds.has(conversationId)) return
    setPreviewLoadingIds((prev) => new Set(prev).add(conversationId))
    // Read-only — getMessages() is a plain `.select()`, it never touches
    // messages.read_at or conversation_participants.is_viewing, so this is
    // always safe to call purely for a peek, unlike openConversation().
    getMessages(conversationId)
      .then((msgs) => {
        setPreviewMessagesByConv((prev) => new Map(prev).set(conversationId, msgs.slice(-6)))
      })
      .finally(() => {
        setPreviewLoadingIds((prev) => { const next = new Set(prev); next.delete(conversationId); return next })
      })
  }

  function handleChatRowPointerDown(e: ReactPointerEvent, conversationId: string) {
    if (swipeCloseTimerRef.current) { window.clearTimeout(swipeCloseTimerRef.current); swipeCloseTimerRef.current = null }
    swipeStartRef.current = { id: conversationId, x: e.clientX, y: e.clientY, dragging: false, pointerId: e.pointerId }
  }

  function handleChatRowPointerMove(e: ReactPointerEvent, conversationId: string) {
    const s = swipeStartRef.current
    if (!s || s.id !== conversationId) return
    const dx = e.clientX - s.x
    const dy = e.clientY - s.y
    if (!s.dragging) {
      // Small movement threshold + horizontal-dominant check, so normal
      // vertical list scrolling is never hijacked into a swipe.
      if (Math.abs(dx) < 10 || Math.abs(dx) < Math.abs(dy)) return
      s.dragging = true
      try { e.currentTarget.setPointerCapture(s.pointerId) } catch { /* capture is best-effort */ }
      ensurePreviewMessagesLoaded(conversationId)
    }
    // Correct swipe direction per reading direction: LTR reveals on a
    // rightward drag, RTL reveals on a leftward drag (mirrored, matching
    // how every other directional gesture in this app follows `isAr`).
    const dirSign = isAr ? -1 : 1
    const signedDx = dx * dirSign
    const progress = Math.max(0, Math.min(1, signedDx / SWIPE_REVEAL_PX))
    const followPx = Math.max(-SWIPE_FOLLOW_PX, Math.min(SWIPE_FOLLOW_PX, dx / 4))
    setSwipePreview({ id: conversationId, progress, followPx, live: true })
  }

  function handleChatRowPointerEnd(conversationId: string, e?: ReactPointerEvent) {
    const s = swipeStartRef.current
    if (s && s.id === conversationId) {
      if (s.dragging) {
        lastSwipeEndRef.current.set(conversationId, Date.now())
        if (e) { try { e.currentTarget.releasePointerCapture(s.pointerId) } catch { /* already released */ } }
      }
    }
    swipeStartRef.current = null
    // Releasing always animates the preview closed, regardless of how far
    // it was dragged — the conversation never opens from this gesture.
    setSwipePreview((prev) => (prev?.id === conversationId ? { ...prev, progress: 0, followPx: 0, live: false } : prev))
    if (swipeCloseTimerRef.current) window.clearTimeout(swipeCloseTimerRef.current)
    swipeCloseTimerRef.current = window.setTimeout(() => {
      setSwipePreview((prev) => (prev?.id === conversationId ? null : prev))
    }, 320)
  }

  function handleChatRowClick(otherUser: { id: string; username: string; avatar_url?: string | null } | undefined, conversationId: string) {
    const lastEnd = lastSwipeEndRef.current.get(conversationId) ?? 0
    if (Date.now() - lastEnd < SWIPE_TAP_GUARD_MS) return
    if (otherUser) handleOpenChatWith(otherUser)
  }

  const totalUnread = useMemo(() => conversations.reduce((sum, c) => sum + (c.unread_count || 0), 0), [conversations])

  // --- Chats tab: load + realtime ---
  const refreshConversations = useCallback(async () => {
    const convos = await getMyConversations()
    setConversations(convos)
    const profiles = await getPublicProfilesMap(convos.map((c) => c.other_user_id))
    setConversationProfiles(profiles)
    setConversationsLoaded(true)
  }, [])

  useEffect(() => {
    refreshConversations()
  }, [refreshConversations])

  useEffect(() => {
    if (!myId) return
    // Unique tag ('chats-tab') — App.tsx subscribes to the same userId for
    // the nav badge; a colliding topic between the two throws and can
    // crash the app (see subscribeToMyConversations' doc comment).
    const unsub = subscribeToMyConversations(myId, refreshConversations, 'chats-tab')
    return () => { unsub() }
  }, [myId, refreshConversations])

  // Default-tab resolution: unread messages always win; otherwise reopen the
  // last tab the user picked. Runs once conversations have loaded so the
  // unread check is accurate, not before.
  useEffect(() => {
    if (tabResolved || !conversationsLoaded) return
    if (totalUnread > 0) {
      setTab('chats')
    } else {
      const remembered = window.localStorage.getItem(LAST_TAB_KEY) as FriendsTab | null
      if (remembered && ['chats', 'friends', 'requests', 'discover'].includes(remembered)) setTab(remembered)
    }
    setTabResolved(true)
  }, [tabResolved, conversationsLoaded, totalUnread])

  function selectTab(t: FriendsTab) {
    setTab(t)
    window.localStorage.setItem(LAST_TAB_KEY, t)
  }

  // --- Friends / Requests ---
  async function refreshFriendsAndRequests(userId: string) {
    const [f, r, sent] = await Promise.all([
      getFriends(userId),
      getIncomingFriendRequests(userId),
      getSentFriendRequests(userId),
    ])
    setFriends(f)
    setRequests(r)
    setSentRequests(sent)
    setSentTo(new Set(sent.map((s) => s.recipient_id)))
    if (f.length) {
      const presence = await getPresence(f.map((x: PublicProfile) => x.id))
      setFriendPresence(new Map(presence.map((p) => [p.id, p])))
    } else {
      setFriendPresence(new Map())
    }
  }

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      await refreshFriendsAndRequests(profile.id)
      if (!cancelled) setLoading(false)
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  // Live presence refresh for the Friends list while it's the active tab.
  // get_presence() is server-authoritative (computes is_online from a fresh
  // last_seen_at, not a stored boolean — see migration
  // 20260718080000_fix_live_presence.sql), but the client still has to
  // actually re-ask it regularly or a friend who went offline mid-session
  // would keep showing whatever status was fetched last. A 15s poll while
  // this tab is open, PLUS an immediate refetch the instant the app/tab
  // comes back to the foreground (visibilitychange/focus) or regains
  // network (online) — polling alone can lag by up to 15s right after
  // returning to the app, and a backgrounded tab's setInterval can be
  // throttled/paused by the browser entirely, so the foreground listener is
  // what actually guarantees "Online never appears stuck" in practice.
  useEffect(() => {
    if (tab !== 'friends' || !friends.length) return
    let cancelled = false
    const refreshPresence = async () => {
      const presence = await getPresence(friends.map((x) => x.id))
      if (!cancelled) setFriendPresence(new Map(presence.map((p) => [p.id, p])))
    }
    const id = window.setInterval(refreshPresence, 15000)
    const onForeground = () => { if (document.visibilityState === 'visible') refreshPresence() }
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('focus', onForeground)
    window.addEventListener('online', onForeground)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('focus', onForeground)
      window.removeEventListener('online', onForeground)
    }
  }, [tab, friends])

  // Discover tab: live search when typing, otherwise a small "people you may know" list.
  useEffect(() => {
    if (!profile?.id) return
    const excludeIds = [profile.id, ...friends.map((f) => f.id), ...requests.map((r) => r.requester_id), ...Array.from(sentTo)]
    const timer = setTimeout(async () => {
      if (query.trim()) {
        const results = await searchUsers(query, excludeIds)
        setSuggestions(results)
      } else {
        const results = await getSuggestedUsers(excludeIds, 5)
        setSuggestions(results)
      }
    }, 300)
    return () => clearTimeout(timer)
  }, [profile?.id, friends, requests, sentTo, query])

  async function handleRespond(requestId: string, accept: boolean) {
    const { error } = await respondFriendRequest(requestId, accept)
    if (!error && profile?.id) await refreshFriendsAndRequests(profile.id)
  }

  async function handleCancelSent(requestId: string) {
    const { error } = await cancelFriendRequest(requestId)
    if (!error && profile?.id) await refreshFriendsAndRequests(profile.id)
  }

  async function handleAdd(userId: string) {
    const { error } = await sendFriendRequest(userId)
    if (!error) setSentTo((prev) => new Set(prev).add(userId))
  }

  async function handleRemove(userId: string) {
    const { error } = await removeFriend(userId)
    if (!error && profile?.id) await refreshFriendsAndRequests(profile.id)
  }

  async function handleBlock(userId: string) {
    const { error } = await blockUser(userId)
    if (!error && profile?.id) await refreshFriendsAndRequests(profile.id)
  }

  // A chat toast (or any other cross-screen entry point) tapped elsewhere in
  // the app hands us a conversation to jump straight into — open it, land on
  // the Chats tab, and tell the parent we've consumed it so it doesn't
  // re-fire on the next render.
  useEffect(() => {
    if (!pendingOpenChat) return
    setOpenChat(pendingOpenChat)
    setTab('chats')
    setTabResolved(true)
    onPendingOpenChatConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOpenChat])

  async function handleOpenChatWith(otherUser: { id: string; username: string; avatar_url?: string | null }) {
    const { id, error } = await getOrCreateConversation(otherUser.id)
    if (error || !id) return
    setOpenChat({ conversationId: id, otherUser })
  }

  const filteredConversations = chatSearch.trim()
    ? conversations.filter((c) => {
        const p = conversationProfiles.get(c.other_user_id)
        return p?.username.toLowerCase().includes(chatSearch.trim().toLowerCase())
      })
    : conversations

  const tabs: { key: FriendsTab; en: string; ar: string; badge?: number }[] = [
    { key: 'chats', en: 'Chats', ar: 'المحادثات', badge: totalUnread },
    { key: 'friends', en: `Friends (${friends.length})`, ar: `الأصدقاء (${friends.length})` },
    { key: 'requests', en: `Requests${requests.length ? ` (${requests.length})` : ''}`, ar: `الطلبات${requests.length ? ` (${requests.length})` : ''}` },
    { key: 'discover', en: 'Discover', ar: 'اكتشف' },
  ]

  return (
    <div className="screen bg-mesh">
      {/* Friends is a top-level nav tab now (like Games/Leaderboard), so no back arrow. */}
      <TopBar title="Friends" titleAr="الأصدقاء" lang={lang} setLang={setLang} />

      <div className="pb-nav" style={{ padding: '16px 16px' }}>
        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, background: 'rgba(var(--fg-rgb),0.04)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => selectTab(t.key)}
              style={{
                position: 'relative', flex: 1, padding: '8px 4px', borderRadius: 9, border: 'none', cursor: 'pointer',
                fontSize: 12, fontWeight: 600, transition: 'all 0.2s ease',
                background: tab === t.key ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'transparent',
                color: tab === t.key ? 'white' : 'rgba(var(--fg-rgb),0.4)',
                fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit',
              }}
            >
              {isAr ? t.ar : t.en}
              {!!t.badge && (
                <span style={{ position: 'absolute', top: 2, right: isAr ? 'auto' : 6, left: isAr ? 6 : 'auto', minWidth: 15, height: 15, borderRadius: 8, background: '#ff4785', color: '#fff', fontSize: 9.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                  {t.badge > 9 ? '9+' : t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* ---------------- Chats ---------------- */}
        {tab === 'chats' && (
          <>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <span style={{ position: 'absolute', left: isAr ? 'auto' : 14, right: isAr ? 14 : 'auto', top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'rgba(var(--fg-rgb),0.3)', pointerEvents: 'none' }}>🔍</span>
              <input
                type="search"
                placeholder={isAr ? 'ابحث في المحادثات…' : 'Search conversations…'}
                value={chatSearch}
                onChange={(e) => setChatSearch(e.target.value)}
                style={{ paddingLeft: isAr ? 16 : 40, paddingRight: isAr ? 40 : 16 }}
              />
            </div>

            {!conversationsLoaded && (
              <p style={{ margin: '20px 0', fontSize: 12, textAlign: 'center', color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>
            )}

            {conversationsLoaded && filteredConversations.length === 0 && (
              <p style={{ margin: '30px 0', fontSize: 12, textAlign: 'center', color: 'rgba(var(--fg-rgb),0.35)' }}>
                {conversations.length === 0
                  ? (isAr ? 'لا توجد محادثات بعد. ابدأ من تبويب الأصدقاء.' : 'No conversations yet. Start one from the Friends tab.')
                  : (isAr ? 'لا نتائج' : 'No matches')}
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredConversations.map((c) => {
                const p = conversationProfiles.get(c.other_user_id)
                const isSwiped = swipePreview?.id === c.conversation_id
                const swipe = isSwiped ? swipePreview.progress : 0
                const followPx = isSwiped ? swipePreview.followPx : 0
                const live = isSwiped ? swipePreview.live : false
                const panelHeight = swipe * SWIPE_MAX_HEIGHT
                const previewMsgs = previewMessagesByConv.get(c.conversation_id) ?? []
                const previewLoading = previewLoadingIds.has(c.conversation_id)
                return (
                  <div
                    key={c.conversation_id}
                    style={{ position: 'relative', zIndex: swipe > 0 ? 40 : undefined }}
                  >
                    <div
                      className="glass-card"
                      style={{
                        position: 'relative', padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer',
                        touchAction: 'pan-y', transform: `translateX(${followPx}px)`,
                        transition: live ? 'none' : 'transform 0.28s cubic-bezier(.2,.8,.2,1)',
                      }}
                      onClick={() => handleChatRowClick(p ? { id: p.id, username: p.username, avatar_url: p.avatar_url } : undefined, c.conversation_id)}
                      onPointerDown={(e) => handleChatRowPointerDown(e, c.conversation_id)}
                      onPointerMove={(e) => handleChatRowPointerMove(e, c.conversation_id)}
                      onPointerUp={(e) => handleChatRowPointerEnd(c.conversation_id, e)}
                      onPointerCancel={(e) => handleChatRowPointerEnd(c.conversation_id, e)}
                    >
                      <div style={{ position: 'relative', flexShrink: 0 }}>
                        <Avatar url={p?.avatar_url} size={48} style={{ border: '2px solid rgba(124,58,237,0.3)' }} />
                        <div style={{ position: 'absolute', bottom: 0, right: isAr ? 'auto' : 0, left: isAr ? 0 : 'auto', width: 12, height: 12, borderRadius: '50%', background: p?.is_online ? '#10b981' : '#4b5563', border: '2px solid #07071a' }} />
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                          <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'var(--foreground)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>@{p?.username ?? '…'}</p>
                          {c.last_message_at && <span style={{ fontSize: 10.5, color: 'rgba(var(--fg-rgb),0.35)', flexShrink: 0 }}>{timeAgo(c.last_message_at, isAr)}</span>}
                        </div>
                        <p style={{ margin: '2px 0 0', fontSize: 12, color: c.unread_count > 0 ? 'var(--foreground)' : 'rgba(var(--fg-rgb),0.4)', fontWeight: c.unread_count > 0 ? 600 : 400, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {c.last_message_saved && <span style={{ fontSize: 10, flexShrink: 0 }}>📌</span>}
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {(() => {
                              const prefix = c.last_message_from_me ? (isAr ? 'أنت: ' : 'You: ') : ''
                              if (c.last_message_body) return `${prefix}${c.last_message_body}`
                              if (c.last_message_type === 'image') return `${prefix}${isAr ? '📷 صورة' : '📷 Photo'}`
                              if (c.last_message_type === 'video') return `${prefix}${isAr ? '🎥 فيديو' : '🎥 Video'}`
                              if (c.last_message_type === 'voice') return `${prefix}${isAr ? '🎤 رسالة صوتية' : '🎤 Voice message'}`
                              return isAr ? 'لا رسائل حالياً' : 'No messages yet'
                            })()}
                          </span>
                        </p>
                      </div>
                      {c.unread_count > 0 && (
                        <span style={{ minWidth: 20, height: 20, borderRadius: 10, background: '#ff4785', color: '#fff', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px', flexShrink: 0 }}>
                          {c.unread_count > 9 ? '9+' : c.unread_count}
                        </span>
                      )}
                    </div>

                    {/* Half-swipe preview panel — progressively reveals the
                        actual recent messages of this conversation, growing
                        downward from underneath the row exactly with the
                        drag distance. Read-only data (getMessages, a plain
                        select); never calls openConversation/heartbeat, so
                        it can never mark anything read or change the unread
                        badge. Height/opacity are driven straight off pointer
                        position with no transition while `live`, and only
                        animate closed once the finger lifts. */}
                    {panelHeight > 0 && (
                      <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                          position: 'absolute', left: 0, right: 0, top: '100%', zIndex: 40,
                          height: panelHeight, overflow: 'hidden',
                          borderRadius: '0 0 16px 16px',
                          background: 'var(--surface-1)',
                          border: swipe > 0.02 ? '1px solid rgba(124,58,237,0.25)' : 'none',
                          borderTop: 'none',
                          boxShadow: swipe > 0.02 ? '0 18px 34px rgba(0,0,0,0.4)' : 'none',
                          transition: live ? 'none' : 'height 0.3s cubic-bezier(.2,.8,.2,1), box-shadow 0.3s ease',
                        }}
                      >
                        <div style={{ minHeight: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 6, padding: '10px 14px 12px' }}>
                          {previewLoading && previewMsgs.length === 0 && (
                            <p style={{ margin: 0, textAlign: 'center', fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>
                          )}
                          {!previewLoading && previewMsgs.length === 0 && (
                            <p style={{ margin: 0, textAlign: 'center', fontSize: 11, color: 'rgba(var(--fg-rgb),0.35)' }}>{isAr ? 'لا توجد رسائل بعد' : 'No messages yet'}</p>
                          )}
                          {previewMsgs.map((m) => {
                            const mine = m.sender_id === myId
                            const label = m.body
                              ? m.body
                              : m.message_type === 'image' ? (isAr ? '📷 صورة' : '📷 Photo')
                              : m.message_type === 'video' ? (isAr ? '🎥 فيديو' : '🎥 Video')
                              : m.message_type === 'voice' ? (isAr ? '🎤 رسالة صوتية' : '🎤 Voice message')
                              : ''
                            return (
                              <div key={m.id} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start' }}>
                                <div
                                  style={{
                                    maxWidth: '80%', padding: '6px 10px', borderRadius: mine ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                                    background: mine ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(var(--fg-rgb),0.08)',
                                    color: mine ? '#fff' : 'var(--foreground)',
                                    fontSize: 11.5, lineHeight: 1.35, wordBreak: 'break-word',
                                    direction: m.body && /[؀-ۿ]/.test(m.body) ? 'rtl' : 'ltr',
                                  }}
                                >
                                  {label}
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ---------------- Friends ---------------- */}
        {tab === 'friends' && (
          <>
            {loading && (
              <p style={{ margin: '20px 0', fontSize: 12, textAlign: 'center', color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>
            )}
            {!loading && friends.length === 0 && (
              <p style={{ margin: '30px 0', fontSize: 12, textAlign: 'center', color: 'rgba(var(--fg-rgb),0.35)' }}>
                {isAr ? 'لا يوجد أصدقاء بعد. جرّب تبويب اكتشف.' : 'No friends yet. Try the Discover tab.'}
              </p>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {friends.map((f) => {
                const pres = friendPresence.get(f.id)
                return (
                  <div key={f.id} className="glass-card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ position: 'relative', flexShrink: 0, cursor: 'pointer' }} onClick={() => setViewingId(f.id)}>
                      <Avatar url={f.avatar_url} size={52} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '2px solid rgba(124,58,237,0.3)' }} />
                      <div style={{ position: 'absolute', bottom: 1, right: isAr ? 'auto' : 1, left: isAr ? 1 : 'auto', width: 13, height: 13, borderRadius: '50%', background: pres?.is_online ? '#10b981' : '#4b5563', border: '2px solid #07071a' }} />
                    </div>
                    <div style={{ flex: 1, cursor: 'pointer' }} onClick={() => setViewingId(f.id)}>
                      <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>@{f.username}</p>
                      <p style={{ margin: '0 0 3px', fontSize: 11, color: 'rgba(var(--fg-rgb),0.35)' }}>{isAr ? `مستوى ${f.level}` : `Lv. ${f.level}`}</p>
                      {pres?.is_in_game && <span style={{ fontSize: 11, color: '#fbbf24' }}>🎮 {isAr ? `يلعب: ${pres.game_name_ar ?? pres.game_name}` : `Playing ${pres.game_name}`}</span>}
                      {!pres?.is_in_game && (
                        <span style={{ fontSize: 11, color: pres?.is_online ? '#10b981' : 'rgba(var(--fg-rgb),0.35)' }}>
                          {formatPresence(!!pres?.is_online, pres?.last_seen_at, isAr)}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => handleOpenChatWith({ id: f.id, username: f.username, avatar_url: f.avatar_url })}
                      title={isAr ? 'مراسلة' : 'Message'}
                      style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(124,58,237,0.15)', border: '1px solid rgba(124,58,237,0.3)', cursor: 'pointer', fontSize: 15, flexShrink: 0 }}
                    >
                      💬
                    </button>
                    <button
                      onClick={() => setActionSheetTarget({ friendId: f.id, relationship: 'friend' })}
                      title={isAr ? 'الإجراءات' : 'Actions'}
                      aria-label={isAr ? 'فتح إجراءات الصديق' : 'Open friend actions'}
                      style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(var(--fg-rgb),0.06)', border: '1px solid rgba(var(--fg-rgb),0.1)', cursor: 'pointer', fontSize: 14, flexShrink: 0 }}
                    >
                      ⋯
                    </button>
                  </div>
                )
              })}
            </div>
          </>
        )}

        {/* ---------------- Requests ---------------- */}
        {tab === 'requests' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <div>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {isAr ? 'واردة' : 'Incoming'}
              </p>
              {requests.length === 0 && (
                <p style={{ margin: '10px 0', fontSize: 12, color: 'rgba(var(--fg-rgb),0.35)' }}>{isAr ? 'لا توجد طلبات واردة' : 'No incoming requests'}</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {requests.map((req) => (
                  <div key={req.id} className="glass-card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, cursor: 'pointer' }} onClick={() => setViewingId(req.requester_id)}>
                      <Avatar url={req.profile?.avatar_url} size={52} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '2px solid rgba(124,58,237,0.3)' }} />
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{req.profile?.username ? `@${req.profile.username}` : ''}</p>
                        <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? `مستوى ${req.profile?.level ?? 0}` : `Lv. ${req.profile?.level ?? 0}`}</p>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button onClick={() => handleRespond(req.id, true)} style={{ padding: '8px 14px', borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', border: 'none', color: 'white', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                        {isAr ? 'قبول' : 'Accept'}
                      </button>
                      <button onClick={() => handleRespond(req.id, false)} style={{ padding: '8px 12px', borderRadius: 10, background: 'rgba(var(--fg-rgb),0.06)', border: '1px solid rgba(var(--fg-rgb),0.1)', color: 'rgba(var(--fg-rgb),0.5)', fontSize: 12, cursor: 'pointer' }}>
                        ✕
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                {isAr ? 'مُرسلة' : 'Sent'}
              </p>
              {sentRequests.length === 0 && (
                <p style={{ margin: '10px 0', fontSize: 12, color: 'rgba(var(--fg-rgb),0.35)' }}>{isAr ? 'لا توجد طلبات مُرسلة' : 'No sent requests'}</p>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {sentRequests.map((req) => (
                  <div key={req.id} className="glass-card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, cursor: 'pointer' }} onClick={() => setViewingId(req.recipient_id)}>
                      <Avatar url={req.profile?.avatar_url} size={52} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '2px solid rgba(var(--fg-rgb),0.1)' }} />
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{req.profile?.username ? `@${req.profile.username}` : ''}</p>
                        <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? 'بانتظار الرد' : 'Pending'}</p>
                      </div>
                    </div>
                    <button onClick={() => handleCancelSent(req.id)} style={{ padding: '8px 14px', borderRadius: 10, background: 'rgba(var(--fg-rgb),0.06)', border: '1px solid rgba(var(--fg-rgb),0.1)', color: 'rgba(var(--fg-rgb),0.5)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>
                      {isAr ? 'إلغاء' : 'Cancel'}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ---------------- Discover ---------------- */}
        {tab === 'discover' && (
          <>
            <div style={{ position: 'relative', marginBottom: 14 }}>
              <span style={{ position: 'absolute', left: isAr ? 'auto' : 14, right: isAr ? 14 : 'auto', top: '50%', transform: 'translateY(-50%)', fontSize: 16, color: 'rgba(var(--fg-rgb),0.3)', pointerEvents: 'none' }}>🔍</span>
              <input
                type="search"
                placeholder={isAr ? 'ابحث عن موظف…' : 'Search employees…'}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                style={{ paddingLeft: isAr ? 16 : 40, paddingRight: isAr ? 40 : 16 }}
              />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <p style={{ margin: '0 0 4px', fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)' }}>
                {isAr ? 'موظفون قد تعرفهم' : 'People you may know'}
              </p>
              {suggestions.length === 0 && (
                <p style={{ margin: '10px 0', fontSize: 12, color: 'rgba(var(--fg-rgb),0.35)' }}>{isAr ? 'لا يوجد شيء لاكتشافه الآن' : 'Nothing to discover right now'}</p>
              )}
              {suggestions.map((s) => (
                <div key={s.id} className="glass-card" style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, flex: 1, cursor: 'pointer' }} onClick={() => setViewingId(s.id)}>
                    <Avatar url={s.avatar_url} size={52} style={{ background: 'rgba(var(--fg-rgb),0.08)', border: '2px solid rgba(var(--fg-rgb),0.1)' }} />
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>@{s.username}</p>
                      {typeof s.level === 'number' && (
                        <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)' }}>{isAr ? `مستوى ${s.level}` : `Lv. ${s.level}`}</p>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => handleAdd(s.id)}
                    disabled={sentTo.has(s.id)}
                    style={{
                      padding: '8px 14px', borderRadius: 10, border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 600,
                      background: sentTo.has(s.id) ? 'rgba(16,185,129,0.2)' : 'linear-gradient(135deg, #7c3aed, #4f46e5)',
                      color: sentTo.has(s.id) ? '#10b981' : 'white',
                      fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit',
                    }}
                  >
                    {sentTo.has(s.id) ? (isAr ? '✓ تمت' : '✓ Sent') : (isAr ? '+ إضافة' : '+ Add')}
                  </button>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {viewingId && (
        <FriendProfileSheet
          userId={viewingId}
          lang={lang}
          onClose={() => setViewingId(null)}
          isFriend={friends.some((f) => f.id === viewingId)}
          onMessage={(u) => { setViewingId(null); handleOpenChatWith(u) }}
          onRemove={(id) => { setViewingId(null); handleRemove(id) }}
          onBlock={(id) => { setViewingId(null); handleBlock(id) }}
        />
      )}

      {actionSheetTarget && (
        <FriendGamingActionSheet
          lang={lang}
          friendId={actionSheetTarget.friendId}
          relationship={actionSheetTarget.relationship}
          requestId={actionSheetTarget.requestId}
          onClose={() => setActionSheetTarget(null)}
          onMessage={(u) => { setActionSheetTarget(null); handleOpenChatWith(u) }}
          onOpenLudoTarget={(mode, roomId) => { setActionSheetTarget(null); onOpenLudoTarget?.(mode, roomId) }}
          onChanged={() => { if (profile?.id) refreshFriendsAndRequests(profile.id) }}
        />
      )}

      {openChat && (
        <ChatConversation
          conversationId={openChat.conversationId}
          otherUser={openChat.otherUser}
          lang={lang}
          onClose={() => { setOpenChat(null); refreshConversations() }}
        />
      )}
    </div>
  )
}
