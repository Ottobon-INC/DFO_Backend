require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
async function r() {
  const { data } = await s.from('conversation_threads').select('*').eq('id', 'a68ab4ff-ca36-47a8-8cc7-a54057bdf7a2');
  console.log(data);
}
r();
