import { supabase } from './supabaseClient'
import type { CosmeticItem } from './api'

// =============================================================================
// Shared cosmetic-rendering pipeline. Every screen that displays a player's
// equipped frame/banner/title/decoration — Hero Profile, Friend Profile,
// Welcome Card, Leaderboard, match lobby, or anywhere else — must go through
// this module instead of re-deriving its own logic, for two reasons found
// while fixing the "equip doesn't visually update anything" bug:
//
// 1. Several screens computed the "current" cosmetic as
//    `owned.find(id === selected) ?? owned[0]`, which silently falls back to
//    whatever the first OWNED item happens to be (not the true default) the
//    moment nothing is equipped — that's how "Unequip" ended up not
//    restoring the real default look. There is no such fallback here: an
//    unresolved/null equipped id resolves to `null`, and the caller's own
//    "nothing equipped" rendering is the correct, real default.
// 2. cosmetic_items.style is a small semantic JSON blob (frames:
//    `{ring, glow}`, banners: `{bg: <gradient keyword>}`), not literal CSS.
//    RewardsScreen's shop preview already translated it correctly; every
//    other screen either didn't translate it at all (ProfileScreen spread
//    `style` directly onto a React style prop, which is a no-op since
//    `ring`/`glow` aren't real CSS properties) or never rendered cosmetics
//    at all. frameAvatarStyle()/bannerBackground() below are that same
//    translation, extracted so every screen — including RewardsScreen's own
//    shop preview — shares one implementation.
// =============================================================================

/** Fetches the full cosmetic catalog fresh from the database every call —
 * deliberately uncached so screens are always reading current server data,
 * never a stale local copy. The table is small (~50 rows), so this is cheap. */
export async function getCosmeticCatalog(): Promise<CosmeticItem[]> {
  const { data, error } = await supabase.from('cosmetic_items').select('*')
  if (error) { console.error('[careerxp:getCosmeticCatalog]', error); return [] }
  return data ?? []
}

export interface EquippedIds {
  equipped_frame_id?: string | null
  equipped_banner_id?: string | null
  equipped_title_id?: string | null
  equipped_decoration_id?: string | null
}

export interface ResolvedCosmetics {
  frame: CosmeticItem | null
  banner: CosmeticItem | null
  title: CosmeticItem | null
  decoration: CosmeticItem | null
}

/**
 * Looks up each of a profile's equipped ids in the catalog. Any slot that's
 * unequipped (null id) or whose id no longer resolves to a catalog row
 * (e.g. a removed item) resolves to `null` — never a fallback to "the first
 * owned item" or any other guess. Works for ANY profile shape that carries
 * the four equipped_* columns: the full `Profile` (own profile, via
 * useAuth), a `PublicProfile` (get_public_profiles — Friend Profile, match
 * lobby), or a `get_leaderboard_v2` row.
 */
export function resolveCosmetics(catalog: CosmeticItem[], ids: EquippedIds): ResolvedCosmetics {
  const byId = new Map(catalog.map((c) => [c.id, c]))
  return {
    frame: (ids.equipped_frame_id && byId.get(ids.equipped_frame_id)) || null,
    banner: (ids.equipped_banner_id && byId.get(ids.equipped_banner_id)) || null,
    title: (ids.equipped_title_id && byId.get(ids.equipped_title_id)) || null,
    decoration: (ids.equipped_decoration_id && byId.get(ids.equipped_decoration_id)) || null,
  }
}

/** Banner `style.bg` keyword -> real CSS gradient. Kept in sync with
 * RewardsScreen's shop preview (same map, single source of truth). */
const BANNER_GRADIENTS: Record<string, string> = {
  'aurora-gradient': 'linear-gradient(135deg,#00e676,#7c3aed,#00d4ff)',
  'tidal-gradient': 'linear-gradient(135deg,#00d4ff,#0d1a3d)',
  'nebula-gradient': 'linear-gradient(135deg,#7c3aed,#ff4785,#0d0d28)',
  'magma-gradient': 'linear-gradient(135deg,#ff6b35,#7c1d1d,#0d0d28)',
  'void-gradient': 'linear-gradient(135deg,#1a0a3d,#03030f,#7c3aed)',
  'cosmic-gradient': 'linear-gradient(135deg,#0d0d28,#1a0a3d,#0d1a3d)',
  'fire-gradient': 'linear-gradient(135deg,#ff6b35,#7c1d1d)',
  'ocean-gradient': 'linear-gradient(135deg,#00d4ff,#0d1a3d)',
}

/** Resolves an equipped banner into a real CSS background — falls back to
 * the caller's own default gradient when nothing is equipped or the style
 * keyword isn't recognized (never silently blank). */
export function bannerBackground(banner: CosmeticItem | null, fallback: string): string {
  const key = (banner?.style as any)?.bg
  return (key && BANNER_GRADIENTS[key]) || fallback
}

/**
 * Resolves an equipped frame into a real avatar border/glow style. The
 * cosmetic frame system is opt-in only: with no frame equipped (or an
 * equipped frame whose style carries no `ring`, e.g. an image-overlay
 * frame — Avatar.tsx handles those entirely on its own), this returns an
 * EMPTY object — no border, no boxShadow, nothing. That's what makes the
 * default (unframed) avatar render pixel-identical to the original
 * pre-cosmetics look everywhere: ProfileScreen, HomeScreen,
 * LeaderboardScreen, FriendProfileSheet, chat, shop preview.
 *
 * `baseBorder` is optional and exists ONLY for call sites that need a
 * border for a reason that has nothing to do with cosmetics — e.g.
 * GameLobbyScreen's ready/not-ready indicator ring, which must still show
 * even when the player has no frame equipped. Do not add a `baseBorder`
 * argument to a call site just to give the "unequipped" avatar some kind
 * of default edge — that reintroduces exactly the regression this comment
 * exists to prevent (a black/blue ring on a fully unframed avatar). If a
 * frame IS equipped and its style has a `ring`, that ring always wins
 * over any `baseBorder` passed in.
 */
export function frameAvatarStyle(frame: CosmeticItem | null, baseBorder?: string): { border?: string; boxShadow?: string } {
  const style = (frame?.style as any) ?? {}
  if (!style.ring) return baseBorder ? { border: baseBorder } : {}
  return {
    border: `3px solid ${style.ring}`,
    boxShadow: style.glow ? `0 0 14px ${style.ring}88` : undefined,
  }
}
