#!/usr/bin/env node
'use strict';
// Graphite — a tiny local server that serves the app and reads/writes a vault of Markdown files.
// Browser mode:  node server.js [path-to-vault]   (default: ./vault)   Env: PORT, VAULT, NO_OPEN=1
// Desktop mode:  the Electron app calls require('./server').start({ vault, port: 0, token }).

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { exec } = require('child_process');

let VAULT = '', CONFIG_DIR = '', PLUGIN_DIR = '';
let TOKEN = null; // desktop app: every request must carry this secret, so other programs can't use the server
const VERSION = require('./package.json').version;
const PUBLIC = path.join(__dirname, 'public');
const NM = path.join(__dirname, 'node_modules');
const LIBS = {
  '/lib/marked.js': path.join(NM, 'marked', 'lib', 'marked.esm.js'),
  '/lib/moment.js': path.join(NM, 'moment', 'min', 'moment-with-locales.min.js'),
  '/lib/js-yaml.js': path.join(NM, 'js-yaml', 'dist', 'js-yaml.mjs'),
  '/lib/mammoth.js': path.join(NM, 'mammoth', 'mammoth.browser.min.js'), // shows .docx files as pages
};
const LUCIDE = path.join(NM, 'lucide-static', 'icons');
const COMMUNITY_LIST = 'https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugins.json';
let communityCache = null;
const NO_OPEN = process.env.NO_OPEN || process.argv.includes('--no-open');

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.ico': 'image/x-icon', '.pdf': 'application/pdf',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.flac': 'audio/flac', '.aac': 'audio/aac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.m4v': 'video/mp4', '.ogv': 'video/ogg',
  '.avif': 'image/avif', '.csv': 'text/csv; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.wasm': 'application/wasm',
};

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

/* ---------- AI: check a note for mistakes, write quiz questions, chat ----------
   Providers: Anthropic (Claude, official SDK) and any OpenAI-compatible API (OpenAI, Google Gemini, DeepSeek,
   Qwen, Kimi, GLM, or a custom URL). The user's own API key arrives in the X-AI-Key header on each request.
   It is never stored or logged here and is only sent to the provider the user chose. */
