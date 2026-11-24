'use strict';
require('./isolate.cjs');
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {calculate,csvNumber,locate} = require('../errata-math');
const {pdf} = require('./paragraph-pdf-fixture.cjs');
const {createErrata} = require('../errata');
const {atomicWrite,withFileLock} = require('../server');

test('arithmetic uses math precedence, earlier results and finite numbers only',()=>{
  assert.equal(calculate('-2^2+2^-2',{}),-3.75);
  assert.equal(calculate('2^3^2',{}),512);
  assert.equal(calculate('(a + 2e-3)/2',{a:1.998}),1);
  for(const expr of ['1/0','2*','Math.PI','unknown+1','1 + (2 * 3','1 9']) assert.throws(()=>calculate(expr,{}));
});
test('CSV handles BOM, quoted names and line breaks, duplicate columns and missing measurements',()=>{
  const csv='\uFEFF"period,s","note"\r\n2.00,"two\r\nlines"\r\n1.97,"quoted ""value"""';
  assert.equal(csvNumber(csv,'period,s',2),1.97);
  for(const src of ['T,T\n2,3','T\n','T\n2 units','T\n"2','T\nInfinity']) assert.throws(()=>csvNumber(src,'T',1));
});
const f = (id,text)=>({id,fp:id,text});
test('duplicates remain unresolved and a plausible textual edit needs manual confirmation',()=>{
  const old=[f('P1S1','Title'),f('P1S2','Gravitational field strength'),f('P1S3','After')];
  const next=[old[0],f('P2S1','Gravitational field intensity'),old[2]];
  assert.equal(locate(old,next,'P1S2').status,'ambiguous');
  assert.equal(locate(old,next,'P1S2','P2S1').status,'changed');
  assert.equal(locate(old,[],'P1S2').status,'missing');
  assert.equal(locate(old,[old[1],f('P2S2',old[1].text)],'P1S2').status,'ambiguous');
});

const source='lecture.pdf', update='replacement.pdf', report='Experiment/Report.md', textNote='Theory.md', unrelated='Other.md';
const spec={parameter:'L',unit:'m',numberIndex:0,inputs:[{name:'T',csv:'time.csv',column:'period',row:1}],
  steps:[{name:'square',formula:'T^2',unit:'s²'},{name:'g',formula:'4*pi^2*L/square',unit:'m/s²'}]};
function lecture(length,{extra=false,duplicate=false,unit='m'}={}) {
  const line=s=>[{lines:[s]}], measured=line('Effective length = '+length+' '+unit);
  const pages=[line('Course notes'),line('Theory and definitions'),line('Lab setup'),measured];
  if(extra) pages.unshift(line('Revision notice'));
  if(duplicate) pages.push(measured);
  return pdf(pages);
}
async function library(t) {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-errata-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const here=rel=>path.join(root,rel);
  await fs.mkdir(here('Experiment'));
  for(const note of [report,textNote,unrelated]) await fs.writeFile(here(note),'# '+note+'\nMy original answer\n');
  await fs.writeFile(here(source),lecture('1.00'));
  await fs.writeFile(here('time.csv'),'period,run\r\n2.00,1\r\n');
  const restart=()=>createErrata({vault:()=>root,atomicWrite,withFileLock});
  const service=restart();
  const req=(action,body)=>service.handle(action,body);
  const doc=await req('document',{path:source});
  await req('track',{pdf:source,source:'P4S1',version:doc.version,report,calculation:spec});
  await req('track',{pdf:source,source:'P2S1',version:doc.version,report:textNote});
  const preview=choices=>req('preview',{pdf:source,path:update,choices});
  const apply=(p,choices)=>req('apply',{pdf:source,path:update,token:p.token,choices});
  return {root,here,req,preview,apply,doc,restart};
}
test('a real 4-page PDF and CSV identify the only affected report; confirmation is restart-safe and idempotent',async t=>{
  const {here,req,preview,apply,doc,restart}=await library(t);
  const bytes=await fs.readFile(here(report));
  const old=await req('pdf',{version:doc.version});
  await fs.writeFile(here(update),lecture('0.98',{extra:true}));
  const p=await preview();
  assert.equal(p.canApply,true);
  assert.deepEqual(p.items.map(i=>[i.status,i.old.id,i.new.id]),[['changed','P4S1','P5S1'],['moved','P2S1','P3S1']]);
  assert.deepEqual(p.items[0].results.map(s=>[s.name,+s.from.toFixed(2),+s.to.toFixed(2)]),[['square',4,4],['g',9.87,9.67]]);
  assert.equal(p.items[1].affected,false);
  await assert.rejects(fs.access(here('勘误草稿')),{code:'ENOENT'});
  const [a,b]=await Promise.all([apply(p),apply(p)]);
  assert.deepEqual(a,b);
  assert.equal(a.drafts.length,1);
  assert.equal(await fs.readFile(here(report),'utf8'),bytes.toString());
  assert.match(await fs.readFile(here(a.drafts[0]),'utf8'),/Effective length = 0.98 m/);
  assert.equal((await preview()).items.every(i=>i.status==='unchanged'),true);
  const fresh=restart();
  assert.deepEqual(await fresh.handle('apply',{pdf:source,path:update,token:p.token}),a);
  assert.deepEqual(await fresh.handle('pdf',{version:doc.version}),old);
  assert.equal((await fresh.handle('state')).tracks.find(i=>i.report===report).source,'P5S1');
});
test('moving without edits makes no draft; duplicate replacements require an explicit source; scanned PDF stays unresolved',async t=>{
  const {here,req,preview,apply}=await library(t);
  await fs.writeFile(here(update),lecture('1.00',{extra:true}));
  const moved=await preview();
  assert.equal(moved.items[0].status,'moved');
  assert.deepEqual((await apply(moved)).drafts,[]);
  await fs.writeFile(here(update),lecture('0.96',{extra:true,duplicate:true}));
  const many=await preview();
  assert.equal(many.canApply,false);
  const i=many.items.find(i=>i.report===report);
  assert.deepEqual(i.candidates.map(c=>c.id),['P5S1','P6S1']);
  await assert.rejects(apply(many),{status:409});
  const choices={[i.id]:'P6S1'};
  const resolved=await preview(choices);
  assert.equal(+resolved.items[0].results.at(-1).to.toFixed(2),9.47);
  await apply(resolved,choices);
  await fs.writeFile(here(update),pdf([[]]));
  assert.equal((await preview()).canApply,false);
});
test('stale previews, CSV changes, unit conflicts and same-name PDF replacement preserve original evidence',async t=>{
  const {here,req,doc,preview,apply}=await library(t);
  await fs.writeFile(here(update),lecture('0.98'));
  const p=await preview();
  await fs.appendFile(here(report),'Saved meanwhile');
  await assert.rejects(apply(p),{status:409});
  await fs.writeFile(here('time.csv'),'period,run\n2.1,1');
  const csv=await preview();
  assert.deepEqual(csv.items[0].results,[]);assert.match(csv.items[0].reason,/测量表/);
  await fs.writeFile(here(update),lecture('98',{unit:'cm'}));
  const pending=await preview();
  const choices={[pending.items[0].id]:'P4S1'};
  const units=await preview(choices);
  assert.deepEqual(units.items[0].results,[]);assert.match(units.items[0].reason,/单位/);
  await fs.writeFile(here(source),lecture('0.99'));
  const latest=await req('preview',{pdf:source,path:source});
  assert.notEqual(latest.version,doc.version);
  assert.deepEqual(await req('pdf',{version:doc.version}),lecture('1.00'));
});

