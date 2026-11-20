import { marked } from '/lib/marked.js';
import katex from '/lib/katex/katex.mjs';
import '/lib/katex/contrib/mhchem.mjs'; // \ce{H2O} chemistry formulas
import { t, LANGS, setLang, getLang, detectLang, applyI18n } from '/i18n.js';
import * as PM from '/plugins.js';
import { hash, merge3, isConflictCopy } from '/sync.js';
import { applyAppearance } from '/appearance.js';
import * as RV from '/review.js';
import * as STUDY from '/study.js'; // mistake book, cards from PDFs, plan days
import { PLUG, fillVars } from '/i18n-plugins.js';
import * as CK from '/check.js';
import * as AI from '/ai.js';
import * as SA from '/studyai.js';
import * as SUM from '/summary.js';
import { mountHandbook } from '/handbook.js';
import * as FJ from '/filejobs.js'; // jobs on your files (find new course files, file captures), in any vault
import { ICON, TAB_ICON, SEL_ICON } from '/icons.js'; // Lucide icons + the Graphite mark (scripts/make-icons.js)
import { G, initGraph, buildGraph, drawGraph, readGraphColors, fitGraph, stopGraph } from '/graph.js';
import { initSettings, openSettings, closeSettings, settingsOpen, refreshSettings } from '/settings.js';
import { mountPdf } from '/pdfview.js';
import { createReferencePane } from '/reference.js';
import { createCanvasView } from '/canvas-view.js';
import { createCodeWorkbench, workbenchAvailable, newCodeFileDialog } from '/code-workbench.js';
import { createCodeEditor, sourceFormat } from '/code-editor.js';
// The bundled plugins write English and ask the app for the text in your language.
window.graphiteT = (s, v) => fillVars((PLUG[getLang()] || {})[s] ?? s, v);

/* =====================================================================
   Helpers
   ===================================================================== */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const IMG_EXT = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i;
