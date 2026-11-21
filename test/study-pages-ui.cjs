// The 🎓 study pages in a new, empty vault (made up for this test): with no study page yet, the hint says how to
// open the first one, in the window's language (Chinese and English); after an .html page is added, 🎓 opens it.
//   node test/study-pages-ui.cjs
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const repo = path.join(__dirname, '..');
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-studypages-'));
  await fs.writeFile(path.join(vault, 'Welcome.md'), '# Welcome\n');
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  const results = [];
  async function test(name, lang, fn) {
    const ctx = await browser.newContext({ viewport: { width: 1300, height: 860 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(l => localStorage.setItem('mo:lang', JSON.stringify(l)), lang);
    const p = await ctx.newPage();
    p.setDefaultTimeout(8000);
    const errors = []; p.on('pageerror', e => errors.push(e.message));
    try {
      await p.goto(origin, { waitUntil: 'domcontentloaded' });
      await p.waitForFunction(() => window.app?.plugins?.getPlugin?.('claude-quizzes'));
      await fn(p);
      if (errors.length) throw new Error('page errors: ' + errors.join(' | '));
      results.push(true); console.log('PASS ' + name);
    } catch (e) { results.push(false); console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 6).join('\n  ')); }
    finally { await ctx.close(); }
  }
  const press = p => p.evaluate(() => window.app.plugins.getPlugin('claude-quizzes').ribbon());
  const notice = p => p.locator('.notice').last().innerText();

  await test('empty vault, Chinese: the hint is in Chinese and says how to open the first page', 'zh-CN', async p => {
    await press(p);
    const text = await notice(p);
    assert.match(text, /还没有学习页。要打开第一份，请把一个 \.html 学习页加入笔记库/);
    assert.doesNotMatch(text, /No study pages yet/);
  });
  await test('empty vault, English', 'en', async p => {
    await press(p);
    assert.match(await notice(p), /No study pages yet\. To open your first one, add an \.html study page to your vault/);
  });
  await fs.mkdir(path.join(vault, 'Study Pages'), { recursive: true });
  await fs.writeFile(path.join(vault, 'Study Pages', 'Week 1.html'), '<!doctype html><title>Week 1</title><h1>STUDY_PAGE_WEEK_1</h1>');
  await test('after adding an .html page, 🎓 opens it as a study tab', 'zh-CN', async p => {
    await p.locator('#tree [data-path="Study Pages"]').waitFor({ state: 'attached' });
    await press(p);
    await p.waitForFunction(() => [...document.querySelectorAll('.cq-view iframe')].some(f => /STUDY_PAGE_WEEK_1/.test(f.contentDocument?.body?.textContent || '')), null, { timeout: 10000 });
  });

  await browser.close();
  await fs.rm(vault, { recursive: true, force: true }).catch(() => {});
  console.log(`\n${results.filter(Boolean).length}/${results.length} passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
main().catch(e => { console.error(e); process.exit(1); });