test('change detection follows the accepted path, including renames with identical bytes',async t=>{
  const {here,req,preview,apply}=await library(t);
  assert.deepEqual(await req('changes'),{documents:[]});
  await fs.copyFile(here(source),here(update));
  await apply(await preview());
  await fs.unlink(here(source));
  assert.deepEqual(await req('changes'),{documents:[]});
  await fs.writeFile(here(update),lecture('0.96',{extra:true}));
  const changes=await req('changes');
  assert.equal(changes.documents.length,1);
  assert.equal(changes.documents[0].status,'updated');
  assert.equal(changes.documents[0].path,update);
  await fs.unlink(here(update));
  assert.equal((await req('changes')).documents[0].status,'missing');
});

test('a missing report is shown alongside other matches and cannot be accidentally replaced',async t=>{
  const {here,preview,apply}=await library(t);
  await fs.writeFile(here(update),lecture('0.97'));
  await fs.unlink(here(report));
  const p=await preview();
  assert.equal(p.items.length,2);
  assert.equal(p.items[0].reportMissing,true);
  assert.equal(p.canApply,false);
  await assert.rejects(apply(p),{status:409});
  await assert.rejects(fs.access(here(report)),{code:'ENOENT'});
});

test('an old citation cannot bind the paragraph currently occupying its page position',async t=>{
  const {req,doc}=await library(t);
  const old=(await req('state')).revision;
  await assert.rejects(req('track',{pdf:source,version:doc.version,source:'P4S1',fp:'stale00',report:unrelated}),{status:409});
  assert.equal((await req('state')).revision,old);
  const anchor=doc.paragraphs.find(p=>p.id==='P4S1');
  const state=await req('track',{pdf:source,version:doc.version,source:anchor.id,fp:anchor.fp,report:unrelated});
  assert.equal(state.tracks.filter(t=>t.report===unrelated).length,1);
});

test('interrupted state publication is recovered once without replacing later edits',async t=>{
  const {root,here,req,preview,restart}=await library(t);
  await fs.writeFile(here(update),lecture('0.98'));
  const p=await preview();
  const interrupted=createErrata({vault:()=>root,withFileLock,atomicWrite:async(file,bytes)=>{
    if(file.endsWith('state.json') && JSON.parse(bytes).receipts[p.token]) throw new Error('interrupted final state write');
    await atomicWrite(file,bytes);
  }});
  const args={pdf:source,path:update,token:p.token};
  await assert.rejects(interrupted.handle('apply',args),/interrupted final state write/);
  const after=restart();
  await fs.appendFile(here(report),'Additional work after restart');
  const saved=await after.handle('apply',args);
  assert.equal(saved.drafts.length,1);
  assert.equal((await req('state')).tracks[0].version,p.version);
  const draft=await fs.readFile(here(saved.drafts[0]),'utf8');
  assert(!draft.includes('Additional work after restart'));
  assert.match(draft,/time\.csv.*period.*数据行 1/);
  assert.match(draft,/g = 4\*pi\^2\*L\/square/);
  const links=[...draft.matchAll(/\[\[([^#]+\.pdf)#page=(\d+)&source=(P\d+S\d+)&fp=/g)];
  assert.deepEqual(links.map(l=>l[3]),['P4S1','P4S1']);
  assert.notDeepEqual(await fs.readFile(here(links[0][1])),await fs.readFile(here(links[1][1])));
  await fs.appendFile(here(saved.drafts[0]),'Edited correction');
  assert.deepEqual(await after.handle('apply',args),saved);
  assert.match(await fs.readFile(here(saved.drafts[0]),'utf8'),/Edited correction$/);
});
