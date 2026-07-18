import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'

export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

const STORAGE_KEY = 'kastro-appearance'

function systemPrefersLight(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: light)').matches
}

function resolve(pref: ThemePreference): ResolvedTheme {
  if (pref === 'system') return systemPrefersLight() ? 'light' : 'dark'
  return pref
}

function readStoredPreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  const raw = window.localStorage.getItem(STORAGE_KEY)
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

function applyToDocument(resolved: ResolvedTheme) {
  document.documentElement.setAttribute('data-theme', resolved)
}

interface ThemeContextValue {
  preference: ThemePreference
  resolved: ResolvedTheme
  setPreference: (p: ThemePreference) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

/**
 * Appearance (Light / Dark / System). Persisted to localStorage so it survives
 * logout, refresh, and reopening the app without touching the backend/profile
 * schema — this is a pure client display preference, not account data.
 * A tiny blocking inline script in index.html sets `data-theme` on <html>
 * before React hydrates, so there is no flash of the wrong theme on load.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(() => readStoredPreference())
  const [resolved, setResolved] = useState<ResolvedTheme>(() => resolve(readStoredPreference()))

  const setPreference = useCallback((p: ThemePreference) => {
    setPreferenceState(p)
    window.localStorage.setItem(STORAGE_KEY, p)
    const r = resolve(p)
    setResolved(r)
    applyToDocument(r)
  }, [])

  // Keep in sync with the OS theme while the user has chosen "system".
  useEffect(() => {
    if (preference !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = () => {
      const r = resolve('system')
      setResolved(r)
      applyToDocument(r)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [preference])

  // Make sure the DOM attribute matches state on mount (in case the inline
  // bootstrap script and React disagree for any reason).
  useEffect(() => { applyToDocument(resolved) }, [])

  return (
    <ThemeContext.Provider value={{ preference, resolved, setPreference }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
