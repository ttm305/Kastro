import { createClient } from '@supabase/supabase-js'

type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

type Database = {
  __InternalSupabase: { PostgrestVersion: "14.5" }
  public: {
    Tables: {
      games: {
        Row: { id: string; name: string }
        Insert: { id?: string; name: string }
        Update: { id?: string; name?: string }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      [key: string]: {
        Args: Record<string, unknown>
        Returns: unknown
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}

const supabase = createClient<Database>('https://x.supabase.co', 'key')

async function test() {
  const r = await supabase.from('games').select('*')
  console.log(r.data?.[0]?.id, r.data?.[0]?.name)

  const rpc = await supabase.rpc('get_public_profiles', { p_ids: ['a'] })
  console.log(rpc.data)
}
