// The course-file import window in a real browser with made-up files (A.docx, B.pptx, C.pdf, Example A.docx …):
// the backend (/api/agent) and the desktop's folder access (window.myobsidianDesktop.agentFolders) are simulated
// with the agreed protocol. Checks the result page (all, some, none imported; originals whose PDF preview is
// still to be made are imported, not lost; short reasons with details; each reason once), retrying only the
// missing previews or only the failed files (one request, nothing else sent), the page for a folder the import
// could not use (who refused, never "the whole disk", choose / cancel / revoke a folder, resume or not), the
// Chinese text of the AI program's own permission error, and previews still to make after a restart.
//   node test/import-results-ui.cjs [filter]
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const repo = path.join(__dirname, '..');
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const nd = o => JSON.stringify(o) + '\n';

const PLAN = { planId: 'plan-1', total: 3, items: [
  { name: 'A.docx', src: 'C:/Courses/CS/A.docx', dest: 'CS/A.pdf', kind: 'convert', course: 'CS' },
  { name: 'B.pptx', src: 'C:/Courses/CS/B.pptx', dest: 'CS/B.pdf', kind: 'convert', course: 'CS' },
  { name: 'C.pdf', src: 'C:/Courses/CS/C.pdf', dest: 'CS/C.pdf', kind: 'copy', course: 'CS' },
] };
const LONG = 'Office conversion failed: C:\\Users\\student\\AppData\\Local\\Temp\\graphite-office-91a\\A.docx: \uFFFD\uFFFD COM error 0x800A03EC\nat Word.Application.Documents.Open\n   at convert (office.ps1:42)';
const ALL_OK = { job: 'import', done: [
  { name: 'A.docx', originalDest: 'CS/A.docx', dest: 'CS/A.pdf', preview: { status: 'ready', dest: 'CS/A.pdf' } },
  { name: 'B.pptx', originalDest: 'CS/B.pptx', dest: 'CS/B.pdf', preview: { status: 'ready', dest: 'CS/B.pdf' } },
  { name: 'C.pdf', dest: 'CS/C.pdf' }], failed: [], indexError: '' };
const PARTIAL = { job: 'import', done: [
  { name: 'A.docx', originalDest: 'CS/A.docx', dest: 'CS/A.docx', preview: { status: 'failed', code: 'officeFailed', reason: LONG, retryId: 'prev-A' } },
  { name: 'C.pdf', dest: 'CS/C.pdf' }],
  failed: [{ name: 'B.pptx', src: 'C:/Courses/CS/B.pptx', error: 'The file is open in another program (EBUSY)', code: 'busy' }],
  retry: { id: 'rec-1', count: 1, framework: 'codex' },
  indexError: LONG };
