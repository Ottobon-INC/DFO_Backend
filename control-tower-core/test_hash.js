const crypto = require('crypto');
const h = crypto.createHmac('sha256', 'default_secret_pepper').update('7392123669').digest('hex');
console.log('7392123669', h);

const h2 = crypto.createHmac('sha256', 'default_secret_pepper').update('917392123669').digest('hex');
console.log('917392123669', h2);

const h3 = crypto.createHmac('sha256', 'default_secret_pepper').update('+917392123669').digest('hex');
console.log('+917392123669', h3);
