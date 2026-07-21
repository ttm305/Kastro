import { useEffect, useState } from 'react'
import type { Lang } from '../App'
import ChatConversation from './ChatConversation'
import { getOrCreateConversation, getMyConversations } from '../lib/api'
import { safeRight, safeLeft } from '../lib/safeArea'

interface Props {
  /** The friend you're currently in a match with. Only ever called for confirmed friends — the generic board-game controller should not render this for non-friend opponents. */
  opponentId: string
  opponentUsername: string
  opponentAvatarUrl?: string | null
  lang: Lang
}

/**
 * Drop-in in-game chat, reusable by any future game screen. Resolves to the
 * exact same conversation as the normal Friends → Chats inbox (via
 * get_or_create_conversation's canonical-pair uniqueness), so a message sent
 * mid-match and a message sent later from the Chats tab are literally the
 * same thread — never a separate "game chat" duplicate.
 *
 * Not currently mounted anywhere: Ludo is disabled and no other live
 * multiplayer game screen exists yet. This is the ready-to-attach piece —
 * a future game screen wires it in with:
 *   <GameChatPanel opponentId={opponent.id} opponentUsername={opponent.username} opponentAvatarUrl={opponent.avatar_url} lang={lang} />
 * placed anywhere in that screen's layout; it manages its own
 * collapsed/expanded state and positioning.
 */
export default function GameChatPanel({ opponentId, opponentUsername, opponentAvatarUrl, lang }: Props) {
  const isAr = lang === 'ar'
  const [conversationId, setConversationId] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== 'undefined' && window.innerWidth >= 900)

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 900)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { id } = await getOrCreateConversation(opponentId)
      if (!cancelled) setConversationId(id)
    })()
    return () => { cancelled = true }
  }, [opponentId])

  // Poll unread count for the toggle badge while the panel is collapsed —
  // once opened, ChatConversation itself takes over via realtime.
  useEffect(() => {
    if (open || !conversationId) return
    const poll = async () => {
      const convos = await getMyConversations()
      const mine = convos.find((c) => c.conversation_id === conversationId)
      setUnread(mine?.unread_count ?? 0)
    }
    poll()
    const id = window.setInterval(poll, 8000)
    return () => window.clearInterval(id)
  }, [open, conversationId])

  if (!conversationId) return null

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed',
          // Mobile: was a flat 88 assuming a fixed-height bottom nav — the
          // nav itself grows on a notched phone (env(safe-area-inset-bottom),
          // see --bottom-nav-height in index.css), so this pins above the
          // nav's REAL measured height instead of drifting under a taller
          // one. Desktop has no bottom nav, so it keeps its flat offset.
          bottom: isDesktop ? 24 : 'calc(var(--bottom-nav-height, 80px) + env(safe-area-inset-bottom, 0px) + 8px)',
          right: isAr ? 'auto' : safeRight(20),
          left: isAr ? safeLeft(20) : 'auto',
          zIndex: 250,
          width: 52, height: 52, borderRadius: '50%',
          background: 'linear-gradient(135deg, #7c3aed, #4f46e5)',
          border: 'none', cursor: 'pointer', fontSize: 22,
          boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
        title={isAr ? 'الدردشة' : 'Chat'}
      >
        💬
        {unread > 0 && (
          <span style={{ position: 'absolute', top: -2, right: -2, minWidth: 18, height: 18, borderRadius: 9, background: '#ff4785', color: '#fff', fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 4px', border: '2px solid var(--background, #0b0b12)' }}>
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
    )
  }

  // Mobile: non-blocking slide-up sheet over the lower portion of the screen
  // (leaves the board/dice interaction zone above it untouched). Desktop:
  // compact floating side panel that doesn't overlay the board.
  return (
    <div
      style={
        isDesktop
          ? { position: 'fixed', bottom: 24, right: isAr ? 'auto' : 20, left: isAr ? 20 : 'auto', zIndex: 250, width: 340, height: 460 }
          : { position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 250, height: '55dvh', paddingBottom: 'env(safe-area-inset-bottom, 0px)', boxSizing: 'border-box' }
      }
    >
      <ChatConversation
        conversationId={conversationId}
        otherUser={{ id: opponentId, username: opponentUsername, avatar_url: opponentAvatarUrl }}
        lang={lang}
        variant="panel"
        onClose={() => setOpen(false)}
      />
    </div>
  )
}
