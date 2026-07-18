import { useState, useEffect } from 'react'
import type { Screen, Lang } from '../App'
import TopBar from '../components/TopBar'
import { getGames, type Game } from '../lib/api'

interface Props {
  onNavigate: (s: Screen) => void
  onNavigateToGame: (s: Screen, gameId?: string) => void
  lang: Lang
  setLang: (l: Lang) => void
}

/* ─── SVG Game Artwork ─── */
const SafetyArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <radialGradient id="sg" cx="50%" cy="50%"><stop offset="0%" stopColor="#ef444450"/><stop offset="100%" stopColor="#7c000010"/></radialGradient>
    </defs>
    <rect width="200" height="120" fill="url(#sg)"/>
    <polygon points="100,15 115,45 145,45 122,63 131,93 100,75 69,93 78,63 55,45 85,45" fill="none" stroke="#ef4444" strokeWidth="2" opacity="0.6"/>
    <polygon points="100,28 110,48 132,48 116,62 122,84 100,72 78,84 84,62 68,48 90,48" fill="#ef444430"/>
    <text x="100" y="100" textAnchor="middle" fill="#ef4444" fontSize="10" fontFamily="monospace" opacity="0.7">HSE ZONE</text>
    <circle cx="30" cy="20" r="2" fill="#ef4444" opacity="0.5"/>
    <circle cx="170" cy="100" r="3" fill="#ff6b35" opacity="0.4"/>
    <circle cx="160" cy="25" r="1.5" fill="#ef4444" opacity="0.6"/>
    <line x1="0" y1="110" x2="200" y2="110" stroke="#ef4444" strokeWidth="0.5" opacity="0.3" strokeDasharray="8,4"/>
    <line x1="0" y1="10" x2="200" y2="10" stroke="#ef4444" strokeWidth="0.5" opacity="0.3" strokeDasharray="8,4"/>
  </svg>
)

const ProcedureArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <linearGradient id="pg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#00d4ff20"/><stop offset="100%" stopColor="#003d6640"/></linearGradient>
    </defs>
    <rect width="200" height="120" fill="url(#pg)"/>
    <rect x="20" y="20" width="60" height="35" rx="5" fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0.5"/>
    <text x="50" y="32" textAnchor="middle" fill="#00d4ff" fontSize="8" opacity="0.8">SOP-001</text>
    <line x1="50" y1="37" x2="50" y2="42" stroke="#00d4ff" strokeWidth="1" opacity="0.5"/>
    <rect x="25" y="37" width="50" height="3" rx="1.5" fill="#00d4ff" opacity="0.3"/>
    <rect x="25" y="43" width="40" height="3" rx="1.5" fill="#00d4ff" opacity="0.2"/>
    <rect x="25" y="49" width="45" height="3" rx="1.5" fill="#00d4ff" opacity="0.15"/>
    <line x1="80" y1="37" x2="100" y2="37" stroke="#00d4ff" strokeWidth="1.5" opacity="0.6" strokeDasharray="4,3"/>
    <polygon points="100,33 108,37 100,41" fill="#00d4ff" opacity="0.6"/>
    <rect x="108" y="20" width="60" height="35" rx="5" fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0.5"/>
    <circle cx="138" cy="37" r="12" fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0.4"/>
    <text x="138" y="41" textAnchor="middle" fill="#00d4ff" fontSize="14" opacity="0.8">✓</text>
    <text x="100" y="85" textAnchor="middle" fill="#00d4ff" fontSize="8" fontFamily="monospace" opacity="0.6">COMMAND CENTER</text>
    <circle cx="20" cy="95" r="2" fill="#00d4ff" opacity="0.3"/>
    <circle cx="180" cy="95" r="2" fill="#00d4ff" opacity="0.3"/>
  </svg>
)

const TargetArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <radialGradient id="tg" cx="50%" cy="50%"><stop offset="0%" stopColor="#00e67620"/><stop offset="100%" stopColor="#00330020"/></radialGradient>
    </defs>
    <rect width="200" height="120" fill="url(#tg)"/>
    <circle cx="100" cy="58" r="40" fill="none" stroke="#00e676" strokeWidth="1" opacity="0.25"/>
    <circle cx="100" cy="58" r="28" fill="none" stroke="#00e676" strokeWidth="1" opacity="0.35"/>
    <circle cx="100" cy="58" r="16" fill="none" stroke="#00e676" strokeWidth="1.5" opacity="0.5"/>
    <circle cx="100" cy="58" r="6" fill="#00e676" opacity="0.6"/>
    <line x1="60" y1="58" x2="84" y2="58" stroke="#00e676" strokeWidth="1" opacity="0.5"/>
    <line x1="116" y1="58" x2="140" y2="58" stroke="#00e676" strokeWidth="1" opacity="0.5"/>
    <line x1="100" y1="18" x2="100" y2="42" stroke="#00e676" strokeWidth="1" opacity="0.5"/>
    <line x1="100" y1="74" x2="100" y2="98" stroke="#00e676" strokeWidth="1" opacity="0.5"/>
    <text x="100" y="110" textAnchor="middle" fill="#00e676" fontSize="8" fontFamily="monospace" opacity="0.6">STRIKE ZONE</text>
  </svg>
)

const ComplianceArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <radialGradient id="cg" cx="50%" cy="50%"><stop offset="0%" stopColor="#9d6fff30"/><stop offset="100%" stopColor="#14052820"/></radialGradient>
    </defs>
    <rect width="200" height="120" fill="url(#cg)"/>
    {[[40,30],[80,30],[120,30],[160,30],[40,60],[80,60],[120,60],[160,60],[40,90],[80,90],[120,90],[160,90]].map(([x,y],i) => (
      <circle key={i} cx={x} cy={y} r="2" fill="#9d6fff" opacity={0.2 + (i%3)*0.15}/>
    ))}
    {[[40,30,80,30],[80,30,120,60],[120,60,160,30],[40,60,80,90],[120,30,160,60],[80,60,120,90]].map(([x1,y1,x2,y2],i) => (
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#9d6fff" strokeWidth="1" opacity="0.25"/>
    ))}
    <circle cx="100" cy="58" r="18" fill="#9d6fff22" stroke="#9d6fff" strokeWidth="1.5" opacity="0.6"/>
    <circle cx="93" cy="55" r="4" fill="#9d6fff" opacity="0.7"/>
    <circle cx="107" cy="55" r="4" fill="#9d6fff" opacity="0.7"/>
    <path d="M93 62 Q100 67 107 62" fill="none" stroke="#9d6fff" strokeWidth="1.5" opacity="0.7"/>
    <text x="100" y="110" textAnchor="middle" fill="#9d6fff" fontSize="8" fontFamily="monospace" opacity="0.6">NEURAL NET</text>
  </svg>
)

const CardClashArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <linearGradient id="ccg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ff478520"/><stop offset="100%" stopColor="#7c3aed30"/></linearGradient>
    </defs>
    <rect width="200" height="120" fill="url(#ccg)"/>
    <g transform="rotate(-15, 70, 60)">
      <rect x="35" y="20" width="45" height="70" rx="6" fill="#1a0a2e" stroke="#ff4785" strokeWidth="1.5" opacity="0.8"/>
      <text x="57" y="58" textAnchor="middle" fill="#ff4785" fontSize="20" opacity="0.9">♠</text>
      <text x="42" y="35" fill="#ff4785" fontSize="10" opacity="0.8">A</text>
    </g>
    <g transform="rotate(10, 130, 60)">
      <rect x="105" y="15" width="45" height="70" rx="6" fill="#1a0014" stroke="#ffd700" strokeWidth="1.5" opacity="0.8"/>
      <text x="127" y="55" textAnchor="middle" fill="#ffd700" fontSize="20" opacity="0.9">♦</text>
      <text x="112" y="30" fill="#ffd700" fontSize="10" opacity="0.8">K</text>
    </g>
    <g>
      <rect x="77" y="25" width="45" height="70" rx="6" fill="#0d1a2e" stroke="#00d4ff" strokeWidth="2" opacity="0.9" filter="drop-shadow(0 0 8px #00d4ff66)"/>
      <text x="99" y="63" textAnchor="middle" fill="#00d4ff" fontSize="22" opacity="0.9">♣</text>
      <text x="84" y="40" fill="#00d4ff" fontSize="10" opacity="0.8">Q</text>
    </g>
    <text x="100" y="110" textAnchor="middle" fill="#ff4785" fontSize="8" fontFamily="monospace" opacity="0.7">NEON DECK</text>
  </svg>
)

const PuzzleArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <linearGradient id="pzg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#00e67615"/><stop offset="100%" stopColor="#0099cc15"/></linearGradient>
    </defs>
    <rect width="200" height="120" fill="url(#pzg)"/>
    <rect x="60" y="20" width="35" height="35" rx="4" fill="#7c3aed40" stroke="#9d6fff" strokeWidth="1.5" opacity="0.8"/>
    <rect x="100" y="20" width="35" height="35" rx="4" fill="#00d4ff30" stroke="#00d4ff" strokeWidth="1.5" opacity="0.8"/>
    <rect x="60" y="60" width="35" height="35" rx="4" fill="#ffd70030" stroke="#ffd700" strokeWidth="1.5" opacity="0.8"/>
    <rect x="100" y="60" width="35" height="35" rx="4" fill="#ff6b3530" stroke="#ff6b35" strokeWidth="1.5" opacity="0.8"/>
    <text x="78" y="42" textAnchor="middle" fill="#9d6fff" fontSize="16" opacity="0.9">✦</text>
    <text x="118" y="42" textAnchor="middle" fill="#00d4ff" fontSize="16" opacity="0.9">◈</text>
    <text x="78" y="82" textAnchor="middle" fill="#ffd700" fontSize="16" opacity="0.9">⬟</text>
    <text x="118" y="82" textAnchor="middle" fill="#ff6b35" fontSize="16" opacity="0.9">▲</text>
    <text x="100" y="110" textAnchor="middle" fill="#00e676" fontSize="8" fontFamily="monospace" opacity="0.6">MIND MAZE</text>
  </svg>
)

const DataArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <linearGradient id="dag" x1="0" y1="1" x2="0" y2="0"><stop offset="0%" stopColor="#001a4a"/><stop offset="100%" stopColor="#3b82f620"/></linearGradient>
    </defs>
    <rect width="200" height="120" fill="url(#dag)"/>
    {[[20,90,95],[35,70,95],[50,80,95],[65,55,95],[80,65,95],[95,40,95],[110,60,95],[125,45,95],[140,70,95],[155,50,95],[170,75,95],[185,35,95]].map(([x,y1,y2],i)=>(
      <rect key={i} x={x-5} y={y1} width="10" height={y2-y1} rx="2" fill="#3b82f6" opacity={0.25+i*0.04}/>
    ))}
    <polyline points="20,85 35,65 50,75 65,50 80,60 95,35 110,55 125,40 140,65 155,45 170,70 185,30" fill="none" stroke="#00d4ff" strokeWidth="1.5" opacity="0.7"/>
    <circle cx="185" cy="30" r="3" fill="#00d4ff" opacity="0.9"/>
    <text x="100" y="110" textAnchor="middle" fill="#3b82f6" fontSize="8" fontFamily="monospace" opacity="0.7">DATA STREAM</text>
  </svg>
)

const TeamArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <radialGradient id="teamg" cx="50%" cy="50%"><stop offset="0%" stopColor="#f59e0b20"/><stop offset="100%" stopColor="#1a0a0020"/></radialGradient>
    </defs>
    <rect width="200" height="120" fill="url(#teamg)"/>
    <circle cx="100" cy="50" r="22" fill="none" stroke="#f59e0b" strokeWidth="1.5" opacity="0.5"/>
    <circle cx="60" cy="70" r="16" fill="none" stroke="#ffd700" strokeWidth="1.5" opacity="0.45"/>
    <circle cx="140" cy="70" r="16" fill="none" stroke="#ffd700" strokeWidth="1.5" opacity="0.45"/>
    <line x1="78" y1="65" x2="87" y2="62" stroke="#ffd700" strokeWidth="1.5" opacity="0.5" strokeDasharray="3,2"/>
    <line x1="113" y1="62" x2="122" y2="65" stroke="#ffd700" strokeWidth="1.5" opacity="0.5" strokeDasharray="3,2"/>
    <circle cx="100" cy="48" r="8" fill="#f59e0b" opacity="0.7"/>
    <path d="M100 56 Q90 60 88 70" fill="none" stroke="#f59e0b" strokeWidth="1.5" opacity="0.5"/>
    <path d="M100 56 Q110 60 112 70" fill="none" stroke="#f59e0b" strokeWidth="1.5" opacity="0.5"/>
    <circle cx="60" cy="68" r="7" fill="#ffd700" opacity="0.6"/>
    <circle cx="140" cy="68" r="7" fill="#ffd700" opacity="0.6"/>
    <text x="100" y="108" textAnchor="middle" fill="#f59e0b" fontSize="8" fontFamily="monospace" opacity="0.6">ALLIANCE</text>
  </svg>
)

const PolicyArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <linearGradient id="polg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#ffd70015"/><stop offset="100%" stopColor="#1a120010"/></linearGradient>
    </defs>
    <rect width="200" height="120" fill="url(#polg)"/>
    <rect x="75" y="15" width="50" height="65" rx="4" fill="#0a0800" stroke="#ffd700" strokeWidth="1.5" opacity="0.7"/>
    <rect x="75" y="15" width="50" height="18" rx="4" fill="#ffd70030"/>
    <text x="100" y="28" textAnchor="middle" fill="#ffd700" fontSize="10" opacity="0.9">POLICY</text>
    <rect x="82" y="40" width="36" height="3" rx="1.5" fill="#ffd700" opacity="0.4"/>
    <rect x="82" y="47" width="28" height="3" rx="1.5" fill="#ffd700" opacity="0.3"/>
    <rect x="82" y="54" width="32" height="3" rx="1.5" fill="#ffd700" opacity="0.25"/>
    <rect x="82" y="61" width="24" height="3" rx="1.5" fill="#ffd700" opacity="0.2"/>
    <circle cx="100" cy="90" r="14" fill="#ffd70015" stroke="#ffd700" strokeWidth="1.5" opacity="0.7"/>
    <circle cx="100" cy="87" r="5" fill="none" stroke="#ffd700" strokeWidth="1.5" opacity="0.8"/>
    <rect x="96" y="90" width="8" height="6" rx="1" fill="#ffd700" opacity="0.7"/>
    <text x="100" y="112" textAnchor="middle" fill="#ffd700" fontSize="8" fontFamily="monospace" opacity="0.6">VAULT</text>
  </svg>
)

const ProcessArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <linearGradient id="procg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stopColor="#00d4ff15"/><stop offset="100%" stopColor="#00665015"/></linearGradient>
    </defs>
    <rect width="200" height="120" fill="url(#procg)"/>
    {[30,80,130].map((x,i) => (
      <g key={i}>
        <circle cx={x} cy="55" r="18" fill={`rgba(0,212,255,${0.08+i*0.05})`} stroke="#00d4ff" strokeWidth="1.5" opacity={0.5+i*0.1}/>
        <text x={x} y="59" textAnchor="middle" fill="#00d4ff" fontSize="14" opacity="0.8">{['①','②','③'][i]}</text>
      </g>
    ))}
    {[[48,55,62,55],[98,55,112,55]].map(([x1,y1,x2,y2],i)=>(
      <g key={i}>
        <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="#00d4ff" strokeWidth="1.5" opacity="0.5"/>
        <polygon points={`${x2},${y1-4} ${x2+7},${y1} ${x2},${y1+4}`} fill="#00d4ff" opacity="0.5"/>
      </g>
    ))}
    <circle cx="170" cy="55" r="18" fill="none" stroke="#00d4ff" strokeWidth="1.5" strokeDasharray="4,3" opacity="0.4"/>
    <text x="170" y="59" textAnchor="middle" fill="#00d4ff" fontSize="12" opacity="0.5">?</text>
    <text x="100" y="110" textAnchor="middle" fill="#00d4ff" fontSize="8" fontFamily="monospace" opacity="0.6">FLOW STATE</text>
  </svg>
)

const EmojiDecodeArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <radialGradient id="edg" cx="50%" cy="50%"><stop offset="0%" stopColor="#ffb70330"/><stop offset="100%" stopColor="#3d280010"/></radialGradient>
    </defs>
    <rect width="200" height="120" fill="url(#edg)"/>
    <text x="62" y="60" textAnchor="middle" fontSize="30" opacity="0.9">🍕</text>
    <text x="100" y="55" textAnchor="middle" fontSize="26" opacity="0.85">🧀</text>
    <text x="138" y="62" textAnchor="middle" fontSize="30" opacity="0.9">🔥</text>
    <line x1="30" y1="85" x2="170" y2="85" stroke="#ffb703" strokeWidth="1" opacity="0.3" strokeDasharray="4,4"/>
    <rect x="55" y="90" width="90" height="16" rx="8" fill="#ffb70318" stroke="#ffb703" strokeWidth="1" opacity="0.6"/>
    <text x="100" y="101" textAnchor="middle" fill="#ffb703" fontSize="9" fontWeight="700" opacity="0.85">?</text>
    <text x="100" y="115" textAnchor="middle" fill="#ffb703" fontSize="8" fontFamily="monospace" opacity="0.6">DECODE ZONE</text>
  </svg>
)

const ColorBlitzArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <radialGradient id="cbg" cx="50%" cy="50%"><stop offset="0%" stopColor="#06d6a030"/><stop offset="100%" stopColor="#00251c10"/></radialGradient>
    </defs>
    <rect width="200" height="120" fill="url(#cbg)"/>
    {[0,1,2,3,4,5,6,7,8].map((i) => {
      const x = 68 + (i % 3) * 22
      const y = 28 + Math.floor(i / 3) * 22
      const isOdd = i === 4
      return <rect key={i} x={x} y={y} width="18" height="18" rx="4" fill={isOdd ? '#06d6a0' : '#0891b2'} opacity={isOdd ? 0.95 : 0.55} stroke={isOdd ? '#06d6a0' : 'none'} strokeWidth={isOdd ? 2 : 0} />
    })}
    <text x="100" y="110" textAnchor="middle" fill="#06d6a0" fontSize="8" fontFamily="monospace" opacity="0.6">BLITZ GRID</text>
  </svg>
)

const LudoArt = () => (
  <svg width="100%" height="100%" viewBox="0 0 200 120" style={{ position: 'absolute', inset: 0 }}>
    <defs>
      <radialGradient id="ludoLibG" cx="50%" cy="50%"><stop offset="0%" stopColor="#7c3aed30" /><stop offset="100%" stopColor="#1a002d10" /></radialGradient>
    </defs>
    <rect width="200" height="120" fill="url(#ludoLibG)" />
    {[['#ff4757', 40, 78], ['#2ed573', 75, 68], ['#f9ca24', 110, 78], ['#3b82f6', 145, 68]].map(([c, x, y], i) => (
      <g key={i} transform={`translate(${x},${y})`}>
        <ellipse cx="0" cy="14" rx="10" ry="3" fill="#000" opacity="0.18" />
        <path d="M -7 13 Q -7 -2 0 -5 Q 7 -2 7 13 Z" fill={c as string} stroke="#fff" strokeWidth="1.2" />
        <circle cx="0" cy="-8" r="5.5" fill={c as string} stroke="#fff" strokeWidth="1.2" />
      </g>
    ))}
    <g transform="translate(100,32) rotate(-10)">
      <rect x="-16" y="-16" width="32" height="32" rx="7" fill="#16162c" stroke="#9d6fff" strokeWidth="1.5" />
      {[[-7, -7], [7, -7], [-7, 0], [7, 0], [-7, 7], [7, 7]].map(([cx, cy], i) => (
        <circle key={i} cx={cx} cy={cy} r="2.6" fill="#c4a6ff" />
      ))}
    </g>
    <text x="100" y="110" textAnchor="middle" fill="#9d6fff" fontSize="8" fontFamily="monospace" opacity="0.6">ROLL · RACE · HOME</text>
  </svg>
)

// Games no longer carry their SVG artwork from the backend — the artwork components above stay
// hardcoded in this file, keyed by the real `games.id` values seeded in the database.
const ART_MAP: Record<string, () => React.JSX.Element> = {
  wg1: SafetyArt,
  wg2: ProcedureArt,
  wg3: TargetArt,
  wg4: ComplianceArt,
  wg5: ProcessArt,
  wg6: DataArt,
  wg7: TeamArt,
  wg8: PolicyArt,
  cg1: CardClashArt,
  cg2: PuzzleArt,
  emoji_decode: EmojiDecodeArt,
  ludo: LudoArt,
  color_blitz: ColorBlitzArt,
}

