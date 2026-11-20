// AI for Graphite: which AI does each job, API keys, and one function to ask.
//
// Each job (Check, quiz questions, chat, revision plans, exam analysis, tidy format) can use a different AI:
// - "claude-code": the Claude Code window on this computer (no API key). The job is written to a file in the
//   vault; Claude, watching that folder (obsidian-chat skill), writes the answer back. Only works while that
//   window is connected.
// - an API provider with the user's own key: Anthropic (Claude), OpenAI, Google Gemini, DeepSeek, Qwen, Kimi,
//   GLM, or any OpenAI-compatible URL. Requests go through this computer's server to that provider only.
// - a local agent framework installed on this computer: DeepSeek Harness ("dsh") or Codex CLI ("codex"). Graphite
//   starts it with the task; it reads the files itself (read-only) and answers (see frameworks.js on the server).
// The user picks one per job; Graphite never switches to another AI on its own when the chosen one fails.
// Keys and choices are kept on this computer (app settings), never in the vault.
import { t, getLang } from '/i18n.js';

let H = null;
const listeners = new Set();
export function initAI(host) {
  H = host;
  // For plugins (the chat panel): window.myobsidianAI
  window.myobsidianAI = { FEATURES, options, choice, setChoice, label, parts, request, ccListening, openSettings: () => H.openSettings('ai'), onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
  Object.assign(window.myobsidianAI, { AGENT_FEATURES, agent, isApi: v => !!PROVIDERS[v], isLocal: v => !!LOCAL[v], isAgent: v => !!PROVIDERS[v] || !!LOCAL[v], frameworks: () => fwState, refreshFrameworks, errorText, readOnlyFolderOf: p => readOnlyFolderOf(p) });
  Object.assign(window.myobsidianAI, { studySettings, executor, executorName });
  refreshFrameworks().catch(() => {});
  studySettings().catch(() => {}); // moves the old settings over on the first start after the update
}
// Who does a job, in words for the UI ("Claude Code", "DeepSeek Harness", "DeepSeek · Flash"). The job itself always
// has Graphite's own name (Graphite study assistant…); this is only the "done by" label next to it.
export const executor = f => choice(f);
export function executorName(v) {
  if (v === 'off') return t('ai.off');
  const p = parts(v);
  return p.model && !LOCAL[v] ? `${p.name} · ${p.model}` : p.name;
}

/* ---------- local agent frameworks ---------- */
export const LOCAL = { dsh: { label: 'DeepSeek Harness', short: 'DeepSeek Harness' }, codex: { label: 'Codex CLI', short: 'Codex' } };
export const isLocal = v => !!LOCAL[v];
let fwState = {}; // id → { found, version, path, reason, detail } (from the server)
let fwLoading = null;
export const frameworks = () => fwState;
export async function refreshFrameworks(force = false) {
  if (fwLoading && !force) return fwLoading;
  fwLoading = fetch('/api/frameworks', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: raw().fwPaths || {}, force }) }).then(r => (r.ok ? r.json() : {})).then(d => { fwState = d || {}; listeners.forEach(fn => { try { fn(); } catch { /* gone */ } }); return fwState; })
    .catch(() => fwState).finally(() => { fwLoading = null; });
  return fwLoading;
}
export const fwPath = id => (raw().fwPaths || {})[id] || '';
export const setFwPath = (id, v) => { save({ fwPaths: { ...(raw().fwPaths || {}), [id]: String(v || '').trim() } }); return refreshFrameworks(true); };
// A framework's state in words: "detected · 0.2.2-rc.1", "not installed", "can't start: …".
export function fwStatus(id) {
  const f = fwState[id];
  if (!f) return { ok: null, text: t('fw.checking') };
  if (f.found) return { ok: true, text: t('fw.found', { version: f.version || '?' }) };
  return { ok: false, text: t('fw.reason.' + (f.reason || 'notInstalled'), { name: LOCAL[id]?.label || id, path: f.path || f.custom || '', detail: f.detail || '' }) };
}
// An error from a job in words, saying which framework or AI it was and why.
export function errorText(e, v) {
  // An error already put into words (by agent() or failFrom) is shown as is: translating its code again would
  // nest the message in itself and repeat the "work folder kept" line.
  if (e?.localized) return e.message;
  const name = LOCAL[v]?.label || (v === CC ? 'Claude Code' : PROVIDERS[v]?.label || v || '');
  let msg = e?.message || String(e);
  if (e?.code && LOCAL[v]) {
    const key = 'fw.err.' + e.code, vars = { name, detail: e.detail || e.message || '' };
    // A code without its own text (a newer backend) still reads as a sentence, never as the key itself.
    msg = t(key, vars); if (msg === key) msg = t('fw.err.generic', vars);
  }
  if (e?.stage) msg += ' ' + t('fw.stageKept', { path: e.stage });
  return msg;
}
async function failFrom(res, v) {
  const d = await res.json().catch(() => ({}));
  throw Object.assign(new Error(d.error || res.statusText), { code: d.code, detail: d.detail, framework: d.framework, stage: d.stage }, { message: errorText({ ...d, message: d.error || res.statusText }, v), localized: true });
}
async function localRequest(v, task, payload, signal) {
  // Every file the job is about goes to the framework as `files`, so it can read what you chose: the note or PDF
  // itself, the notes and PDFs in a revision plan's range, past papers, format examples. (Note titles that are not
  // vault paths are left out.)
  const j = payload.job || {};
  const asPaths = v => (Array.isArray(v) ? v : v ? [v] : []).filter(p => typeof p === 'string' && /\.[a-z0-9]{1,5}$/i.test(p));
  const files = [...new Set([...asPaths(payload.path), ...asPaths(j.pdf), ...asPaths(j.notes), ...asPaths(j.papers), ...asPaths(j.examples), ...asPaths(j.files)])];
  const res = await fetch('/api/local-ai', {
    signal, method: 'POST',
    headers: { 'X-Vault': '1', 'Content-Type': 'application/json', ...(v === 'dsh' && keyOf('deepseek') ? { 'X-AI-Key': keyOf('deepseek') } : {}) },
    body: JSON.stringify({ task, framework: v, lang: getLang(), frameworkPaths: raw().fwPaths || {}, files, ...payload, job: undefined }),
  });
  if (!res.ok) await failFrom(res, v);
  return res.json();
}

