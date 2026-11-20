'use strict';
// Local agent frameworks: AI jobs that need to look at files on this computer can be handed to an agent program
// installed here, which receives the task, reads the files with its own tools and returns the result. Graphite
// then checks the result and, for jobs that change files, shows it for confirmation before writing anything.
//
//   dsh    DeepSeek Harness (official), headless profile: `dsh --profile headless --permission-mode read-only
//          --approval-policy never --json -`, the task on stdin, events as JSON lines on stdout.
//   codex  OpenAI Codex CLI: `codex exec --sandbox read-only -c windows.sandbox="unelevated" --json -`,
//          the task on stdin, the last message written to a temporary file.
//
// Rules: the user picks the framework; nothing switches to another one on failure. Keys never go on the command
// line (DeepSeek Harness gets the saved DeepSeek key, if any, through DEEPSEEK_API_KEY in its environment).
// No fixed ports: everything goes through the child's stdin / stdout.
// Modes: "read" (planning: the framework's read-only sandbox, working in the vault) and "write" (only after the user
// confirmed a plan: the framework's workspace-write sandbox, working in a private stage folder that Graphite then
// checks before applying anything). While it runs, every file it opens is checked against the allowed folders;
// the first access outside them stops it. A run counts as done only if the program exits with 0 AND its own final
// event says the task completed.
const fs = require('fs');
const fsp = fs.promises;
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn, execFile } = require('child_process');

const WIN = process.platform === 'win32';
const RESULT_RE = /<graphite-result>([\s\S]*?)<\/graphite-result>/g;

function pathDirs() { return String(process.env.PATH || process.env.Path || '').split(path.delimiter).filter(Boolean); }
function exts() { return WIN ? ['.cmd', '.exe', '.bat', ''] : ['']; }
async function isFile(p) { try { return (await fsp.stat(p)).isFile(); } catch { return false; } }
async function which(name) {
  for (const d of pathDirs()) for (const e of exts()) { const p = path.join(d, name + e); if (await isFile(p)) return p; }
  return null;
}

