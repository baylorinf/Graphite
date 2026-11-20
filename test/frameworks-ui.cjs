// Local frameworks through Graphite's normal UI, with the real DeepSeek Harness and Codex CLI (scripted local AI,
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
// isolated framework homes, temporary vaults under test/.work). Checks:
//  - an existing vault with an older Graphie chat plugin: the plugin code is updated, its settings kept; in
//    Settings → AI the job's picker shows the framework as found; choose it; run "File my Claude Inbox captures"
//    from the command menu; Cancel calls nothing; Confirm makes the framework write; the choice survives a restart;
//  - a brand-new vault (made from the sample vault, plugins off): "Find new course files" from the command menu
//    runs Graphite's own job window with Codex, one of two files unticked, only the ticked one copied;
//  - Settings shows the default course folder as D:\Task\DYS, repairs a saved "D:TaskDYS", marks folders;
//  - a missing framework: a clear message in Chinese, nothing changed, no other AI asked.
//   node test/frameworks-ui.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs'); const fsp = fs.promises; const path = require('node:path'); const crypto = require('node:crypto');
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const fake = require('./fake-llm.cjs');
const { script, seen, model } = require('./framework-model.cjs');
const repo = path.join(__dirname, '..');
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function main() {
  const root = path.join(__dirname, '.work'); await fsp.mkdir(root, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(root, 'ui-'));
  const srv = await fake.start(model);
  const dshHome = path.join(tmp, 'dsh-home'), codexHome = path.join(tmp, 'codex-home');
  await fsp.mkdir(dshHome, { recursive: true }); await fsp.mkdir(codexHome, { recursive: true });
  await fsp.writeFile(path.join(codexHome, 'config.toml'), `model = "fake-model"\nmodel_provider = "fake"\nanalytics.enabled = false\n[model_providers.fake]\nname = "Local test"\nbase_url = "${srv.url}/v1"\nenv_key = "FAKE_CODEX_KEY"\nwire_api = "responses"\nsupports_websockets = false\n`);
  Object.assign(process.env, { DSH_HOME: dshHome, DEEPSEEK_BASE_URL: srv.url, DEEPSEEK_API_KEY: 'sk-test-' + 'x'.repeat(24), DSH_TELEMETRY_DISABLED: '1', CODEX_HOME: codexHome, FAKE_CODEX_KEY: 'fake' });
  const marker = 'MARK-' + crypto.randomBytes(4).toString('hex'); script.marker = marker;
  const results = [];
  const test = async (name, fn) => { try { await fn(); results.push([name, 'PASS']); console.log('PASS ' + name); } catch (e) { results.push([name, 'FAIL']); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 6).join('\n  ')); } };
  const browser = await chromium.launch({ executablePath: chrome, headless: true });

  // ---------- an existing vault with the older chat plugin ----------
  const old = path.join(tmp, 'old-vault'), plug = path.join(old, '.obsidian/plugins/claude-chat');
  await fsp.mkdir(path.join(old, 'Algebra'), { recursive: true }); await fsp.mkdir(plug, { recursive: true });
  await fsp.writeFile(path.join(old, 'Algebra/Lesson.md'), '# Lesson\n' + marker + '\n');
  await fsp.writeFile(path.join(old, 'Claude Inbox.md'), '# Inbox\n- [ ] **Interesting** · 2026-11-20 · [[Algebra/Lesson]] %%cap-1%%\n  > First capture.\n');
  await fsp.writeFile(path.join(old, '.obsidian/community-plugins.json'), JSON.stringify(['claude-chat']));
  const shipped = path.join(repo, 'extensions/obsidian-plugins/claude-chat');
  for (const f of ['main.js', 'styles.css']) await fsp.copyFile(path.join(shipped, f), path.join(plug, f));
  await fsp.writeFile(path.join(plug, 'main.js'), (await fsp.readFile(path.join(plug, 'main.js'), 'utf8')) + '\n// old copy\n');
  await fsp.writeFile(path.join(plug, 'manifest.json'), JSON.stringify({ ...JSON.parse(await fsp.readFile(path.join(shipped, 'manifest.json'), 'utf8')), version: '1.0.0' }));
  await fsp.writeFile(path.join(plug, 'data.json'), '{"keep":"my settings"}');
  const server = require(path.join(repo, 'server.js'));
  const port = await server.start({ vault: old });
  const origin = 'http://127.0.0.1:' + port;
  const profile = path.join(tmp, 'chrome-profile');
  let ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1400, height: 900 } });
  const open = async c => {
    await c.addInitScript(() => { localStorage.setItem('mo:pluginsOn', '1'); localStorage.setItem('mo:lang', '"zh-CN"'); });
    await c.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    const p = await c.newPage(); p.setDefaultTimeout(30000);
    await p.goto(origin); await p.waitForFunction(() => !!window.myobsidianAI?.frameworks?.().dsh);
    return p;
  };
  void profile;
  let p = await open(ctx);
  const calls = [];
  p.on('request', r => { if (r.url().endsWith('/api/agent')) { const b = r.postDataJSON(); calls.push([b.framework, b.job, b.phase]); } });

  await test('old vault: the chat plugin code is updated to the shipped version, its settings kept', async () => {
    const man = JSON.parse(await fsp.readFile(path.join(plug, 'manifest.json'), 'utf8'));
    assert.notEqual(man.version, '1.0.0');
    assert.ok(!(await fsp.readFile(path.join(plug, 'main.js'), 'utf8')).includes('// old copy'));
    assert.equal(await fsp.readFile(path.join(plug, 'data.json'), 'utf8'), '{"keep":"my settings"}');
  });
  await test('Settings → AI: the framework list and each job show detection status; choose DeepSeek Harness for captures', async () => {
    await p.evaluate(async () => (await import('/settings.js')).openSettings('ai'));
    await p.locator('.fw-list [data-fw="dsh"] .fw-status.is-ok').waitFor();
    const st = await p.locator('.fw-list').innerText();
    assert.match(st, /DeepSeek Harness[\s\S]*已检测到 · 版本 0\.2\.2/); assert.match(st, /Codex CLI[\s\S]*已检测到 · 版本 0\.161/);
    const { t } = { t: await p.evaluate(async () => { const m = await import('/i18n.js'); return m.t('ai.job.inbox'); }) };
    const row = p.locator('.setting-item').filter({ has: p.getByText(t, { exact: true }) });
    await row.locator('.aip-btn').click();
    const opt = p.locator('.aip-pop [data-v="dsh"]');
    assert.match(await opt.innerText(), /DeepSeek Harness[\s\S]*已检测到/);
    await opt.click();
    assert.equal(await p.evaluate(() => window.myobsidianAI.choice('inbox')), 'dsh');
    assert.match(await row.locator('.aip-btn').innerText(), /DeepSeek Harness/);
    // The course folders are in Study settings now (shared by every AI); the AI page links there.
    assert.equal(await p.locator('[data-open-study]').count(), 1);
    await p.evaluate(async () => (await import('/settings.js')).openSettings('study'));
    await p.locator('[data-study="courseRoots"]').waitFor();
    await p.evaluate(async () => (await import('/settings.js')).closeSettings());
  });
  const runInbox = async () => {
    await p.keyboard.press('Control+p');
    const label = await p.evaluate(() => window.graphiteT('File my captures into my notes'));
    await p.locator('#modal-input').fill(label);
    // the chat plugin's command (prefixed with its name), not the app's own file-jobs window
    const name = await p.evaluate(async () => (await import('/i18n.js')).t('plug.claude-chat.name'));
    await p.locator('#modal-list .modal-item', { hasText: name }).first().click();
  };
  await test('old vault: Cancel after the plan calls nothing and changes nothing', async () => {
    script.plan = { items: [{ id: 'cap-1', target: 'Algebra/Filed.md', mode: 'new', text: '# Filed\nRead by dsh: NATIVE_MARKER', shown: 'Filed' }], summary: 'one' };
    script.readFile = path.join(old, 'Algebra/Lesson.md');
    const inbox = await fsp.readFile(path.join(old, 'Claude Inbox.md'), 'utf8');
    await runInbox();
    await p.locator('.cc-agent-go').waitFor({ timeout: 120000 });
    assert.match(await p.locator('.cc-agent-plan').innerText(), /DeepSeek Harness[\s\S]*Algebra\/Filed\.md|Algebra\/Filed\.md/);
    await p.locator('.cc-agent-cancel').click();
    await p.waitForTimeout(500);
    assert.deepEqual(calls.map(c => c[2]), ['plan']);
    assert.equal(await fsp.readFile(path.join(old, 'Claude Inbox.md'), 'utf8'), inbox);
    assert.ok(!fs.existsSync(path.join(old, 'Algebra/Filed.md')));
  });
  await test('old vault: Confirm makes DeepSeek Harness write the note in its stage; Graphite applies it; survives a restart', async () => {
    calls.length = 0; seen.writes = [];
    await runInbox();
    await p.locator('.cc-agent-go').waitFor({ timeout: 120000 });
    assert.ok(!fs.existsSync(path.join(old, 'Algebra/Filed.md')));
    await p.locator('.cc-agent-go').click();
    await p.waitForFunction(() => !document.querySelector('.cc-agent-steps') && !document.querySelector('.cc-agent-go'), null, { timeout: 120000 });
    assert.deepEqual(calls.map(c => c.join(':')), ['dsh:inbox:plan', 'dsh:inbox:apply']);
    assert.ok(seen.writes.includes('Algebra/Filed.md'), 'DeepSeek Harness did not write');
    assert.ok((await fsp.readFile(path.join(old, 'Algebra/Filed.md'), 'utf8')).includes(marker));
    assert.match(await fsp.readFile(path.join(old, 'Claude Inbox.md'), 'utf8'), /- \[x\]/);
    const state = await ctx.storageState();
    await ctx.close();
    ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1400, height: 900 }, storageState: state });
    p = await open(ctx);
    assert.equal(await p.evaluate(() => window.myobsidianAI.choice('inbox')), 'dsh');
  });
  await test('a missing DeepSeek Harness: a clear message, nothing changed, no other AI asked', async () => {
    await p.evaluate(async () => { const AI = await import('/ai.js'); await AI.setFwPath('dsh', 'C:\\nowhere\\dsh.cmd'); });
    await p.evaluate(async () => (await import('/settings.js')).openSettings('ai'));
    await p.locator('.fw-list [data-fw="dsh"] .fw-status.is-bad').waitFor();
    assert.match(await p.locator('.fw-list [data-fw="dsh"]').innerText(), /在 C:\\nowhere\\dsh\.cmd 没有找到程序/);
    await p.evaluate(async () => (await import('/settings.js')).closeSettings());
    const n = srv.log.length;
    await fsp.writeFile(path.join(old, 'Claude Inbox.md'), '# Inbox\n- [ ] **Interesting** · 2026-11-20 · [[Algebra/Lesson]] %%cap-9%%\n  > Another.\n');
    const before = await fsp.readFile(path.join(old, 'Claude Inbox.md'), 'utf8');
    await runInbox();
    await p.waitForFunction(() => /⚠️/.test(document.querySelector('.cc-list')?.innerText || ''), null, { timeout: 60000 });
    const msg = await p.locator('.cc-list').innerText();
    assert.match(msg, /在 设置 → AI 填写的路径找不到 DeepSeek Harness，这项任务没有执行/);
    assert.equal(srv.log.length, n, 'another AI was asked');
    assert.equal(await fsp.readFile(path.join(old, 'Claude Inbox.md'), 'utf8'), before);
    await p.evaluate(async () => { const AI = await import('/ai.js'); await AI.setFwPath('dsh', ''); });
  });
  await ctx.close();

  // ---------- a brand-new vault, made from the sample vault ----------
  const nv = path.join(tmp, 'new-vault'), courses = path.join(tmp, 'courses');
  fs.cpSync(path.join(repo, 'sample-vault'), nv, { recursive: true });
  await fsp.mkdir(path.join(courses, 'Algebra'), { recursive: true });
  const pdf = Buffer.from('%PDF-1.4\n' + crypto.randomBytes(3000).toString('base64') + '\n%%EOF\n');
  await fsp.writeFile(path.join(courses, 'Algebra/Slides.pdf'), pdf);
  await fsp.writeFile(path.join(courses, 'Algebra/Homework.pdf'), Buffer.from('%PDF-1.4\nhomework\n%%EOF\n'));
  await fsp.writeFile(path.join(courses, 'Algebra/Notes2.md'), '# Notes\n' + marker + '\n');
  // A second Graphite server process would be the real app; here the same module serves the new vault after a
  // restart of the module (fresh require cache).
  for (const k of Object.keys(require.cache)) if (k.startsWith(repo) && !k.includes('test')) delete require.cache[k];
  const port2 = await require(path.join(repo, 'server.js')).start({ vault: nv });
  const origin2 = 'http://127.0.0.1:' + port2;
  ctx = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1400, height: 900 } });
  await ctx.addInitScript(({ courses }) => {
    localStorage.setItem('mo:lang', '"zh-CN"');
    localStorage.setItem('mo:ai', JSON.stringify({ use: { import: 'codex' }, agent: { roots: [courses], skip: ['UPC'] } }));
  }, { courses });
  await ctx.route('**/*', r => (r.request().url().startsWith(origin2 + '/') ? r.continue() : r.abort()));
  p = await ctx.newPage(); p.setDefaultTimeout(30000);
  // Course folders now live in Study settings (one file for every AI), already saved by the first vault's start.
  await fetch(origin2 + '/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { courseRoots: [courses], skipFolders: ['UPC'] } }) });
  await p.goto(origin2); await p.waitForFunction(() => !!window.myobsidianAI?.frameworks?.().codex);
  await test('new vault: the sample vault brings the Graphie chat and Capture plugins (enabled when plugins are on)', async () => {
    const list = JSON.parse(await fsp.readFile(path.join(nv, '.obsidian/community-plugins.json'), 'utf8'));
    assert.ok(list.includes('claude-chat') && list.includes('claude-capture'));
    assert.ok(fs.existsSync(path.join(nv, '.obsidian/plugins/claude-chat/main.js')));
  });
  await test('new vault: "Find new course files" (built in) runs Codex; only the ticked file is copied, byte for byte', async () => {
    script.readFile = path.join(courses, 'Algebra/Notes2.md');
    script.plan = pr => { const ids = [...pr.matchAll(/\{"id":(\d+),[^\n]*?"name":"([^"]+)"/g)]; const s = ids.find(m => m[2] === 'Slides.pdf'), h = ids.find(m => m[2] === 'Homework.pdf'); return { items: [s && { id: +s[1], dest: 'Algebra/Slides.pdf' }, h && { id: +h[1], dest: 'Algebra/Homework.pdf' }].filter(Boolean), ignore: [], questions: [] }; };
    await p.keyboard.press('Control+p');
    const label = await p.evaluate(async () => (await import('/i18n.js')).t('cmd.find-course-files'));
    await p.locator('#modal-input').fill(label);
    await p.locator('#modal-list .modal-item').first().click();
    await p.locator('.fj-modal [data-a="apply"]').waitFor({ timeout: 120000 });
    assert.match(await p.locator('.fj-who').innerText(), /Codex CLI · 已检测到/);
    assert.match(await p.locator('.fj-reads').innerText(), /Codex CLI 自己读取了 \d+ 个文件/);
    const boxes = p.locator('.fj-modal .fj-item input');
    assert.equal(await boxes.count(), 2);
    const names = await p.locator('.fj-modal .fj-item b').allInnerTexts();
    await boxes.nth(names.indexOf('Homework.pdf')).uncheck();
    assert.ok(!fs.existsSync(path.join(nv, 'Algebra/Slides.pdf')));
    await p.locator('.fj-modal [data-a="apply"]').click();
    await p.locator('.fj-modal .review-done').waitFor({ timeout: 120000 });
    assert.deepEqual(await fsp.readFile(path.join(nv, 'Algebra/Slides.pdf')), pdf);
    assert.ok(!fs.existsSync(path.join(nv, 'Algebra/Homework.pdf')), 'an unticked file was copied');
    await p.locator('.fj-modal [data-a="close"]').click();
  });
  await test('Study settings: a saved "D:TaskDYS" is shown repaired as D:/Task/DYS; each folder is marked', async () => {
    const keep = await p.evaluate(() => fetch('/api/study-profile').then(r => r.json()).then(r => r.profile));
    await p.evaluate(async roots => { await fetch('/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { courseRoots: roots } }) }); }, ['D:TaskDYS', ...keep.courseRoots, 'relative\\folder']);
    await p.evaluate(async () => (await import('/settings.js')).openSettings('study'));
    await p.locator('[data-study="courseRoots"]').waitFor();
    assert.equal((await p.locator('[data-study="courseRoots"]').inputValue()).split('\n')[0], 'D:/Task/DYS');
    await p.locator('.fw-roots .fw-root').nth(2).waitFor();
    const marks = await p.locator('.fw-roots').innerText();
    assert.match(marks, /✓ .*courses/); assert.match(marks, /✗ relative\/folder — 不是完整路径/);
    await p.evaluate(async () => (await import('/settings.js')).closeSettings());
    await p.evaluate(async profile => { await fetch('/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ profile }) }); }, keep);
  });
  await test('new vault without the chat plugin, Claude Code chosen but not connected: says how to connect, not back to Settings', async () => {
    // Built-in plugins ship in every vault; this user removed the chat plugin (it stays removed: offered once).
    await fsp.rm(path.join(nv, '.obsidian/plugins/claude-chat'), { recursive: true, force: true });
    await fsp.writeFile(path.join(nv, '.obsidian/community-plugins.json'), JSON.stringify(['claude-capture']));
    await p.reload(); await p.waitForFunction(() => typeof window.__moFlush === 'function'); await p.waitForTimeout(500);
    await p.evaluate(async () => { const AI = await import('/ai.js'); AI.setChoice('inbox', 'claude-code'); });
    assert.equal(await p.evaluate(() => !!window.app?.plugins?.getPlugin?.('claude-chat')), false);
    await p.keyboard.press('Control+p');
    await p.locator('#modal-input').fill(await p.evaluate(async () => (await import('/i18n.js')).t('cmd.file-inbox')));
    await p.locator('#modal-list .modal-item').first().click();
    await p.locator('.fj-modal .fj-phrase').waitFor();
    assert.match(await p.locator('.fj-modal').innerText(), /connect to Graphite[\s\S]*重新检查/);
    assert.equal(await p.locator('.settings-content:visible').count(), 0, 'sent back to Settings');
    await p.locator('.fj-modal [data-a="close"]').click();
  });
  await test('new vault without the chat plugin, Claude Code connected: the job goes into its task queue and its answer shows', async () => {
    const chat = path.join(nv, '.obsidian/plugins/claude-chat/chat');
    await fsp.mkdir(path.join(chat, 'replies'), { recursive: true });
    await fsp.writeFile(path.join(chat, 'status.json'), JSON.stringify({ listening: true, at: Date.now() })); // the Claude Code watcher's heartbeat
    const beat = setInterval(() => fs.writeFileSync(path.join(chat, 'status.json'), JSON.stringify({ listening: true, at: Date.now() })), 3000);
    try {
      await p.keyboard.press('Control+p');
      await p.locator('#modal-input').fill(await p.evaluate(async () => (await import('/i18n.js')).t('cmd.file-inbox')));
      await p.locator('#modal-list .modal-item').first().click();
      await p.locator('.fj-modal .check-busy').waitFor();
      const line = (await fsp.readFile(path.join(chat, 'outbox.jsonl'), 'utf8')).trim().split('\n').pop();
      const m = JSON.parse(line);
      assert.equal(m.type, 'user'); assert.match(m.text, /captures/); assert.ok(!m.via, 'the Claude Code watcher skips messages with "via"');
      await fsp.writeFile(path.join(chat, 'replies', m.id + '.md'), 'Filed **2** captures into [[Algebra]].');
      await p.locator('.fj-modal .fj-reply').waitFor({ timeout: 15000 });
      assert.match(await p.locator('.fj-modal .fj-reply').innerText(), /Filed 2 captures/);
    } finally { clearInterval(beat); }
  });
  await browser.close(); srv.close();
  console.log(JSON.stringify({ tmp, passed: results.filter(r => r[1] === 'PASS').length, total: results.length }, null, 1));
  if (!process.env.KEEP) await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  process.exit(results.every(r => r[1] === 'PASS') ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
