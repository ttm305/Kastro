import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Lang } from '../App'
import Avatar from './Avatar'
import { useAuth } from '../lib/auth'
import { formatPresence } from '../lib/presenceFormat'
import { getCosmeticCatalog, resolveCosmetics, frameAvatarStyle } from '../lib/cosmetics'
import { safeBottom, safeLeft, safeRight, tapTarget, TAP_MIN } from '../lib/safeArea'
import {
  getPublicProfile, getPresence, getBlockStatus, getFriendPrefs, getUserRank, getGameStats, getGames,
  setFriendPinned, setFriendMuted, removeFriend, blockUser, unblockUser, reportUser,
  respondFriendRequest, cancelFriendRequest, getOrCreateConversation, sendMessage, levelProgress,
  getUserPublicAchievements,
  type PublicProfile, type FriendPresence, type FriendPrefs, type GameStat, type Game, type ReportCategory,
  type CosmeticItem, type PublicAchievement,
} from '../lib/api'

// =============================================================================
// Friends Gaming Action Sheet — replaces the old three-dot "⋯" menu (which
// just reopened the profile sheet) with a real, state-aware quick-actions
// panel. Every action here calls a genuinely working backend path; nothing
// is rendered unless the underlying capability actually exists for this
// friend right now (see the `actions` memo below) — see get_presence's
// migration comment and this file's own comments for exactly which real
// server state each action is gated on.
// =============================================================================

type Relationship = 'friend' | 'incoming_request' | 'sent_request'
type ActionKey = 'message' | 'invite' | 'join' | 'spectate' | 'compare' | 'achievements' | 'pin' | 'unpin' | 'mute' | 'unmute'
type View = 'menu' | 'invite' | 'compare' | 'achievements' | 'report'

interface Props {
  lang: Lang
  friendId: string
  relationship: Relationship
  /** Required for incoming_request/sent_request (Accept/Decline/Cancel target). */
  requestId?: string
  onClose: () => void
  onMessage: (user: { id: string; username: string; avatar_url?: string | null }) => void
  onOpenLudoTarget: (mode: 'join' | 'spectate', roomId: string) => void
  /** Called after any mutation that should refresh the caller's friend/request lists (remove, block, unblock, accept, decline, cancel). Pin/mute don't need it — this sheet reflects those itself. */
  onChanged: () => void
}

const RARITY_COLOR: Record<string, string> = { common: '#9ca3af', uncommon: '#34d399', rare: '#60a5fa', epic: '#c084fc', legendary: '#ffd700' }

const REPORT_CATEGORIES: { key: ReportCategory; en: string; ar: string }[] = [
  { key: 'harassment', en: 'Harassment or bullying', ar: 'مضايقة أو تنمر' },
  { key: 'hate_speech', en: 'Hate speech', ar: 'خطاب كراهية' },
  { key: 'spam', en: 'Spam', ar: 'رسائل مزعجة' },
  { key: 'inappropriate_content', en: 'Inappropriate content', ar: 'محتوى غير لائق' },
  { key: 'cheating', en: 'Cheating', ar: 'غش' },
  { key: 'impersonation', en: 'Impersonation', ar: 'انتحال شخصية' },
  { key: 'other', en: 'Other', ar: 'أخرى' },
]

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'message': return <svg {...common}><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>
    case 'invite': return <svg {...common}><path d="M12 5v14M5 12h14" /></svg>
    case 'join': return <svg {...common}><path d="M15 3h4a2 2 0 0 1 2 2v4M21 3l-8 8" /><path d="M14 21H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h4" /></svg>
    case 'spectate': return <svg {...common}><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></svg>
    case 'compare': return <svg {...common}><path d="M8 3v18M16 3v18" /><path d="M4 8h4M16 8h4M4 16h4M16 16h4" /></svg>
    case 'achievements': return <svg {...common}><circle cx="12" cy="8" r="5" /><path d="M8.5 12.5 7 21l5-2.5L17 21l-1.5-8.5" /></svg>
    case 'pin': return <svg {...common}><path d="M12 2a4 4 0 0 0-4 4c0 2 1 3.5 1 5.5L5 15h14l-4-3.5c0-2 1-3.5 1-5.5a4 4 0 0 0-4-4z" /><path d="M12 15v7" /></svg>
    case 'unpin': return <svg {...common}><path d="M2 2l20 20" /><path d="M12 2a4 4 0 0 0-4 4c0 2 1 3.5 1 5.5L5 15h6" /><path d="M12 15v7" /><path d="M15.5 11.5 19 15h-3.5" /></svg>
    case 'mute': return <svg {...common}><path d="M15 8a3 3 0 0 1 0 5.83" /><path d="M18 5a7 7 0 0 1 0 12.5" /><path d="M9 9H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4l4 4V5l-4 4z" /></svg>
    case 'unmute': return <svg {...common}><path d="M9 9H5a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h4l4 4V5l-4 4z" /><path d="M2 2l20 20" /></svg>
    case 'remove': return <svg {...common}><circle cx="9" cy="8" r="4" /><path d="M2 21v-1a6 6 0 0 1 6-6h2a6 6 0 0 1 6 6v1" /><path d="M17 8h6" /></svg>
    case 'block': return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M5.5 5.5l13 13" /></svg>
    case 'report': return <svg {...common}><path d="M5 3v18" /><path d="M5 4h11l-2 4 2 4H5" /></svg>
    case 'check': return <svg {...common}><path d="M20 6 9 17l-5-5" /></svg>
    case 'x': return <svg {...common}><path d="M18 6 6 18M6 6l12 12" /></svg>
    case 'chevronBack': return <svg {...common}><path d="m15 18-6-6 6-6" /></svg>
    case 'chevronFwd': return <svg {...common}><path d="m9 18 6-6-6-6" /></svg>
    default: return null
  }
}

