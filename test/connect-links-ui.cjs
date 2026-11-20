// "Connect this note" and Markdown link clicks in a real browser, with a new temporary vault of made-up notes
// (the AI's answers are simulated; the note-links endpoint is the real one). Checks: a double click sends one
// request; the proposals are shown as "this → that" to tick; Cancel or closing writes nothing; confirming sends
// one POST /api/note-links {source, targets} and the links appear both ways; a failed write keeps the ticks with
// Retry; read-only folders (Study settings) are never written; Claude Code gets the same preview through its job
// queue; an older bundled chat plugin is upgraded in place. And links to names with "#" or "%" open the right note.
//   node test/connect-links-ui.cjs [filter]
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = path.join(__dirname, '..');
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SHIP = path.join(repo, 'extensions/obsidian-plugins/claude-chat');

const NOTES = {
  'Welcome.md': 'Welcome',
  'Course/A.md': '# A\n\nEigenvalues of a matrix.\n',
  'Course/B.md': '# B\n\nCharacteristic polynomial.\n',
  'Course/C.md': '# C\n\nDiagonalization.\n',
  'Locked/L.md': '# L\n\nA locked note.\n',
  'Question.md': '# Question\n\n## Proof\n\nplain question\n',
  'Question#1.md': '# Question 1\n\nfiller\n\n## Proof\n\nhash question\n',
  'Course/Grade100%.md': '# Grade\n\npercent note\n',
  'Links.md': '# Links\n\n[Hash](Question%231.md) · [Hash proof](Question%231.md#Proof) · [Plain proof](Question.md#Proof) · [Plain percent](Course/Grade100%.md) · [Encoded percent](Course/Grade100%25.md)\n',
};

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-connect-'));
  const plug = path.join(vault, '.obsidian/plugins/claude-chat');
  await fs.mkdir(path.join(plug, 'chat/replies'), { recursive: true });
  for (const f of ['main.js', 'styles.css']) await fs.copyFile(path.join(SHIP, f), path.join(plug, f));
  const ship = JSON.parse(await fs.readFile(path.join(SHIP, 'manifest.json'), 'utf8'));
  await fs.writeFile(path.join(plug, 'manifest.json'), JSON.stringify({ ...ship, version: '1.2.0' }));
  await fs.writeFile(path.join(plug, 'data.json'), JSON.stringify({ mine: 'kept' }));
  const history = JSON.stringify({ type: 'user', id: 'm-old-1', text: 'OLD QUESTION', at: '2026-11-10' }) + '\n';
  await fs.writeFile(path.join(plug, 'chat/outbox.jsonl'), history);
  await fs.writeFile(path.join(plug, 'chat/replies/m-old-1.md'), 'OLD ANSWER');
  await fs.writeFile(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['claude-chat']));
  await fs.writeFile(path.join(vault, '.obsidian/graphite-builtins.json'), JSON.stringify({ offered: ['claude-capture', 'claude-chat', 'claude-quizzes'] }));
  for (const [n, b] of Object.entries(NOTES)) { await fs.mkdir(path.dirname(path.join(vault, n)), { recursive: true }); await fs.writeFile(path.join(vault, n), b); }
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const disk = n => fs.readFile(path.join(vault, n), 'utf8');
  const reset = async () => { for (const n of ['Course/A.md', 'Course/B.md', 'Course/C.md', 'Locked/L.md']) await fs.writeFile(path.join(vault, n), NOTES[n]); };
  const setReadOnly = (p, folders) => p.evaluate(f => fetch('/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { readOnlyFolders: f } }) }), folders);
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  async function page({ via = 'deepseek' } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(via => {
      localStorage.setItem('mo:lang', JSON.stringify('en'));
      localStorage.setItem('mo:ai', JSON.stringify({ keys: { deepseek: 'test-only' }, models: { deepseek: 'deepseek-flash' }, use: { check: 'off', quiz: 'off', chat: 'off', inbox: 'off', format: 'off', connect: via } }));
    }, via);
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    const errors = []; p.on('pageerror', e => errors.push(e.message)); p.__errors = errors;
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor({ state: 'attached' });
    await p.waitForFunction(() => window.app?.plugins?.getPlugin?.('claude-chat') && window.app?.commands);
    return p;
  }
  async function test(name, fn, opts) {
    if (filter && !filter.test(name)) return;
    let p;
    try { await reset(); p = await page(opts); await fn(p); if (p.__errors.length) throw new Error('page errors: ' + p.__errors.join(' | ')); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { results.push({ name, pass: false }); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 10).join('\n  ')); }
    finally { if (p) await setReadOnly(p, []).catch(() => {}); await p?.context().close(); }
  }
  const open = async (p, file) => { await p.evaluate(f => window.app.workspace.openLinkText(f, ''), file); await p.waitForFunction(f => window.app.workspace.getActiveFile()?.path === f, file); };
  const proposals = (p, related, hold = null) => {
    const asked = [];
    return p.route(origin + '/api/ai', async r => { asked.push(1); if (hold) await hold; return r.fulfill({ json: { related } }); }).then(() => asked);
  };
  const posts = async p => { const list = []; await p.route(origin + '/api/note-links', r => { list.push(JSON.parse(r.request().postData())); return r.continue(); }); return list; };
  const connectBtn = '.cc-connect-note';

  await test('upgrade: the older bundled chat plugin is replaced in place; its settings and chat history stay', async () => {
    assert.equal(JSON.parse(await disk('.obsidian/plugins/claude-chat/manifest.json')).version, ship.version);
    assert.notEqual(ship.version, '1.2.0');
    assert.equal(JSON.parse(await disk('.obsidian/plugins/claude-chat/data.json')).mine, 'kept');
    assert.equal(await disk('.obsidian/plugins/claude-chat/chat/outbox.jsonl'), history);
    assert.equal(await disk('.obsidian/plugins/claude-chat/chat/replies/m-old-1.md'), 'OLD ANSWER');
  });

  await test('double click asks the AI once; the proposals show "A → B"; Cancel writes nothing', async p => {
    let release; const hold = new Promise(r => { release = r; });
    const asked = await proposals(p, [{ title: 'B', why: 'shared idea' }, { title: 'Nope', why: 'does not exist' }], hold);
    const sent = await posts(p);
    await open(p, 'Course/A.md');
    await p.locator(connectBtn).evaluate(b => { b.click(); b.click(); });
    assert.equal(await p.locator(connectBtn).isDisabled(), true, 'busy before the answer');
    release();
    await p.locator('.cc-connect-modal .cc-connect-row').first().waitFor();
    assert.equal(asked.length, 1);
    assert.deepEqual(await p.locator('.cc-connect-modal .cc-connect-pair').allInnerTexts(), ['A → B'], 'only notes that exist');
    await p.locator('.cc-connect-modal [data-connect=cancel]').click();
    await sleep(300);
    assert.equal(sent.length, 0);
    assert.equal(await disk('Course/A.md'), NOTES['Course/A.md']); assert.equal(await disk('Course/B.md'), NOTES['Course/B.md']);
    assert.equal(await p.locator(connectBtn).isDisabled(), false, 'ready again');
  });

  await test('closing with Esc writes nothing either', async p => {
    await proposals(p, [{ title: 'B' }]);
    const sent = await posts(p);
    await open(p, 'Course/A.md');
    await p.locator(connectBtn).click();
    await p.locator('.cc-connect-modal .cc-connect-row').first().waitFor();
    await p.keyboard.press('Escape');
    await sleep(300);
    assert.equal(sent.length, 0);
    assert.equal(await disk('Course/A.md'), NOTES['Course/A.md']);
  });

  await test('confirm the ticked ones: one POST {source, targets}; the links are added both ways; the chat records it', async p => {
    await proposals(p, [{ title: 'B', why: 'polynomial' }, { path: 'Course/C.md', why: 'next topic' }]);
    const sent = await posts(p);
    await open(p, 'Course/A.md');
    await p.locator(connectBtn).click();
    await p.locator('.cc-connect-modal .cc-connect-row').nth(1).waitFor();
    await p.locator('.cc-connect-modal input[data-i="1"]').uncheck();     // only A → B
    await p.locator('.cc-connect-modal [data-connect=confirm]').click();
    await p.locator('.cc-connect-modal').waitFor({ state: 'detached' });
    assert.deepEqual(sent, [{ source: 'Course/A.md', targets: ['Course/B.md'] }]);
    assert.match(await disk('Course/A.md'), /B/);
    assert.notEqual(await disk('Course/B.md'), NOTES['Course/B.md'], 'the back-link');
    assert.equal(await disk('Course/C.md'), NOTES['Course/C.md'], 'unticked: untouched');
    await p.waitForFunction(() => /Linked “A” with/.test(document.querySelector('.cc-list')?.innerText || ''));
  });

  await test('a failed write keeps the window and the ticks with Retry; Retry links them once', async p => {
    await proposals(p, [{ title: 'B' }, { title: 'C' }]);
    let fail = true; const sent = [];
    await p.route(origin + '/api/note-links', r => { sent.push(JSON.parse(r.request().postData())); if (fail) return r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'disk busy', paths: ['Course/B.md'] }) }); return r.continue(); });
    await open(p, 'Course/A.md');
    await p.locator(connectBtn).click();
    await p.locator('.cc-connect-modal .cc-connect-row').nth(1).waitFor();
    await p.locator('.cc-connect-modal input[data-i="0"]').uncheck();
    await p.locator('.cc-connect-modal [data-connect=confirm]').click();
    await p.locator('.cc-connect-modal .cc-connect-error').filter({ hasText: 'disk busy' }).waitFor();
    assert.match(await p.locator('.cc-connect-modal .cc-connect-error').innerText(), /Not linked: disk busy \(Course\/B\.md\)/);
    assert.equal(await p.locator('.cc-connect-modal input[data-i="0"]').isChecked(), false, 'your choice stays');
    assert.equal(await p.locator('.cc-connect-modal input[data-i="1"]').isChecked(), true);
    assert.equal(await p.locator('.cc-connect-modal [data-connect=confirm]').innerText(), 'Retry');
    fail = false;
    await p.locator('.cc-connect-modal [data-connect=confirm]').evaluate(b => { b.click(); b.click(); });
    await p.locator('.cc-connect-modal').waitFor({ state: 'detached' });
    assert.equal(sent.length, 2, 'the retry is sent once');
    assert.deepEqual(sent[1], { source: 'Course/A.md', targets: ['Course/C.md'] });
    assert.equal(await disk('Course/B.md'), NOTES['Course/B.md']);
    assert.notEqual(await disk('Course/C.md'), NOTES['Course/C.md']);
  });

  await test('read-only folders (Study settings): a locked target can\'t be ticked; a locked source can\'t be linked at all', async p => {
    await setReadOnly(p, ['Locked']);
    await proposals(p, [{ title: 'L' }, { title: 'B' }]);
    const sent = await posts(p);
    await open(p, 'Course/A.md');
    await p.locator(connectBtn).click();
    await p.locator('.cc-connect-modal .cc-connect-row').nth(1).waitFor();
    assert.equal(await p.locator('.cc-connect-modal input[data-i="0"]').isDisabled(), true);
    assert.match(await p.locator('.cc-connect-modal .cc-connect-row').first().innerText(), /Read-only folder “Locked”: not linked/);
    await p.locator('.cc-connect-modal [data-connect=confirm]').click();
    await p.locator('.cc-connect-modal').waitFor({ state: 'detached' });
    assert.deepEqual(sent, [{ source: 'Course/A.md', targets: ['Course/B.md'] }]);
    assert.equal(await disk('Locked/L.md'), NOTES['Locked/L.md']);
    // The locked note itself as the source: nothing can be confirmed.
    await open(p, 'Locked/L.md');
    await p.locator(connectBtn).click();
    await p.locator('.cc-connect-modal .cc-connect-locked').waitFor();
    assert.equal(await p.locator('.cc-connect-modal [data-connect=confirm]').isDisabled(), true);
    await p.locator('.cc-connect-modal [data-connect=cancel]').click();
    assert.equal(await disk('Locked/L.md'), NOTES['Locked/L.md']);
    assert.equal(sent.length, 1);
  });

  await test('Claude Code: the job goes through its queue (no file edits by it); Graphite shows the same preview and writes', async p => {
    const chat = path.join(plug, 'chat');
    const beat = setInterval(() => fss.writeFileSync(path.join(chat, 'status.json'), JSON.stringify({ listening: true, at: Date.now() })), 1000);
    fss.writeFileSync(path.join(chat, 'status.json'), JSON.stringify({ listening: true, at: Date.now() }));
    const answer = (async () => {
      for (let i = 0; i < 100; i++) {
        const jobs = (await fs.readdir(path.join(chat, 'tasks')).catch(() => [])).filter(f => f.endsWith('.json'));
        for (const j of jobs) {
          const job = JSON.parse(await fs.readFile(path.join(chat, 'tasks', j), 'utf8'));
          if (job.task !== 'ai-connect' || fss.existsSync(path.join(chat, 'replies', j))) continue;
          assert.equal(job.note, 'Course/A.md'); assert.ok(job.candidates.includes('Course/B.md'));
          await fs.writeFile(path.join(chat, 'replies', j), JSON.stringify({ related: [{ path: 'Course/B.md', title: 'B', why: 'from Claude Code' }] }));
          return job;
        }
        await sleep(100);
      }
      throw new Error('no ai-connect job');
    })();
    try {
      const sent = await posts(p);
      await open(p, 'Course/A.md');
      await p.locator(connectBtn).click();
      await answer;
      await p.locator('.cc-connect-modal .cc-connect-row').first().waitFor({ timeout: 15000 });
      assert.match(await p.locator('.cc-connect-modal').innerText(), /from Claude Code/);
      await p.locator('.cc-connect-modal [data-connect=confirm]').click();
      await p.locator('.cc-connect-modal').waitFor({ state: 'detached' });
      assert.deepEqual(sent, [{ source: 'Course/A.md', targets: ['Course/B.md'] }]);
    } finally { clearInterval(beat); }
  }, { via: 'claude-code' });

  for (const [label, want, heading] of [['Hash', 'Question#1.md', ''], ['Hash proof', 'Question#1.md', 'Proof'], ['Plain proof', 'Question.md', 'Proof'], ['Plain percent', 'Course/Grade100%.md', ''], ['Encoded percent', 'Course/Grade100%.md', '']]) {
    await test(`Markdown link “${label}” opens ${want}${heading ? ' at #' + heading : ''}`, async p => {
      await open(p, 'Links.md');
      await p.evaluate(() => window.app.commands.executeCommandById('toggle-preview')).catch(() => {});
      const link = p.locator('#preview a', { hasText: new RegExp('^' + label + '$') });
      await link.waitFor();
      await link.click();
      await p.waitForFunction(w => window.app.workspace.getActiveFile()?.path === w, want);
      if (heading) await p.waitForFunction(() => /hash question|plain question/.test(document.querySelector('#preview')?.innerText || document.getElementById('editor')?.value || ''));
    });
  }

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
