// Snip and file: what the selection bar's actions do, for selected text and for screenshots.
//
// - Snip (Alt+S, the scissors in a PDF, or "Snip" on the selection bar): drag a box around anything in the window
//   (a formula, a figure, a table, a study page). The desktop app takes a real screenshot of that box; in a browser,
//   a box on a PDF page is cut from the page. The capture panel then offers:
//     Ask Graphie (the image goes with the question), To Markdown (the AI chosen for "Screenshot to Markdown"
//     writes it out with $maths$, editable), Add to note, Not familiar, Interesting, Card, Mistake book, Copy.
//   Copying PDF text breaks maths; the Markdown from a screenshot doesn't.
// - Add to note / Interesting: a picker shows the note (the one you had open, or "<file> notes") and its sections;
//   the text goes at the end of the section you pick (Interesting as a [!tip] callout), with a link back to the page.
// - Not familiar: Graphie explains it right away in the chat, the capture also goes to Claude Inbox (for the
//   brain), and a card for it comes back in tomorrow's review.
// - Card: a flashcard in a deck (the course folder by default), reviewed with spaced repetition.
import { t } from '/i18n.js';
import * as STUDY from '/study.js';
import * as RV from '/review.js';

let H = null;
export function initSnip(host) { H = host; }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fileName = p => String(p || '').split('/').pop();
const stem = p => fileName(p).replace(/\.[^.]+$/, '');
const dirName = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const desktop = () => window.myobsidianDesktop;
const plugins = () => window.app?.plugins;

// A link back to where it came from: [[LA15.pdf#page=45|LA15 p.45]].
export function sourceLink({ src, page }) {
  if (!src) return '';
  const name = H.linkNameFor(src);
  return page ? `[[${name}#page=${page}|${stem(src)} p.${page}]]` : `[[${name}|${stem(src)}]]`;
}
// The deck a card from this file goes to: its course (the top folder).
export const deckOf = src => (src && src.includes('/') ? src.split('/')[0] : '');

/* =====================================================================
   1. The snip tool
   ===================================================================== */
let snipping = false;
export function startSnip(ctx = {}) {
  if (snipping) return;
  snipping = true;
  const layer = document.body.appendChild(document.createElement('div'));
  layer.className = 'snip-layer';
  layer.innerHTML = `<div class="snip-hint">${esc(t('snip.hint'))}</div><div class="snip-rect" hidden></div>`;
  const rectEl = layer.querySelector('.snip-rect');
  const done = () => { snipping = false; layer.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
  document.addEventListener('keydown', onKey, true);
  let start = null;
  // Scroll what's under the layer (a PDF, a page) while choosing.
  layer.addEventListener('wheel', e => {
    layer.style.pointerEvents = 'none';
    let el = document.elementFromPoint(e.clientX, e.clientY);
    layer.style.pointerEvents = '';
    while (el && !(el.scrollHeight > el.clientHeight + 2 && /auto|scroll/.test(getComputedStyle(el).overflowY))) el = el.parentElement;
    if (el) el.scrollTop += e.deltaY;
  }, { passive: true });
  layer.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    start = { x: e.clientX, y: e.clientY };
    layer.setPointerCapture(e.pointerId);
    rectEl.hidden = false;
    Object.assign(rectEl.style, { left: start.x + 'px', top: start.y + 'px', width: 0, height: 0 });
  });
  layer.addEventListener('pointermove', e => {
    if (!start) return;
    Object.assign(rectEl.style, { left: Math.min(e.clientX, start.x) + 'px', top: Math.min(e.clientY, start.y) + 'px', width: Math.abs(e.clientX - start.x) + 'px', height: Math.abs(e.clientY - start.y) + 'px' });
  });
  layer.addEventListener('pointerup', async e => {
    if (!start) return;
    const box = { left: Math.min(e.clientX, start.x), top: Math.min(e.clientY, start.y), right: Math.max(e.clientX, start.x), bottom: Math.max(e.clientY, start.y) };
    start = null;
    if (box.right - box.left < 8 || box.bottom - box.top < 8) { rectEl.hidden = true; return; }
    done();
    try {
      const cap = await capture(box, ctx);
      if (cap) openPanel(cap);
    } catch (err) { H.toast(t('snip.failed', { msg: err.message || String(err) })); }
  });
}

