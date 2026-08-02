require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function r() {
  const { data, error } = await s.from('conversation_threads')
    .select('*')
    .eq('domain', 'janmasethu')
    .in('status', ['red', 'yellow']);
  console.log(data, error);
}
r();
