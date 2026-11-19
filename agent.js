'use strict';
// Graphite's own agent harness: the jobs that used to need the Claude Code window (find new course files, file
// the Claude Inbox captures, update the Claude Brain) can run with any API model the user picked in Settings → AI.
//
// Every job has two phases, so nothing is copied or written before the user says yes:
//   plan  — the model looks around with read-only tools (list_dir, read_file) and calls submit_plan. The server
//           checks the plan (paths stay inside the vault, sources come from the scan) and keeps it in memory.
//   apply — after the user confirms (and maybe unticks some items) the server carries out the plan itself:
//           copies files (never overwriting), makes PDF copies of Office files, appends to notes, ticks the
//           inbox, writes Brain edits with a compare-and-swap on the hash it saw. For imports a second, short
//           model loop then adds the new files to the course index notes with write_vault_file.
// Sandbox: reads only inside the vault and the course folders the user approved (minus left-out names such as
// UPC); writes only inside the vault, never in .obsidian/, .trash/ or the mirrored brain folders.
// Progress is streamed as one JSON object per line: {"progress":{...}} … then {"result":{...}} or {"error":"…"}.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

module.exports = function createAgent(h) {
  const { HttpError, hash, inVault, toRel, exists, uniquePath, atomicWrite, withFileLock, officeToPdf, readBody, LANG_NAMES } = h;
  const VAULT = () => h.vault();
  const WIN = process.platform === 'win32';
  const low = s => (WIN ? s.toLowerCase() : s);
  const norm = p => p.replace(/\\/g, '/');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const MANIFEST = '.obsidian/plugins/claude-chat/imports.json';
  const INBOX = 'Claude Inbox.md';
  const BRAIN = 'Claude Brain';
  const NO_WRITE = /^(\.|My Brain(\/|$)|我的大脑知识库(\/|$))|\/\./;
  const MAX_BYTES = 300 * 1024 * 1024;
  const DOC_EXT = /\.(pdf|pptx?|docx?)$/i, NOTE_EXT = /\.md$/i, OFFICE = /\.(pptx?|docx?)$/i;
  const SKIP_DIR = /^(\.git|\.vscode|node_modules|Videos?|Practice|artifacts|build|dist|out|bin|obj|__pycache__|\.venv|venv|env|\.idea|\.obsidian|\.trash)$/i;
  const SKIP_FILE = /^(~\$|\.~lock|desktop\.ini$|thumbs\.db$)/i;
  const plans = new Map(); // planId → { job, at, ... } (kept one hour)

  /* ---------- sandbox ---------- */
  function cleanRoots(body) {
    const skip = (Array.isArray(body.skip) ? body.skip : ['UPC']).map(s => String(s).trim()).filter(Boolean);
    const roots = (Array.isArray(body.roots) ? body.roots : []).map(r => String(r).trim()).filter(r => r && path.isAbsolute(r)).map(r => path.resolve(r));
    return { roots: roots.filter(r => !inside(r, VAULT())), skip: skip.map(low) };
  }
  function inside(abs, dir) { const a = low(abs), d = low(dir); return a === d || a.startsWith(d.endsWith(path.sep) ? d : d + path.sep); }
  function skipped(abs, sb) { return abs.split(/[\\/]/).some(seg => sb.skip.includes(low(seg))); }
  // A path the model gave: absolute → must be in an approved course folder; relative → in the vault.
  function resolveRead(p, sb) {
    p = String(p || '').trim();
    if (!p || p === '.' || p === '/') return { abs: VAULT(), vault: true };
    if (path.isAbsolute(p) && !/^[/\\][^/\\]/.test(p)) {
      const abs = path.resolve(p);
      if (inside(abs, VAULT())) return checkVault(abs);
      if (!sb.roots.some(r => inside(abs, r))) throw new Error('Not allowed: only the vault and the approved course folders can be read');
      if (skipped(abs, sb)) throw new Error('Not allowed: this folder is left out');
      return { abs, vault: false };
    }
    return checkVault(inVault(p));
  }
  function checkVault(abs) {
    const rel = toRel(abs);
    if (rel.split('/').some(s => s.startsWith('.'))) throw new Error('Not allowed: hidden folders in the vault');
    return { abs, vault: true, rel };
  }
  async function realOk(abs, sb) { // no escaping through links
    const real = await fsp.realpath(abs).catch(() => abs);
    if (inside(real, VAULT()) || sb.roots.some(r => inside(real, r))) return;
    throw new Error('Not allowed: the path leads outside the allowed folders');
  }
  function writeTarget(rel) {
    rel = norm(String(rel || '').trim()).replace(/^\/+/, '');
    if (!rel || !NOTE_EXT.test(rel)) throw new Error('Only Markdown notes (.md) can be written');
    if (NO_WRITE.test(rel) || rel.split('/').some(s => s === '..' || s.startsWith('.'))) throw new Error('Not allowed to write there: ' + rel);
    const abs = inVault(rel);
    return { abs, rel: toRel(abs) };
  }

  /* ---------- tools ---------- */
  const TOOL_DEFS = {
    list_dir: { description: 'List a folder. Use a vault-relative path ("" for the vault root) or an absolute path inside an approved course folder.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    read_file: { description: 'Read a text file or note (Markdown, text). For PDFs, returns the first pages\' text when available. Vault-relative or absolute in an approved course folder.',
      parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } },
    write_vault_file: { description: 'Write a whole Markdown note in the vault (vault-relative path). An existing note must be read first in this session; keep every line that was there and only add.',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
    finish: { description: 'Call when done, with a short summary for the user.', parameters: { type: 'object', properties: { summary: { type: 'string' } }, required: ['summary'] } },
  };
  function tools(run) {
    return {
      async list_dir({ path: p }) {
        const r = resolveRead(p, run.sb);
        await realOk(r.abs, run.sb);
        run.progress({ step: 'list', path: r.vault ? (r.rel || '/') : norm(r.abs) });
        const ents = await fsp.readdir(r.abs, { withFileTypes: true }).catch(e => { throw new Error(e.code === 'ENOENT' ? 'No such folder' : e.message); });
        const out = [];
        for (const e of ents) {
          if (e.name.startsWith('.') || SKIP_FILE.test(e.name)) continue;
          if (e.isDirectory()) { if (!skipped(path.join(r.abs, e.name), run.sb)) out.push(e.name + '/'); continue; }
          const st = await fsp.stat(path.join(r.abs, e.name)).catch(() => null);
          if (st) out.push(`${e.name}  (${Math.round(st.size / 1024)} KB, ${new Date(st.mtimeMs).toISOString().slice(0, 10)})`);
          if (out.length >= 300) { out.push('… more not shown'); break; }
        }
        return out.join('\n') || '(empty)';
      },
      async read_file({ path: p }) {
        const r = resolveRead(p, run.sb);
        await realOk(r.abs, run.sb);
        run.progress({ step: 'read', path: r.vault ? r.rel : norm(r.abs) });
        const st = await fsp.stat(r.abs).catch(() => null);
        if (!st || !st.isFile()) throw new Error('No such file');
        if (/\.pdf$/i.test(r.abs)) return (await pdfText(r.abs, 2)) || `(PDF, ${Math.round(st.size / 1024)} KB; its text can't be read here)`;
        if (!/\.(md|txt|csv|json|tex)$/i.test(r.abs)) return `(binary file, ${Math.round(st.size / 1024)} KB)`;
        const text = await fsp.readFile(r.abs, 'utf8');
        if (r.vault) run.seen.set(low(r.abs), hash(text));
        return text.length > 30000 ? text.slice(0, 30000) + '\n… (cut)' : text;
      },
      async write_vault_file({ path: p, content }) {
        const { abs, rel } = writeTarget(p);
        content = String(content ?? '');
        if (!content.trim()) throw new Error('Empty content');
        return withFileLock(abs, async () => {
          if (await exists(abs)) {
            const seen = run.seen.get(low(abs));
            if (!seen) throw new Error('Read the note first, then write it');
            const cur = await fsp.readFile(abs, 'utf8');
            if (hash(cur) !== seen) { run.seen.delete(low(abs)); throw new Error('The note changed since you read it; read it again'); }
            const have = new Set(content.split(/\r?\n/).map(l => l.trim()));
            const lost = cur.split(/\r?\n/).map(l => l.trim()).filter(l => l && !have.has(l));
            if (lost.length) throw new Error('Not written: keep every existing line. Missing: ' + lost.slice(0, 3).join(' | '));
            await atomicWrite(abs, content);
          } else {
            await fsp.mkdir(path.dirname(abs), { recursive: true });
            await fsp.writeFile(abs, content, { flag: 'wx' });
          }
          run.seen.set(low(abs), hash(content));
          if (!run.edited.includes(rel)) run.edited.push(rel);
          run.progress({ step: 'write', path: rel });
          return 'Written ' + rel;
        });
      },
    };
  }
  function pdfText(abs, pages) {
    return new Promise(res => execFile('pdftotext', ['-l', String(pages), '-q', abs, '-'], { encoding: 'utf8', timeout: 8000, windowsHide: true },
      (err, out) => res(err ? '' : String(out).replace(/\s+/g, ' ').trim().slice(0, 3000))));
  }

  /* ---------- the model loop (OpenAI-compatible providers and Anthropic) ---------- */
  async function loop(run, { system, user, toolNames, submit, maxTurns = 14 }) {
    const impl = tools(run);
    const defs = toolNames.map(n => [n, n === submit.name ? submit : TOOL_DEFS[n]]);
    const terminal = submit.name;
    const anth = run.provider === 'anthropic';
    const msgs = [{ role: 'user', content: user }];
    let nudged = 0;
    for (let turn = 0; turn < maxTurns; turn++) {
      if (run.signal.aborted) throw new HttpError(499, 'Stopped');
      run.progress({ step: 'think', turn: turn + 1 });
      const last = turn === maxTurns - 1;
      const r = anth ? await anthropicTurn(run, system, msgs, defs, last ? terminal : null) : await compatTurn(run, system, msgs, defs, last ? terminal : null);
      if (!r.calls.length) {
        // No tool call: maybe the plan came as plain JSON text.
        try { const j = h.parseJsonReply(r.text || ''); if (j && typeof j === 'object') return j; } catch { /* not JSON */ }
        if (nudged++ >= 2) throw new HttpError(502, 'The model did not finish the job; try again or pick another model');
        msgs.push(anth ? { role: 'assistant', content: r.text || '…' } : { role: 'assistant', content: r.text || '…' });
        msgs.push({ role: 'user', content: `Use the tools. When you are done, call ${terminal}.` });
        continue;
      }
      const results = [];
      for (const c of r.calls) {
        if (c.name === terminal) {
          if (c.bad) { results.push({ id: c.id, text: 'Error: the arguments were not valid JSON' }); continue; }
          return c.args;
        }
        let text;
        try {
          if (!toolNames.includes(c.name) || !impl[c.name]) throw new Error('Unknown tool ' + c.name);
          if (c.bad) throw new Error('The arguments were not valid JSON');
          text = String(await impl[c.name](c.args || {}));
        } catch (e) { text = 'Error: ' + e.message; }
        results.push({ id: c.id, text: text.length > 40000 ? text.slice(0, 40000) + '\n… (cut)' : text });
      }
      if (anth) {
        msgs.push({ role: 'assistant', content: r.raw });
        msgs.push({ role: 'user', content: results.map(x => ({ type: 'tool_result', tool_use_id: x.id, content: x.text })) });
      } else {
        msgs.push(r.raw);
        for (const x of results) msgs.push({ role: 'tool', tool_call_id: x.id, content: x.text });
      }
    }
    throw new HttpError(502, 'The model took too many steps; try again or pick another model');
  }

  async function compatTurn(run, system, msgs, defs, force) {
    const cc = h.compatCaller(run.provider, run.key, run.body);
    const tok = cc.P.tokens || 'max_tokens';
    const toolsArg = defs.map(([name, d]) => ({ type: 'function', function: { name, description: d.description, parameters: d.parameters } }));
    const base = { model: run.model, messages: [{ role: 'system', content: system }, ...msgs], tools: toolsArg, [tok]: 8000,
      tool_choice: force ? { type: 'function', function: { name: force } } : 'auto' };
    let data;
    try { data = await cc.call('/chat/completions', { method: 'POST', body: JSON.stringify({ ...base, ...(cc.P.extra || {}) }), signal: run.signal }); }
    catch (e) { if (e.raw === 400 || e.raw === 422) data = await cc.call('/chat/completions', { method: 'POST', body: JSON.stringify({ ...base, tool_choice: 'auto' }), signal: run.signal }); else throw e; }
    const m = (data.choices && data.choices[0] && data.choices[0].message) || {};
    const calls = (m.tool_calls || []).map((c, i) => {
      let args = null, bad = false;
      try { args = typeof c.function?.arguments === 'string' ? JSON.parse(c.function.arguments || '{}') : (c.function?.arguments || {}); } catch { bad = true; }
      return { id: c.id || 'call_' + i, name: c.function?.name, args, bad };
    });
    const raw = { role: 'assistant', content: m.content || null, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}), ...(m.reasoning_content ? { reasoning_content: m.reasoning_content } : {}) };
    return { text: String(m.content || ''), calls, raw };
  }

  async function anthropicTurn(run, system, msgs, defs, force) {
    const client = h.anthropicClient(run.key);
    try {
      const r = await client.messages.create({
        model: run.model, max_tokens: 8000, system, messages: msgs,
        tools: defs.map(([name, d]) => ({ name, description: d.description, input_schema: d.parameters })),
        ...(force ? { tool_choice: { type: 'tool', name: force } } : {}),
      }, { signal: run.signal });
      if (r.stop_reason === 'refusal') throw new HttpError(422, 'Claude declined to do this');
      const calls = r.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input || {} }));
      return { text: r.content.filter(b => b.type === 'text').map(b => b.text).join(''), calls, raw: r.content };
    } catch (e) { throw h.anthropicError(e, run.model); }
  }

  /* ---------- import: scan (ported from the obsidian-import skill's scan.js) ---------- */
  async function readManifest() {
    try { return { imported: {}, ignored: {}, ...JSON.parse(await fsp.readFile(inVault(MANIFEST), 'utf8')) }; } catch { return { imported: {}, ignored: {} }; }
  }
  async function scan(sb, extras, progress) {
    const manifest = await readManifest();
    const key = p => norm(p).toLowerCase();
    const bySize = new Set(), pdfNames = new Set(), folders = [];
    async function walkVault(dir, depth) {
      let ents = []; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 3) folders.push(toRel(p)); await walkVault(p, depth + 1); continue; }
        const ext = path.extname(e.name).toLowerCase();
        const st = await fsp.stat(p).catch(() => null);
        if (st) bySize.add(st.size + ext);
        if (ext === '.pdf') pdfNames.add(path.basename(e.name, ext).toLowerCase());
      }
    }
    await walkVault(VAULT(), 0);
    const inV = (file, size) => {
      const ext = path.extname(file).toLowerCase();
      return bySize.has(size + ext) || (OFFICE.test(ext) && pdfNames.has(path.basename(file, ext).toLowerCase()));
    };
    const candidates = [], counts = { scanned: 0, inVault: 0, known: 0, ignored: 0 };
    async function consider(file, st, course, rel) {
      counts.scanned++;
      const k = key(file);
      if (manifest.ignored[k]) { counts.ignored++; return; }
      const prev = manifest.imported[k];
      if (prev && prev.size === st.size && Math.abs((prev.mtime || 0) - st.mtimeMs) < 2000) { counts.known++; return; }
      if (inV(file, st.size)) { counts.inVault++; return; }
      const ext = path.extname(file).toLowerCase();
      const c = { src: norm(file), name: path.basename(file), size: st.size, modified: new Date(st.mtimeMs).toISOString().slice(0, 10),
        kind: NOTE_EXT.test(ext) ? 'note' : OFFICE.test(ext) ? 'convert' : 'copy', course: course || null, rel: rel || null, changed: !!prev };
      if (!course && ext === '.pdf') { const fp = await pdfText(file, 1); if (fp) c.firstPage = fp.slice(0, 300); }
      candidates.push(c);
    }
    async function walk(dir, course, base, { recentOnly = false, depth = 0, maxDepth = 8 } = {}) {
      let ents = []; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIR.test(e.name) && !sb.skip.includes(low(e.name)) && depth < maxDepth && !inside(p, VAULT())) await walk(p, course, base, { recentOnly, depth: depth + 1, maxDepth });
          continue;
        }
        if (SKIP_FILE.test(e.name)) continue;
        if (!DOC_EXT.test(e.name) && !(course && NOTE_EXT.test(e.name))) continue;
        const st = await fsp.stat(p).catch(() => null);
        if (!st || st.size === 0 || st.size > MAX_BYTES) continue;
        if (recentOnly && Date.now() - st.mtimeMs > 180 * 864e5) continue;
        await consider(p, st, course, course ? norm(path.relative(base, p)) : null);
      }
    }
    // Each folder directly inside an approved root is a course (files right in the root count for the root).
    for (const root of sb.roots) {
      if (skipped(root, sb)) continue;
      progress({ step: 'scan', path: norm(root) });
      let ents = []; try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        const p = path.join(root, e.name);
        if (e.isDirectory()) { if (!SKIP_DIR.test(e.name) && !sb.skip.includes(low(e.name)) && !e.name.startsWith('.')) await walk(p, e.name, p); }
        else if (e.isFile() && !SKIP_FILE.test(e.name) && (DOC_EXT.test(e.name) || NOTE_EXT.test(e.name))) {
          const st = await fsp.stat(p).catch(() => null);
          if (st && st.size && st.size <= MAX_BYTES) await consider(p, st, path.basename(root), e.name);
        }
      }
    }
    if (extras) {
      const home = require('os').homedir();
      for (const d of ['Downloads', 'Desktop', 'Documents']) { progress({ step: 'scan', path: norm(path.join(home, d)) }); await walk(path.join(home, d), null, null, { recentOnly: true, maxDepth: 2 }); }
    }
    // The same file found twice: keep the course-folder one.
    const seen = new Map();
    for (const c of [...candidates].sort((a, b) => (b.course ? 1 : 0) - (a.course ? 1 : 0))) {
      const k = c.size + path.extname(c.name).toLowerCase();
      if (seen.has(k)) c.duplicateOf = seen.get(k); else seen.set(k, c.src);
    }
    // Where earlier imports went, by course: a strong hint for the model.
    const hints = {};
    for (const [src, v] of Object.entries(manifest.imported)) {
      const course = sb.roots.map(r => norm(r).toLowerCase()).filter(r => src.startsWith(r + '/')).map(r => src.slice(r.length + 1).split('/')[0])[0];
      if (course && v.dest) { const f = norm(v.dest).split('/').slice(0, -1).join('/'); (hints[course] ||= new Set()).add(f); }
    }
    return { candidates, counts, folders, hints: Object.fromEntries(Object.entries(hints).map(([k, s]) => [k, [...s].slice(0, 8)])) };
  }

  const IMPORT_SYSTEM = lang => `You file a university student's course files into their notes vault (Graphite, an Obsidian-style app).
You get a list of candidate files found on their computer that are not in the vault yet, the vault's folders, and where earlier imports of each course went.
Decide for each candidate:
- Course-folder files (course set): import. Put them where files of the same kind of that course already are. Usual layout (look at the vault to confirm, and copy its folder names exactly): slides/lecture decks → "<Course>/课件 Slides/", textbooks → "<Course>/教材/", homework/assignments → "<Course>/作业 Homework/", exams/mock papers/solutions/review → "<Course>/复习资料/", anything else → "<Course>/<same subfolder name>/". <Course> is the vault folder for that course (e.g. LA → "Linear Algebra"); use the earlier imports and the vault folders to find it.
- PowerPoint/Word files get a .pdf destination with the same base name (a PDF copy is made). Markdown notes keep .md.
- Files from Downloads/Desktop/Documents (course null): use the name and firstPage to tell the course. Import only clear course material. Put entries with duplicateOf in ignore with reason "same as <path>". Personal non-study files (bank statements, IDs, tickets, CVs): leave out silently (neither import nor ignore). Unsure: add a question instead.
Use list_dir and read_file only when you need to look (a few calls at most). Then call submit_plan once, with items by candidate id and dest relative to the vault.
Write reasons, questions and the note in ${lang}.`;
  const IMPORT_SUBMIT = { name: 'submit_plan', description: 'The filing plan. Nothing is copied until the user confirms it.',
    parameters: { type: 'object', required: ['items'], properties: {
      items: { type: 'array', items: { type: 'object', required: ['id', 'dest'], properties: { id: { type: 'integer' }, dest: { type: 'string', description: 'vault-relative path including the file name' } } } },
      ignore: { type: 'array', items: { type: 'object', required: ['id', 'reason'], properties: { id: { type: 'integer' }, reason: { type: 'string' } } } },
      questions: { type: 'array', items: { type: 'object', required: ['id', 'question'], properties: { id: { type: 'integer' }, question: { type: 'string' } } } },
      note: { type: 'string' } } } };

  async function importPlan(run) {
    const { candidates, counts, folders, hints } = await scan(run.sb, !!run.body.extras, run.progress);
    if (!candidates.length) return { job: 'import', empty: true, counts, items: [], ignore: [], questions: [] };
    const shown = candidates.slice(0, 300);
    const user = `Today: ${today()}\n\n<candidates>\n${shown.map((c, i) => JSON.stringify({ id: i, ...c })).join('\n')}\n</candidates>\n` +
      (candidates.length > shown.length ? `(${candidates.length - shown.length} more not shown; they will be offered next time)\n` : '') +
      `\n<vault_folders>\n${folders.slice(0, 400).join('\n')}\n</vault_folders>\n\n<earlier_imports_by_course>\n${JSON.stringify(hints)}\n</earlier_imports_by_course>`;
    const out = await loop(run, { system: IMPORT_SYSTEM(run.langName), user, toolNames: ['list_dir', 'read_file', 'submit_plan'], submit: IMPORT_SUBMIT, maxTurns: 10 });
    const items = [], used = new Set();
    for (const it of Array.isArray(out.items) ? out.items : []) {
      const c = shown[+it.id];
      if (!c || used.has(+it.id)) continue;
      let dest = norm(String(it.dest || '')).replace(/^\/+/, '').trim();
      if (!dest) continue;
      if (dest.endsWith('/')) dest += c.name;
      const want = c.kind === 'convert' ? '.pdf' : path.extname(c.name).toLowerCase();
      if (path.extname(dest).toLowerCase() !== want) dest = dest.replace(/\.[^./]*$/, '') + want;
      try { writeTargetAny(dest); } catch { continue; }
      used.add(+it.id);
      items.push({ src: c.src, name: c.name, dest, kind: c.kind, course: c.course, size: c.size });
    }
    const pick = (arr, f) => (Array.isArray(arr) ? arr : []).map(x => ({ c: shown[+x.id], x })).filter(o => o.c && !used.has(shown.indexOf(o.c))).map(f);
    const ignore = pick(out.ignore, o => ({ src: o.c.src, name: o.c.name, reason: String(o.x.reason || '') }));
    const questions = pick(out.questions, o => ({ src: o.c.src, name: o.c.name, question: String(o.x.question || '') }));
    return { job: 'import', counts, total: candidates.length, items, ignore, questions, note: String(out.note || '') };
  }
  function writeTargetAny(rel) { // a copy destination: any file type, but never in hidden or mirrored folders
    if (NO_WRITE.test(rel) || rel.split('/').some(s => s === '..' || s.startsWith('.') || !s.trim())) throw new Error('Not allowed: ' + rel);
    return inVault(rel);
  }

  // Copy a file into the vault, never overwriting (a numbered name is used instead).
  async function copyIntoVault(src, dest) {
    const abs = await uniquePath(writeTargetAny(dest));
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.copyFile(src, abs, fs.constants.COPYFILE_EXCL);
    return toRel(abs);
  }
  async function officeIntoVault(src, dest) {
    const abs = await uniquePath(writeTargetAny(dest));
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await officeToPdf(src, abs);
    return toRel(abs);
  }

  const INDEX_SYSTEM = lang => `New course files were just copied into a student's notes vault. Make them one click away from the course's index note, in the student's own style.
- In each course folder (the top folder of the destinations), find the index note: a note whose name has "Index", "目录", "Resources" or "资料" in it (list_dir the course folder). Read it before writing.
- Add links like [[2026.10.15.pdf|10.15]] (file name, then a short label) under a numbered section for the file's folder (e.g. "2. 作业 Homework。"), creating that section at the end if it doesn't exist. Follow the note's existing style. Never remove or rewrite anything already there; only add.
- If the course has no index note, create "<Course>/课件目录 Slides Index.md" with frontmatter "graph: hide".
- Use write_vault_file with the whole note. Then call finish with a two-line summary in ${lang}.`;

  async function importApply(run, plan) {
    const accept = new Set((Array.isArray(run.body.accept) ? run.body.accept : plan.items.map((_, i) => i)).map(Number));
    const done = [], failed = [];
    const manifest = await readManifest();
    const key = p => norm(p).toLowerCase();
    for (const [i, it] of plan.items.entries()) {
      if (!accept.has(i)) continue;
      run.progress({ step: 'copy', path: it.dest, i: done.length + failed.length + 1, n: accept.size });
      try {
        const st = await fsp.stat(it.src);
        const dest = it.kind === 'convert' ? await officeIntoVault(it.src, it.dest) : await copyIntoVault(it.src, it.dest);
        manifest.imported[key(it.src)] = { dest, size: st.size, mtime: st.mtimeMs, at: new Date().toISOString(), ...(it.kind === 'convert' ? { converted: true } : {}) };
        done.push({ src: it.src, name: it.name, dest });
      } catch (e) { failed.push({ src: it.src, name: it.name, error: e.message }); }
    }
    if (run.body.recordIgnore !== false) for (const ig of plan.ignore || []) manifest.ignored[key(ig.src)] = { reason: ig.reason || '', at: new Date().toISOString() };
    const mAbs = inVault(MANIFEST);
    await withFileLock(mAbs, () => atomicWrite(mAbs, JSON.stringify(manifest, null, 2)));
    let summary = '', indexError = '';
    const notes = done.filter(d => !/\.md$/i.test(d.dest));
    if (notes.length) {
      try {
        const out = await loop(run, { system: INDEX_SYSTEM(run.langName), user: `Files just added (vault paths):\n${notes.map(d => '- ' + d.dest).join('\n')}`,
          toolNames: ['list_dir', 'read_file', 'write_vault_file', 'finish'], submit: TOOL_DEFS.finish && { name: 'finish', ...TOOL_DEFS.finish }, maxTurns: 16 });
        summary = String(out.summary || '');
      } catch (e) { indexError = e.message; }
    }
    return { job: 'import', done, failed, ignored: (plan.ignore || []).length, edited: run.edited, summary, indexError };
  }

  /* ---------- inbox (ported from the obsidian-inbox skill) ---------- */
  function parseInbox(text) {
    const lines = text.split(/\r?\n/), items = [];
    for (let i = 0; i < lines.length; i++) {
      const m = /^- \[ \] (.*)$/.exec(lines[i]);
      if (!m) continue;
      const head = m[1], body = [];
      for (let j = i + 1; j < lines.length && (/^\s+\S/.test(lines[j])); j++) body.push(lines[j].trim());
      const id = (/%%(cap-[^%]+)%%/.exec(head) || [])[1] || 'line-' + (i + 1);
      items.push({ id, line: i, kind: (/\*\*(.+?)\*\*/.exec(head) || [])[1] || '', when: (/·\s*(\d{4}-\d{2}-\d{2}[^·]*)·/.exec(head) || [])[1]?.trim() || '',
        source: (/\[\[([^\]]+)\]\]/.exec(head) || [])[1] || (/·\s*(🎓[^%]*)/.exec(head) || [])[1]?.trim() || '',
        quote: body.filter(l => l.startsWith('>')).map(l => l.replace(/^>\s?/, '')).join('\n'),
        thought: body.filter(l => /^- Thought:/i.test(l)).map(l => l.replace(/^- Thought:\s*/i, '')).join('\n') });
    }
    return items;
  }
  const INBOX_SYSTEM = lang => `You file a university student's captures into their own notes (Graphite, an Obsidian-style app). Each capture is something they selected while reading and marked "Not familiar" (explain it so they get it) or "Interesting" (keep it, expand a little, connect it).
For each capture:
1. read_file the source note (the link before "#", plus ".md") around the heading, and list_dir its folder to find an existing note on the same concept.
2. Choose the target: append to the concept's existing note, or to the source note if the capture is about its own topic, or make a new note in the source's folder named "中文名 English.md". Never write in "My Brain/", "我的大脑知识库/" or hidden folders.
3. Write in the user's format (read a note in that folder first): numbered points "N. 标题。" continuing the note's numbering, short paragraphs, maths in $…$ / $$…$$ with $$ on their own lines, Chinese prose with the course's English terms. A new note starts with frontmatter (tags: [Course name], created: YYYY.MM.DD).
   Not familiar (8–20 lines): 直观理解, 准确表述, 例子 with real numbers, 常见误区 if any, then "来源 Source: [[link from the capture]]".
   Interesting (4–12 lines): the selection as a quote, why it matters with [[links]] to existing notes, answer the Thought, then "来源 Source: [[…]]".
   If the selection is wrong or garbled, say so.
4. If "Claude Brain/" exists: read confusions.md and log.md there and include edits (whole new content): each Not familiar capture becomes a question in confusions.md; one dated log.md entry "Graphite inbox" for the batch. Brain files never use [[links]] to notes outside Claude Brain/ (write note names in backticks). Never edit quiz-results.md.
Then call submit_plan once. "shown" is the short link label, e.g. "投影 Projection › 4". Summary in ${lang}.`;
  const EDITS_SCHEMA = { type: 'array', items: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string' }, content: { type: 'string', description: 'the whole new file' }, why: { type: 'string' } } } };
  const INBOX_SUBMIT = { name: 'submit_plan', description: 'What to write for each capture. Nothing is written until the user confirms.',
    parameters: { type: 'object', required: ['items'], properties: {
      items: { type: 'array', items: { type: 'object', required: ['id', 'target', 'mode', 'text'], properties: {
        id: { type: 'string', description: 'capture id' }, target: { type: 'string', description: 'vault-relative .md path' }, mode: { type: 'string', enum: ['append', 'new'] },
        text: { type: 'string', description: 'Markdown to append, or the whole new note' }, shown: { type: 'string' } } } },
      edits: EDITS_SCHEMA, summary: { type: 'string' } } } };

  async function checkEdits(edits) {
    const out = [];
    for (const e of Array.isArray(edits) ? edits : []) {
      try {
        const { abs, rel } = writeTarget(e.path);
        if (!rel.startsWith(BRAIN + '/') || /quiz-results\.md$/i.test(rel)) continue;
        const cur = await fsp.readFile(abs, 'utf8').catch(() => null);
        const content = String(e.content || '');
        if (!content.trim() || content === cur) continue;
        const a = new Set((cur || '').split(/\r?\n/)), b = new Set(content.split(/\r?\n/));
        out.push({ path: rel, content, why: String(e.why || ''), base: cur == null ? null : hash(cur),
          added: [...b].filter(l => l.trim() && !a.has(l)).length, removed: [...a].filter(l => l.trim() && !b.has(l)).length });
      } catch { /* not allowed: dropped */ }
    }
    return out;
  }
  async function writeEdit(e) {
    const abs = inVault(e.path);
    return withFileLock(abs, async () => {
      const cur = await fsp.readFile(abs, 'utf8').catch(() => null);
      if ((cur == null ? null : hash(cur)) !== e.base) throw new Error('changed since the plan was made');
      await atomicWrite(abs, e.content);
    });
  }

  async function inboxPlan(run) {
    const abs = inVault(INBOX);
    const text = await fsp.readFile(abs, 'utf8').catch(() => '');
    const caps = parseInbox(text);
    if (!caps.length) return { job: 'inbox', empty: true, items: [], edits: [] };
    run.progress({ step: 'inbox', n: caps.length });
    const brain = await exists(inVault(BRAIN));
    const user = `Today: ${today()}\nClaude Brain folder: ${brain ? 'exists' : 'none (no edits)'}\n\n<captures>\n${caps.map(c => JSON.stringify({ id: c.id, kind: c.kind, when: c.when, source: c.source, quote: c.quote, thought: c.thought })).join('\n')}\n</captures>`;
    const out = await loop(run, { system: INBOX_SYSTEM(run.langName), user, toolNames: ['list_dir', 'read_file', 'submit_plan'], submit: INBOX_SUBMIT, maxTurns: 6 + caps.length * 4 });
    const items = [];
    for (const it of Array.isArray(out.items) ? out.items : []) {
      const cap = caps.find(c => c.id === String(it.id));
      if (!cap || items.some(x => x.id === cap.id)) continue;
      let t; try { t = writeTarget(it.target); } catch { continue; }
      if (t.rel.startsWith(BRAIN + '/') || t.rel === INBOX) continue;
      const has = await exists(t.abs);
      const body = String(it.text || '').trim();
      if (!body) continue;
      items.push({ id: cap.id, kind: cap.kind, quote: cap.quote.slice(0, 160), target: t.rel, mode: has ? 'append' : 'new', text: body, shown: String(it.shown || '') });
    }
    return { job: 'inbox', items, edits: brain ? await checkEdits(out.edits) : [], summary: String(out.summary || ''), total: caps.length };
  }

  async function inboxApply(run, plan) {
    const accept = new Set((Array.isArray(run.body.accept) ? run.body.accept : plan.items.map((_, i) => i)).map(Number));
    const done = [], failed = [];
    for (const [i, it] of plan.items.entries()) {
      if (!accept.has(i)) continue;
      run.progress({ step: 'write', path: it.target });
      try {
        const abs = inVault(it.target);
        await withFileLock(abs, async () => {
          const cur = await fsp.readFile(abs, 'utf8').catch(() => null);
          if (cur == null) { await fsp.mkdir(path.dirname(abs), { recursive: true }); await fsp.writeFile(abs, it.text.replace(/\s*$/, '\n'), { flag: 'wx' }); }
          else await atomicWrite(abs, cur.replace(/\s*$/, '') + '\n\n' + it.text.replace(/\s*$/, '') + '\n');
        });
        done.push(it);
      } catch (e) { failed.push({ id: it.id, target: it.target, error: e.message }); }
    }
    // Tick each filed capture, with a link to where it went.
    if (done.length) {
      const abs = inVault(INBOX);
      await withFileLock(abs, async () => {
        const lines = (await fsp.readFile(abs, 'utf8')).split('\n');
        for (const it of done) {
          const k = lines.findIndex((l, n) => l.startsWith('- [ ] ') && (l.includes(`%%${it.id}%%`) || it.id === 'line-' + (n + 1)));
          if (k < 0) continue;
          const link = it.target.replace(/\.md$/i, '');
          lines[k] = lines[k].replace('- [ ] ', '- [x] ').replace(/\s*$/, '') + ` → [[${link}${it.shown ? '|' + it.shown.replace(/[|\]]/g, ' ') : ''}]] (${today()})`;
        }
        await atomicWrite(abs, lines.join('\n'));
      });
    }
    const edited = [];
    const ae = acceptSet(run.body.acceptEdits, plan.edits || []);
    for (const [i, e] of (plan.edits || []).entries()) {
      if (!ae.has(i)) continue;
      try { await writeEdit(e); edited.push(e.path); } catch (er) { failed.push({ target: e.path, error: er.message }); }
    }
    return { job: 'inbox', done: done.map(d => ({ id: d.id, target: d.target, shown: d.shown, mode: d.mode })), failed, edited, summary: plan.summary };
  }

  /* ---------- brain (ported from the update-brain skill) ---------- */
  const BRAIN_SYSTEM = lang => `You keep a university student's study knowledge base, the "Claude Brain" folder in their notes vault: README.md, profile.md, courses/<course>.md (a table per course: topic, status, evidence, date), confusions.md (open confusions as questions; resolved ones at the bottom), next.md (what to study next), log.md (one dated entry per session, newest first). quiz-results.md is written by the app: read it, never edit it.
From the conversation given, record what it shows:
- Demonstrated understanding (a correct answer with a reason, their own explanation) vs. confusion (wrong answers, "I don't get", repeated why-questions: record the specific gap) vs. self-reports (mark as self-reported) vs. coverage (explained to them: not understanding).
- Status labels: solid, shaky, confused, not started. When unsure, use the weaker one.
Read the files first (list_dir "Claude Brain", read_file). Update rows instead of duplicating them. Each brain file starts with frontmatter "graph: hide" and "tags: [Claude Brain]". Never use [[links]] to notes outside Claude Brain/; write note names in backticks.
Then call submit_plan with edits (each the whole new file) and a short summary in ${lang}. If the conversation shows nothing new, submit no edits.`;
  const BRAIN_SUBMIT = { name: 'submit_plan', description: 'Edits to the Claude Brain. Nothing is written until the user confirms.',
    parameters: { type: 'object', required: ['edits'], properties: { edits: EDITS_SCHEMA, summary: { type: 'string' } } } };
  async function brainPlan(run) {
    const hist = (Array.isArray(run.body.history) ? run.body.history : []).slice(-30).filter(m => m && m.content)
      .map(m => `${m.role === 'assistant' ? 'Assistant' : 'Student'}: ${String(m.content).slice(0, 4000)}`).join('\n\n');
    if (!hist.trim()) return { job: 'brain', empty: true, edits: [] };
    const out = await loop(run, { system: BRAIN_SYSTEM(run.langName), user: `Today: ${today()}\n\n<conversation>\n${hist}\n</conversation>`, toolNames: ['list_dir', 'read_file', 'submit_plan'], submit: BRAIN_SUBMIT, maxTurns: 14 });
    return { job: 'brain', edits: await checkEdits(out.edits), summary: String(out.summary || '') };
  }
  async function brainApply(run, plan) {
    const accept = acceptSet(run.body.acceptEdits ?? run.body.accept, plan.edits);
    const edited = [], failed = [];
    for (const [i, e] of plan.edits.entries()) {
      if (!accept.has(i)) continue;
      try { await writeEdit(e); edited.push(e.path); } catch (er) { failed.push({ target: e.path, error: er.message }); }
    }
    return { job: 'brain', edited, failed, summary: plan.summary };
  }

  // Which plan entries the user kept ticked (all of them if the client didn't say).
  function acceptSet(list, all) { return new Set((Array.isArray(list) ? list : all.map((_, i) => i)).map(Number)); }

  /* ---------- the route ---------- */
  const JOBS = { import: [importPlan, importApply], inbox: [inboxPlan, inboxApply], brain: [brainPlan, brainApply] };
  async function handle(req, res) {
    const key = String(req.headers['x-ai-key'] || '').trim();
    const body = JSON.parse((await readBody(req, 5 * 1024 * 1024)).toString('utf8') || '{}');
    const job = JOBS[body.job];
    if (!job) throw new HttpError(400, 'Unknown agent job');
    const provider = body.provider || 'anthropic';
    if (provider !== 'anthropic' && !h.COMPAT[provider]) throw new HttpError(400, 'Unknown AI provider');
    if (!key && provider !== 'custom') throw new HttpError(400, 'No API key');
    const model = String(body.model || '').trim() || (provider === 'anthropic' ? h.ANTHROPIC_DEFAULT : '');
    if (!model) throw new HttpError(400, 'Choose a model first (Settings → AI)');
    for (const [k, v] of plans) if (Date.now() - v.at > 3600e3) plans.delete(k);
    let plan = null;
    if (body.phase === 'apply') {
      plan = plans.get(String(body.planId || ''));
      if (!plan || plan.job !== body.job) throw new HttpError(410, 'This plan has expired; start again');
    }
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    const line = o => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    const run = { provider, key, body: { ...body, model }, model, sb: cleanRoots(body), langName: LANG_NAMES[body.lang] || 'English',
      signal: ctl.signal, seen: new Map(), edited: [], progress: p => line({ progress: p }) };
    try {
      let result;
      if (plan) { plans.delete(body.planId); result = await job[1](run, plan); }
      else {
        result = await job[0](run);
        if (!result.empty && ['items', 'edits', 'ignore', 'questions'].some(k => result[k] && result[k].length)) {
          const planId = crypto.randomBytes(9).toString('hex');
          plans.set(planId, { ...result, at: Date.now() });
          result = { ...result, planId, edits: (result.edits || []).map(({ content, base, ...e }) => e) };
          if (result.items) result.items = result.items.map(({ text, ...it }) => ({ ...it, preview: text ? text.slice(0, 600) : undefined }));
        }
      }
      line({ result });
    } catch (e) { line({ error: e.message || String(e), status: e.status || 500 }); }
    res.end();
  }
  return { handle, parseInbox, scan, copyIntoVault };
};
