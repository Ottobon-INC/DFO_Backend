const fs = require('fs');

const envFiles = [
  'c:\\Users\\adrad\\OneDrive\\Desktop\\bot_backend\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\clinic_DFO\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\DFO\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\DFO-1\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\DFO-1\\.env.local',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\dfo-clinical-operations-dashboard\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\DFO-Janmasethu\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\DFO-V.3\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\digital_office\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\divya\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\divya\\DFO-V1\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\framework\\control-tower-core\\.env\\development.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\framework\\frontend\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\Janmasethu\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\Janmasethu\\support_system\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\Janmasethu\\whatsapp_chatbot\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\Janmasethu_trust\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\knowledge\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\Knowledge-hub_Automation\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\kumar-hospital-bot\\.env.local',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\KumarOrtho\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\KumarOrtho\\.env.local',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\landing page\\backend\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\Medcy\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\mezi-health-pkg\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\page\\.env.local',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\registrations\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\swamy\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\talent-ops-ravindra\\.env',
  'c:\\Users\\adrad\\OneDrive\\Desktop\\test_bot\\.env'
];

for (const file of envFiles) {
    if (!fs.existsSync(file)) continue;
    try {
        const content = fs.readFileSync(file, 'utf8');
        const lines = content.split('\n');
        let matched = false;
        const matches = [];
        for (const line of lines) {
            if (line.includes('kaaxkycrhkefylynkupy') || line.includes('SERVICE_ROLE') || line.includes('SUPABASE_KEY')) {
                matches.push(line.trim());
                matched = true;
            }
        }
        if (matched) {
            console.log(`File: ${file}`);
            matches.forEach(m => console.log(`  ${m}`));
        }
    } catch (e) {
        // ignore
    }
}
