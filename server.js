#!/usr/bin/env node
'use strict';
// Graphite — a tiny local server that serves the app and reads/writes a vault of Markdown files.
// Browser mode:  node server.js [path-to-vault]   (default: ./vault)   Env: PORT, VAULT, NO_OPEN=1
// Desktop mode:  the Electron app calls require('./server').start({ vault, port: 0, token }).

const http = require('http');
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const { createHash, randomUUID } = require('node:crypto');
const { exec } = require('child_process');
const { createFile } = require('./new-file');

let VAULT = '', CONFIG_DIR = '', PLUGIN_DIR = '';
let TOKEN = null; // desktop app: every request must carry this secret, so other programs can't use the server
let canvas;
const VERSION = require('./package.json').version;
const PUBLIC = path.join(__dirname, 'public');
const NM = path.join(__dirname, 'node_modules');
const SOURCE_FORMATS = require('./public/source-formats.json');
const SOURCE_LIMIT = 2 * 1024 * 1024;
const sourceRevision = bytes => createHash('sha256').update(bytes).digest('hex');
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
  mock: { type: 'object', additionalProperties: false, required: ['title', 'problems', 'topics'], properties: { title: { type: 'string' },
    problems: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['no', 'marks', 'kind', 'sourceFile', 'sourcePage', 'sourceLabel', 'topic', 'question', 'answer'],
      properties: { no: { type: 'string' }, marks: { type: 'integer' }, kind: { type: 'string', enum: ['past', 'variant', 'new'] }, sourceFile: { type: 'string' }, sourcePage: { type: 'integer' },
        sourceLabel: { type: 'string' }, topic: { type: 'string' }, question: { type: 'string' }, answer: { type: 'string' } } } },
    topics: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['topic', 'pastCount', 'note'], properties: { topic: { type: 'string' }, pastCount: { type: 'integer' }, note: { type: 'string' } } } } } },
  connect: { type: 'object', additionalProperties: false, required: ['related'], properties: { related: { type: 'array', items: {
    type: 'object', additionalProperties: false, required: ['title', 'why'], properties: { title: { type: 'string' }, why: { type: 'string' } } } } } },
  format: { type: 'object', additionalProperties: false, required: ['markdown', 'changes'], properties: { markdown: { type: 'string' }, changes: { type: 'array', items: { type: 'string' } } } },
  summary: { type: 'object', additionalProperties: false, required: ['title', 'overview', 'sections', 'concepts', 'formulas'], properties: {
    title: { type: 'string' }, overview: { type: 'string' },
    sections: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['heading', 'page', 'points'], properties: { heading: { type: 'string' }, page: { type: 'integer' },
      points: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'page'], properties: { text: { type: 'string' }, page: { type: 'integer' } } } } } } },
    concepts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['term', 'meaning', 'page'], properties: { term: { type: 'string' }, meaning: { type: 'string' }, page: { type: 'integer' } } } },
    formulas: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['latex', 'meaning', 'page'], properties: { latex: { type: 'string' }, meaning: { type: 'string' }, page: { type: 'integer' } } } } } },
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
  mock: ui => `You write a mock exam paper for a university student, modelled on their course's past papers.
The input gives: the course, the time and number of problems wanted, the mix (how many past, adapted and new problems), the past papers' text (with "--- page N ---" markers, inside <past_paper file="..."> tags), the notes in range (titles, headings and their quiz questions), and the student's weak spots (mistake book, cards they keep failing).
- Copy the past papers' shape: kinds of problems, wording, difficulty, how marks are split. The notes in range decide which topics may appear; never test anything outside them.
- kind "past": a problem copied from a past paper as it was set. kind "variant": a past problem with new numbers or a changed setting. kind "new": a problem none of the past papers asked, aimed at a weak spot or an untested topic in range.
- For past and variant problems: sourceFile is the exact file="..." of that past paper, sourcePage the page it is on, sourceLabel a short label such as "2024 midterm Q4". For new problems: sourceFile is the note it tests (exact title from the list, without .md), sourcePage 0, sourceLabel the note title.
- Give every problem a full worked answer (steps, not only the result). Maths in $...$ / $$...$$. marks are whole numbers; their total should be about 100 unless the past papers use another total.
- Write problems in the language the past papers use; write topic, sourceLabel and topics[].note in ${ui}.
- topics: each topic in range with how many times it appears across the past papers given (pastCount) and a short note on why it is in this paper or not.
title: a short title such as "<course> mock paper".`,
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
  summary: ui => `You summarize one PDF (lecture slides, a textbook chapter, notes) for a university student, so they can review it and jump back to the right page.
The input is the PDF's text with "--- page N ---" markers (only the pages chosen), or, for a local agent, the file itself and the page range.
- Follow the document's own chapters or sections, in order. For each: heading (as in the document, or a short one), page (where it starts), and 2–6 points: the key ideas, each one or two sentences, with the page it comes from.
- concepts: the key terms and definitions (term, one-sentence meaning, page). formulas: the important formulas or theorems (LaTeX without $ signs, what it means, page). Empty lists if there are none.
- overview: two or three sentences on what the document covers.
- Use only what the given pages say. Every page number must be one of the pages given; never invent pages. If a page has no text (scanned), say so in the overview instead of guessing its content.
- Write in ${ui}; keep technical terms as the document writes them. Maths in $...$ inside text.
title: a short note title such as "<document name> summary".`,
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
  mock: { title: 'Linear Algebra mock paper', problems: [{ no: '1', marks: 10, kind: 'past', sourceFile: 'LA/复习资料/2024 midterm.pdf', sourcePage: 2, sourceLabel: '2024 midterm Q4', topic: 'Determinants', question: 'Compute $\\det A$ for ...', answer: 'Expand along the first row: ...' }], topics: [{ topic: 'Determinants', pastCount: 3, note: 'appears every year' }] },
  format: { markdown: 'the whole reformatted note', changes: ['Added frontmatter', 'Numbered the key points'] },
  summary: { title: 'Lecture 3 summary', overview: 'What the lecture covers.', sections: [{ heading: '3.1 Eigenvalues', page: 2, points: [{ text: 'An eigenvector keeps its direction under $A$.', page: 2 }] }], concepts: [{ term: 'Eigenvalue', meaning: 'A scalar $\\lambda$ with $Av = \\lambda v$ for some $v \\neq 0$.', page: 2 }], formulas: [{ latex: '\\det(A - \\lambda I) = 0', meaning: 'characteristic equation', page: 3 }] },
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
  else if (task === 'mock') {
    out.title = String(out.title || '');
    out.problems = (Array.isArray(out.problems) ? out.problems : []).filter(x => x && typeof x === 'object' && x.question).map((x, i) => ({
      no: String(x.no ?? i + 1), marks: Number.isFinite(+x.marks) ? Math.max(0, Math.round(+x.marks)) : 0, kind: ['past', 'variant', 'new'].includes(x.kind) ? x.kind : 'new',
      sourceFile: String(x.sourceFile || ''), sourcePage: Number.isFinite(+x.sourcePage) ? Math.max(0, Math.round(+x.sourcePage)) : 0, sourceLabel: String(x.sourceLabel || ''),
      topic: String(x.topic || ''), question: String(x.question), answer: String(x.answer || '') }));
    out.topics = (Array.isArray(out.topics) ? out.topics : []).filter(x => x && x.topic).map(x => ({ topic: String(x.topic), pastCount: Math.max(0, Math.round(+x.pastCount || 0)), note: String(x.note || '') }));
    if (!out.problems.length) throw new SyntaxError('empty');
  }
  else if (task === 'connect') out.related = (Array.isArray(out.related) ? out.related : []).filter(x => x && x.title).map(x => ({ title: String(x.title), why: String(x.why || '') }));
  else if (task === 'format') { out.markdown = String(out.markdown || ''); out.changes = Array.isArray(out.changes) ? out.changes.map(String) : []; if (!out.markdown) throw new SyntaxError('empty'); }
  else if (task === 'summary') {
    const pg = x => (Number.isFinite(+x) ? Math.max(0, Math.round(+x)) : 0);
    const arr = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object') : []);
    out.title = String(out.title || ''); out.overview = String(out.overview || '');
    out.sections = arr(out.sections).map(s => ({ heading: String(s.heading || ''), page: pg(s.page), points: arr(s.points).map(p => ({ text: String(p.text || ''), page: pg(p.page) })).filter(p => p.text) })).filter(s => s.heading || s.points.length);
    out.concepts = arr(out.concepts).map(c => ({ term: String(c.term || ''), meaning: String(c.meaning || ''), page: pg(c.page) })).filter(c => c.term);
    out.formulas = arr(out.formulas).map(f => ({ latex: String(f.latex || ''), meaning: String(f.meaning || ''), page: pg(f.page) })).filter(f => f.latex);
    if (!out.sections.length && !out.overview) throw new SyntaxError('empty');
  }
  return out;
}

