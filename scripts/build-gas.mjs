// Copies the single-file phone build into the Apps Script project as Index.html.
import { copyFileSync, statSync } from 'node:fs';

copyFileSync('dist-gas/index.html', 'apps-script/Index.html');
const kb = Math.round(statSync('apps-script/Index.html').size / 1024);
console.log(`apps-script/Index.html written (${kb} KB). Push it with: cd apps-script && npx @google/clasp push`);
