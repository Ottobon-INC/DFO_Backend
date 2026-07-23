const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
    const { data, error } = await supabase
        .from('sakhi_clinic_users')
        .select('id, name, specialization, role')
        .in('role', ['Doctor', 'Superadmin', 'Admin'])
        .order('name');
        
    if (error) {
        console.error("SUPABASE ERROR:", error);
    } else {
        console.log("SUCCESS:", data.length);
    }
}

test();
