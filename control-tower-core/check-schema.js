require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkSchema() {
    // If the table is empty, data will be [], but we can get columns using an rpc or intentionally failing query
    // Actually, we can just do a select and log the keys if there is data.
    // If no data, we can query the information_schema via a raw query if available, or just insert a fake row and roll back.
    // Better yet, just log the data to see if it's empty
    const { data: notes, error: err1 } = await supabase.from('sakhi_clinic_patient_notes').select('*').limit(1);
    console.log('Notes columns:', notes && notes.length > 0 ? Object.keys(notes[0]) : 'Empty, cannot infer columns');
    
    const { data: docs, error: err2 } = await supabase.from('sakhi_clinic_documents').select('*').limit(1);
    console.log('Docs columns:', docs && docs.length > 0 ? Object.keys(docs[0]) : 'Empty, cannot infer columns');
}
checkSchema();
