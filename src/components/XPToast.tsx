import { useState } from 'react'

interface XPEvent {
  id: number
  amount: number
  label: string
  x: number
}

interface Props {
  events: XPEvent[]
}

export function useXPToast() {
  const [events, setEvents] = useState<XPEvent[]>([])
  let counter = 0

  const fire = (amount: number, label: string) => {
    const id = ++counter
    const x = 30 + Math.random() * 40
    setEvents((prev) => [...prev, { id, amount, label, x }])
    setTimeout(() => setEvents((prev) => prev.filter((e) => e.id !== id)), 2000)
  }

  return { events, fire }
}

export default function XPToast({ events }: Props) {
  return (
    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, pointerEvents: 'none', zIndex: 9000 }}>
      {events.map((e) => (
        <div
          key={e.id}
          style={{
            position: 'absolute',
            left: `${e.x}%`,
            top: 100,
            transform: 'translateX(-50%)',
            animation: 'float-up 2s ease forwards',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
          }}
        >
          <div style={{
            background: 'linear-gradient(135deg, #ffd700, #f59e0b)',
            borderRadius: 99,
            padding: '4px 12px',
            fontFamily: "'Exo 2', sans-serif",
            fontSize: 16,
            fontWeight: 900,
            color: '#03030f',
            boxShadow: '0 0 16px rgba(255,215,0,0.5)',
            whiteSpace: 'nowrap',
          }}>
            +{e.amount} XP
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,215,0,0.7)', fontWeight: 600 }}>{e.label}</div>
        </div>
      ))}
    </div>
  )
}
