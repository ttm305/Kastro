import { useState } from 'react'
import type { Lang } from '../App'
import KastroLogo from '../components/KastroLogo'
import { useAuth } from '../lib/auth'
import { safeTop, safeLeft, safeRight, tapTargetMinHeight } from '../lib/safeArea'

interface Props {
  lang: Lang
  setLang: (l: Lang) => void
}

/**
 * Rendered instead of the normal screen tree whenever a Supabase
 * PASSWORD_RECOVERY session is active (see App.tsx / auth.tsx). The user
 * lands here straight from the email link and must set a new password
 * before the recovery session is allowed to proceed into the app.
 */
export default function ResetPasswordScreen({ lang, setLang }: Props) {
  const { updatePassword, completePasswordRecovery, loading } = useAuth()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const isAr = lang === 'ar'

  const mismatch = !!(confirmPassword && password !== confirmPassword)
  const tooShort = password.length > 0 && password.length < 8

  const handleSubmit = async () => {
    setErrorMsg(null)
    if (mismatch || tooShort || !password) return
    const { error } = await updatePassword(password)
    if (error) { setErrorMsg(error); return }
    setDone(true)
    // Show the confirmation briefly before releasing the recovery session
    // into the normal app flow (App.tsx routes off isPasswordRecovery).
    setTimeout(() => completePasswordRecovery(), 1500)
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
      }}
    >
      <div className="bg-stars" style={{ position: 'absolute', inset: 0, opacity: 0.7, pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', top: -80, left: -60, width: 260, height: 260, background: 'radial-gradient(circle, rgba(124,58,237,0.18) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />
      <div style={{ position: 'absolute', bottom: -60, right: -40, width: 200, height: 200, background: 'radial-gradient(circle, rgba(0,212,255,0.12) 0%, transparent 70%)', borderRadius: '50%', pointerEvents: 'none' }} />

      {/* Same fix as LoginScreen's lang toggle — hardcoded top/right with no
          safe-area handling. */}
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

      <div style={{ textAlign: 'center', marginBottom: 32 }} className="animate-slide-up">
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 20 }}>
          <KastroLogo size={52} wordmark animated />
        </div>
        <h1
          className={isAr ? 'font-cairo' : 'font-display'}
          style={{
            fontSize: isAr ? 26 : 32, fontWeight: 900, margin: '0 0 8px',
            background: 'linear-gradient(135deg, #eeeeff 0%, #9d6fff 60%, #00d4ff 100%)',
            WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text',
            lineHeight: 1.1,
          }}
        >
          {isAr ? 'تعيين كلمة مرور جديدة' : 'Set a New Password'}
        </h1>
        <p style={{ color: 'rgba(var(--fg2-rgb),0.5)', fontSize: 14, margin: 0 }}>
          {isAr ? 'أدخل كلمة مرور جديدة لحسابك' : 'Choose a new password for your account'}
        </p>
      </div>

      <div className="card animate-slide-up" style={{ width: '100%', maxWidth: 420, padding: '28px 24px', animationDelay: '0.1s', animationFillMode: 'both' }}>
        {!done ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {isAr ? 'كلمة المرور الجديدة' : 'New Password'}
              </label>
              <input type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              {tooShort && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ff4785' }}>
                  {isAr ? 'يجب أن تتكون كلمة المرور من ٨ أحرف على الأقل' : 'Password must be at least 8 characters'}
                </p>
              )}
            </div>
            <div>
              <label style={{ fontSize: 11, color: 'rgba(var(--fg2-rgb),0.5)', marginBottom: 6, display: 'block', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {isAr ? 'تأكيد كلمة المرور' : 'Confirm Password'}
              </label>
              <input
                type="password" placeholder="••••••••"
                value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                style={{ borderColor: mismatch ? 'rgba(255,71,133,0.5)' : undefined }}
              />
              {mismatch && (
                <p style={{ margin: '4px 0 0', fontSize: 11, color: '#ff4785' }}>
                  {isAr ? 'كلمتا المرور غير متطابقتين' : 'Passwords do not match'}
                </p>
              )}
            </div>
            {errorMsg && (
              <p style={{ margin: 0, fontSize: 12, color: '#ff4785', background: 'rgba(255,71,133,0.08)', border: '1px solid rgba(255,71,133,0.2)', borderRadius: 10, padding: '8px 12px' }}>
                {errorMsg}
              </p>
            )}
            <button
              className="btn btn-primary"
              style={{ width: '100%', marginTop: 4, fontFamily: isAr ? "'Cairo', sans-serif" : "'Exo 2', sans-serif", fontSize: 15 }}
              onClick={handleSubmit}
              disabled={loading || mismatch || tooShort || !password || !confirmPassword}
            >
              {loading ? (isAr ? 'جارٍ الحفظ...' : 'Saving…') : (isAr ? 'حفظ كلمة المرور' : 'Save Password')}
            </button>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '20px 16px', background: 'rgba(0,230,118,0.07)', border: '1px solid rgba(0,230,118,0.18)', borderRadius: 14 }}>
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#00e676" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: 10 }}>
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><polyline points="22,6 12,13 2,6"/>
            </svg>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#00e676' }}>
              {isAr ? 'تم تحديث كلمة المرور!' : 'Password updated!'}
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'rgba(var(--fg2-rgb),0.5)' }}>
              {isAr ? 'جارٍ نقلك إلى حسابك...' : 'Taking you to your account…'}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
