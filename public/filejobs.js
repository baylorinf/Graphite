// Jobs on your files, built into the app (they also work in a new vault without the Graphie chat plugin):
// find new course files on this computer, and file the Claude Inbox captures. The AI chosen for the job in
// Settings → AI does the looking: a local framework (DeepSeek Harness, Codex CLI) or an API model plans it, then
// this window shows the plan with a tick per item; nothing is copied or written until you confirm, and you can
// stop at any point. Claude Code jobs go to the Claude window through the chat plugin, as before.
import { t } from '/i18n.js';
import * as AI from '/ai.js';
import { hash } from '/sync.js';

let H = null;
export function initFileJobs(host) { H = host; }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let win = null;
function close() { win?.ctl?.abort(); win?.el.remove(); win = null; document.removeEventListener('keydown', onKey, true); }
const onKey = e => { if (e.key === 'Escape' && win && !win.busy) { e.preventDefault(); e.stopPropagation(); close(); } };

// Who does it, in words, with the framework's status: "DeepSeek Harness · found · version 0.2.2-rc.1".
function whoLine(v) {
  if (AI.isLocal(v)) { const st = AI.fwStatus(v); return { text: `${AI.LOCAL[v].label} · ${st.text}`, ok: st.ok }; }
  if (v === AI.CC) return { text: 'Claude Code', ok: null };
  return { text: AI.label(v), ok: true };
}

export async function runFileJob(feature, job) {
  close();
  const v = AI.choice(feature);
  if (v === AI.CC) {
    // Claude Code: with the chat plugin, as before (its chat shows the answer). Without it (a new vault, or an
    // old one without the plugin), the job goes into the same task queue the Claude Code window watches, and
    // this window shows the answer; if Claude Code isn't connected, it says how to connect.
    const chat = window.app?.plugins?.getPlugin?.('claude-chat');
    if (job === 'import' && chat?.findFiles) return chat.findFiles();
    if (job === 'inbox' && chat?.fileInbox) return chat.fileInbox();
    return ccJob(job);
  }
  if (v === 'off' || (!AI.isLocal(v) && !AI.PROVIDERS[v])) { H.toast(t('fj.needsChoice')); H.openSettings('ai'); return; }
  await AI.refreshFrameworks();
  const el = document.body.appendChild(document.createElement('div'));
  el.className = 'review-modal ai-tool fj-modal';
  el.innerHTML = `<div class="review-bg"></div><div class="review-box">
    <div class="review-head"><span class="review-title">${esc(t('fj.title.' + job))}</span><span class="review-progress"></span><button class="review-x">×</button></div>
    <div class="review-card scroll fj-body"></div><div class="review-actions fj-actions"></div></div>`;
  win = { el, ctl: new AbortController(), busy: true, v, feature, job };
  el.querySelector('.review-bg').onclick = () => { if (!win?.busy) close(); };
  el.querySelector('.review-x').onclick = () => { if (win?.busy) win.ctl.abort(); else close(); };
  document.addEventListener('keydown', onKey, true);
  await plan();
}

