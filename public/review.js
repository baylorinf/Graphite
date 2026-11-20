// Review: turns notes into questions, schedules them with spaced repetition, runs check sessions,
// shows the Review page, and finds related notes. Works offline; nothing leaves your computer.
//
// Questions come from what you write:
//   ==highlight== or **bold** term   → fill in the blank
//   - **Term**: definition           → "What is Term?"
//   question :: answer               → flashcard (one line)
//   question lines / ? / answer lines → flashcard (several lines)
//   ## Heading with text under it    → "What do you remember about Heading?"
//   a note with none of the above    → "What are the key points of Note?"
// Progress is stored in the vault (.obsidian/myobsidian/review.json), so it syncs with your notes.
import { t, getLang } from '/i18n.js';
import { hash } from '/sync.js';

let H = null;
const FILE = '.obsidian/myobsidian/review.json';
let state = null;

const fresh = () => ({ version: 1, cards: {}, days: {}, notes: {}, newSeen: {} });
// Local day number (days since 1970 in your time zone).
export const today = () => Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000);

// Connect to the app right away (related notes are needed before the review progress has loaded).
export function attach(host) { H = host; }
export async function initReview(host) {
  H = host;
  try { state = { ...fresh(), ...JSON.parse((await H.api('GET', 'file', { path: FILE })).content) }; }
  catch { state = fresh(); }
  // Ratings from last time that never reached the disk: put them back and save them now.
  const kept = takeKeptPending();
  if (kept.length) { pending = kept.concat(pending); state = apply(state, kept); save(); }
}
// Saving merges instead of overwriting. Two windows (or two computers syncing the vault) may review at the
// same time; each records its own changes as small operations, and a save re-reads the file, applies only
// those operations on top, and writes the result. So both windows keep their ratings and day counts.
let saveTimer = null, pending = [], inflight = [], flushing = null;
// Each operation has its own id. The file remembers the ids it has taken in (`applied`), so an operation that
// arrives twice (kept for crash recovery and then recovered in two windows, or recovered after a save that did
// reach the disk) is applied once: ratings and day counts are never added twice.
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
const op = o => { pending.push({ ...o, u: uid() }); save(); };
const setCard = (id, v) => { if (v) state.cards[id] = v; else delete state.cards[id]; op({ k: 'cards', id, v: v || null }); };
const setNoteState = (path, v) => { if (v) state.notes[path] = v; else delete state.notes[path]; op({ k: 'notes', id: path, v: v || null }); };
const setAi = (path, v) => { state.ai = state.ai || {}; if (v) state.ai[path] = v; else delete state.ai[path]; op({ k: 'ai', id: path, v: v || null }); };
const setItem = (id, v) => { state.items = state.items || {}; if (v) state.items[id] = v; else delete state.items[id]; op({ k: 'items', id, v: v || null }); };
const setPlan = (id, v) => { state.plans = state.plans || {}; if (v) state.plans[id] = v; else delete state.plans[id]; op({ k: 'plans', id, v: v || null }); };
const bump = (k, d) => { state[k][d] = (state[k][d] || 0) + 1; op({ k, id: d, inc: 1 }); };
const APPLIED_MAX = 4000;
function apply(base, ops) {
  const seen = new Set(Array.isArray(base.applied) ? base.applied : []);
  const added = [];
  for (const o of ops) {
    if (o.u) { if (seen.has(o.u)) continue; seen.add(o.u); added.push(o.u); }
    base[o.k] = base[o.k] || {};
    if (o.inc) base[o.k][o.id] = (base[o.k][o.id] || 0) + o.inc;
    else if (o.v) base[o.k][o.id] = o.v;
    else delete base[o.k][o.id];
  }
  if (added.length) base.applied = [...(Array.isArray(base.applied) ? base.applied : []), ...added].slice(-APPLIED_MAX);
  return base;
}
// The file on disk: { raw: its exact text (null if there is none), data: parsed progress, corrupt: true if unreadable }.
async function readDiskRaw() {
  let raw = null;
  try { raw = (await H.api('GET', 'file', { path: FILE })).content; } catch { return { raw: null, data: fresh() }; }
  try { return { raw, data: { ...fresh(), ...JSON.parse(raw) } }; } catch { return { raw, data: fresh(), corrupt: true }; }
}
async function readDisk() { return (await readDiskRaw()).data; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Write the merged progress only if the file is still the version just read ("compare and swap"): if another
// window saved in between, the server refuses, and the save re-reads and re-applies this window's operations.
async function writeIfUnchanged(raw, text) {
  const enc = encodeURIComponent(FILE);
  const res = raw == null
    ? await fetch(`/api/file?path=${enc}`, { method: 'POST', headers: { 'X-Vault': '1' }, body: text })   // create only
    : await fetch(`/api/file?path=${enc}`, { method: 'PUT', headers: { 'X-Vault': '1', 'X-Base-Hash': hash(raw) }, body: text });
  if (res.status === 409) return false;
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || res.statusText);
  return true;
}
async function flush() {
  if (flushing) return flushing; // one save at a time; changes made meanwhile go in the next one
  if (!pending.length) return;
  flushing = (async () => {
    let failed = false;
    const ops = pending; pending = [];
    inflight = ops;  // still in the crash-recovery copy until the disk has them
    keepPending();
    try {
      for (let attempt = 0; ; attempt++) {
        const disk = await readDiskRaw();
        // An unreadable file is copied to a backup before anything replaces it. If the backup can't be written
        // (disk full, read-only), the original is left exactly as it is and the ratings wait for the next try.
        if (disk.corrupt) {
          const bak = FILE.replace(/\.json$/, `.unreadable-${Date.now()}.json`);
          const r = await fetch(`/api/file?path=${encodeURIComponent(bak)}`, { method: 'POST', headers: { 'X-Vault': '1' }, body: disk.raw });
          if (!r.ok) throw Object.assign(new Error('Could not back up the unreadable review file; it was left unchanged'), { backup: true });
        }
        const merged = apply(disk.data, ops);
        if (await writeIfUnchanged(disk.corrupt ? null : disk.raw, JSON.stringify(merged)) || (disk.corrupt && await writeIfUnchanged(disk.raw, JSON.stringify(merged)))) {
          // Adopt what other windows saved too, keeping changes made while this save was running.
          state = apply(merged, pending);
          break;
        }
        if (attempt >= 12) throw new Error('review.json kept changing');
        await sleep(30 + Math.random() * 60 * (attempt + 1));
      }
    } catch (e) {
      pending = ops.concat(pending); // keep them for the next try
      failed = true;
      console.warn('review save failed', e);
    } finally { inflight = []; }
    // Recorded here (not by whoever started the save), so every caller waiting on this save sees the result.
    saveFailed = failed;
    keepPending();
    showUnsaved(failed && pending.length > 0);
    // After a failure, try again a little later (not in a tight loop); the ratings stay in memory meanwhile.
    if (pending.length) { clearTimeout(saveTimer); saveTimer = setTimeout(flush, failed ? 8000 : 600); }
  })();
  try { await flushing; } finally { flushing = null; }
}
// Before closing, updating or switching vaults: wait until every rating made so far is on disk, including any
// made while a save was already running. Stops at the first failure (reported, retried later) instead of looping.
export async function flushReview() {
  clearTimeout(saveTimer);
  for (let round = 0; round < 50; round++) {
    if (flushing) { await flushing.catch(() => {}); continue; }
    if (!pending.length) break;
    await flush();
    if (saveFailed) break;
  }
  return { ok: !reviewUnsaved() };
}
// Ratings that are not on disk yet (the desktop app asks before closing, updating or switching vaults; see
// window.__moFlush).
export const reviewUnsaved = () => pending.length > 0 || inflight.length > 0;
function save() {
  clearTimeout(saveTimer);
  keepPending();
  saveTimer = setTimeout(flush, 600);
}