const ANTHROPIC_DEFAULT = 'claude-opus-5-5';
const LANG_NAMES = { en: 'English', fr: 'French', es: 'Spanish', ja: 'Japanese', ko: 'Korean', 'zh-CN': 'Simplified Chinese', 'zh-TW': 'Traditional Chinese' };
const AI_SCHEMAS = {
  check: {
    type: 'object', additionalProperties: false, required: ['summary', 'issues'],
    properties: {
      summary: { type: 'string' },
      issues: { type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['type', 'quote', 'suggestion', 'explanation'],
        properties: {
          type: { type: 'string', enum: ['fact', 'spelling', 'grammar', 'clarity', 'logic', 'formatting', 'links', 'structure', 'style'] },
          quote: { type: 'string' }, suggestion: { type: 'string' }, explanation: { type: 'string' },
        } } },
    },
  },
  plan: { type: 'object', additionalProperties: false, required: ['title', 'markdown'], properties: { title: { type: 'string' }, markdown: { type: 'string' } } },
  exam: { type: 'object', additionalProperties: false, required: ['title', 'markdown', 'problems'], properties: { title: { type: 'string' }, markdown: { type: 'string' },
    problems: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['no', 'page', 'topic', 'question', 'myAnswer', 'mistake'],
      properties: { no: { type: 'string' }, page: { type: 'integer' }, topic: { type: 'string' }, question: { type: 'string' }, myAnswer: { type: 'string' }, mistake: { type: 'string' } } } } } },
  connect: { type: 'object', additionalProperties: false, required: ['related'], properties: { related: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['title', 'why'], properties: { title: { type: 'string' }, why: { type: 'string' } } } } } },
  format: { type: 'object', additionalProperties: false, required: ['markdown', 'changes'], properties: { markdown: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } } } },
  questions: {
    type: 'object', additionalProperties: false, required: ['questions'],
    properties: { questions: { type: 'array', items: {
      type: 'object', additionalProperties: false, required: ['question', 'answer'],
      properties: { question: { type: 'string' }, answer: { type: 'string' } } } } },
  },
};
const AI_PROMPTS = {
  check: ui => `You proofread and fact-check personal study notes written in Markdown (Obsidian style).
Find real mistakes: wrong facts, spelling, grammar, unclear or ambiguous sentences, and faulty logic.
Do not report personal style choices, and leave Markdown syntax alone ([[links]], #tags, ==highlights==, $math$, code) unless it is actually wrong.
For each mistake:
- quote: the exact text from the note, copied character for character, as short as possible while still appearing only once in the note.
- suggestion: the corrected text that should replace the quote, in the note's own language.
- explanation: one short sentence in ${ui} saying what was wrong.
summary: one sentence in ${ui} describing the overall state of the note.
If there are no mistakes, return an empty issues list.`,
  questions: ui => `You write quiz questions that help someone revise their own study notes.
Write 3 to 8 questions that test understanding of the most important ideas in the note, not trivia.
Use only what the note says. Write questions and answers in the note's own language (if unclear, use ${ui}).
Answers are short: one or two sentences.`,
  plan: ui => `You make day-by-day revision plans for a university student's exam, as a Markdown note for their notes app.
The input gives the exam, today's date, the exam date, what is examined, minutes per day, and the notes in range with how well the student remembers each (from their quiz history: strength 0–100%, questions due, or not studied yet).
- Cover every note in range. Put weak, due and not-yet-studied topics first; revisit them later (spaced review).
- Keep each day within the time available, with a realistic minutes estimate per task.
- Leave the last day or two before the exam for a timed mock exam and reviewing mistakes.
- Link notes as [[Note title]] exactly as given. If the input names slide files (e.g. LA5.pdf), link them as [[LA5.pdf|LA5]].
- Write in ${ui}, except keep note titles as given.
markdown: the whole note: YAML frontmatter (tags: [Revision plan], created: today's date as YYYY.MM.DD), a short overview (exam, date, days left, priorities), then one "## Day N · date" section per day with "- [ ] task (minutes)" items.
title: a short note title such as "<exam> revision plan".`,
  exam: ui => `You analyse an exam paper (or a graded exam / mock exam) for a university student, as a Markdown note for their notes app.
The input is the paper's text, possibly with the student's answers and marks, the student's comment, and the titles of their notes.
- List every problem: number, topic, what it tests, and which of their notes covers it (as [[Note title]], only titles from the list given).
- If answers or marks are visible: say which problems lost marks, what went wrong and why (concept gap, calculation slip, missing step, time).
- Then give concrete suggestions and a short study plan with "- [ ] task" items, weakest topics first.
- Write in ${ui}. Keep maths in $...$ / $...$.
markdown: the whole note: YAML frontmatter (tags: [Exam analysis], created: YYYY.MM.DD), "## Summary", "## Problems" (a list or a table of at most 4 columns), "## Mistakes and why" (if there are answers), "## Suggestions", "## Plan".
title: a short note title such as "<paper name> analysis".
- The input may be only part of the paper (a page range, or one batch of a long paper): analyse only what is given; don't guess about other pages.
problems: one entry per problem, in order: no (its number as printed, e.g. "3" or "2(b)"), page (the page it is on, from the "--- page N ---" markers; 0 if unknown), topic, question (the problem itself, shortened if long, maths in $...$), myAnswer (the student's answer if visible, else ""), mistake (what went wrong if it lost marks, else ""). Write topic and mistake in ${ui}.`,
  connect: ui => `You link one of a university student's notes to their other notes that really matter for it.
The input is the note and a list of their other notes (title, folder, headings).
- Pick 2 to 6 notes that share a concept, give a definition or theorem this note relies on, or continue its topic. Never pick a note only because it is in the same course. Pick none if nothing really fits.
related: the chosen notes, each with title (copied exactly from the list) and why (one short phrase in ${ui}).`,
  format: ui => `You reformat one Markdown note so that its format matches the user's other notes (examples given), without changing its content.
- Copy the examples' conventions: frontmatter fields, heading levels and style, numbering, the source line (e.g. "来源：" with slide links), the "相关 Related:" line, list style, maths style ($...$), bilingual titles if they use them.
- Keep every piece of content, every link and the user's wording and language. Do not add new facts or remove anything. Fix only obvious typos and broken maths.
- If the note already matches, return it unchanged with an empty changes list.
markdown: the whole reformatted note.
changes: one short item per kind of change, in ${ui}.`,
  chat: () => `You are Graphie, the study assistant in the chat panel of Graphite, a Markdown notes app. The user asks about what they are studying.
- Reply in the language of the user's latest message.
- When they say "this", "here" or "it", they mean the selected text if there is one, otherwise the open note (both are included in their message when available).
- Write Markdown: short paragraphs, **bold**, lists, maths as $...$ and $$...$$ (KaTeX), and [[Note name]] for links to their notes. The panel is narrow, so keep answers as short as the question allows and tables to at most three columns.
- You cannot change their notes yourself. If they ask you to add something to a note, write the text to add; they can press "Add to note" under your answer.`,
};
// The JSON shape spelled out for providers whose JSON mode can't take a schema.
const AI_EXAMPLES = {
  check: { summary: 'One sentence about the note.', issues: [{ type: 'spelling', quote: 'exact words from the note', suggestion: 'corrected words', explanation: 'Why it was wrong.' }] },
  questions: { questions: [{ question: 'A question about the note?', answer: 'A short answer.' }] },
  plan: { title: 'Linear Algebra midterm revision plan', markdown: '---\ntags: [Revision plan]\ncreated: 2026.11.20\n---\n...' },
  exam: { title: 'Mock midterm analysis', markdown: '---\ntags: [Exam analysis]\ncreated: 2026.11.20\n---\n## Summary\n...', problems: [{ no: '1', page: 1, topic: 'Eigenvalues', question: 'Find the eigenvalues of A.', myAnswer: 'lambda = 2', mistake: 'Missed the repeated root.' }] },
  connect: { related: [{ title: 'Exact note title from the list', why: 'uses its definition of X' }] },
  format: { markdown: 'the whole reformatted note', changes: ['Added frontmatter', 'Numbered the key points'] },
};
// OpenAI-compatible providers. `extra` holds optional fields (e.g. turning off slow "thinking"); if a provider
// rejects them, the request is retried without them.
const COMPAT = {
  openai: { name: 'OpenAI', base: 'https://api.openai.com/v1', tokens: 'max_completion_tokens' },
  gemini: { name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai' },
  deepseek: { name: 'DeepSeek', base: 'https://api.deepseek.com', extra: { thinking: { type: 'disabled' } }, topUp: 'platform.deepseek.com' },
  qwen: { name: 'Qwen', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', extra: { enable_thinking: false } },
  kimi: { name: 'Kimi', base: 'https://api.moonshot.cn/v1' },
  glm: { name: 'GLM', base: 'https://open.bigmodel.cn/api/paas/v4', extra: { thinking: { type: 'disabled' } } },
  custom: { name: 'Custom API' },
};
const tooLong = c => { if (c.length > 400000) throw new HttpError(413, 'This note is too long to send in one request'); };
const attr = s => String(s || '').replace(/"/g, "'");
const noteBlock = b => `<note title="${attr(b.title)}">\n${String(b.content || '')}\n</note>`;
// Chat: earlier turns plus the new message, with the open note / selection / study page attached to the new one.
function chatMessages(b) {
  const hist = (Array.isArray(b.history) ? b.history : []).slice(-20)
    .filter(m => (m.role === 'user' || m.role === 'assistant') && m.content).map(m => ({ role: m.role, content: String(m.content) }));
  let ctx = '';
  if (b.note && b.note.content != null) { tooLong(String(b.note.content)); ctx += `<open_note title="${attr(b.note.title)}">\n${b.note.content}\n</open_note>\n`; }
  if (b.study) ctx += `<study_page>${b.study}</study_page>\n`;
  if (b.selection) ctx += `<selection>\n${b.selection}\n</selection>\n`;
  return [...hist, { role: 'user', content: ctx + String(b.text || '') }];
}
// Pull the JSON object out of a reply that may have extra text or ``` fences around it.
function parseJsonReply(text) {
  try { return JSON.parse(text); } catch { /* look for the object */ }
  const a = text.indexOf('{'), z = text.lastIndexOf('}');
  if (a >= 0 && z > a) return JSON.parse(text.slice(a, z + 1));
  throw new SyntaxError('no JSON');
}
function tidyResult(task, out) {
  if (task === 'check') { out.summary = String(out.summary || ''); out.issues = Array.isArray(out.issues) ? out.issues : []; }
  else if (task === 'questions') out.questions = Array.isArray(out.questions) ? out.questions : [];
  else if (task === 'plan' || task === 'exam') {
    out.title = String(out.title || ''); out.markdown = String(out.markdown || ''); if (!out.markdown) throw new SyntaxError('empty');
    if (task === 'exam') out.problems = (Array.isArray(out.problems) ? out.problems : []).filter(x => x && typeof x === 'object').map(x => ({
      no: String(x.no ?? ''), page: Number.isFinite(+x.page) ? Math.max(0, Math.round(+x.page)) : 0, topic: String(x.topic || ''), question: String(x.question || ''), myAnswer: String(x.myAnswer || ''), mistake: String(x.mistake || '') }));
  }
  else if (task === 'connect') out.related = (Array.isArray(out.related) ? out.related : []).filter(x => x && x.title).map(x => ({ title: String(x.title), why: String(x.why || '') }));
  else if (task === 'format') { out.markdown = String(out.markdown || ''); out.changes = Array.isArray(out.changes) ? out.changes.map(String) : []; if (!out.markdown) throw new SyntaxError('empty'); }
  return out;
}

async function compatTask(provider, key, body) {
  const P = COMPAT[provider];
  let base = P.base;
  if (provider === 'custom') {
    base = String(body.baseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/\S+$/i.test(base)) throw new HttpError(400, 'Enter the API base URL for your custom provider (e.g. https://example.com/v1)');
  }
  const name = P.name;
  const call = async (pathname, init = {}) => {
    let r;
    try {
      r = await fetch(base + pathname, { ...init, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(240000) });
    } catch (e) {
      if (e.name === 'TimeoutError') throw new HttpError(504, `${name} took longer than 4 minutes to answer; try again, or pick a faster model`);
      throw new HttpError(502, `Could not reach ${name} (check your internet connection${provider === 'custom' ? ' and the base URL' : ''})`);
    }
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      const detail = (data.error && data.error.message) || data.message || r.statusText;
      const err = r.status === 401 || r.status === 403 ? new HttpError(401, `The ${name} API key was not accepted`)
        : r.status === 402 ? new HttpError(402, `Your ${name} balance is empty${P.topUp ? `; top it up at ${P.topUp}` : ''}`)
        : r.status === 404 ? new HttpError(404, `${name} doesn't know that model (${body.model || '?'}); press Test the key in Settings → AI to see the available models`)
        : r.status === 429 ? new HttpError(429, `Too many requests to ${name}, or no credit left; try again later`)
        : r.status >= 500 ? new HttpError(502, `${name} had a server error; try again later`)
        : new HttpError(422, `${name} error ${r.status}: ${detail}`);
      err.raw = r.status;
      throw err;
    }
    return data;
  };
  if (body.task === 'test') {
    let models = [];
    try {
      const m = await call('/models');
      models = (m.data || m.models || []).map(x => String(x.id || x.name || '').replace(/^models\//, '')).filter(Boolean).sort();
    } catch (e) { if (e.raw !== 404) throw e; } // some providers have no model list; the key may still be fine
    const out = { ok: true, models };
    if (provider === 'deepseek') {
      const b = await call('/user/balance').catch(() => null);
      if (b) { out.balance = (b.balance_infos || []).map(i => `${i.total_balance} ${i.currency}`).join(', ') || null; out.available = b.is_available !== false; }
    }
    return out;
  }
  const model = String(body.model || '').trim();
  if (!model) throw new HttpError(400, `Choose a ${name} model first (Settings → AI)`);
  const prompt = AI_PROMPTS[body.task];
  if (!prompt) throw new HttpError(400, 'Unknown task');
  const json = body.task !== 'chat';
  let messages;
  if (json) {
    tooLong(String(body.content || ''));
    messages = [{ role: 'system', content: `${prompt(LANG_NAMES[body.lang] || 'English')}\n\nReply with JSON only, in exactly this format:\n${JSON.stringify(AI_EXAMPLES[body.task], null, 2)}` },
      { role: 'user', content: noteBlock(body) }];
  } else messages = [{ role: 'system', content: prompt() }, ...chatMessages(body)];
  const tokens = P.tokens || 'max_tokens';
  const full = { model, messages, [tokens]: 16000, ...(json ? { response_format: { type: 'json_object' } } : {}), ...(P.extra || {}) };
  const plain = { model, messages, [tokens]: 16000 };
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try { r = await call('/chat/completions', { method: 'POST', body: JSON.stringify(attempt === 0 ? full : plain) }); }
    catch (e) { if (attempt === 0 && (e.raw === 400 || e.raw === 422)) continue; throw e; } // optional fields not supported: retry without
    const choice = r.choices && r.choices[0];
    if (choice && choice.finish_reason === 'length') throw new HttpError(422, 'The answer was too long; try a shorter note');
    const text = String((choice && choice.message && choice.message.content) || '').trim();
    if (!text) continue; // JSON mode can occasionally return blank content
    if (!json) return { text };
    try { return tidyResult(body.task, parseJsonReply(text)); } catch { /* try again */ }
  }
  throw new HttpError(502, `${name} returned an answer that could not be read; try again`);
}

let AnthropicSDK = null;
async function anthropicTask(key, body) {
  if (!key) throw new HttpError(400, 'No API key');
  AnthropicSDK ||= require('@anthropic-ai/sdk');
  const Anthropic = AnthropicSDK.default || AnthropicSDK;
  const client = new Anthropic({ apiKey: key, timeout: 240000, maxRetries: 1 });
  const model = String(body.model || '').trim() || ANTHROPIC_DEFAULT;
  try {
    if (body.task === 'test') {
      const models = [];
      for await (const m of client.models.list({ limit: 100 })) models.push(m.id);
      return { ok: true, models: models.filter(id => id.startsWith('claude')).sort() };
    }
    const prompt = AI_PROMPTS[body.task];
    if (!prompt) throw new HttpError(400, 'Unknown task');
    const json = body.task !== 'chat';
    if (json) tooLong(String(body.content || ''));
    const params = {
      model, max_tokens: 16000,
      system: json ? prompt(LANG_NAMES[body.lang] || 'English') : prompt(),
      messages: json ? [{ role: 'user', content: noteBlock(body) }] : chatMessages(body),
      output_config: json
        ? { format: { type: 'json_schema', schema: AI_SCHEMAS[body.task] }, effort: body.task === 'questions' ? 'low' : 'medium' }
        : { effort: 'low' },
    };
    // Opus and Sonnet 5.5: if a safety check declines, Anthropic retries on a suitable model automatically.
    const fallback = /^claude-(opus|sonnet)-5-5$/.test(model);
    const r = fallback
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(params);
    if (r.stop_reason === 'refusal') throw new HttpError(422, 'Claude declined to answer this');
    if (r.stop_reason === 'max_tokens') throw new HttpError(422, 'The answer was too long; try a shorter note');
    const text = r.content.filter(b => b.type === 'text').map(b => b.text).join('');
    return json ? tidyResult(body.task, JSON.parse(text)) : { text };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new HttpError(401, 'The Anthropic API key was not accepted');
    if (e instanceof Anthropic.PermissionDeniedError) throw new HttpError(403, 'This API key may not use that model');
    if (e instanceof Anthropic.NotFoundError) throw new HttpError(404, `Model not available for this key (${model})`);
    if (e instanceof Anthropic.RateLimitError) throw new HttpError(429, 'Too many requests or no credit left; try again later');
    if (e instanceof Anthropic.APIConnectionTimeoutError) throw new HttpError(504, 'Claude took longer than 4 minutes to answer; try again, or pick a faster model');
    if (e instanceof Anthropic.APIConnectionError) throw new HttpError(502, 'Could not reach Anthropic (check your internet connection)');
    if (e instanceof Anthropic.APIError) throw new HttpError(502, `Anthropic error ${e.status ?? ''}: ${e.message}`);
    if (e instanceof SyntaxError) throw new HttpError(502, 'Claude returned an answer that could not be read');
    throw e;
  }
}

async function aiTask(req) {
  const key = String(req.headers['x-ai-key'] || '').trim();
  const body = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString('utf8') || '{}');
  const provider = body.provider || 'anthropic';
  if (provider === 'anthropic') return anthropicTask(key, body);
  if (!COMPAT[provider]) throw new HttpError(400, 'Unknown AI provider');
  if (!key && provider !== 'custom') throw new HttpError(400, 'No API key');
  return compatTask(provider, key, body);
}

/* ---------- Word and PowerPoint files as PDF ----------
   .doc, .docx, .ppt and .pptx files are turned into a PDF by Word or PowerPoint (if installed), so they show in
   the PDF viewer looking exactly like the original. The PDF is cached in .obsidian/graphite/pdf-copies/ (hidden
   from the file list) and made again only when the file changes. "save" also puts a copy next to the original. */
const OFFICE = /\.(docx?|pptx?)$/i;
const PDF_CACHE = '.obsidian/graphite/pdf-copies';
// PowerPoint runs as one shared copy: if the user already has presentations open, it is left running.
const OFFICE_PS = `$ErrorActionPreference = 'Stop'
$src = $env:GRAPHITE_SRC; $out = $env:GRAPHITE_OUT
if ($src -match '\\.pptx?$') {
  $pp = New-Object -ComObject PowerPoint.Application
  $wasOpen = $pp.Presentations.Count -gt 0
  try { $p = $pp.Presentations.Open($src, -1, 0, 0); $p.SaveAs($out, 32); $p.Close() }
  finally { if (-not $wasOpen) { $pp.Quit() }; [Runtime.InteropServices.Marshal]::ReleaseComObject($pp) | Out-Null }
} else {
  $wd = New-Object -ComObject Word.Application; $wd.Visible = $false; $wd.DisplayAlerts = 0
  try { $d = $wd.Documents.Open($src, $false, $true); $d.ExportAsFixedFormat($out, 17); $d.Close(0) }
  finally { $wd.Quit(); [Runtime.InteropServices.Marshal]::ReleaseComObject($wd) | Out-Null }
}`;
let officeQueue = Promise.resolve();
function officeToPdf(srcAbs, outAbs) {
  const job = officeQueue.then(() => new Promise((resolve, reject) => {
    const { spawn } = require('child_process');
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', OFFICE_PS],
      { env: { ...process.env, GRAPHITE_SRC: srcAbs, GRAPHITE_OUT: outAbs }, windowsHide: true });
    let err = '';
    ps.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { ps.kill(); reject(new HttpError(504, 'Office took too long to make the PDF')); }, 180000);
    ps.on('error', e => { clearTimeout(timer); reject(new HttpError(501, 'Could not start PowerShell: ' + e.message)); });
    ps.on('close', code => {
      clearTimeout(timer);
      if (code === 0 && fs.existsSync(outAbs)) return resolve();
      const noOffice = /80040154|Class not registered|ComObject/i.test(err);
      reject(new HttpError(noOffice ? 501 : 500, noOffice
        ? 'Microsoft Office (Word or PowerPoint) is needed to show this file here. Use “Open with default app”.'
        : 'Office could not convert this file: ' + (err.split(/\r?\n/).find(l => l.trim()) || 'unknown error').trim()));
    });
  }));
  officeQueue = job.catch(() => {});
  return job;
}
async function officePdf(rel, save) {
  if (process.platform !== 'win32') throw new HttpError(501, 'Showing Word and PowerPoint files needs Windows with Microsoft Office.');
  if (!OFFICE.test(rel)) throw new HttpError(400, 'Not a Word or PowerPoint file');
  const src = inVault(rel);
  const st = await fsp.stat(src).catch(() => null);
  if (!st) throw new HttpError(404, 'Not found');
  const cacheRel = `${PDF_CACHE}/${hash(rel + '|' + st.size + '|' + st.mtimeMs)}.pdf`;
  const cacheAbs = inVault(cacheRel);
  if (!(await exists(cacheAbs))) {
    await fsp.mkdir(path.dirname(cacheAbs), { recursive: true });
    await officeToPdf(src, cacheAbs);
  }
  if (!save) return { pdf: cacheRel };
  const dest = await uniquePath(src.replace(OFFICE, '.pdf'));
  await fsp.copyFile(cacheAbs, dest);
  return { pdf: cacheRel, saved: toRel(dest) };
}

