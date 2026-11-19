// Local frameworks, for real: Graphite starts the installed DeepSeek Harness (dsh) and Codex CLI, which read and
// write files with their own tools. The AI behind them is a scripted local stand-in (test/fake-llm.cjs), reached
// through each framework's own settings (DEEPSEEK_BASE_URL; a CODEX_HOME config), so no account, key or network
// is used. Everything lives in a new folder under test/.work (outside the system temp folder, so the frameworks'
// sandboxes treat it like the user's real files) and is deleted at the end unless KEEP=1.
//   node test/frameworks.cjs [filter]
const assert = require('node:assert/strict');
const fs = require('node:fs'); const fsp = fs.promises;
const path = require('node:path'); const crypto = require('node:crypto');
const fake = require('./fake-llm.cjs');
const filter = process.argv[2] ? new RegExp(process.argv[2]) : null;
const DSH = path.join(process.env.LOCALAPPDATA || '', 'Programs/DeepSeek Harness/resources/runtime/cli/bin/dsh.cmd');

const { script, seen, model } = require('./framework-model.cjs');

async function main() {
  const root = path.join(__dirname, '.work');
  await fsp.mkdir(root, { recursive: true });
  const tmp = await fsp.mkdtemp(path.join(root, 'fw-'));
  const vault = path.join(tmp, 'vault'), courses = path.join(tmp, 'courses'), outside = path.join(tmp, 'outside');
  const srv = await fake.start(model);
  // Isolated framework settings: their own homes, the stand-in AI, a fake key in the environment only.
  const dshHome = path.join(tmp, 'dsh-home'), codexHome = path.join(tmp, 'codex-home');
  await fsp.mkdir(dshHome, { recursive: true }); await fsp.mkdir(codexHome, { recursive: true });
  await fsp.writeFile(path.join(codexHome, 'config.toml'), `model = "fake-model"\nmodel_provider = "fake"\nanalytics.enabled = false\n[model_providers.fake]\nname = "Local test"\nbase_url = "${srv.url}/v1"\nenv_key = "FAKE_CODEX_KEY"\nwire_api = "responses"\nsupports_websockets = false\n`);
  Object.assign(process.env, { DSH_HOME: dshHome, DEEPSEEK_BASE_URL: srv.url, DEEPSEEK_API_KEY: 'sk-test-' + 'x'.repeat(24), DSH_TELEMETRY_DISABLED: '1', CODEX_HOME: codexHome, FAKE_CODEX_KEY: 'fake' });
  const marker = 'MARK-' + crypto.randomBytes(4).toString('hex');
  script.marker = marker;
  const files = {
    [path.join(vault, 'Algebra/Lesson.md')]: '# Lesson\n' + marker + '\n',
    [path.join(vault, 'Algebra/Index.md')]: '# Index\n',
    [path.join(vault, 'Claude Inbox.md')]: '# Inbox\n- [ ] **Interesting** · 2026-11-20 · [[Algebra/Lesson]] %%cap-1%%\n  > First capture.\n- [ ] **Not familiar** · 2026-11-20 · [[Algebra/Lesson]] %%cap-2%%\n  > Second capture.\n',
    [path.join(vault, 'Claude Brain/log.md')]: '# Brain\n',
    [path.join(courses, 'Algebra/Slides.pdf')]: Buffer.from('%PDF-1.4\n' + crypto.randomBytes(2000).toString('base64') + '\n%%EOF\n'),
    [path.join(courses, 'Algebra/Notes2.md')]: '# Notes 2\n' + marker + '\n',
    [path.join(outside, 'secret.md')]: 'outside the allowed folders\n',
  };
  for (const [f, b] of Object.entries(files)) { await fsp.mkdir(path.dirname(f), { recursive: true }); await fsp.writeFile(f, b); }
  const port = await require(path.join(__dirname, '..', 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const snapshot = async () => Object.fromEntries(await Promise.all(['Claude Inbox.md', 'Algebra/Lesson.md', 'Algebra/Index.md', 'Claude Brain/log.md', 'Algebra/Filed.md', 'Algebra/Second.md', 'Algebra/Slides.pdf'].map(async r => [r, await fsp.readFile(path.join(vault, r), 'utf8').catch(() => null)])));
  async function job(body) {
    const r = await fetch(origin + '/api/agent', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ lang: 'en', roots: [courses], skip: ['UPC'], ...body }) });
    const rows = (await r.text()).trim().split('\n').filter(Boolean).map(l => JSON.parse(l));
    const last = rows.at(-1);
    return { steps: rows.filter(x => x.progress).map(x => x.progress), result: last.result, error: last.error ? last : null };
  }
  const results = [];
  async function test(name, fn) {
    if (filter && !filter.test(name)) return;
    Object.assign(script, { mode: 'plan', plan: null, readFile: null, writeWrong: false, fail: false, outside: null });
    try { await fn(); results.push([name, 'PASS']); console.log('PASS ' + name); }
    catch (e) { results.push([name, 'FAIL', e.message]); console.log('FAIL ' + name + '\n  ' + e.message); }
  }
  const inboxPlan = { items: [{ id: 'cap-1', target: 'Algebra/Filed.md', mode: 'new', text: '# Filed\nRead by the framework: NATIVE_MARKER', shown: 'Filed' }, { id: 'cap-2', target: 'Algebra/Second.md', mode: 'new', text: '# Second\nNot confirmed', shown: 'Second' }], summary: 'Two captures.' };
  try {
    await test('detects both installed frameworks', async () => {
      const d = await fetch(origin + '/api/frameworks').then(r => r.json());
      assert.ok(d.dsh.found && d.codex.found, JSON.stringify(d));
      console.log('  dsh', d.dsh.version, '· codex', d.codex.version);
    });
    for (const fw of ['dsh', 'codex']) {
      await test(`${fw}: reads the note itself, writes only the confirmed capture in its stage, Graphite applies it`, async () => {
        script.plan = inboxPlan; script.readFile = path.join(vault, 'Algebra/Lesson.md');
        const before = await snapshot();
        const plan = await job({ job: 'inbox', framework: fw, phase: 'plan' });
        assert.ok(!plan.error, JSON.stringify(plan.error));
        assert.equal(plan.result.framework, fw); assert.equal(plan.result.items.length, 2);
        assert.ok(seen.reads.includes(marker), 'the framework did not read the note');
        assert.deepEqual(await snapshot(), before, 'planning changed files');
        seen.writes = [];
        const done = await job({ job: 'inbox', framework: fw, phase: 'apply', planId: plan.result.planId, accept: [0], acceptEdits: [] });
        assert.ok(!done.error, JSON.stringify(done.error));
        assert.ok(seen.writes.includes('Algebra/Filed.md') && seen.writes.includes('Claude Inbox.md'), 'the framework did not write: ' + seen.writes);
        const after = await snapshot();
        assert.ok(after['Algebra/Filed.md'].includes(marker));
        assert.equal(after['Algebra/Second.md'], null, 'an unticked capture was written');
        assert.match(after['Claude Inbox.md'], /- \[x\] .*%%cap-1%%/); assert.match(after['Claude Inbox.md'], /- \[ \] .*%%cap-2%%/);
        assert.equal(after['Algebra/Lesson.md'], before['Algebra/Lesson.md']);
        const left = (await fsp.readdir(require('os').tmpdir())).filter(n => n.startsWith('graphite-stage-'));
        // reset for the next framework
        await fsp.rm(path.join(vault, 'Algebra/Filed.md')); await fsp.writeFile(path.join(vault, 'Claude Inbox.md'), files[path.join(vault, 'Claude Inbox.md')]);
        void left;
      });
      await test(`${fw}: a failure while writing (exit or error from its AI) changes nothing and keeps its work folder`, async () => {
        script.plan = inboxPlan; script.readFile = path.join(vault, 'Algebra/Lesson.md');
        const before = await snapshot();
        const plan = await job({ job: 'inbox', framework: fw, phase: 'plan' });
        assert.ok(plan.result?.planId, JSON.stringify(plan.error));
        script.fail = true;
        const done = await job({ job: 'inbox', framework: fw, phase: 'apply', planId: plan.result.planId, accept: [0], acceptEdits: [] });
        assert.ok(done.error, 'a failed run was reported as done');
        assert.ok(['failed', 'auth'].includes(done.error.code), JSON.stringify(done.error));
        assert.ok(done.error.stage && fs.existsSync(done.error.stage), 'the work folder was not kept');
        assert.deepEqual(await snapshot(), before, 'files changed after a failed run');
      });
      await test(`${fw}: a staged result that differs from what was confirmed is not applied`, async () => {
        script.plan = inboxPlan; script.readFile = path.join(vault, 'Algebra/Lesson.md');
        const before = await snapshot();
        const plan = await job({ job: 'inbox', framework: fw, phase: 'plan' });
        script.writeWrong = true;
        const done = await job({ job: 'inbox', framework: fw, phase: 'apply', planId: plan.result.planId, accept: [0], acceptEdits: [] });
        assert.equal(done.error?.code, 'badStage', JSON.stringify(done.error || done.result));
        assert.deepEqual(await snapshot(), before);
      });
      await test(`${fw}: reading outside the allowed folders stops it`, async () => {
        script.plan = inboxPlan; script.outside = path.join(outside, 'secret.md');
        const plan = await job({ job: 'inbox', framework: fw, phase: 'plan' });
        assert.equal(plan.error?.code, 'outside', JSON.stringify(plan.error || plan.result));
      });
    }
    await test('codex: imports a course file byte for byte and adds it to the course index (writes by codex in its stage)', async () => {
      script.readFile = path.join(courses, 'Algebra/Notes2.md');
      script.plan = p => { const ids = [...p.matchAll(/\{"id":(\d+),[^\n]*?"name":"([^"]+)"/g)]; const pdf = ids.find(m => m[2] === 'Slides.pdf'); return { items: pdf ? [{ id: +pdf[1], dest: 'Algebra/Slides.pdf' }] : [], ignore: [], questions: [], note: 'read NATIVE_MARKER' }; };
      const plan = await job({ job: 'import', framework: 'codex', phase: 'plan' });
      assert.ok(plan.result?.planId, JSON.stringify(plan.error || plan.result));
      assert.equal(plan.result.items.length, 1);
      assert.equal((await snapshot())['Algebra/Slides.pdf'], null);
      seen.writes = [];
      const done = await job({ job: 'import', framework: 'codex', phase: 'apply', planId: plan.result.planId });
      assert.ok(!done.error, JSON.stringify(done.error));
      assert.deepEqual(await fsp.readFile(path.join(vault, 'Algebra/Slides.pdf')), files[path.join(courses, 'Algebra/Slides.pdf')]);
      assert.match(await fsp.readFile(path.join(vault, 'Algebra/Index.md'), 'utf8'), new RegExp('# Index[\\s\\S]*Slides\\.pdf[\\s\\S]*' + marker));
      assert.ok(seen.writes.includes('Algebra/Slides.pdf'), 'codex did not do the copy');
    });
    await test('dsh: the Brain edit is written by dsh in its stage after confirmation', async () => {
      // Brain plans come from chat history; here the confirmed edit is given straight to the apply step.
      script.plan = { edits: [{ path: 'Claude Brain/log.md', content: '# Brain\nNew entry NATIVE_MARKER\n', why: 'test' }], summary: 'one edit' };
      script.readFile = path.join(vault, 'Algebra/Lesson.md');
      const plan = await job({ job: 'brain', framework: 'dsh', phase: 'plan', history: [{ role: 'user', content: 'I understood eigenvalues.' }, { role: 'assistant', content: 'Good.' }] });
      assert.ok(plan.result?.planId, JSON.stringify(plan.error || plan.result));
      assert.equal(await fsp.readFile(path.join(vault, 'Claude Brain/log.md'), 'utf8'), '# Brain\n');
      const done = await job({ job: 'brain', framework: 'dsh', phase: 'apply', planId: plan.result.planId });
      assert.ok(!done.error, JSON.stringify(done.error));
      assert.ok((await fsp.readFile(path.join(vault, 'Claude Brain/log.md'), 'utf8')).includes(marker));
    });
    await test('a framework that is not installed (or a wrong path) is reported, nothing else is started', async () => {
      const n = srv.log.length;
      for (const [p, code] of [[path.join(tmp, 'nowhere', 'dsh.cmd'), 'notFoundAt'], [path.join(process.env.SystemRoot || 'C:/Windows', 'notepad.exe'), 'badName']]) {
        const plan = await job({ job: 'inbox', framework: 'dsh', phase: 'plan', frameworkPaths: { dsh: p } });
        assert.equal(plan.error?.code, code, JSON.stringify(plan.error || plan.result));
      }
      assert.equal(srv.log.length, n, 'another AI was asked instead');
    });
    await test('framework detection with a custom path needs the app (POST with X-Vault)', async () => {
      const r = await fetch(origin + '/api/frameworks?dsh=' + encodeURIComponent('C:/Windows/notepad.exe'));
      const d = await r.json();
      assert.ok(d.dsh.found && !/notepad/i.test(d.dsh.path || ''), 'GET used a path from the address');
      const bad = await fetch(origin + '/api/frameworks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: { dsh: 'C:/Windows/notepad.exe' } }) });
      assert.ok(!bad.ok, 'POST without X-Vault was accepted');
    });
    await test('exam analysis with dsh: it gets the PDF path and pages, and its answer comes back', async () => {
      script.readFile = path.join(vault, 'Algebra/Lesson.md');
      script.plan = { title: 'Exam', markdown: '# Exam\nNATIVE_MARKER', problems: [] };
      const r = await fetch(origin + '/api/local-ai', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'exam', framework: 'dsh', lang: 'en', title: 'Paper', content: '<pdf_file>Algebra/Paper.pdf</pdf_file>', path: 'Algebra/Lesson.md' }) });
      const d = await r.json();
      assert.ok(r.ok, JSON.stringify(d));
      assert.ok(d.markdown.includes(marker)); assert.equal(d.framework, 'dsh');
      assert.ok(seen.prompts.some(p => p.includes('Algebra')), 'the file path was not in the task');
    });
  } finally { srv.close(); }
  console.log(JSON.stringify({ tmp, passed: results.filter(r => r[1] === 'PASS').length, total: results.length }, null, 1));
  if (!process.env.KEEP) await fsp.rm(tmp, { recursive: true, force: true }).catch(() => {});
  process.exit(results.every(r => r[1] === 'PASS') ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(2); });
void DSH;
