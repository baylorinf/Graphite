// End-to-end source editing checks in a disposable vault. Runs headless and never invokes a compiler or interpreter.
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
// node test/source-editor.cjs [path to Graphite's unpacked app]
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE, '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const project = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const chrome = process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-code-editor-'));
  const file = name => path.join(vault, name);
  const cpp = 'C++/向量.cpp', python = 'Week 1/exercise.py', sameName = 'Week 2/exercise.py';
  const cppText = [
    '#include <iostream>', '#include <vector>', '',
    '// 练习：求两个等长向量的点积',
    'int dotProduct(const std::vector<int>& a, const std::vector<int>& b) {',
    '    int sum = 0;', '    for (std::size_t i = 0; i < a.size(); ++i) {',
    '        sum += a[i] * b[i];', '    }', '    return sum;', '}', '', 'int main() {',
    '    std::cout << dotProduct({1, 2}, {3, 4}) << "\\n";', '}', ''
  ].join('\n');
  const winBytes = text => Buffer.from('\uFEFF' + text.replaceAll('\n', '\r\n'));
  // A harmless canary: if anything were to run this file, we could observe it without relying on logging.
  const pyText = "from pathlib import Path\nPath(__file__).with_suffix('.ran').write_text('ran')\n\ndef grade():\n";
  const secondText = '# week 2\nanswer = 2\n';
  const legacyBytes = Buffer.from([0x23, 0x20, 0xc3, 0x28, 0xa0, 0x0a]);
  const mixedBytes = Buffer.from('def first():\r\n    return 1\ndef second():\r\n    return 2\n');
  const files = {
    'Welcome.md': '# Welcome', [cpp]: winBytes(cppText), [python]: pyText, [sameName]: secondText,
    'Old/legacy.py': legacyBytes, 'Old/mixed.py': mixedBytes, 'Conflicts/task.py': winBytes('# original\n'), 'Conflicts/slow.py': '# base\n'
  };
  for (const [name, contents] of Object.entries(files)) {
    await fs.mkdir(path.dirname(file(name)), {recursive:true}); await fs.writeFile(file(name), contents);
  }
  const origin = 'http://127.0.0.1:' + await require(path.join(project, 'server.js')).start({vault});
  let browser, ctx, page, beforeRequest;
  async function launch(storageState) {
    browser = await chromium.launch({headless:true, executablePath:chrome, args:['--disable-background-networking']});
    ctx = await browser.newContext({storageState, locale:'zh-CN', viewport:{width:1450,height:850}});
    await ctx.addInitScript(()=>{
      localStorage.setItem('mo:lang', '"zh-CN"');
      // Isolate the clipboard so copying a source citation cannot replace the user's clipboard contents.
      Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.testSourceLink=text;}}});
    });
    await ctx.route('**/*', async route => {
      const u = route.request().url();
      if (beforeRequest) await beforeRequest(route.request());
      return u.startsWith(origin+'/') && !u.startsWith(origin+'/api/events') ? route.continue() : route.abort();
    });
    page = await ctx.newPage(); page.setDefaultTimeout(11000);
    page.on('dialog', dialog=>dialog.accept(dialog.defaultValue()));
    await page.goto(origin, {waitUntil:'domcontentloaded'}); await page.locator('#tree [data-path="Welcome.md"]').waitFor();
  }
  const source = () => page.locator('#code-editor .CodeMirror');
  const content = () => source().evaluate(el => el.CodeMirror.getValue());
  const focus = async () => { await source().locator('.CodeMirror-code').click(); };
  async function open(name, expected) {
    await page.locator('#tree [data-path='+JSON.stringify(name)+']').click();
    if (expected !== undefined) {
      await page.waitForFunction(value => document.querySelector('#code-editor .CodeMirror')?.CodeMirror?.getValue() === value, expected);
      await source().waitFor({state:'visible'});
    }
  }
  async function diskEquals(name, expected) {
    const bytes = Buffer.isBuffer(expected) ? expected : Buffer.from(expected);
    for (let i = 0; i < 70; i++) {
      const data = await fs.readFile(file(name)).catch(()=>null); if (data && bytes.equals(data)) return;
      await sleep(100);
    }
    assert.deepEqual(await fs.readFile(file(name)), bytes, name+' on disk');
  }
  async function restart() {
    await page.goto('about:blank'); // dispatch the same beforeunload that persists outstanding editor drafts
    const storage = await ctx.storageState(); await browser.close(); await launch(storage);
  }
  const passed = [];
  const pass = label => {passed.push(label);console.log('PASS '+label);};
  try {
    await launch();
    await open(cpp, cppText); await focus(); await page.keyboard.press('Control+Home'); await page.keyboard.press('End');
    await page.keyboard.insertText(' // 向量课程'); await page.locator('#code-save').click();
    const cppChanged = cppText.replace('<iostream>','<iostream> // 向量课程');
    await diskEquals(cpp,winBytes(cppChanged));
    assert.ok(await source().locator('.CodeMirror-linenumber').count() >= 12, 'C++ line numbers');
    assert.ok(await source().locator('.cm-keyword,.cm-type').count() >= 2, 'C++ syntax highlighting');
    if (process.env.GRAPHITE_SOURCE_SCREENSHOT) {
      await source().locator('.CodeMirror-line').filter({hasText:'sum += a[i]'}).click();
      await page.evaluate(()=>document.fonts.ready);
      await page.screenshot({path:process.env.GRAPHITE_SOURCE_SCREENSHOT});
    }
    pass('C++ file tree, Chinese editing and explicit Save preserve CRLF and UTF-8 BOM');

    await focus(); await page.keyboard.press('Control+Home'); await page.keyboard.press('Control+f');
    const find = page.locator('#code-find-text'); await find.fill('sum');
    const hit = () => source().evaluate(el=>({text:el.CodeMirror.getSelection(),line:el.CodeMirror.getCursor('from').line}));
    const hits = [await hit()];
    for (let i=0;i<3;i++) {await find.press('Enter');hits.push(await hit());}
    assert.equal(new Set(hits.slice(0,3).map(h=>h.line)).size,3);
    assert.ok(hits.every(h=>h.text==='sum')); assert.deepEqual(hits[0],hits[3]);
    await find.press('Shift+Enter'); assert.deepEqual(await hit(),hits[2]);
    await find.fill('向量'); assert.equal((await hit()).text,'向量');
    await find.fill('无此标记1234'); assert.match(await page.locator('#code-find-result').innerText(),/没有|无匹配|未找到/);
    await find.press('Escape'); assert.ok(await find.isHidden()); assert.ok(await source().evaluate(el=>el.CodeMirror.hasFocus()));
    await diskEquals(cpp,winBytes(cppChanged));
    pass('Find in source: Chinese and repeated symbols, next/previous, wrap and Escape restores editor focus');

    await open(python,pyText); await focus(); await page.keyboard.press('Control+End'); await page.keyboard.press('Tab');
    assert.equal(await content(),pyText+'    ');
    await page.keyboard.press('Shift+Tab'); assert.equal(await content(),pyText);
    await page.keyboard.press('Tab');
    await page.keyboard.insertText('return "得分"');
    const pyChanged = pyText + '    return "得分"';
    assert.equal(await content(),pyChanged,'Tab indents Python four columns without moving keyboard focus');
    await page.keyboard.press('Control+s'); await diskEquals(python,pyChanged);
    await open(sameName,secondText); await focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('# 第二周');
    await open(python,pyChanged); await open(sameName,secondText+'# 第二周');
    await focus(); await page.keyboard.press('Control+s'); await diskEquals(sameName,secondText+'# 第二周');
    await diskEquals(python,pyChanged);
    pass('Python Tab, shortcut save and same-named source files remain independent');

    await restart(); await open(cpp,cppChanged); await open(python,pyChanged); await open(sameName,secondText+'# 第二周');
    pass('Closed and reopened browser reads all three edited files');

    await page.locator('#tree [data-path='+JSON.stringify(sameName)+']').dblclick();
    const sameTab=page.locator('#tabbar .tab[title='+JSON.stringify(sameName)+']');
    await sameTab.waitFor();
    await source().locator('.CodeMirror-line').filter({hasText:'answer = 2'}).click();
    await page.locator('#code-link').click();
    const citation = await page.evaluate(()=>window.testSourceLink);
    assert.match(citation,/Week 2\/exercise\.py#L2[|\]]/);
    await open('Welcome.md'); await page.locator('#editor').fill('# My solution\n\n'+citation+'\n');
    await page.locator('#editor').press('Control+s');
    const follow = async modifiers => {
      await page.locator('#preview a.internal-link').filter({hasText:'exercise.py L2'}).click({modifiers});
      await page.waitForFunction(text=>{const cm=document.querySelector('#code-editor .CodeMirror')?.CodeMirror;return cm?.getValue()===text && cm.getCursor().line===1;},secondText+'# 第二周');
    };
    assert.equal(await sameTab.count(),1); await follow(['Control']);
    await open('Welcome.md'); await sameTab.locator('[data-close]').click();
    assert.equal(await sameTab.count(),0); await follow([]);
    pass('Source line citation reaches the correct duplicate filename and line, whether its tab is open or closed');

    for (const [name,bytes,why] of [['Old/legacy.py',legacyBytes,/UTF-?8|编码/i],['Old/mixed.py',mixedBytes,/换行|行尾|CRLF|mixed/i]]) {
      await open(name); const readonly = page.locator('#code-readonly'); await readonly.waitFor({state:'visible'});
      assert.match(await readonly.innerText(),why);
      assert.ok(await page.locator('#code-save').isDisabled() || await page.locator('#code-save').isHidden());
      await page.keyboard.press('Control+s'); await diskEquals(name,bytes);
    }
    pass('Invalid UTF-8 and mixed line endings show a read-only reason and retain every byte');

    const created = '练习-新建.py'; await page.locator('#code-new').click();
    const nameInput = page.locator('#modal-input'); await nameInput.fill(created); await nameInput.press('Enter');
    await source().waitFor({state:'visible'}); await focus(); await page.keyboard.press('Control+a'); await page.keyboard.insertText('# 新练习\n');
    await page.keyboard.press('Control+s');
    const newFile = page.locator('#tree .file[data-path$='+JSON.stringify(created)+']'); await newFile.waitFor();
    const newPath = await newFile.getAttribute('data-path'); await diskEquals(newPath,'# 新练习\n');
    pass('Create a new Python file through the application and save source');

    const target = 'Conflicts/task.py', own = '# original\n# my draft', external = '# another editor saved this\n';
    await open(target,'# original\n'); await focus(); await page.keyboard.press('Control+End'); await page.keyboard.insertText('# my draft');
    await fs.writeFile(file(target),winBytes(external));
    const conflict = page.waitForResponse(r=>r.url().startsWith(origin+'/api/source?') && r.request().method()==='PUT' && r.status()===409);
    await page.keyboard.press('Control+s'); await conflict;
    await diskEquals(target,winBytes(external)); assert.equal(await content(),own);
    await restart(); await open(target,own); await diskEquals(target,winBytes(external));
    const copy = page.locator('#code-save-copy'); await copy.waitFor({state:'visible'}); await copy.click();
    const copyInput = page.locator('#modal-input'); await copyInput.waitFor();
    if (!(await copyInput.inputValue())) await copyInput.fill('task-recovered.py'); await copyInput.press('Enter');
    let preserved;
    for(let i=0;i<70&&!preserved;i++) {
      const entries=await fs.readdir(vault,{recursive:true});
      for(const entry of entries.filter(p=>p.endsWith('.py') && p.replaceAll('\\','/')!==target)) {
        if((await fs.readFile(file(entry))).equals(winBytes(own))){preserved=entry;break;}
      }
      if(!preserved)await sleep(100);
    }
    assert.ok(preserved,'separate source file containing the local draft, including BOM and CRLF'); await diskEquals(target,winBytes(external));
    pass('External edit returns 409, preserves original and saves the separate draft with its original BOM and CRLF');

    const slow = 'Conflicts/slow.py'; await open(slow,'# base\n'); await focus();
    await page.keyboard.press('Control+End'); await page.keyboard.insertText('pending');
    let signalPending,release;
    const pending = new Promise(resolve=>{signalPending=resolve;});
    const next = new Promise(resolve=>{release=resolve;});
    const slowRoute = url=>url.pathname==='/api/source' && url.searchParams.get('path')===slow;
    beforeRequest=async request=>{if(slowRoute(new URL(request.url())) && request.method()==='PUT'){signalPending();await next;}};
    await page.keyboard.press('Control+s'); await pending; await page.keyboard.press('Control+z');
    assert.equal(await content(),'# base\n','undo a saving edit while its write is still pending');
    await open(python,pyChanged);
    const written=page.waitForResponse(r=>slowRoute(new URL(r.url()))&&r.request().method()==='PUT');
    release(); await written; beforeRequest=null;
    await open(slow,'# base\n'); await focus(); await page.keyboard.press('Control+s');
    await diskEquals(slow,'# base\n');
    pass('Undo during a pending save survives switching to another source tab and back');

    assert.equal(await fs.access(file('Week 1/exercise.ran')).then(()=>true,()=>false),false);
    pass('Opening, editing, switching and saving never executes the Python source');
    console.log(JSON.stringify({vault,passed:passed.length}));
  }finally {await browser?.close();}
}
main().then(()=>process.exit(0),err=>{console.error(err);process.exit(1);});
