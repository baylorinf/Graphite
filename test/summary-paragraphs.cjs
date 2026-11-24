// "Summarize this PDF" → paragraph citations: every paragraph is sent after its source ID ([P2S3] = page 2,
// paragraph 3), the AI answers with that ID in `source`, Graphite checks it against the batch and this PDF, and
// the note's link opens the PDF scrolled to that paragraph with it highlighted. Old #page=N links still work.
// Synthetic PDFs only; runs in a real browser against a throwaway vault.
//   node test/summary-paragraphs.cjs [filter]
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const repo = path.resolve(process.env.GRAPHITE_REPO || path.join(__dirname, '..'));
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const {pdf} = require('./paragraph-pdf-fixture.cjs');
const para = (tag, n = 3) => ({ lines: Array.from({ length: n }, (_, k) => `${tag} line ${k + 1} of the paragraph about ${tag.toLowerCase()} and more words`) });
const P2 = [para('ALPHA'), para('BRAVO', 4), para('CHARLIE'), para('DELTA', 2)]; // CHARLIE is P2S3
const doc = [
  [{ lines: ['Chapter One Overview'], size: 20 }, para('INTRO'), para('SCOPE')],
  P2,
  [], // scanned
  [para('ECHO'), para('FOXTROT')],
  // page 5: one long block (60 lines, no gaps) → split every 40 lines
  [{ lines: Array.from({ length: 60 }, (_, k) => `GOLF block line ${k + 1}`), size: 8 }],
];
const revised = {
  moved: [doc[0], [para('NEWLY INSERTED'), ...P2], [], doc[3], doc[4]], // CHARLIE is now P2S4
  changed: [doc[0], [P2[0], P2[1], para('CHARLIE REWRITTEN'), P2[3]], [], doc[3], doc[4]],
  // The old number is void (S3 is now ALPHA) and two paragraphs have CHARLIE's words (S4, S6): no guessing.
  twins: [doc[0], [para('NEWLY INSERTED'), para('ANOTHER NEW ONE'), P2[0], P2[2], P2[1], P2[2], P2[3]], [], doc[3], doc[4]],
};
const otherDoc = [[para('OTHER ONE')], [para('OTHER TWO A'), para('OTHER TWO B'), para('OTHER TWO C')]];

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-paras-'));
  const files = {
    'Welcome.md': 'Welcome',
    'Course/Para.pdf': pdf(doc), 'Other/Para.pdf': pdf(otherDoc),
    'Course/Desk.pdf': pdf([[para('PAGE ONE')], { h: 1040, paras: [{ ...para('TOP'), y: 980 }, { ...para('MIDDLE'), y: 566 }, { ...para('BOTTOM'), y: 148 }] }]),
    'Course/Rev-moved.pdf': pdf(revised.moved), 'Course/Rev-changed.pdf': pdf(revised.changed), 'Course/Rev-twins.pdf': pdf(revised.twins),
  };
  for (const [n, b] of Object.entries(files)) { await fs.mkdir(path.dirname(path.join(vault, n)), { recursive: true }); await fs.writeFile(path.join(vault, n), b); }
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
  await ctx.addInitScript(() => {
    localStorage.setItem('mo:lang', JSON.stringify('en'));
    localStorage.setItem('mo:ai', JSON.stringify({ keys: { deepseek: 'test-only' }, models: { deepseek: 'deepseek-flash' }, use: { summary: 'deepseek' } }));
  });
  // The stand-in AI: one point per paragraph ID it was sent (source = that ID), plus sources it must not get
  // away with: an ID never sent, the same ID "in" another PDF, a malformed one, and prose markers.
  const calls = [];
  const answer = body => {
    const content = String(body.content || '');
    const ids = [...new Set([...content.matchAll(/\[(P\d+S\d+)\]/g)].map(m => m[1]))];
    const pageOf = id => +/^P(\d+)/.exec(id)[1];
    return {
      title: 'Para summary', overview: 'Overview cites [P2S3] and a stranger [P9S9].',
      sections: [{ heading: 'All', page: 1, source: 'P1S1', points: [
        ...ids.map(id => ({ text: 'Point from ' + id, page: pageOf(id), source: id })),
        { text: 'Never sent', page: 2, source: 'P9S9' },
        { text: 'Other book', page: 2, source: 'Other/Para.pdf#P2S1' },
        { text: 'Self named', page: 2, source: 'Course/Para.pdf#P2S2' },
        { text: 'Wrong page given', page: 4, source: '[P2S4]' },
        { text: 'Malformed', page: 2, source: 'paragraph three' },
        { text: 'Unsent page', page: 3, source: 'P3S1' },
        { text: 'Prose marker [P4S2] here', page: 0 },
      ] }],
      concepts: [{ term: 'Charlie', meaning: 'm', page: 2, source: 'P2S3' }],
      formulas: [{ latex: 'x=1', meaning: 'one', page: 4, source: 'P4S1' }],
    };
  };
  const handler = async r => { const body = JSON.parse(r.request().postData() || '{}'); calls.push(body); return r.fulfill({ json: answer(body) }); };
  await ctx.route(origin + '/api/ai', handler);
  await ctx.route(origin + '/api/local-ai', handler);

  const p = await ctx.newPage();
  p.setDefaultTimeout(60000);
  p.on('dialog', d => d.accept());
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  await p.goto(origin, { waitUntil: 'domcontentloaded' });
  await p.locator('#tree [data-path="Welcome.md"]').waitFor();
  await p.waitForFunction(() => typeof window.__moFlush === 'function');
  await sleep(300);
  const results = [];
  async function test(name, fn) {
    if (filter && !filter.test(name)) return;
    try { await fn(); results.push(true); console.log('PASS ' + name); }
    catch (e) { results.push(false); console.log('FAIL ' + name + '\n  ' + String(e.message).split('\n').slice(0, 10).join('\n  ')); }
  }
  const start = async (file, engine = 'deepseek') => {
    await p.evaluate(f => import('/summary.js').then(m => m.summaryDialog(f)), file);
    await p.locator('.ai-summary [data-f=engine]').waitFor({ state: 'attached' });
    await p.locator('.ai-summary [data-f=engine]').evaluate((s, v) => { const o = [...s.options].find(x => x.value === v); o.disabled = false; s.value = v; s.dispatchEvent(new Event('change')); }, engine);
    await p.locator('.ai-summary [data-a=go]').click();
  };
  const closeDialog = () => p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
  const url = f => '/vault/' + f.split('/').map(encodeURIComponent).join('/');
  const extract = f => p.evaluate(u => import('/pdfview.js').then(m => m.pdfText(u, { paras: true })), url(f));
  // The PDF shown in the file view: the result of the last jump, the highlight (if any) and where it is.
  const viewer = () => p.evaluate(() => {
    const host = document.querySelector('#file-view .pdf-host');
    const hl = host?.querySelector('.pdf-source-hl');
    const sc = host?.querySelector('.pdf-scroll')?.getBoundingClientRect(), r = hl?.getBoundingClientRect();
    const page = hl?.closest('.page'), pr = page?.getBoundingClientRect();
    // The words drawn under the highlight (text layer spans whose middle lies inside it).
    const under = hl ? [...page.querySelectorAll('.textLayer span')].filter(s => { const b = s.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2; return b.width && x > r.left && x < r.right && y > r.top && y < r.bottom; }).map(s => s.textContent).join(' ') : '';
    return {
      result: host?.dataset.sourceResult || '', source: host?.dataset.source || '', count: host ? host.querySelectorAll('.pdf-source-hl').length : -1,
      hl: hl ? { id: hl.dataset.source, page: +hl.dataset.page, inView: r.top >= sc.top - 1 && r.bottom <= sc.bottom + 1 && r.height > 0, rel: [(r.left - pr.left) / pr.width, (r.top - pr.top) / pr.height, r.width / pr.width, r.height / pr.height] } : null,
      under, file: document.querySelector('#file-view .fv-name')?.textContent || '',
    };
  });
  // The PDF view of the previous jump stays in the page until the next one replaces it: forget its result first.
  const prime = () => p.evaluate(() => document.querySelectorAll('#file-view .pdf-host').forEach(h => { delete h.dataset.sourceResult; }));
  const waitResult = () => p.waitForFunction(() => { const r = document.querySelector('#file-view .pdf-host')?.dataset.sourceResult; return r && r !== 'pending'; });
  // A note with the given text, opened in reading view.
  const noteWith = async (name, md) => {
    await fs.writeFile(path.join(vault, name), md); await sleep(900);
    await p.locator(`#tree [data-path="${name}"]`).click();
    await p.evaluate(() => document.querySelector('[data-cmd="mode-preview"]')?.click());
    await p.locator('#preview a.internal-link').first().waitFor();
  };

  let fp = {}; // id → fingerprint in the original Para.pdf
  try {
    await test('paragraphs: IDs per page from text and geometry (heading, gaps, scanned page, a long block split every 40 lines)', async () => {
      const r = await extract('Course/Para.pdf');
      const ids = r.pages.map(pg => pg.paras.map(x => x.id));
      assert.deepEqual(ids, [['P1S1', 'P1S2', 'P1S3'], ['P2S1', 'P2S2', 'P2S3', 'P2S4'], [], ['P4S1', 'P4S2'], ['P5S1', 'P5S2']]);
      assert.equal(r.pages[0].paras[0].text, 'Chapter One Overview');
      assert.match(r.pages[1].paras[2].text, /^CHARLIE line 1[\s\S]*CHARLIE line 3/);
      assert.ok(!/BRAVO|DELTA/.test(r.pages[1].paras[2].text));
      assert.equal(r.pages[4].paras[0].text.split('\n').length, 40);
      assert.deepEqual(r.empty, [3]);
      for (const pg of r.pages) for (const x of pg.paras) fp[x.id] = x.fp;
      assert.equal(new Set(Object.values(fp)).size, Object.keys(fp).length, 'two paragraphs share a fingerprint');
      // The same split again (and the plain text is unchanged for other callers).
      const again = await extract('Course/Para.pdf');
      assert.deepEqual(again.pages.map(pg => pg.paras), r.pages.map(pg => pg.paras));
      const plain = await p.evaluate(u => import('/pdfview.js').then(m => m.pdfText(u)), url('Course/Para.pdf'));
      assert.deepEqual(plain.pages.map(x => x.text), r.pages.map(x => x.text));
      assert.ok(plain.pages.every(x => !('paras' in x)));
    });

    await test('planBatches with paragraphs: "[P2S3] words", sources per batch; a long page split repeats the ID and cites only its own paragraphs', async () => {
      const r = await p.evaluate(async u => {
        const [pv, sm] = await Promise.all([import('/pdfview.js'), import('/summary.js')]);
        const read = await pv.pdfText(u, { paras: true });
        return { one: sm.planBatches(read.pages), small: sm.planBatches(read.pages, { budget: 900 }) };
      }, url('Course/Para.pdf'));
      assert.equal(r.one.length, 1);
      assert.match(r.one[0].text, /--- page 2 ---\n\[P2S1\] ALPHA line 1[^\n]*\n[^\n]*\n[^\n]*\n\n\[P2S2\] BRAVO/);
      assert.deepEqual(Object.keys(r.one[0].sources).sort(), Object.keys(fp).sort());
      assert.deepEqual(r.one[0].sources, fp);
      // Small batches: every batch's sources are exactly the IDs that appear in its text, and nothing else.
      for (const b of r.small) {
        assert.ok(b.text.length <= 900, 'over budget: ' + b.text.length);
        const inText = [...new Set([...b.text.matchAll(/\[(P\d+S\d+)\]/g)].map(m => m[1]))].sort();
        assert.deepEqual(Object.keys(b.sources).sort(), inText, b.text.slice(0, 200));
      }
      const cont = r.small.filter(b => /\(part [2-9]\/\d+\) ---\n\[P5S\d\] \(…\) GOLF/.test(b.text));
      assert.ok(cont.length >= 1, 'a part inside a paragraph does not repeat its ID');
      const all = r.small.flatMap(b => Object.keys(b.sources));
      assert.deepEqual([...new Set(all)].sort(), Object.keys(fp).sort(), 'a paragraph was lost');
      const golf = r.small.map(b => b.text).join('').match(/GOLF block line \d+/g);
      assert.deepEqual(golf, Array.from({ length: 60 }, (_, k) => `GOLF block line ${k + 1}`), 'block text lost or reordered');
    });

    await test('checkCitations: a source is kept only if this batch sent it and it names this PDF; otherwise the checked page', async () => {
      const r = await p.evaluate(() => import('/summary.js').then(m => {
        const sources = { P2S1: 'a1', P2S2: 'b2', P2S3: 'c3' };
        const self = m.selfMatcher('Course/Para.pdf', 'Para.pdf');
        const link = (n, id = '') => m.noteLink('Para.pdf', n, id, sources[id] || '');
        const out = m.checkCitations({ overview: 'see [P2S3] and [P7S1] and [[Para.pdf#page=2&source=P2S2&fp=zz|x]] and [[Para.pdf#page=2&source=P5S5|y]]', sections: [{ heading: 'h', page: 2, source: 'P2S1', points: [
          { text: 'ok', page: 2, source: 'P2S2' }, { text: 'other batch', page: 2, source: 'P2S4' }, { text: 'other pdf', page: 2, source: 'Other.pdf#P2S1' },
          { text: 'self pdf', page: 2, source: 'Course/Para.pdf#page=2&source=P2S3' }, { text: 'page wrong', page: 9, source: 'P2S3' },
          { text: 'garbage', page: 2, source: 'third' }, { text: 'none', page: 7 },
          // Desktop report: page 2 with source P3S1 in the same batch (both valid alone, contradictory together).
          { text: 'contradiction', page: 2, source: 'P3S1' }, { text: 'no page given', source: 'P2S1' }] }] }, new Set([2, 3]), link, self, { ...sources, P3S1: 'd4' });
        return out;
      }));
      const pts = r.sections[0].points.map(x => [x.text, x.page, x.source || '', x.fp || '']);
      assert.deepEqual(r.sections[0].source, 'P2S1');
      // "page wrong": page 9 with P2S3 contradict each other → the ID is dropped and page 9 (not sent) checked → 0.
      assert.deepEqual(pts, [['ok', 2, 'P2S2', 'b2'], ['other batch', 2, '', ''], ['other pdf', 2, '', ''], ['self pdf', 2, 'P2S3', 'c3'], ['page wrong', 0, '', ''], ['garbage', 2, '', ''], ['none', 0, '', ''], ['contradiction', 2, '', ''], ['no page given', 2, 'P2S1', 'a1']]);
      assert.equal(r.overview, 'see ([[Para.pdf#page=2&source=P2S3&fp=c3|p. 2 ¶3]]) and and x ([[Para.pdf#page=2&source=P2S2&fp=b2|p. 2 ¶2]]) and y ([[Para.pdf#page=2|p. 2]])');
    });

    let saved = '';
    await test('API summary: numbered text sent; preview links go to the paragraph (scrolled into view, highlighted); bad sources fall back to the page', async () => {
      calls.length = 0;
      await start('Course/Para.pdf');
      await p.locator('.ai-summary .sum-preview li').first().waitFor({ timeout: 120000 });
      assert.equal(calls.length, 1);
      assert.match(calls[0].content, /\[P2S3\] CHARLIE line 1/);
      assert.match(calls[0].content, /<pages_without_text>3<\/pages_without_text>/);
      const heads = await p.$$eval('.ai-summary .sum-preview a.internal-link', as => as.map(a => [a.textContent, a.dataset.heading]));
      const h = Object.fromEntries(heads.map(([t, x]) => [x, t]));
      assert.equal(h[`page=2&source=P2S3&fp=${fp.P2S3}`], 'p. 2 ¶3');
      assert.equal(h[`page=5&source=P5S2&fp=${fp.P5S2}`], 'p. 5 ¶2');
      assert.ok(!heads.some(([, x]) => /P9S9|P3S1/.test(x)), JSON.stringify(heads));
      // Every paragraph link carries the fingerprint of that paragraph in this PDF.
      for (const [, x] of heads) { const m = /source=(P\d+S\d+)&fp=(\w+)/.exec(x); if (m) assert.equal(m[2], fp[m[1]], x); }
      // "Wrong page given" (page 4, source P2S4) contradicts itself: page 4 only.
      assert.ok(heads.some(([t, x]) => t === 'p. 4' && x === 'page=4'));
      const html = await p.evaluate(() => document.querySelector('.ai-summary .sum-preview').innerHTML);
      assert.ok(!/P9S9/.test(html), 'an unsent ID shows');
      // Click in the preview.
      await prime(); await p.locator(`.ai-summary .sum-preview a[data-heading="page=2&source=P2S3&fp=${fp.P2S3}"]`).first().click();
      await waitResult();
      let v = await viewer();
      assert.equal(v.result, 'found'); assert.equal(v.count, 1);
      assert.equal(v.hl.id, 'P2S3'); assert.equal(v.hl.page, 2); assert.ok(v.hl.inView, 'highlight not in view');
      await p.waitForFunction(() => document.querySelector('#file-view .page[data-page-number="2"] .textLayer span'));
      v = await viewer();
      assert.match(v.under, /CHARLIE line 1/); assert.ok(!/BRAVO|DELTA/.test(v.under), 'highlight covers other paragraphs: ' + v.under);
      // Back to the preview; Save.
      await p.locator('.sum-return').click();
      await p.locator('.ai-summary [data-a=save]').click();
      await p.waitForFunction(() => !document.querySelector('.ai-summary'));
      saved = await fs.readFile(path.join(vault, 'Course', 'Para summary.md'), 'utf8');
      // Another Para.pdf exists (Other/), so links name this one by its full path.
      assert.match(saved, new RegExp(`- Point from P2S3 \\(\\[\\[Course/Para\\.pdf#page=2&source=P2S3&fp=${fp.P2S3}\\|p\\. 2 ¶3\\]\\]\\)`));
      assert.match(saved, /- Never sent \(\[\[Course\/Para\.pdf#page=2\|p\. 2\]\]\)/);
      assert.match(saved, /- Other book \(\[\[Course\/Para\.pdf#page=2\|p\. 2\]\]\)/);
      assert.match(saved, /- Unsent page\n/); // page 3 was not sent to an API model
      assert.match(saved, /- Prose marker \(\[\[Course\/Para\.pdf#page=4&source=P4S2&fp=\w+\|p\. 4 ¶2\]\]\) here/);
      assert.match(saved, /- Wrong page given \(\[\[Course\/Para\.pdf#page=4\|p\. 4\]\]\)/);
    });

    await test('saved note reopened after a restart: a paragraph link scrolls to it and highlights it; zoom keeps the highlight on the same words', async () => {
      await p.reload({ waitUntil: 'domcontentloaded' }); // a fresh app: nothing cached from the summary run
      await p.waitForFunction(() => typeof window.__moFlush === 'function'); await sleep(300);
      await p.locator('#tree [data-path="Course/Para summary.md"]').click();
      await p.evaluate(() => document.querySelector('[data-cmd="mode-preview"]')?.click());
      await prime(); await p.locator(`#preview a[data-heading="page=4&source=P4S2&fp=${fp.P4S2}"]`).first().click();
      await waitResult();
      let v = await viewer();
      assert.equal(v.file, 'Para.pdf'); assert.equal(v.result, 'found'); assert.equal(v.hl.id, 'P4S2'); assert.ok(v.hl.inView);
      const before = v.hl.rel;
      await p.locator('#file-view [data-pdf="in"]').click(); await p.locator('#file-view [data-pdf="in"]').click();
      await sleep(800);
      await p.waitForFunction(() => document.querySelector('#file-view .page[data-page-number="4"] .pdf-source-hl'));
      v = await viewer();
      assert.equal(v.count, 1); assert.equal(v.hl.id, 'P4S2');
      v.hl.rel.forEach((x, i) => assert.ok(Math.abs(x - before[i]) < 0.01, `moved on zoom: ${before} → ${v.hl.rel}`));
      await p.waitForFunction(() => document.querySelector('#file-view .page[data-page-number="4"] .textLayer span'));
      assert.match((await viewer()).under, /FOXTROT/);
    });

    await test('old #page=N links, a scanned page, and a same-named PDF elsewhere', async () => {
      await noteWith('Links.md', [
        'old [[Course/Para.pdf#page=4|p. 4]]',
        `scanned [[Course/Para.pdf#page=3&source=P3S1&fp=abc|p. 3 ¶1]]`,
        `other [[Other/Para.pdf#page=2&source=P2S3&fp=${fp.P2S3}|other p. 2 ¶3]]`,
        `mine [[Course/Para.pdf#page=2&source=P2S3&fp=${fp.P2S3}|mine p. 2 ¶3]]`,
      ].join('\n\n'));
      const click = async label => { await prime(); await p.locator('#preview a.internal-link', { hasText: label }).first().click(); };
      await click('p. 4'); await p.waitForFunction(() => document.querySelector('#file-view .pdf-page')?.value === '4');
      let v = await viewer();
      assert.equal(v.count, 0); assert.notEqual(v.result, 'found');
      await p.locator('#tree [data-path="Links.md"]').click(); await p.evaluate(() => document.querySelector('[data-cmd="mode-preview"]')?.click());
      await click('p. 3 ¶1'); await waitResult();
      v = await viewer(); assert.equal(v.result, 'page'); assert.equal(v.count, 0);
      assert.equal(await p.evaluate(() => document.querySelector('#file-view .pdf-page').value), '3');
      await p.locator('#tree [data-path="Links.md"]').click(); await p.evaluate(() => document.querySelector('[data-cmd="mode-preview"]')?.click());
      await click('other p. 2'); await waitResult();
      v = await viewer(); assert.equal(v.result, 'page', 'highlighted a paragraph in the other Para.pdf'); assert.equal(v.count, 0);
      await p.locator('#tree [data-path="Links.md"]').click(); await p.evaluate(() => document.querySelector('[data-cmd="mode-preview"]')?.click());
      await click('mine p. 2'); await waitResult();
      v = await viewer(); assert.equal(v.result, 'found'); assert.equal(v.hl.id, 'P2S3');
    });

    await test('PDF changed: paragraph moved → found by its words; rewritten → page only; two identical paragraphs → page only', async () => {
      const link = f => `[[Course/${f}#page=2&source=P2S3&fp=${fp.P2S3}|${f}]]`;
      await noteWith('Revised.md', ['Rev-moved.pdf', 'Rev-changed.pdf', 'Rev-twins.pdf'].map(link).join('\n\n'));
      const go = async f => {
        await p.locator('#tree [data-path="Revised.md"]').click(); await p.evaluate(() => document.querySelector('[data-cmd="mode-preview"]')?.click());
        await prime(); await p.locator('#preview a.internal-link', { hasText: f }).first().click(); await waitResult(); return viewer();
      };
      let v = await go('Rev-moved.pdf');
      assert.equal(v.result, 'moved'); assert.equal(v.hl.id, 'P2S4'); assert.match(v.under || 'CHARLIE', /CHARLIE/); assert.ok(v.hl.inView);
      v = await go('Rev-changed.pdf');
      assert.equal(v.result, 'page'); assert.equal(v.count, 0);
      v = await go('Rev-twins.pdf');
      assert.equal(v.result, 'page'); assert.equal(v.count, 0, 'picked one of two identical paragraphs');
      // The same file changed on disk: reopened, the old link no longer highlights paragraph 3 (now ALPHA… no: rewritten CHARLIE).
      await fs.writeFile(path.join(vault, 'Course', 'Para.pdf'), pdf(revised.changed)); await sleep(1200);
      await noteWith('Same.md', `[[Course/Para.pdf#page=2&source=P2S3&fp=${fp.P2S3}|same file]]`);
      await prime(); await p.locator('#preview a.internal-link', { hasText: 'same file' }).click(); await waitResult();
      v = await viewer(); assert.equal(v.result, 'page', 'old link highlighted the rewritten paragraph'); assert.equal(v.count, 0);
      await fs.writeFile(path.join(vault, 'Course', 'Para.pdf'), pdf(doc)); await sleep(1200);
    });

    await test('desktop report: in the preview, p. 2 ¶3 near the bottom of a tall page is shown (window set aside), and Back returns to the same preview to Save', async () => {
      await p.setViewportSize({ width: 1280, height: 800 });
      calls.length = 0;
      await start('Course/Desk.pdf');
      await p.locator('.ai-summary .sum-preview li').first().waitFor({ timeout: 120000 });
      const before = await p.evaluate(() => document.querySelector('.ai-summary .sum-preview').innerHTML);
      const link = p.locator('.ai-summary .sum-preview a.internal-link[data-heading^="page=2&source=P2S3&"]').first();
      await prime(); await link.click();
      await p.waitForFunction(() => { const r = document.querySelector('#file-view .pdf-host')?.dataset.sourceResult; return r && r !== 'pending'; }, null, { timeout: 5000 });
      const v = await viewer();
      assert.equal(v.result, 'found'); assert.equal(v.hl.id, 'P2S3'); assert.ok(v.hl.inView, 'BOTTOM paragraph not scrolled into view');
      assert.ok(await p.evaluate(() => { const w = document.querySelector('.ai-summary'); return !!w && getComputedStyle(w).display === 'none'; }), 'the summary window still covers the PDF');
      // Really visible: the element at the highlight's centre is the PDF page, not a dialog.
      assert.ok(await p.evaluate(() => { const r = document.querySelector('#file-view .pdf-source-hl').getBoundingClientRect(); return !!document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.closest('#file-view .page[data-page-number="2"]'); }), 'something covers the highlighted paragraph');
      await p.waitForFunction(() => document.querySelector('#file-view .page[data-page-number="2"] .textLayer span'));
      assert.match((await viewer()).under, /BOTTOM/);
      // Esc while looking does not throw the result away; Back brings the same preview; Save without a new run.
      await p.keyboard.press('Escape');
      await p.locator('.sum-return').click();
      assert.equal(await p.evaluate(() => document.querySelector('.ai-summary .sum-preview').innerHTML), before);
      assert.equal(await p.locator('.sum-return').count(), 0);
      await p.locator('.ai-summary [data-a=save]').click();
      await p.waitForFunction(() => !document.querySelector('.ai-summary'));
      assert.equal(calls.length, 1, 'the AI was asked again');
      assert.match(await fs.readFile(path.join(vault, 'Course', 'Desk summary.md'), 'utf8'), /Point from P2S3 \(\[\[Desk\.pdf#page=2&source=P2S3&fp=\w+\|p\. 2 ¶3\]\]\)/);
      await p.setViewportSize({ width: 1400, height: 900 });
    });

    await test('the newest jump wins: a slow paragraph lookup that a newer jump overtook neither scrolls nor highlights', async () => {
      const r = await p.evaluate(async u => {
        const m = await import('/pdfview.js');
        const box = Object.assign(document.createElement('div'), { style: 'position:fixed;left:0;top:0;width:700px;height:500px;z-index:9999' });
        document.body.append(box);
        const ready = new Promise(res => { window.__ready = res; });
        const ctl = await m.mountPdf(box, u, { onReady: () => window.__ready() });
        await ready;
        const out = {};
        // 1. Paragraph on page 4 (not looked up yet: async), then at once a paragraph on page 2: only page 2's.
        const a = ctl.goToSource({ page: 4, source: 'P4S2', fp: '' }), b = ctl.goToSource({ page: 2, source: 'P2S2', fp: '' });
        out.ab = [await a, await b, [...box.querySelectorAll('.pdf-source-hl')].map(e => e.dataset.source), ctl.page];
        // 2. Paragraph on page 5, then at once a plain page jump (an old #page link): no highlight at all, page 1.
        const c = ctl.goToSource({ page: 5, source: 'P5S1', fp: '' }); ctl.clearSource(); ctl.goTo(1);
        const scroll = box.querySelector('.pdf-scroll').scrollTop;
        out.c = [await c, box.querySelectorAll('.pdf-source-hl').length, ctl.page, box.querySelector('.pdf-scroll').scrollTop === scroll, box.dataset.sourceResult];
        // 3. Paragraph, then the page box / Home key (goTo) before it resolves: no scroll back, no highlight.
        const d = ctl.goToSource({ page: 4, source: 'P4S1', fp: '' }); ctl.goTo(3);
        out.d = [await d, box.querySelectorAll('.pdf-source-hl').length, ctl.page];
        ctl.destroy(); box.remove();
        return out;
      }, url('Course/Para.pdf'));
      assert.deepEqual(r.ab, ['stale', 'found', ['P2S2'], 2]);
      assert.deepEqual(r.c, ['stale', 0, 1, true, 'none']);
      assert.deepEqual(r.d, ['stale', 0, 3]);
    });

    await test('Claude Code gets the numbered text of its batch in job.sourceText', async () => {
      const chat = path.join(vault, '.obsidian/plugins/claude-chat/chat');
      await fs.mkdir(path.join(chat, 'tasks'), { recursive: true }); await fs.mkdir(path.join(chat, 'replies'), { recursive: true });
      const beat = setInterval(() => fss.writeFileSync(path.join(chat, 'status.json'), JSON.stringify({ listening: true, at: Date.now() })), 1000);
      fss.writeFileSync(path.join(chat, 'status.json'), JSON.stringify({ listening: true, at: Date.now() }));
      try {
        await start('Course/Para.pdf', 'claude-code');
        let task = null;
        for (let i = 0; i < 60 && !task; i++) { await sleep(250); const f = (await fs.readdir(path.join(chat, 'tasks'))).find(x => x.endsWith('.json')); if (f) task = { f, j: JSON.parse(await fs.readFile(path.join(chat, 'tasks', f), 'utf8')) }; }
        assert.ok(task, 'no task file');
        assert.equal(task.j.task, 'ai-summary');
        assert.match(task.j.sourceText, /--- page 2 ---\n\[P2S1\] ALPHA/);
        assert.match(task.j.sourceText, /\[P5S2\] GOLF block line 41/);
        await fs.writeFile(path.join(chat, 'replies', task.f), JSON.stringify(answer({ content: task.j.sourceText })));
        await p.locator('.ai-summary .sum-preview li').first().waitFor({ timeout: 20000 });
        const html = await p.evaluate(() => document.querySelector('.ai-summary .sum-preview').innerHTML);
        assert.ok(html.includes(`data-heading="page=2&amp;source=P2S3&amp;fp=${fp.P2S3}"`), 'no paragraph link from Claude Code');
        // An agent may cite a scanned page of its range, but only by page.
        assert.ok(/data-heading="page=3"/.test(html) && !/source=P3S1/.test(html));
        await closeDialog();
      } finally { clearInterval(beat); }
    });

    await test('no page errors', async () => { assert.deepEqual(errors, []); });
  } finally {
    console.log(JSON.stringify({ vault, passed: results.filter(Boolean).length, total: results.length }));
    await browser.close();
    if (!process.env.KEEP) await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
    process.exit(results.every(Boolean) ? 0 : 1);
  }
}
main().catch(e => { console.error(e); process.exit(1); });