/* ---------- Claude Code through the built-in task queue (no chat plugin needed) ---------- */
const CHAT = '.obsidian/plugins/claude-chat/chat';
const CONNECT_PHRASE = 'connect to Graphite';
async function readText(p) { const r = await fetch('/api/file?path=' + encodeURIComponent(p)); return r.ok ? (await r.json()).content : null; }
function ccWindow(job) {
  const el = document.body.appendChild(document.createElement('div'));
  el.className = 'review-modal ai-tool fj-modal';
  el.innerHTML = `<div class="review-bg"></div><div class="review-box">
    <div class="review-head"><span class="review-title">${esc(t('fj.title.' + job))}</span><span class="review-progress"></span><button class="review-x">×</button></div>
    <div class="review-card scroll fj-body"></div><div class="review-actions fj-actions"></div></div>`;
  win = { el, ctl: new AbortController(), busy: false, v: AI.CC, job };
  el.querySelector('.review-bg').onclick = close; el.querySelector('.review-x').onclick = close;
  document.addEventListener('keydown', onKey, true);
  return { body: el.querySelector('.fj-body'), actions: el.querySelector('.fj-actions') };
}
async function ccJob(job) {
  const { body, actions } = ccWindow(job);
  const who = ok => `<div class="fj-who${ok ? ' is-ok' : ' is-bad'}"><span class="fj-who-k">${esc(t('fj.by'))}</span> Claude Code · ${esc(ok ? t('fw.ccOn') : t('fj.ccOffShort'))}</div>`;
  const on = await AI.ccListening();
  if (!on) {
    // Not connected: say exactly how, and let them check again here (not back to the same choice).
    body.innerHTML = who(false) + `<p>${esc(t('fj.ccHow1'))}</p>
      <div class="fj-phrase"><code>${esc(CONNECT_PHRASE)}</code><button class="mod-button" data-a="copy">${esc(t('fj.copy'))}</button></div>
      <p class="muted">${esc(t('fj.ccHow2'))}</p>`;
    actions.innerHTML = `<button class="mod-button mod-cta" data-a="again">${esc(t('fj.ccAgain'))}</button><button class="mod-button" data-a="settings">${esc(t('fj.otherAi'))}</button><button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
    body.querySelector('[data-a=copy]').onclick = async () => { try { await navigator.clipboard.writeText(CONNECT_PHRASE); } catch { await window.myobsidianDesktop?.copyText?.(CONNECT_PHRASE); } H.toast(t('fj.copied')); };
    actions.querySelector('[data-a=again]').onclick = () => { close(); ccJob(job); };
    actions.querySelector('[data-a=settings]').onclick = () => { close(); H.openSettings('ai'); };
    actions.querySelector('[data-a=close]').onclick = close;
    return;
  }
  // Connected: add the task to the queue the Claude window reads (chat/outbox.jsonl), then wait for its answer.
  const id = 'm-' + new Date().toISOString().replace(/\D/g, '').slice(0, 17) + '-fj';
  const text = job === 'import' ? 'Find new course files on this computer and add them to Graphite.' : 'File my captures into my notes.';
  const msg = { type: 'user', id, at: new Date().toISOString().slice(0, 16).replace('T', ' '), text, ...(job === 'import' ? { task: 'import' } : {}), note: '', study: '', selection: '' };
  try {
    for (let i = 0; ; i++) {
      const cur = await readText(CHAT + '/outbox.jsonl');
      const next = (cur ? cur.replace(/\s*$/, '\n') : '') + JSON.stringify(msg) + '\n';
      const res = await fetch('/api/file?path=' + encodeURIComponent(CHAT + '/outbox.jsonl'), { method: 'PUT', headers: { 'X-Vault': '1', ...(cur != null ? { 'X-Base-Hash': hash(cur) } : {}) }, body: next });
      if (res.ok) break;
      if (res.status !== 409 || i > 4) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
    }
  } catch (e) { body.innerHTML = who(true) + `<p class="mod-error">${esc(t('fj.ccSendFailed', { msg: e.message }))}</p>`; actions.innerHTML = `<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`; actions.querySelector('[data-a=close]').onclick = close; return; }
  body.innerHTML = who(true) + `<div class="check-busy"><span class="spinner"></span><span>${esc(t('fj.ccSent'))}</span><span class="check-elapsed muted"></span></div><p class="muted">${esc(t('fj.ccWhere'))}</p>`;
  actions.innerHTML = `<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=close]').onclick = close;
  const mine = win, t0 = Date.now();
  while (win === mine) {
    const e = mine.el.querySelector('.check-elapsed'); if (e) e.textContent = Math.round((Date.now() - t0) / 1000) + ' s';
    const reply = await readText(`${CHAT}/replies/${id}.md`);
    if (reply != null) {
      body.innerHTML = who(true) + '<div class="markdown fj-reply"></div>';
      H.renderInto(body.querySelector('.fj-reply'), reply, '', 1);
      await H.sync?.().catch(() => {});
      return;
    }
    if (Date.now() - t0 > 30 * 60 * 1000) return;
    await new Promise(r => setTimeout(r, 2000));
  }
}