const isMd = p => /\.md$/i.test(p);
const fileName = p => p.split('/').pop();
const baseName = p => fileName(p).replace(/\.md$/i, '');
const dirName = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const joinPath = (d, n) => (d ? `${d}/${n}` : n);
const encPath = p => p.split('/').map(encodeURIComponent).join('/');
const pad = n => String(n).padStart(2, '0');
const cmpName = (a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
const normalize = p => { const out = []; for (const s of p.split('/')) { if (s === '..') out.pop(); else if (s && s !== '.') out.push(s); } return out.join('/'); };
const slug = s => s.toLowerCase().trim().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-');
// Characters Windows or link syntax don't allow in file names are swapped for lookalikes that are allowed,
// so you can type any title. (Obsidian-compatible: the result is still an ordinary file name.)
const LOOKALIKE = { '\\': '⧵', '/': '∕', ':': '꞉', '*': '∗', '?': '？', '"': '＂', '<': '＜', '>': '＞', '|': '∣', '#': '＃', '^': 'ˆ', '[': '［', ']': '］' };
function safeName(name, { folder = false } = {}) {
  let s = String(name).replace(/[\u0000-\u001f\u007f]/g, '').replace(/[\\/:*?"<>|#^[\]]/g, c => LOOKALIKE[c]).trim();
  if (folder) s = s.replace(/\.+$/, m => '․'.repeat(m.length)); // Windows drops dots at the end of folder names
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(s)) s = s + '_'; // names Windows reserves
  return s;
}
// Same swap for a link target, keeping "/" as the folder separator.
const lookalikePath = p => p.split('/').map(seg => seg.replace(/[\\:*?"<>^]/g, c => LOOKALIKE[c])).join('/');

const store = {
  get(k, d) { try { const v = localStorage.getItem('mo:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mo:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
};

const icon = name => `<svg class="i" viewBox="0 0 24 24">${ICON[name] || ''}</svg>`;

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('show'), 2600);
}

async function api(method, route, params = {}, body) {
  const qs = new URLSearchParams(params).toString();
  const headers = { 'X-Vault': '1' };
  let payload;
  if (body instanceof Blob || typeof body === 'string') payload = body;
  else if (body != null) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(`/api/${route}${qs ? '?' + qs : ''}`, { method, headers, body: payload });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

/* =====================================================================
   State & vault index
   ===================================================================== */
const S = {
  files: new Map(),      // path -> { path, mtime, size, content?, links?, tags?, headings?, fm? }
  folders: new Set(),
  current: null,
  dirty: false,
  mode: store.get('mode', 'split'),
  lastEditMode: store.get('lastEditMode', 'split'),
  view: 'note',
  history: [], hIdx: -1,
  collapsed: new Set(store.get('collapsed', [])),
  selectedFolder: null,
};
let nameIdx = new Map(); // lowercased "name" / "name.md" / "file.png" -> [paths]

function rebuildNameIndex() {
  nameIdx = new Map();
  const add = (k, p) => { if (!nameIdx.has(k)) nameIdx.set(k, []); nameIdx.get(k).push(p); };
  for (const p of S.files.keys()) {
    const n = fileName(p).toLowerCase();
    add(n, p);
    if (n.endsWith('.md')) add(n.slice(0, -3), p);
  }
}

function addFolderChain(p) { let acc = ''; for (const s of dirName(p).split('/').filter(Boolean)) { acc = joinPath(acc, s); S.folders.add(acc); } }

// Resolve a link target ("Note", "folder/Note", "image.png", "../x.md") to a vault path.
function resolve(name, from = '') {
  if (!name) return null;
  // A link like [[Q&A: Why?]] should find the note saved as "Q&A꞉ Why？"; try the exact name first.
  const exact = resolveExact(name, from);
  if (exact) return exact;
  const alt = lookalikePath(name.trim());
  return alt !== name.trim() ? resolveExact(alt, from) : null;
}
function resolveExact(name, from) {
  let t = name.replace(/\\/g, '/').trim();
  // An explicitly rooted link can distinguish a root file from its namesake beside the note.
  if (t.startsWith('/')) {
    const root = t.slice(1).toLowerCase();
    for (const path of S.files.keys()) {
      const candidate = path.toLowerCase();
      if (candidate === root || candidate === root + '.md') return path;
    }
  }
  if (from && (t.startsWith('./') || t.startsWith('../'))) { const rel = normalize(joinPath(dirName(from), t)); if (S.files.has(rel)) return rel; }
  t = t.replace(/^\.?\//, '');
  const tl = t.toLowerCase();
  const prefer = list => list.length === 1 ? list[0] : [...list].sort((a, b) => score(a, from) - score(b, from))[0];
  if (!tl.includes('/')) { const c = nameIdx.get(tl); return c ? prefer(c) : null; }
  const tlMd = tl.endsWith('.md') ? tl : tl + '.md';
  const hits = [];
  for (const p of S.files.keys()) {
    const pl = p.toLowerCase();
    if (pl === tlMd || pl === tl) return p;
    if (pl.endsWith('/' + tlMd) || pl.endsWith('/' + tl)) hits.push(p);
  }
  return hits.length ? prefer(hits) : null;
}
const score = (p, from) => (isMd(p) ? 0 : 500) + (dirName(p) === dirName(from) ? 0 : 1000) + p.length;

// Shortest unambiguous name to write inside [[ ]] for a path.
function linkNameFor(path) {
  // Another file with the same name (e.g. Lecture1.pdf in two courses): write the full path, so the link
  // can't open the other one. The label after "|" stays short.
  if (!isMd(path)) return (nameIdx.get(fileName(path).toLowerCase()) || []).length > 1 ? (path.includes('/') ? path : '/' + path) : fileName(path);
  const n = baseName(path);
  return (nameIdx.get(n.toLowerCase()) || []).length > 1 ? path.replace(/\.md$/i, '') : n;
}

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
function splitFrontmatter(text) {
  const m = text.match(FM_RE);
  return m ? { fm: parseYaml(m[1]), body: text.slice(m[0].length) } : { fm: null, body: text };
}
const unq = s => s.trim().replace(/^["']|["']$/g, '');
function parseYaml(src) {
  const out = {}; let key = null;
  for (const line of src.split(/\r?\n/)) {
    const li = line.match(/^\s+-\s*(.*)$/);
    if (li && key) { if (!Array.isArray(out[key])) out[key] = []; out[key].push(unq(li[1])); continue; }
    const kv = line.match(/^([^:#\s][^:]*):\s*(.*)$/);
    if (!kv) continue;
    key = kv[1].trim(); let v = kv[2].trim();
    out[key] = /^\[.*\]$/.test(v) ? v.slice(1, -1).split(',').map(unq).filter(Boolean) : (v === '' ? '' : unq(v));
  }
  return out;
}
// Remove code, comments and math blocks before looking for links and #tags (a "#" inside LaTeX isn't a tag).
const stripCode = t => t.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1.*$/gm, '').replace(/`[^`\n]*`/g, '').replace(/%%[\s\S]*?%%/g, '').replace(/\$\$[\s\S]*?\$\$/g, '');

function splitOnce(s, ch) { const i = s.indexOf(ch); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]; }
function splitWiki(inner) {
  const [target, alias] = splitOnce(inner, '|');
  const [name, heading] = splitOnce(target, '#');
  return { name: name.trim(), heading: heading.replace(/^\^/, '').trim(), alias: alias.trim() };
}

const WIKI_RE = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
const MDLINK_RE = /\[[^\]\n]*\]\(([^)\s]+?\.md)(#[^)]*)?\)/gi;
function parseLinks(text) {
  const out = []; let m;
  WIKI_RE.lastIndex = 0;
  while ((m = WIKI_RE.exec(text))) { const { name } = splitWiki(m[2]); if (name) out.push({ name, embed: !!m[1], raw: m[0] }); }
  MDLINK_RE.lastIndex = 0;
  while ((m = MDLINK_RE.exec(text))) {
    if (/^[a-z]+:/i.test(m[1])) continue;
    try { out.push({ name: decodeURIComponent(m[1]), raw: m[0] }); } catch { /* bad uri */ }
  }
  return out;
}
const TAG_RE = /(^|[\s(,])#([\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
function parseTags(text, fm) {
  const set = new Set(); let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(text))) set.add(m[2].toLowerCase());
  const ft = fm && (fm.tags ?? fm.tag);
  if (ft) (Array.isArray(ft) ? ft : String(ft).split(/[,\s]+/)).forEach(t => { t = t.replace(/^#/, '').trim(); if (t) set.add(t.toLowerCase()); });
  return [...set];
}
function parseHeadings(text) {
  const out = []; let fence = null;
  const fmLen = (text.match(FM_RE)?.[0] || '').split('\n').length - 1;
  text.split('\n').forEach((line, i) => {
    if (i < fmLen) return;
    const f = line.match(/^\s*(```|~~~)/);
    if (f) { fence = fence ? (line.trim().startsWith(fence) ? null : fence) : f[1]; return; }
    if (fence) return;
    const h = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) out.push({ level: h[1].length, text: h[2], line: i });
  });
  return out;
}

function indexFile(f) {
  if (!isMd(f.path) || f.content == null) return;
  const { fm, body } = splitFrontmatter(f.content);
  const clean = stripCode(body);
  f.fm = fm; f.links = parseLinks(clean); f.tags = parseTags(clean, fm); f.headings = parseHeadings(f.content);
}

async function loadAll() {
  const d = await api('GET', 'all');
  S.vault = d.vault;
  S.version = d.version;
  S.files.clear();
  S.folders = new Set(d.folders);
  // f.disk = the version on disk that the app last saw; used to detect and merge changes from other devices.
  for (const f of d.files) { f.disk = f.content; indexFile(f); S.files.set(f.path, f); }
  rebuildNameIndex();
}

async function fetchContent(f, external = false) {
  const r = await api('GET', 'file', { path: f.path }).catch(() => null);
  if (!r) return;
  const isOpen = f.path === S.current;
  const base = f.disk ?? f.content ?? '';
  const changed = base !== r.content;
  f.disk = r.content; f.mtime = r.mtime;
  if (external && changed && isOpen) {
    if (!S.dirty) { f.content = r.content; indexFile(f); setEditorText(r.content, false); renderPreview(); updateStatus(); }
    else await mergeIntoEditor(f, base, r.content); // you are typing in it: combine both versions
    return;
  }
  if (!isOpen || !S.dirty) f.content = r.content;
  indexFile(f);
}

/* ---------- sync safety (cloud folders) ---------- */
function scheduleSave() { setSaveStatus(t('status.unsaved')); clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 700); }

// The open note changed on another device while it has unsaved edits here.
async function mergeIntoEditor(f, base, theirs) {
  const mine = ed.value, name = baseName(f.path);
  const m = merge3(base, mine, theirs);
  if (m.ok) {
    if (m.text !== mine) { setEditorText(m.text, false); syncNotice(t('sync.merged', { name })); }
    setDraft(f.path, m.text); rebaseDraft(f.path, theirs);
  } else {
    try {
      const copy = await saveConflictCopy(f.path, theirs);
      syncNotice(t('sync.conflict', { name }), copy);
      setDraft(f.path, mine); rebaseDraft(f.path, theirs);
    } catch (e) {
      // The other version isn't safely on disk yet: keep treating the disk as changed, so the next save
      // is refused by the server and tries the copy again instead of overwriting it.
      f.disk = base;
      setDraft(f.path, mine);
      syncNotice(e.message);
    }
  }
  S.dirty = true; scheduleSave();
  f.content = ed.value; indexFile(f); renderPreview(); updateStatus(); refreshSidePanels();
}

// Save a note, telling the server which version we started from. If the file changed on disk in the
// meantime, merge; if the changes clash, keep ours and save theirs as a "(conflict …)" copy.
async function putNote(path, text, base = draftBase(path)) {
  const put = (body, baseText) => fetch(`/api/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT', body, headers: { 'X-Vault': '1', ...(baseText != null ? { 'X-Base-Hash': hash(baseText) } : {}) },
  });
  const fail = async res => { throw new Error((await res.json().catch(() => ({}))).error || res.statusText); };
  let res = await put(text, base);
  if (res.status === 409) {
    const theirs = (await res.json()).content;
    const final = await resolveConflict(path, base ?? '', text, theirs);
    res = await put(final, theirs);
    if (!res.ok) await fail(res);
    return { ...(await res.json()), content: final };
  }
  if (!res.ok) await fail(res);
  return { ...(await res.json()), content: text };
}
async function resolveConflict(path, base, mine, theirs) {
  const name = baseName(path), m = merge3(base, mine, theirs);
  if (m.ok) { syncNotice(t('sync.merged', { name })); return m.text; }
  const copy = await saveConflictCopy(path, theirs);
  syncNotice(t('sync.conflict', { name }), copy);
  return mine;
}
// Save the other version as "Name (conflict YYYY-MM-DD HHmm).md". The server creates it exclusively: if a copy
// with that name is already on disk (even one the app hasn't seen yet), the next number is tried. Any other
// failure throws, so the caller does NOT overwrite the original with only one of the two versions.
async function saveConflictCopy(path, content) {
  const d = new Date();
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}${pad(d.getMinutes())}`;
  for (let i = 1; i <= 50; i++) {
    const p = joinPath(dirName(path), `${baseName(path)} (conflict ${stamp}${i > 1 ? ' ' + i : ''}).md`);
    if (S.files.has(p)) continue;
    let res;
    try { res = await fetch(`/api/file?path=${encodeURIComponent(p)}`, { method: 'POST', headers: { 'X-Vault': '1' }, body: content }); }
    catch (e) { throw new Error(t('sync.copyFailed', { name: baseName(path), msg: e.message })); }
    if (res.status === 409) continue; // that name is taken on disk: try the next one
    if (!res.ok) throw new Error(t('sync.copyFailed', { name: baseName(path), msg: (await res.json().catch(() => ({}))).error || res.statusText }));
    const r = await res.json();
    const f = { path: r.path, mtime: r.mtime, size: content.length, content, disk: content };
    indexFile(f); S.files.set(f.path, f); addFolderChain(f.path);
    rebuildNameIndex(); renderTree(); refreshSidePanels();
    PM.emitVault('create', f.path); PM.emitMetadata(f.path);
    return f.path;
  }
  throw new Error(t('sync.copyFailed', { name: baseName(path), msg: 'no free name' }));
}
function syncNotice(msg, openPath) {
  const frag = document.createDocumentFragment();
  frag.append(msg);
  if (openPath) {
    const a = Object.assign(document.createElement('a'), { href: '#', className: 'notice-link', textContent: t('sync.openCopy') });
    a.dataset.open = openPath;
    frag.append(document.createElement('br'), a);
  }
  try { new PM.Notice(frag, openPath ? 15000 : 6000); } catch { toast(msg); }
}
const conflictFiles = () => [...S.files.keys()].filter(p => isConflictCopy(fileName(p))).sort(cmpName);
function updateSyncStatus() {
  const n = conflictFiles().length, el = $('#st-sync');
  el.textContent = n ? '⚠ ' + t('sync.statusConflicts', { n }) : '';
  el.classList.toggle('hidden', !n);
}

// Pick up changes made on disk by other programs.
async function sync() {
  const d = await api('GET', 'list');
  const seen = new Set(); let structural = false;
  const events = [];
  for (const nf of d.files) {
    seen.add(nf.path);
    const old = S.files.get(nf.path);
    if (!old) { structural = true; S.files.set(nf.path, nf); if (isMd(nf.path)) await fetchContent(nf); events.push(['create', nf.path]); }
    else if (old.mtime !== nf.mtime) { old.size = nf.size; if (isMd(nf.path)) await fetchContent(old, true); else old.mtime = nf.mtime; events.push(['modify', nf.path]); }
  }
  for (const p of [...S.files.keys()]) if (!seen.has(p)) { S.files.delete(p); structural = true; events.push(['delete', p]); }
  const folders = new Set(d.folders);
  if (folders.size !== S.folders.size || [...folders].some(x => !S.folders.has(x))) structural = true;
  S.folders = folders;
  if (structural) { rebuildNameIndex(); renderTree(); }
  for (const [type, p] of events) {
    PM.emitVault(type, p); if (type !== 'delete') PM.emitMetadata(p);
    if (type !== 'create' && p === codeEditor.activePath) void codeEditor.external(p);
  }
  if (S.current && !S.files.has(S.current)) {
    // Deleted on another device. If you were editing it, keep your copy instead of losing the edits.
    if (S.dirty) {
      const p = S.current, text = ed.value;
      const f = await createFile(p, text, { silent: true });
      if (f) { S.dirty = false; setSaveStatus(t('status.saved')); syncNotice(t('sync.deletedKept', { name: baseName(p) })); }
      else closeNote();
    } else closeNote();
  }
  closeFileIfGone();
  await pruneTabs();
  refreshSidePanels();
  if (S.view === 'graph') buildGraph();
}

/* =====================================================================
   Markdown rendering
   ===================================================================== */
let renderCtx = { from: '' };

// LaTeX math with KaTeX: $inline$ and $$display$$, like Obsidian. Errors are shown in red, never thrown.
function renderMath(tex, display) {
  try {
    const html = katex.renderToString(tex.trim(), { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml' });
    return display ? `<div class="math math-block">${html}</div>` : `<span class="math math-inline">${html}</span>`;
  } catch (e) { return `<span class="math-error">${esc(e.message)}</span>`; }
}

marked.use({
  gfm: true,
  breaks: true,
  extensions: [
    {
      // $$ … $$ on its own lines → centred display math
      name: 'mathBlock', level: 'block',
      // marked passes the text from the 2nd character on, so only a "$$" right after a line break is a
      // real line start (matching the very beginning would split "`$$` …" lines in the middle).
      start(src) { const m = /\n {0,3}\$\$/.exec(src); return m ? m.index + 1 : undefined; },
      tokenizer(src) {
        const m = /^ {0,3}\$\$([\s\S]+?)\$\$[ \t]*(?:\n+|$)/.exec(src);
        if (m) return { type: 'mathBlock', raw: m[0], tex: m[1] };
      },
      renderer: t => renderMath(t.tex, true),
    },
    {
      // $$ … $$ inside a sentence (display), or $ … $ (inline).
      // Like Obsidian, "$5 and $10" is not math: no space just inside the $ signs, no digit right after.
      name: 'mathInline', level: 'inline',
      start(src) { const i = src.indexOf('$'); return i < 0 ? undefined : i; },
      tokenizer(src) {
        let m = /^\$\$((?:\\[\s\S]|[^$])+?)\$\$/.exec(src);
        if (m) return { type: 'mathInline', raw: m[0], tex: m[1], display: true };
        m = /^\$(?=\S)((?:\\[\s\S]|[^\\$\n])+?)\$(?!\d)/.exec(src);
        if (m && !/\s$/.test(m[1])) return { type: 'mathInline', raw: m[0], tex: m[1], display: false };
      },
      renderer: t => renderMath(t.tex, t.display),
    },
    {
      name: 'wikilink', level: 'inline',
      start(src) { const i = src.indexOf('[['); if (i < 0) return; return i > 0 && src[i - 1] === '!' ? i - 1 : i; },
      tokenizer(src) {
        const m = /^(!?)\[\[([^\[\]\n]+?)\]\]/.exec(src);
        if (m) return { type: 'wikilink', raw: m[0], embed: !!m[1], ...splitWiki(m[2]) };
      },
      renderer: t => renderWiki(t),
    },
    {
      name: 'highlight', level: 'inline',
      start(src) { const i = src.indexOf('=='); return i < 0 ? undefined : i; },
      tokenizer(src) {
        const m = /^==(?=\S)([^\n]*?\S)==/.exec(src);
        if (m) return { type: 'highlight', raw: m[0], tokens: this.lexer.inlineTokens(m[1]) };
      },
      renderer(t) { return `<mark>${this.parser.parseInline(t.tokens)}</mark>`; },
    },
    {
      name: 'comment', level: 'inline',
      start(src) { const i = src.indexOf('%%'); return i < 0 ? undefined : i; },
      tokenizer(src) { const m = /^%%[\s\S]*?%%/.exec(src); if (m) return { type: 'comment', raw: m[0] }; },
      renderer: () => '',
    },
    {
      name: 'tag', level: 'inline',
      // marked shows start() the text from its 2nd character on, so a "#" at position 0 may well follow a
      // space ("#a #b" → " #b" → "#b"). Report it; the tokenizer then checks what really came before.
      start(src) { const m = /(^|[\s(,])#[\p{L}_\-/]/u.exec(src); return m ? m.index + m[1].length : undefined; },
      tokenizer(src, tokens) {
        // A tag must start the text or follow a space, "(" or ",": "word#x" is not a tag.
        const prev = tokens?.[tokens.length - 1];
        if (prev && !/[\s(,]$/.test(prev.raw)) return;
        const m = /^#([\p{L}_\-/][\p{L}\p{N}_\-/]*)/u.exec(src);
        if (m) return { type: 'tag', raw: m[0], tag: m[1] };
      },
      renderer: t => `<a href="#" class="tag" data-tag="${esc(t.tag.toLowerCase())}">#${esc(t.tag)}</a>`,
    },
  ],
});

function renderWiki(t) {
  const target = t.name ? resolve(t.name, renderCtx.from) : renderCtx.from;
  if (t.embed && target) {
    if (!isMd(target)) {
      const src = '/vault/' + encPath(target);
      if (IMG_EXT.test(target)) {
        const size = t.alias.match(/^(\d+)(?:x(\d+))?$/);
        const attrs = size ? ` width="${size[1]}"${size[2] ? ` height="${size[2]}"` : ''}` : '';
        return `<img src="${src}" alt="${esc(size ? fileName(target) : (t.alias || fileName(target)))}"${attrs} loading="lazy">`;
      }
      if (/\.pdf$/i.test(target)) return `<iframe class="embed-pdf" src="${src}"></iframe>`;
      if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(target)) return `<audio controls src="${src}"></audio>`;
      if (/\.(mp4|webm|mov|ogv)$/i.test(target)) return `<video controls src="${src}"></video>`;
      return `<a href="${src}" target="_blank" rel="noopener">${esc(fileName(target))}</a>`;
    }
    return `<span class="embed-note" data-embed="${esc(target)}" data-heading="${esc(t.heading)}"></span>`;
  }
  const label = t.alias || (t.heading ? (t.name ? `${t.name} > ${t.heading}` : t.heading) : t.name);
  return `<a href="#" class="internal-link${target ? '' : ' unresolved'}" data-target="${esc(t.name)}" data-heading="${esc(t.heading)}" data-from="${esc(renderCtx.from || '')}">${esc(label)}</a>`;
}

function sectionOf(text, heading) {
  const lines = text.split('\n'); const h = heading.toLowerCase();
  const start = lines.findIndex(l => { const m = l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/); return m && m[2].toLowerCase() === h; });
  if (start < 0) return text;
  const level = lines[start].match(/^#+/)[0].length;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) { const m = lines[i].match(/^(#{1,6})\s/); if (m && m[1].length <= level) { end = i; break; } }
  return lines.slice(start, end).join('\n');
}

function renderProps(fm) {
  const rows = Object.entries(fm).map(([k, v]) => {
    const vals = Array.isArray(v) ? v : [v];
    const isTags = /^tags?$/i.test(k);
    const html = vals.filter(x => x !== '').map(x => isTags
      ? `<a href="#" class="tag" data-tag="${esc(String(x).replace(/^#/, '').toLowerCase())}">#${esc(String(x).replace(/^#/, ''))}</a>`
      : `<span>${esc(x)}</span>`).join(isTags ? '' : ', ');
    return `<div class="prop"><span class="key">${esc(k)}</span><span class="val">${html}</span></div>`;
  }).join('');
  return `<div class="properties">${rows}</div>`;
}

const CALLOUT_ICON = { note: '✎', info: 'ℹ', todo: '☐', tip: '🔥', hint: '🔥', important: '🔥', success: '✔', check: '✔', done: '✔', question: '?', help: '?', faq: '?', warning: '⚠', caution: '⚠', attention: '⚠', failure: '✘', fail: '✘', missing: '✘', danger: '⚡', error: '⚡', bug: '🐞', example: '☰', quote: '❝', cite: '❝', progress: '◔', abstract: '📋', summary: '📋', tldr: '📋' };

function renderInto(el, text, from, depth = 0) {
  const { fm, body } = splitFrontmatter(text);
  const prev = renderCtx; renderCtx = { from };
  let html;
  try { html = marked.parse(body); } catch (e) { html = `<pre>${esc(e.message)}</pre>`; }
  finally { renderCtx = prev; }
  el.innerHTML = (depth === 0 && fm && Object.keys(fm).length ? renderProps(fm) : '') + html;
  postProcess(el, from, depth);
}

function postProcess(el, from, depth) {
  STUDY.decorate(el, from, depth); // problem lists from exam analyses, Start buttons in revision plans
  // Heading ids for outline / [[Note#Heading]] navigation.
  const used = new Set();
  for (const h of el.querySelectorAll('h1,h2,h3,h4,h5,h6')) {
    let id = slug(h.textContent) || 'h'; let n = id, i = 1;
    while (used.has(n)) n = `${id}-${i++}`;
    used.add(n); h.id = n;
  }
  // External links open in a new tab.
  for (const a of el.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href');
    if (/^[a-z][\w+.-]*:/i.test(href)) { a.target = '_blank'; a.rel = 'noopener'; a.classList.add('external'); }
    else if (/\.md(#.*)?$/i.test(href) && !a.classList.contains('internal-link')) {
      const [p, h] = splitOnce(decodeURIComponent(href), '#');
      a.classList.add('internal-link'); a.dataset.target = p; a.dataset.heading = h;
      if (!resolve(p, from)) a.classList.add('unresolved');
      a.setAttribute('href', '#');
    }
    // A relative link to an attachment (e.g. an assignment's "附件/作业 1.pdf" or "notes%20v2.txt"): the note's own
    // folder first, so a same-named file of another course is never opened instead; then the vault-wide name.
    // It opens inside Graphite (PDF, text, images…), with #page=N kept.
    else if (href && !href.startsWith('#') && !href.startsWith('/') && !a.classList.contains('internal-link') && !a.dataset.open) {
      let raw = href; try { raw = decodeURIComponent(href); } catch { /* keep as written */ }
      const [p, h] = splitOnce(raw, '#');
      if (!p) continue;
      const near = normalize(joinPath(dirName(from || ''), p.replace(/^\.\//, '')));
      const target = S.files.has(near) ? near : S.files.has(p) ? p : resolve(p, from);
      a.setAttribute('href', '#');
      if (target) { a.dataset.open = target; if (h) a.dataset.heading = h; a.classList.add('attachment-link'); a.title = target; }
      else { a.classList.add('unresolved'); a.title = near; }
    }
  }
  // Relative images in standard markdown syntax point into the vault.
  for (const img of el.querySelectorAll('img[src]')) {
    const src = img.getAttribute('src');
    if (!/^([a-z]+:|\/|data:)/i.test(src)) {
      const p = resolve(decodeURIComponent(src), from) || normalize(joinPath(dirName(from), decodeURIComponent(src)));
      img.src = '/vault/' + encPath(p);
    }
  }
  // Callouts:  > [!note] Title
  for (const bq of el.querySelectorAll('blockquote')) {
    const p = bq.firstElementChild;
    if (!p || p.tagName !== 'P') continue;
    const m = p.innerHTML.match(/^\s*\[!([\w-]+)\]([+-]?)[ \t]*([^\n]*?)(?:<br>\n?|\n|$)/);
    if (!m) continue;
    const type = m[1].toLowerCase();
    p.innerHTML = p.innerHTML.slice(m[0].length);
    if (!p.innerHTML.trim()) p.remove();
    const div = document.createElement('div');
    div.className = 'callout'; div.dataset.callout = type;
    if (m[2]) div.dataset.fold = m[2];
    if (m[2] === '-') div.classList.add('collapsed');
    div.innerHTML = `<div class="callout-title"><span>${CALLOUT_ICON[type] || 'ℹ'}</span><span>${m[3].trim() || type[0].toUpperCase() + type.slice(1)}</span>${m[2] ? '<span class="callout-fold">▾</span>' : ''}</div><div class="callout-content"></div>`;
    const content = div.lastElementChild;
    while (bq.firstChild) content.appendChild(bq.firstChild);
    bq.replaceWith(div);
  }
  // Clickable task checkboxes (only for the note itself, not embeds).
  if (depth === 0) {
    let n = 0;
    for (const cb of el.querySelectorAll('li > input[type=checkbox]')) { cb.disabled = false; cb.dataset.task = n++; }
  } else {
    for (const cb of el.querySelectorAll('input[type=checkbox]')) cb.disabled = true;
  }
  // Embedded notes: ![[Note]] / ![[Note#Heading]]
  if (depth < 3) {
    for (const sp of el.querySelectorAll('.embed-note:not([data-done])')) {
      sp.dataset.done = '1';
      const f = S.files.get(sp.dataset.embed);
      if (!f || f.content == null) { sp.textContent = t('embed.notFound'); continue; }
      const text = sp.dataset.heading ? sectionOf(f.content, sp.dataset.heading) : f.content;
      sp.innerHTML = `<div class="embed-header"><a href="#" data-open="${esc(f.path)}">${esc(baseName(f.path))}${sp.dataset.heading ? ' › ' + esc(sp.dataset.heading) : ''}</a></div><div class="embed-body markdown"></div>`;
      renderInto(sp.querySelector('.embed-body'), text, f.path, depth + 1);
    }
  }
  // Plugin code-block processors and Markdown post-processors (once, over the whole rendered note).
  if (depth === 0) PM.runPostProcessors(el, from);
}

/* =====================================================================
   Editor
   ===================================================================== */
const ed = $('#editor');
const edWrap = $('#editor-wrap');
const pvWrap = $('#preview-wrap');
let saveTimer = null;

function autosize() {
  const top = edWrap.scrollTop;
  ed.style.height = 'auto';
  ed.style.height = ed.scrollHeight + 'px';
  edWrap.scrollTop = top;
}

function setEditorText(text, reset = true) {
  const s = ed.selectionStart, e = ed.selectionEnd, top = edWrap.scrollTop;
  ed.value = text;
  S.dirty = false;
  autosize();
  if (reset) { edWrap.scrollTop = 0; pvWrap.scrollTop = 0; ed.setSelectionRange(0, 0); }
  else { ed.setSelectionRange(Math.min(s, text.length), Math.min(e, text.length)); edWrap.scrollTop = top; }
}

const scheduleRender = debounce(() => { renderPreview(); updateStatus(); }, 120);

ed.addEventListener('input', () => {
  if (!S.current) return;
  S.dirty = true;
  setDraft(S.current, ed.value, true);
  const at = activeTab(); if (at?.preview) { at.preview = false; renderTabs(); persistTabs(); }
  setSaveStatus(t('status.unsaved'));
  autosize();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 700);
  scheduleRender();
  updateSuggest();
  if (!Sug) PM.emitEditorChange();
});

// Unsaved drafts, per note: { text: the newest text typed, base: the version on disk it was written against }.
// Kept until that text has reached the disk, across note switches, reloads and restarts (stored with the app
// settings, separately for each vault, so a note with the same name in another vault is never touched).
// Every save of a draft (typing, Ctrl+S, switching notes, background retries, reload, closing) goes through
// putNote with the draft's base: if the file on disk changed since, both versions are kept, never overwritten.
let drafts = new Map(), draftsKey = null, draftPersistTimer = null;
function loadDrafts() {
  draftsKey = 'drafts:' + (S.vault || '');
  drafts = new Map(Object.entries(store.get(draftsKey, {}) || {}).filter(([, d]) => d && typeof d.text === 'string'));
}
const persistDrafts = () => { clearTimeout(draftPersistTimer); draftPersistTimer = null; if (draftsKey) store.set(draftsKey, Object.fromEntries(drafts)); };
const persistDraftsSoon = () => { if (!draftPersistTimer) draftPersistTimer = setTimeout(persistDrafts, 300); };
const draftBase = path => (drafts.has(path) ? drafts.get(path).base : S.files.get(path)?.disk);
function setDraft(path, text, soon = false) {
  const old = drafts.get(path);
  drafts.set(path, { text, base: old ? old.base : (S.files.get(path)?.disk ?? null), at: Date.now() });
  if (soon) persistDraftsSoon(); else persistDrafts();
}
// The draft now builds on a newer disk version (merged with it, or the other version was kept as a copy).
function rebaseDraft(path, base) { const d = drafts.get(path); if (d) { d.base = base; persistDrafts(); } }
function clearDraft(path, text) { const d = drafts.get(path); if (d && (text == null || d.text === text)) { drafts.delete(path); persistDrafts(); } }
// Try to write every draft of a note that isn't open (the open one goes through saveNow).
async function retryDrafts() {
  for (const [path, d] of [...drafts]) {
    if (path === S.current) continue;
    const f = S.files.get(path);
    try {
      const r = await putNote(path, d.text, d.base);
      if (f) { f.content = r.content; f.disk = r.content; f.mtime = r.mtime; f.size = r.content.length; indexFile(f); }
      else { S.files.set(path, { path, mtime: r.mtime, size: r.content.length, content: r.content, disk: r.content }); addFolderChain(path); rebuildNameIndex(); renderTree(); }
      clearDraft(path, d.text); rebaseDraft(path, r.content);
    } catch { /* still failing: keep the draft (and its base) */ }
  }
  updateDraftStatus();
}
function updateDraftStatus() {
  const n = [...drafts.keys()].filter(p => p !== S.current).length;
  $('#st-save').classList.toggle('has-drafts', n > 0 || ($('#st-save').textContent === t('status.saveFailed')));
  if (n && !S.dirty && $('#st-save').textContent !== t('status.saveFailed')) setSaveStatus(t('status.draftsWaiting', { n }));
}
setInterval(() => { if (drafts.size) retryDrafts(); }, 20000);
// Download a draft as a .md file, for when the vault can't be written to.
function downloadDraft(path, text) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/markdown' })), download: fileName(path) });
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$('#st-save').addEventListener('click', e => {
  const open = S.current && (S.dirty || drafts.has(S.current)) ? [[S.current, ed.value]] : [];
  const list = [...open, ...[...drafts].filter(([p]) => p !== S.current).map(([p, d]) => [p, d.text])];
  if (!list.length) return;
  showMenu(e.clientX, e.clientY - 10, [
    { label: t('draft.retry'), run: async () => { await saveNow(); await retryDrafts(); if (!drafts.size && !S.dirty) toast(t('status.saved')); } },
    '-',
    ...list.map(([p, text]) => ({ label: t('draft.saveAs', { name: baseName(p) }), run: () => downloadDraft(p, text) })),
  ]);
});

// Saves run one at a time: a second save waits for the one already on its way to disk. Without this, closing
// the app mid-save skipped the flush, and two overlapping saves looked like an edit from another device.
let saveChain = Promise.resolve();
function saveNow() {
  clearTimeout(saveTimer);
  const run = saveChain.then(saveOnce);
  saveChain = run.catch(() => {});
  return run;
}
async function saveOnce() {
  if (!S.current || !S.dirty) return;
  const path = S.current, text = ed.value, f = S.files.get(path);
  S.dirty = false;
  setDraft(path, text); // kept until this text is on disk
  if (f) { f.content = text; indexFile(f); }
  setSaveStatus(t('status.saving'));
  try {
    const r = await putNote(path, text, draftBase(path));
    if (f) { f.mtime = r.mtime; f.size = r.content.length; f.disk = r.content; }
    if (r.content !== text && S.current === path) {
      // Saved together with changes from another device: bring those into the editor too.
      const m = merge3(text, ed.value, r.content);
      const next = m.ok ? m.text : ed.value;
      if (next !== ed.value) setEditorText(next, false);
      if (next !== r.content) { S.dirty = true; scheduleSave(); }
      if (f) { f.content = next; indexFile(f); }
      renderPreview(); updateStatus();
    }
    // Saved. Anything typed meanwhile stays a draft, now building on what was just written.
    clearDraft(path, text); rebaseDraft(path, r.content);
    if (S.dirty && S.current === path) setDraft(path, ed.value);
    if (!S.dirty) setSaveStatus(t('status.saved'));
    refreshSidePanels();
    PM.emitVault('modify', path); PM.emitMetadata(path);
    if (drafts.size) retryDrafts();
  } catch (e) {
    // Keep the newest text as this note's draft. If you are still in the note, it stays "unsaved" so Ctrl+S
    // (or the next edit) retries; if you switched away, it is retried in the background and on reopening.
    if (S.current === path) { S.dirty = true; setDraft(path, ed.value); } else setDraft(path, text);
    setSaveStatus(t('status.saveFailed')); updateDraftStatus();
    toast(t('toast.saveFailed', { msg: e.message }));
  }
}

async function writeFile(path, content) {
  const r = await putNote(path, content, S.files.get(path)?.disk);
  const f = S.files.get(path);
  if (f) { f.content = r.content; f.disk = r.content; f.mtime = r.mtime; indexFile(f); }
  PM.emitVault('modify', path); PM.emitMetadata(path);
}

// Write a note on behalf of a plugin; keeps the open editor in sync.
async function writeNote(path, content) {
  if (path === S.current) { if (S.dirty) await saveNow(); setEditorText(content, false); renderPreview(); updateStatus(); }
  if (!S.files.has(path)) { await createFile(path, content, { silent: true }); return; }
  await writeFile(path, content);
  refreshSidePanels();
}
async function readFileContent(path) {
  if (path === S.current) return ed.value;
  const f = S.files.get(path);
  if (!f) throw new Error('File not found: ' + path);
  if (!isMd(path)) return (await api('GET', 'file', { path })).content;
  if (f.content == null) await fetchContent(f);
  return f.content ?? '';
}

function setSaveStatus(s) { $('#st-save').textContent = s; }

function updateStatus() {
  if (S.view === 'file' && S.filePath) { // a PDF or other file: only how many notes link to it
    $('#st-words').textContent = $('#st-chars').textContent = '';
    $('#st-links').textContent = t('status.backlinks', { n: backlinksOf(S.filePath).length });
    return;
  }
  if (!S.current) { $('#st-words').textContent = $('#st-chars').textContent = $('#st-links').textContent = ''; return; }
  const text = ed.value;
  // Chinese/Japanese characters count one each (no spaces between words); everything else splits on whitespace.
  const words = (text.match(/[぀-ヿ㐀-䶿一-鿿豈-﫿]|[^\s぀-ヿ㐀-䶿一-鿿豈-﫿　-〿＀-￯]+/g) || []).length;
  $('#st-words').textContent = t('status.words', { n: words });
  $('#st-chars').textContent = t('status.chars', { n: text.length });
  const bl = backlinksOf(S.current).length;
  $('#st-links').textContent = t('status.backlinks', { n: bl });
}

// Insert text while keeping the browser's native undo stack.
function replaceRange(start, end, text) {
  const visible = ed.offsetParent !== null;
  if (visible) {
    ed.focus();
    ed.setSelectionRange(start, end);
    const ok = text ? document.execCommand('insertText', false, text) : document.execCommand('delete');
    if (ok) return;
  }
  ed.setRangeText(text, start, end, 'end');
  ed.dispatchEvent(new Event('input'));
}

function wrapSelection(before, after = before) {
  const s = ed.selectionStart, e = ed.selectionEnd, sel = ed.value.slice(s, e);
  if (sel.startsWith(before) && sel.endsWith(after) && sel.length >= before.length + after.length) {
    replaceRange(s, e, sel.slice(before.length, sel.length - after.length));
    ed.setSelectionRange(s, e - before.length - after.length);
  } else {
    replaceRange(s, e, before + sel + after);
    ed.setSelectionRange(s + before.length, s + before.length + sel.length);
  }
}

function indentLines(outdent) {
  const v = ed.value, s = ed.selectionStart, e = ed.selectionEnd;
  const ls = v.lastIndexOf('\n', s - 1) + 1;
  const le = v.indexOf('\n', e - (e > s && v[e - 1] === '\n' ? 1 : 0)); const end = le < 0 ? v.length : le;
  const lines = v.slice(ls, end).split('\n');
  const out = lines.map(l => outdent ? l.replace(/^(\t| {1,4})/, '') : '\t' + l).join('\n');
  replaceRange(ls, end, out);
  ed.setSelectionRange(ls, ls + out.length);
}

ed.addEventListener('keydown', e => {
  if (suggestKeydown(e)) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'b') { e.preventDefault(); wrapSelection('**'); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'i') { e.preventDefault(); wrapSelection('*'); return; }
  if (mod && !e.shiftKey && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const s = ed.selectionStart, e2 = ed.selectionEnd, sel = ed.value.slice(s, e2);
    replaceRange(s, e2, `[${sel}](url)`);
    ed.setSelectionRange(s + sel.length + 3, s + sel.length + 6);
    return;
  }
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = ed.selectionStart, v = ed.value;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    const isList = /^\s*([-*+]|\d+[.)])\s/.test(v.slice(ls));
    if (e.shiftKey || ed.selectionStart !== ed.selectionEnd || isList) indentLines(e.shiftKey);
    else replaceRange(s, s, '\t');
    return;
  }
  if (e.key === '[' && !mod && ed.selectionStart === ed.selectionEnd) {
    const s = ed.selectionStart;
    if (ed.value[s - 1] === '[') { e.preventDefault(); replaceRange(s, s, '[]]'); ed.setSelectionRange(s + 1, s + 1); updateSuggest(); }
    return;
  }
  if (e.key === 'Enter' && !e.shiftKey && !mod && ed.selectionStart === ed.selectionEnd) {
    const s = ed.selectionStart, v = ed.value;
    const ls = v.lastIndexOf('\n', s - 1) + 1, line = v.slice(ls, s);
    const m = line.match(/^(\s*(?:>\s*)*)(?:([-*+])|(\d+)([.)]))\s+(\[[ xX]\]\s+)?/) || line.match(/^(\s*>\s*)/);
    if (!m) return;
    e.preventDefault();
    if (line.trim() === m[0].trim()) { replaceRange(ls, s, ''); return; } // empty item ends the list
    const bullet = m[3] ? `${parseInt(m[3], 10) + 1}${m[4]} ` : m[2] ? `${m[2]} ` : '';
    replaceRange(s, s, '\n' + m[1] + bullet + (m[5] ? '[ ] ' : ''));
  }
});

// Paste or drop files (images etc.) into the editor -> saved under attachments/
async function insertAttachment(file) {
  const ext = (file.name.match(/\.[^.]+$/)?.[0] || '.' + ((file.type.split('/')[1] || 'bin').replace('jpeg', 'jpg'))).toLowerCase();
  const d = new Date();
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const name = file.name && !/^image\.(png|jpe?g|gif)$/i.test(file.name) ? file.name : `Pasted image ${stamp}${ext}`;
  try {
    const r = await api('POST', 'upload', { path: 'attachments/' + name }, file);
    S.files.set(r.path, { path: r.path, mtime: r.mtime, size: r.size });
    addFolderChain(r.path); rebuildNameIndex(); renderTree();
    const s = ed.selectionStart;
    replaceRange(s, ed.selectionEnd, `![[${linkNameFor(r.path)}]]`);
  } catch (e) { toast(t('toast.uploadFailed', { msg: e.message })); }
}
ed.addEventListener('paste', async e => {
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) await insertAttachment(f);
});
ed.addEventListener('dragover', e => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault(); });
ed.addEventListener('drop', async e => {
  const files = [...(e.dataTransfer?.files || [])];
  const treePath = e.dataTransfer?.getData('text/x-vault-path');
  if (treePath) { e.preventDefault(); const s = ed.selectionStart; replaceRange(s, s, `${isMd(treePath) ? '' : '!'}[[${linkNameFor(treePath)}]]`); return; }
  if (!files.length) return;
  e.preventDefault();
  for (const f of files) await insertAttachment(f);
});

// Split mode: keep preview roughly in step with the editor.
edWrap.addEventListener('scroll', () => {
  if (S.mode !== 'split') return;
  const r = edWrap.scrollTop / Math.max(1, edWrap.scrollHeight - edWrap.clientHeight);
  pvWrap.scrollTop = r * (pvWrap.scrollHeight - pvWrap.clientHeight);
});
new ResizeObserver(() => autosize()).observe(edWrap);

/* ---------- [[ link autocomplete ---------- */
let Sug = null;
function caretCoords(pos) {
  const div = document.createElement('div'), cs = getComputedStyle(ed);
  for (const p of ['boxSizing', 'width', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderLeftWidth', 'fontStyle', 'fontWeight', 'fontSize', 'lineHeight', 'fontFamily', 'letterSpacing', 'wordSpacing', 'tabSize', 'textIndent'])
    div.style[p] = cs[p];
  Object.assign(div.style, { position: 'absolute', visibility: 'hidden', whiteSpace: 'pre-wrap', wordWrap: 'break-word', top: '0', left: '-9999px' });
  div.textContent = ed.value.slice(0, pos);
  const span = document.createElement('span'); span.textContent = ed.value.slice(pos) || '.';
  div.appendChild(span); document.body.appendChild(div);
  const r = ed.getBoundingClientRect();
  const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.6;
  const out = { x: r.left + span.offsetLeft, y: r.top + span.offsetTop + lh, top: span.offsetTop };
  div.remove();
  return out;
}

function updateSuggest() {
  const s = ed.selectionStart;
  if (s !== ed.selectionEnd) return hideSuggest();
  const m = ed.value.slice(Math.max(0, s - 200), s).match(/(!?)\[\[([^\[\]\n|#]*)$/);
  if (!m) return hideSuggest();
  const q = m[2];
  const items = [];
  for (const f of S.files.values()) {
    const label = isMd(f.path) ? baseName(f.path) : fileName(f.path);
    const r = fuzzy(q, label);
    if (r) items.push({ f, label, r: r.score + (isMd(f.path) === !m[1] ? 5 : 0) });
  }
  items.sort((a, b) => b.r - a.r);
  if (!items.length) return hideSuggest();
  Sug = { start: s - q.length, end: s, items: items.slice(0, 20), sel: 0 };
  drawSuggest();
  const c = caretCoords(Sug.start);
  const box = $('#suggest'), bh = box.offsetHeight;
  const lh = parseFloat(getComputedStyle(ed).lineHeight) || 27;
  box.style.left = Math.max(8, Math.min(c.x, innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = (c.y + bh + 8 > innerHeight ? c.y - lh - bh - 4 : c.y + 4) + 'px';
}
function drawSuggest() {
  const box = $('#suggest');
  box.innerHTML = Sug.items.map((it, i) => `<div class="sg-item${i === Sug.sel ? ' sel' : ''}" data-i="${i}"><span class="mi-label">${esc(it.label)}</span><span class="mi-detail">${esc(dirName(it.f.path))}</span></div>`).join('');
  box.classList.remove('hidden');
  box.children[Sug.sel]?.scrollIntoView({ block: 'nearest' });
}
function hideSuggest() { Sug = null; $('#suggest').classList.add('hidden'); }
function acceptSuggest(i) {
  const it = Sug.items[i], name = linkNameFor(it.f.path);
  const start = Sug.start, end = Sug.end;
  const tail = ed.value.slice(end, end + 2) === ']]' ? '' : ']]';
  hideSuggest();
  replaceRange(start, end, name + tail);
  ed.setSelectionRange(start + name.length + 2, start + name.length + 2);
  hideSuggest();
}
function suggestKeydown(e) {
  if (!Sug) return false;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    Sug.sel = (Sug.sel + (e.key === 'ArrowDown' ? 1 : -1) + Sug.items.length) % Sug.items.length;
    drawSuggest(); return true;
  }
  if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); acceptSuggest(Sug.sel); return true; }
  if (e.key === 'Escape') { e.preventDefault(); hideSuggest(); return true; }
  return false;
}
$('#suggest').addEventListener('mousedown', e => { const el = e.target.closest('.sg-item'); if (el) { e.preventDefault(); acceptSuggest(+el.dataset.i); } });
ed.addEventListener('blur', () => setTimeout(hideSuggest, 150));
ed.addEventListener('click', hideSuggest);

/* =====================================================================
   Preview
   ===================================================================== */
function renderPreview() {
  if (!S.current || S.mode === 'source') return;
  renderInto($('#preview'), ed.value, S.current);
}

// Lines of a note that are code (fenced ``` / ~~~ blocks and indented code blocks) or frontmatter, found with the
// Markdown parser itself so they match what the preview treats as code.
function codeLines(text) {
  const out = new Set();
  const fm = text.match(FM_RE)?.[0] || '';
  const fmLines = fm ? (fm.match(/\n/g) || []).length : 0;
  for (let i = 0; i < fmLines; i++) out.add(i);
  let line = fmLines, tokens;
  try { tokens = marked.lexer(text.slice(fm.length)); } catch { return out; }
  for (const tk of tokens) {
    const n = ((tk.raw || '').match(/\n/g) || []).length;
    if (tk.type === 'code') { const end = tk.raw.endsWith('\n') ? n : n + 1; for (let k = 0; k < end; k++) out.add(line + k); }
    line += n;
  }
  return out;
}
// Apply fn to the parts of one line that are not inline `code`.
const outsideInlineCode = (line, fn) => line.split(/(`+[^`]*?`+)/).map((seg, i) => (i % 2 ? seg : fn(seg))).join('');

function toggleTask(n) {
  const v = ed.value, lines = v.split('\n');
  const fmLen = (v.match(FM_RE)?.[0] || '').split('\n').length - 1;
  const code = codeLines(v); // fenced AND indented code blocks: task syntax there is an example, not a task
  let fence = null, k = 0, offset = 0;
  for (let i = 0; i < lines.length; offset += lines[i].length + 1, i++) {
    if (i < fmLen || code.has(i)) continue;
    const l = lines[i];
    const f = l.match(/^\s*(```|~~~)/);
    if (f) { fence = fence ? null : f[1]; continue; }
    if (fence) continue;
    const m = l.match(/^(\s*(?:>\s*)*(?:[-*+]|\d+[.)])\s+\[)([ xX])\]/);
    if (!m) continue;
    if (k++ === n) {
      const at = offset + m[1].length;
      const top = pvWrap.scrollTop;
      replaceRange(at, at + 1, m[2] === ' ' ? 'x' : ' ');
      renderPreview(); pvWrap.scrollTop = top;
      return;
    }
  }
}

$('#preview').addEventListener('auxclick', e => {
  const link = e.target.closest('a.internal-link');
  if (!link || e.button !== 1) return;
  const tg = resolve(link.dataset.target, link.dataset.from || S.current || '');
  if (tg) { e.preventDefault(); openInTab(tg, { where: 'new', keep: true, heading: link.dataset.heading || '' }); }
});
$('#preview').addEventListener('change', e => {
  if (e.target.matches('input[type=checkbox][data-task]')) toggleTask(+e.target.dataset.task);
});
$('#preview').addEventListener('click', e => {
  const ct = e.target.closest('.callout-title');
  if (ct && ct.parentElement.dataset.fold) ct.parentElement.classList.toggle('collapsed');
});

// Jump to a line of the open note (from a search excerpt): select the matched word in the editor and, in the
// reading view, scroll to it and flash a highlight.
function revealLine(line, term = '') {
  const src = ed.value, lines = src.split('\n');
  if (line < 0 || line >= lines.length) return;
  const start = lines.slice(0, line).join('\n').length + (line ? 1 : 0);
  const col = term ? lines[line].toLowerCase().indexOf(term.toLowerCase()) : -1;
  const a = start + Math.max(0, col), b = col >= 0 ? a + term.length : start + lines[line].length;
  if (S.mode !== 'preview') {
    const c = caretCoords(a);
    edWrap.scrollTop = Math.max(0, c.top - edWrap.clientHeight / 3);
    ed.focus({ preventScroll: true }); ed.setSelectionRange(a, b);
  }
  if (S.mode !== 'source' && term) {
    // Which occurrence of the word is it, counting from the top of the note?
    const low = term.toLowerCase();
    let nth = 0, i = src.toLowerCase().indexOf(low);
    while (i >= 0 && i < a) { nth++; i = src.toLowerCase().indexOf(low, i + 1); }
    // Rendered text can differ from the source (frontmatter, formulas), so fall back to the first match.
    const walker = document.createTreeWalker($('#preview'), NodeFilter.SHOW_TEXT);
    const hits = [];
    let node;
    while ((node = walker.nextNode())) {
      if (node.parentElement?.closest('.katex, .frontmatter, .props')) continue;
      const tl = node.nodeValue.toLowerCase();
      for (let j = tl.indexOf(low); j >= 0; j = tl.indexOf(low, j + 1)) hits.push([node, j]);
    }
    const hit = hits[nth] || hits[0];
    if (!hit) return;
    const r = document.createRange(); r.setStart(hit[0], hit[1]); r.setEnd(hit[0], hit[1] + low.length);
    const mark = document.createElement('mark'); mark.className = 'search-flash';
    r.surroundContents(mark);
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => { if (mark.isConnected) mark.replaceWith(...mark.childNodes); }, 2600);
  }
}

function scrollToHeading(heading) {
  if (!heading) return;
  const h = heading.toLowerCase();
  if (S.mode !== 'source') {
    const el = $$('#preview h1,#preview h2,#preview h3,#preview h4,#preview h5,#preview h6').find(x => x.textContent.trim().toLowerCase() === h) || document.getElementById(slug(heading));
    if (el) el.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
  if (S.mode !== 'preview') {
    const f = S.files.get(S.current);
    const hd = (f?.headings || []).find(x => x.text.toLowerCase() === h);
    if (hd) {
      const pos = ed.value.split('\n').slice(0, hd.line).join('\n').length + (hd.line ? 1 : 0);
      const c = caretCoords(pos);
      edWrap.scrollTop = c.top - 20;
      ed.focus({ preventScroll: true }); ed.setSelectionRange(pos, pos);
    }
  }
}

/* =====================================================================
   Notes: open / create / rename / delete
   ===================================================================== */
async function openNote(path, { push = true, heading = '' } = {}) {
  const f = S.files.get(path);
  if (!f && !(sourceFormat(path) && codeEditor.hasDraft(path))) return;
  if (!isMd(path)) return showFile(path, { push, at: heading });
  leaveCustomTab();
  const prev = S.current;
  if (S.dirty) await saveNow().catch(() => {});
  // Typed more while that save was running (or it failed): the newest text is kept as the note's draft and
  // written in the background, with the same conflict check.
  if (prev && prev !== path && S.current === prev && S.dirty) { setDraft(prev, ed.value); S.dirty = false; setTimeout(retryDrafts, 50); }
  if (f.content == null) await fetchContent(f);
  if (path !== S.current) offerCheckIfWritten();
  if (S.view !== 'note') showNoteView();
  S.current = path;
  S.openedContent = f.content ?? '';
  if (push) {
    S.history = S.history.slice(0, S.hIdx + 1);
    if (S.history[S.hIdx] !== path) { S.history.push(path); S.hIdx = S.history.length - 1; }
  }
  store.set('last', path);
  $('#empty-state').classList.add('hidden');
  $('#doc').classList.remove('hidden');
  $('#title').value = baseName(path);
  $('#preview-title').textContent = baseName(path);
  setEditorText(f.content ?? '', true);
  // A draft that isn't on disk yet (compared with the disk, not with the text last tried): show it, keep it unsaved.
  const draft = drafts.get(path);
  if (draft && draft.text !== (f.disk ?? f.content ?? '')) {
    setEditorText(draft.text, true);
    S.dirty = true; setSaveStatus(t('status.unsaved'));
    toast(t('draft.restored', { name: baseName(path) }));
    clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 400);
  } else if (draft) clearDraft(path);
  setSaveStatus('');
  renderPreview();
  for (const el of $$('.tree-item.file')) el.classList.toggle('active', el.dataset.path === path);
  S.selectedFolder = null;
  refreshRightPanel(); updateStatus(); updateTopbar();
  document.title = `${baseName(path)} - Graphite`;
  if (heading) setTimeout(() => scrollToHeading(heading), 30);
  syncActiveTab();
  PM.emitFileOpen(path);
}

// You wrote in this note and are moving on: offer a short check on it (Settings → Review can turn this off).
function offerCheckIfWritten() {
  const p = S.current;
  if (!p || S.openedContent == null) return;
  const a = S.openedContent, b = ed.value;
  let s = 0; while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0; while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const changed = Math.max(a.length, b.length) - s - e;
  S.openedContent = null;
  if (changed >= 30) setTimeout(() => RV.offerCheck(p), 400);
}

function closeNote() {
  offerCheckIfWritten();
  S.current = null; S.dirty = false;
  $('#doc').classList.add('hidden'); $('#empty-state').classList.remove('hidden');
  document.title = 'Graphite';
  renderStartPage();
  refreshRightPanel(); updateStatus(); updateTopbar();
  syncActiveTab();
  PM.emitFileOpen(null);
}

async function openLink(name, heading = '', from = '') {
  if (!name) return scrollToHeading(heading);
  const target = resolve(name, from || S.current || '');
  if (target) return openNote(target, { heading });
  const clean = name.replace(/\.md$/i, '').split('/').map(seg => safeName(seg)).filter(Boolean).join('/');
  if (!clean) return;
  const f = await createFile(clean + '.md', '');
  if (f) openNote(f.path);
}

// Where a new note goes: the folder you picked in the file list, else the folder of what is open in front
// (a PDF or other file in the file view counts, so a note made while reading LA5.pdf goes next to it).
function currentFolder() {
  if (S.selectedFolder != null) return S.selectedFolder;
  if (S.view === 'file' && S.filePath) return dirName(S.filePath);
  return S.current ? dirName(S.current) : '';
}

async function createFile(path, content = '', { silent = false } = {}) {
  try {
    const r = await api('POST', 'file', { path }, content);
    const f = { path: r.path, mtime: r.mtime, size: content.length, content, disk: content };
    indexFile(f); S.files.set(f.path, f); addFolderChain(f.path);
    rebuildNameIndex(); renderTree(); refreshSidePanels();
    PM.emitVault('create', f.path); PM.emitMetadata(f.path);
    return f;
  } catch (e) { if (!silent) toast(e.message); return null; }
}

async function createFolder(p) {
  await api('POST', 'folder', { path: p });
  S.folders.add(p); addFolderChain(p + '/x'); renderTree();
  PM.emitVault('create', p);
}

async function newNote(folder = currentFolder()) {
  let p, i = 0;
  const base = t('note.untitled');
  do { p = joinPath(folder, (i ? `${base} ${i}` : base) + '.md'); i++; } while (S.files.has(p));
  const f = await createFile(p, '');
  if (!f) return;
  await openNote(f.path);
  if (S.mode === 'preview') setMode(S.lastEditMode);
  const title = $('#title'); title.focus(); title.select();
}

// Copy files from this computer into a vault folder (PDFs, slides, images…). The originals stay where they are;
// a file whose name is taken gets a numbered name instead of replacing anything.
function addFiles(folder = currentFolder()) {
  const input = Object.assign(document.createElement('input'), { type: 'file', multiple: true });
  input.onchange = async () => {
    const files = [...(input.files || [])];
    if (!files.length) return;
    const added = [];
    for (const file of files) {
      try {
        const r = await api('POST', 'upload', { path: joinPath(folder, file.name) }, file);
        S.files.set(r.path, { path: r.path, mtime: r.mtime, size: r.size });
        addFolderChain(r.path);
        added.push(r.path);
        PM.emitVault('create', r.path);
      } catch (e) { toast(t('toast.uploadFailed', { msg: `${file.name}: ${e.message}` })); }
    }
    if (!added.length) return;
    rebuildNameIndex(); renderTree();
    // Read every imported note now, so search, links, tags and review questions include them at once.
    for (const ap of added) if (isMd(ap)) { const f = S.files.get(ap); if (f) { await fetchContent(f); PM.emitMetadata(ap); } }
    rebuildNameIndex(); refreshSidePanels(); onReviewChange();
    toast(t('toast.filesAdded', { n: added.length, folder: folder || t('tree.vaultRoot') }));
    // Show the first one: notes open as notes, PDFs and other files in the file view.
    openNote(added[0]);
  };
  input.click();
}

async function newFolder(parent = currentFolder()) {
  const name = await askText(t('prompt.folderName'), '', parent ? t('prompt.folderIn', { folder: parent }) : t('prompt.folderRoot'));
  const safe = name && safeName(name, { folder: true });
  if (!safe) return;
  const p = joinPath(parent, safe);
  try {
    await api('POST', 'folder', { path: p });
    S.folders.add(p); addFolderChain(p + '/x'); S.collapsed.delete(p); renderTree();
  } catch (e) { toast(e.message); }
}

// A rename or move: every file whose path changes (the file itself, or everything in a folder), old → new.
function renamePairs(from, to) {
  const pairs = new Map();
  for (const p of S.files.keys()) if (p === from || p.startsWith(from + '/')) pairs.set(p, to + p.slice(from.length));
  return pairs;
}
// Rewrite the links that point at moved files, in every note. Only real links change: links inside code blocks
// and `inline code` (Markdown examples) are left exactly as written. Links written with a path keep a path (the
// new one); links written with just a name get the new name. Page / heading parts (#page=7) and aliases stay.
function computeLinkUpdates(pairs) {
  const out = [];
  for (const f of S.files.values()) {
    if (!isMd(f.path) || f.content == null) continue;
    const code = codeLines(f.content);
    let changed = false;
    const lines = f.content.split('\n').map((line, i) => (code.has(i) ? line : outsideInlineCode(line, seg =>
      seg.replace(/(!?)\[\[([^\[\]\n]+?)\]\]/g, (all, bang, inner) => {
        const { name, heading, alias } = splitWiki(inner);
        if (!name) return all;
        const np = pairs.get(resolve(name, f.path));
        if (!np) return all;
        const nn = name.includes('/') ? (name.startsWith('/') ? '/' : '') + (isMd(np) && !/\.md$/i.test(name) ? np.replace(/\.md$/i, '') : np)
          : (isMd(np) && !/\.md$/i.test(name) ? baseName(np) : fileName(np));
        if (nn === name) return all;
        changed = true;
        return `${bang}[[${nn}${heading ? '#' + heading : ''}${alias ? '|' + alias : ''}]]`;
      }))));
    if (changed) out.push({ path: f.path, content: lines.join('\n') });
  }
  return out;
}

const renameHooks = [pairs => RV.renamedSources(pairs), pairs => { let moved = false; for (const [o, n] of pairs) if (drafts.has(o)) { drafts.set(n, drafts.get(o)); drafts.delete(o); moved = true; } if (moved) persistDrafts(); }]; // features with their own per-file data (mistake book, cards from PDFs) follow renames
async function renamePath(from, to) {
  if (!from || !to || from === to) return false;
  const isFile = S.files.has(from);
  const taken = S.files.has(to) || S.folders.has(to);
  if (taken && from.toLowerCase() !== to.toLowerCase()) { toast(t('toast.exists', { name: to })); return false; }
  if (S.dirty) await saveNow();
  await codeEditor.idle();
  const pairs = renamePairs(from, to);
  const edits = computeLinkUpdates(pairs); // worked out before the rename, while links still resolve to the old paths
  try { await api('POST', 'rename', {}, { from, to }); } catch (e) { toast(e.message); return false; }

  const map = p => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p);
  for (const [p, f] of [...S.files]) { const np = map(p); if (np !== p) { S.files.delete(p); f.path = np; S.files.set(np, f); } }
  S.folders = new Set([...S.folders].map(map));
  addFolderChain(to);
  if (!isFile) S.folders.add(to);
  S.collapsed = new Set([...S.collapsed].map(map));
  S.history = S.history.map(map);
  codeEditor.renamed(pairs);
  reference.rename(map);
  renameInTabs(map);
  const wasCurrent = S.current;
  if (S.current) S.current = map(S.current);
  rebuildNameIndex();
  PM.emitVault('rename', to, from);
  // Keep review progress (cards, due dates, notes checked) and other per-note data for every moved note.
  for (const [o, n] of pairs) if (isMd(n)) RV.renamed(o, n);
  for (const fn of renameHooks) { try { fn(pairs); } catch (e) { console.warn(e); } }

  for (const e of edits) {
    const p = map(e.path);
    try { await writeFile(p, e.content); } catch (err) { toast(t('toast.linkUpdateFailed', { path: p })); }
    if (p === S.current) setEditorText(e.content, false);
  }
  if (edits.length) toast(t('toast.linksUpdated', { n: edits.length }));
  renderTree();
  // The PDF / image / other file shown in the file view was renamed or moved: show it under its new name.
  if (S.view === 'file' && S.filePath && map(S.filePath) !== S.filePath) await showFile(map(S.filePath), { push: false });
  if (wasCurrent && S.current !== wasCurrent) {
    $('#title').value = baseName(S.current); $('#preview-title').textContent = baseName(S.current);
    if (S.view !== 'file') { store.set('last', S.current); document.title = `${baseName(S.current)} - Graphite`; }
  }
  renderPreview(); refreshSidePanels(); updateTopbar();
  return true;
}

async function renameNoteTitle() {
  if (!S.current) return;
  const name = safeName($('#title').value);
  if (!name || name === baseName(S.current)) { $('#title').value = baseName(S.current); return; }
  const ok = await renamePath(S.current, joinPath(dirName(S.current), name + '.md'));
  $('#title').value = baseName(S.current); // shows the saved name (with any swapped characters)
}
$('#title').addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); ed.focus(); ed.setSelectionRange(0, 0); }
  if (e.key === 'Escape') { $('#title').value = baseName(S.current); ed.focus(); }
});
$('#title').addEventListener('blur', renameNoteTitle);

async function renamePrompt(path) {
  const isFile = S.files.has(path);
  const cur = isFile && isMd(path) ? baseName(path) : fileName(path);
  const typed = await askText(t('prompt.newName'), cur, t('prompt.rename', { name: cur }));
  let name = typed && safeName(typed, { folder: !isFile });
  if (!name || name === cur) return;
  // A PDF / image / other attachment keeps its extension if you type the name without one ("Lecture" → "Lecture.pdf").
  const ext = isFile && !isMd(path) ? (/\.[^./]+$/.exec(fileName(path)) || [''])[0] : '';
  if (ext && !/\.[^./]+$/.test(name)) name += ext;
  if (name === cur) return;
  await renamePath(path, joinPath(dirName(path), name + (isFile && isMd(path) ? '.md' : '')));
}

async function deletePath(path, { confirm: ask = true } = {}) {
  const isFile = S.files.has(path);
  const label = isFile && isMd(path) ? baseName(path) : fileName(path);
  if (ask && !confirm(t(isFile ? 'confirm.delete' : 'confirm.deleteFolder', { name: label }))) return;
  try { await api('DELETE', 'file', { path }); } catch (e) { if (!ask) throw e; return toast(e.message); }
  const removed = [];
  for (const p of [...S.files.keys()]) if (p === path || p.startsWith(path + '/')) { S.files.delete(p); removed.push(p); }
  for (const d of [...S.folders]) if (d === path || d.startsWith(path + '/')) { S.folders.delete(d); removed.push(d); }
  if (S.current && !S.files.has(S.current)) { S.dirty = false; closeNote(); }
  closeFileIfGone();
  rebuildNameIndex(); renderTree(); refreshSidePanels();
  await pruneTabs();
  for (const p of removed) PM.emitVault('delete', p);
  if (ask) toast(t('toast.trashed', { name: label }));
}

async function duplicate(path) {
  const f = S.files.get(path);
  if (!f || !isMd(path)) return;
  if (f.content == null) await fetchContent(f);
  let p, i = 1;
  do { p = joinPath(dirName(path), `${baseName(path)} ${i++}.md`); } while (S.files.has(p));
  const nf = await createFile(p, f.content || '');
  if (nf) openNote(nf.path);
}

async function openDaily() {
  const d = new Date();
  const name = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const path = `Daily Notes/${name}.md`;
  if (!S.files.has(path)) {
    const pretty = d.toLocaleDateString(getLang(), { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    if (!(await createFile(path, `# ${pretty}\n\n## ${t('daily.tasks')}\n- [ ] \n\n## ${t('daily.notes')}\n\n`))) return;
  }
  openNote(path);
}

function openRandom() {
  const notes = [...S.files.keys()].filter(isMd);
  if (notes.length) openNote(notes[Math.floor(Math.random() * notes.length)]);
}

/* =====================================================================
   File tree
   ===================================================================== */
function renderTree() {
  const root = { path: '', folders: new Map(), files: [] };
  const node = p => {
    let n = root, acc = '';
    for (const s of p.split('/').filter(Boolean)) {
      acc = joinPath(acc, s);
      if (!n.folders.has(s)) n.folders.set(s, { name: s, path: acc, folders: new Map(), files: [] });
      n = n.folders.get(s);
    }
    return n;
  };
  for (const d of S.folders) node(d);
  for (const f of S.files.values()) node(dirName(f.path)).files.push(f);
  const html = renderNode(root, 0);
  $('#tree').innerHTML = html || `<div class="muted pad">${esc(t('tree.empty'))}</div>`;
}

function renderNode(n, depth) {
  let h = '';
  for (const f of [...n.folders.values()].sort((a, b) => cmpName(a.name, b.name))) {
    const col = S.collapsed.has(f.path);
    h += `<div class="tree-item folder${col ? ' collapsed' : ''}" data-path="${esc(f.path)}" data-type="folder" draggable="true" style="--d:${depth}"><span class="chev">${icon('chev')}</span><span class="name">${esc(f.name)}</span></div>`;
    if (!col) h += `<div class="tree-children">${renderNode(f, depth + 1)}</div>`;
  }
  for (const f of n.files.sort((a, b) => cmpName(fileName(a.path), fileName(b.path)))) {
    const md = isMd(f.path);
    const ext = md ? '' : (fileName(f.path).match(/\.([^.]+)$/)?.[1] || '');
    h += `<div class="tree-item file${f.path === (S.view === 'file' ? S.filePath : S.current) ? ' active' : ''}" data-path="${esc(f.path)}" data-type="file" draggable="true" style="--d:${depth}" title="${esc(f.path)}"><span class="name">${esc(md ? baseName(f.path) : fileName(f.path).replace(/\.[^.]+$/, ''))}</span>${ext ? `<span class="ext">${esc(ext)}</span>` : ''}</div>`;
  }
  return h;
}

const tree = $('#tree');
tree.addEventListener('click', e => {
  const it = e.target.closest('.tree-item');
  if (!it) { S.selectedFolder = ''; return; }
  const p = it.dataset.path;
  if (it.dataset.type === 'folder') {
    S.collapsed.has(p) ? S.collapsed.delete(p) : S.collapsed.add(p);
    store.set('collapsed', [...S.collapsed]);
    S.selectedFolder = p;
    renderTree();
  } else openInTab(p, { where: e.ctrlKey || e.metaKey ? 'new' : 'auto', keep: e.ctrlKey || e.metaKey });
});
tree.addEventListener('auxclick', e => {
  const it = e.target.closest('.tree-item.file');
  if (it && e.button === 1) { e.preventDefault(); openInTab(it.dataset.path, { where: 'new', keep: true }); }
});
tree.addEventListener('dblclick', e => {
  const it = e.target.closest('.tree-item.file');
  if (!it) return;
  const tab = TABS.list.find(x => x.kind === 'path' && x.path === it.dataset.path);
  if (tab?.preview) { tab.preview = false; renderTabs(); persistTabs(); }
});
tree.addEventListener('contextmenu', e => {
  e.preventDefault();
  const it = e.target.closest('.tree-item');
  if (!it) return showMenu(e.clientX, e.clientY, [
    { label: t('menu.newNote'), run: () => newNote('') }, { label: t('menu.newFolder'), run: () => newFolder('') },
    { label: t('menu.addFiles'), run: () => addFiles('') },
  ]);
  const p = it.dataset.path, isFolder = it.dataset.type === 'folder';
  // Items added by plugins through the "file-menu" event go at the end.
  const extra = PM.fileMenuItems(p, isFolder);
  const tail = extra.length ? ['-', ...extra] : [];
  if (isFolder) showMenu(e.clientX, e.clientY, [
    { label: t('menu.newNote'), run: () => newNote(p) }, { label: t('menu.newFolder'), run: () => newFolder(p) },
    { label: t('menu.addFiles'), run: () => addFiles(p) }, '-',
    { label: t('menu.rename'), run: () => renamePrompt(p) }, { label: t('menu.delete'), danger: true, run: () => deletePath(p) }, ...tail,
  ]);
  else showMenu(e.clientX, e.clientY, [
    { label: t('menu.open'), run: () => openInTab(p, { where: 'auto' }) },
    { label: t('tabs.openNew'), run: () => openInTab(p, { where: 'new', keep: true }) },
    ...(isMd(p) ? [{ label: t('menu.copy'), run: () => duplicate(p) }] : []),
    { label: t('menu.rename'), run: () => renamePrompt(p) }, '-',
    ...(isMd(p) ? [{ label: t('cmd.tidy-format'), run: async () => { await openNote(p); SA.tidyFormat(p); } }] : []),
    ...(/\.pdf$/i.test(p) ? [{ label: t('sum.title'), run: () => SUM.summaryDialog(p) }] : []),
    ...(isMd(p) || /\.pdf$/i.test(p) ? [{ label: t('menu.examAnalysis'), run: () => SA.examDialog(p) }, '-'] : []),
    { label: t('menu.delete'), danger: true, run: () => deletePath(p) }, ...tail,
  ]);
});
// Drag files/folders onto folders (or empty space = vault root) to move them.
tree.addEventListener('dragstart', e => {
  const it = e.target.closest('.tree-item');
  if (!it) return;
  e.dataTransfer.setData('text/x-vault-path', it.dataset.path);
  // move (onto a folder), copy (open in a tab), link (into a note): a drop whose effect isn't allowed here is silently refused
  e.dataTransfer.effectAllowed = 'all';
});
const dropFolderOf = e => { const it = e.target.closest('.tree-item'); return it ? (it.dataset.type === 'folder' ? it.dataset.path : dirName(it.dataset.path)) : ''; };
tree.addEventListener('dragover', e => {
  if (!e.dataTransfer.types.includes('text/x-vault-path')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  $$('.drop-target').forEach(x => x.classList.remove('drop-target'));
  const it = e.target.closest('.tree-item.folder');
  if (it) it.classList.add('drop-target');
});
tree.addEventListener('dragleave', () => $$('.drop-target').forEach(x => x.classList.remove('drop-target')));
tree.addEventListener('drop', async e => {
  const src = e.dataTransfer.getData('text/x-vault-path');
  $$('.drop-target').forEach(x => x.classList.remove('drop-target'));
  if (!src) return;
  e.preventDefault();
  const folder = dropFolderOf(e);
  if (folder === dirName(src) || folder === src || folder.startsWith(src + '/')) return;
  await renamePath(src, joinPath(folder, fileName(src)));
});

/* =====================================================================
   Context menu & modal
   ===================================================================== */
function showMenu(x, y, items) {
  const m = $('#ctxmenu');
  m.innerHTML = items.map((it, i) => it === '-' ? '<div class="sep"></div>' : `<div class="ctx-item${it.danger ? ' danger' : ''}" data-i="${i}">${esc(it.label)}</div>`).join('');
  m.classList.remove('hidden');
  m.style.left = Math.min(x, innerWidth - m.offsetWidth - 8) + 'px';
  m.style.top = Math.min(y, innerHeight - m.offsetHeight - 8) + 'px';
  m.onclick = e => { const el = e.target.closest('.ctx-item'); if (!el) return; hideMenu(); items[+el.dataset.i].run(); };
}
function hideMenu() { $('#ctxmenu').classList.add('hidden'); }
document.addEventListener('mousedown', e => { if (!e.target.closest?.('#ctxmenu')) hideMenu(); });

function fuzzy(q, s) {
  q = q.toLowerCase().trim(); const sl = s.toLowerCase();
  if (!q) return { score: 0, idx: [] };
  const sub = sl.indexOf(q);
  if (sub >= 0) return { score: 100 - sub + (sub === 0 ? 50 : 0) - s.length * 0.1, idx: Array.from({ length: q.length }, (_, i) => sub + i) };
  const idx = []; let j = 0, score = 0, last = -2;
  for (let i = 0; i < sl.length && j < q.length; i++) {
    if (sl[i] === q[j]) { idx.push(i); score += i === last + 1 ? 5 : 1; last = i; j++; }
  }
  return j < q.length ? null : { score: score - s.length * 0.1, idx };
}
function hl(s, idx) { const set = new Set(idx); return s.split('').map((c, i) => (set.has(i) ? `<b>${esc(c)}</b>` : esc(c))).join(''); }

const Modal = {
  opts: null, items: [], sel: 0,
  open(opts) {
    this.opts = opts; this.sel = 0;
    $('#modal').classList.remove('hidden');
    const inp = $('#modal-input');
    inp.value = opts.value || ''; inp.placeholder = opts.placeholder || '';
    $('#modal-hint').innerHTML = opts.hint || '';
    this.update(); inp.focus(); inp.select();
  },
  close(chosen = false) {
    if (!this.opts) return;
    const o = this.opts; this.opts = null;
    $('#modal').classList.add('hidden');
    if (!chosen && o.onCancel) o.onCancel();
  },
  update() {
    if (!this.opts) return;
    const q = $('#modal-input').value;
    this.items = this.opts.items ? this.opts.items(q) : [];
    this.sel = Math.min(this.sel, Math.max(0, this.items.length - 1));
    $('#modal-list').innerHTML = this.items.map((it, i) => `<div class="modal-item${i === this.sel ? ' sel' : ''}" data-i="${i}"><span class="mi-label">${it.html ?? esc(it.label)}</span>${it.detail ? `<span class="mi-detail">${esc(it.detail)}</span>` : ''}${it.kbd ? `<kbd>${esc(it.kbd)}</kbd>` : ''}</div>`).join('');
    $('#modal-list').children[this.sel]?.scrollIntoView({ block: 'nearest' });
  },
  choose(i) {
    const o = this.opts, q = $('#modal-input').value, it = this.items[i];
    this.close(true);
    if (it) it.run(q); else if (o.onSubmit) o.onSubmit(q);
  },
};
$('#modal-input').addEventListener('input', () => { Modal.sel = 0; Modal.update(); });
$('#modal-input').addEventListener('keydown', e => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = Modal.items.length; if (!n) return;
    Modal.sel = (Modal.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; Modal.update();
  } else if (e.key === 'Enter') { e.preventDefault(); Modal.choose(e.shiftKey ? -1 : Modal.sel); }
  else if (e.key === 'Escape') { e.preventDefault(); Modal.close(); }
});
$('#modal-list').addEventListener('click', e => { const el = e.target.closest('.modal-item'); if (el) Modal.choose(+el.dataset.i); });
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') Modal.close(); });

function askText(placeholder, value = '', hint = '') {
  return new Promise(res => Modal.open({
    placeholder, value, hint: (hint ? esc(hint) + ' · ' : '') + esc(t('prompt.hint')),
    onSubmit: v => res(v.trim() || null), onCancel: () => res(null),
  }));
}

function quickSwitcher() {
  Modal.open({
    placeholder: t('qs.placeholder'),
    hint: esc(t('qs.hint')),
    items: q => {
      const res = [];
      for (const f of S.files.values()) {
        const label = isMd(f.path) ? baseName(f.path) : fileName(f.path);
        const r = fuzzy(q, label) || (q && fuzzy(q, f.path) ? { score: -50, idx: [] } : null);
        if (r) res.push({ f, label, r });
      }
      if (!q) res.sort((a, b) => b.f.mtime - a.f.mtime); else res.sort((a, b) => b.r.score - a.r.score);
      const items = res.slice(0, 50).map(({ f, label, r }) => ({ html: hl(label, r.idx), detail: dirName(f.path), run: () => openInTab(f.path, { where: 'auto' }) }));
      if (q.trim() && !res.some(x => x.label.toLowerCase() === q.trim().toLowerCase()))
        items.push({ html: `<span class="muted">${esc(t('qs.create'))}</span> ${esc(q.trim())}`, run: v => openLink(v.trim()) });
      return items;
    },
    onSubmit: v => v.trim() && openLink(v.trim()),
  });
}

// Let the user pick the other half of the workbench without changing the active document on cancel.
function chooseStudyFile(pickNote, chosen) {
  const currentFolder = dirName(S.filePath || S.current || '');
  const candidates = [...S.files.keys()].filter(p => pickNote ? isMd(p) : /\.pdf$/i.test(p));
  Modal.open({
    placeholder: t(pickNote ? 'ref.chooseNote' : 'ref.choosePdf'),
    hint: !candidates.length && !pickNote ? esc(t('ref.noPdfs')) : '',
    items: q => {
      const hits = candidates.map(path => ({ path, rank: fuzzy(q, fileName(path)) || fuzzy(q, path) }))
        .filter(x => x.rank)
        .sort((a, b) => b.rank.score - a.rank.score ||
          Number(dirName(b.path) === currentFolder) - Number(dirName(a.path) === currentFolder) || cmpName(a.path, b.path));
      const items = hits.slice(0, 50).map(({path}) => ({
        label: pickNote ? baseName(path) : fileName(path), detail: dirName(path), run: () => chosen(path),
      }));
      if (pickNote) items.push({ label: t('menu.newNote'), run: async () => {
        const title = await askText(t('prompt.newName'));
        if (!title) return;
        const name = safeName(title.replace(/\.md$/i, ''));
        if (!name) return;
        const path = joinPath(currentFolder, name + '.md');
        if (S.files.has(path)) { toast(t('toast.exists', { name: path })); return; }
        const f = await createFile(path);
        if (f) chosen(f.path);
      } });
      return items;
    },
  });
}

function openStudyReference() {
  if (S.view === 'file' && /\.pdf$/i.test(S.filePath || '')) {
    const path = S.filePath, pdf = S.pdf;
    const page = (pdf?.ready && pdf.ctl?.page) || pdf?.jumpPage || pdf?.requestedPage || 1;
    chooseStudyFile(true, async note => {
      await openInTab(note, { where: 'new', keep: true });
      if (S.view === 'note' && S.current === note) reference.select(path, page);
    });
  } else if (S.view === 'note' && S.current) {
    chooseStudyFile(false, path => reference.select(path));
  }
}
const reference = createReferencePane({
  store, vault: () => S.vault, files: () => S.files, url: path => '/vault/' + encPath(path),
  choose: openStudyReference,
  cite: (path, page) => replaceRange(ed.selectionStart, ed.selectionEnd, selSourceLink({ path, page })),
  layout: () => { updateTopbar(); requestAnimationFrame(autosize); },
});

function recordSource(path, result) {
  const existing = S.files.get(path);
  if (existing) { existing.mtime=result.mtime; return; }
  S.files.set(path,{path,mtime:result.mtime}); addFolderChain(path); rebuildNameIndex(); renderTree();
  PM.emitVault('create', path);
}
const codeEditor = createCodeEditor({
  vault: () => S.vault, askName: value => askText(t('code.name'),value), savedFile:recordSource, toast,
  openCreated:async(path,result)=>{ recordSource(path,result); await openInTab(path,{where:'new',keep:true}); },
  copyLine:async(path,line)=>{
    const text='[['+linkNameFor(path)+'#L'+line+'|'+fileName(path)+' L'+line+']]';
    if (await copyText(text)) toast(t('file.linkCopied'));
  },
});
async function newCodeFile() {
  const folder = S.selectedFolder ?? (S.view==='file' && S.filePath ? dirName(S.filePath) : currentFolder());
  // In the desktop app: choose any folder of this vault, or a project folder elsewhere on this computer; the new
  // file opens in the code workbench (folder tree, run and debug). The browser version keeps the simple prompt.
  if (workbenchAvailable()) {
    const choice = await newCodeFileDialog({ wb: codeWorkbench, vaultFolders: () => [...S.folders].filter(f => !/^\./.test(f)).sort(), startFolder: folder });
    if (!choice) return;
    await openCustomTab('code-workbench', 'workbench');
    if (await codeWorkbench.createFile(choice) && choice.where === 'vault') await sync().catch(() => {});
    return;
  }
  const name=await askText(t('code.name'),'main.cpp',folder);
  if (!name) return;
  if (!sourceFormat(name) || name !== safeName(name) || /[\\/]/.test(name)) { toast(t('code.badName')); return; }
  const path=joinPath(folder,name);
  try { const result=await codeEditor.create(path); recordSource(path,result); await openInTab(path,{where:'new',keep:true}); }
  catch(err) { toast(err.status===409?t('code.exists'):t('code.error',{msg:err.message})); }
}

/* =====================================================================
   Commands & shortcuts
   ===================================================================== */
const COMMANDS = [
  { id: 'sjtu-canvas', name: 'SJTU Canvas courses, files and deadlines', run: () => openCustomTab('sjtu-canvas', 'courses', {here:true}) },
  { id:'new-code-file', name:'Create a code file', run:newCodeFile },
  { id:'code-workbench', name:'Open the code workbench (project folder, run and debug C++)', available: () => workbenchAvailable(), run: () => openCustomTab('code-workbench', 'workbench') },
  { id: 'study-reference', name: 'Study PDF beside a note', available: () => (S.view === 'note' && !!S.current) || (S.view === 'file' && /\.pdf$/i.test(S.filePath || '')), run: openStudyReference },
  { id: 'new-note', name: 'Create new note', kbd: 'Alt+N', run: () => newNote() },
  { id: 'new-folder', name: 'Create new folder', run: () => newFolder() },
  { id: 'quick-switcher', name: 'Open quick switcher', kbd: 'Ctrl+O', run: quickSwitcher },
  { id: 'palette', name: 'Open command palette', kbd: 'Ctrl+P', run: () => palette() },
  { id: 'daily', name: "Open today's daily note", kbd: 'Alt+D', run: openDaily },
  { id: 'random', name: 'Open random note', run: openRandom },
  { id: 'graph', name: 'Toggle graph view', kbd: 'Ctrl+G', run: () => (S.view === 'graph' ? showNoteView() : showGraph()) },
  { id: 'local-graph', name: 'Open local graph of current note', run: () => { $('#g-local').checked = true; showGraph(); } },
  { id: 'search', name: 'Search in all files', kbd: 'Ctrl+Shift+F', run: () => searchFor($('#search-input').value) },
  { id: 'toggle-mode', name: 'Toggle reading / editing view', kbd: 'Ctrl+E', run: () => setMode(S.mode === 'preview' ? S.lastEditMode : 'preview') },
  { id: 'mode-source', name: 'Switch to editing view', run: () => setMode('source') },
  { id: 'mode-split', name: 'Switch to split view', run: () => setMode('split') },
  { id: 'mode-preview', name: 'Switch to reading view', run: () => setMode('preview') },
  { id: 'rename', name: 'Rename current note', kbd: 'F2', run: () => {
    if (codeEditor.activePath) return renamePrompt(codeEditor.activePath);
    if (S.current) { showNoteView(); setMode(S.mode === 'preview' ? S.lastEditMode : S.mode); $('#title').focus(); $('#title').select(); }
  } },
  { id: 'duplicate', name: 'Make a copy of current note', run: () => S.current && duplicate(S.current) },
  { id: 'delete', name: 'Delete current note', run: () => S.current && deletePath(S.current) },
  { id: 'insert-date', name: 'Insert current date', run: () => { const d = new Date(); insertAtCursor(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`); } },
  { id: 'insert-time', name: 'Insert current time', run: () => { const d = new Date(); insertAtCursor(`${pad(d.getHours())}:${pad(d.getMinutes())}`); } },
  { id: 'insert-table', name: 'Insert table', run: () => insertAtCursor(`\n| ${t('insert.col', { n: 1 })} | ${t('insert.col', { n: 2 })} |\n| --- | --- |\n|  |  |\n`) },
  { id: 'insert-callout', name: 'Insert callout', run: () => insertAtCursor(`\n> [!note] ${t('insert.calloutTitle')}\n> ${t('insert.calloutContent')}\n`) },
  { id: 'insert-math', name: 'Insert math block', run: () => { if (!S.current) return; insertAtCursor('\n$$\n\n$$\n'); const p = ed.selectionStart - 4; ed.setSelectionRange(p, p); } },
  { id: 'language', name: 'Change language', run: () => chooseLanguage() },
  { id: 'check-updates', name: 'Check for updates', available: () => !!window.myobsidianDesktop?.checkUpdates, run: () => checkUpdates(true) },
  { id: 'install-update', name: 'Install update', available: () => !!S.update?.available, run: () => installUpdate() },
  { id: 'toggle-left', name: 'Toggle left sidebar', run: () => toggleSide('left') },
  { id: 'toggle-right', name: 'Toggle right sidebar', run: () => toggleSide('right') },
  { id: 'toggle-theme', name: 'Toggle light / dark theme', run: () => applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark') },
  { id: 'collapse-all', name: 'Collapse all folders', run: () => { S.collapsed = new Set(S.folders); store.set('collapsed', [...S.collapsed]); renderTree(); } },
  { id: 'expand-all', name: 'Expand all folders', run: () => { S.collapsed.clear(); store.set('collapsed', []); renderTree(); } },
  { id: 'reload', name: 'Reload vault from disk', run: async () => { await loadAll(); renderTree(); refreshSidePanels(); if (S.current && S.files.has(S.current)) openNote(S.current, { push: false }); toast(t('toast.reloaded')); } },
  { id: 'graph-fit', name: 'Fit graph to screen', run: () => fitGraph() },
  { id: 'back', name: 'Navigate back', kbd: 'Alt+←', run: () => navigate(-1) },
  { id: 'forward', name: 'Navigate forward', kbd: 'Alt+→', run: () => navigate(1) },
  { id: 'help', name: 'Open help', kbd: 'F1', run: () => (S.view === 'help' && S.helpPage === 'guide' ? showNoteView() : showHelp('guide')) },
  { id: 'markdown-cheatsheet', name: 'Open Markdown cheatsheet', run: () => (S.view === 'help' && S.helpPage === 'markdown' ? showNoteView() : showHelp('markdown')) },
  { id: 'review', name: 'Open review', kbd: 'Alt+R', run: () => showReview() }, // always opens Review (going back is the tab or Back)
  { id: 'start-review', name: 'Start today’s review', run: () => RV.startDailyReview() },
  { id: 'check-note', name: 'Check this note for mistakes', kbd: 'Ctrl+Shift+E', available: () => !!S.current, run: async () => { if (S.dirty) await saveNow(); CK.checkNote(S.current); } },
  { id: 'tidy-format', name: 'Tidy this note\'s format to match its folder', kbd: 'Ctrl+Shift+Y', available: () => !!S.current, run: () => SA.tidyFormat(S.current) },
  { id: 'revision-plan', name: 'Make an exam revision plan', run: () => SA.planDialog() },
  { id: 'find-course-files', name: 'Find new course files on this computer', run: () => FJ.runFileJob('import', 'import') },
  { id: 'find-course-files-manual', name: 'Find new course files (Graphite scan only, no AI)', run: () => FJ.runFileJob('import', 'import', { manual: true }) },
  { id: 'file-inbox', name: 'File my captures into my notes', run: () => FJ.runFileJob('inbox', 'inbox') },
  { id: 'mock-paper', name: 'Make a mock paper', run: () => SA.mockDialog() },
  { id: 'summarize-pdf', name: 'Summarize this PDF', available: () => S.view === 'file' && /\.pdf$/i.test(S.filePath || ''), run: () => SUM.summaryDialog(S.filePath) },
  { id: 'exam-analysis', name: 'Analyse an exam paper', run: () => SA.examDialog(S.view === 'file' && /\.pdf$/i.test(S.filePath || '') ? S.filePath : (S.current || '')) },
  { id: 'quiz-note', name: 'Quiz yourself on this note', kbd: 'Ctrl+Shift+K', available: () => !!S.current, run: async () => { if (S.dirty) await saveNow(); RV.checkNote(S.current); } },
  { id: 'latex-cheatsheet', name: 'Open LaTeX cheatsheet', run: () => (S.view === 'help' && S.helpPage === 'latex' ? showNoteView() : showHelp('latex')) },
  { id: 'settings', name: 'Open settings', kbd: 'Ctrl+,', run: () => openSettings() },
  { id: 'study-settings', name: 'Open study settings', run: () => openSettings('study') },
  { id: 'feature-handbook', name: 'Search the feature manual', run: async () => { if (!(S.view === 'help' && S.helpPage === 'guide')) await showHelp('guide'); HB.focus(); } },
  { id: 'ai-settings', name: 'Choose who does each AI job', run: () => openSettings('ai') },
  { id: 'reload-plugins', name: 'Reload plugins', run: async () => { await PM.reloadAll(); refreshSettings(); } },
];
// Returns false when the command does not exist or is not available right now.
const noteCommands = new Set(['duplicate','delete','insert-date','insert-time','insert-table','insert-callout','insert-math','tidy-format','check-note','quiz-note','toggle-mode','mode-source','mode-split','mode-preview']);
const commandAvailable = c => !!c && !(codeEditor.activePath && noteCommands.has(c.id)) && (!c.available || c.available());
const runCommand = id => {
  const c = COMMANDS.find(x => x.id === id);
  if (!commandAvailable(c)) return false;
  c.run();
  return true;
};
function registerCommand(cmd) { unregisterCommand(cmd.id); COMMANDS.push(cmd); }
function unregisterCommand(id) { const i = COMMANDS.findIndex(c => c.id === id); if (i >= 0) COMMANDS.splice(i, 1); }

function insertAtCursor(text) {
  if (!S.current) return;
  if (S.mode === 'preview') setMode(S.lastEditMode);
  const s = ed.selectionStart;
  replaceRange(s, ed.selectionEnd, text);
}

function palette() {
  Modal.open({
    placeholder: t('palette.placeholder'),
    hint: esc(t('palette.hint')),
    // Match the translated name first; fall back to the English name so English keywords always work.
    items: q => COMMANDS.filter(c => c.id !== 'palette' && commandAvailable(c))
      .map(c => {
        const label = c.label || t('cmd.' + c.id);
        const r = fuzzy(q, label) || (fuzzy(q, c.name) ? { score: -20, idx: [] } : null);
        return { c, label, r };
      }).filter(x => x.r)
      .sort((a, b) => b.r.score - a.r.score)
      .map(({ c, label, r }) => ({ html: hl(label, r.idx), kbd: c.kbd, run: c.run })),
  });
}

function chooseLanguage() {
  Modal.open({
    placeholder: t('lang.placeholder'),
    hint: esc(t('lang.hint')),
    items: q => LANGS
      .filter(l => !q.trim() || fuzzy(q, l.name) || fuzzy(q, l.english) || fuzzy(q, l.code))
      .map(l => ({ html: `${esc(l.name)}${l.code === getLang() ? ' <span class="muted">✓</span>' : ''}`, detail: l.english, run: () => changeLanguage(l.code) })),
  });
  const i = LANGS.findIndex(l => l.code === getLang());
  if (i > 0) { Modal.sel = i; Modal.update(); }
}

function changeLanguage(code) {
  setLang(code);
  store.set('lang', code);
  applyI18n();
  renderTree(); refreshSidePanels(); updateTopbar(); setSaveStatus('');
  if (S.update) showUpdate(S.update); // update button tooltip in the new language
  PM.setMomentLocale(code);
  window.myobsidianDesktop?.setLanguage(code);
  refreshSettings();
  canvasWorkspace.relabel();
  codeWorkbench.relabel();
  renderTabs();
  if (activeTab()?.kind === 'empty') renderStartPage();
  if (S.view === 'graph') { readGraphColors(); drawGraph(); }
  if (S.view === 'help') showHelp();
}

// Tab shortcuts (capture phase, so they work inside the editor too).
document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey;
  if (!mod || e.altKey) return;
  if (!$('#modal').classList.contains('hidden') || document.querySelector('.plugin-modal, #cv-submit-dialog[open]') || settingsOpen()) return;
  const k = e.key.toLowerCase();
  let done = true;
  if (e.key === 'Tab') cycleTab(e.shiftKey ? -1 : 1);
  else if (e.key === 'PageDown') cycleTab(1);
  else if (e.key === 'PageUp') cycleTab(-1);
  else if (k === 't' && !e.shiftKey) newTab();
  else if (k === 't' && e.shiftKey) reopenClosedTab();
  else if (k === 'w' && !e.shiftKey) { if (TABS.active) closeTab(TABS.active); }
  else if (/^[1-9]$/.test(e.key) && !e.shiftKey) { const tab = e.key === '9' ? TABS.list[TABS.list.length - 1] : TABS.list[+e.key - 1]; if (tab) activateTab(tab.id); }
  else done = false;
  if (done) { e.preventDefault(); e.stopPropagation(); }
}, true);

// Pages shown inside the app (the 🎓 study tabs, embedded web pages) get keyboard focus when you click in them,
// and their key presses never reach this window. So Graphite's own shortcuts (tabs, reopen closed tab,
// switcher, palette, back/forward…) are caught inside every same-origin frame and replayed here. Keys the page
// itself needs (copy, paste, select all, find, typing) stay with the page.
function isAppShortcut(e) {
  const mod = e.ctrlKey || e.metaKey, k = (e.key || '').toLowerCase();
  if (e.key === 'F1') return true;
  if (mod && !e.altKey) {
    if (['Tab', 'PageUp', 'PageDown'].includes(e.key)) return true;
    if (!e.shiftKey) return /^[1-9]$/.test(e.key) || ['t', 'w', 'o', 'p', 'n', 'g', ','].includes(k);
    return ['t', 'f', 'k', 'e', 'y'].includes(k);
  }
  if (e.altKey && !mod) return ['r', 'd', 'n'].includes(k) || e.key === 'ArrowLeft' || e.key === 'ArrowRight';
  return false;
}
function bridgeFrameKeys(frame) {
  const hook = () => {
    let win;
    try { win = frame.contentWindow; if (!win || !win.document || win.__graphiteKeys) return; } catch { return; } // sandboxed / other origin
    win.__graphiteKeys = true;
    win.addEventListener('keydown', e => {
      if (!isAppShortcut(e)) return;
      const copy = new KeyboardEvent('keydown', { key: e.key, code: e.code, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, bubbles: true, cancelable: true });
      document.dispatchEvent(copy);
      if (copy.defaultPrevented) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  };
  frame.addEventListener('load', hook);
  hook();
}
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType !== 1) continue;
    if (n.tagName === 'IFRAME') bridgeFrameKeys(n);
    else n.querySelectorAll?.('iframe').forEach(bridgeFrameKeys);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
document.querySelectorAll('iframe').forEach(bridgeFrameKeys);

document.addEventListener('keydown', e => {
  const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (!$('#modal').classList.contains('hidden') || document.querySelector('.plugin-modal, #cv-submit-dialog[open]') || settingsOpen()) return;
  if (e.key === 'F1') { e.preventDefault(); runCommand('help'); return; }
  if (mod && !e.shiftKey && e.key === ',') { e.preventDefault(); openSettings(); return; }
  if (e.key === 'Escape' && S.view === 'help') { showNoteView(); return; }
  if (mod && !e.shiftKey && k === 'o') { e.preventDefault(); quickSwitcher(); }
  else if (mod && !e.shiftKey && k === 'p') { e.preventDefault(); palette(); }
  else if (mod && !e.shiftKey && k === 's') { e.preventDefault(); if (S.view === 'file' && codeEditor.activePath) codeEditor.save(); else saveNow().then(retryDrafts); }
  else if (mod && !e.shiftKey && k === 'e') { e.preventDefault(); runCommand('toggle-mode'); }
  else if (mod && !e.shiftKey && k === 'g') { e.preventDefault(); runCommand('graph'); }
  else if (mod && !e.shiftKey && k === 'n') { e.preventDefault(); newNote(); }
  else if (mod && e.shiftKey && k === 'f') { e.preventDefault(); runCommand('search'); }
  else if (e.altKey && !mod && k === 'n') { e.preventDefault(); newNote(); }
  else if (e.altKey && !mod && k === 'd') { e.preventDefault(); openDaily(); }
  else if (e.altKey && !mod && k === 'r') { e.preventDefault(); runCommand('review'); }
  else if (mod && e.shiftKey && k === 'k') { e.preventDefault(); runCommand('quiz-note'); }
  else if (mod && e.shiftKey && k === 'e') { e.preventDefault(); runCommand('check-note'); }
  else if (mod && e.shiftKey && k === 'y') { e.preventDefault(); runCommand('tidy-format'); }
  else if (e.altKey && e.key === 'ArrowLeft') { e.preventDefault(); navigate(-1); }
  else if (e.altKey && e.key === 'ArrowRight') { e.preventDefault(); navigate(1); }
  else if (e.key === 'F2') { e.preventDefault(); runCommand('rename'); }
  else if (e.key === 'Escape' && S.view === 'graph') showNoteView();
});

// Global click delegation: commands, note links, tags.
document.addEventListener('click', e => {
  const cmd = e.target.closest('[data-cmd]');
  // The "+" note button above the file list offers a choice: a new note, or files from this computer.
  if (cmd && cmd.dataset.cmd === 'new-note' && cmd.closest('.pane-toolbar')) {
    e.preventDefault();
    const r = cmd.getBoundingClientRect(), folder = currentFolder();
    showMenu(r.left, r.bottom + 4, [
      { label: t('menu.newNote') + '   Alt+N', run: () => newNote(folder) },
      { label: t('cmd.new-code-file'), run: newCodeFile },
      { label: t('menu.addFiles'), run: () => addFiles(folder) },
    ]);
    return;
  }
  if (cmd) { e.preventDefault(); runCommand(cmd.dataset.cmd); return; }
  // Example links and tags in the cheatsheets are only examples: don't open, create or search anything.
  if (S.view === 'help' && S.helpPage !== 'guide' && e.target.closest('#help-body') && e.target.closest('a.internal-link, [data-tag], [data-open]')) { e.preventDefault(); return; }
  const open = e.target.closest('[data-open]');
  if (open && (e.ctrlKey || e.metaKey) && S.files.has(open.dataset.open)) { e.preventDefault(); openInTab(open.dataset.open, { where: 'new', keep: true, heading: open.dataset.heading || '' }); return; }
  if (open) {
    e.preventDefault();
    const at = open.dataset.line;
    openNote(open.dataset.open, { heading: open.dataset.heading || '' }).then(() => {
      if (at != null && S.current === open.dataset.open) setTimeout(() => revealLine(+at, open.dataset.term || ''), 40);
    });
    return;
  }
  const link = e.target.closest('a.internal-link');
  // Resolve from the note the link was written in (an embedded note's own folder), not the outer note.
  if (link && (e.ctrlKey || e.metaKey)) { const tg = resolve(link.dataset.target, link.dataset.from || S.current || ''); if (tg) { e.preventDefault(); openInTab(tg, { where: 'new', keep: true, heading: link.dataset.heading || '' }); return; } }
  if (link) { e.preventDefault(); openLink(link.dataset.target, link.dataset.heading, link.dataset.from); return; }
  const tag = e.target.closest('[data-tag]');
  if (tag) { e.preventDefault(); searchFor('#' + tag.dataset.tag); }
});

function navigate(dir) {
  const i = S.hIdx + dir;
  if (i < 0 || i >= S.history.length) return;
  const p = S.history[i];
  if (!S.files.has(p)) { S.history.splice(i, 1); if (dir < 0) S.hIdx--; return navigate(dir); }
  S.hIdx = i; openNote(p, { push: false });
}

function updateTopbar() {
  const editing = S.view === 'note' && !!S.current && !$('#main').classList.contains('tab-custom');
  const readingPdf = S.view === 'file' && /\.pdf$/i.test(S.filePath || '');
  const shown = reference.refresh(editing);
  $('#reference-button').classList.toggle('hidden', shown || !(editing || readingPdf));
  $('#nav-back').disabled = S.hIdx <= 0;
  $('#nav-fwd').disabled = S.hIdx >= S.history.length - 1;
  const bc = $('#breadcrumb');
  if (S.view === 'graph') { bc.innerHTML = `<b>${esc(t('graph.title'))}</b>`; return; }
  if (S.view === 'help') { bc.innerHTML = `<b>${esc(t(S.helpPage && S.helpPage !== 'guide' ? (S.helpPage === 'latex' ? 'latex.title' : 'mdsheet.title') : 'help.title'))}</b>`; return; }
  if (S.view === 'review') { bc.innerHTML = `<b>${esc(t('review.title'))}</b>`; return; }
  if (S.view === 'file' && S.filePath) {
    const fp = dirName(S.filePath).split('/').filter(Boolean);
    bc.innerHTML = fp.map(p => esc(p) + ' / ').join('') + `<b>${esc(fileName(S.filePath))}</b>`;
    return;
  }
  if (!S.current) { bc.textContent = ''; return; }
  const parts = dirName(S.current).split('/').filter(Boolean);
  bc.innerHTML = parts.map(p => esc(p) + ' / ').join('') + `<b>${esc(baseName(S.current))}</b>`;
}
$('#nav-back').addEventListener('click', () => navigate(-1));
$('#nav-fwd').addEventListener('click', () => navigate(1));

/* =====================================================================
   Layout: modes, sidebars, theme
   ===================================================================== */
function setMode(mode) {
  S.mode = mode; store.set('mode', mode);
  if (mode !== 'preview') { S.lastEditMode = mode; store.set('lastEditMode', mode); }
  $('#panes').className = 'mode-' + mode;
  $$('#mode-switch button').forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
  if (S.view === 'graph') showNoteView();
  renderPreview();
  requestAnimationFrame(autosize);
}
$('#mode-switch').addEventListener('click', e => { const b = e.target.closest('[data-mode]'); if (b) setMode(b.dataset.mode); });

function toggleSide(side) {
  const app = $('#app'), cls = side + '-collapsed';
  app.classList.toggle(cls);
  store.set(cls, app.classList.contains(cls));
  fitSides();
  if (S.view === 'graph') requestAnimationFrame(drawGraph);
}

function applyTheme(t = store.get('theme', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark')) {
  document.documentElement.dataset.theme = t; store.set('theme', t);
  readGraphColors(); if (S.view === 'graph') drawGraph();
}

function setLeftTab(tab) {
  $$('[data-ltab]').forEach(b => b.classList.toggle('active', b.dataset.ltab === tab));
  for (const t of ['files', 'search', 'tags']) $('#lpane-' + t).classList.toggle('hidden', t !== tab);
  if ($('#app').classList.contains('left-collapsed')) toggleSide('left');
}
$$('[data-ltab]').forEach(b => b.addEventListener('click', () => { setLeftTab(b.dataset.ltab); if (b.dataset.ltab === 'search') $('#search-input').focus(); }));
$$('[data-rtab]').forEach(b => b.addEventListener('click', () => {
  $$('[data-rtab]').forEach(x => x.classList.toggle('active', x === b));
  $('#rpane-links').classList.toggle('hidden', b.dataset.rtab !== 'links');
  $('#rpane-outline').classList.toggle('hidden', b.dataset.rtab !== 'outline');
}));

// Sidebar widths. The note area in the middle always keeps MAIN_MIN pixels, so
// dragging a divider (or shrinking the window) can never squeeze it to nothing
// and push the other sidebar past the window edge.
const SIDE_MIN = 160, SIDE_MAX = 560, MAIN_MIN = 320, SIDE_DEFAULT = { left: 260, right: 280 };
function sideWidth(side) {
  const app = $('#app');
  if (app.classList.contains(side + '-collapsed')) return 0;
  return parseFloat(app.style.getPropertyValue(`--${side}-w`)) || SIDE_DEFAULT[side];
}
function setSideWidth(side, want) {
  const other = side === 'left' ? 'right' : 'left';
  const room = innerWidth - 44 - 8 - MAIN_MIN - sideWidth(other);
  const v = Math.round(Math.max(SIDE_MIN, Math.min(SIDE_MAX, want, room)));
  $('#app').style.setProperty(`--${side}-w`, v + 'px');
  return v;
}
// Re-apply the saved (wanted) widths, shrinking them to fit the current window.
function fitSides() { for (const side of ['left', 'right']) setSideWidth(side, store.get(side + '-w', SIDE_DEFAULT[side])); }
addEventListener('resize', fitSides);

for (const r of $$('.resizer')) {
  r.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault();
    const side = r.dataset.resize;
    // Pointer capture keeps the drag going even when the cursor passes over an
    // embedded PDF / web page (iframes would otherwise swallow the moves).
    r.setPointerCapture(e.pointerId);
    r.classList.add('active'); document.body.classList.add('resizing');
    let v = sideWidth(side);
    const move = ev => { v = setSideWidth(side, side === 'left' ? ev.clientX - 44 : innerWidth - ev.clientX); };
    const up = () => {
      r.classList.remove('active'); document.body.classList.remove('resizing');
      r.removeEventListener('pointermove', move); r.removeEventListener('pointerup', up); r.removeEventListener('lostpointercapture', up);
      store.set(side + '-w', v);
      if (S.view === 'graph') drawGraph();
    };
    r.addEventListener('pointermove', move); r.addEventListener('pointerup', up); r.addEventListener('lostpointercapture', up);
  });
}

/* =====================================================================
   Side panels: backlinks, outgoing, outline, tags, search
   ===================================================================== */
function backlinksOf(path) {
  const out = [];
  for (const f of S.files.values()) {
    if (!f.links || f.path === path) continue;
    const hits = f.links.filter(l => resolve(l.name, f.path) === path);
    if (hits.length) out.push({ f, hits });
  }
  return out.sort((a, b) => cmpName(baseName(a.f.path), baseName(b.f.path)));
}

function snippetLines(content, needles, max = 3) {
  const out = [];
  for (const line of content.split('\n')) {
    if (needles.some(n => line.includes(n))) { out.push(line.trim()); if (out.length >= max) break; }
  }
  return out;
}

function trimAround(line, term, width = 90) {
  if (line.length <= width * 2) return line;
  const i = Math.max(0, line.toLowerCase().indexOf(term.toLowerCase()));
  const s = Math.max(0, i - width), e = Math.min(line.length, i + term.length + width);
  return (s > 0 ? '…' : '') + line.slice(s, e) + (e < line.length ? '…' : '');
}

function markTerms(s, terms) {
  if (!terms.length) return esc(s);
  const re = new RegExp('(' + terms.map(reEsc).join('|') + ')', 'gi');
  return s.split(re).map((part, i) => (i % 2 ? `<mark>${esc(part)}</mark>` : esc(part))).join('');
}

function refreshRightPanel() {
  // Follow what is on screen: the open PDF / image / other file in the file view, otherwise the note.
  const p = S.view === 'file' ? S.filePath : S.current;
  const f = p && S.files.get(p);
  const md = !!p && isMd(p);
  if (!f) {
    for (const id of ['backlinks', 'unlinked', 'outgoing', 'note-tags', 'outline']) $('#' + id).innerHTML = '';
    for (const id of ['bl-count', 'ul-count', 'ol-count']) $('#' + id).textContent = '';
    return;
  }
  // Backlinks
  const back = backlinksOf(p);
  $('#bl-count').textContent = back.length || '';
  $('#backlinks').innerHTML = back.length ? back.map(({ f: src, hits }) => {
    const lines = snippetLines(src.content || '', hits.map(h => h.raw));
    return `<div class="bl-file"><div class="bl-name" data-open="${esc(src.path)}"><span>${esc(baseName(src.path))}</span><span class="count">${hits.length}</span></div>${lines.map(l => `<div class="bl-snippet" data-open="${esc(src.path)}">${markTerms(trimAround(l, hits[0].raw), hits.map(h => h.raw))}</div>`).join('')}</div>`;
  }).join('') : `<div class="empty-hint">${esc(t('right.noBacklinks'))}</div>`;

  // Unlinked mentions
  const name = md ? baseName(p) : fileName(p).replace(/.[^.]+$/, ''), linked = new Set(back.map(b => b.f.path));
  const re = name.length >= 3 ? new RegExp(`(^|[^\\p{L}\\p{N}])${reEsc(name)}(?![\\p{L}\\p{N}])`, 'iu') : null;
  const unl = [];
  if (re) for (const o of S.files.values()) {
    if (o.path === p || linked.has(o.path) || !isMd(o.path) || !o.content) continue;
    const line = o.content.split('\n').find(l => re.test(l) && !l.toLowerCase().includes('[[' + name.toLowerCase()));
    if (line) unl.push({ o, line });
    if (unl.length >= 30) break;
  }
  $('#ul-count').textContent = unl.length || '';
  $('#unlinked').innerHTML = unl.length ? unl.map(({ o, line }) => `<div class="bl-file"><div class="bl-name" data-open="${esc(o.path)}"><span>${esc(baseName(o.path))}</span></div><div class="bl-snippet" data-open="${esc(o.path)}">${markTerms(trimAround(line.trim(), name), [name])}</div></div>`).join('') : `<div class="empty-hint">${esc(t('right.noUnlinked'))}</div>`;

  // Outgoing links
  const seen = new Set(), rows = [];
  for (const l of f.links || []) {
    const tp = resolve(l.name, p), key = tp || 'u:' + l.name.toLowerCase();
    if (seen.has(key)) continue; seen.add(key);
    rows.push(tp
      ? `<div class="link-row" data-open="${esc(tp)}"><span>${esc(isMd(tp) ? baseName(tp) : fileName(tp))}</span><span class="hint">${esc(dirName(tp))}</span></div>`
      : `<a class="link-row unresolved internal-link" href="#" data-target="${esc(l.name)}" title="${esc(t('right.clickToCreate'))}"><span>${esc(l.name)}</span><span class="hint">${esc(t('right.notCreated'))}</span></a>`);
  }
  $('#ol-count').textContent = rows.length || '';
  $('#outgoing').innerHTML = rows.join('') || `<div class="empty-hint">${esc(t('right.noOutgoing'))}</div>`;

  // Related notes: similar wording, but not linked either way yet
  const linkedAll = new Set([...linked, ...[...seen].filter(k => !k.startsWith('u:'))]);
  const rel = md ? RV.relatedNotes(p, linkedAll) : [];
  $('#rel-count').textContent = rel.length || '';
  $('#related').innerHTML = rel.length ? rel.map(r => `<div class="rel-row"><div class="bl-name" data-open="${esc(r.path)}"><span>${esc(baseName(r.path))}</span>
    <button class="rel-link" data-link-to="${esc(r.path)}" title="${esc(t('right.addLinkTitle'))}">${esc(t('right.addLink'))}</button></div>
    <div class="rel-words">${r.words.map(w => `<span>${esc(w)}</span>`).join('')}</div></div>`).join('')
    : `<div class="empty-hint">${esc(t('right.noRelated'))}</div>`;

  // Tags
  $('#note-tags').innerHTML = (f.tags || []).map(tg => `<span class="chip" data-tag="${esc(tg)}">#${esc(tg)}</span>`).join('') || `<div class="empty-hint">${esc(t('right.noTags'))}</div>`;

  // Outline
  $('#outline').innerHTML = (f.headings || []).map(h => `<div class="ol-item" style="--l:${h.level - 1}" data-heading="${esc(h.text)}">${esc(h.text.replace(/[*_`=]|\[\[|\]\]/g, ''))}</div>`).join('') || `<div class="empty-hint">${esc(t('right.noHeadings'))}</div>`;
}
// "Link" next to a related note: add [[that note]] where you were typing (or at the end of the note).
$('#related').addEventListener('click', e => {
  const b = e.target.closest('[data-link-to]');
  if (!b || !S.current) return;
  e.preventDefault(); e.stopPropagation();
  if (S.mode === 'preview') setMode(S.lastEditMode);
  if (document.activeElement !== ed && ed.selectionStart === 0) ed.setSelectionRange(ed.value.length, ed.value.length);
  const before = ed.value.slice(0, ed.selectionStart);
  insertAtCursor(`${before && !/\s$/.test(before) ? ' ' : ''}[[${linkNameFor(b.dataset.linkTo)}]]`);
  toast(t('right.linkAdded', { name: baseName(b.dataset.linkTo) }));
}, true);

$('#outline').addEventListener('click', e => { const it = e.target.closest('.ol-item'); if (it) scrollToHeading(it.dataset.heading); });

function renderTagList() {
  const counts = new Map();
  for (const f of S.files.values()) for (const t of f.tags || []) counts.set(t, (counts.get(t) || 0) + 1);
  const list = [...counts].sort((a, b) => b[1] - a[1] || cmpName(a[0], b[0]));
  $('#tag-list').innerHTML = list.length
    ? list.map(([tg, n]) => `<div class="tag-row" data-tag="${esc(tg)}"><span>#${esc(tg)}</span><span class="count">${n}</span></div>`).join('')
    : `<div class="empty-hint">${esc(t('tags.empty'))}</div>`;
}

function searchFor(q) {
  setLeftTab('search');
  const inp = $('#search-input');
  inp.value = q; runSearch(q); inp.focus();
}

// Notes match by name, text, #tag, path: and file:; attachments (PDF, images, code…) by their file name and path,
// so an exact attachment name finds it. Results come 200 at a time, with "Show more" for the rest.
let searchShown = 200, searchQuery = '';
function runSearch(q) {
  const out = $('#search-results');
  q = q.trim();
  if (q !== searchQuery) { searchQuery = q; searchShown = 200; }
  if (!q) { out.innerHTML = ''; return; }
  const terms = (q.match(/"[^"]+"|\S+/g) || []).map(t => t.replace(/^"|"$/g, '').toLowerCase());
  const plain = terms.filter(t => !t.startsWith('#') && !/^(path|file|tag):/.test(t));
  const whole = q.replace(/^"|"$/g, '').toLowerCase();
  const results = [];
  for (const f of S.files.values()) {
    const md = isMd(f.path);
    if (md && f.content == null) continue;
    const name = (md ? baseName(f.path) : fileName(f.path)).toLowerCase(), text = md ? f.content.toLowerCase() : '';
    const ok = terms.every(t => {
      if (t.startsWith('#') || t.startsWith('tag:')) {
        if (!md) return false;
        const tg = t.replace(/^(tag:)?#?/, '');
        return (f.tags || []).some(x => x === tg || x.startsWith(tg + '/'));
      }
      if (t.startsWith('path:')) return f.path.toLowerCase().includes(t.slice(5));
      if (t.startsWith('file:')) return name.includes(t.slice(5));
      return md ? text.includes(t) || name.includes(t) : name.includes(t) || f.path.toLowerCase().includes(t);
    });
    if (!ok) continue;
    const lines = [];
    // Each excerpt remembers its line and the matched word, so a click can jump straight to it.
    if (md && plain.length) f.content.split('\n').some((line, i) => {
      const ll = line.toLowerCase(), term = plain.find(t => ll.includes(t));
      if (term) lines.push({ text: trimAround(line.trim(), term), line: i, term });
      return lines.length >= 3;
    });
    const exact = name === whole || fileName(f.path).toLowerCase() === whole;
    results.push({ f, md, lines, exact, nameHit: plain.some(t => name.includes(t)) });
  }
  results.sort((a, b) => (b.exact - a.exact) || (b.nameHit - a.nameHit) || (b.f.mtime - a.f.mtime));
  const shown = results.slice(0, searchShown), left = results.length - shown.length;
  out.innerHTML = `<div class="sr-count">${esc(t('search.results', { n: results.length }))}</div>` + shown.map(({ f, md, lines }) =>
    `<div class="sr-file${md ? '' : ' sr-attachment'}"><div class="sr-title" data-open="${esc(f.path)}">${markTerms(md ? baseName(f.path) : fileName(f.path), plain)}${dirName(f.path) ? ` <span class="count">${esc(dirName(f.path))}</span>` : ''}</div>${lines.map(l => `<div class="sr-snippet" data-open="${esc(f.path)}" data-line="${l.line}" data-term="${esc(l.term)}">${markTerms(l.text, plain)}</div>`).join('')}</div>`).join('') +
    (left > 0 ? `<button type="button" class="mod-button sr-more">${esc(t('search.more', { n: left }))}</button>` : '');
  out.querySelector('.sr-more')?.addEventListener('click', () => { searchShown += 200; runSearch(q); });
}
$('#search-input').addEventListener('input', debounce(e => runSearch(e.target.value), 150));

function refreshSidePanels() {
  renderTagList();
  const q = $('#search-input').value;
  if (q.trim() && !$('#lpane-search').classList.contains('hidden')) runSearch(q);
  refreshRightPanel();
  updateStatus();
  updateSyncStatus();
  updateReviewBadge();
}

/* Graph view: see graph.js */

/* ---------- Review page & badge ---------- */
// Startup restores the tabs of last time (after reading the vault and the review progress). Where you went before
// that finished is applied again afterwards, so the restored tab never takes your place.
let booting = true, bootNav = null;
function afterBoot(go) { if (booting) bootNav = go; }
function showReview() {
  afterBoot(showReview);
  if (S.dirty) saveNow();
  setView('review');
  const el = $('#review-view');
  // Opened right after starting, before the progress (and the vault) is read: say so, and draw it once ready.
  if (RV.isReady()) RV.renderReviewPage(el);
  else el.innerHTML = `<p class="empty-hint" role="status">${esc(t('review.loading'))}</p>`;
  el.scrollTop = 0;
  // Then refresh with whatever other windows have saved meanwhile (a failed read still draws what is known).
  RV.whenReady().then(() => RV.reloadReview()).catch(() => {}).then(() => { if (S.view === 'review') RV.renderReviewPage(el); });
}
function updateReviewBadge() {
  const btn = $('#review-btn');
  if (!btn) return;
  let badge = btn.querySelector('.badge');
  if (!badge) badge = btn.appendChild(Object.assign(document.createElement('span'), { className: 'badge' }));
  const n = RV.dueCount();
  badge.textContent = n > 99 ? '99+' : n || '';
  badge.classList.toggle('hidden', !n);
  btn.title = t('ribbon.review') + (n ? ` · ${t('review.startN', { n })}` : '');
}
function onReviewChange() {
  updateReviewBadge();
  if (S.view === 'review' && RV.isReady()) RV.renderReviewPage($('#review-view'));
}

function setView(name) {
  if (name !== 'file') codeEditor.close();
  leaveCustomTab();
  if (S.view === 'note' && name !== 'note') { offerCheckIfWritten(); S.openedContent = ed.value; }
  S.view = name;
  if (name !== 'graph') stopGraph();
  $('#note-view').classList.toggle('hidden', name !== 'note');
  $('#graph-view').classList.toggle('hidden', name !== 'graph');
  $('#help-view').classList.toggle('hidden', name !== 'help');
  $('#review-view').classList.toggle('hidden', name !== 'review');
  $('#file-view').classList.toggle('hidden', name !== 'file');
  $('#main').dataset.view = name;
  // Leaving the file view: stop any video or audio and unload the PDF.
  if (name !== 'file' && S.filePath) { closePdf(); hideSelBar(); $('#file-view').innerHTML = ''; S.filePath = null; refreshRightPanel(); updateStatus(); }
  updateTopbar();
  if (name === 'graph' || name === 'review' || name === 'help') setTimeout(syncActiveTab, 0);
  PM.emitLayoutChange();
}

// The ribbon's language and theme buttons are optional (Settings → General); both stay in Settings anyway.
function applyRibbonExtras() {
  const on = !!store.get('ribbonExtras', false);
  for (const b of $$('#ribbon [data-cmd="language"], #ribbon [data-cmd="toggle-theme"]')) b.classList.toggle('hidden', !on);
}

/* ---------- Attachments: shown inside the app instead of another program ---------- */
const FILE_KIND = [
  ['pdf', /\.pdf$/i],
  ['docx', /\.docx$/i],            // shown as a page (mammoth); "Exact layout" makes a PDF with Word
  ['office', /\.(doc|ppt|pptx)$/i], // shown as a PDF made by Word / PowerPoint
  ['image', IMG_EXT],
  ['video', /\.(mp4|webm|ogv|mov|m4v)$/i],
  ['audio', /\.(mp3|wav|ogg|oga|m4a|flac|aac|opus)$/i],
  ['text', /\.(txt|csv|tsv|json|ya?ml|toml|ini|log|tex|bib|xml|js|mjs|ts|py|c|h|cpp|hpp|java|kt|rs|go|rb|sh|ps1|bat|css|sql)$/i],
  ['html', /\.html?$/i],
];
const fileKind = p => sourceFormat(p) ? 'code' : (FILE_KIND.find(([, re]) => re.test(p)) || ['other'])[0];
const fmtSize = n => (n == null ? '' : n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

// at: where to open, from a link like [[x.pdf#page=12]] or [[x.mp4#t=125]] ("page=12", "t=125").
const fmtTime = s => { s = Math.floor(s); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
async function showFile(path, { push = true, at = '' } = {}) {
  const f = S.files.get(path) || (sourceFormat(path) && codeEditor.hasDraft(path) ? {path} : null);
  if (!f) return;
  // Study pages (.html) open as study tabs when the study-pages plugin is on.
  if (fileKind(path) === 'html' && window.moStudy?.handles?.(path)) { window.moStudy.open(path); return; }
  const page = Number((/^page=(\d+)$/i.exec(at || '') || [])[1]) || 0;
  const time = Number((/^t=(\d+(?:\.\d+)?)$/i.exec(at || '') || [])[1]) || 0;
  leaveCustomTab();
  if (S.dirty) await saveNow();
  if (push) {
    S.history = S.history.slice(0, S.hIdx + 1);
    if (S.history[S.hIdx] !== path) { S.history.push(path); S.hIdx = S.history.length - 1; }
  }
  setView('file');
  codeEditor.close();
  closePdf(); hideSelBar();
  S.filePath = path;
  S.selectedFolder = null; // like opening a note: a new note now goes next to this file
  store.set('last', path); // reopen this file (not the previous note) next time the app starts
  refreshRightPanel(); updateStatus();
  const box = $('#file-view');
  const src = '/vault/' + encPath(path);
  const kind = fileKind(path);
  box.innerHTML = `
    <div class="fv-bar">
      <span class="fv-name">${esc(fileName(path))}</span>
      <span class="fv-meta">${esc(fmtSize(f.size))}</span>
      <span class="spacer"></span>
      ${kind === 'pdf' || kind === 'office' ? pdfControls() : ''}
      ${kind === 'docx' ? `<button class="fv-btn" data-fv="as-pdf" title="${esc(t('office.exactTitle'))}">${esc(t('office.exact'))}</button>` : ''}
      ${kind === 'docx' || kind === 'office' ? `<button class="fv-btn" data-fv="save-pdf" title="${esc(t('office.savePdfTitle'))}">${esc(t('office.savePdf'))}</button>` : ''}
      ${kind === 'pdf' || kind === 'office' ? `<button class="fv-btn" data-fv="link-page" title="${esc(t('file.linkPageTitle'))}">${esc(t('file.linkPage'))}</button>` : ''}
      ${kind === 'video' || kind === 'audio' ? `<button class="fv-btn" data-fv="link-time" title="${esc(t('file.linkTimeTitle'))}">${esc(t('file.linkTime'))}</button>` : ''}
      <button class="fv-btn" data-fv="external" title="${esc(t('file.openExternalTitle'))}">${esc(t('file.openExternal'))}</button>
    </div>
    <div class="fv-body fv-${kind}"></div>`;
  const body = box.querySelector('.fv-body');
  if (kind === 'code') void codeEditor.open(body,path,at);
  else if (kind === 'pdf') openPdf(box, body, path, src, page);
  else if (kind === 'office') showOfficeAsPdf(box, body, path, page);
  else if (kind === 'docx') showDocx(box, body, path, src);
  else if (kind === 'image') body.innerHTML = `<img class="fv-img" src="${src}" alt="${esc(fileName(path))}">`;
  else if (kind === 'video') body.innerHTML = `<video class="fv-media" src="${src}" controls preload="metadata"></video>`;
  else if (kind === 'audio') body.innerHTML = `<div class="fv-audio"><div class="fv-audio-name">${esc(fileName(path))}</div><audio src="${src}" controls preload="metadata"></audio></div>`;
  else if (kind === 'html') body.innerHTML = `<iframe class="fv-frame" src="${src}" sandbox="allow-scripts allow-forms allow-popups" title="${esc(fileName(path))}"></iframe>`;
  else if (kind === 'text') {
    body.innerHTML = `<pre class="fv-text"></pre>`;
    try {
      const text = (await api('GET', 'file', { path })).content ?? '';
      if (S.filePath === path) body.querySelector('.fv-text').textContent = text.length > 2e6 ? text.slice(0, 2e6) + '\n…' : text;
    } catch (e) { body.querySelector('.fv-text').textContent = String(e.message || e); }
  } else {
    body.innerHTML = `<div class="fv-none"><p>${esc(t('file.noPreview'))}</p></div>`;
  }
  const media = body.querySelector('video, audio');
  if (media && time) media.addEventListener('loadedmetadata', () => { media.currentTime = time; }, { once: true });
  // Links to a place in this file, to paste into a note.
  const name = linkNameFor(path), short = baseName(path);
  const copyLink = async (text, msg) => { try { await navigator.clipboard.writeText(text); } catch { await window.myobsidianDesktop?.copyText?.(text); } toast(msg); };
  box.querySelector('[data-fv="link-page"]')?.addEventListener('click', async () => {
    const cur = S.pdf?.path === path ? S.pdf.ctl?.page : page;
    const v = await askText(t('file.linkPagePrompt'), cur ? String(cur) : '', t('file.linkPageHint'));
    const n = parseInt(v, 10);
    if (n > 0) copyLink(`[[${name}#page=${n}|${short} p.${n}]]`, t('file.linkCopied'));
  });
  box.querySelector('[data-fv="link-time"]')?.addEventListener('click', () => {
    const s = Math.floor(media?.currentTime || 0);
    copyLink(`[[${name}#t=${s}|${short} ${fmtTime(s)}]]`, t('file.linkCopied'));
  });
  box.querySelector('[data-fv="external"]').onclick = () => window.open(src, '_blank');
  box.querySelector('[data-fv="as-pdf"]')?.addEventListener('click', e => {
    e.currentTarget.remove();
    const bar = box.querySelector('.fv-bar'), ext = bar.querySelector('[data-fv="save-pdf"]');
    bar.insertAdjacentHTML('afterbegin', ''); ext?.insertAdjacentHTML('beforebegin', pdfControls());
    body.className = 'fv-body fv-office';
    showOfficeAsPdf(box, body, path, 0);
  });
  box.querySelector('[data-fv="save-pdf"]')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    toast(t('office.making', { app: /\.pptx?$/i.test(path) ? 'PowerPoint' : 'Word' }));
    try { const r = await api('POST', 'office-pdf', { path, save: '1' }); toast(t('office.saved', { path: r.saved })); }
    catch (err) { toast(err.message); }
    b.disabled = false;
  });
  for (const el of $$('.tree-item.file')) el.classList.toggle('active', el.dataset.path === path);
  document.title = `${fileName(path)} - Graphite`;
  updateTopbar();
  syncActiveTab();
}
/* ---------- Word and PowerPoint ----------
   .docx: converted to a page with mammoth (headings, lists, tables, images); no Office needed.
   .doc / .ppt / .pptx (and .docx on request): Word or PowerPoint makes a PDF (cached, see server.js), shown in
   the PDF viewer below, so it looks exactly like the original. */
let mammothLoad = null;
const loadMammoth = () => (mammothLoad ||= new Promise((res, rej) => {
  if (window.mammoth) return res(window.mammoth);
  const sc = Object.assign(document.createElement('script'), { src: '/lib/mammoth.js', onload: () => res(window.mammoth), onerror: () => rej(new Error('mammoth')) });
  document.head.append(sc);
}));
async function showDocx(box, body, path, src) {
  body.innerHTML = `<div class="fv-wait"><span class="spinner"></span>${esc(t('office.reading'))}</div>`;
  try {
    const [m, buf] = await Promise.all([loadMammoth(), fetch(src).then(r => { if (!r.ok) throw new Error(r.statusText); return r.arrayBuffer(); })]);
    const r = await m.convertToHtml({ arrayBuffer: buf });
    if (S.filePath !== path) return;
    body.innerHTML = '<div class="fv-docx scroll"><div class="col markdown"></div></div>';
    const col = body.querySelector('.col');
    col.innerHTML = r.value || `<p class="muted">${esc(t('office.empty'))}</p>`;
    for (const a of col.querySelectorAll('a[href]')) { a.target = '_blank'; a.rel = 'noopener'; }
  } catch (e) {
    if (S.filePath !== path) return;
    // Couldn't read it as a page (e.g. an unusual file): try Word instead.
    body.className = 'fv-body fv-office';
    showOfficeAsPdf(box, body, path, 0);
  }
}
async function showOfficeAsPdf(box, body, path, page) {
  const appName = /\.pptx?$/i.test(path) ? 'PowerPoint' : 'Word';
  body.innerHTML = `<div class="fv-wait"><span class="spinner"></span>${esc(t('office.making', { app: appName }))}</div>`;
  try {
    const r = await api('POST', 'office-pdf', { path });
    if (S.filePath !== path) return;
    body.innerHTML = '';
    openPdf(box, body, path, '/vault/' + encPath(r.pdf), page);
  } catch (e) {
    if (S.filePath !== path) return;
    body.innerHTML = `<div class="fv-none"><p>${esc(e.message)}</p></div>`;
  }
}
/* ---------- PDFs (PDF.js): page box, zoom, fit width, find; reopens at the page you were on ---------- */
const PDF_POS_MAX = 300;
// Kept per vault: two vaults can both have Algebra/Lecture.pdf, and each keeps its own page and zoom.
// (Up to 1.1.40 one list served every vault; it is handed to the first vault opened after the update.)
const pdfPosKey = () => 'pdfPos:' + String(S.vault || '').replace(/\\/g, '/').toLowerCase();
function pdfPosAll() {
  const k = pdfPosKey();
  let all = store.get(k, null);
  if (!all) {
    const legacy = store.get('pdfPos', null);
    all = legacy && typeof legacy === 'object' ? legacy : {};
    if (legacy) { store.set(k, all); try { localStorage.removeItem('mo:pdfPos'); } catch { /* ignore */ } }
  }
  return all;
}
const pdfPos = path => pdfPosAll()[path] || null;
function savePdfPos(path, st) {
  const all = pdfPosAll();
  delete all[path];
  all[path] = { page: st.page, scale: st.scaleValue };
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - PDF_POS_MAX))) delete all[k];
  store.set(pdfPosKey(), all);
}
function pdfControls() {
  const b = (cmd, label, title) => `<button class="fv-btn pdf-ib" data-pdf="${cmd}" title="${esc(title)}">${label}</button>`;
  return `<span class="pdf-ctl">
    <input class="pdf-page" type="text" inputmode="numeric" value="" aria-label="${esc(t('pdf.page'))}" title="${esc(t('pdf.page'))}"><span class="pdf-pages">/ …</span>
    <span class="pdf-sep"></span>
    ${b('out', '−', t('pdf.zoomOut'))}<button class="fv-btn pdf-scale" data-pdf="fit" title="${esc(t('pdf.fitWidth'))}">…</button>${b('in', '+', t('pdf.zoomIn'))}
    <span class="pdf-sep"></span>
    <input class="pdf-find" type="search" placeholder="${esc(t('pdf.findPh'))}" title="${esc(t('pdf.find'))} (Ctrl+F)"><span class="pdf-hits"></span>
    <span class="pdf-sep"></span>
    <button class="fv-btn pdf-ib pdf-study" data-pdf="clip" title="${esc(t('clip.title'))}">${selSvg('scissors')}</button>
    <button class="fv-btn pdf-ib pdf-study" data-pdf="mistake" title="${esc(t('mist.addFromPage'))}">${selSvg('mistake')}</button>
    <button class="fv-btn pdf-summary" data-cmd="summarize-pdf" title="${esc(t('sum.title'))}">${esc(t('sum.short'))}</button>
  </span>`;
}
function closePdf() {
  if (!S.pdf) return;
  try { S.pdf.ctl?.destroy(); } catch { /* ignore */ }
  S.pdf = null;
}
async function openPdf(box, body, path, src, page) {
  const pos = pdfPos(path);
  const token = S.pdf = { path, ctl: null, requestedPage: page || pos?.page || 1 };
  body.innerHTML = `<div class="pdf-host"><div class="fv-none pdf-loading">${esc(t('pdf.loading'))}</div></div>`;
  const host = body.firstElementChild;
  const pageIn = box.querySelector('.pdf-page'), pagesEl = box.querySelector('.pdf-pages'), scaleBtn = box.querySelector('.pdf-scale');
  const findIn = box.querySelector('.pdf-find'), hits = box.querySelector('.pdf-hits');
  let ctl;
  try {
    ctl = await mountPdf(host, src, {
      page: page || pos?.page || 1, scale: pos?.scale || 'page-width',
      onReady: () => {
        token.ready = true;
        if (S.pdf === token && token.jumpPage) token.ctl?.goTo(token.jumpPage);
      },
      onState: st => {
        if (S.pdf !== token) return;
        if (document.activeElement !== pageIn) pageIn.value = st.page;
        pagesEl.textContent = '/ ' + st.pages;
        scaleBtn.textContent = Math.round(st.scale * 100) + '%';
        scaleBtn.classList.toggle('on', st.scaleValue === 'page-width');
        scaleBtn.title = st.scaleValue === 'page-width' ? t('pdf.fitPage') : t('pdf.fitWidth');
        savePdfPos(path, st);
      },
    });
  } catch (e) {
    if (S.pdf === token) host.innerHTML = `<div class="fv-none"><p>${esc(t('pdf.failed', { msg: e.message || String(e) }))}</p></div>`;
    return;
  }
  if (S.pdf !== token) { ctl.destroy(); return; } // another file was opened meanwhile
  token.ctl = ctl;
  if (token.ready && token.jumpPage) ctl.goTo(token.jumpPage);
  pageIn.addEventListener('keydown', e => { if (e.key === 'Enter') { ctl.goTo(parseInt(pageIn.value, 10) || 1); pageIn.blur(); } if (e.key === 'Escape') { pageIn.value = ctl.page; pageIn.blur(); } });
  pageIn.addEventListener('blur', () => { pageIn.value = ctl.page; });
  pageIn.addEventListener('focus', () => pageIn.select());
  box.querySelector('[data-pdf="in"]').onclick = () => ctl.zoomIn();
  // Clip a box of the page (as a card or a mistake), or add this page's problem to the mistake book.
  box.querySelector('[data-pdf="clip"]').onclick = e => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenu(r.left, r.bottom + 4, [
      { label: t('clip.asCard'), run: () => STUDY.startClip(host, path, 'card') },
      { label: t('clip.asMistake'), run: () => STUDY.startClip(host, path, 'mistake') },
    ]);
  };
  box.querySelector('[data-pdf="mistake"]').onclick = () => STUDY.mistakeForm({ src: path, page: ctl.page });
  box.querySelector('[data-pdf="out"]').onclick = () => ctl.zoomOut();
  // The % button switches between "fit the width" (follows the pane size) and "whole page".
  scaleBtn.onclick = () => ctl.setScale(scaleBtn.classList.contains('on') ? 'page-fit' : 'page-width');
  ctl.onFind((n, state) => { hits.textContent = findIn.value.trim() ? (n?.total ? `${n.current}/${n.total}` : state === 1 ? t('pdf.noHits') : '') : ''; });
  let lastQ = '';
  findIn.addEventListener('keydown', e => {
    if (e.key === 'Enter') { const q = findIn.value.trim(); if (q) ctl.find(q, { again: q === lastQ, previous: e.shiftKey }); lastQ = q; }
    if (e.key === 'Escape') { findIn.value = ''; ctl.find(''); lastQ = ''; hits.textContent = ''; findIn.blur(); }
  });
  findIn.addEventListener('input', debounce(() => { const q = findIn.value.trim(); lastQ = q; ctl.find(q); if (!q) hits.textContent = ''; }, 250));
}
// Ctrl+F in a PDF searches the PDF; Home / End jump to the first / last page when not typing.
addEventListener('keydown', e => {
  if (S.view !== 'file' || !S.pdf?.ctl) return;
  const typing = /^(INPUT|TEXTAREA)$/.test(document.activeElement?.tagName || '');
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); e.stopPropagation(); $('#file-view .pdf-find')?.focus(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
  const c = S.pdf.ctl;
  if (e.key === 'Home') { c.goTo(1); e.preventDefault(); } else if (e.key === 'End') { c.goTo(c.pages); e.preventDefault(); }
}, true);

/* ---------- Selection bar in the file view (PDF text and text files) ----------
   Add to note, Ask Graphie, Not familiar / Interesting (Claude Capture), Copy. */
const selSvg = n => `<svg class="i" viewBox="0 0 24 24">${SEL_ICON[n]}</svg>`;
let selBar = null, selCtx = null;
function hideSelBar() { if (selBar) selBar.hidden = true; }
function buildSelBar() {
  selBar = document.createElement('div');
  selBar.className = 'fv-selbar'; selBar.hidden = true; selBar.setAttribute('role', 'toolbar');
  document.body.append(selBar);
  selBar.addEventListener('mousedown', e => e.preventDefault()); // keep the selection
  selBar.addEventListener('click', e => {
    const b = e.target.closest('[data-sel]');
    if (!b || !selCtx) return;
    const ctx = selCtx; hideSelBar();
    selAction(b.dataset.sel, ctx).catch(err => toast(err.message || String(err)));
  });
}
// Where "Add to note" puts things: the note you had open before this file, or a "<file> notes" note beside it.
function selTargetNote(path) {
  if (S.current && S.files.has(S.current)) return { path: S.current, isNew: false };
  const base = fileName(path).replace(/\.[^.]+$/, '');
  return { path: joinPath(dirName(path), `${base} ${t('sel.notesSuffix')}.md`), isNew: !S.files.has(joinPath(dirName(path), `${base} ${t('sel.notesSuffix')}.md`)) };
}
function showSelBar(e) {
  if (S.view !== 'file' || !S.filePath) return hideSelBar();
  const sel = getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return hideSelBar();
  const host = sel.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
  if (!host?.closest('#file-view .pdf-host, #file-view .fv-text')) return hideSelBar();
  const text = sel.toString().replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  if (!text) return hideSelBar();
  const path = S.filePath, isPdf = !!host.closest('.pdf-host');
  const page = isPdf && S.pdf?.ctl ? S.pdf.ctl.pageOf(sel.anchorNode) : 0;
  selCtx = { text, path, page };
  if (!selBar) buildSelBar();
  const target = selTargetNote(path);
  const plugins = window.app?.plugins;
  const chat = plugins?.getPlugin?.('claude-chat'), cap = plugins?.getPlugin?.('claude-capture');
  const btn = (id, ic, label, title, cls = '') => `<button type="button" class="${cls}" data-sel="${id}" title="${esc(title)}">${selSvg(ic)}<span>${esc(label)}</span></button>`;
  selBar.innerHTML = [
    btn('note', 'note', t('sel.addNote'), t(target.isNew ? 'sel.addNoteNew' : 'sel.addNoteTitle', { note: baseName(target.path) }), 'primary'),
    chat ? btn('ask', 'spark', t('sel.ask'), t('sel.askTitle')) : '',
    cap ? '<span class="sep"></span>' + btn('unfamiliar', 'help', t('sel.unfamiliar'), t('sel.unfamiliarTitle')) + btn('interesting', 'bulb', t('sel.interesting'), t('sel.interestingTitle')) : '',
    '<span class="sep"></span>' + btn('card', 'cards', t('sel.card'), t('sel.cardTitle')),
    btn('copy', 'copy', t('sel.copy'), t('sel.copyTitle')),
  ].join('');
  selBar.hidden = false;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  const bw = selBar.offsetWidth, bh = selBar.offsetHeight;
  const mid = e?.clientX && r.width > 600 ? e.clientX : (r.left + r.right) / 2;
  const x = Math.max(8, Math.min(mid - bw / 2, innerWidth - bw - 8));
  const above = r.top > bh + 70;
  selBar.style.left = x + 'px';
  selBar.style.top = (above ? r.top - bh - 8 : Math.min(r.bottom + 8, innerHeight - bh - 8)) + 'px';
}
// A link back to where the text came from, e.g. [[LA15.pdf#page=45|LA15 p.45]].
function selSourceLink({ path, page }) {
  const short = fileName(path).replace(/\.[^.]+$/, '');
  return page ? `[[${linkNameFor(path)}#page=${page}|${short} p.${page}]]` : `[[${linkNameFor(path)}|${short}]]`;
}
async function selAction(kind, ctx) {
  const { text, path, page } = ctx;
  if (kind === 'copy') {
    try { await navigator.clipboard.writeText(text); } catch { await window.myobsidianDesktop?.copyText?.(text); }
    return toast(t('sel.copied'));
  }
  if (kind === 'card') return STUDY.cardForm({ src: path, page, a: text });
  if (kind === 'note') {
    const target = selTargetNote(path);
    const quote = text.split('\n').map(l => '> ' + l).join('\n') + '\n> — ' + selSourceLink(ctx) + '\n';
    if (target.path === S.current && S.dirty) await saveNow();
    const cur = S.files.has(target.path) ? await readFileContent(target.path) : '';
    await writeNote(target.path, cur ? cur.replace(/\s*$/, '') + '\n\n' + quote : quote);
    refreshSidePanels();
    return toast(t('sel.added', { note: baseName(target.path) }));
  }
  const plugins = window.app?.plugins;
  if (kind === 'ask') {
    const cap = plugins?.getPlugin?.('claude-capture'), chat = plugins?.getPlugin?.('claude-chat');
    const where = fileName(path) + (page ? ` p.${page}` : '');
    // The chat picks up the latest selection from Claude Capture, for the file that is open. Let the chat see
    // which file is open first: it ignores selections made before the file in front changed.
    try { chat?.context?.(); } catch { /* older chat plugin */ }
    if (cap) cap.lastSel = { text: `${text}\n— ${where}`, heading: page ? `page=${page}` : '', at: Date.now() + 1, path };
    else if (chat) chat.extSel = { text: `${text}\n— ${where}`, page, at: Date.now() + 1, path }; // without Claude Capture
    chat?.show?.();
    chat?.renderChips?.();
    setTimeout(() => chat?.input?.focus(), 50);
    return;
  }
  if (kind === 'unfamiliar' || kind === 'interesting') {
    const cap = plugins?.getPlugin?.('claude-capture');
    const file = window.app?.vault?.getAbstractFileByPath?.(path) || null;
    await cap?.saveCapture({ kind, text, thought: '', file, heading: page ? `page=${page}` : '' });
  }
}
document.addEventListener('mouseup', e => { if (!selBar?.contains(e.target)) setTimeout(() => showSelBar(e), 0); });
document.addEventListener('keyup', e => { if (e.shiftKey || e.key.startsWith('Arrow')) setTimeout(() => showSelBar(null), 0); });
document.addEventListener('mousedown', e => { if (selBar && !selBar.contains(e.target)) hideSelBar(); }, true);
document.addEventListener('scroll', e => { if (selBar && !selBar.hidden && !selBar.contains(e.target)) hideSelBar(); }, true);
addEventListener('resize', hideSelBar);

function showGraph() {
  if (S.dirty) saveNow();
  setView('graph');
  readGraphColors();
  G.autoFit = true;
  buildGraph();
}
// The file shown in the file view was deleted (here or on another device): go back to the note, or the empty page.
function closeFileIfGone() {
  updateTopbar(); // also drop a reference PDF removed from the vault
  if (S.view !== 'file' || !S.filePath || S.files.has(S.filePath) || codeEditor.hasDraft(S.filePath)) return;
  showNoteView();
  if (S.current && S.files.has(S.current)) store.set('last', S.current); else closeNote();
}
function showNoteView() {
  setView('note');
  refreshRightPanel();
  requestAnimationFrame(autosize);
}

/* =====================================================================
   Built-in guide (public/help/<lang>.md)
   ===================================================================== */
// Help pages: the guide and two cheatsheets, shown as tabs. Files: public/help/<prefix><lang>.md
const HELP_PAGES = { guide: { file: '', title: 'settings.help' }, markdown: { file: 'markdown-', title: 'mdsheet.title' }, latex: { file: 'latex-', title: 'latex.title' } };
async function showHelp(page = S.helpPage || 'guide') {
  if (!HELP_PAGES[page]) page = 'guide';
  if (S.dirty) saveNow();
  S.helpPage = page;
  setView('help');
  $('#help-tabs').innerHTML = Object.entries(HELP_PAGES).map(([id, p]) =>
    `<button data-help-page="${id}" class="${id === page ? 'active' : ''}">${esc(t(p.title))}</button>`).join('');
  const lang = getLang();
  let text = '';
  for (const l of [lang, 'en']) {
    const r = await fetch(`/help/${HELP_PAGES[page].file}${l}.md`).catch(() => null);
    if (r?.ok) { text = await r.text(); break; }
  }
  if (S.view !== 'help' || S.helpPage !== page) return;
  $('#help-view').classList.toggle('cheatsheet', page !== 'guide');
  updateTopbar();
  // The guide page has the manual's search on top (by study task, word or shortcut).
  $('#help-find').hidden = page !== 'guide';
  if (page === 'guide') {
    const g = document.createElement('div');
    renderInto(g, text, '', 1);
    helpGuide = g;
    HB.redraw();
    if (HB.active()) { drawHandbook(); $('#help-view').scrollTop = 0; return; }
  }
  renderInto($('#help-body'), text, '', 1);
  // Table of contents from the page's sections (not from the headings inside examples).
  const toc = $('#help-toc');
  toc.innerHTML = $$('#help-body h2').filter(h => !h.closest('.md-example')).map(h => `<a href="#" data-help="${esc(h.id)}">${esc(h.textContent)}</a>`).join('');
  $('#help-view').scrollTop = 0;
}
$('#help-tabs').addEventListener('click', e => { const b = e.target.closest('[data-help-page]'); if (b) showHelp(b.dataset.helpPage); });
// The manual's search: live commands (translated name, shortcut, available now?) plus the guide's sections.
let helpGuide = null;
const HB = mountHandbook($('#help-find'), {
  commands: () => COMMANDS.filter(c => c.id !== 'palette').map(c => ({ id: c.id, name: c.name, label: c.label || t('cmd.' + c.id), kbd: c.kbd || '', available: commandAvailable(c) })),
  guide: () => helpGuide,
  update: () => { if (S.view === 'help' && S.helpPage === 'guide') { if (HB.active()) drawHandbook(); else showHelp('guide'); } },
});
function drawHandbook() {
  HB.render($('#help-body'));
  $('#help-toc').innerHTML = '';
}
$('#help-body').addEventListener('click', e => {
  const run = e.target.closest('[data-hb-run]');
  if (run) { e.preventDefault(); e.stopPropagation(); runCommand(run.dataset.hbRun); return; }
  if (e.target.closest('[data-hb-reset]')) { e.preventDefault(); HB.reset(); showHelp('guide'); }
}, true);
$('#help-toc').addEventListener('click', e => {
  const a = e.target.closest('[data-help]');
  if (!a) return;
  e.preventDefault();
  document.getElementById(a.dataset.help)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
});
$('#help-body').addEventListener('click', async e => {
  // Links between the guide and the cheatsheet
  const go = e.target.closest('[data-help-page]');
  if (go) { e.preventDefault(); showHelp(go.dataset.helpPage); return; }
  // Foldable callouts work here too
  const ct = e.target.closest('.callout-title');
  if (ct && ct.parentElement.dataset.fold) { ct.parentElement.classList.toggle('collapsed'); return; }
  // Cheatsheets: click any code to copy it
  const code = S.helpPage !== 'guide' && e.target.closest('code');
  if (code) {
    const text = code.textContent.replace(/\n$/, '');
    if (await copyText(text)) toast(t('latex.copied', { code: text.split('\n')[0].slice(0, 40) }));
  }
});

// Copy to the clipboard: the desktop app's own clipboard first, then the browser's, then the old way.
async function copyText(text) {
  try { if (window.myobsidianDesktop?.copyText) { await window.myobsidianDesktop.copyText(text); return true; } } catch { /* fall through */ }
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  ta.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(ta); ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  return ok;
}

/* =====================================================================
   Host API for plugins & settings
   ===================================================================== */
const host = {
  S, api, resolve, linkNameFor, isMd, baseName, fileName, encPath, fuzzy, toast, askText,
  editorEl: ed,
  vaultName: () => (S.vault || '').split(/[\\/]/).filter(Boolean).pop() || 'vault',
  openNote, openLink, createFile, createFolder, writeNote, readFile: readFileContent,
  deletePath, renamePath, sync, saveNow, setMode,
  getMode: () => S.mode,
  renderInto, rerender: () => renderPreview(),
  replaceRange, caretCoords,
  registerCommand, unregisterCommand, runCommand,
  showMenu, hideMenu,
  addRibbonButton(title) {
    const b = document.createElement('button');
    b.title = title || '';
    b.className = 'plugin-ribbon';
    $('#ribbon .spacer').before(b);
    return b;
  },
  openSettings, closeSettings,
  changeLanguage, applyTheme, showHelp,
  conflictFiles,
  checkUpdates, installUpdate,
  store, onReviewChange, applyRibbonExtras,
  checkNote: p => CK.checkNote(p),
  // The quiz asks Claude for extra questions when AI is set up and the Review setting allows it.
  aiQuestions: () => (AI.choice('quiz') !== 'off' ? (task, payload, o) => AI.request('quiz', task, payload, o) : null),
  // For Check: read a note (the editor's current text if it's open), change part of it, show a passage.
  getNoteText: p => (p === S.current ? ed.value : S.files.get(p)?.content ?? ''),
  replaceInNote(p, start, end, text) {
    if (p === S.current) { replaceRange(start, end, text); renderPreview(); return; }
    const f = S.files.get(p);
    if (f?.content != null) writeNote(p, f.content.slice(0, start) + text + f.content.slice(end));
  },
  async showInEditor(p, quote, start) {
    if (p !== S.current) await openNote(p);
    if (S.mode === 'preview') setMode(S.lastEditMode);
    let at = ed.value.slice(start, start + quote.length) === quote ? start : ed.value.indexOf(quote);
    if (at < 0) return;
    ed.focus(); ed.setSelectionRange(at, at + quote.length);
    edWrap.scrollTop = Math.max(0, caretCoords(at).top - edWrap.clientHeight / 3);
  },
};

/* =====================================================================
   Tabs (like a browser / VS Code)
   - Clicking a file in the tree opens it in a "preview" tab (title in italics) that the next click replaces;
     editing the note, double-clicking the tab, or opening with Ctrl/middle-click or by dragging keeps it.
   - Links inside a note navigate the tab you're in (Ctrl+click: new tab). Back / forward are per tab.
   - Drag files from the tree onto the tab bar or into the main area to open them; drag tabs to reorder.
   - × or middle-click closes; Ctrl+T new tab, Ctrl+W close, Ctrl+Shift+T reopen, Ctrl+Tab / Ctrl+1…9 switch.
   - Plugins can add their own tabs (the 🎓 study pages do) through window.moTabs.
   ===================================================================== */
const TABS = { list: [], active: null, closed: [], seq: 0, providers: new Map(), restoring: false };
const canvasWorkspace = createCanvasView($('#canvas-view'), {
  api,
  openFile: async path => { await sync(); await openInTab(path, {where:'new', keep:true}); },
});
TABS.providers.set(canvasWorkspace.id, canvasWorkspace);
// The code workbench: a project folder (this vault or any folder), its tree, several files, C++ build/run/debug.
const codeWorkbench = createCodeWorkbench($('#code-workbench'), {
  toast, askText: (ph, v, hint) => askText(ph, v, hint), vaultRoot: () => S.vault || '',
  vaultFolders: () => [...S.folders].sort(), onShowTab: () => openCustomTab('code-workbench', 'workbench'),
});
TABS.providers.set(codeWorkbench.id, codeWorkbench);
const tabById = id => TABS.list.find(x => x.id === id) || null;
const activeTab = () => tabById(TABS.active);
const newTabObj = (o = {}) => ({ id: 't' + (++TABS.seq), kind: 'empty', path: null, preview: false, history: [], hIdx: -1, ...o });
const tabSvg = k => `<svg class="i" viewBox="0 0 24 24">${TAB_ICON[k] || TAB_ICON.file}</svg>`;
function tabIconKind(tab) {
  if (tab.kind !== 'path') return tab.kind;
  if (isMd(tab.path)) return 'note';
  const k = fileKind(tab.path);
  return k === 'pdf' ? 'pdf' : k === 'image' ? 'image' : k === 'video' || k === 'audio' ? 'media' : 'file';
}
function tabTitle(tab) {
  if (tab.kind === 'path') return tab.path ? (isMd(tab.path) ? baseName(tab.path) : fileName(tab.path)) : '';
  if (tab.kind === 'graph') return t('graph.title');
  if (tab.kind === 'review') return t('review.title');
  if (tab.kind === 'help') return t(tab.page && tab.page !== 'guide' ? (tab.page === 'latex' ? 'latex.title' : 'mdsheet.title') : 'help.title');
  if (tab.kind === 'custom') { const pr = TABS.providers.get(tab.provider); return (pr?.title?.(tab.key)) || tab.title || tab.key; }
  return t('tabs.newTab');
}

function renderTabs() {
  const bar = $('#tabbar');
  if (!bar) return;
  const box = bar.querySelector('.tabs');
  box.innerHTML = TABS.list.map(tab => {
    const pr = tab.kind === 'custom' ? TABS.providers.get(tab.provider) : null;
    const icon = pr?.icon ? `<span class="tab-emoji">${esc(pr.icon)}</span>` : tabSvg(tabIconKind(tab));
    const title = tabTitle(tab), badge = tab.badge?.text || '';
    const tip = tab.kind === 'path' ? tab.path : tab.badge?.title || title;
    return `<div class="tab${tab.id === TABS.active ? ' active' : ''}${tab.preview ? ' preview' : ''}${tab.kind === 'path' && isMd(tab.path || '') ? '' : ' k-' + tabIconKind(tab)}" data-tab="${tab.id}" draggable="true" role="tab" title="${esc(tip + (tab.preview ? '\n' + t('tabs.previewHint') : ''))}">
      ${icon}<span class="tab-title">${esc(title)}</span>${badge ? `<span class="tab-badge">${esc(badge)}</span>` : ''}
      <button type="button" class="tab-x" data-close="${tab.id}" draggable="false" title="${esc(t('tabs.close'))} (Ctrl+W)" aria-label="${esc(t('tabs.close') + ': ' + title)}">×</button>
      ${tab.badge?.progress ? `<span class="tab-read" style="width:calc((100% - 20px) * ${Math.max(0, Math.min(1, tab.badge.progress))})"></span>` : ''}
    </div>`;
  }).join('');
  box.querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let persistTimer = 0;
function persistTabs() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    store.set('tabs', {
      active: TABS.active,
      list: TABS.list.map(x => ({ id: x.id, kind: x.kind, path: x.path, page: x.page, provider: x.provider, key: x.key, title: x.kind === 'custom' ? tabTitle(x) : undefined, preview: x.preview, history: (x.history || []).slice(-30), hIdx: Math.min(x.hIdx ?? -1, 29) })),
    });
  }, 200);
}

// What the app is showing right now → the tab in front. Called after every navigation.
function syncActiveTab() {
  if (TABS.restoring) return;
  const tab = activeTab();
  if (!tab || tab.kind === 'custom') return;
  const v = S.view;
  if (v === 'file' && S.filePath) Object.assign(tab, { kind: 'path', path: S.filePath });
  else if (v === 'note' && S.current) Object.assign(tab, { kind: 'path', path: S.current });
  else if (v === 'graph' || v === 'review') Object.assign(tab, { kind: v, path: null });
  else if (v === 'help') Object.assign(tab, { kind: 'help', path: null, page: S.helpPage || 'guide' });
  else if (v === 'note' && !S.current) Object.assign(tab, { kind: 'empty', path: null });
  tab.history = S.history; tab.hIdx = S.hIdx;
  if (tab.kind === 'path') rememberRecent(tab.path);
  renderTabs(); persistTabs();
}

// The app's own views can't show inside a plugin tab: move to a normal tab first.
function leaveCustomTab() {
  const tab = activeTab();
  if (!tab || tab.kind !== 'custom') return;
  TABS.providers.get(tab.provider)?.hide?.(tab.key);
  $('#main').classList.remove('tab-custom');
  const nt = newTabObj();
  const i = tab ? TABS.list.indexOf(tab) + 1 : TABS.list.length;
  TABS.list.splice(i, 0, nt);
  TABS.active = nt.id;
  S.history = nt.history; S.hIdx = -1;
}

function saveTabView(tab) {
  if (!tab) return;
  tab.history = S.history; tab.hIdx = S.hIdx;
  if (tab.kind === 'path' && isMd(tab.path || '') && S.view === 'note') {
    tab.scroll = { ed: edWrap.scrollTop, pv: pvWrap.scrollTop, start: ed.selectionStart, end: ed.selectionEnd, direction: ed.selectionDirection };
  }
}

async function activateTab(id) {
  const tab = tabById(id);
  if (!tab) return;
  const cur = activeTab();
  if (cur === tab && !TABS.restoring) { renderTabs(); return; }
  if (S.dirty) await saveNow();
  if (cur && cur !== tab) {
    saveTabView(cur);
    if (cur.kind === 'custom') TABS.providers.get(cur.provider)?.hide?.(cur.key);
  }
  TABS.active = tab.id;
  S.history = tab.history || []; S.hIdx = tab.hIdx ?? -1;
  const wasRestoring = TABS.restoring;
  TABS.restoring = true; // showing a tab's content must not change the tab itself
  try {
    if (tab.kind === 'custom') {
      codeEditor.close();
      const pr = TABS.providers.get(tab.provider);
      $('#main').classList.add('tab-custom');
      hideSelBar();
      if (pr) { pr.open?.(tab.key); pr.show?.(tab.key); }
    } else {
      $('#main').classList.remove('tab-custom');
      if (tab.kind === 'path' && tab.path && (S.files.has(tab.path) || codeEditor.hasDraft(tab.path))) {
        await openNote(tab.path, { push: false });
        if (tab.scroll && S.current === tab.path) {
          const sc = tab.scroll;
          ed.setSelectionRange(sc.start, sc.end, sc.direction);
          requestAnimationFrame(() => {
            if (activeTab() !== tab || S.current !== tab.path) return;
            edWrap.scrollTop = sc.ed; pvWrap.scrollTop = sc.pv;
          });
        }
      } else if (tab.kind === 'graph') showGraph();
      else if (tab.kind === 'review') showReview();
      else if (tab.kind === 'help') await showHelp(tab.page || 'guide');
      else { tab.kind = 'empty'; tab.path = null; showStartPage(); }
    }
  } finally { TABS.restoring = wasRestoring; }
  updateTopbar(); renderTabs(); persistTabs();
}

// Open a file. where: 'auto' (tree click: reuse the preview tab), 'new' (new tab), 'here' (this tab).
async function openInTab(path, { where = 'auto', keep = false, heading = '', index = null } = {}) {
  if (!S.files.has(path)) return;
  const existing = TABS.list.find(x => x.kind === 'path' && x.path === path);
  if (existing && where !== 'here') {
    if (keep) existing.preview = false;
    await activateTab(existing.id);
    if (heading && isMd(path)) setTimeout(() => scrollToHeading(heading), 30);
    else if (heading && S.view === 'file' && S.filePath === path) {
      if (sourceFormat(path) && /^L\d+$/i.test(heading)) { codeEditor.goTo(Number(heading.slice(1))); return; }
      const match = /^page=(\d+)$/i.exec(heading);
      if (match && S.pdf?.path === path) {
        S.pdf.jumpPage = Number(match[1]);
        if (S.pdf.ready) S.pdf.ctl?.goTo(S.pdf.jumpPage);
      } else if (!isMd(path)) await showFile(path, { push: false, at: heading });
    }
    return;
  }
  let target = null;
  const cur = activeTab();
  if (where === 'here' && cur && cur.kind !== 'custom') target = cur;
  else if (where === 'auto') {
    if (cur && (cur.kind === 'empty' || cur.preview)) target = cur;
    else target = TABS.list.find(x => x.preview) || null;
  }
  if (!target) {
    target = newTabObj({ preview: where === 'auto' && !keep });
    const i = index ?? (cur ? TABS.list.indexOf(cur) + 1 : TABS.list.length);
    TABS.list.splice(Math.max(0, Math.min(i, TABS.list.length)), 0, target);
  } else if (keep) target.preview = false;
  else if (where === 'auto' && target.kind === 'empty') target.preview = true;
  if (target !== cur) await activateTab(target.id);
  await openNote(path, { heading });
}

async function newTab(index = null) {
  if (S.dirty) await saveNow();
  const cur = activeTab();
  const nt = newTabObj();
  TABS.list.splice(index ?? (cur ? TABS.list.indexOf(cur) + 1 : TABS.list.length), 0, nt);
  await activateTab(nt.id);
  setTimeout(() => $('#start-search')?.focus(), 30);
}

async function closeTab(id, { activate = true } = {}) {
  const i = TABS.list.findIndex(x => x.id === id);
  if (i < 0) return;
  const tab = TABS.list[i];
  if (tab.id === TABS.active) { if (S.dirty) await saveNow(); saveTabView(tab); }
  if (tab.kind !== 'empty') TABS.closed.push({ ...tab, at: i });
  if (TABS.closed.length > 20) TABS.closed.shift();
  if (tab.kind === 'custom') {
    const pr = TABS.providers.get(tab.provider);
    if (tab.id === TABS.active) { pr?.hide?.(tab.key); $('#main').classList.remove('tab-custom'); }
    pr?.close?.(tab.key);
  }
  TABS.list.splice(i, 1);
  if (tab.id === TABS.active) {
    TABS.active = null;
    if (!TABS.list.length) TABS.list.push(newTabObj());
    if (activate) await activateTab((TABS.list[i] || TABS.list[i - 1]).id);
  }
  renderTabs(); persistTabs();
}
async function closeTabs(ids) {
  for (const id of ids) await closeTab(id, { activate: false });
  if (!activeTab()) await activateTab((TABS.list[0] || (TABS.list.push(newTabObj()), TABS.list[0])).id);
  renderTabs(); persistTabs();
}
async function reopenClosedTab() {
  const c = TABS.closed.pop();
  if (!c) return;
  if (c.kind === 'path' && !S.files.has(c.path)) return reopenClosedTab();
  const { id: _old, at: _at, ...rest } = c;
  const tab = newTabObj({ ...rest, preview: false });
  TABS.list.splice(Math.min(c.at, TABS.list.length), 0, tab);
  await activateTab(tab.id);
}
function cycleTab(dir) {
  if (TABS.list.length < 2) return;
  const i = TABS.list.findIndex(x => x.id === TABS.active);
  activateTab(TABS.list[(i + dir + TABS.list.length) % TABS.list.length].id);
}

// Files that are renamed, moved or deleted: keep the tabs pointing at the right place.
function renameInTabs(map) {
  for (const tab of [...TABS.list, ...TABS.closed]) {
    if (tab.path) tab.path = map(tab.path);
    if (tab.history) tab.history = tab.history.map(map);
  }
  renderTabs(); persistTabs();
}
async function pruneTabs() {
  const gone = TABS.list.filter(x => x.kind === 'path' && x.path && !S.files.has(x.path) && !codeEditor.hasDraft(x.path)).map(x => x.id);
  if (gone.length) await closeTabs(gone);
}

/* ---------- recent files and the new-tab page ---------- */
function rememberRecent(path) {
  if (!path) return;
  const r = (store.get('recent', []) || []).filter(p => p !== path);
  r.unshift(path);
  store.set('recent', r.slice(0, 30));
}
function showStartPage() {
  if (S.view !== 'note') setView('note');
  if (S.current) { offerCheckIfWritten(); S.current = null; S.dirty = false; }
  $('#doc').classList.add('hidden'); $('#empty-state').classList.remove('hidden');
  document.title = 'Graphite';
  renderStartPage();
  refreshRightPanel(); updateStatus(); updateTopbar();
  PM.emitFileOpen(null);
}
function renderStartPage() {
  const box = $('#empty-state .empty-inner');
  if (!box) return;
  const recent = (store.get('recent', []) || []).filter(p => S.files.has(p)).slice(0, 12);
  const launchers = [...TABS.providers.values()].flatMap(pr => (pr.launchers?.() || []).map(l => ({ ...l, provider: pr.id })));
  const item = (attrs, icon, title, sub) => `<button type="button" class="sp-item" ${attrs}>${icon}<span class="sp-t">${esc(title)}</span>${sub ? `<span class="sp-s">${esc(sub)}</span>` : ''}</button>`;
  const iconFor = p => tabSvg(tabIconKind({ kind: 'path', path: p }));
  box.innerHTML = `
    <div class="sp">
      <h2>${esc(t('tabs.startTitle'))}</h2>
      <input id="start-search" type="search" autocomplete="off" spellcheck="false" placeholder="${esc(t('tabs.searchPh'))}">
      <div id="start-results" class="sp-grid"></div>
      ${launchers.length ? `<h3>${esc(t('tabs.study'))}</h3><div class="sp-grid">${launchers.map(l => item(`data-launch="${esc(l.provider)}" data-key="${esc(l.key)}" title="${esc(l.subtitle || '')}"`, `<span class="tab-emoji">${esc(l.icon || '🎓')}</span>`, l.title, l.badge || '')).join('')}</div>` : ''}
      ${recent.length ? `<h3>${esc(t('tabs.recent'))}</h3><div class="sp-grid">${recent.map(p => item(`data-start-open="${esc(p)}" title="${esc(p)}"`, iconFor(p), isMd(p) ? baseName(p) : fileName(p), dirName(p))).join('')}</div>` : ''}
      <h3>${esc(t('tabs.actions'))}</h3>
      <div class="sp-grid sp-actions">
        ${item('data-cmd="new-note"', tabSvg('note'), t('menu.newNote'), 'Alt+N')}
        ${item('data-cmd="daily"', tabSvg('note'), t('ribbon.daily'), 'Alt+D')}
        ${item('data-cmd="graph"', tabSvg('graph'), t('graph.title'), 'Ctrl+G')}
        ${item('data-cmd="review"', tabSvg('review'), t('review.title'), 'Alt+R')}
        ${item('data-cmd="sjtu-canvas"', icon('calendar'), t('cmd.sjtu-canvas'), '')}
        ${item('data-cmd="help"', tabSvg('help'), t('empty.help'), 'F1')}
      </div>
      <p class="sp-tip">${esc(t('tabs.tip'))}</p>
    </div>`;
  const input = $('#start-search'), res = $('#start-results');
  const run = () => {
    const q = input.value.trim();
    if (!q) { res.innerHTML = ''; return; }
    const hits = [];
    for (const f of S.files.values()) {
      const label = isMd(f.path) ? baseName(f.path) : fileName(f.path);
      const r = fuzzy(q, label) || fuzzy(q, f.path);
      if (r) hits.push({ p: f.path, label, s: r.score });
    }
    hits.sort((a, b) => b.s - a.s);
    res.innerHTML = hits.slice(0, 12).map(h => item(`data-start-open="${esc(h.p)}" title="${esc(h.p)}"`, iconFor(h.p), h.label, dirName(h.p))).join('') || `<div class="muted pad">${esc(t('tabs.noHits'))}</div>`;
  };
  input.addEventListener('input', debounce(run, 80));
  input.addEventListener('keydown', e => { if (e.key === 'Enter') res.querySelector('[data-start-open]')?.click(); });
}
$('#empty-state').addEventListener('click', e => {
  const o = e.target.closest('[data-start-open]');
  if (o) { e.preventDefault(); e.stopPropagation(); openInTab(o.dataset.startOpen, { where: 'here', keep: true }); return; }
  const l = e.target.closest('[data-launch]');
  if (l) { e.preventDefault(); e.stopPropagation(); openCustomTab(l.dataset.launch, l.dataset.key, { here: true }); }
}, true);

/* ---------- tabs added by plugins ---------- */
async function openCustomTab(provider, key, { here = false, background = false } = {}) {
  let tab = TABS.list.find(x => x.kind === 'custom' && x.provider === provider && x.key === key);
  if (!tab) {
    const cur = activeTab();
    if (here && cur && cur.kind === 'empty') { tab = cur; Object.assign(tab, { kind: 'custom', provider, key, path: null, preview: false }); TABS.active = null; }
    else { tab = newTabObj({ kind: 'custom', provider, key }); TABS.list.splice(cur ? TABS.list.indexOf(cur) + 1 : TABS.list.length, 0, tab); }
    TABS.providers.get(provider)?.open?.(key);
  }
  if (background) { renderTabs(); persistTabs(); return; }
  await activateTab(tab.id);
}
window.moTabs = {
  // pr: { id, icon, title(key), open(key), show(key), hide(key), close(key), launchers() → [{ key, title, subtitle, icon, badge }],
  //       restore: [keys] (tabs it had open before tabs moved into the app) }
  registerProvider(pr) {
    TABS.providers.set(pr.id, pr);
    // First run with app tabs: take over the tabs the plugin had open itself.
    const mig = store.get('tabsMigrated', {}) || {};
    if (!mig[pr.id]) {
      for (const key of pr.restore || []) if (!TABS.list.some(x => x.kind === 'custom' && x.provider === pr.id && x.key === key)) TABS.list.push(newTabObj({ kind: 'custom', provider: pr.id, key }));
      store.set('tabsMigrated', { ...mig, [pr.id]: true });
    }
    for (const tab of TABS.list) if (tab.kind === 'custom' && tab.provider === pr.id) pr.open?.(tab.key);
    const a = activeTab();
    if (a?.kind === 'custom' && a.provider === pr.id) { $('#main').classList.add('tab-custom'); pr.show?.(a.key); }
    renderTabs(); persistTabs();
    if (activeTab()?.kind === 'empty') renderStartPage();
  },
  open: (provider, key, opts) => openCustomTab(provider, key, opts),
  close(provider, key) { const tab = TABS.list.find(x => x.kind === 'custom' && x.provider === provider && x.key === key); if (tab) closeTab(tab.id); },
  isOpen: (provider, key) => TABS.list.some(x => x.kind === 'custom' && x.provider === provider && x.key === key),
  activeKey(provider) { const a = activeTab(); return a?.kind === 'custom' && a.provider === provider ? a.key : null; },
  // badge: { text, progress (0–1, a thin line under the tab), title (tooltip) }
  setBadge(provider, key, badge) {
    const tab = TABS.list.find(x => x.kind === 'custom' && x.provider === provider && x.key === key);
    if (tab) { tab.badge = badge; renderTabs(); }
  },
  cycle: dir => cycleTab(dir),
  bar: () => $('#tabbar'),
};

/* ---------- tab bar: mouse ---------- */
{
  const bar = $('#tabbar'), box = bar.querySelector('.tabs');
  bar.addEventListener('click', e => {
    const x = e.target.closest('[data-close]');
    if (x) { e.stopPropagation(); closeTab(x.dataset.close); return; }
    const tb = e.target.closest('.tab');
    if (tb) activateTab(tb.dataset.tab);
    else if (e.target.closest('.tab-new')) newTab(TABS.list.length);
  });
  bar.addEventListener('auxclick', e => { const tb = e.target.closest('.tab'); if (tb && e.button === 1) { e.preventDefault(); closeTab(tb.dataset.tab); } });
  bar.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); }); // no autoscroll on middle-click
  bar.addEventListener('dblclick', e => {
    const tb = e.target.closest('.tab');
    if (tb) { const tab = tabById(tb.dataset.tab); if (tab?.preview) { tab.preview = false; renderTabs(); persistTabs(); } }
    else if (!e.target.closest('button')) newTab(TABS.list.length);
  });
  bar.addEventListener('contextmenu', e => {
    const tb = e.target.closest('.tab');
    e.preventDefault();
    if (!tb) return showMenu(e.clientX, e.clientY, [{ label: t('tabs.newTab') + '   Ctrl+T', run: () => newTab(TABS.list.length) }, ...(TABS.closed.length ? [{ label: t('tabs.reopen') + '   Ctrl+Shift+T', run: reopenClosedTab }] : [])]);
    const tab = tabById(tb.dataset.tab), i = TABS.list.indexOf(tab);
    showMenu(e.clientX, e.clientY, [
      { label: t('tabs.close') + '   Ctrl+W', run: () => closeTab(tab.id) },
      { label: t('tabs.closeOthers'), run: () => closeTabs(TABS.list.filter(x => x !== tab).map(x => x.id)) },
      { label: t('tabs.closeRight'), run: () => closeTabs(TABS.list.slice(i + 1).map(x => x.id)) },
      ...(tab.preview ? [{ label: t('tabs.keep'), run: () => { tab.preview = false; renderTabs(); persistTabs(); } }] : []),
      '-',
      ...(tab.kind === 'path' ? [{ label: t('tabs.reveal'), run: () => revealInTree(tab.path) }, { label: t('tabs.copyPath'), run: () => navigator.clipboard?.writeText(tab.path) }] : []),
      ...(TABS.closed.length ? [{ label: t('tabs.reopen') + '   Ctrl+Shift+T', run: reopenClosedTab }] : []),
      { label: t('tabs.newTab') + '   Ctrl+T', run: () => newTab(i + 1) },
    ]);
  });
  // Drag tabs to reorder; drop files from the tree on the bar to open them there.
  let dragId = null;
  const dropIndex = e => {
    const tabs = [...box.querySelectorAll('.tab')];
    for (let k = 0; k < tabs.length; k++) { const r = tabs[k].getBoundingClientRect(); if (e.clientX < r.left + r.width / 2) return k; }
    return tabs.length;
  };
  const marker = () => { bar.querySelectorAll('.drop-before, .drop-after').forEach(x => x.classList.remove('drop-before', 'drop-after')); };
  box.addEventListener('dragstart', e => {
    const tb = e.target.closest('.tab');
    if (!tb) return;
    dragId = tb.dataset.tab;
    e.dataTransfer.setData('text/x-mo-tab', dragId);
    const tab = tabById(dragId);
    if (tab?.kind === 'path') e.dataTransfer.setData('text/x-vault-path', tab.path); // drop a tab into a note: inserts a link
    e.dataTransfer.effectAllowed = 'all';
    tb.classList.add('dragging');
  });
  box.addEventListener('dragend', () => { dragId = null; marker(); box.querySelectorAll('.dragging').forEach(x => x.classList.remove('dragging')); });
  bar.addEventListener('dragover', e => {
    const types = e.dataTransfer.types;
    if (!types.includes('text/x-mo-tab') && !types.includes('text/x-vault-path')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = types.includes('text/x-mo-tab') ? 'move' : 'copy';
    marker();
    const tabs = [...box.querySelectorAll('.tab')], k = dropIndex(e);
    if (tabs[k]) tabs[k].classList.add('drop-before'); else tabs[tabs.length - 1]?.classList.add('drop-after');
  });
  bar.addEventListener('dragleave', e => { if (!bar.contains(e.relatedTarget)) marker(); });
  bar.addEventListener('drop', e => {
    marker();
    const k = dropIndex(e);
    const moving = e.dataTransfer.getData('text/x-mo-tab');
    if (moving) {
      e.preventDefault();
      const tab = tabById(moving), from = TABS.list.indexOf(tab);
      if (from < 0) return;
      TABS.list.splice(from, 1);
      TABS.list.splice(k > from ? k - 1 : k, 0, tab);
      renderTabs(); persistTabs();
      return;
    }
    const p = e.dataTransfer.getData('text/x-vault-path');
    if (p && S.files.has(p)) { e.preventDefault(); openInTab(p, { where: 'new', keep: true, index: k }); }
  });
}

