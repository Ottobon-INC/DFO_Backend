const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const passwordHash = require('password-hash');

const envPath = path.join(__dirname, '.env');
const envContent = fs.readFileSync(envPath, 'utf8').replace(/\r/g, '');
const env = {};
envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) env[parts[0].trim()] = parts.slice(1).join('=').trim();
});

const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
const supabase = createClient(env.SUPABASE_URL, key);

async function seed() {
    const pwd = passwordHash.generate('password123');
    
    const users = [
        { email: 'admin@medcyivf.com', password_hash: pwd, first_name: 'Admin', last_name: 'User', role: 'Admin' },
        { email: 'doctor@medcyivf.com', password_hash: pwd, first_name: 'Dr. B. Sireesha', last_name: 'Rani', role: 'Doctor' },
        { email: 'frontdesk@medcyivf.com', password_hash: pwd, first_name: 'Front Desk', last_name: 'User', role: 'Receptionist' },
        { email: 'cro@medcyivf.com', password_hash: pwd, first_name: 'CRO', last_name: 'User', role: 'CRO' },
        { email: 'nurse@medcyivf.com', password_hash: pwd, first_name: 'Nurse', last_name: 'User', role: 'Nurse' },
    ];

    console.log('Seeding users into sakhi_clinic_users...');
    
    for (const user of users) {
        const { data, error } = await supabase
            .from('sakhi_clinic_users')
            .upsert([user], { onConflict: 'email' })
            .select();

        if (error) {
            console.log(`❌ Failed for ${user.role} (${user.email}):`, error.message);
        } else {
            console.log(`✅ ${user.role} -> ${user.email} (password: password123)`);
        }
    }
    
    // Verify
    const { data: all } = await supabase.from('sakhi_clinic_users').select('email, role, first_name, last_name');
    console.log('\nAll users now in database:', all);
}

seed();