// Where the box is: the open file and the PDF page under its middle.
function contextAt(box, ctx) {
  const mid = document.elementsFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
  const pageEl = mid.map(x => x.closest?.('.page[data-page-number]')).find(Boolean);
  const src = ctx.src || (H.S.view === 'file' ? H.S.filePath : H.S.view === 'note' ? H.S.current : '') || '';
  return { src, page: ctx.page || (pageEl ? +pageEl.dataset.pageNumber : 0), pageEl };
}
async function capture(box, ctx) {
  const where = contextAt(box, ctx);
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); // the layer is gone from the screen
  let blob = null;
  if (desktop()?.captureRegion) {
    const bytes = await desktop().captureRegion({ x: box.left, y: box.top, width: box.right - box.left, height: box.bottom - box.top });
    blob = new Blob([bytes], { type: 'image/png' });
  } else {
    // Without the desktop app: cut the box out of the PDF page under it.
    const canvas = where.pageEl?.querySelector('canvas');
    if (!canvas) { H.toast(t('snip.noDesktop')); return null; }
    const cr = canvas.getBoundingClientRect(), sx = canvas.width / cr.width, sy = canvas.height / cr.height;
    const x0 = Math.max(0, (box.left - cr.left) * sx), y0 = Math.max(0, (box.top - cr.top) * sy);
    const x1 = Math.min(canvas.width, (box.right - cr.left) * sx), y1 = Math.min(canvas.height, (box.bottom - cr.top) * sy);
    if (x1 - x0 < 4 || y1 - y0 < 4) { H.toast(t('snip.noDesktop')); return null; }
    const out = document.createElement('canvas');
    out.width = Math.round(x1 - x0); out.height = Math.round(y1 - y0);
    const g = out.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
    g.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, out.width, out.height);
    blob = await new Promise(r => out.toBlob(r, 'image/png'));
  }
  // Kept in the vault (hidden folder), so cards and the AI can use it offline.
  const img = `.obsidian/graphite/clips/${stem(where.src || 'snip').replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40)}-p${where.page}-${Date.now().toString(36)}.png`;
  const res = await fetch(`/api/file?path=${encodeURIComponent(img)}`, { method: 'POST', headers: { 'X-Vault': '1' }, body: blob });
  if (!res.ok) throw new Error(res.statusText || String(res.status));
  return { img, blob, src: where.src, page: where.page, box, md: '' };
}

/* =====================================================================
   2. The capture panel
   ===================================================================== */
