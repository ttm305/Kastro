import { useEffect, useState } from 'react'
import type { Lang } from '../App'
import Avatar from './Avatar'
import {
  getPublicProfile,
  getUserPublicAchievements,
  levelProgress,
  getPresence,
  getBlockStatus,
  unblockUser,
  reportUser,
  type PublicProfile,
  type PublicAchievement,
  type FriendPresence,
  type CosmeticItem,
} from '../lib/api'
import { useAuth } from '../lib/auth'
import { formatPresence } from '../lib/presenceFormat'
import { getCosmeticCatalog, resolveCosmetics, frameAvatarStyle } from '../lib/cosmetics'
import CosmeticBannerLayer from './CosmeticBannerLayer'

interface Props {
  userId: string
  lang: Lang
  onClose: () => void
  /** Whether userId is already a confirmed friend — hides Remove/Block-irrelevant actions for non-friends (Requests/Discover cards). */
  isFriend?: boolean
  onMessage?: (user: { id: string; username: string; avatar_url?: string | null }) => void
  onRemove?: (userId: string) => void
  onBlock?: (userId: string) => void
}

const RARITY_COLOR: Record<string, string> = { common: '#9ca3af', uncommon: '#34d399', rare: '#60a5fa', epic: '#c084fc', legendary: '#ffd700' }
const RARITY_AR: Record<string, string> = { common: 'عادي', uncommon: 'غير شائع', rare: 'نادر', epic: 'ملحمي', legendary: 'أسطوري' }
// Same fallback as ProfileScreen's hero — the header band here must never
// render blank for a viewed user who hasn't uploaded a cover photo.
const DEFAULT_HEADER_GRADIENT = 'linear-gradient(135deg, #1a0b3d 0%, #4c1d95 45%, #0891b2 100%)'

/**
 * Read-only profile card for a friend / friend-request / suggestion — reachable
 * from FriendsScreen. Pulls from get_public_profiles + get_user_public_achievements,
 * both SECURITY DEFINER RPCs that expose only the non-sensitive subset of a
 * profile (no email, no access code, no role) — the same "public within KASTRO"
 * model the leaderboard and friends list already rely on.
 */
