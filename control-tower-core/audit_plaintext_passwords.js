require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment variables.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function auditPlaintextPasswords() {
    console.log('--- Starting Plaintext Password Audit ---\n');

    let issuesFound = 0;

    // 1. Check sakhi_clinic_users
    console.log('Auditing [sakhi_clinic_users] table...');
    const { data: users, error: usersError } = await supabase
        .from('sakhi_clinic_users')
        .select('id, email, password_hash');

    if (usersError) {
        console.error('Error fetching users:', usersError);
    } else {
        const vulnerableUsers = users.filter(u => u.password_hash && !u.password_hash.startsWith('sha1$'));
        console.log(`Found ${vulnerableUsers.length} users with plaintext/invalid password hashes.`);
        if (vulnerableUsers.length > 0) {
            issuesFound += vulnerableUsers.length;
            console.table(vulnerableUsers.map(u => ({ id: u.id, email: u.email })));
        }
    }

    // 2. Check super_admins
    console.log('\nAuditing [super_admins] table...');
    const { data: admins, error: adminsError } = await supabase
        .from('super_admins')
        .select('id, email, password_hash');

    if (adminsError) {
        console.error('Error fetching super admins:', adminsError);
    } else {
        const vulnerableAdmins = admins.filter(a => a.password_hash && !a.password_hash.startsWith('sha1$'));
        console.log(`Found ${vulnerableAdmins.length} super admins with plaintext/invalid password hashes.`);
        if (vulnerableAdmins.length > 0) {
            issuesFound += vulnerableAdmins.length;
            console.table(vulnerableAdmins.map(a => ({ id: a.id, email: a.email })));
        }
    }

    // 3. Check patients for plaintext PINs
    console.log('\nAuditing [patients] table for plaintext PINs...');
    // Assuming bcrypt is used for patients (starts with $2b$ or $2a$)
    const { data: patients, error: patientsError } = await supabase
        .from('patients')
        .select('id, phone, pin_hash');

    if (patientsError) {
        console.error('Error fetching patients:', patientsError);
    } else {
        const vulnerablePatients = patients.filter(p => p.pin_hash && !p.pin_hash.startsWith('$2'));
        console.log(`Found ${vulnerablePatients.length} patients with plaintext/invalid PIN hashes.`);
        if (vulnerablePatients.length > 0) {
            issuesFound += vulnerablePatients.length;
            console.table(vulnerablePatients.map(p => ({ id: p.id, phone: p.phone })));
        }
    }

    console.log('\n--- Audit Complete ---');
    if (issuesFound > 0) {
        console.error(`\n⚠️ WARNING: Found ${issuesFound} accounts with plaintext passwords/PINs.`);
        console.error('These accounts will NOT be able to log in until their passwords are force-reset by an admin.');
    } else {
        console.log('\n✅ All checked accounts appear to have properly hashed passwords.');
    }
}

auditPlaintextPasswords();
