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

// opts.manual: "Scan with Graphite only": no AI at all, whatever is chosen in Settings → AI.
export async function runFileJob(feature, job, opts = {}) {
  close();
  const v = AI.choice(feature);
  const noAi = v === 'off' || (v !== AI.CC && !AI.isLocal(v) && !AI.PROVIDERS[v]);
  if (job === 'import' && (opts.manual || noAi)) {
    // Graphite's own scan needs no AI. With no AI chosen, offer it here instead of only sending you to Settings.
    openWindow(job, v);
    if (opts.manual) return plan({ planning: 'manual' });
    win.busy = false;
    const body = win.el.querySelector('.fj-body'), actions = win.el.querySelector('.fj-actions');
    body.innerHTML = `<p>${esc(t('fj.needsChoice'))}</p><p class="muted">${esc(t('fj.manualHint'))}</p>`;
    actions.innerHTML = `<button class="mod-button mod-cta" data-a="manual">${esc(t('fj.manualScan'))}</button><button class="mod-button" data-a="settings">${esc(t('fj.openSettings'))}</button><button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
    actions.querySelector('[data-a=manual]').onclick = () => plan({ planning: 'manual' });
    actions.querySelector('[data-a=settings]').onclick = () => { close(); H.openSettings('ai'); };
    actions.querySelector('[data-a=close]').onclick = close;
    return;
  }
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
  openWindow(job, v, feature);
  await plan();
}
function openWindow(job, v, feature = job) {
  const el = document.body.appendChild(document.createElement('div'));
  el.className = 'review-modal ai-tool fj-modal';
  el.innerHTML = `<div class="review-bg"></div><div class="review-box">
    <div class="review-head"><span class="review-title">${esc(t('fj.title.' + job))}</span><span class="review-progress"></span><button class="review-x">×</button></div>
    <div class="review-card scroll fj-body"></div><div class="review-actions fj-actions"></div></div>`;
  win = { el, ctl: new AbortController(), busy: true, v, feature, job, gen: 0 };
  el.querySelector('.review-bg').onclick = () => { if (!win?.busy) close(); };
  el.querySelector('.review-x').onclick = () => { if (win?.busy) win.ctl.abort(); else close(); };
  document.addEventListener('keydown', onKey, true);
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
  // Graphite's own scan says so, instead of naming an AI that did nothing.
  if (win.manualRun) return `<div class="fj-who is-ok fj-manual-who"><span class="fj-who-k">${esc(t('fj.by'))}</span> ${esc(t('fj.byGraphite'))}</div>${extra}`;
  const w = whoLine(win.v);
  return `<div class="fj-who${w.ok === false ? ' is-bad' : w.ok ? ' is-ok' : ''}"><span class="fj-who-k">${esc(t('fj.by'))}</span> ${esc(w.text)}</div>${extra}`;
}
// Switch from the AI's planning to Graphite's own scan: the AI's request is stopped, and its late answer (or
// its "stopped" error) is ignored because a newer request now owns the window.
function switchToManual() {
  if (!win) return;
  win.ctl.abort();
  win.ctl = new AbortController();
  plan({ planning: 'manual' });
}
function working(title) {
  const body = win.el.querySelector('.fj-body'), actions = win.el.querySelector('.fj-actions');
  win.busy = true; win.steps = [];
  body.innerHTML = header(`<div class="check-busy"><span class="spinner"></span><span>${esc(title)}</span><span class="check-elapsed muted"></span></div><ul class="fj-steps"></ul>`);
  const offerManual = win.job === 'import' && !win.manualRun && !win.applying;
  actions.innerHTML = `${offerManual ? `<button class="mod-button" data-a="manual">${esc(t('fj.manualScan'))}</button>` : ''}<button class="mod-button" data-a="stop">${esc(t('ai.stop'))}</button>`;
  actions.querySelector('[data-a=manual]')?.addEventListener('click', switchToManual);
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
  // A folder the import could not use: its own page (who refused, which folder, what can be done next).
  // (While planning, without that evidence, the usual error with Graphite's own scan stays.)
  if (win.job === 'import' && (e?.access || e?.recovery || (win.applying && ['agentPermission', 'outside'].includes(e?.code)))) return accessProblem(e);
  const body = win.el.querySelector('.fj-body'), actions = win.el.querySelector('.fj-actions');
  const msg = e?.name === 'AbortError' ? t('fj.stopped') : AI.errorText(e, win.v); // agent() errors are already in words; errorText leaves them as they are
  body.innerHTML = header(`<p class="mod-error fj-error">${esc(msg)}</p>`);
  // Finding course files can always fall back to Graphite's own scan, without the AI.
  const manualBtn = win.job === 'import' ? `<button class="mod-button" data-a="manual">${esc(t('fj.manualScan'))}</button>` : '';
  actions.innerHTML = `${manualBtn}<button class="mod-button" data-a="settings">${esc(t('fj.openSettings'))}</button><button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
  const mb = actions.querySelector('[data-a=manual]');
  if (mb) mb.onclick = switchToManual;
  actions.querySelector('[data-a=settings]').onclick = () => { close(); H.openSettings('ai'); };
  actions.querySelector('[data-a=close]').onclick = close;
}

// Files left out because the same content is already in the vault: each one with the vault file it matches.
function dupesHtml(r, open) {
  const d = (r.duplicates || []).filter(x => x && x.src);
  if (!d.length) return '';
  return `<details class="fj-dupes"${open ? ' open' : ''}><summary>${esc(t('fj.dupes', { n: d.length }))}</summary><ul>${d.map(x =>
    `<li><b>${esc(baseOf(x.src))}</b> ${esc(t('fj.sameAs'))} <span class="fj-match">${esc(x.match || '')}</span><div class="muted fj-src">${esc(x.src)}</div></li>`).join('')}</ul></details>`;
}

// The file name a manual plan keeps (the backend only lets the folder change).
const baseOf = p => String(p || '').split('/').pop();
const folderOf = p => String(p || '').split('/').slice(0, -1).join('/');

// extra: { planning: 'manual' } asks for Graphite's own scan instead of the AI's plan.
async function plan(extra = {}) {
  const asked = extra.planning === 'manual';
  // Each request gets a number; only the newest one may change the window (an AI plan stopped for a manual scan
  // can still answer late, and must not replace the scan's result).
  const me = win, gen = ++me.gen, current = () => win === me && me.gen === gen;
  me.manualRun = asked; me.manualAsked = asked; me.applying = false;
  const tick = working(t('fj.planning'));
  let r;
  try { r = await AI.agent(me.feature, me.job, { phase: 'plan', ...extra }, { onProgress: p => { if (current()) step(p); }, signal: me.ctl.signal, provider: me.v, graphite: asked }); }
  catch (e) { clearInterval(tick); if (current()) fail(e); return; }
  clearInterval(tick);
  if (!current()) return;
  win.busy = false;
  if (r.planMode === 'manual') win.manualRun = true;
  const body = win.el.querySelector('.fj-body'), actions = win.el.querySelector('.fj-actions');
  if (!r.planId) {
    // Nothing new: still say which files were skipped because the same file is already in the vault.
    body.innerHTML = header(`<p>${esc(win.job === 'import' ? t('fj.noneImport') : t('fj.noneInbox'))}</p>${dupesHtml(r, true)}`);
    actions.innerHTML = `<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
    actions.querySelector('[data-a=close]').onclick = close;
    return;
  }
  win.plan = r;
  // A manual plan is Graphite's own scan (the AI could not plan without more access, or you asked for it). It is
  // not an AI suggestion: no "read N files" line, files of unclear course start unticked, every folder is editable.
  const manual = r.planMode === 'manual';
  const items = r.items || [], edits = r.edits || [];
  // An original already in the vault whose PDF preview is still to be made (e.g. after restarting): it keeps its
  // place and course; only the preview is made. Ticked, no "unclear course" tag, no folder to choose again.
  const previewOnly = it => !!it.retryPreviewId;
  const ticked = it => previewOnly(it) || (manual || 'selectedByDefault' in it ? it.selectedByDefault === true : true);
  const fwName = AI.LOCAL[r.planningIssue?.framework]?.label || AI.LOCAL[win.v]?.label || r.planningIssue?.framework || '';
  let intro;
  if (manual) {
    intro = (r.planningIssue ? `<p class="fj-issue">${esc(t('fj.manualOutside', { name: fwName }))}</p>` : '') +
      `<p class="fj-head">${esc(r.planningIssue ? t('fj.manualKept', { total: r.total || items.length }) : t('fj.manualPlain'))}</p>`;
  } else {
    intro = (AI.isLocal(win.v) ? `<p class="muted fj-reads">${esc(t('fj.reads', { name: AI.LOCAL[win.v].label, n: (r.reads || []).length }))}</p>` : '') +
      `<p class="fj-head">${esc(win.job === 'import' ? t('fj.planImport', { n: items.length, total: r.total || items.length }) : t('fj.planInbox', { n: items.length }))}</p>`;
  }
  const folders = [...new Set([...(r.folders || []), ...items.map(it => folderOf(it.dest)).filter(Boolean)])].sort();
  const row = (it, i) => {
    const title = esc(it.name || (it.quote || '').replace(/\s+/g, ' ').slice(0, 80));
    if (previewOnly(it)) {
      return `<div class="fj-item is-preview-only"><input type="checkbox" data-i="${i}" id="fj-i-${i}" checked><span class="fj-text"><label for="fj-i-${i}"><b>${title}</b> <span class="fj-tag is-ok">${esc(t('fj.res.previewOnly'))}</span></label>
        <span class="muted">${esc(t('fj.res.stays', { path: shownPath(it.originalDest || '') }))}</span>${manual ? `<span class="fj-dest"><span class="muted">${esc(t('fj.res.pdfFolder'))}</span><input type="text" class="fj-folder" data-f="${i}" list="fj-folders" spellcheck="false" placeholder="${esc(t('fj.vaultRoot'))}" value="${esc(folderOf(it.dest))}"><span class="muted">/${esc(baseOf(it.dest))}</span></span>` : `<span class="muted">→ ${esc(shownPath(it.dest || ''))}</span>`}</span></div>`;
    }
    const unknown = manual && !it.course;
    const where = manual
      ? `<span class="fj-dest"><span class="muted">${esc(t('fj.folder'))}</span><input type="text" class="fj-folder" data-f="${i}" list="fj-folders" spellcheck="false" placeholder="${esc(t('fj.vaultRoot'))}" title="${esc(t('fj.folderHint'))}" value="${esc(folderOf(it.dest))}"><span class="muted">/${esc(baseOf(it.dest))}${it.kind === 'convert' ? ' ' + esc(t('fj.pdfCopy')) : ''}</span></span>`
      : `<span class="muted">→ ${esc(it.dest || it.target || '')}${it.kind === 'convert' ? ' ' + esc(t('fj.pdfCopy')) : ''}</span>`;
    return `<div class="fj-item${unknown ? ' is-unknown' : ''}"><input type="checkbox" data-i="${i}" id="fj-i-${i}"${ticked(it) ? ' checked' : ''}><span class="fj-text"><label for="fj-i-${i}"><b>${title}</b>${unknown ? ` <span class="fj-tag">${esc(t('fj.unknownCourse'))}</span>` : ''}</label>
      ${manual && it.src ? `<span class="muted fj-src">${esc(it.src)}</span>` : ''}${where}</span></div>`;
  };
  body.innerHTML = header(intro +
    `<div class="fj-items">${items.map(row).join('')}
      ${edits.map((e, i) => `<label class="fj-item"><input type="checkbox" data-e="${i}" checked><span class="fj-text"><b>${esc(e.path)}</b><span class="muted">${esc(e.summary || '')}</span></span></label>`).join('')}</div>` +
    (manual ? `<datalist id="fj-folders">${folders.map(f => `<option value="${esc(f)}">`).join('')}</datalist>` : '') +
    dupesHtml(r, false) +
    (r.ignore?.length ? `<p class="muted">${esc(t('fj.ignore', { list: r.ignore.map(x => `${x.name} (${x.reason})`).join('; ') }))}</p>` : '') +
    (r.questions?.length ? `<p class="muted">${esc(t('fj.questions'))}</p><ul>${r.questions.map(q => `<li>${esc(q.name)}: ${esc(q.question)}</li>`).join('')}</ul>` : '') +
    `<p class="muted fj-note">${esc(t('fj.confirmNote'))}</p><p class="mod-error fj-form-error" hidden></p>`);
  actions.innerHTML = `<button class="mod-button mod-cta" data-a="apply">${esc(t('fj.apply'))}</button><button class="mod-button" data-a="cancel">${esc(t('fj.cancel'))}</button>`;
  const count = () => body.querySelectorAll('input[type=checkbox]:checked').length;
  const applyBtn = actions.querySelector('[data-a=apply]');
  const upd = () => { applyBtn.disabled = !count(); applyBtn.textContent = t('fj.applyN', { n: count() }); };
  body.addEventListener('change', upd); upd();
  actions.querySelector('[data-a=cancel]').onclick = close;
  applyBtn.onclick = () => {
    const accept = [...body.querySelectorAll('[data-i]:checked')].map(x => +x.dataset.i);
    if (!manual) return apply(accept, [...body.querySelectorAll('[data-e]:checked')].map(x => +x.dataset.e));
    // Only folders you changed go to the backend, as "folder/original name" (an empty folder is the vault root,
    // shown as "Vault root"); the backend checks each one.
    const destinations = {}, err = body.querySelector('.fj-form-error');
    for (const i of accept) {
      const it = items[i], raw = String(body.querySelector(`[data-f="${i}"]`)?.value || '').trim().replace(/\\/g, '/');
      if (/(^|\/)\.\.?(\/|$)/.test(raw) || /:/.test(raw)) { err.textContent = t('fj.badFolder', { name: it.name || baseOf(it.dest) }); err.hidden = false; return; }
      const f = raw.replace(/^\/+|\/+$/g, '').replace(/\/{2,}/g, '/');
      if (f !== folderOf(it.dest)) destinations[String(i)] = f ? `${f}/${baseOf(it.dest)}` : baseOf(it.dest);
    }
    err.hidden = true;
    apply(accept, [], { destinations, manual: true });
  };
}

async function apply(accept, acceptEdits, { destinations = null, manual = false } = {}) {
  const me = win, gen = ++me.gen, current = () => win === me && me.gen === gen;
  me.ctl = new AbortController(); me.applying = true;
  const tick = working(t('fj.applying'));
  let r;
  const payload = manual ? { phase: 'apply', planId: me.plan.planId, accept, destinations: destinations || {} } : { phase: 'apply', planId: me.plan.planId, accept, acceptEdits };
  try { r = await AI.agent(me.feature, me.job, payload, { onProgress: p => { if (current()) step(p); }, signal: me.ctl.signal, provider: me.v, graphite: manual && me.manualAsked }); }
  catch (e) { clearInterval(tick); if (current()) fail(e); return; }
  clearInterval(tick);
  if (!current()) return;
  win.busy = false;
  await H.sync?.().catch(() => {});
  if (win.job === 'import') return showImportResult(r);
  const body = win.el.querySelector('.fj-body'), actions = win.el.querySelector('.fj-actions');
  const done = r.done || [], failed = r.failed || [], edited = r.edited || [];
  body.innerHTML = header(`<div class="review-done"><div class="review-done-icon">✔</div><h2>${esc(t('fj.done', { n: done.length }))}</h2></div>
    <ul>${done.map(d => { const p = d.dest || d.target || d.name || ''; return `<li>${esc(p && !p.includes('/') && d.dest ? `${t('fj.vaultRoot')} / ${p}` : p)}</li>`; }).join('')}</ul>
    ${edited.length ? `<p class="muted">${esc(t('fj.edited', { list: edited.join(', ') }))}</p>` : ''}
    ${failed.length ? `<p class="mod-error">${esc(t('fj.failed', { list: failed.map(f => `${f.name || f.id}: ${f.error}`).join('; ') }))}</p>` : ''}
    ${r.indexError ? `<p class="mod-error">${esc(AI.errorText({ message: r.indexError }, win.v))}</p>` : ''}`);
  actions.innerHTML = `<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=close]').onclick = close;
}

/* ---------- the import's result, file by file ---------- */
// Each original counts once. An original that is in the vault but whose PDF preview could not be made is
// imported (preview to make later), never "lost"; only `failed` means a file was not imported.
const isPath = s => /^(?:[a-z]:[\\/]|\\\\|\/)/i.test(s);
// A short, readable reason: the first line, without long paths or broken characters; the full text stays in a
// "Details" fold when it says more.
function shortReason(s) {
  const text = String(s || '').replace(/\r/g, '');
  const first = text.split('\n').map(x => x.trim()).find(Boolean) || '';
  const clean = first.replace(/(?:[A-Za-z]:[\\/]|\\\\|\/)(?:[^\s"'<>|]*[\\/])+([^\s"'<>|\\/]+)/g, '$1').replace(/[�\u0000-\u0008\u000B\u000C\u000E-\u001F]+/g, '').replace(/\s{2,}/g, ' ').trim();
  return clean.length > 140 ? clean.slice(0, 137).trimEnd() + '…' : clean;
}
function reasonHtml(full) {
  const s = shortReason(full);
  const more = String(full || '').trim();
  return `<span class="fj-reason">${esc(s)}</span>${more && more !== s ? `<details class="fj-diag"><summary>${esc(t('fj.res.details'))}</summary><pre>${esc(more)}</pre></details>` : ''}`;
}
const shownPath = p => (p && !p.includes('/') ? `${t('fj.vaultRoot')} / ${p}` : p || '');
function showImportResult(r) {
  if (!win) return;
  const me = win;
  me.result = r;
  const body = me.el.querySelector('.fj-body'), actions = me.el.querySelector('.fj-actions');
  const done = r.done || [], failed = r.failed || [];
  const pending = done.filter(d => d.preview?.status === 'failed');
  const total = done.length + failed.length;
  const state = !failed.length && !pending.length ? 'ok' : done.length ? 'partial' : 'none';
  const icon = { ok: '✔', partial: '⚠', none: '✗' }[state];
  const title = state === 'ok' ? t('fj.done', { n: done.length }) : state === 'partial' ? t('fj.res.partial', { n: done.length, total }) : t('fj.res.none', { total });
  const lines = [];
  if (pending.length) lines.push(t('fj.res.previewsLeft', { n: pending.length }));
  if (failed.length && done.length) lines.push(t('fj.res.notImported', { n: failed.length }));
  // indexError repeats per-file reasons (missing previews): show only what is new.
  const reasons = [...pending.map(d => d.preview?.reason || ''), ...failed.map(f => f.error || '')].filter(Boolean);
  const extraNote = String(r.indexError || '').split('\n').map(x => x.trim()).filter(x => x && !reasons.some(rs => rs.includes(x) || x.includes(rs)) && !pending.some(d => x.includes(d.name || baseOf(d.originalDest || d.dest))));
  const imported = done.map(d => {
    const p = d.originalDest || d.dest || d.target || d.name || '';
    const pend = d.preview?.status === 'failed';
    const ready = d.preview?.status === 'ready' && d.preview.dest && d.preview.dest !== p ? ` <span class="muted">→ ${esc(shownPath(d.preview.dest))}</span>` : '';
    return `<li class="fj-res-row${pend ? ' is-pending' : ''}"><span class="fj-res-name">${esc(shownPath(p))}</span>${ready}${pend ? `<div class="fj-res-tag">${esc(t('fj.res.previewPending'))}</div>${reasonHtml(d.preview.reason || d.preview.code || '')}${d.preview.retryId ? `<button class="mod-button fj-retry-one" data-retry-one="${esc(d.preview.retryId)}">${esc(t('fj.res.retryOne'))}</button>` : ''}` : ''}</li>`;
  }).join('');
  const notDone = failed.map(f => `<li class="fj-res-row is-failed"><span class="fj-res-name">${esc(f.name || baseOf(f.src) || f.id || '')}</span><div class="fj-res-tag">${esc(t('fj.res.notImportedTag'))}</div>${reasonHtml(f.error || '')}</li>`).join('');
  body.innerHTML = header(`<div class="fj-res-head is-${state}${state === 'ok' ? ' review-done' : ''}" role="status"><div class="fj-res-icon">${icon}</div><div><h2>${esc(title)}</h2>${lines.map(l => `<p>${esc(l)}</p>`).join('')}</div></div>
    ${done.length ? `<h3 class="fj-res-h">${esc(t('fj.res.importedH', { n: done.length }))}</h3><ul class="fj-res-list fj-res-imported">${imported}</ul>` : ''}
    ${failed.length ? `<h3 class="fj-res-h">${esc(t('fj.res.failedH', { n: failed.length }))}</h3><ul class="fj-res-list fj-res-failed">${notDone}</ul>` : ''}
    ${(r.edited || []).length ? `<p class="muted">${esc(t('fj.edited', { list: r.edited.join(', ') }))}</p>` : ''}
    ${extraNote.length ? `<p class="muted fj-res-note">${esc(extraNote.join(' '))}</p>` : ''}
    <p class="mod-error fj-res-error" role="alert" hidden></p>`);
  const retryN = r.retry?.count || 0;
  actions.innerHTML = `${pending.length ? `<button class="mod-button mod-cta" data-a="previews">${esc(t('fj.res.retryPreviews', { n: pending.length }))}</button>` : ''}${retryN ? `<button class="mod-button${pending.length ? '' : ' mod-cta'}" data-a="resume">${esc(t('fj.res.retryFiles', { n: retryN }))}</button>` : ''}<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=close]').onclick = close;
  actions.querySelector('[data-a=previews]')?.addEventListener('click', () => retryPreviews(me));
  body.querySelector('.fj-res-imported')?.addEventListener('click', e => { const id = e.target.closest('[data-retry-one]')?.dataset.retryOne; if (id) retryPreviews(me, id); });
  actions.querySelector('[data-a=resume]')?.addEventListener('click', () => resumeFailed(me));
}
function resultError(me, e) {
  const el = me.el.querySelector('.fj-res-error');
  if (el) { el.textContent = e?.name === 'AbortError' ? t('fj.stopped') : AI.errorText(e, me.v); el.hidden = false; }
}
function lockActions(me, busy) {
  me.busy = busy;
  for (const b of me.el.querySelectorAll('.fj-actions button, .fj-retry-one')) b.disabled = busy && b.dataset.a !== 'close';
}
// Make the missing PDF previews of originals already in the vault (nothing is imported again).
async function retryPreviews(me, only = null) {
  if (me.busy || win !== me) return;
  lockActions(me, true);
  const r = me.result, done = [...(r.done || [])];
  let error = null;
  for (let i = 0; i < done.length; i++) {
    const d = done[i];
    if (d.preview?.status !== 'failed' || !d.preview.retryId || (only && d.preview.retryId !== only)) continue;
    try {
      const out = await AI.agent(me.feature, 'import', { phase: 'retryPreview', retryId: d.preview.retryId }, { signal: me.ctl.signal, graphite: true });
      if (out?.done?.[0]) done[i] = out.done[0];
    } catch (e) { error = e; if (e?.name === 'AbortError') break; }
    if (win !== me) return;
  }
  lockActions(me, false);
  await H.sync?.().catch(() => {});
  showImportResult({ ...r, done, indexError: '' });
  if (error) resultError(me, error);
}
// Import again only the files that failed, with the same AI and the folders already confirmed (the server keeps
// them: nothing else is sent, so files that worked are not copied twice and new files are not added).
async function resumeFailed(me) {
  if (me.busy || win !== me || !me.result?.retry?.id) return;
  lockActions(me, true);
  const r = me.result, retry = r.retry;
  try {
    const out = await AI.agent(me.feature, 'import', { phase: 'resumeImport', recoveryId: retry.id },
      { signal: me.ctl.signal, provider: retry.framework || retry.provider, graphite: retry.provider === 'graphite' });
    if (win !== me) return;
    lockActions(me, false);
    await H.sync?.().catch(() => {});
    showImportResult({ ...r, done: [...(r.done || []), ...(out.done || [])], failed: out.failed || [], retry: out.retry || null, indexError: out.indexError || '' });
  } catch (e) {
    if (win !== me) return;
    lockActions(me, false);
    resultError(me, e);
    if (e?.access || e?.recovery) accessProblem(e, me);
  }
}

/* ---------- source folders the local AI may read (desktop app) ---------- */
// The list from the desktop app with three separate states (Graphite allows it; Graphite can list it; whether
// the AI program itself can read it is not verified), "Choose a folder…" (the system picker; cancelling changes
// nothing) and "Revoke" for folders that can be revoked. Used on the import's access page and in Settings.
export function folderPanel(host) {
  const desk = window.myobsidianDesktop?.agentFolders;
  if (!host || !desk) return null;
  if (!host.querySelector('.fj-folder-list')) host.innerHTML = `<h4>${esc(t('fj.acc.foldersH'))}</h4><ul class="fj-folder-list"><li class="muted">${esc(t('fj.loading'))}</li></ul>
    <button class="mod-button" data-a="choose">${esc(t('fj.acc.choose'))}</button><p class="muted fj-acc-scope">${esc(t('fj.acc.scope'))}</p>`;
  const list = host.querySelector('.fj-folder-list');
  let busy = false;
  const draw = res => {
    if (!res?.ok) { list.innerHTML = `<li class="mod-error">${esc(res?.message || t('error'))}</li>`; return; }
    const fs = res.folders || [];
    list.innerHTML = fs.length ? fs.map(f => `<li class="fj-folder" data-id="${esc(f.id)}"><code>${esc(f.path)}</code>
      <span class="fj-chip${f.graphiteAllowed ? ' is-ok' : ''}">${esc(t(f.graphiteAllowed ? 'fj.acc.gYes' : 'fj.acc.gNo'))}</span>
      <span class="fj-chip${f.processReadable ? ' is-ok' : ''}">${esc(t(f.processReadable ? 'fj.acc.pYes' : 'fj.acc.pNo'))}</span>
      <span class="fj-chip">${esc(t(f.agentAccess === 'unverified' || !f.agentAccess ? 'fj.acc.aUnverified' : f.agentAccess === 'readable' ? 'fj.acc.aYes' : 'fj.acc.aNo'))}</span>
      ${f.reason ? `<span class="muted">${esc(f.reason)}</span>` : ''}
      ${f.revocable ? `<button class="mod-button fj-revoke" data-revoke="${esc(f.id)}">${esc(t('fj.acc.revoke'))}</button>` : ''}</li>`).join('') : `<li class="muted">${esc(t('fj.acc.noFolders'))}</li>`;
  };
  const run = async fn => { if (busy) return; busy = true; try { const res = await fn(); if (res && !res.canceled) draw(res); } catch (err) { draw({ ok: false, message: err.message }); } finally { busy = false; } };
  run(() => desk('list'));
  host.querySelector('[data-a=choose]').onclick = () => run(() => desk('choose'));   // cancelled: nothing changes
  list.addEventListener('click', ev => { const id = ev.target.closest('[data-revoke]')?.dataset.revoke; if (id) run(() => desk('revoke', { id })); });
  return { refresh: () => run(() => desk('list')) };
}

/* ---------- a folder the import could not use ---------- */
// Who refused, from what the backend actually saw: Graphite's limits for this job, the operating system, or the
// AI program itself. When the path was only guessed from a command's text, say the check could not confirm it
// (never that the whole disk was read).
function accessKind(e) {
  const a = e?.access || {};
  if (a.source === 'graphite') return a.operation === 'commandPath' ? 'unconfirmed' : 'graphite';
  if (a.source === 'agent' || e?.code === 'agentPermission') return 'agent';
  if (a.source === 'system' || /^(EACCES|EPERM)$/.test(e?.code || '')) return 'system';
  return 'unknown';
}
async function accessProblem(e, me = win) {
  if (!me || win !== me) return;
  me.busy = false; me.accessError = e;
  const body = me.el.querySelector('.fj-body'), actions = me.el.querySelector('.fj-actions');
  const a = e.access || {}, kind = accessKind(e), name = AI.LOCAL[e.framework || me.v]?.label || AI.label(me.v);
  const desk = window.myobsidianDesktop?.agentFolders;
  body.innerHTML = header(`<div class="fj-access" data-kind="${kind}">
    <h3>${esc(t('fj.acc.title'))}</h3>
    <p class="fj-acc-why">${esc(t('fj.acc.' + kind, { name, path: a.path || '' }))}</p>
    ${a.path ? `<p class="fj-acc-path"><span class="muted">${esc(t('fj.acc.pathLabel'))}</span> <code>${esc(a.path)}</code></p>` : ''}
    ${a.driveRoot ? `<p class="fj-acc-root">${esc(t('fj.acc.driveRoot'))}</p>` : ''}
    <p class="muted">${esc(t('fj.acc.purpose'))}</p>
    ${desk ? '<div class="fj-folders"></div>' : ''}
    ${e.recovery ? `<p>${esc(t('fj.acc.canResume', { n: e.recovery.count || 0 }))}</p>` : `<p class="fj-acc-next">${esc(t('fj.acc.noResume'))}</p>`}
    <p class="mod-error fj-res-error" role="alert" hidden></p></div>`);
  const rec = e.recovery;
  actions.innerHTML = (rec ? `<button class="mod-button mod-cta" data-a="resume-fw">${esc(t('fj.acc.resumeFw', { name: AI.LOCAL[rec.framework]?.label || rec.framework || name }))}</button><button class="mod-button" data-a="resume-graphite">${esc(t('fj.acc.resumeGraphite', { n: rec.count || 0 }))}</button>`
    : `<button class="mod-button mod-cta" data-a="rescan">${esc(t('fj.acc.rescan'))}</button>`) + `<button class="mod-button" data-a="close">${esc(t('review.close'))}</button>`;
  actions.querySelector('[data-a=close]').onclick = close;
  actions.querySelector('[data-a=rescan]')?.addEventListener('click', () => { if (!me.busy) { me.ctl = new AbortController(); plan(); } });
  const resume = async graphite => {
    if (me.busy || win !== me) return;
    lockActions(me, true);
    me.ctl = new AbortController();
    const tick = working(t('fj.applying'));
    try {
      const out = await AI.agent(me.feature, 'import', { phase: 'resumeImport', recoveryId: rec.id },
        { signal: me.ctl.signal, provider: graphite ? undefined : rec.framework, graphite });
      clearInterval(tick);
      if (win !== me) return;
      me.busy = false;
      await H.sync?.().catch(() => {});
      showImportResult(out);
    } catch (err) {
      clearInterval(tick);
      if (win !== me) return;
      // The recovery can be used once; a second permission problem brings its own.
      if (err?.access || err?.recovery) return accessProblem(err, me);
      fail(err);
    }
  };
  actions.querySelector('[data-a=resume-fw]')?.addEventListener('click', () => resume(false));
  actions.querySelector('[data-a=resume-graphite]')?.addEventListener('click', () => resume(true));
  if (desk) folderPanel(body.querySelector('.fj-folders'));
}