// Ratings not yet on disk (the batch being written and the ones after it) are also kept in this window's
// storage, so a crash or a restart while the vault can't be written doesn't lose them; they are saved on the
// next start. Each window has its own copy (two open windows can't overwrite each other's); the ids above make
// sure a rating recovered twice is counted once.
let saveFailed = false;
const WIN = uid();
const PENDING_KEY = 'reviewPending:' + WIN, PENDING_INDEX = 'reviewPendingIndex';
function keepPending() {
  try {
    const ops = [...inflight, ...pending];
    const index = new Set(H?.store?.get(PENDING_INDEX, []) || []);
    if (ops.length) index.add(WIN); else index.delete(WIN);
    H?.store?.set(PENDING_KEY, ops.length ? { vault: H.S?.vault || '', ops } : null);
    H?.store?.set(PENDING_INDEX, [...index]);
  } catch { /* storage full or blocked */ }
}
function takeKeptPending() {
  const out = [], seen = new Set();
  try {
    const index = new Set(H?.store?.get(PENDING_INDEX, []) || []);
    for (const id of [...index, ...(index.size ? [] : [''])]) {
      const key = id ? 'reviewPending:' + id : 'reviewPending';
      const kept = H?.store?.get(key, null);
      if (!kept || !Array.isArray(kept.ops) || (kept.vault && kept.vault !== (H.S?.vault || ''))) continue;
      for (const o of kept.ops) { const k = o.u || JSON.stringify(o); if (!seen.has(k)) { seen.add(k); out.push(o); } }
      H?.store?.set(key, null);
      index.delete(id);
    }
    H?.store?.set(PENDING_INDEX, [...index]);
  } catch { /* unreadable */ }
  return out;
}

// "Review progress isn't saved yet": shown until a save succeeds, with Retry.
let unsavedBar = null;
function showUnsaved(on) {
  if (!on) { unsavedBar?.remove(); unsavedBar = null; return; }
  if (!unsavedBar) {
    unsavedBar = document.body.appendChild(document.createElement('div'));
    unsavedBar.className = 'review-unsaved-bar';
    unsavedBar.setAttribute('role', 'alert');
  }
  unsavedBar.innerHTML = `<span>${escapeHtml(t('review.unsavedMsg'))}</span><button type="button" class="mod-button mod-cta">${escapeHtml(t('review.retrySave'))}</button>`;
  unsavedBar.querySelector('button').onclick = async e => {
    e.currentTarget.disabled = true;
    await flushReview();
    if (unsavedBar) { const b = unsavedBar.querySelector('button'); if (b) b.disabled = false; }
  };
}
// Pick up what other windows saved, keeping this window's unsaved changes.
export async function reloadReview() {
  if (!H) return;
  await flush();
  state = apply(await readDisk(), pending);
  cardCache.clear();
}
// The quiz offer after writing is opt-in (off unless turned on in Settings → Review).
const settings = () => ({ checkAfterWriting: false, newPerDay: 10, aiQuestions: true, reviewFolders: [], reviewExclude: [], ...(H.store.get('review', {}) || {}) });
export const reviewSettings = settings;
export function setReviewSettings(patch) { H.store.set('review', { ...settings(), ...patch }); }

/* =====================================================================
   1. Questions from notes
   ===================================================================== */
const BLANK = '［…］';
const cardCache = new Map(); // path -> { key, cards }

export function cardsFor(path) {
  const f = H.S.files.get(path);
  if (!f || f.content == null || !/\.md$/i.test(path)) return [];
  const key = hash(f.content) + getLang(); // questions are worded in the interface language
  const c = cardCache.get(path);
  if (c && c.key === key) return c.cards;
  const cards = extractCards(path, f.content);
  // AI-written questions, if they were made for this exact version of the note
  const ai = state?.ai?.[path];
  if (ai && ai.key === hash(f.content)) {
    const note = path.split('/').pop().replace(/\.md$/i, '');
    ai.cards.forEach((c, i) => cards.push({ id: hash(`${path}\u0000ai\u0000${c.q}`), path, note, kind: 'ai', q: c.q, a: c.a, line: 100000 + i }));
  }
  cardCache.set(path, { key, cards });
  return cards;
}

