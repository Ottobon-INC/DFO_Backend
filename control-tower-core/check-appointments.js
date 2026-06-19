const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables manually
const envPath = path.join(__dirname, '.env', 'development.env');
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        env[key] = value;
    }
});

const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY);

async function checkAppointments() {
    console.log('Fetching appointments...');
    const { data, error } = await supabase.from('sakhi_clinic_appointments').select('*').limit(10);
    if (error) {
        console.error('Error fetching appointments:', error);
    } else {
        console.log('Appointments in DB:', data);
    }
    process.exit(0);
}

checkAppointments();
