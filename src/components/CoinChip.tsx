interface Props {
  coins: number
  size?: 'sm' | 'md'
  animate?: boolean
}

/** Small pill showing the coin balance — visually distinct from XP (gold coin glyph vs violet XP bar) so the two currencies never get confused on screen. */
export default function CoinChip({ coins, size = 'md', animate }: Props) {
  const sm = size === 'sm'
  return (
    <div
      className={animate ? 'animate-scale-in' : undefined}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: sm ? 4 : 6,
        background: 'rgba(255,215,0,0.1)',
        border: '1px solid rgba(255,215,0,0.28)',
        borderRadius: 99,
        padding: sm ? '4px 9px' : '6px 13px',
      }}
    >
      <svg width={sm ? 12 : 14} height={sm ? 12 : 14} viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="10" fill="#ffd700" />
        <circle cx="12" cy="12" r="10" fill="none" stroke="#f59e0b" strokeWidth="1.5" />
        <text x="12" y="16.5" textAnchor="middle" fontSize="12" fontWeight="900" fill="#7a5200">$</text>
      </svg>
      <span style={{ fontFamily: "'Exo 2', sans-serif", fontSize: sm ? 11 : 13, fontWeight: 800, color: '#ffd700' }}>
        {coins.toLocaleString()}
      </span>
    </div>
  )
}