function ActionRow({ icon, label, sublabel, onClick, danger, disabled, busy }: {
  icon: string; label: string; sublabel?: string; onClick: () => void; danger?: boolean; disabled?: boolean; busy?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || busy}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 14, padding: '13px 14px', minHeight: TAP_MIN,
        borderRadius: 14, border: `1px solid ${danger ? 'rgba(255,71,133,0.18)' : 'rgba(var(--fg-rgb),0.07)'}`,
        background: danger ? 'rgba(255,71,133,0.05)' : 'rgba(var(--fg-rgb),0.03)',
        cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, textAlign: 'left', marginBottom: 8,
        transition: 'background 0.15s ease, transform 0.1s ease',
      }}
      className="gas-action-row"
    >
      <span style={{
        width: 36, height: 36, borderRadius: 11, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: danger ? '#ff6b95' : '#b79bff',
        background: danger ? 'linear-gradient(135deg, rgba(255,71,133,0.18), rgba(255,71,133,0.06))' : 'linear-gradient(135deg, rgba(124,58,237,0.25), rgba(0,212,255,0.1))',
      }}>
        {busy ? <span className="gas-spinner" /> : <Icon name={icon} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 13.5, fontWeight: 700, color: danger ? '#ff6b95' : 'var(--foreground)' }}>{label}</span>
        {sublabel && <span style={{ display: 'block', fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)', marginTop: 1 }}>{sublabel}</span>}
      </span>
      <span style={{ color: 'rgba(var(--fg-rgb),0.25)', flexShrink: 0 }}><Icon name="chevronFwd" size={16} /></span>
    </button>
  )
}

