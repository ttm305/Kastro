# Migrations in this folder

This folder contains file-versioned copies of the migrations applied
directly to the live Supabase project (`pagwybefqbnqrqigvvrw`) via the
management API, going back to the Friends + Chat build:

- `20260716200629_friends_chat_tables.sql`
- `20260716200757_friends_chat_functions.sql`
- `20260717162011_owner_admin_schema_extensions.sql`
- `20260717162053_owner_admin_xp_coin_rpcs.sql`
- `20260717162146_owner_admin_badge_and_title_rpcs.sql`
- `20260717162211_owner_admin_stats_correction_rpc.sql`
- `20260717162258_owner_admin_reset_progress_and_owner_protection.sql`
- `20260717162334_owner_admin_revoke_anon_from_all_admin_rpcs.sql`
- `20260717170415_fix_branches_registration_dropdown.sql`
- `20260717171746_dynamic_branch_management.sql`
- `20260717172013_fix_admin_reorder_branches_log_call_ambiguity.sql`
- `20260717173105_fix_get_public_profiles_branch_column_rename.sql`
- `20260717180942_fix_conversation_persistence_and_save_messages.sql`
- `20260717182201_push_notifications_schema.sql`
- `20260717183512_revoke_anon_from_friends_chat_rpcs.sql`
- `20260717184228_tighten_chat_table_grants.sql`
- `20260717185041_add_notifications_to_realtime_publication.sql`

## Critical finding: `notifications` was never in the realtime publication

