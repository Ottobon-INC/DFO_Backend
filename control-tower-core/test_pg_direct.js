const { Client } = require('pg');

const connectionString = 'postgresql://postgres:Narayanaswamy%403152@db.kaaxkycrhkefylynkupy.supabase.co:5432/postgres';

const client = new Client({
  connectionString: connectionString,
});

async function run() {
  try {
    await client.connect();
    console.log('Reloading schema cache...');
    await client.query("NOTIFY pgrst, 'reload schema'");
    console.log('Schema cache reloaded successfully!');
  } catch (err) {
    console.error('Connection/Query error:', err);
  } finally {
    await client.end();
  }
}

run();
