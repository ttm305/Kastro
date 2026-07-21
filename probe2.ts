import { createClient } from '@supabase/supabase-js'
import type { Database } from './src/lib/database.types'

const supabaseAny = createClient('https://x.supabase.co', 'key')
const supabaseTyped = createClient<Database, 'public'>('https://x.supabase.co', 'key')
const supabaseTyped2 = createClient<Database>('https://x.supabase.co', 'key')

async function test() {
  const r0 = await supabaseAny.from('games').select('*')
  console.log(r0.data?.[0])

  const r1 = await supabaseTyped.from('games').select('*')
  console.log(r1.data?.[0]?.id)

  const r2 = await supabaseTyped2.from('games').select('*')
  console.log(r2.data?.[0]?.id)
}
