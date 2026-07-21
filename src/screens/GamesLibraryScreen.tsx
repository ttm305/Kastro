import { useState, useEffect, useMemo } from 'react'
import type { Screen, Lang } from '../App'
import TopBar from '../components/TopBar'
import { getGames, getFavoriteGameIds, toggleFavoriteGame, type Game } from '../lib/api'
import { useAuth } from '../lib/auth'

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

// Games without an admin-uploaded cover_image_url fall back to these
// hand-built SVG "world" artworks, keyed by the real `games.id` values
// seeded in the database — so the page never looks broken before an owner
// uploads real cover art from the Admin Dashboard.
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

type ChipKey = 'all' | 'new' | 'multiplayer' | 'card' | 'board' | 'puzzle' | 'quick' | 'work'

const CHIPS: { key: ChipKey; en: string; ar: string }[] = [
  { key: 'all', en: 'All', ar: 'الكل' },
  { key: 'new', en: 'New', ar: 'جديد' },
  { key: 'card', en: 'Card', ar: 'ورق' },
  { key: 'board', en: 'Board', ar: 'لوح' },
  { key: 'puzzle', en: 'Puzzle', ar: 'ألغاز' },
  { key: 'quick', en: 'Quick', ar: 'سريع' },
  { key: 'multiplayer', en: 'Multiplayer', ar: 'متعدد اللاعبين' },
  { key: 'work', en: 'Work Challenges', ar: 'تحديات العمل' },
]

function matchesChip(game: Game, chip: ChipKey): boolean {
  if (chip === 'all') return true
  if (chip === 'new') return game.is_new
  if (chip === 'multiplayer') return game.is_multiplayer
  return game.category === chip
}

/* Small icon buttons for the header's optional search/sort controls — same
   36x36 rgba-chip shape TopBar's own back button uses, for visual consistency. */
function HeaderIconButton({ onClick, active, label, children }: { onClick: () => void; active?: boolean; label: string; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      title={label}
      style={{
        width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
        background: active ? 'rgba(124,58,237,0.25)' : 'rgba(var(--fg-rgb),0.08)',
        border: `1px solid ${active ? 'rgba(124,58,237,0.4)' : 'rgba(var(--fg-rgb),0.1)'}`,
        color: active ? '#c4b5fd' : 'var(--foreground)',
      }}
    >
      {children}
    </button>
  )
}

function SearchIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
}
function SortIcon() {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 7h18M6 12h12M10 17h4"/></svg>
}
function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill={filled ? '#ff4785' : 'none'} stroke={filled ? '#ff4785' : 'white'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8Z"/>
    </svg>
  )
}
function PlayGlyph() {
  return <svg width="11" height="11" viewBox="0 0 24 24" fill="white"><polygon points="5,3 19,12 5,21"/></svg>
}

