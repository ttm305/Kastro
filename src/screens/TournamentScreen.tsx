import { Fragment, useEffect, useState } from 'react'
import type { Screen, Lang } from '../App'
import TopBar from '../components/TopBar'
import Avatar from '../components/Avatar'
import { useAuth } from '../lib/auth'
import {
  getActiveTournament,
  getTournamentBracket,
  getMyTournamentRegistration,
  registerForTournament,
  supabase,
  type PublicProfile,
} from '../lib/api'

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  setLang: (l: Lang) => void
}

type TournamentTab = 'bracket' | 'prizes' | 'schedule'

type ActiveTournament = NonNullable<Awaited<ReturnType<typeof getActiveTournament>>>
type TournamentPrize = ActiveTournament['tournament_prizes'][number]
type BracketRound = Awaited<ReturnType<typeof getTournamentBracket>>[number]
type BracketMatch = BracketRound['tournament_matches'][number]
type Registration = Awaited<ReturnType<typeof getMyTournamentRegistration>>

const PRIZE_STYLES = [
  { icon: '🥇', color: '#ffd700' },
  { icon: '🥈', color: '#c0c0c0' },
  { icon: '🥉', color: '#cd7f32' },
  { icon: '🎖️', color: '#9d6fff' },
]

const ROUND_STATUS_COLOR: Record<string, string> = { done: '#9d6fff', live: '#ff6b35', upcoming: '#ffd700' }

function formatRoundDate(start: string | null, end: string | null, isAr: boolean) {
  if (!start) return isAr ? 'التاريخ لم يُحدد بعد' : 'Date TBD'
  const locale = isAr ? 'ar' : 'en-US'
  const opts: Intl.DateTimeFormatOptions = { month: 'long', day: 'numeric', year: 'numeric' }
  const startStr = new Date(start).toLocaleDateString(locale, opts)
  if (!end) return startStr
  const endStr = new Date(end).toLocaleDateString(locale, opts)
  return startStr === endStr ? startStr : `${startStr} – ${endStr}`
}

