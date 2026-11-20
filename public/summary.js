// Summarize this PDF: one PDF → an editable Markdown note with the main points by section, key concepts and
// formulas, each pointing back to its page ([[file.pdf#page=N|p. N]]). Done by the AI chosen for "PDF summary"
// in Settings → AI (Claude Code, a local framework or an API model), with the Study settings that job uses.
//
// The rules that keep it safe:
// - Pages are checked against the PDF's real page count before any AI is asked (0, past the end, or a range
//   running past the end are refused; an empty field means every page). Nothing is sent for a bad range.
// - Page links come from Graphite, not the AI: a page the AI names that wasn't read is shown without a link.
// - Nothing is written until you press Save in the preview. An existing summary is never overwritten silently:
//   you choose "save as a new note" or "update the existing note" (with a warning if you edited it by hand).
// - Stopping or a failed save leaves every existing note as it was.
import { t } from '/i18n.js';
import * as AI from '/ai.js';
import { pdfText, parsePages, pageRanges } from '/pdfview.js';
import { pagesError, pdfPageCount } from '/studyai.js';

let H = null;
export function initSummary(host) { H = host; }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dirOf = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const fileOf = p => p.split('/').pop();
const stem = p => fileOf(p).replace(/\.[^.]+$/, '');
const join = (d, n) => (d ? d + '/' + n : n);
const safeName = s => String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Summary';
const today = () => { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };
// A short fingerprint of a summary's body, kept in its frontmatter: tells a hand-edited summary from an untouched one.
export function fingerprint(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s).replace(/\r\n?/g, '\n').trim()) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
const splitFm = md => { const m = String(md).match(/^---\n([\s\S]*?)\n---\n?/); return m ? { fm: m[1], body: md.slice(m[0].length) } : { fm: '', body: String(md) }; };
const fmField = (fm, k) => (fm.match(new RegExp('^' + k + ':\\s*(.*)$', 'm')) || [])[1]?.trim().replace(/^["']|["']$/g, '') || '';

/* ---------- where to save ---------- */
// The PDF's own folder first. If the PDF came from a course folder outside the vault (an import) or sits in a
// folder named by a course code, the mapped course folder in the vault is offered too.
async function destinations(path, profile) {
  const out = [{ folder: dirOf(path), label: t('sum.destSame', { folder: dirOf(path) || '/' }) }];
  const courses = profile?.courses || {};
  const add = (folder, label) => { if (folder != null && !out.some(o => o.folder.toLowerCase() === folder.toLowerCase())) out.push({ folder, label }); };
  // 1. Imported from outside the vault: the manifest knows the original path.
  try {
    const r = await H.api('GET', 'file', { path: '.obsidian/plugins/claude-chat/imports.json' });
    const man = JSON.parse(r.content || '{}');
    const src = Object.entries(man.imported || {}).find(([, v]) => String(v.dest || '').toLowerCase() === path.toLowerCase())?.[0];
    if (src) {
      const s = src.replace(/\\/g, '/');
      for (const root of profile?.courseRoots || []) {
        const r0 = root.replace(/\\/g, '/').replace(/\/+$/, '');
        if (!s.toLowerCase().startsWith(r0.toLowerCase() + '/')) continue;
        const code = s.slice(r0.length + 1).split('/')[0];
        if (courses[code]) add(courses[code], t('sum.destCourse', { course: courses[code], src: s }));
      }
    }
  } catch { /* no imports yet */ }
  // 2. Inside the vault under a course code folder (e.g. "LA/…" with LA = Linear Algebra and a "Linear Algebra" folder).
  const topDir = path.split('/')[0];
  if (path.includes('/') && courses[topDir] && H.S.folders?.has?.(courses[topDir])) add(courses[topDir], t('sum.destCourse', { course: courses[topDir], src: topDir }));
  const ro = (profile?.readOnlyFolders || []).map(f => f.toLowerCase().replace(/\/+$/, ''));
  for (const o of out) o.readOnly = ro.some(r => o.folder.toLowerCase() === r || o.folder.toLowerCase().startsWith(r + '/'));
  return out;
}

/* ---------- the window ---------- */
let win = null, pending = null;
function close() { pending?.abort(); pending = null; win?.remove(); win = null; document.removeEventListener('keydown', onKey, true); }
const onKey = e => { if (e.key === 'Escape' && win) { e.preventDefault(); e.stopPropagation(); close(); } };
function open(title) {
  close();
  win = document.body.appendChild(document.createElement('div'));
  win.className = 'review-modal ai-tool ai-summary';
  win.innerHTML = `<div class="review-bg"></div><div class="review-box">
    <div class="review-head"><span class="review-title">${esc(title)}</span><span class="review-progress"></span><button class="review-x" aria-label="${esc(t('review.close'))}">×</button></div>
    <div class="review-card scroll ai-tool-body"></div>
    <div class="review-actions ai-tool-actions"></div></div>`;
  win.querySelector('.review-bg').onclick = close;
  win.querySelector('.review-x').onclick = close;
  document.addEventListener('keydown', onKey, true);
  return { body: win.querySelector('.ai-tool-body'), actions: win.querySelector('.ai-tool-actions') };
}
const engineSelect = () => `<label class="ai-field"><span>${esc(t('sum.runBy'))}</span><select data-f="engine" data-aip-job="summary">${AI.options('summary').filter(o => o.value !== 'off')
  .map(o => `<option value="${esc(o.value)}"${o.value === AI.choice('summary') ? ' selected' : ''}${o.ready ? '' : ' disabled'}>${esc(o.label + (o.ready ? '' : ' — ' + t('sum.unavailable')))}</option>`).join('')}</select></label>`;

export async function summaryDialog(path) {
  if (!path || !/\.pdf$/i.test(path) || !H.S.files.has(path)) { H.toast(t('sum.pickPdf')); return; }
  const { body, actions } = open(t('sum.title'));
  const st = await AI.studySettings().catch(() => null);
  if (!win) return;
  const profile = st?.profile || {};
  const total = await pdfPageCount(path).catch(() => 0);
  if (!win) return;
  const dests = await destinations(path, profile);
  if (!win) return;
  body.innerHTML = `<p class="muted">${esc(t('sum.intro'))}</p>
    <div class="ai-field"><span>${esc(t('sum.file'))}</span><b class="sum-file">${esc(path)}</b></div>
    <p class="ai-pages-info muted">${total ? esc(t('exam.pageCount', { n: total })) : esc(t('sum.unreadable'))}</p>
    <label class="ai-field"><span>${esc(t('exam.pages'))}</span><input data-f="pages" placeholder="${esc(t('exam.pagesPh'))}"></label>
    <label class="ai-field"><span>${esc(t('sum.saveIn'))}</span><select data-f="dest">${dests.map((d, i) => `<option value="${i}"${d.readOnly ? ' disabled' : ''}>${esc(d.label + (d.readOnly ? ' — ' + t('sum.readOnly') : ''))}</option>`).join('')}</select></label>
    ${engineSelect()}
    <p class="sum-avail muted"></p>`;
  // The selected AI's state, right where the job starts (installed? connected? needs a key?).
  const sel = body.querySelector('[data-f=engine]'), avail = body.querySelector('.sum-avail');
  const showAvail = async () => {
    const v = sel.value;
    let text = t('sum.availApi', { name: AI.executorName(v) });
    if (v === AI.CC) text = (await AI.ccListening()) ? t('fw.ccOn') : t('fw.ccOff');
    else if (AI.isLocal(v)) text = AI.fwStatus(v).text;
    if (win && sel.value === v) avail.textContent = `${t('sum.runBy')}: ${AI.executorName(v)} · ${text}`;
  };
  sel.addEventListener('change', showAvail); showAvail();
  try { (await import('/aipicker.js')).enhanceAISelect(sel, 'summary'); } catch { /* plain select */ }
  const firstOk = dests.findIndex(d => !d.readOnly);
  body.querySelector('[data-f=dest]').value = String(Math.max(0, firstOk));
  actions.innerHTML = `<button class="mod-button mod-cta" data-a="go">${esc(t('sum.go'))}</button><button class="mod-button" data-a="cancel">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=cancel]').onclick = close;
  actions.querySelector('[data-a=go]').onclick = async () => {
    if (!total) { H.toast(t('sum.unreadable')); return; }
    let only;
    try { only = parsePages(body.querySelector('[data-f=pages]').value, total); } catch (e) { H.toast(pagesError(e)); body.querySelector('[data-f=pages]').focus(); return; }
    const dest = dests[+body.querySelector('[data-f=dest]').value];
    if (!dest || dest.readOnly) { H.toast(t('sum.readOnlyToast')); return; }
    const engine = sel.value;
    if (engine !== AI.choice('summary')) AI.setChoice('summary', engine);
    await generate({ path, only, total, dest, engine, profile, body, actions });
  };
}

async function generate({ path, only, total, dest, engine, profile, body, actions }) {
  const pages = only || Array.from({ length: total }, (_, i) => i + 1);
  const src = '/vault/' + path.split('/').map(encodeURIComponent).join('/');
  const stop = new AbortController(); pending = stop;
  const t0 = Date.now();
  const busy = msg => { body.innerHTML = `<div class="check-busy"><span class="spinner"></span><span class="sum-busy">${esc(msg)}</span><span class="check-elapsed muted"></span></div>`; };
  busy(t('exam.reading'));
  actions.innerHTML = `<button class="mod-button" data-a="stop">${esc(t('ai.stop'))}</button>`;
  actions.querySelector('[data-a=stop]').onclick = () => stop.abort();
  const tick = setInterval(() => { const el = win?.querySelector('.check-elapsed'); if (!el) return clearInterval(tick); el.textContent = Math.round((Date.now() - t0) / 1000) + ' s'; }, 1000);
  const failed = msg => { if (!win) return; body.innerHTML = `<p class="mod-error sum-error">${esc(msg)}</p><p class="muted">${esc(t('sum.nothingWritten'))}</p>`; actions.innerHTML = `<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`; actions.querySelector('[data-a=close]').onclick = close; };
  try {
    // The text of the chosen pages (also for Claude Code and local agents, as a start: they can open the PDF).
    let read;
    try { read = await pdfText(src, { only: pages, onProgress: (i, n) => { const el = win?.querySelector('.sum-busy'); if (el) el.textContent = t('exam.readingN', { i, n }); } }); }
    catch (e) { if (e.code === 'range') return failed(t('exam.pagesRange', { part: pageRanges(pages), n: total })); throw e; }
    if (stop.signal.aborted) return failed(t('sum.stopped'));
    const withText = read.pages.filter(p => p.text);
    const isApi = engine !== AI.CC && !AI.isLocal(engine);
    if (!withText.length && isApi) return failed(t('sum.scanned', { pages: pageRanges(pages) }));
    busy(engine === AI.CC ? t('ai.workingCC') : t('ai.working', { model: AI.label(engine) }));
    const text = withText.map(p => `--- page ${p.n} ---\n${p.text}`).join('\n').slice(0, 300000);
    const local = AI.isLocal(engine) || engine === AI.CC
      ? `<pdf_file>${path}</pdf_file>\n<pages_to_summarize>${pageRanges(pages)} of ${total}</pages_to_summarize>\n` + (read.empty.length ? `<pages_without_text>${pageRanges(read.empty)} — scanned: open these pages from the PDF yourself.</pages_without_text>\n` : '')
      : (read.empty.length ? `<pages_without_text>${pageRanges(read.empty)}</pages_without_text>\n` : '');
    const content = `${local}<pdf file="${path}">\n${text}\n</pdf>\n<pages_included>${pageRanges(pages)} of ${total}</pages_included>`;
    const r = await AI.request('summary', 'summary', { title: stem(path), content, path, job: { pages: pageRanges(pages), total, pdf: path } }, { signal: stop.signal, provider: engine });
    if (!win || stop.signal.aborted) return;
    const md = buildNote(path, r, { pages, empty: read.empty, engine, profile });
    preview({ path, md, dest, title: r.title, body, actions });
  } catch (e) {
    if (stop.signal.aborted || e.name === 'AbortError') return failed(t('sum.stopped'));
    failed(t('ai.failedJob', { msg: e.name === 'TimeoutError' ? t('check.timeout') : AI.errorText(e, engine) }));
  } finally { clearInterval(tick); if (pending === stop) pending = null; }
}

// The note, built by Graphite so every page link is real: a page that wasn't read gets no link.
export function buildNote(path, r, { pages, empty = [], engine, profile = {} }) {
  const ok = new Set(pages);
  const link = H.linkNameFor(path);
  const at = n => (n && ok.has(n) ? ` ([[${link}#page=${n}|p. ${n}]])` : '');
  const L = [];
  L.push(`[[${link}|${fileOf(path)}]] · ${t('sum.pagesLine', { pages: pageRanges(pages) })}`, '');
  if (r.overview) L.push(r.overview.trim(), '');
  if (empty.length) L.push(`> ${t('sum.emptyNote', { pages: pageRanges(empty) })}`, '');
  for (const s of r.sections || []) {
    L.push(`## ${s.heading || t('sum.section')}${at(s.page)}`, '');
    for (const p of s.points || []) L.push(`- ${p.text.trim()}${at(p.page)}`);
    L.push('');
  }
  if (r.concepts?.length) {
    L.push(`## ${t('sum.concepts')}`, '');
    for (const c of r.concepts) L.push(`- **${c.term.trim()}**: ${c.meaning.trim()}${at(c.page)}`);
    L.push('');
  }
  if (r.formulas?.length) {
    L.push(`## ${t('sum.formulas')}`, '');
    for (const f of r.formulas) L.push(`- $${f.latex.trim().replace(/^\$+|\$+$/g, '')}$${f.meaning ? ' — ' + f.meaning.trim() : ''}${at(f.page)}`);
    L.push('');
  }
  const bodyText = L.join('\n').trim() + '\n';
  const fm = ['---', 'tags: [PDF summary]', `created: ${today()}`, `source: "[[${link}]]"`, `summary-of: "${path.replace(/"/g, "'")}"`, `pages: "${pageRanges(pages)}"`,
    `generated-by: "${AI.executorName(engine).replace(/"/g, "'")}"`, `generated-hash: ${fingerprint(bodyText)}`, '---', ''];
  void profile;
  return fm.join('\n') + `# ${(r.title || stem(path) + ' ' + t('sum.suffix')).replace(/\n/g, ' ')}\n\n` + bodyText;
}

// The preview: where it will be saved, the note rendered, and Save. If a note is already there: save as new, or
// update it (warning when it was edited by hand since it was generated).
async function preview({ path, md, dest, body, actions }) {
  const name = `${safeName(stem(path))} ${t('sum.suffix')}.md`;
  const target = join(dest.folder, name);
  body.innerHTML = `<div class="ai-field"><span>${esc(t('sum.target'))}</span><code class="sum-target">${esc(target)}</code></div>
    <div class="sum-existing"></div>
    <div class="markdown sum-preview"></div>`;
  H.renderInto(body.querySelector('.sum-preview'), md, target, 1);
  const exists = H.S.files.has(target);
  let edited = false;
  if (exists) {
    try {
      const cur = await H.readFile(target);
      const { fm, body: b } = splitFm(cur);
      const want = fmField(fm, 'generated-hash');
      const titleCut = b.replace(/^# .*\n\n?/, '');
      edited = !want || fingerprint(titleCut) !== want;
    } catch { edited = true; }
    body.querySelector('.sum-existing').innerHTML = `<p class="${edited ? 'mod-warning' : 'muted'} sum-exists">${esc(t(edited ? 'sum.existsEdited' : 'sum.exists', { path: target }))}</p>
      <label class="sum-choice"><input type="radio" name="sum-mode" value="new" checked> ${esc(t('sum.saveNew'))}</label>
      <label class="sum-choice"><input type="radio" name="sum-mode" value="update"> ${esc(t(edited ? 'sum.updateEdited' : 'sum.update'))}</label>`;
  }
  actions.innerHTML = `<button class="mod-button mod-cta" data-a="save">${esc(t('sum.save'))}</button><button class="mod-button" data-a="cancel">${esc(t('sum.discard'))}</button>`;
  actions.querySelector('[data-a=cancel]').onclick = close;
  const btn = actions.querySelector('[data-a=save]');
  btn.onclick = async () => {
    btn.disabled = true;
    const mode = body.querySelector('input[name=sum-mode]:checked')?.value || 'new';
    let saved = null;
    try {
      if (exists && mode === 'update') {
        if (edited && !confirm(t('sum.confirmUpdate', { path: target }))) { btn.disabled = false; return; }
        await H.writeNote(target, md);
        saved = target;
      } else {
        let p = target, i = 1;
        while (H.S.files.has(p)) p = join(dest.folder, `${safeName(stem(path))} ${t('sum.suffix')} ${++i}.md`);
        const f = await H.createFile(p, md, { silent: true });
        if (!f) throw new Error(t('sum.writeFailed', { path: p }));
        saved = f.path;
      }
    } catch (e) {
      btn.disabled = false;
      body.querySelector('.sum-existing').insertAdjacentHTML('afterbegin', `<p class="mod-error sum-error">${esc(t('sum.saveFailed', { msg: e.message || String(e) }))}</p>`);
      return;
    }
    close();
    await H.openNote(saved);
    H.toast(t('ai.savedTo', { path: saved }));
  };
}