export default function FriendGamingActionSheet({ lang, friendId, relationship, requestId, onClose, onMessage, onOpenLudoTarget, onChanged }: Props) {
  const isAr = lang === 'ar'
  const { profile: myProfile } = useAuth()
  const sheetRef = useRef<HTMLDivElement>(null)
  const previouslyFocused = useRef<HTMLElement | null>(null)
  const prefersReducedMotion = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches, [])

  const [mounted, setMounted] = useState(false)
  const [closing, setClosing] = useState(false)
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [presence, setPresence] = useState<FriendPresence | null>(null)
  const [blockStatus, setBlockStatus] = useState<{ blockedByMe: boolean; blockedMe: boolean }>({ blockedByMe: false, blockedMe: false })
  const [prefs, setPrefs] = useState<FriendPrefs | null>(null)
  const [rank, setRank] = useState<number | null>(null)
  const [catalog, setCatalog] = useState<CosmeticItem[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('menu')
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [confirmingBlock, setConfirmingBlock] = useState(false)

  // --- Entrance/dismissal animation (skipped for reduced-motion users) ---
  useEffect(() => {
    if (prefersReducedMotion) { setMounted(true); return }
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)))
    return () => cancelAnimationFrame(id)
  }, [prefersReducedMotion])

  function requestClose() {
    if (prefersReducedMotion) { onClose(); return }
    setClosing(true)
    window.setTimeout(onClose, 220)
  }

  // --- Focus trap + Escape-to-close + focus restoration ---
  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null
    const container = sheetRef.current
    const focusables = () => Array.from(container?.querySelectorAll<HTMLElement>('button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])') ?? []).filter((el) => !el.hasAttribute('disabled'))
    focusables()[0]?.focus()

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); requestClose(); return }
      if (e.key !== 'Tab') return
      const els = focusables()
      if (!els.length) return
      const first = els[0]
      const last = els[els.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      previouslyFocused.current?.focus?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // --- Data load ---
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [p, [pres], status, cat] = await Promise.all([
        getPublicProfile(friendId),
        getPresence([friendId]),
        myProfile?.id ? getBlockStatus(friendId, myProfile.id) : Promise.resolve({ blockedByMe: false, blockedMe: false }),
        getCosmeticCatalog(),
      ])
      if (cancelled) return
      setProfile(p); setPresence(pres ?? null); setBlockStatus(status); setCatalog(cat); setLoading(false)
      if (relationship === 'friend' && !status.blockedByMe) {
        getFriendPrefs([friendId]).then((m) => { if (!cancelled) setPrefs(m.get(friendId) ?? { friend_id: friendId, pinned: false, muted: false }) })
        getUserRank(friendId).then((r) => { if (!cancelled) setRank(r) })
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [friendId])

  // Presence can go stale while the sheet stays open — same 15s + foreground refresh contract as FriendProfileSheet/FriendsScreen.
  useEffect(() => {
    let cancelled = false
    const refresh = async () => { const [pres] = await getPresence([friendId]); if (!cancelled) setPresence(pres ?? null) }
    const id = window.setInterval(refresh, 15000)
    const onForeground = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onForeground)
    return () => { cancelled = true; window.clearInterval(id); document.removeEventListener('visibilitychange', onForeground) }
  }, [friendId])

  const progress = profile ? levelProgress(profile.xp) : null
  const equipped = profile ? resolveCosmetics(catalog, profile) : null

  const actions = useMemo<ActionKey[]>(() => {
    if (relationship !== 'friend' || blockStatus.blockedByMe || !presence) return []
    const list: ActionKey[] = ['message']
    if (presence.is_online) {
      if (presence.is_in_game) {
        if (presence.spectate_room_id && presence.spectate_game_slug === 'ludo') list.push('spectate')
      } else if (presence.lobby_room_id && presence.lobby_open && presence.lobby_game_slug === 'ludo') {
        list.push('join')
      } else {
        list.push('invite')
      }
    }
    list.push('compare', 'achievements')
    list.push(prefs?.pinned ? 'unpin' : 'pin')
    list.push(prefs?.muted ? 'unmute' : 'mute')
    return list
  }, [relationship, blockStatus, presence, prefs])

  async function run(key: string, fn: () => Promise<void>) {
    setBusyKey(key); setError(null)
    try { await fn() } finally { setBusyKey(null) }
  }

  async function handleAction(key: ActionKey) {
    if (!profile) return
    if (key === 'message') { onMessage({ id: friendId, username: profile.username, avatar_url: profile.avatar_url }); requestClose(); return }
    if (key === 'invite') { setView('invite'); return }
    if (key === 'compare') { setView('compare'); return }
    if (key === 'achievements') { setView('achievements'); return }
    if (key === 'join' && presence?.lobby_room_id) { onOpenLudoTarget('join', presence.lobby_room_id); requestClose(); return }
    if (key === 'spectate' && presence?.spectate_room_id) { onOpenLudoTarget('spectate', presence.spectate_room_id); requestClose(); return }
    if (key === 'pin' || key === 'unpin') {
      const next = key === 'pin'
      await run(key, async () => {
        const { error: err } = await setFriendPinned(friendId, next)
        if (err) { setError(isAr ? 'تعذر تحديث التثبيت.' : 'Couldn’t update pin status.'); return }
        setPrefs((p) => (p ? { ...p, pinned: next } : p))
      })
      return
    }
    if (key === 'mute' || key === 'unmute') {
      const next = key === 'mute'
      await run(key, async () => {
        const { error: err } = await setFriendMuted(friendId, next)
        if (err) { setError(isAr ? 'تعذر تحديث كتم الإشعارات.' : 'Couldn’t update mute status.'); return }
        setPrefs((p) => (p ? { ...p, muted: next } : p))
      })
    }
  }

  async function handleRemove() {
    await run('remove', async () => {
      const { error: err } = await removeFriend(friendId)
      if (err) { setError(isAr ? 'تعذرت إزالة الصديق.' : 'Couldn’t remove this friend.'); return }
      onChanged(); requestClose()
    })
  }
  async function handleBlock() {
    await run('block', async () => {
      const { error: err } = await blockUser(friendId)
      if (err) { setError(isAr ? 'تعذر الحظر.' : 'Couldn’t block this user.'); return }
      onChanged(); requestClose()
    })
  }
  async function handleUnblock() {
    await run('unblock', async () => {
      const { error: err } = await unblockUser(friendId)
      if (err) { setError(isAr ? 'تعذر إلغاء الحظر.' : 'Couldn’t unblock this user.'); return }
      onChanged(); requestClose()
    })
  }
  async function handleAccept(accept: boolean) {
    if (!requestId) return
    await run(accept ? 'accept' : 'decline', async () => {
      const { error: err } = await respondFriendRequest(requestId, accept)
      if (err) { setError(isAr ? 'تعذر تنفيذ العملية.' : 'Couldn’t complete that action.'); return }
      onChanged(); requestClose()
    })
  }
  async function handleCancelRequest() {
    if (!requestId) return
    await run('cancel', async () => {
      const { error: err } = await cancelFriendRequest(requestId)
      if (err) { setError(isAr ? 'تعذر إلغاء الطلب.' : 'Couldn’t cancel the request.'); return }
      onChanged(); requestClose()
    })
  }

  const isAr_ = isAr
  const header = (
    <div style={{ padding: '18px 20px 14px', display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        <Avatar url={profile?.avatar_url} size={60} style={frameAvatarStyle(equipped?.frame ?? null)} frame={equipped?.frame ?? null} />
        <div style={{
          position: 'absolute', bottom: 1, right: isAr_ ? 'auto' : 1, left: isAr_ ? 1 : 'auto', width: 14, height: 14, borderRadius: '50%',
          background: presence?.is_in_game ? '#fbbf24' : presence?.is_online ? '#10b981' : '#4b5563', border: '3px solid var(--surface-1)',
        }} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        {profile?.display_name?.trim() && (
          <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--foreground)', overflowWrap: 'break-word' }}>{profile.display_name.trim()}</div>
        )}
        <div style={{ fontSize: profile?.display_name?.trim() ? 12.5 : 15, fontWeight: 700, color: profile?.display_name?.trim() ? 'rgba(var(--fg-rgb),0.5)' : 'var(--foreground)' }}>
          @{profile?.username ?? '…'}
        </div>
        {equipped?.title && (
          <div style={{ fontSize: 11, fontWeight: 700, color: '#9d6fff', marginTop: 3 }}>
            {isAr_ ? (equipped.title.label_ar || equipped.title.label) : equipped.title.label}
          </div>
        )}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
          {progress && (
            <span style={pillStyle('rgba(124,58,237,0.14)', '#b79bff')}>{isAr_ ? `المستوى ${progress.level}` : `Lvl ${progress.level}`}</span>
          )}
          {typeof rank === 'number' && (
            <span style={pillStyle('rgba(0,212,255,0.12)', '#5fd8ff')}>{isAr_ ? `الترتيب #${rank}` : `Rank #${rank}`}</span>
          )}
          <span style={pillStyle(
            presence?.is_in_game ? 'rgba(251,191,36,0.14)' : presence?.is_online ? 'rgba(16,185,129,0.14)' : 'rgba(var(--fg-rgb),0.06)',
            presence?.is_in_game ? '#fbbf24' : presence?.is_online ? '#34d399' : 'rgba(var(--fg-rgb),0.45)'
          )}>
            {presence?.is_in_game
              ? (isAr_ ? `يلعب: ${presence.game_name_ar ?? presence.game_name}` : `Playing ${presence.game_name}`)
              : formatPresence(!!presence?.is_online, presence?.last_seen_at, isAr_)}
          </span>
        </div>
      </div>
      <button
        onClick={requestClose}
        aria-label={isAr_ ? 'إغلاق' : 'Close'}
        style={{ ...tapTarget(28), display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: 10, border: 'none', background: 'rgba(var(--fg-rgb),0.06)', color: 'rgba(var(--fg-rgb),0.6)', cursor: 'pointer', flexShrink: 0 }}
      >
        <Icon name="x" size={16} />
      </button>
    </div>
  )

  const actionLabels: Record<ActionKey, { icon: string; en: string; ar: string; sub?: { en: string; ar: string } }> = {
    message: { icon: 'message', en: 'Message', ar: 'مراسلة' },
    invite: { icon: 'invite', en: 'Invite to Game', ar: 'دعوة للعب' },
    join: { icon: 'join', en: 'Join Game', ar: 'انضمام للعبة', sub: { en: 'Their lobby is open', ar: 'غرفتهم مفتوحة' } },
    spectate: { icon: 'spectate', en: 'Spectate', ar: 'مشاهدة' },
    compare: { icon: 'compare', en: 'Compare Stats', ar: 'مقارنة الإحصائيات' },
    achievements: { icon: 'achievements', en: 'View Achievements', ar: 'عرض الإنجازات' },
    pin: { icon: 'pin', en: 'Pin Friend', ar: 'تثبيت الصديق' },
    unpin: { icon: 'unpin', en: 'Unpin Friend', ar: 'إلغاء تثبيت الصديق' },
    mute: { icon: 'mute', en: 'Mute Notifications', ar: 'كتم الإشعارات' },
    unmute: { icon: 'unmute', en: 'Unmute Notifications', ar: 'إلغاء كتم الإشعارات' },
  }

  let body: ReactNode
  if (loading) {
    body = <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)', padding: '30px 20px' }}>{isAr_ ? 'جارٍ التحميل...' : 'Loading…'}</p>
  } else if (view === 'invite') {
    body = <InviteView isAr={isAr_} friendId={friendId} onDone={requestClose} setSheetError={setError} />
  } else if (view === 'compare') {
    body = <CompareView isAr={isAr_} myId={myProfile?.id ?? ''} friendId={friendId} />
  } else if (view === 'achievements') {
    body = <AchievementsView isAr={isAr_} friendId={friendId} />
  } else if (view === 'report') {
    body = <ReportView isAr={isAr_} friendId={friendId} onSubmitted={requestClose} />
  } else if (blockStatus.blockedByMe) {
    body = (
      <div style={{ padding: '4px 20px 4px' }}>
        <p style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.45)', margin: '0 0 12px' }}>
          {isAr_ ? 'لقد حظرت هذا المستخدم. لن يتمكن من مراسلتك أو رؤية نشاطك.' : 'You’ve blocked this user. They can’t message you or see your activity.'}
        </p>
        <ActionRow icon="block" label={isAr_ ? 'إلغاء الحظر' : 'Unblock'} onClick={handleUnblock} busy={busyKey === 'unblock'} />
      </div>
    )
  } else if (relationship === 'incoming_request') {
    body = (
      <div style={{ padding: '4px 20px 4px' }}>
        <ActionRow icon="check" label={isAr_ ? 'قبول الطلب' : 'Accept Request'} onClick={() => handleAccept(true)} busy={busyKey === 'accept'} />
        <ActionRow icon="x" label={isAr_ ? 'رفض الطلب' : 'Decline Request'} onClick={() => handleAccept(false)} busy={busyKey === 'decline'} danger />
        <SensitiveSection isAr={isAr_} onReport={() => setView('report')} onBlock={handleBlock} confirmingBlock={confirmingBlock} setConfirmingBlock={setConfirmingBlock} busyKey={busyKey} />
      </div>
    )
  } else if (relationship === 'sent_request') {
    body = (
      <div style={{ padding: '4px 20px 4px' }}>
        <ActionRow icon="x" label={isAr_ ? 'إلغاء الطلب' : 'Cancel Request'} onClick={handleCancelRequest} busy={busyKey === 'cancel'} danger />
        <SensitiveSection isAr={isAr_} onReport={() => setView('report')} onBlock={handleBlock} confirmingBlock={confirmingBlock} setConfirmingBlock={setConfirmingBlock} busyKey={busyKey} />
      </div>
    )
  } else {
    body = (
      <div style={{ padding: '4px 20px 4px' }}>
        {actions.map((key) => {
          const meta = actionLabels[key]
          return (
            <ActionRow
              key={key}
              icon={meta.icon}
              label={isAr_ ? meta.ar : meta.en}
              sublabel={meta.sub ? (isAr_ ? meta.sub.ar : meta.sub.en) : undefined}
              onClick={() => handleAction(key)}
              busy={busyKey === key}
            />
          )
        })}

        <div style={{ height: 1, background: 'rgba(var(--fg-rgb),0.07)', margin: '10px 2px 14px' }} />
        <div style={{ fontSize: 10.5, fontWeight: 700, color: 'rgba(255,71,133,0.6)', textTransform: 'uppercase', letterSpacing: 0.8, margin: '0 2px 8px' }}>
          {isAr_ ? 'إجراءات حساسة' : 'Sensitive actions'}
        </div>

        {!confirmingRemove && (
          <ActionRow icon="remove" label={isAr_ ? 'إزالة صديق' : 'Remove Friend'} onClick={() => setConfirmingRemove(true)} danger />
        )}
        {confirmingRemove && (
          <div style={confirmBoxStyle}>
            <p style={confirmTextStyle}>{isAr_ ? 'هل تريد إزالة هذا الصديق؟ سيختفي من قائمة أصدقائك.' : 'Remove this friend? They’ll disappear from your friends list.'}</p>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => setConfirmingRemove(false)} style={confirmCancelBtnStyle}>{isAr_ ? 'تراجع' : 'Cancel'}</button>
              <button onClick={handleRemove} disabled={busyKey === 'remove'} style={confirmDangerBtnStyle}>{isAr_ ? 'تأكيد الإزالة' : 'Confirm Remove'}</button>
            </div>
          </div>
        )}

        <SensitiveSection isAr={isAr_} onReport={() => setView('report')} onBlock={handleBlock} confirmingBlock={confirmingBlock} setConfirmingBlock={setConfirmingBlock} busyKey={busyKey} />
      </div>
    )
  }

  return (
    <div
      role="presentation"
      style={{
        position: 'fixed', inset: 0, zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        background: mounted && !closing ? 'rgba(3,3,15,0.72)' : 'rgba(3,3,15,0)',
        backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)',
        transition: prefersReducedMotion ? 'none' : 'background 0.22s ease',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) requestClose() }}
    >
      <style>{`
        @keyframes gasSpin { to { transform: rotate(360deg); } }
        .gas-spinner { width: 15px; height: 15px; border-radius: 50%; border: 2px solid rgba(124,58,237,0.25); border-top-color: #b79bff; animation: gasSpin 0.7s linear infinite; display: inline-block; }
        .gas-action-row:hover:not(:disabled) { background: rgba(124,58,237,0.08) !important; }
        .gas-action-row:focus-visible { outline: 2px solid #9d6fff; outline-offset: 2px; }
        .gas-sheet-panel { width: 100%; max-width: 480px; border-radius: 22px 22px 0 0; }
        @media (min-width: 640px) {
          .gas-sheet-overlay { align-items: center !important; }
          .gas-sheet-panel { border-radius: 22px; max-width: 420px; margin-bottom: 0 !important; }
        }
      `}</style>
      <div
        ref={sheetRef}
        role="dialog"
        aria-modal="true"
        aria-label={isAr_ ? 'إجراءات الصديق' : 'Friend actions'}
        className="gas-sheet-panel"
        style={{
          background: 'linear-gradient(180deg, rgba(20,14,44,0.98), rgba(10,8,26,0.99))',
          border: '1px solid rgba(157,111,255,0.18)',
          borderBottom: 'none',
          boxShadow: '0 -20px 60px rgba(124,58,237,0.25), 0 -4px 24px rgba(0,0,0,0.5)',
          maxHeight: '86dvh', overflowY: 'auto',
          paddingLeft: safeLeft(0), paddingRight: safeRight(0), paddingBottom: safeBottom(14),
          transform: prefersReducedMotion ? 'none' : (mounted && !closing ? 'translateY(0)' : 'translateY(100%)'),
          opacity: prefersReducedMotion ? 1 : (mounted && !closing ? 1 : 0),
          transition: prefersReducedMotion ? 'none' : 'transform 0.28s cubic-bezier(.22,.9,.32,1), opacity 0.22s ease',
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(157,111,255,0.3)', margin: '10px auto 2px' }} />

        {(view !== 'menu') && !loading && (
          <button
            onClick={() => setView('menu')}
            style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '10px 16px 0', padding: '6px 4px', background: 'none', border: 'none', color: 'rgba(var(--fg-rgb),0.55)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}
          >
            <Icon name={isAr_ ? 'chevronFwd' : 'chevronBack'} size={15} /> {isAr_ ? 'رجوع' : 'Back'}
          </button>
        )}

        {view === 'menu' && header}

        {error && (
          <div style={{ margin: '0 20px 10px', padding: '9px 12px', borderRadius: 10, background: 'rgba(255,71,133,0.1)', border: '1px solid rgba(255,71,133,0.25)', color: '#ff9db8', fontSize: 12 }}>
            {error}
          </div>
        )}

        {body}
      </div>
    </div>
  )
}

