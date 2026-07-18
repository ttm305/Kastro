import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Screen, Lang } from '../App'
import TopBar from '../components/TopBar'
import { useAuth } from '../lib/auth'
import { getAchievementsWithStatus } from '../lib/api'

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  setLang: (l: Lang) => void
}

type AchievementWithStatus = Awaited<ReturnType<typeof getAchievementsWithStatus>>[number]

const rarityLabels = {
  common: { en: 'Common', ar: 'عادي', color: '#9ca3af' },
  uncommon: { en: 'Uncommon', ar: 'غير شائع', color: '#34d399' },
  rare: { en: 'Rare', ar: 'نادر', color: '#60a5fa' },
  epic: { en: 'Epic', ar: 'ملحمي', color: '#a78bfa' },
  legendary: { en: 'Legendary', ar: 'أسطوري', color: '#fbbf24' },
}

const categoryLabels: Record<string, { en: string; ar: string }> = {
  gameplay: { en: 'Gameplay', ar: 'اللعب' },
  progression: { en: 'Progression', ar: 'التقدم' },
  consistency: { en: 'Consistency', ar: 'المواظبة' },
  social: { en: 'Social', ar: 'اجتماعي' },
  general: { en: 'General', ar: 'عام' },
  board_games: { en: 'Board Games', ar: 'ألعاب الطاولة' },
}

