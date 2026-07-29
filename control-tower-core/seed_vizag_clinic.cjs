const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcrypt');

// Load env from dfo-backend
const envPath = 'c:/Users/adrad/OneDrive/Desktop/dfo-backend/control-tower-core/.env';
const envContent = fs.readFileSync(envPath, 'utf8');
const env = {};
envContent.split('\n').forEach(line => {
    const parts = line.split('=');
    if (parts.length >= 2) {
        env[parts[0].trim()] = parts.slice(1).join('=').trim();
    }
});

const url = env.SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_KEY;
console.log('Connecting to:', url);
const supabase = createClient(url, key);

async function run() {
    // Step 1: Check if HQ clinic exists, or create it
    console.log('\n1. Looking for existing clinic...');
    let { data: clinics, error: clinicErr } = await supabase
        .from('clinics')
        .select('id, name')
        .eq('is_active', true)
        .limit(5);

    if (clinicErr) {
        console.error('Error fetching clinics:', clinicErr);
        return;
    }

    console.log('Existing clinics:', clinics);

    let clinicId;
    if (clinics && clinics.length > 0) {
        clinicId = clinics[0].id;
        console.log(`Using existing clinic: ${clinics[0].name} (${clinicId})`);
    } else {
        const { data: newClinic, error: newErr } = await supabase
            .from('clinics')
            .insert([{
                name: 'Janmasethu Fertility Centre - Vizag',
                address: 'Dwaraka Nagar, Visakhapatnam, Andhra Pradesh 530016',
                contact_phone: '+91-891-2755555',
                contact_email: 'vizag@janmasethu.com',
                working_hours: 'Monday–Saturday: 8:00 AM – 6:00 PM',
                departments: ['Fertility', 'Obstetrics', 'Gynaecology'],
                is_active: true,
                greeting: 'Welcome to Janmasethu Fertility Centre Vizag. How can I assist you today?'
            }])
            .select();

        if (newErr) {
            console.error('Error creating clinic:', newErr);
            return;
        }
        clinicId = newClinic[0].id;
        console.log('Created new clinic:', newClinic[0].name, clinicId);
    }

    // Step 2: Check clinics_coverage table
    console.log('\n2. Checking clinics_coverage for Vizag...');
    const { data: existing, error: covErr } = await supabase
        .from('clinics_coverage')
        .select('*')
        .eq('clinic_id', clinicId)
        .limit(5);

    if (covErr) {
        console.error('Error fetching coverage:', covErr.message);
    } else {
        console.log('Existing coverage rows:', existing);
    }

    // Step 3: Insert Vizag coverage entries
    console.log('\n3. Inserting Vizag coverage entries...');
    const vizagPins = [
        { zip_code: '530001', district: 'Visakhapatnam', state: 'Andhra Pradesh', coverage_area: 'Visakhapatnam, Vizag' },
        { zip_code: '530002', district: 'Visakhapatnam', state: 'Andhra Pradesh', coverage_area: 'Visakhapatnam, Vizag' },
        { zip_code: '530016', district: 'Visakhapatnam', state: 'Andhra Pradesh', coverage_area: 'Dwaraka Nagar, Visakhapatnam' },
        { zip_code: '530003', district: 'Visakhapatnam', state: 'Andhra Pradesh', coverage_area: 'Visakhapatnam, Vizag' },
        { zip_code: '530004', district: 'Visakhapatnam', state: 'Andhra Pradesh', coverage_area: 'Visakhapatnam, Vizag' },
    ];

    for (const pin of vizagPins) {
        const { data: dup } = await supabase
            .from('clinics_coverage')
            .select('id')
            .eq('clinic_id', clinicId)
            .eq('zip_code', pin.zip_code)
            .maybeSingle();

        if (dup) {
            console.log(`  Coverage for PIN ${pin.zip_code} already exists, skipping.`);
            continue;
        }

        const { data: ins, error: insErr } = await supabase
            .from('clinics_coverage')
            .insert([{
                clinic_id: clinicId,
                zip_code: pin.zip_code,
                district: pin.district,
                state: pin.state,
                coverage_area: pin.coverage_area,
                is_available: true,
                partner_rank: 5,
                specialities: ['IVF', 'IUI', 'Fertility', 'PCOS', 'Obstetrics', 'Gynaecology']
            }])
            .select();

        if (insErr) {
            console.error(`  Error inserting ${pin.zip_code}:`, insErr.message);
        } else {
            console.log(`  ✓ Inserted coverage for PIN ${pin.zip_code}`);
        }
    }

    // Step 4: Seed a doctor for this clinic
    console.log('\n4. Checking for doctors at this clinic...');
    const { data: doctors } = await supabase
        .from('sakhi_clinic_users')
        .select('id, first_name, last_name')
        .eq('clinic_id', clinicId)
        .eq('role', 'doctor');

    if (doctors && doctors.length > 0) {
        console.log('Doctors already exist:', doctors.map(d => `${d.first_name} ${d.last_name}`));
    } else {
        const hash = await bcrypt.hash('password123', 10);
        const { data: newDoc, error: docErr } = await supabase
            .from('sakhi_clinic_users')
            .insert([{
                clinic_id: clinicId,
                first_name: 'Dr. Priya',
                last_name: 'Sharma',
                email: 'priya.sharma@janmasethu.com',
                password_hash: hash,
                role: 'Doctor',
                specialization: 'Fertility Specialist & IVF Expert',
                designation: 'Senior Fertility Consultant',
                is_available: true
            }])
            .select();

        if (docErr) {
            console.error('Error creating doctor:', docErr.message);
        } else {
            console.log('Created doctor:', `${newDoc[0].first_name} ${newDoc[0].last_name}`);
        }
    }

    console.log('\nDone! Vizag clinic seeding complete.');
}

run().catch(console.error);
