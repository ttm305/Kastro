import { useEffect, useRef, useState } from 'react'
import type { Lang } from '../App'
import { getDiagEntries, subscribeDiag, clearDiagEntries, type DiagEntry } from '../lib/diagnostics'

/**
 * TEMPORARY owner-only diagnostics overlay.
 *
 * Why this exists: this delivery was written without any live Supabase
 * connection to the production project — no way to run the requested
 * two-device acceptance test directly, or to confirm live that the
 * presence/lobby fixes actually work against the real database. Rather
 * than claim a live result that was never actually observed, this panel
 * lets the owner capture the exact same diagnostic stream this delivery
 * would otherwise only be able to describe in the abstract, directly on
 * their own device, in real time, while testing with a second real
 * account. Every diagLog(...) call feeding this (see src/lib/
 * diagnostics.ts and its call sites in lobbyController.ts,
 * useMatchEngine.ts, presenceHeartbeat.ts, api.ts's realtime subscribe
 * callbacks) fires regardless of whether this panel is open — this is
 * just a viewer into an always-running in-memory ring buffer, gated to
 * the owner role only (never shown to a normal player) and never sent
 * anywhere off-device.
 *
 * Meant to be removed once the owner has confirmed the fixes live — it
 * is deliberately unobtrusive (small floating toggle, closed by default)
 * so it costs nothing for normal owner use in the meantime.
 */
export default function DiagnosticsPanel({ lang }: { lang: Lang }) {
  const isAr = lang === 'ar'
  const [open, setOpen] = useState(false)
  const [entries, setEntries] = useState<DiagEntry[]>(getDiagEntries())
  const [filter, setFilter] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => subscribeDiag(setEntries), [])

  useEffect(() => {
    if (!open) return
    const el = listRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [entries, open])

  const shown = filter.trim()
    ? entries.filter((e) => `${e.scope} ${e.message}`.toLowerCase().includes(filter.trim().toLowerCase()))
    : entries

  const copyAll = () => {
    const text = shown
      .map((e) => `${new Date(e.at).toISOString()} [${e.scope}] ${e.message}${e.data ? ' ' + JSON.stringify(e.data) : ''}`)
      .join('\n')
    navigator.clipboard?.writeText(text).catch(() => {})
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        aria-label="Diagnostics"
        style={{
          position: 'fixed', top: 'max(10px, env(safe-area-inset-top))', insetInlineStart: 10, zIndex: 9999,
          width: 36, height: 36, borderRadius: 10, border: '1px solid rgba(255,180,0,0.4)',
          background: 'rgba(20,15,0,0.85)', color: '#ffb703', fontSize: 16, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'monospace',
        }}
      >
        🐞
      </button>
    )
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(5,5,10,0.97)',
        display: 'flex', flexDirection: 'column', color: '#e8e8f0', fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', borderBottom: '1px solid rgba(255,180,0,0.25)', paddingTop: 'max(10px, env(safe-area-inset-top))' }}>
        <span style={{ color: '#ffb703', fontWeight: 800, fontSize: 13 }}>🐞 {isAr ? 'التشخيص (مؤقت)' : 'Diagnostics (temporary)'}</span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{shown.length}/{entries.length}</span>
        <div style={{ flex: 1 }} />
        <button onClick={copyAll} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, padding: '5px 8px', cursor: 'pointer' }}>
          {isAr ? 'نسخ' : 'Copy'}
        </button>
        <button onClick={clearDiagEntries} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 11, padding: '5px 8px', cursor: 'pointer' }}>
          {isAr ? 'مسح' : 'Clear'}
        </button>
        <button onClick={() => setOpen(false)} style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, padding: '5px 10px', cursor: 'pointer' }}>
          ✕
        </button>
      </div>

      <input
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder={isAr ? 'تصفية (مثال: presence, room, ready, realtime)' : 'Filter (e.g. presence, room, ready, realtime)'}
        style={{ margin: 8, padding: '8px 10px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.05)', color: '#fff', fontSize: 12 }}
      />

      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '0 10px 10px', fontSize: 11.5, lineHeight: 1.5 }}>
        {shown.length === 0 && (
          <p style={{ color: 'rgba(255,255,255,0.35)', textAlign: 'center', marginTop: 30 }}>
            {isAr ? 'لا سجلات بعد. ابدأ استخدام الغرف/الدردشة/الحضور.' : 'No log entries yet. Start using rooms/chat/presence.'}
          </p>
        )}
        {shown.map((e) => (
          <div key={e.id} style={{ padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
            <span style={{ color: 'rgba(255,255,255,0.35)' }}>{new Date(e.at).toLocaleTimeString()}</span>{' '}
            <span style={{ color: '#67e8f9', fontWeight: 700 }}>[{e.scope}]</span>{' '}
            <span style={{ color: /fail|error|denied|forbidden/i.test(e.message) ? '#ff6b6b' : '#e8e8f0' }}>{e.message}</span>
            {e.data !== undefined && (
              <pre style={{ margin: '2px 0 0', color: 'rgba(255,255,255,0.55)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                {typeof e.data === 'string' ? e.data : JSON.stringify(e.data)}
              </pre>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
