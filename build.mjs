// Unisce public/index.html dentro il Worker: un solo file da pubblicare (dist/worker.js)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const html = readFileSync('public/index.html', 'utf8');
const src0 = readFileSync('src/worker.js', 'utf8');
import { createHash } from 'node:crypto';
const VER = createHash('sha256').update(html + src0).digest('hex').slice(0, 12);
const src = src0.replace('"__VER__"', JSON.stringify(VER));
if (!src.includes('"__HTML__"')) throw new Error('segnaposto mancante');
mkdirSync('dist', { recursive: true });
writeFileSync('dist/worker.js', src.replace('"__HTML__"', () => JSON.stringify(html.replace('__VER__', VER))));
console.log('dist/worker.js', (readFileSync('dist/worker.js').length / 1024).toFixed(1), 'KB');
