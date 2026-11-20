// Note checking and tidying in a real browser, with a new temporary vault and synthetic notes (no paid model:
// the AI's answers are simulated). Checks that proofreading never changes formulas or code, compares the edited
// note and every formula character by character on disk, and that an AI's change is not written into a folder
// that Study settings mark read-only (decided at the moment of applying).
//   node test/note-assist-ui.cjs [filter]
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

// Every formula and code span in the note, in order: they must come back exactly as they were.
const FORMULAS = ['$x x$', '$$\na a = b b\n$$', '`the the`', '$y y$', '\\(z z\\)', '$q q$', '$$m m$$'];
const PROOF = [
  '# Proof',
  '',
  'The the student reads. The product $x x$ stays.',
  '',
  '$$\na a = b b\n$$',
  '',
  'Code `the the` stays, but but this is fixed.',
  '',
  'Escaped \\$5 is is money, and $5 and and $10 too.',
  '',
  'Before a formula is is $y y$ and after after it.',
  '',
  'Inline \\(z z\\) stays; 中文 测试 测试 修正后 $q q$ 仍在。',
  '',
  '```',
  'the the in a fence',
  '```',
  '',
  'Display $$m m$$ kept.',
  '',
].join('\n');
const EXPECTED = PROOF
  .replace('The the student', 'The student')
  .replace('but but this', 'but this')
  .replace('is is money', 'is money')
  .replace('and and $10', 'and $10')
  .replace('formula is is $y', 'formula is $y')
  .replace('after after it', 'after it')
  .replace('测试 测试', '测试');

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-assist-'));
  const files = {
    'Welcome.md': 'Welcome',
    'Course/Proof.md': PROOF,
    'Course/AI.md': 'The the cat. Area $x x$ here.\n',
    'Read Only/Locked.md': '# Locked\nsome   text\n',
    'Read Only/Example.md': '---\ntags: [x]\n---\n# Example\n\n1. Point\n',
    'Course/Free.md': '# Free\nsome   text\n',
    'Course/Example.md': '---\ntags: [x]\n---\n# Example\n\n1. Point\n',
  };
  for (const [n, b] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(vault, n)), { recursive: true }); await fs.writeFile(path.join(vault, n), b); }
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const disk = n => fs.readFile(path.join(vault, n), 'utf8');
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  async function page({ use = {} } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(use => {
      localStorage.setItem('mo:lang', JSON.stringify('en'));
      localStorage.setItem('mo:ai', JSON.stringify({ keys: { deepseek: 'test-only' }, models: { deepseek: 'deepseek-flash' }, use: { check: 'off', quiz: 'off', chat: 'off', format: 'deepseek', inbox: 'off', ...use } }));
    }, use);
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    p.on('dialog', d => d.accept());
    const errors = []; p.on('pageerror', e => errors.push(e.message)); p.__errors = errors;
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor({ state: 'attached' });
    await p.waitForFunction(() => typeof window.__moFlush === 'function' && window.app?.commands);
    return p;
  }
  async function test(name, fn, opts) {
    if (filter && !filter.test(name)) return;
    let p;
    try { p = await page(opts); await fn(p); if (p.__errors.length) throw new Error('page errors: ' + p.__errors.join(' | ')); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { results.push({ name, pass: false }); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 10).join('\n  ')); }
    finally { await p?.context().close(); }
  }
  const run = (p, id) => p.evaluate(id => window.app.commands.executeCommandById(id), id);
  const open = async (p, file) => { await p.evaluate(f => window.app.workspace.openLinkText(f, ''), file); await p.waitForFunction(f => document.title.startsWith(f.split('/').pop().replace(/\.md$/, '')), file); };
  const saved = async (p, file, want) => {
    await p.evaluate(() => window.__moFlush());
    for (let i = 0; i < 40 && (await disk(file)) !== want; i++) await sleep(100);
    return disk(file);
  };

  await test('offline check, Apply all: repeated words are fixed in prose; every formula and code span is kept character by character, on disk too', async p => {
    await open(p, 'Course/Proof.md');
    await run(p, 'check-note');
    await p.locator('.check-modal [data-act=all]').click();
    const text = await saved(p, 'Course/Proof.md', EXPECTED);
    assert.equal(text, EXPECTED);
    let at = 0;
    for (const f of FORMULAS) { const i = text.indexOf(f, at); assert.ok(i >= 0, 'kept: ' + f); at = i + f.length; }
    assert.ok(text.includes('the the in a fence'));
  });

  await test('an AI\'s check: a quote found only inside a formula is not offered; the prose fix applies; the formula is unchanged', async p => {
    await p.route(origin + '/api/ai', r => r.fulfill({ json: { summary: 'two', issues: [
      { type: 'spelling', quote: 'x x', suggestion: 'x', explanation: 'repeated' },
      { type: 'spelling', quote: 'The the', suggestion: 'The', explanation: 'repeated' },
    ] } }));
    await open(p, 'Course/AI.md');
    await run(p, 'check-note');
    await p.locator('.check-modal .check-item').first().waitFor();
    assert.equal(await p.locator('.check-modal .check-item').count(), 1, await p.locator('.check-modal .check-list').innerText());
    await p.locator('.check-modal [data-act=apply]').click();
    assert.equal(await saved(p, 'Course/AI.md', 'The cat. Area $x x$ here.\n'), 'The cat. Area $x x$ here.\n');
  }, { use: { check: 'deepseek' } });

  await test('Tidy format in a read-only folder: the preview shows, Apply is refused with the reason, the file and unsaved edits stay', async p => {
    await p.evaluate(() => fetch('/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { readOnlyFolders: ['Read Only'] } }) }));
    await p.route(origin + '/api/ai', r => r.fulfill({ json: { markdown: '---\ntags: [x]\n---\n# Locked\n\n1. some text\n', changes: ['numbered'] } }));
    await open(p, 'Read Only/Locked.md');
    await run(p, 'tidy-format');
    await p.locator('.ai-tool [data-a=go]').click();
    await p.locator('.ai-tool [data-a=apply]').click();
    await p.locator('.ai-tool .ai-readonly').waitFor();
    assert.match(await p.locator('.ai-tool .ai-readonly').innerText(), /“Read Only” is a read-only folder/);
    assert.equal(await p.locator('.ai-tool .ai-after').count(), 1, 'the preview stays');
    await sleep(300);
    assert.equal(await disk('Read Only/Locked.md'), '# Locked\nsome   text\n');
    // Editing it yourself still works.
    await p.locator('.ai-tool .review-x').click();
    await p.evaluate(() => { const ed = document.getElementById('editor'); ed.value += 'my own line\n'; ed.dispatchEvent(new Event('input', { bubbles: true })); });
    assert.equal(await saved(p, 'Read Only/Locked.md', '# Locked\nsome   text\nmy own line\n'), '# Locked\nsome   text\nmy own line\n');
  });

  await test('the folder becomes read-only after the preview was made: Apply checks the settings as they are now', async p => {
    await p.evaluate(() => fetch('/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { readOnlyFolders: [] } }) }));
    await p.route(origin + '/api/ai', r => r.fulfill({ json: { markdown: '---\ntags: [x]\n---\n# Free\n\n1. some text\n', changes: [] } }));
    await open(p, 'Course/Free.md');
    await run(p, 'tidy-format');
    await p.locator('.ai-tool [data-a=go]').click();
    await p.locator('.ai-tool [data-a=apply]').waitFor();
    await p.evaluate(() => fetch('/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { readOnlyFolders: ['course'] } }) }));
    await p.locator('.ai-tool [data-a=apply]').click();
    await p.locator('.ai-tool .ai-readonly').waitFor();
    assert.equal(await disk('Course/Free.md'), '# Free\nsome   text\n');
    // Not read-only any more: Apply works.
    await p.evaluate(() => fetch('/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { readOnlyFolders: [] } }) }));
    await p.locator('.ai-tool [data-a=apply]').click();
    assert.equal(await saved(p, 'Course/Free.md', '---\ntags: [x]\n---\n# Free\n\n1. some text\n'), '---\ntags: [x]\n---\n# Free\n\n1. some text\n');
  });

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