export const FEATURES = ['check', 'quiz', 'chat', 'plan', 'exam', 'mock', 'summary', 'format', 'connect', 'code'];
export const openSettings = () => H?.openSettings('ai');
export const CC = 'claude-code';
export const CHAT_DIR = '.obsidian/plugins/claude-chat/chat';

// Model suggestions are only a starting point: "Test the key" loads the provider's real model list.
export const PROVIDERS = {
  anthropic: { label: 'Anthropic (Claude)', site: 'console.anthropic.com', keyPh: 'sk-ant-…', suggest: ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'], prefer: /opus-5-5|sonnet-5-5/ },
  openai: { label: 'OpenAI (GPT)', site: 'platform.openai.com', keyPh: 'sk-…', suggest: ['gpt-6.2-sol', 'gpt-6.2-astra', 'gpt-6-luna'], prefer: /sol|mini/ },
  gemini: { label: 'Google Gemini', site: 'aistudio.google.com', keyPh: 'AIza…', suggest: [], prefer: /flash/ },
  deepseek: { label: 'DeepSeek', site: 'platform.deepseek.com', keyPh: 'sk-…', suggest: ['deepseek-flash', 'deepseek-v4-pro'], prefer: /flash|chat/ },
  qwen: { label: 'Qwen 通义千问', site: 'bailian.console.aliyun.com', keyPh: 'sk-…', suggest: [], prefer: /plus|flash/ },
  kimi: { label: 'Kimi (Moonshot)', site: 'platform.moonshot.cn', keyPh: 'sk-…', suggest: [], prefer: /kimi|k\d/ },
  glm: { label: 'GLM 智谱', site: 'open.bigmodel.cn', keyPh: '…', suggest: [], prefer: /flash|glm/ },
  custom: { label: 'Custom (OpenAI-compatible)', site: '', keyPh: '', suggest: [], prefer: /./ },
};
const SKIP = /embed|tts|audio|image|vision|whisper|dall|moderation|realtime|transcri|search|lite|preview|instruct|-vl|ocr/i;

/* ---------- settings ---------- */
function raw() {
  const s = H?.store.get('ai', {}) || {};
  const keys = { ...(s.keys || {}) }, models = { ...(s.models || {}) };
  // Older versions kept one Anthropic key/model and one DeepSeek key/model.
  if (s.key && !('anthropic' in keys)) keys.anthropic = s.key;
  if (s.deepseekKey && !('deepseek' in keys)) keys.deepseek = s.deepseekKey;
  if (s.model && !models.anthropic) models.anthropic = s.model;
  if (s.deepseekModel && !models.deepseek) models.deepseek = s.deepseekModel;
  let use = { ...(s.use || {}) };
  if (!s.use) {
    const old = s.provider === 'deepseek' ? 'deepseek' : 'anthropic';
    const def = keys[old] ? old : CC;
    const rev = H?.store.get('review', {}) || {};
    use = { check: def, quiz: rev.aiQuestions === false ? 'off' : def, chat: CC, plan: def, exam: def, format: def };
  }
  return { keys, models, lists: { ...(s.lists || {}) }, baseUrl: s.baseUrl || '', use, agent: { ...(s.agent || {}) }, fwPaths: { ...(s.fwPaths || {}) } };
}
function save(patch) {
  const next = { ...raw(), ...patch };
  H.store.set('ai', next);
  listeners.forEach(fn => { try { fn(); } catch { /* plugin gone */ } });
}
export const settings = raw;
export const keyOf = p => raw().keys[p] || '';
export const modelOf = p => raw().models[p] || (PROVIDERS[p]?.suggest[0] ?? '');
// A provider's model list belongs to the address and key it was read with. Only a one-way fingerprint of them is
// kept (never the key itself), so another key or address shows no old list until it is checked again.
const fnv = s => { let h = 0x811c9dc5; for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); };
const listContext = p => p + ':' + fnv([p, p === 'custom' ? raw().baseUrl : '', raw().keys[p] || ''].join('\n'));
// { fetched: true, models } once this provider was checked with the current address and key (models may be
// empty: then only "Custom model…" is offered); { fetched: false, models: [] } before that.
export function listState(p) {
  const e = raw().lists[p];
  return e && !Array.isArray(e) && e.ctx === listContext(p) && Array.isArray(e.models) ? { fetched: true, models: e.models } : { fetched: false, models: [] };
}
export const listOf = p => listState(p).models;
export const baseUrl = () => raw().baseUrl;
export const setKey = (p, v) => { const r = raw(); save({ keys: { ...r.keys, [p]: v.trim() } }); };
export const setModel = (p, v) => { const r = raw(); save({ models: { ...r.models, [p]: v.trim() } }); };
export const setBaseUrl = v => save({ baseUrl: v.trim() });
// Jobs added later default to what Check uses.
// The code assistant uses the chat's AI until one is chosen for it.
export const choice = f => raw().use[f] || (f === 'code' && raw().use.chat ? raw().use.chat : null) || (['plan', 'exam', 'mock', 'format', 'connect', 'summary'].includes(f) && raw().use.check && raw().use.check !== 'off' ? raw().use.check : CC);
export const setChoice = (f, v) => { const r = raw(); save({ use: { ...r.use, [f]: v } }); };
const hasProvider = p => (p === 'custom' ? !!raw().baseUrl : !!keyOf(p));

