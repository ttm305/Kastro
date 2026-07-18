import { useState, useEffect, useRef } from 'react'
import LoginScreen from './screens/LoginScreen'
import ResetPasswordScreen from './screens/ResetPasswordScreen'
import HomeScreen from './screens/HomeScreen'
import GamesLibraryScreen from './screens/GamesLibraryScreen'
import WeeklyChallengeScreen from './screens/WeeklyChallengeScreen'
import LeaderboardScreen from './screens/LeaderboardScreen'
import AchievementsScreen from './screens/AchievementsScreen'
import ProfileScreen from './screens/ProfileScreen'
import FriendsScreen from './screens/FriendsScreen'
import RewardsScreen from './screens/RewardsScreen'
import AdminDashboardScreen from './screens/AdminDashboardScreen'
import GameLobbyScreen from './screens/GameLobbyScreen'
import WorkGameScreen from './screens/WorkGameScreen'
import CasualGameScreen from './screens/CasualGameScreen'
import SeasonPassScreen from './screens/SeasonPassScreen'
import TournamentScreen from './screens/TournamentScreen'
import EmojiDecodeScreen from './screens/EmojiDecodeScreen'
import ColorBlitzScreen from './screens/ColorBlitzScreen'
import LudoScreen from './screens/LudoScreen'
import LudoPacingSlice from './screens/LudoPacingSlice'
import BottomNav from './components/BottomNav'
import SplashScreen from './components/SplashScreen'
import AchievementOverlayHost from './components/AchievementOverlayHost'
import ChatToastHost from './components/ChatToastHost'
import QuietErrorBoundary from './components/QuietErrorBoundary'
import { AuthProvider, useAuth } from './lib/auth'
import { getMyConversations, subscribeToMyConversations } from './lib/api'
import { isNativePlatform, listenForNotificationTaps } from './lib/nativePush'
import { startPresenceHeartbeat } from './lib/presenceHeartbeat'

export type Screen =
  | 'login'
  | 'home'
  | 'games'
  | 'weekly'
  | 'leaderboard'
  | 'achievements'
  | 'profile'
  | 'friends'
  | 'rewards'
  | 'admin'
  | 'lobby'
  | 'workgame'
  | 'casualgame'
  | 'seasonpass'
  | 'tournament'
  | 'emojidecode'
  | 'colorblitz'
  | 'ludo'
  | 'ludopacing'

export type Lang = 'en' | 'ar'
export type UserRole = 'owner' | 'player'

/**
 * Kept for reference/display only — the real owner check happens
 * server-side (app_config.owner_email + the on_auth_user_created
 * trigger + RLS policies + every admin_* RPC calling
 * private.require_owner()). Nothing in the client trusts this constant
 * for access control anymore.
 */
export const OWNER_EMAIL = 'muraikhi13@gmail.com'

// Weekly Challenge is no longer a bottom-nav slot — it stays reachable from
// Home and the Profile hub instead, freeing the center slot for Friends.
const NAV_SCREENS: Screen[] = ['home', 'games', 'friends', 'leaderboard', 'profile']

