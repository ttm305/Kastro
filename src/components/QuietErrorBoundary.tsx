import { Component, type ReactNode } from 'react'

/**
 * Wraps a non-essential, "nice to have" piece of UI (realtime toast hosts,
 * celebratory overlays, badges — anything the app is fully usable without)
 * so a bug in it can never take down the rest of the app. React error
 * boundaries only catch errors thrown during rendering/lifecycle methods,
 * not inside async callbacks — the realtime subscription code this
 * currently wraps already defends against that itself (try/catch around
 * every callback), but this is the last line of defense for anything that
 * still slips through: render silently nothing instead of white-screening
 * the whole app.
 */
export default class QuietErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error: unknown) {
    // eslint-disable-next-line no-console
    console.error('[careerxp:QuietErrorBoundary] suppressed a render error to keep the app usable', error)
  }

  render() {
    if (this.state.hasError) return null
    return this.props.children
  }
}
