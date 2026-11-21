// "Related notes" in the right sidebar (1.1.53): Canvas assignment notes and other records are never suggested,
// course boilerplate (作业, 截止时间, 要求, 提交, 不少…) is never a chip, and real notes still find each other.
//   node test/related-notes-ui.cjs
require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const repo = path.join(__dirname, '..');
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';

(async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-related-'));
  const put = async (rel, body) => { await fs.mkdir(path.dirname(path.join(vault, rel)), { recursive: true }); await fs.writeFile(path.join(vault, rel), body); };
  await put('Welcome.md', 'Welcome');
  // Canvas records: old style (no frontmatter) and new style (graph: hide).
  for (let i = 1; i <= 6; i++) await put(`形势与政策/作业 Homework/作业${i} (4286${i}).md`, `# 作业${i}\n\n截止时间：12月${i}日 23:59\n\n请大家及时提交作业，要求不少于800字，学习体会。\n\n[在 Canvas 查看](https://oc.sjtu.edu.cn/courses/98397/assignments/4286${i})\n`);
  await put('形势与政策/作业 Homework/期末作业提交 (440900).md', '---\ngraph: hide\n---\n# 期末作业提交\n\n截止时间：12月13日 23:59\n\n期末作业要求如下，请大家及时提交。论文，不少于800字。\n\n[在 Canvas 查看](https://oc.sjtu.edu.cn/courses/98397/assignments/440900)\n');
  // Real notes: two about eigenvalues, several unrelated, all with a bit of the same filler.
  await put('Linear Algebra/特征值.md', '# 特征值 Eigenvalue\n\n特征多项式 characteristic polynomial 的根就是特征值。对角化 diagonalization 需要足够多的特征向量 eigenvector。作业里用到。\n');
  await put('Linear Algebra/对角化.md', '# 对角化 Diagonalization\n\n矩阵可对角化当且仅当有 n 个线性无关的特征向量 eigenvector；特征多项式 characteristic polynomial 分解。\n');
  for (const [n, t] of [['Program Design/指针.md', '指针 pointer 指向内存地址，引用 reference 是别名。作业要求。'], ['Mathematical Analysis/极限.md', '数列极限 limit 的 epsilon 定义，柯西收敛准则 Cauchy。'],
    ['Program Design/类.md', '类 class 封装数据成员 member 与成员函数，构造函数 constructor。'], ['Theoretical Computer Science/图灵机.md', '图灵机 Turing machine 与可计算性 computability。'],
    ['English/演讲.md', 'Public speaking: structure, storytelling, audience.'], ['Mathematical Analysis/连续.md', '连续函数 continuous function 的介值定理 intermediate value theorem。']]) await put(n, t);

  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--disable-background-networking'] });
  let fails = 0;
  try {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    await ctx.route('**/*', r => (r.request().url().startsWith(origin + '/') ? r.continue() : r.abort()));
    await ctx.addInitScript(() => localStorage.setItem('mo:lang', JSON.stringify('zh-CN')));
    const p = await ctx.newPage();
    p.setDefaultTimeout(10000);
    await p.goto(origin, { waitUntil: 'domcontentloaded' });
    await p.locator('#tree [data-path="Welcome.md"]').waitFor();
    const related = async file => {
      await p.evaluate(f => window.app.workspace.openLinkText(f.replace(/\.md$/, ''), ''), file);
      await p.waitForFunction(f => document.querySelector('#topbar')?.textContent.includes(f.split('/').pop().replace('.md', '')), file);
      await p.waitForTimeout(400);
      return p.evaluate(() => [...document.querySelectorAll('#related .rel-row')].map(r => ({ name: r.querySelector('.bl-name span').textContent, words: [...r.querySelectorAll('.rel-words span')].map(s => s.textContent) })));
    };
    const step = async (name, fn) => { try { await fn(); console.log('PASS ' + name); } catch (e) { fails++; console.log('FAIL ' + name + '\n  ' + e.message.split('\n').slice(0, 6).join('\n  ')); } };
    await step('a Canvas assignment note suggests nothing (no 提交 / 作业 / 截止时间 chips)', async () => {
      assert.deepEqual(await related('形势与政策/作业 Homework/期末作业提交 (440900).md'), []);
      assert.deepEqual(await related('形势与政策/作业 Homework/作业1 (42861).md'), []);
    });
    await step('real notes still find each other, with specific shared words only', async () => {
      const rel = await related('Linear Algebra/特征值.md');
      assert.equal(rel[0]?.name, '对角化', JSON.stringify(rel));
      const boiler = /^(作业|提交|截止|截止时间|要求|不少|学习|请大家|及时)$/;
      for (const r of rel) for (const w of r.words) assert.doesNotMatch(w, boiler, JSON.stringify(rel));
      assert.ok(!rel.some(r => /作业\d/.test(r.name)), 'no Canvas notes among the suggestions');
    });
  } finally { await browser.close(); }
  console.log(fails ? fails + ' failed' : 'all passed');
  process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
