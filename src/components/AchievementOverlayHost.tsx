import { useEffect, useState, useRef } from 'react'
import type { Lang } from '../App'
import { useAuth } from '../lib/auth'
import { subscribeToNewNotifications, markNotificationRead, type Notification } from '../lib/api'
import LevelUpOverlay from './LevelUpOverlay'
import BadgeUnlockOverlay from './BadgeUnlockOverlay'

/**
 * Mounted once at the app shell so level-up / badge-unlock celebrations pop
 * the instant they happen server-side (via private.notify in the relevant
 * RPCs), no matter which screen the player is currently on — rather than
 * being wired to a single screen's local state, which is what silently
 * never fired before (HomeScreen's old `showLevelUp` was never set true).
 * A small in-memory queue means two events landing back-to-back (e.g. an
 * achievement's xp_reward pushing a level up in the same request) show one
 * at a time instead of stomping each other.
 */
export default function AchievementOverlayHost({ lang }: { lang: Lang }) {
  const { profile } = useAuth()
  const [queue, setQueue] = useState<Notification[]>([])
  const activeRef = useRef(false)

  useEffect(() => {
    if (!profile) return
    // Unique tag ('achievements') — see subscribeToNewNotifications' doc
    // comment: every independent call site needs its own realtime channel
    // topic, or a second subscriber calling .on() on the same topic throws
    // and can crash the app.
    const unsub = subscribeToNewNotifications(profile.id, (n) => {
      if (n.type === 'level_up' || n.type === 'badge_unlocked') {
        setQueue((q) => [...q, n])
      }
    }, 'achievements')
    return () => { unsub() }
  }, [profile?.id])

  const current = queue[0]
  activeRef.current = !!current

  function dismiss() {
    if (current) markNotificationRead(current.id).catch(() => {})
    setQueue((q) => q.slice(1))
  }

  if (!current) return null

  if (current.type === 'level_up') {
    const level = (current.data as any)?.level ?? profile?.level ?? 1
    return <LevelUpOverlay level={level} lang={lang} onDismiss={dismiss} />
  }

  const data = (current.data as any) ?? {}
  return (
    <BadgeUnlockOverlay
      name={current.body ?? current.title}
      nameAr={current.body_ar ?? current.title_ar}
      rarity={data.rarity ?? 'Common'}
      color={data.color ?? '#9d6fff'}
      category={data.category ?? 'general'}
      lang={lang}
      onDismiss={dismiss}
    />
  )
}