export function extractCards(path, content) {
  const note = path.split('/').pop().replace(/\.md$/i, '');
  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '');
  // Blank out code blocks and math blocks so nothing inside them becomes a question.
  const lines = []; let fence = false, math = false;
  for (const l of body.split('\n')) {
    if (/^\s*(```|~~~)/.test(l)) { fence = !fence; lines.push(''); continue; }
    if (/^\s*\$\$\s*$/.test(l)) { math = !math; lines.push(''); continue; }
    lines.push(fence || math ? '' : l);
  }
  const cards = [];
  // The id comes from the note's own text (key), never from translated wording, so progress survives a
  // language change.
  const add = (kind, q, a, line, key = q) => {
    q = q.trim(); a = a.trim();
    if (!q || !a) return;
    cards.push({ id: hash(`${path}\u0000${kind}\u0000${String(key).trim()}`), path, note, kind, q, a, line });
  };
  const used = new Set(); // lines already turned into a question

  // question :: answer. A card when " :: " has a space before it ("问题 :: 答案"), or the question has a space or a
  // question mark (? or ？). Properties written like "status:: done" (no space before ::) stay plain properties.
  lines.forEach((l, i) => {
    const m = l.match(/^\s*(?:[-*+]\s+|\d+[.)]\s+)?(.+?)\s*::\s*(.+)$/);
    if (m && (/\s::/.test(l) || /[\s?？]/.test(m[1].trim()))) { add('qa', m[1], m[2], i); used.add(i); }
  });
  // Several lines: question, a line with just "?", answer (until an empty line)
  lines.forEach((l, i) => {
    if (l.trim() !== '?' && l.trim() !== '？') return;
    let s = i - 1; while (s >= 0 && lines[s].trim()) s--;
    let e = i + 1; while (e < lines.length && lines[e].trim()) e++;
    const q = lines.slice(s + 1, i).join('\n'), a = lines.slice(i + 1, e).join('\n');
    if (q.trim() && a.trim()) { add('qa', q, a, s + 1); for (let k = s + 1; k < e; k++) used.add(k); }
  });
  // - **Term**: definition   → What is Term?
  lines.forEach((l, i) => {
    if (used.has(i)) return;
    const m = l.match(/^\s*(?:[-*+]\s+)?\*\*([^*]{1,60})\*\*\s*[:：—–-]\s*(.{3,})$/);
    if (m) { add('def', t('review.whatIs', { term: m[1].trim() }), m[2], i, m[1]); used.add(i); }
  });
  // ==highlight== and **bold** → fill in the blank (one question per marked term)
  lines.forEach((l, i) => {
    if (used.has(i) || /^\s*#/.test(l) || /^\s*>\s*\[!/.test(l)) return;
    const marks = [...l.matchAll(/==([^=\n]+?)==|\*\*([^*\n]+?)\*\*/g)];
    const plain = l.replace(/==|\*\*/g, '').replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').trim();
    if (!marks.length || marks.length > 4 || plain.length < 20) return;
    for (const m of marks) {
      const term = (m[1] || m[2]).trim();
      if (term.length < 2 || /[:：]$/.test(term) || term.length > plain.length * 0.7) continue;
      const q = l.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(m[0], `==${BLANK}==`).replace(/==([^=\n]+?)==|\*\*([^*\n]+?)\*\*/g, (x, a, b) => (x.includes(BLANK) ? x : (a || b)));
      add('cloze', q, term, i);
    }
  });
  // Sections: "What do you remember about Heading?"
  const heads = [];
  lines.forEach((l, i) => { const m = l.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/); if (m) heads.push({ level: m[1].length, text: m[2], i }); });
  heads.forEach((h, k) => {
    if (h.level < 2 || h.level > 4) return;
    let end = lines.length;
    for (let j = k + 1; j < heads.length; j++) if (heads[j].level <= h.level) { end = heads[j].i; break; }
    const section = body.split('\n').slice(h.i + 1, end).join('\n').trim();
    const words = lines.slice(h.i + 1, end).join(' ').replace(/[#>*_`=\-\[\]()\s]+/g, ' ').trim(); // code not counted
    if (words.length >= 40) add('section', t('review.recallSection', { heading: h.text.replace(/[*=_`]/g, '') }), section.length > 1500 ? section.slice(0, 1500) + '\n\n…' : section, h.i, h.text);
  });
  // Nothing else, but a real note: recall the whole note.
  if (!cards.length) {
    const text = body.trim();
    if (text.replace(/\s+/g, '').length >= 80) add('note', t('review.recallNote', { note }), text.length > 1500 ? text.slice(0, 1500) + '\n\n…' : text, 0, 'whole-note');
  }
  // Which section each card is in ("Chapter 2 › Example"), shown while you answer.
  const sectionAt = line => {
    const open = [];
    for (const h of heads) { if (h.i > line) break; while (open.length && open[open.length - 1].level >= h.level) open.pop(); open.push(h); }
    return open.map(h => h.text.replace(/[*=_`]/g, '').trim()).filter(Boolean).join(' › ');
  };
  for (const c of cards) c.section = sectionAt(c.line);
  // The same question in two places of one note used to get the same id, so one rating counted for both. A card
  // whose question is unique keeps its old id (and its history). Cards that shared an id now get their own,
  // made from their section (and their order within it, if a section repeats it); the old shared record is left
  // as it was and not given to either card, because there is no way to tell which one it belonged to.
  const byId = new Map();
  for (const c of cards) byId.set(c.id, [...(byId.get(c.id) || []), c]);
  for (const [shared, group] of byId) {
    if (group.length < 2) continue;
    const seen = new Map();
    for (const c of group) {
      const n = (seen.get(c.section) || 0) + 1; seen.set(c.section, n);
      c.id = hash(`${shared}\u0000section\u0000${c.section}\u0000${n}`);
      c.sharedId = shared;
    }
  }
  return cards;
}

/* =====================================================================
   2. Scheduling (spaced repetition, SM-2 style)
   ===================================================================== */
function next(c, rating) {
  c = { interval: 0, ease: 2.5, reps: 0, lapses: 0, ...(c || {}) };
  let iv;
  if (rating === 1) { if (c.reps) c.lapses++; c.reps = 0; c.ease = Math.max(1.3, c.ease - 0.2); iv = 0; }
  else if (c.reps === 0) { iv = rating === 4 ? 4 : 1; if (rating === 4) c.ease += 0.15; c.reps = 1; }
  else if (c.reps === 1) { iv = rating === 2 ? 3 : rating === 3 ? 4 : 7; if (rating === 2) c.ease = Math.max(1.3, c.ease - 0.15); if (rating === 4) c.ease += 0.15; c.reps = 2; }
  else {
    const base = Math.max(1, c.interval);
    iv = Math.ceil(rating === 2 ? base * 1.2 : rating === 3 ? base * c.ease : base * c.ease * 1.3);
    if (rating === 2) c.ease = Math.max(1.3, c.ease - 0.15);
    if (rating === 4) c.ease += 0.15;
    c.reps++;
  }
  c.interval = Math.min(iv, 3650);
  return c;
}
export function rate(card, rating) {
  const d = today();
  const c = next(state.cards[card.id], rating);
  c.due = d + c.interval; c.last = d; c.path = card.path;
  if (!state.cards[card.id]) bump('newSeen', d);
  setCard(card.id, c);
  bump('days', d);
  return c;
}
export function intervalLabel(days) {
  if (days <= 0) return t('review.now');
  if (days < 7) return t('review.unitDay', { n: days });
  if (days < 30) return t('review.unitWeek', { n: Math.round(days / 7) });
  if (days < 365) return t('review.unitMonth', { n: Math.round(days / 30) });
  return t('review.unitYear', { n: +(days / 365).toFixed(1) });
}

// Which notes feed daily review. "Quiz this note" works on any note; daily review only uses notes that are
// inside "Folders in daily review" (empty = whole vault), not inside "Left out of daily review", and don't
// say "review: off" (or "graph: hide", which marks index pages, logs and other non-knowledge notes).
const folderList = v => (Array.isArray(v) ? v : String(v || '').split(',')).map(s => String(s).trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
const inFolder = (p, d) => p === d || p.startsWith(d + '/');
export function inDailyReview(path) {
  const f = H.S.files.get(path);
  const fm = f?.fm || {};
  const off = v => v === false || /^(off|no|false|hide|hidden)$/i.test(String(v ?? ''));
  if (off(fm.review) || off(fm.graph)) return false;
  const s = settings(), inc = folderList(s.reviewFolders), exc = folderList(s.reviewExclude);
  if (inc.length && !inc.some(d => inFolder(path, d))) return false;
  return !exc.some(d => inFolder(path, d));
}
export function allCards() {
  const out = [];
  for (const p of H.S.files.keys()) if (/\.md$/i.test(p) && inDailyReview(p)) out.push(...cardsFor(p));
  out.push(...itemCards());
  return out;
}

/* =====================================================================
   Your own items: mistakes from exam papers, and cards made from PDFs (text or a clipped image)
   ===================================================================== */
const newId = () => 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
export const items = (kind) => Object.entries(state?.items || {}).map(([id, v]) => ({ id, ...v })).filter(i => !kind || i.kind === kind);
export function getItem(id) { return state?.items?.[id] ? { id, ...state.items[id] } : null; }
// item: { kind: 'mistake', src, page, no, question, myAnswer, mistake, redo (day number), note? }
//    or { kind: 'card', src, page, q, a, img?, imgSide: 'q' | 'a' }
export function addItem(item) {
  const id = newId(), d = today();
  setItem(id, { ...item, created: d });
  // A mistake comes back on its redo day (not as a "new" card); a card is new and joins like any new question.
  if (item.kind === 'mistake') setCard(id, { interval: 0, ease: 2.5, reps: 0, lapses: 0, due: Math.max(d, item.redo ?? d + 1), last: d, path: item.src || '' });
  H.onReviewChange();
  return id;
}
export function updateItem(id, patch) { const cur = state.items?.[id]; if (cur) setItem(id, { ...cur, ...patch }); }
export function removeItem(id) { clearMistakeDraft(id); setItem(id, null); setCard(id, null); H.onReviewChange(); }
export function setDue(id, day) { const c = state.cards[id]; if (c) setCard(id, { ...c, due: day }); }
export const dueOf = id => state?.cards?.[id]?.due ?? null;
const shortName = p => String(p || '').split('/').pop().replace(/\.(md|pdf|docx?|pptx?)$/i, '');
const imgMd = p => `![](/vault/${String(p).split('/').map(encodeURIComponent).join('/')})`;
function itemCard(id, v) {
  const where = v.src ? `${shortName(v.src)}${v.page ? ' p.' + v.page : ''}` : t('mist.noSource');
  if (v.kind === 'mistake') return {
    id, kind: 'mistake', path: v.src || '', page: v.page || 0, note: where, item: v, line: 0,
    q: [v.no ? `**${t('mist.problem', { no: v.no })}**` : '', v.question || '', v.img ? imgMd(v.img) : ''].filter(Boolean).join('\n\n') || t('mist.seePaper'),
    a: `**${t('mist.oldAnswer')}**\n\n${v.myAnswer || '—'}\n\n**${t('mist.whyWrong')}**\n\n${v.mistake || '—'}`,
  };
  return {
    id, kind: 'card', path: v.src || '', page: v.page || 0, note: where, item: v, line: 0,
    q: [v.q || '', v.img && v.imgSide !== 'a' ? imgMd(v.img) : ''].filter(Boolean).join('\n\n') || '…',
    a: [v.a || '', v.img && v.imgSide === 'a' ? imgMd(v.img) : ''].filter(Boolean).join('\n\n') || '…',
  };
}
export const itemCards = () => items().map(i => itemCard(i.id, i));
// A file was renamed or moved: items pointing at it (source PDF, clipped image, related note) follow.
export function renamedSources(pairs) {
  if (!state) return;
  for (const it of items()) {
    const patch = {};
    for (const k of ['src', 'img', 'note']) if (it[k] && pairs.has(it[k])) patch[k] = pairs.get(it[k]);
    if (Object.keys(patch).length) { const { id, ...v } = it; setItem(id, { ...v, ...patch }); if (patch.src && state.cards[id]) setCard(id, { ...state.cards[id], path: patch.src }); }
  }
  for (const [pid, rec] of Object.entries(state.plans || {})) {
    const [plan, key] = [pid.slice(0, pid.indexOf('#')), pid.slice(pid.indexOf('#') + 1)];
    if (pairs.has(plan)) { setPlan(pairs.get(plan) + '#' + key, rec); setPlan(pid, null); }
  }
}

/* ---------- Revision plans: start one day's cards and mistakes, keep progress, carry over what's left ---------- */
const planKey = (plan, key) => plan + '#' + key;
export function planRecord(plan, key) { return state?.plans?.[planKey(plan, key)] || null; }
function cardIndex() {
  const byId = new Map();
  for (const p of H.S.files.keys()) if (/\.md$/i.test(p)) for (const c of cardsFor(p)) byId.set(c.id, c);
  for (const c of itemCards()) byId.set(c.id, c);
  return byId;
}
// The cards for a day: every question from the notes it links, plus mistakes and PDF cards whose source (or
// related note) it links. Worked out the first time the day is started, then kept, so progress stays stable.
export function planDayIds(links) {
  const files = new Set(links), ids = [];
  for (const p of links) if (/\.md$/i.test(p)) for (const c of cardsFor(p)) ids.push(c.id);
  for (const it of items()) if (files.has(it.src) || (it.note && files.has(it.note))) ids.push(it.id);
  return [...new Set(ids)];
}
export function planProgress(plan, key, links) {
  const rec = planRecord(plan, key);
  const ids = rec ? rec.ids : planDayIds(links);
  return { total: ids.length, done: rec ? rec.done.filter(id => ids.includes(id)).length : 0, carriedTo: rec?.carriedTo || null, carriedIn: rec?.carriedIn || 0 };
}
export async function startPlanDay(plan, key, { title, links, onClose } = {}) {
  await reloadReview();
  const pid = planKey(plan, key);
  let rec = state.plans?.[pid];
  if (!rec) { rec = { ids: planDayIds(links || []), done: [], started: today() }; setPlan(pid, rec); }
  const byId = cardIndex();
  const remaining = rec.ids.filter(id => !rec.done.includes(id)).map(id => byId.get(id)).filter(Boolean);
  if (!remaining.length) { H.toast(rec.ids.length ? t('plan.dayDone') : t('plan.dayEmpty')); return; }
  startSession(remaining, {
    title,
    onDone: card => { const r = state.plans?.[pid]; if (r && !r.done.includes(card.id)) setPlan(pid, { ...r, done: [...r.done, card.id], updated: today() }); },
    onClose,
  });
}
// Move what's left of earlier days into this day (each earlier day remembers where its rest went).
export function carryOver(plan, fromKeys, toKey, toLinks) {
  const pid = planKey(plan, toKey);
  const rec = state.plans?.[pid] || { ids: planDayIds(toLinks || []), done: [], started: today() };
  const moved = [];
  for (const k of fromKeys) {
    const r = state.plans?.[planKey(plan, k)];
    if (!r || r.carriedTo) continue;
    const left = r.ids.filter(id => !r.done.includes(id));
    if (!left.length) continue;
    moved.push(...left);
    setPlan(planKey(plan, k), { ...r, carriedTo: toKey, carried: left.length });
  }
  const ids = [...new Set([...rec.ids, ...moved])];
  setPlan(pid, { ...rec, ids, carriedIn: (rec.carriedIn || 0) + moved.length, updated: today() });
  return moved.length;
}
// Earlier days of a plan that were started but not finished (and not yet carried over).
export function unfinishedDays(plan, keys) {
  return keys.filter(k => { const r = planRecord(plan, k); return r && !r.carriedTo && r.ids.some(id => !r.done.includes(id)); });
}
export function stats() {
  const d = today(), cards = allCards();
  let due = 0, learned = 0, mature = 0, fresh = 0;
  for (const c of cards) {
    const s = state.cards[c.id];
    if (!s) { fresh++; continue; }
    learned++;
    if (s.interval >= 21) mature++;
    if (s.due <= d) due++;
  }
  const newLeft = Math.max(0, settings().newPerDay - (state.newSeen[d] || 0));
  let streak = 0;
  for (let k = state.days[d] ? d : d - 1; state.days[k]; k--) streak++;
  return { total: cards.length, due, learned, mature, fresh, newToday: Math.min(fresh, newLeft), reviewedToday: state.days[d] || 0, streak };
}
// Today's review: everything due, plus some new questions (newest notes first).
export function todaysQueue() {
  const d = today(), cards = allCards();
  const due = cards.filter(c => state.cards[c.id] && state.cards[c.id].due <= d).sort((a, b) => state.cards[a.id].due - state.cards[b.id].due);
  const newLeft = Math.max(0, settings().newPerDay - (state.newSeen[d] || 0));
  const mtime = p => H.S.files.get(p)?.mtime || 0;
  const fresh = cards.filter(c => !state.cards[c.id]).sort((a, b) => mtime(b.path) - mtime(a.path) || a.line - b.line).slice(0, newLeft);
  return [...due, ...fresh];
}
// A check on one note: its new and due questions first, then the rest (up to 8).
export function noteQueue(path) {
  const d = today(), cards = cardsFor(path);
  const pri = c => (!state.cards[c.id] ? 0 : state.cards[c.id].due <= d ? 1 : 2);
  return [...cards].sort((a, b) => pri(a) - pri(b) || a.line - b.line).slice(0, 8);
}
export const dueCount = () => { if (!state) return 0; const s = stats(); return s.due + s.newToday; };

/* =====================================================================
   3. Check session (a quiz in a window)
   ===================================================================== */
let session = null;
// A draft belongs to one question in one vault, independent of its review history and due date.
const draftKey = id => 'mistakeDraft:' + JSON.stringify([H.S.vault, id]);
const lastDraftKey = () => 'lastMistakeDraft:' + H.S.vault;
export const mistakeDraft = id => H.store.get(draftKey(id), '');
export function lastDraftItem() {
  const id = H.store.get(lastDraftKey(), null);
  return id && state?.items?.[id]?.kind === 'mistake' && mistakeDraft(id) ? id : null;
}
function clearMistakeDraft(id) {
  if (mistakeDraft(id)) H.store.set(draftKey(id), '');
  if (H.store.get(lastDraftKey(), null) === id) H.store.set(lastDraftKey(), null);
}
function editMistakeDraft(id, text) {
  if (!text) { clearMistakeDraft(id); return; }
  H.store.set(draftKey(id), text);
  if (H.store.get(lastDraftKey(), null) !== id) H.store.set(lastDraftKey(), id);
}

export function startSession(cards, { title = t('review.title'), notePath = null, onDone = null, onClose = null } = {}) {
  if (!cards.length) { H.toast(t('review.noCards')); return; }
  closeSession();
  const el = document.body.appendChild(document.createElement('div'));
  el.className = 'review-modal';
  el.innerHTML = `<div class="review-bg"></div><div class="review-box">
    <div class="review-head"><span class="review-title"></span><span class="review-progress"></span><button class="review-x" title="Esc">×</button></div>
    <div class="review-bar"><div></div></div>
    <div class="review-card scroll"><div class="review-source"></div><div class="review-q markdown"></div><div class="review-a markdown hidden"></div></div>
    <div class="review-actions"></div></div>`;
  el.querySelector('.review-title').textContent = title;
  session = { el, queue: [...cards], done: 0, total: cards.length, good: 0, again: new Set(), notePath, results: [], onDone, onClose, rated: new Set() };
  el.querySelector('.review-bg').onclick = closeSession;
  el.querySelector('.review-x').onclick = closeSession;
  document.addEventListener('keydown', onKey, true);
  showCard();
}
function closeSession() {
  if (!session) return;
  const cb = session.onClose;
  session.returnBar?.remove();
  session.el.remove(); session = null;
  try { cb?.(); } catch (e) { console.warn(e); }
  document.removeEventListener('keydown', onKey, true);
  H.onReviewChange();
}
// Keep the exact queue, input and revealed state when looking up a source. The paper can be read normally.
async function consultSource(s, path, page) {
  const returnBar = document.createElement('div');
  returnBar.className = 'review-source-return';
  returnBar.innerHTML = `<button class="mod-button mod-cta" data-review-return>${escapeHtml(t('mist.backToReview'))}</button><button class="clickable-icon" data-review-dismiss aria-label="${escapeHtml(t('review.close'))}">×</button>`;
  const vault = H.S.vault;
  const resume = () => {
    if (session !== s) return;
    if (H.S.vault !== vault) { closeSession(); return; }
    returnBar.remove(); s.returnBar = null;
    document.body.append(s.el);
    document.addEventListener('keydown', onKey, true);
    s.el.querySelector('.review-try:not([readonly]), .review-actions button')?.focus();
  };
  returnBar.querySelector('[data-review-return]').onclick = resume;
  returnBar.querySelector('[data-review-dismiss]').onclick = closeSession;
  s.returnBar = returnBar;
  s.el.remove(); document.removeEventListener('keydown', onKey, true);
  document.body.append(returnBar);
  try { await H.openNote(path, { heading: page ? 'page=' + page : '' }); }
  catch (e) { resume(); H.toast(e.message); }
}
function onKey(e) {
  if (!session) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSession(); return; }
  // The "Done" page: Space and Enter close it (its only button); rating keys do nothing, so a second
  // press of "3" can never rate anything again. Checked first: on this page the answer area is hidden too.
  if (session.finished) {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); closeSession(); }
    else if (/^[1-4]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); }
    return;
  }
  if (!session.queue.length) return;
  const shown = !session.el.querySelector('.review-a').classList.contains('hidden');
  if (e.target?.closest?.('.review-try')) return; // typing an answer
  if (!shown && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); e.stopPropagation(); reveal(); return; }
  if (shown && /^[1-4]$/.test(e.key)) { e.preventDefault(); e.stopPropagation(); answer(+e.key); return; }
}
function showCard() {
  const s = session, card = s.queue[0];
  if (!card) return finish();
  const { el } = s;
  el.querySelector('.review-progress').textContent = t('review.progress', { i: Math.min(s.done + 1, s.total), n: s.total });
  el.querySelector('.review-bar > div').style.width = `${(s.done / s.total) * 100}%`;
  // Mistakes and PDF cards link back to the exact page of their source.
  el.querySelector('.review-source').innerHTML = card.kind === 'mistake' || card.kind === 'card'
    ? `<span class="review-kind">${escapeHtml(t(card.kind === 'mistake' ? 'mist.kind' : 'pcard.kind'))}</span> ${card.path ? `<a href="#" class="review-goto" data-path="${escapeHtml(card.path)}" data-page="${card.page || 0}">${escapeHtml(t('mist.backTo', { where: card.note }))}</a>` : ''}`
    : `<a href="#" data-open="${escapeHtml(card.path)}">${escapeHtml(t('review.fromNote', { note: card.note }))}</a>${card.section && card.kind !== 'note' ? ` <span class="review-section">› ${escapeHtml(card.section)}</span>` : ''}`;
  el.querySelector('.review-goto')?.addEventListener('click', ev => { ev.preventDefault(); ev.stopPropagation(); const { path, page } = ev.currentTarget.dataset; consultSource(s, path, +page); });
  H.renderInto(el.querySelector('.review-q'), card.q, card.path, 1);
  // A mistake: answer it again first (written down), then compare with your old answer.
  if (card.kind === 'mistake') {
    const prompt = el.querySelector('.review-q');
    prompt.insertAdjacentHTML('beforeend', `<textarea class="review-try" rows="4" placeholder="${escapeHtml(t('mist.tryPh'))}"></textarea><button class="mod-button review-draft-clear">${escapeHtml(t('mist.clearDraft'))}</button>`);
    const input = prompt.querySelector('.review-try'), clear = prompt.querySelector('.review-draft-clear');
    input.value = mistakeDraft(card.id);
    clear.hidden = !input.value;
    input.oninput = () => { editMistakeDraft(card.id, input.value); clear.hidden = !input.value; };
    clear.onclick = () => { input.value = ''; editMistakeDraft(card.id, ''); clear.hidden = true; input.focus(); };
  }
  const a = el.querySelector('.review-a');
  a.classList.add('hidden');
  H.renderInto(a, card.a, card.path, 1);
  const actions = el.querySelector('.review-actions');
  actions.innerHTML = `<button class="mod-button mod-cta review-show">${escapeHtml(t('review.showAnswer'))} <kbd>Space</kbd></button>`;
  actions.querySelector('.review-show').onclick = reveal;
}
function reveal() {
  const s = session, card = s?.queue[0];
  if (!card || s.finished) return;
  s.el.querySelector('.review-a').classList.remove('hidden');
  const tryEl = s.el.querySelector('.review-try');
  if (card.kind === 'mistake' && tryEl) {
    const answerNow = tryEl.value.trim();
    tryEl.readOnly = true;
    if (answerNow) { const v = state.items?.[card.id]; if (v) updateItem(card.id, { attempts: [...(v.attempts || []), { day: today(), answer: answerNow }] }); }
    if (mistakeDraft(card.id) === tryEl.value) clearMistakeDraft(card.id);
    s.el.querySelector('.review-draft-clear').hidden = true;
  }
  const cur = state.cards[card.id];
  const labels = [[1, 'again'], [2, 'hard'], [3, 'good'], [4, 'easy']];
  s.el.querySelector('.review-actions').innerHTML = labels.map(([r, k]) =>
    `<button class="mod-button review-rate rate-${k}" data-r="${r}"><b>${escapeHtml(t('review.' + k))}</b><small>${escapeHtml(intervalLabel(next(cur, r).interval))}</small><kbd>${r}</kbd></button>`).join('');
  s.el.querySelectorAll('.review-rate').forEach(b => { b.onclick = () => answer(+b.dataset.r); });
}
function answer(r) {
  const s = session;
  if (!s || s.finished || !s.queue.length || s.el.querySelector('.review-a').classList.contains('hidden')) return;
  const card = s.queue.shift();
  rate(card, r);
  if (!s.rated.has(card.id)) { s.rated.add(card.id); try { s.onDone?.(card); } catch (e) { console.warn(e); } }
  if (r === 1 && !s.again.has(card.id)) { s.again.add(card.id); s.queue.push(card); s.total++; } // see it again at the end
  else if (r >= 3 && !s.again.has(card.id)) s.good++;
  s.done++;
  showCard();
}
function finish() {
  const s = session;
  s.finished = true;
  if (s.notePath) setNoteState(s.notePath, { checked: today() });
  const firstTry = s.total - s.again.size;
  const upcoming = Object.values(state.cards).filter(c => c.due > today()).map(c => c.due).sort((a, b) => a - b)[0];
  s.el.querySelector('.review-progress').textContent = '';
  s.el.querySelector('.review-bar > div').style.width = '100%';
  s.el.querySelector('.review-source').innerHTML = '';
  s.el.querySelector('.review-a').classList.add('hidden');
  s.el.querySelector('.review-q').innerHTML = `<div class="review-done"><div class="review-done-icon">✔</div><h2>${escapeHtml(t('review.done'))}</h2>
    <p>${escapeHtml(t('review.summary', { good: s.good, n: firstTry }))}</p>
    ${upcoming ? `<p class="muted">${escapeHtml(t('review.next', { when: intervalLabel(upcoming - today()) }))}</p>` : ''}</div>`;
  s.el.querySelector('.review-actions').innerHTML = `<button class="mod-button mod-cta review-close">${escapeHtml(t('review.close'))}</button>`;
  const done = s.el.querySelector('.review-close');
  done.onclick = closeSession;
  done.focus({ preventScroll: true });
}
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Quiz on one note. With AI on, first let it write questions about the note (once per version of the note).
export async function checkNote(path) {
  if (!path) return;
  await reloadReview(); // start from what every window has saved
  const note = path.split('/').pop().replace(/\.md$/i, '');
  const ai = H.aiQuestions?.();
  if (ai) {
    const f = H.S.files.get(path), content = H.getNoteText(path);
    const key = hash(content);
    if (state.ai?.[path]?.key !== key && content.replace(/\s+/g, '').length >= 40) {
      H.toast(t('ai.writingQuestions'));
      try {
        const r = await ai('questions', { title: note, content, path });
        setAi(path, { key, cards: (r.questions || []).filter(q => q.question && q.answer).slice(0, 8).map(q => ({ q: String(q.question), a: String(q.answer) })) });
        if (f) cardCache.delete(path);
      } catch (e) { if (!e.offline) H.toast(t('ai.failedQuiz', { msg: e.message })); }
    }
  }
  startSession(noteQueue(path), { title: t('review.checkTitle', { note }), notePath: path });
}
export async function startDailyReview() { await reloadReview(); startSession(todaysQueue(), { title: t('review.title') }); }