export default function GamesLibraryScreen({ onNavigateToGame, lang, setLang }: Props) {
  const { profile } = useAuth()
  const [games, setGames] = useState<Game[]>([])
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(new Set())
  const [chip, setChip] = useState<ChipKey>('all')
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [sortAz, setSortAz] = useState(false)
  const isAr = lang === 'ar'

  useEffect(() => {
    let cancelled = false
    getGames().then((data) => { if (!cancelled) setGames(data) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!profile?.id) { setFavoriteIds(new Set()); return }
    let cancelled = false
    getFavoriteGameIds(profile.id).then((ids) => { if (!cancelled) setFavoriteIds(new Set(ids)) })
    return () => { cancelled = true }
  }, [profile?.id])

  const toggleFavorite = async (gameId: string) => {
    if (!profile?.id) return
    const isFav = favoriteIds.has(gameId)
    setFavoriteIds((prev) => { // optimistic
      const next = new Set(prev)
      if (isFav) next.delete(gameId); else next.add(gameId)
      return next
    })
    const { error } = await toggleFavoriteGame(profile.id, gameId, !isFav)
    if (error) { // revert on failure
      setFavoriteIds((prev) => {
        const next = new Set(prev)
        if (isFav) next.add(gameId); else next.delete(gameId)
        return next
      })
    }
  }

  const activeGames = useMemo(() => games.filter((g) => g.is_active), [games])

  // The single hero card at the top — only the highest-priority (lowest
  // sort_order, since `games` is already sorted server-side) featured game,
  // never a wall of every featured game. Hidden while filtering/searching
  // so it doesn't compete with the "you're looking for X" results below.
  const featuredGame = useMemo(
    () => (chip === 'all' && !query.trim() ? activeGames.find((g) => g.is_featured) ?? null : null),
    [activeGames, chip, query],
  )

  const gridGames = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = activeGames.filter((g) => matchesChip(g, chip) && (!featuredGame || g.id !== featuredGame.id))
    if (q) list = list.filter((g) => g.name.toLowerCase().includes(q) || g.name_ar.includes(query.trim()))
    if (sortAz) list = [...list].sort((a, b) => (isAr ? a.name_ar.localeCompare(b.name_ar, 'ar') : a.name.localeCompare(b.name)))
    return list
  }, [activeGames, chip, query, featuredGame, sortAz, isAr])

  return (
    <div className="screen bg-game">
      <TopBar
        title="Games"
        titleAr="الألعاب"
        lang={lang}
        setLang={setLang}
        rightSlot={
          <>
            <HeaderIconButton onClick={() => setSortAz((v) => !v)} active={sortAz} label={isAr ? 'ترتيب أبجدي' : 'Sort A–Z'}><SortIcon /></HeaderIconButton>
            <HeaderIconButton onClick={() => setSearchOpen((v) => !v)} active={searchOpen} label={isAr ? 'بحث' : 'Search'}><SearchIcon /></HeaderIconButton>
          </>
        }
      />

      <div style={{ padding: '12px 16px 0' }}>
        {searchOpen && (
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <span style={{ position: 'absolute', [isAr ? 'right' : 'left']: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none', display: 'flex', alignItems: 'center', color: 'rgba(var(--fg-rgb),0.3)' }}>
              <SearchIcon />
            </span>
            <input
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isAr ? 'ابحث عن لعبة…' : 'Search games…'}
              style={{ [isAr ? 'paddingRight' : 'paddingLeft']: 40 }}
            />
          </div>
        )}

        {/* Category chips — horizontally scrollable, never wraps. RTL-safe:
            .scroll-x is a plain flex row, so the browser's own bidi handling
            (driven by the page's dir attribute) reverses scroll direction
            for Arabic without any extra logic here. */}
        <div className="scroll-x" style={{ marginBottom: 16 }}>
          {CHIPS.map((c) => (
            <button
              key={c.key}
              onClick={() => setChip(c.key)}
              style={{
                flexShrink: 0, padding: '8px 16px', borderRadius: 99, border: 'none', cursor: 'pointer',
                fontSize: 13, fontWeight: 700, whiteSpace: 'nowrap', transition: 'all 0.2s ease',
                background: chip === c.key ? 'linear-gradient(135deg, #7c3aed, #5b21b6)' : 'rgba(var(--fg-rgb),0.05)',
                color: chip === c.key ? 'white' : 'rgba(var(--fg2-rgb),0.55)',
                boxShadow: chip === c.key ? '0 4px 14px rgba(124,58,237,0.4)' : 'none',
              }}
            >
              {isAr ? c.ar : c.en}
            </button>
          ))}
        </div>
      </div>

      <div className="pb-nav" style={{ padding: '0 16px' }}>
        {featuredGame && (
          <div style={{ marginBottom: 18 }}>
            <FeaturedGameCard game={featuredGame} isAr={isAr} isFavorite={favoriteIds.has(featuredGame.id)} onToggleFavorite={profile?.id ? () => toggleFavorite(featuredGame.id) : undefined} onNavigateToGame={onNavigateToGame} />
          </div>
        )}

        {gridGames.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: 'rgba(var(--fg2-rgb),0.4)' }}>
            <div style={{ fontSize: 32, marginBottom: 10 }}>🎮</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{isAr ? 'لا توجد ألعاب مطابقة' : 'No games match this filter'}</div>
          </div>
        ) : (
          <div className="games-grid">
            {gridGames.map((game) => (
              <GameTile key={game.id} game={game} isAr={isAr} isFavorite={favoriteIds.has(game.id)} onToggleFavorite={profile?.id ? () => toggleFavorite(game.id) : undefined} onNavigateToGame={onNavigateToGame} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/** Coming-soon > Featured > New > Multiplayer, capped at 2 so a tile never gets cluttered with every badge it qualifies for. */
function gameBadges(game: Game, isAr: boolean): { label: string; bg: string; color: string }[] {
  const badges: { label: string; bg: string; color: string }[] = []
  if (game.is_coming_soon) badges.push({ label: isAr ? 'قريباً' : 'Coming Soon', bg: 'rgba(3,3,15,0.55)', color: 'rgba(255,255,255,0.75)' })
  if (game.is_featured) badges.push({ label: isAr ? 'مميزة' : 'Featured', bg: 'rgba(255,215,0,0.9)', color: '#03030f' })
  if (game.is_new) badges.push({ label: isAr ? 'جديد' : 'New', bg: 'rgba(0,212,255,0.9)', color: '#03030f' })
  if (game.is_multiplayer) badges.push({ label: isAr ? 'متعدد' : 'Multiplayer', bg: 'rgba(0,230,118,0.9)', color: '#03030f' })
  return badges.slice(0, 2)
}

function FavoriteHeart({ filled, onClick, isAr }: { filled: boolean; onClick: () => void; isAr: boolean }) {
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick() }}
      aria-label={isAr ? 'إضافة للمفضلة' : 'Favorite'}
      style={{
        position: 'absolute', top: 8, [isAr ? 'left' : 'right']: 8, zIndex: 2,
        width: 26, height: 26, borderRadius: '50%', border: 'none', cursor: 'pointer',
        background: 'rgba(3,3,15,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(4px)',
      }}
    >
      <HeartIcon filled={filled} />
    </button>
  )
}

function GameTile({ game, isAr, isFavorite, onToggleFavorite, onNavigateToGame }: {
  game: Game; isAr: boolean; isFavorite: boolean; onToggleFavorite?: () => void; onNavigateToGame: (s: Screen, gameId?: string) => void
}) {
  const coming = game.is_coming_soon
  const Art = ART_MAP[game.id] ?? SafetyArt
  const badges = gameBadges(game, isAr)

  return (
    <div
      className={`game-tile card-hover ${game.cover_image_url ? '' : (game.world ?? '')}`}
      style={{ opacity: coming ? 0.65 : 1, boxShadow: `0 0 24px ${game.accent_color}10` }}
      onClick={() => !coming && onNavigateToGame(game.target_screen as Screen, game.id)}
    >
      {game.cover_image_url ? <img src={game.cover_image_url} alt="" /> : <div className="game-tile-art"><Art /></div>}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 40%, rgba(3,3,15,0.88) 100%)' }} />

      {onToggleFavorite && <FavoriteHeart filled={isFavorite} onClick={onToggleFavorite} isAr={isAr} />}

      {badges.length > 0 && (
        <div style={{ position: 'absolute', top: 8, [isAr ? 'right' : 'left']: 8, display: 'flex', flexDirection: 'column', gap: 4, zIndex: 1 }}>
          {badges.map((b) => (
            <span key={b.label} style={{ fontSize: 9, fontWeight: 800, background: b.bg, color: b.color, borderRadius: 6, padding: '3px 7px', letterSpacing: '0.05em', textTransform: 'uppercase', width: 'fit-content' }}>
              {b.label}
            </span>
          ))}
        </div>
      )}

      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, padding: '10px 12px' }}>
        <p style={{ margin: 0, fontSize: 14, fontWeight: 800, color: 'white', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {isAr ? game.name_ar : game.name}
        </p>
      </div>
    </div>
  )
}

