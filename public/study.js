// Study tools built on the review system (review.js):
// A. Mistake book: add a problem from an exam analysis (or straight from a PDF page) with where it is, your
//    answer, why it was wrong and when to redo it. It comes back in the daily review on that day: you see the
//    problem, answer it again, then compare with your old answer and rate yourself. "Back to page" opens the paper.
// B. Cards from PDFs: make a card from selected PDF text (question and answer editable, exact file and page kept),
//    or clip a box of a page (formula, figure, scanned page) as an image saved in the vault, reviewable offline.
// C. Revision plans: each day of a plan note gets a Start button that runs that day's cards and mistakes.
//    Progress is saved as you go (stop any time and continue later), missed days can be carried over to
//    today, and the plan note shows the progress as a readable line under each day.
import { t } from '/i18n.js';
import * as RV from '/review.js';

let H = null;
export function initStudy(host) {
  H = host;
  H.studyExtras = reviewPageExtras;
}

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = p => String(p || '').split('/').pop().replace(/\.(md|pdf|docx?|pptx?)$/i, '');
const where = (src, page) => (src ? short(src) + (page ? ` p.${page}` : '') : '');
const enc = p => p.split('/').map(encodeURIComponent).join('/');

/* ---------- a small form window ---------- */
let modal = null;
function closeModal() { modal?.remove(); modal = null; document.removeEventListener('keydown', onKey, true); }
const onKey = e => { if (e.key === 'Escape' && modal) { e.preventDefault(); e.stopPropagation(); closeModal(); } };
function openModal(title, html, cls = '') {
  closeModal();
  modal = document.body.appendChild(document.createElement('div'));
  modal.className = 'review-modal study-modal ' + cls;
  modal.innerHTML = `<div class="review-bg"></div><div class="review-box">
    <div class="review-head"><span class="review-title">${esc(title)}</span><span class="review-progress"></span><button class="review-x" aria-label="${esc(t('review.close'))}">×</button></div>
    <div class="review-card scroll study-body">${html}</div>
    <div class="review-actions study-actions"></div></div>`;
  modal.querySelector('.review-bg').onclick = closeModal;
  modal.querySelector('.review-x').onclick = closeModal;
  document.addEventListener('keydown', onKey, true);
  return { body: modal.querySelector('.study-body'), actions: modal.querySelector('.study-actions') };
}
const field = (label, inner, hint = '') => `<label class="ai-field"><span>${esc(label)}</span>${inner}${hint ? `<small class="muted">${esc(hint)}</small>` : ''}</label>`;
const sourceLine = (src, page) => src ? `<p class="study-source">${esc(t('study.source'))}: <a href="#" class="study-goto" data-path="${esc(src)}" data-page="${page || 0}">${esc(src)}${page ? ' · ' + esc(t('study.page', { n: page })) : ''}</a></p>` : '';
function wireGoto(root) {
  root.querySelectorAll('.study-goto').forEach(a => a.addEventListener('click', e => {
    e.preventDefault();
    const { path, page } = a.dataset;
    closeModal();
    H.openNote(path, { heading: +page ? 'page=' + page : '' });
  }));
}
// Live preview of Markdown (maths, images) under a text box.
function livePreview(textarea, out, from) {
  const draw = () => H.renderInto(out, textarea.value || '', from || '', 1);
  textarea.addEventListener('input', () => { clearTimeout(textarea._pv); textarea._pv = setTimeout(draw, 200); });
  draw();
}

/* =====================================================================
   A. Mistake book
   ===================================================================== */
