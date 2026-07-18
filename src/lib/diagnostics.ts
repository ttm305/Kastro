/**
 * TEMPORARY production-safe diagnostics for verifying the presence and
 * multiplayer-lobby fixes on real devices, requested explicitly because
 * this delivery was written without any live Supabase connection (no way
 * to run the two-device acceptance test directly). Everything here is
 * additive and read-only from the app's point of view — it never changes
 * what any RPC does, it only records what happened so it can be inspected
 * without needing to attach a laptop's devtools to a phone.
 *
 * "Production-safe" specifically means: every entry only ever contains
 * data the currently-signed-in user could already see about their own
 * session (their own auth id, the room/code/players they're already
 * looking at, RPC responses their own client already received) — nothing
 * here reads or exposes another user's private data, and nothing is sent
 * anywhere off-device; it's an in-memory ring buffer plus console.log,
 * visible only in that browser's own devtools or the owner-only
 * DiagnosticsPanel (src/components/DiagnosticsPanel.tsx).
 *
 * Meant to be deleted (or left harmlessly inert) once the underlying bugs
 * are confirmed fixed live — every call site is a single diagLog(...)
 * line that can be grepped and removed in one pass.
 */

export interface DiagEntry {
  id: number
  at: number
  scope: string
  message: string
  data?: unknown
}

const MAX_ENTRIES = 300
let entries: DiagEntry[] = []
let nextId = 1
const listeners = new Set<(entries: DiagEntry[]) => void>()

export function diagLog(scope: string, message: string, data?: unknown) {
  const entry: DiagEntry = { id: nextId++, at: Date.now(), scope, message, data }
  entries = [...entries.slice(-(MAX_ENTRIES - 1)), entry]
  // eslint-disable-next-line no-console
  console.log(`[KASTRO-DIAG][${scope}] ${message}`, data ?? '')
  for (const l of listeners) l(entries)
}

export function getDiagEntries(): DiagEntry[] {
  return entries
}

export function clearDiagEntries() {
  entries = []
  for (const l of listeners) l(entries)
}

export function subscribeDiag(listener: (entries: DiagEntry[]) => void): () => void {
  listeners.add(listener)
  listener(entries)
  return () => { listeners.delete(listener) }
}
