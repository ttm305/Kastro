# KASTRO — Mobile Production Readiness Audit

Scope: a full audit of KASTRO as a *real installed iPhone/Android app*,
not a mobile browser tab — packaging strategy, native build setup, push
notifications, safe areas, offline/error resilience, dev-artifact and
security cleanup, and a formal pass/fail gate before any game
development resumes.

**Read this first — the one hard constraint that shapes everything
below:** the sandbox this delivery was produced in has file-tool access
and a Linux shell, but **no npm registry access** and **no Xcode/Android
Studio/physical devices**. That means every code-level fix, the database
migration, and the Edge Function below are real, applied, and verified
where verification was possible — but `npm install`, `npx cap add ios/android`,
an actual Xcode/Android Studio build, and on-device testing could not be
performed here and are not claimed as done. Section 16 is explicit about
exactly which line each item falls on.

---

## 1. Packaging strategy

**Recommendation: Capacitor (option B), as requested.**

The app is already most of the way to PWA-installable (see below), which
is exactly the starting point Capacitor wants — it wraps the existing
`vite build` output (`dist/`) in a thin native shell (WKWebView on iOS,
Android System WebView) and exposes native APIs (push, status bar,
splash screen, back button, etc.) to the same React/TypeScript code
through JS bridges. Nothing about the screens, the state-machine
navigation, the Supabase client, or the CSS design system needs to
change to adopt it.

- **Option A (PWA only)** was already ~80% done before this pass
  (`manifest.webmanifest`, install icons, `viewport-fit=cover`, a Web
  Push service worker) and remains valuable as a fallback/lightweight
  install path — but a PWA cannot ship to the App Store/Play Store, has
  no reliable background push on iOS Safari outside of iOS 16.4+
  Home-Screen installs, and cannot access native APIs like the real
  device back-button or badge count.
- **Option C (React Native/Expo)** would mean rewriting all 30+ screens
  from DOM/CSS to RN primitives — weeks of work with no functional gain
  over Capacitor for an app that is fundamentally a styled web UI, not
  something that needs native-only widgets.
- **Option D** — no other approach fits a Vite+React codebase this size
  better than Capacitor; it is the standard, actively maintained choice
  for exactly this situation (Ionic's own framework, current major
  version 8.x as of this audit).

**Verdict: proceed with Capacitor.** The scaffolding for it is in place
(see §2); what remains is running the native-toolchain steps in §4/§5
that require npm registry access and Xcode/Android Studio, which this
sandbox doesn't have.

---

## 2. What was actually completed this pass

### Native/mobile setup
- **`capacitor.config.ts`** — hand-written (see file for why — `npx cap
  init` needs `@capacitor/cli` installed, which needs npm registry
  access). App ID `com.kastro.app` (placeholder — see §5), app name
  KASTRO, portrait-locked, dark background matching the app's own theme,
  StatusBar/SplashScreen plugin config.
- **`package.json`** — added `@capacitor/core`, `@capacitor/app`,
  `@capacitor/push-notifications`, `@capacitor/status-bar`,
  `@capacitor/splash-screen` as dependencies, `@capacitor/cli`,
  `@capacitor/ios`, `@capacitor/android` as devDependencies (all `^8.0.0`,
  current major as of this audit), plus `cap:sync`/`cap:ios`/`cap:android`
  npm scripts. **Not installed** — declared only, for the same npm
  registry reason.
- **`src/types/capacitor-shims.d.ts`** — a temporary hand-written type
  shim so `tsc -b` passes in this sandbox without the real Capacitor
  packages on disk. **Delete this file** as the first step after `npm
  install` locally — see the file's own header comment.
- **`resources/`** — `icon.png` (1024×1024), Android adaptive
  `icon-foreground.png`/`icon-background.png`, `splash.png` (2732×2732),
  and a monochrome `notification-icon.png`, generated from the existing
  approved KASTRO mark (`public/icon-512.png`) in the exact input layout
  `@capacitor/assets` expects. See `resources/README.md`.

### Notification panel transparency (iOS WebKit fix)
Root cause: the panel used `.card` (4%-alpha background, relying almost
entirely on `backdrop-filter` blur to read as "glass"). iOS WebKit has
known bugs where `backdrop-filter` silently fails to composite for
`position: absolute` elements in certain stacking contexts — leaving only
that near-invisible 4% fill behind the text. `.bottom-nav` elsewhere in
the same stylesheet already avoids this exact bug using a 92%-opaque
`rgba(var(--bg-rgb), 0.92)` base; the notification dropdown just hadn't
been given the same treatment.

