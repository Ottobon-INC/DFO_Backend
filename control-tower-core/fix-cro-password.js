const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
const fs = require('fs');
const path = require('path');

// Load environment variables manually
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
} catch (e) {
    console.warn('Failed to load local env file');
}

async function fixPassword() {
    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase URL or Key');
        process.exit(1);
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    try {
        const newHash = await bcrypt.hash('Temporary123!', 10);
        console.log('Generated new bcrypt hash:', newHash);
        
        const { data, error } = await supabase
            .from('sakhi_clinic_users')
            .update({ password_hash: newHash })
            .eq('email', 'cro@medcyivf.com');
            
        if (error) {
            console.error('Failed to update password in DB:', error);
        } else {
            console.log('Successfully updated cro@medcyivf.com with a valid bcrypt hash!');
        }
    } catch (e) {
        console.error('Error:', e);
    }
}

fixPassword();
