// The agent harness (agent.js): Find new course files and inbox filing with an API model only (DeepSeek key,
// Claude Code not connected), in a real browser against a throwaway vault and a throwaway course folder.
//   node test/agent.cjs [repo] [filter]
// Needs Playwright (GRAPHITE_PLAYWRIGHT or the Codex runtime copy) and Chrome (GRAPHITE_CHROME).
// The "provider" is a fake OpenAI-compatible server started here (GRAPHITE_TEST_AI_BASE points the server at
// it), so the whole tool loop in the server runs, with no real key and no network. Nothing outside a new
// temporary folder is read or written, except that the server is asked to read a system file and must refuse.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const http = require('node:http');
const path = require('node:path');
const repo = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

const INDEX = 'Linear Algebra/复习资料 Study Resources.md';
const INDEX_TEXT = '---\ngraph: hide\n---\n# 线性代数 资料\n\n1. 课件 Slides。\n\n[[old-slides.pdf|old]]\n';
const INBOX_TEXT = `---\ntags: [Claude]\n---\n# Claude Inbox\n\n- [x] **Interesting** · 2026-11-01 10:00 · [[Linear Algebra/Proj]] %%cap-old%% → [[Linear Algebra/Proj]] (2026-11-01)\n` +
  `- [ ] **Not familiar** · 2026-11-17 14:03 · [[Linear Algebra/Proj#2. 投影矩阵|Proj › 2]] %%cap-20261117-140312%%\n    > P = A(A^T A)^{-1} A^T\n    - Thought: why is P symmetric?\n` +
  `- [ ] **Interesting** · 2026-11-18 09:00 · [[Linear Algebra/Proj]] %%cap-20261118-090000%%\n    > least squares is a projection\n`;

/* ---------- the fake provider ---------- */
const calls = [];
function fakeProvider() {
  return http.createServer(async (req, res) => {
    let body = ''; for await (const c of req) body += c;
    const json = o => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(o)); };
    if (req.url.endsWith('/models')) return json({ data: [{ id: 'deepseek-flash' }] });
    const b = JSON.parse(body || '{}');
    calls.push({ auth: req.headers.authorization, body: b });
    const sys = b.messages[0].content, user = b.messages[1].content;
    const toolMsgs = b.messages.filter(m => m.role === 'tool');
    let n = 0;
    const call = (name, args) => ({ id: 'c' + (++n) + '_' + toolMsgs.length, type: 'function', function: { name, arguments: JSON.stringify(args) } });
    const reply = tool_calls => json({ choices: [{ finish_reason: 'tool_calls', message: { role: 'assistant', content: null, tool_calls } }] });
    if (/file a university student's course files/.test(sys)) {
      if (!toolMsgs.length) return reply([call('list_dir', { path: '' }), call('read_file', { path: process.env.SystemRoot ? path.join(process.env.SystemRoot, 'win.ini') : '/etc/hosts' }),
        call('list_dir', { path: path.join(global.coursesDir, 'UPC') }), call('read_file', { path: '.obsidian/plugins/claude-chat/imports.json' })]);
      const cands = [...user.matchAll(/^\{"id".*\}$/gm)].map(m => JSON.parse(m[0]));
      const items = cands.filter(c => c.course === 'LA').map(c => ({ id: c.id, dest: (/^HW\//.test(c.rel) ? 'Linear Algebra/作业 Homework/' : 'Linear Algebra/课件 Slides/') + c.name.replace(/\.pptx$/, '') }));
      return reply([call('submit_plan', { items, ignore: [], questions: [], note: 'Filed by course folder.' })]);
    }
    if (/were just copied into a student's notes vault/.test(sys)) {
      const files = [...user.matchAll(/^- (.+)$/gm)].map(m => m[1]);
      if (toolMsgs.length === 0) return reply([call('read_file', { path: INDEX })]);
      if (toolMsgs.length === 1) return reply([call('write_vault_file', { path: INDEX, content: '# replaced\n' })]); // drops lines: must be refused
      if (toolMsgs.length === 2) return reply([call('write_vault_file', { path: INDEX, content: INDEX_TEXT + '\n2. 作业 Homework。\n\n' + files.map(f => `[[${f.replace(/^.*\//, '')}|${f.replace(/^.*\//, '').replace(/\.pdf$/, '')}]]`).join(' ') + '\n' })]);
      return reply([call('finish', { summary: 'Index updated.' })]);
    }
    if (/file a university student's captures/.test(sys)) {
      if (!toolMsgs.length) return reply([call('read_file', { path: 'Linear Algebra/Proj.md' }), call('read_file', { path: 'Claude Brain/confusions.md' })]);
      return reply([call('submit_plan', {
        items: [
          { id: 'cap-20261117-140312', target: 'Linear Algebra/Proj.md', mode: 'append', text: '3. 投影矩阵为什么对称。\n\n$P^T = P$.\n\n来源 Source: [[Linear Algebra/Proj]]', shown: 'Proj › 3' },
          { id: 'cap-20261118-090000', target: 'Linear Algebra/最小二乘 Least Squares.md', mode: 'new', text: '---\ntags: [Linear Algebra]\n---\n1. 最小二乘是投影。\n\n来源 Source: [[Linear Algebra/Proj]]', shown: '最小二乘' },
          { id: 'cap-unknown', target: 'Linear Algebra/x.md', mode: 'new', text: 'dropped' },
          { id: 'cap-20261117-140312', target: '.obsidian/evil.md', mode: 'new', text: 'dropped' },
        ],
        edits: [{ path: 'Claude Brain/confusions.md', content: '# Confusions\n\n- Why is $P$ symmetric?\n', why: 'not familiar capture' }, { path: 'Elsewhere/x.md', content: 'no', why: 'outside the brain' }],
        summary: '2 captures.' })]);
    }
    return json({ choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'unexpected' } }] });
  });
}

