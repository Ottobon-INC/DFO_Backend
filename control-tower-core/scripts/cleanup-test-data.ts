import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Error: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env file.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function cleanup() {
  console.log('\n🧹 Starting Cleanup of Load Test Data...\n');

  // Find all "Load Test Clinic" entries
  const { data: testClinics, error: fetchError } = await supabase
    .from('clinics')
    .select('id, name')
    .like('name', 'Load Test Clinic%');

  if (fetchError) {
    console.error('❌ Error fetching test clinics:', fetchError);
    return;
  }

  if (!testClinics || testClinics.length === 0) {
    console.log('✅ No load test clinics found. Database is already clean!');
    return;
  }

  console.log(`Found ${testClinics.length} load test clinic(s) to remove:\n`);
  for (const clinic of testClinics) {
    console.log(`  🏢 ${clinic.name} (${clinic.id})`);
  }

  const clinicIds = testClinics.map((c: any) => c.id);

  // Delete patients belonging to test clinics
  const { count: pCount, error: pError } = await supabase
    .from('sakhi_clinic_patients')
    .delete({ count: 'exact' })
    .in('clinic_id', clinicIds);
  if (pError) console.error('❌ Error deleting patients:', pError);
  else console.log(`\n🗑️  Deleted ${pCount ?? 0} test patients`);

  // Delete documents belonging to test clinics
  const { count: dCount, error: dError } = await supabase
    .from('sakhi_clinic_documents')
    .delete({ count: 'exact' })
    .in('clinic_id', clinicIds);
  if (dError) console.error('❌ Error deleting documents:', dError);
  else console.log(`🗑️  Deleted ${dCount ?? 0} test documents`);

  // Finally, delete the test clinics themselves (CASCADE will handle any remaining FK refs)
  const { count: cCount, error: cError } = await supabase
    .from('clinics')
    .delete({ count: 'exact' })
    .in('id', clinicIds);
  if (cError) console.error('❌ Error deleting clinics:', cError);
  else console.log(`🗑️  Deleted ${cCount ?? 0} test clinic(s)`);

  console.log('\n✅ Cleanup Complete! Your database is clean.\n');
}

cleanup().catch(console.error);
