// Settings → AI, a job's own model, in a real browser with a simulated provider (no real keys, nothing sent out).
// Checks that the model row shows only for an API company, defaults to the key box's model, can pick another model
// for one job only, that the job's request carries that model while other jobs keep the default, that "Default"
// clears it, and that it is kept per company when the job switches away and back.
//   node test/job-model-ui.cjs
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const repo = path.join(__dirname, '..');
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-jobmodel-'));
  await fs.writeFile(path.join(vault, 'Welcome.md'), 'Welcome');
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('mo:lang', JSON.stringify('en'));
    localStorage.setItem('mo:ai', JSON.stringify({ keys: { anthropic: 'key-A' }, models: { anthropic: 'claude-sonnet-5-5' }, use: { check: 'anthropic', quiz: 'anthropic', chat: 'claude-code' } }));
  });
  const p = await ctx.newPage();
  p.setDefaultTimeout(8000);
  const errors = []; p.on('pageerror', e => errors.push(e.message));
  const sent = [];
  await p.route(origin + '/api/ai', async r => {
    const b = JSON.parse(r.request().postData());
    sent.push({ task: b.task, provider: b.provider, model: b.model });
    if (b.task === 'questions') return r.fulfill({ json: { questions: [] } });
    return r.fulfill({ json: { summary: 'ok', issues: [] } });
  });
  let fails = 0;
  const step = async (name, fn) => { try { await fn(); console.log('PASS ' + name); } catch (e) { fails++; console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 8).join('\n  ')); } };
  try {
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.waitForFunction(() => window.app?.commands);
    await p.evaluate(() => import('/settings.js').then(m => m.openSettings('ai')));
    const row = f => p.locator(`.job-model[data-job-model="${f}"]`);
    const jbtn = f => p.locator(`[data-job-model-picker="${f}"]`);
    await row('check').waitFor({ state: 'attached' });

    await step('the row shows for API jobs only, and starts on the key box model', async () => {
      assert.equal(await row('check').isVisible(), true);
      assert.equal(await row('chat').isVisible(), false, 'chat uses Claude Code: no model row');
      assert.match(await jbtn('check').innerText(), /Default: claude-sonnet-5-5/);
      assert.equal(await p.locator('[data-model-picker="anthropic"]').count(), 1, 'only the key box has the provider picker');
    });

    await step('picking Haiku for Check only: the AI button and the request show it; Quiz keeps Sonnet', async () => {
      await jbtn('check').click();
      const opts = row('check').locator('.model-list [role=option]');
      assert.match(await opts.first().innerText(), /Default: claude-sonnet-5-5/);
      await opts.filter({ hasText: 'claude-haiku-5-5' }).click();
      assert.match(await jbtn('check').innerText(), /claude-haiku-5-5/);
      const ai = JSON.parse(await p.evaluate(() => localStorage.getItem('mo:ai')));
      assert.equal(ai.jobModels.check.anthropic, 'claude-haiku-5-5');
      assert.equal(ai.models.anthropic, 'claude-sonnet-5-5', 'the key box model is unchanged');
      const checkSetting = p.locator('.setting-item').filter({ has: row('check') });
      assert.match(await checkSetting.locator('.aip-btn').innerText(), /Haiku 5.5/);
      await p.evaluate(async () => { const AI = await import('/ai.js'); await AI.request('check', 'check', { title: 'x', content: 'y', path: 'Welcome.md' }); await AI.request('quiz', 'questions', { title: 'x', content: 'y', path: 'Welcome.md' }); });
      assert.deepEqual(sent.map(s => [s.task, s.model]), [['check', 'claude-haiku-5-5'], ['questions', 'claude-sonnet-5-5']]);
    });

    await step('switching Check to Claude Code hides the row; switching back keeps Haiku', async () => {
      const sel = p.locator('.setting-item').filter({ has: row('check') }).locator('select');
      await sel.selectOption('claude-code', { force: true });
      assert.equal(await row('check').isVisible(), false);
      await sel.selectOption('anthropic', { force: true });
      assert.match(await jbtn('check').innerText(), /claude-haiku-5-5/);
    });

    await step('"Default" clears the job model', async () => {
      await jbtn('check').click();
      await row('check').locator('.model-opt-inherit').click();
      assert.match(await jbtn('check').innerText(), /Default: claude-sonnet-5-5/);
      const ai = JSON.parse(await p.evaluate(() => localStorage.getItem('mo:ai')));
      assert.equal(ai.jobModels.check.anthropic, undefined);
    });
    if (errors.length) { fails++; console.log('FAIL page errors: ' + errors.join(' | ')); }
  } finally { await browser.close(); }
  console.log(fails ? `${fails} failed` : 'all passed');
  process.exit(fails ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
