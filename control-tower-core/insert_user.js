const { createClient } = require('@supabase/supabase-js');
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

const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
const supabase = createClient(env.SUPABASE_URL, key);

async function run() {
    const pwdHash = passwordHash.generate('password123');
    const users = [
        {
            email: 'doctor@medcyivf.com',
            password_hash: pwdHash,
            name: 'Dr. Sireesha',
            role: 'Doctor'
        },
        {
            email: 'cro@medcyivf.com',
            password_hash: pwdHash,
            name: 'CRO Desk User',
            role: 'CRO'
        },
        {
            email: 'frontdesk@medcyivf.com',
            password_hash: pwdHash,
            name: 'Front Desk Assistant',
            role: 'Receptionist'
        },
        {
            email: 'admin@medcyivf.com',
            password_hash: pwdHash,
            name: 'System Admin',
            role: 'Admin'
        },
        {
            email: 'nurse@medcyivf.com',
            password_hash: pwdHash,
            name: 'Nurse Divya',
            role: 'Nurse'
        }
    ];
    
    console.log('Inserting users...');
    const { data, error } = await supabase
        .from('sakhi_clinic_users')
        .upsert(users, { onConflict: 'email' })
        .select();
        
    if (error) {
        console.error('Error inserting users:', error);
    } else {
        console.log('Inserted successfully:', data);
    }
}

run();
