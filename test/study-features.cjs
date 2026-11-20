// Regression checks for the student features and the related fixes, run in a real browser against a throwaway vault.
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
//   node test/study-features.cjs [repo] [filter]
// Needs Playwright (GRAPHITE_PLAYWRIGHT or the Codex runtime copy) and Chrome (GRAPHITE_CHROME). Nothing outside a
// new temporary folder is written. AI calls go to a fake local provider (the /api/ai request is answered here).
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const filter = process.argv[3] ? new RegExp(process.argv[3]) : null;
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// A PDF with `n` pages; pages in `empty` have no text; every other page has `words` words.
function pdf(n, empty = [], label = 'P', words = 12) {
  const objects = [];
  const add = s => { objects.push(s); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Count ' + n + ' /Kids [' + Array.from({ length: n }, (_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 1; i <= n; i++) {
    let data = '';
    if (!empty.includes(i)) {
      data = 'BT /F1 9 Tf 20 220 Td 11 TL (' + label + '-page-' + i + ') Tj';
      for (let l = 0; l < Math.ceil(words / 12); l++) data += ' T* (' + Array.from({ length: 12 }, (_, w) => 'word' + (l * 12 + w)).join(' ') + ') Tj';
      data += ' ET\n';
    } else data = 'q Q\n';
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 240] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (3 + i * 2) + ' 0 R >>');
    add('<< /Length ' + data.length + ' >>\nstream\n' + data + 'endstream');
  }
  let out = '%PDF-1.4\n';
  const offsets = objects.map((s, i) => { const j = out.length; out += (i + 1) + ' 0 obj\n' + s + '\nendobj\n'; return j; });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(j => String(j).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(out + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n', 'ascii');
}
const isoDay = off => { const d = new Date(Date.now() + off * 86400000); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-study-'));
  const files = {
    'Welcome.md': 'Welcome',
    'LA/Eigen.md': '# Eigen\n\n什么是特征值？ :: 使 Av = λv 成立的 λ\n\n问题 :: 答案\n\nstatus:: done\n',
    'LA/Ch1/Det.md': 'What is a determinant? :: A number from a square matrix\n\nWhy does a swap flip the sign? :: Alternating\n',
    'LA/Ch2/Maps.md': 'What is a linear map? :: Additive and homogeneous\n',
    'LA/Ch2/Kernel.md': 'What is the kernel? :: Vectors sent to 0\n',
    'Bio/Cells.md': 'What is a cell? :: The unit of life\n',
    'LA/Exam.pdf': pdf(85, [5, 9, 84], 'EX', 120),
    'LA/Lecture.pdf': pdf(3, [], 'LEC', 24),
    'ReferenceScratch.md': '# A source for this proof\n',
    'LA/复习资料/2024 期中.pdf': pdf(3, [], 'MID', 24),
    'LA/复习计划 Review Plans/Plan.md': `---\ntags: [Revision plan]\ncreated: 2026.11.20\n---\n# LA plan\n\n## Day 1 · ${isoDay(-1)}\n\n- [ ] [[Det]] (30)\n\n## Day 2 · ${isoDay(0)}\n\n- [ ] [[Maps]] (30)\n\n## Day 3 · ${isoDay(1)}\n\n- [ ] [[Kernel]] (30)\n`,
  };
  for (const [n, b] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(vault, n)), { recursive: true }); await fs.writeFile(path.join(vault, n), b); }
  // The Graphie chat plugin, to check that bundled plugins follow the language.
  const plugSrc = path.join(repo, 'extensions/obsidian-plugins/claude-chat');
  await fs.mkdir(path.join(vault, '.obsidian'), { recursive: true });
  await fs.writeFile(path.join(vault, '.obsidian/community-plugins.json'), JSON.stringify(['claude-chat']));
  if (fss.existsSync(plugSrc)) await fs.cp(plugSrc, path.join(vault, '.obsidian/plugins/claude-chat'), { recursive: true, filter: s => !/[\\/]chat([\\/]|$)/.test(s.slice(plugSrc.length)) });

  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  const aiCalls = [];
  async function page({ lang = 'en', plugins = false } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    // A fake API provider for this throwaway profile (no real key: the request is answered below).
    await ctx.addInitScript(({ lang, plugins }) => {
      localStorage.setItem('mo:lang', JSON.stringify(lang));
      if (plugins) localStorage.setItem('mo:pluginsOn', '1');
      localStorage.setItem('mo:ai', JSON.stringify({ keys: { deepseek: 'test-only' }, models: { deepseek: 'deepseek-flash' }, use: { check: 'deepseek', quiz: 'off', chat: 'claude-code', plan: 'deepseek', exam: 'deepseek', format: 'deepseek', connect: 'deepseek' } }));
    }, { lang, plugins });
    await ctx.route(origin + '/api/ai', async r => {
      const body = JSON.parse(r.request().postData() || '{}');
      aiCalls.push(body);
      if (body.task === 'plan') return r.fulfill({ json: { title: 'LA plan', markdown: '---\ntags: [Revision plan]\n---\n## Day 1\n- [ ] x' } });
      if (body.task === 'exam') {
        const pages = [...String(body.content).matchAll(/--- page (\d+) ---/g)].map(m => +m[1]);
        return r.fulfill({ json: { title: 'Exam analysis', markdown: `---\ntags: [Exam analysis]\n---\n## Summary\nPages ${pages[0]}-${pages.at(-1)}`,
          problems: [{ no: String(pages[0]), page: pages[0], topic: 'Eigen', question: 'Find $\\lambda$ on page ' + pages[0], myAnswer: '2', mistake: 'sign' }] } });
      }
      if (body.task === 'mock') return r.fulfill({ json: { title: 'LA mock', topics: [{ topic: 'Determinants', pastCount: 2, note: 'every year' }], problems: [
        { no: '1', marks: 40, kind: 'past', sourceFile: 'LA/复习资料/2024 期中.pdf', sourcePage: 2, sourceLabel: '2024 midterm Q2', topic: 'Determinants', question: 'Compute det A.', answer: 'Expand: 6.' },
        { no: '2', marks: 30, kind: 'variant', sourceFile: 'LA/复习资料/2024 期中.pdf', sourcePage: 3, sourceLabel: '2024 midterm Q5', topic: 'Determinants', question: 'Variant problem.', answer: 'Step 1\nStep 2' },
        { no: '3', marks: 30, kind: 'new', sourceFile: 'Det', sourcePage: 0, sourceLabel: 'Det', topic: 'Swaps', question: 'Why does a swap flip the sign?', answer: 'Alternating.' }] } });
      return r.fulfill({ status: 400, json: { error: 'unexpected task ' + body.task } });
    });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    p.on('dialog', d => d.accept());
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor();
    await p.waitForFunction(() => typeof window.__moFlush === 'function');
    await sleep(300);
    return p;
  }
  async function test(name, fn) {
    if (filter && !filter.test(name)) return;
    let p;
    try { p = await page(fn.opts || {}); await fn(p); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { const toast = await p?.locator('#toast').innerText().catch(() => ''); if (toast) e.message += '\n  last toast: ' + toast; results.push({ name, pass: false, error: e.message }); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').join('\n  ')); }
    finally { await p?.context().close(); }
  }
  const review = async () => JSON.parse(await fs.readFile(path.join(vault, '.obsidian/myobsidian/review.json'), 'utf8').catch(() => '{}'));

  try {
    await test('Reference PDF stays on its page while editing and inserts a durable citation', async p => {
      await p.locator('#tree [data-path="ReferenceScratch.md"]').dblclick();
      await p.locator('#reference-button').click();
      await p.locator('#modal-input').fill('LA/Lecture.pdf');
      await p.locator('#modal-list .modal-item').first().click();
      const pageNumber = p.locator('#reference-page');
      await pageNumber.fill('3');
      await pageNumber.press('Enter');
      await p.waitForFunction(() => document.querySelector('#reference-page').value === '3');
      const editor = p.locator('#editor');
      const old = await editor.inputValue();
      await editor.focus();
      await editor.press('Control+End');
      await p.locator('#reference-cite').click();
      const text = await editor.inputValue();
      assert.ok(text.startsWith(old));
      assert.match(text.slice(old.length), /\[\[Lecture\.pdf#page=3[|\]]/);
      await p.evaluate(() => window.__moFlush());
      assert.equal(await fs.readFile(path.join(vault, 'ReferenceScratch.md'), 'utf8'), text);
      await p.reload();
      await p.waitForFunction(() => document.querySelector('#reference-page')?.value === '3');
      await p.locator('#reference-close').click();
      assert.equal(await p.locator('#reference-pane').isVisible(), false);
    });
    await test('9 Chinese and spaced "question :: answer" make cards; "status:: done" stays a property', async p => {
      const cards = await p.evaluate(async () => (await import('/review.js')).cardsFor('LA/Eigen.md').map(c => [c.q, c.a]));
      assert.deepEqual(cards, [['什么是特征值？', '使 Av = λv 成立的 λ'], ['问题', '答案']]);
    });

    await test('10 plan: untick a chapter after ticking the course → it is left out of what is sent, final range shown', async p => {
      await p.evaluate(async () => (await import('/studyai.js')).planDialog());
      await p.locator('[data-f=exam]').fill('LA midterm');
      await p.locator('[data-folder="LA"]').check();
      await p.locator('[data-folder="LA/Ch2"]').uncheck();
      const summary = await p.locator('.ai-range-summary').innerText();
      const parent = await p.locator('[data-folder="LA"]').evaluate(x => ({ checked: x.checked, indeterminate: x.indeterminate }));
      assert.deepEqual(parent, { checked: false, indeterminate: true });
      assert.match(summary, /LA: .*Ch1/); assert.doesNotMatch(summary, /Ch2/);
      aiCalls.length = 0;
      await p.locator('[data-a=go]').click();
      await p.waitForFunction(() => document.querySelector('#title')?.value.startsWith('LA plan'));
      const sent = aiCalls.find(c => c.task === 'plan').content;
      assert.match(sent, /\[\[Det\]\]/); assert.match(sent, /\[\[Eigen\]\]/);
      assert.doesNotMatch(sent, /\[\[Maps\]\]|\[\[Kernel\]\]/, 'unticked chapter was still sent');
      assert.match(await p.locator('#editor').inputValue(), /LA\/Ch1/, 'plan note records the range used');
    });

    await test('11 + A exam analysis reads all 85 pages, reports no-text pages, batches, and problems go to the mistake book', async p => {
      await p.evaluate(async () => (await import('/studyai.js')).examDialog('LA/Exam.pdf'));
      await p.locator('.ai-pages-info').filter({ hasText: '85' }).waitFor();
      aiCalls.length = 0;
      await p.locator('[data-a=go]').click();
      await p.waitForFunction(() => document.querySelector('#title')?.value.startsWith('Exam analysis'), null, { timeout: 30000 });
      const sentPages = aiCalls.filter(c => c.task === 'exam').flatMap(c => [...c.content.matchAll(/--- page (\d+) ---/g)].map(m => +m[1]));
      assert.ok(aiCalls.length >= 2, 'long paper should be sent in batches, got ' + aiCalls.length);
      assert.ok(sentPages.includes(81) && sentPages.includes(85), 'pages after 80 missing');
      assert.ok(!sentPages.includes(5) && !sentPages.includes(84), 'empty pages should not be sent as text');
      const note = await p.locator('#editor').inputValue();
      assert.match(note, /\[!info\]/); assert.match(note, /5, 9, 84|5, 9, 84/); assert.match(note, /of 85|85/);
      assert.match(note, /```graphite-problems/);
      // Preview: problem list with "+ Mistake book".
      await p.evaluate(() => document.querySelector('[data-mode="preview"]')?.click());
      const add = p.locator('.study-problems [data-add]').first();
      await add.waitFor();
      await add.click();
      await p.locator('.study-mistake [data-f=myAnswer]').fill('λ = 2');
      await p.locator('.study-mistake [data-a=save]').click();
      await p.locator('.study-problems .study-added').first().waitFor();
      await p.evaluate(async () => (await import('/review.js')).flushReview());
      const items = Object.values((await review()).items || {}).filter(i => i.kind === 'mistake');
      assert.equal(items.length, 1);
      assert.equal(items[0].src, 'LA/Exam.pdf'); assert.ok(items[0].page > 0); assert.equal(items[0].myAnswer, 'λ = 2');
    });

    await test('A mistake comes back on its redo day: problem first, answer again, then old answer, rating, back to the page', async p => {
      const id = await p.evaluate(async () => {
        const RV = await import('/review.js');
        await RV.reloadReview();
        const id = RV.addItem({ kind: 'mistake', src: 'LA/Lecture.pdf', page: 2, no: '4', question: 'Compute $\\det A$', myAnswer: 'OLD-ANSWER', mistake: 'swapped rows', redo: RV.today() + 3 });
        RV.setDue(id, RV.today()); // as if three days passed
        return id;
      });
      const inQueue = await p.evaluate(async id => (await import('/review.js')).todaysQueue().some(c => c.id === id), id);
      assert.ok(inQueue, 'due mistake not in the daily review');
      await p.evaluate(async id => { const RV = await import('/review.js'); RV.startSession(RV.itemCards().filter(c => c.id === id)); }, id);
      await p.locator('.review-try').fill('NEW-ATTEMPT');
      assert.ok(await p.locator('.review-a').isHidden(), 'old answer shown before trying');
      await p.locator('.review-show, [data-show], .review-reveal').first().click().catch(async () => { await p.keyboard.press('Escape'); });
      await p.locator('.review-a').filter({ hasText: 'OLD-ANSWER' }).waitFor();
      await p.locator('.review-rate[data-r="3"]').first().click();
      await p.evaluate(async () => (await import('/review.js')).flushReview());
      const it = (await review()).items[id];
      assert.equal(it.attempts?.[0]?.answer, 'NEW-ATTEMPT');
      assert.ok((await review()).cards[id].due > Math.floor((Date.now() - new Date().getTimezoneOffset() * 60000) / 86400000), 'rating should move the due date');
      // Back to the page.
      await p.evaluate(async id => { const RV = await import('/review.js'); RV.startSession(RV.itemCards().filter(c => c.id === id)); }, id);
      await p.locator('.review-goto').click();
      await p.waitForFunction(() => document.querySelector('.pdf-page')?.value === '2', null, { timeout: 15000 });
    });

    await test('B card from selected PDF text (exact file and page), and a clipped image card saved in the vault', async p => {
      await p.locator('#tree [data-path="LA/Lecture.pdf"]').click();
      const span = p.locator('.page[data-page-number="2"] .textLayer span').filter({ hasText: 'LEC-page-2' }).first();
      await span.waitFor({ timeout: 15000 });
      await span.evaluate(s => { const r = document.createRange(); r.selectNodeContents(s); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); s.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 150 })); });
      await p.locator('[data-sel="card"]').click();
      await p.locator('.study-card [data-f=q]').fill('Which page label?');
      assert.equal(await p.locator('.study-card [data-f=a]').inputValue(), 'LEC-page-2');
      await p.locator('.study-card [data-a=save]').click();
      // Clip: drag a box over page 1.
      await p.locator('[data-pdf="clip"]').click();
      await p.locator('#ctxmenu .ctx-item').first().click();
      const pg = await p.locator('.page[data-page-number="1"] canvas').boundingBox();
      await p.mouse.move(pg.x + 20, pg.y + 20); await p.mouse.down(); await p.mouse.move(pg.x + 200, pg.y + 120, { steps: 5 }); await p.mouse.up();
      await p.locator('.study-card img.study-clip').waitFor();
      await p.locator('.study-card [data-f=a]').fill('The first lecture page');
      await p.locator('.study-card [data-a=save]').click();
      await p.evaluate(async () => (await import('/review.js')).flushReview());
      const cards = Object.values((await review()).items).filter(i => i.kind === 'card');
      const text = cards.find(c => c.q === 'Which page label?');
      assert.deepEqual([text.src, text.page], ['LA/Lecture.pdf', 2]);
      const img = cards.find(c => c.img);
      assert.ok(img && img.page === 1 && img.src === 'LA/Lecture.pdf', JSON.stringify(cards));
      const st = await fs.stat(path.join(vault, img.img));
      assert.ok(st.size > 500, 'clipped PNG saved');
      // It reviews from the local file (no network).
      const shown = await p.evaluate(async () => { const RV = await import('/review.js'); const c = RV.itemCards().find(c => c.item.img); RV.startSession([c]); return c.q; });
      assert.match(shown, /\/vault\/\.obsidian\/graphite\/clips\//);
      await p.locator('.review-q img').waitFor();
      assert.ok(await p.locator('.review-q img').evaluate(i => i.complete && i.naturalWidth > 0), 'image did not load');
    });

    await test('C plan day: start, stop half way, continue after reload, carry over a missed day, progress written in the note', async p => {
      await p.locator('#tree [data-path="LA/复习计划 Review Plans/Plan.md"]').click();
      await p.evaluate(() => document.querySelector('[data-mode="preview"]')?.click());
      const btns = p.locator('#preview .study-plan-start');
      await btns.first().waitFor();
      assert.equal(await btns.count(), 3);
      // Day 1 (yesterday) was missed: carry it into today.
      const carry = p.locator('#preview .study-plan-carry');
      await carry.waitFor();
      assert.match(await carry.innerText(), /2/);
      await carry.click();
      await p.waitForFunction(() => /\[!progress\]/.test(document.querySelector('#editor').value));
      // Today now has Maps (1) + Det (2) = 3 cards. Answer one, then close.
      await p.locator('#preview .study-plan-start').nth(1).click();
      await p.locator('.review-modal').waitFor();
      await p.keyboard.press('Space');
      await p.locator('.review-rate[data-r="3"]').first().click();
      await p.locator('.review-x').click();
      await p.waitForFunction(() => /\[!progress\] Progress 1\/3/.test(document.querySelector('#editor').value));
      await p.evaluate(() => window.__moFlush());
      // Reload: progress is still there, and the button continues.
      await p.reload({ waitUntil: 'domcontentloaded' });
      await p.locator('#tree [data-path="LA/复习计划 Review Plans/Plan.md"]').click();
      await p.evaluate(() => document.querySelector('[data-mode="preview"]')?.click());
      const today = p.locator('#preview .study-plan-start').nth(1);
      await today.waitFor();
      assert.match(await today.innerText(), /1\/3/);
      const md = await fs.readFile(path.join(vault, 'LA/复习计划 Review Plans/Plan.md'), 'utf8');
      assert.match(md, /## Day 1[^\n]*\n> \[!progress\][^\n]*moved to/);
      assert.match(md, /## Day 2[^\n]*\n> \[!progress\] Progress 1\/3/);
      await today.click();
      assert.match(await p.locator('.review-progress').innerText(), /1\s*\/\s*2|2/);
    });

    await test('Mock paper: past papers as the model, chapter range respected, every problem sourced and linked, folded answers', async p => {
      await p.locator('[data-cmd="review"]').first().click();
      await p.locator('[data-cmd-run="mock-paper"]').click();
      await p.locator('.ai-mock [data-f=course]').selectOption('LA');
      await p.locator('.ai-mock [data-paper]').first().waitFor();
      assert.ok(await p.locator('.ai-mock [data-paper="LA/复习资料/2024 期中.pdf"]').isChecked());
      await p.locator('.ai-mock [data-chapter="Ch2"]').uncheck();
      aiCalls.length = 0;
      await p.locator('.ai-mock [data-a=go]').click();
      await p.waitForFunction(() => document.querySelector('#title')?.value === 'LA mock', null, { timeout: 30000 });
      const sent = aiCalls.find(c => c.task === 'mock').content;
      assert.ok(sent.includes('<past_paper file="LA/复习资料/2024 期中.pdf">'), 'past paper not sent');
      assert.ok(sent.includes('--- page 2 ---\nMID-page-2'), 'past paper pages not sent');
      assert.ok(sent.includes('Det (LA/Ch1)'), 'chapter note missing');
      assert.doesNotMatch(sent, /Maps|Kernel/, 'unticked chapter sent');
      const md = await p.locator('#editor').inputValue();
      assert.ok(md.includes('[[2024 期中.pdf#page=2|2024 midterm Q2 p.2]]'), 'past problem source link');
      assert.ok(md.includes('[[Det|Det]]'), 'new problem note link');
      assert.ok(md.includes('> [!success]- Answer 2\n> Step 1\n> Step 2'), 'folded answer');
      assert.ok(md.includes('Total: 100 marks'), 'total marks');
      assert.ok(md.includes('```graphite-problems'), 'mistake-book block');
      await p.evaluate(() => document.querySelector('[data-mode="preview"]')?.click());
      assert.equal(await p.locator('#preview a.internal-link.unresolved').count(), 0, 'a source link does not resolve');
      await p.locator('#preview a.internal-link').filter({ hasText: '2024 midterm Q2 p.2' }).click();
      await p.waitForFunction(() => document.querySelector('.pdf-page')?.value === '2', null, { timeout: 15000 });
    });

    await test('rename a source PDF: mistakes and cards follow it', async p => {
      await p.evaluate(async () => {
        const RV = await import('/review.js'); await RV.reloadReview();
        RV.addItem({ kind: 'card', src: 'LA/Lecture.pdf', page: 3, q: 'q', a: 'a' });
      });
      await p.evaluate(async () => window.app && null);
      await p.locator('#tree [data-path="LA/Lecture.pdf"]').click({ button: 'right' });
      await p.locator('#ctxmenu .ctx-item').filter({ hasText: /^Rename/ }).click();
      await p.locator('#modal-input').fill('Lecture 1');
      await p.locator('#modal-input').press('Enter');
      await p.locator('#tree [data-path="LA/Lecture 1.pdf"]').waitFor({ state: 'attached' });
      await sleep(400);
      await p.evaluate(async () => (await import('/review.js')).flushReview());
      const srcs = Object.values((await review()).items).map(i => i.src);
      assert.ok(!srcs.includes('LA/Lecture.pdf') && srcs.includes('LA/Lecture 1.pdf'), JSON.stringify(srcs));
    });

    await test('Review library: find, expand and edit older items by question and source', async p => {
      const ids = await p.evaluate(async () => {
        const rv = await import('/review.js');
        const result = [];
        for (let i = 1; i <= 12; i++) {
          const src = i === 12 ? 'LA/复习资料/2024 期中.pdf' : 'LA/Exam.pdf';
          result.push({ mistake: rv.addItem({ kind: 'mistake', src, page: 2, no: String(i), question: `Variant ${i}`, redo: rv.today() + i }), card: rv.addItem({ kind: 'card', src, page: 2, q: `Recall ${i}`, a: `Solution ${i}` }) });
        }
        await rv.flushReview(); return result;
      });
      await p.locator('#review-btn').click();
      for (const kind of ['mistake', 'card']) {
        const box = p.locator(`[data-study-list=${kind}]`), search = box.locator('input[type=search]');
        assert.equal(await box.locator('.study-item').count(), 8);
        await box.locator('.study-book-all').click();
        assert.ok(await box.locator('.study-item').count() >= 12);
        await box.locator('.study-book-all').click();
        assert.equal(await box.locator('.study-item').count(), 8);
        await search.fill('no-such-question-or-path');
        assert.equal(await box.locator('.study-item').count(), 0);
        await search.fill(kind === 'mistake' ? 'variant １２ 期中' : 'recall 12 期中');
        const entry = box.locator('.study-item');
        assert.equal(await entry.count(), 1);
        assert.equal(await entry.getAttribute('data-id'), ids[11][kind]);
        await entry.locator('[data-act=edit]').click();
        const field = p.locator('.study-modal [data-f='+(kind === 'mistake' ? 'question' : 'q')+']');
        await field.fill((await field.inputValue())+' edited');
        await p.locator('.study-modal [data-a=save]').click();
        await entry.filter({hasText:/edited/}).waitFor();
        assert.match(await entry.innerText(), /edited/);
        await search.fill('');
      }
      await p.evaluate(async () => (await import('/review.js')).flushReview());
      const saved = (await review()).items;
      assert.match(saved[ids[11].mistake].question, /edited$/);
      assert.match(saved[ids[11].card].q, /edited$/);
    });

    await test('Redo draft: read the paper, return to the queue, close, reopen, clear and submit', async p => {
      const id = await p.evaluate(async () => {
        const rv = await import('/review.js');
        const id = rv.addItem({ kind: 'mistake', src: 'LA/复习资料/2024 期中.pdf', page: 2, question: 'Draft specimen', myAnswer: 'old', redo: rv.today() });
        await rv.flushReview(); return id;
      });
      const before = await review();
      const draft = '由定义可知\nλ < 2 & λ ≠ 0';
      const openQuestion = async () => {
        await p.locator('#review-btn').click();
        const box = p.locator('[data-study-list=mistake]');
        await box.locator('input[type=search]').fill('Draft specimen');
        await box.locator(`[data-id="${id}"] [data-act=do]`).click();
      };
      await openQuestion();
      await p.locator('.review-try').fill(draft);
      const progress = await p.locator('.review-progress').innerText();
      await p.locator('.review-goto').click();
      await p.waitForFunction(() => document.querySelector('.pdf-page')?.value === '2');
      await p.locator('[data-review-return]').click();
      assert.equal(await p.locator('.review-progress').innerText(), progress);
      assert.equal(await p.locator('.review-try').inputValue(), draft);
      assert.ok(await p.locator('.review-a').isHidden());
      await p.locator('.review-x').click();
      // Open the Review panel while Graphite is still starting after a restart: the vault list (/api/all) and then
      // the review progress are held back on purpose until the panel is open. It says it is loading; once startup
      // (with restoring last time's tabs) is done, the panel is still in front, with its list and "resume draft".
      for (const [pattern, name] of [[/\/api\/all(\?|$)/, 'vault list'], [/\/api\/file\?path=[^&]*review\.json/, 'review progress']]) {
        let release, held = 0;
        const gate = new Promise(r => { release = r; });
        await p.route(pattern, async r => { if (r.request().method() === 'GET' && !held++) await gate; return r.continue(); });
        await p.reload({ waitUntil: 'domcontentloaded' });
        await p.locator('#review-btn').click();
        await p.locator('#review-view [role=status]').waitFor();
        assert.equal(await p.locator('[data-resume-draft]').count(), 0, name);
        release();
        await p.locator('#review-view [data-study-list=mistake]').waitFor();
        await p.locator('[data-resume-draft]').waitFor();
        assert.equal(await p.evaluate(() => document.querySelector('#main').dataset.view), 'review', name + ': Review stays in front');
        await p.unroute(pattern);
      }
      await p.locator('[data-resume-draft]').click();
      assert.equal(await p.locator('.review-try').inputValue(), draft);
      let disk = await review();
      assert.deepEqual(disk.cards[id], before.cards[id]);
      assert.deepEqual(disk.days, before.days);
      assert.deepEqual(disk.items[id].attempts, before.items[id].attempts);
      await p.locator('.review-draft-clear').click();
      await p.locator('.review-x').click();
      assert.equal(await p.locator('[data-resume-draft]').count(), 0);
      await openQuestion();
      assert.equal(await p.locator('.review-try').inputValue(), '');
      await p.locator('.review-try').fill('now submit');
      await p.locator('.review-show').click();
      await p.locator('.review-goto').click();
      await p.locator('[data-review-return]').click();
      assert.ok(await p.locator('.review-a').isVisible());
      await p.locator('.review-rate[data-r="3"]').click();
      await p.locator('.review-close').click();
      await p.evaluate(async () => (await import('/review.js')).flushReview());
      disk = await review();
      assert.deepEqual(disk.items[id].attempts.map(a => a.answer), ['now submit']);
      assert.equal(disk.cards[id].reps, before.cards[id].reps + 1);
      await openQuestion();
      assert.equal(await p.locator('.review-try').inputValue(), '');
    });

    const zh = async p => {
      await p.evaluate(async () => (await import('/settings.js')).openSettings('ai'));
      const btn = p.locator('.aip-btn').first();
      await btn.waitFor();
      await btn.click();
      await p.locator('.aip-pop .aip-head').first().waitFor();
      const heads = await p.locator('.aip-pop .aip-head').allInnerTexts();
      assert.ok(heads.some(h => /本机/.test(h)) && heads.some(h => /API/.test(h)), JSON.stringify(heads));
      assert.equal(await p.locator('.aip-pop .aip-opt.is-locked').first().locator('.aip-addkey').innerText(), '添加密钥');
      assert.ok(!(await p.locator('.aip-pop').innerText()).includes('· ?'), 'no "· ?" for models not set');
      await p.keyboard.press('Escape');
      // Bundled plugin text follows the language.
      await p.waitForFunction(() => !!document.querySelector('.cc-input'), null, { timeout: 15000 });
      assert.equal(await p.locator('.cc-input').getAttribute('placeholder'), '向 Graphie 询问你的笔记…');
    };
    zh.opts = { lang: 'zh-CN', plugins: true };
    await test('UI: grouped AI picker and translated plugins (中文)', zh);
  } finally { await browser.close(); }
  console.log(JSON.stringify({ vault, passed: results.filter(r => r.pass).length, total: results.length }, null, 1));
  return results.every(r => r.pass) ? 0 : 1;
}
main().then(c => process.exit(c), e => { console.error(e); process.exit(2); });