function FeaturedGameCard({ game, isAr, isFavorite, onToggleFavorite, onNavigateToGame }: {
  game: Game; isAr: boolean; isFavorite: boolean; onToggleFavorite?: () => void; onNavigateToGame: (s: Screen, gameId?: string) => void
}) {
  const Art = ART_MAP[game.id] ?? SafetyArt
  const coming = game.is_coming_soon

  return (
    <div
      className={`game-featured card-hover ${game.cover_image_url ? '' : (game.world ?? '')}`}
      style={{ opacity: coming ? 0.65 : 1 }}
      onClick={() => !coming && onNavigateToGame(game.target_screen as Screen, game.id)}
    >
      {game.cover_image_url ? <img src={game.cover_image_url} alt="" /> : <div className="game-tile-art"><Art /></div>}
      <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, transparent 25%, rgba(3,3,15,0.9) 100%)' }} />

      <div style={{ position: 'absolute', top: 12, [isAr ? 'right' : 'left']: 14 }}>
        <span style={{ fontSize: 10, fontWeight: 800, color: '#03030f', background: '#ffd700', borderRadius: 6, padding: '4px 10px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          {isAr ? 'مميز' : 'Featured'}
        </span>
        {coming && (
          <span style={{ marginInlineStart: 6, fontSize: 10, fontWeight: 800, color: 'rgba(255,255,255,0.85)', background: 'rgba(3,3,15,0.6)', borderRadius: 6, padding: '4px 10px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {isAr ? 'قريباً' : 'Coming Soon'}
          </span>
        )}
        {!coming && game.is_multiplayer && (
          <span style={{ marginInlineStart: 6, fontSize: 10, fontWeight: 800, color: '#03030f', background: '#00e676', borderRadius: 6, padding: '4px 10px', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
            {isAr ? 'متعدد اللاعبين' : 'Multiplayer'}
          </span>
        )}
      </div>

      {onToggleFavorite && <FavoriteHeart filled={isFavorite} onClick={onToggleFavorite} isAr={isAr} />}

      <div style={{ position: 'absolute', bottom: 16, left: 18, right: 18, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 12 }}>
        <p style={{ margin: 0, fontSize: 22, fontWeight: 900, color: 'white', lineHeight: 1.15 }}>
          {isAr ? game.name_ar : game.name}
        </p>
        {!coming && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 12, background: `linear-gradient(135deg, ${game.accent_color}, ${game.accent_color}aa)`, boxShadow: `0 4px 16px ${game.accent_color}40`, flexShrink: 0 }}>
            <PlayGlyph />
            <span style={{ fontSize: 12, fontWeight: 800, color: game.accent_color === '#ffd700' ? '#03030f' : 'white' }}>
              {isAr ? 'العب' : 'Play'}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
