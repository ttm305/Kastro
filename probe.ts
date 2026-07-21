import { createClient } from '@supabase/supabase-js'
import type { Database } from './src/lib/database.types'

const supabase = createClient<Database>('https://x.supabase.co', 'key')

async function test() {
  const { data } = await supabase.from('games').select('*')
  console.log(data?.[0]?.id)

  const { data: rpcData } = await supabase.rpc('get_public_profiles', { p_ids: ['a'] })
  console.log(rpcData)
}