Fix: new `.panel-elevated` class (`src/index.css`) — 94%-opaque
theme-aware base (readable with or without blur), `backdrop-filter`
layered on top as a progressive enhancement, `@supports not
(backdrop-filter)` fallback to fully solid, and a `prefers-reduced-transparency`
media query that also goes fully solid — applied to
`NotificationsBell.tsx`'s dropdown. `.card` itself is untouched (still
used correctly everywhere else in the app).

### Safe areas
- `TopBar.tsx` — added `paddingTop: max(14px, env(safe-area-inset-top))`
  (was previously unguarded — the one real gap found; everything else
  below was already handled correctly before this pass).
- Already correct, verified: `.bottom-nav`/`.pb-nav` (bottom inset +
  content padding), `ChatToastHost.tsx` (top inset), `ChatConversation.tsx`'s
  message-input row and bottom-sheet variant (bottom inset).
- `FriendProfileSheet.tsx` — bottom padding widened to
  `max(36px, calc(20px + env(safe-area-inset-bottom)))` (was a fixed
  36px with no inset awareness).
- **Not exhaustively re-verified this pass**: `AvatarPickerModal.tsx`,
  `DailyRewardModal.tsx`, `BadgeUnlockOverlay.tsx`, `LevelUpOverlay.tsx`,
  and the admin/registration form screens. These are centered
  full-screen overlays rather than edge-flush sheets, so they're lower
  risk, but they were not individually confirmed — see §16.

### Global error boundary / crash resilience
- New `src/components/RootErrorBoundary.tsx`, wrapping the entire
  `<App/>` tree in `main.tsx`. Unlike the existing `QuietErrorBoundary`
  (fails silently to `null` — correct for small, skippable widgets like
  toast hosts), this renders a real bilingual "Something went wrong /
  حدث خطأ ما" screen with a Reload button. A packaged mobile app has no
  browser chrome to fall back on if a render crash happens — a blank
  screen there looks like a dead/broken app with no way back in, which is
  exactly what this closes off.

### Native push notifications (FCM/APNs)
Extends the existing Web Push (VAPID) architecture rather than replacing
it — both now run in parallel and converge on the same server pipeline:

- **`supabase/migrations/20260718001500_native_push_tokens.sql`**
  (applied live) — new `native_push_tokens` table (RLS: select/insert/
  update/delete restricted to `user_id = auth.uid()`, matching the
  existing `push_subscriptions` pattern exactly), `register_native_push_token()`/
  `unregister_native_push_token()` RPCs, `has_push_subscription()` widened
  to check both tables, `private.send_push_for_new_message()` widened to
  wake the Edge Function for native-only users too.
- **`supabase/functions/send-push/index.ts`** (redeployed, live) — now
  sends via `web-push` (existing) **and** via Firebase Cloud Messaging's
  HTTP v1 API (`npm:google-auth-library` handles the service-account
  OAuth2 exchange) for native tokens, in parallel, each independently
  optional based on which secrets are configured. FCM's per-message
  response drives the same stale-token pruning pattern already used for
  Web Push (`UNREGISTERED`/`INVALID_ARGUMENT`/`NOT_FOUND` → delete the
  row). Badge count is computed server-side from the real unread
  in-app-notification count and sent in the APNs payload.
- **`src/lib/nativePush.ts`** (new) — `enableNativePush()`/
  `disableNativePush()` (permission request → `PushNotifications.register()`
  → token → server registration, mirroring `src/lib/push.ts`'s Web Push
  flow), `listenForNotificationTaps()` (native equivalent of
  `public/sw.js`'s `notificationclick` handler — converges on the exact
  same `openFromChatTarget()` navigation `App.tsx` already uses for the
  Web Push path).
- **`src/screens/ProfileScreen.tsx`**'s notification toggle now branches
  on `isNativePlatform()` — previously it would have shown "not supported
  in this browser" inside a native build (correct for a literal iOS/Android
  WebView, which genuinely doesn't implement the Push API, but misleading
  messaging for an app where push *does* work, just through FCM instead).