/* ---------- dropping a file from the tree into the main area opens it in a new tab ----------
   Over the note editor, hold Alt to insert a link to it instead (the old behaviour). */
{
  const main = $('#main');
  let hint = null, hideT = 0;
  const showHint = (e, overEditor) => {
    if (!hint) { hint = document.createElement('div'); hint.id = 'drop-hint'; main.append(hint); }
    hint.textContent = overEditor && e.altKey ? t('tabs.dropLink') : t('tabs.dropOpen') + (overEditor ? ' · ' + t('tabs.dropAlt') : '');
    hint.classList.add('show');
    main.classList.add('drop-open');
    clearTimeout(hideT); hideT = setTimeout(clearHint, 250);
  };
  const clearHint = () => { hint?.classList.remove('show'); main.classList.remove('drop-open'); };
  main.addEventListener('dragover', e => {
    if (e.target.closest('#tabbar')) return;
    const types = e.dataTransfer?.types || [];
    if (!types.includes('text/x-vault-path') || types.includes('text/x-mo-tab')) return;
    e.preventDefault();
    const overEditor = !!e.target.closest('#editor');
    e.dataTransfer.dropEffect = overEditor && e.altKey ? 'link' : 'copy';
    showHint(e, overEditor);
  }, true);
  main.addEventListener('drop', e => {
    if (e.target.closest('#tabbar')) return;
    const p = e.dataTransfer?.getData('text/x-vault-path');
    if (!p || e.dataTransfer.types.includes('text/x-mo-tab')) return;
    clearHint();
    if (e.target.closest('#editor') && e.altKey) return; // the editor inserts a link
    e.preventDefault(); e.stopPropagation();
    if (S.files.has(p)) openInTab(p, { where: 'new', keep: true });
  }, true);
}