let panel = null;
export function closePanel() { panel?.remove(); panel = null; document.removeEventListener('keydown', panelKey, true); }
const panelKey = e => { if (e.key === 'Escape' && panel && !document.querySelector('.snip-picker, .review-modal')) { e.preventDefault(); closePanel(); } };
export function openPanel(cap) {
  closePanel();
  panel = document.body.appendChild(document.createElement('div'));
  panel.className = 'snip-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', t('cap.title'));
  const url = URL.createObjectURL(cap.blob);
  const b = (id, label, title, cls = '') => `<button type="button" class="${cls}" data-cap="${id}" title="${esc(title || label)}">${esc(label)}</button>`;
  panel.innerHTML = `<div class="snip-head"><b>${esc(t('cap.title'))}</b><span class="muted">${esc(cap.src ? stem(cap.src) + (cap.page ? ' p.' + cap.page : '') : '')}</span><button class="snip-x" data-cap="close" aria-label="×">×</button></div>
    <img class="snip-img" src="${url}" alt="">
    <div class="snip-md" hidden><textarea rows="5" spellcheck="false" aria-label="${esc(t('cap.edit'))}"></textarea><div class="snip-preview markdown"></div></div>
    <div class="snip-actions">
      ${b('ask', t('sel.ask'), t('sel.askTitle'), 'primary')}${b('text', t('cap.text'), t('cap.textTitle'))}${b('note', t('sel.addNote'), t('sel.addNoteTitle'))}
      <span class="sep"></span>${b('unfamiliar', t('sel.unfamiliar'), t('sel.unfamiliarTitle'))}${b('interesting', t('sel.interesting'), t('sel.interestingTitle'))}
      <span class="sep"></span>${b('card', t('sel.card'), t('sel.cardTitle'))}${b('mistake', t('cap.mistake'))}${b('copy', t('cap.copy'))}
    </div><div class="snip-status muted" role="status"></div>`;
  // Next to the box, inside the window.
  const w = Math.min(460, innerWidth - 24);
  panel.style.width = w + 'px';
  const left = cap.box.right + 12 + w < innerWidth ? cap.box.right + 12 : Math.max(12, cap.box.left - w - 12) ;
  panel.style.left = (left + w > innerWidth - 12 ? Math.max(12, innerWidth - w - 12) : left) + 'px';
  panel.style.top = Math.max(12, Math.min(cap.box.top, innerHeight - 420)) + 'px';
  document.addEventListener('keydown', panelKey, true);
  const ta = panel.querySelector('textarea'), pv = panel.querySelector('.snip-preview'), status = panel.querySelector('.snip-status');
  const draw = () => H.renderInto(pv, ta.value, cap.src || '', 1);
  ta.addEventListener('input', () => { cap.md = ta.value; clearTimeout(ta._t); ta._t = setTimeout(draw, 200); });
  const showMd = md => { cap.md = md; ta.value = md; panel.querySelector('.snip-md').hidden = false; draw(); };
  panel.addEventListener('click', async e => {
    const btn = e.target.closest('[data-cap]');
    if (!btn) return;
    const act = btn.dataset.cap;
    if (act === 'close') return closePanel();
    if (act === 'text') {
      btn.disabled = true; status.textContent = t('cap.working');
      try { showMd(await transcribe(cap)); status.textContent = ''; }
      catch (err) { status.textContent = window.myobsidianAI?.errorText?.(err, window.myobsidianAI?.choice?.('transcribe')) || err.message; }
      finally { btn.disabled = false; }
      return;
    }
    if (act === 'copy') {
      try {
        if (cap.md) { await navigator.clipboard.writeText(cap.md).catch(() => desktop()?.copyText?.(cap.md)); H.toast(t('sel.copied')); }
        else if (desktop()?.copyImage) { await desktop().copyImage(new Uint8Array(await cap.blob.arrayBuffer())); H.toast(t('cap.copiedImg')); }
        else { await navigator.clipboard.write([new ClipboardItem({ 'image/png': cap.blob })]); H.toast(t('cap.copiedImg')); }
      } catch (err) { H.toast(err.message); }
      return;
    }
    const item = { text: cap.md, img: cap.img, src: cap.src, page: cap.page, blob: cap.blob };
    if (act !== 'note' && act !== 'interesting') closePanel();
    run(act, item, btn.getBoundingClientRect()).catch(err => H.toast(err.message || String(err)));
  });
}

// Screenshot → Markdown with $maths$, by the AI chosen for the job.
export async function transcribe(cap) {
  const AI = window.myobsidianAI;
  if (!AI) throw new Error('AI');
  const out = await AI.request('transcribe', 'transcribe', { img: cap.img, title: cap.src ? stem(cap.src) : '', path: cap.img, job: { img: cap.img, files: [cap.img], src: cap.src || '', page: cap.page || 0 } });
  return String(out.markdown || '').trim();
}

/* =====================================================================
   3. The actions (text from the selection bar, or a capture)
   item: { text, img?, src, page }
   ===================================================================== */
export async function run(kind, item, anchor) {
  if (kind === 'ask') return askGraphie(item);
  if (kind === 'unfamiliar') return unfamiliar(item);
  if (kind === 'interesting' || kind === 'note') return pickPlace(item, kind, anchor);
  if (kind === 'card') return STUDY.cardForm({ src: item.src, page: item.page, a: item.text || '', ...(item.img ? { img: item.img, imgSide: 'q' } : {}), deck: deckOf(item.src) });
  if (kind === 'mistake') return STUDY.mistakeForm({ src: item.src, page: item.page, question: item.text || '', ...(item.img ? { img: item.img } : {}) });
}

// The selection Graphie gets: the text (or the Markdown of a screenshot), where the screenshot is, and the page.
function forGraphie(item) {
  const where = item.src ? fileName(item.src) + (item.page ? ` p.${item.page}` : '') : '';
  return [item.text, item.img ? `[${t('cap.title')}: ${item.img}]` : '', where ? '— ' + where : ''].filter(Boolean).join('\n');
}
function askGraphie(item, prompt = '') {
  const cap = plugins()?.getPlugin?.('claude-capture'), chat = plugins()?.getPlugin?.('claude-chat');
  if (!chat) { H.toast(t('cap.noChat')); return false; }
  try { chat.context?.(); } catch { /* older chat plugin */ }
  const text = forGraphie(item);
  if (cap) cap.lastSel = { text, heading: item.page ? `page=${item.page}` : '', at: Date.now() + 1, path: item.src };
  else chat.extSel = { text, page: item.page, at: Date.now() + 1, path: item.src };
  chat.show?.();
  chat.renderChips?.();
  if (prompt && chat.input) { chat.input.value = prompt; return chat.send?.(); }
  setTimeout(() => chat.input?.focus(), 50);
  return true;
}

