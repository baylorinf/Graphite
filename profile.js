'use strict';
// Study settings ("学习设置"): one set of facts about the student and their files, saved once in Graphite and used
// by every AI that does a job for them: Claude Code, DeepSeek Harness, Codex CLI, an API model, and any framework
// added later. It is a plain JSON file on this computer, so an outside agent can read it too:
//
//   ~/.graphite/study.json        (GRAPHITE_HOME overrides the folder; tests use that)
//
// Graphite also hands the parts a job needs to the AI doing it (profileFor / promptBlock), and keeps the old
// Claude Code copy (~/.claude/graphite.json, read by the Claude Code skills) in step with it.
//
// Fields (all optional):
//   courseRoots      folders on this computer with course files (the first one is the old "studyRoot")
//   courses          { "LA": "Linear Algebra" }: course folder name (code) → course name / vault folder
//   skipFolders      folder names never opened anywhere (e.g. "UPC")
//   lookElsewhere    also look in recentFolders (files changed in the last recentDays days) for course files
//   recentFolders    e.g. ["Downloads", "Desktop", "Documents"] (in the user's home folder)
//   recentDays
//   readOnlyFolders  vault folders no AI may write in
//   brainFolder      the study record ("档案"): progress, confusions, quiz results (default "Claude Brain")
//   studyPagesFolder where a course's study pages (.html) are
//   about, chatLanguage, readingLanguages, noteLanguage
//   differences      what the migration found set differently in the two old places, kept for the user to check
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const os = require('os');

const DEFAULTS = {
  courseRoots: [], courses: {}, skipFolders: [], lookElsewhere: false, recentFolders: ['Downloads', 'Desktop', 'Documents'], recentDays: 180,
  readOnlyFolders: [], brainFolder: 'Claude Brain', studyPagesFolder: 'Study Pages',
  about: '', chatLanguage: '', readingLanguages: '', noteLanguage: '',
};
const FIELDS = Object.keys(DEFAULTS);
const strList = v => (Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[,\n]/) : []).map(x => String(x).trim()).filter(Boolean);
const uniq = (list, key = x => x.toLowerCase()) => { const seen = new Set(); return list.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };
const slash = p => String(p || '').trim().replace(/\\/g, '/').replace(/\/+$/, '');
// "D:TaskDYS": saved by an early version without its backslashes.
const fixRoot = r => (/^[A-Za-z]:TaskDYS$/i.test(String(r)) ? String(r).slice(0, 2) + '/Task/DYS' : r);

// Clean whatever came in (from the app, from an old file) into the shape above.
function clean(input = {}) {
  const out = {};
  out.courseRoots = uniq(strList(input.courseRoots).map(fixRoot).map(slash).filter(Boolean));
  const courses = {};
  for (const [k, v] of Object.entries(input.courses && typeof input.courses === 'object' ? input.courses : {})) {
    const code = String(k).trim(); if (code) courses[code] = String(v ?? '').trim() || code;
  }
  out.courses = courses;
  out.skipFolders = uniq(strList(input.skipFolders));
  out.lookElsewhere = !!input.lookElsewhere;
  out.recentFolders = input.recentFolders == null ? DEFAULTS.recentFolders.slice() : uniq(strList(input.recentFolders));
  out.recentDays = Math.max(1, Math.min(3650, Math.round(+input.recentDays || DEFAULTS.recentDays)));
  out.readOnlyFolders = uniq(strList(input.readOnlyFolders).map(slash).map(s => s.replace(/^\/+/, '')).filter(Boolean));
  out.brainFolder = slash(input.brainFolder).replace(/^\/+/, '') || DEFAULTS.brainFolder;
  out.studyPagesFolder = slash(input.studyPagesFolder).replace(/^\/+/, '') || DEFAULTS.studyPagesFolder;
  for (const k of ['about', 'chatLanguage', 'readingLanguages', 'noteLanguage']) out[k] = String(input[k] ?? '').trim().slice(0, 2000);
  if (Array.isArray(input.differences)) out.differences = input.differences.slice(0, 40);
  return out;
}