// Pick a sensible default model from a provider's list.
function pickModel(p, list) {
  const ok = list.filter(m => !SKIP.test(m));
  const pref = ok.filter(m => PROVIDERS[p].prefer.test(m));
  return (pref.length ? pref : ok).sort().pop() || list[0] || '';
}

// Short, readable names for menus: { name: 'DeepSeek', model: 'Flash' }, { name: 'Claude', model: 'Opus 5.5' }.
const SHORT = { anthropic: 'Claude', openai: 'OpenAI', gemini: 'Gemini', deepseek: 'DeepSeek', qwen: 'Qwen', kimi: 'Kimi', glm: 'GLM', custom: 'Custom' };
function prettyModel(p, m) {
  if (!m) return '';
  let s = m.replace(/^models\//, '');
  if (p === 'anthropic') s = s.replace(/^claude-/, '').replace(/-(\d+)-(\d+)$/, ' $1.$2');
  if (p === 'deepseek') s = s.replace(/^deepseek-/, '');
  if (p === 'gemini') s = s.replace(/^gemini-/, '');
  if (p === 'kimi') s = s.replace(/^kimi-/, '');
  s = s.replace(/[-_]+/g, ' ').replace(/\b([a-z])/g, c => c.toUpperCase()).replace(/\bGpt\b/g, 'GPT').replace(/\bGlm\b/g, 'GLM').replace(/\bQwen(\d)/g, 'Qwen $1');
  return s.trim();
}
export function parts(v) {
  if (v === CC) return { name: 'Claude Code', model: '' };
  if (LOCAL[v]) return { name: LOCAL[v].label, model: fwState[v]?.found ? fwState[v].version || '' : '' };
  if (!PROVIDERS[v]) return { name: v, model: '' };
  return { name: SHORT[v], model: prettyModel(v, modelOf(v)) };
}

export function label(v) {
  if (v === CC) return t('ai.cc');
  if (v === 'off') return t('ai.off');
  if (LOCAL[v]) return LOCAL[v].label;
  const P = PROVIDERS[v];
  if (!P) return v;
  return modelOf(v) ? `${P.label} · ${modelOf(v)}` : P.label;
}
// Choices for one job: Claude Code, each provider (greyed out until it has a key), and "off" for jobs that can do without AI.
export function options(f) {
  const out = [{ value: CC, label: t('ai.cc'), ready: true }];
  // Local frameworks are always offered; one that isn't installed shows why (and fails clearly if chosen).
  for (const id of Object.keys(LOCAL)) out.push({ value: id, label: LOCAL[id].label, ready: fwState[id] ? !!fwState[id].found : true, local: true });
  for (const p of Object.keys(PROVIDERS)) out.push({ value: p, label: label(p) + (hasProvider(p) ? '' : ' ' + t('ai.needsKey')), ready: hasProvider(p) });
  if (f === 'check') out.push({ value: 'off', label: t('ai.offCheck'), ready: true });
  if (f === 'quiz') out.push({ value: 'off', label: t('ai.offQuiz'), ready: true });
  return out;
}

/* ---------- Claude Code on this computer ---------- */
const enc = encodeURIComponent;
async function readVault(path) {
  const r = await fetch('/api/file?path=' + enc(path));
  if (!r.ok) return null;
  return (await r.json()).content;
}
async function writeVault(path, text) {
  const r = await fetch('/api/file?path=' + enc(path), { method: 'PUT', headers: { 'X-Vault': '1', 'Content-Type': 'text/plain; charset=utf-8' }, body: text });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText);
}
export async function ccListening() {
  try {
    const st = JSON.parse(await readVault(CHAT_DIR + '/status.json') || '{}');
    return !!(st.listening && Date.now() - st.at < 15000);
  } catch { return false; }
}
const sleep = (ms, signal) => new Promise((res, rej) => {
  const id = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); rej(Object.assign(new Error('aborted'), { name: 'AbortError' })); }, { once: true });
});
async function ccRequest(task, payload, signal) {
  if (!(await ccListening())) throw Object.assign(new Error(t('ai.ccOffline')), { offline: true });
  const id = 't-' + new Date().toISOString().replace(/\D/g, '').slice(0, 14) + '-' + Math.random().toString(36).slice(2, 6);
  // The job carries the study settings too (the same ones every other AI gets), and where the full file is.
  const st = await studySettings().catch(() => null);
  const { differences, ...profile } = st?.profile || {};
  await writeVault(`${CHAT_DIR}/tasks/${id}.json`, JSON.stringify({ id, task: 'ai-' + task, note: payload.path || '', title: payload.title || '', lang: getLang(), at: new Date().toISOString(), studySettings: profile, studySettingsFile: st?.file || '', ...(payload.job || {}) }));
  const t0 = Date.now();
  for (;;) {
    if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
    const r = await readVault(`${CHAT_DIR}/replies/${id}.json`);
    if (r != null) {
      let out; try { out = JSON.parse(r); } catch { throw new Error(t('ai.ccBadReply')); }
      if (out.error) throw new Error(out.error);
      return out;
    }
    if (Date.now() - t0 > 900000) throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    await sleep(1500, signal);
  }
}

