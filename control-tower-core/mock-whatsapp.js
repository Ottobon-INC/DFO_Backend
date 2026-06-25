const express = require('express');
const app = express();
app.use(express.json());

app.post('/send', (req, res) => {
    console.log('\n======================================');
    console.log('💬 [MOCK WHATSAPP GATEWAY]');
    console.log('Message successfully delivered to:', req.body.userId);
    console.log('Message Content:');
    console.log('  ->', req.body.message);
    console.log('======================================\n');
    res.json({ success: true });
});

app.listen(4005, () => {
    console.log('✅ Mock WhatsApp Gateway listening on port 4005');
});
