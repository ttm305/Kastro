import { useEffect, useMemo, useState } from 'react'
import type { Screen, Lang } from '../App'
import TopBar from '../components/TopBar'
import { useAuth } from '../lib/auth'
import { getShopCatalog, purchaseCosmeticItem, getWeeklyCoinsEarned, equipCosmetic, type ShopItem, type EquipSlot } from '../lib/api'
import CosmeticBannerLayer from '../components/CosmeticBannerLayer'
import Avatar from '../components/Avatar'

interface Props {
  // Shop is now a top-level bottom-nav tab (replacing Hero/Profile), so it
  // no longer needs a back-button destination — kept optional/unused for
  // prop-shape consistency with the other top-level tabs (see Leaderboard/
  // FriendsScreen, which follow the same pattern).
  onNavigate?: (s: Screen) => void
  lang: Lang
  setLang: (l: Lang) => void
}

// ── Cosmetics Shop — Coins only. Nothing here is ever exchangeable for
// real-world value; every item is a pure display collectible or cosmetic
// equip slot. Purchasing never changes XP, level, rank, or achievements. ──

type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic'
type CategoryKey = 'all' | 'badge_collectible' | 'trophy' | 'frame' | 'title' | 'banner' | 'avatar_decoration' | 'victory_animation' | 'emote' | 'seasonal'
type SortKey = 'default' | 'price_asc' | 'price_desc' | 'rarity' | 'newest'

const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic']

const SORT_META: { key: SortKey; en: string; ar: string }[] = [
  { key: 'default',    en: 'Featured',    ar: 'مميّز' },
  { key: 'newest',     en: 'Newest',      ar: 'الأحدث' },
  { key: 'price_asc',  en: 'Price: Low',  ar: 'السعر: الأقل' },
  { key: 'price_desc', en: 'Price: High', ar: 'السعر: الأعلى' },
  { key: 'rarity',     en: 'Rarity',      ar: 'الندرة' },
]

const RARITY_META: Record<Rarity, { en: string; ar: string; color: string; glow: string }> = {
  common:    { en: 'Common',    ar: 'عادي',        color: '#9ca3af', glow: 'rgba(156,163,175,0.25)' },
  rare:      { en: 'Rare',      ar: 'نادر',         color: '#60a5fa', glow: 'rgba(96,165,250,0.3)' },
  epic:      { en: 'Epic',      ar: 'ملحمي',        color: '#c084fc', glow: 'rgba(192,132,252,0.3)' },
  legendary: { en: 'Legendary', ar: 'أسطوري',       color: '#ffd700', glow: 'rgba(255,215,0,0.35)' },
  mythic:    { en: 'Mythic',    ar: 'أسطوري خارق',  color: '#ff3d68', glow: 'rgba(255,61,104,0.4)' },
}

const CATEGORY_META: { key: CategoryKey; en: string; ar: string; equipSlot?: EquipSlot }[] = [
  { key: 'all',                en: 'All',        ar: 'الكل' },
  { key: 'badge_collectible',  en: 'Badges',      ar: 'الميداليات' },
  { key: 'trophy',             en: 'Trophies',    ar: 'الكؤوس' },
  { key: 'frame',              en: 'Frames',      ar: 'الإطارات',      equipSlot: 'frame' },
  { key: 'title',              en: 'Nameplates',  ar: 'الألقاب',       equipSlot: 'title' },
  { key: 'banner',             en: 'Backgrounds', ar: 'الخلفيات',      equipSlot: 'banner' },
  { key: 'avatar_decoration',  en: 'Decorations', ar: 'الزخارف',       equipSlot: 'decoration' },
  { key: 'victory_animation',  en: 'Victory FX',  ar: 'حركات الانتصار' },
  { key: 'emote',              en: 'Emotes',      ar: 'التعبيرات' },
  { key: 'seasonal',           en: 'Seasonal',    ar: 'موسمي' },
]

const EQUIP_SLOT_BY_TYPE: Record<string, EquipSlot> = {
  frame: 'frame', banner: 'banner', title: 'title', avatar_decoration: 'decoration',
}

