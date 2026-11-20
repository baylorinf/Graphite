// Settings switches without a mouse, in a real browser with a new temporary vault: the bundled Capture switch
// and a made-up community plugin's switch are reachable with Tab, have a name, the switch role and their state,
// flip with Space or Enter, show where the focus is, report and respect "unavailable", keep working with the
// mouse and the plugin API, and their state is saved (reopening shows it). English and Chinese.
//   node test/settings-switch-ui.cjs [filter]
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

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-switch-'));
  await fs.writeFile(path.join(vault, 'Welcome.md'), 'Welcome');
  await fs.writeFile(path.join(vault, 'Claude Inbox.md'), '# Claude Inbox\n\n- [ ] **Interesting** · 2026-11-01 %%cap-1%%\n    > kept capture\n');
  const demo = path.join(vault, '.obsidian/plugins/demo-sample');
  await fs.mkdir(demo, { recursive: true });
  await fs.writeFile(path.join(demo, 'manifest.json'), JSON.stringify({ id: 'demo-sample', name: 'Demo Sample', version: '0.1.0', description: 'A made-up plugin for this test.' }));
  await fs.writeFile(path.join(demo, 'main.js'), "const { Plugin } = require('obsidian'); module.exports = class extends Plugin { onload() { window.__demoLoaded = (window.__demoLoaded || 0) + 1; } onunload() { window.__demoUnloaded = (window.__demoUnloaded || 0) + 1; } };");
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const enabledList = async () => JSON.parse(await fs.readFile(path.join(vault, '.obsidian/community-plugins.json'), 'utf8'));
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  async function page({ lang = 'en' } = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(lang => localStorage.setItem('mo:lang', JSON.stringify(lang)), lang);
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    p.on('dialog', d => d.accept());
    const errors = []; p.on('pageerror', e => errors.push(e.message)); p.__errors = errors;
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor({ state: 'attached' });
    await p.waitForFunction(() => window.app?.plugins?.getPlugin?.('claude-capture'));
    return p;
  }
  async function test(name, fn, opts) {
    if (filter && !filter.test(name)) return;
    let p;
    try { p = await page(opts); await fn(p); if (p.__errors.length) throw new Error('page errors: ' + p.__errors.join(' | ')); results.push({ name, pass: true }); console.log('PASS ' + name); }
    catch (e) { results.push({ name, pass: false }); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 10).join('\n  ')); }
    finally { await p?.context().close(); }
  }
  const openPlugins = async p => { await p.evaluate(() => import('/settings.js').then(m => m.openSettings('plugins'))); await p.getByRole('switch').first().waitFor(); };
  const switchFor = (p, name) => p.getByRole('switch', { name });
  // Tab from the start of the Settings window until this switch has the focus (as a keyboard user would).
  async function tabTo(p, name) {
    // Start inside the Settings window, at its first control.
    await p.evaluate(() => document.querySelector('.settings-nav-item.active')?.focus());
    for (let i = 0; i < 120; i++) {
      await p.keyboard.press('Tab');
      const hit = await p.evaluate(n => { const a = document.activeElement; if (a?.getAttribute('role') !== 'switch') return false; const id = a.getAttribute('aria-labelledby'); return (document.getElementById(id)?.textContent || a.getAttribute('aria-label') || '').includes(n); }, name);
      if (hit) return i + 1;
    }
    throw new Error('Tab never reached the switch for ' + name);
  }

  await test('the bundled Capture switch: Tab reaches it, it has a name, the switch role and its state; focus is visible; Space turns the plugin off (data kept) and on', async p => {
    await openPlugins(p);
    const sw = switchFor(p, /Graphite Capture/);
    assert.equal(await sw.getAttribute('aria-checked'), 'true');
    await tabTo(p, 'Graphite Capture');
    const ring = await p.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
    assert.notEqual(ring, 'none', 'a visible focus ring');
    await p.keyboard.press('Space');
    await p.waitForFunction(() => !window.app.plugins.enabledPlugins?.has?.('claude-capture') || !window.app.plugins.getPlugin('claude-capture'));
    await p.waitForFunction(() => document.querySelector('[role=switch][aria-checked="false"]'));
    assert.equal((await enabledList()).includes('claude-capture'), false);
    assert.match(await fs.readFile(path.join(vault, 'Claude Inbox.md'), 'utf8'), /kept capture/, 'its data stays');
    await tabTo(p, 'Graphite Capture');
    await p.keyboard.press('Enter');
    await p.waitForFunction(() => window.app.plugins.getPlugin('claude-capture'));
    assert.equal((await enabledList()).includes('claude-capture'), true);
  });

  await test('a made-up community plugin: keyboard on, saved, and after reopening the switch shows it on; the mouse still works', async p => {
    await openPlugins(p);
    const on = p.locator('.settings-box button', { hasText: 'Turn on community plugins' });
    if (await on.count()) { await on.click(); await sleep(300); const ok = p.locator('.modal button.mod-cta, .settings-box button.mod-cta').first(); if (await ok.count() && /turn on|yes|continue/i.test(await ok.innerText())) await ok.click(); }
    const sw = switchFor(p, /Demo Sample/);
    await sw.waitFor();
    const was = await sw.getAttribute('aria-checked');
    await tabTo(p, 'Demo Sample');
    await p.keyboard.press('Space');
    await p.waitForFunction(w => document.querySelector('[role=switch][aria-labelledby]') && [...document.querySelectorAll('[role=switch]')].some(s => document.getElementById(s.getAttribute('aria-labelledby'))?.textContent.includes('Demo Sample') && s.getAttribute('aria-checked') !== w), was);
    const now = was === 'true' ? 'false' : 'true';
    for (let i = 0; i < 30 && (await enabledList()).includes('demo-sample') !== (now === 'true'); i++) await sleep(100);
    assert.equal((await enabledList()).includes('demo-sample'), now === 'true', JSON.stringify({ now, list: await enabledList(), modal: await p.locator('.plugin-modal, .modal-container').allInnerTexts() }));
    await p.reload(); await p.waitForFunction(() => window.app?.plugins?.getPlugin?.('claude-capture'));
    await openPlugins(p);
    assert.equal(await switchFor(p, /Demo Sample/).getAttribute('aria-checked'), now);
    await switchFor(p, /Demo Sample/).click();                       // and back with the mouse
    await p.waitForFunction(w => [...document.querySelectorAll('[role=switch]')].some(s => document.getElementById(s.getAttribute('aria-labelledby'))?.textContent.includes('Demo Sample') && s.getAttribute('aria-checked') === w), was);
  });

  await test('the plugin API: setValue, onChange, setDisabled (announced, and Space does nothing), setTooltip, onClick', async p => {
    const r = await p.evaluate(async () => {
      const PM = await import('/plugins.js');
      const host = document.body.appendChild(document.createElement('div'));
      const changes = [];
      let tg;
      new PM.Setting(host).addToggle(x => { tg = x; x.setValue(true).onChange(v => changes.push(v)); }).setName('Sample switch').setDesc('What it does');
      const el = tg.toggleEl;
      const out = { role: el.getAttribute('role'), tab: el.tabIndex, checked: el.getAttribute('aria-checked'), name: document.getElementById(el.getAttribute('aria-labelledby')).textContent, desc: document.getElementById(el.getAttribute('aria-describedby')).textContent };
      el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
      out.afterSpace = [tg.getValue(), el.getAttribute('aria-checked'), changes.join()];
      tg.setDisabled(true);
      el.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); el.click();
      out.disabled = [el.getAttribute('aria-disabled'), tg.getValue(), changes.length];
      tg.setDisabled(false); tg.onClick();
      out.onClick = [tg.getValue(), changes.join()];
      const lone = new PM.ToggleComponent(host); lone.setTooltip('Lonely switch');
      out.tooltipName = lone.toggleEl.getAttribute('aria-label');
      host.remove();
      return out;
    });
    assert.deepEqual(r, { role: 'switch', tab: 0, checked: 'true', name: 'Sample switch', desc: 'What it does', afterSpace: [false, 'false', 'false'], disabled: ['true', false, 1], onClick: [true, 'false,true'], tooltipName: 'Lonely switch' });
  });

  await test('Chinese: the switches have readable Chinese names and states are announced', async p => {
    await openPlugins(p);
    const names = await p.evaluate(() => [...document.querySelectorAll('[role=switch]')].map(s => ({ name: (document.getElementById(s.getAttribute('aria-labelledby'))?.textContent || '').trim(), checked: s.getAttribute('aria-checked') })));
    assert.ok(names.length >= 3, JSON.stringify(names));
    for (const n of names) { assert.ok(n.name.length > 0, 'every switch has a name'); assert.ok(['true', 'false'].includes(n.checked)); }
    assert.ok(names.some(n => /[\u4e00-\u9fff]/.test(n.name)), 'Chinese labels: ' + JSON.stringify(names));
    await tabTo(p, names.find(n => /[\u4e00-\u9fff]/.test(n.name)).name);
  }, { lang: 'zh-CN' });

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(1); });
