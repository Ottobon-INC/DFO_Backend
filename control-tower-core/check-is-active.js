const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
    console.log("Checking clinics");
    const { data: clinics, error: e1 } = await supabase.from('clinics').select('is_active').limit(1);
    console.log(e1 ? e1 : "Clinics is_active exists: " + (clinics.length >= 0 ? true : false));

    console.log("Checking sakhi_clinic_users");
    const { data: users, error: e2 } = await supabase.from('sakhi_clinic_users').select('is_active').limit(1);
    console.log(e2 ? e2 : "Users is_active exists: " + (users.length >= 0 ? true : false));
}
check();