// Not familiar: explained now, filed for the brain, and back in tomorrow's review.
async function unfamiliar(item) {
  const cap = plugins()?.getPlugin?.('claude-capture');
  const file = window.app?.vault?.getAbstractFileByPath?.(item.src) || null;
  if (cap?.saveCapture && (item.text || item.img)) await cap.saveCapture({ kind: 'unfamiliar', text: item.text || `![[${item.img}]]`, thought: '', file, heading: item.page ? `page=${item.page}` : '' }).catch(() => {});
  RV.addItem({ kind: 'card', src: item.src || '', page: item.page || 0, q: item.text || '', a: t('unf.answer', { link: sourceLink(item) || '' }), deck: deckOf(item.src), tag: 'unfamiliar', ...(item.img ? { img: item.img, imgSide: 'q' } : {}) });
  const asked = await askGraphie(item, t('unf.prompt'));
  H.toast(t(asked === false ? 'unf.doneNoChat' : 'unf.done'));
}

/* ---------- where in which note ---------- */
// Sections of a note: Markdown headings, and the "1. Title。" numbered sections many study notes use.
export function sectionsOf(text) {
  const lines = String(text).split('\n'), out = [];
  let fence = null;
  lines.forEach((l, i) => {
    const f = l.match(/^\s*(```|~~~)/);
    if (f) fence = fence ? (l.trim().startsWith(fence) ? null : fence) : f[1];
    if (fence) return;
    const h = l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) out.push({ line: i, level: h[1].length, title: h[2] });
    else if (/^\d+\.\s+\S/.test(l) && /[。.:：]\s*$/.test(l) && l.length < 80) out.push({ line: i, level: 2, title: l.replace(/[。.:：]\s*$/, ''), numbered: true });
  });
  return out;
}
// Put a block at the end of a section (before the next section of the same or a higher level), or at the end.
export function insertInSection(text, section, block) {
  const lines = String(text).replace(/\s*$/, '').split('\n');
  if (!section) return (lines.join('\n') ? lines.join('\n') + '\n\n' : '') + block + '\n';
  const all = sectionsOf(text);
  const next = all.find(s => s.line > section.line && (section.numbered ? s.numbered || s.level <= 1 : s.level <= section.level));
  let at = next ? next.line : lines.length;
  while (at > section.line + 1 && !lines[at - 1].trim()) at--;
  lines.splice(at, 0, '', block, ...(next ? [''] : []));
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';
}
async function blockFor(item, kind) {
  const link = sourceLink(item);
  let body = item.text || '';
  if (!body && item.img) {
    // A screenshot that wasn't turned into text goes in as an image (copied next to the notes: attachments/).
    const r = await H.api('POST', 'upload', { path: 'attachments/' + fileName(item.img) }, item.blob || await (await fetch('/vault/' + item.img.split('/').map(encodeURIComponent).join('/'))).blob());
    H.S.files.set(r.path, { path: r.path, mtime: r.mtime, size: r.size });
    body = `![[${H.linkNameFor(r.path)}]]`;
  }
  const quoted = body.split('\n').map(l => ('> ' + l).trimEnd()).join('\n');
  if (kind === 'interesting') return `> [!tip] ${t('sel.interesting')}\n${quoted}${link ? '\n> — ' + link : ''}`;
  return item.img && item.text ? `${body}\n\n— ${link}` : `${quoted}${link ? '\n> — ' + link : ''}`;
}
// The note it goes to first: the note you had open before this file, the last one used for this file, or a new
// "<file> notes" next to it.
function defaultTarget(src) {
  const last = H.store.get('snipTarget', {})[src || ''];
  if (last && H.S.files.has(last)) return last;
  if (H.S.current && H.S.files.has(H.S.current) && H.S.current !== src) return H.S.current;
  const base = src ? stem(src) : t('cap.title');
  return (src ? dirName(src) + '/' : '') + `${base} ${t('sel.notesSuffix')}.md`;
}
let picker = null;
export function closePicker() { picker?.remove(); picker = null; }
export async function pickPlace(item, kind, anchor) {
  closePicker();
  let target = defaultTarget(item.src);
  picker = document.body.appendChild(document.createElement('div'));
  picker.className = 'snip-picker';
  picker.setAttribute('role', 'dialog');
  const notes = () => [...H.S.files.keys()].filter(p => /\.md$/i.test(p) && !p.startsWith('.'));
  const draw = async () => {
    const exists = H.S.files.has(target);
    const text = exists ? await H.readFile(target).catch(() => '') : '';
    const secs = sectionsOf(text);
    const cap = plugins()?.getPlugin?.('claude-capture');
    picker.innerHTML = `<div class="snip-head"><b>${esc(t(kind === 'interesting' ? 'sel.interesting' : 'sel.addNote'))}</b><button class="snip-x" data-pick="close" aria-label="×">×</button></div>
      <input type="search" class="snip-search" placeholder="${esc(t('pick.search'))}" aria-label="${esc(t('pick.search'))}">
      <div class="snip-found" hidden></div>
      <div class="snip-target"><span class="muted">${esc(t('pick.into'))}</span> <b>${esc(fileName(target).replace(/\.md$/i, ''))}</b>${exists ? '' : ` <span class="muted">(${esc(t('pick.new'))})</span>`}</div>
      <div class="snip-sections" role="listbox">${secs.map((s, i) => `<button type="button" role="option" data-sec="${i}" style="padding-inline-start:${0.6 + Math.max(0, s.level - 1) * 0.9}em">${esc(s.title)}</button>`).join('')}
        <button type="button" role="option" data-sec="end" class="snip-end">⤓ ${esc(t('pick.end'))}</button></div>
      ${kind === 'interesting' && cap?.saveCapture ? `<button type="button" class="snip-graphie" data-pick="graphie">${esc(t('pick.graphie'))}</button>` : ''}`;
    picker._secs = secs;
    picker.querySelector('.snip-search').addEventListener('input', e => {
      const q = e.target.value.trim().toLowerCase(), box = picker.querySelector('.snip-found');
      const hits = q ? notes().filter(p => p.toLowerCase().includes(q)).slice(0, 8) : [];
      box.hidden = !hits.length;
      box.innerHTML = hits.map(p => `<button type="button" data-note="${esc(p)}">${esc(p.replace(/\.md$/i, ''))}</button>`).join('');
    });
  };
  await draw();
  const r = anchor || { left: innerWidth / 2 - 160, bottom: innerHeight / 3 };
  picker.style.left = Math.max(8, Math.min(r.left, innerWidth - 340)) + 'px';
  picker.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - 380)) + 'px';
  picker.addEventListener('mousedown', e => { if (!e.target.closest('input')) e.preventDefault(); });
  picker.addEventListener('click', async e => {
    const el = e.target.closest('button');
    if (!el) return;
    if (el.dataset.pick === 'close') return closePicker();
    if (el.dataset.note) { target = el.dataset.note; return draw(); }
    if (el.dataset.pick === 'graphie') {
      const cap = plugins()?.getPlugin?.('claude-capture');
      const file = window.app?.vault?.getAbstractFileByPath?.(item.src) || null;
      await cap.saveCapture({ kind: 'interesting', text: item.text || `![[${item.img}]]`, thought: '', file, heading: item.page ? `page=${item.page}` : '' });
      closePicker(); closePanel();
      return;
    }
    if (el.dataset.sec == null) return;
    const sec = el.dataset.sec === 'end' ? null : picker._secs[+el.dataset.sec];
    try {
      const block = await blockFor(item, kind);
      if (target === H.S.current) await H.saveNow?.();
      const cur = H.S.files.has(target) ? await H.readFile(target) : '';
      await H.writeNote(target, insertInSection(cur, sec, block));
      H.store.set('snipTarget', { ...H.store.get('snipTarget', {}), [item.src || '']: target });
      closePicker(); closePanel();
      H.toast(t('pick.added', { note: fileName(target).replace(/\.md$/i, ''), section: sec ? sec.title : t('pick.end') }));
    } catch (err) { H.toast(err.message || String(err)); }
  });
}
document.addEventListener('mousedown', e => { if (picker && !picker.contains(e.target)) closePicker(); }, true);