export default function TournamentScreen({ onNavigate, lang, setLang }: Props) {
  const [tab, setTab] = useState<TournamentTab>('bracket')
  const isAr = lang === 'ar'
  const { profile } = useAuth()

  const [tournament, setTournament] = useState<ActiveTournament | null>(null)
  const [rounds, setRounds] = useState<BracketRound[]>([])
  const [profilesMap, setProfilesMap] = useState<Map<string, PublicProfile>>(new Map())
  const [registration, setRegistration] = useState<Registration>(null)
  const [loading, setLoading] = useState(true)
  const [registering, setRegistering] = useState(false)
  const [toast, setToast] = useState<{ msg: string; color?: string } | null>(null)

  const flash = (msg: string, color?: string) => {
    setToast({ msg, color })
    setTimeout(() => setToast(null), 2000)
  }

  useEffect(() => {
    if (!profile) return
    let mounted = true
    ;(async () => {
      setLoading(true)
      const t = await getActiveTournament()
      if (!mounted) return
      setTournament(t)
      if (t) {
        const [r, myReg] = await Promise.all([
          getTournamentBracket(t.id),
          getMyTournamentRegistration(t.id, profile.id),
        ])
        if (!mounted) return
        setRounds(r)
        setRegistration(myReg)

        const ids = new Set<string>()
        r.forEach((round) => round.tournament_matches.forEach((m) => {
          if (m.participant1_id) ids.add(m.participant1_id)
          if (m.participant2_id) ids.add(m.participant2_id)
        }))
        if (ids.size) {
          const { data } = await supabase.rpc('get_public_profiles', { p_ids: Array.from(ids) })
          const profiles = data as PublicProfile[] | null
          if (mounted && profiles) setProfilesMap(new Map(profiles.map((p) => [p.id, p])))
        }
      }
      if (mounted) setLoading(false)
    })()
    return () => {
      mounted = false
    }
  }, [profile?.id])

  const handleRegister = async () => {
    if (!tournament || !profile) return
    setRegistering(true)
    const res = await registerForTournament(tournament.id)
    setRegistering(false)
    if (res.error) {
      flash(res.error, '#ff4785')
      return
    }
    const myReg = await getMyTournamentRegistration(tournament.id, profile.id)
    setRegistration(myReg)
    flash(isAr ? 'تم التسجيل بنجاح!' : 'Registered successfully!', '#00e676')
  }

  if (loading) {
    return (
      <div className="screen bg-game">
        <TopBar title="Tournament" titleAr="بطولة التصفيات" lang={lang} setLang={setLang} onBack={() => onNavigate('profile')} />
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(var(--fg2-rgb),0.4)', fontSize: 13 }}>
          {isAr ? 'جارٍ التحميل...' : 'Loading...'}
        </div>
      </div>
    )
  }

  if (!tournament) {
    return (
      <div className="screen bg-game">
        <TopBar title="Tournament" titleAr="بطولة التصفيات" lang={lang} setLang={setLang} onBack={() => onNavigate('profile')} />
        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'rgba(var(--fg2-rgb),0.4)', fontSize: 13 }}>
          {isAr ? 'لا توجد بطولة نشطة حالياً' : 'No active tournament right now'}
        </div>
      </div>
    )
  }

  const sortedRounds = [...rounds].sort((a, b) => a.round_order - b.round_order)
  const currentRound = sortedRounds.find((r) => r.status === 'live') ?? sortedRounds[sortedRounds.length - 1] ?? null
  const isLive = currentRound?.status === 'live'

  const competitorIds = new Set<string>()
  currentRound?.tournament_matches.forEach((m) => {
    if (m.participant1_id) competitorIds.add(m.participant1_id)
    if (m.participant2_id) competitorIds.add(m.participant2_id)
  })

  // Determine whether/where the current user was eliminated, if at all.
  let eliminationInfo: { roundName: string; roundNameAr: string; opponentName: string; margin: number } | null = null
  if (profile) {
    for (const round of sortedRounds) {
      const match = round.tournament_matches.find(
        (m) => (m.participant1_id === profile.id || m.participant2_id === profile.id) && m.completed_at && m.winner_id && m.winner_id !== profile.id
      )
      if (match) {
        const opponentId = match.participant1_id === profile.id ? match.participant2_id : match.participant1_id
        const opponent = opponentId ? profilesMap.get(opponentId) : null
        const margin = Math.abs((match.score1 ?? 0) - (match.score2 ?? 0))
        eliminationInfo = {
          roundName: round.name,
          roundNameAr: round.name_ar,
          opponentName: opponent?.username ? `@${opponent.username}` : (isAr ? 'خصم' : 'Opponent'),
          margin,
        }
        break
      }
    }
  }

  return (
    <div className="screen bg-game">
      <TopBar title="Tournament" titleAr="بطولة التصفيات" lang={lang} setLang={setLang} onBack={() => onNavigate('profile')} />

      <div className="pb-nav" style={{ padding: '14px 16px' }}>
        {/* Hero */}
        <div
          className="card"
          style={{
            padding: '20px', marginBottom: 14,
            background: 'linear-gradient(135deg, rgba(255,107,53,0.18) 0%, rgba(124,58,237,0.15) 50%, rgba(0,212,255,0.08) 100%)',
            border: '1px solid rgba(255,107,53,0.3)',
            textAlign: 'center', position: 'relative', overflow: 'hidden',
          }}
        >
          <div className="bg-stars" style={{ position: 'absolute', inset: 0, opacity: 0.5, pointerEvents: 'none' }} />
          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{ fontSize: 40, marginBottom: 8, animation: 'crown-float 2.5s ease-in-out infinite' }}>⚔️</div>
            <h2 className={isAr ? 'font-cairo' : 'font-display'} style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 900 }}>
              <span className="grad-text-fire">{isAr ? tournament.name_ar : tournament.name}</span>
            </h2>
            <p style={{ margin: '0 0 12px', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.5)' }}>
              {currentRound
                ? (isAr
                  ? `${currentRound.name_ar} جارٍ · ${competitorIds.size} متنافسون متبقون`
                  : `${currentRound.name} in progress · ${competitorIds.size} competitors remain`)
                : (isAr ? 'التسجيل مفتوح الآن' : 'Registration is open now')}
            </p>
            <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
              {isLive && <span className="badge badge-live"><span className="live-dot" style={{ width: 5, height: 5 }} />{isAr ? 'مباشر' : 'LIVE'}</span>}
              {currentRound && <span className="badge badge-hot">{(isAr ? currentRound.name_ar : currentRound.name).toUpperCase()}</span>}
            </div>
          </div>
        </div>

        {/* Registration */}
        {registration ? (
          <div className="card" style={{ padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
            <span style={{ fontSize: 18 }}>✅</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#00e676' }}>
              {isAr ? 'أنت مسجّل في هذه البطولة' : "You're registered for this tournament"}
            </span>
          </div>
        ) : (
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: 14, fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit', opacity: registering ? 0.6 : 1 }}
            onClick={handleRegister}
            disabled={registering}
          >
            {isAr ? '⚔️ سجّل في البطولة' : '⚔️ Register for Tournament'}
          </button>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 5, background: 'rgba(var(--fg-rgb),0.04)', borderRadius: 12, padding: 4, marginBottom: 16 }}>
          {[
            { key: 'bracket', en: '🏅 Bracket', ar: '🏅 الجدول' },
            { key: 'prizes', en: '🎁 Prizes', ar: '🎁 الجوائز' },
            { key: 'schedule', en: '📅 Schedule', ar: '📅 الجدول الزمني' },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key as TournamentTab)}
              style={{
                flex: 1, padding: '8px 4px', borderRadius: 9, border: 'none', cursor: 'pointer',
                fontSize: 11, fontWeight: 700, transition: 'all 0.2s ease',
                background: tab === t.key ? 'linear-gradient(135deg, #ff6b35, #e53e3e)' : 'transparent',
                color: tab === t.key ? 'white' : 'rgba(var(--fg2-rgb),0.38)',
                fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif",
              }}
            >
              {isAr ? t.ar : t.en}
            </button>
          ))}
        </div>

        {tab === 'bracket' && (
          <div>
            {/* Your elimination notice */}
            {eliminationInfo && (
              <div className="card glass-fire" style={{ padding: '12px 16px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 24 }}>😤</span>
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 800, color: '#ff6b35' }}>
                    {isAr ? `تم استبعادك في ${eliminationInfo.roundNameAr}` : `You were eliminated in ${eliminationInfo.roundName}`}
                  </p>
                  <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)' }}>
                    {isAr
                      ? `تفوق عليك ${eliminationInfo.opponentName} بـ ${eliminationInfo.margin} نقاط — العب أكثر لتكون جاهزاً للبطولة القادمة!`
                      : `${eliminationInfo.opponentName} beat you by ${eliminationInfo.margin} pts — play more for next tournament!`}
                  </p>
                </div>
              </div>
            )}

            {/* Bracket visual */}
            {sortedRounds.length === 0 ? (
              <div className="card" style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 34, marginBottom: 10, opacity: 0.5 }}>🏅</div>
                <p style={{ fontSize: 13, color: 'rgba(var(--fg2-rgb),0.45)' }}>
                  {isAr ? 'سيتم نشر الجدول عند إغلاق باب التسجيل' : 'The bracket will be posted once registration closes'}
                </p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto', paddingBottom: 8 }}>
                <div style={{ display: 'flex', gap: 12, minWidth: sortedRounds.length > 1 ? 640 : 280, padding: '4px 0' }}>
                  {sortedRounds.map((round, ri) => (
                    <Fragment key={round.id}>
                      <div style={{ flex: 1 }}>
                        <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 800, color: 'rgba(var(--fg2-rgb),0.35)', textTransform: 'uppercase', letterSpacing: '0.12em', textAlign: 'center' }}>
                          {isAr ? round.name_ar : round.name}
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                          {round.tournament_matches.map((match) => (
                            <MatchCard
                              key={match.id}
                              match={match}
                              profilesMap={profilesMap}
                              myId={profile?.id}
                              isAr={isAr}
                              isFinal={sortedRounds.length > 1 && ri === sortedRounds.length - 1}
                            />
                          ))}
                        </div>
                      </div>

                      {ri < sortedRounds.length - 1 && (
                        <div style={{ width: 20, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center' }}>
                          <div style={{ width: 16, height: 70, border: '1px solid rgba(124,58,237,0.3)', borderLeft: 'none', borderRadius: '0 8px 8px 0' }} />
                        </div>
                      )}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {tab === 'prizes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[...tournament.tournament_prizes]
              .sort((a: TournamentPrize, b: TournamentPrize) => a.sort_order - b.sort_order)
              .map((p: TournamentPrize, i: number) => {
                const style = PRIZE_STYLES[i % PRIZE_STYLES.length]
                return (
                  <div
                    key={p.rank_label}
                    className="card"
                    style={{
                      padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 16,
                      background: `${style.color}08`,
                      border: `1px solid ${style.color}25`,
                    }}
                  >
                    <div style={{ fontSize: 34, flexShrink: 0 }}>{style.icon}</div>
                    <div style={{ flex: 1 }}>
                      <p style={{ margin: '0 0 3px', fontSize: 14, fontWeight: 800, color: style.color }}>
                        {isAr ? p.rank_label_ar : p.rank_label}
                      </p>
                      <p style={{ margin: 0, fontSize: 12, color: 'rgba(var(--fg2-rgb),0.5)' }}>
                        {isAr ? p.prize_ar : p.prize}
                      </p>
                    </div>
                  </div>
                )
              })}

            <div className="card glass-violet" style={{ padding: '14px 16px', textAlign: 'center' }}>
              <p style={{ margin: '0 0 4px', fontSize: 13, fontWeight: 700, color: '#9d6fff' }}>
                {isAr ? '⚡ كيف تؤهل نفسك للبطولة القادمة؟' : '⚡ How to qualify for the next tournament?'}
              </p>
              <p style={{ margin: 0, fontSize: 12, color: 'rgba(var(--fg2-rgb),0.5)' }}>
                {isAr ? tournament.qualification_rule_ar : tournament.qualification_rule}
              </p>
            </div>
          </div>
        )}

        {tab === 'schedule' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {sortedRounds.length === 0 ? (
              <div className="card" style={{ padding: '40px 20px', textAlign: 'center' }}>
                <div style={{ fontSize: 34, marginBottom: 10, opacity: 0.5 }}>📅</div>
                <p style={{ fontSize: 13, color: 'rgba(var(--fg2-rgb),0.45)' }}>
                  {isAr ? 'سيتم الإعلان عن الجدول الزمني قريباً' : 'Schedule will be announced soon'}
                </p>
              </div>
            ) : (
              sortedRounds.map((s) => (
                <div key={s.id} className="card" style={{ padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: s.status === 'live' ? '#00e676' : s.status === 'done' ? '#9d6fff' : 'rgba(var(--fg-rgb),0.3)', flexShrink: 0, ...(s.status === 'live' ? { animation: 'live-pulse 1.4s ease-in-out infinite' } : {}) }} />
                  <div style={{ flex: 1 }}>
                    <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 800, color: ROUND_STATUS_COLOR[s.status] ?? '#ffd700' }}>{isAr ? s.name_ar : s.name}</p>
                    <p style={{ margin: 0, fontSize: 12, color: 'rgba(var(--fg2-rgb),0.4)' }}>{formatRoundDate(s.starts_at, s.ends_at, isAr)}</p>
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: s.status === 'live' ? '#00e676' : s.status === 'done' ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.3)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                    {s.status === 'live' ? (isAr ? 'مباشر' : 'LIVE') : s.status === 'done' ? (isAr ? 'انتهى' : 'DONE') : (isAr ? 'قادم' : 'SOON')}
                  </span>
                </div>
              ))
            )}
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