// While a file or tab is being dragged, embedded pages (🎓 study pages, PDFs shown as web pages, HTML files)
// let the drag pass through to the app. Otherwise they swallow it and the drop never arrives.
document.addEventListener('dragstart', e => {
  if (e.target.closest?.('.tree-item, #tabbar .tab')) document.body.classList.add('dragging-vault');
}, true);
for (const ev of ['dragend', 'drop']) document.addEventListener(ev, () => document.body.classList.remove('dragging-vault'), true);

function revealInTree(path) {
  setLeftTab('files');
  let d = dirName(path), changed = false;
  while (d) { if (S.collapsed.delete(d)) changed = true; d = dirName(d); }
  if (changed) { store.set('collapsed', [...S.collapsed]); renderTree(); }
  const el = [...$$('.tree-item')].find(x => x.dataset.path === path);
  el?.scrollIntoView({ block: 'center' });
  el?.classList.add('flash'); setTimeout(() => el?.classList.remove('flash'), 900);
}

// Startup: bring back the tabs from last time (or the last open file, from before there were tabs).
async function restoreTabs() {
  const saved = store.get('tabs', null);
  TABS.list = [];
  for (const x of saved?.list || []) {
    if (x.kind === 'path' && !S.files.has(x.path) && !codeEditor.hasDraft(x.path)) continue;
    const { id: oldId, ...rest } = x;
    const tab = newTabObj({ ...rest, history: (x.history || []).filter(p => S.files.has(p)) });
    tab.oldId = oldId;
    tab.hIdx = Math.min(x.hIdx ?? tab.history.length - 1, tab.history.length - 1);
    TABS.list.push(tab);
  }
  // A source removed outside Graphite still needs a way to recover its unsaved copy.
  for (const path of codeEditor.draftPaths()) {
    if (!S.files.has(path) && sourceFormat(path) && !TABS.list.some(tab=>tab.path===path)) TABS.list.push(newTabObj({kind:'path',path}));
  }
  const act = TABS.list.find(x => x.oldId === saved?.active) || TABS.list[0];
  for (const x of TABS.list) delete x.oldId;
  if (!TABS.list.length) {
    const last = store.get('last', null);
    const welcome = [...S.files.keys()].find(p => /^welcome\.md$/i.test(fileName(p)));
    const p = last && S.files.has(last) ? last : welcome;
    TABS.list.push(newTabObj(p ? { kind: 'path', path: p, history: [p], hIdx: 0 } : {}));
  }
  TABS.restoring = true;
  try { await activateTab((act || TABS.list[0]).id); } finally { TABS.restoring = false; }
  renderTabs();
}

