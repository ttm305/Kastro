# KASTRO — Setup

## Zip contents
This is the complete, current KASTRO source: all screens, the Friends +
private disappearing-chat system, the 5-tab nav (Home / Games / Friends /
Leaderboard / Profile), every game (Ludo included, still hidden/disabled
from normal users as intended), all components, styles, translations,
Supabase client code, database migrations, and the `register` Edge
Function. `node_modules` is not included — step 2 below generates it.

## What I can and cannot personally certify

I was asked to extract this exact zip into a clean folder and confirm
`npm install` → `npm run dev` loads with no blank screen and no console
errors before sending it. **I could not do that, and I'm not going to
claim otherwise.** My sandbox is Linux (aarch64) with no access to the
npm package registry (every request to registry.npmjs.org, and every
mirror/CDN I tried, returns 403 from a network allowlist I can't change).
This project's `vite`/Tailwind/formatter dependencies ship native
binaries per-platform — I have no way to install the Linux ones, and no
way to install anything else either. That means I cannot run `npm
install`, `npm run dev`, or `npm run build` end to end in this
environment, on this project or any project. This has been true for
every delivery in this conversation; I'm restating it plainly here
because you asked me to confirm testing directly, and the honest answer
is I didn't run it.

What I did verify, concretely, in this exact source tree, moments before
zipping:
- `npx tsc -b --force` — zero errors, zero warnings. Re-ran it fresh
  after adding the Edge Function file above; still clean.
- A full parse of every `.ts`/`.tsx` file's module-level (import-time)
  code using the TypeScript compiler's own AST, checking for any
  statement that executes before React mounts and could throw. Two
  candidates exist (the Supabase env-var check, and a Ludo geometry
  sanity check) — both were checked against their actual runtime values
  and neither fires.
- Every file listed below is present in the zip; nothing referenced by
  `App.tsx`'s import graph is missing.

What that does *not* rule out: a bug that only shows up when the code
actually executes in a browser (a bad prop at runtime, a CSS issue, a
Safari-specific quirk). Static analysis and a clean type-check are real
signal, but they are not the same as watching the app load in a browser
window, and I don't have a way to do the latter from here.

If it still doesn't load after following the steps below, the single
fastest path to a real fix is the exact text of the error in your
browser's console (Safari: Develop menu → Show JavaScript Console, or
right-click the page → Inspect Element → Console) — that will point
directly at the file and line, instead of me continuing to audit blind.

## Setup — exact commands

```
cp .env.example .env.local
npm install
npm run dev
```

Then open the URL Vite prints (typically `http://localhost:5173`).

`.env.local` values: `.env.example` already contains this project's real,
working Supabase URL and publishable key — you don't need to look
anything up or enter anything yourself, just copy the file:

```
VITE_SUPABASE_URL=https://pagwybefqbnqrqigvvrw.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_UA4dgj5yOadC7yh9UWMg_g_9AYizEFE
```

These are safe to have in a plain file — the publishable key is the
public, RLS-protected anon-equivalent key Supabase is designed to ship to
browsers, not a secret. No service_role key or other credential is
anywhere in this project's frontend code or env files. This project's
entire database schema (Friends/Chat included) is already live against
this exact Supabase project, which is why pointing at any other project
would not work out of the box — if you ever do want a fresh project, run
`supabase db pull` against `pagwybefqbnqrqigvvrw` first to get the full
schema, since only the two most recent migrations are saved as `.sql`
files in this repo (see `supabase/migrations/README.md` for why).

If `npm run dev` was already running when you created `.env.local`, stop
it (Ctrl+C) and start it again — Vite only reads env files at startup.

To type-check and build for production:
```
npm run build
```

## No lockfile is included, on purpose

I can't reach the npm registry from this sandbox, so I can't generate a
`package-lock.json` that's actually correct — an earlier attempt produced
one with broken relative file paths tied to my sandbox's folder layout,
and shipping that would have been worse than shipping nothing.
`package.json` has every dependency pinned to an exact version (no `^`
ranges), so `npm install` on your machine — which does have real registry
access — will resolve deterministically and write a correct
`package-lock.json` for you on first install.

## Files changed in this delivery (on top of everything already built)

Root cause fixes for the two build blockers reported earlier:
`src/lib/database.types.ts` (the core fix — a `Functions` type shape that
didn't satisfy `@supabase/supabase-js`'s generic constraint, which had
been silently breaking every `.from()`/`.rpc()` call's types
project-wide), plus follow-on fixes in `src/lib/api.ts`,
`src/lib/adminApi.ts`, `src/lib/auth.tsx`, `src/lib/useMatchEngine.ts`,
`src/components/AchievementOverlayHost.tsx`,
`src/components/NotificationsBell.tsx`, `src/screens/FriendsScreen.tsx`,
`src/screens/GameLobbyScreen.tsx`, `src/screens/GamesLibraryScreen.tsx`,
`src/screens/LeaderboardScreen.tsx`, `src/screens/ProfileScreen.tsx`,
`src/screens/TournamentScreen.tsx`, `src/screens/AdminDashboardScreen.tsx`,
and `package.json` (exact-pinned versions).

New this round: `supabase/functions/register/index.ts` — the deployed
Edge Function's source, pulled directly from the live project and added
to the repo (it existed only on the server before, never in the zip).
