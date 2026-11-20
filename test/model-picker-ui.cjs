// Settings → AI, an API provider's model, in a real browser with simulated providers (no real keys, nothing sent
// out): a provider with 66 made-up models (A) and one that answers with an empty list (B). Checks the picker opens
// on the whole list (it scrolls), its own search, ↑/↓/Enter, Esc back to the button, "Custom model…", that the
// chosen model is saved and shown again after reopening; that the list stays under its own provider (narrow,
// scrolled, zoomed, next to another provider); and that a list belongs to the key and address it was read with
// (changing them hides it at once, a late answer is ignored, an empty answer empties it, providers never share).
//   node test/model-picker-ui.cjs [filter]
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
const SIXTY_SIX = Array.from({ length: 66 }, (_, i) => `fable-model-${String(i + 1).padStart(2, '0')}`);

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-models-'));
  await fs.writeFile(path.join(vault, 'Welcome.md'), 'Welcome');
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  async function page({ lang = 'en', width = 1300, height = 900, scale = 1, keys = { gemini: 'key-A', openai: 'key-O' }, baseUrl = '' } = {}) {
    const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: scale });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(({ lang, keys, baseUrl }) => {
      if (sessionStorage.getItem('seeded')) return;      // a reload keeps what the page saved
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('mo:lang', JSON.stringify(lang));
      localStorage.setItem('mo:ai', JSON.stringify({ keys, models: {}, baseUrl, use: { check: 'off', chat: 'off' } }));
    }, { lang, keys, baseUrl });
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    const errors = []; p.on('pageerror', e => errors.push(e.message)); p.__errors = errors;
    p.__tests = [];
    // Simulated providers: A (key-A or address https://a.example/v1) lists 66 models; B (key-B or https://b.example/v1)
    // answers with an empty list; key-O lists two other models. A "slow-" key answers after 700 ms.
    await p.route(origin + '/api/ai', async r => {
      const b = JSON.parse(r.request().postData()), key = r.request().headers()['x-ai-key'] || '';
      if (b.task !== 'test') return r.fulfill({ json: {} });
      p.__tests.push({ provider: b.provider, key, baseUrl: b.baseUrl });
      if (key.startsWith('slow-')) await sleep(700);
      const who = b.provider === 'custom' ? b.baseUrl : key.replace(/^slow-/, '');
      const models = /key-A|a\.example/.test(who) ? SIXTY_SIX : /key-O/.test(who) ? ['other-1', 'other-2'] : [];
      return r.fulfill({ json: { ok: true, models } });
    });
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor({ state: 'attached' });
    await p.waitForFunction(() => window.app?.commands);
    return p;
  }
  async function test(name, fn, opts) {
    if (filter && !filter.test(name)) return;
    let p;
    try { p = await page(opts); await fn(p); if (p.__errors.length) throw new Error('page errors: ' + p.__errors.join(' | ')); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { results.push({ name, pass: false }); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 10).join('\n  ')); }
    finally { await p?.context().close(); }
  }
  const openAI = async p => { await p.evaluate(() => import('/settings.js').then(m => m.openSettings('ai'))); await p.locator('[data-model-picker]').first().waitFor({ state: 'attached' }); };
  const box = (p, provider) => p.locator('details.ai-provider').filter({ has: p.locator(`[data-model-picker="${provider}"]`) });
  const btn = (p, provider) => p.locator(`[data-model-picker="${provider}"]`);
  const options = (p, provider) => box(p, provider).locator('.model-list [role=option]');
  async function testKey(p, provider) {
    const b = box(p, provider);
    if (!(await b.evaluate(d => d.open))) await b.locator('summary').click();
    const before = p.__tests.length;
    const label = await p.evaluate(() => import('/i18n.js').then(m => m.t('ai.test')));
    await b.getByRole('button', { name: label, exact: true }).click();
    for (let i = 0; i < 50 && p.__tests.length === before; i++) await sleep(50);
  }
  const listed = async (p, provider) => (await options(p, provider).allInnerTexts()).map(s => s.trim());

  await test('66 models: the whole list opens at once and scrolls; search finds a later one; Enter picks it; saved and shown after reopening', async p => {
    await openAI(p);
    await testKey(p, 'gemini');
    await p.waitForFunction(() => /66/.test(document.querySelector('details.ai-provider [data-model-picker="gemini"]')?.closest('details')?.innerText || ''));
    await btn(p, 'gemini').click();
    const all = await listed(p, 'gemini');
    assert.equal(all.length, 67, 'all 66 and "Custom model…"');
    assert.equal(all[66], 'Custom model…');
    const scroll = await box(p, 'gemini').locator('.model-list').evaluate(l => l.scrollHeight > l.clientHeight && getComputedStyle(l).overflowY === 'auto');
    assert.ok(scroll, 'the list scrolls');
    await p.keyboard.type('model-37');
    assert.deepEqual(await listed(p, 'gemini'), ['fable-model-37', 'Custom model…']);
    await p.keyboard.press('Enter');
    assert.match(await btn(p, 'gemini').innerText(), /fable-model-37/);
    assert.equal(await p.evaluate(() => document.activeElement?.dataset.modelPicker), 'gemini', 'focus back on the button');
    // Opening again after a search: the whole list again, the chosen one marked.
    await btn(p, 'gemini').click();
    assert.equal((await listed(p, 'gemini')).length, 67);
    assert.equal(await box(p, 'gemini').locator('[role=option][aria-selected=true]').innerText(), 'fable-model-37');
    await p.keyboard.press('Escape');
    await p.reload(); await p.waitForFunction(() => window.app?.commands);
    await openAI(p);
    assert.match(await btn(p, 'gemini').innerText(), /fable-model-37/);
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('mo:ai')).models.gemini), 'fable-model-37');
  });

  await test('keyboard: ↓ opens, ↓↓ + Enter picks the third, Esc closes the list only (Settings stays) and the focus returns', async p => {
    await openAI(p);
    await testKey(p, 'gemini');
    await p.waitForFunction(() => /66/.test(document.querySelector('[data-model-picker="gemini"]')?.closest('details')?.innerText || ''));
    await btn(p, 'gemini').focus();
    await p.keyboard.press('ArrowDown');
    await box(p, 'gemini').locator('.model-search').waitFor();
    const start = await box(p, 'gemini').locator('[role=option].is-active').innerText();
    await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
    const third = await box(p, 'gemini').locator('[role=option].is-active').innerText();
    assert.notEqual(third, start);
    assert.equal(await box(p, 'gemini').locator('.model-search').getAttribute('aria-activedescendant'), await box(p, 'gemini').locator('[role=option].is-active').getAttribute('id'));
    await p.keyboard.press('Enter');
    assert.equal((await btn(p, 'gemini').innerText()).trim(), third.trim());
    await btn(p, 'gemini').click();
    await p.keyboard.press('Escape');
    assert.equal(await btn(p, 'gemini').getAttribute('aria-expanded'), 'false');
    assert.equal(await p.locator('.settings-modal:not(.hidden)').count(), 1, 'Settings is still open');
    assert.equal(await p.evaluate(() => document.activeElement?.dataset.modelPicker), 'gemini');
  });

  await test('"Custom model…" lets you type a name that is not listed; it is saved', async p => {
    await openAI(p);
    await testKey(p, 'gemini');
    await btn(p, 'gemini').click();
    await box(p, 'gemini').locator('.model-opt-custom').click();
    const input = box(p, 'gemini').locator('.model-custom');
    await input.fill('my-own-model'); await input.press('Enter');
    assert.match(await btn(p, 'gemini').innerText(), /my-own-model/);
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('mo:ai')).models.gemini), 'my-own-model');
  });

  for (const [label, opts, prep] of [
    ['next to another provider', {}, null],
    ['narrow window', { width: 480 }, null],
    ['settings scrolled', {}, async p => { await p.locator('.settings-content').evaluate(c => { c.scrollTop = 120; }); }],
    ['zoomed 175%', { width: 743, height: 514, scale: 1.75 }, null],
  ]) {
    await test(`the list stays right under its own provider's button (${label}) and never shows the other provider's models`, async p => {
      await openAI(p);
      for (const pr of ['openai', 'gemini']) { await testKey(p, pr); }
      await p.waitForFunction(() => /66/.test(document.querySelector('[data-model-picker="gemini"]')?.closest('details')?.innerText || ''));
      if (prep) await prep(p);
      await btn(p, 'gemini').scrollIntoViewIfNeeded();
      await btn(p, 'gemini').click();
      const b = await btn(p, 'gemini').boundingBox(), pop = await box(p, 'gemini').locator('.model-pop').boundingBox();
      assert.ok(Math.abs(pop.y - (b.y + b.height)) < 12, JSON.stringify({ b, pop }));
      assert.ok(Math.abs(pop.x - b.x) < 2, 'left edges line up');
      const g = await listed(p, 'gemini');
      assert.ok(g.includes('fable-model-01') && !g.includes('other-1'));
      await p.keyboard.press('Escape');
      await btn(p, 'openai').click();
      const o = await listed(p, 'openai');
      assert.deepEqual(o, ['other-1', 'other-2', 'Custom model…'], 'each provider its own list');
    }, opts);
  }

  await test('another key hides the old list at once; an empty answer empties it (only "Custom model…" stays); a late answer for the old key is ignored', async p => {
    await openAI(p);
    await testKey(p, 'gemini');
    await p.waitForFunction(() => /66/.test(document.querySelector('[data-model-picker="gemini"]')?.closest('details')?.innerText || ''));
    const keyBox = box(p, 'gemini').locator('input[type=password]');
    // A slow check with the old key, then a new key checked quickly: the slow answer (66 models) comes last.
    await keyBox.fill('slow-key-A'); await keyBox.dispatchEvent('change');
    await box(p, 'gemini').getByRole('button', { name: 'Test' }).click();
    await sleep(50);
    await keyBox.fill('key-B'); await keyBox.press('Tab');
    await btn(p, 'gemini').click();
    assert.deepEqual(await listed(p, 'gemini'), ['Custom model…'], 'the old list is gone as soon as the key changes');
    await p.keyboard.press('Escape');
    await box(p, 'gemini').getByRole('button', { name: 'Test' }).click();
    await sleep(1200);                                     // the slow answer for the old key has arrived by now
    await btn(p, 'gemini').click();
    assert.deepEqual(await listed(p, 'gemini'), ['Custom model…']);
    assert.match(await box(p, 'gemini').locator('.model-none').innerText(), /listed no models/);
    const stored = await p.evaluate(() => JSON.parse(localStorage.getItem('mo:ai')));
    assert.ok(!JSON.stringify(stored.lists).includes('key-B') && !JSON.stringify(stored.lists).includes('key-A'), 'no key kept with the list');
  });

  await test('custom address: switching from A (66) to B hides A\'s list; B\'s empty answer leaves only "Custom model…"; back to A needs a new check', async p => {
    await openAI(p);
    const cbox = box(p, 'custom');
    if (!(await cbox.evaluate(d => d.open))) await cbox.locator('summary').click();
    const url = cbox.locator('input[placeholder^="https://"]');
    await url.fill('https://a.example/v1'); await url.press('Tab');
    await testKey(p, 'custom');
    await p.waitForFunction(() => /66/.test(document.querySelector('[data-model-picker="custom"]')?.closest('details')?.innerText || ''));
    await btn(p, 'custom').click();
    assert.equal((await listed(p, 'custom')).length, 67);
    await p.keyboard.press('Escape');
    await url.fill('https://b.example/v1'); await url.press('Tab');
    await btn(p, 'custom').click();
    assert.deepEqual(await listed(p, 'custom'), ['Custom model…'], 'A\'s list is not shown for B');
    await p.keyboard.press('Escape');
    await testKey(p, 'custom'); await sleep(300);
    await btn(p, 'custom').click();
    assert.deepEqual(await listed(p, 'custom'), ['Custom model…']);
    await p.keyboard.press('Escape');
    await url.fill('https://a.example/v1'); await url.press('Tab');
    await btn(p, 'custom').click();
    assert.deepEqual(await listed(p, 'custom'), ['Custom model…'], 'checked again before A\'s models show');
  }, { keys: { gemini: 'key-A' } });

  await test('the status line follows the newest check only: an old answer arriving late (success or failure) never shows; changing the key clears it', async p => {
    await openAI(p);
    const gbox = box(p, 'gemini'), keyBox = gbox.locator('input[type=password]'), status = gbox.locator('p.setting-note').first();
    await keyBox.fill('slow-key-A'); await keyBox.press('Tab');
    await gbox.getByRole('button', { name: 'Test' }).click();
    await sleep(50);
    await keyBox.fill('key-O'); await keyBox.press('Tab');
    assert.doesNotMatch(await status.innerText(), /66/, 'the old key\'s status is gone when the key changed');
    await gbox.getByRole('button', { name: 'Test' }).click();
    await p.waitForFunction(() => /2/.test([...document.querySelectorAll('[data-model-picker="gemini"]')][0].closest('details').querySelector('p.setting-note')?.textContent || ''));
    await sleep(1000);                                  // the old check (66 models) has answered by now
    assert.match(await status.innerText(), / 2 models/); assert.doesNotMatch(await status.innerText(), /66/);
    // A late failure of an older check doesn't show either.
    await p.route(origin + '/api/ai', async r => { const k = r.request().headers()['x-ai-key']; if (k === 'slow-bad') { await sleep(700); return r.fulfill({ status: 500, json: { error: 'OLD FAILURE' } }); } return r.fallback(); });
    await keyBox.fill('slow-bad'); await keyBox.press('Tab');
    await gbox.getByRole('button', { name: 'Test' }).click();
    await sleep(50);
    await keyBox.fill('key-O'); await keyBox.press('Tab');
    await gbox.getByRole('button', { name: 'Test' }).click();
    await sleep(1100);
    assert.doesNotMatch(await status.innerText(), /OLD FAILURE/);
  });

  await test('"Custom model…": Esc drops what was typed and keeps the model chosen before; Enter (or "Use this name") saves it', async p => {
    await openAI(p);
    await testKey(p, 'gemini');
    await btn(p, 'gemini').click(); await p.keyboard.type('model-33'); await p.keyboard.press('Enter');
    await btn(p, 'gemini').click();
    await box(p, 'gemini').locator('.model-opt-custom').click();
    await box(p, 'gemini').locator('.model-custom').fill('temporary-name');
    await box(p, 'gemini').locator('.model-custom').press('Escape');
    assert.match(await btn(p, 'gemini').innerText(), /fable-model-33/);
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('mo:ai')).models.gemini), 'fable-model-33');
    assert.equal(await p.locator('.settings-modal:not(.hidden)').count(), 1, 'Settings stays open');
    await btn(p, 'gemini').click();
    await box(p, 'gemini').locator('.model-opt-custom').click();
    await box(p, 'gemini').locator('.model-custom').fill('chosen-name');
    await box(p, 'gemini').locator('.model-custom-use').click();
    assert.equal(await p.evaluate(() => JSON.parse(localStorage.getItem('mo:ai')).models.gemini), 'chosen-name');
  });

  await test('Chinese labels are readable', async p => {
    await openAI(p);
    await testKey(p, 'gemini');
    await btn(p, 'gemini').click();
    assert.equal(await box(p, 'gemini').locator('.model-search').getAttribute('placeholder'), '搜索模型');
    assert.equal((await listed(p, 'gemini')).at(-1), '自定义模型…');
  }, { lang: 'zh-CN' });

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
