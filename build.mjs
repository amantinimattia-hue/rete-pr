// Unisce public/index.html dentro il Worker: un solo file da pubblicare (dist/worker.js)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync('public/index.html', 'utf8');
const src = readFileSync('src/worker.js', 'utf8');
if (!src.includes('"__HTML__"')) throw new Error('segnaposto mancante');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/worker.js', src.replace('"__HTML__"', () => JSON.stringify(html)));
console.log('dist/worker.js', (readFileSync('dist/worker.js').length / 1024).toFixed(1), 'KB');
