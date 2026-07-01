import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

// Load environment variables from the root .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file.');
  process.exit(1);
}

// Create a Supabase client with the Service Role key to bypass RLS
const supabase = createClient(supabaseUrl, supabaseKey);

async function runSeed() {
  console.log('\n🌱 Starting Database Seeding Process for Multi-Tenant Testing...');

  // 1. Create a Load Testing Clinic
  const clinicName = `Load Test Clinic - ${Date.now()}`;
  console.log(`\n🏢 Creating Clinic: ${clinicName}...`);
  const { data: clinicData, error: clinicError } = await supabase
    .from('clinics')
    .insert([{ name: clinicName, contact_email: 'admin@loadtestclinic.com', is_active: true }])
    .select()
    .single();

  if (clinicError || !clinicData) {
    console.error('❌ Failed to create clinic:', clinicError);
    return;
  }
  const clinicId = clinicData.id;
  console.log(`✅ Clinic Created Successfully!`);
  console.log(`🔥 SAVE THIS CLINIC ID FOR EXPLAIN QUERIES: ${clinicId}\n`);

  // 2. Insert 1000 Mock Patients
  console.log('👥 Generating 1000 Mock Patients...');
  const patients: any[] = [];
  for (let i = 0; i < 1000; i++) {
    patients.push({
      clinic_id: clinicId,
      uhid: `UHID-TEST-${i}`,
      name: `ScaleTest Patient${i}`,
      gender: i % 2 === 0 ? 'Male' : 'Female',
      mobile: `+1555${String(i).padStart(7, '0')}`,
      // Randomize created_at so the query planner has useful time-series data
      created_at: new Date(Date.now() - Math.floor(Math.random() * 10000000000)).toISOString()
    });
  }

  // Insert in chunks of 250
  for (let i = 0; i < patients.length; i += 250) {
    const chunk = patients.slice(i, i + 250);
    const { error: pError } = await supabase.from('sakhi_clinic_patients').insert(chunk);
    if (pError) {
      console.error('❌ Error inserting patients chunk:', pError);
    } else {
      console.log(`  -> Inserted patients ${i} to ${i + 250}`);
    }
  }
  console.log('✅ Patients Seeded!');

  // 3. Insert 1000 Mock Documents
  console.log('\n📄 Generating 1000 Mock Documents...');
  const documents: any[] = [];
  for (let i = 0; i < 1000; i++) {
    documents.push({
      clinic_id: clinicId,
      name: `load_test_doc_${i}.pdf`,
      file_path: `load_test/load_test_doc_${i}.pdf`,
      file_size: 1024 * (i % 10 + 1),
      mime_type: 'application/pdf',
      created_at: new Date(Date.now() - Math.floor(Math.random() * 10000000000)).toISOString()
    });
  }

  for (let i = 0; i < documents.length; i += 250) {
    const chunk = documents.slice(i, i + 250);
    const { error: dError } = await supabase.from('sakhi_clinic_documents').insert(chunk);
    if (dError) {
      console.error('❌ Error inserting documents chunk:', dError);
    } else {
      console.log(`  -> Inserted documents ${i} to ${i + 250}`);
    }
  }
  console.log('✅ Documents Seeded!');

  console.log('\n🎉 Seeding Complete!');
  console.log('========================================================================');
  console.log('🚀 READY FOR PERFORMANCE VERIFICATION!');
  console.log('Please run the following query in your Supabase SQL Editor:\n');
  console.log(`EXPLAIN ANALYZE`);
  console.log(`SELECT * FROM sakhi_clinic_patients`);
  console.log(`WHERE clinic_id = '${clinicId}'`);
  console.log(`ORDER BY created_at DESC LIMIT 50;\n`);
  console.log('========================================================================\n');
}

runSeed().catch(console.error);
