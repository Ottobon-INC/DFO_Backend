const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables manually if they exist, otherwise use process.env
let supabaseUrl = process.env.SUPABASE_URL;
let supabaseKey = process.env.SUPABASE_KEY;

try {
    const envPath = path.join(__dirname, '.env', 'development.env');
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
    console.warn('Failed to load local env file, using process.env');
}

if (!supabaseUrl || !supabaseKey) {
    supabaseUrl = supabaseUrl || 'https://dummy.supabase.co';
    supabaseKey = supabaseKey || 'dummy-key';
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkTables() {
    const tables = [
        'conversation_threads',
        'conversation_messages',
        'dfo_patients',
        'dfo_risk_logs',
        'dfo_summaries',
        'dfo_clinician_workload',
        'dfo_appointments',
        'dfo_consultations',
        'dfo_notification_logs',
        'dfo_prescriptions',
        'dfo_medical_reports',
        'dfo_doctors',
        'dfo_availability_slots',
        'audit_logs',
        'routing_events'
    ];

    console.log('Checking for required tables and data...');
    for (const table of tables) {
        const { count, error } = await supabase.from(table).select('*', { count: 'exact', head: true });
        if (error) {
            console.log(`❌ Table '${table}' error: ${error.message}`);
        } else {
            console.log(`✅ Table '${table}' exists. Rows: ${count}`);
        }
    }

    console.log('\n--- Sample Data Verification ---');
    const { data: appData } = await supabase.from('dfo_appointments').select('*').limit(1);
    console.log('Sample Appointment:', JSON.stringify(appData?.[0], null, 2));

    const { data: conData } = await supabase.from('dfo_consultations').select('*').limit(1);
    console.log('Sample Consultation:', JSON.stringify(conData?.[0], null, 2));
}

checkTables();