module.exports = function createProfile({ atomicWrite, vault, claudeDir }) {
  const home = () => process.env.GRAPHITE_HOME || path.join(os.homedir(), '.graphite');
  const file = () => path.join(home(), 'study.json');
  const claudeFile = () => path.join(claudeDir(), 'graphite.json');
  const readJson = async f => { try { return JSON.parse(await fsp.readFile(f, 'utf8')); } catch { return null; } };
  let cache = null; // { at, value } — the file is small; read again when it changes on disk

  // The settings, or null when they were never saved (then the app migrates the old ones first).
  async function load() {
    const st = await fsp.stat(file()).catch(() => null);
    if (!st) return null;
    if (cache && cache.at === st.mtimeMs) return cache.value;
    const raw = await readJson(file());
    const value = raw ? { ...DEFAULTS, ...clean(raw) } : null;
    cache = { at: st.mtimeMs, value };
    return value;
  }
  // Settings for a job, never null (defaults when nothing was saved).
  async function get() { return (await load()) || { ...DEFAULTS }; }

  // The old Claude Code copy, in the new shape (studyRoot → courseRoots[0], recent folders → look elsewhere).
  async function fromClaude() {
    const c = await readJson(claudeFile());
    if (!c || typeof c !== 'object') return null;
    return clean({ ...c, courseRoots: [c.studyRoot, ...strList(c.studyRoots)].filter(Boolean), lookElsewhere: c.lookElsewhere ?? (Array.isArray(c.recentFolders) && c.recentFolders.length > 0) });
  }

  // First start after the update: combine the two old places. Settings → AI kept course folders, left-out names and
  // "also look in Downloads…" in the app; Settings → Claude Code kept the rest in ~/.claude/graphite.json. Where both
  // say something different, both values are kept (folders are combined) and the difference is listed so the user
  // can check it once in Study settings. `agent` is the app's old Settings → AI value (null if never set there).
  async function migrate(agent) {
    const cc = await fromClaude();
    const ag = agent && typeof agent === 'object' ? agent : null;
    const differences = [];
    const base = { ...(cc || {}) };
    if (ag) {
      const agRoots = uniq(strList(ag.roots).map(fixRoot).map(slash).filter(Boolean));
      const agSkip = uniq(strList(ag.skip));
      if (cc && cc.courseRoots.length && agRoots.length && agRoots.map(x => x.toLowerCase()).sort().join('|') !== cc.courseRoots.map(x => x.toLowerCase()).sort().join('|'))
        differences.push({ field: 'courseRoots', claude: cc.courseRoots, ai: agRoots, kept: 'both' });
      base.courseRoots = uniq([...(cc?.courseRoots || []), ...agRoots]);
      if (cc && cc.skipFolders.length && agSkip.length && agSkip.map(x => x.toLowerCase()).sort().join('|') !== cc.skipFolders.map(x => x.toLowerCase()).sort().join('|'))
        differences.push({ field: 'skipFolders', claude: cc.skipFolders, ai: agSkip, kept: 'both' });
      base.skipFolders = uniq([...(cc?.skipFolders || []), ...agSkip]);
      if (cc && 'extras' in ag && !!ag.extras !== !!cc.lookElsewhere)
        differences.push({ field: 'lookElsewhere', claude: !!cc.lookElsewhere, ai: !!ag.extras, kept: 'ai' });
      if ('extras' in ag) base.lookElsewhere = !!ag.extras;
    }
    const value = clean({ ...base, differences });
    const sources = [cc ? 'claude' : null, ag ? 'ai' : null].filter(Boolean);
    // Only the new file is written here: Claude Code's own copy is left exactly as it was until the user saves
    // Study settings (or installs the Claude Code kit), so an update alone never changes what Claude Code does.
    await save(value, { migratedFrom: sources }, { mirror: false });
    return { profile: await get(), migratedFrom: sources, differences };
  }

  async function save(input, extra = {}, { mirror = true } = {}) {
    const value = clean(input);
    const body = { version: 1, vault: slash(vault()), ...value, ...extra, savedAt: new Date().toISOString() };
    await fsp.mkdir(home(), { recursive: true });
    await atomicWrite(file(), JSON.stringify(body, null, 2) + '\n');
    cache = null;
    if (mirror) await mirrorClaude(value).catch(() => {});
    return get();
  }

  // Keep the Claude Code skills' copy in step, if Claude Code is set up on this computer (its folder exists).
  // Only the fields the skills read are written; anything else in that file stays. Its "vault" is Claude Code's
  // own choice (set when the kit is installed) and is never changed here: saving settings while another vault is
  // open must not point Claude Code at that vault.
  async function mirrorClaude(p) {
    if (!fs.existsSync(claudeDir())) return;
    const prev = (await readJson(claudeFile())) || {};
    const next = { ...prev, vault: prev.vault || slash(vault()), studyRoot: p.courseRoots[0] || '', studyRoots: p.courseRoots, courses: p.courses, skipFolders: p.skipFolders,
      recentFolders: p.lookElsewhere ? p.recentFolders : [], recentDays: p.recentDays, brainFolder: p.brainFolder, readOnlyFolders: p.readOnlyFolders,
      studyPagesFolder: p.studyPagesFolder, chatLanguage: p.chatLanguage, readingLanguages: p.readingLanguages, noteLanguage: p.noteLanguage, about: p.about,
      studySettings: file().split(path.sep).join('/') };
    await atomicWrite(claudeFile(), JSON.stringify(next, null, 2) + '\n');
  }

  return { file, load, get, save, migrate, fromClaude, DEFAULTS, FIELDS };
};