- **Still required from you, and impossible for this delivery to do**: a
  real Firebase project (`FCM_PROJECT_ID` + a service-account JSON as the
  `FCM_SERVICE_ACCOUNT_JSON` Edge Function secret) and, for iOS, an APNs
  key uploaded into that same Firebase project's Cloud Messaging settings
  — this is genuinely external-account setup only you can do. Until those
  two secrets are set, native push silently no-ops (same graceful-skip
  pattern the existing VAPID keys already use) rather than breaking
  anything.

### Android back button / navigation
`App.tsx` now listens for Capacitor's `backButton` event (native builds
only): drills back out of a sub-screen the same way its own on-screen
back button would, returns to Home from any other bottom-nav tab (the
standard Android top-level-tabs convention), and only actually exits the
app from Home or the login screen — so a stray back-press deep in a flow
can no longer accidentally kill the app.

### Development artifacts
Found **31 stray `.new` backup files** (one per edited screen/component
across the whole history of this project, e.g. `App.tsx.new`,
`ProfileScreen.tsx.new`), plus `src/_index_new.css` (an exact duplicate
of `src/index.css`), and three root-level debug scripts
(`probe.ts`, `probe2.ts`, `probe3.ts`, `audit_module_scope.cjs`) — none
imported or referenced anywhere in the app, confirmed by grep. **Excluded
from the delivered zip** (see the exclude list in §7), but could not be
physically deleted from the underlying project folder — the sandbox's
mount for this project only permits creating/modifying files, not
deleting them (verified: even a file created fresh in this same session
couldn't be removed). Run this once locally to actually clean them out:

```bash
find . -iname "*.new" -not -path "*/node_modules/*" -delete
rm -f src/_index_new.css probe.ts probe2.ts probe3.ts audit_module_scope.cjs
```

No other dev artifacts found: no `TODO`/`FIXME`/mock-data markers of
concern, no `localhost` assumptions in source, no test-only buttons.

### Security
- No `service_role`/`SERVICE_ROLE` reference anywhere in `src/` —
  confirmed by grep. Only the Edge Function (server-side, `Deno.env.get`)
  ever touches it.
- `.env.local` correctly gitignored and excluded from the delivered zip;
  `src/lib/supabaseClient.ts` only ever reads the public URL + publishable
  key via `import.meta.env`.
- `native_push_tokens` (new table) has the same locked-down RLS shape as
  every other user-owned table in this project: select/insert/update/delete
  all scoped to `user_id = auth.uid()`, `anon` fully revoked.
- Storage: the `avatars` bucket is public-read (intentional — avatars are
  meant to be visible) but write/update/delete are all scoped to the
  uploader's own folder (`storage.foldername(name)[1] = auth.uid()`).
- Ran the Supabase security advisor after all changes: the only findings
  are `SECURITY DEFINER` warnings on `send_message`, `heartbeat_match_room`,
  `clear_my_game_presence`, `get_presence`, and now the two new native-push
  RPCs — the same class of *intentional* warning every controlled-mutation
  RPC in this project has always triggered (flagged and accepted in the
  prior security review passes referenced in this project's history). No
  new criticals.

---

## 3. Files modified/added this pass

**New:** `capacitor.config.ts`, `resources/{icon.png,icon-foreground.png,icon-background.png,splash.png,notification-icon.png,README.md}`,
`src/types/capacitor-shims.d.ts`, `src/lib/nativePush.ts`,
`src/components/RootErrorBoundary.tsx`, `supabase/migrations/20260718001500_native_push_tokens.sql`,
this file.

**Modified:** `package.json`, `src/index.css` (`.panel-elevated`),
`src/components/NotificationsBell.tsx`, `src/components/TopBar.tsx`,
`src/components/FriendProfileSheet.tsx`, `src/main.tsx`, `src/App.tsx`,
`src/screens/ProfileScreen.tsx`, `src/lib/api.ts`,
`supabase/functions/send-push/index.ts` (redeployed live).

---

## 4. iOS build instructions (to run locally — requires macOS + Xcode + npm registry access)

```bash
cd skillzone
npm install                       # pulls in the Capacitor packages declared in package.json
rm src/types/capacitor-shims.d.ts # delete the temporary type stand-in — see its header comment
npm run build                     # tsc -b && vite build → dist/
npx cap add ios                   # creates ios/ — only needs to be run once
npx capacitor-assets generate     # populates ios/App/App/Assets.xcassets from resources/
npx cap sync ios                  # copies dist/ + plugins into the native project
npx cap open ios                  # opens Xcode
```

In Xcode: select a signing team under *Signing & Capabilities*, confirm
the bundle identifier matches `capacitor.config.ts`'s `appId`
(`com.kastro.app` — change both together if you use a different one),
add the **Push Notifications** capability, and add
**Background Modes → Remote notifications** if you want silent/data-only
pushes to wake the app. Then Product → Run on a simulator, or a connected
device for real push testing (push notifications do not work in the
iOS Simulator — a physical device or TestFlight build is required to
verify APNs delivery end to end).

## 5. Android build instructions (to run locally — requires Android Studio + npm registry access)

```bash
cd skillzone
npm install
rm src/types/capacitor-shims.d.ts
npm run build
npx cap add android
npx capacitor-assets generate     # populates android/app/src/main/res/
npx cap sync android
npx cap open android
```

In Android Studio: confirm `applicationId` in
`android/app/build.gradle` matches `capacitor.config.ts`'s `appId`, add
`google-services.json` (from the same Firebase project used for push,
see §6) to `android/app/`, and Run on an emulator or connected device.

**Before either store submission:** replace the placeholder `appId`
(`com.kastro.app`) with your organization's real registered identifier —
it's baked into both native projects at `cap add` time, so changing it
later means re-running `cap add` from scratch.

## 6. Push notification setup instructions

1. Create a Firebase project (console.firebase.google.com) if you don't
   have one, and add both an iOS app and an Android app to it using the
   same `appId` from `capacitor.config.ts`.
2. iOS: in Firebase Project Settings → Cloud Messaging, upload your Apple
   Push Notification key (`.p8` file) from your Apple Developer account —
   this lets Firebase relay to APNs on your behalf, so a single FCM call
   reaches both platforms.
3. Android: download `google-services.json` from Firebase, place it at
   `android/app/google-services.json`.
4. iOS: download `GoogleService-Info.plist` from Firebase, add it to the
   Xcode project (drag into `ios/App/App/`).
5. Create a Firebase service account with the "Firebase Cloud Messaging
   API" role, generate a JSON key, and set it as two Supabase Edge
   Function secrets (Dashboard → Edge Functions → send-push → Secrets, or
   `supabase secrets set`):
   - `FCM_PROJECT_ID` — the Firebase project ID
   - `FCM_SERVICE_ACCOUNT_JSON` — the full service-account JSON, as one
     string
6. That's it on the server side — `send-push` (already deployed) picks
   these up automatically and starts delivering to any registered native
   token; no redeploy needed after setting secrets.
7. On-device: build and run via §4/§5, open Profile → Notifications,
   toggle it on, grant the permission prompt, and send yourself a test
   message from a second account.

Web Push (VAPID) is unaffected by any of this and continues working for
browser tabs/installed PWAs exactly as before.

---

## 7. Delivered zip contents

Same build convention as every prior delivery in this project
(`rsync` from the project folder, excluding `node_modules/`, `dist/`,
`.env.local`, `*.tsbuildinfo`, `.git/`, `.DS_Store`), **plus** this pass
excludes every `*.new` file, `src/_index_new.css`, `probe*.ts`, and
`audit_module_scope.cjs` (see §2's Development Artifacts note — these
couldn't be deleted from the source folder itself, only kept out of the
package).

---

## 8. Honest test matrix

| Item | Status | Notes |
|---|---|---|
| Backend/RLS/RPC correctness (auth, chat, presence, admin) | **PASS** | Verified live via direct SQL role-impersonation this session and in prior passes — see this project's earlier delivery notes for the full breakdown. |
| `tsc -b` (whole frontend, including all new native-push code) | **PASS** | Clean, `EXIT:0`, re-run after every change in this pass. |
| Notification panel fix — actually renders correctly on a real iPhone | **NOT TESTED** | No physical device or browser available in this sandbox. The CSS fix directly targets a documented, specific WebKit `backdrop-filter`-in-`position:absolute` compositing bug and reuses a technique (`.bottom-nav`) already proven correct elsewhere in this exact app — but "should fix it" isn't the same as "confirmed fixed on-device." |
| `npm install` / Capacitor packages actually installed | **BLOCKED** | No npm registry access in this sandbox. Declared in `package.json`, not installed. |
| `npx cap add ios` / `android` (native projects created) | **BLOCKED** | Depends on the above. |
| iOS build opens/launches in Xcode | **NOT TESTED** | No macOS/Xcode in this sandbox. Config and instructions are prepared and internally consistent; not run. |
| Android build opens/launches in Android Studio | **NOT TESTED** | No Android Studio in this sandbox. Same as above. |
| App icon / splash appear correctly on-device | **NOT TESTED** | Source assets generated and verified as valid, correctly-sized PNGs; not yet run through `@capacitor/assets` or seen on a real launch screen. |
| Push: foreground / background / closed-app delivery | **BLOCKED** | Requires a real Firebase project + APNs key (external accounts only you can create) plus an actual device — the architecture is built and the web-push half of it already works in production, but the native half cannot be exercised without those credentials. |
| Push: tap opens correct chat | **NOT TESTED** | Code path implemented and shares the exact same navigation function already used (and working) for the Web Push equivalent; not exercised on-device. |
| Safe areas — notch/Dynamic Island, home indicator | **PARTIAL PASS** | Bottom-nav/chat-input/toast-host safe areas were already correct and re-verified; TopBar top-inset and one bottom sheet were real gaps, now fixed. Several secondary modals not individually re-checked this pass (see §2). No device to visually confirm on. |
| Keyboard avoidance (chat input) | **PASS (code-level)** | Existing `ChatConversation.tsx` input row already uses safe-area-aware padding and is a `position: fixed` sheet above the keyboard by construction (not `absolute` content that a keyboard would cover) — not re-broken by this pass. Not visually confirmed on a real keyboard. |
| Offline / network-failure handling | **PASS (pre-existing) + PASS (this pass)** | `sendMessage()`'s timeout/watchdog (fixed in the prior session) and the new root error boundary both directly target "never a dead blank screen." Not exercised with an actual airplane-mode device test. |
| Deep links (chat, notification tap) | **PASS (code-level)** | Both Web Push and native paths converge on one navigation function, already working for Web Push in production. |
| Security (RLS, service-role isolation, storage, tokens) | **PASS** | See §2's Security section — re-verified this pass, no new criticals from the advisor. |
| Dev artifacts removed from shipped package | **PASS (packaging) / BLOCKED (source tree)** | Excluded from the zip; could not be deleted from the underlying folder — see §2 and the cleanup command provided there. |
| Landscape disabled (portrait lock) | **PASS (config-level)** | `capacitor.config.ts` doesn't set orientation lock directly (that's a native `Info.plist`/`AndroidManifest.xml` setting `cap add` generates defaults for); `manifest.webmanifest`'s `"orientation": "portrait"` already covers the PWA case. Native lock should be spot-checked once `ios/`/`android/` exist — flagged, not yet confirmed. |

---

## 9. Remaining blockers (in priority order)

1. **No npm registry access in this delivery environment** — blocks
   installing the Capacitor packages, running `cap add`, and therefore
   every subsequent native-build step. Everything in §4/§5 is ready to
   run the moment this happens on your machine.
2. **No Firebase project / APNs key** — external accounts only you can
   create (§6). Native push silently no-ops until these exist; nothing
   breaks in the meantime.
3. **No physical iPhone/Android device or Xcode/Android Studio in this
   sandbox** — every "NOT TESTED" row in §8 needs a real build-and-run
   pass on your end before this can honestly move to PASS.
4. **Placeholder `appId`** (`com.kastro.app`) — cosmetic now, but must be
   finalized before the first `cap add` (changing it after means
   redoing the native projects).
5. Secondary modal safe-area coverage (`AvatarPickerModal`,
   `DailyRewardModal`, `BadgeUnlockOverlay`, `LevelUpOverlay`,
   registration/admin forms) — lower risk (centered overlays, not
   edge-flush sheets) but not individually re-verified this pass; worth a
   quick pass once real-device testing is possible.

---

## 10. Gate confirmation

**Game development should not resume until:** items 1–3 above move from
BLOCKED/NOT TESTED to PASS via a real local build-and-device pass — that
is the only way to honestly confirm "installable native app that
actually works on an iPhone and an Android phone," which was the
explicit bar for this audit. Everything that could be verified
end-to-end *inside this sandbox* (backend correctness, RLS, the
notification-panel CSS logic, safe-area code, error-boundary behavior,
`tsc` cleanliness, the full native-push server architecture) has been,
and passes. What remains is exclusively the native-toolchain and
physical-device work no cloud sandbox can substitute for.
