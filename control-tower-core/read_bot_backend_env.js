const fs = require('fs');
const path = 'c:\\Users\\adrad\\OneDrive\\Desktop\\bot_backend\\.env';
if (fs.existsSync(path)) {
    console.log(fs.readFileSync(path, 'utf8'));
} else {
    console.log('File does not exist');
}
