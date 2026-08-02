require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.ORG_SUPABASE_URL, process.env.ORG_SUPABASE_SERVICE_ROLE_KEY);
async function r() {
  const { data } = await s.from('sakhi_encrypted_chats').select('*').eq('chat_id', 'a68ab4ff-ca36-47a8-8cc7-a54057bdf7a2');
  console.log(data);
}
r();