function MatchCard({
  match, isAr, profilesMap, myId, isFinal,
}: {
  match: BracketMatch
  isAr: boolean
  profilesMap: Map<string, PublicProfile>
  myId?: string
  isFinal?: boolean
}) {
  const slots: { id: string | null; score: number | null }[] = [
    { id: match.participant1_id, score: match.score1 },
    { id: match.participant2_id, score: match.score2 },
  ]

  const players = slots.map((slot, i) => {
    const isWinner = !!match.completed_at && !!match.winner_id && match.winner_id === slot.id
    const isMe = !!slot.id && slot.id === myId
    const upcoming = !match.completed_at
    const p = slot.id ? profilesMap.get(slot.id) : undefined
    return {
      key: slot.id ?? `tbd-${i}`,
      name: slot.id ? (p?.username ? `@${p.username}` : (isAr ? 'لاعب' : 'Player')) : (isAr ? '؟' : 'TBD'),
      hasParticipant: !!slot.id,
      avatarUrl: p?.avatar_url ?? null,
      score: slot.score ?? 0,
      winner: isWinner,
      isMe,
      upcoming,
    }
  })

  return (
    <div className="bracket-match" style={{ border: isFinal ? '1px solid rgba(255,215,0,0.3)' : undefined }}>
      {players.map((p) => (
        <div
          key={p.key}
          className={`bracket-player ${p.winner ? 'winner' : ''}`}
          style={{
            opacity: p.upcoming ? 0.5 : 1,
            background: p.isMe ? 'rgba(255,107,53,0.1)' : undefined,
            borderLeft: p.isMe ? '2px solid #ff6b35' : p.winner ? '2px solid #9d6fff' : '2px solid transparent',
          }}
        >
          {p.hasParticipant ? <Avatar url={p.avatarUrl} size={14} /> : <span style={{ fontSize: 14 }}>❓</span>}
          <span style={{ flex: 1, fontSize: 11, fontWeight: 700, color: p.winner ? 'var(--foreground)' : p.upcoming ? 'rgba(var(--fg2-rgb),0.4)' : 'rgba(var(--fg2-rgb),0.6)' }}>
            {p.name}
          </span>
          {!p.upcoming && (
            <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 12, fontWeight: 900, color: p.winner ? '#9d6fff' : 'rgba(var(--fg2-rgb),0.4)' }}>
              {p.score}
            </span>
          )}
        </div>
      ))}
    </div>
  )
}
