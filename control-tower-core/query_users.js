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

async function run() {
    const { data, error } = await supabase.from('sakhi_clinic_users').select('email, role, name');
    if (error) {
        console.error('Error:', error);
    } else {
        console.log('Users in database:', data);
    }
}
run();
