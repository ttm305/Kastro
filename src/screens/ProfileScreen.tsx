import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Screen, Lang, UserRole } from '../App'
import { useAuth } from '../lib/auth'
import { useTheme, type ThemePreference } from '../lib/theme'
import { isPushSupported, getNotificationPermission, isPushSubscribedLocally, enablePush, disablePush } from '../lib/push'
import { isNativePlatform, enableNativePush, disableNativePush } from '../lib/nativePush'
import Avatar from '../components/Avatar'
import AvatarPickerModal from '../components/AvatarPickerModal'
import HeaderPickerModal from '../components/HeaderPickerModal'
import CosmeticBannerLayer from '../components/CosmeticBannerLayer'
import { safeTop, safeLeft, safeRight, tapTarget, tapTargetMinHeight } from '../lib/safeArea'
import {
  getAchievementsWithStatus,
  getProfileStats,
  getActivityLog,
  getCosmetics,
  equipCosmetic,
  getActiveSeason,
  getSeasonTrack,
  getLeaderboard,
  updateProfile,
  updateUsername,
  getFavoriteGame,
  getBranches,
  getXpHistory,
  getGameStats,
  type Branch,
  type XpLedgerEntry,
  type GameStat,
  type CosmeticItem,
} from '../lib/api'
import { getCosmeticCatalog, resolveCosmetics, frameAvatarStyle, bannerBackground } from '../lib/cosmetics'

const MAX_USERNAME_LEN = 24
// Matches the DB-side `profiles_display_name_length` check constraint.
// Unlike username, Display Name has no minimum length or uniqueness rule —
// it's a free-form label, not an identifier.
const MAX_DISPLAY_NAME_LEN = 40

// Shown whenever a user has neither a custom cover photo nor an owned/
// equipped "Profile Banner" cosmetic — previously this fell through to
// `background: undefined` (a plain transparent 160px strip), which is
// almost certainly what read as "too much empty space at the top" for any
// account that hasn't bought a banner from the shop. A real gradient here
// means the hero never renders blank.
const DEFAULT_HERO_GRADIENT = 'linear-gradient(135deg, #1a0b3d 0%, #4c1d95 45%, #0891b2 100%)'

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  setLang: (l: Lang) => void
  userRole?: UserRole
  onSignOut: () => Promise<void>
  /**
   * When set, this screen is being shown inside the Plato-style slide-over
   * (see ProfileOverlayHost/App.tsx) rather than as its own full-screen
   * route — renders a back arrow that closes the overlay (reversing the
   * slide animation) instead of the plain bottom-nav-tab chrome this screen
   * used to have. Omitted entirely for the few remaining call sites that
   * still navigate here as a full screen (e.g. Achievements/Season Pass/
   * Tournament/Admin's own back buttons), which keep today's no-back-arrow
   * look unchanged.
   */
  onClose?: () => void
}

type Tab = 'stats' | 'badges' | 'activity' | 'season'

type AchievementWithStatus = Awaited<ReturnType<typeof getAchievementsWithStatus>>[number]
type CosmeticsData = Awaited<ReturnType<typeof getCosmetics>>
type ProfileStatsData = Awaited<ReturnType<typeof getProfileStats>>
type ActivityRow = Awaited<ReturnType<typeof getActivityLog>>[number]
type SeasonData = Awaited<ReturnType<typeof getActiveSeason>>
type SeasonTrackData = Awaited<ReturnType<typeof getSeasonTrack>>

type Rarity = 'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary'

interface Badge {
  id: string
  nameEn: string
  nameAr: string
  rarity: Rarity
  rarityAr: string
  color: string
  bg: string
  earned: boolean
  desc: string
  descAr: string
}

const RARITY_AR: Record<string, string> = {
  common: 'عادي',
  uncommon: 'غير شائع',
  rare: 'نادر',
  epic: 'ملحمي',
  legendary: 'أسطوري',
}

function capitalizeRarity(r: string): Rarity {
  return (r.charAt(0).toUpperCase() + r.slice(1)) as Rarity
}

function toBadge(a: AchievementWithStatus): Badge {
  return {
    id: a.id,
    nameEn: a.name,
    nameAr: a.name_ar,
    rarity: capitalizeRarity(a.rarity),
    rarityAr: RARITY_AR[a.rarity] ?? a.rarity,
    color: a.color,
    bg: `${a.color}14`,
    earned: a.unlocked,
    desc: a.description,
    descAr: a.description_ar,
  }
}

const ACTIVITY_COLORS: Record<string, string> = {
  rank_up: '#ffd700',
  leaderboard: '#ffd700',
  achievement: '#60a5fa',
  achievement_unlocked: '#60a5fa',
  game_completed: '#9d6fff',
  game: '#9d6fff',
  streak: '#ff6b35',
  challenge: '#00d4ff',
  weekly_challenge: '#00d4ff',
}

function activityColor(eventType: string): string {
  return ACTIVITY_COLORS[eventType] ?? '#9d6fff'
}

function timeAgo(iso: string, isAr: boolean): string {
  const diffMs = Math.max(0, Date.now() - new Date(iso).getTime())
  const mins = Math.floor(diffMs / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days > 0) return isAr ? `${days} يوم` : `${days}d`
  if (hrs > 0) return isAr ? `${hrs} ساعة` : `${hrs}h`
  return isAr ? `${Math.max(mins, 1)} د` : `${Math.max(mins, 1)}m`
}

const RARITY_ORDER: Rarity[] = ['Legendary', 'Epic', 'Rare', 'Uncommon', 'Common']

function BadgeMark({ badge, size = 56 }: { badge: Badge; size?: number }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: Math.round(size * 0.28),
      background: badge.bg,
      border: `1.5px solid ${badge.color}40`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      position: 'relative',
      filter: badge.earned ? 'none' : 'grayscale(0.8)',
      opacity: badge.earned ? 1 : 0.45,
      boxShadow: badge.earned ? `0 0 12px ${badge.color}25` : 'none',
    }}>
      <svg width={size * 0.5} height={size * 0.5} viewBox="0 0 24 24" fill="none">
        <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26" fill={badge.color} opacity="0.9"/>
      </svg>
      {!badge.earned && (
        <div style={{ position: 'absolute', inset: 0, borderRadius: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg2-rgb),0.4)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
      )}
    </div>
  )
}

const APPEARANCE_OPTIONS: { key: ThemePreference; en: string; ar: string }[] = [
  { key: 'light', en: 'Light', ar: 'فاتح' },
  { key: 'dark', en: 'Dark', ar: 'داكن' },
  { key: 'system', en: 'System', ar: 'تلقائي' },
]

function AppearanceIcon({ mode, color }: { mode: ThemePreference; color: string }) {
  if (mode === 'light') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </svg>
    )
  }
  if (mode === 'dark') {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
      </svg>
    )
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4" width="20" height="13" rx="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  )
}