export default function FriendProfileSheet({ userId, lang, onClose, isFriend, onMessage, onRemove, onBlock }: Props) {
  const isAr = lang === 'ar'
  const { profile: myProfile } = useAuth()
  const [profile, setProfile] = useState<PublicProfile | null>(null)
  const [badges, setBadges] = useState<PublicAchievement[]>([])
  const [catalog, setCatalog] = useState<CosmeticItem[]>([])
  const [presence, setPresence] = useState<FriendPresence | null>(null)
  const [blockStatus, setBlockStatus] = useState<{ blockedByMe: boolean; blockedMe: boolean }>({ blockedByMe: false, blockedMe: false })
  const [loading, setLoading] = useState(true)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [confirmingBlock, setConfirmingBlock] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const [p, a, [pres], status] = await Promise.all([
        getPublicProfile(userId),
        getUserPublicAchievements(userId),
        getPresence([userId]),
        myProfile?.id ? getBlockStatus(userId, myProfile.id) : Promise.resolve({ blockedByMe: false, blockedMe: false }),
      ])
      if (!cancelled) {
        setProfile(p)
        setBadges(a)
        setPresence(pres ?? null)
        setBlockStatus(status)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  // Same "don't let Online go stale" contract as FriendsScreen/ChatConversation
  // — this sheet can stay open a while, so re-ask get_presence() periodically
  // and immediately on foreground instead of trusting the one-time fetch above.
  useEffect(() => {
    let cancelled = false
    const refreshPresence = async () => {
      const [pres] = await getPresence([userId])
      if (!cancelled) setPresence(pres ?? null)
    }
    const id = window.setInterval(refreshPresence, 15000)
    const onForeground = () => { if (document.visibilityState === 'visible') refreshPresence() }
    document.addEventListener('visibilitychange', onForeground)
    window.addEventListener('focus', onForeground)
    return () => {
      cancelled = true
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', onForeground)
      window.removeEventListener('focus', onForeground)
    }
  }, [userId])

  // Cosmetic catalog is user-independent, so it's fetched once and reused —
  // still a fresh DB read (see cosmetics.ts), just not re-fetched per friend.
  useEffect(() => { getCosmeticCatalog().then(setCatalog) }, [])

  const progress = profile ? levelProgress(profile.xp) : null
  // Resolved strictly from this viewed user's own profile.equipped_*_id
  // (via get_public_profiles, refetched fresh every time the sheet opens
  // for a given userId) — never from anything local to the viewer, so
  // another account opening this same sheet sees exactly the same result.
  const equipped = profile ? resolveCosmetics(catalog, profile) : null

  async function handleUnblock() {
    await unblockUser(userId)
    setBlockStatus((s) => ({ ...s, blockedByMe: false }))
  }

  async function handleReport() {
    const reason = window.prompt(isAr ? 'صف سبب الإبلاغ' : 'Describe the reason for reporting')
    if (!reason?.trim()) return
    await reportUser(userId, null, reason.trim())
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(3,3,15,0.88)', zIndex: 300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{ background: 'var(--surface-1)', borderRadius: '20px 20px 0 0', width: '100%', maxWidth: 480, maxHeight: '88dvh', overflowY: 'auto', border: '1px solid rgba(var(--fg-rgb),0.08)', borderBottom: 'none' }}>
        <div style={{ width: 36, height: 4, borderRadius: 2, background: 'rgba(var(--fg-rgb),0.15)', margin: '10px auto 0' }} />

        {loading && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)', padding: '30px 20px' }}>{isAr ? 'جارٍ التحميل...' : 'Loading…'}</p>
        )}

        {!loading && !profile && (
          <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(var(--fg-rgb),0.4)', padding: '30px 20px' }}>{isAr ? 'تعذر تحميل الملف الشخصي' : 'Could not load this profile'}</p>
        )}

        {!loading && profile && progress && (
          <>
            {/* Header band — this user's own cover image (never the viewer's),
                fetched via the same public get_public_profiles RPC as the
                rest of this sheet's data, so it's automatically covered by
                that RPC's existing "public within KASTRO" visibility model
                with no separate read path. Falls back to a premium default
                gradient, never blank. */}
            <div style={{ position: 'relative', height: 186, marginTop: 14, overflow: 'hidden', background: profile.header_url || equipped?.banner ? undefined : DEFAULT_HEADER_GRADIENT }}>
              {profile.header_url ? (
                <>
                  <img src={profile.header_url} alt="" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(3,3,15,0.1) 0%, rgba(3,3,15,0.06) 40%, rgba(3,3,15,0.5) 72%, rgba(3,3,15,0.8) 100%)' }} />
                </>
              ) : equipped?.banner ? (
                <>
                  <CosmeticBannerLayer banner={equipped.banner} fallbackGradient={DEFAULT_HEADER_GRADIENT} />
                  <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(3,3,15,0.1) 0%, rgba(3,3,15,0.06) 40%, rgba(3,3,15,0.5) 72%, rgba(3,3,15,0.8) 100%)' }} />
                </>
              ) : (
                <div className="bg-stars" style={{ position: 'absolute', inset: 0, opacity: 0.6 }} />
              )}
            </div>

            <div style={{ padding: '0 20px max(20px, calc(16px + env(safe-area-inset-bottom)))' }}>
              {/* Avatar overlapping header band. The previous -68 margin had
                  the avatar poking out PAST the header's bottom edge (header
                  ended at Y=150, avatar spanned Y=82-166 — 16px of the
                  avatar hung below the header), matching the same bug fixed
                  in ProfileScreen. Fix: avatar's absolute position is pinned
                  (top stays at Y=82, unchanged) while the header grew from
                  150 to 186; marginTop grows by the same 36px purely to keep
                  the avatar's on-screen position fixed. Net effect: header
                  now extends ~20px past the avatar's bottom edge (Y=186 vs
                  avatar bottom Y=166). */}
              {/* Avatar-only block — kept separate from the text block below
                  it so the two have independent spacing. This block alone
                  carries the negative margin that overlaps the avatar onto
                  the header (avatar bottom = 180, header bottom = 200, a
                  20px overlap by design). marginBottom:36 then reserves
                  clearance so the text block starts at 180+36=216, safely
                  16px AFTER the header ends (200) instead of 10px before it
                  — that 10px shortfall was why the header image was visibly
                  covering the username. */}
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: -104, marginBottom: 36 }}>
                <div style={{ position: 'relative' }}>
                  <Avatar url={profile.avatar_url} size={84} style={frameAvatarStyle(equipped?.frame ?? null, '3px solid var(--surface-1)')} frame={equipped?.frame ?? null} />
                  {equipped?.decoration && (
                    <span
                      style={{ position: 'absolute', top: -8, right: isAr ? 'auto' : -8, left: isAr ? -8 : 'auto', fontSize: 26, lineHeight: 1, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.4))', pointerEvents: 'none' }}
                    >
                      {equipped.decoration.icon}
                    </span>
                  )}
                  <div style={{ position: 'absolute', bottom: 3, right: isAr ? 'auto' : 3, left: isAr ? 3 : 'auto', width: 16, height: 16, borderRadius: '50%', background: presence?.is_online ? '#10b981' : '#4b5563', border: '3px solid var(--surface-1)' }} />
                </div>
              </div>

              {/* Text block sits entirely below the header now, with an
                  explicit solid background (matching the sheet's own
                  surface color) as a defensive measure so the header image
                  can never visually bleed through regardless of stacking
                  order. */}
              <div style={{ position: 'relative', background: 'var(--surface-1)', textAlign: 'center', marginBottom: 20 }}>
                {/* Usernames are plain user-chosen identifiers — use the
                    app's regular UI font, not the decorative "Exo 2"
                    display font (its stylized glyphs, e.g. a slanted
                    uppercase T, made short usernames like "@T" look
                    distorted). */}
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--foreground)' }}>@{profile.username}</div>
                {equipped?.title && (
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#9d6fff', marginTop: 3 }}>
                    {equipped.title.icon} {isAr ? (equipped.title.label_ar || equipped.title.label) : equipped.title.label}
                  </div>
                )}
                <div style={{ fontSize: 12, color: presence?.is_in_game ? '#fbbf24' : presence?.is_online ? '#10b981' : 'rgba(var(--fg-rgb),0.35)', marginTop: 2 }}>
                  {presence?.is_in_game
                    ? (isAr ? `يلعب الآن: ${presence.game_name_ar ?? presence.game_name}` : `Playing ${presence.game_name}`)
                    : formatPresence(!!presence?.is_online, presence?.last_seen_at, isAr)}
                </div>
                {blockStatus.blockedByMe && (
                  <div style={{ fontSize: 11, color: '#ff4785', marginTop: 4, fontWeight: 600 }}>{isAr ? 'لقد حظرت هذا المستخدم' : "You've blocked this user"}</div>
                )}
                {profile.branch_name && (
                  <div style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.45)', marginTop: 4 }}>{isAr ? (profile.branch_name_ar || profile.branch_name) : profile.branch_name}</div>
                )}
                {profile.bio && (
                  <p style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.55)', textAlign: 'center', margin: '10px auto 0', lineHeight: 1.5, maxWidth: 320 }}>{profile.bio}</p>
                )}
              </div>

            {/* Level + XP progress */}
            <div style={{ background: 'rgba(var(--fg-rgb),0.04)', border: '1px solid rgba(var(--fg-rgb),0.08)', borderRadius: 12, padding: '14px 16px', marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#9d6fff', fontFamily: "'Exo 2', sans-serif" }}>{isAr ? `المستوى ${progress.level}` : `Level ${progress.level}`}</span>
                <span style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)' }}>{progress.xpIntoLevel} / {progress.xpForNext} XP</span>
              </div>
              <div style={{ height: 6, background: 'rgba(var(--fg-rgb),0.06)', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ height: '100%', width: '100%', transform: `scaleX(${progress.pct})`, transformOrigin: isAr ? 'right center' : 'left center', background: 'linear-gradient(90deg,#7c3aed,#9d6fff)', borderRadius: 3, transition: 'transform 0.4s' }} />
              </div>
              <div style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)', marginTop: 6 }}>{isAr ? `${profile.xp.toLocaleString()} XP إجمالي` : `${profile.xp.toLocaleString()} total XP`}</div>
            </div>

            {/* Streaks */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div style={{ background: 'rgba(var(--fg-rgb),0.04)', border: '1px solid rgba(var(--fg-rgb),0.08)', borderRadius: 12, padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#ff6b35', fontFamily: "'Exo 2', sans-serif" }}>🔥 {profile.streak_count}</div>
                <div style={{ fontSize: 10, color: 'rgba(var(--fg-rgb),0.4)', marginTop: 3 }}>{isAr ? 'أيام متتالية' : 'Day streak'}</div>
              </div>
              <div style={{ background: 'rgba(var(--fg-rgb),0.04)', border: '1px solid rgba(var(--fg-rgb),0.08)', borderRadius: 12, padding: '12px', textAlign: 'center' }}>
                <div style={{ fontSize: 20, fontWeight: 800, color: '#00d4ff', fontFamily: "'Exo 2', sans-serif" }}>📅 {profile.weekly_streak_count}</div>
                <div style={{ fontSize: 10, color: 'rgba(var(--fg-rgb),0.4)', marginTop: 3 }}>{isAr ? 'أسابيع متتالية' : 'Week streak'}</div>
              </div>
            </div>

            {/* Badges */}
            <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 }}>
              {isAr ? `الشارات (${badges.length})` : `Badges (${badges.length})`}
            </div>
            {badges.length === 0 && (
              <p style={{ fontSize: 12, color: 'rgba(var(--fg-rgb),0.35)', padding: '10px 0 4px' }}>{isAr ? 'لا توجد شارات بعد' : 'No badges unlocked yet'}</p>
            )}
            {badges.length > 0 && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 8 }}>
                {badges.map((b) => (
                  <div key={b.achievement_id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }} title={isAr ? b.name_ar : b.name}>
                    <div style={{ width: 52, height: 52, borderRadius: 14, background: `${RARITY_COLOR[b.rarity] ?? '#9d6fff'}18`, border: `1.5px solid ${RARITY_COLOR[b.rarity] ?? '#9d6fff'}55`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24 }}>
                      {b.icon}
                    </div>
                    <div style={{ fontSize: 9, fontWeight: 700, color: RARITY_COLOR[b.rarity] ?? '#9d6fff', textTransform: 'uppercase', letterSpacing: 0.4 }}>
                      {isAr ? (RARITY_AR[b.rarity] ?? b.rarity) : b.rarity}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            {!blockStatus.blockedByMe && (isFriend || onMessage) && (
              <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
                {isFriend && onMessage && (
                  <button
                    onClick={() => onMessage({ id: userId, username: profile.username, avatar_url: profile.avatar_url })}
                    style={{ flex: 1, padding: '11px 16px', borderRadius: 10, background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', border: 'none', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
                  >
                    {isAr ? '💬 مراسلة' : '💬 Message'}
                  </button>
                )}
              </div>
            )}

            {isFriend && (onRemove || onBlock) && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                {onRemove && !confirmingRemove && (
                  <button onClick={() => setConfirmingRemove(true)} style={{ flex: 1, padding: '10px 14px', borderRadius: 10, background: 'rgba(var(--fg-rgb),0.06)', border: '1px solid rgba(var(--fg-rgb),0.1)', color: 'rgba(var(--fg-rgb),0.6)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    {isAr ? 'إزالة صديق' : 'Remove friend'}
                  </button>
                )}
                {onRemove && confirmingRemove && (
                  <button onClick={() => onRemove(userId)} style={{ flex: 1, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,71,133,0.15)', border: '1px solid rgba(255,71,133,0.35)', color: '#ff4785', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                    {isAr ? 'تأكيد الإزالة' : 'Confirm remove'}
                  </button>
                )}
                {onBlock && !confirmingBlock && (
                  <button onClick={() => setConfirmingBlock(true)} style={{ flex: 1, padding: '10px 14px', borderRadius: 10, background: 'rgba(var(--fg-rgb),0.06)', border: '1px solid rgba(var(--fg-rgb),0.1)', color: 'rgba(var(--fg-rgb),0.6)', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>
                    {isAr ? 'حظر' : 'Block'}
                  </button>
                )}
                {onBlock && confirmingBlock && (
                  <button onClick={() => onBlock(userId)} style={{ flex: 1, padding: '10px 14px', borderRadius: 10, background: 'rgba(255,71,133,0.15)', border: '1px solid rgba(255,71,133,0.35)', color: '#ff4785', fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                    {isAr ? 'تأكيد الحظر' : 'Confirm block'}
                  </button>
                )}
              </div>
            )}

            {blockStatus.blockedByMe && (
              <button onClick={handleUnblock} style={{ width: '100%', marginTop: 16, padding: '11px 16px', borderRadius: 10, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>
                {isAr ? 'إلغاء الحظر' : 'Unblock'}
              </button>
            )}

            <button onClick={handleReport} style={{ width: '100%', marginTop: 8, padding: '9px 16px', borderRadius: 10, background: 'transparent', border: 'none', color: 'rgba(var(--fg-rgb),0.35)', fontSize: 11.5, fontWeight: 600, cursor: 'pointer' }}>
              {isAr ? '🚩 الإبلاغ عن هذا المستخدم' : '🚩 Report this user'}
            </button>

            <button
              onClick={onClose}
              style={{ width: '100%', justifyContent: 'center', marginTop: 8, padding: '11px 16px', borderRadius: 10, background: 'rgba(var(--fg-rgb),0.06)', border: '1px solid rgba(var(--fg-rgb),0.1)', color: 'rgba(var(--fg-rgb),0.7)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}
            >
              {isAr ? 'إغلاق' : 'Close'}
            </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
