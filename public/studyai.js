// AI study tools, each using the AI chosen for its job in Settings → AI (Claude Code or an API model):
// - Revision plan: exam name, date and range → a day-by-day plan note, weakest topics first (uses quiz memory).
// - Exam analysis: an exam paper (PDF or note) → a note listing the problems, mistakes, suggestions and a plan.
// - Tidy format: rewrite a note's format to match the other notes in its folder (content unchanged), with a preview.
import { t, getLang } from '/i18n.js';
import * as AI from '/ai.js';
import * as RV from '/review.js';
import { pdfText } from '/pdfview.js';

let H = null;
export function initStudyAI(host) { H = host; }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isMd = p => /\.md$/i.test(p);
const base = p => p.split('/').pop().replace(/\.md$/i, '');
const top = p => (p.includes('/') ? p.split('/')[0] : '');
const day = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
// Folders that hold the app's own pages, not study notes.
const SKIP = /^(Claude Brain|My Brain|我的大脑知识库|Claude Chats|Daily Notes)(\/|$)|(^|\/)\./;
const safeName = s => String(s || '').replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'AI';
const hidden = f => /^---[\s\S]*?\ngraph:\s*hide/m.test((f.content || '').slice(0, 400));

/* ---------- a small window: form → waiting (timer, Stop) → result ---------- */
let win = null, pending = null;
function close() { pending?.abort(); pending = null; win?.remove(); win = null; document.removeEventListener('keydown', onKey, true); }
const onKey = e => { if (e.key === 'Escape' && win) { e.preventDefault(); e.stopPropagation(); close(); } };
function open(title, cls = '') {
  close();
  win = document.body.appendChild(document.createElement('div'));
  win.className = 'review-modal ai-tool ' + cls;
  win.innerHTML = `<div class="review-bg"></div><div class="review-box">
    <div class="review-head"><span class="review-title">${esc(title)}</span><span class="review-progress"></span><button class="review-x">×</button></div>
    <div class="review-card scroll ai-tool-body"></div>
    <div class="review-actions ai-tool-actions"></div></div>`;
  win.querySelector('.review-bg').onclick = close;
  win.querySelector('.review-x').onclick = close;
  document.addEventListener('keydown', onKey, true);
  return { body: win.querySelector('.ai-tool-body'), actions: win.querySelector('.ai-tool-actions') };
}
const engineSelect = job => `<label class="ai-field"><span>${esc(t('ai.usedFor'))}</span><select data-f="engine">${AI.options(job).filter(o => o.value !== 'off')
  .map(o => `<option value="${esc(o.value)}"${o.value === AI.choice(job) ? ' selected' : ''}${o.ready ? '' : ' disabled'}>${esc(o.label)}</option>`).join('')}</select></label>`;

