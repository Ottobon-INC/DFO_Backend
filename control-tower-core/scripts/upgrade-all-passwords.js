const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');
require('dotenv').config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

async function upgradeAllPasswords() {
    if (!supabaseUrl || !supabaseKey) {
        console.error('Missing Supabase URL or Key');
        process.exit(1);
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);
    
    try {
        console.log("Generating bcrypt hash for 'Temporary123!'...");
        const newHash = await bcrypt.hash('Temporary123!', 10);
        
        console.log("Upgrading all sakhi_clinic_users with old sha1 passwords...");
        const { data: users, error: usersError } = await supabase
            .from('sakhi_clinic_users')
            .select('id, email, password_hash')
            .like('password_hash', 'sha1$%');

        if (usersError) throw usersError;

        if (users.length === 0) {
            console.log("No clinic users found with sha1 passwords.");
        } else {
            for (const user of users) {
                await supabase.from('sakhi_clinic_users').update({ password_hash: newHash }).eq('id', user.id);
                console.log(`Updated clinic user: ${user.email}`);
            }
        }

        console.log("\nUpgrading all super_admins with old sha1 passwords...");
        const { data: admins, error: adminsError } = await supabase
            .from('super_admins')
            .select('id, email, password_hash')
            .like('password_hash', 'sha1$%');

        if (adminsError) throw adminsError;

        if (admins.length === 0) {
            console.log("No super admins found with sha1 passwords.");
        } else {
            for (const admin of admins) {
                await supabase.from('super_admins').update({ password_hash: newHash }).eq('id', admin.id);
                console.log(`Updated super admin: ${admin.email}`);
            }
        }

        console.log("\nAll legacy passwords have been reset to 'Temporary123!'");

    } catch (e) {
        console.error('Error:', e);
    }
}

upgradeAllPasswords();