/* ---------- asking ---------- */
// request('check', 'check', { title, content, path }) → { summary, issues }
// request('quiz', 'questions', { title, content, path }) → { questions }
// request('chat', 'chat', { text, history, note, selection, study }) → { text }
// request(null, 'test', {}, { provider }) → { ok, models, balance? }
export async function request(feature, task, payload, { signal, provider } = {}) {
  const v = provider || choice(feature);
  if (v === 'off') throw new Error(t('ai.isOff'));
  if (v === CC) return ccRequest(task, payload, signal);
  if (LOCAL[v]) return localRequest(v, task, payload, signal);
  if (!PROVIDERS[v]) throw new Error(t('ai.noKey'));
  if (!hasProvider(v)) throw new Error(t('ai.noKeyFor', { provider: PROVIDERS[v].label }));
  const limit = AbortSignal.timeout(['plan', 'exam', 'mock', 'format', 'connect', 'summary'].includes(task) ? 270000 : 150000);
  const res = await fetch('/api/ai', {
    signal: signal ? AbortSignal.any([signal, limit]) : limit,
    method: 'POST',
    headers: { 'X-Vault': '1', 'Content-Type': 'application/json', 'X-AI-Key': keyOf(v) },
    body: JSON.stringify({ task, provider: v, model: modelOf(v), baseUrl: v === 'custom' ? baseUrl() : undefined, lang: getLang(), ...payload, job: undefined }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

// Test a provider's key; remembers its model list and picks a model if none is set yet.
// Each provider's newest check; an older one that answers late is ignored, as is any answer for a key or address
// that has changed meanwhile. A successful empty list is kept as empty (no models from before shown).
const testSeq = {};
export async function testProvider(p) {
  const seq = (testSeq[p] = (testSeq[p] || 0) + 1), ctx = listContext(p);
  const r = await request(null, 'test', {}, { provider: p });
  if (seq !== testSeq[p] || ctx !== listContext(p)) return { ...r, stale: true };
  const found = Array.isArray(r.models) ? [...new Set(r.models.filter(m => typeof m === 'string' && m.trim()).map(m => m.trim()))] : null;
  const lists = { ...raw().lists };
  if (found) lists[p] = { ctx, models: found };
  const cur = raw().models[p];
  const models = { ...raw().models };
  if (!cur || (found?.length && !found.includes(cur))) models[p] = pickModel(p, found || []) || cur || PROVIDERS[p].suggest[0] || '';
  save({ lists, models });
  return { ...r, models: found || r.models };
}

/* ---------- the agent: jobs on your files, with an API model ----------
   Find new course files, file the Claude Inbox captures and update the Claude Brain used to need the Claude Code
   window. With an API model chosen for them, Graphite's server does them itself (agent.js): the model looks
   around with read-only tools and proposes a plan; nothing is copied or written until the user confirms it.
   It may read only the vault and the course folders listed here (minus the left-out folder names). */
export const AGENT_FEATURES = ['import', 'inbox'];

/* ---------- Study settings: one set of folders, courses and languages for every AI ----------
   Kept by the server in ~/.graphite/study.json (profile.js); every job reads what it needs from there. On the
   first start after the update the two old places (Settings → AI's course folders here, Settings → Claude
   Code's ~/.claude/graphite.json) are combined once, keeping any differences for the user to check. */
let studyCache = null;
export async function studySettings(force = false) {
  if (studyCache && !force) return studyCache;
  const r = await fetch('/api/study-profile').then(x => (x.ok ? x.json() : null)).catch(() => null);
  if (!r) return studyCache || { profile: {}, saved: false };
  if (!r.saved) {
    // Only what the user really set in Settings → AI counts (not the built-in default folder).
    const old = (H?.store.get('ai', {}) || {}).agent;
    const agent = old && (Array.isArray(old.roots) || Array.isArray(old.skip) || 'extras' in old) ? old : null;
    const m = await fetch('/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ migrate: true, agent }) }).then(x => x.json()).catch(() => null);
    if (m?.profile) { studyCache = { ...r, ...m, differences: m.differences || [] }; listeners.forEach(fn => { try { fn(); } catch { /* gone */ } }); return studyCache; }
  }
  studyCache = r;
  return r;
}
// The read-only folder (Study settings, as they are right now) that holds this vault path, or null. Read fresh
// every time: it is checked just before an AI's change is written. If the settings can't be read, the last known
// ones count (never "nothing is read-only" by default when they were known).
export async function readOnlyFolderOf(path) {
  const st = await studySettings(true).catch(() => studyCache);
  const norm = s => String(s || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '').toLowerCase();
  const p = norm(path);
  const hit = (st?.profile?.readOnlyFolders || []).find(r => { const n = norm(r); return n && (p === n || p.startsWith(n + '/')); });
  return hit ? String(hit).replace(/\\/g, '/').replace(/^\/+|\/+$/g, '') : null; // as written in the settings
}
export async function saveStudySettings(profile, { keepDifferences = false } = {}) {
  const res = await fetch('/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ profile, keepDifferences }) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || res.statusText);
  studyCache = { ...(studyCache || {}), ...d, differences: keepDifferences ? studyCache?.differences || [] : [] };
  listeners.forEach(fn => { try { fn(); } catch { /* gone */ } });
  return studyCache;
}
export const DEFAULT_ROOT = 'D:\\Task\\DYS';
export function agentConf() {
  const a = raw().agent || {};
  const fix = r => (/^[A-Za-z]:TaskDYS$/i.test(String(r)) ? String(r).slice(0, 2) + '\\Task\\DYS' : r); // saved by an earlier version without its backslashes
  return { roots: Array.isArray(a.roots) ? a.roots.map(fix) : [DEFAULT_ROOT], skip: Array.isArray(a.skip) ? a.skip : ['UPC'], extras: !!a.extras };
}
export const setAgentConf = patch => save({ agent: { ...agentConf(), ...patch } });
// agent('import', 'import', { phase: 'plan' }, { onProgress }) → { planId, items, ignore, questions, … }
// agent('import', 'import', { phase: 'apply', planId, accept: [0, 2] }) → { done, failed, edited, summary }
// Jobs: 'import' (feature import), 'inbox' and 'brain' (feature inbox).
// opts.graphite: "Scan with Graphite only", which you chose yourself: provider "graphite", with no key, model or
// framework sent. (A plan the backend made manually because the chosen CLI could not plan is still confirmed
// with that CLI as the provider, so it matches who the plan belongs to.)
export async function agent(feature, job, payload = {}, { onProgress, signal, provider, graphite = false } = {}) {
  const v = graphite ? 'graphite' : provider || choice(feature);
  if (!graphite && !PROVIDERS[v] && !LOCAL[v]) throw new Error(t('agent.needsApi'));
  if (!graphite && PROVIDERS[v] && !hasProvider(v)) throw new Error(t('ai.noKeyFor', { provider: PROVIDERS[v].label }));
  const key = graphite ? '' : LOCAL[v] ? (v === 'dsh' ? keyOf('deepseek') : '') : keyOf(v);
  const who = graphite ? { provider: 'graphite' } : LOCAL[v] ? { framework: v, frameworkPaths: raw().fwPaths || {} } : { provider: v, model: modelOf(v), baseUrl: v === 'custom' ? baseUrl() : undefined };
  const res = await fetch('/api/agent', {
    signal, method: 'POST',
    headers: { 'X-Vault': '1', 'Content-Type': 'application/json', ...(key ? { 'X-AI-Key': key } : {}) },
    body: JSON.stringify({ job, ...who, lang: getLang(), ...agentConf(), ...payload }),
  });
  if (!res.ok) await failFrom(res, v);
  // One JSON object per line: progress steps, then the result or an error.
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    buf += dec.decode(value || new Uint8Array(), { stream: !done });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      const o = JSON.parse(line);
      if (o.progress) { try { onProgress?.(o.progress); } catch { /* display only */ } }
      // access / recovery: a permission problem before anything was written (who refused, and whether the
      // confirmed files can be resumed); failed: files that could not be read. Kept for the import window.
      else if (o.error) throw Object.assign(new Error(errorText({ ...o, message: o.error }, v)), { code: o.code, framework: o.framework, stage: o.stage, status: o.status, access: o.access, recovery: o.recovery, failed: o.failed, raw: o.error, localized: true });
      else if (o.result) return o.result;
    }
    if (done) throw new Error(t('agent.cutOff'));
  }
}
