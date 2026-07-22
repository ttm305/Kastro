// purge-chat-media: drains public.pending_media_deletions and actually
// deletes the underlying files from the private 'chat-media' storage
// bucket via the real Storage API (service role).
//
// Why this exists: storage.objects rows can't be deleted with plain SQL in
// this project (storage.protect_delete() blocks it — "Use the Storage API
// instead"), so a Postgres trigger alone can't clean up media files when a
// disappearing-message sweep (leave-triggered or the 24h purge) deletes a
// media message row. Instead, that trigger (private.queue_media_deletion,
// see the chat_media_send_rpc_and_cleanup_queue migration) queues the
// object path into pending_media_deletions, and this function drains that
// queue on a schedule (see the pg_cron job wired up alongside it).
//
// Auth model: identical to send-push — not a public endpoint, verify_jwt is
// disabled, and every request must carry the shared secret in
// x-internal-secret, matching private.app_secrets.push_internal_secret
// (reused here rather than provisioning a second secret; Edge Function
// secrets are project-wide, not per-function).

import { createClient } from 'jsr:@supabase/supabase-js@2'

const INTERNAL_SECRET = Deno.env.get('PUSH_INTERNAL_SECRET') ?? ''
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const BATCH_SIZE = 200

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 })
  }

  if (!INTERNAL_SECRET || req.headers.get('x-internal-secret') !== INTERNAL_SECRET) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { 'Content-Type': 'application/json' } })
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

  const { data: rows, error: fetchError } = await supabase
    .from('pending_media_deletions')
    .select('id, media_path')
    .order('created_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (fetchError) {
    console.error('purge-chat-media: failed to read pending_media_deletions', fetchError)
    return new Response(JSON.stringify({ error: fetchError.message }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  if (!rows || rows.length === 0) {
    return new Response(JSON.stringify({ removed: 0, drained: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }

  const paths = rows.map((r) => r.media_path as string)
  const { error: removeError } = await supabase.storage.from('chat-media').remove(paths)

  // Best-effort, same philosophy as send-push's stale-subscription pruning:
  // a file that's already gone (removed by a previous run, never actually
  // written because the upload failed client-side, etc.) isn't a reason to
  // leave the queue row stuck forever — drain it regardless. A real,
  // unexpected storage-service failure logs loudly instead.
  if (removeError) {
    console.error('purge-chat-media: storage.remove reported an error (draining queue rows anyway)', removeError)
  }

  const ids = rows.map((r) => r.id)
  const { error: deleteError } = await supabase.from('pending_media_deletions').delete().in('id', ids)
  if (deleteError) {
    console.error('purge-chat-media: failed to drain pending_media_deletions rows', deleteError)
    return new Response(JSON.stringify({ error: deleteError.message, removed: paths.length, drained: 0 }), { status: 500, headers: { 'Content-Type': 'application/json' } })
  }

  return new Response(JSON.stringify({ removed: paths.length, drained: ids.length }), { status: 200, headers: { 'Content-Type': 'application/json' } })
})