function pillStyle(bg: string, color: string): CSSProperties {
  return { fontSize: 10.5, fontWeight: 700, color, background: bg, borderRadius: 7, padding: '3px 8px', whiteSpace: 'nowrap' }
}

const confirmBoxStyle: CSSProperties = { background: 'rgba(255,71,133,0.06)', border: '1px solid rgba(255,71,133,0.2)', borderRadius: 14, padding: '12px 14px', marginBottom: 8 }
const confirmTextStyle: CSSProperties = { fontSize: 12, color: 'rgba(var(--fg-rgb),0.65)', margin: '0 0 10px', lineHeight: 1.4 }
const confirmCancelBtnStyle: CSSProperties = { flex: 1, padding: '9px 12px', borderRadius: 10, background: 'rgba(var(--fg-rgb),0.07)', border: '1px solid rgba(var(--fg-rgb),0.1)', color: 'rgba(var(--fg-rgb),0.6)', fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: TAP_MIN }
const confirmDangerBtnStyle: CSSProperties = { flex: 1, padding: '9px 12px', borderRadius: 10, background: 'rgba(255,71,133,0.18)', border: '1px solid rgba(255,71,133,0.4)', color: '#ff6b95', fontSize: 12, fontWeight: 700, cursor: 'pointer', minHeight: TAP_MIN }

