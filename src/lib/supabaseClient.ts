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
