import { useState, useEffect } from 'react'
import type { CSSProperties } from 'react'
import type { Screen, Lang } from '../App'
import { OWNER_EMAIL } from '../App'
import AppLogo from '../components/AppLogo'
import { useAuth } from '../lib/auth'
import { getBranches, type Branch } from '../lib/api'
import { safeTop, safeLeft, safeRight, tapTargetMinHeight } from '../lib/safeArea'

const DEFAULT_MIN_USERNAME_LEN = 3
const MAX_USERNAME_LEN = 24
// Bumped by hand whenever a meaningful fix ships, so anyone testing the app
// can confirm — at a glance, on the login screen — which build they're on.
const BUILD_STAMP = '2026-07-16.1'

interface Props {
  onNavigate: (s: Screen) => void
  lang: Lang
  setLang: (l: Lang) => void
}

export default function LoginScreen({ onNavigate: _onNavigate, lang, setLang }: Props) {
  const { signIn, signUp, sendPasswordReset, loading } = useAuth()
  const [isSignup, setIsSignup] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [username, setUsername] = useState('')
  const [accessCode, setAccessCode] = useState('')
  const [branchId, setBranchId] = useState('')
  const [branches, setBranches] = useState<Branch[]>([])
  // Three distinct states, deliberately kept apart (never collapsed into a
  // single "branches is empty" check): still loading, failed to load
  // (network/RLS/server error — recoverable, show Retry), and loaded
  // successfully but zero active branches exist (not recoverable by the
  // user — registration must be blocked and an admin contacted). Treating
  // the last two the same was exactly what made the original empty-
  // dropdown bug invisible.
  const [branchesLoading, setBranchesLoading] = useState(true)
  const [branchesError, setBranchesError] = useState<string | null>(null)
  const [showForgot, setShowForgot] = useState(false)
  const [resetSent, setResetSent] = useState(false)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const isAr = lang === 'ar'

  const loadBranches = () => {
    setBranchesLoading(true)
    setBranchesError(null)
    getBranches().then(({ error, data }) => {
      setBranchesLoading(false)
      if (error) { setBranchesError(error); return }
      setBranches(data)
    })
  }

  useEffect(() => { loadBranches() }, [])

  const T = {
    tagline:        isAr ? 'تعلّم. نافس. تطوّر.'   : 'Work. Play. Evolve.',
    sub:            isAr ? 'حوّل عملك إلى تجربة لعب لا تُنسى' : 'Transform your workplace into an unforgettable game.',
    emailLbl:       isAr ? 'البريد الإلكتروني'      : 'Email',
    usernameLbl:    isAr ? 'اسم المستخدم'           : 'Username',
    passLbl:        isAr ? 'كلمة المرور'            : 'Password',
    confirmPassLbl: isAr ? 'تأكيد كلمة المرور'      : 'Confirm Password',
    accessCodeLbl:  isAr ? 'رمز الوصول'             : 'Access Code',
    accessCodeHint: isAr ? 'رمز مقدّم من الإدارة'   : 'Provided by your administrator',
    deptLbl:        isAr ? 'الفرع'                   : 'Branch',
    deptPlaceholder:isAr ? 'اختر الفرع'              : 'Select branch',
    branchesLoading:isAr ? 'جارٍ تحميل الفروع…'      : 'Loading branches…',
    branchesError:  isAr ? 'تعذّر تحميل الفروع. تحقق من اتصالك وحاول مرة أخرى.' : 'Could not load branches. Check your connection and try again.',
    retry:          isAr ? 'إعادة المحاولة'          : 'Retry',
    noBranches:     isAr ? 'لا توجد فروع متاحة للتسجيل حالياً. يرجى التواصل مع الإدارة.' : 'No branches are currently available for registration. Please contact your administrator.',
    forgot:         isAr ? 'نسيت كلمة المرور؟'      : 'Forgot password?',
    login:          isAr ? 'ابدأ اللعب'             : 'Sign In',
    signup:         isAr ? 'إنشاء حساب'             : 'Create Account',
    terms:          isAr ? 'بالمتابعة توافق على الشروط والسياسة' : 'By continuing you agree to our Terms & Privacy Policy',
    privateNote:    isAr ? 'منصة خاصة — التسجيل يتطلب رمز وصول صادر من الإدارة' : 'Private platform — registration requires an admin-issued access code',
  }

  const pwMismatch = !!(confirmPassword && password !== confirmPassword)

  // The single-character-username exception applies to exactly one email —
  // the owner account. This client-side check is purely a UX convenience
  // (real-time feedback before the request round-trips); the `register`
  // Edge Function re-validates authoritatively against the live
  // app_config.owner_email row, so a spoofed email here can never actually
  // get a short username past the backend.
  const isOwnerEmail = email.trim().toLowerCase() === OWNER_EMAIL.toLowerCase()
  const minUsernameLen = isOwnerEmail ? 1 : DEFAULT_MIN_USERNAME_LEN
  const usernameInvalid = !!username && (username.length < minUsernameLen || username.length > MAX_USERNAME_LEN)
  // Registration is impossible without a branch to assign — block it
  // outright (not just leave the submit button disabled by omission)
  // whenever branches are still loading, failed to load, or loaded to an
  // empty active list.
  const branchesUnavailable = branchesLoading || !!branchesError || branches.length === 0

  const handleSignIn = async () => {
    setErrorMsg(null)
    // Role is derived server-side (app_config.owner_email) — the client
    // never decides who's an owner.
    const { error } = await signIn(email, password)
    if (error) setErrorMsg(error)
  }

  const handleSignUp = async () => {
    setErrorMsg(null)
    if (pwMismatch || usernameInvalid || !branchId || branchesUnavailable) return
    // Access-code validation happens server-side in the `register` Edge
    // Function before any account is created — new accounts always land
    // as PLAYER; there is no client-side path to self-promote.
    const { error } = await signUp(email, password, username, accessCode, branchId)
    if (error) setErrorMsg(error)
  }

  const handleSendReset = async () => {
    setErrorMsg(null)
    const { error } = await sendPasswordReset(email)
    if (error) { setErrorMsg(error); return }
    setResetSent(true)
  }

  return (
    <div
      style={{
        minHeight: '100dvh',
        background: 'radial-gradient(ellipse 120% 80% at 20% 10%, rgba(124,58,237,0.22) 0%, transparent 60%), radial-gradient(ellipse 80% 60% at 80% 90%, rgba(0,212,255,0.14) 0%, transparent 55%), #03030f',
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        padding: '24px 24px 48px',
        paddingBottom: 'max(48px, calc(24px + env(safe-area-inset-bottom, 0px)))',
        paddingLeft: safeLeft(24), paddingRight: safeRight(24),
        position: 'relative', overflow: 'hidden',
        // This screen's backdrop is intentionally always dark (a fixed
        // "space" brand treatment), regardless of the app-wide light/dark
        // toggle — but every input/label/helper-text color below reads
        // from the shared --foreground/--fg-rgb/--fg2-rgb theme variables,
        // which DO flip in light mode (see :root[data-theme='light'] in
        // index.css, where --foreground becomes near-black for use on
        // light backgrounds elsewhere in the app). Left alone, toggling to
        // light mode made every label, input value, placeholder, and
        // dropdown option here render near-black text on this near-black
        // background — unreadable. Pinning the foreground variables to
        // their dark-mode values in this subtree, regardless of
        // data-theme, keeps this screen's text white/near-white in both
        // modes without touching the global theme or any other screen.
        ['--foreground' as string]: '#eeeeff',
        ['--foreground-muted' as string]: 'rgba(200,200,255,0.65)',
        ['--foreground-dim' as string]: 'rgba(180,180,230,0.45)',
        ['--fg-rgb' as string]: '255,255,255',
        ['--fg2-rgb' as string]: '200,200,255',
      } as CSSProperties}
    >
      {/* Star field */}
      <div className="bg-stars" style={{ position: 'absolute', inset: 0, opacity: 0.7, pointerEvents: 'none' }} />

      {/* Floating orbs */}
      <div style={{ position: 'absolute', top: -80, left: -60, width: 260, height: 260, background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -60, right: -40, width: 200, height: 200, background: 'radial-gradient(circle, rgba(0,212,255,0.12) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />

      {/* Lang toggle — first screen most users ever see, so a notch overlap
          here is maximally visible. Was a hardcoded `top: 20, right: 20`
          with no safe-area awareness, same bug class as ProfileScreen's
          Customize row. */}
      <div style={{ position: 'absolute', top: safeTop(20), right: safeRight(20) }}>
        <button
          onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
          style={{
            background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.35)', borderRadius: 10,
            padding: '7px 14px', cursor: 'pointer', fontSize: 13, fontWeight: 700, color: '#9d6fff',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            ...tapTargetMinHeight(30),
          }}
        >
          {lang === 'en' ? 'عربي' : 'EN'}
        </button>
      </div>

      {/* Logo + hero */}
      <div style={{ textAlign: 'center', marginBottom: 32 }} className="animate-slide-up">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <AppLogo size={52} wordmark animated />
        </div>

        <h1
          className={isAr ? 'font-cairo' : 'font-display'}
          style={{
            fontSize: isAr ? 30 : 38, fontWeight: 900, margin: '0 0 8px',
            background: 'linear-gradient(135deg, #eeeeff 0%, #9d6fff 60%, #00d4ff 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            lineHeight: 1.1,
          }}
        >
          {T.tagline}
        </h1>
        <p style={{ color: 'rgba(var(--fg2-rgb),0.5)', fontSize: 14, margin: '0 0 14px' }}>{T.sub}</p>

        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, background: 'rgba(0,230,118,0.07)', border: '1px solid rgba(0,230,118,0.18)', borderRadius: 99, padding: '5px 14px' }}>
          <div className="live-dot" />
          <span style={{ fontSize: 12, color: '#00e676', fontWeight: 600 }}>
            {isAr ? 'الخادم جاهز للعب' : 'Server live — Ready to play'}
          </span>
        </div>
      </div>

      {/* Auth card */}
      <div className="card animate-slide-up" style={{ width: '100%', maxWidth: 420, padding: '28px 24px', animationDelay: '0.1s', animationFillMode: 'both' }}>

        {/* Sign In / Sign Up tabs */}
        <div style={{ display: 'flex', gap: 4, background: 'rgba(var(--fg-rgb),0.04)', borderRadius: 12, padding: 4, marginBottom: 22 }}>
          {[{ key: false, en: 'Sign In', ar: 'دخول' }, { key: true, en: 'Sign Up', ar: 'تسجيل' }].map((tab) => (
            <button
              key={String(tab.key)}
              onClick={() => { setIsSignup(tab.key); setShowForgot(false) }}
              style={{
                flex: 1, padding: '10px', borderRadius: 9, border: 'none', cursor: 'pointer',
                fontSize: 14, fontWeight: 700, transition: 'all 0.2s ease',
                background: isSignup === tab.key ? 'linear-gradient(135deg, #7c3aed, #5b21b6)' : 'transparent',
                color: isSignup === tab.key ? 'white' : 'rgba(var(--fg2-rgb),0.4)',
                boxShadow: isSignup === tab.key ? '0 4px 14px rgba(124,58,237,0.35)' : 'none',
                fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif",
              }}
            >
              {isAr ? tab.ar : tab.en}
            </button>
          ))}
        </div>

        {/* ── Sign In ── */}
        {!isSignup && !showForgot && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{T.emailLbl}</label>
              <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{T.passLbl}</label>
                <button onClick={() => setShowForgot(true)} style={{ background: 'none', border: 'none', fontSize: 12, color: '#9d6fff', cursor: 'pointer', padding: 0 }}>
                  {T.forgot}
                </button>
              </div>
              <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {errorMsg && (
              <p style={{ margin: 0, fontSize: 12, color: '#ff4785', background: 'rgba(255,71,133,0.08)', border: '1px solid rgba(255,71,133,0.2)', borderRadius: 10, padding: '8px 12px' }}>
                {errorMsg}
              </p>
            )}
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 4, fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif", fontSize: 15 }}
              onClick={handleSignIn}
              disabled={loading || !email || !password}
            >
              {loading ? (isAr ? 'جارٍ الدخول...' : 'Signing in…') : T.login}
            </button>
          </div>
        )}

        {/* ── Forgot Password ── */}
        {!isSignup && showForgot && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {!resetSent ? (
              <>
                <div style={{ background: 'rgba(0,212,255,0.07)', border: '1px solid rgba(0,212,255,0.2)', borderRadius: 12, padding: '12px 14px' }}>
                  <p style={{ margin: 0, fontSize: 13, color: 'rgba(var(--fg2-rgb),0.7)', lineHeight: 1.5 }}>
                    {isAr ? "أدخل بريدك الإلكتروني وسنرسل لك رابط إعادة تعيين كلمة المرور." : "Enter your email and we'll send you a password reset link."}
                  </p>
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{T.emailLbl}</label>
                  <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {errorMsg && (
                  <p style={{ margin: 0, fontSize: 12, color: '#ff4785', background: 'rgba(255,71,133,0.08)', border: '1px solid rgba(255,71,133,0.2)', borderRadius: 10, padding: '8px 12px' }}>
                    {errorMsg}
                  </p>
                )}
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif" }}
                  onClick={handleSendReset}
                  disabled={!email}
                >
                  {isAr ? 'إرسال رابط الاسترداد' : 'Send Reset Link'}
                </button>
                <button onClick={() => setShowForgot(false)} style={{ background: 'none', border: 'none', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.45)', cursor: 'pointer', textAlign: 'center' }}>
                  {isAr ? '← العودة لتسجيل الدخول' : '← Back to Sign In'}
                </button>
              </>
            ) : (
              <>
                <div style={{ textAlign: 'center', padding: '20px 16px', background: 'rgba(0,230,118,0.07)', border: '1px solid rgba(0,230,118,0.18)', borderRadius: 14 }}>
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00e676" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 10 }}>
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
                  </svg>
                  <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#00e676' }}>
                    {isAr ? 'تم إرسال الرابط!' : 'Reset link sent!'}
                  </p>
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: 'rgba(var(--fg2-rgb),0.5)' }}>
                    {isAr ? 'تحقق من صندوق بريدك الإلكتروني' : 'Check your email inbox'}
                  </p>
                </div>
                <button onClick={() => { setShowForgot(false); setResetSent(false) }} style={{ background: 'none', border: 'none', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.45)', cursor: 'pointer', textAlign: 'center' }}>
                  {isAr ? '← العودة لتسجيل الدخول' : '← Back to Sign In'}
                </button>
              </>
            )}
          </div>
        )}

        {/* ── Sign Up ── */}
        {isSignup && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{T.emailLbl}</label>
              <input type="email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{T.usernameLbl}</label>
              <input
                type="text" placeholder={isAr ? 'اسم_المستخدم' : 'your_username'}
                value={username} onChange={(e) => setUsername(e.target.value)}
                style={{ borderColor: usernameInvalid ? 'rgba(255,71,133,0.5)' : undefined }}
              />
              {usernameInvalid && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ff4785' }}>
                  {isAr
                    ? `يجب أن يتكون اسم المستخدم من ${minUsernameLen === 1 ? 'حرف واحد' : `${minUsernameLen} أحرف`} إلى ${MAX_USERNAME_LEN} حرفًا`
                    : `Username must be ${minUsernameLen}-${MAX_USERNAME_LEN} characters`}
                </p>
              )}
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{T.passLbl}</label>
              <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{T.confirmPassLbl}</label>
              <input
                type="password" placeholder="••••••••"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ borderColor: pwMismatch ? 'rgba(255,71,133,0.5)' : undefined }}
              />
              {pwMismatch && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ff4785' }}>
                  {isAr ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match'}
                </p>
              )}
            </div>

            {/* Role notice — no privilege escalation possible */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'rgba(0,230,118,0.06)', border: '1px solid rgba(0,230,118,0.15)', borderRadius: 10 }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#00e676" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>
              <span style={{ fontSize: 11, color: 'rgba(0,230,118,0.8)', fontWeight: 600 }}>
                {isAr ? 'جميع الحسابات الجديدة بدور لاعب فقط.' : 'All new accounts are created as Player.'}
              </span>
            </div>

            {/* Branch — loaded dynamically from Supabase every time this
                screen mounts, never a hardcoded list. Three distinct
                states below: loading, failed (Retry), and successfully
                loaded (dropdown, or the zero-active-branches block). */}
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{T.deptLbl}</label>

              {branchesLoading && (
                <div style={{
                  width: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 8,
                  background: 'rgba(var(--fg-rgb),0.04)', border: '1px solid rgba(var(--fg-rgb),0.1)',
                  borderRadius: 10, padding: '11px 12px', fontSize: 13, color: 'rgba(var(--fg2-rgb),0.5)',
                }}>
                  <span className="live-dot" style={{ background: 'rgba(var(--fg2-rgb),0.4)' }} />
                  {T.branchesLoading}
                </div>
              )}

              {!branchesLoading && branchesError && (
                <div style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  background: 'rgba(255,71,133,0.08)', border: '1px solid rgba(255,71,133,0.25)',
                  borderRadius: 10, padding: '10px 12px',
                }}>
                  <span style={{ fontSize: 12, color: '#ff4785', lineHeight: 1.4 }}>{T.branchesError}</span>
                  <button
                    type="button"
                    onClick={loadBranches}
                    style={{
                      flexShrink: 0, background: 'rgba(255,71,133,0.15)', border: '1px solid rgba(255,71,133,0.35)',
                      borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 700, color: '#ff4785', cursor: 'pointer',
                    }}
                  >
                    {T.retry}
                  </button>
                </div>
              )}

              {!branchesLoading && !branchesError && branches.length === 0 && (
                <div style={{
                  background: 'rgba(255,215,0,0.08)', border: '1px solid rgba(255,215,0,0.25)',
                  borderRadius: 10, padding: '10px 12px', fontSize: 12, color: '#ffd700', lineHeight: 1.4,
                }}>
                  {T.noBranches}
                </div>
              )}

              {!branchesLoading && !branchesError && branches.length > 0 && (
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  style={{
                    width: '100%', fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif",
                    background: 'rgba(var(--fg-rgb),0.04)', border: '1px solid rgba(var(--fg-rgb),0.1)',
                    borderRadius: 10, padding: '11px 12px', fontSize: 14, color: branchId ? 'var(--foreground)' : 'rgba(var(--fg2-rgb),0.4)',
                  }}
                >
                  {/* Explicit background+color on <option> — the popup list
                      for a native <select> is rendered by the OS, not by
                      our CSS cascade, so without this some browsers (iOS/
                      Android included) fall back to system colors that can
                      end up low-contrast against our dark theme. Most
                      browsers that respect any option styling respect this. */}
                  <option value="" disabled style={{ background: '#0d0d28', color: 'rgba(200,200,255,0.6)' }}>{T.deptPlaceholder}</option>
                  {branches.map((b) => (
                    <option key={b.id} value={b.id} style={{ background: '#0d0d28', color: '#eeeeff' }}>{isAr ? b.name_ar : b.name_en}</option>
                  ))}
                </select>
              )}
            </div>

            {/* Access Code block */}
            <div style={{ padding: '14px', background: 'rgba(157,111,255,0.07)', border: '1px solid rgba(157,111,255,0.25)', borderRadius: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 11, color: '#9d6fff', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#9d6fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                  {T.accessCodeLbl}
                </label>
                <span style={{ fontSize: 10, color: 'rgba(var(--fg2-rgb),0.4)' }}>{T.accessCodeHint}</span>
              </div>
              <input
                type="text"
                placeholder="XXXX-XXXX-XXXX"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value.toUpperCase())}
                style={{ fontFamily: "'Exo 2', sans-serif", fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}
              />
              <p style={{ margin: '6px 0 0', fontSize: 11, color: 'rgba(var(--fg2-rgb),0.4)', lineHeight: 1.4 }}>
                {isAr
                  ? 'رمز الوصول مطلوب للتسجيل مرة واحدة فقط. بعد التسجيل يمكنك الدخول بالبريد وكلمة المرور فقط.'
                  : 'Required once to register. After sign-up you only need your email and password.'}
              </p>
            </div>

            {errorMsg && (
              <p style={{ margin: 0, fontSize: 12, color: '#ff4785', background: 'rgba(255,71,133,0.08)', border: '1px solid rgba(255,71,133,0.2)', borderRadius: 10, padding: '8px 12px' }}>
                {errorMsg}
              </p>
            )}

            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 2, fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif", fontSize: 15 }}
              onClick={handleSignUp}
              disabled={pwMismatch || usernameInvalid || !branchId || branchesUnavailable || loading || !email || !password || !username || !accessCode}
            >
              {loading ? (isAr ? 'جارٍ الإنشاء...' : 'Creating account…') : T.signup}
            </button>
          </div>
        )}
      </div>

      {/* Footer */}
      <div style={{ marginTop: 18, display: 'flex', alignItems: 'flex-start', gap: 8, maxWidth: 420, padding: '0 4px' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="rgba(var(--fg2-rgb),0.28)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: 1 }}>
          <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
        <p style={{ margin: 0, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.28)', lineHeight: 1.5 }}>{T.privateNote}</p>
      </div>
      <p style={{ marginTop: 8, fontSize: 11, color: 'rgba(var(--fg2-rgb),0.16)', textAlign: 'center' }}>{T.terms}</p>
      <p style={{ marginTop: 4, fontSize: 10, color: 'rgba(var(--fg2-rgb),0.14)', textAlign: 'center' }}>build {BUILD_STAMP}</p>
    </div>
  )
}