// Run one AI job with a timer and a Stop button. Resolves with the result, or null if stopped / failed (shown in the window).
async function runJob(job, task, payload, { body, actions }) {
  const engine = body.querySelector('[data-f=engine]')?.value || AI.choice(job);
  if (engine !== AI.choice(job)) AI.setChoice(job, engine);
  const stop = new AbortController(), t0 = Date.now();
  pending = stop;
  body.innerHTML = `<div class="check-busy"><span class="spinner"></span><span>${esc(t(engine === AI.CC ? 'ai.workingCC' : 'ai.working', { model: AI.label(engine) }))}</span><span class="check-elapsed muted"></span></div>`;
  actions.innerHTML = `<button class="mod-button" data-a="stop">${esc(t('ai.stop'))}</button>`;
  actions.querySelector('[data-a=stop]').onclick = () => stop.abort();
  const tick = setInterval(() => { const el = win?.querySelector('.check-elapsed'); if (!el) return clearInterval(tick); el.textContent = Math.round((Date.now() - t0) / 1000) + ' s'; }, 1000);
  try {
    return await AI.request(job, task, payload, { signal: stop.signal });
  } catch (e) {
    if (!win) return null;
    const msg = stop.signal.aborted ? t('ai.stopped') : e.name === 'TimeoutError' ? t('check.timeout') : e.message;
    body.innerHTML = `<p class="mod-error">${esc(t('ai.failedJob', { msg }))}</p>`;
    actions.innerHTML = `<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
    actions.querySelector('[data-a=close]').onclick = close;
    return null;
  } finally { clearInterval(tick); if (pending === stop) pending = null; }
}

// Save a generated note into a folder (unique name) and open it.
async function saveNote(folder, title, markdown) {
  const name = safeName(title);
  let path = `${folder ? folder + '/' : ''}${name}.md`, i = 1;
  while (H.S.files.has(path)) path = `${folder ? folder + '/' : ''}${name} ${++i}.md`;
  const f = await H.createFile(path, markdown.trim() + '\n');
  if (f) { close(); await H.openNote(f.path); H.toast(t('ai.savedTo', { path: f.path })); }
}

/* ---------- 1. Revision plan ---------- */
function courseFolders() {
  const out = new Set();
  for (const p of H.S.files.keys()) {
    if (!isMd(p) || SKIP.test(p)) continue;
    const parts = p.split('/');
    if (parts.length > 1) out.add(parts[0]);
    if (parts.length > 2) out.add(parts[0] + '/' + parts[1]);
  }
  return [...out].sort();
}
export function planDialog() {
  const { body, actions } = open(t('plan.title'), 'ai-plan');
  const folders = courseFolders();
  const last = H.store.get('planForm', {}) || {};
  const soon = new Date(Date.now() + 7 * 86400000);
  body.innerHTML = `<p class="muted">${esc(t('plan.intro'))}</p>
    <label class="ai-field"><span>${esc(t('plan.exam'))}</span><input data-f="exam" value="${esc(last.exam || '')}" placeholder="${esc(t('plan.examPh'))}"></label>
    <label class="ai-field"><span>${esc(t('plan.date'))}</span><input type="date" data-f="date" value="${esc(last.date && last.date >= day() ? last.date : day(soon))}" min="${day()}"></label>
    <label class="ai-field"><span>${esc(t('plan.range'))}</span><input data-f="range" value="${esc(last.range || '')}" placeholder="${esc(t('plan.rangePh'))}"></label>
    <div class="ai-field"><span>${esc(t('plan.folders'))}</span><div class="ai-folders">${folders.filter(f => !f.includes('/')).map(f => `
      <details${(last.folders || []).some(x => x === f || x.startsWith(f + '/')) ? ' open' : ''}><summary><label><input type="checkbox" data-folder="${esc(f)}"${(last.folders || []).includes(f) ? ' checked' : ''}> ${esc(f)}</label></summary>
      ${folders.filter(x => x.startsWith(f + '/')).map(x => `<label class="ai-sub"><input type="checkbox" data-folder="${esc(x)}"${(last.folders || []).includes(x) ? ' checked' : ''}> ${esc(x.slice(f.length + 1))}</label>`).join('')}</details>`).join('')}</div></div>
    <label class="ai-field"><span>${esc(t('plan.minutes'))}</span><input type="number" data-f="minutes" min="15" max="600" step="15" value="${esc(last.minutes || 90)}"></label>
    ${engineSelect('plan')}`;
  // Ticking a course ticks everything inside it.
  body.querySelectorAll('[data-folder]').forEach(cb => cb.addEventListener('change', () => {
    if (!cb.dataset.folder.includes('/')) body.querySelectorAll(`[data-folder^="${CSS.escape(cb.dataset.folder)}/"]`).forEach(x => { x.checked = cb.checked; });
  }));
  actions.innerHTML = `<button class="mod-button mod-cta" data-a="go">${esc(t('plan.make'))}</button><button class="mod-button" data-a="cancel">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=cancel]').onclick = close;
  actions.querySelector('[data-a=go]').onclick = async () => {
    const v = k => body.querySelector(`[data-f=${k}]`).value.trim();
    const form = { exam: v('exam') || t('plan.examDefault'), date: v('date'), range: v('range'), minutes: Number(v('minutes')) || 90,
      folders: [...body.querySelectorAll('[data-folder]:checked')].map(x => x.dataset.folder) };
    if (!form.folders.length && !form.range) { H.toast(t('plan.needRange')); return; }
    if (!form.date) { H.toast(t('plan.needDate')); return; }
    H.store.set('planForm', form);
    const inRange = p => !form.folders.length || form.folders.some(f => p === f || p.startsWith(f + '/'));
    const notes = [...H.S.files.values()].filter(f => isMd(f.path) && !SKIP.test(f.path) && inRange(f.path) && !hidden(f));
    const slides = [...H.S.files.keys()].filter(p => /\.pdf$/i.test(p) && !SKIP.test(p) && inRange(p)).map(p => p.split('/').pop());
    if (!notes.length) { H.toast(t('plan.noNotes')); return; }
    const mem = p => { const m = RV.noteMemory(p); return !m || !m.total ? 'no quiz questions' : m.strength == null ? 'not studied yet' : `memory ${Math.round(m.strength * 100)}%${m.due ? `, ${m.due} due` : ''}`; };
    const heads = f => (f.headings || []).map(h => h.text || h).filter(Boolean).slice(0, 8).join('; ');
    const daysLeft = Math.max(0, Math.round((new Date(form.date) - new Date(day())) / 86400000));
    const content = [`Exam: ${form.exam}`, `Today: ${day()}`, `Exam date: ${form.date} (${daysLeft} days from today)`,
      `What is examined: ${form.range || '(the notes below)'}`, `Time per day: ${form.minutes} minutes`, '', 'Notes in range:',
      ...notes.map(f => `- [[${base(f.path)}]] (${f.path.split('/').slice(0, -1).join('/')}) · ${mem(f.path)}${heads(f) ? ' · sections: ' + heads(f) : ''}`),
      ...(slides.length ? ['', 'Slide / PDF files in range: ' + slides.join(', ')] : [])].join('\n');
    const job = { exam: form.exam, date: form.date, today: day(), range: form.range, minutes: form.minutes,
      notes: notes.map(f => f.path), memory: Object.fromEntries(notes.map(f => [f.path, mem(f.path)])) };
    const r = await runJob('plan', 'plan', { title: form.exam, content, job }, { body, actions });
    if (!r || !win) return;
    const courses = [...new Set(notes.map(f => top(f.path)))];
    const folder = (courses.length === 1 && courses[0] ? courses[0] + '/' : '') + '复习计划 Review Plans';
    await saveNote(folder, r.title || `${form.exam} ${t('plan.noteSuffix')}`, r.markdown);
  };
  setTimeout(() => body.querySelector('[data-f=exam]')?.focus(), 30);
}