/* =====================================================================
   Boot
   ===================================================================== */
async function boot() {
  applyAppearance(); // fonts and size from Settings → Appearance, before anything is drawn
  RV.attach(host);
  CK.initCheck(host);
  initGraph(host);
  AI.initAI(host);
  SA.initStudyAI(host);
  SUM.initSummary(host);
  FJ.initFileJobs(host);
  STUDY.initStudy(host);
  setLang(store.get('lang', null) || detectLang());
  applyI18n();
  for (const el of $$('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
  applyRibbonExtras();
  applyTheme();
  const app = $('#app');
  for (const side of ['left', 'right']) if (store.get(side + '-collapsed', false)) app.classList.add(side + '-collapsed');
  fitSides();
  setMode(S.mode);
  try { await loadAll(); } catch (e) { toast(t('toast.loadFailed', { msg: e.message })); return; }
  loadDrafts();
  renderTree(); refreshSidePanels();
  const last = store.get('last', null);
  const welcome = [...S.files.keys()].find(p => /^welcome\.md$/i.test(fileName(p)));
  void last; void welcome;
  // Review progress first: a restored Review tab (or plan / mistake book) draws from it right away.
  await RV.initReview(host);
  try { await restoreTabs(); }
  finally {
    booting = false;
    if (bootNav) { const go = bootNav; bootNav = null; go(); } // e.g. Review opened while this was loading
  }

  const es = new EventSource('/api/events');
  const resync = debounce(() => sync().catch(console.error), 250);
  es.onmessage = resync;
  // Also check when you come back to the window, in case a change notification was missed.
  addEventListener('focus', resync);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) resync(); });
  $('#st-sync').addEventListener('click', () => openSettings('sync'));

  window.myobsidianDesktop?.setLanguage(getLang());
  if (window.myobsidianDesktop?.onUpdate) { window.myobsidianDesktop.onUpdate(showUpdate); checkUpdates(); }
  initSettings(host);
  updateReviewBadge();
  setInterval(updateReviewBadge, 60 * 1000); // new day → new reviews
  // Right-click menu actions from the desktop app
  window.myobsidianDesktop?.onAppCommand?.(cmd => {
    if (cmd.type === 'wrap' && S.current && !codeEditor.activePath) { if (S.view !== 'note') showNoteView(); ed.focus(); wrapSelection(cmd.before, cmd.after ?? cmd.before); }
    else if (cmd.type === 'search') searchFor(cmd.text);
    else if (cmd.type === 'command') runCommand(cmd.id);
  });
  await PM.initPlugins(host);
  // Tabs from a plugin that isn't loaded (turned off or removed) would only show an empty page: close them.
  setTimeout(() => {
    const orphans = TABS.list.filter(x => x.kind === 'custom' && !TABS.providers.has(x.provider)).map(x => x.id);
    if (orphans.length) closeTabs(orphans);
  }, 4000);
  if (S.current) { renderPreview(); PM.emitFileOpen(S.current); }
}

