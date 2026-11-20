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
      const all = files(), mine = all[p.id] || {};
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

  await test('run: unsaved files are saved first, other .cpp files in the folder are compiled too, input goes to the program', async p => {
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
    assert.equal(start.mode, 'run'); assert.equal(start.stdin, '5 7'); assert.deepEqual(start.sources, ['util.cpp']); assert.deepEqual(start.breakpoints, []);
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
    assert.equal(await p.locator(`${wb} [data-wb=run]`).innerText(), '▶ 运行');
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

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
