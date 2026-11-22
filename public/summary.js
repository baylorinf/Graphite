// Summarize this PDF: one PDF → an editable Markdown note with the main points by section, key concepts and
// formulas, each pointing back to its page ([[file.pdf#page=N|p. N]]). Done by the AI chosen for "PDF summary"
// in Settings → AI (Claude Code, a local framework or an API model), with the Study settings that job uses.
//
// The rules that keep it safe:
// - Pages are checked against the PDF's real page count before any AI is asked (0, past the end, or a range
//   running past the end are refused; an empty field means every page). Nothing is sent for a bad range.
// - Page links come from Graphite, not the AI: a page the AI names that wasn't read is shown without a link.
// - Paragraph links too: each paragraph is sent after its source ID ("[P7S3]" = page 7, paragraph 3; see
//   pdfview.js paragraphs), the AI names it in `source`, and only an ID its batch sent, of this PDF, whose page
//   agrees with the item's page, becomes [[file.pdf#page=7&source=P7S3&fp=…|p. 7 ¶3]]; anything else falls back
//   to the checked page. The viewer scrolls to that paragraph and highlights it, or shows just the page when
//   the PDF has changed so that the paragraph can't be found for sure.
// - Nothing is written until you press Save in the preview. An existing summary is never overwritten silently:
//   you choose "save as a new note" or "update the existing note" (with a warning if you edited it by hand).
// - Stopping or a failed save leaves every existing note as it was.
import { t } from '/i18n.js';
import * as AI from '/ai.js';
import { pdfText, parsePages, pageRanges, parseSourceId, locationHash } from '/pdfview.js';
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
    const same = p => String(p || '').replace(/\\/g, '/').toLowerCase() === path.toLowerCase();
    // This PDF itself, or the PDF made later from a Word/PowerPoint original (its preview record knows both).
    const previewIds = new Set(Object.entries(man.previews || {}).filter(([, v]) => same(v?.pdfDest)).map(([id]) => id));
    const src = Object.entries(man.imported || {}).find(([, v]) => same(v?.dest) || (v?.previewId && previewIds.has(v.previewId)))?.[0];
    if (src) {
      // Import records keep source paths in lower case: match course roots and course codes without case.
      const s = src.replace(/\\/g, '/');
      const courseOf = code => Object.keys(courses).find(k => k.toLowerCase() === String(code).toLowerCase());
      for (const root of profile?.courseRoots || []) {
        const r0 = root.replace(/\\/g, '/').replace(/\/+$/, '');
        if (!s.toLowerCase().startsWith(r0.toLowerCase() + '/')) continue;
        const code = courseOf(s.slice(r0.length + 1).split('/')[0]);
        if (code) add(courses[code], t('sum.destCourse', { course: courses[code], src: s }));
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
let win = null, pending = null, back = null;
function close() { pending?.abort(); pending = null; win?.remove(); win = null; back?.remove(); back = null; document.removeEventListener('keydown', onKey, true); }
// Esc closes the window, but not while it is set aside to look at a source (that would throw the result away).
const onKey = e => { if (e.key === 'Escape' && win && !win.classList.contains('sum-peek')) { e.preventDefault(); e.stopPropagation(); close(); } };
// A source link clicked in the preview: the window steps aside so the PDF (scrolled to that paragraph) can be
// seen, and a button brings the same unsaved preview back, to Save without running the AI again.
function peek() {
  if (!win) return;
  win.classList.add('sum-peek');
  if (!back) {
    back = document.body.appendChild(Object.assign(document.createElement('button'), { className: 'mod-button mod-cta sum-return', textContent: t('sum.backToPreview') }));
    back.onclick = unpeek;
  }
}
function unpeek() { win?.classList.remove('sum-peek'); back?.remove(); back = null; }
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
  const st = await AI.studySettings(true).catch(() => null);
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
    let text = t('sum.availApi', { name: AI.executorName(v, 'summary') });
    if (v === AI.CC) text = (await AI.ccListening()) ? t('fw.ccOn') : t('fw.ccOff');
    else if (AI.isLocal(v)) text = AI.fwStatus(v).text;
    if (win && sel.value === v) avail.textContent = `${t('sum.runBy')}: ${AI.executorName(v, 'summary')} · ${text}`;
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
    // Read-only as Study settings say now (they may have changed since this window opened).
    if (!dest || dest.readOnly || await AI.readOnlyFolderOf((dest.folder ? dest.folder + '/' : '') + 'summary.md')) { H.toast(t('sum.readOnlyToast')); return; }
    const engine = sel.value;
    if (engine !== AI.choice('summary')) AI.setChoice('summary', engine);
    await generate({ path, only, total, dest, engine, profile, body, actions });
  };
}

