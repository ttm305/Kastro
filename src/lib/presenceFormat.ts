/**
 * Shared "Online now" / "Last seen X ago" formatter. Every screen that
 * shows presence (FriendsScreen, FriendProfileSheet, ChatConversation)
 * used to render a flat Online/Offline boolean with no relative-time
 * fallback — this is the single source of truth for that text now, driven
 * entirely by what get_presence() returns (is_online is server-computed
 * from last_seen_at freshness, see 20260718080000_fix_live_presence.sql).
 */
function arCount(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one
  if (n === 2) return two
  if (n >= 3 && n <= 10) return `${n} ${few}`
  return `${n} ${many}`
}

export function formatPresence(isOnline: boolean, lastSeenAt: string | null | undefined, isAr: boolean): string {
  if (isOnline) return isAr ? 'متصل الآن' : 'Online now'
  if (!lastSeenAt) return isAr ? 'غير متصل' : 'Offline'

  const diffMs = Date.now() - new Date(lastSeenAt).getTime()
  if (diffMs < 0) return isAr ? 'غير متصل' : 'Offline'

  const min = Math.floor(diffMs / 60000)
  if (min < 1) return isAr ? 'غير متصل الآن' : 'Offline just now'
  if (min < 60) {
    return isAr
      ? `آخر ظهور ${arCount(min, 'قبل دقيقة', 'قبل دقيقتين', 'دقائق', 'دقيقة')}`
      : `Last seen ${min} minute${min === 1 ? '' : 's'} ago`
  }

  const hr = Math.floor(min / 60)
  if (hr < 24) {
    return isAr
      ? `آخر ظهور ${arCount(hr, 'قبل ساعة', 'قبل ساعتين', 'ساعات', 'ساعة')}`
      : `Last seen ${hr} hour${hr === 1 ? '' : 's'} ago`
  }

  const day = Math.floor(hr / 24)
  if (day === 1) return isAr ? 'آخر ظهور أمس' : 'Last seen yesterday'
  if (day < 7) {
    return isAr ? `آخر ظهور قبل ${day} أيام` : `Last seen ${day} days ago`
  }

  const week = Math.floor(day / 7)
  if (week < 5) return isAr ? `آخر ظهور ${arCount(week, 'قبل أسبوع', 'قبل أسبوعين', 'أسابيع', 'أسبوع')}` : `Last seen ${week} week${week === 1 ? '' : 's'} ago`

  return isAr ? 'آخر ظهور منذ وقت طويل' : 'Last seen a long time ago'
}

/** Small colored-dot + label helper for the online/offline indicator dot color, shared across the same three components. */
export function presenceDotColor(isOnline: boolean): string {
  return isOnline ? '#10b981' : '#4b5563'
}
