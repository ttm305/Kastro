import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase, EDGE_FUNCTION_URL } from './supabaseClient'
import type { Tables } from './database.types'

export type Profile = Tables<'profiles'>

interface AuthContextValue {
  session: Session | null
  profile: Profile | null
  loading: boolean
  /** True once the initial session check has resolved (avoids a login-screen flash). */
  ready: boolean
  /**
   * True from the moment Supabase's recovery link lands us back in the app
   * (a PASSWORD_RECOVERY auth event) until the user successfully sets a new
   * password. The app shell checks this before its normal login/home
   * redirect so a recovery session can never be silently treated as a
   * regular sign-in.
   */
  isPasswordRecovery: boolean
  signIn: (email: string, password: string) => Promise<{ error: string | null }>
  signUp: (
    email: string,
    password: string,
    username: string,
    accessCode: string,
    branchId: string
  ) => Promise<{ error: string | null }>
  signOut: () => Promise<void>
  sendPasswordReset: (email: string) => Promise<{ error: string | null }>
  /** Sets a new password on the current (recovery) session — does not by itself leave recovery mode. */
  updatePassword: (newPassword: string) => Promise<{ error: string | null }>
  /** Call once the "password updated" confirmation has been shown, to release the user into the app. */
  completePasswordRecovery: () => void
  refreshProfile: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)

  const loadProfile = useCallback(async (userId: string) => {
    const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle()
    setProfile(data ?? null)
  }, [])

  useEffect(() => {
    let mounted = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return
      setSession(data.session)
      if (data.session) await loadProfile(data.session.user.id)
      setReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange(async (event, newSession) => {
      if (!mounted) return
      // A recovery-link session must never be treated as a normal sign-in —
      // flag it so the app shell can route to the "set new password" screen
      // instead of dropping the user straight into Home with the old
      // password still active.
      if (event === 'PASSWORD_RECOVERY') setIsPasswordRecovery(true)
      setSession(newSession)
      if (newSession) {
        await loadProfile(newSession.user.id)
      } else {
        setProfile(null)
      }
    })

    return () => {
      mounted = false
      sub.subscription.unsubscribe()
    }
  }, [loadProfile])

  // Presence: mark online whenever a session starts. There is no reliable
  // client-side "tab closed" signal, so `is_online` naturally clears on the
  // next explicit sign-out; a scheduled job could additionally flip stale
  // sessions offline server-side if exact presence becomes important.
  useEffect(() => {
    if (!session) return
    supabase.rpc('record_login').then(() => loadProfile(session.user.id))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id])

  const signIn: AuthContextValue['signIn'] = async (email, password) => {
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
    setLoading(false)
    return { error: error?.message ?? null }
  }

  const signUp: AuthContextValue['signUp'] = async (email, password, username, accessCode, branchId) => {
    setLoading(true)
    try {
      const res = await fetch(EDGE_FUNCTION_URL('register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, username, accessCode, branchId }),
      })
      const body = await res.json()
      if (!res.ok) {
        setLoading(false)
        return { error: body.error ?? 'Registration failed' }
      }
      // Account created — now establish a real session.
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password })
      setLoading(false)
      return { error: error?.message ?? null }
    } catch {
      setLoading(false)
      return { error: 'Network error — please try again' }
    }
  }

  const signOut = async () => {
    // Presence lifecycle fix: clear any "Playing X" game activity immediately
    // on logout rather than leaving it to the 90s staleness sweep — this is
    // the explicit "logging out" case from the presence requirements. Best
    // effort: never blocks sign-out if it fails.
    await supabase.rpc('clear_my_game_presence').then(undefined, () => {})
    await supabase.rpc('record_logout').then(undefined, () => {})
    await supabase.auth.signOut()
  }

  const sendPasswordReset: AuthContextValue['sendPasswordReset'] = async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: window.location.origin,
    })
    return { error: error?.message ?? null }
  }

  const refreshProfile = async () => {
    if (session) await loadProfile(session.user.id)
  }

  const updatePassword: AuthContextValue['updatePassword'] = async (newPassword) => {
    setLoading(true)
    const { error } = await supabase.auth.updateUser({ password: newPassword })
    setLoading(false)
    return { error: error?.message ?? null }
  }

  const completePasswordRecovery = () => setIsPasswordRecovery(false)

  return (
    <AuthContext.Provider
      value={{
        session, profile, loading, ready, isPasswordRecovery,
        signIn, signUp, signOut, sendPasswordReset, updatePassword, completePasswordRecovery, refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