function inVault(rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new HttpError(400, 'Missing path');
  const abs = path.resolve(VAULT, rel.replace(/^[/\\]+/, ''));
  if (abs !== VAULT && !abs.startsWith(VAULT + path.sep)) throw new HttpError(400, 'Path escapes the vault');
  return abs;
}
const toRel = abs => path.relative(VAULT, abs).split(path.sep).join('/');
// Files that cloud sync apps and Windows leave around; never show them as notes.
const JUNK = /^(desktop\.ini|thumbs\.db|\.ds_store|~\$.*|.*\.tmp|.*\.crdownload|\.~lock\..*#?)$/i;
// Same 53-bit hash as the app uses, to tell whether a note changed since the app last saw it.
function hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
const isMd = p => p.toLowerCase().endsWith('.md');
const exists = p => fsp.access(p).then(() => true, () => false);

async function walk(dir, out, withContent) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.') || e.name === 'node_modules' || JUNK.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { out.folders.push(toRel(full)); await walk(full, out, withContent); }
    else if (e.isFile()) {
      const st = await fsp.stat(full);
      const f = { path: toRel(full), mtime: st.mtimeMs, size: st.size };
      if (withContent && isMd(e.name)) f.content = await fsp.readFile(full, 'utf8');
      out.files.push(f);
    }
  }
  return out;
}

