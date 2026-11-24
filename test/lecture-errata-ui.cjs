'use strict';
require('./isolate.cjs');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pdf } = require('./paragraph-pdf-fixture.cjs');
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));

async function main() {
  const project = path.resolve(process.argv[2] || path.join(__dirname,'..'));
  const vault = path.join(process.env.GRAPHITE_TEST_ISOLATED,'vault');
  await fs.mkdir(vault);
  const lecture = (length, extra = false) => pdf((extra ? ['Revision'] : []).concat(['Introduction','Theory','Method','Effective length = '+length+' m']).map(line=>[{lines:[line]}]));
  const report = '# Report\nOriginal result\n';
  for (const [name,data] of Object.entries({'Lecture.pdf':lecture('1.00'),'Report.md':report,'Other.md':'# Other','Measurements.csv':'period\n2.00\n','Legacy.md':'[[Lecture.pdf#page=4|Method]]'})) {
    await fs.writeFile(path.join(vault,name),data);
  }
  const port = await require(path.join(project,'server.js')).start({vault});
  const origin = 'http://127.0.0.1:'+port;
  const browser = await chromium.launch({headless:true,executablePath:process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-background-networking']});
  try {
    const ctx = await browser.newContext({locale:'en',viewport:{width:1200,height:830}});
    await ctx.addInitScript(()=>localStorage.setItem('mo:lang',JSON.stringify('en')));
    await ctx.route('**/*',r=>r.request().url().startsWith(origin+'/')?r.continue():r.abort());
    const p = await ctx.newPage(); p.setDefaultTimeout(8000);
    p.on('pageerror',e=>console.error('Renderer:',e.message));
    const click = (el,name) => el.getByRole('button',{name,exact:true}).click();
    const modal = () => p.locator('dialog[open]').last();
    const tree = name=>p.locator('#tree [data-path="'+name+'"]');
    await p.goto(origin,{waitUntil:'domcontentloaded'});
    await tree('Legacy.md').click();
    const previewMode=p.locator('[data-cmd="mode-preview"]:visible').first();
    if(await previewMode.count()) await previewMode.click();
    await p.locator('a.internal-link').filter({hasText:'Method'}).first().click();
    await p.locator('[data-fv="errata"]').click();
    let d=modal();
    await d.getByText(/Cited page 4/).waitFor();
    assert.equal(await d.locator('.errata-paras input:checked').count(),0);
    await d.locator('.errata-paras input[value=P4S1]').check();
    await d.getByLabel('Report (Markdown note)',{exact:true}).fill('Report.md');
    await d.locator('input[value=calc]').check();
    await d.getByLabel('Parameter name',{exact:true}).fill('L');
    await d.getByPlaceholder('m',{exact:true}).fill('m');
    await click(d,'Add input');
    const entry = d.locator('.errata-row').filter({has:p.locator('input[value=csv]')});
    await entry.getByLabel('Name',{exact:true}).fill('T');
    await entry.locator('input[value=csv]').check();
    await entry.getByLabel('CSV file',{exact:true}).fill('Measurements.csv');
    await entry.getByLabel('Column header',{exact:true}).fill('period');
    const step = d.locator('.errata-row').filter({has:p.getByLabel('Formula',{exact:true})});
    await step.getByLabel('Name',{exact:true}).fill('g');
    await step.getByLabel('Formula',{exact:true}).fill('4*pi^2*L/T^2');
    await step.getByLabel('Unit',{exact:true}).fill('m/s²');
    await click(d,'Track');
    await p.waitForFunction(()=>!document.querySelector('dialog[open] .errata-form'));
    const state = async()=> (await fetch(origin+'/api/errata/state')).json();
    const tr=(await state()).tracks[0]; assert.equal(tr.source,'P4S1'); assert.equal(tr.calculation.inputs[0].value,2);
    console.log('PASS legacy page citation, toolbar, CSV and formula binding');
    while(await p.locator('dialog[open]').count()) await p.keyboard.press('Escape');
    await fs.writeFile(path.join(vault,'Lecture.pdf'),lecture('0.98',true));
    await p.keyboard.press('Control+p');
    await p.locator('#modal-input').fill('tracked lecture sources');
    await p.locator('#modal-list .modal-item').first().click();
    d=modal(); await d.getByText('Updated at the same path',{exact:true}).waitFor();
    await click(d,'Compare: Lecture.pdf');
    d=modal(); const results=d.locator('.errata-results'); await results.waitFor();
    assert.match(await results.textContent(),/9.87.*9.67/);
    assert.match(await d.innerText(),/P5S1/);
    await click(d,'Cancel');
    await assert.rejects(fs.access(path.join(vault,'勘误草稿')),{code:'ENOENT'});
    await click(modal(),'Compare: Lecture.pdf'); d=modal();
    await d.locator('.errata-results').waitFor();
    for (const [button,source] of [['View archived original','P4S1'],['View archived new','P5S1']]) {
      await click(d,button);
      const archive=modal();
      try { await archive.locator('.pdf-source-hl[data-source="'+source+'"]').waitFor(); }
      catch(e) {
        console.error('PDF viewer:',await archive.locator('.errata-alert,.errata-status,.errata-overlay-bar').allTextContents(),
          await archive.locator('.page').count(),await archive.locator('.pdf-source-hl').count());
        throw e;
      }
      await p.keyboard.press('Escape');
    }
    console.log('PASS same-path file change, calculation preview, cancellation and both archived paragraph highlights');
    d=modal(); await click(d,'Save…'); await click(modal(),'Confirm');
    const openDraft=modal().getByRole('button',{name:/Open: .*Report.md/});
    await openDraft.waitFor(); await openDraft.click();
    await p.waitForFunction(()=>!document.querySelector('dialog[open]'));
    const folders=await fs.readdir(path.join(vault,'勘误草稿'));
    assert.equal(folders.length,1);
    const draft=await fs.readFile(path.join(vault,'勘误草稿',folders[0],'Report.md'),'utf8');
    assert.match(draft,/P4S1/); assert.match(draft,/P5S1/);
    assert.equal(await fs.readFile(path.join(vault,'Report.md'),'utf8'),report);
    assert.equal(await fs.readFile(path.join(vault,'Other.md'),'utf8'),'# Other');
    await p.reload({waitUntil:'domcontentloaded'});
    assert.equal((await state()).tracks[0].source,'P5S1');
    console.log('PASS confirm, independent draft, original report, unrelated note and persistent new location');
    const openSources=async()=>{
      await p.keyboard.press('Control+p');
      await p.locator('#modal-input').fill('tracked lecture sources');
      await p.locator('#modal-list .modal-item').first().click();
      await click(modal(),'Compare: Lecture.pdf');
      return modal();
    };
    const duplicates=pdf(['Revision','Introduction','Theory','Method','Effective length = 0.96 m','Effective length = 0.96 m'].map(line=>[{lines:[line]}]));
    await fs.writeFile(path.join(vault,'Lecture.pdf'),duplicates);
    d=await openSources();
    const section=d.locator('.errata-item-ambiguous');
    await section.waitFor();
    assert.equal(await d.getByRole('button',{name:'Save…',exact:true}).isDisabled(),true);
    await section.locator('input[value=P6S1]').check();
    await d.locator('.errata-results').waitFor();
    assert.match(await d.locator('.errata-results').textContent(),/9.67.*9.47/);
    await click(d,'Save…');
    await fs.appendFile(path.join(vault,'Report.md'),'Independent edit\n');
    await click(d,'Confirm');
    await d.getByRole('button',{name:'Preview again'}).waitFor();
    assert.equal((await fs.readdir(path.join(vault,'勘误草稿'))).length,1);
    await click(d,'Preview again');
    await d.locator('.errata-results').waitFor();
    await click(d,'Save…'); await click(d,'Confirm');
    await d.getByRole('button',{name:/Open: .*Report.md/}).waitFor();
    assert.equal((await state()).tracks[0].source,'P6S1');
    assert.equal(await fs.readFile(path.join(vault,'Report.md'),'utf8'),report+'Independent edit\n');
    console.log('PASS duplicate paragraphs require a choice; stale confirmation retains independent edits and retry succeeds');
  } finally { await browser.close(); }
}
main().then(()=>process.exit(0),e=>{console.error(e.stack || e);process.exit(1);});