function SensitiveSection({ isAr, onReport, onBlock, confirmingBlock, setConfirmingBlock, busyKey }: {
  isAr: boolean; onReport: () => void; onBlock: () => void
  confirmingBlock: boolean; setConfirmingBlock: (v: boolean) => void; busyKey: string | null
}) {
  return (
    <>
      {!confirmingBlock && (
        <ActionRow icon="block" label={isAr ? 'حظر' : 'Block'} onClick={() => setConfirmingBlock(true)} danger />
      )}
      {confirmingBlock && (
        <div style={confirmBoxStyle}>
          <p style={confirmTextStyle}>{isAr ? 'سيتم حظر هذا المستخدم: لن يتمكن من مراسلتك، إرسال طلبات صداقة لك، أو رؤية نشاطك.' : 'This user will be blocked: they won’t be able to message you, send friend requests, or see your activity.'}</p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => setConfirmingBlock(false)} style={confirmCancelBtnStyle}>{isAr ? 'تراجع' : 'Cancel'}</button>
            <button onClick={onBlock} disabled={busyKey === 'block'} style={confirmDangerBtnStyle}>{isAr ? 'تأكيد الحظر' : 'Confirm Block'}</button>
          </div>
        </div>
      )}
      <ActionRow icon="report" label={isAr ? 'الإبلاغ' : 'Report'} onClick={onReport} danger />
    </>
  )
}

