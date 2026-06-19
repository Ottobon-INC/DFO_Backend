const { createClient } = require('@supabase/supabase-js');
const passwordHash = require('password-hash');

const supabaseUrl = 'https://kaaxkycrhkefylynkupy.supabase.co';

const keys = {
    'knowledge': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3NzI3MTQzNzMsImV4cCI6MjA4ODA3NDM3M30.NFdQ81nDcu4UNsCVdDWIALerkTwyvb_O9pLe6HpAgy4',
    'knowledge_hub': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZoZWRwdWNvd2JqYWJnaWtseWVhIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3MTk4OTQzNywiZXhwIjoyMDg3NTY1NDM3fQ._RBmUFpQgwSrTOnuB6A9w_W4jaD80Seaqd8ydV1tIk8'
};

const pwdHash = passwordHash.generate('password123');
const userToInsert = {
    email: 'cro.desk@sakhiclinic.com',
    password_hash: pwdHash,
    name: 'CRO Desk User',
    role: 'CRO'
};

async function run() {
    for (const [name, key] of Object.entries(keys)) {
        console.log(`\nTrying key from: ${name}...`);
        const supabase = createClient(supabaseUrl, key);
        try {
            const { data, error } = await supabase
                .from('sakhi_clinic_users')
                .upsert([userToInsert], { onConflict: 'email' })
                .select();
                
            if (error) {
                console.error(`Error with key ${name}:`, error.message);
            } else {
                console.log(`SUCCESS with key ${name}! Inserted/Upserted user:`, data);
            }
        } catch (e) {
            console.error(`Exception with key ${name}:`, e.message);
        }
    }
}

run();
