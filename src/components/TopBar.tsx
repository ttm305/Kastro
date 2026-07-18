import type { Lang } from '../App'
import KastroLogo from './KastroLogo'
import NotificationsBell from './NotificationsBell'

interface Props {
  title: string
  titleAr?: string
  lang: Lang
  setLang: (l: Lang) => void
  onBack?: () => void
  rightSlot?: React.ReactNode
}

/** Direction-aware chevron — points left in LTR, right in RTL, so it always reads as "back" regardless of language. */
function BackIcon({ isRTL }: { isRTL: boolean }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={{ transform: isRTL ? 'scaleX(-1)' : undefined }}>
      <polyline points="15 18 9 12 15 6" />
    </svg>
  )
}

export default function TopBar({ title, titleAr, lang, setLang, onBack, rightSlot }: Props) {
  return (
    <div
      className="glass"
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 50,
        // Base padding stays 14px on all sides for the normal browser case;
        // on a notched/Dynamic-Island device (or any Capacitor build, which
        // renders truly edge-to-edge with no OS chrome of its own) the top
        // inset can exceed that, so take whichever is larger rather than
        // stacking them. Requires viewport-fit=cover in index.html (already
        // set) for env(safe-area-inset-*) to resolve to a nonzero value —
        // it's 0px on non-notched devices/browsers, so this is a no-op
        // there.
        padding: '14px 20px',
        paddingTop: 'max(14px, env(safe-area-inset-top))',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        {onBack && (
          <button
            onClick={onBack}
            style={{
              background: 'rgba(var(--fg-rgb),0.08)',
              border: '1px solid rgba(var(--fg-rgb),0.1)',
              borderRadius: 10,
              width: 36,
              height: 36,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--foreground)',
            }}
            aria-label={lang === 'ar' ? 'رجوع' : 'Back'}
          >
            <BackIcon isRTL={lang === 'ar'} />
          </button>
        )}
        {title === 'KASTRO' ? (
          <KastroLogo size={32} wordmark />
        ) : (
          <h1
            className={lang === 'ar' ? 'font-cairo' : 'font-display'}
            style={{ margin: 0, fontSize: 19, fontWeight: 700, color: 'var(--foreground)', letterSpacing: lang === 'en' ? '0.03em' : 0 }}
          >
            {lang === 'ar' && titleAr ? titleAr : title}
          </h1>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {rightSlot}
        <NotificationsBell lang={lang} />
        <button
          onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
          style={{
            background: 'rgba(124,58,237,0.2)',
            border: '1px solid rgba(124,58,237,0.3)',
            borderRadius: 10,
            padding: '6px 12px',
            cursor: 'pointer',
            fontSize: 12,
            fontWeight: 700,
            color: '#a78bfa',
            letterSpacing: '0.05em',
          }}
        >
          {lang === 'en' ? 'عربي' : 'EN'}
        </button>
      </div>
    </div>
  )
}
