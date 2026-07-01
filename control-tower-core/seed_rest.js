// Seed users via the backend's own API (bypass RLS by adding a seed endpoint temporarily)
// Instead, we'll use fetch to call the running backend directly to create users via a POST
// But there's no create user endpoint... so let's use Supabase REST API with the anon key

const https = require('https');
const fs = require('fs');
const path = require('path');
const passwordHash = require('password-hash');

const envPath = path.join(__dirname, '.env', 'development.env');
const envContent = fs.readFileSync(envPath, 'utf8').replace(/\r/g, '');
const env = {};
envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) env[parts[0].trim()] = parts.slice(1).join('=').trim();
});

const supabaseUrl = env.SUPABASE_URL;
const anonKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANOYN_KEY;

const pwd = passwordHash.generate('password123');

const users = [
    { email: 'admin@medcyivf.com', password_hash: pwd, name: 'Admin User', role: 'Admin' },
    { email: 'doctor@medcyivf.com', password_hash: pwd, name: 'Dr. B. Sireesha Rani', role: 'Doctor' },
    { email: 'frontdesk@medcyivf.com', password_hash: pwd, name: 'Front Desk User', role: 'Receptionist' },
    { email: 'cro@medcyivf.com', password_hash: pwd, name: 'CRO User', role: 'CRO' },
    { email: 'nurse@medcyivf.com', password_hash: pwd, name: 'Nurse User', role: 'Nurse' },
];

async function seedViaRestApi() {
    for (const user of users) {
        const body = JSON.stringify(user);
        const url = new URL(`${supabaseUrl}/rest/v1/sakhi_clinic_users`);

        try {
            const resp = await fetch(url.toString(), {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'apikey': anonKey,
                    'Authorization': `Bearer ${anonKey}`,
                    'Prefer': 'return=representation'
                },
                body: body
            });

            if (resp.ok) {
                const data = await resp.json();
                console.log(`✅ ${user.role} -> ${user.email}`);
            } else {
                const err = await resp.text();
                console.log(`❌ ${user.role} (${resp.status}): ${err}`);
            }
        } catch (e) {
            console.log(`❌ ${user.role}: ${e.message}`);
        }
    }
}

seedViaRestApi();
