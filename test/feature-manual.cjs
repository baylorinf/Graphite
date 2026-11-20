// Built-in user manual in the real app, without networking or a visible window.
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
// node test/feature-manual.cjs [path to the unpacked application]
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {chromium} = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const project = path.resolve(process.argv[2] || path.join(__dirname,'..'));

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(),'graphite-manual-'));
  await fs.writeFile(path.join(vault,'Welcome.md'),'# Sample course notebook');
  const port = await require(path.join(project,'server.js')).start({vault});
  const origin = 'http://127.0.0.1:'+port;
  const browser = await chromium.launch({headless:true,executablePath:process.env.GRAPHITE_CHROME||'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking']});
  try {
    for (const lang of ['zh-CN','en']) {
      const zh=lang==='zh-CN';
      const ctx=await browser.newContext({locale:lang,viewport:{width:1365,height:850}});
      await ctx.addInitScript(lang=>localStorage.setItem('mo:lang',JSON.stringify(lang)),lang);
      await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
      const p=await ctx.newPage();p.setDefaultTimeout(10000);
      await p.goto(origin,{waitUntil:'domcontentloaded'});await p.locator('#tree [data-path="Welcome.md"]').waitFor();
      await p.locator('#tree [data-path="Welcome.md"]').click();await p.keyboard.press('Control+t');
      const launch=p.locator('#empty-state [data-cmd=help]');await launch.waitFor();
      assert.match(await launch.innerText(),zh?/手册|指南/:/manual|guide/i);await launch.click();
      const help=p.locator('#help-view'), search=help.locator('input[type=search]');await search.waitFor();
      const guide=help.locator('#help-body');
      const all = await guide.innerText();
      for (const feature of (zh?[/笔记/,/代码/,/错题/,/制卡|卡片/,/复习计划|学习计划/,/PDF/,/框架/,/DeepSeek Harness/,/同步/,/插件/,/图谱|关系图/,/Markdown/]:[/note/i,/code/i,/mistake/i,/card/i,/plan/i,/PDF/,/framework/i,/DeepSeek Harness/,/sync/i,/plugin/i,/graph/i,/Markdown/])) assert.match(all,feature);
      for(const [query,wanted] of (zh?[['代码',/源文件|代码编辑|代码文件/],['错题',/错题/],['本地框架',/DeepSeek Harness/],['Ctrl+S',/Ctrl\s*\+\s*S/i]]:[['code',/source|code editor/i],['mistake',/mistake/i],['DeepSeek Harness',/DeepSeek Harness/],['Ctrl+S',/Ctrl\s*\+\s*S/i]])){
        await search.fill(query);
        await p.waitForFunction(({source,flags})=>{const el=document.querySelector('#help-body');return el&&new RegExp(source,flags).test(el.innerText);},{source:wanted.source,flags:wanted.flags});
      }
      await search.fill('impossible-zzzx-069432');
      await p.waitForFunction(zh=>{const s=document.querySelector('#help-view')?.innerText||'';return (zh?/没有|无匹配|未找到|找不到/:/no (?:results|match)|not found/i).test(s);},zh);
      await search.fill('');
      await p.waitForFunction(()=>document.querySelector('#help-body')?.innerText.includes('DeepSeek Harness'));
      for(const [tab,term] of [['markdown',/Markdown/i],['latex',/LaTeX/i]]){
        await help.locator('#help-tabs [data-help-page='+tab+']').click();
        await p.waitForFunction(term=>new RegExp(term,'i').test(document.querySelector('#help-body h1')?.innerText||''),term.source);
        assert.ok((await guide.innerText()).length>1000);
      }
      await p.locator('#tree [data-path="Welcome.md"]').click();await p.keyboard.press('F1');await search.waitFor();
      await p.waitForFunction(()=>document.querySelector('#help-body')?.innerText.includes('DeepSeek Harness'));
      console.log('PASS '+lang+' homepage text, F1, feature coverage, four searches, no matches, reset and both cheatsheets');
      await ctx.close();
    }
  }finally{await browser.close();}
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});
