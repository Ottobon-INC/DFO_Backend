const { Client } = require('pg');
const fs = require('fs');
require('dotenv').config();

const connectionString = 'postgresql://postgres:Narayanaswamy%403152@db.kaaxkycrhkefylynkupy.supabase.co:5432/postgres';

const client = new Client({
  connectionString: connectionString,
});

async function run() {
  try {
    await client.connect();
    console.log('Reading migration file...');
    const sql = fs.readFileSync('db/028_add_name_to_rooms.sql', 'utf8');
    
    console.log('Executing migration 028...');
    await client.query(sql);
    console.log('Migration executed successfully!');
  } catch (err) {
    console.error('Connection/Query error:', err);
  } finally {
    await client.end();
  }
}

run();