function readBody(req, limit = 100 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > limit) { reject(new HttpError(413, 'Body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

// A short lock per file (".name.graphite-lock" next to it, hidden like all dot files), shared by every
// Graphite window and process using this vault. A lock older than 10 s is left over from a crash and ignored.
async function withFileLock(abs, fn) {
  const lock = path.join(path.dirname(abs), '.' + path.basename(abs) + '.graphite-lock');
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const t0 = Date.now();
  for (;;) {
    try { const h = await fsp.open(lock, 'wx'); await h.close(); break; }
    catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const st = await fsp.stat(lock).catch(() => null);
      if (st && Date.now() - st.mtimeMs > 10000) { await fsp.unlink(lock).catch(() => {}); continue; }
      if (Date.now() - t0 > 5000) throw new HttpError(503, 'The file is busy; try again');
      await new Promise(r => setTimeout(r, 20 + Math.random() * 40));
    }
  }
  try { return await fn(); } finally { await fsp.unlink(lock).catch(() => {}); }
}
// Write to a temporary file and rename it over the original, so a failed write never leaves half a file.
async function atomicWrite(abs, body) {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${process.pid}.${Date.now()}.tmp`);
  await fsp.writeFile(tmp, body);
  // Windows can refuse to replace a file another program has open for a moment (antivirus, cloud sync):
  // try the rename again for a while. Never fall back to writing over the original in place: a write that
  // fails half way (disk full) would leave half a file. If it can't be replaced, the original stays whole
  // and the save is reported as failed, so the app keeps the text and tries again.
  for (let i = 0; ; i++) {
    try { await fsp.rename(tmp, abs); return; }
    catch (e) {
      const busy = e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY';
      if (!busy || i >= 7) {
        await fsp.unlink(tmp).catch(() => {});
        if (busy) throw new HttpError(503, 'The file is in use by another program; it was not changed. Try again.');
        throw e;
      }
      await new Promise(r => setTimeout(r, 40 * 2 ** Math.min(i, 4)));
    }
  }
}

async function uniquePath(abs) {
  if (!(await exists(abs))) return abs;
  const ext = path.extname(abs), base = abs.slice(0, abs.length - ext.length);
  for (let i = 1; ; i++) { const p = `${base} ${i}${ext}`; if (!(await exists(p))) return p; }
}

// Deleting moves things into <vault>/.trash (like Obsidian) instead of destroying them.
async function moveToTrash(abs) {
  const trash = path.join(VAULT, '.trash');
  await fsp.mkdir(trash, { recursive: true });
  await fsp.rename(abs, await uniquePath(path.join(trash, path.basename(abs))));
}

async function api(req, res, u) {
  const route = u.pathname.slice('/api/'.length), m = req.method, q = u.searchParams;

  if (route === 'all' && m === 'GET') return send(res, 200, { vault: VAULT, version: VERSION, ...(await walk(VAULT, { folders: [], files: [] }, true)) });
  if (route === 'list' && m === 'GET') return send(res, 200, await walk(VAULT, { folders: [], files: [] }, false));

  if (route === 'file') {
    const abs = inVault(q.get('path'));
    if (m === 'GET') {
      if (!(await exists(abs))) throw new HttpError(404, 'Not found');
      const st = await fsp.stat(abs);
      // A folder (plugins check whether one exists this way): say so instead of failing to read it.
      if (st.isDirectory()) return send(res, 200, { path: toRel(abs), mtime: st.mtimeMs, folder: true, content: null });
      return send(res, 200, { path: toRel(abs), mtime: st.mtimeMs, content: await fsp.readFile(abs, 'utf8') });
    }
    if (m === 'POST') {
      // Create only: exclusive, so a new file (e.g. a sync conflict copy) never replaces one already on disk.
      const body = await readBody(req);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      try { await fsp.writeFile(abs, body, { flag: 'wx' }); }
      catch (e) { if (e.code === 'EEXIST') throw new HttpError(409, 'A file with that name already exists'); throw e; }
      const st = await fsp.stat(abs);
      return send(res, 200, { path: toRel(abs), mtime: st.mtimeMs });
    }
    if (m === 'PUT') {
      const body = await readBody(req);
      // Sync safety: the app says which version it last saw (X-Base-Hash). If the file on disk has
      // changed since (e.g. a cloud app brought in an edit from another device), refuse and return it.
      // The check and the write happen under a per-file lock, so two windows can't both pass the check.
      const base = req.headers['x-base-hash'];
      return await withFileLock(abs, async () => {
        if (base && await exists(abs)) {
          const cur = await fsp.readFile(abs, 'utf8');
          const h = hash(cur);
          if (h !== base && h !== hash(body.toString('utf8'))) {
            const st = await fsp.stat(abs);
            return send(res, 409, { error: 'conflict', content: cur, mtime: st.mtimeMs });
          }
        }
        await atomicWrite(abs, body);
        const st = await fsp.stat(abs);
        return send(res, 200, { path: toRel(abs), mtime: st.mtimeMs });
      });
    }
    if (m === 'DELETE') {
      if (!(await exists(abs))) throw new HttpError(404, 'Not found');
      await moveToTrash(abs);
      return send(res, 200, { ok: true });
    }
  }

  if (route === 'folder' && m === 'POST') {
    const abs = inVault(q.get('path'));
    await fsp.mkdir(abs, { recursive: true });
    return send(res, 200, { path: toRel(abs) });
  }

  if (route === 'rename' && m === 'POST') {
    const { from, to } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const a = inVault(from), b = inVault(to);
    if (a === VAULT || b === VAULT) throw new HttpError(400, 'Cannot rename the vault root');
    if (!(await exists(a))) throw new HttpError(404, 'Source not found');
    if (await exists(b) && a.toLowerCase() !== b.toLowerCase()) throw new HttpError(409, 'Something already exists at ' + to);
    if (b.startsWith(a + path.sep)) throw new HttpError(400, 'Cannot move a folder into itself');
    await fsp.mkdir(path.dirname(b), { recursive: true });
    await fsp.rename(a, b);
    return send(res, 200, { path: toRel(b) });
  }

  if (route === 'upload' && m === 'POST') {
    const abs = await uniquePath(inVault(q.get('path')));
    const body = await readBody(req);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, body);
    const st = await fsp.stat(abs);
    return send(res, 200, { path: toRel(abs), mtime: st.mtimeMs, size: st.size });
  }

  // ---- Obsidian-compatible plugins: <vault>/.obsidian/plugins/<id>/{manifest.json, main.js, styles.css, data.json}
  if (route === 'plugins' && m === 'GET') {
    let dirs = [];
    try { dirs = await fsp.readdir(PLUGIN_DIR, { withFileTypes: true }); } catch { /* none yet */ }
    const plugins = [];
    for (const d of dirs) {
      if (!d.isDirectory()) continue;
      const dir = path.join(PLUGIN_DIR, d.name);
      try {
        const manifest = JSON.parse(await fsp.readFile(path.join(dir, 'manifest.json'), 'utf8'));
        plugins.push({ dir: d.name, manifest, hasStyles: await exists(path.join(dir, 'styles.css')), hasMain: await exists(path.join(dir, 'main.js')) });
      } catch { plugins.push({ dir: d.name, error: 'Missing or invalid manifest.json' }); }
    }
    let enabled = [];
    try { enabled = JSON.parse(await fsp.readFile(path.join(CONFIG_DIR, 'community-plugins.json'), 'utf8')); } catch { /* none */ }
    return send(res, 200, { dir: PLUGIN_DIR, plugins, enabled: Array.isArray(enabled) ? enabled : [] });
  }

  if (route === 'plugins/community' && m === 'GET') {
    if (!communityCache || Date.now() - communityCache.at > 3600e3) {
      const r = await fetch(COMMUNITY_LIST);
      if (!r.ok) throw new HttpError(502, `Community list: HTTP ${r.status}`);
      communityCache = { at: Date.now(), list: await r.json() };
    }
    return send(res, 200, communityCache.list);
  }

  if (route === 'plugins/install' && m === 'POST') {
    const { repo } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new HttpError(400, 'Invalid repository name');
    const base = `https://github.com/${repo}/releases/latest/download/`;
    const get = async (file, optional) => {
      const r = await fetch(base + file, { redirect: 'follow' });
      if (!r.ok) { if (optional) return null; throw new HttpError(502, `${file}: HTTP ${r.status}`); }
      return Buffer.from(await r.arrayBuffer());
    };
    const manifestBuf = await get('manifest.json');
    const manifest = JSON.parse(manifestBuf.toString('utf8'));
    if (!/^[\w.-]+$/.test(manifest.id || '')) throw new HttpError(400, 'Invalid plugin id in manifest');
    const mainJs = await get('main.js');
    const styles = await get('styles.css', true);
    const dir = path.join(PLUGIN_DIR, manifest.id);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'manifest.json'), manifestBuf);
    await fsp.writeFile(path.join(dir, 'main.js'), mainJs);
    if (styles) await fsp.writeFile(path.join(dir, 'styles.css'), styles);
    return send(res, 200, { id: manifest.id, manifest });
  }

  // Which cloud service (if any) the vault lives in, and which ones exist on this PC.
  if (route === 'sync-info' && m === 'GET') return send(res, 200, await syncInfo());
  if (route === 'ai' && m === 'POST') return send(res, 200, await aiTask(req));
  if (route === 'office-pdf' && m === 'POST') return send(res, 200, await officePdf(q.get('path'), q.get('save') === '1'));

  // Open a vault folder in the system file manager.
  if (route === 'reveal' && m === 'POST') {
    const rel = q.get('path') || '';
    const abs = rel ? inVault(rel) : VAULT;
    await fsp.mkdir(abs, { recursive: true });
    const cmd = process.platform === 'win32' ? `explorer "${abs}"` : `${process.platform === 'darwin' ? 'open' : 'xdg-open'} "${abs}"`;
    exec(cmd, () => {});
    return send(res, 200, { ok: true });
  }

  // requestUrl() for plugins: fetch from the server side so CORS does not get in the way.
  if (route === 'fetch' && m === 'POST') {
    const { url, method = 'GET', headers = {}, body } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    if (!/^https?:\/\//i.test(url || '')) throw new HttpError(400, 'Only http(s) URLs are allowed');
    const r = await fetch(url, { method, headers, body: body == null ? undefined : body, redirect: 'follow' });
    const buf = Buffer.from(await r.arrayBuffer());
    return send(res, 200, { status: r.status, headers: Object.fromEntries(r.headers), body: buf.toString('base64') });
  }

  if (route === 'events' && m === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': connected\n\n');
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  throw new HttpError(404, 'Unknown API route');
}