const FRAMEWORKS = {
  dsh: {
    name: 'DeepSeek Harness',
    names: /^dsh(\.cmd|\.exe)?$/i,
    async find(custom) {
      if (custom) return (await isFile(custom)) ? custom : null; // a path the user set is used as is, or not at all
      const c = [];
      const la = process.env.LOCALAPPDATA, pf = process.env.ProgramFiles;
      if (la) c.push(path.join(la, 'Programs', 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', WIN ? 'dsh.cmd' : 'dsh'));
      if (pf) c.push(path.join(pf, 'DeepSeek Harness', 'resources', 'runtime', 'cli', 'bin', 'dsh.cmd'));
      if (process.platform === 'darwin') c.push('/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh');
      for (const p of c) if (await isFile(p)) return p;
      return which('dsh');
    },
    versionArgs: ['--version'],
    parseVersion: s => (String(s).match(/\d+\.\d+\.\d+(?:-[\w.]+)?/) || [''])[0],
    args: ({ mode, patch }) => ['--profile', 'headless', ...(patch ? ['--patch', patch] : []),
      '--permission-mode', mode === 'write' ? 'workspace-write' : 'read-only', '--approval-policy', 'never', '--json', '-'],
    env: ({ key }) => (key ? { DEEPSEEK_API_KEY: key } : {}),
    // One JSON event per line. Reads show as progress; the final text carries the result.
    onLine(line, st) {
      let ev; try { ev = JSON.parse(line); } catch { return null; }
      if (ev.type === 'tool_call') {
        const inp = ev.input || {}, paths = [inp.file_path, inp.path].filter(Boolean).map(String);
        const cmd = ev.tool === 'pwsh' || ev.tool === 'bash' ? String(inp.command || '') : '';
        const step = ev.tool === 'read' || ev.tool === 'read_image' ? 'read' : ev.tool === 'glob' || ev.tool === 'grep' ? 'list' : ev.tool === 'write' || ev.tool === 'edit' ? 'write' : 'tool';
        return { step, tool: ev.tool, path: paths[0] || cmd.slice(0, 160) || String(inp.pattern || ''), paths, command: cmd };
      }
      if (ev.type === 'text' && ev.text) st.text += ev.text + '\n';
      if (ev.type === 'final') {
        st.final = String(ev.text || ''); st.completed = !ev.reason || ev.reason.kind === 'completed';
        if (!st.completed) { const er = ev.reason.error || {}; st.failure = er.message || ev.reason.message || ev.reason.kind; st.failCode = er.code || ''; }
      }
      if (ev.type === 'error') st.failure = ev.message || ev.error?.message || ev.error || 'error';
      return null;
    },
  },
  codex: {
    name: 'Codex CLI',
    names: /^codex(\.cmd|\.exe)?$/i,
    async find(custom) {
      if (custom) return (await isFile(custom)) ? custom : null;
      const ap = process.env.APPDATA;
      if (ap && await isFile(path.join(ap, 'npm', 'codex.cmd'))) return path.join(ap, 'npm', 'codex.cmd');
      return which('codex');
    },
    versionArgs: ['--version'],
    parseVersion: s => (String(s).match(/\d+\.\d+\.\d+(?:-[\w.]+)?/) || [''])[0],
    args: ({ outFile, mode, answerArgs = [] }) => ['exec', ...(WIN ? ['-c', 'windows.sandbox="unelevated"'] : []),
      ...(mode === 'answer' ? ['--ignore-rules',
        ...['shell_tool', 'unified_exec', 'hooks', 'shell_snapshot', 'apps', 'plugins', 'multi_agent', 'multi_agent_v2',
          'code_mode', 'view_image', 'image_generation', 'memories', 'goals'].flatMap(name => ['--disable', name]),
        '-c', 'tools.experimental_request_user_input.enabled=false', '-c', 'tools.update_plan.enabled=false',
        '-c', 'mcp_servers={}', '-c', 'approval_policy="never"', '-c', 'project_doc_max_bytes=0', '-c', 'skills.include_instructions=false',
        '-c', 'skills.bundled.enabled=false', '-c', 'web_search="disabled"'] : []),
      ...answerArgs, '--sandbox', mode === 'write' ? 'workspace-write' : 'read-only', '--skip-git-repo-check', '--ephemeral', '--color', 'never', '--json', '--output-last-message', outFile, '-'],
    env: () => ({}),
    onLine(line, st) {
      let ev; try { ev = JSON.parse(line); } catch { return null; }
      const it = ev.item || {};
      if (ev.type === 'item.started' && it.type === 'command_execution') return { step: 'tool', tool: 'command', path: String(it.command || '').slice(0, 160), command: String(it.command || '') };
      if (ev.type === 'item.started' && (it.type === 'file_change' || it.type === 'patch')) return { step: 'write', tool: 'patch', path: (it.changes || []).map(c => c.path).join(', '), paths: (it.changes || []).map(c => String(c.path)) };
      if (ev.type === 'item.completed' && it.type === 'agent_message' && it.text) st.text += it.text + '\n';
      if (ev.type === 'turn.completed') st.completed = true;
      if (ev.type === 'turn.failed' || ev.type === 'error') { st.failure = ev.error?.message || ev.message || 'error'; st.completed = false; }
      return null;
    },
  },
};

// Run a program. A .cmd/.bat (npm and installer shims) goes through cmd.exe with every argument quoted; the
// arguments are Graphite's own constants and temporary paths, never text from the task.
function launch(file, args, opts) {
  if (WIN && /\.(cmd|bat)$/i.test(file)) {
    const q = a => (/[\s"&|<>^()%!]/.test(a) || a === '' ? '"' + String(a).replace(/"/g, '""') + '"' : a);
    return spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', `"${[file, ...args].map(q).join(' ')}"`], { ...opts, windowsVerbatimArguments: true, windowsHide: true });
  }
  return spawn(file, args, { ...opts, windowsHide: true });
}
function inside(abs, dir) { const a = path.resolve(abs).toLowerCase(), d = path.resolve(dir).toLowerCase(); return a === d || a.startsWith(d.endsWith(path.sep) ? d : d + path.sep); }
// Absolute paths mentioned in a shell command (C:\…, D:/…, \\server\share\…).
function absPaths(cmd) { return String(cmd || '').match(/(?:[A-Za-z]:[\\/]|\\\\)[^"'`|;&<>\r\n]*?(?=["'`|;&<>\r\n]|\s+-|\s*$)/g) || []; }
function killTree(child) {
  if (!child || child.exitCode != null) return;
  if (WIN) execFile('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else { try { process.kill(-child.pid, 'SIGTERM'); } catch { try { child.kill('SIGTERM'); } catch { /* gone */ } } }
}

module.exports = function createFrameworks({ HttpError }) {
  const cache = new Map(); // id|custom → { at, info }
  async function detectOne(id, custom, force) {
    const F = FRAMEWORKS[id];
    const k = id + '|' + (custom || '');
    const hit = cache.get(k);
    if (!force && hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.info;
    let info;
    if (custom && !F.names.test(path.basename(custom))) {
      info = { id, name: F.name, found: false, reason: 'badName', custom };
      cache.set(k, { at: Date.now(), info });
      return info;
    }
    const file = await F.find(custom || '').catch(() => null);
    if (!file) info = { id, name: F.name, found: false, reason: custom ? 'notFoundAt' : 'notInstalled', custom: custom || '' };
    else {
      const out = await new Promise(resolve => {
        const ch = launch(file, F.versionArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
        let s = '';
        const t = setTimeout(() => { killTree(ch); resolve({ err: 'timeout' }); }, 45000);
        ch.stdout.on('data', d => { s += d; }); ch.stderr.on('data', d => { s += d; });
        ch.on('error', e => { clearTimeout(t); resolve({ err: e.message }); });
        ch.on('close', code => { clearTimeout(t); resolve(code === 0 ? { s } : { err: s.trim().split('\n').pop() || 'exit ' + code }); });
      });
      info = out.err ? { id, name: F.name, found: false, path: file, reason: 'notRunnable', detail: out.err.slice(0, 300) }
        : { id, name: F.name, found: true, path: file, version: F.parseVersion(out.s) || out.s.trim().slice(0, 40) };
    }
    cache.set(k, { at: Date.now(), info });
    return info;
  }
  async function detect({ paths = {}, force = false } = {}) {
    const ids = Object.keys(FRAMEWORKS);
    const list = await Promise.all(ids.map(id => detectOne(id, paths[id], force)));
    return Object.fromEntries(list.map(i => [i.id, i]));
  }

  // Run one task. Resolves with { text, result, reads } or throws an HttpError with a code the app shows in words.
  async function run(id, { prompt, cwd, key, paths = {}, signal, onProgress, timeoutMs = 15 * 60 * 1000, mode = 'read', allow = null, useNativeCodexInstructions = false }) {
    const F = FRAMEWORKS[id];
    if (!F) throw Object.assign(new HttpError(400, 'Unknown local framework'), { code: 'unknown' });
    const info = await detectOne(id, paths[id], false);
    if (!info.found) throw Object.assign(new HttpError(424, `${F.name}: ${info.reason}${info.detail ? ' — ' + info.detail : ''}`), { code: info.reason, framework: id });
    const outFile = path.join(os.tmpdir(), `graphite-${id}-${crypto.randomBytes(6).toString('hex')}.txt`);
    let patch;
    if (mode === 'answer' && id === 'dsh') {
      // The CLI is an external process and cannot import a plugin from Electron's app.asar.
      // Put the shipped tool-free executor beside the empty workspace, for the lifetime of this question.
      const dir = path.dirname(cwd);
      const executor = path.join(dir, 'dsh-answer.mjs');
      await fsp.copyFile(path.join(__dirname, 'extensions/code-assistant/dsh-answer.mjs'), executor);
      patch = path.join(dir, 'code-answer.yml');
      const overlay = [
        { id: 'tool-executor-native', disabled: true },
        { id: 'tool-executor-ptc', disabled: true },
        { insert: [{ id: 'graphite-code-answer', name: executor.replace(/\\/g, '/') }] },
        ...['agent-instructions', 'skill-filesystem', 'tool-skill', 'session-persistence-jsonl'].map(id => ({ id, disabled: true })),
      ];
      await fsp.writeFile(patch, JSON.stringify(overlay));
    }
    const answer = mode === 'answer' && id === 'codex'
      ? await require('./extensions/code-assistant/codex-answer.cjs')({launch,file:info.path,cwd,signal,killTree,HttpError,useNativeCodexInstructions}) : {};
    if (signal?.aborted) throw Object.assign(new HttpError(499, 'Stopped'), { code: 'stopped', framework: id });
    const child = launch(info.path, F.args({ outFile, mode, patch, answerArgs:answer.args }), { cwd, env: { ...process.env, ...F.env({ key }), ...answer.env }, stdio: ['pipe', 'pipe', 'pipe'] });
    const st = { text: '', final: '', failure: '', reads: [], completed: null };
    let err = '', buf = '', timedOut = false, aborted = false, outside = '', operation = '';
    // Every path the framework touches must be inside the allowed folders (and not in a left-out folder).
    const check = p => {
      if (!allow || outside) return;
      const list = [...(p.paths || []), ...absPaths(p.command || '')];
      for (const raw of list) {
        const abs = path.resolve(cwd, String(raw).replace(/^["']|["']$/g, ''));
        const leftOut = (allow.skip || []).some(n => abs.split(/[\\/]/).some(seg => seg.toLowerCase() === String(n).toLowerCase()));
        // Programs it runs (python.exe, powershell) and its own temp files are not the user's data.
        const tool = /\.(exe|com|cmd|bat)$/i.test(abs) || (process.env.SystemRoot && inside(abs, process.env.SystemRoot)) || inside(abs, os.tmpdir());
        const ok = !leftOut && (tool || allow.roots.some(r => inside(abs, r)));
        if (!ok) { outside = abs; operation = p.command ? 'commandPath' : p.step; killTree(child); return; }
      }
    };
    const stop = () => { aborted = true; killTree(child); };
    signal?.addEventListener('abort', stop, { once: true });
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    onProgress?.({ step: 'framework', framework: id, name: F.name, version: info.version });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line) continue;
        const p = F.onLine(line, st);
        if (p) { check(p); if (p.step === 'read' && p.path) st.reads.push(...(p.paths && p.paths.length ? p.paths : [p.path])); const { command, paths: _ps, ...shown } = p; onProgress?.({ ...shown, framework: id }); }
      }
    });
    child.stderr.on('data', d => { err = (err + d).slice(-4000); });
    child.stdin.on('error', () => {});
    child.stdin.end(prompt);
    const code = await new Promise(resolve => { child.on('error', e => { err += e.message; resolve(-1); }); child.on('close', resolve); });
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    if (buf.trim()) { const lastEvent = F.onLine(buf.trim(),st); if (lastEvent) check(lastEvent); }
    let last = '';
    try { last = await fsp.readFile(outFile, 'utf8'); } catch { /* not written */ }
    fsp.unlink(outFile).catch(() => {});
    if (outside) throw Object.assign(new HttpError(403, `${F.name}: ${outside}`), { code: 'outside', framework: id, detail: outside,
      access: {source:'graphite',operation,path:outside,driveRoot:path.parse(outside).root === outside} });
    if (aborted) throw Object.assign(new HttpError(499, 'Stopped'), { code: 'stopped', framework: id });
    if (timedOut) throw Object.assign(new HttpError(504, `${F.name}: timeout`), { code: 'timeout', framework: id });
    const text = last || st.final || st.text;
    const tail = (st.failure || err).trim().split('\n').slice(-3).join(' ').slice(0, 400);
    // Done only when the program exited with 0 and its own final event says the task completed. A failure is a
    // failure even if some JSON was printed before it.
    if (code !== 0 || st.failure || st.completed === false) {
      if (/\bEACCES\b|\bEPERM\b|\bpermission denied\b|\baccess (?:is )?denied\b|未经授权的访问|拒绝访问/i.test(tail) &&
          !/\b(?:HTTP|API|OAuth|401|403|token|API key)\b/i.test(tail)) {
        throw Object.assign(new HttpError(403,`${F.name}: ${tail}`),{code:'agentPermission',framework:id,detail:tail,
          access:{source:'agent',operation:'fileAccess'}});
      }
      const auth = /\b(401|403)\b|api[ _-]?key|unauthori[sz]ed|authentication|not logged in|login|credential/i.test(tail + ' ' + (st.failCode || ''));
      throw Object.assign(new HttpError(502, `${F.name}: ${tail || 'exit ' + code}`), { code: auth ? 'auth' : 'failed', framework: id, detail: (tail || 'exit ' + code) + (code !== 0 ? ` (exit ${code})` : '') });
    }
    return { text, reads: st.reads, result: parseResult(text) };
  }
  return { detect, run, parseResult, FRAMEWORKS, ids: Object.keys(FRAMEWORKS) };
};

// The last <graphite-result>{…}</graphite-result> block, or the last JSON object in the text.
function parseResult(text) {
  let m, last = null;
  RESULT_RE.lastIndex = 0;
  while ((m = RESULT_RE.exec(String(text || '')))) last = m[1];
  const src = (last ?? String(text || '')).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
  try { return JSON.parse(src); } catch { /* look for the outermost object */ }
  const a = src.indexOf('{'), z = src.lastIndexOf('}');
  if (a >= 0 && z > a) { try { return JSON.parse(src.slice(a, z + 1)); } catch { /* not JSON */ } }
  return null;
}
module.exports.parseResult = parseResult;
