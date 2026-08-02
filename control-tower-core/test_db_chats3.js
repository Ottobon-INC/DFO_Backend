require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.ORG_SUPABASE_URL, process.env.ORG_SUPABASE_SERVICE_ROLE_KEY);
async function r() {
  const { data } = await s.from('sakhi_encrypted_chats').select('*').in('user_id', ['+917392123669', '917392123669', '7392123669']).limit(5);
  console.log(data);
}
r();