function AppearancePicker({ isAr }: { isAr: boolean }) {
  const { preference, setPreference } = useTheme()
  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {isAr ? 'المظهر' : 'Appearance'}
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        {APPEARANCE_OPTIONS.map((opt) => {
          const active = preference === opt.key
          return (
            <button
              key={opt.key}
              onClick={() => setPreference(opt.key)}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6,
                padding: '10px 6px', borderRadius: 12, cursor: 'pointer',
                border: `1px solid ${active ? '#9d6fff' : 'rgba(var(--fg-rgb),0.08)'}`,
                background: active ? 'rgba(157,111,255,0.14)' : 'rgba(var(--fg-rgb),0.04)',
              }}
            >
              <AppearanceIcon mode={opt.key} color={active ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.6)'} />
              <span className={isAr ? 'font-cairo' : ''} style={{ fontSize: 11, fontWeight: 600, color: active ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.6)' }}>
                {isAr ? opt.ar : opt.en}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Enable/disable push notifications for this device. Branches entirely on
 * isNativePlatform(): inside a Capacitor-wrapped iOS/Android build this
 * uses native push (FCM device token) via src/lib/nativePush.ts, because
 * neither iOS nor Android's WKWebView/WebView actually implements the
 * browser Push API — isPushSupported() would (correctly) report false
 * there, which used to surface the misleading "not supported in this
 * browser" message even though push genuinely works in that build, just
 * through a different mechanism. In a plain browser tab or installed PWA,
 * behavior is unchanged from before (src/lib/push.ts, Web Push/VAPID).
 *
 * Deliberately checks both sides of the subscription independently: the
 * server's has_push_subscription() (do I have *any* device registered at
 * all) and this exact device's local state (isPushSubscribedLocally, or
 * the native permission status) — they can drift (e.g. permission revoked
 * via OS settings without the app ever hearing about it), and the toggle
 * should reflect *this* device's real, current state rather than trusting
 * either alone.
 */
function PushNotificationToggle({ isAr }: { isAr: boolean }) {
  const [isNative, setIsNative] = useState(false)
  const [supported, setSupported] = useState(true)
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('default')
  const [subscribedHere, setSubscribedHere] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const native = isNativePlatform()
    setIsNative(native)
    if (native) {
      // Native push permission state isn't exposed as a simple sync read
      // the way Notification.permission is for Web Push — has_push_subscription()
      // (queried by the parent settings screen and passed down isn't
      // available here, so fall back to "supported, unknown subscribed
      // state until the user interacts" rather than an extra round trip
      // just for initial toggle position.
      setSupported(true)
      setPermission('default')
      setSubscribedHere(false)
    } else {
      setSupported(isPushSupported())
      setPermission(getNotificationPermission())
      isPushSubscribedLocally().then(setSubscribedHere)
    }
  }, [])

  async function handleToggle() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      if (subscribedHere) {
        const { error: err } = isNative ? await disableNativePush() : await disablePush()
        if (err) { setError(err); return }
        setSubscribedHere(false)
      } else {
        const { error: err } = isNative ? await enableNativePush() : await enablePush()
        if (err) {
          setError(
            err === 'permission_denied'
              ? (isAr ? 'تم رفض إذن الإشعارات من إعدادات النظام.' : 'Notification permission was denied in system settings.')
              : (isAr ? 'تعذّر تفعيل الإشعارات.' : 'Could not enable notifications.')
          )
          return
        }
        setSubscribedHere(true)
        if (isNative) setPermission('granted')
      }
      if (!isNative) setPermission(getNotificationPermission())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card" style={{ padding: '14px 16px', marginBottom: 10 }}>
      <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
        {isAr ? 'الإشعارات' : 'Notifications'}
      </p>
      {!supported ? (
        <p style={{ margin: 0, fontSize: 12, color: 'rgba(var(--fg2-rgb),0.5)' }}>
          {isAr
            ? 'الإشعارات غير مدعومة في هذا المتصفح. على iOS، أضف CareerXP إلى الشاشة الرئيسية أولاً.'
            : 'Push notifications aren’t supported in this browser. On iOS, add CareerXP to your Home Screen first.'}
        </p>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
              {isAr ? 'الإشعارات' : 'Push notifications'}
            </p>
            <p style={{ margin: '2px 0 0', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)' }}>
              {permission === 'denied'
                ? (isAr ? 'محظورة من إعدادات المتصفح' : 'Blocked in browser settings')
                : subscribedHere
                  ? (isAr ? 'مفعّلة على هذا الجهاز' : 'Enabled on this device')
                  : (isAr
                      ? 'رسائل جديدة، بطولات، تحديات، وطلبات صداقة'
                      : 'New messages, tournaments, challenges, and friend requests')}
            </p>
          </div>
          <button
            onClick={handleToggle}
            disabled={busy || permission === 'denied'}
            style={{
              width: 46, height: 26, borderRadius: 13, border: 'none', cursor: permission === 'denied' ? 'default' : 'pointer',
              background: subscribedHere ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(var(--fg-rgb),0.12)',
              position: 'relative', flexShrink: 0, opacity: busy ? 0.6 : 1,
            }}
          >
            <span style={{
              position: 'absolute', top: 3, left: subscribedHere ? 23 : 3, width: 20, height: 20, borderRadius: '50%',
              background: '#fff', transition: 'left 0.15s ease',
            }} />
          </button>
        </div>
      )}
      {error && <p style={{ margin: '8px 0 0', fontSize: 11, color: '#f87171' }}>{error}</p>}
    </div>
  )
}

