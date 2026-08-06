require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env");
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createSuperAdmin() {
    const name = 'Admin User'; // Change if needed
    const email = 'admin@medcyivf.com'; // Change to your desired email
    const plainPassword = 'Temporary123!'; 

    console.log(`Creating super admin for: ${email}`);

    try {
        const password_hash = await bcrypt.hash(plainPassword, 10);

        const { data, error } = await supabase
            .from('super_admins')
            .insert([{ 
                name, 
                email, 
                password_hash 
            }])
            .select()
            .single();

        if (error) {
            if (error.code === '23505') {
                console.log(`\nUser ${email} already exists in super_admins table.`);
            } else {
                console.error('\nError creating super admin:', error.message);
            }
        } else {
            console.log('\n✅ Super Admin created successfully!');
            console.log(`Email: ${email}`);
            console.log(`Password: ${plainPassword}`);
        }
    } catch (err) {
        console.error('Unexpected error:', err);
    }
}

createSuperAdmin();