`20260717185041_add_notifications_to_realtime_publication.sql` is very
likely the actual root cause of "No in-app notification appears when a
new message arrives" — one of the four bugs reported at the top of this
request. `public.notifications` had never been added to the
`supabase_realtime` publication (`alter publication supabase_realtime add
table ...`), even though `subscribeToNotifications()` and
`subscribeToNewNotifications()` in `src/lib/api.ts` — used by
`NotificationsBell`, `AchievementOverlayHost`, and this delivery's new
`ChatToastHost` — all subscribe to `postgres_changes` on it. Supabase
Realtime's `postgres_changes` feature is built on Postgres logical
replication: a table not in the publication simply never emits change
events over that channel, with no error anywhere in the client — the
subscription "succeeds" and then silently never fires. This means no
realtime in-app notification of any kind (not just chat: level-up
overlays, badge-unlock overlays, the notification bell's live badge)
could ever have worked before this fix, on any part of the app, in any
previous phase of this project — they'd only ever show up correctly after
a manual reload/poll caught up. Fixed with one `alter publication ... add
table` statement; verified the table now appears in
`pg_publication_tables` for `supabase_realtime` post-migration.

## Security review finding #2: overly broad table grants on chat tables

`20260717184228_tighten_chat_table_grants.sql` fixes a second, related
finding from the same review pass. `messages`, `conversations`, and
`conversation_participants` all still carried Postgres's default
table-level grants (`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/
`REFERENCES`/`TRIGGER` to both `anon` and `authenticated`) from however
they were originally created, even though RLS on all three only defines a
`SELECT` policy (plus a self-scoped `UPDATE` policy on
`conversation_participants`). Because RLS denies any command with no
matching policy by default, `INSERT`/`UPDATE`/`DELETE` were already
unreachable through those grants alone — but `TRUNCATE` is **not**
subject to row-level security at all, so `anon` holding `TRUNCATE` on all
three tables was a genuine (if not reachable through PostgREST/the
Supabase client SDKs, which never issue `TRUNCATE`) latent risk. This
migration revokes everything and re-grants only what RLS actually uses:
`SELECT` for `authenticated` on all three, plus `UPDATE` on
`conversation_participants` (needed by `saveDraft()`/heartbeat-adjacent
direct table writes). `anon` now has zero privileges on any of the three.
Verified live post-migration that both direct-table code paths in
`api.ts` that don't go through an RPC — `getMessages()` (SELECT) and
`saveDraft()` (UPDATE) — still work for an authenticated user. Also
enabled RLS (no policies, i.e. deny-all) on `private.app_secrets` for
consistency — it already had zero grants and lives in a schema PostgREST
never exposes, so this is pure defense-in-depth with no behavior change.

## Security review finding #1: anon could call every friends/chat RPC

`20260717183512_revoke_anon_from_friends_chat_rpcs.sql` closes a gap found
while doing this delivery's explicit security review pass (section 8 of
the request). None of the RPCs in the *original* Friends + Chat migration
(`20260716200757_friends_chat_functions.sql` — `send_message`,
`block_user`, `report_user`, `send_friend_request`,
`respond_friend_request`, `remove_friend`, `get_or_create_conversation`,
`open_conversation`, `heartbeat_conversation`, `leave_conversation`, plus
the `private.are_friends` / `private.is_blocked` / `private.notify` /
`private.leave_conversation_for` helpers) had an explicit
`revoke ... from anon` — PostgreSQL grants `EXECUTE` to `PUBLIC` on every
new function by default, so all of them were technically callable by an
unauthenticated (anon-key) request through PostgREST. Each function does
check `auth.uid()` internally, but several use
`if auth.uid() not in (a, b) then raise ...`, and SQL's NULL-propagation
means that check quietly evaluates to NULL (⇒ treated as false, i.e.
"don't raise") when `auth.uid()` is NULL for an anonymous caller — so
rejection wasn't guaranteed by design, only as an incidental side effect
of hitting an unrelated `NOT NULL` constraint later. This migration
revokes `anon`/`PUBLIC` execute and re-grants explicitly to
`authenticated` only, matching the pattern already used correctly
elsewhere (owner/admin RPCs, and every new RPC added in this delivery).
Verified live post-migration: an authenticated `send_message()` call still
succeeds unchanged; `has_function_privilege('anon', ..., 'execute')` now
returns `false` for all of the functions listed above.

## Push notifications (Web Push / VAPID) — setup required before this works live

`20260717182201_push_notifications_schema.sql` adds the full backend for
out-of-app (backgrounded/closed) push notifications on new messages:
`public.push_subscriptions` (one row per browser/device a user has
enabled push on, RLS-locked to `user_id = auth.uid()` for
select/insert/update/delete — no admin bypass needed, a user only ever
manages their own devices), `register_push_subscription()` /
`unregister_push_subscription()` / `has_push_subscription()` RPCs, a
`private.app_secrets` table holding one generated shared secret used only
for internal DB→Edge-Function authentication (never exposed via the API —
`private` isn't reachable through PostgREST, and no grant gives `anon` or
`authenticated` access to it), and `private.send_push_for_new_message()`,
which `send_message()` now calls (via `pg_net`, fire-and-forget,
exception-swallowed so a push failure can never fail a message send)
under the exact same "recipient isn't actively viewing the conversation"
condition that already gates the in-app notification. The `pg_net`
extension was enabled as part of this migration (it was not previously
installed on this project).

The actual Web Push delivery happens in the `send-push` Edge Function
(`supabase/functions/send-push/index.ts`, deployed and ACTIVE on the live
project as of this delivery). It receives `{user_id, title, body, data}`
from the DB trigger, authenticates the request via a `x-internal-secret`
header that must match `private.app_secrets.push_internal_secret`, looks
up that user's `push_subscriptions` rows using its auto-injected
`SUPABASE_SERVICE_ROLE_KEY`, sends via the `web-push` npm package (VAPID),
and deletes any subscription that comes back 404/410 (permanently
invalidated — uninstalled, permission revoked, etc.).

**A real VAPID key pair was generated for this project** (P-256 ECDH,
via Node's built-in `crypto` module — no third-party service involved):
the public key is embedded in `src/lib/push.ts` (`VAPID_PUBLIC_KEY`,
public by design — it's the Push API's "application server key" and is
meant to ship in client code). The matching private key, plus the
internal shared secret, were **not** set as Edge Function secrets as part
of this delivery — no tool available in this environment can set Edge
Function secrets (that requires the Supabase CLI or Dashboard). **Push
notifications will not actually deliver until the project owner runs:**

```
supabase secrets set --project-ref pagwybefqbnqrqigvvrw \
  VAPID_PUBLIC_KEY=BKUQXoS3k9nIw2rKVyhAZoYiEv1Wihkh2dgkaRf6Q7sjLRiU4dPk_Dem6cJeywjTcnFVX48ur9my5uUiOX1b1tM \
  VAPID_PRIVATE_KEY=wZcPv9vyT3AB8J7m7Y7Yq3LGMdtS1p_KWtkJKpMLFaU \
  VAPID_SUBJECT=mailto:support@kastro.app \
  PUSH_INTERNAL_SECRET=33bddc5367f4f825b4f638c8716e278e10fa182a202b9cb881b898d49aef17d7
```

(`PUSH_INTERNAL_SECRET` must exactly match the value already seeded into
`private.app_secrets` by the migration above — copy it from there if it's
ever rotated, rather than picking a new value independently.) Until these
four secrets are set, `send-push` returns `{skipped: "vapid_not_configured"}`
for every call and no push is ever sent — in-app delivery (realtime toast +
badge, section 5) is completely unaffected either way.

Frontend pieces: `public/sw.js` (service worker — renders the OS
notification on `push`, and on `notificationclick` either focuses an
already-open tab via `postMessage` or opens a new one with
`?open_chat=<id>` so App.tsx can deep-link into the right conversation
either way), `src/lib/push.ts` (`enablePush()` / `disablePush()` /
`isPushSupported()` — requests Notification permission, subscribes via
`PushManager`, registers the subscription server-side), and a toggle in
Profile → Notifications (`PushNotificationToggle` in
`src/screens/ProfileScreen.tsx`).

**iOS Safari limitation (disclosed, not worked around — there is no
workaround):** Web Push on iOS only works after the site has been added
to the Home Screen via Safari's Share → "Add to Home Screen" (iOS 16.4+).
An ordinary Safari tab has no `PushManager`/`Notification` API at all —
`isPushSupported()` correctly returns `false` there and the toggle shows
an explanatory message instead of failing silently. The existing
`manifest.webmanifest` + `apple-mobile-web-app-capable` meta tags already
made this app installable before this change; nothing new was needed
there.

**What was and wasn't tested.** Every DB-layer piece (RLS, the RPCs,
`send_message()` calling `private.send_push_for_new_message()` without
throwing, the early-exit when a user has zero subscriptions) was verified
live against the real database. The Edge Function was deployed
successfully and is ACTIVE. **Live end-to-end push delivery to a real
browser/device was not tested** — this sandbox has no real browser or
mobile device, and the VAPID secrets aren't set yet regardless (see
above). Per instruction, this is reported honestly as untested rather
than marked passed.

`20260717180942_fix_conversation_persistence_and_save_messages.sql` fixes
the two backend bugs behind "the conversation disappears once its messages
are cleared" and adds the "Save in Chat" feature. Root cause: (1)
`get_my_conversations()` required a currently-existing message row to list
a conversation at all, and (2) nothing distinguished "conversation with
real history" from "conversation with none" once every message row had
been deleted by the ephemeral cleanup path — `conversations.last_message_at`
is the only field that persists that fact, but the old `get_my_conversations()`
didn't use it as the inclusion key. Fix: `get_my_conversations()` now lists
any conversation where `last_message_at is not null`, independent of
whether a message row currently exists, and returns
`last_message_saved` so the frontend can render a distinct saved-message
preview instead of an empty state when appropriate.  Also added:
`messages.is_saved`/`saved_at`/`saved_by` columns and a new
`toggle_save_message(message_id, save)` RPC (participant-only, self-checked
against `conversations.user_a`/`user_b`) — `private.leave_conversation_for()`
was updated so its read-then-delete ephemeral cleanup skips any message
with `is_saved = true`, so saved messages survive the recipient leaving the
conversation. Finally, `send_message()`'s "new_message" notification
previously had a null title/body; it now includes
`"{sender username}: {80-char preview}"` so in-app and (future) push
notifications have real content. All three functions
(`get_my_conversations`, `leave_conversation_for`, `send_message`) were
live-tested end-to-end via direct RPC simulation as both `test` and `T`
before and after this migration — see the delivery notes for the exact
scenarios verified.

The first of these three converts Branch Management from "one
hardcoded-ish seeded row" into a fully dynamic, owner-managed system: the
`branches` table gained its final shape (`code`/`name_ar`/`name_en`/
`is_active`/`sort_order`/`created_at`/`updated_at`, with `name`→`name_en`
and `slug`→`code` renames), RLS was tightened so normal players (anon or
authenticated) only ever see `is_active = true` rows while the owner sees
everything, and six new owner-only RPCs were added — `admin_get_branches`
(list + live user_count per branch), `admin_create_branch`,
`admin_update_branch` (names only — `code` is a permanent machine key),
`admin_set_branch_active`, `admin_reorder_branches`, and
`admin_delete_branch` (hard-blocked if any profile still references the
branch). The second file is a same-session bug fix:
`admin_reorder_branches`'s audit-log call was ambiguous between two
`log_admin_action` overloads (5-arg vs. 8-arg with defaults) and had to be
re-declared passing all 8 args explicitly. The third file is a second
same-session regression fix, found by grepping every function definition
in the database for references to the renamed columns after applying the
first migration: `get_public_profiles()` (used by HomeScreen/
ProfileScreen to show another user's branch) still selected the
now-nonexistent `b.name` and would have raised "column does not exist" on
every call; re-declared to select `b.name_en` instead, output contract
(`branch_name`) unchanged. All three were found and fixed via live
testing/introspection before delivery, not left for the user to discover.

`20260717170415_fix_branches_registration_dropdown.sql` fixes the
registration Branch dropdown showing an empty options list: the dropdown
loads via `getBranches()` before the user is signed in, but the
`branches` table's only SELECT policy at the time required
`auth.role() = 'authenticated'`, so the pre-auth (anon) read silently
returned zero rows. It added an `anon`-scoped SELECT policy restricted to
`is_active = true` branches (superseded/broadened by the dynamic Branch
Management migration above, which folds anon into the same public
active-only policy) and normalized seed data so exactly one branch
("Evaluation Branch") was active — the other seed row was deactivated,
not deleted.

The six before that make up the owner-administration expansion: fixing the
"Reset XP to 0" bug at its root cause, and adding full owner control over
user status, XP, coins, badges, statistics correction, custom display
titles, and a transactional "Reset Player Progress" action — all gated by
`private.require_owner()` inside each SECURITY DEFINER function, never by
frontend-only checks. Apply them in the exact filename order above; each
is idempotent (`create or replace function`, `add column if not exists`)
so re-running against a project already at this state is safe.

**Why not the full history.** Every migration for this project (~76 of
them, going back to the original core schema) was applied directly to the
live Supabase project via the Supabase management API, and none were ever
saved as `.sql` files in the repo — that predates this file-versioning
practice. The files here were reconstructed by introspecting the live
database (table definitions, RLS policies, function bodies, indexes, the
pg_cron job) after applying them, so they're a faithful record of what's
live, but they are not a complete migration history for the whole project.
Run `supabase db pull` (or an equivalent introspection) against project
`pagwybefqbnqrqigvvrw` if you want a complete, versioned migration set for
everything that came before this practice started.
