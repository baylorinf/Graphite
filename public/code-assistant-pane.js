// The code assistant beside the project editor (code mode). It explains a selection, explains compile errors,
// suggests a change or answers a question, with the AI chosen for "Code assistant" in Settings → AI (an API
// model, a local framework or Claude Code). Before sending it says exactly what goes with the question: the
// current selection, the whole current file as it is in the editor (unsaved changes included), or only the
// question. Nothing else is attached (no notes, no other files). Replies are only text to read: nothing is run
// or written. Each project (workspace) has its own conversation; a reply that arrives after switching projects
// goes to the project that asked, never into the one now open.
import { t, getLang } from '/i18n.js';
import * as AI from '/ai.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const LIMIT = 64000;                 // what /api/code-assistant accepts for an excerpt
const STORE = 'mo:wb:chat:';
const load = key => { try { const v = JSON.parse(localStorage.getItem(STORE + key) || '[]'); return Array.isArray(v) ? v.filter(m => m && typeof m.content === 'string') : []; } catch { return []; } };
const keep = (key, msgs) => { try { localStorage.setItem(STORE + key, JSON.stringify(msgs.filter(m => !m.pending && !m.consent).slice(-40))); } catch { /* storage full or blocked: the chat stays for this session */ } };

// getContext() → { projectKey, projectId, path, selection, fileText, diagnostics }
export function createAssistant(host, { getContext, toast, onRendered }) {
  const convs = new Map();           // project key → messages [{role, content, ctx?, error?, pending?, consent?}]
  let key = null, ctxMode = 'selection', uid = 0;
  const conv = k => { if (!convs.has(k)) convs.set(k, load(k)); return convs.get(k); };

  host.classList.add('wb-assist');
  host.setAttribute('role', 'complementary');
  host.innerHTML = `
    <div class="wa-head"><h2 class="wa-title"></h2><span class="wb-spacer"></span><button type="button" data-wa="clear"></button></div>
    <div class="wa-log" role="log" aria-live="polite"></div>
    <fieldset class="wa-ctx"><legend></legend>
      <label><input type="radio" name="wa-ctx" value="selection" checked> <span data-l="selection"></span></label>
      <label><input type="radio" name="wa-ctx" value="file"> <span data-l="file"></span></label>
      <label><input type="radio" name="wa-ctx" value="question"> <span data-l="question"></span></label>
    </fieldset>
    <p class="wa-will" role="status"></p>
    <div class="wa-actions"><button type="button" data-wa="explain"></button><button type="button" data-wa="diagnose"></button><button type="button" data-wa="suggest"></button></div>
    <textarea class="wa-input" rows="3" spellcheck="false"></textarea>
    <div class="wa-send-row"><span class="wa-engine muted"></span><span class="wb-spacer"></span><button type="button" class="wb-primary" data-wa="send"></button></div>`;
  const $ = s => host.querySelector(s);
  const input = $('.wa-input'), log = $('.wa-log');

  function relabel() {
    host.setAttribute('aria-label', t('wa.title'));
    $('.wa-title').textContent = t('wa.title');
    $('[data-wa=clear]').textContent = t('wa.clear');
    $('.wa-ctx legend').textContent = t('wa.contextLegend');
    for (const el of host.querySelectorAll('[data-l]')) el.textContent = t('wa.ctx.' + el.dataset.l);
    $('[data-wa=explain]').textContent = t('wa.explain'); $('[data-wa=diagnose]').textContent = t('wa.diagnose'); $('[data-wa=suggest]').textContent = t('wa.suggest');
    input.setAttribute('aria-label', t('wa.askLabel')); input.placeholder = t('wa.askPh');
    $('[data-wa=send]').textContent = t('wa.send');
    render();
  }
  // What will go with the question, in words, for the choice made now.
  function willSend() {
    const c = getContext();
    const lines = s => (s ? s.split('\n').length : 0);
    let text;
    if (!c.projectId) text = t('wa.noProject');
    else if (ctxMode === 'question') text = t('wa.will.question');
    else if (!c.path) text = t('wa.will.noFile');
    else if (ctxMode === 'file') text = c.fileText.length > LIMIT ? t('wa.tooLongFile', { file: c.path }) : t('wa.will.file', { file: c.path, n: lines(c.fileText) });
    else text = c.selection ? (c.selection.length > LIMIT ? t('wa.tooLongSel') : t('wa.will.selection', { file: c.path, n: lines(c.selection) })) : t('wa.will.noSelection', { file: c.path });
    $('.wa-will').textContent = text;
    const choice = AI.choice('code');
    $('.wa-engine').textContent = t('wa.by', { name: AI.label(choice, 'code') });
  }
  function render() {
    const msgs = key ? conv(key) : [];
    log.innerHTML = msgs.length ? msgs.map(m => `<div class="wa-msg is-${m.role}${m.error ? ' is-error' : ''}${m.pending ? ' is-pending' : ''}" data-id="${m.id || ''}">
        ${m.ctx ? `<div class="wa-msg-ctx muted">${esc(m.ctx)}</div>` : ''}<div class="wa-msg-text">${esc(m.content)}</div>
        ${m.consent ? `<button type="button" class="wb-primary" data-consent="${m.id}">${esc(t('wa.codexConsent'))}</button>` : ''}</div>`).join('')
      : `<p class="muted wa-empty">${esc(t('wa.empty'))}</p>`;
    log.scrollTop = log.scrollHeight;
    willSend();
    onRendered?.();
  }
  function body(action, c, question) {
    const provider = AI.choice('code');
    const local = AI.isLocal(provider);
    const fwPaths = Object.fromEntries(Object.keys(AI.LOCAL).map(id => [id, AI.fwPath(id)]).filter(([, v]) => v));
    let selection = '', diagnostics = '';
    if (action === 'diagnose') diagnostics = c.diagnostics;
    else if (ctxMode === 'selection') selection = c.selection;
    else if (ctxMode === 'file') selection = c.fileText;
    const history = conv(c.projectKey).filter(m => !m.error && !m.pending && !m.consent && ['user', 'assistant'].includes(m.role)).slice(-8).map(m => ({ role: m.role, content: m.content }));
    return {
      provider, ...(AI.PROVIDERS[provider] ? { model: AI.modelFor('code', provider) } : {}), ...(provider === 'custom' ? { baseUrl: AI.baseUrl() } : {}),
      ...(local && Object.keys(fwPaths).length ? { frameworkPaths: fwPaths } : {}), lang: getLang(), action,
      filename: (selection || diagnostics) && c.path ? c.path : '', selection, diagnostics, question, history,
    };
  }
  const keyHeader = provider => (AI.PROVIDERS[provider] ? AI.keyOf(provider) : provider === 'dsh' ? AI.keyOf('deepseek') : '');
  async function post(b) {
    const res = await fetch('/api/code-assistant', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json', ...(keyHeader(b.provider) ? { 'X-AI-Key': keyHeader(b.provider) } : {}) }, body: JSON.stringify(b) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(d.error || res.statusText), { status: res.status, code: d.code });
    if (typeof d.text !== 'string') throw new Error(t('wa.badReply'));
    return d.text;
  }
  // Send, and put the answer into the conversation of the project that asked (shown only if it is open).
  async function deliver(projectKey, msg, b) {
    const list = conv(projectKey);
    try {
      const text = await post(b);
      Object.assign(msg, { role: 'assistant', content: text, pending: false });
    } catch (e) {
      // Native Codex asks once before it may use this computer's own global Codex instructions: offer it for this
      // request only, never automatically, never remembered.
      if (e.status === 409 && e.code === 'codexGlobalInstructionsConsent' && b.provider === 'codex' && !b.useNativeCodexInstructions) {
        Object.assign(msg, { role: 'assistant', content: t('wa.codexAsk'), pending: false, consent: true, retry: b });
      } else Object.assign(msg, { role: 'assistant', content: t('wa.failed', { msg: e.message }), pending: false, error: true });
    }
    keep(projectKey, list);
    if (projectKey === key) render();
  }
  async function send(action) {
    const c = getContext();
    if (!c.projectId) { toast(t('wa.noProject')); return; }
    const question = input.value.trim();
    if (action === 'ask' && !question) { input.focus(); return; }
    if (action === 'diagnose' && !c.diagnostics) { toast(t('wa.noDiagnostics')); return; }
    if (action !== 'diagnose' && action !== 'ask' && ctxMode === 'question') { toast(t('wa.needCode')); return; }
    if (ctxMode === 'selection' && action !== 'diagnose' && (action !== 'ask' || !question) && !c.selection) { toast(t('wa.selectFirst')); return; }
    const b = body(action, c, question || t('wa.q.' + action));
    if (b.selection.length > LIMIT) { toast(ctxMode === 'file' ? t('wa.tooLongFile', { file: c.path }) : t('wa.tooLongSel')); return; }
    const projectKey = c.projectKey, list = conv(projectKey);
    const ctxLabel = action === 'diagnose' ? t('wa.sent.diagnostics', { file: c.path || '' }) : b.selection ? (ctxMode === 'file' ? t('wa.sent.file', { file: c.path }) : t('wa.sent.selection', { file: c.path })) : t('wa.sent.question');
    list.push({ id: 'u' + (++uid), role: 'user', content: b.question, ctx: ctxLabel });
    const reply = { id: 'a' + (++uid), role: 'assistant', content: t('wa.thinking'), pending: true };
    list.push(reply);
    input.value = '';
    keep(projectKey, list);
    render();
    await deliver(projectKey, reply, b);
  }
  host.addEventListener('change', e => { if (e.target.name === 'wa-ctx') { ctxMode = e.target.value; willSend(); } });
  host.addEventListener('click', e => {
    const a = e.target.closest('[data-wa]')?.dataset.wa;
    const consent = e.target.closest('[data-consent]')?.dataset.consent;
    if (consent && key) {
      const list = conv(key), msg = list.find(m => m.id === consent);
      if (!msg?.retry) return;
      const b = { ...msg.retry, useNativeCodexInstructions: true };
      Object.assign(msg, { content: t('wa.thinking'), pending: true, consent: false, retry: null });
      render();
      deliver(key, msg, b);
      return;
    }
    if (!a) return;
    if (a === 'clear') { if (key) { convs.set(key, []); keep(key, []); render(); } return; }
    if (a === 'send') return send('ask');
    return send(a);
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send('ask'); } });
  relabel();
  return {
    // Another project (workspace) is open: show its own conversation; nothing of the previous one carries over.
    setProject(k) { if (k === key) return; key = k || null; render(); },
    refresh: willSend,
    relabel,
  };
}
