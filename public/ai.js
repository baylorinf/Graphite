// AI for Graphite: which AI does each job, API keys, and one function to ask.
//
// Each job (Check, quiz questions, chat, revision plans, exam analysis, tidy format) can use a different AI:
// - "claude-code": the Claude Code window on this computer (no API key). The job is written to a file in the
//   vault; Claude, watching that folder (obsidian-chat skill), writes the answer back. Only works while that
//   window is connected.
// - an API provider with the user's own key: Anthropic (Claude), OpenAI, Google Gemini, DeepSeek, Qwen, Kimi,
//   GLM, or any OpenAI-compatible URL. Requests go through this computer's server to that provider only.
// Keys and choices are kept on this computer (app settings), never in the vault.
import { t, getLang } from '/i18n.js';

let H = null;
const listeners = new Set();
export function initAI(host) {
  H = host;
  // For plugins (the chat panel): window.myobsidianAI
  window.myobsidianAI = { FEATURES, options, choice, setChoice, label, request, ccListening, onChange: fn => { listeners.add(fn); return () => listeners.delete(fn); } };
}

export const FEATURES = ['check', 'quiz', 'chat', 'plan', 'exam', 'format'];
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
  return { keys, models, lists: { ...(s.lists || {}) }, baseUrl: s.baseUrl || '', use };
}
function save(patch) {
  const next = { ...raw(), ...patch };
  H.store.set('ai', next);
  listeners.forEach(fn => { try { fn(); } catch { /* plugin gone */ } });
}
export const settings = raw;
export const keyOf = p => raw().keys[p] || '';
export const modelOf = p => raw().models[p] || (PROVIDERS[p]?.suggest[0] ?? '');
export const listOf = p => raw().lists[p] || [];
export const baseUrl = () => raw().baseUrl;
export const setKey = (p, v) => { const r = raw(); save({ keys: { ...r.keys, [p]: v.trim() } }); };
export const setModel = (p, v) => { const r = raw(); save({ models: { ...r.models, [p]: v.trim() } }); };
export const setBaseUrl = v => save({ baseUrl: v.trim() });
// Jobs added later default to what Check uses.
export const choice = f => raw().use[f] || (['plan', 'exam', 'format'].includes(f) && raw().use.check && raw().use.check !== 'off' ? raw().use.check : CC);
export const setChoice = (f, v) => { const r = raw(); save({ use: { ...r.use, [f]: v } }); };
const hasProvider = p => (p === 'custom' ? !!raw().baseUrl : !!keyOf(p));

// Pick a sensible default model from a provider's list.
function pickModel(p, list) {
  const ok = list.filter(m => !SKIP.test(m));
  const pref = ok.filter(m => PROVIDERS[p].prefer.test(m));
  return (pref.length ? pref : ok).sort().pop() || list[0] || '';
}

export function label(v) {
  if (v === CC) return t('ai.cc');
  if (v === 'off') return t('ai.off');
  const P = PROVIDERS[v];
  if (!P) return v;
  return `${P.label} · ${modelOf(v) || '?'}`;
}
// Choices for one job: Claude Code, each provider (greyed out until it has a key), and "off" for jobs that can do without AI.
export function options(f) {
  const out = [{ value: CC, label: t('ai.cc'), ready: true }];
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
  await writeVault(`${CHAT_DIR}/tasks/${id}.json`, JSON.stringify({ id, task: 'ai-' + task, note: payload.path || '', title: payload.title || '', lang: getLang(), at: new Date().toISOString(), ...(payload.job || {}) }));
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
  if (!PROVIDERS[v]) throw new Error(t('ai.noKey'));
  if (!hasProvider(v)) throw new Error(t('ai.noKeyFor', { provider: PROVIDERS[v].label }));
  const limit = AbortSignal.timeout(['plan', 'exam', 'format'].includes(task) ? 270000 : 150000);
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
export async function testProvider(p) {
  const r = await request(null, 'test', {}, { provider: p });
  const lists = { ...raw().lists };
  if (r.models?.length) lists[p] = r.models;
  const cur = raw().models[p];
  const models = { ...raw().models };
  if (!cur || (r.models?.length && !r.models.includes(cur))) models[p] = pickModel(p, r.models || []) || cur || PROVIDERS[p].suggest[0] || '';
  save({ lists, models });
  return r;
}
