// Front-end checks for the 1.1.45 student-workflow fixes, in a real browser against a throwaway vault.
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
//   node test/frontend-1145.cjs [filter]
// Needs Playwright (GRAPHITE_PLAYWRIGHT or the Codex runtime copy) and Chrome (GRAPHITE_CHROME). Only a new temporary
// folder is written. Every AI, agent and Canvas answer is simulated here; no school account and no real student files.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const repo = path.join(__dirname, '..');
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A small PDF whose pages say "<label>-page-<n>".
function pdf(n, label) {
  const objects = []; const add = s => { objects.push(s); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Count ' + n + ' /Kids [' + Array.from({ length: n }, (_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 1; i <= n; i++) {
    // label null: a "scanned" page, a grey block and no text at all
    const data = label == null ? '0.6 g 20 20 360 200 re f\n' : 'BT /F1 9 Tf 20 220 Td (' + label + '-page-' + i + ' words about the topic) Tj ET\n';
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (3 + i * 2) + ' 0 R >>');
    add('<< /Length ' + data.length + ' >>\nstream\n' + data + 'endstream');
  }
  let out = '%PDF-1.4\n';
  const offsets = objects.map((s, i) => { const j = out.length; out += (i + 1) + ' 0 obj\n' + s + '\nendobj\n'; return j; });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(j => String(j).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(out + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n', 'ascii');
}
const ndjson = (...lines) => lines.map(l => JSON.stringify(l)).join('\n') + '\n';

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-fe1145-'));
  const files = {
    'Welcome.md': 'Welcome',
    'LA/Lecture.pdf': pdf(2, 'LEC'),
    'LA/作业/作业 1.md': '# 作业 1\n\n[题目附件](附件/作业%201.pdf) · [说明](<说明 v2.txt>) · [官网](https://example.org/x)\n\n![图](附件/fig.png)\n',
    'LA/作业/附件/作业 1.pdf': pdf(2, 'LAHW'),
    'LA/作业/附件/fig.png': Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex'),
    'LA/作业/说明 v2.txt': 'LA instructions',
    'MA/作业/附件/作业 1.pdf': pdf(2, 'MAHW'), // same name, another course
    'Phys/Slides.pdf': pdf(3, 'PHYS'),         // a course with PDFs only
    'Scans/Exam scan.pdf': pdf(2, null),       // a course with scanned PDFs only (no text layer)
    'Cards.md': '# Cards\n\n## Chapter A\n\nWhat is the rule? :: Rule A\n\nUnique here? :: Yes\n\n## Chapter B\n\nWhat is the rule? :: Rule B\n',
  };
  for (let i = 0; i < 205; i++) files[`Big/item-${String(i).padStart(3, '0')}.txt`] = 'x';
  for (const [n, b] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(vault, n)), { recursive: true }); await fs.writeFile(path.join(vault, n), b); }

  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  async function page({ lang = 'en', use = {} } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(({ lang, use }) => {
      localStorage.setItem('mo:lang', JSON.stringify(lang));
      localStorage.setItem('mo:ai', JSON.stringify({ keys: { deepseek: 'test-only' }, models: { deepseek: 'deepseek-flash' }, use: { check: 'off', quiz: 'off', chat: 'off', plan: 'deepseek', exam: 'deepseek', mock: 'deepseek', import: 'deepseek', inbox: 'off', ...use } }));
    }, { lang, use });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    p.on('dialog', d => d.accept());
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor();
    await p.waitForFunction(() => typeof window.__moFlush === 'function' && window.app?.commands);
    await sleep(300);
    return p;
  }
  async function test(name, fn, opts = {}) {
    if (filter && !filter.test(name)) return;
    let p;
    try { p = await page(opts); await fn(p); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { results.push({ name, pass: false, error: e.message }); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 8).join('\n  ')); }
    finally { await p?.context().close(); }
  }
  const run = (p, id) => p.evaluate(id => window.app.commands.executeCommandById(id), id);

  /* ---------- 1. Find course files: Graphite's manual preview ---------- */
  const manualPlan = (extra = {}) => ({ job: 'import', planId: 'plan-1', planMode: 'manual', planningIssue: { code: 'outside', framework: 'codex' }, counts: {}, total: 3,
    folders: ['Linear Algebra/课件 Slides', 'Linear Algebra/作业 Homework', 'Mathematical Analysis'],
    items: [
      { src: 'C:/fake/LA/Slides/LA9.pdf', name: 'LA9.pdf', dest: 'Linear Algebra/课件 Slides/LA9.pdf', kind: 'copy', course: 'LA', selectedByDefault: true },
      { src: 'C:/fake/Downloads/scan 3.pdf', name: 'scan 3.pdf', dest: 'scan 3.pdf', kind: 'copy', course: null, selectedByDefault: false },
      { src: 'C:/fake/LA/HW/hw.docx', name: 'hw.docx', dest: 'Linear Algebra/作业 Homework/hw.pdf', kind: 'convert', course: 'LA', selectedByDefault: true },
    ],
    duplicates: [{ src: 'C:/fake/Downloads/LA1 copy.pdf', match: 'Linear Algebra/课件 Slides/LA1.pdf' }], ...extra });

  await test('import: Codex fell back to a manual preview (not "read 0 files"), unknown course unticked, folders editable, apply sends destinations', async p => {
    const bodies = [];
    await p.route(origin + '/api/agent', async r => {
      const b = JSON.parse(r.request().postData()); bodies.push(b);
      if (b.phase === 'plan') return r.fulfill({ body: ndjson({ progress: { step: 'scan', path: 'C:/fake' } }, { result: { ...manualPlan(), framework: 'deepseek', reads: [] } }), contentType: 'application/x-ndjson' });
      return r.fulfill({ body: ndjson({ result: { job: 'import', planMode: 'manual', done: [{ dest: 'Linear Algebra/新目录/LA9.pdf' }, { dest: 'scan 3.pdf' }], failed: [] } }), contentType: 'application/x-ndjson' });
    });
    await run(p, 'find-course-files');
    await p.locator('.fj-item').first().waitFor();
    const text = await p.locator('.fj-body').innerText();
    assert.ok(!/read 0 files|读取了 0 个文件/.test(text), 'no "read 0 files": ' + text);
    assert.equal(await p.locator('.fj-reads').count(), 0);
    assert.match(text, /Graphite’s own scan/);
    assert.match(await p.locator('.fj-issue').innerText(), /Codex CLI/);
    assert.deepEqual(await p.locator('.fj-item input[type=checkbox]').evaluateAll(xs => xs.map(x => x.checked)), [true, false, true]);
    assert.match(await p.locator('.fj-item').nth(1).innerText(), /Course unclear/);
    assert.match(await p.locator('.fj-dupes').textContent(), /LA1 copy\.pdf[\s\S]*Linear Algebra\/课件 Slides\/LA1\.pdf/);
    await p.locator('[data-f="0"]').fill('Linear Algebra/新目录');
    await p.locator('#fj-i-1').check();
    await p.locator('[data-f="1"]').fill(''); // the vault root, chosen explicitly
    assert.equal(await p.locator('[data-f="1"]').getAttribute('placeholder'), 'Vault root');
    await p.locator('[data-a=apply]').click();
    await p.locator('.review-done').waitFor();
    const apply = bodies.find(b => b.phase === 'apply');
    assert.deepEqual(apply.accept, [0, 1, 2]);
    assert.deepEqual(apply.destinations, { 0: 'Linear Algebra/新目录/LA9.pdf' }, 'only changed folders are sent (item 1 already at the root)');
    assert.equal(apply.planId, 'plan-1');
    assert.equal(apply.provider, 'deepseek', 'an automatic fallback is confirmed with the AI that owns the plan');
    assert.match(await p.locator('.fj-body').innerText(), /Vault root \/ scan 3\.pdf/);
  });

  await test('import: "Scan without AI" with no AI chosen sends provider graphite, no key/model; all-duplicate result lists them, labelled Graphite', async p => {
    const bodies = [], headers = [];
    await p.route(origin + '/api/agent', async r => {
      bodies.push(JSON.parse(r.request().postData())); headers.push(r.request().headers());
      return r.fulfill({ body: ndjson({ result: { job: 'import', empty: true, counts: {}, items: [], duplicates: [{ src: 'C:/fake/a.pdf', match: 'LA/Lecture.pdf' }, { src: 'C:/fake/b.pdf', match: 'Phys/Slides.pdf' }] } }), contentType: 'application/x-ndjson' });
    });
    await run(p, 'find-course-files');
    await p.locator('[data-a=manual]').click();
    await p.locator('.fj-dupes[open]').waitFor();
    const b = bodies[0];
    assert.equal(b.provider, 'graphite'); assert.equal(b.planning, 'manual'); assert.equal(b.phase, 'plan');
    assert.ok(!('model' in b) && !('framework' in b), JSON.stringify(b));
    assert.ok(!headers[0]['x-ai-key'], 'no key header');
    const text = await p.locator('.fj-body').innerText();
    assert.match(text, /Graphite’s own scan/); assert.match(text, /a\.pdf[\s\S]*LA\/Lecture\.pdf/); assert.match(text, /b\.pdf[\s\S]*Phys\/Slides\.pdf/);
  }, { use: { import: 'off' } });

  await test('import: switching to the Graphite scan while the AI plans ignores the AI\'s late answer', async p => {
    const bodies = [];
    await p.route(origin + '/api/agent', async r => {
      const b = JSON.parse(r.request().postData()); bodies.push(b);
      if (b.provider !== 'graphite') {
        await sleep(1500);
        return r.fulfill({ body: ndjson({ result: { job: 'import', planId: 'ai-plan', items: [{ name: 'AI.pdf', dest: 'X/AI.pdf' }], total: 1 } }), contentType: 'application/x-ndjson' }).catch(() => {});
      }
      return r.fulfill({ body: ndjson({ result: manualPlan({ planningIssue: undefined, planId: 'g-plan' }) }), contentType: 'application/x-ndjson' });
    });
    await run(p, 'find-course-files');
    await p.locator('.fj-actions [data-a=manual]').click();
    await p.locator('.fj-item').first().waitFor();
    await sleep(2000); // the AI's answer would arrive now
    assert.equal(await p.locator('.fj-manual-who').count(), 1);
    assert.ok(!(await p.locator('.fj-body').innerText()).includes('AI.pdf'));
    assert.equal(bodies.at(-1).provider, 'graphite');
  });

  await test('import: a framework error is put into words once (no repeated "work folder kept")', async p => {
    await p.route(origin + '/api/agent', r => r.fulfill({ body: ndjson({ error: 'raw', code: 'outside', detail: 'C:/elsewhere/x', framework: 'codex', stage: 'C:/stage/1' }), contentType: 'application/x-ndjson' }));
    await run(p, 'find-course-files');
    const err = await p.locator('.fj-error').innerText();
    assert.equal((err.match(/C:\/stage\/1/g) || []).length, 1, err);
    assert.equal((err.match(/Codex CLI/g) || []).length, 1, err);
    assert.ok(await p.locator('.fj-actions [data-a=manual]').count(), 'the Graphite scan is offered after an error');
  }, { use: { import: 'codex' } });

  /* ---------- 2. Review ratings that can't be saved ---------- */
  await test('review: a failed save shows "not saved" with Retry; __moFlush reports reviewUnsaved with the message in Chinese; retry saves', async p => {
    let fail = true;
    await p.route(origin + '/api/file?path=.obsidian%2Fmyobsidian%2Freview.json', r => (fail && r.request().method() !== 'GET' ? r.fulfill({ status: 500, json: { error: 'disk full' } }) : r.continue()));
    await p.evaluate(async () => { const RV = await import('/review.js'); RV.rate({ id: 'card-x', path: 'Cards.md' }, 3); });
    const flushed = await p.evaluate(() => window.__moFlush());
    assert.equal(flushed.ok, false); assert.equal(flushed.reviewUnsaved, true);
    assert.equal(flushed.reviewMessage, '复习进度还没有保存。请重试或返回继续编辑。');
    assert.deepEqual(flushed.unsaved, [], 'only real note/code drafts are listed');
    await p.locator('.review-unsaved-bar').waitFor();
    fail = false;
    await p.locator('.review-unsaved-bar button').click();
    await p.locator('.review-unsaved-bar').waitFor({ state: 'detached' });
    const disk = JSON.parse(await fs.readFile(path.join(vault, '.obsidian/myobsidian/review.json'), 'utf8'));
    assert.ok(disk.cards['card-x']);
    const after = await p.evaluate(() => window.__moFlush());
    assert.equal(after.ok, true); assert.ok(!after.reviewUnsaved);
  }, { lang: 'zh-CN' });

  await test('review: a rating kept for crash recovery is saved once, even when two windows recover it', async p => {
    await p.evaluate(() => {
      const op = { k: 'days', id: '99999', inc: 1, u: 'same-op-1' };
      localStorage.setItem('mo:reviewPending:w1', JSON.stringify({ vault: '', ops: [op] }));
      localStorage.setItem('mo:reviewPending:w2', JSON.stringify({ vault: '', ops: [op] }));
      localStorage.setItem('mo:reviewPendingIndex', JSON.stringify(['w1', 'w2']));
    });
    await p.reload(); await p.waitForFunction(() => typeof window.__moFlush === 'function'); await sleep(400);
    await p.evaluate(() => window.__moFlush());
    // A second window recovering the same operation again:
    await p.evaluate(() => { localStorage.setItem('mo:reviewPending:w3', JSON.stringify({ vault: '', ops: [{ k: 'days', id: '99999', inc: 1, u: 'same-op-1' }] })); localStorage.setItem('mo:reviewPendingIndex', JSON.stringify(['w3'])); });
    await p.reload(); await p.waitForFunction(() => typeof window.__moFlush === 'function'); await sleep(400);
    await p.evaluate(() => window.__moFlush());
    const disk = JSON.parse(await fs.readFile(path.join(vault, '.obsidian/myobsidian/review.json'), 'utf8'));
    assert.equal(disk.days['99999'], 1);
  });

  /* ---------- 5. Same question in two sections ---------- */
  await test('cards: the same question in two sections gets two ids (with its section); a unique card keeps its old id', async p => {
    const r = await p.evaluate(async () => {
      const RV = await import('/review.js'), { hash } = await import('/sync.js');
      const content = (await (await fetch('/api/file?path=Cards.md')).json()).content;
      const cards = RV.extractCards('Cards.md', content).filter(c => c.kind === 'qa');
      return { cards: cards.map(c => ({ id: c.id, q: c.q, section: c.section })), oldShared: hash('Cards.md\u0000qa\u0000What is the rule?'), oldUnique: hash('Cards.md\u0000qa\u0000Unique here?') };
    });
    const rule = r.cards.filter(c => c.q === 'What is the rule?');
    assert.equal(rule.length, 2); assert.notEqual(rule[0].id, rule[1].id);
    assert.ok(!rule.some(c => c.id === r.oldShared), 'the old shared record is given to neither');
    assert.deepEqual(rule.map(c => c.section), ['Cards › Chapter A', 'Cards › Chapter B']);
    assert.equal(r.cards.find(c => c.q === 'Unique here?').id, r.oldUnique);
  });

  /* ---------- 4. Relative attachment links in an assignment note ---------- */
  await test('links: relative PDF/TXT links resolve from the note\'s folder (spaces, Chinese, same name in another course) and open in Graphite', async p => {
    await p.locator('#tree [data-path="LA/作业/作业 1.md"]').click();
    await p.locator('#preview a.attachment-link').first().waitFor();
    const opens = await p.locator('#preview a.attachment-link').evaluateAll(as => as.map(a => a.dataset.open));
    assert.deepEqual(opens, ['LA/作业/附件/作业 1.pdf', 'LA/作业/说明 v2.txt']);
    assert.equal(await p.locator('#preview a.external').getAttribute('target'), '_blank');
    assert.match(await p.locator('#preview img').getAttribute('src'), /\/vault\/LA\/.*fig\.png$/);
    await p.locator('#preview a.attachment-link').first().click();
    await p.waitForFunction(() => document.title.startsWith('作业 1.pdf'));
    assert.match(await p.locator('#breadcrumb').innerText(), /LA/);
  });

  /* ---------- verification: new note next to an open PDF; sidebar finds attachments, >200 ---------- */
  await test('new note while a PDF is open goes into the PDF\'s folder', async p => {
    await p.locator('#tree [data-path="Phys/Slides.pdf"]').click();
    await p.waitForFunction(() => document.title.startsWith('Slides.pdf'));
    await p.keyboard.press('Alt+n');
    await p.waitForFunction(() => [...document.querySelectorAll('#tree .tree-item.file')].some(e => /^Phys\/.*\.md$/.test(e.dataset.path)));
  });

  await test('search: an exact attachment name finds it first; more than 200 results continue with "Show more"', async p => {
    await p.keyboard.press('Control+Shift+F');
    await p.locator('#search-input').fill('作业 1.pdf');
    await sleep(400);
    assert.match(await p.locator('#search-results .sr-title').first().getAttribute('data-open'), /作业 1\.pdf$/);
    await p.locator('#search-input').fill('item-');
    await sleep(400);
    assert.equal(await p.locator('#search-results .sr-file').count(), 200);
    await p.locator('#search-results .sr-more').click();
    assert.equal(await p.locator('#search-results .sr-file').count(), 205);
  });

  /* ---------- verification: a PDF-only course in a revision plan; materials reach every kind of AI ---------- */
  await test('plan: a course with only readable PDFs can be planned; the API model gets page excerpts', async p => {
    const calls = [];
    await p.route(origin + '/api/ai', r => { calls.push(JSON.parse(r.request().postData())); return r.fulfill({ json: { title: 'Phys plan', markdown: '---\ntags: [x]\n---\n## Day 1\n- [ ] read' } }); });
    await run(p, 'revision-plan');
    await p.locator('[data-folder="Phys"]').check();
    await p.locator('[data-f=exam]').fill('Physics final');
    await p.locator('[data-a=go]').click();
    await p.waitForFunction(() => document.title.includes('Phys plan'));
    assert.match(calls[0].content, /--- Slides\.pdf page 1 ---\nPHYS-page-1/);
  });

  for (const [lang, next] of [['en', /choose PDFs that have a text layer, add a text note for this range, or run OCR/], ['zh-CN', /选择含文字层的 PDF、为这个范围添加文字笔记，或先对扫描件运行 OCR 识别文字/]]) {
    await test('plan (' + lang + '): a range of scanned PDFs only says what to do next, stays in the form, and sends nothing', async p => {
      const calls = [];
      await p.route(origin + '/api/ai', r => { calls.push(1); return r.fulfill({ json: {} }); });
      await run(p, 'revision-plan');
      await p.locator('[data-folder="Scans"]').check();
      await p.locator('[data-f=exam]').fill('Scan exam');
      await p.locator('[data-a=go]').click();
      await p.locator('.ai-range-summary[data-no-readable]').waitFor();
      assert.match(await p.locator('.ai-range-summary').innerText(), next);
      assert.equal(await p.locator('.ai-range-summary').getAttribute('role'), 'alert');
      assert.equal(calls.length, 0);
    }, { lang });
  }

  await test('plan: a local framework receives the chosen PDFs and notes as files', async p => {
    const calls = [];
    await p.route(origin + '/api/local-ai', r => { calls.push(JSON.parse(r.request().postData())); return r.fulfill({ json: { title: 'Phys plan', markdown: '# x' } }); });
    await run(p, 'revision-plan');
    await p.locator('[data-folder="Phys"]').check();
    await p.locator('[data-a=go]').click();
    await p.waitForFunction(() => document.title.includes('Phys plan'));
    assert.ok(calls[0].files.includes('Phys/Slides.pdf'), JSON.stringify(calls[0].files));
    assert.ok(calls[0].files.every(f => f.startsWith('Phys/')), 'only files in the chosen range: ' + JSON.stringify(calls[0].files));
  }, { use: { plan: 'dsh' } });

  await test('mock: a past paper can be added by hand and is used', async p => {
    const calls = [];
    await p.route(origin + '/api/ai', r => { calls.push(JSON.parse(r.request().postData())); return r.fulfill({ json: { title: 'LA mock', topics: [], problems: [{ no: '1', marks: 10, kind: 'past', sourceFile: 'LA/Lecture.pdf', sourcePage: 1, sourceLabel: 'L', topic: 't', question: 'q', answer: 'a' }] } }); });
    await run(p, 'mock-paper');
    await p.locator('[data-f=course]').selectOption('LA');
    await p.locator('[data-f=addPaper]').fill('LA/Lecture.pdf');
    await p.locator('[data-a=add-paper]').click();
    assert.equal(await p.locator('[data-paper="LA/Lecture.pdf"]').isChecked(), true);
    await p.locator('[data-a=go]').click();
    await p.waitForFunction(() => document.title.includes('LA mock'));
    assert.match(calls[0].content, /LEC-page-1/);
  });

  /* ---------- 3, 6, 7. Canvas submission drafts (simulated school; nothing is ever sent by itself) ---------- */
  await test('canvas: drafts follow the accountKey; expiry keeps them paused, same account restores with a new preview, another account clears; files append', async p => {
    const r = await p.evaluate(async () => {
      const { createSubmissionDialog } = await import('/canvas-submit.js');
      let state = { connected: true, accountKey: 'A', user: 'Same Name', authMode: 'oauth', canSubmit: true };
      let submits = 0; const real = window.fetch;
      window.fetch = async (url, o) => { if (String(url).includes('/api/canvas/submit')) { submits++; return new Response('{}', { status: 500 }); } return real(url, o); };
      const s = createSubmissionDialog({ esc: x => String(x), formatTime: () => '', getState: () => state, listFiles: async () => ({ files: [] }), authorize: async () => {}, openOfficial: async () => {}, onAccepted: () => {} });
      const course = { id: 1, name: 'Algebra' }, item = { id: 7, title: 'HW1', submissionTypes: ['online_text_entry', 'online_upload'], attempt: 0 };
      const out = {};
      s.statusChanged(null, state);
      s.open(course, item);
      document.querySelector('#cv-submit-text').value = 'my answer'; document.querySelector('#cv-submit-text').dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('[data-submit-action=preview]').click();
      await new Promise(r => setTimeout(r, 50));
      out.previewed = !!document.querySelector('[data-submit-action=confirm]');
      let next = { ...state, connected: false, canSubmit: false };           // session expired
      s.statusChanged(state, next); state = next;
      out.closedOnExpiry = !document.querySelector('#cv-submit-dialog');
      s.open(course, item);
      out.pausedText = document.querySelector('#cv-submit-text')?.value;
      out.pausedNotice = !!document.querySelector('[data-submit-paused]');
      out.noConfirmWhilePaused = !document.querySelector('[data-submit-action=confirm]');
      next = { ...state, connected: true, canSubmit: true };                  // same account back
      s.statusChanged(state, next); state = next;
      s.open(course, item);
      out.restoredText = document.querySelector('#cv-submit-text')?.value;
      out.repreviewNotice = !!document.querySelector('[data-submit-repreview]');
      next = { ...state, accountKey: 'B' };                                   // same display name, another student
      s.statusChanged(state, next); state = next;
      out.closedOnSwitch = !document.querySelector('#cv-submit-dialog');
      s.open(course, item);
      out.otherText = document.querySelector('#cv-submit-text')?.value;
      out.submits = submits;
      s.clear();
      return out;
    });
    assert.deepEqual(r, { previewed: true, closedOnExpiry: true, pausedText: 'my answer', pausedNotice: true, noConfirmWhilePaused: true,
      restoredText: 'my answer', repreviewNotice: true, closedOnSwitch: true, otherText: '', submits: 0 });
    // Files from the computer: a second choice adds to the first; the same name twice is marked.
    await p.evaluate(async () => {
      const { createSubmissionDialog } = await import('/canvas-submit.js');
      const state = { connected: true, accountKey: 'A', authMode: 'oauth', canSubmit: true };
      window.__s = createSubmissionDialog({ esc: x => String(x), formatTime: () => '', getState: () => state, listFiles: async () => ({ files: [] }), authorize: async () => {}, openOfficial: async () => {}, onAccepted: () => {} });
      window.__s.statusChanged(null, state);
      window.__s.open({ id: 1, name: 'Algebra' }, { id: 8, title: 'HW2', submissionTypes: ['online_upload'], attempt: 0 });
    });
    await p.locator('#cv-submit-files').setInputFiles([{ name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('a') }]);
    await p.locator('#cv-submit-files').setInputFiles([{ name: 'b.pdf', mimeType: 'application/pdf', buffer: Buffer.from('bb') }, { name: 'a.pdf', mimeType: 'application/pdf', buffer: Buffer.from('aaa') }]);
    const rows = await p.locator('.cv-attachment-list li').allInnerTexts();
    assert.equal(rows.length, 3, rows.join('|'));
    assert.equal(await p.locator('.cv-attachment-list li.cv-dup').count(), 2);
    await p.locator('.cv-attachment-list li').nth(2).locator('.cv-remove').click();
    assert.equal(await p.locator('.cv-attachment-list li').count(), 2);
    assert.equal(await p.locator('.cv-attachment-list li.cv-dup').count(), 0);
  });

  await test('canvas: an unclear result is verified first; not received → the student restores (new request id); unknown status stays unknown; never resent', async p => {
    const r = await p.evaluate(async () => {
      const { createSubmissionDialog } = await import('/canvas-submit.js');
      const state = { connected: true, accountKey: 'A', authMode: 'oauth', canSubmit: true };
      const forms = [], real = window.fetch;
      window.fetch = async (url, o) => { if (!String(url).includes('/api/canvas/submit')) return real(url, o); forms.push(Object.fromEntries(o.body.entries())); return new Response(JSON.stringify({ code: 'submission_unknown', error: 'x' }), { status: 502 }); };
      const ids = { courseId: 1, assignmentId: 9, accountKey: 'A' };
      let answer = { ...ids, status: 'unknown', attempt: null, submittedAt: null };
      const asked = [];
      const s = createSubmissionDialog({ esc: x => String(x), formatTime: () => '', getState: () => state, listFiles: async () => ({ files: [] }), authorize: async () => {}, openOfficial: async () => {}, onAccepted: () => {},
        verify: async (c, a, k) => { asked.push([c, a, k]); if (answer === 'network') throw new Error('offline'); return answer; } });
      s.statusChanged(null, state);
      // Canvas's record when the draft was made: clearly not submitted yet.
      s.open({ id: 1, name: 'Algebra' }, { id: 9, title: 'HW3', submissionTypes: ['online_text_entry'], attempt: 0, submissionEvidence: { status: 'unsubmitted', attempt: null, submittedAt: null } });
      const q = s => document.querySelector(s), tick = () => new Promise(r => setTimeout(r, 30));
      q('#cv-submit-text').value = 'answer'; q('#cv-submit-text').dispatchEvent(new Event('input', { bubbles: true }));
      q('[data-submit-action=preview]').click(); await tick();
      q('[data-submit-action=confirm]').click(); await tick();
      const out = { unknown: !!q('[data-submit-unknown]'), firstId: forms[0].requestId };
      q('[data-submit-action=verify]').click(); await tick();          // status "unknown"
      out.stillUnknown = !!q('[data-submit-unknown]') && !q('[data-submit-not-received]');
      answer = 'network';
      q('[data-submit-action=verify]').click(); await tick();          // network error
      answer = { ...ids, assignmentId: 10, status: 'unsubmitted', attempt: 0, submittedAt: null };
      q('[data-submit-action=verify]').click(); await tick();          // an answer about another assignment
      answer = { courseId: 1, assignmentId: 9, status: 'unsubmitted', attempt: null, submittedAt: null };
      q('[data-submit-action=verify]').click(); await tick();          // an answer that names no account
      out.stillUnknownAfterAll = !!q('[data-submit-unknown]') && !q('[data-submit-not-received]') && !q('[data-submit-receipt]');
      out.askedWith = asked[0];
      answer = { ...ids, status: 'unsubmitted', attempt: 0, submittedAt: null };
      q('[data-submit-action=verify]').click(); await tick();          // Canvas clearly has nothing
      out.notReceived = !!q('[data-submit-not-received]');
      await new Promise(r => setTimeout(r, 300));
      out.sendsBeforeRestore = forms.length;
      q('[data-submit-action=restore]').click(); await tick();
      out.restoredText = q('#cv-submit-text').value;
      q('[data-submit-action=preview]').click(); await tick();
      q('[data-submit-action=confirm]').click(); await tick();
      out.secondIdNew = forms[1].requestId !== out.firstId;
      s.clear();
      return out;
    });
    assert.deepEqual(r, { unknown: true, firstId: r.firstId, stillUnknown: true, stillUnknownAfterAll: true, askedWith: [1, 9, 'A'], notReceived: true, sendsBeforeRestore: 1, restoredText: 'answer', secondIdNew: true });
  });

  // A dialog with a simulated school, sent to "unknown" (the school's answer was lost). Returns helpers.
  const unclearDraft = `async (evidence, item = {}) => {
      const { createSubmissionDialog } = await import('/canvas-submit.js');
      const state = window.__state = { connected: true, accountKey: 'A', authMode: 'oauth', canSubmit: true };
      const forms = window.__forms = [], real = window.fetch;
      window.fetch = async (url, o) => { if (!String(url).includes('/api/canvas/submit')) return real(url, o); forms.push(Object.fromEntries(o.body.entries())); return new Response(JSON.stringify({ code: 'submission_unknown', error: 'x' }), { status: 502 }); };
      window.__answers = []; window.__accepted = [];
      const s = window.__s = createSubmissionDialog({ esc: x => String(x), formatTime: () => '', getState: () => window.__state, listFiles: async () => ({ files: [] }), authorize: async () => {}, openOfficial: async () => {},
        onAccepted: (...a) => window.__accepted.push(a),
        verify: async () => { const a = window.__answers.shift(); if (a === 'network' || a === undefined) throw new Error('offline'); return a; } });
      s.statusChanged(null, state);
      s.open({ id: 1, name: 'Algebra' }, { id: 9, title: 'HW3', submissionTypes: ['online_text_entry'], attempt: 0, ...(evidence === undefined ? {} : { submissionEvidence: evidence }), ...item });
      const q = s => document.querySelector(s), tick = () => new Promise(r => setTimeout(r, 30));
      q('#cv-submit-text').value = 'answer'; q('#cv-submit-text').dispatchEvent(new Event('input', { bubbles: true }));
      q('[data-submit-action=preview]').click(); await tick();
      q('[data-submit-action=confirm]').click(); await tick();
    }`;
  const verifyWith = (p, answer) => p.evaluate(async a => {
    window.__answers.push(a);
    document.querySelector('[data-submit-action=verify]')?.click();
    await new Promise(r => setTimeout(r, 40));
    const q = s => document.querySelector(s);
    return q('[data-submit-receipt]') ? 'received' : q('[data-submit-not-received]') ? 'not-received' : q('[data-submit-unknown]') ? 'unknown' : 'other';
  }, answer);

  await test('canvas #16: a check counts only with the exact account (a non-empty string, never an array or a number), course and assignment', async p => {
    await p.evaluate(`(${unclearDraft})({ status: 'unsubmitted', attempt: null, submittedAt: null })`);
    const ok = { courseId: '1', assignmentId: '9', accountKey: 'A', status: 'unsubmitted', attempt: null, submittedAt: null };
    for (const wrong of [
      { ...ok, accountKey: undefined }, { ...ok, accountKey: '' }, { ...ok, accountKey: ['A'] }, { ...ok, accountKey: 'B' },
      { ...ok, courseId: '' }, { ...ok, courseId: ['1'] }, { ...ok, assignmentId: undefined }, { ...ok, assignmentId: '10' }, { ...ok, assignmentId: { id: '9' } }, { ...ok, courseId: 1.5 },
    ]) assert.equal(await verifyWith(p, wrong), 'unknown', JSON.stringify(wrong));
    assert.equal(await verifyWith(p, ok), 'not-received');
    assert.equal(await p.evaluate(() => window.__forms.length), 1, 'nothing sent again');
  });

  await test('canvas #16: a number as the account never matches an account written as text', async p => {
    await p.evaluate(`(${unclearDraft})({ status: 'unsubmitted', attempt: null, submittedAt: null })`);
    await p.evaluate(() => { const next = { ...window.__state, accountKey: '123' }; window.__s.statusChanged(window.__state, next); window.__state = next; });
    // Another account clears the drafts; open again as "123" and get to "unknown" once more.
    await p.evaluate(async () => {
      window.__s.open({ id: 1, name: 'Algebra' }, { id: 9, title: 'HW3', submissionTypes: ['online_text_entry'], attempt: 0, submissionEvidence: { status: 'unsubmitted', attempt: null, submittedAt: null } });
      const q = s => document.querySelector(s), tick = () => new Promise(r => setTimeout(r, 30));
      q('#cv-submit-text').value = 'answer'; q('#cv-submit-text').dispatchEvent(new Event('input', { bubbles: true }));
      q('[data-submit-action=preview]').click(); await tick(); q('[data-submit-action=confirm]').click(); await tick();
    });
    assert.equal(await verifyWith(p, { courseId: 1, assignmentId: 9, accountKey: 123, status: 'unsubmitted', attempt: null }), 'unknown');
    assert.equal(await verifyWith(p, { courseId: 1, assignmentId: 9, accountKey: '123', status: 'unsubmitted', attempt: null }), 'not-received');
  });

  await test('canvas #16: the record had a submission and Canvas now says "not submitted": stays unknown with the reason, no restore; only a higher attempt counts', async p => {
    await p.evaluate(`(${unclearDraft})({ status: 'submitted', attempt: 2, submittedAt: '2026-11-01T10:00:00Z' }, { submitted: true, attempt: 2 })`);
    const ids = { courseId: '1', assignmentId: '9', accountKey: 'A' };
    assert.equal(await p.evaluate(() => window.__forms[0].expectedAttempt), '2', 'the baseline attempt is what Canvas is told to expect');
    assert.equal(await verifyWith(p, { ...ids, status: 'unsubmitted', attempt: null }), 'unknown');
    assert.match(await p.locator('.cv-error').innerText(), /earlier record showed a submission/);
    assert.equal(await p.locator('[data-submit-action=restore]').count(), 0);
    assert.equal(await verifyWith(p, { ...ids, status: 'submitted', attempt: 2 }), 'unknown', 'the same attempt is no proof');
    assert.equal(await verifyWith(p, { ...ids, status: 'submitted', attempt: 3, submittedAt: '2026-11-20T10:00:00Z' }), 'received');
    assert.deepEqual(await p.evaluate(() => window.__accepted.map(a => [a[0], a[1], a[2].attempt, a[3]])), [[1, 9, 3, 'A']]);
    assert.equal(await p.evaluate(() => window.__forms.length), 1);
  });

  await test('canvas #16: a record Canvas left unclear ("unknown") that it cannot confirm now: nothing is sent, the draft stays, ready to try again', async p => {
    // An old-style row with a displayed attempt 0, and evidence "unknown": the baseline is read from Canvas first.
    await p.evaluate(`(${unclearDraft})({ status: 'unknown', attempt: null, submittedAt: null })`);
    // No answer queued: the baseline couldn't be read, so nothing was sent and the draft is kept.
    assert.equal(await p.evaluate(() => window.__forms.length), 0);
    assert.match(await p.locator('.cv-error').innerText(), /Couldn’t read this assignment’s current submission record/);
    assert.equal(await p.evaluate(() => document.querySelector('[data-submit-action=confirm]') !== null), true, 'still in the preview, ready to try again');
  });

  await test('canvas #16: an old record (no evidence, shown attempt 0): Canvas is asked before the first send; its attempt is used, not the 0', async p => {
    await p.evaluate(`(${unclearDraft})(undefined)`);
    assert.equal(await p.evaluate(() => window.__forms.length), 0, 'no baseline: nothing sent');
    const r = await p.evaluate(async () => {
      window.__answers.push({ courseId: '1', assignmentId: '9', accountKey: 'A', status: 'submitted', attempt: 4, submittedAt: '2026-10-01T00:00:00Z' });
      document.querySelector('[data-submit-action=confirm]').click();
      await new Promise(r => setTimeout(r, 60));
      return { sent: window.__forms.length, expected: window.__forms[0]?.expectedAttempt, text: window.__forms[0]?.text };
    });
    assert.deepEqual(r, { sent: 1, expected: '4', text: 'answer' });
    // The baseline (submitted, attempt 4) is fixed now: "not submitted" later is a contradiction, attempt 5 is a receipt.
    assert.equal(await verifyWith(p, { courseId: '1', assignmentId: '9', accountKey: 'A', status: 'unsubmitted', attempt: null }), 'unknown');
    assert.equal(await verifyWith(p, { courseId: '1', assignmentId: '9', accountKey: 'A', status: 'submitted', attempt: 5 }), 'received');
  });

  await test('canvas #16: A\'s answer arriving after switching to B (same course and assignment IDs and names) changes nothing in B\'s list; nothing is sent', async p => {
    const r = await p.evaluate(async () => {
      const { createCanvasView } = await import('/canvas-view.js');
      const course = (submitted, attempt) => ({ id: '1', name: 'Algebra', code: 'MATH', files: [], announcements: [], modules: [], quizzes: [], events: [], discussions: [], pages: [],
        assignments: [{ id: '9', title: 'HW3', dueAt: null, submissionTypes: ['online_text_entry'], submitted, attempt, submissionEvidence: { status: submitted ? 'submitted' : 'unsubmitted', attempt: submitted ? attempt : null, submittedAt: null } }] });
      const statusOf = key => ({ connected: true, accountKey: key, user: 'Same Name', authMode: 'oauth', canSubmit: true, syncedAt: '2026-11-20T00:00:00Z', snapshot: { courses: [course(false, 0)], warnings: [] } });
      let current = statusOf('A'), release, submits = 0;
      const lateAnswer = new Promise(r => { release = r; });
      const api = async (method, path, query, body) => {
        if (path === 'canvas/status') return JSON.parse(JSON.stringify(current));
        if (path === 'canvas/verify-submission') { await lateAnswer; return { courseId: '1', assignmentId: '9', accountKey: 'A', status: 'submitted', attempt: 5, submittedAt: '2026-11-20T10:00:00Z' }; }
        return {};
      };
      const real = window.fetch;
      window.fetch = async (url, o) => { if (String(url).includes('/api/canvas/submit')) { submits++; return new Response(JSON.stringify({ code: 'submission_unknown' }), { status: 502 }); } return real(url, o); };
      const root = document.createElement('div'); document.body.append(root);
      const view = createCanvasView(root, { api, openFile: async () => {} });
      const tick = (ms = 40) => new Promise(r => setTimeout(r, ms)), q = s => document.querySelector(s);
      view.show(); await tick(80);
      root.querySelector('[data-group=assignments]').click(); await tick();
      root.querySelector('[data-cv=submission]').click(); await tick();
      q('#cv-submit-text').value = 'answer'; q('#cv-submit-text').dispatchEvent(new Event('input', { bubbles: true }));
      q('[data-submit-action=preview]').click(); await tick();
      q('[data-submit-action=confirm]').click(); await tick();
      const unknown = !!q('[data-submit-unknown]');
      q('[data-submit-action=verify]').click(); await tick();      // A's check is on its way…
      current = statusOf('B');                                         // …and the student switches to B
      view.hide(); view.show(); await tick(80);
      const before = (root.querySelector('[data-group=assignments]')?.click(), await tick(), root.querySelector('[data-cv=submission]')?.textContent);
      release(); await tick(80);                                       // A's answer arrives now
      view.hide(); view.show(); await tick(80);                        // draw B's list again from memory
      root.querySelector('[data-group=assignments]')?.click(); await tick();
      const bButton = root.querySelector('[data-cv=submission]')?.textContent;
      const shown = root.textContent;
      view.close(); root.remove();
      return { unknown, submits, dialogOpen: !!q('#cv-submit-dialog'), before, bButton, receiptShown: /\b5\b/.test(shown) };
    });
    assert.equal(r.unknown, true);
    assert.equal(r.before, 'Submit assignment');
    assert.equal(r.bButton, 'Submit assignment', 'B\'s assignment with the same ID is still not submitted');
    assert.equal(r.submits, 1, 'never sent again');
    assert.equal(r.dialogOpen, false, 'the dialog for A closed when B signed in');
    assert.equal(r.receiptShown, false, 'no receipt from A shown to B');
  });

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
