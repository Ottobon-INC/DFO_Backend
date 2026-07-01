const fs = require('fs');

const envFiles = [
  'c:\\Users\\adrad\\OneDrive\\Desktop\\knowledge\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\Knowledge-hub_Automation\\.env',
];

for (const file of envFiles) {
    if (!fs.existsSync(file)) continue;
    try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        console.log(`File: ${file}`);
        for (const line of lines) {
            if (line.includes('SUPABASE_KEY') || line.includes('SUPABASE_URL') || line.includes('SUPABASE_SERVICE')) {
                console.log(`  Line: ${line.trim()}`);
            }
        }
    } catch (e) {
        // ignore
    }
}
