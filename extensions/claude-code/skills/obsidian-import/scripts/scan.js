// Lists study files on this computer that are not in the Graphite vault yet. Changes nothing.
//
//   node scan.js            -> JSON on stdout: { candidates: [...], counts: {...} }
//
// Where it looks:
//   - one folder per course under "studyRoot" (folder name = course code from "courses"; "skipFolders" are left out)
//   - recent files (last "recentDays" days) in the "recentFolders" of your home folder, course unknown
// What counts: PDFs, PowerPoint and Word files, and Markdown notes inside course folders.
// What is skipped: code/video/build folders, Office temp files, files over 300 MB, anything already in the
// vault (same size and type, or a PDF copy with the same name for PowerPoint/Word), and anything in the
// manifest's "imported" or "ignored" lists.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

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
const HOME = require('os').homedir();
const SKIP = new Set((graphite.skipFolders || []).map(s => String(s).toLowerCase()));
const COURSES = Object.fromEntries(Object.entries(graphite.courses || {}).filter(([code]) => !SKIP.has(code.toLowerCase())));
const STUDY_ROOT = graphite.studyRoot || '';
const EXTRA_ROOTS = (graphite.recentFolders || ['Downloads', 'Desktop', 'Documents']).map(d => path.isAbsolute(d) ? d : path.join(HOME, d));
const RECENT_DAYS = graphite.recentDays || 180;
const MAX_BYTES = 300 * 1024 * 1024;
const DOC_EXT = /\.(pdf|pptx?|docx?)$/i;
const NOTE_EXT = /\.md$/i;
const SKIP_DIR = /^(\.git|\.vscode|node_modules|Videos?|Practice|artifacts|build|dist|out|bin|obj|__pycache__|\.venv|venv|env|\.idea|\.obsidian)$/i;
const SKIP_FILE = /^(~\$|\.~lock|desktop\.ini$|thumbs\.db$)/i;

const norm = p => p.replace(/\\/g, '/');
const readJson = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const manifest = readJson(MANIFEST) || { imported: {}, ignored: {} };
const key = p => norm(p).toLowerCase();

// Everything already in the vault: by "size + extension", and by base name for PDF copies.
const bySize = new Set(), pdfNames = new Set();
(function walkVault(dir) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== '.obsidian' && e.name !== '.trash') walkVault(p); continue; }
    const ext = path.extname(e.name).toLowerCase();
    try { bySize.add(fs.statSync(p).size + ext); } catch { /* vanished */ }
    if (ext === '.pdf') pdfNames.add(path.basename(e.name, ext).toLowerCase());
  }
})(VAULT);

function inVault(file, size) {
  const ext = path.extname(file).toLowerCase();
  if (bySize.has(size + ext)) return true;
  // PowerPoint / Word files live in the vault as PDF copies with the same name.
  if (/\.(pptx?|docx?)$/.test(ext) && pdfNames.has(path.basename(file, ext).toLowerCase())) return true;
  return false;
}

const candidates = [];
const counts = { scanned: 0, inVault: 0, known: 0, ignored: 0 };

function consider(file, st, course, rel) {
  counts.scanned++;
  const k = key(file);
  if (manifest.ignored[k]) { counts.ignored++; return; }
  const prev = manifest.imported[k];
  if (prev && prev.size === st.size && Math.abs((prev.mtime || 0) - st.mtimeMs) < 2000) { counts.known++; return; }
  if (inVault(file, st.size)) { counts.inVault++; return; }
  const ext = path.extname(file).toLowerCase();
  const kind = NOTE_EXT.test(ext) ? 'note' : /\.(pptx?|docx?)$/.test(ext) ? 'convert' : 'copy';
  const c = {
    src: norm(file), name: path.basename(file), size: st.size, modified: new Date(st.mtimeMs).toISOString().slice(0, 10),
    kind, course: course || null, rel: rel || null, changed: !!prev,
  };
  // For files outside the course folders, a peek at the first page helps decide what they are.
  if (!course && ext === '.pdf') {
    try { c.firstPage = execFileSync('pdftotext', ['-l', '1', '-q', file, '-'], { encoding: 'utf8', timeout: 8000 }).replace(/\s+/g, ' ').trim().slice(0, 300); } catch { /* no pdftotext */ }
  }
  candidates.push(c);
}

function walk(dir, course, base, { recentOnly = false, depth = 0, maxDepth = 8 } = {}) {
  let ents = []; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIR.test(e.name) && depth < maxDepth) walk(p, course, base, { recentOnly, depth: depth + 1, maxDepth }); continue; }
    if (SKIP_FILE.test(e.name)) continue;
    const isDoc = DOC_EXT.test(e.name), isNote = course && NOTE_EXT.test(e.name);
    if (!isDoc && !isNote) continue;
    let st; try { st = fs.statSync(p); } catch { continue; }
    if (st.size === 0 || st.size > MAX_BYTES) continue;
    if (recentOnly && Date.now() - st.mtimeMs > RECENT_DAYS * 864e5) continue;
    consider(p, st, course, course ? norm(path.relative(base, p)) : null);
  }
}

// Every course folder from Study settings (studyRoots; older files only have studyRoot).
const ROOTS = [...new Set([STUDY_ROOT, ...(Array.isArray(graphite.studyRoots) ? graphite.studyRoots : [])].filter(Boolean))];
for (const root of ROOTS) for (const [code, course] of Object.entries(COURSES)) {
  const dir = path.join(root, code);
  if (fs.existsSync(dir) && !SKIP.has(code.toLowerCase())) walk(dir, course, dir);
}
for (const dir of EXTRA_ROOTS) walk(dir, null, dir, { recentOnly: true, maxDepth: 2 });

// The same file found twice (e.g. downloaded, then also saved in a course folder): keep the course one.
const seen = new Map();
for (const c of [...candidates].sort((a, b) => (b.course ? 1 : 0) - (a.course ? 1 : 0))) {
  const k = c.size + path.extname(c.name).toLowerCase();
  if (seen.has(k)) c.duplicateOf = seen.get(k); else seen.set(k, c.src);
}

process.stdout.write(JSON.stringify({ vault: VAULT, candidates, counts }, null, 2) + '\n');
