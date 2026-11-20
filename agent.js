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
  const { HttpError, hash, inVault, toRel, exists, atomicWrite, withFileLock, officeToPdf, readBody, LANG_NAMES } = h;
  const VAULT = () => h.vault();
  const WIN = process.platform === 'win32';
  const low = s => (WIN ? s.toLowerCase() : s);
  const norm = p => p.replace(/\\/g, '/');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const MANIFEST = '.obsidian/plugins/claude-chat/imports.json';
  const INBOX = 'Claude Inbox.md'; // file name kept from earlier versions, so existing captures stay where they are
  // The study record folder and the read-only folders come from Study settings (set per job in handle()).
  let BRAIN = 'Claude Brain';
  const BUILTIN_NO_WRITE = require('./profile').BUILTIN_READ_ONLY;
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
  function sourceReadError(run, cause) {
    run.signal.throwIfAborted();
    const zh = /^zh/i.test(run.body.lang || '');
    const [code,en,cn] = cause.code === 'EBUSY'
      ? ['sourceBusy','The source is in use. Close it and retry.','来源文件正被占用，关闭后可重试。']
      : ['ENOENT','ENOTDIR'].includes(cause.code)
        ? ['sourceMissing','The source was moved or deleted. Restore it and retry.','来源文件已被移动或删除，恢复后可重试。']
        : ['sourceUnreadable','The source could not be read. Check access and retry.','来源文件无法读取，请检查读取权限后重试。'];
    return Object.assign(new Error(zh ? cn : en), {sourceIssue:code});
  }
  const failedImport = (item, error) => ({src:item.src, name:item.name, dest:item.dest, error:error.message, ...(error.sourceIssue ? {code:error.sourceIssue} : {})});
  async function snapshotSource(run, src, input) {
    const digest = crypto.createHash('sha256');
    // Only source reads become per-file failures. Opening/writing the stage and an
    // interrupted operation still fail the job; never hand a partial input to the CLI.
    async function* chunks() {
      try {
        for await (const chunk of fs.createReadStream(src,{signal:run.signal})) {
          digest.update(chunk); yield chunk;
        }
      } catch (e) { throw sourceReadError(run,e); }
    }
    await fsp.writeFile(input,chunks(),{flag:'wx',mode:0o600,signal:run.signal});
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
  async function fwApply(run, ops, { free = [], freeTask = '', importCopies } = {}) {
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
    // The selected framework can read its workspace even when its own file policy excludes the
    // course directory. Give it exactly the selected inputs, with no dependency on drive access.
    let inputsDir;
    const sourceFailures = [];
    if (importCopies) {
      inputsDir = await fsp.mkdtemp(path.join(stage,'.graphite-inputs-'));
      try {
        const ready = [];
        for (const [i,op] of ops.entries()) {
          run.signal.throwIfAborted();
          const input = path.join(inputsDir,String(i)+path.extname(op.src));
          try {
            const src = await checkedSource(run,op.src,true);
            const stagedHash = await snapshotSource(run,src,input);
            ready.push({...op,stagedHash,input:norm(path.relative(stage,input))});
          } catch(e) {
            if (!e.sourceIssue) throw e;
            await fsp.rm(input,{force:true});
            sourceFailures.push(failedImport(op,e));
          }
        }
        if (!ready.length) {
          await fsp.rm(stage,{recursive:true,force:true});
          return {done:[],failed:sourceFailures,extra:[]};
        }
        ops = ready;
      } catch (e) {
        await fsp.rm(stage,{recursive:true,force:true});
        throw e;
      }
    }
    const steps = ops.map((o, i) => (o.kind === 'copy'
      ? `${i + 1}. Copy the file "${o.input || o.src}" to "${o.rel}" (relative to your working directory), byte for byte. Create the folders it needs.`
      : `${i + 1}. Write the file "${o.rel}" (relative to your working directory) with exactly the text between the markers, replacing the file if it is there. Create the folders it needs.\n<<<GRAPHITE-FILE\n${o.content.replace(/\s*$/, '')}\nGRAPHITE-FILE>>>`));
    const prompt = ['You are carrying out changes the user has just confirmed in Graphite, a notes app.',
      `Your working directory is a temporary stage folder: ${stage}`,
      'Write ONLY inside your working directory, using your own file tools. Graphite checks what you wrote and then copies it into the user\'s notes itself.',
      steps.length ? 'Do exactly these steps, nothing else:' : '', ...steps,
      freeBase.size ? `${steps.length ? 'Then: ' : ''}${freeTask} The notes you may edit are already in your working directory: ${[...freeBase.keys()].join(', ')}. Keep every line that is in them now; only add lines. Do not create other notes.` : '',
      'Do not create, change or delete anything else, and do not read anything except the files named here.',
      'When you are done, reply with <graphite-result>{"done":[the numbers of the steps you did]}</graphite-result>.'].filter(Boolean).join('\n\n');
    const srcDirs = importCopies ? [] : [...new Set(ops.filter(o => o.kind === 'copy').map(o => path.dirname(o.src)))];
    try {
      await h.frameworks.run(run.fw, {
        prompt, cwd: stage, key: run.key, paths: run.body.frameworkPaths || {}, signal: run.signal, mode: 'write',
        allow: { roots: [stage, ...srcDirs], skip: run.sb.skip },
        onProgress: p => run.progress(p.step === 'write' || p.step === 'read' ? { ...p, path: norm(path.relative(stage, path.resolve(stage, String(p.path || '')))) } : p),
      });
    } catch (e) {
      e.stage = stage;
      if (sourceFailures.length) e.sourceFailures = sourceFailures;
      if (importCopies && (e.code === 'outside' || e.code === 'agentPermission')) e.canResumeImport = true;
      if (e.code === 'stopped') await fsp.rm(stage,{recursive:true,force:true}).catch(()=>{});
      throw e;
    } finally {
      if (inputsDir) await fsp.rm(inputsDir,{recursive:true,force:true}).catch(()=>{});
    }
    // Check the stage.
    run.progress({ step: 'check' });
    const problems = [];
    for (const o of ops) {
      const f = path.join(stage, o.rel);
      if (!(await exists(f))) { problems.push(`missing ${o.rel}`); continue; }
      if (o.kind === 'copy') {
        if (!(await fsp.lstat(f)).isFile() || !inside(await fsp.realpath(f),await fsp.realpath(stage))) {
          problems.push(`${o.rel} is not a regular staged copy`); continue;
        }
        o.sourceHash = await fileHash(f);
        if (o.sourceHash !== (o.stagedHash || await fileHash(o.src))) problems.push(`${o.rel} is not an exact copy`);
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
    if (importCopies) {
      try {
        const result = await importCopies(stage,ops);
        return {done:result.done, failed:[...sourceFailures,...result.failed], extra};
      }
      finally { await fsp.rm(stage, {recursive:true,force:true}).catch(()=>{}); }
    }
    // Apply: only the confirmed changes; undo everything if one fails.
    const undo = [], applied = [];
    try {
      for (const o of ops) {
        if (o.kind === 'copy') {
          run.progress({ step: 'copy', path: o.dest, i: applied.length + 1, n: ops.length });
          await realInVault(inVault(o.dest));
          const dest = await copyIntoVault(path.join(stage, o.rel), o.dest);
          undo.push({abs:inVault(dest),rel:dest,expected:o.sourceHash,previous:null});
          applied.push({ ...o, dest });
        } else {
          const abs = await realInVault(inVault(o.target || o.rel));
          const staged = await fsp.readFile(path.join(stage, o.rel));
          run.progress({ step: 'write', path: o.target || o.rel });
          await withFileLock(abs, async () => {
            const compare = () => verifyRecordVersion(abs, o.base ?? null, o.target || o.rel);
            const cur = await compare();
            if (cur == null) await createRecord(abs, staged, compare);
            else await atomicWrite(abs, staged, {beforeReplace:compare});
            undo.push({abs,rel:o.target || o.rel,expected:crypto.createHash('sha256').update(staged).digest('hex'),previous:cur});
          });
          applied.push(o);
        }
      }
      for (const e of freeEdits) {
        const abs = await realInVault(inVault(e.rel));
        await withFileLock(abs, async () => {
          const cur = await fsp.readFile(abs, 'utf8');
          if (hash(cur) !== e.base) throw new Error(`${e.rel} changed meanwhile`);
          await atomicWrite(abs,e.content);
          undo.push({abs,rel:e.rel,expected:crypto.createHash('sha256').update(e.content).digest('hex'),previous:cur});
        });
        if (!run.edited.includes(e.rel)) run.edited.push(e.rel);
      }
    } catch (e) {
      const kept = [];
      for (const item of undo.reverse()) {
        try {
          await withFileLock(item.abs,async()=>{
            if (await fileHash(item.abs) !== item.expected) { kept.push(item.rel); return; }
            if (item.previous==null) await fsp.unlink(item.abs);
            else await atomicWrite(item.abs,item.previous);
          });
        } catch { kept.push(item.rel); }
      }
      if (kept.length) fail('Some files changed during recovery and were left as found','applyChanged',kept.join(', '));
      fail('Applying the confirmed changes failed; everything was put back', 'applyFailed', e.message);
    }
    await fsp.rm(stage, { recursive: true, force: true }).catch(() => {});
    return { applied, extra };
  }

  /* ---------- import: scan (ported from the obsidian-import skill's scan.js) ---------- */
  async function readManifest() {
    const file = await realInVault(inVault(MANIFEST));
    try { return { imported: {}, ignored: {}, previews: {}, ...JSON.parse(await fsp.readFile(file, 'utf8')) }; }
    catch (e) { if (e.code === 'ENOENT') return { imported:{}, ignored:{}, previews:{} }; throw e; }
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
    const pendingPreviews = [];
    for (const [id, preview] of Object.entries(manifest.previews)) {
      if (preview.status !== 'failed') continue;
      const possible = bySize.get(preview.size+path.extname(preview.originalDest).toLowerCase()) || [];
      const found = await locateOriginal(preview,possible,digest).catch(()=>null);
      if (!found) continue;
      const originalDest = toRel(found), dest = proposedPdf(preview,originalDest);
      pendingPreviews.push({name:path.posix.basename(originalDest), originalDest, src:found, dest, kind:'convert', retryPreviewId:id,
        selectedByDefault:true, size:preview.size, preview:previewInfo(preview,id)});
    }
    return { candidates, counts, folders, duplicates, pendingPreviews, hints: Object.fromEntries(Object.entries(hints).map(([k, s]) => [k, [...s].slice(0, 8)])) };
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
    const { candidates, counts, folders, duplicates, pendingPreviews } = scanResult;
    const mapped = Object.entries(run.prof?.courses || {});
    const items = candidates.filter(c => !c.duplicateOf).map(c => {
      const file = c.kind === 'convert' ? c.name.slice(0, -path.extname(c.name).length) + '.pdf' : c.name;
      const course = c.course && (mapped.find(([code]) => low(code) === low(c.course))?.[1] || c.course);
      const sub = c.rel ? path.posix.dirname(c.rel) : '.';
      let dest = [course, sub === '.' ? '' : sub, file].filter(Boolean).join('/');
      try { checkManualDest(dest, file); } catch { dest = file; }
      return {src:c.src, name:c.name, dest, kind:c.kind, course:c.course, size:c.size, selectedByDefault:!!course};
    });
    return {job:'import', planMode:'manual', ...(issue ? {planningIssue:issue} : {}), counts, total:candidates.length+pendingPreviews.length,
      items:[...pendingPreviews,...items], folders:folders.filter(folder=>!NO_WRITE.test(folder)), duplicates, ignore:[], questions:[]};
  }
  async function importPlan(run) {
    const scanResult = await scan(run.sb, !!run.body.extras, run.progress, run.body, run.signal);
    run.signal.throwIfAborted();
    const { candidates, counts, folders, hints, duplicates, pendingPreviews } = scanResult;
    if (!candidates.length && pendingPreviews.length) return manualImportPlan(run, scanResult);
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
    return { job: 'import', counts, duplicates, total: candidates.length+pendingPreviews.length,
      items:[...pendingPreviews,...items], ignore, questions, note: String(out.note || '') };
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
    const items = [];
    for (const i of selected) {
      const it = plan.items[i], dest = Object.hasOwn(destinations,i) ? destinations[i] : it.dest;
      const to = checkManualDest(dest, path.posix.basename(it.dest));
      await realInVault(to);
      if (!it.retryPreviewId) {
        try { await checkedSource(run,it.src,true); }
        catch (e) { if (!e.sourceIssue) throw e; } // Report unavailable individual sources alongside the others at apply.
      }
      items.push({...it,dest});
    }
    return items;
  }

  async function checkedSource(run, src, individual = false) {
    const roots = run.sb.roots.slice();
    if (run.body.extras) {
      const home = os.homedir();
      for (const folder of run.body.recentFolders || ['Downloads','Desktop','Documents']) {
        const recent = path.resolve(home, folder);
        if (inside(recent, home) && recent !== home) roots.push(recent);
      }
    }
    const unavailable = () => new HttpError(409, 'A source is no longer available in the approved folders; scan again');
    const expected = path.resolve(src);
    if (!roots.some(root=>inside(expected,root)) || skipped(expected,run.sb)) throw unavailable();
    try {
      const current = await fsp.realpath(src);
      if (low(current) !== low(expected) || !(await fsp.lstat(src)).isFile()) throw unavailable();
      return current;
    } catch (e) {
      if (e.status) throw e;
      throw individual ? sourceReadError(run,e) : unavailable();
    }
  }

  // Copy a file into the vault, never overwriting (a numbered name is used instead).
  async function copyIntoVault(src, dest) {
    const target = await importLocation(dest,true);
    await fsp.mkdir(path.dirname(target), { recursive: true });
    const ext = path.extname(target), stem = target.slice(0,target.length-ext.length);
    for (let n=0; ; n++) {
      const abs = n ? `${stem} ${n}${ext}` : target;
      try { await fsp.copyFile(src, abs, fs.constants.COPYFILE_EXCL); return toRel(abs); }
      catch (e) { if (e.code !== 'EEXIST') throw e; }
    }
  }
  const importKey = src => norm(src).toLowerCase();
  const withPdfExtension = rel => rel.slice(0,-path.posix.extname(rel).length)+'.pdf';
  async function importLocation(rel,write) {
    if (typeof rel !== 'string' || path.posix.isAbsolute(rel) || path.win32.isAbsolute(rel) || /[\\:\x00-\x1f]/.test(rel)) {
      throw new HttpError(400,'Choose a file inside the vault.');
    }
    const abs = write ? writeTargetAny(rel) : checkVault(inVault(rel)).abs;
    let at = abs;
    while (!(await fsp.lstat(at).catch(e=>{if(e.code!=='ENOENT')throw e;return null;}))) at = path.dirname(at);
    const real = await fsp.realpath(at), root = await fsp.realpath(VAULT());
    if (!inside(real,root)) throw new HttpError(400,'The selected path is outside the vault.');
    const actual = norm(path.relative(root,path.resolve(real,path.relative(at,abs))));
    if (actual.split('/').some(s=>s.startsWith('.')) || (write && NO_WRITE.test(actual))) throw new HttpError(400,'This vault folder is unavailable for that action.');
    return abs;
  }
  function previewInfo(record,id) {
    return record.status === 'ready' ? {status:'ready',dest:record.pdfDest}
      : {status:'failed',code:record.code,reason:record.reason,retryId:id};
  }
  function previewResult(record,id) {
    return {name:path.posix.basename(record.originalDest), originalDest:record.originalDest,
      dest:record.status === 'ready' ? record.pdfDest : record.originalDest, preview:previewInfo(record,id)};
  }
  function converterFailure(e,input) {
    const code = typeof e.code === 'string' && /^office[A-Za-z]+$/.test(e.code) ? e.code : 'officeConversionFailed';
    let reason = String(e.message || '').split(/\r?\n/).map(s=>s.trim()).find(Boolean) || '';
    for (const app of ['Word','PowerPoint']) {
      const prefix = app+' · '+path.basename(input);
      if (reason.startsWith(prefix)) reason = reason.slice(prefix.length).replace(/^[：:\s]+/,'');
    }
    if (!reason || reason.includes(path.dirname(input))) reason = 'PDF conversion failed.';
    reason = reason.slice(0,200);
    return {code,reason};
  }
  async function updateManifest(change) {
    const file = inVault(MANIFEST);
    await realInVault(file);
    return withFileLock(file,async()=>{
      const manifest = await readManifest(), created = [];
      async function publish(source,dest,expectedHash) {
        const rel = await copyIntoVault(source,dest), abs = inVault(rel);
        const st = await fsp.lstat(abs,{bigint:true});
        created.push({rel,abs,st,expectedHash});
        return rel;
      }
      try {
        const result = await change(manifest,publish);
        await atomicWrite(file,JSON.stringify(manifest,null,2));
        return result;
      } catch (e) {
        const kept = [];
        for (const {abs,rel,st,expectedHash} of created) {
          try {
            await withFileLock(abs,async()=>{
              await importLocation(rel,true);
              const current = await fsp.lstat(abs,{bigint:true});
              if (!current.isFile() || current.ino !== st.ino || current.dev !== st.dev || current.ctimeNs !== st.ctimeNs ||
                  await fileHash(abs) !== expectedHash || (await fsp.lstat(abs,{bigint:true})).ctimeNs !== current.ctimeNs) {
                kept.push(rel); return;
              }
              await fsp.unlink(abs);
            });
          } catch(err) { if (err.code !== 'ENOENT') kept.push(rel); }
        }
        if (kept.length) e.message += ' Kept changed files: '+kept.join(', ');
        throw e;
      }
    });
  }
  async function officeSnapshot(src,run,work) {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(),'graphite-convert-'));
    try {
      const input = path.join(dir,'source'+path.extname(src)), pdf = path.join(dir,'preview.pdf');
      const sourceHash = await snapshotSource(run,src,input);
      const snapshot = {input,pdf,size:(await fsp.stat(input)).size,sourceHash};
      return await work(snapshot);
    } finally { await fsp.rm(dir,{recursive:true,force:true}).catch(()=>{}); }
  }
  async function makePreview(snapshot,run) {
    run.signal.throwIfAborted();
    try {
      await officeToPdf(snapshot.input,snapshot.pdf);
      const file = await fsp.open(snapshot.pdf,'r');
      try {
        const head = Buffer.alloc(5); await file.read(head,0,head.length,0);
        if (head.toString('ascii') !== '%PDF-') throw Object.assign(new Error('Office did not produce a PDF file.'),{code:'officeExportFailed'});
      } finally { await file.close(); }
    }
    catch(e) { run.signal.throwIfAborted(); return converterFailure(e,snapshot.input); }
    run.signal.throwIfAborted();
    return null;
  }
  async function keepOffice(it,src,run) {
    return officeSnapshot(src,run,async snapshot=>{
      const source = await checkedSource(run,it.src);
      const changed = () => new HttpError(409,'The Office source changed; scan again.');
      let issue = await makePreview(snapshot,run);
      const dest = it.dest, key = importKey(it.src);
      if (run.vault !== VAULT()) throw new HttpError(409,'The vault changed; scan again.');
      if (snapshot.sourceHash !== await fileHash(await checkedSource(run,it.src),run.signal)) throw changed();
      const st = await fsp.stat(source);
      // An Office repair prompt or unusual converter may have changed its temporary input.
      if (await fileHash(snapshot.input,run.signal).catch(()=>null) !== snapshot.sourceHash) {
        await fsp.copyFile(source,snapshot.input);
        if (snapshot.sourceHash !== await fileHash(snapshot.input,run.signal)) throw changed();
        issue ||= {code:'officeExportFailed',reason:'Office changed the input while converting it.'};
      }
      const pdfHash = issue ? null : await fileHash(snapshot.pdf,run.signal);
      return updateManifest(async (manifest,publish)=>{
        const previous = manifest.imported[key];
        if (previous?.sourceHash === snapshot.sourceHash && previous.plannedDest === dest) {
          const record = manifest.previews[previous.previewId];
          if (record && await exists(await realInVault(writeTargetAny(record.originalDest)))) return previewResult(record,previous.previewId);
          if (previous.converted && await exists(await realInVault(writeTargetAny(previous.dest)))) return {dest:previous.dest,preview:{status:'ready',dest:previous.dest}};
        }
        const base = {size:st.size,mtime:st.mtimeMs,sourceHash:snapshot.sourceHash,at:new Date().toISOString(),plannedDest:dest,...(run.fw ? {by:run.fw} : {})};
        if (!issue) {
          const saved = await publish(snapshot.pdf,dest,pdfHash);
          manifest.imported[key] = {...base,dest:saved,converted:true};
          return {dest:saved,preview:{status:'ready',dest:saved}};
        }
        const originalDest = await publish(snapshot.input,dest.slice(0,-4)+path.extname(it.src),snapshot.sourceHash);
        const id = crypto.randomUUID(), record = {originalDest,requestedDest:withPdfExtension(originalDest),size:st.size,originalHash:snapshot.sourceHash,status:'failed',...issue};
        manifest.previews[id] = record;
        manifest.imported[key] = {...base,dest:originalDest,previewId:id};
        return previewResult(record,id);
      });
    });
  }
  function proposedPdf(record,originalDest) {
    const sameFolder = record.requestedDest === withPdfExtension(record.originalDest);
    const suggested = sameFolder ? withPdfExtension(originalDest) : record.requestedDest;
    if (!NO_WRITE.test(suggested)) return suggested;
    return path.posix.basename(suggested);
  }
  async function locateOriginal(record,possible,digest=fileHash) {
    if (!record || !OFFICE.test(record.originalDest) || !/\.pdf$/i.test(record.requestedDest)) throw new HttpError(404,'This saved Office original is unavailable.');
    const file = await importLocation(record.originalDest,false);
    const st = await fsp.lstat(file).catch(e=>{if(e.code!=='ENOENT')throw e;return null;});
    if (st?.isFile() && st.size <= MAX_BYTES) return file;
    if (st || !record.originalHash) throw new HttpError(409,'The saved Office original is unavailable.');
    const ext = path.extname(record.originalDest).toLowerCase();
    if (!possible) {
      possible = [];
      const dirs = [VAULT()];
      while (dirs.length) {
        const dir = dirs.pop();
        for (const e of await fsp.readdir(dir,{withFileTypes:true}).catch(()=>[])) {
          if (e.name.startsWith('.')) continue;
          const p = path.join(dir,e.name);
          if (e.isDirectory()) dirs.push(p);
          else if (e.isFile() && path.extname(e.name).toLowerCase()===ext && (await fsp.stat(p).catch(()=>null))?.size===record.size) possible.push(p);
        }
      }
    }
    let found;
    for (const candidate of possible) {
      await importLocation(toRel(candidate),false);
      if (await digest(candidate).catch(()=>null) !== record.originalHash) continue;
      if (found) throw new HttpError(409,'Several files match the moved Office original. Restore its original path to identify the correct one.');
      found = candidate;
    }
    if (!found) throw new HttpError(409,'The saved Office original is missing or has moved and changed.');
    return found;
  }
  const previewJobs = new Map();
  function retryPreview(run,id,requestedDest) {
    const key = JSON.stringify([run.vault,id,requestedDest || '']);
    if (previewJobs.has(key)) return previewJobs.get(key);
    const job = generateSavedPreview(run,id,requestedDest).finally(()=>previewJobs.delete(key));
    previewJobs.set(key,job);
    return job;
  }
  async function generateSavedPreview(run,id,requestedDest) {
    if (typeof id !== 'string' || !/^[a-f\d-]{36}$/i.test(id)) throw new HttpError(400,'Choose an existing PDF preview to retry.');
    const first = (await readManifest()).previews[id];
    const original = await locateOriginal(first), originalDest = toRel(original);
    const proposed = proposedPdf(first,originalDest), dest = requestedDest || proposed;
    checkManualDest(dest,path.posix.basename(proposed));
    await importLocation(dest,true);
    return officeSnapshot(original,run,async snapshot=>{
      async function alreadyReady(record) {
        if (record?.status !== 'ready' || record.inputHash !== snapshot.sourceHash) return false;
        const file = await realInVault(checkManualDest(record.pdfDest,path.posix.basename(record.pdfDest)));
        return await fileHash(file,run.signal).catch(()=>null) === record.pdfHash;
      }
      if (await alreadyReady(first)) return previewResult({...first,originalDest},id);
      const issue = await makePreview(snapshot,run);
      const pdfHash = issue ? null : await fileHash(snapshot.pdf,run.signal);
      if (run.vault !== VAULT()) throw new HttpError(409,'The vault changed; scan again.');
      if (await fileHash(await importLocation(originalDest,false),run.signal) !== snapshot.sourceHash) throw new HttpError(409,'The saved Office original changed during conversion. Retry with the edited file.');
      return updateManifest(async (manifest,publish)=>{
        const record = manifest.previews[id];
        if (!record || (record.originalDest !== first.originalDest && record.originalDest !== originalDest)) throw new HttpError(409,'The saved Office original changed; scan again.');
        if (await alreadyReady(record)) return previewResult(record,id);
        if (originalDest !== record.originalDest) {
          record.originalDest = originalDest;
          for (const imported of Object.values(manifest.imported)) if (imported.previewId === id) imported.dest = originalDest;
        }
        record.size = snapshot.size;
        record.originalHash = snapshot.sourceHash;
        if (issue) Object.assign(record,{requestedDest:dest,status:'failed',...issue});
        else {
          const saved = await publish(snapshot.pdf,dest,pdfHash);
          Object.assign(record,{status:'ready',requestedDest:dest,pdfDest:saved,inputHash:snapshot.sourceHash,pdfHash});
          delete record.code; delete record.reason;
        }
        return previewResult(record,id);
      });
    });
  }
  function previewNotice(done,lang,indexError='') {
    const missing = done.filter(d=>d.preview?.status === 'failed');
    if (!missing.length) return indexError;
    const reasons = [...new Set(missing.map(d=>d.preview.reason))].slice(0,3).join(' / ');
    const notice = /^zh/i.test(lang || '')
      ? `已保留 ${missing.length} 份 Office 原件，PDF 预览未生成。重新扫描可重试预览。${reasons}`
      : `Saved ${missing.length} Office original(s). PDF preview unavailable. Scan again to retry. ${reasons}`;
    return [notice,indexError].filter(Boolean).join('\n');
  }

  async function recordIgnored(ignored) {
    if (!ignored.length) return;
    await updateManifest(async manifest=>{
      for (const ig of ignored) manifest.ignored[norm(ig.src).toLowerCase()] = {reason:ig.reason || '', at:new Date().toISOString()};
    });
  }

  const INDEX_SYSTEM = lang => `New course files were just copied into a student's notes vault. Make them one click away from the course's index note, in the student's own style.
- In each course folder (the top folder of the destinations), find the index note: a note whose name has "Index", "目录", "Resources" or "资料" in it (list_dir the course folder). Read it before writing.
- Add links like [[2026.10.15.pdf|10.15]] (file name, then a short label) under a numbered section for the file's folder (e.g. "2. 作业 Homework。"), creating that section at the end if it doesn't exist. Follow the note's existing style. Never remove or rewrite anything already there; only add.
- If the course has no index note, create "<Course>/课件目录 Slides Index.md" with frontmatter "graph: hide".
- Use write_vault_file with the whole note. Then call finish with a two-line summary in ${lang}.`;

  async function importFiles(run,chosen,stage) {
    const done = [], failed = [];
    for (const it of chosen) {
      run.signal.throwIfAborted();
      run.progress({ step: 'copy', path: it.dest, i: done.length + failed.length + 1, n: chosen.length });
      try {
        if (it.retryPreviewId) { done.push(await retryPreview(run,it.retryPreviewId,it.dest)); continue; }
        const source = await checkedSource(run,it.src,true);
        const bytes = stage ? path.join(stage,it.rel) : source;
        let sourceHash;
        if (stage || it.kind !== 'convert') {
          sourceHash = await fileHash(source,run.signal).catch(e=>{throw sourceReadError(run,e);});
          if (stage && sourceHash !== it.stagedHash) {
            const msg = /^zh/i.test(run.body.lang || '') ? '来源文件已更改，请重新扫描。' : 'The source changed. Scan again to import the latest version.';
            throw Object.assign(new Error(msg),{sourceIssue:'sourceChanged'});
          }
        }
        if (it.kind === 'convert') { done.push({...await keepOffice(it,bytes,run),src:it.src,name:it.name}); continue; }
        const st = await fsp.stat(source).catch(e=>{throw sourceReadError(run,e);});
        const dest = await updateManifest(async (manifest,publish)=>{
          const key = importKey(it.src), previous = manifest.imported[key];
          // A second preview can have the same source and destination. Reuse the
          // earlier copy only while its bytes still match; keep any student edits.
          if (typeof previous?.dest === 'string' && previous.sourceHash === sourceHash &&
              path.relative(previous.plannedDest || previous.dest,it.dest) === '') {
            const previousFile = await importLocation(previous.dest,false);
            try {
              if ((await fsp.lstat(previousFile)).isFile() && await fileHash(previousFile,run.signal) === sourceHash) return previous.dest;
            } catch (err) {
              if (!['ENOENT','ENOTDIR','EBUSY','EACCES','EPERM'].includes(err.code)) throw err;
            }
          }
          const saved = await publish(bytes,it.dest,sourceHash);
          manifest.imported[key] = {dest:saved,plannedDest:it.dest,size:st.size,mtime:st.mtimeMs,sourceHash,at:new Date().toISOString(),...(run.fw ? {by:run.fw} : {})};
          return saved;
        });
        done.push({src:it.src,name:it.name,dest});
      } catch (e) {
        run.signal.throwIfAborted();
        failed.push(failedImport(it,e));
      }
    }
    return {done,failed};
  }
  function rememberImport(run,items,options) {
    const id = crypto.randomBytes(16).toString('hex');
    plans.set(id,{job:'import',items,ignore:[],owner:run.fw || run.provider,vault:run.vault,at:Date.now(),resumeOnly:true,...options});
    return {id,count:items.length,...(run.fw ? {framework:run.fw} : {provider:run.provider})};
  }
  async function importApply(run,plan) {
    const manual = plan.planMode === 'manual';
    const accept = acceptSet(run.body.accept,plan.items);
    const chosen = manual ? run.manualItems : plan.items.filter((_,i)=>accept.has(i));
    const external = chosen.filter(i=>!i.retryPreviewId);
    const staged = !manual && run.fw && external.length;
    let done, failed, extra;
    if (staged) {
      const seen = new Set(), ops = [];
      for (const it of external) {
        await realInVault(writeTargetAny(it.dest));
        let rel = it.kind === 'convert' ? it.dest.replace(/\.pdf$/i,path.extname(it.src)) : it.dest;
        while (seen.has(low(rel))) rel = 'input-' + ops.length + '/' + rel;
        seen.add(low(rel));
        ops.push({...it,rel,kind:'copy',importKind:it.kind});
      }
      ({done, failed, extra} = await fwApply(run,ops,{importCopies:(stage,ready)=>importFiles(run,ready.map(o=>({...o,kind:o.importKind})),stage)}));
      const retried = await importFiles(run,chosen.filter(i=>i.retryPreviewId));
      done.push(...retried.done); failed.push(...retried.failed);
    } else ({done,failed} = await importFiles(run,chosen));
    await recordIgnored(run.body.recordIgnore === false ? [] : plan.ignore || []);
    let summary = '', indexError = '';
    const notes = done.filter(d => !/\.md$/i.test(d.dest));
    // Index only actual published paths (after conflict numbering or an Office original fallback).
    if (notes.length && !manual && external.length) {
      try {
        if (run.fw) await frameworkIndex(run,notes);
        else {
          const out = await loop(run, { system: INDEX_SYSTEM(run.langName), user: `Files just added (vault paths):\n${notes.map(d => '- ' + d.dest).join('\n')}`,
            toolNames: ['list_dir', 'read_file', 'write_vault_file', 'finish'], submit: TOOL_DEFS.finish && { name: 'finish', ...TOOL_DEFS.finish }, maxTurns: 16 });
          summary = String(out.summary || '');
        }
      } catch (e) { indexError = e.message; }
    }
    const retrySources = new Set(failed.filter(it=>it.code).map(it=>it.src));
    const retryItems = chosen.filter(it=>retrySources.has(it.src));
    const retry = retryItems.length && run.vault === VAULT()
      ? rememberImport(run,retryItems,{planMode:plan.planMode}) : null;
    return {job:'import',...(manual ? {planMode:'manual'} : {}),done,failed,...(retry ? {retry} : {}),ignored:(plan.ignore || []).length,
      edited:run.edited,summary,indexError:previewNotice(done,run.body.lang,indexError),...(extra ? {extra} : {})};
  }
  async function frameworkIndex(run,notes) {
    // Index notes of the courses that get files: notes in the course folder named like an index.
    const courses = [...new Set(notes.filter(it=>it.dest.includes('/')).map(it=>it.dest.split('/')[0]))];
    const free = [];
    for (const c of courses) {
      const list = await walkFiles(inVault(c)).catch(() => []);
      for (const r of list) { const rel = norm(path.join(c, r)); if (NOTE_EXT.test(rel) && !rel.split('/').some(x => x.startsWith('.')) && /(目录|索引|index|资料|resources|contents)/i.test(path.basename(rel))) free.push(rel); }
    }
    const added = notes.map(it => '- ' + it.dest).join('\n');
    const freeTask = free.length ? `Add a link to each newly added file in the index note of its course and folder section, in the style the note already uses (for example [[LA5.pdf|LA5]]). The new files (vault paths): \n${added}` : '';
    if (free.length) await fwApply(run,[],{free:free.slice(0,40),freeTask});
  }

  /* ---------- inbox (ported from the obsidian-inbox skill) ---------- */
  function parseInbox(text, includeFiled = false) {
    const lines = text.split(/\r?\n/), items = [], markers = new Map(), copies = new Map();
    for (let i = 0; i < lines.length; i++) {
      const m = /^- \[([ xX])\] (.*)$/.exec(lines[i]);
      if (!m) continue;
      const filed = m[1] !== ' ';
      const head = filed ? m[2].replace(/ → \[\[.*?\]\] \(\d{4}-\d{2}-\d{2}\)\s*$/, '') : m[2];
      const body = [];
      for (let j = i + 1; j < lines.length && (/^\s+\S/.test(lines[j])); j++) body.push(lines[j].trim());
      const marker = (/%%(cap-[^%]+)%%/.exec(head) || [])[1];
      if (marker) markers.set(marker, (markers.get(marker) || 0) + 1);
      const fingerprint = crypto.createHash('sha256').update(JSON.stringify([head, ...body])).digest('hex');
      const occurrence = copies.get(fingerprint) || 0;
      copies.set(fingerprint, occurrence + 1);
      items.push({ marker, fingerprint, occurrence, filed, line: i, kind: (/\*\*(.+?)\*\*/.exec(head) || [])[1] || '', when: (/·\s*(\d{4}-\d{2}-\d{2}[^·]*)·/.exec(head) || [])[1]?.trim() || '',
        source: (/\[\[([^\]]+)\]\]/.exec(head) || [])[1] || (/·\s*(🎓[^%]*)/.exec(head) || [])[1]?.trim() || '',
        quote: body.filter(l => l.startsWith('>')).map(l => l.replace(/^>\s?/, '')).join('\n'),
        thought: body.filter(l => /^- Thought:/i.test(l)).map(l => l.replace(/^- Thought:\s*/i, '')).join('\n') });
    }
    for (const item of items) {
      item.copyCount = copies.get(item.fingerprint);
      item.id = !item.marker ? 'line-' + (item.line + 1) : markers.get(item.marker) === 1 ? item.marker
        : 'capture:' + item.fingerprint + ':' + (item.occurrence + 1);
    }
    return includeFiled ? items : items.filter(item => !item.filed);
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

  // Local frameworks read independently of Graphite's read_file tool. Remember the original versions
  // of editable study records before asking either kind of model to propose whole-file replacements.
  async function studyRecordVersions() {
    const versions = new Map();
    async function visit(rel) {
      if (NO_WRITE.test(rel)) return;
      const dir = await realInVault(inVault(rel));
      let entries;
      try { entries = await fsp.readdir(dir, {withFileTypes:true}); }
      catch (e) { if (['ENOENT','ENOTDIR','EACCES','EPERM'].includes(e.code)) return; throw e; }
      for (const entry of entries) {
        const child = rel+'/'+entry.name;
        if (NO_WRITE.test(child)) continue;
        if (entry.isDirectory()) { await visit(child); continue; }
        if (!entry.isFile() || !NOTE_EXT.test(entry.name) || /^quiz-results\.md$/i.test(entry.name)) continue;
        const file = await realInVault(inVault(child));
        try { versions.set(low(file), hash(await fsp.readFile(file,'utf8'))); }
        catch (e) { if (!['ENOENT','EACCES','EPERM'].includes(e.code)) throw e; }
      }
    }
    await visit(BRAIN);
    return versions;
  }
  async function checkEdits(edits, original) {
    const out = [];
    for (const e of Array.isArray(edits) ? edits : []) {
      let target;
      try { target = writeTarget(e.path); } catch { continue; }
      const { abs, rel } = target;
      if (!rel.startsWith(BRAIN + '/') || /quiz-results\.md$/i.test(rel)) continue;
      try {
        await realInVault(abs);
      } catch { continue; }
      const content = String(e.content || '');
      if (!content.trim()) continue;
      const cur = await readExistingRecord(abs), base = original.get(low(abs)) ?? null;
      if (content === cur) continue;
      if ((cur === null ? null : hash(cur)) !== base) {
        throw new HttpError(409, rel+' changed while preparing these edits. Review a new plan.');
      }
      const a = new Set((cur || '').split(/\r?\n/)), b = new Set(content.split(/\r?\n/));
      out.push({ path: rel, content, why: String(e.why || ''), base,
        added: [...b].filter(l => l.trim() && !a.has(l)).length, removed: [...a].filter(l => l.trim() && !b.has(l)).length });
    }
    return out;
  }
  async function readExistingRecord(abs) {
    try { return await fsp.readFile(abs,'utf8'); }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  async function verifyRecordVersion(abs, base, rel) {
    await realInVault(abs);
    const current = await readExistingRecord(abs);
    if ((current === null ? null : hash(current)) !== base) throw new Error(rel+' changed since the plan was made');
    return current;
  }
  async function createRecord(abs, content, compare) {
    await fsp.mkdir(path.dirname(abs),{recursive:true});
    const stage = path.join(path.dirname(abs),'.graphite-record-'+crypto.randomUUID()+'.tmp');
    try {
      await fsp.writeFile(stage,content,{flag:'wx'});
      await compare();
      try { await fsp.link(stage,abs); }
      catch (error) {
        // FAT and some network shares do not support hard links. Still require a new name.
        if (!['ENOTSUP','ENOSYS','EPERM','EXDEV'].includes(error.code)) throw error;
        await fsp.copyFile(stage,abs,fs.constants.COPYFILE_EXCL);
      }
    } finally { await fsp.unlink(stage).catch(()=>{}); }
  }
  async function writeEdit(e) {
    const {abs,rel} = writeTarget(e.path);
    if (!rel.startsWith(BRAIN+'/')) throw new Error('The study record folder changed. Review a new plan.');
    return withFileLock(abs, async () => {
      const compare = () => verifyRecordVersion(abs, e.base, rel);
      await compare();
      if (e.base === null) await createRecord(abs, e.content, compare);
      else await atomicWrite(abs, e.content, {beforeReplace:compare});
    });
  }

  async function inboxPlan(run) {
    const abs = inVault(INBOX);
    const text = await fsp.readFile(abs, 'utf8').catch(() => '');
    const caps = parseInbox(text);
    if (!caps.length) return { job: 'inbox', empty: true, items: [], edits: [] };
    run.progress({ step: 'inbox', n: caps.length });
    const brain = await exists(inVault(BRAIN));
    const versions = brain ? await studyRecordVersions() : null;
    const user = `Today: ${today()}\nClaude Brain folder: ${brain ? 'exists' : 'none (no edits)'}\n\n<captures>\n${caps.map(c => JSON.stringify({ id: c.id, kind: c.kind, when: c.when, source: c.source, quote: c.quote, thought: c.thought })).join('\n')}\n</captures>`;
    const out = await loop(run, { system: INBOX_SYSTEM(run.langName), user, toolNames: ['list_dir', 'read_file', 'submit_plan'], submit: INBOX_SUBMIT, maxTurns: 6 + caps.length * 4 });
    const items = [];
    for (const it of Array.isArray(out.items) ? out.items : []) {
      const cap = caps.find(c => c.id === String(it.id));
      if (!cap || items.some(x => x.id === cap.id)) continue;
      let t; try { t = writeTarget(it.target); } catch { continue; }
      if (low(t.rel).startsWith(low(BRAIN + '/')) || low(t.rel) === low(INBOX)) continue;
      const has = await exists(t.abs);
      const body = String(it.text || '').trim();
      if (!body) continue;
      items.push({ id: cap.id, fingerprint: cap.fingerprint, occurrence: cap.occurrence, copyCount: cap.copyCount,
        kind: cap.kind, quote: cap.quote.slice(0, 160), target: t.rel, mode: has ? 'append' : 'new', text: body, shown: String(it.shown || '') });
    }
    return { job: 'inbox', items, edits: brain ? await checkEdits(out.edits,versions) : [], summary: String(out.summary || ''), total: caps.length };
  }

  function selectedCaptures(run, plan) {
    const accept = acceptSet(run.body.accept, plan.items);
    return plan.items.filter((_, i) => accept.has(i));
  }
  function captureLine(rows, it) {
    const row = rows.find(r => r.fingerprint === it.fingerprint && r.occurrence === it.occurrence && r.copyCount === it.copyCount);
    if (!row || row.filed) throw new Error('Capture changed or was already filed. Refresh the inbox.');
    return row.line;
  }
  function markCapture(lines, line, it) {
    const link = it.target.replace(/\.md$/i, '');
    const alias = it.shown ? '|' + it.shown.replace(/[|\]]/g, ' ') : '';
    const cr = lines[line].endsWith('\r') ? '\r' : '';
    lines[line] = lines[line].replace('- [ ] ', '- [x] ').trimEnd() + ` → [[${link}${alias}]] (${today()})` + cr;
  }
  const appendCapture = (cur, text) => (cur == null ? '' : cur.trimEnd() + '\n\n') + text.trimEnd() + '\n';
  const optionalNote = abs => fsp.readFile(abs,'utf8').catch(e => { if (e.code === 'ENOENT') return null; throw e; });

  async function inboxApply(run, plan) {
    if (plan.vault !== VAULT() || plan.owner !== (run.fw || run.provider)) throw new HttpError(409, 'Vault or executor changed. Refresh the inbox.');
    if (run.fw) return inboxApplyFw(run, plan);
    const selected = selectedCaptures(run, plan), done = [], failed = [];
    const inbox = await realInVault(inVault(INBOX));
    for (const it of selected) {
      try {
        const target = await realInVault(writeTarget(it.target).abs);
        await withFileLock(inbox, async () => {
          const original = await fsp.readFile(inbox, 'utf8');
          const line = captureLine(parseInbox(original, true), it);
          const lines = original.split('\n');
          markCapture(lines, line, it);
          await withFileLock(target, async () => {
            const previous = await optionalNote(target);
            const next = appendCapture(previous, it.text);
            run.progress({ step: 'write', path: it.target });
            if (previous == null) { await fsp.mkdir(path.dirname(target), {recursive:true}); await fsp.writeFile(target,next,{flag:'wx'}); }
            else await atomicWrite(target, next);
            try {
              await atomicWrite(inbox, lines.join('\n'), {beforeReplace: async () => {
                if (await fsp.readFile(inbox,'utf8') !== original) throw new Error('Inbox changed during filing. Refresh the inbox.');
              }});
            } catch (err) {
              if (await optionalNote(target) === next) {
                if (previous == null) await fsp.unlink(target);
                else await atomicWrite(target,previous);
              }
              throw err;
            }
          });
        });
        done.push(it);
      } catch (e) { failed.push({ id: it.id, target: it.target, error: e.message }); }
    }
    const edited = [];
    const ae = acceptSet(run.body.acceptEdits, plan.edits || []);
    for (const [i, e] of (plan.edits || []).entries()) {
      if (!ae.has(i)) continue;
      if (done.length < selected.length) { failed.push({target:e.path,error:'Refresh the inbox before updating this study record.'}); continue; }
      try { await writeEdit(e); edited.push(e.path); } catch (er) { failed.push({ target: e.path, error: er.message }); }
    }
    return { job: 'inbox', done: done.map(d => ({ id: d.id, target: d.target, shown: d.shown, mode: d.mode })), failed, edited, summary: plan.summary };
  }

  // With a local framework: Graphite works out the confirmed new text of every note (each target with the
  // capture added, the inbox with those captures ticked, Brain edits); the framework writes them in its stage.
  async function inboxApplyFw(run, plan) {
    const selected = selectedCaptures(run, plan), ae = acceptSet(run.body.acceptEdits, plan.edits || []);
    const items = [], failed = [], ops = [];
    if (selected.length) {
      const cur = await fsp.readFile(await realInVault(inVault(INBOX)), 'utf8');
      const lines = cur.split('\n'), rows = parseInbox(cur, true);
      for (const it of selected) {
        try { markCapture(lines, captureLine(rows, it), it); items.push(it); }
        catch (e) { failed.push({id:it.id,target:it.target,error:e.message}); }
      }
      if (items.length) ops.push({kind:'file',rel:INBOX,content:lines.join('\n'),base:hash(cur)});
    }
    const byTarget = new Map();
    for (const it of items) {
      const abs = await realInVault(writeTarget(it.target).abs), key = low(it.target);
      if (!byTarget.has(key)) { const cur = await optionalNote(abs); byTarget.set(key, {rel:it.target,cur,text:cur}); }
      const target = byTarget.get(key);
      target.text = appendCapture(target.text,it.text);
    }
    for (const {rel,cur,text} of byTarget.values()) ops.push({kind:'file',rel,content:text,base:cur == null ? null : hash(cur)});
    const edits = [];
    for (const [i,e] of (plan.edits || []).entries()) if (ae.has(i)) {
      if (items.length < selected.length) { failed.push({target:e.path,error:'Refresh the inbox before updating this study record.'}); continue; }
      ops.push({kind:'file',rel:e.path,content:e.content,base:e.base}); edits.push(e.path);
    }
    if (ops.length) await fwApply(run, ops);
    return { job: 'inbox', framework: run.fw, done: items.map(d => ({ id: d.id, target: d.target, shown: d.shown, mode: d.mode })), failed, edited: edits, summary: plan.summary };
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
    const versions = await studyRecordVersions();
    const out = await loop(run, { system: BRAIN_SYSTEM(run.langName), user: `Today: ${today()}\n\n<conversation>\n${hist}\n</conversation>`, toolNames: ['list_dir', 'read_file', 'submit_plan'], submit: BRAIN_SUBMIT, maxTurns: 14 });
    return { job: 'brain', edits: await checkEdits(out.edits,versions), summary: String(out.summary || '') };
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
    const retrying = body.job === 'import' && body.phase === 'retryPreview';
    const resuming = body.job === 'import' && body.phase === 'resumeImport';
    const fw = !retrying && body.framework && h.frameworks.ids.includes(body.framework) ? body.framework : null;
    const provider = retrying ? 'graphite' : fw ? null : body.provider || 'anthropic';
    const model = fw ? '' : String(body.model || '').trim() || (provider === 'anthropic' ? h.ANTHROPIC_DEFAULT : '');
    for (const [k, v] of plans) if (Date.now() - v.at > 3600e3) plans.delete(k);
    let plan = null;
    const planId = String((resuming ? body.recoveryId : body.planId) || '');
    if (body.phase === 'apply' || resuming) {
      plan = plans.get(planId);
      if (!plan || plan.job !== body.job || !!plan.resumeOnly !== resuming) throw new HttpError(410, 'This plan has expired; start again');
      const resumeWithGraphite = resuming && plan.allowGraphiteFallback && !fw && provider === 'graphite';
      if (body.job === 'import' && ((!resumeWithGraphite && plan.owner !== (fw || provider)) || plan.vault !== VAULT())) {
        throw new HttpError(409, 'The chosen executor or vault changed; scan again');
      }
      if (resuming) {
        if ('accept' in body || 'destinations' in body || 'acceptEdits' in body) throw new HttpError(400,'Resume uses only the previously confirmed files and folders');
        body.accept = plan.items.map((_,i)=>i);
        body.recordIgnore = false;
      }
    }
    const manual = retrying || (resuming && provider === 'graphite') || (body.job === 'import' && (plan ? plan.planMode === 'manual' : body.planning === 'manual'));
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
    const run = { provider, fw, key, body: { ...body, model }, model, vault:VAULT(), sb: cleanRoots(body), prof,
      langName: prof ? h.PROFILE.outputLanguage(body.job === 'brain' ? 'brain' : body.job, prof, uiName) : uiName,
      settingsBlock: prof ? h.PROFILE.promptBlock(body.job, prof, h.study.file()) : '',
      signal: ctl.signal, sourceRetry:resuming && !plan.allowGraphiteFallback, seen: new Map(), edited: [], progress: p => line({ progress: p }) };
    try {
      let result;
      if (retrying) {
        const done = [await retryPreview(run,body.retryId,body.destination)];
        result = {job:'import',planMode:'manual',done,failed:[],edited:[],ignored:0,indexError:previewNotice(done,body.lang)};
      } else if (plan) {
        if (manual) {
          run.manualItems = await manualSelection(run, plan);
        }
        if (plans.get(planId) !== plan) throw new HttpError(410, 'This plan was already used');
        plans.delete(planId);
        try {
          result = await job[1](run,manual ? {...plan,planMode:'manual'} : plan);
        } catch (e) {
          if (e.canResumeImport && fw && body.job === 'import' && !run.sourceRetry && run.vault === VAULT()) {
            const accepted = acceptSet(body.accept,plan.items);
            const items = plan.items.filter((_,i)=>accepted.has(i));
            e.recovery = rememberImport(run,items,{allowGraphiteFallback:true});
          }
          throw e;
        }
      }
      else {
        result = await job[0](run);
        if (!result.empty && ['items', 'edits', 'ignore', 'questions'].some(k => result[k] && result[k].length)) {
          const planId = crypto.randomBytes(9).toString('hex');
          plans.set(planId, { ...result, owner:fw || provider, vault:VAULT(), at: Date.now() });
          result = { ...result, planId, edits: (result.edits || []).map(({ content, base, ...e }) => e) };
          if (result.items) result.items = result.items.map(({text,...it})=>text ? {...it,preview:text.slice(0,600)} : it);
        }
      }
      if (fw) result = { ...result, framework: fw, reads: (run.reads || []).slice(0, 50) };
      line({ result });
    } catch (e) { line({ error: e.message || String(e), status: e.status || 500, ...(e.code ? { code: e.code } : {}), ...(e.framework ? { framework: e.framework, detail: e.detail || '' } : {}), ...(e.stage ? { stage: e.stage } : {}), ...(e.access ? {access:e.access} : {}), ...(e.recovery ? {recovery:e.recovery} : {}), ...(e.sourceFailures ? {failed:e.sourceFailures} : {}) }); }
    res.end();
  }
  return { handle, parseInbox, scan, copyIntoVault };
};
