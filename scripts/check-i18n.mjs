// Checks that translations are complete.
//   node scripts/check-i18n.mjs [plugin-dir…]
// 1. Every key used with t('…') in public/*.js exists in English, and every English key has all 7 languages.
// 2. Every T('…') text in the bundled plugins (default: the plugins in vault/.obsidian/plugins that use
//    window.graphiteT) has a row in public/i18n-plugins.js, and every row has 7 non-empty columns.
// Exits 1 and lists what is missing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.document = { documentElement: {}, querySelectorAll: () => [] };
// (Node already has a navigator; detectLang() isn't called here.)
const tmp = path.join(repo, 'node_modules', '.check-i18n');
fs.mkdirSync(tmp, { recursive: true });
// The app's modules import each other by absolute URL ('/i18n.js'); load copies with plain file names.
for (const f of ['i18n.js', 'i18n-plugins.js']) fs.writeFileSync(path.join(tmp, f.replace(/\.js$/, '.mjs')), fs.readFileSync(path.join(repo, 'public', f), 'utf8'));
const I = await import(pathToFileURL(path.join(tmp, 'i18n.mjs')));
const P = await import(pathToFileURL(path.join(tmp, 'i18n-plugins.mjs')));
const codes = I.LANGS.map(l => l.code);
const problems = [];

// Read a language's raw value: t() falls back to English, so switch languages and compare with a sentinel.
const has = (code, key) => { I.setLang(code); const v = I.t(key); I.setLang('en'); return v; };
const used = new Set();
for (const f of fs.readdirSync(path.join(repo, 'public')).filter(f => f.endsWith('.js'))) {
  const src = fs.readFileSync(path.join(repo, 'public', f), 'utf8');
  for (const m of src.matchAll(/\bt\(\s*'([a-zA-Z][\w-]*\.[\w.-]+)'/g)) used.add(m[1]);
}
I.setLang('en');
const warnings = [];
for (const key of [...used].sort()) {
  if (/[._]$/.test(key)) continue; // built from parts, e.g. t('ai.job.' + f)
  if (I.t(key) === key) { problems.push(`missing English text: ${key}`); continue; }
  const en = I.t(key);
  for (const c of codes) if (c !== 'en' && has(c, key) === en && !/^[\s\p{P}\p{S}\d{}a-z]*$/u.test(en) && en.length > 3) warnings.push(`same as English (${c}): ${key}`);
}

const dirs = process.argv.slice(2).filter(a => !a.startsWith('--')).length ? process.argv.slice(2).filter(a => !a.startsWith('--')) : fs.readdirSync(path.join(repo, 'vault/.obsidian/plugins'), { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => path.join(repo, 'vault/.obsidian/plugins', d.name)).filter(d => fs.existsSync(path.join(d, 'main.js')));
const fr = P.PLUG.fr || {};
for (const d of dirs) {
  const src = fs.readFileSync(path.join(d, 'main.js'), 'utf8');
  if (!/graphiteT/.test(src)) continue;
  for (const m of src.matchAll(/\bT\(\s*'((?:[^'\\]|\\.)*)'/g)) {
    const s = m[1].replace(/\\'/g, "'");
    if (!(s in fr)) problems.push(`no translation row (${path.basename(d)}): ${s}`);
  }
}
for (const c of Object.keys(P.PLUG)) for (const [en, v] of Object.entries(P.PLUG[c])) if (!v) problems.push(`empty ${c} column: ${en}`);

if (warnings.length) console.log(`(${warnings.length} texts are the same as English in some language; fine for names like “Notes”. Run with --warnings to list them.)`);
if (process.argv.includes('--warnings')) console.log(warnings.join('\n'));
if (problems.length) { console.log([...new Set(problems)].join('\n')); console.log(`\n${new Set(problems).size} problem(s)`); process.exit(1); }
console.log(`i18n complete: ${used.size} app keys × ${codes.length} languages, plugin rows checked in ${dirs.length} plugin(s)`);
