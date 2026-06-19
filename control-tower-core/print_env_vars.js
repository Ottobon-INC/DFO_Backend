console.log('--- ENV KEYS ---');
for (const [key, val] of Object.entries(process.env)) {
    if (key.includes('SUPABASE') || key.includes('SERVICE') || key.includes('KEY')) {
        console.log(`${key}=${val ? val.substring(0, 15) + '...' : ''}`);
    }
}
