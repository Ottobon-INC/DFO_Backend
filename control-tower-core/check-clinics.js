const { createClient } = require('@supabase/supabase-js');
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

async function checkClinics() {
    const supabase = createClient(supabaseUrl, supabaseKey);
    const { data: clinics, error } = await supabase.from('sakhi_clinics').select('*');
        
    console.log('Clinics:', clinics);
}

checkClinics();
