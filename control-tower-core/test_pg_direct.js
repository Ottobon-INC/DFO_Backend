const { Client } = require('pg');

const connectionString = 'postgresql://postgres:Narayanaswamy%403152@db.kaaxkycrhkefylynkupy.supabase.co:5432/postgres';

const client = new Client({
  connectionString: connectionString,
});

async function run() {
  try {
    await client.connect();
    console.log('Connected to PostgreSQL successfully!');
    
    const res = await client.query('SELECT * FROM sakhi_clinic_appointments');
    console.log('Appointments count:', res.rows.length);
    console.log('Appointments sample:', res.rows);
    
  } catch (err) {
    console.error('Connection/Query error:', err);
  } finally {
    await client.end();
  }
}

run();