// One request to an OpenAI-compatible provider, with readable errors. Shared by AI jobs and the agent (agent.js).
// GRAPHITE_TEST_AI_BASE (tests only) sends every provider's requests to a fake local server instead.
function compatCaller(provider, key, body) {
  const P = COMPAT[provider];
  let base = P.base;
  if (provider === 'custom') {
    base = String(body.baseUrl || '').trim().replace(/\/+$/, '');
    if (!/^https?:\/\/\S+$/i.test(base)) throw new HttpError(400, 'Enter the API base URL for your custom provider (e.g. https://example.com/v1)');
  }
  if (process.env.GRAPHITE_TEST_AI_BASE) base = process.env.GRAPHITE_TEST_AI_BASE;
  const name = P.name;
  const call = async (pathname, init = {}) => {
    let r;
    try {
      const limit = AbortSignal.timeout(240000);
      r = await fetch(base + pathname, { ...init, headers: { ...(key ? { Authorization: `Bearer ${key}` } : {}), 'Content-Type': 'application/json' }, signal: init.signal ? AbortSignal.any([init.signal, limit]) : limit });
    } catch (e) {
      if (init.signal?.aborted) throw new HttpError(499, 'Stopped');
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
  return { P, name, call };
}

async function compatTask(provider, key, body, signal) {
  const { P, name, call } = compatCaller(provider, key, body);
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
    messages = [{ role: 'system', content: `${body.__system || prompt(LANG_NAMES[body.lang] || 'English')}\n\nReply with JSON only, in exactly this format:\n${JSON.stringify(AI_EXAMPLES[body.task], null, 2)}` },
      { role: 'user', content: noteBlock(body) }];
  } else messages = [{ role: 'system', content: body.__system || prompt() }, ...chatMessages(body)];
  const tokens = P.tokens || 'max_tokens';
  const full = { model, messages, [tokens]: 16000, ...(json ? { response_format: { type: 'json_object' } } : {}), ...(P.extra || {}) };
  const plain = { model, messages, [tokens]: 16000 };
  for (let attempt = 0; attempt < 3; attempt++) {
    let r;
    try { r = await call('/chat/completions', { method: 'POST', body: JSON.stringify(attempt === 0 ? full : plain), signal }); }
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
const anthropicSDK = () => { AnthropicSDK ||= require('@anthropic-ai/sdk'); return AnthropicSDK.default || AnthropicSDK; };
function anthropicClient(key) {
  if (!key) throw new HttpError(400, 'No API key');
  const Anthropic = anthropicSDK();
  return new Anthropic({ apiKey: key, timeout: 240000, maxRetries: 1 });
}
// Anthropic SDK errors as readable messages (used by the agent; anthropicTask has its own copy for JSON jobs).
function anthropicError(e, model) {
  const Anthropic = anthropicSDK();
  if (e instanceof HttpError) return e;
  if (e instanceof Anthropic.APIUserAbortError) return new HttpError(499, 'Stopped');
  if (e instanceof Anthropic.AuthenticationError) return new HttpError(401, 'The Anthropic API key was not accepted');
  if (e instanceof Anthropic.PermissionDeniedError) return new HttpError(403, 'This API key may not use that model');
  if (e instanceof Anthropic.NotFoundError) return new HttpError(404, `Model not available for this key (${model})`);
  if (e instanceof Anthropic.RateLimitError) return new HttpError(429, 'Too many requests or no credit left; try again later');
  if (e instanceof Anthropic.APIConnectionTimeoutError) return new HttpError(504, 'Claude took longer than 4 minutes to answer; try again, or pick a faster model');
  if (e instanceof Anthropic.APIConnectionError) return new HttpError(502, 'Could not reach Anthropic (check your internet connection)');
  if (e instanceof Anthropic.APIError) return new HttpError(502, `Anthropic error ${e.status ?? ''}: ${e.message}`);
  return e;
}
async function anthropicTask(key, body, signal) {
  const client = anthropicClient(key);
  const Anthropic = anthropicSDK();
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
      system: body.__system || (json ? prompt(LANG_NAMES[body.lang] || 'English') : prompt()),
      messages: json ? [{ role: 'user', content: noteBlock(body) }] : chatMessages(body),
      output_config: json
        ? { format: { type: 'json_schema', schema: AI_SCHEMAS[body.task] }, effort: body.task === 'questions' ? 'low' : 'medium' }
        : { effort: 'low' },
    };
    // Opus and Sonnet 5.5: if a safety check declines, Anthropic retries on a suitable model automatically.
    const fallback = /^claude-(opus|sonnet)-5-5$/.test(model);
    const r = fallback
      ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal })
      : await client.messages.create(params, { signal });
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

// The instructions for a job: the job's own, in the language it should write in, plus the study settings it uses
// (Study settings: the same for every AI). Used for API models and local frameworks alike.
async function jobSystem(task, body) {
  const p = await study.get();
  const ui = LANG_NAMES[body.lang] || 'English';
  const base = task === 'chat' ? AI_PROMPTS.chat() : AI_PROMPTS[task](PROFILE.outputLanguage(task, p, ui));
  const block = PROFILE.promptBlock(task, p, study.file());
  return block ? base + '\n\n' + block : base;
}
async function aiTask(req) {
  const key = String(req.headers['x-ai-key'] || '').trim();
  const body = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString('utf8') || '{}');
  delete body.__system;
  if (AI_PROMPTS[body.task]) body.__system = await jobSystem(body.task, body);
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
const { officeToPdf, isPdf, copyPdfNew, error: officeError } = require('./extensions/claude-code/skills/obsidian-import/scripts/office-pdf.cjs');
const officePreviews = new Map();
async function officePdf(rel, save) {
  if (!OFFICE.test(rel)) throw new HttpError(400, 'Not a Word or PowerPoint file');
  const src = inVault(rel);
  let st;
  try { st = await fsp.stat(src); }
  catch(e) { throw officeError(['ENOENT','ENOTDIR'].includes(e.code) ? 'officeSourceMissing' : 'officeSourceUnreadable',src); }
  if (!st.isFile() || !st.size) throw officeError('officeInvalidDocument',src);
  const cacheRel = PDF_CACHE + '/' + hash(toRel(src) + '|' + st.size + '|' + st.mtimeMs) + '.pdf';
  const cacheAbs = inVault(cacheRel);
  if (!await isPdf(cacheAbs)) {
    if (!officePreviews.has(cacheAbs)) {
      const fill = officeToPdf(src, cacheAbs).finally(() => officePreviews.delete(cacheAbs));
      officePreviews.set(cacheAbs, fill);
    }
    await officePreviews.get(cacheAbs);
  }
  if (!save) return { pdf: cacheRel };
  const saved = await copyPdfNew(cacheAbs, src.replace(OFFICE, '.pdf'));
  return { pdf: cacheRel, saved: toRel(saved) };
}

function inVault(rel) {
  if (typeof rel !== 'string' || !rel.trim()) throw new HttpError(400, 'Missing path');
  const abs = path.resolve(VAULT, rel.replace(/^[/\\]+/, ''));
  if (abs !== VAULT && !abs.startsWith(VAULT + path.sep)) throw new HttpError(400, 'Path escapes the vault');
  return abs;
}
const CANVAS_ATTACHMENT_LIMIT = 64 * 1024 * 1024;
const ADDITIONAL_UPLOAD_TYPES = {
  '.doc': 'application/msword', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.odt': 'application/vnd.oasis.opendocument.text', '.zip': 'application/zip', '.ipynb': 'application/x-ipynb+json',
};

// The assignment picker lists ordinary vault files. Serve the original bytes, including binary handouts.
async function canvasVaultFile(res, rel) {
  const abs = inVault(rel);
  const parts = rel.split(/[\\/]/);
  if (parts.some(p => !p || p.startsWith('.') || p.toLowerCase() === 'node_modules' || JUNK.test(p) || /[:\x00-\x1f]/.test(p))) {
    throw new HttpError(400, '请选择笔记库中可见的文件。');
  }
  let handle;
  try {
    const [root, actual] = await Promise.all([fsp.realpath(VAULT), fsp.realpath(abs)]);
    if (path.relative(path.join(root, ...parts), actual) !== '') throw new HttpError(400, '请选择笔记库中的原文件。');
    if (!(await fsp.lstat(actual)).isFile()) throw new HttpError(400, '请选择一个文件。');
    handle = await fsp.open(actual, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const info = await handle.stat();
    if (!info.isFile()) throw new HttpError(400, '请选择一个文件。');
    if (info.size > CANVAS_ATTACHMENT_LIMIT) throw new HttpError(413, '附件超过 64 MiB。');
    const ext = path.extname(actual).toLowerCase();
    const fileType = MIME[ext]?.split(';')[0] || ADDITIONAL_UPLOAD_TYPES[ext] || (Object.hasOwn(SOURCE_FORMATS, ext.slice(1)) ? 'text/plain' : 'application/octet-stream');
    res.writeHead(200, {'Content-Type':'application/octet-stream', 'Content-Disposition':'attachment', 'X-Graphite-File-Type':fileType,
      'Content-Length':info.size, 'X-Content-Type-Options':'nosniff', 'Cache-Control':'no-store'});
    if (!info.size) return res.end();
    const { pipeline } = require('node:stream/promises');
    await pipeline(handle.createReadStream({end:info.size - 1}), res);
  } catch (e) {
    if (res.headersSent) { res.destroy(); return; }
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw new HttpError(404, '文件已移动或删除，请重新选择。');
    throw e;
  } finally { if (handle) await handle.close(); }
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
async function atomicWrite(abs, body, { mode, beforeReplace } = {}) {
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.${path.basename(abs)}.${randomUUID()}.tmp`);
  // Windows can refuse to replace a file another program has open for a moment (antivirus, cloud sync):
  // try the rename again for a while. Never fall back to writing over the original in place: a write that
  // fails half way (disk full) would leave half a file. If it can't be replaced, the original stays whole
  // and the save is reported as failed, so the app keeps the text and tries again.
  const temporary = await fsp.open(tmp, 'wx', mode);
  try {
    try { await temporary.writeFile(body); } finally { await temporary.close(); }
    if (mode !== undefined && process.platform !== 'win32') await fsp.chmod(tmp, mode);
    for (let i = 0; ; i++) {
      if (beforeReplace) await beforeReplace();
      try { await fsp.rename(tmp, abs); return; }
      catch (e) {
        const busy = e.code === 'EPERM' || e.code === 'EACCES' || e.code === 'EBUSY';
        if (!busy) throw e;
        if (i >= 7) throw new HttpError(503, 'The file is in use by another program; it was not changed. Try again.');
        await new Promise(r => setTimeout(r, 40 * 2 ** Math.min(i, 4)));
      }
    }
  } catch (err) {
    await fsp.unlink(tmp).catch(() => {});
    throw err;
  }
}

// Use the same visible directories as the file tree. Only ordinary source files are editable.
async function sourcePath(rel) {
  const abs = inVault(rel);
  const parts = rel.split(/[\\/]/);
  if (!Object.hasOwn(SOURCE_FORMATS, path.extname(abs).slice(1).toLowerCase()) ||
      parts.some(p => !p || p.startsWith('.') || p.toLowerCase() === 'node_modules' || /[:\x00-\x1f]/.test(p))) {
    throw new HttpError(400, 'Unsupported source path');
  }
  const [root, parent] = await Promise.all([fsp.realpath(VAULT), fsp.realpath(path.dirname(abs))]);
  const relative = path.relative(root, parent);
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative) ||
      relative.split(path.sep).some(p => p.startsWith('.') || p.toLowerCase() === 'node_modules')) {
    throw new HttpError(400, 'Invalid source directory');
  }
  return path.join(parent, path.basename(abs));
}

async function readSource(abs) {
  const st = await fsp.lstat(abs);
  if (!st.isFile()) throw new HttpError(400, 'Not a regular source file');
  if (st.size > SOURCE_LIMIT) return { editable: false, reason: 'size' };
  const bytes = await fsp.readFile(abs);
  if (bytes.length > SOURCE_LIMIT) return { editable: false, reason: 'size' };
  let raw;
  try { raw = decodeSource(bytes); } catch { return { editable: false, reason: 'encoding' }; }
  const endings = new Set(raw.match(/\r\n|\r|\n/g));
  const content = raw.replace(/\r\n?/g, '\n');
  if (endings.size > 1) return { editable: false, reason: 'mixed-eol', content };
  const eol = endings.has('\r\n') ? 'CRLF' : endings.has('\r') ? 'CR' : 'LF';
  return { editable: true, content, eol, bom: bytes.subarray(0, 3).equals(UTF8_BOM), revision: sourceRevision(bytes), mode: st.mode & 0o777, mtime: st.mtimeMs };
}

const UTF8_BOM = Buffer.from([0xef, 0xbb, 0xbf]);
function decodeSource(bytes, literalBom = false) {
  if (bytes.includes(0)) throw new Error('binary');
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: literalBom }).decode(bytes);
}

async function sourceFile(req, res, rel) {
  let abs;
  try {
    abs = await sourcePath(rel);
    if (req.method === 'GET') return send(res, 200, await readSource(abs));
    const creating = req.method === 'POST';
    if (!creating && req.method !== 'PUT') throw new HttpError(405, 'Unsupported source operation');
    const base = req.headers['x-base-hash'];
    if (!creating && !/^[a-f\d]{64}$/.test(base || '')) throw new HttpError(428, 'Missing file revision');
    const body = await readBody(req, SOURCE_LIMIT + 4);
    let content;
    try { content = decodeSource(body, true).replace(/\r\n?/g, '\n'); }
    catch { throw new HttpError(400, 'Expected UTF-8 source text'); }
    return await withFileLock(abs, async () => {
      let bom = false, eol = 'LF', current;
      if (creating) {
        eol = req.headers['x-source-eol'] || 'LF';
        const mark = req.headers['x-source-bom'] || '0';
        if (!['LF', 'CRLF', 'CR'].includes(eol) || !['0', '1'].includes(mark)) throw new HttpError(400, 'Invalid source format');
        bom = mark === '1';
      } else {
        current = await readSource(abs);
        if (!current.editable) throw new HttpError(409, 'changed');
        ({ bom, eol } = current);
      }
      const lineEnd = { LF: '\n', CRLF: '\r\n', CR: '\r' }[eol];
      const bytes = Buffer.from((bom ? '\uFEFF' : '') + content.replace(/\n/g, lineEnd), 'utf8');
      if (bytes.length > SOURCE_LIMIT) throw new HttpError(413, 'Source file is too large');
      const revision = sourceRevision(bytes);
      if (creating) {
        await createFile(abs, bytes);
      } else if (current.revision !== revision) {
        if (current.revision !== base) throw new HttpError(409, 'changed');
        if (!(current.mode & 0o222)) throw new HttpError(403, 'File is read-only');
        await atomicWrite(abs, bytes, { mode: current.mode, beforeReplace: async () => {
          const latest = await readSource(abs);
          if (latest.revision !== base) throw new HttpError(409, 'changed');
        } });
      }
      return send(res, 200, { revision, eol, bom, mtime: (await fsp.stat(abs)).mtimeMs });
    });
  } catch (err) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') throw new HttpError(404, 'Source file or directory not found');
    if (err.code === 'EEXIST') throw new HttpError(409, 'exists');
    throw err;
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
  await withFileLock(path.join(trash,'.entries'),async()=>{
    await fsp.rename(abs,await uniquePath(path.join(trash,path.basename(abs))));
  });
}

async function savePluginRelease(dir, files) {
  // The release files are all available. Update just those files, leaving data.json and
  // any other user files in place. The manifest is written last.
  await withFileLock(dir,async()=>{
    const created=await fsp.mkdir(dir,{recursive:true});
    const old = new Map();
    async function read(file) {
      try {return await fsp.readFile(file);}
      catch (e) {if (e.code === 'ENOENT') return null; throw e;}
    }
    for (const name of Object.keys(files)) old.set(name,await read(path.join(dir,name)));
    const changed=[];
    try {
      for (const [name,bytes] of Object.entries(files)) {
        const previous=old.get(name), target=path.join(dir,name);
        if (bytes===null ? previous===null : previous?.equals(bytes)) continue;
        if (bytes===null) await fsp.unlink(target); else await atomicWrite(target,bytes);
        changed.push(name);
      }
    } catch (err) {
      for (const name of changed.reverse()) {
        const target=path.join(dir,name), current=await read(target), published=files[name], previous=old.get(name);
        if (published===null ? current!==null : !current?.equals(published)) continue;
        if (previous===null) await fsp.unlink(target); else await atomicWrite(target,previous);
      }
      if (created) await fsp.rmdir(dir).catch(()=>{});
      throw err;
    }
  });
}

async function api(req, res, u) {
  const route = u.pathname.slice('/api/'.length), m = req.method, q = u.searchParams;
  if (route.startsWith('canvas/')) {
    if (route === 'canvas/vault-file' && m === 'GET') return canvasVaultFile(res, q.get('path'));
    let body = {};
    if (route === 'canvas/submit' && m === 'POST') {
      const limit=CANVAS_ATTACHMENT_LIMIT;
      const mime=req.headers['content-type']||'';
      if(!mime.toLowerCase().startsWith('multipart/form-data;'))throw new HttpError(415,'请从作业预览页提交。');
      if(Number(req.headers['content-length'])>limit+512*1024)throw new HttpError(413,'一次最多提交 64 MiB。');
      const raw=await readBody(req,limit+512*1024);
      let parts;
      try{parts=await new Response(raw,{headers:{'Content-Type':mime}}).formData();}
      catch{throw new HttpError(400,'附件内容不完整，请重新选择。');}
      const files=parts.getAll('files');
      if(files.length>20 || files.some(f=>typeof f.arrayBuffer!=='function') || files.reduce((sum,f)=>sum+f.size,0)>limit)throw new HttpError(413,'一次最多 20 个附件，共 64 MiB。');
      const field=name=>typeof parts.get(name)==='string'?parts.get(name):'';
      body={files,courseId:field('courseId'),assignmentId:field('assignmentId'),type:field('type'),text:field('text'),url:field('url'),
        requestId:field('requestId'),expectedAttempt:/^\d+$/.test(field('expectedAttempt'))?Number(field('expectedAttempt')):null,confirmed:field('confirmed')==='true'};
    } else if (m === 'POST') {
      const raw = await readBody(req, 16 * 1024);
      try { body = JSON.parse(raw.toString('utf8') || '{}'); }
      catch { throw new HttpError(400, 'Invalid JSON'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid request');
    }
    return send(res, 200, await canvas.handle(m, route.slice(7), body));
  }

  if (route === 'all' && m === 'GET') return send(res, 200, { vault: VAULT, version: VERSION, ...(await walk(VAULT, { folders: [], files: [] }, true)) });
  if (route === 'list' && m === 'GET') return send(res, 200, await walk(VAULT, { folders: [], files: [] }, false));

  if (route === 'source') return sourceFile(req, res, q.get('path'));
  if (route === 'note-links' && m === 'POST') {
    let selection;
    try { selection = JSON.parse(await readBody(req, 1024 * 1024)); } catch (e) { if (e.status) throw e; throw new HttpError(400, 'Invalid JSON'); }
    return send(res, 200, await connectNotes(selection));
  }

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
      try { await createFile(abs, body); }
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
      if (abs === VAULT) throw new HttpError(400,'Choose a file or folder inside the vault');
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
    if (b.startsWith(a + path.sep)) throw new HttpError(400, 'Cannot move a folder into itself');
    await withFileLock(b,async()=>{
      const samePath = a === b || (process.platform === 'win32' && a.toLowerCase() === b.toLowerCase());
      if (!samePath && await exists(b)) throw new HttpError(409, 'Something already exists at ' + to);
      await fsp.rename(a,b);
    });
    return send(res, 200, { path: toRel(b) });
  }

  if (route === 'upload' && m === 'POST') {
    const requested = inVault(q.get('path'));
    if (requested === VAULT) throw new HttpError(400,'Choose an attachment name');
    const body = await readBody(req);
    await fsp.mkdir(path.dirname(requested),{recursive:true});
    const abs = await createFile(requested, body, {choosePath:uniquePath});
    const st = await fsp.stat(abs);
    return send(res,200,{path:toRel(abs),mtime:st.mtimeMs,size:st.size});
  }

  // ---- Study settings (shared by every AI): read, save, and the one-time move from the two old places
  if (route === 'study-profile' && m === 'GET') {
    const saved = await study.load();
    return send(res, 200, { profile: saved || { ...study.DEFAULTS }, saved: !!saved, file: study.file(), vault: VAULT, differences: saved?.differences || [], claude: await study.fromClaude() });
  }
  if (route === 'study-profile' && m === 'POST') {
    const input = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
    if (input.migrate) {
      if (await study.load()) return send(res, 200, { profile: await study.get(), saved: true, migrated: false, file: study.file() });
      const r = await study.migrate(input.agent || null);
      return send(res, 200, { ...r, saved: true, migrated: true, file: study.file() });
    }
    const prev = await study.load();
    const keep = input.keepDifferences ? prev?.differences : undefined;
    const profile = await study.save({ ...(input.profile || {}), differences: keep });
    return send(res, 200, { profile, saved: true, file: study.file() });
  }

  // ---- Claude Code kit (Settings → Claude Code)
  if (route === 'claude-kit' && m === 'GET') return send(res, 200, await claudeKitStatus());
  if (route === 'claude-kit' && m === 'POST') {
    const input = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
    const r = await installClaudeKit(input);
    return send(res, 200, { ...r, status: await claudeKitStatus() });
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
        plugins.push({ dir: d.name, manifest, builtin: BUILTIN_IDS.has(manifest.id), hasStyles: await exists(path.join(dir, 'styles.css')), hasMain: await exists(path.join(dir, 'main.js')) });
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
      if (!r.ok) { if (optional && (r.status===404 || r.status===410)) return null; throw new HttpError(502, `${file}: HTTP ${r.status}`); }
      return Buffer.from(await r.arrayBuffer());
    };
    const manifestBuf = await get('manifest.json');
    const manifest = JSON.parse(manifestBuf.toString('utf8'));
    if (!/^[\w.-]+$/.test(manifest.id || '')) throw new HttpError(400, 'Invalid plugin id in manifest');
    const mainJs = await get('main.js');
    const styles = await get('styles.css', true);
    const dir = path.join(PLUGIN_DIR, manifest.id);
    await savePluginRelease(dir,{'main.js':mainJs,'styles.css':styles,'manifest.json':manifestBuf});
    return send(res, 200, { id: manifest.id, manifest });
  }

  // Which cloud service (if any) the vault lives in, and which ones exist on this PC.
  if (route === 'sync-info' && m === 'GET') return send(res, 200, await syncInfo());
  if (route === 'ai' && m === 'POST') return send(res, 200, await aiTask(req));
  if (route === 'code-assistant' && m === 'POST') {
    const input = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8') || '{}');
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableFinished) controller.abort(); });
    if (res.destroyed) controller.abort();
    try {
      const answer = await require('./code-assistant')({ input, key: req.headers['x-ai-key'] || '', signal: controller.signal,
        vault: VAULT, frameworks, compat: COMPAT, compatTask, anthropicTask, languages: LANG_NAMES, atomicWrite, HttpError });
      if (!controller.signal.aborted) return send(res, 200, answer);
    } catch (error) { if (!controller.signal.aborted) throw error; }
    return;
  }
  if (route === 'local-ai' && m === 'POST') return send(res, 200, await localAiTask(req, res));
  // Which local frameworks are installed. A custom program path can only come with a POST from the app itself
  // (X-Vault, like every other change), and must name the program (dsh / codex): a web page can't make
  // Graphite start some other program.
  // The course folders the file jobs may read: is each a full path, and does it exist?
  if (route === 'check-folders' && m === 'POST') {
    const b = JSON.parse((await readBody(req, 65536)).toString('utf8') || '{}');
    const out = [];
    for (const p of (Array.isArray(b.paths) ? b.paths : []).slice(0, 50).map(String)) {
      if (!path.isAbsolute(p) || /^[A-Za-z]:[^\\/]/.test(p)) { out.push({ path: p, ok: false, reason: 'notAbsolute' }); continue; }
      const st = await fsp.stat(p).catch(() => null);
      out.push(st && st.isDirectory() ? { path: p, ok: true } : { path: p, ok: false, reason: 'missing' });
    }
    return send(res, 200, out);
  }
  if (route === 'frameworks' && m === 'GET') return send(res, 200, await frameworks.detect({ force: q.get('force') === '1' }));
  if (route === 'frameworks' && m === 'POST') {
    const b = JSON.parse((await readBody(req, 65536)).toString('utf8') || '{}');
    const paths = {}; for (const id of frameworks.ids) if (typeof b.paths?.[id] === 'string' && b.paths[id].trim()) paths[id] = b.paths[id].trim();
    return send(res, 200, await frameworks.detect({ paths, force: !!b.force }));
  }
  // The agent harness (agent.js): import files, file inbox captures, update the Claude Brain with an API model.
  if (route === 'agent' && m === 'POST') return agent.handle(req, res);
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

// Local agent frameworks (DeepSeek Harness, Codex CLI): detection and running, shared by the file jobs and AI jobs.
const frameworks = require('./frameworks')({ HttpError });
// Study settings: one file every AI job reads its folders, courses and languages from (profile.js).
const PROFILE = require('./profile');
const study = PROFILE({ atomicWrite, withFileLock, vault: () => VAULT, claudeDir: () => CLAUDE_DIR() });
const connectNotes = require('./note-links')({ vault: () => VAULT, study, atomicWrite, withFileLock,
  listNotes: async () => (await walk(VAULT, {folders: [], files: []}, false)).files.filter(f => isMd(f.path)).map(f => f.path) });
const agent = require('./agent')({
  HttpError, hash, inVault, toRel, exists, uniquePath, atomicWrite, withFileLock, officeToPdf, readBody, LANG_NAMES, COMPAT, ANTHROPIC_DEFAULT,
  parseJsonReply, compatCaller, anthropicClient, anthropicError, vault: () => VAULT, frameworks, study, PROFILE,
});
// An AI job (Check, quiz questions, chat, plan, exam analysis, mock paper, tidy format, connect) done by a local
// framework: it gets the same instructions as an API model, plus the paths of the files involved, which it may
// open itself (read-only). The answer comes back as the same JSON and goes through the same checks.
async function localAiTask(req, res) {
  const key = String(req.headers['x-ai-key'] || '').trim();
  const body = JSON.parse((await readBody(req, 8 * 1024 * 1024)).toString('utf8') || '{}');
  if (!frameworks.ids.includes(body.framework)) throw new HttpError(400, 'Unknown local framework');
  const prompt = AI_PROMPTS[body.task];
  if (!prompt) throw new HttpError(400, 'Unknown task');
  const files = [...new Set([body.path, ...(Array.isArray(body.files) ? body.files : [])].filter(Boolean).map(String))]
    .map(f => { try { return inVault(f); } catch { return null; } }).filter(Boolean);
  const chat = body.task === 'chat';
  const parts = [await jobSystem(body.task, body), '',
    '## How to work here',
    `You are running as a local agent for Graphite, a notes app. The vault (the user's notes) is the folder: ${VAULT}`,
    files.length ? `Files for this task (open them with your own tools if you need to; the text below may be shortened): ${files.join(' ; ')}` : '',
    'This is read-only: read files in the vault if useful, but do not create, change, move or delete anything, and do not read outside the vault.', ''];
  if (chat) parts.push(...chatMessages(body).map(m => `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`), '', 'Reply with your answer only, in Markdown.');
  else parts.push(noteBlock(body), '', '## Your answer',
    'Reply with exactly one JSON object in this format, between <graphite-result> and </graphite-result>, and nothing after it:',
    JSON.stringify(AI_EXAMPLES[body.task] || {}, null, 1));
  const ctl = new AbortController();
  res.on('close', () => { if (!res.writableFinished) ctl.abort(); }); // the app pressed Stop
  const out = await frameworks.run(body.framework, { prompt: parts.filter(x => x !== null).join('\n'), cwd: VAULT, key, paths: body.frameworkPaths || {}, signal: ctl.signal, mode: 'read', allow: { roots: [VAULT], skip: [] } });
  if (chat) return { text: out.text.replace(/<graphite-result>[\s\S]*?<\/graphite-result>/g, '').trim(), framework: body.framework, reads: out.reads };
  if (!out.result) throw Object.assign(new HttpError(502, 'no result'), { code: 'noResult', framework: body.framework });
  return { ...tidyResult(body.task, out.result), framework: body.framework, reads: out.reads };
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
    if (u.pathname.startsWith('/vault/')) {
      const abs = inVault(decodeURIComponent(u.pathname.slice(7)));
      const rel = path.relative(VAULT, abs).split(path.sep);
      if (rel[0]?.toLowerCase() === 'canvas' && /\.(html?|xhtml|xml|svg|js|mjs)$/i.test(abs)) {
        // Downloaded course materials are third-party documents, served outside the app's execution context.
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'; img-src data:; style-src 'unsafe-inline'");
        res.setHeader('X-Content-Type-Options', 'nosniff');
      }
      return serveFile(res, abs, req);
    }
    let p = decodeURIComponent(u.pathname);
    if (p === '/') p = '/index.html';
    const abs = path.resolve(PUBLIC, '.' + p);
    if (!abs.startsWith(PUBLIC + path.sep)) throw new HttpError(404, 'Not found');
    return serveFile(res, abs);
  } catch (e) {
    if (!res.headersSent) send(res, e.status || 500, { error: e.message || String(e), ...(e.code ? { code: e.code } : {}), ...(Array.isArray(e.paths) ? {paths:e.paths} : {}), ...(e.openUrl ? { openUrl:e.openUrl } : {}), ...(e.framework ? { framework: e.framework, detail: e.detail || '' } : {}) });
    if (!e.status) console.error(e);
  }
});

function openBrowser(url) {
  if (NO_OPEN) return;
  if (process.platform === 'win32') exec(`start "" msedge --app=${url}`, err => { if (err) exec(`start "" "${url}"`); });
  else exec(`${process.platform === 'darwin' ? 'open' : 'xdg-open'} "${url}"`);
}

/* ---------- Built-in extensions (extensions/ in the app) ----------
   obsidian-plugins/: Graphie chat, 🎓 study pages, ✦ Claude Capture. Every vault gets them: a plugin the vault
   has never had is installed and enabled once (so turning it off or deleting it sticks); an older copy gets the
   new code (main.js, manifest.json, styles.css) while its settings (data.json), chat history and import records
   stay. claude-code/: the skills, hooks and settings example that Settings → Claude Code installs. */
const EXT = path.join(__dirname, 'extensions');
const PLUGINS_SHIP = path.join(EXT, 'obsidian-plugins');
const CLAUDE_SHIP = path.join(EXT, 'claude-code');
const newer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
const readJsonFile = async (f, def) => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return def; } };
async function readPluginJson(file, fallback) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw error; }
}
// Copy by reading and writing (works out of the packaged app's archive too).
async function copyOut(from, to) { await fsp.mkdir(path.dirname(to), { recursive: true }); await fsp.writeFile(to, await fsp.readFile(from)); }
let BUILTIN_IDS = new Set();
async function installBuiltinPlugins() {
  const ids = (await fsp.readdir(PLUGINS_SHIP).catch(() => [])).filter(id => fs.existsSync(path.join(PLUGINS_SHIP, id, 'manifest.json')));
  BUILTIN_IDS = new Set(ids);
  if (!ids.length) return;
  const stateFile = path.join(CONFIG_DIR, 'graphite-builtins.json');
  const state = await readPluginJson(stateFile, { offered: [] });
  if (!Array.isArray(state?.offered)) throw new Error('Invalid built-in plugin history: ' + stateFile);
  const offered = new Set(state.offered);
  const enabledFile = path.join(CONFIG_DIR, 'community-plugins.json');
  const enabled = await readPluginJson(enabledFile, []);
  if (!Array.isArray(enabled)) throw new Error('Invalid enabled plugin list: ' + enabledFile);
  let enabledChanged = false;
  for (const id of ids) {
    const sourceDir = path.join(PLUGINS_SHIP, id);
    const manifestBytes = await fsp.readFile(path.join(sourceDir, 'manifest.json'));
    const ship = JSON.parse(manifestBytes);
    const mine = path.join(PLUGIN_DIR, id);
    let have;
    try { have = await readPluginJson(path.join(mine, 'manifest.json'), undefined); }
    catch (error) { console.warn('Skipping unreadable plugin manifest:', id, error.message); continue; }
    if (have !== undefined && (!have || typeof have.id !== 'string')) {
      console.warn('Skipping invalid plugin manifest:', id);
      continue;
    }
    const fresh = !have && !offered.has(id);
    if (have && (have.id !== ship.id || !newer(ship.version, have.version || '0'))) { offered.add(id); continue; }
    if (!have && !fresh) continue; // you removed it: leave it out
    let styles = null;
    try { styles = await fsp.readFile(path.join(sourceDir, 'styles.css')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await savePluginRelease(mine, {'main.js':await fsp.readFile(path.join(sourceDir,'main.js')), 'styles.css':styles, 'manifest.json':manifestBytes});
    if (fresh && !enabled.includes(id)) { enabled.push(id); enabledChanged = true; }
    offered.add(id);
  }
  if (enabledChanged) await atomicWrite(enabledFile, JSON.stringify(enabled, null, 2));
  await atomicWrite(stateFile, JSON.stringify({ offered: [...offered] }, null, 2));
}

/* ---------- Claude Code kit: skills, hooks and the settings they read ---------- */
const CLAUDE_DIR = () => process.env.GRAPHITE_CLAUDE_DIR || path.join(require('os').homedir(), '.claude');
const KIT_HOOKS = [
  { file: 'obsidian-inbox.js', events: ['SessionStart', 'UserPromptSubmit'], timeout: 10 },
  { file: 'brain-autoupdate.js', events: ['Stop'], timeout: 15 },
];
const isKitHook = cmd => /(obsidian-inbox|brain-autoupdate)\.js/i.test(String(cmd || ''));
async function listFiles(dir, base = dir) {
  const out = [];
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...await listFiles(full, base)); else out.push(path.relative(base, full));
  }
  return out;
}
async function claudeKitStatus() {
  const dir = CLAUDE_DIR();
  const config = await readJsonFile(path.join(dir, 'graphite.json'), null);
  // New users start from empty fields (the example file's values are only shown as placeholders).
  const defaults = { studyRoot: '', courses: {}, skipFolders: [], recentFolders: ['Downloads', 'Desktop', 'Documents'], recentDays: 180, brainFolder: 'Claude Brain', readOnlyFolders: [], studyPagesFolder: 'Study Pages', chatLanguage: '', readingLanguages: '', noteLanguage: '', about: '' };
  const skills = [];
  for (const name of await fsp.readdir(path.join(CLAUDE_SHIP, 'skills')).catch(() => [])) {
    let same = true, present = fs.existsSync(path.join(dir, 'skills', name, 'SKILL.md'));
    if (present) for (const f of await listFiles(path.join(CLAUDE_SHIP, 'skills', name))) {
      const a = await fsp.readFile(path.join(CLAUDE_SHIP, 'skills', name, f)).catch(() => null), b = await fsp.readFile(path.join(dir, 'skills', name, f)).catch(() => null);
      if (!a || !b || !a.equals(b)) { same = false; break; }
    }
    skills.push({ name, installed: present, upToDate: present && same });
  }
  const settings = await readJsonFile(path.join(dir, 'settings.json'), {});
  const cmds = Object.values(settings.hooks || {}).flat().flatMap(g => (g.hooks || []).map(h => h.command));
  const hooks = KIT_HOOKS.map(h => ({ file: h.file, registered: cmds.some(c => String(c).includes('graphite') && String(c).includes(h.file)) }));
  return { claudeDir: dir, claudeFound: fs.existsSync(dir), vault: VAULT, config: { ...defaults, ...(config || {}), vault: VAULT }, hasConfig: !!config, skills, hooks };
}
async function installClaudeKit(input) {
  const dir = CLAUDE_DIR();
  await fsp.mkdir(dir, { recursive: true });
  // 1. Settings the skills and hooks read. The vault is always the one this app has open.
  const allowed = ['studyRoot', 'courses', 'skipFolders', 'recentFolders', 'recentDays', 'brainFolder', 'readOnlyFolders', 'studyPagesFolder', 'chatLanguage', 'readingLanguages', 'noteLanguage', 'about'];
  const prev = await readJsonFile(path.join(dir, 'graphite.json'), {});
  const config = { ...prev, vault: VAULT.split(path.sep).join('/') };
  for (const k of allowed) if (input && k in input) config[k] = input[k];
  if (config.studyRoot) config.studyRoot = String(config.studyRoot).trim().replace(/\\/g, '/');
  await atomicWrite(path.join(dir, 'graphite.json'), JSON.stringify(config, null, 2) + '\n');
  // The study settings are the source: fill Claude Code's copy from them (when they were saved), so the skills
  // read the same folders, courses and languages as every other AI.
  const shared = await study.load();
  if (shared) await study.save(shared);
  // 2. Skills (each file the app ships is copied over; your own extra files are left alone).
  const done = { skills: [], hooks: [] };
  for (const name of await fsp.readdir(path.join(CLAUDE_SHIP, 'skills')).catch(() => [])) {
    for (const f of await listFiles(path.join(CLAUDE_SHIP, 'skills', name))) await copyOut(path.join(CLAUDE_SHIP, 'skills', name, f), path.join(dir, 'skills', name, f));
    done.skills.push(name);
  }
  await copyOut(path.join(CLAUDE_SHIP, 'graphite.example.json'), path.join(dir, 'skills', 'graphite.example.json'));
  // 3. Hooks: copied to ~/.claude/hooks/graphite/ and registered in Claude Code's settings.json. Only Graphite's
  //    own entries are replaced; every other hook stays as it is. A backup of settings.json is kept.
  for (const h of KIT_HOOKS) await copyOut(path.join(CLAUDE_SHIP, 'hooks', h.file), path.join(dir, 'hooks', 'graphite', h.file));
  const settingsFile = path.join(dir, 'settings.json');
  let settings = {};
  if (fs.existsSync(settingsFile)) {
    try { settings = JSON.parse(await fsp.readFile(settingsFile, 'utf8')); }
    catch { done.hooksError = 'settings.json could not be read, so the hooks were not registered'; return { ...done, config }; }
    await fsp.copyFile(settingsFile, settingsFile + '.before-graphite');
  }
  settings.hooks = settings.hooks || {};
  for (const ev of Object.keys(settings.hooks)) {
    settings.hooks[ev] = (settings.hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !isKitHook(h.command)) })).filter(g => g.hooks.length);
    if (!settings.hooks[ev].length) delete settings.hooks[ev];
  }
  for (const h of KIT_HOOKS) {
    const command = `node "${path.join(dir, 'hooks', 'graphite', h.file)}"`;
    for (const ev of h.events) (settings.hooks[ev] = settings.hooks[ev] || []).push({ hooks: [{ type: 'command', command, timeout: h.timeout }] });
    done.hooks.push(h.file);
  }
  await atomicWrite(settingsFile, JSON.stringify(settings, null, 2) + '\n');
  return { ...done, config };
}

async function start({ vault, port = 0, token = null, retry = 0, canvasOptions = {} } = {}) {
  VAULT = path.resolve(vault);
  canvas = require('./canvas-service').createCanvasService({ ...canvasOptions, vault: VAULT, noteWriter: {withFileLock, atomicWrite} });
  CONFIG_DIR = path.join(VAULT, '.obsidian');
  PLUGIN_DIR = path.join(CONFIG_DIR, 'plugins');
  TOKEN = token;
  await fsp.mkdir(VAULT, { recursive: true });
  await installBuiltinPlugins().catch(e => console.warn('built-in plugins:', e.message));
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
module.exports = { start, atomicWrite, withFileLock, readSource };

// Browser mode (node server.js).
if (require.main === module) {
  const vault = process.argv.slice(2).find(a => !a.startsWith('--')) || process.env.VAULT || path.join(__dirname, 'vault');
  start({ vault, port: Number(process.env.PORT) || 3000, retry: 20 }).then(port => {
    const url = `http://localhost:${port}`;
    console.log(`\n  Graphite is running at ${url}\n  Vault: ${VAULT}\n  Press Ctrl+C to stop.\n`);
    openBrowser(url);
  }).catch(e => { console.error(e); process.exit(1); });
}
