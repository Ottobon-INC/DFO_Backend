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
    console.log('Signing up user via Supabase Auth...');
    const email = 'doctor@medcyivf.com';
    const password = 'password123';
    
    const { data, error } = await supabase.auth.signUp({
        email: email,
        password: password,
        options: {
            data: {
                name: 'Dr. Sireesha Rani',
                role: 'doctor'
            }
        }
    });
    
    if (error) {
        console.error('Signup error:', error.message);
    } else {
        console.log('Signup successful! Data:', data);
    }
}

run();
