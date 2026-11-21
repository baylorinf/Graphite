// "Find new course files" in the chat panel while its history is still loading, in a real browser with a new
// temporary vault (made-up chat history; Claude Code's answers are written by the test). The reads of the history
// are held back on purpose, so the order is the same every time:
//  1. a finished search whose answer is still being read: the first click starts a new search (exactly one);
//  2. the old history arrives after a new search was sent and answered: the new one and its answer stay, also
//     after reopening;
//  3. clicks in quick succession start one search; a search really waiting for its answer blocks a second one.
//   node test/chat-import-ui.cjs
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const repo = path.join(__dirname, '..');
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const OLD = { type: 'user', id: 'm-old-import', at: '2026-11-20 09:00', text: 'Find new course files on this computer and add them to Graphite.', task: 'import', note: '', study: '', selection: '' };

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-chat-import-'));
  const chat = path.join(vault, '.obsidian/plugins/claude-chat/chat');
  await fs.mkdir(path.join(chat, 'replies'), { recursive: true });
  await fs.writeFile(path.join(vault, 'Welcome.md'), 'Welcome');
  const reset = async () => {
    await fs.writeFile(path.join(chat, 'outbox.jsonl'), JSON.stringify(OLD) + '\n');
    for (const f of await fs.readdir(path.join(chat, 'replies'))) await fs.rm(path.join(chat, 'replies', f));
    await fs.writeFile(path.join(chat, 'replies', 'm-old-import.md'), 'OLD SEARCH DONE: 2 files added.');
  };
  const outbox = async () => (await fs.readFile(path.join(chat, 'outbox.jsonl'), 'utf8')).trim().split('\n').map(l => JSON.parse(l));
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  // gates: { 'm-old-import.md': promise, 'outbox.jsonl': promise } hold the first GET of that file.
  async function test(name, gates, fn) {
    await reset();
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
    await ctx.addInitScript(() => { localStorage.setItem('mo:lang', JSON.stringify('en')); localStorage.setItem('mo:ai', JSON.stringify({ use: { import: 'claude-code', chat: 'claude-code' } })); });
    const held = new Set();
    await ctx.route('**/*', async r => {
      const url = decodeURIComponent(r.request().url());
      if (!r.request().url().startsWith(origin + '/')) return r.abort();
      for (const [file, gate] of Object.entries(gates)) {
        if (r.request().method() === 'GET' && url.includes(file) && !held.has(file)) {
          held.add(file);
          const res = await r.fetch();                 // the server has answered with the file as it was then…
          await Promise.race([gate, sleep(10000)]);    // …and that answer reaches the page only now (10 s at most)
          return r.fulfill({ response: res });
        }
      }
      return r.continue();
    });
    const p = await ctx.newPage();
    p.__held = held;
    p.setDefaultTimeout(8000);
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    const notices = []; p.__notices = notices;
    await p.exposeFunction('__notice', t => notices.push(t));
    await p.addInitScript(() => new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('notice')) window.__notice(n.textContent); }).observe(document, { childList: true, subtree: true }));
    try {
      await p.goto(origin, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.app?.plugins?.getPlugin?.('claude-chat')?.pane);
      await fn(p);
      if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
      results.push(true); console.log('PASS ' + name);
    } catch (e) { results.push(false); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 8).join('\n  ')); }
    finally { await ctx.close(); }
  }
  const find = p => p.evaluate(() => window.app.plugins.getPlugin('claude-chat').findFiles());
  const imports = async () => (await outbox()).filter(m => m.task === 'import');

  {
    let release; const gate = new Promise(r => { release = r; });
    await test('a finished search whose answer is still loading: the first click starts one new search, no "already looking"', { 'm-old-import.md': gate }, async p => {
      // Click while the history load is really waiting for that old answer.
      for (let i = 0; i < 100 && !p.__held.has('m-old-import.md'); i++) await sleep(50);
      assert.ok(p.__held.has('m-old-import.md'), 'the old answer is being read');
      const clicked = find(p);
      await sleep(300);
      release();
      await clicked;
      await sleep(200);
      assert.equal((await imports()).length, 2, 'the old one and exactly one new one');
      assert.ok(!p.__notices.some(n => /already looking/.test(n)), p.__notices.join(' | '));
    });
  }

  await test('the old history arrives after a new search was sent and answered: the new search and its answer stay, also after reopening', {}, async p => {
    // The history as the server had it before the new search (an old read that answers late) …
    await p.evaluate(async () => { const c = window.app.plugins.getPlugin('claude-chat'); await c.whenLoaded(); window.__oldOutbox = await c.app.vault.adapter.read(c.dir + '/outbox.jsonl'); });
    await find(p);
    const fresh = (await imports()).at(-1);
    assert.notEqual(fresh.id, OLD.id);
    await fs.writeFile(path.join(chat, 'replies', fresh.id + '.md'), 'NEW SEARCH RECEIPT: 3 files added.');
    await p.waitForFunction(() => /NEW SEARCH RECEIPT/.test(document.querySelector('.cc-list')?.innerText || ''), null, { timeout: 6000 });
    // … arrives now: the history is read again and that read returns the old snapshot.
    await p.evaluate(async () => {
      const c = window.app.plugins.getPlugin('claude-chat'), a = c.app.vault.adapter, read = a.read.bind(a);
      a.read = async path => (path.endsWith('outbox.jsonl') ? window.__oldOutbox : read(path));
      try { await c.loadChat(); } finally { a.read = read; }
    });
    const shown = await p.locator('.cc-list').innerText();
    assert.match(shown, /NEW SEARCH RECEIPT/, 'the new search stays in the chat');
    assert.match(shown, /OLD SEARCH DONE/, 'the old history is there too');
    await p.reload(); await p.waitForFunction(() => window.app?.plugins?.getPlugin?.('claude-chat')?.pane);
    await p.waitForFunction(() => /NEW SEARCH RECEIPT/.test(document.querySelector('.cc-list')?.innerText || ''));
  });

  await test('clicks in quick succession start one search; a search still waiting for its answer blocks another; the fast path is unchanged', {}, async p => {
    await p.evaluate(() => { const c = window.app.plugins.getPlugin('claude-chat'); c.findFiles(); c.findFiles(); return c.findFiles(); });
    await sleep(300);
    assert.equal((await imports()).length, 2, 'the old one and one new one');
    await find(p);
    await sleep(200);
    assert.equal((await imports()).length, 2, 'still one new search');
    assert.ok(p.__notices.some(n => /already looking/.test(n)));
    await p.waitForFunction(() => /OLD SEARCH DONE/.test(document.querySelector('.cc-list')?.innerText || ''));
  });

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