async function syncInfo() {
  const env = process.env, home = require('os').homedir();
  const roots = [];
  const add = (provider, root) => { if (root && fs.existsSync(root) && !roots.some(r => r.root.toLowerCase() === root.toLowerCase())) roots.push({ provider, root }); };
  for (const k of ['OneDriveConsumer', 'OneDriveCommercial', 'OneDrive']) add('OneDrive', env[k]);
  for (const base of [env.APPDATA, env.LOCALAPPDATA]) {
    try {
      const info = JSON.parse(fs.readFileSync(path.join(base || '', 'Dropbox', 'info.json'), 'utf8'));
      add('Dropbox', info.personal?.path); add('Dropbox', info.business?.path);
    } catch { /* no Dropbox */ }
  }
  add('iCloud Drive', path.join(home, 'iCloudDrive'));
  for (const d of 'GHIJKLMNOPQRSTUVWXYZ') add('Google Drive', `${d}:\\My Drive`);
  const v = VAULT.toLowerCase();
  let hit = roots.find(r => v === r.root.toLowerCase() || v.startsWith(r.root.toLowerCase() + path.sep));
  // A folder that is only *named* like a cloud folder (but isn't one this PC's cloud app is set up to sync)
  // is not treated as synced; it's reported separately so the app can say so.
  let nameOnly = null;
  if (!hit) {
    const m = VAULT.match(/[\\/](OneDrive[^\\/]*|Dropbox|Google Drive|My Drive|iCloud ?Drive)([\\/]|$)/i);
    if (m) nameOnly = /onedrive/i.test(m[1]) ? 'OneDrive' : /dropbox/i.test(m[1]) ? 'Dropbox' : /icloud/i.test(m[1]) ? 'iCloud Drive' : 'Google Drive';
  }
  if (!hit) { // Syncthing marks synced folders with .stfolder
    for (let d = VAULT; ; d = path.dirname(d)) {
      if (fs.existsSync(path.join(d, '.stfolder'))) { hit = { provider: 'Syncthing', root: d }; break; }
      if (path.dirname(d) === d) break;
    }
  }
  // "configured": inside the folder a cloud app is set up to sync. Graphite can't see whether uploads finished,
  // so it never claims they did (uploaded stays unknown).
  return { vault: VAULT, provider: hit?.provider || null, root: hit?.root || null, configured: !!hit?.root, nameOnly, available: roots };
}

