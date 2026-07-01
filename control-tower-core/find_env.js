const fs = require('fs');
const path = require('path');

const desktopPath = 'c:\\Users\\adrad\\OneDrive\\Desktop';
const envFiles = [];

function search(dir, depth = 0) {
    if (depth > 3) return; // limit depth to prevent long searches
    try {
        const files = fs.readdirSync(dir);
        for (const file of files) {
            const fullPath = path.join(dir, file);
            let stat;
            try {
                stat = fs.statSync(fullPath);
            } catch (e) {
                continue;
            }
            if (stat.isDirectory()) {
                if (file !== 'node_modules' && file !== '.git' && file !== '.next') {
                    search(fullPath, depth + 1);
                }
            } else {
                if (file.toLowerCase().includes('.env')) {
                    envFiles.push(fullPath);
                }
            }
        }
    } catch (e) {
        // ignore errors
    }
}

search(desktopPath);
console.log('Found env files:');
console.log(envFiles);
