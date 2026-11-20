// ✦ Capture in a real browser with a new temporary vault: two captures saved through the window in the same
// second (and millisecond) get their own ids and both reach the inbox; a failed inbox write (HTTP 507) keeps the
// window, text, thought, kind and source with a Retry that writes exactly one entry; the selection bar's
// one-click save gets the same protection; and an older bundled copy is upgraded in place, keeping its settings
// and the inbox history.
//   node test/capture-ui.cjs [filter]
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const repo = path.join(__dirname, '..');
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHIP = path.join(repo, 'extensions/obsidian-plugins/claude-capture');
const OLD_INBOX = '---\ngraph: hide\ntags: [Claude]\n---\n# Claude Inbox\n\n- [x] **Interesting** · 2026-11-01 10:00 · [[Welcome|Welcome]] %%cap-20261101-100000%% → [[Done]] (2026-11-02)\n    > an old capture\n';

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-capture-'));
  const plug = path.join(vault, '.obsidian/plugins/claude-capture');
  // An older bundled copy, with its own settings, and an inbox with history.
  await fs.mkdir(plug, { recursive: true });
  for (const f of ['main.js', 'styles.css']) await fs.copyFile(path.join(SHIP, f), path.join(plug, f));
  const ship = JSON.parse(await fs.readFile(path.join(SHIP, 'manifest.json'), 'utf8'));
  await fs.writeFile(path.join(plug, 'manifest.json'), JSON.stringify({ ...ship, version: '1.2.0' }));
  await fs.writeFile(path.join(plug, 'data.json'), JSON.stringify({ selectionBar: true, firaCodeSet: true, graphHiddenSet: true, mine: 'kept' }));
  await fs.writeFile(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['claude-capture']));
  await fs.writeFile(path.join(vault, '.obsidian/graphite-builtins.json'), JSON.stringify({ offered: ['claude-capture', 'claude-chat', 'claude-quizzes'] }));
  await fs.writeFile(path.join(vault, 'Welcome.md'), '# Welcome\n\n## Section\n\nSample A lives in this sentence.\n');
  await fs.writeFile(path.join(vault, 'Claude Inbox.md'), OLD_INBOX);

  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const inbox = () => fs.readFile(path.join(vault, 'Claude Inbox.md'), 'utf8');
  const ids = text => [...text.matchAll(/%%(cap-[\w-]+)%%/g)].map(m => m[1]);
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  async function page() {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(() => localStorage.setItem('mo:lang', JSON.stringify('en')));
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    const errors = []; p.on('pageerror', e => errors.push(e.message)); p.__errors = errors;
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor({ state: 'attached' });
    await p.waitForFunction(() => window.app?.plugins?.getPlugin?.('claude-capture'));
    await p.locator('#tree [data-path="Welcome.md"]').click();
    return p;
  }
  async function test(name, fn) {
    if (filter && !filter.test(name)) return;
    let p;
    try { p = await page(); await fn(p); if (p.__errors.length) throw new Error('page errors: ' + p.__errors.join(' | ')); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { results.push({ name, pass: false }); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 8).join('\n  ')); }
    finally { await p?.context().close(); }
  }
  const openCapture = p => p.evaluate(() => window.app.commands.executeCommandById('claude-capture:capture'));
  const fill = async (p, text, thought = '') => {
    await p.locator('.claude-capture-modal .cc-text').fill(text);
    await p.locator('.claude-capture-modal .cc-note').fill(thought);
  };
  // Fail inbox writes on demand: 'fail' (nothing written), 'late' (written, but the answer says 507).
  async function inboxFaults(p) {
    const mode = { now: null, puts: 0 };
    await p.route(/\/api\/file\?path=Claude%20Inbox\.md/, async r => {
      if (r.request().method() !== 'PUT') return r.continue();
      mode.puts++;
      if (mode.now === 'fail') return r.fulfill({ status: 507, contentType: 'application/json', body: JSON.stringify({ error: 'Insufficient storage' }) });
      if (mode.now === 'late') { await r.fetch(); return r.fulfill({ status: 507, contentType: 'application/json', body: JSON.stringify({ error: 'Insufficient storage' }) }); }
      return r.continue();
    });
    return mode;
  }

  await test('upgrade: the older bundled Capture is replaced in place; its settings and the inbox history stay', async () => {
    assert.equal(JSON.parse(await fs.readFile(path.join(plug, 'manifest.json'), 'utf8')).version, ship.version);
    assert.notEqual(ship.version, '1.2.0');
    assert.equal(JSON.parse(await fs.readFile(path.join(plug, 'data.json'), 'utf8')).mine, 'kept');
    assert.equal(await inbox(), OLD_INBOX);
    assert.equal(await fs.readFile(path.join(plug, 'main.js'), 'utf8'), await fs.readFile(path.join(SHIP, 'main.js'), 'utf8'));
  });

  await test('two captures saved through the window in the same second and millisecond: two entries, two ids, old ones untouched', async p => {
    await p.clock.setFixedTime(new Date('2026-11-21T09:30:15.123'));
    await openCapture(p); await fill(p, 'Example A');
    await p.locator('.claude-capture-modal .cc-interesting').click();
    await p.locator('.claude-capture-modal').waitFor({ state: 'detached' });
    await openCapture(p); await fill(p, 'Example B');
    await p.locator('.claude-capture-modal .cc-unfamiliar').click();
    await p.locator('.claude-capture-modal').waitFor({ state: 'detached' });
    const text = await inbox();
    assert.ok(text.startsWith(OLD_INBOX), 'the old inbox is kept as it was');
    const added = ids(text.slice(OLD_INBOX.length));
    assert.equal(added.length, 2);
    assert.notEqual(added[0], added[1]);
    for (const id of added) assert.match(id, /^cap-20261121-093015-[a-z0-9]{10}$/);
    assert.match(text, /\*\*Interesting\*\* · 2026-11-21 09:30 · \[\[Welcome[^\]\n]*\]\] %%cap-[\w-]+%%\n    > Example A\n/);
    assert.match(text, /    > Example B\n/);
  });

  await test('two windows saving at the same moment get different ids (no shared counter)', async p => {
    const p2 = await p.context().newPage();
    await p2.goto(origin, { waitUntil: 'domcontentloaded' });
    await p2.waitForFunction(() => window.app?.plugins?.getPlugin?.('claude-capture'));
    // Both windows build 100 entries each at the same fixed time (the inbox write is replaced by a dry run).
    const gen = q => q.evaluate(async () => {
      const c = window.app.plugins.getPlugin('claude-capture'), vault = c.app.vault, orig = vault.modify;
      const out = []; let last = '';
      vault.modify = async (f, d) => { last = d; };
      try {
        for (let i = 0; i < 100; i++) { await c.writeCapture({ kind: 'interesting', text: 'x' + i, thought: '' }); out.push((last.match(/%%(cap-[\w-]+)%%\n    > x\d+\n$/) || [])[1]); }
      } finally { vault.modify = orig; }
      return out;
    });
    await p2.clock.setFixedTime(new Date('2026-11-21T09:30:15.123'));
    await p.clock.setFixedTime(new Date('2026-11-21T09:30:15.123'));
    const a = await gen(p), b = await gen(p2);
    const all = [...a, ...b];
    assert.equal(all.filter(Boolean).length, 200);
    assert.equal(new Set(all).size, 200);
    await p2.close();
  });

  await test('inbox write fails (507): the window stays with text, thought, kind and source; Retry (clicked twice) writes one entry', async p => {
    const mode = await inboxFaults(p);
    const before = await inbox();
    mode.now = 'fail';
    await openCapture(p); await fill(p, 'Sample A', 'Thought B');
    await p.locator('.claude-capture-modal .cc-unfamiliar').click();
    await p.locator('.claude-capture-modal .cc-error [data-retry], .claude-capture-modal .cc-retry').waitFor();
    assert.match(await p.locator('.claude-capture-modal .cc-error').innerText(), /Not saved: .*Your text is kept here/);
    assert.equal(await p.locator('.claude-capture-modal .cc-text').inputValue(), 'Sample A');
    assert.equal(await p.locator('.claude-capture-modal .cc-note').inputValue(), 'Thought B');
    assert.match(await p.locator('.claude-capture-modal .cc-source').innerText(), /Welcome/);
    assert.equal(await p.locator('.claude-capture-modal .cc-unfamiliar.cc-suggested').count(), 1, 'the kind chosen is kept');
    assert.equal(await inbox(), before, 'nothing written');
    mode.now = null;
    await p.locator('.claude-capture-modal .cc-retry').evaluate(b => { b.click(); b.click(); });
    await p.locator('.claude-capture-modal').waitFor({ state: 'detached' });
    const added = (await inbox()).slice(before.length);
    assert.equal(ids(added).length, 1);
    assert.match(added, /\*\*Not familiar\*\*.*\n    > Sample A\n    - Thought: Thought B\n$/);
  });

  await test('the write reached the disk but the answer was an error: Retry does not add it twice', async p => {
    const mode = await inboxFaults(p);
    const before = await inbox();
    mode.now = 'late';
    await openCapture(p); await fill(p, 'Arrived anyway');
    await p.locator('.claude-capture-modal .cc-interesting').click();
    await p.locator('.claude-capture-modal .cc-retry').waitFor();
    mode.now = null;
    await p.locator('.claude-capture-modal .cc-retry').click();
    await p.locator('.claude-capture-modal').waitFor({ state: 'detached' });
    const added = (await inbox()).slice(before.length);
    assert.equal((added.match(/Arrived anyway/g) || []).length, 1, added);
  });

  await test('Esc while saving does not close the window (the text would be lost if that save failed)', async p => {
    let release;
    const gate = new Promise(r => { release = r; });
    await p.route(/\/api\/file\?path=Claude%20Inbox\.md/, async r => { if (r.request().method() === 'PUT') { await gate; return r.fulfill({ status: 507, contentType: 'application/json', body: '{"error":"Insufficient storage"}' }); } return r.continue(); });
    await openCapture(p); await fill(p, 'Kept while saving');
    await p.locator('.claude-capture-modal .cc-interesting').click();
    await p.keyboard.press('Escape');
    assert.equal(await p.locator('.claude-capture-modal').count(), 1);
    assert.equal(await p.locator('.claude-capture-modal .cc-interesting').isDisabled(), true, 'buttons are off while saving');
    release();
    await p.locator('.claude-capture-modal .cc-retry').waitFor();
    assert.equal(await p.locator('.claude-capture-modal .cc-text').inputValue(), 'Kept while saving');
  });

  await test('the selection bar\'s one-click save fails: the window opens with the selected text and Retry; then one entry', async p => {
    const mode = await inboxFaults(p);
    const before = await inbox();
    // Select "Sample A lives" in the editor and use the bar's Interesting button.
    await p.evaluate(() => { const ed = document.getElementById('editor'); const at = ed.value.indexOf('Sample A lives'); ed.focus(); ed.setSelectionRange(at, at + 'Sample A lives'.length); document.dispatchEvent(new Event('selectionchange')); });
    const box = await p.locator('#editor').boundingBox();
    await p.mouse.move(box.x + 50, box.y + 50); await p.mouse.up();
    await p.locator('.cc-selbar:not([hidden]) .cc-q-int').waitFor();
    mode.now = 'fail';
    await p.locator('.cc-selbar .cc-q-int').click();
    await p.locator('.claude-capture-modal .cc-retry').waitFor();
    assert.equal(await p.locator('.claude-capture-modal .cc-text').inputValue(), 'Sample A lives');
    assert.equal(await inbox(), before);
    mode.now = null;
    await p.locator('.claude-capture-modal .cc-retry').click();
    await p.locator('.claude-capture-modal').waitFor({ state: 'detached' });
    const added = (await inbox()).slice(before.length);
    assert.equal(ids(added).length, 1);
    assert.match(added, /\*\*Interesting\*\*.*\n    > Sample A lives\n$/);
  });

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