export default function ProfileScreen({ onNavigate, lang, setLang, userRole = 'player', onSignOut, onClose }: Props) {
  const { profile, refreshProfile } = useAuth()
  const [tab, setTab] = useState<Tab>('stats')
  const [selectedFrame, setSelectedFrame] = useState<string | null>(null)
  const [selectedBanner, setSelectedBanner] = useState<string | null>(null)
  const [selectedTitle, setSelectedTitle] = useState<string | null>(null)
  const [selectedDecoration, setSelectedDecoration] = useState<string | null>(null)
  const [editMode, setEditMode] = useState(false)
  const [selectedBadge, setSelectedBadge] = useState<Badge | null>(null)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [showHeaderPicker, setShowHeaderPicker] = useState(false)

  // Profile editor drafts (display name / bio / username / branch)
  const [displayNameDraft, setDisplayNameDraft] = useState('')
  const [bioDraft, setBioDraft] = useState('')
  const [usernameDraft, setUsernameDraft] = useState('')
  const [branchChoice, setBranchChoice] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  const [savingDisplayName, setSavingDisplayName] = useState(false)
  const [savingBio, setSavingBio] = useState(false)
  const [savingUsername, setSavingUsername] = useState(false)
  const [savingBranch, setSavingBranch] = useState(false)
  const [toast, setToast] = useState<{ msg: string; color?: string } | null>(null)
  const [signingOut, setSigningOut] = useState(false)

  const [loading, setLoading] = useState(true)
  const [profileStats, setProfileStats] = useState<ProfileStatsData>({ gamesPlayed: 0, avgScore: 0, wins: 0, badgeCount: 0, friendCount: 0 })
  const [rank, setRank] = useState<number | null>(null)
  const [activityLog, setActivityLog] = useState<ActivityRow[]>([])
  const [achievements, setAchievements] = useState<AchievementWithStatus[]>([])
  const [cosmetics, setCosmetics] = useState<CosmeticsData>({ frames: [], banners: [], titles: [], decorations: [] })
  // Full cosmetic_items catalog (all items, not just owned ones) — needed to
  // translate whatever is actually equipped (profile.equipped_*_id, read
  // fresh from the DB via useAuth's profile) into real render data. See
  // src/lib/cosmetics.ts for why this must not fall back to "first owned
  // item" the way the old local `frames.find(...) ?? frames[0]` logic did.
  const [catalog, setCatalog] = useState<CosmeticItem[]>([])
  const [season, setSeason] = useState<SeasonData>(null)
  const [seasonTrack, setSeasonTrack] = useState<SeasonTrackData | null>(null)
  const [favoriteGame, setFavoriteGame] = useState<{ en: string; ar: string; xp: number; sessions: number; color: string } | null>(null)
  const [xpHistory, setXpHistory] = useState<XpLedgerEntry[]>([])
  const [gameStats, setGameStats] = useState<GameStat[]>([])
  const [expandedGameStat, setExpandedGameStat] = useState<string | null>(null)

  const isAr = lang === 'ar'

  useEffect(() => { getBranches().then(({ data }) => setBranches(data)) }, [])

  // Load everything that depends on the current user once we know who they are.
  useEffect(() => {
    if (!profile) return
    let active = true
    ;(async () => {
      const [stats, log, ach, cos, cat, board, activeSeason, favGame, xpHist, gStats] = await Promise.all([
        getProfileStats(profile.id),
        getActivityLog(profile.id),
        getAchievementsWithStatus(profile.id),
        getCosmetics(profile.id),
        getCosmeticCatalog(),
        getLeaderboard('weekly'),
        getActiveSeason(),
        getFavoriteGame(profile.id),
        getXpHistory(profile.id, 15),
        getGameStats(profile.id),
      ])
      if (!active) return
      setProfileStats(stats)
      setActivityLog(log)
      setAchievements(ach)
      setCosmetics(cos)
      setCatalog(cat)
      setFavoriteGame(favGame)
      setXpHistory(xpHist)
      setGameStats(gStats)
      const mine = (board as Array<{ user_id: string; rank: number }>).find((r) => r.user_id === profile.id)
      setRank(mine ? mine.rank : null)
      setSeason(activeSeason)
      if (activeSeason) {
        const track = await getSeasonTrack(activeSeason.id, profile.id)
        if (active) setSeasonTrack(track)
      } else {
        setSeasonTrack(null)
      }
      setLoading(false)
    })()
    return () => {
      active = false
    }
  }, [profile?.id])

  // Keep the local equip-slot selections in sync with whatever is actually equipped.
  useEffect(() => {
    if (!profile) return
    setSelectedFrame(profile.equipped_frame_id)
    setSelectedBanner(profile.equipped_banner_id)
    setSelectedTitle(profile.equipped_title_id)
    setSelectedDecoration(profile.equipped_decoration_id)
  }, [profile?.equipped_frame_id, profile?.equipped_banner_id, profile?.equipped_title_id, profile?.equipped_decoration_id])

  // Keep the local edit-form drafts in sync with the saved profile — also
  // re-syncs after a successful save (refreshProfile() updates `profile`).
  useEffect(() => {
    if (!profile) return
    setDisplayNameDraft(profile.display_name ?? '')
    setBioDraft(profile.bio ?? '')
    setUsernameDraft(profile.username)
    setBranchChoice(profile.branch_id ?? '')
  }, [profile?.id, profile?.display_name, profile?.bio, profile?.username, profile?.branch_id])

  if (!profile || loading) {
    return <div className="screen bg-game" />
  }

  const frames = cosmetics.frames.filter((f) => f.owned)
  const banners = cosmetics.banners.filter((b) => b.owned)
  const titles = cosmetics.titles.filter((t) => t.owned)
  const decorations = cosmetics.decorations.filter((d) => d.owned)

  // What's actually shown on the hero comes strictly from the DB — the
  // profile object's equipped_*_id columns (refreshed via refreshProfile()
  // after every equip/unequip) resolved against the full catalog. This is
  // deliberately NOT derived from `selected*` local state or from "first
  // owned item": an unequipped slot resolves to null here and renders this
  // screen's real default (no frame ring, DEFAULT_HERO_GRADIENT banner, no
  // title, no decoration) rather than silently picking whatever the owned
  // list happens to start with.
  const equipped = resolveCosmetics(catalog, profile)
  const currentTitle = equipped.title
  const currentDecoration = equipped.decoration
  const currentFrameStyle = frameAvatarStyle(equipped.frame)

  async function handleSelectFrame(id: string) {
    setSelectedFrame(id)
    const { error } = await equipCosmetic('frame', id)
    if (!error) await refreshProfile()
  }

  async function handleSelectBanner(id: string) {
    setSelectedBanner(id)
    const { error } = await equipCosmetic('banner', id)
    if (!error) await refreshProfile()
  }

  async function handleSelectTitle(id: string | null) {
    setSelectedTitle(id)
    const { error } = await equipCosmetic('title', id)
    if (!error) await refreshProfile()
  }

  async function handleSelectDecoration(id: string | null) {
    setSelectedDecoration(id)
    const { error } = await equipCosmetic('decoration', id)
    if (!error) await refreshProfile()
  }

  const flash = (msg: string, color?: string) => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 2000)
  }

  const branchValid = !!branchChoice
  const branchUnchanged = branchChoice === (profile.branch_id ?? '')
  const myBranch = branches.find((b) => b.id === profile.branch_id)
  const minUsernameLen = profile.role === 'owner' ? 1 : 3

  async function handleSaveDisplayName() {
    const trimmed = displayNameDraft.trim()
    if (trimmed.length > MAX_DISPLAY_NAME_LEN) return
    setSavingDisplayName(true)
    // Empty string clears it back to null (falls back to @username
    // everywhere it's shown), same convention as bio.
    const { error } = await updateProfile(profile!.id, { display_name: trimmed || null })
    setSavingDisplayName(false)
    if (error) { flash(error, '#ff4785'); return }
    await refreshProfile()
    flash(isAr ? '✓ تم الحفظ' : '✓ Saved', '#00e676')
  }

  async function handleSaveBio() {
    setSavingBio(true)
    // Non-null assertion: the `if (!profile || loading) return` guard above
    // already narrowed profile for this render; TS just can't carry that
    // narrowing into a closure that might run later.
    const { error } = await updateProfile(profile!.id, { bio: bioDraft })
    setSavingBio(false)
    if (error) { flash(error, '#ff4785'); return }
    await refreshProfile()
    flash(isAr ? '✓ تم الحفظ' : '✓ Saved', '#00e676')
  }

  async function handleSaveUsername() {
    const trimmed = usernameDraft.trim()
    if (!trimmed || trimmed.length > MAX_USERNAME_LEN) return
    setSavingUsername(true)
    const { error } = await updateUsername(trimmed)
    setSavingUsername(false)
    if (error) { flash(error, '#ff4785'); return }
    await refreshProfile()
    flash(isAr ? '✓ تم الحفظ' : '✓ Saved', '#00e676')
  }

  async function handleSaveBranch() {
    if (!branchValid) return
    setSavingBranch(true)
    const { error } = await updateProfile(profile!.id, { branch_id: branchChoice })
    setSavingBranch(false)
    if (error) { flash(error, '#ff4785'); return }
    await refreshProfile()
    flash(isAr ? '✓ تم الحفظ' : '✓ Saved', '#00e676')
  }

  async function handleSignOut() {
    if (signingOut) return
    setSigningOut(true)
    try {
      await onSignOut()
    } finally {
      setSigningOut(false)
    }
  }

  const TABS: { key: Tab; en: string; ar: string }[] = [
    { key: 'stats',    en: 'Stats',    ar: 'الإحصائيات' },
    { key: 'badges',   en: 'Badges',   ar: 'الشارات' },
    { key: 'activity', en: 'Activity', ar: 'النشاط' },
    { key: 'season',   en: 'Season',   ar: 'الموسم' },
  ]

  const badges = achievements.map(toBadge)
  const pinnedBadges = (
    profile.pinned_badge_ids?.length
      ? profile.pinned_badge_ids
          .map((id) => badges.find((b) => b.id === id))
          .filter((b): b is Badge => Boolean(b))
      : badges.filter((b) => b.earned)
  ).slice(0, 3)

  const stats = [
    { label: isAr ? 'مجموع XP' : 'Total XP', val: profile.xp.toLocaleString(), color: '#9d6fff' },
    { label: isAr ? 'المستوى' : 'Level',      val: String(profile.level), color: '#ffd700' },
    { label: isAr ? 'الترتيب' : 'Rank',       val: rank !== null ? `#${rank}` : '—', color: '#f59e0b' },
    { label: isAr ? 'ألعاب' : 'Games',        val: String(profileStats.gamesPlayed), color: '#00d4ff' },
    { label: isAr ? 'انتصارات' : 'Wins',      val: String(profileStats.wins), color: '#00e676' },
    { label: isAr ? 'أيام متتالية' : 'Streak',val: String(profile.streak_count), color: '#ff6b35' },
    { label: isAr ? 'شارات' : 'Badges',       val: String(profileStats.badgeCount), color: '#c084fc' },
    { label: isAr ? 'أصدقاء' : 'Friends',     val: String(profileStats.friendCount), color: '#9d6fff' },
  ]

  const daysRemaining = season ? Math.max(0, Math.ceil((new Date(season.ends_at).getTime() - Date.now()) / 86400000)) : 0
  const seasonPercent = seasonTrack && seasonTrack.nodes.length
    ? Math.round((seasonTrack.progress.current_level / seasonTrack.nodes.length) * 100)
    : 0

  return (
    <div className="screen bg-game">
      <style>{`
        @keyframes toast-in { from{opacity:0;transform:translate(-50%,8px)} to{opacity:1;transform:translate(-50%,0)} }
      `}</style>

      {/* Avatar picker */}
      {showAvatarPicker && (
        <AvatarPickerModal
          lang={lang}
          userId={profile.id}
          currentAvatarUrl={profile.avatar_url}
          onClose={() => setShowAvatarPicker(false)}
          onSaved={() => { refreshProfile(); setShowAvatarPicker(false) }}
        />
      )}

      {showHeaderPicker && (
        <HeaderPickerModal
          lang={lang}
          userId={profile.id}
          currentHeaderUrl={profile.header_url}
          onClose={() => setShowHeaderPicker(false)}
          onSaved={() => { refreshProfile(); setShowHeaderPicker(false) }}
        />
      )}

      {/* Save confirmation / error toast */}
      {toast && (
        <div style={{
          position: 'fixed',
          // Was a flat `88` assuming an 80px nav + a little clearance — on a
          // notched phone the bottom nav itself grows by env(safe-area-inset-
          // bottom) (see .pb-nav / --bottom-nav-height in index.css), so a
          // fixed 88 could sit under the taller nav. Same measured-height +
          // inset formula as .pb-nav keeps this pinned just above the nav on
          // every device.
          bottom: 'calc(var(--bottom-nav-height, 80px) + env(safe-area-inset-bottom, 0px) + 8px)',
          left: '50%', transform: 'translateX(-50%)',
          background: toast.color ?? '#00e676', color: (toast.color ?? '#00e676') === '#00e676' ? '#03030f' : '#fff',
          padding: '9px 20px', borderRadius: 10, fontSize: 12, fontWeight: 700, zIndex: 9200,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)', animation: 'toast-in 0.25s ease-out',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Badge detail sheet */}
      {selectedBadge && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(3,3,15,0.88)', zIndex: 200, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setSelectedBadge(null)}
        >
          <div
            style={{
              width: '100%', maxWidth: 480, background: 'var(--surface-2)', borderRadius: '24px 24px 0 0',
              padding: '24px 20px 40px', paddingBottom: 'max(40px, calc(24px + env(safe-area-inset-bottom, 0px)))',
              paddingLeft: safeLeft(20), paddingRight: safeRight(20),
              border: '1px solid rgba(var(--fg-rgb),0.08)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
              <div className="animate-badge-reveal">
                <BadgeMark badge={selectedBadge} size={80} />
              </div>
            </div>
            <h3 style={{ textAlign: 'center', margin: '0 0 4px', fontSize: 20, fontWeight: 800, fontFamily: "'Exo 2', sans-serif", color: selectedBadge.color }}>
              {isAr ? selectedBadge.nameAr : selectedBadge.nameEn}
            </h3>
            <div style={{ textAlign: 'center', marginBottom: 12 }}>
              <span className={`rarity-${selectedBadge.rarity.toLowerCase()}`}>
                {isAr ? selectedBadge.rarityAr : selectedBadge.rarity}
              </span>
            </div>
            <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.6)', marginBottom: 20, lineHeight: 1.5 }}>
              {isAr ? selectedBadge.descAr : selectedBadge.desc}
            </p>
            <div style={{ textAlign: 'center', padding: '10px 16px', background: selectedBadge.earned ? 'rgba(0,230,118,0.08)' : 'rgba(var(--fg-rgb),0.04)', border: `1px solid ${selectedBadge.earned ? 'rgba(0,230,118,0.2)' : 'rgba(var(--fg-rgb),0.08)'}`, borderRadius: 12 }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: selectedBadge.earned ? '#00e676' : 'rgba(var(--fg2-rgb),0.4)' }}>
                {selectedBadge.earned ? (isAr ? '✓ محقق' : '✓ Earned') : (isAr ? '🔒 مقفل' : '🔒 Locked')}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Hero banner — priority order: custom cover photo, then an owned/
          equipped "Profile Banner" cosmetic gradient, then a premium CareerXP
          default gradient. Never blank. */}
      <div style={{ position: 'relative', height: 256, overflow: 'hidden', background: profile.header_url || equipped.banner ? undefined : DEFAULT_HERO_GRADIENT }}>
        {profile.header_url ? (
          <>
            <img
              src={profile.header_url}
              alt=""
              style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center' }}
            />
            {/* Bottom-weighted dark gradient so the top controls, pinned badges,
                and the avatar/username that overlaps the lower edge all stay
                legible over an arbitrarily bright photo. Slightly deepened
                and re-tuned for the taller header (was 160px, now 220px) so
                the darkest part still lands right behind the overlapping
                avatar/username instead of higher up the image. */}
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(3,3,15,0.12) 0%, rgba(3,3,15,0.08) 35%, rgba(3,3,15,0.55) 72%, rgba(3,3,15,0.85) 100%)' }} />
          </>
        ) : equipped.banner ? (
          <>
            {/* Equipped Profile Banner cosmetic — real looping <video> when
                is_animated, a static image, or the CSS gradient, decided
                entirely inside CosmeticBannerLayer. Same legibility overlay
                as the custom-photo branch above so text stays readable
                whether the banner is a still gradient or playing video. */}
            <CosmeticBannerLayer banner={equipped.banner} fallbackGradient={DEFAULT_HERO_GRADIENT} />
            <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, rgba(3,3,15,0.12) 0%, rgba(3,3,15,0.08) 35%, rgba(3,3,15,0.55) 72%, rgba(3,3,15,0.85) 100%)' }} />
          </>
        ) : (
          <div className="bg-stars" style={{ position: 'absolute', inset: 0, opacity: 0.7 }} />
        )}

        {/* Top controls — this row is the reported "Customize button" bug's
            root cause: it's `position: absolute` inside the hero banner,
            which is this screen's own first element (ProfileScreen doesn't
            use the shared TopBar), so it used to sit at a hardcoded `top:
            14` with no iOS safe-area awareness at all. On a notched/Dynamic-
            Island phone that landed the row (and the Customize/language/
            sign-out buttons in it) right under — or behind — the status
            bar/notch. Same fix pattern as TopBar/GameHeader: `max(base,
            env(safe-area-inset-*))` collapses to plain `base` with zero
            extra space on non-notched devices, so nothing shifts on older
            iPhones/Android/desktop. Horizontal insets guard the same row in
            landscape, where the notch/rounded corner sits to one physical
            side regardless of LTR/RTL. */}
        <div style={{ position: 'absolute', top: safeTop(14), left: safeLeft(16), right: safeRight(16), display: 'flex', justifyContent: 'space-between', alignItems: 'center', zIndex: 2 }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            {/* Only rendered when shown inside the Plato-style slide-over
                (see the `onClose` prop doc comment) — closes the overlay,
                reversing the slide-in animation back to Home. The few
                remaining full-screen-route call sites (Achievements/Season
                Pass/etc.'s own back buttons landing here) don't pass
                onClose, so they keep today's chrome exactly as-is.

                Structural fix for the "Back is too small and almost
                touching Customize" bug: the old version relied on
                `tapTarget()`'s padding+negative-margin trick to grow a
                fixed 30x30 `width/height` box up to a 44x44 hit area — but
                this app's global CSS reset is `box-sizing: border-box`,
                under which padding on a box with an explicit fixed
                width/height does NOT grow the box at all (border-box caps
                the total box at the declared width/height, so the padding
                just ate into the icon's own content area instead). The
                negative margin then WAS real, pulling this button 7px
                closer to Customize on top of the row's `gap`, leaving a
                ~1px visible seam — exactly the reported bug. Fixed here by
                making the `<button>` itself a real, explicit 44x44 hit box
                (no padding/margin arithmetic to get wrong), with the
                original 30x30 visual chip rendered as a purely decorative
                inner `<span>` centered inside it — so the icon's on-screen
                size and position are unchanged, but the actual clickable
                area is now genuinely 44x44 and participates normally in
                this row's `gap: 12`, independent of Customize. */}
            {onClose && (
              <button
                onClick={onClose}
                aria-label={isAr ? 'رجوع' : 'Back'}
                style={{
                  width: 44, height: 44, borderRadius: 12, border: 'none', background: 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0, flexShrink: 0,
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 30, height: 30, borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(230,230,255,0.85)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isAr ? 'scaleX(-1)' : undefined }}>
                    <polyline points="15 18 9 12 15 6" />
                  </svg>
                </span>
              </button>
            )}
            <button
              onClick={() => setEditMode(!editMode)}
              /* Sits on the hero banner, which stays a fixed dark/colorful backdrop
                 regardless of app theme (like the pre-auth screens) — so this chip
                 is deliberately NOT theme-linked, to keep it readable in light mode.
                 `minHeight: 44` (explicit, not derived from padding math) guarantees
                 a real >=44px tap target independent of the Back button above. */
              style={{
                padding: '6px 14px', borderRadius: 10, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.08)',
                fontSize: 12, fontWeight: 600, color: 'rgba(230,230,255,0.85)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                minHeight: 44, boxSizing: 'border-box', flexShrink: 0,
              }}
            >
              {editMode ? (isAr ? 'تم' : 'Done') : (isAr ? 'تخصيص' : 'Customize')}
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
              style={{
                padding: '6px 12px', borderRadius: 10, border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.2)',
                fontSize: 12, fontWeight: 700, color: '#a78bfa', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                ...tapTargetMinHeight(26),
              }}
            >
              {lang === 'en' ? 'عربي' : 'EN'}
            </button>
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              aria-label={isAr ? 'تسجيل الخروج' : 'Sign out'}
              title={isAr ? 'تسجيل الخروج' : 'Sign out'}
              style={{
                width: 30, height: 30, borderRadius: 10, border: '1px solid rgba(255,71,133,0.3)', background: 'rgba(255,71,133,0.14)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: signingOut ? 'default' : 'pointer', opacity: signingOut ? 0.6 : 1, padding: 0,
                // Visible box stays 30x30; clickable box expands to 44x44 via
                // negative margin (same precedent as the Ludo back button).
                ...tapTarget(30, 30),
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff4785" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Pinned badges on banner — bottom sits well clear of the home
            indicator (this row is inside the 256px hero, not screen-bottom),
            but still given `safeBottom`-free horizontal insets for landscape
            notch clearance, matching the top-controls row above. */}
        <div style={{ position: 'absolute', bottom: 16, right: isAr ? 'auto' : safeRight(16), left: isAr ? safeLeft(16) : 'auto', display: 'flex', gap: 8, zIndex: 2 }}>
          {pinnedBadges.map((b) => (
            <button key={b.id} onClick={() => setSelectedBadge(b)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...tapTarget(36, 36) }}>
              <BadgeMark badge={b} size={36} />
            </button>
          ))}
        </div>
      </div>

      {/* Avatar overlapping banner. The previous -52 margin actually had the
          avatar poking out PAST the header's bottom edge (header ended at
          Y=220, avatar spanned Y=168-236 — the avatar's own bottom 16px hung
          below the header, which is why the header visibly cut off around
          the avatar's middle/lower-middle on device).
          Fix: the avatar's absolute position is now pinned (top stays at
          Y=168, identical to before — it has NOT moved) while the header
          itself grew from 220 to 256. Since marginTop is measured from the
          hero's NEW bottom edge, it must grow by the same amount the hero
          grew (52 -> 88) purely to keep the avatar's on-screen position
          unchanged; this is a derived consequence of pinning the avatar, not
          a standalone margin tweak. Net effect: header now extends ~20px
          *past* the avatar's bottom edge (Y=256 vs avatar bottom Y=236),
          i.e. the header genuinely continues behind the full avatar. */}
      <div style={{ position: 'relative', padding: '0 20px', marginTop: -88, marginBottom: 36 }}>
        {/* marginBottom:36 reserves clearance below the avatar so the
            username block (next sibling, inside .pb-nav) starts safely
            AFTER the header's bottom edge (avatar bottom = 236, header
            bottom = 256, +16px buffer = 272) instead of 20px before it —
            fixes the header image visually covering the username text. */}
        <div style={{ position: 'relative', width: 68, height: 68 }}>
          <button
            onClick={() => setShowAvatarPicker(true)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'block', borderRadius: '50%' }}
            aria-label={isAr ? 'تغيير الصورة الرمزية' : 'Change avatar'}
          >
            <Avatar url={profile.avatar_url} size={68} style={{ ...currentFrameStyle }} frame={equipped.frame} />
          </button>
          {currentDecoration && (
            <span
              aria-hidden="true"
              style={{ position: 'absolute', top: -8, left: isAr ? 'auto' : -6, right: isAr ? -6 : 'auto', fontSize: 20, lineHeight: 1, pointerEvents: 'none', filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.4))' }}
            >
              {currentDecoration.icon}
            </span>
          )}
          <button
            onClick={() => setShowAvatarPicker(true)}
            style={{
              position: 'absolute', bottom: -2, right: isAr ? 'auto' : -2, left: isAr ? -2 : 'auto',
              width: 24, height: 24, borderRadius: '50%', background: '#7c3aed', border: '2px solid var(--background)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', padding: 0,
            }}
            aria-label={isAr ? 'تغيير الصورة الرمزية' : 'Change avatar'}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/>
            </svg>
          </button>
        </div>
      </div>

      <div className="pb-nav" style={{ padding: '12px 20px', background: 'var(--background)', position: 'relative' }}>

        {/* Name & rank */}
        <div style={{ marginBottom: 16 }}>
          {/* Instagram-style identity order: large Display Name, smaller
              @username beneath it, then Bio. Display Name falls back to
              @username when unset (pre-existing accounts render exactly as
              before). Usernames are plain user-chosen identifiers (letters,
              digits, underscores) — the @username line deliberately stays
              on the app's regular UI font rather than the decorative
              "Exo 2" display font (whose stylized glyphs, e.g. a slanted/
              geometric uppercase T, made short usernames like "@T" look
              distorted/mis-rendered); the display-name heading itself is
              free text and uses the same heading font Home's Welcome Card
              uses, for visual consistency between the two. Cairo is kept
              for Arabic since it's the app's standard RTL body font, not a
              decorative one. */}
          <h2
            className={isAr ? 'font-cairo' : 'font-display'}
            style={{ margin: '0 0 2px', fontSize: 22, fontWeight: 800, color: 'var(--foreground)', overflowWrap: 'break-word' }}
          >
            {profile.display_name?.trim() || `@${profile.username}`}
          </h2>
          {profile.display_name?.trim() && (
            <p style={{ margin: '0 0 4px', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.5)' }}>
              @{profile.username}
            </p>
          )}
          {profile.bio?.trim() && (
            <p style={{ margin: '0 0 8px', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.7)', lineHeight: 1.5 }}>
              {profile.bio}
            </p>
          )}
          {/* Owner-assigned custom title — cosmetic only, separate from the
              equippable shop title below and from the real system role. */}
          {profile.custom_title && (
            <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#ffd700' }}>
              {isAr && profile.custom_title_ar ? profile.custom_title_ar : profile.custom_title}
            </p>
          )}
          {currentTitle && (
            <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, color: '#9d6fff' }}>
              {currentTitle.icon} {isAr ? currentTitle.label_ar : currentTitle.label}
            </p>
          )}
          {myBranch && (
            <p style={{ margin: '0 0 8px', fontSize: 12, color: 'rgba(var(--fg2-rgb),0.55)' }}>
              {isAr ? myBranch.name_ar : myBranch.name_en}
            </p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ padding: '4px 10px', borderRadius: 99, background: 'rgba(157,111,255,0.15)', border: '1px solid rgba(157,111,255,0.3)', fontSize: 11, color: '#9d6fff', fontWeight: 700 }}>
              {isAr ? `مستوى ${profile.level}` : `Level ${profile.level}`}
            </span>
            <span style={{ padding: '4px 10px', borderRadius: 99, background: 'rgba(255,215,0,0.1)', border: '1px solid rgba(255,215,0,0.25)', fontSize: 11, color: '#ffd700', fontWeight: 700 }}>
              {isAr ? `مرتبة #${rank ?? '—'}` : `Rank #${rank ?? '—'}`}
            </span>
            <span style={{ padding: '4px 10px', borderRadius: 99, background: 'rgba(255,107,53,0.1)', border: '1px solid rgba(255,107,53,0.25)', fontSize: 11, color: '#ff6b35', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="#ff6b35"><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>
              {isAr ? `${profile.streak_count} أيام متتالية` : `${profile.streak_count}d streak`}
            </span>
            {profile.weekly_streak_count > 0 && (
              <span style={{ padding: '4px 10px', borderRadius: 99, background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.25)', fontSize: 11, color: '#00d4ff', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 4 }}>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#00d4ff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                {isAr ? `${profile.weekly_streak_count} أسابيع متتالية` : `${profile.weekly_streak_count}wk streak`}
              </span>
            )}
          </div>
        </div>

        {/* Edit Profile: identity fields + cosmetics, all in one consolidated editor */}
        {editMode && (
          <div className="card" style={{ padding: '14px 16px', marginBottom: 14, border: '1px solid rgba(157,111,255,0.22)', display: 'flex', flexDirection: 'column', gap: 18 }}>

            {/* Language toggle — also reachable from the header, repeated here for discoverability */}
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
                style={{ padding: '6px 12px', borderRadius: 10, border: '1px solid rgba(124,58,237,0.3)', background: 'rgba(124,58,237,0.2)', fontSize: 12, fontWeight: 700, color: '#a78bfa', cursor: 'pointer' }}
              >
                {lang === 'en' ? 'عربي' : 'EN'}
              </button>
            </div>

            {/* Avatar */}
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#9d6fff', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {isAr ? 'الصورة الرمزية' : 'Avatar'}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Avatar url={profile.avatar_url} size={48} />
                <button className="btn btn-ghost btn-sm" onClick={() => setShowAvatarPicker(true)}>
                  {isAr ? 'تغيير الصورة' : 'Change Photo'}
                </button>
              </div>
            </div>

            {/* Cover Image / Profile Header — distinct from the "Profile
                Banner" cosmetic below: this is a user-uploaded photo, not a
                purchased gradient. A custom cover photo takes visual
                priority over an equipped Profile Banner wherever both would
                otherwise show (see the hero banner above). */}
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#9d6fff', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {isAr ? 'صورة الغلاف' : 'Cover Image'}
              </p>
              <div
                style={{
                  height: 60, borderRadius: 10, marginBottom: 10, overflow: 'hidden', position: 'relative',
                  background: profile.header_url || equipped.banner ? undefined : DEFAULT_HERO_GRADIENT,
                  border: '1px solid rgba(var(--fg-rgb),0.08)',
                }}
              >
                {profile.header_url ? (
                  <img src={profile.header_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : equipped.banner ? (
                  <CosmeticBannerLayer banner={equipped.banner} fallbackGradient={DEFAULT_HERO_GRADIENT} />
                ) : null}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowHeaderPicker(true)}>
                  {profile.header_url ? (isAr ? 'تغيير الغلاف' : 'Change Cover') : (isAr ? 'إضافة صورة غلاف' : 'Add Cover Image')}
                </button>
              </div>
            </div>

            {/* Display Name — a second, non-unique identity field shown
                above @username everywhere identity is rendered (this
                screen, Home's Welcome Card). Unlike Username, it has no
                minimum length, no uniqueness requirement, and fully
                supports Arabic/English/emoji/unicode since it's just plain
                text (no transliteration or ASCII-only restriction like
                Username has). */}
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {isAr ? 'الاسم المعروض' : 'Display Name'}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="text"
                  value={displayNameDraft}
                  onChange={(e) => setDisplayNameDraft(e.target.value)}
                  maxLength={MAX_DISPLAY_NAME_LEN}
                  placeholder={isAr ? 'أدخل اسمك' : 'Enter your name'}
                  style={{ flex: 1 }}
                />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveDisplayName}
                  disabled={savingDisplayName || displayNameDraft.trim().length > MAX_DISPLAY_NAME_LEN || displayNameDraft.trim() === (profile.display_name ?? '')}
                >
                  {savingDisplayName ? (isAr ? '...' : '…') : (isAr ? 'حفظ' : 'Save')}
                </button>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)' }}>
                {isAr ? `حتى ${MAX_DISPLAY_NAME_LEN} حرفًا — يمكن أن يتشابه مع مستخدمين آخرين` : `Up to ${MAX_DISPLAY_NAME_LEN} characters — can be shared with other users`}
              </p>
            </div>

            {/* Username */}
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {isAr ? 'اسم المستخدم' : 'Username'}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <span style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', right: isAr ? 14 : 'auto', left: isAr ? 'auto' : 14, color: 'rgba(var(--fg2-rgb),0.4)', fontSize: 15, pointerEvents: 'none' }}>
                    @
                  </span>
                  <input
                    type="text"
                    value={usernameDraft}
                    onChange={(e) => setUsernameDraft(e.target.value)}
                    maxLength={MAX_USERNAME_LEN}
                    style={{ paddingLeft: isAr ? 16 : 28, paddingRight: isAr ? 28 : 16 }}
                  />
                </div>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveUsername}
                  disabled={savingUsername || !usernameDraft.trim() || usernameDraft.trim().length > MAX_USERNAME_LEN || usernameDraft.trim() === profile.username}
                >
                  {savingUsername ? (isAr ? '...' : '…') : (isAr ? 'حفظ' : 'Save')}
                </button>
              </div>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)' }}>
                {isAr
                  ? `من ${minUsernameLen === 1 ? 'حرف واحد' : `${minUsernameLen} أحرف`} إلى ${MAX_USERNAME_LEN} حرفًا`
                  : `${minUsernameLen}-${MAX_USERNAME_LEN} characters`}
              </p>
            </div>

            {/* Bio */}
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {isAr ? 'نبذة' : 'Bio'}
              </label>
              <textarea
                value={bioDraft}
                onChange={(e) => setBioDraft(e.target.value)}
                maxLength={100}
                rows={3}
                placeholder={isAr ? 'اكتب نبذة عنك...' : 'Tell us about yourself...'}
                style={{ resize: 'none' }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                <span style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)' }}>{bioDraft.length}/100</span>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={handleSaveBio}
                  disabled={savingBio || bioDraft === (profile.bio ?? '')}
                >
                  {savingBio ? (isAr ? '...' : '…') : (isAr ? 'حفظ' : 'Save')}
                </button>
              </div>
            </div>

            {/* Branch */}
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {isAr ? 'الفرع' : 'Branch'}
              </label>
              <select
                value={branchChoice}
                onChange={(e) => setBranchChoice(e.target.value)}
                style={{
                  width: '100%', fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif",
                  background: 'rgba(var(--fg-rgb),0.04)', border: '1px solid rgba(var(--fg-rgb),0.1)',
                  borderRadius: 10, padding: '11px 12px', fontSize: 14, color: branchChoice ? 'var(--foreground)' : 'rgba(var(--fg2-rgb),0.4)',
                }}
              >
                <option value="" disabled>{isAr ? 'اختر الفرع' : 'Select branch'}</option>
                {branches.map((b) => (
                  <option key={b.id} value={b.id}>{isAr ? b.name_ar : b.name_en}</option>
                ))}
              </select>
              <button
                className="btn btn-primary btn-sm"
                style={{ marginTop: 10, width: '100%' }}
                onClick={handleSaveBranch}
                disabled={savingBranch || !branchValid || branchUnchanged}
              >
                {savingBranch ? (isAr ? '...' : '…') : (isAr ? 'حفظ الفرع' : 'Save Branch')}
              </button>
            </div>

            {/* Avatar Frame */}
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#9d6fff', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {isAr ? 'إطار الصورة' : 'Avatar Frame'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {frames.map((f) => (
                  <button key={f.id} onClick={() => handleSelectFrame(f.id)} style={{ flex: 1, padding: '8px 6px', borderRadius: 10, border: `1px solid ${selectedFrame === f.id ? '#9d6fff' : 'rgba(var(--fg-rgb),0.08)'}`, background: selectedFrame === f.id ? 'rgba(157,111,255,0.18)' : 'rgba(var(--fg-rgb),0.04)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: selectedFrame === f.id ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.5)' }}>
                    {isAr ? f.label_ar : f.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Profile Banner */}
            <div>
              <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#9d6fff', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                {isAr ? 'خلفية الملف الشخصي' : 'Profile Banner'}
              </p>
              <div style={{ display: 'flex', gap: 8 }}>
                {banners.map((b) => (
                  <button key={b.id} onClick={() => handleSelectBanner(b.id)} style={{ flex: 1, height: 36, borderRadius: 10, border: `2px solid ${selectedBanner === b.id ? '#9d6fff' : 'transparent'}`, background: bannerBackground(b, DEFAULT_HERO_GRADIENT), cursor: 'pointer' }} />
                ))}
              </div>
            </div>

            {/* Nameplate — owned titles purchased from the shop, or "None" */}
            {titles.length > 0 && (
              <div>
                <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#9d6fff', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  {isAr ? 'اللقب' : 'Nameplate'}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => handleSelectTitle(null)} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${!selectedTitle ? '#9d6fff' : 'rgba(var(--fg-rgb),0.08)'}`, background: !selectedTitle ? 'rgba(157,111,255,0.18)' : 'rgba(var(--fg-rgb),0.04)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: !selectedTitle ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.5)' }}>
                    {isAr ? 'بلا' : 'None'}
                  </button>
                  {titles.map((t) => (
                    <button key={t.id} onClick={() => handleSelectTitle(t.id)} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${selectedTitle === t.id ? '#9d6fff' : 'rgba(var(--fg-rgb),0.08)'}`, background: selectedTitle === t.id ? 'rgba(157,111,255,0.18)' : 'rgba(var(--fg-rgb),0.04)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: selectedTitle === t.id ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.5)' }}>
                      {t.icon} {isAr ? t.label_ar : t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Avatar Decoration — owned decorations purchased from the shop, or "None" */}
            {decorations.length > 0 && (
              <div>
                <p style={{ margin: '0 0 10px', fontSize: 12, fontWeight: 700, color: '#9d6fff', textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                  {isAr ? 'زخرفة الصورة الرمزية' : 'Avatar Decoration'}
                </p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button onClick={() => handleSelectDecoration(null)} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${!selectedDecoration ? '#9d6fff' : 'rgba(var(--fg-rgb),0.08)'}`, background: !selectedDecoration ? 'rgba(157,111,255,0.18)' : 'rgba(var(--fg-rgb),0.04)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: !selectedDecoration ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.5)' }}>
                    {isAr ? 'بلا' : 'None'}
                  </button>
                  {decorations.map((d) => (
                    <button key={d.id} onClick={() => handleSelectDecoration(d.id)} style={{ padding: '8px 12px', borderRadius: 10, border: `1px solid ${selectedDecoration === d.id ? '#9d6fff' : 'rgba(var(--fg-rgb),0.08)'}`, background: selectedDecoration === d.id ? 'rgba(157,111,255,0.18)' : 'rgba(var(--fg-rgb),0.04)', cursor: 'pointer', fontSize: 11, fontWeight: 600, color: selectedDecoration === d.id ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.5)' }}>
                      {d.icon} {isAr ? d.label_ar : d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: 'flex', gap: 4, background: 'rgba(var(--fg-rgb),0.04)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                flex: 1, padding: '8px 3px', borderRadius: 9, border: 'none', cursor: 'pointer',
                fontSize: isAr ? 10 : 11, fontWeight: 600, transition: 'all 0.2s ease',
                background: tab === t.key ? 'linear-gradient(135deg, #7c3aed, #5b21b6)' : 'transparent',
                color: tab === t.key ? 'white' : 'rgba(var(--fg2-rgb),0.5)',
                fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif",
                boxShadow: tab === t.key ? '0 3px 10px rgba(124,58,237,0.3)' : 'none',
              }}
            >
              {isAr ? t.ar : t.en}
            </button>
          ))}
        </div>

        {/* ── STATS ── */}
        {tab === 'stats' && (
          <>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 14 }}>
              {stats.map((s) => (
                <div key={s.label} className="card" style={{ padding: '12px 6px', textAlign: 'center' }}>
                  <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 18, fontWeight: 900, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 9, color: 'rgba(var(--fg2-rgb),0.5)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.04em', lineHeight: 1.3 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Favorite game — only rendered once the player has a real one */}
            {favoriteGame && (
              <div className="card" style={{ padding: '14px 16px', marginBottom: 14, border: `1px solid ${favoriteGame.color}25` }}>
                <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {isAr ? 'اللعبة المفضلة' : 'Favourite Game'}
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div style={{ width: 44, height: 44, borderRadius: 14, background: `${favoriteGame.color}18`, border: `1px solid ${favoriteGame.color}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={favoriteGame.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <polygon points="5,3 19,12 5,21"/>
                    </svg>
                  </div>
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 700, color: 'var(--foreground)' }}>{isAr ? favoriteGame.ar : favoriteGame.en}</p>
                    <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.55)' }}>
                      {isAr ? `${favoriteGame.sessions} جلسة · ${favoriteGame.xp.toLocaleString()} XP مكتسب` : `${favoriteGame.sessions} sessions · ${favoriteGame.xp.toLocaleString()} XP earned`}
                    </p>
                  </div>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill={favoriteGame.color}>
                    <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
                  </svg>
                </div>
              </div>
            )}

            {/* Per-game statistics — one card per game the player has ever
                completed a session of. Populated automatically for every
                game (solo, multiplayer, tournament, challenge) with zero
                per-game special-casing, so new games show up here for free
                the moment someone plays them. */}
            {gameStats.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <p style={{ margin: '0 0 10px', fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  {isAr ? 'إحصائيات الألعاب' : 'Game Statistics'}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {gameStats.map((gs) => {
                    const g = gs.game
                    const color = g?.accent_color ?? '#7c3aed'
                    const name = g ? (isAr ? g.name_ar : g.name) : gs.game_id
                    const isOpen = expandedGameStat === gs.game_id
                    const accuracy = gs.total_questions > 0 ? Math.round((gs.total_correct / gs.total_questions) * 100) : null
                    return (
                      <div key={gs.game_id} className="card" style={{ padding: '12px 14px', border: `1px solid ${color}20` }}>
                        <button
                          onClick={() => setExpandedGameStat(isOpen ? null : gs.game_id)}
                          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'start' }}
                        >
                          <div style={{ width: 34, height: 34, borderRadius: 10, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <polygon points="5,3 19,12 5,21"/>
                            </svg>
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <p className={isAr ? 'font-cairo' : ''} style={{ margin: 0, fontSize: 13, fontWeight: 700, color: 'var(--foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</p>
                            <p style={{ margin: '2px 0 0', fontSize: 10.5, color: 'rgba(var(--fg2-rgb),0.5)' }}>
                              {isAr ? `${gs.games_played} لعبة · ${gs.wins} فوز` : `${gs.games_played} played · ${gs.wins} wins`}
                            </p>
                          </div>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg2-rgb),0.35)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s ease', flexShrink: 0 }}>
                            <polyline points="9,18 15,12 9,6"/>
                          </svg>
                        </button>
                        {isOpen && (
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, marginTop: 12, paddingTop: 12, borderTop: `1px solid ${color}18` }}>
                            {[
                              { en: 'Best Score', ar: 'أفضل نتيجة', val: gs.best_score.toLocaleString() },
                              { en: 'Best Streak', ar: 'أفضل تتابع', val: gs.best_streak.toLocaleString() },
                              { en: 'Current Streak', ar: 'التتابع الحالي', val: gs.current_streak.toLocaleString() },
                              { en: 'Accuracy', ar: 'الدقة', val: accuracy !== null ? `${accuracy}%` : '—' },
                              { en: 'Fastest Time', ar: 'أسرع وقت', val: gs.fastest_time_ms !== null ? `${(gs.fastest_time_ms / 1000).toFixed(1)}s` : '—' },
                              { en: 'Last Played', ar: 'آخر لعب', val: gs.last_played_at ? new Date(gs.last_played_at).toLocaleDateString(isAr ? 'ar' : 'en', { month: 'short', day: 'numeric' }) : '—' },
                            ].map((m) => (
                              <div key={m.en} style={{ textAlign: 'center' }}>
                                <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 14, fontWeight: 800, color: 'var(--foreground)' }}>{m.val}</div>
                                <div style={{ fontSize: 8.5, color: 'rgba(var(--fg2-rgb),0.45)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{isAr ? m.ar : m.en}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {/* Shortcuts — grouped. Friends moved to its own bottom-nav tab, so it
                no longer appears here; Weekly Challenge moved in (it lost its
                nav slot to Friends) so it's still reachable from Home + here. */}
            {([
              {
                key: 'progress',
                en: 'Progress & Rewards', ar: 'التقدم والمكافآت',
                // "Cosmetics Shop" removed — Shop now has its own permanent
                // bottom-nav destination, so this row would have been a
                // second, duplicate way to reach the exact same screen.
                items: [
                  { en: 'Weekly Challenge', ar: 'تحدي الأسبوع', screen: 'weekly' as Screen, color: '#ff6b35' },
                  { en: 'Achievements', ar: 'الإنجازات', screen: 'achievements' as Screen, color: '#9d6fff' },
                  { en: 'Season Pass', ar: 'بطاقة الموسم', screen: 'seasonpass' as Screen, color: '#ffd700' },
                ],
              },
              {
                key: 'competitive',
                en: 'Competitive', ar: 'تنافسي',
                items: [
                  { en: 'Tournaments', ar: 'البطولات', screen: 'tournament' as Screen, color: '#ff6b35' },
                ],
              },
              ...(userRole === 'owner'
                ? [{
                    key: 'admin',
                    en: 'Owner / Admin', ar: 'المالك / الإدارة',
                    items: [{ en: 'Admin Dashboard', ar: 'لوحة الإدارة', screen: 'admin' as Screen, color: '#ff4785' }],
                  }]
                : []),
            ] as { key: string; en: string; ar: string; items: { en: string; ar: string; screen: Screen; color: string }[] }[]).map((group) => (
              <div key={group.key} style={{ marginBottom: 18 }}>
                <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  {isAr ? group.ar : group.en}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {group.items.map((item) => (
                    <button
                      key={item.en}
                      onClick={() => onNavigate(item.screen)}
                      style={{ width: '100%', padding: '14px 16px', borderRadius: 16, border: '1px solid rgba(var(--fg-rgb),0.07)', background: 'rgba(var(--fg-rgb),0.04)', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', transition: 'background 0.2s ease', textAlign: 'start' }}
                    >
                      <div style={{ width: 36, height: 36, borderRadius: 12, background: `${item.color}14`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={item.color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                          <polygon points="5,3 19,12 5,21"/>
                        </svg>
                      </div>
                      <span className={isAr ? 'font-cairo' : ''} style={{ flex: 1, fontSize: 14, fontWeight: 600, color: 'var(--foreground)' }}>
                        {isAr ? item.ar : item.en}
                      </span>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg2-rgb),0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points={isAr ? '15,18 9,12 15,6' : '9,18 15,12 9,6'}/>
                      </svg>
                    </button>
                  ))}
                </div>
              </div>
            ))}

            {/* Settings & Support */}
            <p style={{ margin: '0 0 8px', fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {isAr ? 'الإعدادات والدعم' : 'Settings & Support'}
            </p>
            {/* Appearance — Light / Dark / System, persisted to localStorage */}
            <AppearancePicker isAr={isAr} />

            {/* Push notifications — enable/disable Web Push for this device */}
            <PushNotificationToggle isAr={isAr} />

            {/* Sign Out — always reachable from the main profile tab */}
            <button
              onClick={handleSignOut}
              disabled={signingOut}
              style={{
                width: '100%', marginTop: 14, padding: '14px 16px', borderRadius: 16,
                border: '1px solid rgba(255,71,133,0.25)', background: 'rgba(255,71,133,0.08)',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                cursor: signingOut ? 'default' : 'pointer', opacity: signingOut ? 0.6 : 1,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ff4785" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16,17 21,12 16,7" /><line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span className={isAr ? 'font-cairo' : ''} style={{ fontSize: 14, fontWeight: 700, color: '#ff4785' }}>
                {signingOut ? (isAr ? 'جارٍ تسجيل الخروج...' : 'Signing out…') : (isAr ? 'تسجيل الخروج' : 'Sign Out')}
              </span>
            </button>
          </>
        )}

        {/* ── BADGES ── */}
        {tab === 'badges' && (
          <>
            {/* Summary */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
              {([['Legendary', '#ffd700'], ['Epic', '#c084fc'], ['Rare', '#60a5fa'], ['Uncommon', '#34d399'], ['Common', '#9ca3af']] as const).map(([r, c]) => {
                const earned = badges.filter((b) => b.rarity === r && b.earned).length
                const total = badges.filter((b) => b.rarity === r).length
                return (
                  <div key={r} style={{ flex: 1, textAlign: 'center', padding: '8px 4px', background: `${c}10`, border: `1px solid ${c}25`, borderRadius: 12 }}>
                    <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 15, fontWeight: 900, color: c }}>{earned}/{total}</div>
                    <div className={`rarity-${r.toLowerCase()}`} style={{ marginTop: 2 }}>{isAr ? { Legendary: 'أسطوري', Epic: 'ملحمي', Rare: 'نادر', Uncommon: 'غير شائع', Common: 'عادي' }[r] : r}</div>
                  </div>
                )
              })}
            </div>

            {/* Badge grid by rarity */}
            {RARITY_ORDER.map((rarity) => {
              const group = badges.filter((b) => b.rarity === rarity)
              const rarityAr = { Legendary: 'أسطوري', Epic: 'ملحمي', Rare: 'نادر', Uncommon: 'غير شائع', Common: 'عادي' }[rarity]
              const rarityColor = { Legendary: '#ffd700', Epic: '#c084fc', Rare: '#60a5fa', Uncommon: '#34d399', Common: '#9ca3af' }[rarity]
              return (
                <div key={rarity} style={{ marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                    <span className={`rarity-${rarity.toLowerCase()}`}>{isAr ? rarityAr : rarity}</span>
                    <div style={{ flex: 1, height: 1, background: `${rarityColor}25` }} />
                    <span style={{ fontSize: 10, color: 'rgba(var(--fg2-rgb),0.35)' }}>
                      {group.filter((b) => b.earned).length}/{group.length}
                    </span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
                    {group.map((b) => (
                      <button
                        key={b.id}
                        onClick={() => setSelectedBadge(b)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, padding: 4 }}
                      >
                        <BadgeMark badge={b} size={54} />
                        <span style={{ fontSize: 10, color: b.earned ? 'rgba(var(--fg2-rgb),0.8)' : 'rgba(var(--fg2-rgb),0.3)', fontWeight: 600, textAlign: 'center', lineHeight: 1.3 }}>
                          {isAr ? b.nameAr : b.nameEn}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )
            })}
          </>
        )}

        {/* ── ACTIVITY ── */}
        {tab === 'activity' && (
          <div className="card" style={{ overflow: 'hidden' }}>
            {activityLog.map((a, i) => (
              <div
                key={a.id}
                style={{ display: 'flex', gap: 14, padding: '14px 16px', borderBottom: i < activityLog.length - 1 ? '1px solid rgba(var(--fg-rgb),0.05)' : 'none', alignItems: 'flex-start' }}
              >
                <div style={{ width: 32, height: 32, borderRadius: 10, background: `${activityColor(a.event_type)}14`, border: `1px solid ${activityColor(a.event_type)}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                  <div style={{ width: 8, height: 8, borderRadius: '50%', background: activityColor(a.event_type) }} />
                </div>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: '0 0 3px', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.85)', fontWeight: 500, lineHeight: 1.4 }}>{isAr ? a.message_ar : a.message}</p>
                  <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)' }}>{timeAgo(a.created_at, isAr)} {isAr ? 'مضت' : 'ago'}</p>
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'activity' && xpHistory.length > 0 && (
          <div className="card" style={{ overflow: 'hidden', marginTop: 12 }}>
            <p style={{ margin: 0, padding: '12px 16px 4px', fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {isAr ? 'سجل الخبرة' : 'XP History'}
            </p>
            {xpHistory.map((x, i) => (
              <div
                key={x.id}
                style={{ display: 'flex', gap: 12, padding: '10px 16px', borderBottom: i < xpHistory.length - 1 ? '1px solid rgba(var(--fg-rgb),0.05)' : 'none', alignItems: 'center' }}
              >
                <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 13, fontWeight: 800, color: x.delta >= 0 ? '#00e676' : '#ff4785', minWidth: 54 }}>
                  {x.delta >= 0 ? '+' : ''}{x.delta}
                </span>
                <div style={{ flex: 1 }}>
                  <p style={{ margin: 0, fontSize: 12.5, color: 'rgba(var(--fg2-rgb),0.8)' }}>{x.reason}</p>
                </div>
                <span style={{ fontSize: 10.5, color: 'rgba(var(--fg2-rgb),0.4)', flexShrink: 0 }}>{timeAgo(x.created_at, isAr)} {isAr ? 'مضت' : 'ago'}</span>
              </div>
            ))}
          </div>
        )}

        {/* ── SEASON ── */}
        {tab === 'season' && season && seasonTrack && (
          <div className="card" style={{ padding: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <div>
                <p style={{ margin: '0 0 3px', fontSize: 15, fontWeight: 800, fontFamily: "'Exo 2', sans-serif", color: '#ffd700' }}>
                  {isAr ? season.name_ar : season.name}
                </p>
                <p style={{ margin: 0, fontSize: 12, color: 'rgba(var(--fg2-rgb),0.5)' }}>
                  {isAr ? `${daysRemaining} يوماً متبقياً` : `${daysRemaining} days remaining`}
                </p>
              </div>
              <span className="badge badge-live">
                <span className="live-dot" style={{ width: 5, height: 5 }} />
                {isAr ? 'نشط' : 'ACTIVE'}
              </span>
            </div>
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5 }}>
                <span style={{ fontSize: 12, color: 'rgba(var(--fg2-rgb),0.55)' }}>{isAr ? 'مستوى الموسم' : 'Season Level'} {seasonTrack.progress.current_level}/{seasonTrack.nodes.length}</span>
                <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 12, fontWeight: 800, color: '#ffd700' }}>{seasonPercent}%</span>
              </div>
              <div className="xp-track" style={{ height: 8 }}>
                <div className="xp-fill xp-fill-gold" style={{ ['--xp-pct' as string]: seasonPercent / 100 } as CSSProperties} />
              </div>
            </div>
            <button className="btn btn-gold btn-sm" style={{ width: '100%', fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif" }} onClick={() => onNavigate('seasonpass')}>
              {isAr ? 'عرض مسار الموسم' : 'View Season Track'}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