function header(extra = '') {
  const w = whoLine(win.v);
  return `<div class="fj-who${w.ok === false ? ' is-bad' : w.ok ? ' is-ok' : ''}"><span class="fj-who-k">${esc(t('fj.by'))}</span> ${esc(w.text)}</div>${extra}`;
}
function working(title) {
  const body = win.el.querySelector('.fj-body'), actions = win.el.querySelector('.fj-actions');
  win.busy = true; win.steps = [];
  body.innerHTML = header(`<div class="check-busy"><span class="spinner"></span><span>${esc(title)}</span><span class="check-elapsed muted"></span></div><ul class="fj-steps"></ul>`);
  actions.innerHTML = `<button class="mod-button" data-a="stop">${esc(t('ai.stop'))}</button>`;
  actions.querySelector('[data-a=stop]').onclick = () => win?.ctl.abort();
  const t0 = Date.now();
  const tick = setInterval(() => { const e = win?.el.querySelector('.check-elapsed'); if (!e) return clearInterval(tick); e.textContent = Math.round((Date.now() - t0) / 1000) + ' s'; }, 1000);
  return tick;
}
function step(p) {
  const ul = win?.el.querySelector('.fj-steps');
  if (!ul) return;
  const label = p.step === 'framework' ? t('fj.started', { name: p.name, version: p.version || '' })
    : p.step === 'read' ? t('fj.read', { path: p.path }) : p.step === 'list' ? t('fj.list', { path: p.path })
      : p.step === 'tool' ? t('fj.tool', { path: p.path || p.tool }) : p.step === 'scan' ? t('fj.scan', { path: p.path })
        : p.step === 'copy' ? t('fj.copy', { i: p.i, n: p.n, path: p.path }) : p.step === 'write' ? t('fj.write', { path: p.path })
          : p.step === 'think' ? t('fj.think', { n: p.turn }) : '';
  if (!label) return;
  win.steps.push(label);
  ul.innerHTML = win.steps.slice(-8).map(s => `<li>${esc(s)}</li>`).join('');
}
function fail(e) {
  if (!win) return;
  win.busy = false;
  const body = win.el.querySelector('.fj-body'), actions = win.el.querySelector('.fj-actions');
  const msg = e?.name === 'AbortError' ? t('fj.stopped') : AI.errorText(e, win.v);
  body.innerHTML = header(`<p class="mod-error fj-error">${esc(msg)}</p>`);
  actions.innerHTML = `<button class="mod-button" data-a="settings">${esc(t('fj.openSettings'))}</button><button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=settings]').onclick = () => { close(); H.openSettings('ai'); };
  actions.querySelector('[data-a=close]').onclick = close;
}

async function plan() {
  const tick = working(t('fj.planning'));
  let r;
  try { r = await AI.agent(win.feature, win.job, { phase: 'plan' }, { onProgress: step, signal: win.ctl.signal }); }
  catch (e) { clearInterval(tick); return fail(e); }
  clearInterval(tick);
  if (!win) return;
  win.busy = false;
  const body = win.el.querySelector('.fj-body'), actions = win.el.querySelector('.fj-actions');
  if (!r.planId) {
    body.innerHTML = header(`<p>${esc(win.job === 'import' ? t('fj.noneImport') : t('fj.noneInbox'))}</p>`);
    actions.innerHTML = `<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
    actions.querySelector('[data-a=close]').onclick = close;
    return;
  }
  win.plan = r;
  const reads = (r.reads || []).length;
  const items = r.items || [], edits = r.edits || [];
  body.innerHTML = header((AI.isLocal(win.v) ? `<p class="muted fj-reads">${esc(t('fj.reads', { name: AI.LOCAL[win.v].label, n: reads }))}</p>` : '') +
    `<p class="fj-head">${esc(win.job === 'import' ? t('fj.planImport', { n: items.length, total: r.total || items.length }) : t('fj.planInbox', { n: items.length }))}</p>` +
    `<div class="fj-items">${items.map((it, i) => `<label class="fj-item"><input type="checkbox" data-i="${i}" checked><span class="fj-text"><b>${esc(it.name || (it.quote || '').replace(/\s+/g, ' ').slice(0, 80))}</b>
      <span class="muted">→ ${esc(it.dest || it.target || '')}${it.kind === 'convert' ? ' ' + esc(t('fj.pdfCopy')) : ''}</span></span></label>`).join('')}
      ${edits.map((e, i) => `<label class="fj-item"><input type="checkbox" data-e="${i}" checked><span class="fj-text"><b>${esc(e.path)}</b><span class="muted">${esc(e.summary || '')}</span></span></label>`).join('')}</div>` +
    (r.ignore?.length ? `<p class="muted">${esc(t('fj.ignore', { list: r.ignore.map(x => `${x.name} (${x.reason})`).join('; ') }))}</p>` : '') +
    (r.questions?.length ? `<p class="muted">${esc(t('fj.questions'))}</p><ul>${r.questions.map(q => `<li>${esc(q.name)}: ${esc(q.question)}</li>`).join('')}</ul>` : '') +
    `<p class="muted fj-note">${esc(t('fj.confirmNote'))}</p>`);
  actions.innerHTML = `<button class="mod-button mod-cta" data-a="apply">${esc(t('fj.apply'))}</button><button class="mod-button" data-a="cancel">${esc(t('fj.cancel'))}</button>`;
  const count = () => body.querySelectorAll('input[type=checkbox]:checked').length;
  const applyBtn = actions.querySelector('[data-a=apply]');
  const upd = () => { applyBtn.disabled = !count(); applyBtn.textContent = t('fj.applyN', { n: count() }); };
  body.addEventListener('change', upd); upd();
  actions.querySelector('[data-a=cancel]').onclick = close;
  applyBtn.onclick = () => apply([...body.querySelectorAll('[data-i]:checked')].map(x => +x.dataset.i), [...body.querySelectorAll('[data-e]:checked')].map(x => +x.dataset.e));
}

