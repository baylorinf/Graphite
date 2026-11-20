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
// Local frameworks: with DeepSeek Harness or Codex CLI chosen instead of an API model, the same job is handed to
// that program (frameworks.js). It reads the files with its own tools, read-only, and returns the plan as JSON;
// Graphite checks it exactly as above and still does the confirmed copies and writes itself.
// Progress is streamed as one JSON object per line: {"progress":{...}} … then {"result":{...}} or {"error":"…"}.
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { execFile } = require('child_process');

module.exports = function createAgent(h) {
  const { HttpError, hash, inVault, toRel, exists, uniquePath, atomicWrite, withFileLock, officeToPdf, readBody, LANG_NAMES } = h;
  const VAULT = () => h.vault();
  const WIN = process.platform === 'win32';
  const low = s => (WIN ? s.toLowerCase() : s);
  const norm = p => p.replace(/\\/g, '/');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const MANIFEST = '.obsidian/plugins/claude-chat/imports.json';
  const INBOX = 'Claude Inbox.md'; // file name kept from earlier versions, so existing captures stay where they are
  // The study record folder and the read-only folders come from Study settings (set per job in handle()).
  let BRAIN = 'Claude Brain';
  const BUILTIN_NO_WRITE = ['My Brain', '我的大脑知识库'];
  let readOnly = BUILTIN_NO_WRITE.slice();
  const NO_WRITE = { test: rel => /^\.|\/\./.test(rel) || readOnly.some(f => { const a = low(rel), b = low(f.replace(/\/+$/, '')); return a === b || a.startsWith(b + '/'); }) };
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
  // The real folder a path ends up in (following links and junctions), checked against the real vault folder.
  async function realInVault(abs) {
    let dir = abs;
    while (!(await exists(dir))) { const up = path.dirname(dir); if (up === dir) break; dir = up; }
    const real = await fsp.realpath(dir).catch(() => dir), vreal = await fsp.realpath(VAULT()).catch(() => VAULT());
    if (!inside(real, vreal)) throw new Error('Not allowed: this path leads outside the vault');
    return abs;
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
  async function loop(run, opts) {
    if (run.settingsBlock) opts = { ...opts, system: opts.system + '\n\n' + run.settingsBlock };
    // The study record folder has the name chosen in Study settings.
    if (BRAIN !== 'Claude Brain') opts = { ...opts, system: opts.system.split('Claude Brain').join(BRAIN), user: String(opts.user).split('Claude Brain').join(BRAIN) };
    if (run.fw) return frameworkLoop(run, opts);
    return apiLoop(run, opts);
  }
  // The task for a local framework: the same instructions, the folders it may read, and the answer as JSON.
  async function frameworkLoop(run, { system, user, toolNames, submit }) {
    const writes = toolNames.includes('write_vault_file');
    const vault = VAULT();
    const schema = writes
      ? { type: 'object', required: ['edits', 'summary'], properties: { summary: { type: 'string' }, edits: { type: 'array', items: { type: 'object', required: ['path', 'content'], properties: { path: { type: 'string', description: 'vault-relative path of a Markdown note' }, content: { type: 'string', description: 'the whole new note' } } } } } }
      : submit.parameters;
    const prompt = [system.replace(/\b(list_dir|read_file)\b/g, m => (m === 'list_dir' ? 'your folder-listing tool' : 'your file-reading tool')).replace(/call submit_plan( once)?/g, 'give your answer').replace(/write_vault_file/g, 'the edits in your answer'),
      '',
      '## How to work here',
      'You are running as a local agent for Graphite, a notes app. Look at the files yourself with your own tools (list, glob, read). This is read-only: do not create, change, move or delete any file, and do not run anything that changes the computer.',
      `The vault (the user's notes) is the folder: ${vault}`,
      `Vault-relative paths in this task (like "Linear Algebra/课件 Slides/LA1.pdf") are relative to that folder.`,
      run.sb.roots.length ? `Course folders you may also read: ${run.sb.roots.join(' ; ')}` : 'Read only inside the vault.',
      run.sb.skip.length ? `Never open anything whose path contains a folder named: ${run.sb.skip.join(', ')}` : '',
      'Do not read anything else on the computer.',
      writes ? 'Instead of writing notes, put each changed note (its whole new text, keeping every existing line) in "edits"; Graphite checks and writes them.' : '',
      '',
      user,
      '',
      '## Your answer',
      'When you are done, reply with exactly one JSON object that follows this JSON Schema, between <graphite-result> and </graphite-result>, and nothing after it.',
      '<schema>' + JSON.stringify(schema) + '</schema>'].filter(x => x !== '').join('\n');
    const out = await h.frameworks.run(run.fw, {
      prompt, cwd: vault, key: run.key, paths: run.body.frameworkPaths || {}, signal: run.signal, mode: 'read',
      allow: { roots: [vault, ...run.sb.roots], skip: run.sb.skip },
      onProgress: p => run.progress(p.step === 'read' || p.step === 'list' ? { ...p, path: shortPath(p.path) } : p),
    });
    run.reads = (run.reads || []).concat(out.reads || []);
    if (!out.result || typeof out.result !== 'object') throw Object.assign(new HttpError(502, 'no result'), { code: 'noResult', framework: run.fw });
    if (writes) { // write the proposed index edits with the same checks the model's own writes get
      const impl = tools(run);
      for (const e of Array.isArray(out.result.edits) ? out.result.edits : []) {
        try { await impl.read_file({ path: e.path }).catch(() => {}); await impl.write_vault_file(e); } catch { /* left out; listed as not edited */ }
      }
      return { summary: String(out.result.summary || '') };
    }
    return out.result;
  }
  const shortPath = p => { const v = VAULT(); const a = String(p || ''); return low(a).startsWith(low(v)) ? norm(a.slice(v.length)).replace(/^\/+/, '') : norm(a); };

  async function apiLoop(run, { system, user, toolNames, submit, maxTurns = 14 }) {
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

  /* ---------- confirmed changes, carried out by the chosen local framework ----------
     The framework gets a private stage folder (in the system temp folder, never the vault) and an exact list of
     steps: write these files with this content, copy these files here; for imports it may also add links to the
     listed index notes. It does them with its own tools in its workspace-write sandbox. Graphite then checks every
     staged file (content, byte-for-byte copies, index notes keeping all their lines) and applies only those, each
     after checking the note hasn't changed since the plan; if anything fails, what was already applied is undone.
     A failed run, a check that doesn't pass or an error keeps the stage folder (its path is in the error). */
  const normText = t => String(t ?? '').replace(/\r\n/g, '\n').replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  async function fileHash(abs, signal) {
    const digest = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(abs, {signal})) digest.update(chunk);
    return digest.digest('hex');
  }
  async function walkFiles(dir, base = dir, out = []) {
    for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) await walkFiles(abs, base, out); else out.push(norm(path.relative(base, abs)));
    }
    return out;
  }
  const stageError = (msg, code, stage, detail) => Object.assign(new HttpError(502, msg), { code, framework: null, stage, detail });
  // ops: { kind: 'file', rel, content, base } — the whole new text of a vault note (base: hash of the current text, null if new)
  //      { kind: 'copy', src, rel, dest, convert } — copy src to rel in the stage; apply to dest (PDF made from Office files)
  // free: vault notes the framework may add lines to (import: course index notes), with what to do.
  async function fwApply(run, ops, { free = [], freeTask = '' } = {}) {
    const stage = await fsp.mkdtemp(path.join(os.tmpdir(), 'graphite-stage-'));
    const fail = (msg, code, detail) => { throw Object.assign(stageError(msg, code, stage, detail), { framework: run.fw }); };
    const freeBase = new Map();
    for (const rel of free) {
      const cur = await fsp.readFile(inVault(rel), 'utf8').catch(() => null);
      if (cur == null) continue;
      await fsp.mkdir(path.dirname(path.join(stage, rel)), { recursive: true });
      await fsp.writeFile(path.join(stage, rel), cur);
      freeBase.set(rel, cur);
    }
    const steps = ops.map((o, i) => (o.kind === 'copy'
      ? `${i + 1}. Copy the file "${o.src}" to "${o.rel}" (relative to your working directory), byte for byte. Create the folders it needs.`
      : `${i + 1}. Write the file "${o.rel}" (relative to your working directory) with exactly the text between the markers, replacing the file if it is there. Create the folders it needs.\n<<<GRAPHITE-FILE\n${o.content.replace(/\s*$/, '')}\nGRAPHITE-FILE>>>`));
    const prompt = ['You are carrying out changes the user has just confirmed in Graphite, a notes app.',
      `Your working directory is a temporary stage folder: ${stage}`,
      'Write ONLY inside your working directory, using your own file tools. Graphite checks what you wrote and then copies it into the user\'s notes itself.',
      steps.length ? 'Do exactly these steps, nothing else:' : '', ...steps,
      freeBase.size ? `${steps.length ? 'Then: ' : ''}${freeTask} The notes you may edit are already in your working directory: ${[...freeBase.keys()].join(', ')}. Keep every line that is in them now; only add lines. Do not create other notes.` : '',
      'Do not create, change or delete anything else, and do not read anything except the files named here.',
      'When you are done, reply with <graphite-result>{"done":[the numbers of the steps you did]}</graphite-result>.'].filter(Boolean).join('\n\n');
    const srcDirs = [...new Set(ops.filter(o => o.kind === 'copy').map(o => path.dirname(o.src)))];
    try {
      await h.frameworks.run(run.fw, {
        prompt, cwd: stage, key: run.key, paths: run.body.frameworkPaths || {}, signal: run.signal, mode: 'write',
        allow: { roots: [stage, ...srcDirs], skip: run.sb.skip },
        onProgress: p => run.progress(p.step === 'write' || p.step === 'read' ? { ...p, path: norm(path.relative(stage, path.resolve(stage, String(p.path || '')))) } : p),
      });
    } catch (e) { e.stage = stage; if (e.code === 'stopped') await fsp.rm(stage, { recursive: true, force: true }).catch(() => {}); throw e; }
    // Check the stage.
    run.progress({ step: 'check' });
    const problems = [];
    for (const o of ops) {
      const f = path.join(stage, o.rel);
      if (!(await exists(f))) { problems.push(`missing ${o.rel}`); continue; }
      if (o.kind === 'copy') {
        o.sourceHash = await fileHash(f);
        if (o.sourceHash !== await fileHash(o.src)) problems.push(`${o.rel} is not an exact copy`);
      }
      else if (normText(await fsp.readFile(f, 'utf8')) !== normText(o.content)) problems.push(`${o.rel} does not have the confirmed text`);
    }
    const freeEdits = [];
    for (const [rel, cur] of freeBase) {
      const now = await fsp.readFile(path.join(stage, rel), 'utf8').catch(() => null);
      if (now == null) { problems.push(`${rel} was deleted`); continue; }
      if (normText(now) === normText(cur)) continue;
      const have = new Set(now.split(/\r?\n/).map(l => l.trim()));
      const lost = cur.split(/\r?\n/).map(l => l.trim()).filter(l => l && !have.has(l));
      if (lost.length) { problems.push(`${rel} lost lines: ${lost.slice(0, 2).join(' | ')}`); continue; }
      freeEdits.push({ rel, content: now, base: hash(cur) });
    }
    if (problems.length) fail('The staged result did not match the confirmed changes', 'badStage', problems.join('; '));
    const known = new Set([...ops.map(o => o.rel), ...freeBase.keys()].map(r => low(norm(r))));
    const extra = (await walkFiles(stage)).filter(r => !known.has(low(r)));
    // Apply: only the confirmed changes; undo everything if one fails.
    const undo = [], applied = [];
    try {
      for (const o of ops) {
        if (o.kind === 'copy') {
          run.progress({ step: 'copy', path: o.dest, i: applied.length + 1, n: ops.length });
          await realInVault(inVault(o.dest));
          const dest = o.convert ? await officeIntoVault(path.join(stage, o.rel), o.dest) : await copyIntoVault(path.join(stage, o.rel), o.dest);
          undo.push(() => fsp.unlink(inVault(dest)));
          applied.push({ ...o, dest });
        } else {
          const abs = await realInVault(inVault(o.target || o.rel));
          const staged = await fsp.readFile(path.join(stage, o.rel));
          run.progress({ step: 'write', path: o.target || o.rel });
          await withFileLock(abs, async () => {
            const cur = await fsp.readFile(abs, 'utf8').catch(() => null);
            if ((cur == null ? null : hash(cur)) !== (o.base ?? null)) throw new Error(`${o.target || o.rel} changed since the plan was made`);
            if (cur == null) { await fsp.mkdir(path.dirname(abs), { recursive: true }); await fsp.writeFile(abs, staged, { flag: 'wx' }); undo.push(() => fsp.unlink(abs)); }
            else { await atomicWrite(abs, staged); undo.push(() => atomicWrite(abs, cur)); }
          });
          applied.push(o);
        }
      }
      for (const e of freeEdits) {
        const abs = await realInVault(inVault(e.rel));
        await withFileLock(abs, async () => {
          const cur = await fsp.readFile(abs, 'utf8');
          if (hash(cur) !== e.base) throw new Error(`${e.rel} changed meanwhile`);
          await atomicWrite(abs, e.content); undo.push(() => atomicWrite(abs, cur));
        });
        if (!run.edited.includes(e.rel)) run.edited.push(e.rel);
      }
    } catch (e) {
      for (const u of undo.reverse()) await Promise.resolve().then(u).catch(() => {});
      fail('Applying the confirmed changes failed; everything was put back', 'applyFailed', e.message);
    }
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
    return { applied, extra };
  }

  /* ---------- import: scan (ported from the obsidian-import skill's scan.js) ---------- */
  async function readManifest() {
    try { return { imported: {}, ignored: {}, ...JSON.parse(await fsp.readFile(inVault(MANIFEST), 'utf8')) }; } catch { return { imported: {}, ignored: {} }; }
  }
  async function scan(sb, extras, progress, opts = {}, signal) {
    const recentDays = Math.max(1, +opts.recentDays || 180);
    const recentFolders = (Array.isArray(opts.recentFolders) && opts.recentFolders.length ? opts.recentFolders : ['Downloads', 'Desktop', 'Documents']).map(String);
    const manifest = await readManifest();
    const key = p => norm(p).toLowerCase();
    const bySize = new Map(), vaultFiles = new Map(), folders = [], digests = new Map(), duplicates = [];
    async function digest(file) {
      signal?.throwIfAborted();
      const key = low(path.resolve(file));
      if (!digests.has(key)) digests.set(key, await fileHash(file, signal).catch(()=>null));
      return digests.get(key); // A file that vanished or could not be read is not evidence of a match.
    }
    async function walkVault(dir, depth) {
      let ents = []; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        signal?.throwIfAborted();
        if (e.name.startsWith('.')) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (depth < 3) folders.push(toRel(p)); await walkVault(p, depth + 1); continue; }
        if (!e.isFile() || (!DOC_EXT.test(e.name) && !NOTE_EXT.test(e.name))) continue;
        const ext = path.extname(e.name).toLowerCase();
        const st = await fsp.stat(p).catch(() => null);
        if (st) {
          vaultFiles.set(low(toRel(p)), p);
          const k = st.size + ext;
          if (!bySize.has(k)) bySize.set(k, []);
          bySize.get(k).push(p);
        }
      }
    }
    await walkVault(VAULT(), 0);
    const candidates = [], counts = { scanned: 0, inVault: 0, known: 0, ignored: 0 };
    async function consider(file, st, course, rel) {
      counts.scanned++;
      const k = key(file);
      if (manifest.ignored[k]) { counts.ignored++; return; }
      const prev = manifest.imported[k];
      const previousCopy = typeof prev?.dest === 'string' && vaultFiles.get(low(norm(prev.dest)));
      if (previousCopy && prev.size === st.size) {
        // Legacy raw copies can be compared directly. A converted PDF cannot prove which
        // Office source produced it, so a legacy conversion is offered for confirmation.
        const expected = prev.sourceHash || (!prev.converted && !OFFICE.test(file) && await digest(previousCopy));
        if (expected && expected === await digest(file)) { counts.known++; return; }
      }
      const ext = path.extname(file).toLowerCase();
      const possible = bySize.get(st.size + ext);
      if (possible) {
        const sourceHash = await digest(file);
        if (sourceHash) for (const other of possible) {
          if (sourceHash === await digest(other)) {
            counts.inVault++; duplicates.push({src:norm(file), match:toRel(other)}); return;
          }
        }
      }
      const c = { src: norm(file), name: path.basename(file), size: st.size, modified: new Date(st.mtimeMs).toISOString().slice(0, 10),
        kind: NOTE_EXT.test(ext) ? 'note' : OFFICE.test(ext) ? 'convert' : 'copy', course: course || null, rel: rel || null, changed: !!prev };
      if (!course && ext === '.pdf') { const fp = await pdfText(file, 1); if (fp) c.firstPage = fp.slice(0, 300); }
      candidates.push(c);
    }
    async function walk(dir, course, base, { recentOnly = false, depth = 0, maxDepth = 8 } = {}) {
      let ents = []; try { ents = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        signal?.throwIfAborted();
        const p = path.join(dir, e.name);
        if (e.isDirectory()) {
          if (!SKIP_DIR.test(e.name) && !sb.skip.includes(low(e.name)) && depth < maxDepth && !inside(p, VAULT())) await walk(p, course, base, { recentOnly, depth: depth + 1, maxDepth });
          continue;
        }
        if (!e.isFile() || SKIP_FILE.test(e.name)) continue;
        if (!DOC_EXT.test(e.name) && !(course && NOTE_EXT.test(e.name))) continue;
        const st = await fsp.stat(p).catch(() => null);
        if (!st || st.size === 0 || st.size > MAX_BYTES) continue;
        if (recentOnly && Date.now() - st.mtimeMs > recentDays * 864e5) continue;
        await consider(p, st, course, course ? norm(path.relative(base, p)) : null);
      }
    }
    // Each folder directly inside an approved root is a course (files right in the root count for the root).
    for (const root of sb.roots) {
      if (skipped(root, sb)) continue;
      progress({ step: 'scan', path: norm(root) });
      signal?.throwIfAborted();
      let ents = []; try { ents = await fsp.readdir(root, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        signal?.throwIfAborted();
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
      for (const d of recentFolders) { progress({ step: 'scan', path: norm(path.join(home, d)) }); await walk(path.resolve(home, d), null, null, { recentOnly: true, maxDepth: 2 }); }
    }
    // The same file found twice: keep the course-folder one.
    const groups = new Map();
    for (const c of [...candidates].sort((a, b) => (b.course ? 1 : 0) - (a.course ? 1 : 0))) {
      const k = c.size + path.extname(c.name).toLowerCase();
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(c);
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue;
      const seen = new Map();
      for (const c of group) {
        const hash = await digest(c.src);
        if (!hash) continue;
        if (seen.has(hash)) c.duplicateOf = seen.get(hash);
        else seen.set(hash, c.src);
      }
    }
    // Where earlier imports went, by course: a strong hint for the model.
    const hints = {};
    for (const [src, v] of Object.entries(manifest.imported)) {
      const course = sb.roots.map(r => norm(r).toLowerCase()).filter(r => src.startsWith(r + '/')).map(r => src.slice(r.length + 1).split('/')[0])[0];
      if (course && v.dest) { const f = norm(v.dest).split('/').slice(0, -1).join('/'); (hints[course] ||= new Set()).add(f); }
    }
    return { candidates, counts, folders, duplicates, hints: Object.fromEntries(Object.entries(hints).map(([k, s]) => [k, [...s].slice(0, 8)])) };
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

  function manualImportPlan(run, scanResult, issue) {
    const { candidates, counts, folders, duplicates } = scanResult;
    const mapped = Object.entries(run.prof?.courses || {});
    const items = candidates.filter(c => !c.duplicateOf).map(c => {
      const file = c.kind === 'convert' ? c.name.slice(0, -path.extname(c.name).length) + '.pdf' : c.name;
      const course = c.course && (mapped.find(([code]) => low(code) === low(c.course))?.[1] || c.course);
      const sub = c.rel ? path.posix.dirname(c.rel) : '.';
      let dest = [course, sub === '.' ? '' : sub, file].filter(Boolean).join('/');
      try { checkManualDest(dest, file); } catch { dest = file; }
      return {src:c.src, name:c.name, dest, kind:c.kind, course:c.course, size:c.size, selectedByDefault:!!course};
    });
    return {job:'import', planMode:'manual', ...(issue ? {planningIssue:issue} : {}), counts, total:candidates.length,
      items, folders:folders.filter(folder=>!NO_WRITE.test(folder)), duplicates, ignore:[], questions:[]};
  }
  async function importPlan(run) {
    const scanResult = await scan(run.sb, !!run.body.extras, run.progress, run.body, run.signal);
    run.signal.throwIfAborted();
    const { candidates, counts, folders, hints, duplicates } = scanResult;
    if (!candidates.length) return { job: 'import', planMode: 'manual', empty: true, counts, duplicates, items: [], ignore: [], questions: [] };
    if (run.body.planning === 'manual') return manualImportPlan(run, scanResult);
    const shown = candidates.slice(0, 300);
    const user = `Today: ${today()}\n\n<candidates>\n${shown.map((c, i) => JSON.stringify({ id: i, ...c })).join('\n')}\n</candidates>\n` +
      (candidates.length > shown.length ? `(${candidates.length - shown.length} more not shown; they will be offered next time)\n` : '') +
      `\n<vault_folders>\n${folders.slice(0, 400).join('\n')}\n</vault_folders>\n\n<earlier_imports_by_course>\n${JSON.stringify(hints)}\n</earlier_imports_by_course>`;
    let out;
    try { out = await loop(run, { system: IMPORT_SYSTEM(run.langName), user, toolNames: ['list_dir', 'read_file', 'submit_plan'], submit: IMPORT_SUBMIT, maxTurns: 10 }); }
    catch (err) {
      if (run.signal.aborted || !run.fw || err.code !== 'outside' || err.framework !== run.fw) throw err;
      return manualImportPlan(run, scanResult, {code:'outside', framework:run.fw});
    }
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
    return { job: 'import', counts, duplicates, total: candidates.length, items, ignore, questions, note: String(out.note || '') };
  }
  function writeTargetAny(rel) { // a copy destination: any file type, but never in hidden or mirrored folders
    if (NO_WRITE.test(rel) || rel.split('/').some(s => s === '..' || s.startsWith('.') || !s.trim())) throw new Error('Not allowed: ' + rel);
    return inVault(rel);
  }
  function checkManualDest(dest, name) {
    if (typeof dest !== 'string' || path.posix.isAbsolute(dest) || path.win32.isAbsolute(dest) ||
        /[\\:\x00-\x1f]/.test(dest) || path.posix.basename(dest) !== name) {
      throw new HttpError(400, 'Choose a vault folder and keep the original file name');
    }
    try { return writeTargetAny(dest); }
    catch { throw new HttpError(400, 'Choose a writable folder inside the vault'); }
  }

  async function manualSelection(run, plan) {
    const {accept, destinations = {}} = run.body;
    if (!Array.isArray(accept) || accept.some(i=>!Number.isInteger(i) || i<0 || i>=plan.items.length)) {
      throw new HttpError(400, 'Confirm the files to import first');
    }
    if (!destinations || typeof destinations !== 'object' || Array.isArray(destinations)) throw new HttpError(400, 'Invalid import destinations');
    const selected = new Set(accept);
    if (Object.keys(destinations).some(k => !selected.has(Number(k)) || String(Number(k)) !== k)) {
      throw new HttpError(400, 'Choose a destination only for a selected file');
    }
    const roots = run.sb.roots.slice();
    if (run.body.extras) {
      const home = os.homedir();
      for (const folder of run.body.recentFolders || ['Downloads','Desktop','Documents']) {
        const recent = path.resolve(home, folder);
        if (inside(recent, home) && recent !== home) roots.push(recent);
      }
    }
    const items = [];
    for (const i of selected) {
      const it = plan.items[i], dest = Object.hasOwn(destinations,i) ? destinations[i] : it.dest;
      const to = checkManualDest(dest, path.posix.basename(it.dest));
      await realInVault(to);
      const current = await fsp.realpath(it.src).catch(()=>null);
      if (!current || low(current) !== low(path.resolve(it.src)) || !roots.some(root=>inside(current, root)) || skipped(current, run.sb) ||
          !(await fsp.lstat(it.src)).isFile()) throw new HttpError(409, 'A source is no longer available in the approved folders; scan again');
      items.push({...it,dest});
    }
    return items;
  }

  // Copy a file into the vault, never overwriting (a numbered name is used instead).
  async function copyIntoVault(src, dest) {
    const target = writeTargetAny(dest);
    await realInVault(target);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    for (;;) {
      const abs = await uniquePath(target);
      try { await fsp.copyFile(src, abs, fs.constants.COPYFILE_EXCL); return toRel(abs); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  }
  async function officeIntoVault(src, dest) {
    const temp = await fsp.mkdtemp(path.join(os.tmpdir(), 'graphite-convert-'));
    const pdf = path.join(temp, 'converted.pdf');
    try { await officeToPdf(src, pdf); return await copyIntoVault(pdf, dest); }
    finally { await fsp.rm(temp, {recursive:true, force:true}).catch(()=>{}); }
  }

  async function recordImports(imported, ignored) {
    if (!Object.keys(imported).length && !ignored.length) return;
    const abs = inVault(MANIFEST);
    await withFileLock(abs, async () => {
      const manifest = await readManifest();
      Object.assign(manifest.imported, imported);
      for (const ig of ignored) manifest.ignored[norm(ig.src).toLowerCase()] = {reason:ig.reason || '', at:new Date().toISOString()};
      await atomicWrite(abs, JSON.stringify(manifest, null, 2));
    });
  }

  const INDEX_SYSTEM = lang => `New course files were just copied into a student's notes vault. Make them one click away from the course's index note, in the student's own style.
- In each course folder (the top folder of the destinations), find the index note: a note whose name has "Index", "目录", "Resources" or "资料" in it (list_dir the course folder). Read it before writing.
- Add links like [[2026.10.15.pdf|10.15]] (file name, then a short label) under a numbered section for the file's folder (e.g. "2. 作业 Homework。"), creating that section at the end if it doesn't exist. Follow the note's existing style. Never remove or rewrite anything already there; only add.
- If the course has no index note, create "<Course>/课件目录 Slides Index.md" with frontmatter "graph: hide".
- Use write_vault_file with the whole note. Then call finish with a two-line summary in ${lang}.`;

  async function importApply(run, plan) {
    const manual = plan.planMode === 'manual';
    if (run.fw && !manual) return importApplyFw(run, plan);
    const accept = acceptSet(run.body.accept, plan.items);
    const chosen = manual ? run.manualItems : plan.items.filter((_,i)=>accept.has(i));
    const done = [], failed = [], imported = {};
    const key = p => norm(p).toLowerCase();
    for (const it of chosen) {
      run.progress({ step: 'copy', path: it.dest, i: done.length + failed.length + 1, n: chosen.length });
      try {
        const st = await fsp.stat(it.src);
        const convert = it.kind === 'convert';
        const before = convert && await fileHash(it.src);
        const dest = convert ? await officeIntoVault(it.src, it.dest) : await copyIntoVault(it.src, it.dest);
        const after = await fileHash(convert ? it.src : inVault(dest)).catch(() => undefined);
        const sourceHash = !convert || before === after ? after : undefined;
        imported[key(it.src)] = { dest, size: st.size, mtime: st.mtimeMs, sourceHash, at: new Date().toISOString(), ...(convert ? { converted: true } : {}) };
        done.push({ src: it.src, name: it.name, dest });
      } catch (e) { failed.push({ src: it.src, name: it.name, error: e.message }); }
    }
    await recordImports(imported, run.body.recordIgnore === false ? [] : plan.ignore || []);
    let summary = '', indexError = '';
    const notes = done.filter(d => !/\.md$/i.test(d.dest));
    if (notes.length && !manual) {
      try {
        const out = await loop(run, { system: INDEX_SYSTEM(run.langName), user: `Files just added (vault paths):\n${notes.map(d => '- ' + d.dest).join('\n')}`,
          toolNames: ['list_dir', 'read_file', 'write_vault_file', 'finish'], submit: TOOL_DEFS.finish && { name: 'finish', ...TOOL_DEFS.finish }, maxTurns: 16 });
        summary = String(out.summary || '');
      } catch (e) { indexError = e.message; }
    }
    return { job: 'import', ...(manual ? {planMode:'manual'} : {}), done, failed, ignored: (plan.ignore || []).length, edited: run.edited, summary, indexError };
  }

  // With a local framework: it copies the confirmed files into its stage (and adds links to the course index
  // notes there), Graphite checks and applies them, then records the import.
  async function importApplyFw(run, plan) {
    const accept = acceptSet(run.body.accept, plan.items);
    const chosen = plan.items.filter((_, i) => accept.has(i));
    for (const it of chosen) { const st = await fsp.stat(it.src).catch(() => null); if (!st || !st.isFile()) throw new HttpError(410, `${it.name} is gone; start again`); writeTargetAny(it.dest); await realInVault(inVault(it.dest)); }
    const ops = chosen.map(it => ({ kind: 'copy', src: it.src, dest: it.dest, convert: it.kind === 'convert',
      rel: it.kind === 'convert' ? it.dest.replace(/\.pdf$/i, path.extname(it.src).toLowerCase()) : it.dest, name: it.name }));
    // Index notes of the courses that get files: notes in the course folder named like an index.
    const courses = [...new Set(chosen.filter(it => !NOTE_EXT.test(it.dest)).map(it => it.dest.split('/')[0]))];
    const free = [];
    for (const c of courses) {
      const list = await walkFiles(inVault(c)).catch(() => []);
      for (const r of list) { const rel = norm(path.join(c, r)); if (NOTE_EXT.test(rel) && !rel.split('/').some(x => x.startsWith('.')) && /(目录|索引|index|资料|resources|contents)/i.test(path.basename(rel))) free.push(rel); }
    }
    const added = chosen.filter(it => !NOTE_EXT.test(it.dest)).map(it => '- ' + it.dest).join('\n');
    const freeTask = free.length ? `Add a link to each newly added file in the index note of its course and folder section, in the style the note already uses (for example [[LA5.pdf|LA5]]). The new files (vault paths): \n${added}` : '';
    const { applied, extra } = await fwApply(run, ops, { free: free.slice(0, 40), freeTask });
    const imported = {};
    for (const o of applied) { const st = await fsp.stat(o.src); imported[norm(o.src).toLowerCase()] = { dest: o.dest, size: st.size, mtime: st.mtimeMs, sourceHash: o.sourceHash, at: new Date().toISOString(), by: run.fw, ...(o.convert ? { converted: true } : {}) }; }
    await recordImports(imported, run.body.recordIgnore === false ? [] : plan.ignore || []);
    return { job: 'import', framework: run.fw, done: applied.map(o => ({ src: o.src, name: o.name, dest: o.dest })), failed: [], ignored: (plan.ignore || []).length, edited: run.edited, extra };
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
    if (run.fw) return inboxApplyFw(run, plan);
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

  // With a local framework: Graphite works out the confirmed new text of every note (each target with the
  // capture added, the inbox with those captures ticked, Brain edits); the framework writes them in its stage.
  async function inboxApplyFw(run, plan) {
    const accept = acceptSet(run.body.accept, plan.items), ae = acceptSet(run.body.acceptEdits, plan.edits || []);
    const items = plan.items.filter((_, i) => accept.has(i));
    const byTarget = new Map();
    for (const it of items) {
      const abs = inVault(it.target); await realInVault(abs);
      if (!byTarget.has(it.target)) { const cur = await fsp.readFile(abs, 'utf8').catch(() => null); byTarget.set(it.target, { cur, text: cur }); }
      const t = byTarget.get(it.target);
      t.text = t.text == null ? it.text.replace(/\s*$/, '\n') : t.text.replace(/\s*$/, '') + '\n\n' + it.text.replace(/\s*$/, '') + '\n';
    }
    const ops = [...byTarget].map(([rel, t]) => ({ kind: 'file', rel, content: t.text, base: t.cur == null ? null : hash(t.cur) }));
    if (items.length) {
      const cur = await fsp.readFile(inVault(INBOX), 'utf8');
      const lines = cur.split('\n');
      for (const it of items) {
        const k = lines.findIndex((l, n) => l.startsWith('- [ ] ') && (l.includes(`%%${it.id}%%`) || it.id === 'line-' + (n + 1)));
        if (k < 0) continue;
        const link = it.target.replace(/\.md$/i, '');
        lines[k] = lines[k].replace('- [ ] ', '- [x] ').replace(/\s*$/, '') + ` → [[${link}${it.shown ? '|' + it.shown.replace(/[|\]]/g, ' ') : ''}]] (${today()})`;
      }
      ops.push({ kind: 'file', rel: INBOX, content: lines.join('\n'), base: hash(cur) });
    }
    const edits = (plan.edits || []).filter((_, i) => ae.has(i));
    for (const e of edits) ops.push({ kind: 'file', rel: e.path, content: e.content, base: e.base });
    if (!ops.length) return { job: 'inbox', framework: run.fw, done: [], failed: [], edited: [], summary: plan.summary };
    await fwApply(run, ops);
    return { job: 'inbox', framework: run.fw, done: items.map(d => ({ id: d.id, target: d.target, shown: d.shown, mode: d.mode })), failed: [], edited: edits.map(e => e.path), summary: plan.summary };
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
    if (run.fw) {
      const edits = plan.edits.filter((_, i) => accept.has(i));
      if (edits.length) await fwApply(run, edits.map(e => ({ kind: 'file', rel: e.path, content: e.content, base: e.base })));
      return { job: 'brain', framework: run.fw, edited: edits.map(e => e.path), failed: [], summary: plan.summary };
    }
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
    const fw = body.framework && h.frameworks.ids.includes(body.framework) ? body.framework : null;
    const provider = fw ? null : body.provider || 'anthropic';
    const model = fw ? '' : String(body.model || '').trim() || (provider === 'anthropic' ? h.ANTHROPIC_DEFAULT : '');
    for (const [k, v] of plans) if (Date.now() - v.at > 3600e3) plans.delete(k);
    let plan = null;
    if (body.phase === 'apply') {
      plan = plans.get(String(body.planId || ''));
      if (!plan || plan.job !== body.job) throw new HttpError(410, 'This plan has expired; start again');
      if (plan.planMode === 'manual' && (plan.owner !== (fw || provider) || plan.vault !== VAULT())) {
        throw new HttpError(409, 'The chosen executor or vault changed; scan again');
      }
    }
    const manual = body.job === 'import' && (plan ? plan.planMode === 'manual' : body.planning === 'manual');
    const localScan = provider === 'graphite' && manual;
    if (!fw && !localScan && provider !== 'anthropic' && !Object.hasOwn(h.COMPAT, provider)) throw new HttpError(400, 'Unknown AI provider');
    if (!manual && !fw && !key && provider !== 'custom') throw new HttpError(400, 'No API key');
    if (!manual && !fw && !model) throw new HttpError(400, 'Choose a model first (Settings → AI)');
    const ctl = new AbortController();
    res.on('close', () => { if (!res.writableFinished) ctl.abort(); });
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store' });
    const line = o => { if (!res.writableEnded) res.write(JSON.stringify(o) + '\n'); };
    // Study settings decide the folders, not the request: course folders, left-out names, "look elsewhere", the
    // study record folder, read-only folders and the language notes are written in. Same for every AI.
    // (Before Study settings were ever saved, e.g. a caller of this API without the app, the request's own folders
    // are used, as in earlier versions; the app saves them on its first start.)
    const prof = h.study ? await h.study.load() : null;
    if (prof) {
      body.roots = prof.courseRoots; body.skip = prof.skipFolders; body.extras = prof.lookElsewhere;
      body.recentFolders = prof.recentFolders; body.recentDays = prof.recentDays;
      BRAIN = prof.brainFolder || 'Claude Brain';
      readOnly = [...BUILTIN_NO_WRITE, ...prof.readOnlyFolders];
    }
    const uiName = LANG_NAMES[body.lang] || 'English';
    const run = { provider, fw, key, body: { ...body, model }, model, sb: cleanRoots(body), prof,
      langName: prof ? h.PROFILE.outputLanguage(body.job === 'brain' ? 'brain' : body.job, prof, uiName) : uiName,
      settingsBlock: prof ? h.PROFILE.promptBlock(body.job, prof, h.study.file()) : '',
      signal: ctl.signal, seen: new Map(), edited: [], progress: p => line({ progress: p }) };
    try {
      let result;
      if (plan) {
        if (plan.planMode === 'manual') {
          run.manualItems = await manualSelection(run, plan);
          if (plans.get(body.planId) !== plan) throw new HttpError(410, 'This plan was already used');
        }
        plans.delete(body.planId);
        result = await job[1](run, plan);
      }
      else {
        result = await job[0](run);
        if (!result.empty && ['items', 'edits', 'ignore', 'questions'].some(k => result[k] && result[k].length)) {
          const planId = crypto.randomBytes(9).toString('hex');
          plans.set(planId, { ...result, owner:fw || provider, vault:VAULT(), at: Date.now() });
          result = { ...result, planId, edits: (result.edits || []).map(({ content, base, ...e }) => e) };
          if (result.items) result.items = result.items.map(({ text, ...it }) => ({ ...it, preview: text ? text.slice(0, 600) : undefined }));
        }
      }
      if (fw) result = { ...result, framework: fw, reads: (run.reads || []).slice(0, 50) };
      line({ result });
    } catch (e) { line({ error: e.message || String(e), status: e.status || 500, ...(e.code ? { code: e.code } : {}), ...(e.framework ? { framework: e.framework, detail: e.detail || '' } : {}), ...(e.stage ? { stage: e.stage } : {}) }); }
    res.end();
  }
  return { handle, parseInbox, scan, copyIntoVault };
};
