require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const passwordHash = require('password-hash');

const supabaseUrl = 'https://kaaxkycrhkefylynkupy.supabase.co';

const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!serviceRoleKey) {
    console.error("Missing SUPABASE_SERVICE_ROLE_KEY in .env file.");
    process.exit(1);
}

const pwdHash = passwordHash.generate('password123');
const userToInsert = {
    email: 'cro.desk@sakhiclinic.com',
    password_hash: pwdHash,
    name: 'CRO Desk User',
    role: 'CRO'
};

async function run() {
    console.log(`\nTrying insert with Service Role Key...`);
    const supabase = createClient(supabaseUrl, serviceRoleKey);
    try {
        const { data, error } = await supabase
            .from('sakhi_clinic_users')
            .upsert([userToInsert], { onConflict: 'email' })
            .select();
            
        if (error) {
            console.error(`Error during insert:`, error.message);
        } else {
            console.log(`SUCCESS! Inserted/Upserted user:`, data);
        }
    } catch (e) {
        console.error(`Exception during insert:`, e.message);
    }
}

run();