async function apply(accept, acceptEdits) {
  win.ctl = new AbortController();
  const tick = working(t('fj.applying'));
  let r;
  try { r = await AI.agent(win.feature, win.job, { phase: 'apply', planId: win.plan.planId, accept, acceptEdits }, { onProgress: step, signal: win.ctl.signal, provider: win.v }); }
  catch (e) { clearInterval(tick); return fail(e); }
  clearInterval(tick);
  if (!win) return;
  win.busy = false;
  await H.sync?.().catch(() => {});
  const body = win.el.querySelector('.fj-body'), actions = win.el.querySelector('.fj-actions');
  const done = r.done || [], failed = r.failed || [], edited = r.edited || [];
  body.innerHTML = header(`<div class="review-done"><div class="review-done-icon">✔</div><h2>${esc(t('fj.done', { n: done.length }))}</h2></div>
    <ul>${done.map(d => `<li>${esc(d.dest || d.target || d.name || '')}</li>`).join('')}</ul>
    ${edited.length ? `<p class="muted">${esc(t('fj.edited', { list: edited.join(', ') }))}</p>` : ''}
    ${failed.length ? `<p class="mod-error">${esc(t('fj.failed', { list: failed.map(f => `${f.name || f.id}: ${f.error}`).join('; ') }))}</p>` : ''}
    ${r.indexError ? `<p class="mod-error">${esc(AI.errorText({ message: r.indexError }, win.v))}</p>` : ''}`);
  actions.innerHTML = `<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=close]').onclick = close;
}
