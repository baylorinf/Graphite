// The selection bar and the snip tool (1.1.50), and the new Canvas entry points, in a real browser with a throwaway
// vault. AI and Canvas answers are simulated here: nothing is sent anywhere.
//   1. Add to note: a picker lists the note's sections; the quote lands at the end of the chosen section.
//   2. Interesting: a [!tip] callout under the chosen section.
//   3. Not familiar: Graphie is asked to explain (the chat sends it) and a card for tomorrow's review is added.
//   4. Snip a PDF region → To Markdown ($maths$, editable) → Card in the course's deck → the deck's review button.
//   5. Snip → Add to note without text: the image goes to attachments/ and is embedded.
//   6. Canvas: ribbon button with a "new files" badge, the new-files card, the folder link, the in-app reader
//      (no browser), and one-click submit (the homework file picked and previewed; nothing sent without Confirm).
//   node test/snip-ui.cjs
require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = path.join(__dirname, '..');
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

function pdf(n, label) {
  const objects = [];
  const add = s => { objects.push(s); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Count ' + n + ' /Kids [' + Array.from({ length: n }, (_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 1; i <= n; i++) {
    const data = 'BT /F1 12 Tf 20 200 Td 14 TL (' + label + '-page-' + i + ') Tj T* (Injective maps keep distinct points apart) Tj ET\n';
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (3 + i * 2) + ' 0 R >>');
    add('<< /Length ' + data.length + ' >>\nstream\n' + data + 'endstream');
  }
  let out = '%PDF-1.4\n';
  const offsets = objects.map((s, i) => { const j = out.length; out += (i + 1) + ' 0 obj\n' + s + '\nendobj\n'; return j; });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(j => String(j).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(out + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n', 'ascii');
}

const NOTES = '# LA notes\n\n## Eigen\n\nold eigen text\n\n## Kernel\n\nkernel text\n';
async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-snip-'));
  const files = {
    'Welcome.md': 'Welcome',
    'LA/Notes.md': NOTES,
    'LA/Lecture.pdf': pdf(2, 'LEC'),
    'Linear Algebra/作业 Homework/HW3 answers.pdf': pdf(1, 'HW3'),
    'Linear Algebra/作业 Homework/HW2 answers.pdf': pdf(1, 'HW2'),
  };
  for (const [n, b] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(vault, n)), { recursive: true }); await fs.writeFile(path.join(vault, n), b); }
  const plugSrc = path.join(repo, 'extensions/obsidian-plugins/claude-chat');
  await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
  await fs.writeFile(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['claude-chat']));
  await fs.cp(plugSrc, path.join(vault, '.obsidian/plugins/claude-chat'), { recursive: true, filter: s => !/[\\/]chat([\\/]|$)/.test(s.slice(plugSrc.length)) });

  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const aiCalls = [], canvasCalls = [];
  const tomorrow = new Date(Date.now() + 86400000).toISOString();
  const status = {
    connected: true, configured: true, authMode: 'oauth', canSubmit: true, canSubmitFiles: true, accountKey: 'acct-1', user: '测试生',
    syncedAt: new Date().toISOString(), autoMirror: true, vaultFolders: ['LA', 'Linear Algebra'], courseLinks: { 7: 'Linear Algebra' },
    lastPull: { finishedAt: new Date().toISOString(), saved: 1, unchanged: 0, failed: [], warnings: [], path: 'Canvas',
      mirror: { added: [{ courseId: '7', course: '线性代数', folder: 'Linear Algebra', path: 'Linear Algebra/课件 Slides/LA9.pdf' }], duplicates: 2, failed: [], unlinked: [], index: ['Linear Algebra/Linear Algebra index.md'] } },
    snapshot: { warnings: [], courses: [{ id: '7', name: '线性代数', files: [], announcements: [], modules: [], quizzes: [], events: [], discussions: [], pages: [],
      assignments: [{ id: '70', title: 'Homework 3', url: 'https://oc.sjtu.edu.cn/courses/7/assignments/70', dueAt: tomorrow, description: 'Old text', attachments: [],
        submissionTypes: ['online_upload'], submissionEvidence: { status: 'unsubmitted', attempt: 0, submittedAt: null }, attempt: 0, submitted: false }] }] },
  };
  async function page() {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(() => {
      localStorage.setItem('mo:lang', JSON.stringify('en'));
      localStorage.setItem('mo:pluginsOn', '1');
      localStorage.setItem('mo:ai', JSON.stringify({ keys: { deepseek: 'test-only' }, models: { deepseek: 'deepseek-flash' }, use: { check: 'deepseek', quiz: 'off', chat: 'claude-code', transcribe: 'deepseek' } }));
      window.open = () => { window.__opened = (window.__opened || 0) + 1; return null; };
    });
    await ctx.route(origin + '/api/ai', async r => {
      const body = JSON.parse(r.request().postData() || '{}');
      aiCalls.push(body);
      if (body.task === 'transcribe') return r.fulfill({ json: { title: 'Injective', markdown: '**Injective.** $T(u) = T(w) \\Rightarrow u = w$' } });
      return r.fulfill({ status: 400, json: { error: 'unexpected ' + body.task } });
    });
    await ctx.route(url => new URL(url).pathname.startsWith('/api/canvas/') && new URL(url).pathname !== '/api/canvas/vault-file', async r => {
      const action = new URL(r.request().url()).pathname.slice('/api/canvas/'.length);
      const body = r.request().postData() ? JSON.parse(r.request().postData()) : null;
      canvasCalls.push({ action, body });
      if (action === 'status') return r.fulfill({ json: status });
      if (action === 'link') { status.courseLinks = { ...status.courseLinks, [body.courseId]: body.folder }; return r.fulfill({ json: status }); }
      if (action === 'read') return r.fulfill({ json: { url: body.url, courseId: '7', title: 'Homework 3', text: 'Prove that T is injective.\nShow every step.', attachments: [], dueAt: tomorrow } });
      return r.fulfill({ status: 400, json: { error: 'unexpected ' + action } });
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor();
    await p.waitForFunction(() => typeof window.__moFlush === 'function' && window.app?.plugins?.getPlugin?.('claude-chat'));
    await sleep(300);
    return p;
  }
  let fails = 0;
  async function test(name, fn) {
    let p;
    try { p = await page(); await fn(p); console.log('PASS ' + name); }
    catch (e) { fails++; const toast = await p?.locator('#toast').innerText().catch(() => ''); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 10).join('\n  ') + (toast ? '\n  last toast: ' + toast : '')); }
    finally { await p?.context().close(); }
  }
  const read = rel => fs.readFile(path.join(vault, rel), 'utf8');
  async function selectOnPdf(p) {
    await p.locator('#tree [data-path="LA/Notes.md"]').click();
    await p.locator('#tree [data-path="LA/Lecture.pdf"]').click();
    const span = p.locator('.page[data-page-number="2"] .textLayer span').filter({ hasText: 'Injective' }).first();
    await span.waitFor({ timeout: 15000 });
    await span.evaluate(s => { const r = document.createRange(); r.selectNodeContents(s); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 160 })); });
    await p.locator('.fv-selbar:not([hidden])').waitFor();
  }
  async function snipPdf(p) {
    await p.locator('#tree [data-path="LA/Notes.md"]').click();
    await p.locator('#tree [data-path="LA/Lecture.pdf"]').click();
    await p.locator('.page[data-page-number="1"] canvas').waitFor({ timeout: 15000 });
    await sleep(400);
    await p.keyboard.press('Alt+S');
    await p.locator('.snip-layer').waitFor();
    const pg = await p.locator('.page[data-page-number="1"] canvas').boundingBox();
    await p.mouse.move(pg.x + 10, pg.y + 10); await p.mouse.down(); await p.mouse.move(pg.x + 260, pg.y + 90, { steps: 5 }); await p.mouse.up();
    await p.locator('.snip-panel img.snip-img').waitFor();
  }

  try {
    await test('Add to note: pick a section; the quote goes at its end with a link to the page', async p => {
      await selectOnPdf(p);
      assert.equal(await p.locator('.fv-selbar [data-sel="snip"]').count(), 1, 'Snip on the bar');
      await p.locator('.fv-selbar [data-sel="note"]').click();
      if (process.env.SNIP_SHOTS) { await p.locator('.snip-picker').waitFor(); await p.screenshot({ path: path.join(process.env.SNIP_SHOTS, 'picker.png') }); }
      await p.locator('.snip-picker .snip-sections button').filter({ hasText: 'Eigen' }).click();
      await p.locator('#toast').filter({ hasText: 'Eigen' }).waitFor();
      const text = await read('LA/Notes.md');
      assert.match(text, /old eigen text\n\n> Injective maps keep distinct points apart\n> — \[\[Lecture\.pdf#page=2\|Lecture p\.2\]\]\n\n## Kernel/);
      await fs.writeFile(path.join(vault, 'LA/Notes.md'), NOTES);
    });

    await test('Interesting: a [!tip] callout under the chosen section', async p => {
      await selectOnPdf(p);
      await p.locator('.fv-selbar [data-sel="interesting"]').click();
      await p.locator('.snip-picker .snip-sections button').filter({ hasText: 'Kernel' }).click();
      await p.locator('#toast').filter({ hasText: 'Kernel' }).waitFor();
      assert.match(await read('LA/Notes.md'), /kernel text\n\n> \[!tip\] Interesting\n> Injective maps keep distinct points apart\n> — \[\[Lecture\.pdf#page=2/);
      await fs.writeFile(path.join(vault, 'LA/Notes.md'), NOTES);
    });

    await test('Not familiar: Graphie is asked to explain, and a review card is added', async p => {
      await selectOnPdf(p);
      await p.locator('.fv-selbar [data-sel="unfamiliar"]').click();
      await p.waitForFunction(() => window.app.plugins.getPlugin('claude-chat').msgs?.some(m => /not familiar/.test(m.text)));
      const msg = await p.evaluate(() => window.app.plugins.getPlugin('claude-chat').msgs.find(m => /not familiar/.test(m.text)));
      assert.match(msg.selection, /Injective maps keep distinct points apart/);
      await p.evaluate(async () => (await import('/review.js')).flushReview());
      const review = JSON.parse(await read('.obsidian/myobsidian/review.json'));
      const card = Object.values(review.items).find(i => i.tag === 'unfamiliar');
      assert.ok(card, 'unfamiliar card');
      assert.equal(card.q, 'Injective maps keep distinct points apart');
      assert.equal(card.deck, 'LA');
      assert.match(card.a, /\[\[Lecture\.pdf#page=2/);
    });

    await test('Snip → To Markdown → Card in the course deck → review the deck', async p => {
      await snipPdf(p);
      await p.locator('.snip-panel [data-cap="text"]').click();
      await p.waitForFunction(() => document.querySelector('.snip-panel textarea')?.value.includes('Rightarrow'));
      assert.equal(aiCalls.at(-1).task, 'transcribe');
      assert.match(aiCalls.at(-1).img, /^\.obsidian\/graphite\/clips\/Lecture-p1-/);
      await p.locator('.snip-panel .snip-preview .katex').first().waitFor();
      if (process.env.SNIP_SHOTS) await p.screenshot({ path: path.join(process.env.SNIP_SHOTS, 'snip.png') });
      await p.locator('.snip-panel [data-cap="card"]').click();
      assert.match(await p.locator('.study-card [data-f=a]').inputValue(), /Rightarrow/);
      assert.equal(await p.locator('.study-card [data-f=deck]').inputValue(), 'LA');
      await p.locator('.study-card [data-f=q]').fill('When is T injective?');
      await p.locator('.study-card [data-a=save]').click();
      await p.locator('#review-btn').click();
      await p.locator('.study-decks [data-deck="LA"]').click();
      await p.locator('.review-modal .review-q').waitFor();
    });

    await test('Snip → Add to note without text: the image is embedded from attachments/', async p => {
      await snipPdf(p);
      await p.locator('.snip-panel [data-cap="note"]').click();
      await p.locator('.snip-picker [data-sec="end"]').click();
      await p.locator('#toast').filter({ hasText: 'Notes' }).waitFor();
      const text = await read('LA/Notes.md');
      assert.match(text, /> !\[\[Lecture-p1-[a-z0-9]+\.png\]\]\n> — \[\[Lecture\.pdf#page=1\|Lecture p\.1\]\]\n$/);
      const img = text.match(/!\[\[(Lecture-p1-[a-z0-9]+\.png)\]\]/)[1];
      assert.ok(fss.existsSync(path.join(vault, 'attachments', img)));
      await fs.writeFile(path.join(vault, 'LA/Notes.md'), NOTES);
    });

    await test('Canvas: ribbon badge, new files, folder link, in-app reader, one-click submit', async p => {
      await p.locator('#canvas-btn .badge:not(.hidden)').waitFor({ timeout: 10000 });
      assert.equal(await p.locator('#canvas-btn .badge').innerText(), '1');
      await p.locator('#canvas-btn').click();
      const view = p.locator('#canvas-view');
      await view.locator('[data-cv-new]').getByText('LA9.pdf').waitFor();
      if (process.env.SNIP_SHOTS) await p.screenshot({ path: path.join(process.env.SNIP_SHOTS, 'canvas.png') });
      assert.equal(await p.locator('#canvas-btn .badge.hidden').count(), 1, 'badge cleared once seen');
      // A Canvas link opens in Graphite's reader, not a browser.
      await view.locator('.cv-agenda a[data-cv-read]').filter({ hasText: 'Homework 3' }).click();
      await view.locator('.cv-reader-text').filter({ hasText: 'Prove that T is injective.' }).waitFor();
      assert.equal(await p.evaluate(() => window.__opened || 0), 0, 'no browser window');
      await view.locator('[data-cv="reader-back"]').click();
      // One click: the matching homework file is picked and previewed; sending still needs Confirm.
      await view.locator('.cv-agenda [data-cv="quick-submit"]').click();
      const dialog = p.locator('#cv-submit-dialog');
      await dialog.locator('[data-submit-suggested]').waitFor();
      assert.match(await dialog.innerText(), /HW3 answers\.pdf/);
      assert.doesNotMatch(await dialog.innerText(), /HW2 answers\.pdf/);
      await dialog.locator('[data-submit-action="confirm"]').waitFor();
      assert.equal(canvasCalls.filter(c => c.action === 'submit').length, 0, 'nothing sent before Confirm');
      await dialog.locator('[data-submit-action="close"]').click();
      // Where this course's new files go.
      await view.locator('#cv-link').selectOption('LA');
      await p.waitForFunction(() => document.querySelector('#cv-link')?.value === 'LA');
      await sleep(300);
      assert.deepEqual(canvasCalls.find(c => c.action === 'link')?.body, { courseId: '7', folder: 'LA' });
    });
  } finally {
    await browser.close();
  }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