export default function GamesLibraryScreen({ onNavigateToGame, lang, setLang }: Props) {
  const [tab, setTab] = useState<'all' | 'work' | 'casual'>('all')
  const [games, setGames] = useState<Game[]>([])
  const isAr = lang === 'ar'

  useEffect(() => {
    let cancelled = false
    getGames().then((data) => { if (!cancelled) setGames(data) })
    return () => { cancelled = true }
  }, [])

  const workGames = games.filter((g) => g.category === 'work' && g.is_active)
  const casualGames = games.filter((g) => g.category === 'casual' && g.is_active)

  const showWork = tab === 'all' || tab === 'work'
  const showCasual = tab === 'all' || tab === 'casual'

  return (
    <div className="screen bg-game">
      <TopBar title="Games" titleAr="الألعاب" lang={lang} setLang={setLang} />

      <div style={{ padding: '14px 16px 0' }}>
        {/* Search */}
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <span style={{ position: 'absolute', [isAr ? 'right' : 'left']: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center' }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg-rgb),0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
          </span>
          <input type="search" placeholder={isAr ? 'ابحث عن عالم…' : 'Search worlds…'} style={{ [isAr ? 'paddingRight' : 'paddingLeft']: 40 }} />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {(['all', 'work', 'casual'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '8px 18px', borderRadius: 99, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, transition: 'all 0.2s ease',
                background: tab === t ? 'linear-gradient(135deg, #7c3aed, #5b21b6)' : 'rgba(var(--fg-rgb),0.05)',
                color: tab === t ? 'white' : 'rgba(var(--fg2-rgb),0.5)',
                boxShadow: tab === t ? '0 4px 14px rgba(124,58,237,0.4)' : 'none',
                fontFamily: isAr ? "'Cairo', sans-serif" : 'inherit',
              }}
            >
              {t === 'all' ? (isAr ? 'الكل' : 'All Worlds') : t === 'work' ? (isAr ? 'تعلّم' : 'Learning') : (isAr ? 'ترفيه' : 'Fun')}
            </button>
          ))}
        </div>
      </div>

      <div className="pb-nav" style={{ padding: '0 16px', paddingBottom: 'calc(80px + 24px)' }}>
        {showWork && (
          <div style={{ marginBottom: 24 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(var(--fg-rgb),0.06)' }} />
              <span className={`font-display`} style={{ fontSize: 12, fontWeight: 800, color: 'rgba(var(--fg2-rgb),0.4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                {isAr ? 'ألعاب التعلم' : 'Learning Worlds'}
              </span>
              <div style={{ flex: 1, height: 1, background: 'rgba(var(--fg-rgb),0.06)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {workGames.map((game) => (
                <GameWorldCard key={game.id} game={game} isAr={isAr} onNavigateToGame={onNavigateToGame} />
              ))}
            </div>
          </div>
        )}

        {showCasual && (
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
              <div style={{ flex: 1, height: 1, background: 'rgba(var(--fg-rgb),0.06)' }} />
              <span className="font-display" style={{ fontSize: 12, fontWeight: 800, color: 'rgba(var(--fg2-rgb),0.4)', letterSpacing: '0.15em', textTransform: 'uppercase' }}>
                {isAr ? 'العوالم الترفيهية' : 'Fun Worlds'}
              </span>
              <div style={{ flex: 1, height: 1, background: 'rgba(var(--fg-rgb),0.06)' }} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {casualGames.map((game) => (
                <GameWorldCard key={game.id} game={game} isAr={isAr} onNavigateToGame={onNavigateToGame} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function GameWorldCard({ game, isAr, onNavigateToGame }: { game: Game, isAr: boolean, onNavigateToGame: (s: Screen, gameId?: string) => void }) {
  const coming = game.is_coming_soon
  const featured = game.is_featured
  const Art = ART_MAP[game.id] ?? SafetyArt // fallback in case a new game id has no artwork mapped yet

  if (featured) {
    // Wide featured card with more height and prominent layout
    return (
      <div
        className={`card card-hover ${game.world ?? ''}`}
        style={{ overflow: 'hidden', opacity: coming ? 0.65 : 1, border: `1px solid ${game.accent_color}35`, boxShadow: `0 0 40px ${game.accent_color}12` }}
        onClick={() => !coming && onNavigateToGame(game.target_screen as Screen, game.id)}
      >
        <div style={{ height: 140, position: 'relative', overflow: 'hidden' }}>
          <Art />
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 20%, rgba(3,3,15,0.85) 100%)' }} />
          {/* Featured label */}
          <div style={{ position: 'absolute', top: 10, left: 12 }}>
            <span style={{ fontSize: 10, fontWeight: 800, color: game.accent_color, background: `${game.accent_color}18`, border: `1px solid ${game.accent_color}35`, borderRadius: 6, padding: '3px 8px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              {isAr ? 'مميز' : 'FEATURED'}
            </span>
          </div>
          <div style={{ position: 'absolute', top: 10, right: 10, display: 'flex', gap: 5 }}>
            {game.tag === 'hot' && <span className="badge badge-hot">HOT</span>}
            {game.tag === 'new' && <span className="badge badge-new">NEW</span>}
          </div>
          <div style={{ position: 'absolute', bottom: 14, left: 16, right: 16 }}>
            <p style={{ margin: '0 0 2px', fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif", fontSize: 20, fontWeight: 900, color: 'var(--foreground)' }}>
              {isAr ? game.name_ar : game.name}
            </p>
            <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 10, fontWeight: 800, color: game.accent_color, letterSpacing: '0.18em', textTransform: 'uppercase', opacity: 0.85 }}>
              {isAr ? game.tagline_ar : game.tagline}
            </span>
          </div>
        </div>
        <div style={{ padding: '12px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 16, fontWeight: 900, color: game.accent_color }}>+{game.base_xp}</div>
              <div style={{ fontSize: 9, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>XP</div>
            </div>
            <div style={{ width: 1, background: 'rgba(var(--fg-rgb),0.07)' }} />
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 16, fontWeight: 900, color: '#00e676' }}>~8</div>
              <div style={{ fontSize: 9, color: 'rgba(var(--fg2-rgb),0.45)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{isAr ? 'دقائق' : 'min'}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 12, background: `linear-gradient(135deg, ${game.accent_color}, ${game.accent_color}aa)`, boxShadow: `0 4px 16px ${game.accent_color}35` }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
            <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 13, fontWeight: 800, color: game.accent_color === '#ffd700' ? '#03030f' : 'white' }}>
              {isAr ? 'العب الآن' : 'Play Now'}
            </span>
          </div>
        </div>
      </div>
    )
  }

  // Standard card
  return (
    <div
      className={`card card-hover ${game.world ?? ''}`}
      style={{ overflow: 'hidden', opacity: coming ? 0.65 : 1 }}
      onClick={() => !coming && onNavigateToGame(game.target_screen as Screen, game.id)}
    >
      <div style={{ height: 90, position: 'relative', overflow: 'hidden' }}>
        <Art />
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 20%, rgba(3,3,15,0.82) 100%)' }} />
        <div style={{ position: 'absolute', bottom: 8, left: 14 }}>
          <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 9, fontWeight: 800, color: game.accent_color, letterSpacing: '0.2em', textTransform: 'uppercase', opacity: 0.8 }}>
            {isAr ? game.tagline_ar : game.tagline}
          </span>
        </div>
        <div style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 4 }}>
          {game.tag === 'hot' && <span className="badge badge-hot">HOT</span>}
          {game.tag === 'new' && <span className="badge badge-new">NEW</span>}
          {coming && <span className="badge badge-soon">{isAr ? 'قريباً' : 'SOON'}</span>}
        </div>
      </div>

      <div style={{ padding: '10px 14px', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ margin: '0 0 2px', fontSize: 14, fontWeight: 800, color: 'var(--foreground)', fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {isAr ? game.name_ar : game.name}
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <svg width="9" height="9" viewBox="0 0 24 24" fill={game.accent_color}><polygon points="13,2 3,14 12,14 11,22 21,10 12,10"/></svg>
            <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 11, fontWeight: 800, color: game.accent_color }}>+{game.base_xp} XP</span>
          </div>
        </div>
        {coming ? (
          <div style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(var(--fg-rgb),0.05)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg2-rgb),0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          </div>
        ) : (
          <div style={{ width: 36, height: 36, borderRadius: 10, background: `${game.accent_color}20`, border: `1px solid ${game.accent_color}35`, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: `0 0 12px ${game.accent_color}20` }}>
            <svg width="12" height="12" viewBox="0 0 24 24" fill={game.accent_color}><polygon points="5,3 19,12 5,21"/></svg>
          </div>
        )}
      </div>
    </div>
  )
}