export default function AchievementsScreen({ onNavigate, lang, setLang }: Props) {
  const { profile } = useAuth()
  const [filter, setFilter] = useState<'all' | 'unlocked' | 'locked'>('all')
  const [category, setCategory] = useState<string>('all')
  const [achievements, setAchievements] = useState<AchievementWithStatus[] | null>(null)

  useEffect(() => {
    if (!profile) return
    let active = true
    getAchievementsWithStatus(profile.id).then((data) => {
      if (active) setAchievements(data)
    })
    return () => {
      active = false
    }
  }, [profile?.id])

  if (!achievements) {
    return (
      <div className="screen bg-mesh">
        <TopBar title="Achievements" titleAr="الإنجازات" lang={lang} setLang={setLang} onBack={() => onNavigate('profile')} />
      </div>
    )
  }

  const categories = ['all', ...Array.from(new Set(achievements.map((a) => a.category)))]

  const filtered = achievements
    .filter((a) => (filter === 'all' ? true : filter === 'unlocked' ? a.unlocked : !a.unlocked))
    .filter((a) => (category === 'all' ? true : a.category === category))

  const unlockedCount = achievements.filter((a) => a.unlocked).length

  return (
    <div className="screen bg-mesh">
      <TopBar title="Achievements" titleAr="الإنجازات" lang={lang} setLang={setLang} onBack={() => onNavigate('profile')} />

      <div className="pb-nav" style={{ padding: '16px 16px', paddingBottom: 'calc(80px + 24px)' }}>
        {/* Summary */}
        <div
          className="glass-card"
          style={{
            padding: '20px',
            background: 'linear-gradient(135deg, rgba(124,58,237,0.15) 0%, rgba(6,182,212,0.08) 100%)',
            border: '1px solid rgba(124,58,237,0.2)',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 20,
          }}
        >
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: "'Rajdhani', sans-serif", fontSize: 36, fontWeight: 800, color: '#fbbf24' }}>{unlockedCount}</div>
            <div style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)' }}>{lang === 'ar' ? 'مفتوح' : 'Unlocked'}</div>
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 13, color: 'rgba(var(--fg-rgb),0.6)' }}>{lang === 'ar' ? 'التقدم الإجمالي' : 'Overall Progress'}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#a78bfa' }}>{unlockedCount}/{achievements.length}</span>
            </div>
            <div className="xp-bar" style={{ height: 10 }}>
              <div className="xp-bar-fill" style={{ ['--xp-pct' as string]: achievements.length ? unlockedCount / achievements.length : 0 } as CSSProperties} />
            </div>
            <div style={{ fontSize: 11, color: 'rgba(var(--fg-rgb),0.35)', marginTop: 6 }}>
              {lang === 'ar' ? `${achievements.reduce((s, a) => s + (a.unlocked ? a.xp_reward : 0), 0).toLocaleString()} XP مكتسب` : `${achievements.reduce((s, a) => s + (a.unlocked ? a.xp_reward : 0), 0).toLocaleString()} XP earned`}
            </div>
          </div>
        </div>

        {/* Filter */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['all', 'unlocked', 'locked'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '8px 16px', borderRadius: 99, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 600, transition: 'all 0.2s ease',
                background: filter === f ? 'linear-gradient(135deg, #7c3aed, #4f46e5)' : 'rgba(var(--fg-rgb),0.06)',
                color: filter === f ? 'white' : 'rgba(var(--fg-rgb),0.45)',
                fontFamily: lang === 'ar' ? "'Cairo', sans-serif" : 'inherit',
              }}
            >
              {f === 'all' ? (lang === 'ar' ? 'الكل' : 'All') : f === 'unlocked' ? (lang === 'ar' ? 'مفتوح' : 'Unlocked') : (lang === 'ar' ? 'مقفل' : 'Locked')}
            </button>
          ))}
        </div>

        {/* Category filter */}
        {categories.length > 2 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 16, overflowX: 'auto', paddingBottom: 2 }}>
            {categories.map((c) => {
              const label = c === 'all' ? { en: 'All Categories', ar: 'كل الفئات' } : (categoryLabels[c] ?? { en: c, ar: c })
              return (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  style={{
                    padding: '6px 13px', borderRadius: 99, border: `1px solid ${category === c ? 'rgba(157,111,255,0.4)' : 'rgba(var(--fg-rgb),0.08)'}`, cursor: 'pointer',
                    fontSize: 11.5, fontWeight: 600, whiteSpace: 'nowrap', flexShrink: 0,
                    background: category === c ? 'rgba(157,111,255,0.15)' : 'rgba(var(--fg-rgb),0.04)',
                    color: category === c ? '#c4b5fd' : 'rgba(var(--fg-rgb),0.45)',
                    fontFamily: lang === 'ar' ? "'Cairo', sans-serif" : 'inherit',
                  }}
                >
                  {lang === 'ar' ? label.ar : label.en}
                </button>
              )
            })}
          </div>
        )}

        {/* Achievements grid */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {filtered.map((a) => {
            const rarity = rarityLabels[a.rarity as keyof typeof rarityLabels]
            return (
              <div
                key={a.id}
                className="glass-card"
                style={{
                  padding: '16px 14px',
                  opacity: a.unlocked ? 1 : 0.5,
                  position: 'relative',
                  overflow: 'hidden',
                  filter: a.unlocked ? 'none' : 'grayscale(0.5)',
                }}
              >
                {a.unlocked && (
                  <div style={{ position: 'absolute', top: 0, right: 0, left: 0, height: 2, background: a.color }} />
                )}
                <div style={{ width: 52, height: 52, borderRadius: 16, background: a.unlocked ? a.color : 'rgba(var(--fg-rgb),0.06)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, marginBottom: 10, boxShadow: a.unlocked ? '0 4px 16px rgba(0,0,0,0.3)' : 'none' }}>
                  {a.unlocked ? a.icon : '🔒'}
                </div>
                <div style={{ fontSize: 11, color: rarity.color, fontWeight: 700, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {lang === 'ar' ? rarity.ar : rarity.en}
                </div>
                <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>
                  {lang === 'ar' ? a.name_ar : a.name}
                </p>
                <p style={{ margin: '0 0 8px', fontSize: 11, color: 'rgba(var(--fg-rgb),0.4)', lineHeight: 1.4 }}>
                  {lang === 'ar' ? a.description_ar : a.description}
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                  {a.xp_reward > 0 && <span style={{ fontSize: 12, color: '#a78bfa', fontWeight: 600 }}>+{a.xp_reward} XP</span>}
                  {a.coin_reward > 0 && <span style={{ fontSize: 12, color: '#f9ca24', fontWeight: 600 }}>+{a.coin_reward} 🪙</span>}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