// --- Invite to Game sub-view -------------------------------------------------
// Sends a real chat message (the app's existing, fully working 1:1 messaging
// path) naming the specific game — no room is silently created on the
// friend's behalf, and no fake "invite sent" state is shown unless the
// message genuinely sent. Deliberately game-architecture-agnostic: Ludo,
// the quiz games, and any future multiplayer game all work identically here
// since this never has to know how each one's matchmaking works internally.
function InviteView({ isAr, friendId, onDone, setSheetError }: { isAr: boolean; friendId: string; onDone: () => void; setSheetError: (e: string | null) => void }) {
  const [games, setGames] = useState<Game[]>([])
  const [loading, setLoading] = useState(true)
  const [sendingId, setSendingId] = useState<string | null>(null)
  const [sentId, setSentId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    getGames().then((g) => { if (!cancelled) { setGames(g.filter((x) => x.is_active && x.is_multiplayer)); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  async function sendInvite(game: Game) {
    setSendingId(game.id); setSheetError(null)
    const { id, error } = await getOrCreateConversation(friendId)
    if (error || !id) { setSendingId(null); setSheetError(isAr ? 'تعذر إرسال الدعوة.' : 'Couldn’t send the invite.'); return }
    const name = isAr ? (game.name_ar || game.name) : game.name
    const text = isAr ? `\u{1F3AE} دعوة للعب ${name} — افتح الألعاب للانضمام!` : `\u{1F3AE} Invite to play ${name} — open Games to join!`
    const clientId = crypto.randomUUID()
    const { error: sendErr } = await sendMessage(id, text, clientId)
    setSendingId(null)
    if (sendErr) { setSheetError(isAr ? 'تعذر إرسال الدعوة.' : 'Couldn’t send the invite.'); return }
    setSentId(game.id)
    window.setTimeout(onDone, 900)
  }

  return (
    <div style={{ padding: '4px 20px 4px' }}>
      <p style={{ fontSize: 11.5, color: 'rgba(var(--fg-rgb),0.4)', margin: '0 0 12px' }}>{isAr ? 'اختر لعبة لدعوتهم إليها' : 'Pick a game to invite them to'}</p>
      {loading && <p style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)', textAlign: 'center', padding: '16px 0' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>}
      {!loading && games.length === 0 && <p style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.35)', textAlign: 'center', padding: '16px 0' }}>{isAr ? 'لا توجد ألعاب جماعية متاحة حاليًا' : 'No multiplayer games available right now'}</p>}
      {games.map((g) => (
        <ActionRow
          key={g.id}
          icon="invite"
          label={isAr ? (g.name_ar || g.name) : g.name}
          onClick={() => sendInvite(g)}
          busy={sendingId === g.id}
          disabled={sentId !== null}
        />
      ))}
      {sentId && <p style={{ fontSize: 12, color: '#34d399', textAlign: 'center', marginTop: 6, fontWeight: 700 }}>{isAr ? '✓ تم إرسال الدعوة' : '✓ Invite sent'}</p>}
    </div>
  )
}

// --- Compare Stats sub-view --------------------------------------------------
function CompareView({ isAr, myId, friendId }: { isAr: boolean; myId: string; friendId: string }) {
  const [mine, setMine] = useState<GameStat[] | null>(null)
  const [theirs, setTheirs] = useState<GameStat[] | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([getGameStats(myId), getGameStats(friendId)]).then(([a, b]) => {
      if (!cancelled) { setMine(a); setTheirs(b) }
    })
    return () => { cancelled = true }
  }, [myId, friendId])

  const loading = mine === null || theirs === null
  const gameIds = useMemo(() => {
    if (!mine || !theirs) return []
    const ids = new Set<string>([...mine.map((m) => m.game_id), ...theirs.map((m) => m.game_id)])
    return Array.from(ids)
  }, [mine, theirs])

  return (
    <div style={{ padding: '4px 20px 8px' }}>
      {loading && <p style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)', textAlign: 'center', padding: '16px 0' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>}
      {!loading && gameIds.length === 0 && (
        <p style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.35)', textAlign: 'center', padding: '16px 0' }}>{isAr ? 'لا توجد إحصائيات بعد لأي منكما' : 'Neither of you has stats yet'}</p>
      )}
      {!loading && gameIds.map((gid) => {
        const m = mine!.find((x) => x.game_id === gid)
        const t = theirs!.find((x) => x.game_id === gid)
        const game = m?.game ?? t?.game
        const myScore = m?.best_score ?? 0
        const theirScore = t?.best_score ?? 0
        const max = Math.max(myScore, theirScore, 1)
        return (
          <div key={gid} style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--foreground)', marginBottom: 8 }}>{game ? (isAr ? (game.name_ar || game.name) : game.name) : gid}</div>
            <StatBar isAr={isAr} label={isAr ? 'أنت' : 'You'} value={myScore} max={max} color="#7c3aed" playCount={m?.games_played ?? 0} wins={m?.wins ?? 0} />
            <StatBar isAr={isAr} label={isAr ? 'صديقك' : 'Friend'} value={theirScore} max={max} color="#00d4ff" playCount={t?.games_played ?? 0} wins={t?.wins ?? 0} />
          </div>
        )
      })}
    </div>
  )
}