function Toast({ msg, visible, color = '#00e676' }: { msg: string; visible: boolean; color?: string }) {
  if (!visible) return null
  return (
    <div
      style={{
        position: 'fixed', bottom: 88, left: '50%', transform: 'translateX(-50%)',
        background: color, color: color === '#00e676' ? '#03030f' : '#fff',
        padding: '9px 20px', borderRadius: 10, fontSize: 12, fontWeight: 700, zIndex: 9200,
        boxShadow: '0 4px 20px rgba(0,0,0,0.4)', animation: 'toast-in 0.25s ease-out', maxWidth: '86%', textAlign: 'center',
      }}
    >
      {msg}
    </div>
  )
}

function ItemPreviewVisual({
  item, size = 88, avatarUrl, equippedFrame, username,
}: { item: ShopItem; size?: number; avatarUrl?: string | null; equippedFrame?: ShopItem | null; username?: string | null }) {
  // Frame ring/glow and banner gradient-keyword translation now live in
  // src/lib/cosmetics.ts — the single source of truth every screen that
  // renders an equipped cosmetic shares, so the shop preview always matches
  // what actually shows up equipped elsewhere in the app.
  if (item.type === 'frame') {
    // Real layered frame artwork (image_url set): composite it over the
    // player's actual avatar via the shared Avatar component — the same
    // frame overlay that shows up everywhere the frame is actually equipped.
    if (item.image_url) {
      return <Avatar url={avatarUrl} alt={item.label} size={size} frame={item} />
    }
    // Legacy items with no overlay artwork yet: the color-ring fallback,
    // reading the same {ring, glow} fields cosmetics.ts does.
    const style = (item.style as any) ?? {}
    const ring = style.ring ?? RARITY_META[item.rarity as Rarity]?.color ?? '#9d6fff'
    return (
      <div style={{ width: size, height: size, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', border: `4px solid ${ring}`, boxShadow: style.glow ? `0 0 24px ${ring}66` : 'none', background: 'rgba(var(--fg-rgb),0.05)' }}>
        <span style={{ fontSize: size * 0.4 }}>{item.icon}</span>
      </div>
    )
  }
  if (item.type === 'banner') {
    // Live preview: if the item is a real animated banner, this actually
    // plays the loop (muted, autoplay) right in the shop tile — requirement
    // (6) "show a small live preview in the Shop" — via the same component
    // every equipped-banner surface in the app uses, so what a player sees
    // here before buying is exactly what they'll see once equipped.
    //
    // No icon/emoji is stamped on top of real banner artwork (image_url,
    // video_url, or an animated_svg) — that was the exact bug reported
    // ("a flag emoji placed in the middle" / "a smaller flag floating
    // inside"). The icon glyph is only shown as a last-resort placeholder
    // for the handful of legacy items that still have nothing but a flat
    // CSS-gradient fallback and no real art behind them yet.
    const hasRealArt = !!(item.image_url || item.video_url || item.media_type === 'animated_svg')
    // Miniature profile mockup composited on top: avatar (with the
    // player's actual equipped frame, if any) + username, together with
    // the banner — so buyers see what their real header will look like,
    // not a bare rectangle. Requirement: "For headers: show a miniature
    // profile preview; include avatar, frame, username and banner
    // together; animated banners must animate in the preview."
    const avatarSize = Math.round(size * 0.42)
    return (
      <div style={{ width: size * 1.8, height: size * 1.15, borderRadius: 16, position: 'relative', overflow: 'hidden', border: '1px solid rgba(var(--fg-rgb),0.1)' }}>
        <CosmeticBannerLayer banner={item} fallbackGradient="linear-gradient(135deg,#0d0d28,#1a0a3d)" />
        {!hasRealArt && (
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1, fontSize: size * 0.35, filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.5))' }}>{item.icon}</span>
        )}
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, padding: '8px 10px', display: 'flex', alignItems: 'center', gap: 8, background: 'linear-gradient(0deg, rgba(0,0,0,0.55), rgba(0,0,0,0))' }}>
          <Avatar url={avatarUrl} size={avatarSize} frame={equippedFrame ?? null} />
          <span style={{ fontSize: 11.5, fontWeight: 700, color: '#fff', textShadow: '0 1px 3px rgba(0,0,0,0.6)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            @{username || '—'}
          </span>
        </div>
      </div>
    )
  }
  return (
    <div style={{ width: size, height: size, borderRadius: 20, display: 'flex', alignItems: 'center', justifyContent: 'center', background: `${RARITY_META[item.rarity as Rarity]?.color ?? '#9d6fff'}18`, border: `1.5px solid ${RARITY_META[item.rarity as Rarity]?.color ?? '#9d6fff'}40`, boxShadow: `0 0 20px ${RARITY_META[item.rarity as Rarity]?.glow ?? 'transparent'}` }}>
      <span style={{ fontSize: size * 0.42 }}>{item.icon}</span>
    </div>
  )
}

