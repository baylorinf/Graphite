// Closing Graphite quits it, even while a hidden Canvas window (a background sync) is open. 1.1.50 kept running
// without its window, and the next launch crashed ("Object has been destroyed" in second-instance).
//   node test/app-close.cjs
require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.join(__dirname, '..');
const { _electron } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'graphite-close-'));
  const vault = path.join(tmp, 'vault'), profile = path.join(tmp, 'profile');
  fs.mkdirSync(vault, { recursive: true });
  fs.writeFileSync(path.join(vault, 'Welcome.md'), '# Test vault\n');
  const app = await _electron.launch({
    executablePath: process.env.GRAPHITE_TEST_EXE || path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [...(process.env.GRAPHITE_TEST_EXE ? [] : [root]), '--update-folder=' + tmp, '--update-repo=disabled', '--vault=' + vault, '--user-data-dir=' + profile],
    cwd: root, env: { ...process.env }, timeout: 60000,
  });
  const proc = app.process();
  const exited = new Promise(resolve => proc.once('exit', code => resolve(code)));
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.app?.commands, null, { timeout: 30000 });
    // A hidden window like the Canvas sync worker.
    await app.evaluate(({ BrowserWindow }) => { new BrowserWindow({ show: false }).loadURL('about:blank'); });
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length), 2);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.isVisible())?.close());
    const code = await Promise.race([exited, new Promise(r => setTimeout(() => r('still running'), 20000))]);
    assert.notEqual(code, 'still running', 'Graphite kept running after its window closed');
    console.log('PASS closing the window quits Graphite, with a hidden Canvas window open');
  } catch (e) {
    console.log('FAIL ' + e.message);
    try { proc.kill(); } catch { /* gone */ }
    process.exitCode = 1;
  }
})();