/* ---------- "Check yourself?" card after writing a note ---------- */
let promptEl = null;
export function offerCheck(path) {
  if (!settings().checkAfterWriting || session) return;
  const n = noteQueue(path).length;
  promptEl?.remove();
  const note = path.split('/').pop().replace(/\.md$/i, '');
  promptEl = document.body.appendChild(document.createElement('div'));
  promptEl.className = 'review-prompt';
  promptEl.innerHTML = `<div class="review-prompt-title">🔎 ${escapeHtml(t('review.offerTitle', { note }))}</div>
    <div class="review-prompt-body">${escapeHtml(t('review.offerBody'))}</div>
    <div class="review-prompt-actions"><button class="mod-button mod-cta" data-a="check">${escapeHtml(t('check.checkBtn'))}</button>${n ? `<button class="mod-button" data-a="quiz">${escapeHtml(t('review.quizMe'))}</button>` : ''}<button class="mod-button" data-a="later">${escapeHtml(t('review.later'))}</button></div>`;
  promptEl.querySelectorAll('[data-a]').forEach(b => b.onclick = () => {
    promptEl.remove(); promptEl = null;
    if (b.dataset.a === 'check') H.checkNote(path);
    else if (b.dataset.a === 'quiz') checkNote(path);
  });
  setTimeout(() => { promptEl?.classList.add('fade'); }, 25000);
  setTimeout(() => { if (promptEl?.classList.contains('fade')) { promptEl.remove(); promptEl = null; } }, 30000);
}