async function serveFile(res, abs, req) {
  try {
    const st = await fsp.stat(abs);
    if (!st.isFile()) throw new Error();
    const type = MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream';
    // Byte ranges, so videos and audio can be scrubbed and long PDFs load progressively.
    const m = /^bytes=(\d*)-(\d*)$/.exec(req?.headers?.range || '');
    if (m && (m[1] !== '' || m[2] !== '') && st.size > 0) {
      const start = m[1] === '' ? Math.max(0, st.size - Number(m[2])) : Number(m[1]);
      const end = m[1] !== '' && m[2] !== '' ? Math.min(Number(m[2]), st.size - 1) : st.size - 1;
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { 'Content-Type': type, 'Content-Length': end - start + 1, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
      fs.createReadStream(abs, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
    fs.createReadStream(abs).pipe(res);
  } catch { send(res, 404, 'Not found', 'text/plain'); }
}

// Live updates: tell open browser tabs when files change on disk (e.g. edited in another program).
const clients = new Set();
function broadcast(data) { for (const c of clients) c.write(`data: ${JSON.stringify(data)}\n\n`); }
setInterval(() => { for (const c of clients) c.write(': ping\n\n'); }, 25000).unref();

function startWatcher() {
  let timer = null; const pending = new Set();
  try {
    fs.watch(VAULT, { recursive: true }, (_ev, f) => {
      if (!f) return;
      const rel = String(f).split(path.sep).join('/');
      if (rel.split('/').some(s => s.startsWith('.')) || JUNK.test(path.basename(rel))) return;
      pending.add(rel);
      clearTimeout(timer);
      timer = setTimeout(() => { broadcast({ changed: [...pending] }); pending.clear(); }, 150);
    });
  } catch (e) { console.warn('File watching unavailable:', e.message); }
}

const server = http.createServer(async (req, res) => {
  try {
    // Only answer requests addressed to this machine (blocks DNS-rebinding tricks).
    const host = (req.headers.host || '').replace(/:\d+$/, '');
    if (!['localhost', '127.0.0.1', '[::1]'].includes(host)) throw new HttpError(403, 'Forbidden host');
    if (TOKEN && req.headers['x-app-token'] !== TOKEN) throw new HttpError(403, 'Forbidden');
    const u = new URL(req.url, 'http://localhost');
    if (u.pathname.startsWith('/api/')) {
      // Writes need a custom header, which other websites cannot send without a CORS preflight we never approve.
      if (req.method !== 'GET' && req.headers['x-vault'] !== '1') throw new HttpError(403, 'Missing X-Vault header');
      return await api(req, res, u);
    }
    if (LIBS[u.pathname]) return serveFile(res, LIBS[u.pathname]);
    if (u.pathname.startsWith('/lib/katex/')) { // KaTeX math: scripts, stylesheet and fonts
      const base = path.join(NM, 'katex', 'dist');
      const abs = path.resolve(base, '.' + decodeURIComponent(u.pathname.slice('/lib/katex'.length)));
      if (!abs.startsWith(base + path.sep)) throw new HttpError(404, 'Not found');
      return serveFile(res, abs);
    }
    if (u.pathname.startsWith('/lib/pdfjs/')) { // PDF.js: the PDF viewer, its worker, fonts and character maps
      const base = path.join(NM, 'pdfjs-dist');
      const abs = path.resolve(base, '.' + decodeURIComponent(u.pathname.slice('/lib/pdfjs'.length)));
      const top = path.relative(base, abs).split(path.sep)[0];
      if (!['build', 'web', 'cmaps', 'standard_fonts', 'wasm', 'iccs'].includes(top) || abs.endsWith('.map')) throw new HttpError(404, 'Not found');
      return serveFile(res, abs);
    }
    const icon = u.pathname.match(/^\/lib\/lucide\/([a-z0-9-]+)\.svg$/);
    if (icon) return serveFile(res, path.join(LUCIDE, icon[1] + '.svg'));
    if (u.pathname.startsWith('/vault/')) return serveFile(res, inVault(decodeURIComponent(u.pathname.slice(7))), req);
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const abs = path.resolve(PUBLIC, '.' + p);
    if (!abs.startsWith(PUBLIC + path.sep)) throw new HttpError(404, 'Not found');
    return serveFile(res, abs);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || String(e) });
    if (!e.status) console.error(e);
  }
});

function openBrowser(url) {
  if (NO_OPEN) return;
  if (process.platform === 'win32') exec(`start "" msedge --app=${url}`, err => { if (err) exec(`start "" "${url}"`); });
  else exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} "${url}"`);
}

// Start serving a vault. port 0 picks a free port. Resolves to the port actually used.
async function start({ vault, port = 0, token = null, retry = 0 } = {}) {
  VAULT = path.resolve(vault);
  CONFIG_DIR = path.join(VAULT, '.obsidian');
  PLUGIN_DIR = path.join(CONFIG_DIR, 'plugins');
  TOKEN = token;
  await fsp.mkdir(VAULT, { recursive: true });
  startWatcher();
  return new Promise((resolve, reject) => {
    let p = port;
    server.on('error', e => {
      if (e.code === 'EADDRINUSE' && p && p < port + retry) { p++; server.listen(p, '127.0.0.1'); }
      else reject(e);
    });
    server.on('listening', () => resolve(server.address().port));
    server.listen(p, '127.0.0.1');
  });
}
module.exports = { start };

// Browser mode (node server.js).
if (require.main === module) {
  const vault = process.argv.slice(2).find(a => !a.startsWith('--')) || process.env.VAULT || path.join(__dirname, 'vault');
  start({ vault, port: Number(process.env.PORT) || 3000, retry: 20 }).then(port => {
    const url = `http://localhost:${port}`;
    console.log(`\n  Graphite is running at ${url}\n  Vault: ${VAULT}\n  Press Ctrl+C to stop.\n`);
    openBrowser(url);
  }).catch(e => { console.error(e); process.exit(1); });
}