/* ---------- which settings each job uses ---------- */
// Every job gets only what it needs. "read" jobs never get write permissions from these settings; the read-only
// folders matter for jobs that propose writes (inbox, brain, import index notes, summaries).
const TASK_FIELDS = {
  import: ['courseRoots', 'courses', 'skipFolders', 'lookElsewhere', 'recentFolders', 'recentDays', 'readOnlyFolders', 'noteLanguage', 'about'],
  inbox: ['courses', 'readOnlyFolders', 'brainFolder', 'noteLanguage', 'readingLanguages', 'about'],
  brain: ['courses', 'readOnlyFolders', 'brainFolder', 'chatLanguage', 'about'],
  chat: ['courses', 'brainFolder', 'studyPagesFolder', 'chatLanguage', 'readingLanguages', 'noteLanguage', 'about'],
  questions: ['brainFolder', 'noteLanguage', 'about'],
  check: ['noteLanguage', 'about'],
  plan: ['courses', 'brainFolder', 'noteLanguage', 'about'],
  exam: ['courses', 'brainFolder', 'noteLanguage', 'about'],
  mock: ['courses', 'brainFolder', 'noteLanguage', 'about'],
  format: ['readOnlyFolders', 'noteLanguage'],
  connect: ['readOnlyFolders', 'noteLanguage'],
  summary: ['courses', 'courseRoots', 'readOnlyFolders', 'brainFolder', 'noteLanguage', 'readingLanguages', 'about'],
};
// Jobs whose answer becomes a note: written in the note language when one is set.
const NOTE_TASKS = new Set(['plan', 'exam', 'mock', 'summary', 'inbox', 'import']);
function profileFor(task, p) {
  const out = {};
  for (const k of TASK_FIELDS[task] || []) if (p && p[k] != null) out[k] = p[k];
  return out;
}
// The language a job writes in: the note language for notes, else the app's language.
function outputLanguage(task, p, uiName) { return NOTE_TASKS.has(task) && p?.noteLanguage ? p.noteLanguage : uiName; }
// The settings as a short block for the AI's instructions.
function promptBlock(task, p, file) {
  const f = profileFor(task, p);
  const lines = [];
  if (f.about) lines.push(`- About the student: ${f.about}`);
  if (f.courses && Object.keys(f.courses).length) lines.push(`- Courses (folder code = course name): ${Object.entries(f.courses).map(([k, v]) => `${k} = ${v}`).join('; ')}`);
  if (f.courseRoots?.length) lines.push(`- Course folders on this computer: ${f.courseRoots.join(' ; ')}`);
  if (f.skipFolders?.length) lines.push(`- Never open folders named: ${f.skipFolders.join(', ')}`);
  if ('lookElsewhere' in f) lines.push(f.lookElsewhere ? `- Also look for course files in ${(f.recentFolders || []).join(', ')} (changed in the last ${f.recentDays} days)` : '- Do not look outside the course folders and the vault');
  if (f.readOnlyFolders?.length) lines.push(`- Read-only vault folders (never write or propose changes there): ${f.readOnlyFolders.join(', ')}`);
  if (f.brainFolder) lines.push(`- The student's study record folder in the vault: ${f.brainFolder}`);
  if (f.studyPagesFolder) lines.push(`- Study pages (.html) are in each course's "${f.studyPagesFolder}" folder`);
  if (f.chatLanguage) lines.push(`- Usual chat language: ${f.chatLanguage}`);
  if (f.readingLanguages) lines.push(`- Reads: ${f.readingLanguages}`);
  if (f.noteLanguage) lines.push(`- Language of their notes: ${f.noteLanguage}${NOTE_TASKS.has(task) ? ' (write the note you produce in it)' : ''}`);
  if (!lines.length) return '';
  return `## Study settings (from Graphite${file ? `, ${String(file).split(path.sep).join('/')}` : ''})\n${lines.join('\n')}`;
}
module.exports.clean = clean;
module.exports.profileFor = profileFor;
module.exports.promptBlock = promptBlock;
module.exports.outputLanguage = outputLanguage;
module.exports.TASK_FIELDS = TASK_FIELDS;