/* ---------- long PDFs: what is sent, in batches ----------
   Nothing is cut off: the chosen pages' text is split into batches of at most BATCH_CHARS characters, page by
   page in order; a page longer than that is split into parts ("--- page 7 (part 2/3) ---"), so the last page
   always gets there too. Each batch is one request, and the note's page links may only point to pages that
   batch really sent (for Claude Code and local agents, also the scanned pages of its range, which they open
   from the PDF themselves). */
export const BATCH_CHARS = 90000;
// pages: [{ n, text, paras? }] in order. Returns [{ pages: [n…] (pages whose text — or part of it — is in this
// batch), open: [n…] (pages without text in this batch's range, for agents that can open the PDF), text,
// sources: { P7S3: fp, … } (the paragraphs whose words — or part of them — are in this batch) }].
// With paras (pdfText(…, { paras: true })), a page is sent as its paragraphs, each after its source ID:
// "[P7S3] words…", blank line between paragraphs. A part that starts inside a paragraph repeats its ID first,
// so every piece of text the AI reads carries the ID it may cite.
export function planBatches(pages, { budget = BATCH_CHARS, agent = false } = {}) {
  const pieces = [];
  for (const p of pages) {
    const paras = (p.paras || []).filter(x => x && x.id && String(x.text || '').trim());
    const spans = [];
    let text = String(p.text || '');
    if (text && paras.length) {
      text = '';
      for (const x of paras) {
        if (text) text += '\n\n';
        spans.push({ id: x.id, fp: x.fp || '', from: text.length, to: text.length + x.id.length + 3 + String(x.text).length });
        text += `[${x.id}] ${x.text}`;
      }
    }
    const within = (a, e) => Object.fromEntries(spans.filter(s => s.from < e && s.to > a).map(s => [s.id, s.fp]));
    if (!text) { pieces.push({ n: p.n, empty: true }); continue; }
    const head = `--- page ${p.n} ---\n`;
    if (head.length + text.length + 1 <= budget) { pieces.push({ n: p.n, chunk: head + text + '\n', sources: within(0, text.length) }); continue; }
    // Split at a line break or space near the end of the room, never inside a word (a hard cut only for a
    // "word" longer than half a batch).
    const room = budget - 64 - (spans.length ? 24 : 0); // leaves space for the "(part i/m)" marker and a repeated ID
    const cuts = [];
    for (let at = 0; at < text.length;) {
      let end = Math.min(text.length, at + room);
      if (end < text.length) {
        const nl = text.lastIndexOf('\n', end - 1), sp = Math.max(text.lastIndexOf(' ', end - 1), text.lastIndexOf('\t', end - 1));
        let best = nl > at + room / 2 ? nl + 1 : sp > at + room / 2 ? sp + 1 : end;
        // A hard cut never falls between the two halves of a character outside the BMP (𝑥, 😀, rare CJK…),
        // which would send each request half a character.
        const code = text.charCodeAt(best - 1);
        if (best === end && code >= 0xD800 && code <= 0xDBFF) best -= 1;
        end = best;
      }
      cuts.push({ at, end }); at = end;
    }
    cuts.forEach(({ at, end }, i) => {
      // Inside a paragraph: its ID again, marked as continued.
      const inside = spans.find(s => s.from < at && s.to > at);
      const again = inside ? `[${inside.id}] (…) ` : '';
      pieces.push({ n: p.n, chunk: `--- page ${p.n} (part ${i + 1}/${cuts.length}) ---\n${again}${text.slice(at, end)}\n`, sources: within(at, end) });
    });
  }
  const batches = [];
  let cur = null, waiting = []; // pages without text before the first text: they go with the next batch
  for (const x of pieces) {
    if (x.empty) { if (cur) cur.open.push(x.n); else waiting.push(x.n); continue; }
    if (!cur || (cur.text && cur.text.length + x.chunk.length > budget)) { cur = { pages: [], open: waiting, text: '', sources: {} }; waiting = []; batches.push(cur); }
    cur.text += x.chunk;
    Object.assign(cur.sources, x.sources);
    if (!cur.pages.includes(x.n)) cur.pages.push(x.n);
  }
  // Without any text (all scanned), agents still get the page range to open themselves.
  if (!batches.length && agent && waiting.length) batches.push({ pages: [], open: waiting, text: '', sources: {} });
  for (const b of batches) if (!Object.keys(b.sources).length) delete b.sources; // plain text: no IDs to cite
  return batches;
}
// The pages one batch's answer may cite.
export const citable = (b, agent) => new Set([...b.pages, ...(agent ? b.open : [])]);
// Keep a batch's answer to the pages it was given: any other page number becomes 0 (shown without a link).
// Links the AI wrote into its own text are not trusted either: every link (wiki [[…]] or Markdown [..](..))
// and raw URL in the text becomes plain words, so the only links in the note are the page links Graphite adds.
// Every kind of link becomes its words. Where a link pointed to a page of this PDF: a page this batch sent keeps
// a jump, rebuilt by Graphite (pageLink); any other page stays as readable text "p. N" with no jump. Covered:
// [[wiki]] / ![[embeds]], [inline](url), [reference][ref] / [ref][] / [ref] with their "[ref]: url" lines (the
// lines are removed), <autolinks>, <a href> and bare URLs.
// A jump is rebuilt only for a target that names THIS PDF (isSelf, see selfMatcher) and a page this batch sent.
// A bare "#page=N" names no file, and "Other.pdf#page=2" is another book: both stay readable text.
const normFile = f => { let t = String(f || '').replace(/\\/g, '/'); try { t = decodeURIComponent(t); } catch { /* keep */ } return t.trim().replace(/^\.?\/+/, '').toLowerCase(); };
// The names that mean this PDF: its vault path, and its link name (just the file name when no other file in the
// vault has that name), each with or without ".pdf".
export function selfMatcher(path, linkName) {
  const names = new Set();
  for (const n of [path, linkName]) { const x = normFile(n); if (x) { names.add(x); names.add(x.replace(/\.pdf$/, '')); } }
  return file => names.has(normFile(file));
}
// sources: { P7S3: fp, … }, the paragraphs this batch sent. A jump keeps a paragraph ("&source=P7S3") only when
// that paragraph is one of them; the AI's bare "[P7S3]" markers in its prose become such jumps, or vanish when
// the ID is not one this batch sent.
const own = (o, k) => !!o && Object.prototype.hasOwnProperty.call(o, k);
export function plainText(s, ok = new Set(), pageLink = null, isSelf = () => false, sources = {}) {
  const jumps = [];
  const parse = target => {
    let t = String(target || '');
    try { t = decodeURIComponent(t); } catch { /* keep */ }
    const m = t.match(/#page=(\d+)/i), q = parseSourceId((t.match(/[#&]source=([^&\s]*)/i) || [])[1]);
    return { n: m ? +m[1] : 0, file: t.replace(/#.*$/, '').trim(), src: q && m && q.page === +m[1] && own(sources, q.id) ? q.id : '' };
  };
  // A link's replacement: its words, then the page — a checked jump, "(p. N)" for this PDF's other pages or a
  // bare #page, "(Other.pdf p. N)" for another file.
  const cite = (label, target) => {
    const { n, file, src } = parse(target);
    let words = String(label || '').trim();
    if (!n) return words;
    if (new RegExp(`^(?:p\\.?|page|第)?\\s*${n}\\s*页?$`, 'i').test(words)) words = ''; // the words are just the page
    const base = file.replace(/\\/g, '/').split('/').pop();
    if (words && file && [normFile(file), normFile(base)].includes(normFile(words))) words = ''; // the words are just the file
    const self = !!file && isSelf(file);
    if (self && ok.has(n) && pageLink) { jumps.push([n, src]); return words ? `${words} \u0001${jumps.length - 1}\u0002` : `\u0003${jumps.length - 1}\u0002`; }
    const where = self || !file ? `p. ${n}` : `${base} p. ${n}`;
    return words ? `${words} (${where})` : where;
  };
  let out = String(s ?? '').replace(/\r\n?/g, '\n').replace(/[\u0001-\u0003]/g, ''); // (the marks used below)
  // 1. Reference definitions: remember, then remove the lines.
  const refs = new Map();
  // Taken liberally: any line starting "[label]:" (even with spaces in the target, as "Long lecture.pdf#page=9").
  out = out.replace(/^[ \t]*\[([^\]\n]+)\]:[ \t]*(.*)$\n?/gm, (_, label, rest) => {
    const target = rest.trim().replace(/[ \t]+(?:"[^"]*"|'[^']*'|\([^)]*\))$/, '').replace(/^<([^>]*)>$/, '$1');
    refs.set(label.trim().toLowerCase(), target); return '';
  });
  out = out
    // 2. Wiki links and embeds.
    .replace(/!?\[\[([^\]|\n]*)(?:\|([^\]\n]*))?\]\]/g, (_, target, label) => cite(label || String(target).replace(/#.*$/, '').trim(), target))
    // 3. Inline links and images: [words](target "title").
    .replace(/!?\[([^\]\n]*)\]\(\s*(?:<([^>\n]*)>|([^)\s]*))(?:\s+(?:"[^"\n]*"|'[^'\n]*'))?\s*\)/g, (_, label, a, b) => cite(label, a ?? b))
    // 4. Reference links: [words][ref], [ref][], and [ref] when it was defined.
    .replace(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g, (_, label, ref) => cite(label, refs.get((ref || label).trim().toLowerCase()) || ''))
    .replace(/!?\[([^\]\n]+)\](?![(:])/g, (m, label) => (refs.has(label.trim().toLowerCase()) ? cite(label, refs.get(label.trim().toLowerCase())) : m))
    // 4b. Source IDs written as "[P7S3]": a checked jump to that paragraph, or nothing.
    .replace(/[ \t]?\[\s*(P\d+S\d+)\s*\]/gi, (m, id) => {
      const q = parseSourceId(id);
      if (!q || !own(sources, q.id) || !ok.has(q.page)) return '';
      if (!pageLink) return ` (p. ${q.page})`;
      jumps.push([q.page, q.id]); return ` \u0001${jumps.length - 1}\u0002`;
    })
    // 5. HTML links, <autolinks>, bare URLs and bare "#page=N".
    .replace(/<a\b[^>]*?href\s*=\s*["']?([^"'\s>]*)[^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => cite(label.replace(/<[^>]*>/g, ''), href))
    .replace(/<([^<>\s]+)>/g, (m, target) => (/^[a-z][\w+.-]*:|#page=\d+|^[^@\s]+@[^@\s]+$/i.test(target) ? cite(String(target).replace(/#.*$/, ''), target) : m))
    .replace(/\b(?:https?|file|obsidian|ftp):\/\/\S+/gi, m => m.replace(/:\/\//, ':​//'))
    .replace(/(^|[\s(])#page=(\d+)/gi, (_, pre, n) => pre + cite('', '#page=' + n));
  // 6. Only now the checked jumps go in, so nothing above can touch them.
  return out.replace(/\u0001(\d+)\u0002/g, (_, i) => `(${pageLink(...jumps[+i])})`).replace(/\u0003(\d+)\u0002/g, (_, i) => pageLink(...jumps[+i]))
    .replace(/[\u0001\u0002\u0003]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
// An item's "source" (the AI's answer for a section, point, concept or formula): "P7S3" (also "[P7S3]",
// "Long.pdf#P7S3" or "Long.pdf#page=7&source=P7S3"). Valid only when that paragraph was sent in this batch and
// any file it names is this PDF. Returns its { page, para, id } or null.
export function sourceOf(item, sources = {}, isSelf = () => false) {
  const s = String(item?.source ?? '').trim();
  if (!s) return null;
  let file = '', id = s;
  const q = /[#&?]source=([^&\s]*)/i.exec(s);
  if (q) { id = q[1]; file = s.split('#')[0]; }
  else { const m = /^(.*?)[#:\s]+\[?\s*(P\d+S\d+)\s*\]?$/i.exec(s); if (m) { file = m[1]; id = m[2]; } }
  const p = parseSourceId(id);
  if (!p || !own(sources, p.id)) return null;
  if (file.trim() && !isSelf(file.trim())) return null;
  return p;
}
// sources: { P7S3: fp, … } of this batch. An item keeps its source (and fp, for the link) only when the source is
// valid and its page agrees with the item's page (or the item gave none); otherwise the source is dropped and the
// item falls back to its page, checked as before (a page this batch did not send becomes 0).
export function checkCitations(r, ok, pageLink = null, isSelf = () => false, sources = {}) {
  const fix = n => (ok.has(n) ? n : 0), clean = s => plainText(s, ok, pageLink, isSelf, sources);
  const at = x => {
    const { source, fp, ...rest } = x; void source; void fp;
    const q = sourceOf(x, sources, isSelf);
    // A page and a source that disagree (page 2, source P3S1): the ID is dropped, the page is checked as usual.
    const agrees = q && (!(+x.page) || +x.page === q.page);
    return agrees && ok.has(q.page) ?{ ...rest, page: q.page, source: q.id, fp: sources[q.id] || '' } : { ...rest, page: fix(x.page) };
  };
  return {
    title: clean(r.title), overview: clean(r.overview),
    sections: (r.sections || []).map(s => ({ ...at(s), heading: clean(s.heading), points: (s.points || []).map(p => ({ ...at(p), text: clean(p.text) })) })),
    concepts: (r.concepts || []).map(c => ({ ...at(c), term: clean(c.term), meaning: clean(c.meaning) })),
    formulas: (r.formulas || []).map(f => ({ ...at(f), meaning: clean(f.meaning) })),
  };
}
// One answer from several batches, in page order; the same concept or formula is kept once. Concepts compare
// without case ("Eigenvalue" = "eigenvalue"); formulas only ignore spacing, since case matters in maths
// (f(x)=x and F(x)=x are different).
export function mergeResults(parts) {
  const seenC = new Set(), seenF = new Set();
  const key = s => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const fkey = s => String(s || '').replace(/\s+/g, '');
  return {
    title: parts.find(r => r.title)?.title || '',
    overview: parts.map(r => r.overview && r.overview.trim()).filter(Boolean).join('\n\n'),
    sections: parts.flatMap(r => r.sections),
    concepts: parts.flatMap(r => r.concepts).filter(c => !seenC.has(key(c.term)) && seenC.add(key(c.term))),
    formulas: parts.flatMap(r => r.formulas).filter(f => !seenF.has(fkey(f.latex)) && seenF.add(fkey(f.latex))),
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
    try { read = await pdfText(src, { only: pages, paras: true, onProgress: (i, n) => { const el = win?.querySelector('.sum-busy'); if (el) el.textContent = t('exam.readingN', { i, n }); } }); }
    catch (e) { if (e.code === 'range') return failed(t('exam.pagesRange', { part: pageRanges(pages), n: total })); throw e; }
    if (stop.signal.aborted) return failed(t('sum.stopped'));
    const agent = AI.isLocal(engine) || engine === AI.CC; // can open the PDF itself (scanned pages too)
    const batches = planBatches(read.pages, { agent });
    if (!batches.length) return failed(t('sum.scanned', { pages: pageRanges(pages) }));
    clearInterval(tick);
    await runBatches({ path, total, dest, engine, profile, body, actions, batches, agent, empty: agent ? [] : read.empty, results: [] });
  } catch (e) {
    if (stop.signal.aborted || e.name === 'AbortError') return failed(t('sum.stopped'));
    failed(t('ai.failedJob', { msg: e.name === 'TimeoutError' ? t('check.timeout') : AI.errorText(e, engine) }));
  } finally { clearInterval(tick); if (pending === stop) pending = null; }
}

// Send the batches one after another. Answers already received are kept: after a failure, Retry carries on from
// the batch that failed. Stop (or closing the window) ends it with nothing written.
async function runBatches(job) {
  const { path, total, dest, engine, profile, body, actions, batches, agent, empty, results } = job;
  const stop = new AbortController(); pending = stop;
  const t0 = Date.now();
  const tick = setInterval(() => { const el = win?.querySelector('.check-elapsed'); if (!el) return clearInterval(tick); el.textContent = Math.round((Date.now() - t0) / 1000) + ' s'; }, 1000);
  const n = batches.length;
  try {
    for (let i = results.length; i < n; i++) {
      const b = batches[i], range = [...b.pages, ...b.open].sort((x, y) => x - y);
      const who = engine === AI.CC ? t('ai.workingCC') : t('ai.working', { model: AI.label(engine, 'summary') });
      body.innerHTML = `<div class="check-busy"><span class="spinner"></span><span class="sum-busy">${esc(who)}</span><span class="check-elapsed muted"></span></div>
        <p class="muted sum-batch" data-batch="${i + 1}" data-batches="${n}">${esc(n > 1 ? t('sum.batch', { i: i + 1, n, pages: pageRanges(range) }) : t('sum.pagesLine', { pages: pageRanges(range) }))}</p>`;
      actions.innerHTML = `<button class="mod-button" data-a="stop">${esc(t('ai.stop'))}</button>`;
      actions.querySelector('[data-a=stop]').onclick = () => stop.abort();
      const hint = (agent ? `<pdf_file>${path}</pdf_file>\n<pages_to_summarize>${pageRanges(range)} of ${total}</pages_to_summarize>\n` : '')
        + (b.open.length ? `<pages_without_text>${pageRanges(b.open)}${agent ? ' — scanned: open these pages from the PDF yourself.' : ''}</pages_without_text>\n` : '')
        + (n > 1 ? `<part>${i + 1} of ${n}: summarize only these pages; the other parts are summarized separately.</part>\n` : '');
      const content = `${hint}<pdf file="${path}">\n${b.text}</pdf>\n<pages_included>${pageRanges(agent ? range : b.pages)} of ${total}</pages_included>`;
      // Claude Code gets the same numbered text in job.sourceText (API models and local frameworks read it in content).
      const r = await AI.request('summary', 'summary', { title: stem(path), content, path, job: { pages: pageRanges(range), total, pdf: path, part: i + 1, parts: n, sourceText: b.text } }, { signal: stop.signal, provider: engine });
      if (!win || stop.signal.aborted) return;
      // Links in the answer's text are rebuilt by Graphite, and only for this PDF and pages this batch sent.
      const link = H.linkNameFor(path);
      const srcs = b.sources || {};
      results.push(checkCitations(r, citable(b, agent), (pg, id = '') => noteLink(link, pg, id, srcs[id] || ''), selfMatcher(path, link), srcs));
    }
    const covered = [...new Set(batches.flatMap(b => [...b.pages, ...(agent ? b.open : [])]))].sort((x, y) => x - y);
    const md = buildNote(path, mergeResults(results), { pages: covered, empty, engine, profile });
    preview({ path, md, dest, body, actions });
  } catch (e) {
    if (!win) return;
    const stopped = stop.signal.aborted || e.name === 'AbortError';
    const msg = stopped ? t('sum.stopped') : t('ai.failedJob', { msg: e.name === 'TimeoutError' ? t('check.timeout') : AI.errorText(e, engine) });
    body.innerHTML = `<p class="mod-error sum-error">${esc(msg)}</p><p class="muted">${esc(t('sum.nothingWritten'))}</p>`
      + (results.length ? `<p class="muted sum-kept">${esc(t('sum.keptParts', { done: results.length, n }))}</p>` : '');
    actions.innerHTML = `${stopped ? '' : `<button class="mod-button mod-cta" data-a="retry">${esc(t('sum.retry'))}</button>`}<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
    actions.querySelector('[data-a=close]').onclick = close;
    actions.querySelector('[data-a=retry]')?.addEventListener('click', () => runBatches(job));
  } finally { clearInterval(tick); if (pending === stop) pending = null; }
}

// A link to a page, or to a paragraph on it: [[Long.pdf#page=7&source=P7S3&fp=0abc123|p. 7 ¶3]] (fp: the paragraph's
// words, so the viewer can tell when the PDF has changed since).
export function noteLink(link, page, source = '', fp = '') {
  const q = source ? parseSourceId(source) : null;
  const id = q && q.page === page ? q.id : '';
  return `[[${link}#${locationHash(page, id, id ? fp : '')}|p. ${page}${id ? ' ¶' + q.para : ''}]]`;
}
// The note, built by Graphite so every page link is real: a page that wasn't read gets no link.
export function buildNote(path, r, { pages, empty = [], engine, profile = {} }) {
  const ok = new Set(pages);
  const link = H.linkNameFor(path);
  const at = x => (x?.page && ok.has(x.page) ? ` (${noteLink(link, x.page, x.source, x.fp)})` : '');
  const L = [];
  L.push(`[[${link}|${fileOf(path)}]] · ${t('sum.pagesLine', { pages: pageRanges(pages) })}`, '');
  if (r.overview) L.push(r.overview.trim(), '');
  if (empty.length) L.push(`> ${t('sum.emptyNote', { pages: pageRanges(empty) })}`, '');
  for (const s of r.sections || []) {
    L.push(`## ${s.heading || t('sum.section')}${at(s)}`, '');
    for (const p of s.points || []) L.push(`- ${p.text.trim()}${at(p)}`);
    L.push('');
  }
  if (r.concepts?.length) {
    L.push(`## ${t('sum.concepts')}`, '');
    for (const c of r.concepts) L.push(`- **${c.term.trim()}**: ${c.meaning.trim()}${at(c)}`);
    L.push('');
  }
  if (r.formulas?.length) {
    L.push(`## ${t('sum.formulas')}`, '');
    for (const f of r.formulas) L.push(`- $${f.latex.trim().replace(/^\$+|\$+$/g, '')}$${f.meaning ? ' — ' + f.meaning.trim() : ''}${at(f)}`);
    L.push('');
  }
  const bodyText = L.join('\n').trim() + '\n';
  const fm = ['---', 'tags: [PDF summary]', `created: ${today()}`, `source: "[[${link}]]"`, `summary-of: "${path.replace(/"/g, "'")}"`, `pages: "${pageRanges(pages)}"`,
    `generated-by: "${AI.executorName(engine, 'summary').replace(/"/g, "'")}"`, `generated-hash: ${fingerprint(bodyText)}`, '---', ''];
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
  // Opening a link from here (the app's own click handler does the opening) sets the window aside first.
  body.querySelector('.sum-preview').addEventListener('click', e => { if (e.target.closest('a.internal-link, [data-open]')) peek(); });
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
