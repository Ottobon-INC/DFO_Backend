const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const envPath = path.join(__dirname, '.env', 'development.env');
const envContent = fs.readFileSync(envPath, 'utf8').replace(/\r/g, '');
const env = {};
envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) env[parts[0].trim()] = parts.slice(1).join('=').trim();
});

const key = env.SUPABASE_ANOYN_KEY || env.SUPABASE_KEY;
const supabase = createClient(env.SUPABASE_URL, key);

async function checkRLS() {
    // Try to read the RLS policies via rpc
    const { data, error } = await supabase.rpc('get_policies', {});
    console.log('RPC result:', data, error);

    // Also try a simple select to see if read works
    const { data: users, error: readErr } = await supabase
        .from('sakhi_clinic_users')
        .select('*');
    console.log('SELECT result:', { count: users?.length, error: readErr });

    // Try insert without using upsert
    const { data: ins, error: insErr } = await supabase
        .from('sakhi_clinic_users')
        .insert([{ email: 'test@test.com', password_hash: 'test', name: 'Test', role: 'admin' }])
        .select();
    console.log('INSERT result:', { data: ins, error: insErr?.message });
}

checkRLS();
