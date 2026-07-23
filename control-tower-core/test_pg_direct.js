const { Client } = require('pg');
const fs = require('fs');

const connectionString = 'postgresql://postgres:Narayanaswamy%403152@db.kaaxkycrhkefylynkupy.supabase.co:5432/postgres';

const client = new Client({
  connectionString: connectionString,
});

async function run() {
  try {
    await client.connect();
    
    console.log('Reading migration file...');
    const sql = fs.readFileSync('db/018_patient_timeline.sql', 'utf8');
    
    console.log('Executing migration 018 (V2)...');
    await client.query(sql);
    console.log('Migration executed successfully!');
    
    // Multi-tenant check
    console.log('Testing multi-tenant isolation...');
    const hqRes = await client.query("SELECT DISTINCT clinic_id FROM sakhi_clinic_appointments WHERE clinic_id IS NOT NULL LIMIT 1");
    const hqClinicId = hqRes.rows[0]?.clinic_id;
    if (hqClinicId) {
        const validRes = await client.query("SELECT COUNT(*) FROM patient_timeline_view WHERE clinic_id = $1", [hqClinicId]);
        console.log(`Results for valid clinic: ${validRes.rows[0].count} events`);
        const randomClinicId = '00000000-0000-0000-0000-000000000000';
        const fakeRes = await client.query("SELECT COUNT(*) FROM patient_timeline_view WHERE clinic_id = $1", [randomClinicId]);
        console.log(`Results for fake clinic: ${fakeRes.rows[0].count} events (Expected: 0)`);
    }
    
  } catch (err) {
    console.error('Connection/Query error:', err);
  } finally {
    await client.end();
  }
}

run();