async function main() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-agent-'));
  const vault = path.join(root, 'vault'), courses = path.join(root, 'DYS');
  global.coursesDir = courses;
  const put = async (p, b) => { await fs.mkdir(path.dirname(p), { recursive: true }); await fs.writeFile(p, b); };
  for (const [n, b] of Object.entries({
    'Welcome.md': 'Welcome', [INDEX]: INDEX_TEXT, 'Linear Algebra/课件 Slides/old-slides.pdf': '%PDF-1.4 old slides',
    'Linear Algebra/Proj.md': '---\ntags: [Linear Algebra]\n---\n1. 投影。\n\n2. 投影矩阵。\n', 'Claude Inbox.md': INBOX_TEXT,
    'Claude Brain/confusions.md': '# Confusions\n', 'Claude Brain/quiz-results.md': '# Quiz results\n',
  })) await put(path.join(vault, n), b);
  await put(path.join(courses, 'LA/HW/hw1.pdf'), '%PDF-1.4 homework one');
  await put(path.join(courses, 'LA/Slide/lec2.pdf'), '%PDF-1.4 lecture two, longer');
  await put(path.join(courses, 'LA/Slide/old-slides.pdf'), '%PDF-1.4 old slides'); // already in the vault (same size)
  await put(path.join(courses, 'UPC/secret.pdf'), '%PDF-1.4 left out on purpose');
  const plugSrc = path.join(repo, 'vault/.obsidian/plugins/claude-chat');
  await fs.writeFile(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['claude-chat'])).catch(async () => { await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true }); await fs.writeFile(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['claude-chat'])); });
  await fs.cp(plugSrc, path.join(vault, '.obsidian/plugins/claude-chat'), { recursive: true, filter: s => !/[\\/](chat|imports\.json)([\\/]|$)/.test(s.slice(plugSrc.length)) });

  const fake = fakeProvider();
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  process.env.GRAPHITE_TEST_AI_BASE = 'http://127.0.0.1:' + fake.address().port;
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  async function page() {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(({ courses }) => {
      localStorage.setItem('mo:lang', JSON.stringify('en'));
      localStorage.setItem('mo:pluginsOn', '1');
      // Only a DeepSeek key (test value, answered by the fake provider); Claude Code is not connected.
      localStorage.setItem('mo:ai', JSON.stringify({ keys: { deepseek: 'test-only' }, models: { deepseek: 'deepseek-flash' },
        use: { check: 'deepseek', quiz: 'off', chat: 'deepseek', import: 'deepseek', inbox: 'deepseek' }, agent: { roots: [courses], skip: ['UPC'], extras: false } }));
    }, { courses });
    const p = await ctx.newPage();
    p.setDefaultTimeout(15000);
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor();
    await p.waitForFunction(() => !!document.querySelector('.cc-find-files') && !!window.app?.plugins?.getPlugin('claude-chat'), null, { timeout: 20000 });
    return p;
  }
  async function test(name, fn) {
    if (filter && !filter.test(name)) return;
    let p;
    try { p = await page(); await fn(p); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { const chat = await p?.locator('.cc-list').innerText().catch(() => ''); if (chat) e.message += '\n  chat panel: ' + chat.slice(-600).replace(/\s+/g, ' '); results.push({ name, pass: false, error: e.message }); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').join('\n  ')); }
    finally { await p?.context().close(); }
  }
  const read = rel => fs.readFile(path.join(vault, rel), 'utf8');
  const lastReply = p => p.locator('.cc-msg.cc-claude .cc-md').last().innerText();
  const toolResults = () => calls.flatMap(c => c.body.messages.filter(m => m.role === 'tool').map(m => m.content));

  try {
    await test('import: plan from the scan, confirm, copy, update the index note (DeepSeek only, no Claude Code)', async p => {
      calls.length = 0;
      await p.locator('.cc-find-files').click();
      await p.locator('.cc-agent-plan').waitFor();
      const names = await p.locator('.cc-agent-plan .cc-agent-name').allInnerTexts();
      assert.deepEqual(names.sort(), ['hw1.pdf', 'lec2.pdf'], 'UPC and files already in the vault are not offered');
      assert.ok(!fss.existsSync(path.join(vault, 'Linear Algebra/作业 Homework/hw1.pdf')), 'nothing copied before confirming');
      // The provider got the tools, the key and the model; sandbox refusals came back as tool errors.
      assert.equal(calls[0].auth, 'Bearer test-only');
      assert.equal(calls[0].body.model, 'deepseek-flash');
      assert.deepEqual(calls[0].body.tools.map(t => t.function.name).sort(), ['list_dir', 'read_file', 'submit_plan']);
      const errs = toolResults();
      assert.ok(errs.some(t => /Not allowed: only the vault and the approved course folders/.test(t)), 'system file refused: ' + errs.join(' | '));
      assert.ok(errs.some(t => /left out/.test(t)), 'UPC refused');
      assert.ok(errs.some(t => /hidden folders/.test(t)), '.obsidian refused');
      assert.ok(!errs.some(t => /secret\.pdf/.test(t)), 'UPC never listed');
      await p.locator('.cc-agent-go').click();
      await p.waitForFunction(() => /Added 2 files/.test(document.querySelector('.cc-list')?.innerText || ''), null, { timeout: 20000 });
      assert.equal(await read('Linear Algebra/作业 Homework/hw1.pdf'), '%PDF-1.4 homework one');
      assert.equal(await read('Linear Algebra/课件 Slides/lec2.pdf'), '%PDF-1.4 lecture two, longer');
      const idx = await read(INDEX);
      assert.ok(idx.startsWith(INDEX_TEXT), 'index note kept everything it had');
      assert.match(idx, /\[\[hw1\.pdf\|hw1\]\]/);
      assert.ok(toolResults().some(t => /keep every existing line/.test(t)), 'a write that drops lines is refused');
      const manifest = JSON.parse(await read('.obsidian/plugins/claude-chat/imports.json'));
      assert.equal(Object.keys(manifest.imported).length, 2);
      assert.match(await lastReply(p), /Index notes updated/);
      // Originals untouched; UPC never copied.
      assert.equal(await fs.readFile(path.join(courses, 'LA/HW/hw1.pdf'), 'utf8'), '%PDF-1.4 homework one');
      assert.ok(!fss.existsSync(path.join(vault, 'UPC')));
    });

    await test('import again: everything is already in Graphite (no model call)', async p => {
      calls.length = 0;
      await p.locator('.cc-find-files').click();
      await p.waitForFunction(() => /Everything is already in Graphite/.test(document.querySelector('.cc-list')?.innerText || ''));
      assert.equal(calls.length, 0);
    });

    await test('inbox: cancel writes nothing; confirm files captures, ticks them, updates the Brain', async p => {
      const run = () => p.evaluate(() => window.app.plugins.getPlugin('claude-chat').fileInbox());
      await run();
      await p.locator('.cc-agent-plan').waitFor();
      assert.equal(await p.locator('.cc-agent-plan .cc-agent-item').count(), 3, 'two captures + one Brain edit (bad ones dropped)');
      await p.locator('.cc-agent-cancel').click();
      await p.waitForFunction(() => /Cancelled/.test(document.querySelector('.cc-list')?.innerText || ''));
      assert.equal(await read('Claude Inbox.md'), INBOX_TEXT);
      await run();
      await p.locator('.cc-agent-plan').waitFor();
      await p.locator('.cc-agent-go').click();
      await p.waitForFunction(() => /Filed 2 captures/.test(document.querySelector('.cc-list')?.innerText || ''), null, { timeout: 20000 });
      const proj = await read('Linear Algebra/Proj.md');
      assert.match(proj, /2\. 投影矩阵。\n\n3\. 投影矩阵为什么对称。/);
      assert.match(await read('Linear Algebra/最小二乘 Least Squares.md'), /最小二乘是投影/);
      const inbox = await read('Claude Inbox.md');
      assert.match(inbox, /- \[x\] \*\*Not familiar\*\*.*%%cap-20261117-140312%% → \[\[Linear Algebra\/Proj\|Proj › 3\]\]/);
      assert.match(inbox, /- \[x\] \*\*Interesting\*\*.*%%cap-20261118-090000%% → \[\[Linear Algebra\/最小二乘 Least Squares\|最小二乘\]\]/);
      assert.ok(!/- \[ \]/.test(inbox));
      assert.match(await read('Claude Brain/confusions.md'), /Why is \$P\$ symmetric/);
      assert.ok(!fss.existsSync(path.join(vault, 'Elsewhere')) && !fss.existsSync(path.join(vault, '.obsidian/evil.md')));
    });

    await test('apply with an unknown plan is refused', async p => {
      const r = await p.evaluate(async () => (await fetch('/api/agent', { method: 'POST', headers: { 'X-Vault': '1', 'X-AI-Key': 'test-only', 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: 'import', phase: 'apply', planId: 'nope', provider: 'deepseek', model: 'deepseek-flash' }) })).text());
      assert.match(r, /expired/);
    });
  } finally { await browser.close(); fake.close(); }
  console.log(JSON.stringify({ root, passed: results.filter(r => r.pass).length, total: results.length }, null, 1));
  return results.every(r => r.pass) ? 0 : 1;
}
main().then(c => process.exit(c), e => { console.error(e); process.exit(2); });
