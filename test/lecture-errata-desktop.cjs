// Run with Electron, optional argv[2] points directly at a packaged app.asar.
'use strict';
require('./isolate.cjs');
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const assert=require('node:assert/strict');
const {pdf}=require('./paragraph-pdf-fixture.cjs');
const root=process.env.GRAPHITE_TEST_ISOLATED;
app.setPath('userData',path.join(root,'electron'));
app.disableHardwareAcceleration();
async function main() {
  await app.whenReady();
  const repo=path.resolve(process.argv[2] || path.join(__dirname,'..'));
  const vault=path.join(root,'vault');
  await fs.mkdir(vault);
  const page=text=>[{lines:[text]}];
  const old=[page('Introduction'),page('Theory'),page('Method'),page('Effective length = 1.00 m')];
  const next=[page('Revision'),...old.slice(0,-1),page('Effective length = 0.98 m')];
  await fs.writeFile(path.join(vault,'Source.pdf'),pdf(old));
  await fs.writeFile(path.join(vault,'New.pdf'),pdf(next));
  await fs.writeFile(path.join(vault,'Report.md'),'# Report\nOriginal result\n');
  await fs.writeFile(path.join(vault,'Measurements.csv'),'period\n2.00\n');
  const port=await require(path.join(repo,'server.js')).start({vault});
  const origin='http://127.0.0.1:'+port;
  async function api(action,body) {
    const response=await fetch(origin+'/api/errata/'+action,body?{method:'POST',headers:{'Content-Type':'application/json','X-Vault':'1'},body:JSON.stringify(body)}:{});
    const out=await response.json();
    assert.equal(response.status,200,action+': '+JSON.stringify(out).slice(0,280));
    return out;
  }
  const doc=await api('document',{path:'Source.pdf'});
  assert.equal(doc.pages,4); assert.equal(doc.paragraphs[3].id,'P4S1');
  await api('track',{pdf:'Source.pdf',version:doc.version,source:'P4S1',report:'Report.md',
    calculation:{parameter:'L',unit:'m',numberIndex:0,inputs:[{name:'T',csv:'Measurements.csv',column:'period',row:1}],steps:[{name:'g',formula:'4*pi^2*L/T^2',unit:'m/s²'}]}});
  const p=await api('preview',{pdf:'Source.pdf',path:'New.pdf'});
  assert.equal(+p.items[0].results[0].to.toFixed(2),9.67);
  const result=await api('apply',{pdf:p.pdf,path:p.path,token:p.token});
  const draft=await fs.readFile(path.join(vault,result.drafts[0]),'utf8');
  await fs.writeFile(path.join(vault,'Evidence.md'),draft);
  await fs.unlink(path.join(vault,'Source.pdf'));await fs.unlink(path.join(vault,'New.pdf'));
  const range=await fetch(origin+'/api/errata/pdf?version='+doc.version,{headers:{Range:'bytes=0-4'}});
  assert.equal(range.status,206);assert.equal(await range.text(),'%PDF-');
  assert.deepEqual((await api('changes')).documents.map(x=>x.status),['missing']);
  console.log('PASS actual service: offline PDF and CSV, trial result, independent draft, archived bytes and changed-file detection');
  const win=new BrowserWindow({show:false,webPreferences:{partition:'errata-isolated',contextIsolation:true,nodeIntegration:false}});
  const js=code=>win.webContents.executeJavaScript(code);
  async function wait(code) {
    for(let i=0;i<160;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,100));}
    throw Error('Timed out: '+code);
  }
  const openRoot=async()=>{
    await win.loadURL(origin);
    await wait('!!document.querySelector(\'#tree [data-path="Evidence.md"]\')');
    await js('document.querySelector(\'#tree [data-path="Evidence.md"]\').click()');
    await js('document.querySelector(\'[data-cmd="mode-preview"]\')?.click()');
  };
  for(const [label,id] of [['旧版原文','P4S1'],['新版原文','P5S1']]) {
    await openRoot();
    const selector='[...document.querySelectorAll("a.internal-link")].find(a=>a.textContent.includes('+JSON.stringify(label)+'))';
    await wait('!!'+selector); await js(selector+'.click()');
    await wait('!!document.querySelector(\'.pdf-source-hl[data-source="'+id+'"]\')');
  }
  win.destroy();
  console.log('PASS archived citations: both draft links open and highlight the exact old and new paragraphs after removal of the working PDFs');
}
main().then(()=>app.exit(0),e=>{console.error(e.stack||e);app.exit(1);});
