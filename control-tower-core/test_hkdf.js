const crypto = require('crypto');
const mk = Buffer.from('474febc8d3b39cd7b94bc38f1a8d4534a6ad2a520aa813d848330c5bd88f6a4cf', 'utf8');
const k = crypto.hkdfSync('sha256', mk, Buffer.from('524ed56e-96df-43bc-bd9e-65c4bb9ec811', 'utf8'), Buffer.from('chat', 'utf8'), 32);
console.log('JS HKDF Key:', Buffer.from(k).toString('hex'));
