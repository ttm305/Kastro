import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY

if (!url || !key) {
  throw new Error(
    'Missing VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY. Copy .env.example to .env.local and fill in your project values.'
  )
}

/**
 * Single shared Supabase client for the whole app. Uses the publishable
 * (anon-equivalent) key only — every privileged operation goes through a
 * SECURITY DEFINER RPC or the `register` Edge Function, never a raw
 * table write from here.
 */
export const supabase = createClient<Database>(url, key, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
})

export const EDGE_FUNCTION_URL = (name: string) => `${url}/functions/v1/${name}`

/**
 * Direct XHR upload against the Storage REST API, used only for chat media
 * (voice/image/video attachments) so the composer can show real upload
 * progress and support cancellation — the storage-js client's own
 * `upload()` is fetch-based and exposes neither. Deliberately built to send
 * the exact same request shape storage-js itself sends for a Blob/File
 * (see StorageFileApi.uploadOrUpdate in @supabase/storage-js): POST to
 * `/storage/v1/object/{bucket}/{path}`, a FormData body with a
 * `cacheControl` field plus the file under an empty-string field name, and
 * the same `apikey` + `Authorization` + `x-upsert` headers the SDK would
 * send — so it is authorized/rejected by exactly the same RLS policies an
 * SDK-driven upload would be (see the chat_media_insert policy).
 */
export function uploadChatMediaWithProgress(
  path: string,
  file: Blob,
  onProgress?: (fraction: number) => void
): { promise: Promise<{ error: string | null }>; cancel: () => void } {
  const xhr = new XMLHttpRequest()
  const promise = new Promise<{ error: string | null }>((resolve) => {
    supabase.auth.getSession().then(({ data }) => {
      const token = data.session?.access_token
      if (!token) { resolve({ error: 'Not signed in' }); return }

      const formData = new FormData()
      formData.append('cacheControl', '3600')
      formData.append('', file)

      xhr.open('POST', `${url}/storage/v1/object/chat-media/${path}`, true)
      xhr.setRequestHeader('Authorization', `Bearer ${token}`)
      xhr.setRequestHeader('apikey', key)
      xhr.setRequestHeader('x-upsert', 'false')
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total)
      }
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve({ error: null })
        else resolve({ error: `Upload failed (${xhr.status})` })
      }
      xhr.onerror = () => resolve({ error: 'Network error during upload' })
      xhr.onabort = () => resolve({ error: 'cancelled' })
      xhr.send(formData)
    })
  })
  return { promise, cancel: () => xhr.abort() }
}
