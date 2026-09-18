import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve('c:/Users/adrad/OneDrive/Desktop/framework/control-tower-core/.env/development.env') });

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!);

async function check() {
    const { data: cols, error } = await supabase.rpc('get_table_columns', { table_name: 'dfo_risk_logs' });
    if (error) {
        // Fallback: try to select one row
        const { data, error: err } = await supabase.from('dfo_risk_logs').select('*').limit(1);
        if (err) console.error('Table error:', err);
        else console.log('Table exists, row:', data);
    } else {
        console.log('Columns:', cols);
    }
}
check();