/* =====================================================================
   Updates (desktop app): show an Update button when a newer version is available
   ===================================================================== */
function showUpdate(state) {
  const previous = S.update;
  S.update = state || null;
  const v = state?.available;
  // One update indicator: a highlighted button in the left icon bar, just above Help.
  const btn = $('#update-btn');
  $('#st-update').classList.add('hidden');
  btn.classList.toggle('hidden', !v);
  if (v) btn.title = state.progress != null ? t('update.downloading', { pct: Math.round(state.progress * 100) }) : t('update.tooltip', { version: v });
  btn.classList.toggle('downloading', state?.progress != null);
  if (state?.progress != null) btn.style.setProperty('--p', Math.round(state.progress * 100) + '%');
  if (!previous || previous.available !== state?.available || previous.checkError !== state?.checkError) refreshSettings('general');
}
async function checkUpdates(announce = false) {
  if (!window.myobsidianDesktop?.checkUpdates) return;
  const state = await window.myobsidianDesktop.checkUpdates({ force: announce }).catch(() => ({
    ...S.update, current: S.version, checkError: 'offline',
  }));
  if (!state) return;
  showUpdate(state);
  if (announce) toast(state.checkError ? t('update.check.' + state.checkError) :
    state.available ? t('update.tooltip', { version: state.available }) : t('update.upToDate', { version: state.current }));
}
let installingUpdate = false;
async function installUpdate() {
  const v = S.update?.available;
  if (installingUpdate || !v || !window.myobsidianDesktop?.installUpdate) return;
  if (!confirm(t('update.confirm', { version: v }))) return;
  installingUpdate = true;
  toast(t('update.installing', { version: v }));
  const r = await window.myobsidianDesktop.installUpdate().catch(e => ({ ok: false, error: e.message }));
  if (!r?.ok) {
    installingUpdate = false;
    const reasons = ['unsaved', 'saveTimeout', 'busy', 'download', 'integrity', 'launch', 'noInstaller'];
    const msg = reasons.includes(r?.errorCode) ? t('update.error.' + r.errorCode) : r?.error || '';
    toast(t('update.failed', { msg }));
  }
}

