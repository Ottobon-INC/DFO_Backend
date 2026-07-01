const fs = require('fs');
const path = require('path');

const desktopPath = 'c:\\Users\\adrad\\OneDrive\\Desktop';
const results = [];

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
                const ext = path.extname(file).toLowerCase();
                if (ext === '.txt' || ext === '.md' || ext === '.js' || ext === '.ts' || ext === '.json' || file.startsWith('.')) {
                    try {
                        const content = fs.readFileSync(fullPath, 'utf8');
                        if (content.includes('kaaxkycrhkefylynkupy')) {
                            results.push(fullPath);
                        }
                    } catch (e) {
                        // ignore
                    }
                }
            }
        }
    } catch (e) {
        // ignore errors
    }
}

search(desktopPath);
console.log('Found occurrences in files:');
console.log(results);