function AppShell() {
  const { session, profile, ready, isPasswordRecovery, signOut } = useAuth()
  const [screen, setScreen] = useState<Screen>('login')
  const [lang, setLang] = useState<Lang>('en')
  const [gameLaunchId, setGameLaunchId] = useState<string | null>(null)
  const [gameLaunchContext, setGameLaunchContext] = useState<{ type: 'practice' | 'challenge' | 'tournament'; refId?: string } | null>(null)
  const [unreadChatCount, setUnreadChatCount] = useState(0)
  const [pendingChatOpen, setPendingChatOpen] = useState<{ conversationId: string; otherUser: { id: string; username: string; avatar_url?: string | null } } | null>(null)

  // Realtime-driven Friends-tab unread badge: refreshes the instant any of
  // my conversations/participant rows change (new message, read, cleanup),
  // via the same subscription the Chats list itself uses. A slower interval
  // poll stays underneath as a safety net for a dropped realtime event —
  // it's no longer the primary update path.
  useEffect(() => {
    if (!session || !profile) { setUnreadChatCount(0); return }
    let cancelled = false
    const refresh = async () => {
      const convos = await getMyConversations()
      if (!cancelled) setUnreadChatCount(convos.reduce((sum, c) => sum + (c.unread_count || 0), 0))
    }
    refresh()
    // Unique tag ('nav-badge') — see subscribeToMyConversations' doc
    // comment: FriendsScreen subscribes to the same userId for the Chats
    // tab, and a colliding topic between the two throws and can crash the
    // app.
    const unsub = subscribeToMyConversations(profile.id, refresh, 'nav-badge')
    const id = window.setInterval(refresh, 30000)
    return () => { cancelled = true; unsub(); window.clearInterval(id) }
  }, [session, profile])

  // Live presence heartbeat — see src/lib/presenceHeartbeat.ts for the full
  // lifecycle (visibilitychange/pagehide/beforeunload/online/offline). This
  // is the actual fix for accounts staying "Online" after closing the app:
  // touch_presence()/mark_offline() existed as RPCs but had no caller
  // anywhere in the app before this. Scoped to a real session only — starts
  // the moment a session exists, tears down completely on sign-out so a
  // logged-out tab never keeps heartbeating.
  useEffect(() => {
    if (!session) return
    return startPresenceHeartbeat()
  }, [session?.user.id])

  // Shared by every push-notification delivery path (Web Push service
  // worker message, Web Push URL param, and native FCM tap below) — all
  // three converge on the same "open this chat" navigation regardless of
  // which mechanism actually delivered the tap.
  function openFromChatTarget(conversationId: string, fromUserId: string, fromUsername: string) {
    if (!conversationId || !fromUserId) return
    setPendingChatOpen({ conversationId, otherUser: { id: fromUserId, username: fromUsername || 'user' } })
    safeNavigate('friends')
  }

  // Push-notification tap deep-linking (Web Push / browser+PWA path). The
  // service worker (public/sw.js) handles this two ways depending on
  // whether a tab was already open:
  //  - already open: it postMessages this exact page directly (listened for
  //    below), no navigation/reload involved.
  //  - closed/backgrounded with no existing tab: it opens a fresh window
  //    with ?open_chat=... in the URL, consumed once on mount below.
  useEffect(() => {
    // Register the push service worker as early as possible, independent
    // of whether the user has ever opened Profile > Notifications. This
    // does NOT request Notification permission or create a push
    // subscription (that stays a deliberate user action — see
    // enablePush() in src/lib/push.ts, triggered only by the toggle) —
    // it just makes sure the worker itself is installed and active, so a
    // push arriving after the user later enables notifications doesn't
    // depend on them having revisited a specific screen first. No-ops
    // outside a browser/PWA context (native builds use FCM directly, no
    // service worker involved) or where the Push API isn't available at
    // all (e.g. an ordinary — not Home-Screen-installed — iOS Safari tab).
    if (!isNativePlatform() && 'serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('[sw] registration failed', err)
      })
    }

    const params = new URLSearchParams(window.location.search)
    const openChatId = params.get('open_chat')
    if (openChatId) {
      openFromChatTarget(openChatId, params.get('from_user') ?? '', params.get('from_username') ?? '')
      // Clean the URL so refreshing/sharing it doesn't re-trigger the deep link.
      window.history.replaceState({}, '', window.location.pathname)
    }

    function handleSwMessage(event: MessageEvent) {
      if (event.data?.type === 'kastro-open-chat') {
        openFromChatTarget(event.data.conversationId, event.data.fromUserId, event.data.fromUsername)
      }
    }
    navigator.serviceWorker?.addEventListener('message', handleSwMessage)
    return () => navigator.serviceWorker?.removeEventListener('message', handleSwMessage)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Push-notification tap deep-linking (native/Capacitor path) — the
  // equivalent of the service-worker handling above, for a packaged
  // iOS/Android build where there is no service worker involved at all.
  // No-ops entirely outside a native build (see listenForNotificationTaps).
  useEffect(() => {
    return listenForNotificationTaps(openFromChatTarget)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Android hardware/gesture back button. Capacitor's 'backButton' event
  // firing at all suppresses the OS's own default behavior (which would
  // otherwise just exit the app the instant there's no WebView history to
  // pop — irrelevant here anyway, since this app is a client-side screen
  // state machine, not a real router with pushState history), so once
  // subscribed this listener is fully responsible for deciding what "back"
  // means: drill back out of a sub-screen the same way its own on-screen
  // back button would, land on Home from any other bottom-nav tab (the
  // standard Android top-level-tabs convention — back from Ranks doesn't
  // mean "whatever tab I was on two screens ago"), and only actually exit
  // the app from Home/Login, so a stray back-press deep in a flow can
  // never accidentally kill the app.
  useEffect(() => {
    if (!isNativePlatform()) return
    let handle: { remove: () => void } | null = null
    let cancelled = false
    import('@capacitor/app').then(({ App: CapApp }) => {
      if (cancelled) return
      CapApp.addListener('backButton', () => {
        if (screen === 'login' || screen === 'home') {
          CapApp.exitApp()
        } else if (NAV_SCREENS.includes(screen)) {
          safeNavigate('home')
        } else {
          navigateBack('home')
        }
      }).then((h) => {
        if (cancelled) h.remove()
        else handle = h
      })
    })
    return () => { cancelled = true; handle?.remove() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [screen])

  const userRole: UserRole = profile?.role === 'owner' ? 'owner' : 'player'
  const userEmail = session?.user.email ?? ''

  const isRTL = lang === 'ar'
  const showNav = NAV_SCREENS.includes(screen)

  // Tracks the screen we're navigating away from, so a screen with no
  // real browser-history entry to pop (this app is a client-side state
  // machine, not a router — the browser back button doesn't correspond to
  // in-app screen changes) can still offer a working "back" button that
  // returns to wherever the user actually came from.
  const previousScreenRef = useRef<Screen>('home')

  // Navigate to home once a session + profile are ready; back to login on sign-out.
  // A recovery session is deliberately excluded here — isPasswordRecovery
  // takes over rendering below until the user sets a new password.
  useEffect(() => {
    if (!ready || isPasswordRecovery) return
    if (session && profile) {
      setScreen((s) => (s === 'login' ? 'home' : s))
    } else if (!session) {
      setScreen('login')
    }
  }, [ready, session, profile, isPasswordRecovery])

  /** Client-side route guard — backend enforces this independently via RLS + require_owner(). */
  const safeNavigate = (s: Screen) => {
    if (s === 'admin' && userRole !== 'owner') return
    setScreen((current) => {
      if (current !== s) previousScreenRef.current = current
      return s
    })
  }

  /**
   * Back-navigation for screens with no bottom-nav tab of their own (e.g.
   * Weekly Challenge) — returns to whichever screen the user actually came
   * from. Falls back to Home if there's no meaningful previous screen
   * (direct load, or the previous screen was the same screen).
   */
  const navigateBack = (fallback: Screen = 'home') => {
    const prev = previousScreenRef.current
    safeNavigate(prev && prev !== screen ? prev : fallback)
  }

  /**
   * Screens that launch a specific game pass its id through here before
   * navigating. `context` lets a challenge/tournament screen launch
   * gameplay that actually scores against it (context_ref_id), instead of
   * every launch silently being 'practice' regardless of where it was
   * started from.
   */
  const navigateToGame = (
    s: Screen,
    gameId?: string,
    context?: { type: 'practice' | 'challenge' | 'tournament'; refId?: string }
  ) => {
    if (gameId) setGameLaunchId(gameId)
    setGameLaunchContext(context ?? null)
    safeNavigate(s)
  }

  if (!ready) {
    return <SplashScreen />
  }

  // A recovery-link session takes over the entire app shell — checked before
  // any normal screen renders, so there is no path from "clicked the email
  // link" to "logged into Home" without setting a new password first.
  if (isPasswordRecovery) {
    return (
      <div dir={isRTL ? 'rtl' : 'ltr'} className={`app-shell${isRTL ? ' font-cairo' : ''}`} style={{ minHeight: '100dvh', background: 'var(--background)' }}>
        <ResetPasswordScreen lang={lang} setLang={setLang} />
      </div>
    )
  }

  return (
    <div
      dir={isRTL ? 'rtl' : 'ltr'}
      className={`app-shell${isRTL ? ' font-cairo' : ''}`}
      style={{ minHeight: '100dvh', background: 'var(--background)', position: 'relative' }}
    >
      {screen === 'login'       && <LoginScreen onNavigate={setScreen} lang={lang} setLang={setLang} />}
      {screen === 'home'        && <HomeScreen onNavigate={safeNavigate} onNavigateToGame={navigateToGame} lang={lang} setLang={setLang} />}
      {screen === 'games'       && <GamesLibraryScreen onNavigate={safeNavigate} onNavigateToGame={navigateToGame} lang={lang} setLang={setLang} />}
      {screen === 'weekly'      && <WeeklyChallengeScreen onNavigate={safeNavigate} onNavigateToGame={navigateToGame} onBack={() => navigateBack('home')} lang={lang} setLang={setLang} />}
      {screen === 'leaderboard' && <LeaderboardScreen onNavigate={safeNavigate} lang={lang} setLang={setLang} />}
      {screen === 'achievements'&& <AchievementsScreen onNavigate={safeNavigate} lang={lang} setLang={setLang} />}
      {screen === 'profile'     && <ProfileScreen onNavigate={safeNavigate} lang={lang} setLang={setLang} userRole={userRole} onSignOut={signOut} />}
      {screen === 'friends'     && (
        <FriendsScreen
          onNavigate={safeNavigate}
          lang={lang}
          setLang={setLang}
          pendingOpenChat={pendingChatOpen}
          onPendingOpenChatConsumed={() => setPendingChatOpen(null)}
        />
      )}
      {screen === 'rewards'     && <RewardsScreen onNavigate={safeNavigate} lang={lang} setLang={setLang} />}
      {screen === 'admin'       && userRole === 'owner'
        ? <AdminDashboardScreen onNavigate={safeNavigate} lang={lang} setLang={setLang} userEmail={userEmail} />
        : screen === 'admin' && (
          <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 32, textAlign: 'center', background: 'var(--background)' }}>
            <div style={{ fontFamily: "'Exo 2', sans-serif", fontSize: 56, fontWeight: 900, color: '#ff4785', lineHeight: 1 }}>403</div>
            <p style={{ color: 'rgba(var(--fg2-rgb),0.45)', marginTop: 8, fontSize: 14 }}>Access forbidden</p>
            <button className="btn btn-ghost btn-sm" style={{ marginTop: 24 }} onClick={() => setScreen('profile')}>← Go back</button>
          </div>
        )
      }
      {screen === 'lobby'       && <GameLobbyScreen onNavigate={safeNavigate} lang={lang} setLang={setLang} gameId={gameLaunchId} />}
      {screen === 'workgame'    && <WorkGameScreen onNavigate={safeNavigate} lang={lang} gameId={gameLaunchId} context={gameLaunchContext} />}
      {screen === 'casualgame'  && <CasualGameScreen onNavigate={safeNavigate} lang={lang} gameId={gameLaunchId} context={gameLaunchContext} />}
      {screen === 'seasonpass'  && <SeasonPassScreen onNavigate={safeNavigate} lang={lang} setLang={setLang} />}
      {screen === 'tournament'  && <TournamentScreen onNavigate={safeNavigate} lang={lang} setLang={setLang} />}
      {screen === 'emojidecode' && <EmojiDecodeScreen onNavigate={safeNavigate} lang={lang} gameId={gameLaunchId} />}
      {screen === 'colorblitz' && <ColorBlitzScreen onNavigate={safeNavigate} lang={lang} gameId={gameLaunchId} />}
      {screen === 'ludo'       && <LudoScreen onNavigate={safeNavigate} lang={lang} />}
      {screen === 'ludopacing' && <LudoPacingSlice onNavigate={safeNavigate} lang={lang} />}

      {showNav && <BottomNav current={screen} onNavigate={safeNavigate} lang={lang} unreadChatCount={unreadChatCount} />}
      {/* Diagnostics moved out of the global app shell — it used to render a
          floating 🐞 button on every screen for owner accounts, which is not
          acceptable production UI even though it never showed for players.
          It now lives exclusively inside Admin Dashboard → Diagnostics (the
          DiagnosticsTab function in AdminDashboardScreen.tsx), hidden behind
          that owner-only route and off by default. The old floating-overlay
          component (src/components/DiagnosticsPanel.tsx) is no longer
          imported or rendered anywhere and can be deleted; it's left in
          place only because this delivery's file tools can't delete files
          from the mounted output folder. */}
      {/* Both hosts are non-essential realtime UI (celebratory overlays,
          the message toast) — wrapped individually in QuietErrorBoundary
          so a bug in either can never blank the entire app; the rest of
          the shell (nav, screens) keeps working regardless. */}
      {session && profile && (
        <QuietErrorBoundary>
          <AchievementOverlayHost lang={lang} />
        </QuietErrorBoundary>
      )}
      {session && profile && (
        <QuietErrorBoundary>
          <ChatToastHost
            lang={lang}
            onOpenChat={(conversationId, otherUser) => {
              setPendingChatOpen({ conversationId, otherUser })
              safeNavigate('friends')
            }}
          />
        </QuietErrorBoundary>
      )}
    </div>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  )
}
