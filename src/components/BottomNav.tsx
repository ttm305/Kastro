import { useEffect, useRef } from 'react'
import type { Screen, Lang } from '../App'

interface Props {
  current: Screen
  onNavigate: (s: Screen) => void
  lang: Lang
  /** Unread-conversation count, shown as a badge on the Friends tab. */
  unreadChatCount?: number
}

const ITEMS = [
  {
    screen: 'home' as Screen,
    iconActive: '🏠',
    icon: '🏠',
    en: 'Home',
    ar: 'الرئيسية',
  },
  {
    screen: 'games' as Screen,
    iconActive: '⚔️',
    icon: '⚔️',
    en: 'Worlds',
    ar: 'الألعاب',
  },
  {
    screen: 'friends' as Screen,
    iconActive: '👥',
    icon: '👥',
    en: 'Friends',
    ar: 'الأصدقاء',
    highlight: true,
  },
  {
    screen: 'leaderboard' as Screen,
    iconActive: '🏆',
    icon: '🏆',
    en: 'Ranks',
    ar: 'ترتيب',
  },
  {
    screen: 'profile' as Screen,
    iconActive: '👤',
    icon: '👤',
    en: 'Hero',
    ar: 'حسابي',
  },
]

export default function BottomNav({ current, onNavigate, lang, unreadChatCount = 0 }: Props) {
  const isAr = lang === 'ar'
  const navRef = useRef<HTMLElement | null>(null)

  // Every screen's bottom padding (see .pb-nav in index.css) is computed
  // from --bottom-nav-height, kept in sync with this nav's REAL rendered
  // height rather than a guessed constant — so it self-corrects for label
  // wrapping, Dynamic Type / larger system font sizes, orientation
  // changes, or a future redesign of this nav, instead of drifting stale
  // like the hardcoded per-screen pixel math this replaces did.
  useEffect(() => {
    const el = navRef.current
    if (!el) return
    const apply = () => {
      document.documentElement.style.setProperty('--bottom-nav-height', `${el.offsetHeight}px`)
    }
    apply()
    const ro = new ResizeObserver(apply)
    ro.observe(el)
    return () => ro.disconnect()
  }, [lang])

  return (
    <nav className="bottom-nav" ref={navRef}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        {ITEMS.map((item) => {
          const isActive = current === item.screen
          return (
            <button
              key={item.screen}
              className={`nav-item ${isActive ? 'active' : ''}`}
              onClick={() => onNavigate(item.screen)}
              style={{
                position: 'relative',
                ...(item.highlight ? {
                  background: isActive ? 'rgba(124,58,237,0.15)' : 'transparent',
                } : {}),
              }}
            >
              {isActive && <div className="nav-pip" />}

              {/* Center highlight button (Friends) */}
              {item.highlight ? (
                <div style={{ position: 'relative' }}>
                  <div style={{
                    width: 42, height: 42, borderRadius: '50%',
                    background: isActive
                      ? 'linear-gradient(135deg, #7c3aed, #5b21b6)'
                      : 'linear-gradient(135deg, rgba(124,58,237,0.4), rgba(91,33,182,0.3))',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20,
                    boxShadow: isActive ? '0 0 20px rgba(124,58,237,0.5)' : '0 0 12px rgba(124,58,237,0.2)',
                    transition: 'all 0.2s ease',
                    border: '1px solid rgba(124,58,237,0.4)',
                    marginBottom: 2,
                  }}>
                    {item.iconActive}
                  </div>
                  {unreadChatCount > 0 && (
                    <span style={{
                      position: 'absolute', top: -2, right: -2,
                      minWidth: 16, height: 16, borderRadius: 8,
                      background: '#ff4785', color: '#fff',
                      fontSize: 10, fontWeight: 700,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      padding: '0 4px', border: '1.5px solid var(--background, #0b0b12)',
                    }}>
                      {unreadChatCount > 9 ? '9+' : unreadChatCount}
                    </span>
                  )}
                </div>
              ) : (
                <span className="nav-icon">{item.iconActive}</span>
              )}

              <span
                className="nav-label"
                style={{ fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif" }}
              >
                {isAr ? item.ar : item.en}
              </span>
            </button>
          )
        })}
      </div>
    </nav>
  )
}
