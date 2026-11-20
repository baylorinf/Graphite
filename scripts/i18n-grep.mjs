// Dev helper: list UI strings (English, or another language) whose text matches a pattern.
//   node scripts/i18n-grep.mjs "claude|brain" [lang]
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
globalThis.document = { documentElement: {} };
const src = fs.readFileSync(new URL('../public/i18n.js', import.meta.url), 'utf8') + '\nexport { D };\n';
const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-')), 'i18n.mjs');
fs.writeFileSync(tmp, src);
const { D } = await import(pathToFileURL(tmp).href);
const re = new RegExp(process.argv[2] || '.', 'i'), lang = process.argv[3] || 'en';
for (const [k, v] of Object.entries(D[lang])) {
  const s = typeof v === 'string' ? v : JSON.stringify(v);
  if (re.test(s)) console.log(k + ' :: ' + s.slice(0, 200));
}
