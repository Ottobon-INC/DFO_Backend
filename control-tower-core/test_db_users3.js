require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.ORG_SUPABASE_URL, process.env.ORG_SUPABASE_SERVICE_ROLE_KEY);
async function r() {
  const { data } = await s.from('sakhi_users').select('*').limit(2)
  console.log(data);
}
r();