const NONE = { job: 'import', done: [], failed: [{ name: 'A.docx', error: 'locked' }, { name: 'B.pptx', error: 'locked' }], indexError: '' };

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-import-ui-'));
  await fs.writeFile(path.join(vault, 'Welcome.md'), 'Welcome');
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  async function page({ lang = 'en', width = 1300, folders = null } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height: 860 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(({ lang, folders }) => {
      localStorage.setItem('mo:lang', JSON.stringify(lang));
      localStorage.setItem('mo:ai', JSON.stringify({ use: { import: 'codex', inbox: 'off', check: 'off', chat: 'off' } }));
      if (folders) {
        // The desktop's source-folder access, simulated: list / choose (system picker) / revoke.
        // With persist, the folder list survives a reload (as the desktop app keeps it).
        const saved = folders.persist ? JSON.parse(localStorage.getItem('fake:folders') || 'null') : null;
        let list = saved || folders.list, nextChoose = folders.choose || [];
        const keep = () => { if (folders.persist) localStorage.setItem('fake:folders', JSON.stringify(list)); };
        window.__folderCalls = [];
        window.myobsidianDesktop = { setLanguage() {}, onAppCommand() {}, onUpdate() {},
          async agentFolders(action, args) {
            window.__folderCalls.push([action, args || null]);
            if (action === 'list') return { ok: true, folders: list };
            if (action === 'choose') { const c = nextChoose.shift() || { canceled: true }; if (c.canceled) return { ok: true, canceled: true, folders: list }; list = [...list, c.folder]; keep(); return { ok: true, added: true, selectedId: c.folder.id, folders: list }; }
            if (action === 'revoke') { list = list.filter(f => f.id !== args.id); keep(); return { ok: true, folders: list }; }
            return { ok: false, code: 'bad', message: 'bad action' };
          } };
      }
    }, { lang, folders });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    const errors = []; p.on('pageerror', e => errors.push(e.message)); p.__errors = errors;
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor({ state: 'attached' });
    await p.waitForFunction(() => window.app?.commands);
    await p.route(origin + '/api/frameworks', r => r.fulfill({ json: { codex: { found: true, version: '1.0' }, dsh: { found: false } } }));
    return p;
  }
  async function test(name, fn, opts) {
    if (filter && !filter.test(name)) return;
    let p;
    try { p = await page(opts); await fn(p); if (p.__errors.length) throw new Error('page errors: ' + p.__errors.join(' | ')); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { results.push({ name, pass: false }); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 10).join('\n  ')); }
    finally { await p?.context().close(); }
  }
  // The simulated /api/agent: answers by phase; every request body is kept.
  async function agent(p, answers) {
    const sent = [];
    await p.route(origin + '/api/agent', async r => {
      const body = JSON.parse(r.request().postData()); sent.push(body);
      const a = answers[body.phase] ?? answers.default;
      const out = typeof a === 'function' ? await a(body, sent) : a;
      return r.fulfill({ status: 200, contentType: 'application/x-ndjson', body: out });
    });
    return sent;
  }
  const start = async p => { await p.evaluate(() => window.app.commands.executeCommandById('find-course-files')); await p.locator('.fj-modal [data-a=apply]').waitFor(); };
  const applyAll = async p => { await p.locator('.fj-modal [data-a=apply]').click(); await p.locator('.fj-res-head').waitFor(); };
  const head = p => p.locator('.fj-res-head');

  await test('all imported: green tick, the exact count, each file in the vault, no retry buttons', async p => {
    await agent(p, { plan: nd({ result: PLAN }), apply: nd({ result: ALL_OK }) });
    await start(p); await applyAll(p);
    assert.match(await head(p).getAttribute('class'), /is-ok/);
    assert.match(await head(p).innerText(), /Done: 3/);
    assert.equal(await p.locator('.fj-res-imported li').count(), 3);
    assert.equal(await p.locator('.fj-modal [data-a=previews], .fj-modal [data-a=resume]').count(), 0);
  });

  await test('some imported: warning (not a green tick); originals with previews still to make count as imported; short reasons, details folded, each reason once', async p => {
    await agent(p, { plan: nd({ result: PLAN }), apply: nd({ result: PARTIAL }) });
    await start(p); await applyAll(p);
    assert.equal(await head(p).getAttribute('class'), 'fj-res-head is-partial', 'not "done"');
    const h = await head(p).innerText();
    assert.match(h, /Imported 2 of 3/); assert.match(h, /1 imported originals still need their PDF preview/); assert.match(h, /1 files were not imported/);
    const pending = p.locator('.fj-res-imported .is-pending');
    assert.equal(await pending.count(), 1);
    assert.match(await pending.innerText(), /CS\/A\.docx[\s\S]*Original imported · PDF preview still to make/);
    const short = await pending.locator('.fj-reason').innerText();
    assert.ok(!short.includes('AppData') && !short.includes('\uFFFD') && short.length <= 140, short);
    assert.equal(await pending.locator('details.fj-diag').getAttribute('open'), null, 'long diagnostics folded');
    assert.match(await p.locator('.fj-res-failed').innerText(), /B\.pptx[\s\S]*Not imported[\s\S]*open in another program/);
    assert.equal(await p.locator('.fj-res-note').count(), 0, 'indexError repeats the per-file reason: shown once');
    assert.equal((await p.locator('.fj-modal .fj-body').innerText()).split('COM error').length - 1, 1);
    assert.match(await p.locator('.fj-modal [data-a=previews]').innerText(), /Make the missing previews \(1\)/);
    assert.match(await p.locator('.fj-modal [data-a=resume]').innerText(), /Retry these 1 files/);
  });

  await test('Make the missing previews: one request per preview (double click ignored), only the retryId; the row becomes ready', async p => {
    let release; const gate = new Promise(r => { release = r; });
    const sent = await agent(p, { plan: nd({ result: PLAN }), apply: nd({ result: PARTIAL }),
      retryPreview: async () => { await gate; return nd({ result: { job: 'import', done: [{ name: 'A.docx', originalDest: 'CS/A.docx', dest: 'CS/A.pdf', preview: { status: 'ready', dest: 'CS/A.pdf' } }], failed: [] } }); } });
    await start(p); await applyAll(p);
    await p.locator('.fj-modal [data-a=previews]').evaluate(b => { b.click(); b.click(); });
    release();
    await p.waitForFunction(() => !document.querySelector('.fj-res-imported .is-pending'));
    const retries = sent.filter(b => b.phase === 'retryPreview');
    assert.equal(retries.length, 1);
    assert.equal(retries[0].retryId, 'prev-A'); assert.equal(retries[0].provider, 'graphite');
    assert.ok(!('accept' in retries[0]) && !('destinations' in retries[0]));
    assert.match(await head(p).innerText(), /Imported 2 of 3/);
    assert.equal(await p.locator('.fj-modal [data-a=previews]').count(), 0);
  });

  await test('Retry these files: resumeImport with the recovery id and the same AI, no accept/destinations; B is added once, nothing else', async p => {
    const sent = await agent(p, { plan: nd({ result: PLAN }), apply: nd({ result: PARTIAL }),
      resumeImport: nd({ result: { job: 'import', done: [{ name: 'B.pptx', originalDest: 'CS/B.pptx', dest: 'CS/B.pdf', preview: { status: 'ready', dest: 'CS/B.pdf' } }], failed: [] } }) });
    await start(p); await applyAll(p);
    await p.locator('.fj-modal [data-a=resume]').evaluate(b => { b.click(); b.click(); });
    await p.waitForFunction(() => !document.querySelector('.fj-res-failed'));
    const resumes = sent.filter(b => b.phase === 'resumeImport');
    assert.equal(resumes.length, 1);
    assert.equal(resumes[0].recoveryId, 'rec-1'); assert.equal(resumes[0].framework, 'codex');
    assert.ok(!('accept' in resumes[0]) && !('destinations' in resumes[0]) && !('provider' in resumes[0]));
    assert.equal(await p.locator('.fj-res-imported li').count(), 3, 'A, C and now B, each once');
    assert.equal(await p.locator('.fj-modal [data-a=resume]').count(), 0);
  });

  await test('nothing imported: a red cross and the count, not a tick', async p => {
    await agent(p, { plan: nd({ result: PLAN }), apply: nd({ result: NONE }) });
    await start(p); await applyAll(p);
    assert.equal(await head(p).getAttribute('class'), 'fj-res-head is-none');
    assert.match(await head(p).innerText(), /Nothing was imported \(2 files\)/);
    assert.equal(await p.locator('.fj-res-imported').count(), 0);
  });

  await test('a long result list scrolls and, in a narrow window, the buttons stay on screen', async p => {
    const many = { ...PARTIAL, done: [...PARTIAL.done, ...Array.from({ length: 60 }, (_, i) => ({ name: `N${i}.pdf`, dest: `CS/N${i}.pdf` }))] };
    await agent(p, { plan: nd({ result: PLAN }), apply: nd({ result: many }) });
    await start(p); await applyAll(p);
    const list = await p.locator('.fj-res-imported').evaluate(el => ({ scroll: el.scrollHeight > el.clientHeight, overflow: getComputedStyle(el).overflowY }));
    assert.ok(list.scroll && list.overflow === 'auto');
    const btn = await p.locator('.fj-modal [data-a=resume]').boundingBox();
    assert.ok(btn && btn.y + btn.height <= 860 && btn.x >= 0 && btn.x + btn.width <= 420, JSON.stringify(btn));
  }, { width: 420 });

  const GRAPHITE_ROOT = nd({ error: 'Codex CLI: D:\\', status: 403, code: 'outside', framework: 'codex', detail: 'D:\\', access: { source: 'graphite', operation: 'list', path: 'D:\\', driveRoot: true }, recovery: { id: 'rec-9', framework: 'codex', count: 2 } });
  const FOLDERS = { list: [{ id: 'f-old', path: 'C:/Courses', graphiteAllowed: true, processReadable: true, agentAccess: 'unverified', revocable: false }],
    choose: [{ canceled: true }, { folder: { id: 'f-new', path: 'C:/Courses/CS', graphiteAllowed: true, processReadable: true, agentAccess: 'unverified', revocable: true } }] };

  await test('Graphite stopped the AI at a drive root: says so, never offers the whole drive; folders show three separate states; choose (cancel, then a folder) and revoke', async p => {
    await agent(p, { plan: nd({ result: PLAN }), apply: GRAPHITE_ROOT });
    await start(p); await p.locator('.fj-modal [data-a=apply]').click();
    await p.locator('.fj-access').waitFor();
    const text = await p.locator('.fj-access').innerText();
    assert.match(text, /Graphite stopped Codex CLI: it tried to use D:\\, outside the folders this import may use/);
    assert.match(text, /root of a drive\. Graphite never allows a whole drive/);
    assert.ok(!/allow (the )?whole (disk|drive)\b(?! :)/i.test(text.replace('never allows a whole drive', '')), 'no offer to allow the drive');
    assert.match(text, /Needed for: reading the source files you confirmed, only for this import/);
    await p.locator('.fj-folder[data-id="f-old"]').waitFor();
    assert.match(await p.locator('.fj-folder[data-id="f-old"]').innerText(), /Graphite: allowed[\s\S]*Graphite can list it[\s\S]*AI program: not verified/);
    assert.equal(await p.locator('.fj-folder[data-id="f-old"] [data-revoke]').count(), 0, 'an older source can\'t be revoked here');
    await p.locator('.fj-modal [data-a=choose]').click();
    await sleep(200);
    assert.equal(await p.locator('.fj-folder').count(), 1, 'cancel changes nothing');
    await p.locator('.fj-modal [data-a=choose]').click();
    await p.locator('.fj-folder[data-id="f-new"] [data-revoke]').click();
    await p.waitForFunction(() => !document.querySelector('.fj-folder[data-id="f-new"]'));
    assert.deepEqual(await p.evaluate(() => window.__folderCalls.map(c => c[0])), ['list', 'choose', 'choose', 'revoke']);
    assert.deepEqual(await p.evaluate(() => window.__folderCalls[3][1]), { id: 'f-new' });
  }, { folders: FOLDERS });

  await test('recoverable: "Retry with Codex CLI" and "Let Graphite import" each send resumeImport with only the recovery id', async p => {
    const sent = await agent(p, { plan: nd({ result: PLAN }), apply: GRAPHITE_ROOT, resumeImport: nd({ result: ALL_OK }) });
    await start(p); await p.locator('.fj-modal [data-a=apply]').click();
    await p.locator('.fj-modal [data-a=resume-graphite]').click();
    await p.locator('.fj-res-head.is-ok').waitFor();
    const r = sent.filter(b => b.phase === 'resumeImport');
    assert.equal(r.length, 1);
    assert.deepEqual({ id: r[0].recoveryId, provider: r[0].provider, framework: r[0].framework || null }, { id: 'rec-9', provider: 'graphite', framework: null });
    assert.ok(!('accept' in r[0]) && !('destinations' in r[0]));
  });

  await test('recoverable with the same AI: framework codex, no provider', async p => {
    const sent = await agent(p, { plan: nd({ result: PLAN }), apply: GRAPHITE_ROOT, resumeImport: nd({ result: ALL_OK }) });
    await start(p); await p.locator('.fj-modal [data-a=apply]').click();
    await p.locator('.fj-modal [data-a=resume-fw]').click();
    await p.locator('.fj-res-head.is-ok').waitFor();
    const r = sent.filter(b => b.phase === 'resumeImport');
    assert.equal(r[0].framework, 'codex'); assert.equal(r[0].recoveryId, 'rec-9'); assert.ok(!('provider' in r[0]));
  });

  for (const [kind, line, want] of [
    ['unconfirmed', nd({ error: 'x', status: 403, code: 'outside', framework: 'codex', access: { source: 'graphite', operation: 'commandPath', path: 'C:\\' } }), /could not confirm what Codex CLI accessed: C:\\ was only read from the text of a command\. Nothing shows that it read the whole disk/],
    ['agent', nd({ error: 'x', status: 403, code: 'agentPermission', framework: 'codex', access: { source: 'agent', operation: 'fileAccess' } }), /Codex CLI itself refused a file operation[\s\S]*doesn’t lift/],
    ['system', nd({ error: 'EACCES', status: 403, code: 'EACCES', access: { source: 'system', path: 'C:/Courses/CS' } }), /operating system refused access to C:\/Courses\/CS/],
    ['unknown', nd({ error: 'x', status: 403, code: 'outside', framework: 'codex', access: {} }), /could not confirm why access failed/],
  ]) {
    await test(`who refused (${kind}); without a recovery only "Scan again" is offered`, async p => {
      await agent(p, { plan: nd({ result: PLAN }), apply: line });
      await start(p); await p.locator('.fj-modal [data-a=apply]').click();
      await p.locator('.fj-access').waitFor();
      assert.equal(await p.locator('.fj-access').getAttribute('data-kind'), kind);
      assert.match(await p.locator('.fj-access .fj-acc-why').innerText(), want);
      assert.match(await p.locator('.fj-access').innerText(), /can’t be continued safely from here/);
      assert.equal(await p.locator('.fj-modal [data-a=resume-fw], .fj-modal [data-a=resume-graphite]').count(), 0);
      assert.equal(await p.locator('.fj-modal [data-a=rescan]').count(), 1);
    });
  }

  await test('the AI program\'s own permission error reads as a sentence in every language (never fw.err.agentPermission)', async p => {
    const out = await p.evaluate(async () => {
      const { errorText } = await import('/ai.js'); const { setLang } = await import('/i18n.js').catch(() => ({}));
      const res = {};
      for (const lang of ['en', 'fr', 'es', 'ja', 'ko', 'zh-CN', 'zh-TW']) {
        localStorage.setItem('mo:lang', JSON.stringify(lang)); if (setLang) setLang(lang);
        res[lang] = [errorText({ code: 'agentPermission', detail: 'denied', message: 'x' }, 'codex'), errorText({ code: 'brandNewCode', detail: 'boom', message: 'x' }, 'codex')];
      }
      return res;
    });
    for (const [lang, [known, other]] of Object.entries(out)) {
      assert.ok(!known.includes('fw.err.') && known.includes('Codex CLI'), lang + ': ' + known);
      assert.ok(!other.includes('fw.err.') && other.includes('boom'), lang + ': ' + other);
    }
    assert.match(out['zh-CN'][0], /Codex CLI 自身拒绝了文件操作/);
  });

  await test('after a restart: originals already imported with only the preview to make keep their place, are ticked, and send no destination', async p => {
    const restart = { planId: 'plan-2', planMode: 'manual', total: 2, items: [
      { name: 'Example A.docx', originalDest: 'CS/Example A.docx', src: 'CS/Example A.docx', dest: 'CS/Example A.pdf', kind: 'convert', retryPreviewId: 'prev-1' },
      { name: 'Example B.pptx', originalDest: 'CS/Example B.pptx', src: 'CS/Example B.pptx', dest: 'CS/Example B.pdf', kind: 'convert', retryPreviewId: 'prev-2' }] };
    const sent = await agent(p, { plan: nd({ result: restart }), apply: nd({ result: { ...ALL_OK, done: ALL_OK.done.slice(0, 2) } }) });
    await p.evaluate(() => window.app.commands.executeCommandById('find-course-files-manual'));
    await p.locator('.fj-modal [data-a=apply]').waitFor();
    const rows = p.locator('.fj-item.is-preview-only');
    assert.equal(await rows.count(), 2);
    assert.equal(await p.locator('.fj-tag', { hasText: /course/i }).count(), 0, 'no "unclear course" tag');
    assert.match(await rows.first().innerText(), /Already imported · only the PDF preview to make[\s\S]*Stays at CS\/Example A\.docx/);
    assert.equal(await p.locator('.fj-item input[type=checkbox]:checked').count(), 2);
    assert.equal(await p.locator('.fj-folder').count(), 0, 'no folder to choose again');
    await p.locator('.fj-modal [data-a=apply]').click();
    await p.locator('.fj-res-head').waitFor();
    const apply = sent.find(b => b.phase === 'apply');
    assert.deepEqual(apply.accept, [0, 1]); assert.deepEqual(apply.destinations, {});
  });

  await test('summary of an imported PDF: its own folder first, the mapped course offered (source paths in lower case; a PDF made from a DOCX maps back to it); read-only refused', async p => {
    const tiny = ['%PDF-1.4', '1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj', 'trailer<</Root 1 0 R>>', '%%EOF', ''].join('\n');
    for (const [n, b] of Object.entries({ '待整理/A.docx': 'docx', '待整理/A.pdf': tiny, '待整理/B.pdf': tiny, '程序设计/x.md': 'x' })) { await fs.mkdir(path.dirname(path.join(vault, n)), { recursive: true }); await fs.writeFile(path.join(vault, n), b); }
    await fs.mkdir(path.join(vault, '.obsidian/plugins/claude-chat'), { recursive: true });
    await fs.writeFile(path.join(vault, '.obsidian/plugins/claude-chat/imports.json'), JSON.stringify({
      imported: { 'c:/courses/cs/a.docx': { dest: '待整理/A.docx', previewId: 'pv1' }, 'c:/courses/cs/b.pdf': { dest: '待整理/B.pdf' } },
      previews: { pv1: { originalDest: '待整理/A.docx', pdfDest: '待整理/A.pdf', status: 'ready' } } }));
    const setProfile = ro => p.evaluate(ro => fetch('/api/study-profile', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ profile: { courseRoots: ['C:/Courses'], courses: { CS: '程序设计' }, readOnlyFolders: ro } }) }), ro);
    await setProfile([]);
    await p.evaluate(() => window.app?.vault?.adapter && fetch('/api/all'));
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    const options = async file => {
      await p.evaluate(f => import('/summary.js').then(m => m.summaryDialog(f)), file);
      const sel = p.locator('.ai-summary select[data-f=dest]');
      await sel.waitFor();
      const out = await sel.locator('option').evaluateAll(o => o.map(x => ({ text: x.textContent, disabled: x.disabled })));
      await p.locator('.ai-summary .review-x').click();
      return out;
    };
    for (const file of ['待整理/A.pdf', '待整理/B.pdf']) {
      const o = await options(file);
      assert.equal(o.length, 2, file + ': ' + JSON.stringify(o));
      assert.match(o[0].text, /待整理/, "the PDF's own folder first");
      assert.match(o[1].text, /程序设计/);
      assert.equal(o[1].disabled, false);
    }
    await setProfile(['程序设计']);
    const o = await options('待整理/A.pdf');
    assert.equal(o[1].disabled, true, "a read-only course folder can't be chosen");
    await setProfile([]);
  });

  await test('Settings → Study settings → Manage folders: add a course folder with the system picker, see it after reopening, revoke it (no import error needed)', async p => {
    const open = async () => {
      await p.evaluate(() => import('/settings.js').then(m => m.openSettings('study')));
      await p.locator('[data-study=manageFolders]').click();
      await p.locator('.study-folders .fj-folder-list li').first().waitFor();
    };
    await open();
    assert.equal(await p.locator('[data-study=manageFolders]').getAttribute('aria-expanded'), 'true');
    assert.equal(await p.locator('.study-folders .fj-folder').count(), 1);
    await p.locator('.study-folders [data-a=choose]').click();
    await p.locator('.study-folders .fj-folder[data-id="f-new"]').waitFor();
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    await open();
    assert.equal(await p.locator('.study-folders .fj-folder[data-id="f-new"]').count(), 1, 'still there after reopening');
    await p.locator('.study-folders [data-revoke="f-new"]').click();
    await p.waitForFunction(() => !document.querySelector('.study-folders .fj-folder[data-id="f-new"]'));
    assert.deepEqual(await p.evaluate(() => window.__folderCalls.map(c => c[0])), ['list', 'revoke']);
  }, { folders: { ...FOLDERS, choose: [{ folder: FOLDERS.choose[1].folder }], persist: true } });

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
