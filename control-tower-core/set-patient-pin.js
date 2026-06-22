const bcrypt = require('bcrypt');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("Missing SUPABASE_URL or SUPABASE_KEY in .env");
    process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function setPin(mobile, pin) {
    console.log(`Setting PIN for mobile: ${mobile}`);
    const saltRounds = 10;
    const pinHash = await bcrypt.hash(pin, saltRounds);

    // Step 1: See if the patient exists at all
    const { data: searchData, error: searchError } = await supabase
        .from('sakhi_clinic_patients')
        .select('id, name, mobile')
        .eq('mobile', mobile);

    if (searchError) {
        return console.error("Error searching for patient:", searchError.message);
    }
    
    if (!searchData || searchData.length === 0) {
        console.error(`Database check: No records exist in sakhi_clinic_patients for mobile: ${mobile}`);
        return;
    }

    console.log(`Found ${searchData.length} patient(s) with this mobile number. Proceeding to update...`);

    // Step 2: Attempt the update
    const { data, error } = await supabase
        .from('sakhi_clinic_patients')
        .update({ pin_hash: pinHash })
        .eq('mobile', mobile)
        .select('id, name, mobile');

    if (error) {
        console.error("Error during update:", error.message);
    } else if (!data || data.length === 0) {
        console.error("The update command affected 0 rows. This usually means Row Level Security (RLS) blocked the update because you are using an anon key instead of a service_role key.");
    } else {
        console.log(`Successfully set PIN for ${data.length} patient record(s)!`);
        data.forEach(p => console.log(` - ${p.name}`));
    }
}

const mobile = process.argv[2];
const pin = process.argv[3];

if (!mobile || !pin) {
    console.log("Usage: node set-patient-pin.js <mobile_number> <4_digit_pin>");
    console.log("Example: node set-patient-pin.js 9876543210 1234");
    process.exit(1);
}

setPin(mobile, pin);
