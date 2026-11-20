// The code workbench end to end in the real desktop app: real g++ and GDB, a new temporary vault and a new
// temporary app profile (never the real ones). Uses the vault as the project, runs main.cpp with input,
// shows a compile error, then debugs: breakpoint, variables, step over, continue.
//   node test/code-workbench-e2e.cjs            (needs the desktop back end: code-projects.js, electron/code-runner.js)
//   GRAPHITE_E2E_ROOT=<checkout> node test/code-workbench-e2e.cjs
require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = process.env.GRAPHITE_E2E_ROOT || path.join(__dirname, '..');
if (!fs.existsSync(path.join(root, 'electron/code-runner.js'))) { console.log('SKIP: no desktop code runner in ' + root); process.exit(0); }
const { _electron } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

const MAIN = [
  '#include <iostream>',
  'int main() {',
  '  int a = 0, b = 0;',
  '  std::cin >> a >> b;',
  '  int sum = a + b;',
  '  std::cout << "sum=" << sum << std::endl;',
  '  return 0;',
  '}',
  '',
].join('\n');

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphite-wb-e2e-'));
  const vault = path.join(tmp, 'vault'), profile = path.join(tmp, 'profile');
  const external = path.join(tmp, 'External project');
  fs.mkdirSync(external);
  fs.writeFileSync(path.join(external,'outside.cpp'), MAIN);
  fs.mkdirSync(path.join(vault, 'algo'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'Welcome.md'), '# Test vault\n');
  fs.writeFileSync(path.join(vault, 'algo', 'main.cpp'), MAIN);
  const packaged = process.env.GRAPHITE_TEST_EXE;
  const hold = path.join(tmp,'automation.js');
  fs.writeFileSync(hold, 'new Promise(() => {})'); // Playwright owns the hidden window until the checks finish.
  const app = await _electron.launch({
    executablePath: packaged || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(packaged ? [] : [root]), '--selftest', '--selftest-hidden', '--disable-background-timer-throttling',
      '--selftest-eval-file=' + hold, '--update-folder='+tmp, '--update-repo=disabled', '--vault=' + vault, '--user-data-dir=' + profile],
    cwd: root, env: { ...process.env }, timeout: 60000,
  });
  const steps = [];
  const step = async (name, fn) => { try { await fn(); steps.push(name); console.log('PASS ' + name); } catch (e) { console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 6).join('\n  ')); throw e; } };
  let failed = false, page = null;
  try {
    const p = page = await app.firstWindow();
    p.setDefaultTimeout(30000);
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    await p.waitForFunction(() => window.app?.commands && window.myobsidianDesktop?.codeRun);
    const wb = '#code-workbench';
    const cm = () => p.evaluate(() => document.querySelector('#code-workbench .CodeMirror').CodeMirror);
    const state = () => p.locator(`${wb} .wb-run-state`).innerText();

    await step('open the workbench on this vault; compiler and debugger are found', async () => {
      await p.evaluate(() => window.app.commands.executeCommandById('code-workbench'));
      await p.locator(`${wb} [data-wb=vault]`).click();
      assert.equal(await p.locator(`${wb} .wb-tree`).isVisible(), true, 'the folder tree is shown beside the editor at the normal window size');
      await p.locator(`${wb} [data-node="algo"]`).click();
      await p.locator(`${wb} [data-node="algo/main.cpp"]`).click();
      await p.locator(`${wb} .CodeMirror`).waitFor();
      await p.locator(`${wb} .wb-tool.is-ok >> nth=1`).waitFor();
      const tools = (await p.locator(`${wb} .wb-tools`).innerText()).replace(/\s+/g, ' ').trim();
      console.log('  tools: ' + tools);
      assert.match(tools, /^✓ g\+\+ [\d.]+ ✓ GDB [\d.]+$/);
    });

    await step('run with input: real output', async () => {
      await p.locator(`${wb} [data-panel=input]`).click();
      await p.locator('#wb-stdin').fill('5 7\n');
      await p.locator(`${wb} [data-wb=run]`).click();
      await p.waitForFunction(() => /sum=12/.test(document.querySelector('#code-workbench .wb-output').textContent), null, { timeout: 90000 });
      await p.waitForFunction(() => document.querySelector('#code-workbench .wb-run-state').classList.contains('is-ok'), null, { timeout: 30000 });
      console.log('  ' + (await state()));
    });

    await step('a compile error: shown under Problems at the right line, nothing was run', async () => {
      await p.evaluate(() => { const c = document.querySelector('#code-workbench .CodeMirror').CodeMirror; c.replaceRange('', { line: 4, ch: c.getLine(4).length - 1 }, { line: 4, ch: c.getLine(4).length }); }); // drop the ';' after "a + b"
      await p.locator(`${wb} [data-wb=build]`).click();
      await p.locator(`${wb} .wb-diag.is-error >> nth=0`).waitFor({ timeout: 90000 });
      const diag = await p.locator(`${wb} .wb-diag.is-error >> nth=0`).innerText();
      console.log('  ' + diag.replace(/\s+/g, ' '));
      assert.match(diag, /algo\/main\.cpp:\d+/);
      assert.match(await state(), /compile|编译/i);
      assert.equal(fs.readFileSync(path.join(vault, 'algo/main.cpp'), 'utf8').includes('a + b\n'), true, 'the broken text was saved before compiling');
      await p.evaluate(() => { const c = document.querySelector('#code-workbench .CodeMirror').CodeMirror; c.replaceRange(';', { line: 4, ch: c.getLine(4).length }); });
    });

    await step('debug: breakpoint on line 6, the variables, step over, continue to the end', async () => {
      await p.evaluate(() => { const c = document.querySelector('#code-workbench .CodeMirror').CodeMirror; CodeMirror.signal(c, 'gutterClick', c, 5, 'wb-bp-gutter', {}); });
      await p.locator(`${wb} [data-wb=debug]`).click();
      await p.locator(`${wb} .wb-locals`).waitFor({ timeout: 90000 });
      const at = await p.locator(`${wb} .wb-paused-at`).innerText();
      const locals = (await p.locator(`${wb} .wb-locals`).innerText()).replace(/\s+/g, ' ');
      console.log('  ' + at + ' | ' + locals);
      assert.match(at, /algo\/main\.cpp:6/);
      assert.match(locals, /\ba 5\b/); assert.match(locals, /\bb 7\b/); assert.match(locals, /\bsum 12\b/);
      assert.equal(await p.evaluate(() => document.querySelectorAll('#code-workbench .wb-paused-line').length), 1);
      await p.locator(`${wb} [data-wb=next]`).click();
      await p.waitForFunction(() => /main\.cpp:7/.test(document.querySelector('#code-workbench .wb-paused-at')?.textContent || ''), null, { timeout: 30000 });
      await p.locator(`${wb} [data-wb=continue]`).click();
      await p.waitForFunction(() => document.querySelector('#code-workbench .wb-run-state').classList.contains('is-ok'), null, { timeout: 30000 });
      assert.match(await p.locator(`${wb} .wb-output`).innerText(), /sum=12/);
      if (process.env.WB_SHOT) await p.screenshot({ path: process.env.WB_SHOT });
    });

    await step('stop a program that waits for input', async () => {
      await p.locator(`${wb} [data-panel=input]`).click();
      await p.locator('#wb-stdin').fill('');
      await p.evaluate(() => { const c = document.querySelector('#code-workbench .CodeMirror').CodeMirror; c.setValue(c.getValue().replace('return 0;', 'while (true) {}\n  return 0;')); });
      await p.locator(`${wb} [data-wb=run]`).click();
      await p.waitForFunction(() => /Running|运行中/.test(document.querySelector('#code-workbench .wb-run-state').textContent), null, { timeout: 90000 });
      await p.locator(`${wb} [data-wb=stop]`).click();
      await p.waitForFunction(() => /Stopped|已停止/.test(document.querySelector('#code-workbench .wb-run-state').textContent), null, { timeout: 30000 });
    });
    await step('choose an external folder, save there, and preserve both edits on a real disk conflict', async () => {
      await app.evaluate(({dialog}, folder) => {
        // Replace only the native folder chooser; reads, saves and conflict detection use the actual desktop service.
        dialog.showOpenDialog = async () => ({canceled:false, filePaths:[folder]});
      },external);
      await p.locator(wb+' [data-wb=choose]').click();
      await p.locator(wb+' [data-node="outside.cpp"]').click();
      await p.locator(wb+' .wb-tab.is-active[data-tab="outside.cpp"]').waitFor();
      const editor = p.locator(wb+' .CodeMirror');
      await editor.waitFor();
      await editor.evaluate(el=>el.CodeMirror.setValue('// user save\n'));
      await p.locator(wb+' [data-wb=save]').click();
      const out = path.join(external,'outside.cpp');
      await p.waitForFunction(()=>document.querySelector('#code-workbench .wb-tab.is-active[data-tab="outside.cpp"]:not(.is-dirty)'));
      assert.equal(fs.readFileSync(out,'utf8'),'// user save\n');
      assert.equal(fs.existsSync(path.join(vault,'outside.cpp')),false);
      fs.writeFileSync(out,'// outside edit\n');
      await editor.evaluate(el=>el.CodeMirror.setValue('// unsaved buffer\n'));
      await p.locator(wb+' [data-wb=save]').click();
      await p.locator(wb+' [data-wb=keep-mine]').waitFor();
      assert.equal(await editor.evaluate(el=>el.CodeMirror.getValue()),'// unsaved buffer\n');
      assert.equal(fs.readFileSync(out,'utf8'),'// outside edit\n');
    });
    if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
  } catch { failed = true; if (process.env.WB_SHOT && page) await page.screenshot({ path: process.env.WB_SHOT.replace(/.png$/, '-fail.png') }).catch(() => {}); }
  finally {
    await app.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
  }
  console.log(`\n${steps.length}/6 steps passed`);
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
