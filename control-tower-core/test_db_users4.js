require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.ORG_SUPABASE_URL, process.env.ORG_SUPABASE_SERVICE_ROLE_KEY);
async function r() {
  const { data } = await s.from('sakhi_users').select('*').in('phone_number', ['6685b9095d71b854b1b3d3c1c2151d4fdde0aaee803a360e95af91da2fa24794', '36a54c0acb48adb8d954a5d78cd42bd5bc4cb66dd13246727b934507e604dda4', '5fb717440be90e1d8b72315ab52e6bb2480b501e258c022dc0eece334dd98b23'])
  console.log(data);
}
r();
