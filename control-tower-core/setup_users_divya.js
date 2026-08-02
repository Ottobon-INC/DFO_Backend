require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const bcrypt = require('bcrypt');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function setupAccounts() {
    const defaultPassword = 'Temporary123!';
    const password_hash = await bcrypt.hash(defaultPassword, 10);

    console.log("1. Creating Super Admin (divya@gmail.com)...");
    const { data: superAdmin, error: saError } = await supabase
        .from('super_admins')
        .insert([{ name: 'Divya', email: 'divya@gmail.com', password_hash }])
        .select()
        .single();

    if (saError) {
        if (saError.code === '23505') {
            console.log("   -> Super Admin divya@gmail.com already exists.");
        } else {
            console.error("   -> Error:", saError.message);
        }
    } else {
        console.log("   -> Super Admin created successfully.");
    }

    console.log("\n2. Fetching a Clinic ID to bind staff accounts to...");
    const { data: clinic, error: clinicError } = await supabase
        .from('clinics')
        .select('id, name')
        .limit(1)
        .single();

    if (clinicError || !clinic) {
        console.error("   -> Error finding a clinic! Make sure a clinic exists.", clinicError);
        return;
    }
    
    console.log(`   -> Found Clinic: ${clinic.name} (${clinic.id})`);

    const staffAccounts = [
        { first_name: 'Divya', last_name: 'CRO', email: 'cro.divya@medcyivf.com', role: 'CRO', is_active: true },
        { first_name: 'Divya', last_name: 'Doctor', email: 'doctor.divya@medcyivf.com', role: 'Doctor', is_active: true },
        { first_name: 'Divya', last_name: 'Nurse', email: 'nurse.divya@medcyivf.com', role: 'Nurse', is_active: true }
    ];

    console.log("\n3. Creating Staff Accounts...");
    for (const acc of staffAccounts) {
        const { error } = await supabase
            .from('sakhi_clinic_users')
            .insert([{ 
                first_name: acc.first_name,
                last_name: acc.last_name, 
                email: acc.email, 
                role: acc.role, 
                clinic_id: clinic.id, 
                password_hash,
                is_active: acc.is_active
            }]);

        if (error) {
            if (error.code === '23505') {
                console.log(`   -> ${acc.role} (${acc.email}) already exists.`);
            } else {
                console.error(`   -> Error creating ${acc.role}:`, error.message);
            }
        } else {
            console.log(`   -> ${acc.role} (${acc.email}) created successfully.`);
        }
    }

    console.log("\n✅ All accounts have been set up successfully with password: Temporary123!");
}

setupAccounts();
