// Unisce public/index.html e le icone dentro il Worker: un solo file da pubblicare (dist/worker.js)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const html = readFileSync('public/index.html', 'utf8');
const staff = readFileSync('public/staff.html', 'utf8');
const src0 = readFileSync('src/worker.js', 'utf8');
const icona = n => 'data:image/png;base64,' + readFileSync(`public/icona-${n}.png`).toString('base64');
const ICONE = { i192: icona(192), i512: icona(512), imask: icona('maskable') };
const VER = createHash('sha256').update(html + staff + src0 + JSON.stringify(ICONE)).digest('hex').slice(0, 12);
let src = src0.replace('"__VER__"', JSON.stringify(VER)).replace('"__ICONE__"', JSON.stringify(ICONE));
if (!src.includes('"__HTML__"') || !src.includes('"__HTML_STAFF__"')) throw new Error('segnaposto mancante');
mkdirSync('dist', { recursive: true });
src = src.replace('"__HTML__"', () => JSON.stringify(html.replace(/__VER__/g, VER).replace('__ICONA192__', ICONE.i192)));
src = src.replace('"__HTML_STAFF__"', () => JSON.stringify(staff.replace(/__VER__/g, VER)));
writeFileSync('dist/worker.js', src);
console.log('dist/worker.js', (readFileSync('dist/worker.js').length / 1024).toFixed(1), 'KB');
