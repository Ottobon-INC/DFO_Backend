const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_KEY;

try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf8');
        envContent.split('\n').forEach(line => {
            const parts = line.split('=');
            if (parts.length === 2) {
                const key = parts[0].trim();
                const value = parts[1].trim();
                if (key === 'SUPABASE_URL') supabaseUrl = value;
                if (key === 'SUPABASE_KEY') supabaseKey = value;
            }
        });
    }
} catch (e) {}

async function checkUser() {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: users, error } = await supabase
        .from('sakhi_clinic_users').select('*').eq('email', 'cro@medcyivf.com');
        
    console.log('Error:', error);
    console.log('Users found:', users?.length);
    
    if (users && users.length > 0) {
        for (const user of users) {
            console.log(`User ID: ${user.id}, Role: ${user.role}`);
            const isMatch = await bcrypt.compare('Temporary123!', user.password_hash);
            console.log(`Password Match? ${isMatch}`);
        }
    }
}

checkUser();