/* ---------- 2. Exam paper analysis ---------- */
export function examDialog(path = '') {
  const { body, actions } = open(t('exam.title'), 'ai-exam');
  const files = [...H.S.files.keys()].filter(p => (/\.pdf$/i.test(p) || isMd(p)) && !SKIP.test(p)).sort();
  body.innerHTML = `<p class="muted">${esc(t('exam.intro'))}</p>
    <label class="ai-field"><span>${esc(t('exam.file'))}</span><input data-f="file" list="ai-exam-files" value="${esc(path)}" placeholder="${esc(t('exam.filePh'))}"></label>
    <datalist id="ai-exam-files">${files.map(p => `<option value="${esc(p)}">`).join('')}</datalist>
    <label class="ai-field"><span>${esc(t('exam.comment'))}</span><textarea data-f="comment" rows="3" placeholder="${esc(t('exam.commentPh'))}"></textarea></label>
    ${engineSelect('exam')}`;
  actions.innerHTML = `<button class="mod-button mod-cta" data-a="go">${esc(t('exam.analyse'))}</button><button class="mod-button" data-a="cancel">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=cancel]').onclick = close;
  actions.querySelector('[data-a=go]').onclick = async () => {
    const file = body.querySelector('[data-f=file]').value.trim(), comment = body.querySelector('[data-f=comment]').value.trim();
    const engine = body.querySelector('[data-f=engine]').value;
    if (!H.S.files.has(file)) { H.toast(t('exam.pickFile')); return; }
    const course = top(file);
    const noteTitles = [...H.S.files.values()].filter(f => isMd(f.path) && !SKIP.test(f.path) && (!course || top(f.path) === course) && !hidden(f)).map(f => base(f.path));
    let text = '';
    if (engine !== AI.CC) { // API models get the paper as text
      if (/\.pdf$/i.test(file)) {
        body.querySelector('.muted').textContent = t('exam.reading');
        try {
          const { pages } = await pdfText('/vault/' + file.split('/').map(encodeURIComponent).join('/'));
          text = pages.map((p, i) => `--- page ${i + 1} ---\n${p}`).join('\n');
          if (!pages.join('').trim()) { H.toast(t('exam.noText')); body.querySelector('.muted').textContent = t('exam.noText'); return; }
        } catch (e) { H.toast(e.message); return; }
      } else text = H.getNoteText(file);
    }
    const content = `<paper file="${file}">\n${text}\n</paper>\n<student_comment>${comment || '(none)'}</student_comment>\n<their_notes>${noteTitles.join(' | ')}</their_notes>`;
    const r = await runJob('exam', 'exam', { title: base(file.replace(/\.pdf$/i, '')), content, path: file, job: { comment, notes: noteTitles } }, { body, actions });
    if (!r || !win) return;
    await saveNote((course ? course + '/' : '') + '考试分析 Exam Analysis', r.title || `${base(file.replace(/\.pdf$/i, ''))} ${t('exam.noteSuffix')}`, r.markdown);
  };
}

/* ---------- 3. Tidy format ---------- */
// Up to three notes from the same folder (or else the same course) to copy the format from.
function examplesFor(path) {
  const folder = path.split('/').slice(0, -1).join('/'), course = top(path);
  const cands = [...H.S.files.values()].filter(f => isMd(f.path) && f.path !== path && !SKIP.test(f.path) && f.content && !hidden(f));
  const same = cands.filter(f => f.path.split('/').slice(0, -1).join('/') === folder);
  const pool = same.length ? same : cands.filter(f => course && top(f.path) === course);
  return pool.sort((a, b) => (b.mtime || 0) - (a.mtime || 0)).slice(0, 3);
}
export async function tidyFormat(path) {
  if (!path || !isMd(path)) { H.toast(t('ai.openNoteFirst')); return; }
  if (H.S.dirty) await H.saveNow();
  const examples = examplesFor(path);
  if (!examples.length) { H.toast(t('format.noExamples')); return; }
  const ui = open(t('format.title', { note: base(path) }), 'ai-format');
  ui.body.innerHTML = `<p class="muted">${esc(t('format.intro', { notes: examples.map(f => base(f.path)).join('、') }))}</p>${engineSelect('format')}`;
  ui.actions.innerHTML = `<button class="mod-button mod-cta" data-a="go">${esc(t('format.go'))}</button><button class="mod-button" data-a="cancel">${esc(t('review.close'))}</button>`;
  ui.actions.querySelector('[data-a=cancel]').onclick = close;
  ui.actions.querySelector('[data-a=go]').onclick = async () => {
    const before = H.getNoteText(path);
    const content = `<note_to_reformat title="${base(path)}">\n${before}\n</note_to_reformat>\n` +
      examples.map(f => `<example title="${base(f.path)}">\n${f.content.length > 8000 ? f.content.slice(0, 8000) + '\n…' : f.content}\n</example>`).join('\n');
    const r = await runJob('format', 'format', { title: base(path), content, path, job: { examples: examples.map(f => f.path) } }, ui);
    if (!r || !win) return;
    const after = r.markdown.replace(/\s+$/, '') + '\n';
    if (after.trim() === before.trim()) { ui.body.innerHTML = `<div class="review-done"><div class="review-done-icon">✔</div><h2>${esc(t('format.same'))}</h2></div>`; ui.actions.innerHTML = `<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`; ui.actions.querySelector('[data-a=close]').onclick = close; return; }
    // Preview: what changed, then the new note rendered next to the old text.
    ui.body.innerHTML = `${r.changes?.length ? `<ul class="ai-changes">${r.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
      <div class="ai-compare"><div><div class="ai-compare-h">${esc(t('format.before'))}</div><pre class="ai-before"></pre></div>
      <div><div class="ai-compare-h">${esc(t('format.after'))}</div><div class="ai-after markdown"></div></div></div>
      <p class="muted">${esc(t('format.undoHint'))}</p>`;
    ui.body.querySelector('.ai-before').textContent = before;
    H.renderInto(ui.body.querySelector('.ai-after'), after, path);
    ui.actions.innerHTML = `<button class="mod-button mod-cta" data-a="apply">${esc(t('format.apply'))}</button><button class="mod-button" data-a="cancel">${esc(t('review.close'))}</button>`;
    ui.actions.querySelector('[data-a=cancel]').onclick = close;
    ui.actions.querySelector('[data-a=apply]').onclick = async () => {
      if (H.getNoteText(path) !== before) { H.toast(t('format.changedMeanwhile')); return; }
      H.replaceInNote(path, 0, before.length, after);
      close();
      H.toast(t('format.applied'));
    };
  };
}