// The desktop app calls this before closing the window so the last edits are written to disk.
window.__moFlush = async () => {
  try { await saveNow(); } catch { /* reported below */ }
  if (S.current && S.dirty) setDraft(S.current, ed.value);
  persistDrafts();
  try { await RV.flushReview(); } catch { /* reported below */ }
  await retryDrafts().catch(() => {});
  const unsaved = [...drafts].map(([path, d]) => ({ path, text: d.text }));
  unsaved.push(...await codeEditor.flush());
  // Code workbench project files: their unsaved text is kept as drafts (checked by reading it back). If it couldn't
  // be kept, the desktop app offers only Retry / Go back (projectMessage, in this window's language); if it was,
  // hasProjectDrafts asks the desktop to make sure storage reaches the disk before closing.
  const wb = codeWorkbench.flush();
  const project = wb.ok ? (wb.hasDrafts ? { hasProjectDrafts: true } : {}) : { projectUnsaved: true, projectMessage: wb.message };
  // Review ratings that could not be written: the desktop app asks before closing, updating or switching vaults,
  // and shows reviewMessage (in this window's language). `unsaved` stays the real note and code drafts only.
  if (RV.reviewUnsaved()) return { ok: false, reviewUnsaved: true, reviewMessage: t('review.unsavedMsg'), unsaved, ...project };
  return { ok: !unsaved.length && wb.ok, unsaved, ...project };
};
// Ask once more on startup for drafts left from last time.
setTimeout(() => { if (drafts.size) retryDrafts(); }, 3000);

// Reloading or closing the page: the newest text is stored as a draft first, then one last save is sent with
// the same version check as every other save, so it can never overwrite a change that reached the disk.
addEventListener('beforeunload', () => {
  codeEditor.writeDrafts();
  if (S.dirty && S.current) {
    setDraft(S.current, ed.value);
    const base = draftBase(S.current);
    fetch(`/api/file?path=${encodeURIComponent(S.current)}`, { method: 'PUT', keepalive: true, headers: { 'X-Vault': '1', ...(base != null ? { 'X-Base-Hash': hash(base) } : {}) }, body: ed.value });
  }
  persistDrafts();
});

boot();
