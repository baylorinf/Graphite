// The code workbench in a real browser, with a simulated desktop app (window.myobsidianDesktop): a fake project
// folder in memory and a fake compiler/debugger that send the same events as the real ones. Checks the project
// choice, the folder tree, several files with unsaved text kept, conflicts, run with input, diagnostics, breakpoints,
// stepping and variables, missing tools, narrow windows and Chinese labels.
require('./isolate.cjs');
//   node test/code-workbench-ui.cjs [filter]
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const repo = path.join(__dirname, '..');
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Runs in the page before Graphite: the simulated desktop API.
function fakeDesktop(opts) {
  const P = 'fake:';
  const load = (k, d) => { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } };
  const save = (k, v) => localStorage.setItem(P + k, JSON.stringify(v));
  const ext = { id: 'ext-1', name: 'proj', root: 'C:/fake/proj' };
  if (!load('files', null)) save('files', { 'ext-1': { 'main.cpp': '#include <iostream>\nint main() {\n  int x = 42;\n  std::cout << x;\n  return 0;\n}\n', 'util.cpp': 'int util() { return 1; }\n', 'inc/util.h': 'int util();\n', 'notes.txt': 'not code' } });
  const calls = window.__calls = [];
  const listeners = new Set();
  const emit = ev => setTimeout(() => listeners.forEach(cb => cb(ev)), 0);
  const rev = s => 'r' + [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(16).padStart(8, '0');
  const proj = () => load('proj', null);
  const files = () => load('files', {});
  const fail = (code, message) => ({ ok: false, code, message });
  window.__fake = { set: (k, v) => save(k, v), get: k => load(k, null), emit, listeners };
  let job = null;
  window.myobsidianDesktop = {
    setLanguage() {}, onAppCommand() {}, onUpdate() {},
    async codeProject(action, args = {}) {
      calls.push(['project', action, JSON.parse(JSON.stringify(args))]);
      const p = proj();
      if (action === 'status') return { ok: true, project: p ? { ...p, available: !load('unavailable', false) } : null };
      if (action === 'choose') { save('proj', ext); return { ok: true, canceled: false, project: { ...ext, available: true } }; }
      if (action === 'useVault') { const v = (await (await fetch('/api/all')).json()).vault.replace(/\\/g, '/'); const vp = { id: 'vault-1', name: v.split('/').pop(), root: v }; save('proj', vp); const f = files(); f['vault-1'] ||= {}; save('files', f); return { ok: true, project: { ...vp, available: true } }; }
      if (!p || args.projectId !== p.id) return fail('project_changed', 'The selected project changed. Reopen the file.');
      if (action === 'read') { const wait = (window.__readDelay || {})[args.path]; if (wait) await new Promise(r => setTimeout(r, wait)); }
      const all = files(), mine = all[p.id] || {};
      if (action === 'findFiles') {
        const q = String(args.query || '').toLowerCase();
        const e = Object.keys(mine).filter(f => f.split('/').pop().toLowerCase().includes(q) || f.toLowerCase().includes(q)).sort().slice(0, Math.min(args.limit || 50, 100)).map(f => ({ name: f.split('/').pop(), path: f, type: 'file' }));
        return { ok: true, entries: e, total: e.length, truncated: false };
      }
      if (action === 'list') {
        const base = args.path ? args.path + '/' : '', seen = new Map();
        for (const f of Object.keys(mine)) if (f.startsWith(base)) { const rest = f.slice(base.length), [head, ...more] = rest.split('/'); seen.set(head, more.length ? 'directory' : (seen.get(head) || 'file')); }
        for (const d of load('dirs', [])) if (d.startsWith(base) && !d.slice(base.length).includes('/')) seen.set(d.slice(base.length), 'directory');
        return { ok: true, entries: [...seen].map(([name, type]) => ({ name, type, path: base + name })).sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1)) };
      }
      if (action === 'read') { if (!(args.path in mine)) return fail('not_found', 'gone'); const c = mine[args.path]; return { ok: true, path: args.path, editable: true, content: c, revision: rev(c), eol: 'LF', bom: false }; }
      if (action === 'write') {
        if (load('writeFails', null)) return fail(load('writeFails', null), 'disk full');
        if (rev(mine[args.path] || '') !== args.revision) return fail('changed', 'The file changed on disk. Reload before saving.');
        mine[args.path] = args.content; all[p.id] = mine; save('files', all); return { ok: true, path: args.path, revision: rev(args.content), eol: 'LF', bom: false };
      }
      if (action === 'create') { if (args.path in mine) return fail('exists', 'exists'); mine[args.path] = args.content || ''; all[p.id] = mine; save('files', all); return { ok: true, path: args.path, revision: rev(''), eol: 'LF', bom: false }; }
      if (action === 'mkdir') { save('dirs', [...load('dirs', []), args.path]); return { ok: true, path: args.path }; }
      return fail('invalid_action', 'x');
    },
    async codeRun(action, args = {}) {
      calls.push(['run', action, JSON.parse(JSON.stringify(args))]);
      if (action === 'tools') return { ok: true, compiler: { found: true, path: 'C:/mingw/g++.exe', version: '13.2.0' }, debugger: { found: !opts.noGdb, path: 'C:/mingw/gdb.exe', version: '14.1' } };
      if (action === 'start') {
        const id = 'job-' + calls.length, code = files()[proj().id][args.path];
        job = { id, args, line: 0 };
        emit({ id, type: 'phase', phase: 'compiling' });
        if (/BROKEN/.test(code)) { emit({ id, type: 'output', stream: 'stderr', text: proj().root + '/' + args.path + ":3:5: error: expected ';' before 'return'\n" }); emit({ id, type: 'end', status: 'compile_error', exitCode: 1, message: 'Compilation failed' }); return { ok: true, id }; }
        if (args.mode === 'build') { emit({ id, type: 'end', status: 'success', exitCode: 0 }); return { ok: true, id }; }
        if (args.mode === 'run') { emit({ id, type: 'phase', phase: 'running' }); emit({ id, type: 'output', stream: 'stdout', text: 'read ' + (args.stdin || '').trim() + '\n42' }); emit({ id, type: 'end', status: 'success', exitCode: 0 }); return { ok: true, id }; }
        emit({ id, type: 'phase', phase: 'debugging' });
        const bp = args.breakpoints[0];
        job.line = bp ? bp.line : 0;
        if (bp) emit({ id, type: 'paused', reason: 'breakpoint-hit', path: bp.path, line: bp.line, function: 'main', locals: [{ name: 'x', value: '42', type: 'int' }] });
        else emit({ id, type: 'end', status: 'success', exitCode: 0 });
        return { ok: true, id };
      }
      if (action === 'debug') {
        if (args.action === 'continue') emit({ id: job.id, type: 'end', status: 'success', exitCode: 0 });
        else { job.line++; emit({ id: job.id, type: 'paused', reason: 'end-stepping-range', path: job.args.path, line: job.line, function: 'main', locals: [{ name: 'x', value: String(41 + job.line), type: 'int' }] }); }
        return { ok: true };
      }
      if (action === 'stop') { emit({ id: job.id, type: 'end', status: 'stopped', exitCode: null }); return { ok: true }; }
      return fail('invalid_action', 'x');
    },
    onCodeRun(cb) { listeners.add(cb); return () => listeners.delete(cb); },
  };
}

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-wb-'));
  for (const [n, b] of Object.entries({ 'Welcome.md': 'Welcome', 'LA/Note.md': 'x', 'LA/Ch1/Old.md': 'y' })) { await fs.mkdir(path.dirname(path.join(vault, n)), { recursive: true }); await fs.writeFile(path.join(vault, n), b); }
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  async function page({ lang = 'en', noGdb = false, width = 1400, setup = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(({ lang }) => localStorage.setItem('mo:lang', JSON.stringify(lang)), { lang });
    await ctx.addInitScript(fakeDesktop, { noGdb });
    // Storage trouble on demand for Graphite's own keys: window.__storage = 'full' (quota error) or 'blocked'
    // (writes silently dropped, as with some privacy settings).
    await ctx.addInitScript(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (String(k).startsWith('mo:wb:') && window.__storage === 'full') throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        if (String(k).startsWith('mo:wb:') && window.__storage === 'blocked') return;
        return set.call(this, k, v);
      };
    });
    if (setup) await ctx.addInitScript(setup);
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    p.on('dialog', d => d.accept());
    const errors = []; p.on('pageerror', e => errors.push(e.message)); p.__errors = errors;
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor({ state: 'attached' });
    await p.waitForFunction(() => window.app?.commands);
    return p;
  }
  async function test(name, fn, opts) {
    if (filter && !filter.test(name)) return;
    let p;
    try { p = await page(opts); await fn(p); if (p.__errors.length) throw new Error('page errors: ' + p.__errors.join(' | ')); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { results.push({ name, pass: false }); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 8).join('\n  ')); }
    finally { await p?.context().close(); }
  }
  const run = (p, id) => p.evaluate(id => window.app.commands.executeCommandById(id), id);
  const calls = (p, kind, action) => p.evaluate(([k, a]) => window.__calls.filter(c => c[0] === k && c[1] === a).map(c => c[2]), [kind, action]);
  const wb = '#code-workbench';
  const openExternal = async p => {
    await p.evaluate(() => window.__fake.set('proj', { id: 'ext-1', name: 'proj', root: 'C:/fake/proj' }));
    await run(p, 'code-workbench');
    await p.locator(`${wb} [data-node="main.cpp"]`).waitFor();
  };

  await test('new code file: any folder of this vault; opens in the workbench with the vault as project', async p => {
    await run(p, 'new-code-file');
    const options = await p.locator('.wb-new-dialog [data-f=folder] option').allTextContents();
    assert.ok(options.includes('Vault root') && options.includes('LA') && options.includes('LA/Ch1'), options.join('|'));
    await p.locator('.wb-new-dialog [data-f=folder]').selectOption('LA/Ch1');
    await p.locator('.wb-new-dialog [data-f=name]').fill('solve.cpp');
    assert.match(await p.locator('.wb-new-dialog .wb-target').innerText(), /LA\/Ch1\/solve\.cpp/);
    await p.locator('.wb-new-dialog [data-a=create]').click();
    await p.locator(`${wb} .wb-tab.is-active`).waitFor();
    assert.equal(await p.locator(`${wb} .wb-file`).innerText(), 'LA/Ch1/solve.cpp');
    assert.match(await p.locator(`${wb} .wb-proj-name`).innerText(), /This vault/);
    assert.deepEqual((await calls(p, 'project', 'create')).map(c => c.path), ['LA/Ch1/solve.cpp']);
    assert.equal(await p.locator('#tabbar .tab.active .tab-title').innerText(), 'Code');
  });

  await test('new code file: a project folder chosen with the system picker, in a subfolder; can switch back to the vault', async p => {
    await run(p, 'new-code-file');
    await p.locator('.wb-new-dialog [data-a=pick]').click();
    await p.locator('.wb-new-dialog input[value=project]:checked').waitFor();
    assert.match(await p.locator('.wb-new-dialog .wb-ext-name').innerText(), /C:\/fake\/proj/);
    await p.locator('.wb-new-dialog [data-f=sub]').fill('src');
    await p.locator('.wb-new-dialog [data-f=name]').fill('app.cpp');
    await p.locator('.wb-new-dialog [data-a=create]').click();
    await p.locator(`${wb} .wb-tab.is-active`).waitFor();
    assert.equal(await p.locator(`${wb} .wb-file`).innerText(), 'src/app.cpp');
    assert.equal(await p.locator(`${wb} .wb-proj-root`).innerText(), 'C:/fake/proj');
    await p.locator(`${wb} [data-wb=vault]`).click();
    await p.waitForFunction(() => /This vault/.test(document.querySelector('#code-workbench .wb-proj-name').textContent));
  });

  await test('tree and files: real folders, several files, unsaved text kept across closing Graphite; the project is found again', async p => {
    await openExternal(p);
    assert.deepEqual(await p.locator(`${wb} .wb-node`).evaluateAll(n => n.map(x => x.dataset.node)), ['inc', 'main.cpp', 'notes.txt', 'util.cpp']);
    await p.locator(`${wb} [data-node="inc"]`).click();
    await p.locator(`${wb} [data-node="inc/util.h"]`).waitFor();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} [data-node="util.cpp"]`).click();
    assert.equal(await p.locator(`${wb} .wb-tab`).count(), 2);
    await p.locator(`${wb} .CodeMirror`).click(); await p.keyboard.press('Control+End'); await p.keyboard.type('// edited util');
    await p.locator(`${wb} .wb-tab.is-dirty`).waitFor();
    assert.match(await p.locator(`${wb} .wb-status`).innerText(), /Unsaved changes · Ln \d+, Col \d+/);
    await sleep(400); // the draft is kept
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    await run(p, 'code-workbench');
    await p.locator(`${wb} .wb-tab.is-dirty`).waitFor();
    assert.equal(await p.locator(`${wb} .wb-tab`).count(), 2);
    assert.equal(await p.locator(`${wb} .wb-proj-root`).innerText(), 'C:/fake/proj');
    assert.match(await p.evaluate(() => document.querySelector('#code-workbench .CodeMirror').CodeMirror.getValue()), /edited util/);
    await p.keyboard.press('Control+s').catch(() => {});
    await p.locator(`${wb} [data-wb=save]`).click();
    await p.waitForFunction(() => !document.querySelector('#code-workbench .wb-tab.is-dirty'));
    assert.match(JSON.stringify(await calls(p, 'project', 'write')), /edited util/);
  });

  await test('a file changed on disk: your text is kept with a clear choice; "keep mine" saves over it', async p => {
    await openExternal(p);
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} .CodeMirror`).click(); await p.keyboard.type('// mine ');
    await p.evaluate(() => { const f = window.__fake.get('files'); f['ext-1']['main.cpp'] = '// someone else\n'; window.__fake.set('files', f); });
    await p.locator(`${wb} [data-wb=save]`).click();
    await p.locator(`${wb} .wb-problem [data-wb=keep-mine]`).waitFor();
    assert.match(await p.evaluate(() => document.querySelector('#code-workbench .CodeMirror').CodeMirror.getValue()), /\/\/ mine/);
    await p.locator(`${wb} [data-wb=keep-mine]`).click();
    await p.waitForFunction(() => /\/\/ mine/.test(JSON.parse(localStorage.getItem('fake:files'))['ext-1']['main.cpp']));
  });

  await test('an unreachable project says so with its path', async p => {
    await p.evaluate(() => { window.__fake.set('proj', { id: 'ext-1', name: 'proj', root: 'C:/fake/proj' }); window.__fake.set('unavailable', true); });
    await run(p, 'code-workbench');
    await p.locator(`${wb} .wb-unavailable:not([hidden])`).waitFor();
    assert.match(await p.locator(`${wb} .wb-unavailable`).innerText(), /C:\/fake\/proj.*can’t be reached/);
  });

  await test('run current file: unsaved files are saved first, only the open file is compiled (not util.cpp next to it), input goes to the program', async p => {
    await openExternal(p);
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} .CodeMirror`).click(); await p.keyboard.type(' ');
    await p.locator(`${wb} [data-panel=input]`).click();
    await p.locator('#wb-stdin').fill('5 7');
    await p.locator(`${wb} [data-wb=run]`).click();
    await p.waitForFunction(() => /Finished \(exit code 0\)/.test(document.querySelector('#code-workbench .wb-run-state').textContent));
    const order = await p.evaluate(() => window.__calls.filter(c => c[1] === 'write' || c[1] === 'start').map(c => c[1]));
    assert.deepEqual(order, ['write', 'start'], 'saved before compiling');
    const start = (await calls(p, 'run', 'start'))[0];
    assert.equal(start.mode, 'run'); assert.equal(start.stdin, '5 7'); assert.deepEqual(start.sources, []); assert.deepEqual(start.breakpoints, []);
    assert.match(await p.locator(`${wb} .wb-output`).innerText(), /read 5 7\n42/);
  });

  await test('a save that fails stops the run before compiling', async p => {
    await openExternal(p);
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} .CodeMirror`).click(); await p.keyboard.type(' ');
    await p.evaluate(() => window.__fake.set('writeFails', 'readonly'));
    await p.locator(`${wb} [data-wb=run]`).click();
    await p.locator(`${wb} .wb-problem:not([hidden])`).waitFor();
    assert.equal((await calls(p, 'run', 'start')).length, 0);
  });

  await test('compile errors: listed under Problems with file and line; clicking goes to the line, which is marked', async p => {
    await p.evaluate(() => { const f = JSON.parse(localStorage.getItem('fake:files') || 'null'); if (f) { f['ext-1']['main.cpp'] = 'int main() {\n  int x = 1\n  BROKEN return 0;\n}\n'; localStorage.setItem('fake:files', JSON.stringify(f)); } });
    await openExternal(p);
    await p.evaluate(() => { const f = window.__fake.get('files'); f['ext-1']['main.cpp'] = 'int main() {\n  int x = 1\n  BROKEN return 0;\n}\n'; window.__fake.set('files', f); });
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} [data-wb=build]`).click();
    await p.locator(`${wb} .wb-diag.is-error`).waitFor();
    assert.match(await p.locator(`${wb} .wb-diag`).innerText(), /main\.cpp:3:5 expected ';'/);
    assert.match(await p.locator(`${wb} .wb-run-state`).innerText(), /Didn’t compile/);
    await p.locator(`${wb} .wb-diag`).click();
    assert.equal(await p.evaluate(() => document.querySelector('#code-workbench .CodeMirror').CodeMirror.getCursor().line), 2);
    assert.equal(await p.locator(`${wb} .wb-error-line`).count(), 1);
  });

  await test('debug: a breakpoint set in the gutter, paused there with variables, step over, continue to the end', async p => {
    await openExternal(p);
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} .CodeMirror`).waitFor();
    await p.evaluate(() => { const cm = document.querySelector('#code-workbench .CodeMirror').CodeMirror; CodeMirror.signal(cm, 'gutterClick', cm, 3, 'wb-bp-gutter', {}); });
    await p.locator(`${wb} .wb-bp`).waitFor();
    await p.locator(`${wb} [data-wb=debug]`).click();
    await p.locator(`${wb} .wb-locals`).waitFor();
    const start = (await calls(p, 'run', 'start'))[0];
    assert.deepEqual(start.breakpoints, [{ path: 'main.cpp', line: 4 }]);
    assert.match(await p.locator(`${wb} .wb-paused-at`).innerText(), /main\.cpp:4 · main/);
    assert.match(await p.locator(`${wb} .wb-locals`).innerText(), /x\s+42\s+int/);
    assert.equal(await p.locator(`${wb} .wb-paused-line`).count(), 1);
    if (process.env.WB_SHOT) await p.screenshot({ path: process.env.WB_SHOT }); // optional picture of the paused debugger
    await p.locator(`${wb} [data-wb=next]`).click();
    await p.waitForFunction(() => /main\.cpp:5/.test(document.querySelector('#code-workbench .wb-paused-at')?.textContent || ''));
    assert.deepEqual((await calls(p, 'run', 'debug')).map(c => c.action), ['next']);
    await p.locator(`${wb} [data-wb=continue]`).click();
    await p.waitForFunction(() => /Finished/.test(document.querySelector('#code-workbench .wb-run-state').textContent));
    assert.equal(await p.locator(`${wb} .wb-paused-line`).count(), 0);
  });

  await test('missing GDB: shown, and Debug is off while Run still works', async p => {
    await openExternal(p);
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} .wb-tool.is-bad`).waitFor();
    await p.locator(`${wb} .wb-tab.is-active`).waitFor();
    await p.waitForFunction(() => !document.querySelector('#code-workbench [data-wb=run]').disabled);
    assert.match(await p.locator(`${wb} .wb-tools`).innerText(), /g\+\+ 13\.2\.0[\s\S]*GDB not found/);
    assert.equal(await p.locator(`${wb} [data-wb=debug]`).isDisabled(), true);
    assert.equal(await p.locator(`${wb} [data-wb=run]`).isDisabled(), false);
  }, { noGdb: true });

  await test('narrow window, Chinese: the tree is a drawer, labels are translated, the panel folds', async p => {
    await p.evaluate(() => window.__fake.set('proj', { id: 'ext-1', name: 'proj', root: 'C:/fake/proj' }));
    await run(p, 'code-workbench');
    await p.locator(`${wb} [data-node="main.cpp"]`).waitFor({ state: 'attached' });
    assert.equal(await p.locator(`${wb} .wb-tree`).isVisible(), false, 'the tree is folded away on a narrow pane');
    assert.equal(await p.locator(`${wb} [data-wb=run]`).innerText(), '▶ 运行当前文件');
    assert.equal(await p.locator(`${wb} [data-panel=input]`).innerText(), '输入');
    await p.locator(`${wb} [data-wb=toggle-tree]`).click();
    assert.equal(await p.locator(`${wb} .wb-tree`).isVisible(), true);
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} .CodeMirror`).waitFor();
    assert.equal(await p.locator(`${wb} .wb-tree`).isVisible(), false, 'picking a file closes the drawer');
    await p.locator(`${wb} [data-wb=panel]`).click();
    assert.equal(await p.locator(`${wb} .wb-panel-body`).isVisible(), false);
    const overflow = await p.evaluate(() => Math.max(...[...document.querySelectorAll('#code-workbench > *')].map(e => e.getBoundingClientRect().right)) - document.querySelector('#code-workbench').getBoundingClientRect().right);
    assert.ok(overflow <= 1, 'no sideways scrolling: ' + overflow);
  }, { lang: 'zh-CN', width: 600 });

  const typeIn = async (p, text) => { await p.locator(`${wb} .CodeMirror`).click(); await p.keyboard.press('Control+End'); await p.keyboard.type(text); };
  const cmText = p => p.evaluate(() => document.querySelector('#code-workbench .CodeMirror').CodeMirror.getValue());

  await test('storage full: the warning with Retry shows, closing is held back (projectUnsaved + message), switching is refused; after Retry all is kept', async p => {
    await openExternal(p);
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} .CodeMirror`).waitFor();
    await p.evaluate(() => { window.__storage = 'full'; });
    await typeIn(p, '// typed while storage is full');
    await p.locator(`${wb} .wb-persist:not([hidden]) [data-wb=retry-persist]`).waitFor();
    const flushed = await p.evaluate(() => window.__moFlush());
    assert.equal(flushed.ok, false); assert.equal(flushed.projectUnsaved, true);
    assert.match(flushed.projectMessage, /couldn’t be kept/); assert.deepEqual(flushed.unsaved, []);
    await p.locator(`${wb} [data-wb=vault]`).click();
    await sleep(200);
    assert.equal((await calls(p, 'project', 'useVault')).length, 0, 'the desktop app was not asked to switch');
    assert.match(await cmText(p), /typed while storage is full/);
    assert.equal(await p.locator(`${wb} .wb-proj-root`).innerText(), 'C:/fake/proj');
    await p.locator(`${wb} [data-wb=retry-persist]`).click();                // still full: stays
    assert.equal(await p.locator(`${wb} .wb-persist`).isVisible(), true);
    await p.evaluate(() => { window.__storage = null; });
    await p.locator(`${wb} [data-wb=retry-persist]`).click();
    await p.locator(`${wb} .wb-persist`).waitFor({ state: 'hidden' });
    const ok = await p.evaluate(() => window.__moFlush());
    assert.equal(ok.projectUnsaved, undefined); assert.equal(ok.hasProjectDrafts, true);
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    await run(p, 'code-workbench');
    await p.locator(`${wb} .wb-tab.is-dirty`).waitFor();
    assert.match(await cmText(p), /typed while storage is full/);
  });

  await test('Chinese: the close-window message comes in the window\'s language', async p => {
    await openExternal(p);
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} .CodeMirror`).waitFor();
    await p.evaluate(() => { window.__storage = 'full'; });
    await typeIn(p, '// 输入');
    const flushed = await p.evaluate(() => window.__moFlush());
    assert.equal(flushed.projectUnsaved, true);
    assert.match(flushed.projectMessage, /没能留存/);
  }, { lang: 'zh-CN' });

  await test('storage silently blocked, project changed elsewhere: the switch waits with the text open; Retry after storage recovers finishes it', async p => {
    await openExternal(p);
    await p.locator(`${wb} [data-node="util.cpp"]`).click();
    await p.locator(`${wb} .CodeMirror`).waitFor();
    await p.evaluate(() => { window.__storage = 'blocked'; });
    await typeIn(p, '// blocked storage');
    await p.locator(`${wb} .wb-persist:not([hidden])`).waitFor();
    // The desktop app now reports another project (chosen in another window, say); refreshing must not drop the text.
    await p.evaluate(async () => { const r = await fetch('/api/all').then(r => r.json()); const v = r.vault.replace(/\\/g, '/'); window.__fake.set('proj', { id: 'vault-1', name: v.split('/').pop(), root: v }); const f = window.__fake.get('files'); f['vault-1'] = {}; window.__fake.set('files', f); });
    await p.locator(`${wb} [data-wb=refresh]`).click();
    await sleep(200);
    assert.match(await p.locator(`${wb} .wb-persist`).innerText(), /was not switched/);
    assert.match(await cmText(p), /blocked storage/);
    assert.equal(await p.locator(`${wb} .wb-proj-root`).innerText(), 'C:/fake/proj');
    const held = await p.evaluate(() => window.__moFlush());
    assert.equal(held.projectUnsaved, true);
    await p.evaluate(() => { window.__storage = null; });
    await p.locator(`${wb} [data-wb=retry-persist]`).click();
    await p.waitForFunction(() => /This vault/.test(document.querySelector('#code-workbench .wb-proj-name').textContent));
    assert.equal(await p.locator(`${wb} .wb-persist`).isVisible(), false);
    const kept = await p.evaluate(() => JSON.parse(localStorage.getItem('mo:wb:draft:ext-1:util.cpp') || 'null'));
    assert.match(kept?.text || '', /blocked storage/, 'the old project\'s text is in its draft');
  });

  await test('a draft whose file changed on disk is never written over it silently: Save and Compile are refused until you choose', async p => {
    await openExternal(p);
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await typeIn(p, '// my draft');
    await sleep(400);
    await p.evaluate(() => { const f = window.__fake.get('files'); f['ext-1']['main.cpp'] = '// changed by another program\n'; window.__fake.set('files', f); });
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    await run(p, 'code-workbench');
    await p.locator(`${wb} .wb-tab.is-conflict`).waitFor();
    await p.keyboard.press('Control+s');                                      // Save itself is greyed out
    await p.locator(`${wb} [data-wb=build]`).click();
    await sleep(300);
    await p.locator(`${wb} .wb-problem [data-wb=keep-mine]`).waitFor();       // the choice is offered
    assert.equal((await calls(p, 'project', 'write')).length, 0);
    assert.equal((await calls(p, 'run', 'start')).length, 0, 'nothing compiled over a conflict');
    assert.equal(await p.evaluate(() => window.__fake.get('files')['ext-1']['main.cpp']), '// changed by another program\n');
    assert.match(await cmText(p), /my draft/);
  });

  await test('files opened at the same time: exactly one editor, the last one chosen is shown with its own text', async p => {
    await p.evaluate(() => { window.__readDelay = { 'main.cpp': 400, 'util.cpp': 50 }; });
    await openExternal(p);
    await p.evaluate(() => { const n = s => document.querySelector(`#code-workbench [data-node="${s}"]`); n('main.cpp').click(); n('util.cpp').click(); n('util.cpp').click(); });
    await sleep(800);
    assert.equal(await p.locator(`${wb} .CodeMirror`).count(), 1);
    assert.equal(await p.locator(`${wb} .wb-tab`).count(), 2);
    assert.match(await p.locator(`${wb} .wb-tab.is-active`).innerText(), /util\.cpp/);
    assert.equal(await cmText(p), 'int util() { return 1; }\n');
    assert.equal((await calls(p, 'project', 'read')).filter(c => c.path === 'util.cpp').length, 1, 'read once');
    // Reopening the project and switching quickly: still one editor, the right text.
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    await p.evaluate(() => { window.__readDelay = { 'main.cpp': 200, 'util.cpp': 200 }; });
    await run(p, 'code-workbench');
    await p.locator(`${wb} .wb-tab >> nth=1`).waitFor();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await sleep(300);
    assert.equal(await p.locator(`${wb} .CodeMirror`).count(), 1);
    assert.match(await cmText(p), /int x = 42/);
  });

  await test('storage refusing every write and removal: a clean open file still lets you choose another project; closing is fine', async p => {
    await openExternal(p);
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.locator(`${wb} .CodeMirror`).waitFor();
    await p.evaluate(() => {
      window.__storage = 'full';                       // setItem throws for the workbench's keys…
      const remove = Storage.prototype.removeItem;     // …and so does removeItem
      Storage.prototype.removeItem = function (k) { if (String(k).startsWith('mo:wb:') && window.__storage) throw new DOMException('denied', 'SecurityError'); return remove.call(this, k); };
    });
    // An old draft of this file that can't be removed now (equal to the disk, so nothing is lost).
    const flushed = await p.evaluate(() => window.__moFlush());
    assert.equal(flushed.ok, true); assert.equal(flushed.projectUnsaved, undefined);
    await p.locator(`${wb} [data-wb=choose]`).click();
    await sleep(200);
    assert.equal((await calls(p, 'project', 'choose')).length, 1, 'the folder picker opened');
    assert.equal(await p.locator(`${wb} .wb-persist`).isVisible(), false);
    await p.locator(`${wb} [data-wb=vault]`).click();
    await p.waitForFunction(() => /This vault/.test(document.querySelector('#code-workbench .wb-proj-name').textContent));
  });

  await test('a file still loading when the project changes does not land in the new project', async p => {
    await openExternal(p);
    await p.evaluate(() => { window.__readDelay = { 'main.cpp': 500 }; document.querySelector('#code-workbench [data-node="main.cpp"]').click(); });
    await p.locator(`${wb} [data-wb=vault]`).click();
    await p.waitForFunction(() => /This vault/.test(document.querySelector('#code-workbench .wb-proj-name').textContent));
    await sleep(700);
    assert.equal(await p.locator(`${wb} .wb-tab`).count(), 0);
    assert.ok(await p.locator(`${wb} .CodeMirror`).count() <= 1);
  });

  await test('the Study / Code buttons speak the window language from the start, after switching language and after a restart', async p => {
    const names = () => p.evaluate(() => [...document.querySelectorAll('#app-mode [data-mode]')].map(b => b.textContent));
    assert.deepEqual(await names(), ['学习', '代码']);
    // Switch the language with the language picker while in code mode: the buttons follow at once.
    await p.evaluate(() => window.__fake.set('proj', { id: 'ext-1', workspaceId: 'ws-A', name: 'proj', root: 'C:/fake/proj' }));
    await p.getByRole('button', { name: '代码', exact: true }).click();
    await p.evaluate(() => window.app.commands.executeCommandById('language'));
    await p.locator('#modal-input').fill('English');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => document.querySelector('#app-mode [data-mode=study]')?.textContent === 'Study');
    assert.deepEqual(await names(), ['Study', 'Code']);
    assert.equal(await p.getByRole('button', { name: 'Code', exact: true }).getAttribute('aria-pressed'), 'true');
    // (This page sets Chinese again on every load: the restart below checks that the start shows Chinese.)
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    assert.deepEqual(await names(), ['学习', '代码']);
  }, { lang: 'zh-CN' });

  /* ---------- code mode: Study / Code, assistant, run choices, shortcuts, workspaces, fonts ---------- */
  const modeBtn = (p, name) => p.getByRole('button', { name, exact: true });
  const cmOf = p => p.locator(`${wb} .wb-cm .CodeMirror`);
  const cmText2 = p => p.evaluate(() => document.querySelector('#code-workbench .wb-cm .CodeMirror').CodeMirror.getValue());
  const useProject = (p, proj) => p.evaluate(x => window.__fake.set('proj', x), proj);
  const A = { id: 'ext-1', workspaceId: 'ws-A', name: 'proj', root: 'C:/fake/proj' };

  await test('Study / Code: both buttons always there; a note, unsaved code, cursor line and input survive round trips; the note sidebars step aside in code mode', async p => {
    assert.equal(await modeBtn(p, 'Study').getAttribute('aria-pressed'), 'true');
    await p.locator('#tree [data-path="Welcome.md"]').click();
    await p.locator('#editor').fill('# Welcome\nKeep this thought');
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await cmOf(p).waitFor();
    assert.equal(await modeBtn(p, 'Code').getAttribute('aria-pressed'), 'true');
    assert.equal(await p.locator('#left').isVisible(), false, 'the note sidebar steps aside');
    await p.evaluate(() => { const c = document.querySelector('#code-workbench .wb-cm .CodeMirror').CodeMirror; c.replaceRange('// working draft\n', { line: 0, ch: 0 }); c.setCursor({ line: 4, ch: 2 }); });
    await p.locator(`${wb} [data-panel=input]`).click();
    await p.locator('#wb-stdin').fill('CASE_7\n');
    await modeBtn(p, 'Study').click();
    await p.locator('#editor').waitFor();
    assert.equal(await p.locator('#editor').inputValue(), '# Welcome\nKeep this thought');
    assert.equal(await p.locator('#left').isVisible(), true);
    await modeBtn(p, 'Code').click();
    assert.deepEqual(await p.evaluate(() => { const c = document.querySelector('#code-workbench .wb-cm .CodeMirror').CodeMirror; return [c.getValue().startsWith('// working draft'), c.getCursor().line]; }), [true, 4]);
    await p.locator(`${wb} [data-panel=input]`).click();
    assert.equal(await p.locator('#wb-stdin').inputValue(), 'CASE_7\n');
    assert.equal((await calls(p, 'project', 'write')).length, 0, 'switching never writes project files');
  });

  await test('a run keeps going while you study: its output is there when you come back; a restart opens code mode with the draft', async p => {
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await cmOf(p).waitFor();
    // The simulated program prints later than the switch to study.
    await p.evaluate(() => { const orig = window.myobsidianDesktop.codeRun; window.myobsidianDesktop.codeRun = async (a, b) => { if (a !== 'start' || b.mode !== 'run') return orig(a, b); const id = 'slow-1'; const emit = window.__fake.emit; emit({ id, type: 'phase', phase: 'compiling' }); setTimeout(() => { emit({ id, type: 'phase', phase: 'running' }); emit({ id, type: 'output', stream: 'stdout', text: 'LATE_OUTPUT' }); emit({ id, type: 'end', status: 'success', exitCode: 0 }); }, 700); return { ok: true, id }; }; });
    await p.locator(`${wb} [data-wb=run]`).click();
    await modeBtn(p, 'Study').click();
    await sleep(1000);
    await modeBtn(p, 'Code').click();
    assert.match(await p.locator(`${wb} .wb-output`).innerText(), /LATE_OUTPUT/);
    assert.match(await p.locator(`${wb} .wb-run-state`).innerText(), /Finished/);
    await p.evaluate(() => document.querySelector('#code-workbench .wb-cm .CodeMirror').CodeMirror.replaceRange('// after restart\n', { line: 0, ch: 0 }));
    await sleep(400);
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    await cmOf(p).waitFor();
    assert.equal(await modeBtn(p, 'Code').getAttribute('aria-pressed'), 'true', 'back in code mode');
    assert.match(await cmText2(p), /^\/\/ after restart/);
  });

  await test('Run current file sends no other sources; Run project lets you tick the files of one program', async p => {
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await cmOf(p).waitFor();
    assert.match(await p.locator(`${wb} [data-wb=run]`).innerText(), /Run current file/);
    await p.locator(`${wb} [data-wb=run]`).click();
    await p.waitForFunction(() => /Finished/.test(document.querySelector('#code-workbench .wb-run-state').textContent));
    assert.deepEqual((await calls(p, 'run', 'start')).at(-1).sources, []);
    await p.locator(`${wb} [data-wb=run-project]`).click();
    await p.locator(`${wb} .wb-run-project [data-src="util.cpp"]`).waitFor();
    assert.equal(await p.locator(`${wb} .wb-run-project [data-src="main.cpp"]`).isDisabled(), true, 'the open file is always in');
    await p.locator(`${wb} .wb-run-project [data-src="util.cpp"]`).check();
    await p.locator(`${wb} [data-wb=run-chosen]`).click();
    await p.waitForFunction(n => window.__calls.filter(c => c[1] === 'start').length === n, 2);
    assert.deepEqual((await calls(p, 'run', 'start')).at(-1).sources, ['util.cpp']);
  });

  await test('Ctrl+P finds a project file and Ctrl+G goes to a line in code mode only; in study mode Ctrl+P is still the command palette', async p => {
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await cmOf(p).waitFor();
    await p.keyboard.press('Control+p');
    await p.locator(`${wb} .wb-quick-input`).fill('util');
    await p.locator(`${wb} .wb-quick-list [data-q]`).first().waitFor();
    assert.deepEqual((await p.locator(`${wb} .wb-quick-list [data-q]`).allInnerTexts()).map(x => x.trim()).sort(), ['util.cpp', 'util.h inc']);
    while (!/util.cpp/.test(await p.locator(`${wb} .wb-quick-list .is-active`).innerText())) await p.keyboard.press('ArrowDown');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => /util\(\)/.test(document.querySelector('#code-workbench .wb-cm .CodeMirror').CodeMirror.getValue()));
    await p.locator(`${wb} .wb-tab`, { hasText: 'main.cpp' }).click();
    await p.keyboard.press('Control+g');
    await p.locator('#modal-input').fill('5');
    await p.keyboard.press('Enter');
    assert.equal(await p.evaluate(() => document.querySelector('#code-workbench .wb-cm .CodeMirror').CodeMirror.getCursor().line), 4);
    await modeBtn(p, 'Study').click();
    await p.keyboard.press('Control+p');
    await p.locator('#modal-input').waitFor();
    assert.equal(await p.locator(`${wb} .wb-quick`).isVisible(), false);
  });

  await test('each language is highlighted from the first open (Python, JS, TS, TSX, Go, Rust, SQL, CSS)', async p => {
    const samples = { 'code.py': ['python', 'def double(x): return x * 2'], 'code.js': ['javascript', 'const double = x => x * 2;'], 'code.ts': ['javascript', 'const count: number = 2;'],
      'code.tsx': ['jsx', 'const row = <p>Demo</p>;'], 'code.go': ['go', 'package main\nfunc main() {}'], 'code.rs': ['rust', 'fn main() { let count = 3; }'],
      'code.sql': ['sql', 'SELECT count(*) FROM notes;'], 'code.css': ['css', 'body { color: red; }'] };
    await p.evaluate(s => { const f = window.__fake.get('files'); f['ext-1'] = { ...f['ext-1'], ...Object.fromEntries(Object.entries(s).map(([n, [, b]]) => [n, b])) }; window.__fake.set('files', f); }, samples);
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    const out = [];
    for (const [name, [mode, body]] of Object.entries(samples)) {
      await p.locator(`${wb} [data-node="${name}"]`).click();
      await p.waitForFunction(b => document.querySelector('#code-workbench .wb-cm .CodeMirror')?.CodeMirror.getValue() === b, body);
      out.push(await p.locator(`${wb} .wb-cm .CodeMirror`).evaluate(async (el, n) => { await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return { n, mode: el.CodeMirror.getMode().name, styled: el.querySelectorAll('.CodeMirror-code [class*="cm-"]').length }; }, name));
    }
    for (const r of out) { assert.equal(r.mode, samples[r.n][0], r.n); assert.ok(r.styled > 0, r.n + ' has highlighting'); }
  });

  await test('32 open files, the last one unsaved and selected: after a restart all 32 come back with that one selected and its draft', async p => {
    const names = Array.from({ length: 32 }, (_, i) => 'lesson-' + String(i + 1).padStart(2, '0') + '.cpp');
    await p.evaluate(n => { const f = window.__fake.get('files'); for (const x of n) f['ext-1'][x] = '// Original ' + x + '\n'; window.__fake.set('files', f); }, names);
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    for (const n of names) { await p.locator(`${wb} [data-node="${n}"]`).click(); await p.waitForFunction(x => document.querySelector('#code-workbench .wb-cm .CodeMirror')?.CodeMirror.getValue().includes(x), n); }
    await p.evaluate(() => document.querySelector('#code-workbench .wb-cm .CodeMirror').CodeMirror.replaceRange('// unfinished solution\n', { line: 0, ch: 0 }));
    await sleep(400);
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    await p.waitForFunction(() => document.querySelectorAll('#code-workbench .wb-tab').length >= 32, null, { timeout: 15000 });
    assert.equal(await p.locator(`${wb} .wb-tab`).count(), 32);
    assert.equal(await p.locator(`${wb} .wb-tab.is-active`).getAttribute('data-tab'), 'lesson-32.cpp');
    assert.match(await cmText2(p), /^\/\/ unfinished solution/);
  });

  await test('workspaces: A\'s drafts and tabs come back after visiting B; a new folder at A\'s path gets none of them; an older draft kept under the project id is still found', async p => {
    await p.evaluate(() => { const f = window.__fake.get('files'); f['ext-B'] = { 'b.cpp': 'int main(){}\n' }; f['ext-NEW'] = { 'main.cpp': 'int main(){ return 9; }\n' }; f['ext-OLD'] = { 'main.cpp': '#include <iostream>\nint main(){}\n' }; window.__fake.set('files', f); });
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await cmOf(p).waitFor();
    await p.evaluate(() => document.querySelector('#code-workbench .wb-cm .CodeMirror').CodeMirror.replaceRange('// A draft\n', { line: 0, ch: 0 }));
    // Visit B (another project), then come back to A with a new session id but the same workspace.
    await useProject(p, { id: 'ext-B', workspaceId: 'ws-B', name: 'B', root: 'C:/fake/B' });
    await p.locator(`${wb} [data-wb=refresh]`).click();
    await p.locator(`${wb} [data-node="b.cpp"]`).waitFor();
    assert.equal(await p.locator(`${wb} .wb-tab`).count(), 0);
    await p.evaluate(() => { const f = window.__fake.get('files'); f['ext-1b'] = f['ext-1']; window.__fake.set('files', f); });
    await useProject(p, { id: 'ext-1b', workspaceId: 'ws-A', name: 'proj', root: 'C:/fake/proj' });
    await p.locator(`${wb} [data-wb=refresh]`).click();
    await p.waitForFunction(() => /^\/\/ A draft/.test(document.querySelector('#code-workbench .wb-cm .CodeMirror')?.CodeMirror.getValue() || ''));
    // A new folder put at the same path: a different workspace, nothing of A shows.
    await useProject(p, { id: 'ext-NEW', workspaceId: 'ws-NEW', name: 'proj', root: 'C:/fake/proj' });
    await p.locator(`${wb} [data-wb=refresh]`).click();
    await p.locator(`${wb} [data-node="main.cpp"]`).waitFor();
    assert.equal(await p.locator(`${wb} .wb-tab`).count(), 0, 'no tabs from A');
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await p.waitForFunction(() => /return 9/.test(document.querySelector('#code-workbench .wb-cm .CodeMirror')?.CodeMirror.getValue() || ''));
    assert.equal(await p.locator(`${wb} .wb-tab.is-dirty`).count(), 0, 'no draft from A');
    // A draft written before workspaces (kept under the project id) moves to its workspace the first time.
    await p.evaluate(() => { localStorage.setItem('mo:wb:draft:ext-OLD:main.cpp', JSON.stringify({ text: '// old draft\nint main(){}\n', revision: 'x' })); localStorage.setItem('mo:wb:open:ext-OLD', JSON.stringify({ files: ['main.cpp'], active: 'main.cpp' })); });
    await useProject(p, { id: 'ext-OLD', workspaceId: 'ws-OLD', name: 'old', root: 'C:/fake/old' });
    await p.locator(`${wb} [data-wb=refresh]`).click();
    await p.waitForFunction(() => /^\/\/ old draft/.test(document.querySelector('#code-workbench .wb-cm .CodeMirror')?.CodeMirror.getValue() || ''));
    assert.equal(await p.evaluate(() => localStorage.getItem('mo:wb:draft:ext-OLD:main.cpp')), null, 'moved, not copied');
  });

  // The code assistant: what goes out with each choice, project separation, Codex's one-time question.
  async function assistantRoute(p, reply = b => ({ text: 'ANSWER to ' + b.question })) {
    const sent = [];
    await p.route('**/api/code-assistant', async r => {
      const b = JSON.parse(r.request().postData()); sent.push(b);
      const out = await reply(b, sent);
      if (out?.status) return r.fulfill({ status: out.status, contentType: 'application/json', body: JSON.stringify(out.json) });
      return r.fulfill({ json: out });
    });
    return sent;
  }
  const assist = p => p.getByRole('complementary', { name: 'Code assistant' });
  const ask = async (p, q) => { await assist(p).getByRole('textbox', { name: /ask the code assistant/i }).fill(q); await assist(p).getByRole('button', { name: 'Send', exact: true }).click(); };

  await test('assistant: says what will be sent; selection / whole file with unsaved changes / question only send exactly that; too long is refused', async p => {
    await p.evaluate(() => { const ai = JSON.parse(localStorage.getItem('mo:ai') || '{}'); localStorage.setItem('mo:ai', JSON.stringify({ ...ai, keys: { custom: 'k' }, baseUrl: 'https://fixture.invalid/v1', models: { custom: 'm' }, use: { ...(ai.use || {}), code: 'custom' } })); });
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    const sent = await assistantRoute(p);
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await cmOf(p).waitFor();
    await p.evaluate(() => { const c = document.querySelector('#code-workbench .wb-cm .CodeMirror').CodeMirror; c.replaceRange('// unsaved line\n', { line: 0, ch: 0 }); c.setSelection({ line: 3, ch: 0 }, { line: 4, ch: 0 }); });
    await sleep(250);
    assert.match(await assist(p).locator('.wa-will').innerText(), /the 2 selected lines of main\.cpp/);
    await ask(p, 'What is x?');
    await assist(p).getByText('ANSWER to What is x?').waitFor();
    assert.deepEqual({ sel: sent[0].selection, file: sent[0].filename, action: sent[0].action, provider: sent[0].provider }, { sel: '  int x = 42;\n', file: 'main.cpp', action: 'ask', provider: 'custom' });
    await assist(p).getByRole('radio', { name: 'Attach current file' }).check();
    assert.match(await assist(p).locator('.wa-will').innerText(), /all of main\.cpp .*unsaved changes included/);
    await ask(p, 'Whole file?');
    await assist(p).getByText('ANSWER to Whole file?').waitFor();
    assert.ok(sent[1].selection.startsWith('// unsaved line\n#include <iostream>'), 'the editor text, not the disk');
    await assist(p).getByRole('radio', { name: 'Question only' }).check();
    await ask(p, 'Just asking');
    await assist(p).getByText('ANSWER to Just asking').waitFor();
    assert.deepEqual([sent[2].selection, sent[2].filename, sent[2].diagnostics], ['', '', '']);
    assert.deepEqual(sent[2].history.map(h => h.role), ['user', 'assistant', 'user', 'assistant'], 'this project\'s conversation so far');
    // A file too long to attach whole: nothing is sent, the message says to select a part.
    await assist(p).getByRole('radio', { name: 'Attach current file' }).check();
    await p.evaluate(() => document.querySelector('#code-workbench .wb-cm .CodeMirror').CodeMirror.replaceRange('x'.repeat(70000) + '\n', { line: 0, ch: 0 }));
    await sleep(250);
    assert.match(await assist(p).locator('.wa-will').innerText(), /too long to attach whole/);
    await ask(p, 'Too long');
    await sleep(300);
    assert.equal(sent.length, 3, 'nothing sent');
  });

  await test('assistant: a reply that arrives after switching projects stays with the project that asked; the other project never sees or sends it', async p => {
    await p.evaluate(() => { const ai = JSON.parse(localStorage.getItem('mo:ai') || '{}'); localStorage.setItem('mo:ai', JSON.stringify({ ...ai, keys: { custom: 'k' }, baseUrl: 'https://fixture.invalid/v1', models: { custom: 'm' }, use: { ...(ai.use || {}), code: 'custom' } })); const f = window.__fake.get('files'); f['ext-B'] = { 'b.cpp': 'int main(){}\n' }; window.__fake.set('files', f); });
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    let release; const held = new Promise(r => { release = r; });
    const sent = await assistantRoute(p, async b => { if (b.question === 'A late') await held; return { text: 'REPLY ' + b.question }; });
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await cmOf(p).waitFor();
    await assist(p).getByRole('radio', { name: 'Question only' }).check();
    await ask(p, 'A late');
    await useProject(p, { id: 'ext-B', workspaceId: 'ws-B', name: 'B', root: 'C:/fake/B' });
    await p.locator(`${wb} [data-wb=refresh]`).click();
    await p.locator(`${wb} [data-node="b.cpp"]`).waitFor();
    await assist(p).getByRole('radio', { name: 'Question only' }).check();
    await ask(p, 'B question');
    await assist(p).getByText('REPLY B question').waitFor();
    release(); await sleep(400);
    assert.equal(await assist(p).getByText(/A late/).count(), 0, 'nothing of A in B');
    assert.deepEqual(sent.find(b => b.question === 'B question').history, []);
    await useProject(p, A);
    await p.locator(`${wb} [data-wb=refresh]`).click();
    await assist(p).getByText('REPLY A late').waitFor();
  });

  await test('assistant with Codex: the one-time question about this computer\'s Codex instructions appears once, and only a click retries (once, with the flag)', async p => {
    await p.evaluate(() => { const ai = JSON.parse(localStorage.getItem('mo:ai') || '{}'); localStorage.setItem('mo:ai', JSON.stringify({ ...ai, use: { ...(ai.use || {}), code: 'codex' } })); });
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    const sent = await assistantRoute(p, b => (b.useNativeCodexInstructions ? { text: 'WITH NATIVE' } : { status: 409, json: { error: 'consent', code: 'codexGlobalInstructionsConsent' } }));
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await cmOf(p).waitFor();
    await assist(p).getByRole('radio', { name: 'Question only' }).check();
    await ask(p, 'Codex q');
    const consent = assist(p).getByRole('button', { name: /Continue with this computer’s Codex global instructions/ });
    await consent.waitFor();
    await sleep(500);
    assert.equal(sent.length, 1, 'no automatic retry');
    await consent.click();
    await assist(p).getByText('WITH NATIVE').waitFor();
    assert.equal(sent.length, 2); assert.equal(sent[1].useNativeCodexInstructions, true); assert.equal(sent[0].useNativeCodexInstructions, undefined);
    assert.equal(await consent.count(), 0);
    await ask(p, 'Next q');
    await sleep(300);
    assert.equal(sent[2].useNativeCodexInstructions, undefined, 'not remembered for the next question');
  });

  await test('code font and size: Settings → Appearance changes the project editor (and source files opened from notes), not the note text; kept after reopening', async p => {
    await useProject(p, A);
    await modeBtn(p, 'Code').click();
    await p.locator(`${wb} [data-node="main.cpp"]`).click();
    await cmOf(p).waitFor();
    const noteSize = await p.evaluate(() => getComputedStyle(document.getElementById('editor')).fontSize);
    await p.evaluate(() => import('/settings.js').then(m => m.openSettings('appearance')));
    const size = p.getByRole('spinbutton', { name: 'Code font size' });
    await size.fill('19'); await size.press('Tab');
    await p.locator('.settings-close').click();
    assert.equal(await cmOf(p).evaluate(el => getComputedStyle(el).fontSize), '19px');
    await sleep(300);
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    await cmOf(p).waitFor();
    assert.equal(await cmOf(p).evaluate(el => getComputedStyle(el).fontSize), '19px');
    await modeBtn(p, 'Study').click();
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById('editor')).fontSize), noteSize, 'note text unchanged');
    assert.equal(await p.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--font-code-size').trim()), '19px');
  });

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
