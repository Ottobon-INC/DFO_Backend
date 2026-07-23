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
                if (key === 'SUPABASE_SERVICE_ROLE_KEY') supabaseKey = value;
            }
        });
    }
} catch (e) {}

async function insertUser() {
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    // First, find the medcyivf clinic id
    const { data: clinic } = await supabase.from('sakhi_clinics').select('id').ilike('name', '%medcy%').limit(1).single();
    let clinic_id = clinic?.id;

    if (!clinic_id) {
        console.log("No clinic found, getting any clinic");
        const { data: anyClinic } = await supabase.from('sakhi_clinics').select('id').limit(1).single();
        clinic_id = anyClinic?.id;
    }

    const pwd = await bcrypt.hash('Temporary123!', 10);
    
    const { data, error } = await supabase
        .from('sakhi_clinic_users')
        .upsert([{ 
            email: 'cro@medcyivf.com', 
            password_hash: pwd, 
            name: 'CRO User', 
            role: 'CRO',
            clinic_id: clinic_id 
        }], { onConflict: 'email' })
        .select();
        
    console.log('Error:', error);
    console.log('User created:', data);
}

insertUser();
