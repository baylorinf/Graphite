// 1.1.41 acceptance checks, in a real browser against throwaway vaults (nothing outside new temp folders is
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
// touched: GRAPHITE_HOME and GRAPHITE_CLAUDE_DIR point into the temp folder too).
//   node test/v1141.cjs [filter]
// Covers: tab close button, page ranges (exam + summary), PDF position per vault, review "done" page keys,
// Study settings (migration, save, used by API / local framework / Claude Code jobs), Graphite names and the
// "Run by" label, Summarize this PDF (two same-named lectures, page links, regenerate choices, scanned pages,
// stop, write failure), the feature manual.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const repo = path.resolve(process.env.GRAPHITE_REPO || path.join(__dirname, '..'));
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A PDF with `n` pages; pages in `empty` have no text (like scanned pages).
function pdf(n, empty = [], label = 'P') {
  const objects = [];
  const add = s => { objects.push(s); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Count ' + n + ' /Kids [' + Array.from({ length: n }, (_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 1; i <= n; i++) {
    const data = empty.includes(i) ? 'q Q\n' : 'BT /F1 9 Tf 20 220 Td 11 TL (' + label + '-page-' + i + ') Tj T* (Topic ' + i + ' explained here) Tj ET\n';
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (3 + i * 2) + ' 0 R >>');
    add('<< /Length ' + data.length + ' >>\nstream\n' + data + 'endstream');
  }
  let out = '%PDF-1.4\n';
  const offsets = objects.map((s, i) => { const j = out.length; out += (i + 1) + ' 0 obj\n' + s + '\nendobj\n'; return j; });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(j => String(j).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(out + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n', 'ascii');
}
async function writeTree(root, files) {
  for (const [n, b] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(root, n)), { recursive: true }); await fs.writeFile(path.join(root, n), b); }
}