function StatBar({ isAr, label, value, max, color, playCount, wins }: { isAr: boolean; label: string; value: number; max: number; color: string; playCount: number; wins: number }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: 'rgba(var(--fg-rgb),0.5)', marginBottom: 3 }}>
        <span>{label}</span>
        <span>{isAr ? `أفضل نتيجة ${value.toLocaleString()} · ${playCount} مباراة · ${wins} فوز` : `Best ${value.toLocaleString()} · ${playCount} plays · ${wins} wins`}</span>
      </div>
      <div style={{ height: 7, borderRadius: 4, background: 'rgba(var(--fg-rgb),0.06)', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${Math.max(3, (value / max) * 100)}%`, background: color, borderRadius: 4, transition: 'width 0.4s ease' }} />
      </div>
    </div>
  )
}

// --- View Achievements sub-view ---------------------------------------------
function AchievementsView({ isAr, friendId }: { isAr: boolean; friendId: string }) {
  const [badges, setBadges] = useState<PublicAchievement[] | null>(null)
  useEffect(() => {
    let cancelled = false
    getUserPublicAchievements(friendId).then((b) => { if (!cancelled) setBadges(b) })
    return () => { cancelled = true }
  }, [friendId])

  return (
    <div style={{ padding: '4px 20px 12px' }}>
      {badges === null && <p style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)', textAlign: 'center', padding: '16px 0' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>}
      {badges?.length === 0 && <p style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.35)', textAlign: 'center', padding: '16px 0' }}>{isAr ? 'لا توجد شارات بعد' : 'No badges unlocked yet'}</p>}
      {badges && badges.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {badges.map((b) => (
            <div key={b.achievement_id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={isAr ? b.name_ar : b.name}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: `${RARITY_COLOR[b.rarity] ?? '#9d6fff'}18`, border: `1.5px solid ${RARITY_COLOR[b.rarity] ?? '#9d6fff'}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 22 }}>
                {b.icon}
              </div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(var(--fg-rgb),0.5)', textAlign: 'center', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', width: '100%' }}>
                {isAr ? b.name_ar : b.name}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// --- Report sub-view ---------------------------------------------------------