/* =====================================================================
   4. Review page
   ===================================================================== */
export function renderReviewPage(el) {
  const s = stats(), d = today();
  const notes = new Map();
  for (const c of allCards()) {
    const st = state.cards[c.id];
    const n = notes.get(c.path) || { path: c.path, note: c.note, due: 0, total: 0, fresh: 0 };
    n.total++;
    if (!st) n.fresh++; else if (st.due <= d) n.due++;
    notes.set(c.path, n);
  }
  const all = [...notes.values()];
  const toRevise = all.filter(n => n.due).sort((a, b) => b.due - a.due);
  const mtime = p => H.S.files.get(p)?.mtime || 0;
  const unchecked = all.filter(n => !state.notes[n.path]).sort((a, b) => mtime(b.path) - mtime(a.path)).slice(0, 12);
  const todayN = s.due + s.newToday;
  const row = n => `<div class="review-note"><a href="#" data-open="${escapeHtml(n.path)}">${escapeHtml(n.note)}</a>
    <span class="muted">${escapeHtml(n.due ? t('review.dueN', { n: n.due }) : t('review.questionsN', { n: n.total }))}</span>
    <button class="mod-button" data-check="${escapeHtml(n.path)}">${escapeHtml(t('review.check'))}</button></div>`;
  // last 14 days of activity
  const days = [...Array(14)].map((_, k) => d - 13 + k).map(k => state.days[k] || 0);
  const max = Math.max(1, ...days);
  el.innerHTML = `<div class="col review-page">
    <h1>${escapeHtml(t('review.title'))}</h1>
    <p class="muted">${escapeHtml(t('review.intro'))}</p>
    <div class="review-start">
      <button class="mod-button mod-cta" data-start ${todayN ? '' : 'disabled'}>${escapeHtml(todayN ? t('review.startN', { n: todayN }) : t('review.nothing'))}</button>
      <button class="mod-button" data-cmd-run="revision-plan">${escapeHtml(t('cmd.revision-plan'))}</button>
      <button class="mod-button" data-cmd-run="exam-analysis">${escapeHtml(t('cmd.exam-analysis'))}</button>
      <button class="mod-button" data-cmd-run="mock-paper">${escapeHtml(t('cmd.mock-paper'))}</button>
    </div>
    <div class="review-stats">
      ${[['dueToday', s.due], ['newCards', s.newToday], ['reviewedToday', s.reviewedToday], ['streak', s.streak], ['total', s.total], ['mature', s.mature]]
        .map(([k, v]) => `<div class="review-stat"><b>${v}</b><span>${escapeHtml(t('review.' + k))}</span></div>`).join('')}
    </div>
    <div class="review-chart" title="${escapeHtml(t('review.last14'))}">${days.map(v => `<div style="height:${Math.round((v / max) * 100)}%" title="${v}"></div>`).join('')}</div>
    <h2>${escapeHtml(t('review.notesToRevise'))}</h2>
    ${toRevise.length ? toRevise.map(row).join('') : `<p class="empty-hint">${escapeHtml(t('review.noneToRevise'))}</p>`}
    <h2>${escapeHtml(t('review.notChecked'))}</h2>
    ${unchecked.length ? unchecked.map(row).join('') : `<p class="empty-hint">${escapeHtml(t('review.allChecked'))}</p>`}
    <h2>${escapeHtml(t('review.howTitle'))}</h2>
    <div class="review-how markdown"></div>
  </div>`;
  H.renderInto(el.querySelector('.review-how'), t('review.how'), '', 1);
  H.studyExtras?.(el.querySelector('.review-page'));
  el.querySelector('[data-start]').onclick = startDailyReview;
  el.querySelectorAll('[data-cmd-run]').forEach(b => { b.onclick = () => H.runCommand(b.dataset.cmdRun); });
  el.querySelectorAll('[data-check]').forEach(b => { b.onclick = () => checkNote(b.dataset.check); });
}