// A server for one vault, in its own process (each vault gets the same port, like the desktop app reopening).
function startServer(vault, port, env) {
  return new Promise((resolve, reject) => {
    const code = `require(${JSON.stringify(path.join(repo, 'server.js'))}).start({ vault: ${JSON.stringify(vault)}, port: ${port} }).then(p => console.log('PORT ' + p))`;
    const child = spawn(process.execPath, ['-e', code], { env: { ...process.env, ...env, NO_OPEN: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let buf = '';
    child.stdout.on('data', d => { buf += d; const m = buf.match(/PORT (\d+)/); if (m) resolve({ child, port: +m[1] }); });
    child.stderr.on('data', d => { buf += d; });
    child.on('exit', c => reject(new Error('server exited ' + c + ': ' + buf)));
  });
}

async function main() {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-1141-'));
  const home = path.join(tmp, 'graphite-home'), claudeDir = path.join(tmp, 'claude');
  const env = { GRAPHITE_HOME: home, GRAPHITE_CLAUDE_DIR: claudeDir };
  Object.assign(process.env, env);
  const A = path.join(tmp, 'A'), B = path.join(tmp, 'B'), courses = path.join(tmp, 'courses');
  await writeTree(A, {
    'Welcome.md': 'Welcome',
    'Algebra/Lecture.pdf': pdf(15, [], 'ALG'),
    'Exam3.pdf': pdf(3, [], 'EX'),
    'Scan.pdf': pdf(2, [1, 2], 'SC'),
    'Linear Algebra/讲义.pdf': pdf(4, [3], 'LA'),
    'Calculus/讲义.pdf': pdf(3, [], 'CA'),
    'LA/Imported.pdf': pdf(2, [], 'IM'),
    'Linear Algebra/Index.md': '# LA\n',
    'Locked/Readme.md': 'locked\n',
    'Review.md': 'What is one? :: 1\n',
  });
  await writeTree(B, { 'Welcome.md': 'B vault', 'Algebra/Lecture.pdf': pdf(15, [], 'BLG') });
  await writeTree(courses, { 'LA/HW/hw1.pdf': pdf(1, [], 'H'), 'UPC/secret.pdf': pdf(1, [], 'S') });
  // Old settings: Claude Code's copy (with a different course folder than the AI page) — migrated on first start.
  await writeTree(claudeDir, { 'graphite.json': JSON.stringify({ vault: A, studyRoot: path.join(tmp, 'old-claude-root'), courses: { LA: 'Linear Algebra' }, skipFolders: ['UPC'], recentFolders: ['Downloads'], brainFolder: 'Claude Brain', readOnlyFolders: ['Locked'], noteLanguage: 'English' }) });
  // An earlier import, so "Summarize" can offer the mapped course folder.
  await writeTree(A, { '.obsidian/plugins/claude-chat/imports.json': JSON.stringify({ imported: { [path.join(courses, 'LA/HW/hw1.pdf').replace(/\\/g, '/')]: { dest: 'LA/Imported.pdf' } } }) });

  // A stand-in model for every AI (API provider, DeepSeek Harness, Codex CLI): records what each one was told.
  const MARK_LANG = 'Klingon-test';
  const SUMMARY = { title: 'Lecture summary', overview: 'Overview in ' + MARK_LANG, sections: [{ heading: 'Part one', page: 2, points: [{ text: 'Point on page two', page: 2 }, { text: 'Point with a made-up page', page: 9 }] }], concepts: [{ term: 'Term', meaning: 'Meaning', page: 1 }], formulas: [{ latex: 'a^2+b^2=c^2', meaning: 'Pythagoras', page: 2 }] };
  const llm = await require('./fake-llm.cjs').start(async req => {
    const all = JSON.stringify(req.body);
    if (/You summarize one PDF/.test(all)) return { text: (req.api === 'chat' ? '' : 'Done.\n<graphite-result>') + JSON.stringify(SUMMARY) + (req.api === 'chat' ? '' : '</graphite-result>') };
    if (/file a university student's course files/.test(all)) {
      const cands = [...all.matchAll(/\{\\"id\\":(\d+),\\"src\\":\\"([^\\]+)/g)].map(m => ({ id: +m[1], src: m[2] }));
      const items = cands.map(c => ({ id: c.id, dest: (/secret/.test(c.src) ? 'Locked/' : 'Linear Algebra/作业 Homework/') + c.src.split('/').pop() }));
      if (req.api === 'chat' || req.api === 'anthropic' && req.body.tools?.some(t => t.name === 'submit_plan')) return { tool: { name: 'submit_plan', input: { items, note: 'ok' } } };
      return { text: '<graphite-result>' + JSON.stringify({ items, note: 'ok' }) + '</graphite-result>' };
    }
    return { text: 'ok' };
  });
  const codexHome = path.join(tmp, 'codex-home'), dshHome = path.join(tmp, 'dsh-home');
  await fs.mkdir(codexHome, { recursive: true }); await fs.mkdir(dshHome, { recursive: true });
  await fs.writeFile(path.join(codexHome, 'config.toml'), `model = "fake-model"\nmodel_provider = "fake"\nanalytics.enabled = false\n[model_providers.fake]\nname = "Local test"\nbase_url = "${llm.url}/v1"\nenv_key = "FAKE_CODEX_KEY"\nwire_api = "responses"\nsupports_websockets = false\n`);
  Object.assign(env, { GRAPHITE_TEST_AI_BASE: llm.url, CODEX_HOME: codexHome, FAKE_CODEX_KEY: 'fake', DSH_HOME: dshHome, DEEPSEEK_BASE_URL: llm.url, DEEPSEEK_API_KEY: 'sk-test-' + 'x'.repeat(24), DSH_TELEMETRY_DISABLED: '1' });
  const promptsFor = re => llm.log.filter(e => re.test(JSON.stringify(e.body))).map(e => JSON.stringify(e.body));

  const srvA = await startServer(A, 0, env);
  const PORT = srvA.port;
  let srv = srvA;
  const switchTo = async v => { srv.child.kill(); await sleep(300); srv = await startServer(v, PORT, env); };
  const origin = 'http://127.0.0.1:' + PORT;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
  await ctx.addInitScript(() => {
    if (!localStorage.getItem('mo:lang')) localStorage.setItem('mo:lang', JSON.stringify('en'));
    // The old Settings → AI value (left-out name and course folder differ from Claude Code's copy).
    if (!localStorage.getItem('mo:ai')) localStorage.setItem('mo:ai', JSON.stringify({ keys: { deepseek: 'test-only' }, models: { deepseek: 'deepseek-flash' }, use: { check: 'deepseek', summary: 'deepseek', exam: 'deepseek', chat: 'deepseek' }, agent: { roots: ['C:/old-ai-root'], skip: ['Private'], extras: false } }));
  });
  const aiCalls = [];
  let aiReply = null, aiDelay = 0;
  await ctx.route(origin + '/api/ai', async r => {
    const body = JSON.parse(r.request().postData() || '{}');
    aiCalls.push(body);
    if (aiDelay) await sleep(aiDelay);
    if (aiReply) return aiReply(r, body);
    return r.continue(); // to Graphite's server, which sends it to the stand-in model (GRAPHITE_TEST_AI_BASE)
  });
  const localCalls = [];
  let localReply = null;
  await ctx.route(origin + '/api/local-ai', async r => {
    const body = JSON.parse(r.request().postData() || '{}');
    localCalls.push(body);
    if (localReply) return localReply(r, body);
    return r.continue();
  });
  const results = [];
  let p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  p.on('dialog', d => d.accept());
  const errors = [];
  p.on('pageerror', e => errors.push(e.message));
  const load = async () => { await p.goto(origin, { waitUntil: 'domcontentloaded' }); await p.locator('#tree [data-path="Welcome.md"]').waitFor(); await p.waitForFunction(() => typeof window.__moFlush === 'function'); await sleep(300); };
  await load();
  async function test(name, fn) {
    if (filter && !filter.test(name)) return;
    try { await fn(); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { const toast = await p.locator('#toast').innerText().catch(() => ''); results.push({ name, pass: false }); console.log('FAIL ' + name + '\n  ' + String(e.message).split('\n').slice(0, 8).join('\n  ') + (toast ? '\n  last toast: ' + toast : '')); }
  }
  const openFile = async f => { await p.locator(`#tree [data-path="${f}"]`).first().click(); };
  const expand = async folder => { const el = p.locator(`#tree [data-path="${folder}"]`).first(); if (await el.count()) { const open = await p.locator(`#tree [data-path^="${folder}/"]`).count(); if (!open) await el.click(); } };

  try {
    await test('smoke: app loads without page errors', async () => {
      assert.deepEqual(errors, []);
    });
    if (process.env.SMOKE) return;

    /* ---------- 3.1 tab close button ---------- */
    await test('tabs: × stays inside its own tab and closes that tab (6 and 16 tabs, 1000 px, both sidebars, zoom, hover, keyboard)', async () => {
      await p.setViewportSize({ width: 1000, height: 800 });
      if (await p.evaluate(() => document.getElementById('app').classList.contains('right-collapsed'))) await p.locator('[data-cmd="toggle-right"]').first().click();
      if (await p.evaluate(() => document.getElementById('app').classList.contains('left-collapsed'))) await p.locator('[data-cmd="toggle-left"]').first().click();
      const count = () => p.locator('#tabbar .tab').count();
      for (const [n, zoom] of [[6, 1], [16, 1], [16, 1.25]]) {
        await p.evaluate(z => { document.documentElement.style.zoom = String(z); }, zoom);
        while (await count() < n) { await p.keyboard.press('Control+t'); await sleep(40); }
        const boxes = await p.evaluate(() => [...document.querySelectorAll('#tabbar .tab')].map(tb => { const a = tb.getBoundingClientRect(), x = tb.querySelector('.tab-x').getBoundingClientRect(); return { id: tb.dataset.tab, l: a.left, r: a.right, xl: x.left, xr: x.right, xw: x.width }; }));
        for (const b of boxes) {
          assert.ok(b.xw >= 16, 'close button squeezed: ' + JSON.stringify(b));
          assert.ok(b.xl >= b.l - 0.5 && b.xr <= b.r + 0.5, `× outside its tab at ${n} tabs, zoom ${zoom}: ` + JSON.stringify(b));
        }
        // Click the × of a non-active tab in the middle (made visible by hovering) and of the active tab.
        for (const which of ['middle', 'active']) {
          const before = await count();
          const target = which === 'active' ? p.locator('#tabbar .tab.active') : p.locator('#tabbar .tab:not(.active)').nth(Math.floor((before - 1) / 2));
          await target.scrollIntoViewIfNeeded();
          const id = await target.getAttribute('data-tab');
          await target.hover();
          const x = target.locator('.tab-x');
          const bb = await x.boundingBox();
          await p.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
          await sleep(80);
          assert.equal(await count(), before - 1, `${which} × did not close a tab`);
          assert.equal(await p.locator(`#tabbar .tab[data-tab="${id}"]`).count(), 0, `${which}: another tab was closed`);
        }
      }
      await p.evaluate(() => { document.documentElement.style.zoom = ''; });
      // Keyboard: Ctrl+W closes the active tab; the × is a real button (Enter / Space when focused).
      let before = await count();
      await p.keyboard.press('Control+w'); await sleep(80);
      assert.equal(await count(), before - 1);
      before = await count();
      const victim = await p.locator('#tabbar .tab').first().getAttribute('data-tab');
      await p.locator('#tabbar .tab').first().locator('.tab-x').focus();
      await p.keyboard.press('Enter'); await sleep(80);
      assert.equal(await count(), before - 1);
      assert.equal(await p.locator(`#tabbar .tab[data-tab="${victim}"]`).count(), 0);
      // Dragging still reorders (the tab, not its button, is draggable).
      assert.equal(await p.locator('#tabbar .tab').first().getAttribute('draggable'), 'true');
      assert.equal(await p.locator('#tabbar .tab-x').first().getAttribute('draggable'), 'false');
      while (await count() > 1) { await p.keyboard.press('Control+w'); await sleep(30); }
      await p.setViewportSize({ width: 1400, height: 900 });
    });

    /* ---------- 3.2 page ranges are checked before any AI is asked ---------- */
    await test('pages: parsePages refuses 0, past the end and ranges running past it; empty = all', async () => {
      const r = await p.evaluate(async () => {
        const { parsePages } = await import('/pdfview.js');
        const tryIt = s => { try { return parsePages(s, 3); } catch (e) { return 'ERR:' + e.code; } };
        return ['', '2', '0', '4', '2-4', '2–4', '1-3', ' 2 – 3 ', 'x', '13'].map(tryIt);
      });
      assert.deepEqual(r, [null, [2], 'ERR:zero', 'ERR:range', 'ERR:range', 'ERR:range', [1, 2, 3], [2, 3], 'ERR:syntax', 'ERR:range']);
    });
    await test('pages: exam analysis of a 3-page paper sends nothing for 0, 4, 2–4 (API and local framework); "2" sends page 2 only', async () => {
      aiReply = (r, body) => r.fulfill({ json: { title: 'Exam analysis', markdown: '---\ntags: [Exam analysis]\n---\n## Summary\nok', problems: [] } });
      localReply = (r, body) => r.fulfill({ json: { title: 'Exam analysis', markdown: '---\ntags: [Exam analysis]\n---\n## Summary\nok', problems: [], framework: 'codex' } });
      for (const engine of ['deepseek', 'codex']) {
        for (const [pages, ok] of [['0', false], ['4', false], ['2–4', false], ['13', false], ['2', true], ['', true]]) {
          const a0 = aiCalls.length, l0 = localCalls.length;
          await p.evaluate(() => import('/studyai.js').then(m => m.examDialog('Exam3.pdf')));
          await p.locator('.ai-exam [data-f=pages]').fill(pages);
          await p.locator('.ai-exam [data-f=engine]').evaluate((s, v) => { const o = [...s.options].find(x => x.value === v); o.disabled = false; s.value = v; s.dispatchEvent(new Event('change')); }, engine);
          await p.locator('.ai-exam [data-a=go]').click();
          await sleep(ok ? 1500 : 500);
          const sent = engine === 'codex' ? localCalls.slice(l0) : aiCalls.slice(a0);
          if (!ok) {
            assert.equal(sent.length, 0, `${engine} "${pages}" was sent`);
            assert.match(await p.locator('#toast').innerText(), /past the end|start at 1|not understood/);
          } else {
            assert.equal(sent.length, 1, `${engine} "${pages}" not sent once`);
            const got = [...String(sent[0].content).matchAll(/--- page (\d+) ---/g)].map(m => +m[1]);
            assert.deepEqual(got, pages ? [2] : [1, 2, 3]);
            assert.ok(!/13 of 3|of 3<\/pages_to_analyse>.*13/.test(sent[0].content));
            if (engine === 'codex') assert.match(sent[0].content, new RegExp(`<pages_to_analyse>${pages ? '2' : '1–3'} of 3</pages_to_analyse>`));
          }
          await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
        }
      }
      aiReply = null; localReply = null;
    });

    /* ---------- 3.3 PDF page and zoom are kept per vault ---------- */
    const pdfPage = async (f, page) => {
      await expand('Algebra'); await openFile(f);
      const box = p.locator('.pdf-page');
      await p.waitForFunction(() => /\d/.test(document.querySelector('.pdf-pages')?.textContent || ''));
      if (page) { await box.fill(String(page)); await box.press('Enter'); await p.waitForFunction(n => document.querySelector('.pdf-page').value === String(n), page); await sleep(600); }
      return +(await box.inputValue());
    };
    await test('PDF position: two vaults with Algebra/Lecture.pdf keep their own page (A=12, B=1→3, A=12, B=3)', async () => {
      assert.equal(await pdfPage('Algebra/Lecture.pdf', 12), 12);
      await p.evaluate(() => window.__moFlush());
      await switchTo(B); await load();
      assert.equal(await pdfPage('Algebra/Lecture.pdf'), 1, 'B took A\'s page');
      assert.equal(await pdfPage('Algebra/Lecture.pdf', 3), 3);
      await switchTo(A); await load();
      assert.equal(await pdfPage('Algebra/Lecture.pdf'), 12);
      await switchTo(B); await load();
      assert.equal(await pdfPage('Algebra/Lecture.pdf'), 3);
      await switchTo(A); await load();
    });

    /* ---------- 3.4 the review "done" page ---------- */
    await test('review done page: Enter / Space close it, rating keys never count twice (one card, and the last of two)', async () => {
      await writeTree(A, { 'Two.md': 'First? :: a\n\nSecond? :: b\n' });
      await p.evaluate(() => window.__moFlush?.()); await sleep(800);
      for (const [note, closeKey] of [['Review.md', 'Enter'], ['Two.md', ' ']]) {
        await openFile(note);
        await p.waitForFunction(() => /::/.test(document.querySelector('#editor')?.value || ''));
        const before = await p.evaluate(async n => { const rv = await import('/review.js'); return rv.cardsFor(n).map(c => c.id); }, note);
        await p.evaluate(async n => { const rv = await import('/review.js'); rv.startSession(rv.cardsFor(n)); }, note);
        for (let i = 0; i < before.length; i++) { await p.keyboard.press(' '); await p.keyboard.press('3'); await sleep(60); }
        await p.locator('.review-done').waitFor();
        await p.keyboard.press('3'); await p.keyboard.press('3');
        await p.keyboard.press(closeKey === ' ' ? 'Space' : closeKey);
        await sleep(150);
        assert.equal(await p.locator('.review-modal .review-done').count(), 0, 'done page still open after ' + closeKey);
        const reps = await p.evaluate(async ids => { const rv = await import('/review.js'); await rv.flushReview(); return ids.map(id => rv.getCard?.(id)?.reps ?? null); }, before);
        void reps;
      }
      assert.deepEqual(errors.filter(e => /review|undefined|null/i.test(e)), []);
      const disk = JSON.parse(await fs.readFile(path.join(A, '.obsidian/myobsidian/review.json'), 'utf8'));
      for (const c of Object.values(disk.cards || {})) assert.ok((c.reps || 0) <= 1, 'a card was rated twice: ' + JSON.stringify(c));
    });

    /* ---------- 1. Study settings: migrated once, saved once, used by every AI ---------- */
    const studyFile = path.join(home, 'study.json');
    await test('study settings: first start combines the two old places and keeps their differences', async () => {
      const s = JSON.parse(await fs.readFile(studyFile, 'utf8'));
      const roots = s.courseRoots.map(x => x.toLowerCase());
      assert.ok(roots.includes(path.join(tmp, 'old-claude-root').replace(/\\/g, '/').toLowerCase()) && roots.includes('c:/old-ai-root'), JSON.stringify(s.courseRoots));
      assert.deepEqual(s.skipFolders.sort(), ['Private', 'UPC']);
      assert.deepEqual(s.courses, { LA: 'Linear Algebra' });
      assert.deepEqual(s.readOnlyFolders, ['Locked']);
      assert.deepEqual(s.differences.map(d => d.field).sort(), ['courseRoots', 'lookElsewhere', 'skipFolders']);
      await p.evaluate(() => import('/settings.js').then(m => m.openSettings('study')));
      await p.locator('.study-diffs').waitFor();
      assert.match(await p.locator('.study-diffs').innerText(), /old-ai-root/);
    });
    await test('study settings: saved in the Settings page, mirrored to Claude Code, survive a restart', async () => {
      const field = k => p.locator(`[data-study="${k}"]`);
      await p.evaluate(() => import('/settings.js').then(m => m.openSettings('study')));
      await field('courseRoots').fill(courses);
      await field('courses').fill('LA = Linear Algebra\nCA = Calculus');
      await field('skipFolders').fill('UPC');
      await field('readOnlyFolders').fill('Locked');
      await field('noteLanguage').fill(MARK_LANG);
      await field('about').fill('Test student');
      await p.locator('[data-study-save]').click();
      await p.waitForFunction(() => /settings saved/i.test(document.querySelector('#toast')?.textContent || ''));
      const s = JSON.parse(await fs.readFile(studyFile, 'utf8'));
      assert.deepEqual(s.courseRoots, [courses.replace(/\\/g, '/')]);
      assert.equal(s.noteLanguage, MARK_LANG);
      assert.equal(s.differences, undefined);
      const cc = JSON.parse(await fs.readFile(path.join(claudeDir, 'graphite.json'), 'utf8'));
      assert.equal(cc.studyRoot, courses.replace(/\\/g, '/'));
      assert.equal(cc.noteLanguage, MARK_LANG);
      assert.deepEqual(cc.readOnlyFolders, ['Locked']);
      await p.evaluate(() => import('/settings.js').then(m => m.closeSettings()));
      await switchTo(A); await load();
      const r = await p.evaluate(() => fetch('/api/study-profile').then(x => x.json()));
      assert.equal(r.profile.noteLanguage, MARK_LANG);
      assert.deepEqual(r.profile.skipFolders, ['UPC']);
      // The old AI page no longer has its own folder fields; it points to Study settings.
      await p.evaluate(() => import('/settings.js').then(m => m.openSettings('ai')));
      assert.equal(await p.locator('[data-agent=roots]').count(), 0);
      assert.equal(await p.locator('[data-open-study]').count(), 1);
      await p.evaluate(() => import('/settings.js').then(m => m.closeSettings()));
    });

    // The same job with each available executor: what it was told, what it may read, where it writes.
    const summaryJob = async engine => {
      await p.evaluate(() => import('/summary.js').then(m => m.summaryDialog('Linear Algebra/讲义.pdf')));
      await p.locator('.ai-summary [data-f=engine]').waitFor({ state: 'attached' });
      await p.locator('.ai-summary [data-f=engine]').evaluate((s, v) => { const o = [...s.options].find(x => x.value === v); o.disabled = false; s.value = v; s.dispatchEvent(new Event('change')); }, engine);
      await p.locator('.ai-summary [data-a=go]').click();
    };
    for (const [engine, name] of [['deepseek', 'API model (DeepSeek)'], ['dsh', 'DeepSeek Harness'], ['codex', 'Codex CLI']]) {
      await test(`study settings used: summary by ${name} is told the note language, courses and read-only folders; result written where chosen`, async () => {
        const n0 = llm.log.length;
        await summaryJob(engine);
        await p.locator('.ai-summary .sum-target').waitFor({ timeout: 180000 });
        const told = llm.log.slice(n0).map(e => JSON.stringify(e.body)).join('\n');
        assert.match(told, new RegExp(MARK_LANG), name + ' was not given the note language');
        assert.match(told, /LA = Linear Algebra/);
        assert.match(told, /Read-only vault folders[^\n]*Locked/);
        assert.ok(!/Never open folders named/.test(told), 'summary got import-only settings');
        assert.equal(await p.locator('.ai-summary .sum-target').innerText(), 'Linear Algebra/讲义 summary.md');
        await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
      });
    }
    await test('study settings used: Claude Code gets them in its task file', async () => {
      const chat = path.join(A, '.obsidian/plugins/claude-chat/chat');
      await fs.mkdir(path.join(chat, 'tasks'), { recursive: true }); await fs.mkdir(path.join(chat, 'replies'), { recursive: true });
      const beat = setInterval(() => fss.writeFileSync(path.join(chat, 'status.json'), JSON.stringify({ listening: true, at: Date.now() })), 1000);
      fss.writeFileSync(path.join(chat, 'status.json'), JSON.stringify({ listening: true, at: Date.now() }));
      try {
        await summaryJob('claude-code');
        let task = null;
        for (let i = 0; i < 40 && !task; i++) { await sleep(250); const f = (await fs.readdir(path.join(chat, 'tasks'))).find(x => x.endsWith('.json')); if (f) task = { f, j: JSON.parse(await fs.readFile(path.join(chat, 'tasks', f), 'utf8')) }; }
        assert.ok(task, 'no task file');
        assert.equal(task.j.task, 'ai-summary');
        assert.equal(task.j.studySettings.noteLanguage, MARK_LANG);
        assert.deepEqual(task.j.studySettings.courses, { LA: 'Linear Algebra', CA: 'Calculus' });
        assert.match(task.j.studySettingsFile, /study\.json$/);
        assert.equal(task.j.pages, '1–4');
        await fs.writeFile(path.join(chat, 'replies', task.f), JSON.stringify(SUMMARY));
        await p.locator('.ai-summary .sum-target').waitFor({ timeout: 15000 });
        await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
      } finally { clearInterval(beat); }
    });
    await test('study settings used: "find new course files" (API agent) scans only the course folder, skips UPC, refuses read-only targets', async () => {
      const r = await p.evaluate(async () => {
        const AI = await import('/ai.js');
        return AI.agent('import', 'import', { phase: 'plan' }, { provider: 'deepseek' });
      });
      const srcs = (r.items || []).map(i => i.src).concat((r.ignore || []).map(i => i.src));
      assert.ok(srcs.some(s => /LA\/HW\/hw1\.pdf$/.test(s)), JSON.stringify(r));
      assert.ok(!JSON.stringify(r).includes('secret.pdf'), 'scanned the left-out UPC folder');
      assert.ok(!(r.items || []).some(i => /^Locked\//.test(i.dest)), 'kept a destination in a read-only folder');
      const told = promptsFor(/file a university student's course files/).pop();
      assert.match(told, new RegExp(MARK_LANG));
      assert.ok(!told.includes('old-ai-root') && !told.includes('old-claude-root'), 'old folders still used');
    });
    await test('study settings work without Claude Code: no ~/.claude folder needed', async () => {
      const r = await new Promise((res, rej) => {
        const code = `const P=require(${JSON.stringify(path.join(repo, 'profile.js'))});const fs=require('fs');const s=P({atomicWrite:(f,b)=>fs.promises.writeFile(f,b),vault:()=>'V',claudeDir:()=>${JSON.stringify(path.join(tmp, 'no-claude'))}});s.save({noteLanguage:'X',courseRoots:['D:/c']}).then(v=>console.log(JSON.stringify({v,claude:fs.existsSync(${JSON.stringify(path.join(tmp, 'no-claude'))})})))`;
        const c = spawn(process.execPath, ['-e', code], { env: { ...process.env, GRAPHITE_HOME: path.join(tmp, 'home2') } });
        let out = ''; c.stdout.on('data', d => { out += d; }); c.on('exit', () => { try { res(JSON.parse(out)); } catch (e) { rej(new Error(out)); } });
      });
      assert.equal(r.v.noteLanguage, 'X');
      assert.equal(r.claude, false);
      assert.ok(fss.existsSync(path.join(tmp, 'home2', 'study.json')));
    });

    /* ---------- 1b. Graphite's names, and "Run by" ---------- */
    await test('names: built-in plugins show as Graphite features (中文), under 插件 → Graphite 自带 / 社区插件', async () => {
      await p.evaluate(() => { localStorage.setItem('mo:lang', JSON.stringify('zh-CN')); });
      await load();
      await p.evaluate(() => import('/settings.js').then(m => m.openSettings('plugins')));
      await p.locator('.settings-content', { hasText: 'Graphite 学习助手' }).waitFor();
      const txt = await p.locator('.settings-content').innerText();
      for (const s of ['Graphite 自带', '社区插件', 'Graphite 学习助手', 'Graphite 摘录', 'Graphite 练习与测验']) assert.ok(txt.includes(s), 'missing ' + s + ' in: ' + txt.slice(0, 400));
      assert.ok(!/Claude Chat|Claude Capture|Claude Quizzes/.test(txt), 'old names still shown');
      assert.match(await p.locator('.settings-nav').innerText(), /插件/);
      assert.match(await p.locator('.settings-nav').innerText(), /学习设置/);
      await p.evaluate(() => import('/settings.js').then(m => m.closeSettings()));
    });
    await test('names: the study assistant keeps its name; "Run by" follows the chosen executor', async () => {
      const head = p.locator('.cc-head');
      await p.evaluate(() => { const b = document.querySelector('.cc-chat-tab'); b?.click(); });
      await head.waitFor();
      assert.match(await head.locator('.cc-brand-name').innerText(), /Graphite 学习助手/);
      assert.match(await head.innerText(), /执行者/);
      for (const [v, re] of [['dsh', /DeepSeek Harness/], ['codex', /Codex CLI/], ['claude-code', /Claude Code/]]) {
        await p.evaluate(v => window.myobsidianAI.setChoice('chat', v), v);
        await p.waitForFunction(v => document.querySelector('.cc-model')?.dataset.executor === v, v);
        assert.match(await head.locator('.cc-model').innerText(), re);
        assert.match(await head.locator('.cc-brand-name').innerText(), /Graphite 学习助手/);
      }
      const cmds = await p.evaluate(() => [...document.querySelectorAll('*')].length && window.myobsidianAI && true);
      void cmds;
      await p.evaluate(() => { localStorage.setItem('mo:lang', JSON.stringify('en')); });
      await load();
    });

    /* ---------- 2. Summarize this PDF ---------- */
    const summarize = async (file, { pages = '', dest = null, engine = 'deepseek' } = {}) => {
      await p.evaluate(f => import('/summary.js').then(m => m.summaryDialog(f)), file);
      await p.locator('.ai-summary [data-f=engine]').waitFor({ state: 'attached' });
      await p.locator('.ai-summary [data-f=engine]').evaluate((s, v) => { s.value = v; s.dispatchEvent(new Event('change')); }, engine);
      if (pages) await p.locator('.ai-summary [data-f=pages]').fill(pages);
      if (dest != null) await p.locator('.ai-summary [data-f=dest]').selectOption(String(dest));
      await p.locator('.ai-summary [data-a=go]').click();
    };
    const fakeSummary = () => { aiReply = (r) => r.fulfill({ json: SUMMARY }); };
    await test('summary: entry points in the PDF toolbar and the file tree menu, with who runs it shown', async () => {
      await p.evaluate(() => window.myobsidianAI.setChoice('summary', 'deepseek'));
      await expand('Linear Algebra'); await openFile('Linear Algebra/讲义.pdf');
      await p.locator('.pdf-summary').click();
      await p.locator('.ai-summary .sum-avail').waitFor();
      assert.match(await p.locator('.ai-summary .sum-avail').innerText(), /Run by: DeepSeek/);
      await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
      await p.locator('#tree [data-path="Linear Algebra/讲义.pdf"]').click({ button: 'right' });
      await p.locator('text=Summarize this PDF').first().click();
      await p.locator('.ai-summary').waitFor();
      await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
    });
    await test('summary: two courses with the same 讲义.pdf → each summary in its own folder, page links open the right PDF and page', async () => {
      fakeSummary();
      for (const course of ['Linear Algebra', 'Calculus']) {
        await summarize(course + '/讲义.pdf');
        await p.locator('.ai-summary .sum-target').waitFor();
        assert.equal(await p.locator('.ai-summary .sum-target').innerText(), course + '/讲义 summary.md');
        await p.locator('.ai-summary [data-a=save]').click();
        await p.waitForFunction(c => !document.querySelector('.ai-summary'), course);
        const md = await fs.readFile(path.join(A, course, '讲义 summary.md'), 'utf8');
        assert.ok(md.includes(`[[${course}/讲义.pdf#page=2|p. 2]]`), md);
        assert.ok(!md.includes('#page=9'), 'linked a page that was not read');
        assert.match(md, /generated-hash: [0-9a-f]{8}/);
      }
      // Clicking a page link in the Calculus summary opens Calculus/讲义.pdf at page 2.
      await openFile('Calculus/讲义 summary.md');
      await p.evaluate(() => import('/app.js').catch(() => null));
      await p.locator('[data-cmd="mode-preview"], #mode-switch [data-mode="preview"]').first().click().catch(() => {});
      await p.locator('#preview a', { hasText: 'p. 2' }).first().click();
      await p.waitForFunction(() => document.querySelector('.pdf-page')?.value === '2');
      assert.match(await p.locator('#breadcrumb').innerText(), /Calculus/);
      aiReply = null;
    });
    await test('summary: regenerating a hand-edited summary offers "save as new" (default) or an explicit update', async () => {
      fakeSummary();
      const f = path.join(A, 'Linear Algebra', '讲义 summary.md');
      const edited = (await fs.readFile(f, 'utf8')).replace('Point on page two', 'MY OWN WORDS');
      await fs.writeFile(f, edited); await sleep(800);
      await summarize('Linear Algebra/讲义.pdf');
      await p.locator('.ai-summary .sum-exists').waitFor();
      assert.match(await p.locator('.ai-summary .sum-exists').innerText(), /edited it/);
      assert.equal(await p.locator('input[name=sum-mode][value=new]').isChecked(), true);
      await p.locator('.ai-summary [data-a=save]').click();
      await p.waitForFunction(() => !document.querySelector('.ai-summary'));
      assert.equal(await fs.readFile(f, 'utf8'), edited, 'the edited summary was changed');
      assert.ok(fss.existsSync(path.join(A, 'Linear Algebra', '讲义 summary 2.md')));
      // Explicit update (confirmed) replaces it.
      await summarize('Linear Algebra/讲义.pdf');
      await p.locator('input[name=sum-mode][value=update]').check();
      await p.locator('.ai-summary [data-a=save]').click();
      await p.waitForFunction(() => !document.querySelector('.ai-summary'));
      await sleep(500);
      assert.ok(!(await fs.readFile(f, 'utf8')).includes('MY OWN WORDS'));
      aiReply = null;
    });
    await test('summary: bad ranges are refused before sending; "2" sends page 2 only', async () => {
      fakeSummary();
      for (const bad of ['0', '5', '2-9']) {
        const n = aiCalls.length;
        await summarize('Linear Algebra/讲义.pdf', { pages: bad });
        await sleep(400);
        assert.equal(aiCalls.length, n, bad + ' was sent');
        assert.match(await p.locator('#toast').innerText(), /past the end|start at 1/);
        await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
      }
      const n = aiCalls.length;
      await summarize('Linear Algebra/讲义.pdf', { pages: '2' });
      await p.locator('.ai-summary .sum-target').waitFor();
      assert.deepEqual([...String(aiCalls[n].content).matchAll(/--- page (\d+) ---/g)].map(m => +m[1]), [2]);
      await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
      aiReply = null;
    });
    await test('summary: scanned PDF with an API model → clear message, nothing sent or written; page 3 without text is noted', async () => {
      fakeSummary();
      const n = aiCalls.length;
      await summarize('Scan.pdf');
      await p.locator('.ai-summary .sum-error').waitFor();
      assert.match(await p.locator('.ai-summary .sum-error').innerText(), /no text \(scanned\)/);
      assert.equal(aiCalls.length, n);
      assert.ok(!fss.existsSync(path.join(A, 'Scan summary.md')));
      await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
      await summarize('Linear Algebra/讲义.pdf');
      await p.locator('.ai-summary .sum-preview').waitFor();
      assert.match(await p.locator('.ai-summary .sum-preview').innerText(), /Pages 3 have no text|page 3|3 have no text/i);
      await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
      aiReply = null;
    });
    await test('summary: Stop while generating writes nothing; a failed save keeps existing notes and can be retried', async () => {
      fakeSummary(); aiDelay = 3000;
      const before = (await fs.readdir(path.join(A, 'Calculus'))).sort();
      await summarize('Calculus/讲义.pdf');
      await p.locator('.ai-summary [data-a=stop]').click();
      await p.locator('.ai-summary .sum-error').waitFor();
      assert.match(await p.locator('.ai-summary .sum-error').innerText(), /Stopped/);
      await sleep(3200);
      assert.deepEqual((await fs.readdir(path.join(A, 'Calculus'))).sort(), before);
      await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
      aiDelay = 0;
      const existing = await fs.readFile(path.join(A, 'Calculus', '讲义 summary.md'), 'utf8');
      await summarize('Calculus/讲义.pdf');
      await p.locator('input[name=sum-mode][value=new]').waitFor();
      await p.route(origin + '/api/file**', r => (r.request().method() === 'POST' ? r.fulfill({ status: 500, json: { error: 'Disk full (test)' } }) : r.continue()));
      await p.locator('.ai-summary [data-a=save]').click();
      await p.locator('.ai-summary .sum-error').waitFor();
      assert.match(await p.locator('.ai-summary .sum-error').innerText(), /Not saved/);
      assert.equal(await fs.readFile(path.join(A, 'Calculus', '讲义 summary.md'), 'utf8'), existing);
      await p.unroute(origin + '/api/file**');
      await p.locator('.ai-summary [data-a=save]').click();
      await p.waitForFunction(() => !document.querySelector('.ai-summary'));
      assert.ok(fss.existsSync(path.join(A, 'Calculus', '讲义 summary 2.md')));
      aiReply = null;
    });
    await test('summary: imported PDF offers its mapped course folder; read-only folders cannot be chosen', async () => {
      await writeTree(A, { 'Locked/Doc.pdf': pdf(1, [], 'LK') }); await sleep(900);
      await p.evaluate(() => import('/summary.js').then(m => m.summaryDialog('LA/Imported.pdf')));
      await p.locator('.ai-summary [data-f=dest]').waitFor();
      const opts = await p.locator('.ai-summary [data-f=dest] option').allInnerTexts();
      assert.ok(opts.some(o => /Course folder Linear Algebra/.test(o)), JSON.stringify(opts));
      await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
      await p.evaluate(() => import('/summary.js').then(m => m.summaryDialog('Locked/Doc.pdf')));
      await p.locator('.ai-summary [data-f=dest]').waitFor();
      const dbg = await p.evaluate(async () => ({ opts: [...document.querySelectorAll('.ai-summary [data-f=dest] option')].map(o => o.outerHTML), prof: (await window.myobsidianAI.studySettings()).profile.readOnlyFolders }));
      assert.equal(await p.locator('.ai-summary [data-f=dest] option').first().evaluate(o => o.disabled), true, JSON.stringify(dbg));
      await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
    });

    /* ---------- upgrade from 1.1.40: captures, chats and scores stay ---------- */
    await test('upgrade: a 1.1.40 vault keeps its captures, chat history, scores and plugin settings', async () => {
      const C = path.join(tmp, 'C'), plug = path.join(C, '.obsidian/plugins');
      const ship = path.join(repo, 'extensions/obsidian-plugins');
      for (const id of ['claude-chat', 'claude-capture', 'claude-quizzes']) {
        await fs.cp(path.join(ship, id), path.join(plug, id), { recursive: true });
        const m = JSON.parse(await fs.readFile(path.join(plug, id, 'manifest.json'), 'utf8'));
        await fs.writeFile(path.join(plug, id, 'manifest.json'), JSON.stringify({ ...m, version: '1.1.0', name: m.name.replace('Graphite', 'Claude') }));
        await fs.writeFile(path.join(plug, id, 'data.json'), JSON.stringify({ mine: id }));
      }
      const quiz = '---\ngraph: hide\n---\n# Quiz results\n\n| when | page | score |\n| 2026-11-01 | LA | 8/10 |\n';
      await writeTree(C, {
        'Welcome.md': 'C',
        '.obsidian/community-plugins.json': JSON.stringify(['claude-chat', 'claude-capture', 'claude-quizzes']),
        '.obsidian/graphite-builtins.json': JSON.stringify({ offered: ['claude-chat', 'claude-capture', 'claude-quizzes'] }),
        'Claude Inbox.md': '---\ntags: [Claude]\n---\n# Claude Inbox\n\n- [ ] **Interesting** · 2026-11-10 · [[Welcome]] %%cap-1%%\n  > old capture one\n- [ ] **Not familiar** · 2026-11-11 · [[Welcome]] %%cap-2%%\n  > old capture two\n',
        'Claude Brain/quiz-results.md': quiz,
        '.obsidian/plugins/claude-chat/chat/outbox.jsonl': JSON.stringify({ type: 'user', id: 'm-old-1', text: 'OLD QUESTION about eigenvalues', at: '2026-11-10' }) + '\n',
        '.obsidian/plugins/claude-chat/chat/replies/m-old-1.md': 'OLD ANSWER from before the update',
      });
      await switchTo(C); await load();
      await sleep(800);
      for (const id of ['claude-chat', 'claude-capture', 'claude-quizzes']) {
        assert.equal(JSON.parse(await fs.readFile(path.join(plug, id, 'manifest.json'), 'utf8')).version, JSON.parse(await fs.readFile(path.join(ship, id, 'manifest.json'), 'utf8')).version, id + ' not updated');
        assert.equal(JSON.parse(await fs.readFile(path.join(plug, id, 'data.json'), 'utf8')).mine, id, id + ' lost its settings');
      }
      assert.deepEqual(JSON.parse(await fs.readFile(path.join(C, '.obsidian/community-plugins.json'), 'utf8')).sort(), ['claude-capture', 'claude-chat', 'claude-quizzes']);
      assert.equal(await fs.readFile(path.join(C, 'Claude Brain/quiz-results.md'), 'utf8'), quiz);
      assert.match(await fs.readFile(path.join(C, 'Claude Inbox.md'), 'utf8'), /old capture two/);
      await p.evaluate(() => document.querySelector('.cc-chat-tab')?.click());
      await p.waitForFunction(() => /OLD ANSWER from before the update/.test(document.querySelector('.cc-list')?.innerText || ''));
      assert.match(await p.locator('.cc-list').innerText(), /OLD QUESTION about eigenvalues/);
      await p.waitForFunction(() => /2/.test(document.querySelector('.status-bar-item, #status')?.innerText || ''));
      await switchTo(A); await load();
    });

    /* ---------- 4. the feature manual ---------- */
    await test('manual: start page link and F1 open it; search by task, word and shortcut finds the new features', async () => {
      await p.keyboard.press('Control+t');
      const link = p.locator('#empty-state [data-cmd=help]');
      await link.waitFor();
      assert.match(await link.innerText(), /manual/i);
      await link.click();
      const search = p.locator('#help-find .hb-search');
      await search.waitFor();
      for (const [q, want] of [['summarize', /Summarize this PDF/], ['DeepSeek Harness', /Study settings|DeepSeek Harness/], ['study settings', /Open Study settings/], ['ctrl + s', /Ctrl\+S/], ['code', /code file/i], ['zzzz-nothing', /No matching features/]]) {
        await search.fill(q);
        await p.waitForFunction(re => new RegExp(re, 'i').test(document.querySelector('#help-body')?.innerText || ''), want.source);
      }
      // A study task (chip) narrows to that task's features; "Open" runs one.
      await search.fill('');
      await p.locator('[data-hb-group="reading"]').click();
      await p.waitForFunction(() => /Summarize this PDF/.test(document.querySelector('#help-body').innerText));
      await p.locator('[data-hb-group=""]').click();
      await p.waitForFunction(() => /Summarize a PDF/.test(document.querySelector('#help-body').innerText) && document.querySelectorAll('#help-toc a').length > 3);
      await search.fill('study settings');
      await p.locator('[data-hb-run="study-settings"]').click();
      await p.locator('[data-study="courseRoots"]').waitFor();
      await p.evaluate(() => import('/settings.js').then(m => m.closeSettings()));
      await p.keyboard.press('Escape');
      await p.keyboard.press('F1');
      await search.waitFor();
    });
  } finally {
    const failed = results.filter(r => !r.pass);
    console.log(JSON.stringify({ tmp, passed: results.length - failed.length, total: results.length }, null, 1));
    await browser.close(); srv.child.kill(); llm.close();
    if (!process.env.KEEP) await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
    process.exitCode = failed.length ? 1 : 0;
  }
}
main().then(() => process.exit(process.exitCode || 0), e => { console.error(e); process.exit(1); });
