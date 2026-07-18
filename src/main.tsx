import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ThemeProvider } from './lib/theme'
import RootErrorBoundary from './components/RootErrorBoundary'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* Last line of defense for the whole app — see RootErrorBoundary for
        why a packaged mobile app in particular must never fall back to a
        blank screen. QuietErrorBoundary (used deeper in the tree around
        individual non-essential widgets) intentionally fails silently;
        this one is the opposite: it's the only thing standing between a
        render crash anywhere in <App/> and a dead white screen with no
        way back in. */}
    <RootErrorBoundary>
      <ThemeProvider>
        <App />
      </ThemeProvider>
    </RootErrorBoundary>
  </React.StrictMode>,
)