function ReportView({ isAr, friendId, onSubmitted }: { isAr: boolean; friendId: string; onSubmitted: () => void }) {
  const [category, setCategory] = useState<ReportCategory | null>(null)
  const [description, setDescription] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function submit() {
    if (!category) return
    setSubmitting(true); setError(null)
    const { error: err } = await reportUser(friendId, null, description.trim(), category)
    setSubmitting(false)
    if (err) { setError(isAr ? 'تعذر إرسال البلاغ. حاول مرة أخرى.' : 'Couldn’t submit the report. Please try again.'); return }
    setDone(true)
    window.setTimeout(onSubmitted, 1000)
  }

  if (done) {
    return (
      <div style={{ padding: '20px 20px 30px', textAlign: 'center' }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: '#34d399' }}>{isAr ? '✓ تم إرسال البلاغ' : '✓ Report submitted'}</p>
        <p style={{ fontSize: 11.5, color: 'rgba(var(--fg-rgb),0.4)', marginTop: 4 }}>{isAr ? 'شكرًا لك، سيتم مراجعته.' : 'Thank you — our team will review it.'}</p>
      </div>
    )
  }

  return (
    <div style={{ padding: '4px 20px 16px' }}>
      <p style={{ fontSize: 11.5, color: 'rgba(var(--fg-rgb),0.4)', margin: '0 0 10px' }}>{isAr ? 'اختر سبب الإبلاغ' : 'Select a reason for reporting'}</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {REPORT_CATEGORIES.map((c) => (
          <button
            key={c.key}
            onClick={() => setCategory(c.key)}
            style={{
              padding: '8px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600, cursor: 'pointer', minHeight: TAP_MIN,
              border: `1px solid ${category === c.key ? 'rgba(255,71,133,0.5)' : 'rgba(var(--fg-rgb),0.1)'}`,
              background: category === c.key ? 'rgba(255,71,133,0.15)' : 'rgba(var(--fg-rgb),0.04)',
              color: category === c.key ? '#ff6b95' : 'rgba(var(--fg-rgb),0.6)',
            }}
          >
            {isAr ? c.ar : c.en}
          </button>
        ))}
      </div>
      <label style={{ fontSize: 11.5, color: 'rgba(var(--fg-rgb),0.4)', display: 'block', marginBottom: 6 }}>{isAr ? 'وصف إضافي (اختياري)' : 'Additional description (optional)'}</label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value.slice(0, 500))}
        placeholder={isAr ? 'أخبرنا بمزيد من التفاصيل...' : 'Tell us more…'}
        rows={4}
        style={{ width: '100%', borderRadius: 12, border: '1px solid rgba(var(--fg-rgb),0.1)', background: 'rgba(var(--fg-rgb),0.03)', color: 'var(--foreground)', padding: '10px 12px', fontSize: 13, resize: 'vertical', marginBottom: 12, fontFamily: 'inherit' }}
      />
      {error && <p style={{ fontSize: 11.5, color: '#ff6b95', marginBottom: 10 }}>{error}</p>}
      <button
        onClick={submit}
        disabled={!category || submitting}
        style={{
          width: '100%', padding: '12px 16px', borderRadius: 12, border: 'none', minHeight: TAP_MIN,
          background: !category ? 'rgba(var(--fg-rgb),0.08)' : 'linear-gradient(135deg, #ff4785, #d6336c)',
          color: !category ? 'rgba(var(--fg-rgb),0.35)' : '#fff', fontSize: 13.5, fontWeight: 800,
          cursor: !category || submitting ? 'default' : 'pointer', opacity: submitting ? 0.7 : 1,
        }}
      >
        {submitting ? (isAr ? 'جارٍ الإرسال...' : 'Submitting…') : (isAr ? 'إرسال البلاغ' : 'Submit Report')}
      </button>
    </div>
  )
}
