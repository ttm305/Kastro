# KASTRO — Production Deployment

## 1. Backend (already live)

Supabase project `pagwybefqbnqrqigvvrw` is fully migrated and seeded: schema, RLS
policies, RPCs, the `register` Edge Function, and reference/catalog data are all
applied. No further backend work is required to launch the pilot.

**Service role key rotation:** the `register` Edge Function reads
`Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")`, which Supabase auto-injects and
keeps in sync with whatever key is active in Project Settings → API. Rotating
the key there is sufficient on its own — no redeploy needed, and the key
value never needs to be pasted into code, chat, or this repo again.

## 2. Required Supabase Dashboard configuration before going live

These are dashboard settings, not code, and must be set once a production
domain is chosen:

- **Authentication → URL Configuration → Site URL**: set to your production
  domain (e.g. `https://kastro.yourcompany.com`). This is what
  `resetPasswordForEmail`'s `redirectTo: window.location.origin` resolves
  against in the email link.
- **Authentication → URL Configuration → Redirect URLs**: add the same
  production domain (and any staging/preview domains you use) to the allow
  list, or password-reset links will fail to redirect correctly.
- Email delivery uses Supabase's built-in sender (per your earlier choice —
  no Resend/SendGrid). For a pilot's volume this is fine; if you outgrow
  Supabase's default sending limits later, a custom SMTP provider can be
  added in Authentication → Emails without any app code changes.

## 3. Frontend build

```bash
cd skillzone
pnpm install       # or npm install
cp .env.example .env.local   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY
pnpm build          # tsc -b && vite build → outputs to dist/
```

Both `.env.local` values are safe to expose to the browser (the publishable
key is anon-equivalent — every privileged action goes through a
SECURITY DEFINER RPC or the `register` Edge Function). The service_role key
must never appear in this build.

**Before shipping:** run the build once in an environment with npm registry
access — it hasn't been possible to run `pnpm install`/`tsc` in this sandbox
(no network egress), so the extensive wiring done here was verified by
static/manual cross-checking against the generated Supabase types rather
than an actual compiler pass. Fix anything `tsc` surfaces; given how
thoroughly each screen's props/imports/RPC calls were cross-referenced, any
remaining issues should be minor.

## 4. Hosting

`pnpm build` produces a static `dist/` folder — no server-side rendering, no
API routes, no router (navigation is in-memory `useState`, not URL-based), so
it deploys to any static host (Vercel, Netlify, Cloudflare Pages, S3+CloudFront,
GitHub Pages, etc.) with zero special rewrite rules needed. Point the host at
`dist/`, set the two `VITE_*` env vars in the host's dashboard, and deploy.

## 5. Post-deploy smoke test

1. Sign up with the bootstrap access code `PILOT2025` using the owner email
   (`muraikhi13@gmail.com`) — this account is auto-promoted to `owner` by the
   `handle_new_user` trigger.
2. Confirm the Admin Dashboard is reachable and shows real (empty/seeded)
   data, not placeholders.
3. Create a fresh access code from the Admin Dashboard and use it to
   register a second, regular player account.
4. Play one quiz game end-to-end and confirm XP/level update on Profile.
5. Trigger "Forgot password" on the login screen, follow the email link, and
   confirm it lands on the new "Set a New Password" screen (added in this
   pass) rather than dropping straight into Home.
6. Once satisfied, consider raising `PILOT2025`'s `max_uses` or retiring it
   in favor of department-specific codes.