const REDO = [[1, 'mist.redo1'], [3, 'mist.redo3'], [7, 'mist.redo7'], [14, 'mist.redo14']];
export function mistakeForm(pre = {}, { onSaved } = {}) {
  const { body, actions } = openModal(t(pre.id ? 'mist.editTitle' : 'mist.addTitle'), `
    ${sourceLine(pre.src, pre.page)}
    <div class="study-row">
      ${field(t('mist.no'), `<input data-f="no" value="${esc(pre.no || '')}" placeholder="3 / 2(b)">`)}
      ${field(t('study.pageField'), `<input data-f="page" type="number" min="0" value="${esc(pre.page || '')}">`)}
    </div>
    ${field(t('mist.question'), `<textarea data-f="question" rows="4" placeholder="${esc(t('mist.questionPh'))}">${esc(pre.question || '')}</textarea>`)}
    <div class="study-preview markdown" data-pv="question"></div>
    ${field(t('mist.myAnswer'), `<textarea data-f="myAnswer" rows="3" placeholder="${esc(t('mist.myAnswerPh'))}">${esc(pre.myAnswer || '')}</textarea>`)}
    ${field(t('mist.whyWrong'), `<textarea data-f="mistake" rows="2" placeholder="${esc(t('mist.whyWrongPh'))}">${esc(pre.mistake || '')}</textarea>`)}
    <div class="ai-field"><span>${esc(t('mist.redo'))}</span><div class="study-chips">
      ${REDO.map(([d, k], i) => `<label class="study-chip"><input type="radio" name="redo" value="${d}"${(!pre.id && i === 1) ? ' checked' : ''}><span>${esc(t(k))}</span></label>`).join('')}
      <label class="study-chip"><input type="radio" name="redo" value="date"${pre.id ? ' checked' : ''}><span>${esc(t('mist.onDate'))}</span></label><input type="date" class="study-date" data-f="redoDate" value="${esc(pre.id && RV.dueOf(pre.id) != null ? RV.dateOfDay(RV.dueOf(pre.id)) : '')}">
    </div></div>`, 'study-mistake');
  livePreview(body.querySelector('[data-f=question]'), body.querySelector('[data-pv=question]'), pre.src);
  for (const ev of ['focus', 'input', 'change']) body.querySelector('[data-f=redoDate]').addEventListener(ev, () => { body.querySelector('input[name=redo][value=date]').checked = true; });
  wireGoto(body);
  actions.innerHTML = `<button class="mod-button mod-cta" data-a="save">${esc(t(pre.id ? 'study.save' : 'mist.add'))}</button><button class="mod-button" data-a="cancel">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=cancel]').onclick = closeModal;
  actions.querySelector('[data-a=save]').onclick = () => {
    const v = k => body.querySelector(`[data-f=${k}]`).value.trim();
    if (!v('question') && !pre.img && !pre.src) { H.toast(t('mist.needQuestion')); return; }
    const r = body.querySelector('input[name=redo]:checked')?.value;
    const redo = r === 'date' ? RV.dayFromDate(v('redoDate')) : RV.today() + Number(r || 3);
    if (redo == null) { H.toast(t('mist.needDate')); return; }
    const item = { kind: 'mistake', src: pre.src || '', page: Number(v('page')) || 0, no: v('no'), question: v('question'), myAnswer: v('myAnswer'), mistake: v('mistake'), redo, ...(pre.img ? { img: pre.img } : {}), ...(pre.note ? { note: pre.note } : {}) };
    let id = pre.id;
    if (id) { RV.updateItem(id, item); RV.setDue(id, redo); }
    else id = RV.addItem(item);
    closeModal();
    H.toast(t(pre.id ? 'study.saved' : 'mist.added', { date: RV.dateOfDay(redo) }));
    H.onReviewChange();
    onSaved?.(id);
  };
  setTimeout(() => body.querySelector(pre.question ? '[data-f=myAnswer]' : '[data-f=question]')?.focus(), 30);
}

// ```graphite-problems blocks (written by Exam analysis): a list of problems, each with "+ Mistake book".
function decorateProblems(el, from) {
  for (const code of el.querySelectorAll('pre > code[class*="graphite-problems"]')) {
    let data;
    try { data = JSON.parse(code.textContent); } catch { continue; }
    const list = Array.isArray(data) ? data : data.problems || [];
    const src = data.src || '';
    const box = document.createElement('div');
    box.className = 'study-problems';
    const added = () => new Map(RV.items('mistake').filter(i => i.src === src && i.no).map(i => [i.no, i]));
    const draw = () => {
      const have = added();
      box.innerHTML = `<div class="study-problems-head"><span>${esc(t('mist.problemsN', { n: list.length }))}</span><span class="muted">${esc(t('mist.inBook', { n: list.filter(p => have.has(String(p.no))).length }))}</span></div>` +
        list.map((p, i) => {
          const done = have.get(String(p.no));
          return `<div class="study-problem${p.mistake ? ' has-mistake' : ''}">
            <div class="study-problem-main"><b>${esc(t('mist.problem', { no: p.no || i + 1 }))}</b>${p.topic ? ` <span class="study-tag">${esc(p.topic)}</span>` : ''}${p.page ? ` <a href="#" class="study-goto" data-path="${esc(p.src || src)}" data-page="${p.page}">${esc(t('study.page', { n: p.page }))}</a>` : ''}
              <div class="study-problem-q markdown" data-q="${i}"></div>
              ${p.mistake ? `<div class="study-problem-m">✗ ${esc(p.mistake)}</div>` : ''}</div>
            ${done ? `<span class="study-added">✓ ${esc(t('mist.added0'))}</span>` : `<button class="mod-button" data-add="${i}">+ ${esc(t('mist.book'))}</button>`}
          </div>`;
        }).join('');
      list.forEach((p, i) => { const q = box.querySelector(`[data-q="${i}"]`); if (q) H.renderInto(q, p.question || '', from, 1); });
      box.querySelectorAll('[data-add]').forEach(b => { b.onclick = () => { const p = list[+b.dataset.add]; mistakeForm({ ...p, src: p.src || src, note: from }, { onSaved: draw }); }; });
      wireGoto(box);
    };
    draw();
    code.parentElement.replaceWith(box);
  }
}

/* =====================================================================
   B. Cards from PDFs (text or a clipped image)
   ===================================================================== */
export function cardForm(pre = {}) {
  const imgUrl = pre.img ? '/vault/' + enc(pre.img) : '';
  const { body, actions } = openModal(t(pre.id ? 'pcard.editTitle' : 'pcard.addTitle'), `
    ${sourceLine(pre.src, pre.page)}
    ${field(t('pcard.q'), `<textarea data-f="q" rows="3" placeholder="${esc(t('pcard.qPh'))}">${esc(pre.q || '')}</textarea>`)}
    <div class="study-preview markdown" data-pv="q"></div>
    ${field(t('pcard.a'), `<textarea data-f="a" rows="4" placeholder="${esc(t('pcard.aPh'))}">${esc(pre.a || '')}</textarea>`)}
    <div class="study-preview markdown" data-pv="a"></div>
    ${imgUrl ? `<div class="ai-field"><span>${esc(t('pcard.image'))}</span><img class="study-clip" src="${esc(imgUrl)}" alt="">
      <div class="study-chips"><label class="study-chip"><input type="radio" name="side" value="q"${pre.imgSide !== 'a' ? ' checked' : ''}><span>${esc(t('pcard.onQ'))}</span></label>
      <label class="study-chip"><input type="radio" name="side" value="a"${pre.imgSide === 'a' ? ' checked' : ''}><span>${esc(t('pcard.onA'))}</span></label></div></div>` : ''}`, 'study-card');
  livePreview(body.querySelector('[data-f=q]'), body.querySelector('[data-pv=q]'), pre.src);
  livePreview(body.querySelector('[data-f=a]'), body.querySelector('[data-pv=a]'), pre.src);
  wireGoto(body);
  actions.innerHTML = `<button class="mod-button mod-cta" data-a="save">${esc(t(pre.id ? 'study.save' : 'pcard.add'))}</button>${pre.id ? '' : `<button class="mod-button" data-a="mistake">${esc(t('pcard.asMistake'))}</button>`}<button class="mod-button" data-a="cancel">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=cancel]').onclick = closeModal;
  const vals = () => ({ q: body.querySelector('[data-f=q]').value.trim(), a: body.querySelector('[data-f=a]').value.trim(), side: body.querySelector('input[name=side]:checked')?.value || 'q' });
  actions.querySelector('[data-a=mistake]')?.addEventListener('click', () => { const v = vals(); mistakeForm({ src: pre.src, page: pre.page, question: v.q || v.a, img: pre.img }); });
  actions.querySelector('[data-a=save]').onclick = () => {
    const v = vals();
    if (!v.q && !(pre.img && v.side === 'q')) { H.toast(t('pcard.needQ')); return; }
    if (!v.a && !(pre.img && v.side === 'a')) { H.toast(t('pcard.needA')); return; }
    const item = { kind: 'card', src: pre.src || '', page: pre.page || 0, q: v.q, a: v.a, ...(pre.img ? { img: pre.img, imgSide: v.side } : {}) };
    if (pre.id) RV.updateItem(pre.id, item); else RV.addItem(item);
    closeModal();
    H.toast(t(pre.id ? 'study.saved' : 'pcard.added'));
    H.onReviewChange();
  };
  setTimeout(() => body.querySelector(pre.q ? '[data-f=a]' : '[data-f=q]')?.focus(), 30);
}

// Clip a box of a PDF page: drag over the page; the box is cut from the page as a PNG (at the resolution the
// page is shown, at least 2×) and saved in the vault (.obsidian/graphite/clips), so it works offline.
export function startClip(pdfHost, path, then = 'card') {
  const scroller = pdfHost.querySelector('.pdf-scroll') || pdfHost;
  if (pdfHost.querySelector('.study-clip-layer')) return;
  const layer = document.createElement('div');
  layer.className = 'study-clip-layer';
  layer.innerHTML = `<div class="study-clip-hint">${esc(t('clip.hint'))}</div><div class="study-clip-rect" hidden></div>`;
  // Cover exactly the visible part of the PDF (fixed to the window, so it doesn't depend on the host's layout).
  const area = scroller.getBoundingClientRect();
  Object.assign(layer.style, { position: 'fixed', left: area.left + 'px', top: area.top + 'px', width: area.width + 'px', height: area.height + 'px', inset: 'auto' });
  pdfHost.append(layer);
  const rectEl = layer.querySelector('.study-clip-rect');
  const done = () => { layer.remove(); document.removeEventListener('keydown', esc_, true); };
  const esc_ = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(); } };
  document.addEventListener('keydown', esc_, true);
  let start = null;
  layer.addEventListener('wheel', e => { scroller.scrollTop += e.deltaY; }, { passive: true });
  layer.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const r = layer.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, ox: r.left, oy: r.top };
    layer.setPointerCapture(e.pointerId);
    rectEl.hidden = false;
    Object.assign(rectEl.style, { left: e.clientX - r.left + 'px', top: e.clientY - r.top + 'px', width: 0, height: 0 });
  });
  layer.addEventListener('pointermove', e => {
    if (!start) return;
    Object.assign(rectEl.style, { left: Math.min(e.clientX, start.x) - start.ox + 'px', top: Math.min(e.clientY, start.y) - start.oy + 'px', width: Math.abs(e.clientX - start.x) + 'px', height: Math.abs(e.clientY - start.y) + 'px' });
  });
  layer.addEventListener('pointerup', async e => {
    if (!start) return;
    const box = { left: Math.min(e.clientX, start.x), top: Math.min(e.clientY, start.y), right: Math.max(e.clientX, start.x), bottom: Math.max(e.clientY, start.y) };
    start = null;
    if (box.right - box.left < 8 || box.bottom - box.top < 8) { rectEl.hidden = true; return; }
    // The page under the middle of the box.
    layer.style.pointerEvents = 'none';
    const pageEl = document.elementsFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2).map(x => x.closest?.('.page[data-page-number]')).find(Boolean);
    layer.style.pointerEvents = '';
    const canvas = pageEl?.querySelector('canvas');
    if (!canvas) { H.toast(t('clip.noPage')); return; }
    const cr = canvas.getBoundingClientRect();
    const sx = canvas.width / cr.width, sy = canvas.height / cr.height;
    const x0 = Math.max(0, (box.left - cr.left) * sx), y0 = Math.max(0, (box.top - cr.top) * sy);
    const x1 = Math.min(canvas.width, (box.right - cr.left) * sx), y1 = Math.min(canvas.height, (box.bottom - cr.top) * sy);
    if (x1 - x0 < 4 || y1 - y0 < 4) { H.toast(t('clip.noPage')); return; }
    const out = document.createElement('canvas');
    out.width = Math.round(x1 - x0); out.height = Math.round(y1 - y0);
    const g = out.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, out.width, out.height);
    g.drawImage(canvas, x0, y0, x1 - x0, y1 - y0, 0, 0, out.width, out.height);
    const blob = await new Promise(r => out.toBlob(r, 'image/png'));
    const page = +pageEl.dataset.pageNumber || 0;
    const img = `.obsidian/graphite/clips/${short(path).replace(/[^\p{L}\p{N}_-]+/gu, '-').slice(0, 40)}-p${page}-${Date.now().toString(36)}.png`;
    const res = await fetch(`/api/file?path=${encodeURIComponent(img)}`, { method: 'POST', headers: { 'X-Vault': '1' }, body: blob }).catch(err => ({ ok: false, statusText: err.message }));
    if (!res.ok) { H.toast(t('clip.failed', { msg: res.statusText || res.status })); return; }
    done();
    if (then === 'mistake') mistakeForm({ src: path, page, img });
    else cardForm({ src: path, page, img, imgSide: 'q' });
  });
}

/* =====================================================================
   C. Revision plans: Start / Continue each day, carry over missed days
   ===================================================================== */
const PROGRESS_RE = /^> \[!progress\]/;
const isPlan = (path, text) => /(^|\/)复习计划 Review Plans\//.test(path) || /^---[\s\S]*?\ntags:.*(Revision plan|复习计划)[\s\S]*?\n---/m.test(text.slice(0, 600));
// The plan's "## ..." days, with the notes / PDFs each one links and its date (if it names one).
function planDays(path, text) {
  const lines = text.split('\n'), days = [];
  let fence = null, cur = null;
  lines.forEach((l, i) => {
    const f = l.match(/^\s*(```|~~~)/);
    if (f) { fence = fence ? (l.trim().startsWith(fence) ? null : fence) : f[1]; }
    if (fence) return;
    const h = l.match(/^(#{1,2})\s+(.+?)\s*#*\s*$/);
    if (h) { cur = h[1] === '##' ? { key: h[2].trim(), line: i, links: new Set(), date: RV.dayFromDate(h[2]) } : null; if (cur) days.push(cur); return; }
    if (!cur) return;
    for (const m of l.matchAll(/!?\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g)) { const p = H.resolve(m[1].trim(), path); if (p) cur.links.add(p); }
  });
  return days.map(d => ({ ...d, links: [...d.links] })).filter(d => d.links.length);
}
function remaining(plan, d) {
  const rec = RV.planRecord(plan, d.key);
  if (rec?.carriedTo) return 0;
  return rec ? rec.ids.filter(id => !rec.done.includes(id)).length : RV.planDayIds(d.links).length;
}
// Write the progress under each started day of the plan note, as a line anyone can read in the Markdown.
async function writeProgress(plan) {
  const text = H.getNoteText(plan);
  const lines = text.split('\n');
  const days = planDays(plan, text);
  let changed = false;
  for (const d of [...days].reverse()) { // bottom up, so line numbers stay right
    const rec = RV.planRecord(plan, d.key);
    if (!rec) continue;
    const p = RV.planProgress(plan, d.key, d.links);
    const line = `> [!progress] ${rec.carriedTo ? t('plan.progressCarried', { done: p.done, total: p.total, to: rec.carriedTo }) : t('plan.progressLine', { done: p.done, total: p.total, date: RV.dateOfDay(RV.today()) })}`;
    const at = d.line + 1;
    if (PROGRESS_RE.test(lines[at] || '')) { if (lines[at].replace(/ · \d{4}-\d\d-\d\d.*$/, '') !== line.replace(/ · \d{4}-\d\d-\d\d.*$/, '')) { lines[at] = line; changed = true; } }
    else { lines.splice(at, 0, line); changed = true; }
  }
  if (changed) await H.writeNote(plan, lines.join('\n'));
}
function decoratePlan(el, from) {
  const text = H.getNoteText(from);
  if (!isPlan(from, text)) return;
  const days = planDays(from, text);
  if (!days.length) return;
  const heads = [...el.querySelectorAll('h2')];
  const today = RV.today();
  // Which day is "today": the one dated today, else the first day with a later date, else the first not done.
  const todayDay = days.find(d => d.date === today) || days.find(d => d.date != null && d.date > today) || null;
  for (const d of days) {
    const h = heads.find(x => x.textContent.trim() === d.key.replace(/[*_`]/g, '').trim()) || null;
    if (!h || h.querySelector('.study-plan-btns')) continue;
    const p = RV.planProgress(from, d.key, d.links);
    const left = remaining(from, d);
    const rec = RV.planRecord(from, d.key);
    const span = document.createElement('span');
    span.className = 'study-plan-btns';
    const label = rec?.carriedTo ? t('plan.carriedTo', { to: rec.carriedTo })
      : !p.total ? t('plan.dayEmptyShort')
        : !left ? '✓ ' + t('plan.done', { n: p.total })
          : p.done ? t('plan.continue', { done: p.done, total: p.total }) : t('plan.start', { n: p.total });
    span.innerHTML = `<button class="mod-button study-plan-start${left && !rec?.carriedTo ? ' mod-cta' : ''}"${!left || rec?.carriedTo ? ' disabled' : ''}>${esc(label)}</button>`;
    if (d === todayDay) {
      // Earlier days (by date, or listed above this one) with work left: offer to bring it into today.
      const earlier = days.filter(x => x !== d && (x.date != null && d.date != null ? x.date < d.date : days.indexOf(x) < days.indexOf(d)));
      const missed = earlier.filter(x => remaining(from, x) > 0);
      const n = missed.reduce((a, x) => a + remaining(from, x), 0);
      if (n) span.insertAdjacentHTML('beforeend', `<button class="mod-button study-plan-carry" title="${esc(t('plan.carryTitle', { days: missed.map(x => x.key).join(', ') }))}">${esc(t('plan.carry', { n }))}</button>`);
      span.querySelector('.study-plan-carry')?.addEventListener('click', async e => {
        e.preventDefault(); e.stopPropagation();
        for (const x of missed) RV.ensurePlanDay(from, x.key, x.links);
        const moved = RV.carryOver(from, missed.map(x => x.key), d.key, d.links);
        await writeProgress(from);
        H.toast(t('plan.carried', { n: moved, day: d.key }));
        H.rerender();
      });
    }
    span.querySelector('.study-plan-start').addEventListener('click', async e => {
      e.preventDefault(); e.stopPropagation();
      await RV.startPlanDay(from, d.key, { title: `${short(from)} · ${d.key}`, links: d.links, onClose: async () => { await writeProgress(from).catch(err => H.toast(err.message)); H.rerender(); } });
    });
    h.append(span);
  }
}

/* ---------- Review page: the mistake book and cards from PDFs ---------- */
function reviewPageExtras(page) {
  if (!page) return;
  const mistakes = RV.items('mistake').sort((a, b) => (RV.dueOf(a.id) ?? 0) - (RV.dueOf(b.id) ?? 0));
  const cards = RV.items('card').sort((a, b) => String(b.created).localeCompare(String(a.created)));
  const today = RV.today();
  const dueM = mistakes.filter(m => (RV.dueOf(m.id) ?? today) <= today);
  const sec = document.createElement('section');
  sec.className = 'study-book';
  const dueText = id => { const d = RV.dueOf(id); return d == null ? '' : d <= today ? t('mist.dueNow') : t('mist.dueOn', { date: RV.dateOfDay(d) }); };
  const row = (i, kind) => `<div class="review-note study-item" data-id="${esc(i.id)}">
      <span class="study-item-main"><b>${esc(kind === 'mistake' ? (i.no ? t('mist.problem', { no: i.no }) : t('mist.kind')) : t('pcard.kind'))}</b>
        <span class="study-item-text">${esc(((kind === 'mistake' ? i.question : i.q) || (i.img ? '🖼 ' + t('pcard.image') : '')).replace(/\s+/g, ' ').slice(0, 90))}</span></span>
      ${i.src ? `<a href="#" class="study-goto muted" data-path="${esc(i.src)}" data-page="${i.page || 0}">${esc(where(i.src, i.page))}</a>` : ''}
      ${kind === 'mistake' ? `<span class="muted">${esc(dueText(i.id))}${i.attempts?.length ? ' · ' + esc(t('mist.attempts', { n: i.attempts.length })) : ''}</span>` : ''}
      <button class="mod-button" data-act="do">${esc(t(kind === 'mistake' ? 'mist.redoNow' : 'pcard.reviewNow'))}</button>
      <button class="clickable-icon" data-act="edit" title="${esc(t('study.edit'))}">✎</button>
      <button class="clickable-icon" data-act="del" title="${esc(t('study.delete'))}">🗑</button>
    </div>`;
  const MAX = 8;
  sec.innerHTML = `<h2>${esc(t('mist.bookTitle'))} <span class="muted">${mistakes.length}</span></h2>
    ${mistakes.length ? `<div class="review-start"><button class="mod-button mod-cta" data-due ${dueM.length ? '' : 'disabled'}>${esc(dueM.length ? t('mist.startDue', { n: dueM.length }) : t('mist.noneDue'))}</button></div>
      ${mistakes.slice(0, MAX).map(i => row(i, 'mistake')).join('')}${mistakes.length > MAX ? `<p class="muted">${esc(t('study.more', { n: mistakes.length - MAX }))}</p>` : ''}`
      : `<p class="empty-hint">${esc(t('mist.empty'))}</p>`}
    <h2>${esc(t('pcard.listTitle'))} <span class="muted">${cards.length}</span></h2>
    ${cards.length ? cards.slice(0, MAX).map(i => row(i, 'card')).join('') + (cards.length > MAX ? `<p class="muted">${esc(t('study.more', { n: cards.length - MAX }))}</p>` : '') : `<p class="empty-hint">${esc(t('pcard.empty'))}</p>`}`;
  // Before "How it works".
  const how = page.querySelector('.review-how')?.previousElementSibling;
  if (how) how.before(sec); else page.append(sec);
  const cardOf = id => RV.itemCards().find(c => c.id === id);
  sec.querySelector('[data-due]')?.addEventListener('click', () => RV.startSession(dueM.map(m => cardOf(m.id)).filter(Boolean), { title: t('mist.bookTitle'), onClose: () => H.onReviewChange() }));
  sec.querySelectorAll('.study-item').forEach(r => r.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const it = RV.getItem(r.dataset.id);
    if (!it) return;
    if (b.dataset.act === 'do') { const c = cardOf(it.id); if (c) RV.startSession([c], { title: it.kind === 'mistake' ? t('mist.bookTitle') : t('pcard.listTitle'), onClose: () => H.onReviewChange() }); }
    if (b.dataset.act === 'edit') (it.kind === 'mistake' ? mistakeForm : cardForm)(it, { onSaved: () => H.onReviewChange() });
    if (b.dataset.act === 'del' && confirm(t('study.deleteConfirm'))) { RV.removeItem(it.id); H.onReviewChange(); }
  }));
  wireGoto(sec);
}

/* ---------- hooked into the preview of every note ---------- */
export function decorate(el, from, depth) {
  if (!H || depth > 0 || !from) return;
  try { decorateProblems(el, from); } catch (e) { console.warn(e); }
  try { decoratePlan(el, from); } catch (e) { console.warn(e); }
}
