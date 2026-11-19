// Check: find mistakes in a note and offer corrections you can apply with one click.
// With an AI chosen for Check (Settings → AI, or the menu in the Check window) the note is checked for wrong facts, spelling, grammar and unclear
// writing. Without AI, a basic offline check still finds repeated words, broken links, formatting left
// open and similar slips.
import { t } from '/i18n.js';
import * as AI from '/ai.js';

let H = null;
export function initCheck(host) { H = host; }

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------- basic offline check ---------- */
function lev(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const tmp = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = tmp; }
  }
  return d[b.length];
}
export function basicCheck(text, path) {
  const issues = [];
  // Blank out frontmatter, code and math so nothing inside them is "corrected" (offsets stay the same).
  const masked = text
    .replace(/^---\r?\n[\s\S]*?\r?\n---/, m => m.replace(/[^\n]/g, ' '))
    .replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1.*$/gm, m => m.replace(/[^\n]/g, ' '))
    .replace(/\$\$[\s\S]*?\$\$/g, m => m.replace(/[^\n]/g, ' '))
    .replace(/`[^`\n]*`/g, m => ' '.repeat(m.length))
    .replace(/https?:\/\/\S+/g, m => ' '.repeat(m.length));
  const add = (type, start, quote, suggestion, explanation) => issues.push({ type, start, quote, suggestion, explanation, source: 'basic' });
  let m;
  // Repeated word: "the the"
  const rep = /(?<![\p{L}\p{N}])([\p{L}]{1,30})(\s+)\1(?![\p{L}\p{N}])/giu;
  while ((m = rep.exec(masked))) {
    if (/^\d+$/.test(m[1]) || ['ha', 'na', 'la', 'bye', 'very'].includes(m[1].toLowerCase())) continue;
    add('spelling', m.index, m[0], m[1], t('check.repeated', { word: m[1] }));
  }
  // Missing space after . , ; : ! ? before a new word ("end.Start")
  const sp = /([a-zà-ÿ]{2,})([.,;!?])([A-ZÀ-Þ][a-zà-ÿ]+)/g;
  while ((m = sp.exec(masked))) add('spelling', m.index, m[0], `${m[1]}${m[2]} ${m[3]}`, t('check.spaceAfter', { mark: m[2] }));
  // Double spaces in the middle of a line
  const ds = /(\S) {2,}(?=\S)/g;
  while ((m = ds.exec(masked))) { const line = masked.slice(masked.lastIndexOf('\n', m.index) + 1, masked.indexOf('\n', m.index) >>> 0); if (line.trim().startsWith('|')) continue; add('formatting', m.index, m[0], `${m[1]} `, t('check.doubleSpace')); }
  // Broken links, with the closest existing note suggested
  const names = [...H.S.files.keys()].filter(p => /\.md$/i.test(p)).map(p => p.split('/').pop().replace(/\.md$/i, ''));
  const wl = /(!?)\[\[([^\[\]\n|#]+)([^\[\]\n]*)\]\]/g;
  while ((m = wl.exec(masked))) {
    const name = m[2].trim();
    if (!name || H.resolve(name, path)) continue;
    let best = null, bestD = Infinity;
    for (const n of names) { const d = lev(name, n); if (d < bestD) { bestD = d; best = n; } }
    const close = best && bestD <= Math.max(2, Math.floor(name.length / 4));
    add('links', m.index, m[0], close ? `${m[1]}[[${best}${m[3]}]]` : null, close ? t('check.linkTypo', { name, best }) : t('check.linkMissing', { name }));
  }
  // Formatting left open on a line: odd number of ** or ==
  let off = 0;
  for (const line of masked.split('\n')) {
    for (const [mark, label] of [['**', '**'], ['==', '=='], ['~~', '~~']]) {
      const n = line.split(mark).length - 1;
      if (n % 2 === 1) add('formatting', off + line.indexOf(mark), text.slice(off, off + line.length).trim().slice(0, 80), null, t('check.unclosed', { mark: label }));
    }
    off += line.length + 1;
  }
  // Heading levels skipped (# then ###)
  let last = 0; off = 0;
  for (const line of masked.split('\n')) {
    const h = line.match(/^(#{1,6})\s+\S/);
    if (h) {
      if (last && h[1].length > last + 1) add('structure', off, line.trim(), null, t('check.headingJump', { from: last, to: h[1].length }));
      last = h[1].length;
    }
    off += line.length + 1;
  }
  return issues.sort((a, b) => a.start - b.start);
}

/* ---------- the Check window ---------- */
let win = null, pending = null;
function close() { pending?.abort(); pending = null; win?.remove(); win = null; document.removeEventListener('keydown', onKey, true); }
const onKey = e => { if (e.key === 'Escape' && win) { e.preventDefault(); e.stopPropagation(); close(); } };

export async function checkNote(path) {
  if (!path) return;
  const note = path.split('/').pop().replace(/\.md$/i, '');
  close();
  win = document.body.appendChild(document.createElement('div'));
  win.className = 'review-modal check-modal';
  win.innerHTML = `<div class="review-bg"></div><div class="review-box">
    <div class="review-head"><span class="review-title">${esc(t('check.title', { note }))}</span><span class="review-progress"></span><button class="review-x">×</button></div>
    <div class="check-mode"></div>
    <div class="review-card scroll check-list"><div class="check-busy"><span class="spinner"></span>${esc(t('check.running'))}</div></div>
    <div class="review-actions check-actions"></div></div>`;
  win.querySelector('.review-bg').onclick = close;
  win.querySelector('.review-x').onclick = close;
  document.addEventListener('keydown', onKey, true);

  const text = H.getNoteText(path);
  let issues = basicCheck(text, path), summary = '', usedAI = false, aiError = null;
  const use = AI.choice('check');
  if (use !== 'off') {
    // While waiting: show how long it has taken, and let the user stop and see the basic check instead.
    const stop = new AbortController(), t0 = Date.now();
    const busy = win.querySelector('.check-busy');
    busy.innerHTML = `<span class="spinner"></span><span class="check-busy-text">${esc(t(use === AI.CC ? 'check.thinkingCC' : 'check.thinking'))}</span><span class="check-elapsed muted"></span>`;
    const tick = setInterval(() => {
      if (!win) return clearInterval(tick);
      const s = Math.round((Date.now() - t0) / 1000);
      win.querySelector('.check-elapsed').textContent = `${s} s` + (s >= 20 ? ' · ' + t(use === AI.CC ? 'check.slowCC' : 'check.slow', { model: AI.label(use) }) : '');
    }, 1000);
    win.querySelector('.check-actions').innerHTML = `<button class="mod-button" data-act="stop">${esc(t('check.stop'))}</button>`;
    win.querySelector('[data-act=stop]').onclick = () => stop.abort();
    pending = stop; // closing the window also stops the request
    try {
      const r = await AI.request('check', 'check', { title: note, content: text, path }, { signal: stop.signal }).finally(() => { clearInterval(tick); if (pending === stop) pending = null; });
      usedAI = true;
      summary = r.summary || '';
      // Place each AI finding in the text (it quotes the exact words it wants to change).
      const ai = (r.issues || []).map(i => ({ ...i, start: text.indexOf(i.quote), source: 'ai' })).filter(i => i.quote && i.start >= 0);
      // Basic findings the AI didn't already cover
      issues = [...ai, ...issues.filter(b => !ai.some(a => Math.abs(a.start - b.start) < 3))].sort((a, b) => a.start - b.start);
    } catch (e) {
      aiError = stop.signal.aborted ? t('check.stopped') : e.name === 'TimeoutError' ? t('check.timeout') : e.message;
    }
  }
  if (!win) return; // closed while waiting
  render(path, issues, { usedAI, summary, aiError, use });
}

function render(path, issues, { usedAI, summary, aiError, use }) {
  const mode = win.querySelector('.check-mode');
  const menu = `<select class="check-engine" title="${esc(t('ai.switch'))}">${AI.options('check').map(o =>
    `<option value="${esc(o.value)}"${o.value === use ? ' selected' : ''}${o.ready ? '' : ' disabled'}>${esc(o.label)}</option>`).join('')}</select>`;
  mode.innerHTML = menu + ' ' + (usedAI
    ? (summary ? `<span>${esc(summary)}</span>` : '')
    : `<span class="chip basic">${esc(t('check.basic'))}</span> ${aiError ? `<span class="mod-error">${esc(aiError === t('check.stopped') ? aiError : t('ai.failed', { msg: aiError }))}</span>` : ''}`)
    + ` <a href="#" class="check-setup" title="${esc(t('settings.ai'))}">⚙</a>`;
  mode.querySelector('.check-setup').addEventListener('click', e => { e.preventDefault(); close(); H.openSettings('ai'); });
  mode.querySelector('.check-engine').addEventListener('change', e => { AI.setChoice('check', e.target.value); checkNote(path); });
  const list = win.querySelector('.check-list');
  const open = issues.filter(i => !i.done);
  win.querySelector('.review-progress').textContent = open.length ? t('check.found', { n: open.length }) : '';
  if (!open.length) {
    list.innerHTML = `<div class="review-done"><div class="review-done-icon">✔</div><h2>${esc(t('check.clean'))}</h2><p class="muted">${esc(usedAI ? t('check.cleanAI') : t('check.cleanBasic'))}</p></div>`;
  } else {
    list.innerHTML = open.map((i, k) => `<div class="check-item" data-k="${issues.indexOf(i)}">
      <div class="check-type t-${esc(i.type)}">${esc(t('check.type.' + i.type) || i.type)}</div>
      <div class="check-change">${i.suggestion != null ? `<del>${esc(i.quote)}</del> <span class="arrow">→</span> <ins>${esc(i.suggestion)}</ins>` : `<span class="check-quote">${esc(i.quote)}</span>`}</div>
      <div class="check-why">${esc(i.explanation || '')}</div>
      <div class="check-buttons">
        ${i.suggestion != null ? `<button class="mod-button mod-cta" data-act="apply">${esc(t('check.apply'))}</button>` : ''}
        <button class="mod-button" data-act="show">${esc(t('check.show'))}</button>
        <button class="mod-button" data-act="dismiss">${esc(t('check.dismiss'))}</button>
      </div></div>`).join('');
  }
  const actions = win.querySelector('.check-actions');
  const fixable = open.filter(i => i.suggestion != null);
  actions.innerHTML = `${fixable.length > 1 ? `<button class="mod-button mod-cta" data-act="all">${esc(t('check.applyAll', { n: fixable.length }))}</button>` : ''}
    <button class="mod-button" data-act="close">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-act=close]').onclick = close;
  actions.querySelector('[data-act=all]')?.addEventListener('click', () => {
    // Apply from the end of the note backwards so earlier positions stay correct.
    for (const i of [...fixable].sort((a, b) => b.start - a.start)) if (apply(path, i)) i.done = true;
    render(path, issues, { usedAI, summary, aiError, use });
  });
  list.querySelectorAll('.check-item').forEach(el => {
    const i = issues[+el.dataset.k];
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      if (b.dataset.act === 'apply') { if (apply(path, i)) i.done = true; }
      else if (b.dataset.act === 'dismiss') i.done = true;
      else if (b.dataset.act === 'show') { close(); H.showInEditor(path, i.quote, i.start); return; }
      render(path, issues, { usedAI, summary, aiError, use });
    });
  });
}

// Replace the quoted text with the suggestion in the open note (undo works with Ctrl+Z).
function apply(path, issue) {
  const text = H.getNoteText(path);
  let at = text.slice(issue.start, issue.start + issue.quote.length) === issue.quote ? issue.start : text.indexOf(issue.quote);
  if (at < 0) { H.toast(t('check.moved')); return false; }
  H.replaceInNote(path, at, at + issue.quote.length, issue.suggestion);
  return true;
}