export default function RewardsScreen({ lang, setLang }: Props) {
  const { profile, refreshProfile } = useAuth()
  const [category, setCategory] = useState<CategoryKey>('all')
  // Applied filters — everything below `category` lives inside the Filter
  // bottom sheet now, not on the always-visible main page (requirement:
  // "Keep the main page simple. At the top show only: shop title; currency
  // balance; horizontal cosmetic category tabs; search button; one clear
  // Filter button.").
  const [rarity, setRarity] = useState<'all' | Rarity>('all')
  const [collection, setCollection] = useState<string>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | 'static' | 'animated'>('all')
  const [ownership, setOwnership] = useState<'all' | 'owned' | 'not_owned' | 'equipped'>('all')
  const [sort, setSort] = useState<SortKey>('default')
  const [items, setItems] = useState<ShopItem[]>([])
  const [loading, setLoading] = useState(true)
  const [weeklyCoins, setWeeklyCoins] = useState(0)
  const [preview, setPreview] = useState<ShopItem | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [purchasing, setPurchasing] = useState(false)
  const [equipping, setEquipping] = useState(false)
  const [toast, setToast] = useState<{ msg: string; color?: string } | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [search, setSearch] = useState('')
  // Draft copies edited inside the Filter sheet — only committed to the
  // real (applied) filter state above when the user taps "Apply filters",
  // so browsing the sheet never re-filters the grid behind it mid-edit.
  const [draftRarity, setDraftRarity] = useState<'all' | Rarity>('all')
  const [draftCollection, setDraftCollection] = useState<string>('all')
  const [draftType, setDraftType] = useState<'all' | 'static' | 'animated'>('all')
  const [draftOwnership, setDraftOwnership] = useState<'all' | 'owned' | 'not_owned' | 'equipped'>('all')
  const [draftSort, setDraftSort] = useState<SortKey>('default')
  const isAr = lang === 'ar'
  const myCoins = profile?.coins ?? 0

  const activeFilterCount =
    (rarity !== 'all' ? 1 : 0) + (collection !== 'all' ? 1 : 0) + (typeFilter !== 'all' ? 1 : 0) +
    (ownership !== 'all' ? 1 : 0) + (sort !== 'default' ? 1 : 0)

  const openFilters = () => {
    setDraftRarity(rarity); setDraftCollection(collection); setDraftType(typeFilter)
    setDraftOwnership(ownership); setDraftSort(sort)
    setShowFilters(true)
  }
  const applyFilters = () => {
    setRarity(draftRarity); setCollection(draftCollection); setTypeFilter(draftType)
    setOwnership(draftOwnership); setSort(draftSort)
    setShowFilters(false)
  }
  const resetDraftFilters = () => {
    setDraftRarity('all'); setDraftCollection('all'); setDraftType('all')
    setDraftOwnership('all'); setDraftSort('default')
  }

  const flash = (msg: string, color?: string) => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 2400)
  }

  const load = async (userId: string) => {
    const [catalog, weekly] = await Promise.all([getShopCatalog(userId), getWeeklyCoinsEarned(userId)])
    setItems(catalog)
    setWeeklyCoins(weekly)
  }

  useEffect(() => {
    if (!profile?.id) return
    let cancelled = false
    setLoading(true)
    load(profile.id).then(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile?.id])

  // Keep the open preview modal's item in sync after a purchase/equip refresh.
  useEffect(() => {
    if (!preview) return
    const fresh = items.find((i) => i.id === preview.id)
    if (fresh) setPreview(fresh)
  }, [items]) // eslint-disable-line react-hooks/exhaustive-deps

  // Collection chips are never hardcoded — they're derived from whatever
  // `collection` values actually exist on the items returned by the shop
  // catalog, so a brand-new collection just appears here the moment an
  // admin adds items tagged with it, with zero code changes.
  const knownCollections = useMemo(
    () => Array.from(new Set(items.map((i) => i.collection).filter((v): v is string => !!v))).sort(),
    [items],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const base = items.filter((i) =>
      (category === 'all' || i.type === category) &&
      (rarity === 'all' || i.rarity === rarity) &&
      (collection === 'all' || i.collection === collection) &&
      (typeFilter === 'all' || (typeFilter === 'animated' ? i.is_animated : !i.is_animated)) &&
      (ownership === 'all' ||
        (ownership === 'owned' && i.owned) ||
        (ownership === 'not_owned' && !i.owned) ||
        (ownership === 'equipped' && i.equipped)) &&
      (!q || i.label.toLowerCase().includes(q) || i.label_ar.includes(search.trim()))
    )
    const sorted = [...base]
    switch (sort) {
      case 'price_asc': sorted.sort((a, b) => (a.price_coins ?? 0) - (b.price_coins ?? 0)); break
      case 'price_desc': sorted.sort((a, b) => (b.price_coins ?? 0) - (a.price_coins ?? 0)); break
      case 'rarity': sorted.sort((a, b) => RARITY_ORDER.indexOf(a.rarity as Rarity) - RARITY_ORDER.indexOf(b.rarity as Rarity)); break
      case 'newest': sorted.sort((a, b) => new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime()); break
      default: sorted.sort((a, b) => (b.is_featured ? 1 : 0) - (a.is_featured ? 1 : 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0))
    }
    return sorted
  }, [items, category, rarity, collection, typeFilter, ownership, sort, search])

  const closePreview = () => { setPreview(null); setConfirming(false) }

  const handlePurchase = async (item: ShopItem) => {
    if (!confirming) { setConfirming(true); return }
    setPurchasing(true)
    const { error } = await purchaseCosmeticItem(item.id)
    setPurchasing(false)
    setConfirming(false)
    if (error) {
      flash(/insufficient/i.test(error) ? (isAr ? 'كوينز غير كافية' : 'Not enough Coins') : error, '#ff4785')
      return
    }
    await refreshProfile()
    if (profile?.id) await load(profile.id)
    flash(isAr ? `✓ تم فتح ${item.label_ar}` : `✓ Unlocked ${item.label}`, '#00e676')
  }

  const handleEquip = async (item: ShopItem, equip: boolean) => {
    const slot = EQUIP_SLOT_BY_TYPE[item.type]
    if (!slot) return
    setEquipping(true)
    const { error } = await equipCosmetic(slot, equip ? item.id : null)
    setEquipping(false)
    if (error) { flash(error, '#ff4785'); return }
    await refreshProfile()
    if (profile?.id) await load(profile.id)
    flash(equip ? (isAr ? '✓ تم التجهيز' : '✓ Equipped') : (isAr ? '✓ تم الإلغاء' : '✓ Unequipped'), '#00e676')
  }

  if (loading) {
    return (
      <div className="screen bg-mesh">
        <TopBar title="Shop" titleAr="المتجر" lang={lang} setLang={setLang} />
        <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.4)' }}>
          {isAr ? 'جارٍ التحميل...' : 'Loading…'}
        </div>
      </div>
    )
  }

  return (
    <div className="screen bg-mesh">
      <style>{`
        @keyframes toast-in { from{opacity:0;transform:translate(-50%,8px)} to{opacity:1;transform:translate(-50%,0)} }
        @keyframes sheet-in { from{opacity:0;transform:translateY(24px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
      <Toast msg={toast?.msg || ''} visible={!!toast} color={toast?.color} />
      <TopBar title="Shop" titleAr="المتجر" lang={lang} setLang={setLang} />

      <div className="pb-nav" style={{ padding: '16px 16px' }}>

        {/* My Coins */}
        <div
          className="glass-card"
          style={{
            padding: '20px', marginBottom: 16,
            background: 'linear-gradient(135deg, rgba(255,215,0,0.16) 0%, rgba(124,58,237,0.1) 100%)',
            border: '1px solid rgba(255,215,0,0.25)',
            display: 'flex', alignItems: 'center', gap: 16,
          }}
        >
          <div style={{ width: 56, height: 56, borderRadius: 18, background: 'linear-gradient(135deg, #ffd700, #f59e0b)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 28, boxShadow: '0 0 24px rgba(255,215,0,0.35)', flexShrink: 0 }}>
            🪙
          </div>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 12, color: 'rgba(var(--fg2-rgb),0.55)' }}>{isAr ? 'رصيدي من الكوينز' : 'My Coins'}</p>
            <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 32, fontWeight: 800, color: '#ffd700', lineHeight: 1 }}>
              {myCoins.toLocaleString()}
            </div>
            {weeklyCoins > 0 && (
              <p style={{ margin: '4px 0 0', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)' }}>
                {isAr ? `+ ${weeklyCoins.toLocaleString()} كوينز هذا الأسبوع` : `+${weeklyCoins.toLocaleString()} Coins this week`}
              </p>
            )}
          </div>
        </div>

        {/* Simplified top: category tabs + search + one Filter button.
            Rarity / Collection / Type / Ownership / Sort all live inside the
            Filter bottom sheet now — nothing else is visible until the user
            opens it (requirement: "Keep the main page simple"). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 2, scrollbarWidth: 'none', flex: 1, minWidth: 0 }}>
            {CATEGORY_META.map((c) => (
              <button
                key={c.key}
                onClick={() => setCategory(c.key)}
                aria-current={category === c.key}
                style={{
                  padding: '10px 16px', borderRadius: 99, border: 'none', cursor: 'pointer', flexShrink: 0,
                  fontSize: 12.5, fontWeight: 600, transition: 'all 0.2s ease', minHeight: 40,
                  background: category === c.key ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(var(--fg-rgb),0.06)',
                  color: category === c.key ? 'white' : 'rgba(var(--fg2-rgb),0.5)',
                  fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit',
                }}
              >
                {isAr ? c.ar : c.en}
              </button>
            ))}
          </div>
          <button
            onClick={() => setShowSearch((v) => !v)}
            aria-label={isAr ? 'بحث' : 'Search'}
            style={{ width: 40, height: 40, flexShrink: 0, borderRadius: 12, border: `1px solid ${showSearch ? 'rgba(157,111,255,0.5)' : 'rgba(var(--fg-rgb),0.1)'}`, background: showSearch ? 'rgba(157,111,255,0.15)' : 'var(--surface-2)', color: showSearch ? '#9d6fff' : 'var(--foreground)', cursor: 'pointer', fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          >
            🔍
          </button>
          <button
            onClick={openFilters}
            style={{ position: 'relative', height: 40, flexShrink: 0, padding: '0 16px', borderRadius: 12, border: `1px solid ${activeFilterCount > 0 ? 'rgba(157,111,255,0.5)' : 'rgba(var(--fg-rgb),0.1)'}`, background: activeFilterCount > 0 ? 'rgba(157,111,255,0.15)' : 'var(--surface-2)', color: activeFilterCount > 0 ? '#9d6fff' : 'var(--foreground)', cursor: 'pointer', fontSize: 12.5, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}
          >
            {isAr ? 'الفلاتر' : 'Filter'}
            {activeFilterCount > 0 && (
              <span style={{ minWidth: 16, height: 16, borderRadius: 99, background: '#9d6fff', color: '#fff', fontSize: 9.5, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 3px' }}>
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {showSearch && (
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isAr ? 'ابحث عن عنصر...' : 'Search items...'}
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', borderRadius: 12, border: '1px solid rgba(var(--fg-rgb),0.12)', background: 'var(--surface-2)', color: 'var(--foreground)', fontSize: 13, marginBottom: 12, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit' }}
          />
        )}

        <div style={{ marginBottom: 12, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)', fontWeight: 600 }}>
          {isAr ? `${filtered.length} من ${items.length}` : `${filtered.length} of ${items.length}`}
        </div>

        {filtered.length === 0 && (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: 'rgba(var(--fg2-rgb),0.4)', fontSize: 13 }}>
            {isAr ? 'لا توجد عناصر في هذه الفئة' : 'No items in this category'}
          </div>
        )}

        {/* Item grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {filtered.map((item) => {
            const meta = RARITY_META[item.rarity as Rarity] ?? RARITY_META.common
            const canAfford = myCoins >= (item.price_coins ?? 0)
            const locked = item.lockedSeasonal
            return (
              <button
                key={item.id}
                onClick={() => setPreview(item)}
                className="glass-card"
                style={{
                  padding: '16px 14px', position: 'relative', overflow: 'hidden', textAlign: 'start',
                  border: `1px solid ${item.equipped ? '#9d6fff80' : `${meta.color}25`}`,
                  cursor: 'pointer', opacity: locked ? 0.5 : 1,
                }}
              >
                <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 2, background: `linear-gradient(90deg, ${meta.color}, transparent)` }} />
                {item.is_featured && (
                  <span style={{ position: 'absolute', top: 8, insetInlineEnd: 8, fontSize: 9, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#ffc400', background: 'rgba(255,196,0,0.15)', border: '1px solid rgba(255,196,0,0.35)', borderRadius: 99, padding: '2px 7px' }}>
                    {isAr ? 'مميّز' : 'Featured'}
                  </span>
                )}
                {item.thumbnail_url ? (
                  <div style={{ width: 44, height: 44, borderRadius: 12, overflow: 'hidden', marginBottom: 8, background: 'rgba(var(--fg-rgb),0.05)' }}>
                    <img src={item.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} onError={(e) => { e.currentTarget.style.display = 'none' }} />
                  </div>
                ) : (
                  <div style={{ fontSize: 30, marginBottom: 8 }}>{item.icon}</div>
                )}
                <p style={{ margin: '0 0 2px', fontSize: 12.5, fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.3 }}>
                  {isAr ? item.label_ar : item.label}
                </p>
                <span style={{ display: 'inline-block', marginBottom: 8, fontSize: 9.5, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.05em', color: meta.color }}>
                  {isAr ? meta.ar : meta.en}
                </span>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: canAfford ? '#ffd700' : 'rgba(var(--fg2-rgb),0.4)' }}>
                    {item.price_coins ? `🪙 ${item.price_coins.toLocaleString()}` : '—'}
                  </span>
                  {item.owned ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: item.equipped ? '#9d6fff' : '#00e676' }}>
                      {item.equipped ? (isAr ? 'مجهّز' : 'Equipped') : (isAr ? 'مملوك' : 'Owned')}
                    </span>
                  ) : locked ? (
                    <span style={{ fontSize: 10, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.4)' }}>{isAr ? 'غير متاح' : 'Unavailable'}</span>
                  ) : null}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Filter bottom sheet — Rarity / Collection / Type / Ownership / Sort,
          all hidden until the user taps the Filter button. Edits here are
          drafts; nothing re-filters the grid until "Apply filters". */}
      {showFilters && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(3,3,15,0.88)', zIndex: 9300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={() => setShowFilters(false)}
        >
          <div
            style={{ width: '100%', maxWidth: 480, maxHeight: '82vh', overflowY: 'auto', background: 'var(--surface-2)', borderRadius: '24px 24px 0 0', padding: '20px 20px 16px', border: '1px solid rgba(var(--fg-rgb),0.08)', animation: 'sheet-in 0.25s ease-out' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--foreground)' }}>{isAr ? 'الفلاتر' : 'Filters'}</h3>
              <button onClick={() => setShowFilters(false)} aria-label={isAr ? 'إغلاق' : 'Close'} style={{ width: 32, height: 32, borderRadius: 99, border: 'none', background: 'rgba(var(--fg-rgb),0.08)', color: 'var(--foreground)', cursor: 'pointer', fontSize: 15 }}>✕</button>
            </div>

            <p style={{ margin: '0 0 8px', fontSize: 11.5, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.5)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{isAr ? 'الندرة' : 'Rarity'}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
              <button onClick={() => setDraftRarity('all')} style={{ padding: '7px 14px', borderRadius: 99, border: `1px solid ${draftRarity === 'all' ? 'rgba(157,111,255,0.5)' : 'rgba(var(--fg-rgb),0.08)'}`, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: draftRarity === 'all' ? 'rgba(157,111,255,0.15)' : 'transparent', color: draftRarity === 'all' ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.5)' }}>
                {isAr ? 'الكل' : 'All'}
              </button>
              {RARITY_ORDER.map((r) => (
                <button key={r} onClick={() => setDraftRarity(r)} style={{ padding: '7px 14px', borderRadius: 99, border: `1px solid ${draftRarity === r ? `${RARITY_META[r].color}80` : 'rgba(var(--fg-rgb),0.08)'}`, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: draftRarity === r ? `${RARITY_META[r].color}20` : 'transparent', color: draftRarity === r ? RARITY_META[r].color : 'rgba(var(--fg2-rgb),0.5)' }}>
                  {isAr ? RARITY_META[r].ar : RARITY_META[r].en}
                </button>
              ))}
            </div>

            {knownCollections.length > 0 && (
              <>
                <p style={{ margin: '0 0 8px', fontSize: 11.5, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.5)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{isAr ? 'المجموعة' : 'Collection'}</p>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
                  <button onClick={() => setDraftCollection('all')} style={{ padding: '7px 14px', borderRadius: 99, border: `1px solid ${draftCollection === 'all' ? 'rgba(157,111,255,0.5)' : 'rgba(var(--fg-rgb),0.08)'}`, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: draftCollection === 'all' ? 'rgba(157,111,255,0.15)' : 'transparent', color: draftCollection === 'all' ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.5)' }}>
                    {isAr ? 'الكل' : 'All'}
                  </button>
                  {knownCollections.map((c) => (
                    <button key={c} onClick={() => setDraftCollection(c)} style={{ padding: '7px 14px', borderRadius: 99, border: `1px solid ${draftCollection === c ? 'rgba(157,111,255,0.5)' : 'rgba(var(--fg-rgb),0.08)'}`, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: draftCollection === c ? 'rgba(157,111,255,0.15)' : 'transparent', color: draftCollection === c ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.5)' }}>
                      {c}
                    </button>
                  ))}
                </div>
              </>
            )}

            <p style={{ margin: '0 0 8px', fontSize: 11.5, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.5)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{isAr ? 'النوع' : 'Type'}</p>
            <div style={{ display: 'flex', gap: 6, marginBottom: 18 }}>
              {([['all', isAr ? 'الكل' : 'All'], ['static', isAr ? 'ثابت' : 'Static'], ['animated', isAr ? 'متحرك' : 'Animated']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setDraftType(v)} style={{ flex: 1, padding: '8px 10px', borderRadius: 10, border: `1px solid ${draftType === v ? 'rgba(157,111,255,0.5)' : 'rgba(var(--fg-rgb),0.08)'}`, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: draftType === v ? 'rgba(157,111,255,0.15)' : 'transparent', color: draftType === v ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.5)' }}>
                  {label}
                </button>
              ))}
            </div>

            <p style={{ margin: '0 0 8px', fontSize: 11.5, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.5)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{isAr ? 'الملكية' : 'Ownership'}</p>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 18 }}>
              {([['all', isAr ? 'الكل' : 'All'], ['owned', isAr ? 'مملوك' : 'Owned'], ['not_owned', isAr ? 'غير مملوك' : 'Not owned'], ['equipped', isAr ? 'مجهّز' : 'Equipped']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setDraftOwnership(v)} style={{ padding: '7px 14px', borderRadius: 99, border: `1px solid ${draftOwnership === v ? 'rgba(157,111,255,0.5)' : 'rgba(var(--fg-rgb),0.08)'}`, cursor: 'pointer', fontSize: 12, fontWeight: 700, background: draftOwnership === v ? 'rgba(157,111,255,0.15)' : 'transparent', color: draftOwnership === v ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.5)' }}>
                  {label}
                </button>
              ))}
            </div>

            <p style={{ margin: '0 0 8px', fontSize: 11.5, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.5)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{isAr ? 'الترتيب' : 'Sorting'}</p>
            <select
              value={draftSort}
              onChange={(e) => setDraftSort(e.target.value as SortKey)}
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 10, border: '1px solid rgba(var(--fg-rgb),0.1)', background: 'var(--surface-1)', color: 'var(--foreground)', fontSize: 13, fontWeight: 600, marginBottom: 22 }}
            >
              {SORT_META.map((s) => <option key={s.key} value={s.key}>{isAr ? s.ar : s.en}</option>)}
            </select>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={resetDraftFilters}
                style={{ flex: 1, padding: '13px', borderRadius: 12, border: '1px solid rgba(var(--fg-rgb),0.12)', background: 'transparent', color: 'var(--foreground)', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}
              >
                {isAr ? 'إعادة تعيين' : 'Reset'}
              </button>
              <button
                onClick={applyFilters}
                style={{ flex: 2, padding: '13px', borderRadius: 12, border: 'none', background: 'linear-gradient(135deg, #7c3aed, #4f46e5)', color: '#fff', cursor: 'pointer', fontSize: 13, fontWeight: 800 }}
              >
                {isAr ? 'تطبيق الفلاتر' : 'Apply filters'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Preview / purchase modal */}
      {preview && (() => {
        const item = preview
        const meta = RARITY_META[item.rarity as Rarity] ?? RARITY_META.common
        const canAfford = myCoins >= (item.price_coins ?? 0)
        const equipSlot = EQUIP_SLOT_BY_TYPE[item.type]
        return (
          <div
            style={{ position: 'fixed', inset: 0, background: 'rgba(3,3,15,0.88)', zIndex: 9300, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
            onClick={closePreview}
          >
            <div
              style={{ width: '100%', maxWidth: 480, background: 'var(--surface-2)', borderRadius: '24px 24px 0 0', padding: '24px 20px 40px', border: '1px solid rgba(var(--fg-rgb),0.08)', animation: 'sheet-in 0.25s ease-out' }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
                <ItemPreviewVisual
                  item={item}
                  size={item.type === 'banner' ? 72 : 92}
                  avatarUrl={profile?.avatar_url}
                  equippedFrame={items.find((i) => i.type === 'frame' && i.equipped) ?? null}
                  username={profile?.username}
                />
              </div>

              <h3 style={{ textAlign: 'center', margin: '0 0 4px', fontSize: 19, fontWeight: 800, fontFamily: "'Exo 2', sans-serif", color: 'var(--foreground)' }}>
                {isAr ? item.label_ar : item.label}
              </h3>
              <div style={{ textAlign: 'center', marginBottom: 12 }}>
                <span style={{ fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: meta.color, padding: '3px 10px', borderRadius: 99, background: `${meta.color}18`, border: `1px solid ${meta.color}40` }}>
                  {isAr ? meta.ar : meta.en}
                </span>
              </div>
              <p style={{ textAlign: 'center', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.65)', marginBottom: 20, lineHeight: 1.6, padding: '0 8px' }}>
                {isAr ? item.description_ar : item.description}
              </p>

              {item.lockedSeasonal ? (
                <div style={{ textAlign: 'center', padding: '12px 16px', background: 'rgba(var(--fg-rgb),0.04)', border: '1px solid rgba(var(--fg-rgb),0.08)', borderRadius: 12, marginBottom: 12 }}>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: 'rgba(var(--fg2-rgb),0.55)' }}>
                    {isAr ? 'هذا العنصر الموسمي غير متاح للشراء حالياً' : 'This seasonal item is not currently available for purchase'}
                  </span>
                </div>
              ) : item.owned ? (
                <>
                  <div style={{ textAlign: 'center', padding: '10px 16px', background: 'rgba(0,230,118,0.08)', border: '1px solid rgba(0,230,118,0.2)', borderRadius: 12, marginBottom: 12 }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#00e676' }}>{isAr ? '✓ مملوك' : '✓ Owned'}</span>
                  </div>
                  {equipSlot && (
                    <button
                      className={item.equipped ? 'btn btn-ghost' : 'btn btn-primary'}
                      style={{ width: '100%' }}
                      disabled={equipping}
                      onClick={() => handleEquip(item, !item.equipped)}
                    >
                      {equipping ? (isAr ? '...' : '…') : item.equipped ? (isAr ? 'إلغاء التجهيز' : 'Unequip') : (isAr ? 'تجهيز' : 'Equip')}
                    </button>
                  )}
                </>
              ) : (
                <>
                  {!canAfford && (
                    <div style={{ textAlign: 'center', padding: '10px 16px', background: 'rgba(255,71,133,0.08)', border: '1px solid rgba(255,71,133,0.2)', borderRadius: 12, marginBottom: 12 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 700, color: '#ff4785' }}>
                        {isAr
                          ? `تحتاج ${((item.price_coins ?? 0) - myCoins).toLocaleString()} كوينز إضافية`
                          : `You need ${((item.price_coins ?? 0) - myCoins).toLocaleString()} more Coins`}
                      </span>
                    </div>
                  )}
                  {confirming && canAfford && (
                    <p style={{ textAlign: 'center', fontSize: 12, color: 'rgba(var(--fg2-rgb),0.55)', marginBottom: 10 }}>
                      {isAr ? `تأكيد شراء "${item.label_ar}" مقابل ${item.price_coins?.toLocaleString()} كوينز؟` : `Confirm purchase of "${item.label}" for ${item.price_coins?.toLocaleString()} Coins?`}
                    </p>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    {confirming && (
                      <button className="btn btn-ghost" style={{ flex: 1 }} onClick={() => setConfirming(false)} disabled={purchasing}>
                        {isAr ? 'إلغاء' : 'Cancel'}
                      </button>
                    )}
                    <button
                      className="btn btn-gold"
                      style={{ flex: 1 }}
                      disabled={!canAfford || purchasing}
                      onClick={() => handlePurchase(item)}
                    >
                      {purchasing
                        ? (isAr ? '...' : '…')
                        : confirming
                          ? (isAr ? 'تأكيد الشراء' : 'Confirm Purchase')
                          : (isAr ? `شراء مقابل ${item.price_coins?.toLocaleString()} 🪙` : `Buy for ${item.price_coins?.toLocaleString()} 🪙`)}
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })()}
    </div>
  )
}
