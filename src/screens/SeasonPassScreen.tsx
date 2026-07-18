import { useEffect, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Screen, Lang } from '../App'
import TopBar from '../components/TopBar'
import { useAuth } from '../lib/auth'
import type { Tables } from '../lib/database.types'
import { getActiveSeason, getSeasonTrack, claimSeasonReward, getPreviousSeasons } from '../lib/api'

type Season = Tables<'seasons'>

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  setLang: (l: Lang) => void
}

type ActiveSeason = NonNullable<Awaited<ReturnType<typeof getActiveSeason>>>
type SeasonTrackData = Awaited<ReturnType<typeof getSeasonTrack>>
type SeasonNode = SeasonTrackData['nodes'][number]
type SeasonProgress = SeasonTrackData['progress']

const TYPE_COLORS: Record<string, string> = {
  xp: '#9d6fff',
  cosmetic: '#00d4ff',
  badge: '#ffd700',
  frame: '#ff6b35',
  reward: '#00e676',
}

function PreviousSeasonsList({ seasons, isAr }: { seasons: Season[]; isAr: boolean }) {
  if (seasons.length === 0) return null
  return (
    <div className="glass-card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '14px 16px', borderBottom: '1px solid rgba(var(--fg-rgb),0.06)' }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: 'rgba(var(--fg-rgb),0.6)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {isAr ? 'المواسم السابقة' : 'Previous Seasons'}
        </h3>
      </div>
      {seasons.map((s, i) => (
        <div key={s.id} style={{ padding: '12px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: i < seasons.length - 1 ? '1px solid rgba(var(--fg-rgb),0.05)' : 'none' }}>
          <div>
            <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: 'var(--foreground)' }}>{isAr ? s.name_ar : s.name}</p>
            <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)' }}>
              {new Date(s.starts_at).toLocaleDateString()} – {new Date(s.ended_at ?? s.ends_at).toLocaleDateString()}
            </p>
          </div>
          <span style={{ fontSize: 11, fontWeight: 700, color: 'rgba(var(--fg2-rgb),0.35)', textTransform: 'uppercase' }}>
            {isAr ? 'منتهي' : 'Ended'}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function SeasonPassScreen({ onNavigate, lang, setLang }: Props) {
  const isAr = lang === 'ar'
  const { profile } = useAuth()

  const [season, setSeason] = useState<ActiveSeason | null>(null)
  const [nodes, setNodes] = useState<SeasonNode[]>([])
  const [progress, setProgress] = useState<SeasonProgress>({ current_level: 1, season_xp: 0 })
  const [loading, setLoading] = useState(true)
  const [claimingId, setClaimingId] = useState<string | null>(null)
  const [toast, setToast] = useState<{ msg: string; color?: string } | null>(null)
  const [previousSeasons, setPreviousSeasons] = useState<Season[]>([])

  useEffect(() => { getPreviousSeasons().then(setPreviousSeasons) }, [])

  const flash = (msg: string, color?: string) => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 2000)
  }

  const loadTrack = async (seasonId: string, userId: string) => {
    const track = await getSeasonTrack(seasonId, userId)
    setNodes(track.nodes)
    setProgress(track.progress)
  }

  useEffect(() => {
    if (!profile) return
    let mounted = true
    ;(async () => {
      setLoading(true)
      const s = await getActiveSeason()
      if (!mounted) return
      setSeason(s)
      if (s) await loadTrack(s.id, profile.id)
      if (mounted) setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [profile?.id])

  const handleClaim = async (nodeId: string) => {
    if (!season || !profile) return
    setClaimingId(nodeId)
    const res = await claimSeasonReward(nodeId)
    setClaimingId(null)
    if (res.error) {
      flash(res.error, '#ff4785')
      return
    }
    await loadTrack(season.id, profile.id)
    flash(isAr ? 'تم استلام المكافأة!' : 'Reward claimed!', '#00e676')
  }

  if (loading) {
    return (
      <div className="screen bg-game">
        <TopBar title="Season Pass" titleAr="بطاقة الموسم" lang={lang} setLang={setLang} onBack={() => onNavigate('profile')} />
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(var(--fg2-rgb),0.4)', fontSize: 13 }}>
          {isAr ? 'جارٍ التحميل...' : 'Loading...'}
        </div>
      </div>
    )
  }

  if (!season) {
    return (
      <div className="screen bg-game">
        <TopBar title="Season Pass" titleAr="بطاقة الموسم" lang={lang} setLang={setLang} onBack={() => onNavigate('profile')} />
        <div className="pb-nav" style={{ padding: '16px 16px' }}>
          <div className="glass-card" style={{ padding: '40px 20px', textAlign: 'center', marginBottom: 16 }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🌟</div>
            <p style={{ margin: 0, fontSize: 13, color: 'rgba(var(--fg2-rgb),0.5)' }}>
              {isAr ? 'لا يوجد موسم نشط حالياً' : 'No active season right now'}
            </p>
          </div>
          <PreviousSeasonsList seasons={previousSeasons} isAr={isAr} />
        </div>
      </div>
    )
  }

  const daysLeft = Math.max(0, Math.ceil((new Date(season.ends_at).getTime() - Date.now()) / 86400000))
  const totalNodes = nodes.length
  const claimedCount = nodes.filter((n) => n.claimed).length
  const percentComplete = totalNodes ? Math.round((claimedCount / totalNodes) * 100) : 0
  const rewardsAhead = totalNodes - claimedCount

  return (
    <div className="screen bg-game">
      <TopBar title="Season Pass" titleAr="بطاقة الموسم" lang={lang} setLang={setLang} onBack={() => onNavigate('profile')} />

      <div className="pb-nav" style={{ padding: '14px 16px' }}>
        {/* Season Hero */}
        <div
          className="card"
          style={{
            padding: '24px 20px', marginBottom: 16,
            background: 'linear-gradient(135deg, rgba(255,215,0,0.15) 0%, rgba(255,107,53,0.08) 50%, rgba(124,58,237,0.12) 100%)',
            border: '1px solid rgba(255,215,0,0.25)',
            position: 'relative', overflow: 'hidden',
          }}
        >
          <div className="bg-stars" style={{ position: 'absolute', inset: 0, opacity: 0.6, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
              <span className="badge badge-live">
                <span className="live-dot" style={{ width: 5, height: 5 }} />
                {isAr ? 'نشط' : 'ACTIVE'}
              </span>
              <span style={{ fontSize: 12, color: 'rgba(var(--fg2-rgb),0.4)' }}>
                {isAr ? `${daysLeft} يوماً متبقياً` : `${daysLeft} days remaining`}
              </span>
            </div>
            <h2 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: '0 0 4px', fontSize: 24, fontWeight: 900 }}>
              <span className="grad-text-fire">
                {isAr ? season.name_ar : season.name}
              </span>
            </h2>
            <p style={{ margin: '0 0 16px', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.5)' }}>
              {isAr ? 'اكسب XP من الألعاب لفتح المكافآت الحصرية' : 'Earn XP through games to unlock exclusive rewards'}
            </p>

            <div style={{ display: 'flex', gap: 20, marginBottom: 14 }}>
              {[
                { val: `${progress.current_level}/${totalNodes}`, label: isAr ? 'مستوى الموسم' : 'Season Level', color: '#ffd700' },
                { val: `${percentComplete}%`, label: isAr ? 'مكتمل' : 'Complete', color: '#9d6fff' },
                { val: `${rewardsAhead}`, label: isAr ? 'مكافآت بانتظارك' : 'Rewards Ahead', color: '#00d4ff' },
              ].map((s) => (
                <div key={s.label}>
                  <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 22, fontWeight: 900, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 10, color: 'rgba(var(--fg2-rgb),0.4)' }}>{s.label}</div>
                </div>
              ))}
            </div>

            <div className="xp-track" style={{ height: 10 }}>
              <div className="xp-fill xp-fill-gold" style={{ ['--xp-pct' as string]: percentComplete / 100 } as CSSProperties} />
            </div>
          </div>
        </div>

        {/* Reward track */}
        <h3 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: '0 0 14px', fontSize: 15, fontWeight: 800, color: 'rgba(var(--fg2-rgb),0.5)', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          {isAr ? '— مسار المكافآت —' : '— Reward Track —'}
        </h3>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {nodes.map((node, i) => (
            <div
              key={node.id}
              className="card"
              style={{
                padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14,
                background: node.current
                  ? 'linear-gradient(135deg, rgba(255,215,0,0.12), rgba(255,107,53,0.06))'
                  : node.claimed
                  ? 'rgba(124,58,237,0.08)'
                  : 'rgba(var(--fg-rgb),0.03)',
                border: node.current
                  ? '1px solid rgba(255,215,0,0.35)'
                  : node.is_final
                  ? '1px solid rgba(255,107,53,0.3)'
                  : node.claimed
                  ? '1px solid rgba(124,58,237,0.2)'
                  : '1px solid rgba(var(--fg-rgb),0.05)',
                boxShadow: node.current ? '0 0 24px rgba(255,215,0,0.12)' : 'none',
                opacity: !node.claimed && !node.current ? 0.65 : 1,
              }}
            >
              {/* Connector line */}
              {i > 0 && (
                <div style={{ position: 'absolute', left: 31, top: -8, width: 2, height: 8, background: nodes[i-1].claimed ? 'rgba(124,58,237,0.4)' : 'rgba(var(--fg-rgb),0.1)' }} />
              )}

              {/* Level indicator */}
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: node.claimed
                  ? 'linear-gradient(135deg, #7c3aed, #5b21b6)'
                  : node.current
                  ? 'linear-gradient(135deg, #ffd700, #f59e0b)'
                  : 'rgba(var(--fg-rgb),0.06)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: "'Exo 2', sans-serif", fontSize: 13, fontWeight: 900,
                color: node.claimed ? 'white' : node.current ? '#03030f' : 'rgba(var(--fg2-rgb),0.4)',
                boxShadow: node.current ? '0 0 16px rgba(255,215,0,0.4)' : node.claimed ? '0 0 10px rgba(124,58,237,0.3)' : 'none',
                ...(node.current ? { animation: 'badge-live-pulse 2s ease-in-out infinite' } : {}),
              }}>
                {node.claimed ? '✓' : node.level}
              </div>

              {/* Reward icon */}
              <div style={{
                width: 44, height: 44, borderRadius: 14, flexShrink: 0,
                background: `${TYPE_COLORS[node.reward_type]}15`,
                border: `1px solid ${TYPE_COLORS[node.reward_type]}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 22,
                filter: !node.claimed && !node.current ? 'grayscale(0.7)' : 'none',
              }}>
                {node.icon}
              </div>

              <div style={{ flex: 1 }}>
                <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 800, color: node.current ? '#ffd700' : node.claimed ? 'var(--foreground)' : 'rgba(var(--fg2-rgb),0.5)' }}>
                  {isAr ? node.reward_label_ar : node.reward_label}
                </p>
                <p style={{ margin: 0, fontSize: 11, color: TYPE_COLORS[node.reward_type], fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  {node.reward_type}{node.current ? (isAr ? ' · يمكن طلبه الآن!' : ' · Claimable now!') : ''}{node.is_final ? ' ⭐' : ''}
                </p>
              </div>

              {node.current ? (
                <button
                  className="btn btn-gold btn-sm"
                  style={{ flexShrink: 0, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit', opacity: claimingId === node.id ? 0.6 : 1 }}
                  disabled={claimingId === node.id}
                  onClick={() => handleClaim(node.id)}
                >
                  {isAr ? 'احصل' : 'Claim'}
                </button>
              ) : node.claimed ? (
                <div style={{ fontSize: 12, fontWeight: 700, color: '#9d6fff' }}>✓</div>
              ) : (
                <div style={{ fontSize: 16, opacity: 0.3 }}>🔒</div>
              )}
            </div>
          ))}
        </div>

        {previousSeasons.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <PreviousSeasonsList seasons={previousSeasons} isAr={isAr} />
          </div>
        )}
      </div>

      {toast && (
        <div style={{
          position: 'fixed', bottom: 88, left: '50%', transform: 'translateX(-50%)',
          background: toast.color ?? '#00e676', color: (toast.color ?? '#00e676') === '#00e676' ? '#03030f' : '#fff',
          padding: '9px 20px', borderRadius: 10, fontSize: 12, fontWeight: 700, zIndex: 9200,
          boxShadow: '0 4px 20px rgba(0,0,0,0.4)',
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  )
}
