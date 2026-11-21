// Long PDFs in "Summarize this PDF": nothing is cut off, every page (the last one too) reaches the AI in batches,
// a page bigger than one batch is split into parts, and the note only links pages its batch really sent.
// Synthetic data only; runs in a real browser against a throwaway vault.
//   node test/summary-long-pdf.cjs [filter]
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

// A PDF: lines[n] is the text lines of page n+1 ([] = a blank, scanned-like page).
function pdf(pagesLines) {
  const objects = [];
  const add = s => { objects.push(s); return objects.length; };
  const n = pagesLines.length;
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Count ' + n + ' /Kids [' + Array.from({ length: n }, (_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pagesLines.forEach((lines, i) => {
    // Every line must lie on the page (PDF.js reads only what is on it), so long pages get tiny type.
    const lead = Math.min(5, 780 / Math.max(1, lines.length)), size = Math.min(4, lead);
    const data = lines.length ? `BT /F1 ${size.toFixed(3)} Tf 10 790 Td ${lead.toFixed(3)} TL ` + lines.map(l => '(' + l + ') Tj T*').join(' ') + ' ET\n' : 'q Q\n';
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (3 + (i + 1) * 2) + ' 0 R >>');
    add('<< /Length ' + data.length + ' >>\nstream\n' + data + 'endstream');
  });
  let out = '%PDF-1.4\n';
  const offsets = objects.map((s, i) => { const j = out.length; out += (i + 1) + ' 0 obj\n' + s + '\nendobj\n'; return j; });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(j => String(j).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(out + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n', 'ascii');
}
const line = (p, k) => `P${p}L${k} ` + 'lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor '.repeat(1).trim();
const TOTAL = 140, BLANK = [50, 51], HUGE = 70;
const lecture = Array.from({ length: TOTAL }, (_, i) => {
  const p = i + 1;
  if (BLANK.includes(p)) return [];
  const k = p === HUGE ? 2600 : 28; // page 70 alone is well over one batch
  const lines = Array.from({ length: k }, (_, j) => line(p, j));
  if (p === TOTAL) lines.push('LASTPAGEMARKER end of the lecture');
  return lines;
});

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-longpdf-'));
  const files = { 'Welcome.md': 'Welcome', 'Course/Long lecture.pdf': pdf(lecture), 'Course/Short.pdf': pdf([['S1 one'], [], ['S3 three']]) };
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
  // The stand-in AI: one point per page it was sent, plus citations it must not get away with (a page of
  // another batch, the last page when it wasn't sent, and a page that doesn't exist).
  const calls = [];
  let failOn = null, delay = 0;
  const answer = body => {
    const content = String(body.content || '');
    const sent = [...new Set([...content.matchAll(/--- page (\d+)( \(part \d+\/\d+\))? ---/g)].map(m => +m[1]))];
    const open = (content.match(/<pages_without_text>([^<—]*)/) || [])[1] || '';
    const bogus = [sent.includes(TOTAL) ? 1 : TOTAL, 999];
    // Links written into the prose itself, to pages this batch never sent (Codex retest, 2026-11-22).
    const foreign = sent.includes(TOTAL) ? 1 : TOTAL;
    // …and reference-style links (Codex retest 2): "见 [来源][ref]" with "[ref]: Long lecture.pdf#page=140" on its
    // own line, plus one valid inline link to a page this batch did send.
    const prose = `See [[Long lecture.pdf#page=${foreign}|p. ${foreign}]] and [there](Long%20lecture.pdf#page=999) and <a href="#page=998">here</a>. 见 [来源][ref]，[本页](Long%20lecture.pdf#page=${sent[0]})，[附录][a]，[同页](#page=${sent[0]})。\n\n[ref]: Long lecture.pdf#page=${foreign}\n[a]: Other.pdf#page=${sent[0]}\n`;
    return { title: 'Long lecture summary', overview: 'Part with pages ' + sent.join(',') + '. ' + prose, sections: [{ heading: 'Pages ' + sent[0], page: sent[0] || 0, points: [...sent.map(p => ({ text: 'Sent page ' + p, page: p })), ...bogus.map(p => ({ text: 'Bogus ' + p + ' ' + prose, page: p })), ...(open ? [{ text: 'Open page', page: BLANK[0] }] : [])] }], concepts: [{ term: 'Shared term', meaning: 'm ' + prose, page: sent[0] }],
      formulas: [{ latex: 'f(x)=x', meaning: 'lower f', page: sent[0] }, { latex: 'F(x)=x', meaning: 'upper F', page: sent[0] }, { latex: 'f(x) = x', meaning: 'same as lower f', page: sent[0] }] };
  };
  const handler = async (r, kind) => {
    const body = JSON.parse(r.request().postData() || '{}');
    calls.push({ kind, body });
    if (delay) await sleep(delay);
    if (failOn && failOn(calls.length)) return r.fulfill({ status: 502, json: { error: 'Provider is busy (test)' } });
    return r.fulfill({ json: answer(body) });
  };
  await ctx.route(origin + '/api/ai', r => handler(r, 'api'));
  await ctx.route(origin + '/api/local-ai', r => handler(r, 'local'));

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
    catch (e) { results.push(false); console.log('FAIL ' + name + '\n  ' + String(e.message).split('\n').slice(0, 8).join('\n  ')); }
    finally { failOn = null; delay = 0; } // the window stays open: the next test may look at the same preview
  }
  const start = async (file, engine = 'deepseek', pages = '') => {
    await p.evaluate(f => import('/summary.js').then(m => m.summaryDialog(f)), file);
    await p.locator('.ai-summary [data-f=engine]').waitFor({ state: 'attached' });
    await p.locator('.ai-summary [data-f=engine]').evaluate((s, v) => { const o = [...s.options].find(x => x.value === v); o.disabled = false; s.value = v; s.dispatchEvent(new Event('change')); }, engine);
    if (pages) await p.locator('.ai-summary [data-f=pages]').fill(pages);
    await p.locator('.ai-summary [data-a=go]').click();
  };
  if (process.env.DBG) console.log('DBG extract', JSON.stringify(await p.evaluate(async () => { const m = await import('/pdfview.js'); const r = await m.pdfText('/vault/Course/' + encodeURIComponent('Long lecture.pdf'), { only: [69, 70, 140] }); return r.pages.map(x => [x.n, x.text.length, x.text.slice(-60)]); })));
  const textPages = Array.from({ length: TOTAL }, (_, i) => i + 1).filter(n => !BLANK.includes(n));
  const BATCH = await p.evaluate(() => import('/summary.js').then(m => m.BATCH_CHARS));

  try {
    await test('planBatches: in order, nothing lost, a huge page split, leading blank pages kept, budget respected', async () => {
      const r = await p.evaluate(() => import('/summary.js').then(m => {
        const pages = [{ n: 1, text: '' }, { n: 2, text: 'x'.repeat(50) }, { n: 3, text: 'y'.repeat(250) }, { n: 4, text: '' }, { n: 5, text: 'z'.repeat(40) }];
        return { api: m.planBatches(pages, { budget: 120 }), agent: m.planBatches([{ n: 1, text: '' }, { n: 2, text: '' }], { budget: 120, agent: true }), none: m.planBatches([{ n: 1, text: '' }], { budget: 120 }) };
      }));
      for (const b of r.api) assert.ok(b.text.length <= 120, 'batch over budget: ' + b.text.length);
      const all = r.api.map(b => b.text).join('');
      for (const [ch, len] of [['x', 50], ['y', 250], ['z', 40]]) assert.equal((all.match(new RegExp(ch, 'g')) || []).length, len, ch + ' lost');
      assert.ok(r.api.some(b => /page 3 \(part 1\/\d\)/.test(b.text)) && r.api.some(b => /page 3 \(part \d\/\d\)/.test(b.text) && !/part 1\//.test(b.text)), 'page 3 not split');
      assert.deepEqual(r.api[0].open, [1]); assert.ok(r.api.some(b => b.open.includes(4)));
      assert.deepEqual(r.agent, [{ pages: [], open: [1, 2], text: '' }]);
      assert.deepEqual(r.none, []);
    });

    await test('reference-style and other links in the AI\'s prose: only pages the batch sent become (Graphite) links', async () => {
      const r = await p.evaluate(() => import('/summary.js').then(m => {
        const ok = new Set(Array.from({ length: 24 }, (_, i) => i + 1));
        const link = n => `[[Long.pdf#page=${n}|p. ${n}]]`;
        const prose = '见 [来源][ref]，也见 [第三页](Long.pdf#page=3)、[[Long.pdf#page=5|第五页]]、[[Long.pdf#page=140]]、<Long.pdf#page=140>、[ref2]。\n\n[ref]: Long.pdf#page=140\n[ref2]: <Long.pdf#page=7> "title"\n  [REF3]: https://example.com/x#page=2';
        const out = m.checkCitations({ title: 't', overview: prose, sections: [{ heading: 'h', page: 1, points: [{ text: prose, page: 1 }] }], concepts: [], formulas: [] }, ok, link, m.selfMatcher('Course/Long.pdf', 'Long.pdf'));
        return { overview: out.overview, point: out.sections[0].points[0].text };
      }));
      for (const s of [r.overview, r.point]) {
        assert.ok(!/page=140/.test(s.replace(/p\. 140/g, '')) || !/\[\[[^\]]*page=140/.test(s), 'page 140 still linked: ' + s);
        assert.ok(!/\[\[[^\]]*page=140/.test(s), 'page 140 became a link: ' + s);
        assert.ok(!/^\s*\[[^\]]+\]:/m.test(s), 'a link definition is left: ' + s);
        assert.ok(!/\]\(|<[^>]*#page=|\]\[/.test(s), 'a Markdown link is left: ' + s);
        assert.match(s, /见 来源/, 'the source words were lost: ' + s);
        for (const n of [3, 5, 7]) assert.ok(s.includes(`[[Long.pdf#page=${n}|p. ${n}]]`), `valid page ${n} lost its link: ` + s);
        assert.match(s, /p\. 140/, 'the readable page number was dropped: ' + s);
      }
    });

    await test('the same page number in another PDF, a bare #page, or a same-named file elsewhere never becomes a jump to this PDF', async () => {
      const r = await p.evaluate(() => import('/summary.js').then(m => {
        const ok = new Set(Array.from({ length: 24 }, (_, i) => i + 1));
        const jump = n => `[[Long.pdf#page=${n}|p. ${n}]]`;
        const self = m.selfMatcher('Course/Long.pdf', 'Long.pdf'); // the only Long.pdf in the vault
        const run = (text, isSelf = self, link = jump) => m.checkCitations({ title: '', overview: text, sections: [], concepts: [], formulas: [] }, ok, link, isSelf).overview;
        return {
          otherRef: run('[附录][a]\n\n[a]: Other.pdf#page=2'),
          otherInline: run('[附录](Other.pdf#page=2) [[Other.pdf#page=3]] <Other.pdf#page=4> [[Books/Other.pdf#page=5|另一本]] [x](Other%2Epdf#page%3D6)'),
          bare: run('[本页](#page=2)，[[#page=3]]，见 #page=4，[r][b]\n[b]: #page=5'),
          same: run('[同书](Long.pdf#page=2) [全路径](Course/Long.pdf#page=3) [[Course/Long#page=4|无扩展名]] [编码](Long%2Epdf#page%3D5) [ref][c]\n[c]: <Course/Long.pdf#page=6> "t"'),
          sameOutOfBatch: run('[同书](Long.pdf#page=140)'),
          elsewhere: run('[同名](Elsewhere/Long.pdf#page=2) [[Other/Long.pdf#page=3]]'),
          // Two Long.pdf in the vault: the link name is the full path, so a bare "Long.pdf" is not clearly this one.
          ambiguous: run('[只写文件名](Long.pdf#page=2) [全路径](Course/Long.pdf#page=3)', m.selfMatcher('Course/Long.pdf', 'Course/Long.pdf'), n => `[[Course/Long.pdf#page=${n}|p. ${n}]]`),
        };
      }));
      const noJump = s => !/\[\[/.test(s);
      assert.ok(noJump(r.otherRef) && /附录 \(Other\.pdf p\. 2\)/.test(r.otherRef) && !/\[a\]/.test(r.otherRef), 'another PDF became a jump: ' + r.otherRef);
      assert.ok(noJump(r.otherInline), 'another PDF became a jump: ' + r.otherInline);
      for (const x of ['附录 (Other.pdf p. 2)', 'Other.pdf p. 3', 'Other.pdf p. 4', '另一本 (Other.pdf p. 5)', 'x (Other.pdf p. 6)']) assert.ok(r.otherInline.includes(x), 'missing "' + x + '": ' + r.otherInline);
      assert.ok(noJump(r.bare), 'a bare #page became a jump: ' + r.bare);
      for (const x of ['本页 (p. 2)', 'p. 3', '见 p. 4', 'r (p. 5)']) assert.ok(r.bare.includes(x), 'missing "' + x + '": ' + r.bare);
      for (const n of [2, 3, 4, 5, 6]) assert.ok(r.same.includes(`[[Long.pdf#page=${n}|p. ${n}]]`), `this PDF, page ${n}: no jump: ` + r.same);
      assert.ok(noJump(r.sameOutOfBatch) && /同书 \(p\. 140\)/.test(r.sameOutOfBatch), 'a page outside the batch became a jump: ' + r.sameOutOfBatch);
      assert.ok(noJump(r.elsewhere) && /同名 \(Long\.pdf p\. 2\)/.test(r.elsewhere), 'a same-named file elsewhere became a jump: ' + r.elsewhere);
      assert.ok(!r.ambiguous.includes('page=2') && r.ambiguous.includes('[[Course/Long.pdf#page=3|p. 3]]'), 'ambiguous file name: ' + r.ambiguous);
    });

    await test('a page with no spaces longer than a batch: no UTF-16 surrogate is split; every character, in order, within the limit', async () => {
      const r = await p.evaluate(() => import('/summary.js').then(m => {
        const B = m.BATCH_CHARS;
        const text = '文'.repeat(B - 65) + '𝑥' + '字'.repeat(300);
        const plans = [m.planBatches([{ n: 1, text }]), m.planBatches([{ n: 1, text: '𝑥'.repeat(B) }]), m.planBatches([{ n: 1, text: 'a' + '😀'.repeat(B) + 'b' }])];
        const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
        const body = b => b.text.replace(/^--- page \d+(?: \(part \d+\/\d+\))? ---\n/, '').replace(/\n$/, '');
        const inputs = [text, '𝑥'.repeat(B), 'a' + '😀'.repeat(B) + 'b'];
        return plans.map((bs, i) => ({ n: bs.length, maxLen: Math.max(...bs.map(b => b.text.length)), budget: B, lone: bs.some(b => lone.test(b.text)), same: bs.map(body).join('') === inputs[i] }));
      }));
      for (const x of r) {
        assert.ok(x.n >= 2, 'not split');
        assert.equal(x.lone, false, 'a request would carry a lone surrogate');
        assert.equal(x.same, true, 'characters lost or reordered');
        assert.ok(x.maxLen <= x.budget, `batch over the limit: ${x.maxLen} > ${x.budget}`);
      }
    });

    await test('140-page lecture (> 300 000 characters): every text page incl. the last reaches the AI, in batches under the limit', async () => {
      calls.length = 0;
      await start('Course/Long lecture.pdf');
      await p.locator('.ai-summary .sum-preview li').first().waitFor({ timeout: 240000 });
      assert.ok(calls.length >= 4, 'only ' + calls.length + ' requests');
      const sentAll = calls.map(c => String(c.body.content));
      const total = sentAll.map(c => (c.match(/<pdf [^>]*>\n([\s\S]*)<\/pdf>/) || [])[1] || '').join('');
      assert.ok(total.length > 300000, 'test data too small: ' + total.length);
      for (const c of sentAll) assert.ok(((c.match(/<pdf [^>]*>\n([\s\S]*)<\/pdf>/) || [])[1] || '').length <= BATCH, 'a request is over the batch size');
      const sentPages = new Set(sentAll.flatMap(c => [...c.matchAll(/--- page (\d+)/g)].map(m => +m[1])));
      assert.deepEqual([...sentPages].sort((a, b) => a - b), textPages, 'pages missing from what was sent');
      assert.ok(total.includes('LASTPAGEMARKER'), 'the last page was cut off');
      // Page 70 went in parts, and every one of its lines arrived.
      if (process.env.DBG) { console.log('DBG p70', sentAll.map(c => (c.match(/--- page 70[^\n]*/g) || []).join('|')).filter(Boolean), 'lens', sentAll.map(c => c.length).join(',')); console.log('DBG html', (await p.evaluate(() => document.querySelector('.ai-summary .sum-preview li')?.outerHTML))); }
      assert.ok(sentAll.some(c => /--- page 70 \(part 1\/\d+\)/.test(c)));
      for (const k of [0, 1300, 2599]) assert.ok(total.includes(`P70L${k} `), 'page 70 line ' + k + ' lost');
      // No word is cut in two: every line marker of every page arrives whole, in exactly one request.
      for (const pg of textPages) {
        const lines = pg === HUGE ? 2600 : 28;
        for (let k = 0; k < lines; k++) {
          const m = `P${pg}L${k} lorem`;
          const n = sentAll.filter(c => c.includes(m)).length;
          if (n !== 1) assert.fail(`marker ${m} arrived in ${n} requests`);
        }
      }
      // Each request names only its own pages.
      for (const c of sentAll) {
        const own = [...new Set([...c.matchAll(/--- page (\d+)/g)].map(m => +m[1]))];
        const said = (c.match(/<pages_included>([^<]*) of 140<\/pages_included>/) || [])[1];
        assert.ok(said && !said.includes('1–140'), 'claims the whole PDF: ' + said);
        assert.ok(own.every(n => said.split(/,\s*/).some(r => { const [a, b] = r.split('–').map(Number); return n >= a && n <= (b || a); })), 'pages_included does not match what was sent');
      }
      const prog = await p.locator('.ai-summary .sum-preview').innerText();
      assert.ok(!/1–140/.test(prog), 'note claims pages 1–140 though 50–51 have no text');
      assert.match(prog, /Pages 50–51 have no text/);
    });

    await test('the note links only pages its batch sent: no other batch\'s page, no unsent last page, no page 999', async () => {
      const md = await p.evaluate(() => document.querySelector('.ai-summary .sum-preview').innerText);
      const html = await p.evaluate(() => document.querySelector('.ai-summary .sum-preview').innerHTML);
      const linked = [...html.matchAll(/data-heading="page=(\d+)"/g)].map(m => +m[1]);
      assert.ok(!linked.includes(999), 'page 999 linked');
      assert.ok(!linked.some(n => BLANK.includes(n)), 'a blank page was linked for an API model');
      assert.deepEqual([...new Set(linked)].sort((a, b) => a - b), textPages, 'linked pages differ from sent pages');
      // A "Bogus 140" line exists in batches that did not send page 140: it must not link page 140 (its prose
      // also holds one valid link to a page that batch did send, which is kept).
      const bogus = await p.evaluate(() => [...document.querySelectorAll('.ai-summary .sum-preview li')].filter(li => /^Bogus 140/.test(li.textContent)).map(li => [...li.querySelectorAll('a')].map(a => a.dataset.heading)));
      assert.ok(bogus.length >= 1 && bogus.every(hs => !hs.includes('page=140') && hs.length === 1), 'an unsent page 140 was linked: ' + JSON.stringify(bogus));
      void md;
      assert.equal(await p.locator('.ai-summary .sum-preview li', { hasText: 'Shared term' }).count(), 1, 'the same concept was repeated');
      // Links the AI wrote into its prose are plain text: none points to page 999, 998 or another batch's page.
      const all = await p.evaluate(() => [...document.querySelectorAll('.ai-summary .sum-preview a')].map(a => [a.textContent, a.getAttribute('href'), a.dataset.target || '', a.dataset.heading || '']));
      // Graphite's own source line ([[Long lecture.pdf]] at the top) is the one link without a page.
      assert.equal(all.filter(([txt, , target, heading]) => txt === 'Long lecture.pdf' && target === 'Long lecture.pdf' && !heading).length, 1);
      const hrefs = all.filter(([txt, , , heading]) => !(txt === 'Long lecture.pdf' && !heading));
      assert.ok(hrefs.every(([txt, href, target, heading]) => target === 'Long lecture.pdf' && /^page=\d+$/.test(heading) && /^p\. \d+$/.test(txt)), 'a link not added by Graphite: ' + JSON.stringify(hrefs.find(([txt, href, target, heading]) => !(target === 'Long lecture.pdf' && /^page=\d+$/.test(heading) && /^p\. \d+$/.test(txt)))));
      const shown = await p.locator('.ai-summary .sum-preview').innerText();
      assert.match(shown, /See p\. \d+ and there \(p\. 999\) and here \(p\. 998\)/);
      assert.match(shown, /见 来源 \(p\. \d+\)，本页 \(p\. \d+\)，附录 \(Other\.pdf p\. \d+\)，同页 \(p\. \d+\)/, 'source words or the valid page link lost');
      // The same page number in Other.pdf and a bare #page: readable, never a jump into this PDF.
      const extra = await p.evaluate(() => [...document.querySelectorAll('.ai-summary .sum-preview p, .ai-summary .sum-preview li')].filter(el => /附录 \(Other\.pdf/.test(el.textContent))
        // anchors inside "附录 (Other.pdf p. N)，同页 (p. N)。" (an item's own page link after the prose is Graphite's)
        .map(el => { const t = el.textContent; const i = t.indexOf('附录'), j = t.indexOf('。', i); return [...el.querySelectorAll('a')].filter(a => { const r = document.createRange(); r.selectNodeContents(el); r.setEndBefore(a); const at = r.toString().length; return at > i && at < j; }).length; }));
      assert.ok(extra.length >= 1 && extra.every(n => n === 0), 'a jump after 附录 / 同页: ' + JSON.stringify(extra));
      assert.ok(!/\[ref\]|\]:/.test(shown), 'a reference definition is shown');
      // f(x)=x and F(x)=x are different formulas; "f(x) = x" is the same as f(x)=x.
      const formulas = await p.evaluate(() => [...document.querySelectorAll('.ai-summary .sum-preview li')].map(li => li.textContent).filter(s => /lower f|upper F/.test(s)));
      assert.equal(formulas.filter(s => /upper F/.test(s)).length, 1, 'F(x)=x was dropped or repeated');
      assert.equal(formulas.filter(s => /lower f/.test(s)).length, 1, 'f(x)=x was dropped or repeated');
      assert.equal(formulas.filter(s => /same as lower f/.test(s)).length, 0, 'spacing made a duplicate');
    });

    await test('save, then regenerate: the hand-edited summary is kept (save as new by default)', async () => {
      await p.locator('.ai-summary [data-a=save]').click();
      await p.waitForFunction(() => !document.querySelector('.ai-summary'));
      const f = path.join(vault, 'Course', 'Long lecture summary.md');
      // The saved note: no reference definitions; the only jumps are Graphite's, each to a page its batch sent —
      // page 140 exactly once (its own "Sent page 140"), never from the batches that did not send it.
      const saved = await fs.readFile(f, 'utf8');
      assert.ok(!/^\s*\[[^\]]+\]:/m.test(saved), 'a reference definition was saved: ' + JSON.stringify(saved.split('\n').filter(l => /^\s*\[[^\]]+\]:/.test(l)).slice(0, 3)));
      assert.ok(!/\]\(|\]\[/.test(saved), 'a Markdown link was saved');
      const jumps = [...saved.matchAll(/\[\[([^\]|]*)#page=(\d+)\|p\. (\d+)\]\]/g)];
      assert.ok(jumps.every(m => m[1] === 'Long lecture.pdf' && m[2] === m[3] && textPages.includes(+m[2])), 'a jump not made by Graphite');
      assert.equal(saved.split('#page=').length - 1, jumps.length, 'a page link Graphite did not check');
      assert.equal(jumps.filter(m => m[2] === '140').length, 1, 'page 140 linked from a batch that did not send it');
      assert.ok(!/附录 \(Other\.pdf p\. \d+\)，同页 \(p\. \d+\)[^\n]*?\[\[/.test(saved.replace(/。[\s\S]*?$/gm, '')) && /附录 \(Other\.pdf p\. \d+\)，同页 \(p\. \d+\)。/.test(saved), 'Other.pdf or a bare #page was saved as a jump');
      // Reopened in the app, the reading view offers the same jumps (page 140 once).
      await p.locator('#tree [data-path="Course/Long lecture summary.md"]').click();
      await p.evaluate(() => document.querySelector('[data-cmd="mode-preview"]')?.click());
      await p.waitForFunction(() => document.querySelectorAll('#preview a[data-heading^="page="]').length > 100);
      assert.equal(await p.locator('#preview a[data-heading="page=140"]').count(), 1);
      assert.equal(await p.locator('#preview a[data-heading="page=999"], #preview a[data-heading="page=998"]').count(), 0);
      const edited = saved.replace('Sent page 2', 'MY OWN NOTE');
      await fs.writeFile(f, edited); await sleep(900);
      await start('Course/Short.pdf'); await p.locator('.ai-summary .sum-preview').waitFor(); await p.evaluate(() => document.querySelector('.ai-tool .review-x')?.click());
      await start('Course/Long lecture.pdf');
      await p.locator('.ai-summary .sum-exists').waitFor({ timeout: 240000 });
      assert.match(await p.locator('.ai-summary .sum-exists').innerText(), /edited it/);
      await p.locator('.ai-summary [data-a=save]').click();
      await p.waitForFunction(() => !document.querySelector('.ai-summary'));
      assert.equal(await fs.readFile(f, 'utf8'), edited);
      assert.ok(fss.existsSync(path.join(vault, 'Course', 'Long lecture summary 2.md')));
    });

    await test('a batch fails: nothing written, earlier parts kept; Retry continues from that batch and finishes', async () => {
      calls.length = 0;
      failOn = k => k === 2;
      const before = (await fs.readdir(path.join(vault, 'Course'))).sort();
      await start('Course/Long lecture.pdf');
      await p.locator('.ai-summary .sum-error').waitFor({ timeout: 240000 });
      assert.match(await p.locator('.ai-summary .sum-error').innerText(), /busy \(test\)/);
      assert.match(await p.locator('.ai-summary .sum-kept').innerText(), /1 of \d+ parts/);
      assert.deepEqual((await fs.readdir(path.join(vault, 'Course'))).sort(), before);
      failOn = null;
      const firstPages = String(calls[0].body.content).match(/--- page (\d+)/)[1];
      await p.locator('.ai-summary [data-a=retry]').click();
      await p.locator('.ai-summary .sum-preview li').first().waitFor({ timeout: 240000 });
      // Batch 1 was not sent again; batch 2 was retried.
      const firsts = calls.map(c => String(c.body.content).match(/--- page (\d+)/)[1]);
      assert.equal(firsts.filter(x => x === firstPages).length, 1, 'batch 1 was sent twice');
      assert.equal(firsts[1], firsts[2], 'the failed batch was not the one retried');
      const html = await p.evaluate(() => document.querySelector('.ai-summary .sum-preview').innerHTML);
      assert.deepEqual([...new Set([...html.matchAll(/data-heading="page=(\d+)"/g)].map(m => +m[1]))].sort((a, b) => a - b), textPages);
    });

    await test('Stop during batch 2 writes nothing and offers no half summary', async () => {
      calls.length = 0; delay = 2500;
      const before = (await fs.readdir(path.join(vault, 'Course'))).sort();
      await start('Course/Long lecture.pdf');
      await p.waitForFunction(() => document.querySelector('.sum-batch')?.dataset.batch === '2', null, { timeout: 240000 });
      await p.locator('.ai-summary [data-a=stop]').click();
      await p.locator('.ai-summary .sum-error').waitFor();
      assert.match(await p.locator('.ai-summary .sum-error').innerText(), /Stopped/);
      assert.equal(await p.locator('.ai-summary [data-a=retry]').count(), 0);
      assert.equal(await p.locator('.ai-summary .sum-preview').count(), 0);
      await sleep(3000);
      assert.deepEqual((await fs.readdir(path.join(vault, 'Course'))).sort(), before);
    });

    await test('a local agent gets the blank pages of its range to open itself, and may cite them; a range is respected', async () => {
      calls.length = 0;
      await start('Course/Long lecture.pdf', 'codex', '45-60');
      await p.locator('.ai-summary .sum-preview li').first().waitFor({ timeout: 240000 });
      const c = calls.map(x => String(x.body.content)).join('\n');
      assert.match(c, /<pages_without_text>50–51 — scanned/);
      assert.ok([...c.matchAll(/--- page (\d+)/g)].every(m => +m[1] >= 45 && +m[1] <= 60), 'sent pages outside 45–60');
      const html = await p.evaluate(() => document.querySelector('.ai-summary .sum-preview').innerHTML);
      assert.ok(/data-heading="page=50"/.test(html), 'a blank page the agent opened could not be cited');
      assert.ok(!/data-heading="page=140"/.test(html) && !/data-heading="page=1"/.test(html), 'cited outside the range');
    });

    await test('a PDF with only blank pages and an API model: clear message, nothing sent', async () => {
      calls.length = 0;
      await start('Course/Short.pdf', 'deepseek', '2');
      await p.locator('.ai-summary .sum-error').waitFor();
      assert.match(await p.locator('.ai-summary .sum-error').innerText(), /no text/);
      assert.equal(calls.length, 0);
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
