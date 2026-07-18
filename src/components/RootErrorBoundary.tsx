import { Component, type ReactNode } from 'react'

/**
 * App-root error boundary. Unlike QuietErrorBoundary (which wraps small,
 * skippable pieces of UI and fails silently to null), this wraps the
 * *entire* <App/> tree in main.tsx — if it fires, the alternative is a
 * fully blank white/black screen with no way back in, which is explicitly
 * unacceptable for a packaged mobile app (there's no browser chrome, no
 * URL bar, no "back" to escape to; a blank screen just looks like the app
 * is broken or dead). So this renders a real, recoverable fallback screen
 * instead: a short explanation and a reload action.
 *
 * Deliberately has zero dependency on app state/context/i18n providers —
 * anything that could itself throw defeats the purpose of a last-resort
 * boundary. It reads only the `data-theme` attribute the inline bootstrap
 * script in index.html already sets on <html> before React ever mounts,
 * so light/dark still resolves correctly even here, and shows both
 * languages at once rather than guessing a preference it has no safe way
 * to read.
 */
export default class RootErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }) {
    // eslint-disable-next-line no-console
    console.error('[kastro:RootErrorBoundary] top-level render crash caught', error, info?.componentStack)
  }

  handleReload = () => {
    // A full reload rather than just resetting boundary state: the error
    // may have come from corrupted in-memory state (a bad realtime payload,
    // a partially-applied optimistic update, etc.) that simply clearing
    // `hasError` wouldn't fix, and could immediately re-throw.
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children

    return (
      <div
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 99999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 16,
          padding: '32px 24px',
          textAlign: 'center',
          background: 'var(--background, #03030f)',
          color: 'var(--foreground, #eeeeff)',
          fontFamily: "'Inter', -apple-system, sans-serif",
        }}
      >
        <div style={{ fontSize: 40 }}>⚠️</div>
        <div>
          <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>Something went wrong</p>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.65, maxWidth: 320 }}>
            KASTRO hit an unexpected error and couldn't continue. Your data is safe — reloading will fix this.
          </p>
        </div>
        <div style={{ borderTop: '1px solid rgba(255,255,255,0.1)', width: 40, margin: '4px 0' }} />
        <div dir="rtl">
          <p style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 700 }}>حدث خطأ ما</p>
          <p style={{ margin: 0, fontSize: 13, opacity: 0.65, maxWidth: 320 }}>
            واجه تطبيق KASTRO خطأً غير متوقع. بياناتك آمنة — إعادة التحميل ستحل المشكلة.
          </p>
        </div>
        <button
          onClick={this.handleReload}
          style={{
            marginTop: 12,
            padding: '12px 28px',
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(135deg, #7c3aed, #5b21b6)',
            color: '#fff',
            fontSize: 14,
            fontWeight: 700,
            cursor: 'pointer',
          }}
        >
          Reload · إعادة تحميل
        </button>
      </div>
    )
  }
}
