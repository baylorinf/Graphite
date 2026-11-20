// Carries out an import plan into the Graphite vault and records it, so the next scan skips it.
//
//   node import.js <plan.json>
//
// plan.json:
//   { "items":  [ { "src": "C:/Users/you/University/CALC/HW/week3.pdf", "dest": "Calculus/Homework/week3.pdf" } ],
//     "ignore": [ { "src": "C:/Users/you/Downloads/x.pdf", "reason": "not course material" } ] }
// - dest is relative to the vault. For PowerPoint/Word sources give a .pdf dest: a PDF copy is made with Office.
// - Never overwrites: if dest exists, a numbered name is used. Originals are never changed.
// Prints JSON: { done: [{src, dest}], failed: [{src, error}], ignored: n }
const fs = require('fs');
const path = require('path');
const { officeToPdf } = require('./office-pdf.cjs');

// Settings: ~/.claude/graphite.json (or the file GRAPHITE_CONFIG points to). Graphite writes it from
// Settings → Claude Code; graphite.example.json shows every field.
const graphite = (() => {
  const os = require('os');
  const file = process.env.GRAPHITE_CONFIG || require('path').join(os.homedir(), '.claude', 'graphite.json');
  try { return JSON.parse(require('fs').readFileSync(file, 'utf8')); } catch { return {}; }
})();

const VAULT = process.env.OBSIDIAN_VAULT || graphite.vault;
if (!VAULT) { console.error('No vault set: fill in ~/.claude/graphite.json (Graphite → Settings → Claude Code).'); process.exit(1); }
const MANIFEST = path.join(VAULT, '.obsidian/plugins/claude-chat/imports.json');
const norm = p => p.replace(/\\/g, '/');
const key = p => norm(p).toLowerCase();

const plan = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
let manifest = { imported: {}, ignored: {} };
try { manifest = { imported: {}, ignored: {}, ...JSON.parse(fs.readFileSync(MANIFEST, 'utf8')) }; } catch { /* first run */ }

function freeName(abs) {
  if (!fs.existsSync(abs)) return abs;
  const ext = path.extname(abs), base = abs.slice(0, -ext.length);
  for (let i = 1; ; i++) { const p = `${base} ${i}${ext}`; if (!fs.existsSync(p)) return p; }
}
function vaultPath(rel) {
  const abs = path.resolve(VAULT, rel);
  if (!abs.startsWith(path.resolve(VAULT) + path.sep)) throw new Error('destination is outside the vault');
  return abs;
}

const done = [], failed = [], toConvert = [];
for (const it of plan.items || []) {
  try {
    const src = path.resolve(it.src), st = fs.statSync(src);
    const target = vaultPath(it.dest);
    const office = /\.(pptx?|docx?)$/i.test(src);
    const dest = office ? target : freeName(target);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (office) { toConvert.push({ src, dest, st }); continue; }
    fs.copyFileSync(src, dest, fs.constants.COPYFILE_EXCL);
    manifest.imported[key(src)] = { dest: norm(path.relative(VAULT, dest)), size: st.size, mtime: st.mtimeMs, at: new Date().toISOString() };
    done.push({ src: norm(src), dest: norm(path.relative(VAULT, dest)) });
  } catch (e) { failed.push({ src: it.src, error: e.message }); }
}

async function finish() {
  for (const item of toConvert) {
    try {
      const target = item.dest.replace(/\.(pptx?|docx?)$/i, '.pdf');
      if (path.extname(target).toLowerCase() !== '.pdf') throw new Error('Choose a PDF destination for Office files.');
      const pdf = await officeToPdf(item.src, target, { asNew: true });
      const dest = norm(path.relative(VAULT, pdf));
      manifest.imported[key(item.src)] = { dest, size: item.st.size, mtime: item.st.mtimeMs, at: new Date().toISOString(), converted: true };
      done.push({ src: norm(item.src), dest });
    } catch (e) { failed.push({ src: norm(item.src), error: e.message }); }
  }
  for (const ig of plan.ignore || []) manifest.ignored[key(ig.src)] = { reason: ig.reason || '', at: new Date().toISOString() };
  fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
  fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  process.stdout.write(JSON.stringify({ done, failed, ignored: (plan.ignore || []).length }, null, 2) + '\n');
}
finish().catch(e => { console.error(e.message); process.exitCode = 1; });