/* =====================================================================
   5. Related notes (word similarity, TF-IDF)
   ===================================================================== */
const STOP = new Set('the and for are but not you all any can had her was one our out has his how its may new now old see two way who did get him let put say she too use that this with from have they will your what when which their there been were them than then into more some also just like only over such very most other about would could should these those after where while because between being through each make made many much here same well even back upon le la les des une est que pour dans pas sur avec qui par plus son ses aux sont el los las del una por con para como más pero sus der die das und ist nicht mit sich auf'.split(' '));
// Chinese has no spaces, so it is split into two-character pairs. Pairs containing a function word
// (的, 们, 这, 就…) or on the filler list say nothing about the topic ("我们", "的列"), so they are skipped.
const CJK_FUNC = new Set('的了是我们你他她它这那就也都而并或把被让给从到为以于之其个么吗呢吧啊着过得地很再又还即则所如若将已该此每各某在两'.split(''));
// "一" only counts at the end of a word like 唯一 / 统一; otherwise it is glue (构成一组, 一个).
const CJK_ONE_OK = new Set('唯一 统一 同一 第一 万一'.split(' '));
const CJK_STOP = new Set('一个 一组 一些 一下 一样 一种 一点 一般 一定 可以 能够 可能 需要 应该 不难 不是 没有 只有 只是 然后 但是 不过 什么 怎么 怎样 进行 注意 发现 直接 还是 并且 因此 由于 例如 比如 然而 同样 一起 这些 那些 部分 东西 时候 问题 方法 情况 结果 来源 相同 不同 任意 任何 至少 本来 根据 表示 两边 证明 得出 得到 显然 容易 不妨 那么 首先 最后 其次 另外 下面 上面 前面 后面 出来 起来 下来'.split(' '));
const vecCache = new Map(); // path -> { key, tf }
function terms(text) {
  const out = [];
  const clean = text
    // Frontmatter. tf() puts the note's name in front ("name ---\n…"), so allow text before it on line 1.
    .replace(/^([^\n]*?)---\r?\n[\s\S]*?\r?\n---/, '$1')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`\n]*`/g, ' ')
    // Formulas: drop LaTeX commands and environment names (\dfrac, \lVert, \begin{pmatrix}) so they
    // never look like shared topics; the words inside \text{…} are kept.
    .replace(/\\(?:begin|end)\{[^}]*\}/g, ' ')
    .replace(/\\text\{([^}]*)\}/g, ' $1 ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/\[\[([^\]|#]+)[^\]]*\]\]/g, ' $1 ')
    .replace(/https?:\/\/\S+/g, ' ');
  for (const w of clean.toLowerCase().match(/[\p{L}\p{N}]+/gu) || []) {
    if (/[぀-ヿ㐀-鿿가-힯]/.test(w)) {
      for (let i = 0; i < w.length - 1; i++) {
        const bi = w.slice(i, i + 2);
        // After a filler word (根据), also skip the pair straddling it (据定 in 根据定义).
        if (CJK_STOP.has(bi)) { i++; continue; }
        if (!/[぀-ヿ㐀-鿿가-힯]{2}/.test(bi) || CJK_FUNC.has(bi[0]) || CJK_FUNC.has(bi[1])) continue;
        if (bi.includes('一') && !CJK_ONE_OK.has(bi)) continue;
        out.push(bi);
      }
    }
    // Skip pure numbers and letter-number codes like mp4 / la10 (file names, slide numbers).
    else if (w.length > 2 && !STOP.has(w) && !/\d/.test(w)) out.push(w);
  }
  return out;
}
function tf(path) {
  const f = H.S.files.get(path);
  const key = hash(f.content || '');
  const c = vecCache.get(path);
  if (c && c.key === key) return c.tf;
  const m = new Map();
  for (const w of terms(`${path.split('/').pop().replace(/\.md$/i, '')} ${f.content || ''}`)) m.set(w, (m.get(w) || 0) + 1);
  vecCache.set(path, { key, tf: m });
  return m;
}
// Notes most similar to `path` that aren't already linked either way.
export function relatedNotes(path, linked = new Set(), limit = 5) {
  if (!H) return [];
  const notes = [...H.S.files.values()].filter(f => /\.md$/i.test(f.path) && f.content != null);
  if (notes.length < 3) return [];
  const df = new Map();
  for (const f of notes) for (const w of tf(f.path).keys()) df.set(w, (df.get(w) || 0) + 1);
  const N = notes.length;
  const vec = p => {
    const v = new Map(); let norm = 0;
    for (const [w, n] of tf(p)) { const x = (1 + Math.log(n)) * Math.log(1 + N / (df.get(w) || 1)); v.set(w, x); norm += x * x; }
    return { v, norm: Math.sqrt(norm) || 1 };
  };
  const me = vec(path);
  const out = [];
  for (const f of notes) {
    if (f.path === path || linked.has(f.path)) continue;
    const o = vec(f.path);
    let dot = 0; const shared = [];
    for (const [w, x] of me.v) { const y = o.v.get(w); if (y) { dot += x * y; shared.push([w, x * y]); } }
    const score = dot / (me.norm * o.norm);
    if (score > 0.05) out.push({ path: f.path, score, words: sharedTerms(shared) });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

// The top shared terms to show as chips. Chinese two-character pieces that overlap (单位 位矩 矩阵) are
// joined back into the word they came from (单位矩阵), and a piece already inside a longer one is dropped.
function sharedTerms(shared, n = 3) {
  const top = shared.sort((a, b) => b[1] - a[1]).slice(0, 12).map(s => s[0]);
  const cjk = w => /^[぀-ヿ㐀-鿿가-힯]{2}$/.test(w);
  const set = new Set(top), used = new Set(), out = [];
  for (const w of top) {
    if (used.has(w)) continue;
    let word = w;
    if (cjk(w)) {
      used.add(w);
      // Grow to the right and to the left while an overlapping piece is also shared.
      for (let grew = true; grew;) {
        grew = false;
        for (const x of set) {
          if (used.has(x) || !cjk(x)) continue;
          if (x[0] === word[word.length - 1]) { word += x[1]; used.add(x); grew = true; }
          else if (x[1] === word[0]) { word = x[0] + word; used.add(x); grew = true; }
        }
      }
    }
    if (!out.some(o => o.includes(word))) out.push(word);
    if (out.length >= n) break;
  }
  return out;
}

// Every pair of notes whose wording is similar (TF-IDF cosine), for the graph's "associations".
// Each note keeps only its strongest few, so the graph shows real associations rather than noise.
let assocCache = { key: '', list: [] };
export function associations({ perNote = 3, min = 0.12 } = {}) {
  if (!H) return [];
  const notes = [...H.S.files.values()].filter(f => /\.md$/i.test(f.path) && f.content != null);
  const key = notes.map(f => f.path + ':' + (f.content.length)).join('|') + `|${perNote}|${min}`;
  if (assocCache.key === key) return assocCache.list;
  if (notes.length < 3 || notes.length > 2500) return (assocCache = { key, list: [] }).list;
  const df = new Map();
  for (const f of notes) for (const w of tf(f.path).keys()) df.set(w, (df.get(w) || 0) + 1);
  const N = notes.length;
  const vecs = notes.map(f => {
    const v = new Map(); let norm = 0;
    for (const [w, n] of tf(f.path)) { if (df.get(w) >= N * 0.6) continue; const x = (1 + Math.log(n)) * Math.log(1 + N / df.get(w)); v.set(w, x); norm += x * x; }
    return { path: f.path, v, norm: Math.sqrt(norm) || 1 };
  });
  const best = new Map(vecs.map(a => [a.path, []]));
  for (let i = 0; i < vecs.length; i++) {
    const a = vecs[i];
    for (let j = i + 1; j < vecs.length; j++) {
      const b = vecs[j], [s, l] = a.v.size < b.v.size ? [a, b] : [b, a];
      let dot = 0;
      for (const [w, x] of s.v) { const y = l.v.get(w); if (y) dot += x * y; }
      const score = dot / (a.norm * b.norm);
      if (score >= min) { const e = { a: a.path, b: b.path, score }; best.get(a.path).push(e); best.get(b.path).push(e); }
    }
  }
  const keep = new Set();
  for (const list of best.values()) list.sort((x, y) => y.score - x.score).slice(0, perNote).forEach(e => keep.add(e));
  return (assocCache = { key, list: [...keep] }).list;
}

// How well a note is remembered, from its quiz progress. strength: 0–1 (chance of recalling it today),
// null when nothing in it has been studied yet. Uses a simple forgetting curve: ~90% recall on the due day.
export function noteMemory(path) {
  if (!state || !H) return null;
  const cards = cardsFor(path);
  if (!cards.length) return { total: 0, seen: 0, due: 0, strength: null, next: null };
  const d = today();
  let seen = 0, due = 0, sum = 0, next = Infinity;
  for (const c of cards) {
    const s = state.cards[c.id];
    if (!s) continue;
    seen++;
    if (s.due <= d) due++;
    next = Math.min(next, s.due);
    // A card you just got wrong ("Again") counts as half-forgotten even if you saw it today.
    sum += Math.pow(0.9, (Math.max(0, d - (s.last ?? d)) + (s.reps ? 0 : 6)) / Math.max(1, s.interval));
  }
  // Strength is over all of the note's cards: cards never reviewed count as not known yet, so reviewing
  // one card out of eight can't make the whole note look "well remembered".
  return { total: cards.length, seen, due, strength: seen ? sum / cards.length : null, next: next === Infinity ? null : next - d };
}

// Keep progress when a note is renamed or moved.
export function renamed(from, to) {
  if (!state) return;
  // Every change goes through setCard / setNoteState / setAi, so a rename merges like any other save.
  for (const [id, c] of Object.entries(state.cards)) if (c.path === from) setCard(id, { ...c, path: to });
  if (state.notes[from]) { setNoteState(to, state.notes[from]); setNoteState(from, null); }
  // Card ids include the path, so re-key them.
  const oldCards = cardsForContent(from, to);
  for (const [oldId, newId] of oldCards) if (state.cards[oldId]) { setCard(newId, state.cards[oldId]); setCard(oldId, null); }
  // AI-written questions move with the note, progress included.
  if (state.ai?.[from]) {
    const moved = state.ai[from];
    setAi(to, moved); setAi(from, null);
    for (const c of moved.cards) {
      const o = hash(`${from}\u0000ai\u0000${c.q}`), n = hash(`${to}\u0000ai\u0000${c.q}`);
      if (state.cards[o]) { setCard(n, state.cards[o]); setCard(o, null); }
    }
  }
  cardCache.delete(from); cardCache.delete(to);
}
function cardsForContent(from, to) {
  const f = H.S.files.get(to);
  if (!f || f.content == null) return [];
  const a = extractCards(from, f.content), b = extractCards(to, f.content);
  return a.map((c, i) => [c.id, b[i]?.id]).filter(([, n]) => n);
}

// Make sure a plan day has a fixed list of cards (for days that were never started, before carrying them over).
export function ensurePlanDay(plan, key, links) {
  const pid = planKey(plan, key);
  if (!state.plans?.[pid]) setPlan(pid, { ids: planDayIds(links || []), done: [], started: null });
  return state.plans[pid];
}
// "2026-11-21" ⇄ the day numbers used for due dates.
export const dayFromDate = s => { const m = String(s).match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/); return m ? Math.floor(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; };
export const dateOfDay = n => new Date(n * 86400000).toISOString().slice(0, 10);
