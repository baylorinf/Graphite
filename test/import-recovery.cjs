'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const createAgent = require(path.join(path.resolve(process.argv[2] || path.join(__dirname,'..')),'agent.js'));
class HttpError extends Error { constructor(status,reason) { super(reason); this.status=status; } }

async function fixture(t) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(),'graphite-course-import-'));
  t.after(()=>fs.rm(base,{recursive:true,force:true}));
  const vault=path.join(base,'vault'), courses=path.join(base,'courses');
  async function put(file, bytes) { await fs.mkdir(path.dirname(file),{recursive:true}); await fs.writeFile(file,bytes); }
  const original=path.join(vault,'Math','notes.md'), source=name=>path.join(courses,'M',name);
  await put(original,'abc');
  await put(source('new.md'),'xyz');
  await put(source('copy-of-notes.md'),'abc');
  await put(source('also-new.md'),'uvw');
  await put(source('another-name.md'),'uvw');
  await put(path.join(vault,'Math','Lecture.pdf'),'old unrelated PDF');
  await put(source('Lecture.docx'),'teacher revised file');
  const state={calls:[],error:'outside'};
  const exists=async p=>!!(await fs.stat(p).catch(()=>null));
  const config={
    vault:()=>vault, inVault:rel=>path.join(vault,rel), toRel:p=>path.relative(vault,p).split(path.sep).join('/'), exists,
    HttpError, COMPAT:{}, LANG_NAMES:{}, readBody:async req=>Buffer.from(JSON.stringify(req.body)),
    withFileLock:(_,f)=>f(), atomicWrite:(file,data)=>state.writeManifest ? state.writeManifest(file,data) : put(file,data),
    officeToPdf:async (source,pdf)=>state.convert ? state.convert(source,pdf) : put(pdf,Buffer.concat([Buffer.from('%PDF-1.4\n'),await fs.readFile(source)])),
    uniquePath:async file=>{ const ext=path.extname(file), stem=file.slice(0,-ext.length); let target=file, n=1;
      while(await exists(target)) target=stem+' ('+(++n)+')'+ext;return target; },
    study:{load:async()=>({courseRoots:[courses],courses:{M:'Math'},skipFolders:[],readOnlyFolders:['Protected'],lookElsewhere:false}),file:()=>''},
    PROFILE:{outputLanguage:()=> 'English',promptBlock:()=>''},
    frameworks:{ids:['codex','dsh'],run:async (id,options)=>{
      state.calls.push(id);
      if(state.frameworkRun)return state.frameworkRun(options);
      if(state.error)throw Object.assign(new Error('Framework stopped'),{code:state.error,framework:id});
      return {result:{items:[]},reads:[]};
    }},
  };
  const agent=createAgent(config);
  async function request(body, onProgress, instance=agent) {
    const resp=new EventEmitter(), lines=[];
    resp.writeHead=()=>{};
    resp.write=line=>{
      const entry=JSON.parse(line);
      lines.push(entry);
      if (entry.progress) onProgress?.(entry.progress,resp);
    };
    resp.end=()=>{};
    try { await instance.handle({headers:{},body:{job:'import',framework:'codex',...body}},resp); }
    catch(e) {return {error:e.message,status:e.status};}
    return lines.at(-1);
  }
  return {state,vault,request,reopen:body=>request(body,null,createAgent(config)),source,original,exists,put};
}

test('content confirms duplicates, blocked classification preserves candidates and makes no file changes',async t=>{
  const f=await fixture(t);
  const {result:p}=await f.request({phase:'plan'});
  assert.deepEqual(p.planningIssue,{code:'outside',framework:'codex'});
  assert.equal(p.planMode,'manual');assert.ok(p.planId);
  assert.equal(p.counts.inVault,1);assert.equal(p.duplicates[0].match,'Math/notes.md');
  assert.equal(p.items.filter(i=>['also-new.md','another-name.md'].includes(i.name)).length,1);
  assert.ok(p.items.some(i=>i.name==='Lecture.docx' && i.dest==='Math/Lecture.pdf'));
  assert.ok(!p.items.some(i=>i.name==='copy-of-notes.md'));
  const index=p.items.findIndex(i=>i.name==='new.md');assert.ok(index>=0);
  assert.equal(p.items[index].dest,'Math/new.md');
  assert.equal(await f.exists(path.join(f.vault,'Math/new.md')),false);
  const apply=args=>f.request({phase:'apply',planId:p.planId,...args});
  assert.equal((await apply({framework:'dsh',accept:[index]})).status,409);
  assert.equal((await apply({})).status,400);
  assert.equal((await apply({accept:[index],destinations:{[index]:'Protected/new.md'}})).status,400);
  const target=path.join(f.vault,'Second','new.md');await f.put(target,'keep');
  const {result:done}=await apply({accept:[index],destinations:{[index]:'Second/new.md'}});
  assert.equal(done.planMode,'manual');assert.equal(done.done.length,1);assert.deepEqual(done.failed,[]);
  assert.equal(await fs.readFile(target,'utf8'),'keep');
  assert.equal(await fs.readFile(path.join(f.vault,done.done[0].dest),'utf8'),'xyz');
  assert.deepEqual(f.state.calls,['codex']);
  assert.equal((await apply({accept:[index]})).status,410);
});

test('explicit manual scan needs no runner; an empty confirmation creates no import record',async t=>{
  const f=await fixture(t);
  const {result:p}=await f.request({phase:'plan',planning:'manual'});
  assert.equal(p.planMode,'manual');assert.equal(p.planningIssue,undefined);
  const {result:done}=await f.request({phase:'apply',planId:p.planId,accept:[]});
  assert.deepEqual(done.done,[]);assert.deepEqual(f.state.calls,[]);
  assert.equal(await f.exists(path.join(f.vault,'.obsidian')),false);
});

test('other framework failures remain visible and a successful AI plan keeps its previous behavior',async t=>{
  const f=await fixture(t);
  f.state.error='auth';assert.equal((await f.request({phase:'plan'})).code,'auth');
  f.state.error=null;const {result:p}=await f.request({phase:'plan'});assert.deepEqual(p.items,[]);assert.equal(p.planMode,undefined);
});

test('Graphite can scan and import without any configured AI',async t=>{
  const f = await fixture(t);
  const graphite = {framework:null, provider:'graphite'};
  assert.equal((await f.request({...graphite, phase:'plan'})).status, 400);
  assert.equal((await f.request({...graphite, job:'inbox', phase:'plan', planning:'manual'})).status, 400);
  const {result:plan} = await f.request({...graphite, phase:'plan', planning:'manual'});
  assert.equal(plan.planMode, 'manual');
  const index = plan.items.findIndex(file => file.name === 'new.md');
  assert.ok(index >= 0);
  const apply = {phase:'apply', planId:plan.planId, accept:[index], destinations:{[index]:'new.md'}};
  assert.equal((await f.request({...apply, framework:'codex'})).status, 409);
  const {result:saved} = await f.request({...graphite, ...apply});
  assert.deepEqual(saved.done.map(file => file.dest), ['new.md']);
  assert.equal(await fs.readFile(path.join(f.vault,'new.md'),'utf8'), 'xyz');
  assert.deepEqual(f.state.calls, []);
});

test('leaving an active scan stops it before asking the AI to plan',async t=>{
  const f = await fixture(t);
  const response = await f.request({phase:'plan'}, (progress,res)=>{
    if (progress.step === 'scan') res.emit('close');
  });
  assert.ok(response.error);
  assert.deepEqual(f.state.calls, []);
  assert.equal(await f.exists(path.join(f.vault,'.obsidian')), false);
});

test('recorded imports detect equal-length revisions even with the same timestamp for both raw and converted files',async t=>{
  const f=await fixture(t), scan=async()=> (await f.request({phase:'plan',planning:'manual'})).result;
  const first=await scan(), names=['new.md','Lecture.docx'];
  const accept=first.items.flatMap((it,i)=>names.includes(it.name)?[i]:[]);
  const {result:done}=await f.request({phase:'apply',planId:first.planId,accept});
  assert.deepEqual(done.failed,[]);assert.equal(done.done.length,2);
  const again=await scan();
  assert.equal(again.counts.known,2);assert.ok(!again.items.some(it=>names.includes(it.name)));
  for(const name of names) {
    const file=f.source(name), st=await fs.stat(file);
    await fs.writeFile(file,Buffer.alloc(st.size,0x7a));
    await fs.utimes(file,st.atime,st.mtime);
  }
  const revised=await scan();
  for(const name of names)assert.ok(revised.items.some(it=>it.name===name),'missing changed '+name);
});

test('old import records require matching content, honor explicit ignores and recover a deleted destination',async t=>{
  const f=await fixture(t);
  const manifest={imported:{},ignored:{}};
  const key=file=>file.replace(/\\/g,'/').toLowerCase();
  for(const [name,dest,converted] of [['new.md','Math/saved.md',false],['Lecture.docx','Math/Lecture.pdf',true]]) {
    const src=f.source(name), st=await fs.stat(src);
    manifest.imported[key(src)]={dest,size:st.size,mtime:st.mtimeMs,converted};
  }
  manifest.ignored[key(f.source('also-new.md'))]={reason:'explicit'};
  const copy=path.join(f.vault,'Math','saved.md');
  await fs.copyFile(f.source('new.md'),copy);
  await f.put(path.join(f.vault,'.obsidian','plugins','claude-chat','imports.json'),JSON.stringify(manifest));
  const scan=async()=> (await f.request({phase:'plan',planning:'manual'})).result;
  const p=await scan();
  assert.equal(p.counts.known,1);assert.equal(p.counts.ignored,1);
  assert.ok(p.items.some(it=>it.name==='Lecture.docx'));
  assert.ok(!p.items.some(it=>it.name==='new.md'||it.name==='also-new.md'));
  await fs.unlink(copy);
  assert.ok((await scan()).items.some(it=>it.name==='new.md'));
});

const nativeScan={framework:null,provider:'graphite',phase:'plan',planning:'manual',lang:'zh-CN'};
const nativeApply=(p,indices)=>({...nativeScan,phase:'apply',planId:p.planId,accept:indices});
const brokenOffice=input=>{const app=/\.pptx?$/i.test(input)?'PowerPoint':'Word';
  throw Object.assign(new Error(app+' · '+path.basename(input)+'：模拟转换器无法打开该文件\nlong diagnostic'),{code:'officeOpenFailed'});};

test('Office fallback counts each file once, preserves original bytes, and rescan retries only the preview from the edited vault copy',async t=>{
  const f=await fixture(t);
  const bytes=Buffer.from([0,0xff,0x12,0xda,0x44]);
  await f.put(f.source('章节.pptx'),bytes);
  await f.put(path.join(f.vault,'Math','章节.pptx'),'student copy');
  await f.put(path.join(f.vault,'Math','Lecture.docx'),'another student copy');
  f.state.convert=brokenOffice;
  const {result:plan}=await f.request(nativeScan);
  const accepted=plan.items.flatMap((it,i)=>['章节.pptx','Lecture.docx','new.md'].includes(it.name)?[i]:[]);
  const {result:saved}=await f.request(nativeApply(plan,accepted));
  assert.equal(saved.done.length,3);assert.deepEqual(saved.failed,[]);
  assert.match(saved.indexError,/2 份 Office 原件/);
  assert.equal(saved.indexError.match(/模拟转换器/g).length,1);
  const retained=saved.done.find(i=>i.originalDest?.endsWith('.pptx'));
  assert.equal(retained.dest,retained.originalDest);assert.notEqual(retained.dest,'Math/章节.pptx');
  assert.equal(retained.preview.status,'failed');assert.equal(retained.preview.code,'officeOpenFailed');assert.equal(retained.preview.reason,'模拟转换器无法打开该文件');
  assert.deepEqual(await fs.readFile(path.join(f.vault,retained.dest)),bytes);
  assert.equal(await fs.readFile(path.join(f.vault,'Math','章节.pptx'),'utf8'),'student copy');
  const other=saved.done.find(i=>i.originalDest?.endsWith('.docx'));
  assert.ok(other.preview.retryId && other.preview.retryId!==retained.preview.retryId);
  await fs.unlink(f.source('章节.pptx'));
  const edited=Buffer.from('student edited the vault original');
  await f.put(path.join(f.vault,retained.originalDest),edited);
  const {result:again}=await f.request(nativeScan);
  assert.equal(again.items.filter(i=>i.retryPreviewId).length,2);
  const i=again.items.findIndex(item=>item.retryPreviewId===retained.preview.retryId);
  assert.ok(i>=0);assert.deepEqual(again.items[i].preview,retained.preview);
  const requested=again.items[i].dest;await f.put(path.join(f.vault,requested),'student PDF');
  let attempts=0;
  f.state.convert=async(input,pdf)=>{attempts++;assert.deepEqual(await fs.readFile(input),edited);await fs.writeFile(pdf,'%PDF-1.4\nnew preview');};
  const {result:retried}=await f.request(nativeApply(again,[i]));
  assert.deepEqual(retried.failed,[]);assert.equal(retried.done.length,1);
  const selected=retried.done[0];assert.equal(selected.preview.status,'ready');assert.equal(selected.originalDest,retained.originalDest);
  assert.notEqual(selected.preview.dest,requested);assert.equal(selected.dest,selected.preview.dest);
  assert.equal(await fs.readFile(path.join(f.vault,requested),'utf8'),'student PDF');
  assert.deepEqual(await fs.readFile(path.join(f.vault,retained.originalDest)),edited);
  const retry={phase:'retryPreview',retryId:retained.preview.retryId};
  assert.equal((await f.reopen(retry)).result.done[0].dest,selected.dest);
  assert.equal(attempts,1);assert.deepEqual(f.state.calls,[]);
  const {result:after}=await f.request(nativeScan);
  assert.deepEqual(after.items.filter(i=>i.retryPreviewId).map(i=>i.retryPreviewId),[other.preview.retryId]);
  assert.equal((await fs.readdir(path.join(f.vault,'Math'))).filter(n=>n.endsWith('.pptx')).length,2);
});

test('failed previews survive closing the import dialog, concurrent retries and an invalid converter output',async t=>{
  const f=await fixture(t);f.state.convert=async(_,pdf)=>fs.writeFile(pdf,'not a PDF');
  const {result:plan}=await f.request(nativeScan);
  const {result:saved}=await f.request(nativeApply(plan,[plan.items.findIndex(i=>i.name==='Lecture.docx')]));
  const retained=saved.done[0];assert.equal(retained.preview.code,'officeExportFailed');
  const retry={phase:'retryPreview',retryId:retained.preview.retryId};
  const before=await fs.readdir(path.join(f.vault,'Math'));
  assert.equal((await f.request(retry)).result.done[0].dest,retained.originalDest);
  assert.deepEqual(await fs.readdir(path.join(f.vault,'Math')),before);
  let count=0;
  f.state.convert=async(_,pdf)=>{count++;await new Promise(r=>setTimeout(r,30));await fs.writeFile(pdf,'%PDF-1.4\none');};
  const both=await Promise.all([f.request(retry),f.request(retry)]);
  assert.equal(count,1);assert.equal(both[0].result.done[0].dest,both[1].result.done[0].dest);
  assert.equal((await fs.readdir(path.join(f.vault,'Math'))).length,before.length+1);
  const bad=await f.request({phase:'retryPreview',retryId:'not-a-preview'});assert.equal(bad.status,400);
});

test('framework confirms exact staged Office bytes and preserves its other selected import after preview failure',async t=>{
  const f=await fixture(t);f.state.convert=brokenOffice;
  f.state.frameworkRun=async opts=>{
    if(opts.mode==='read'){
      const selected=[...opts.prompt.matchAll(/\{"id":(\d+),[^\n]*?"name":"([^"]+)"/g)]
        .filter(m=>['Lecture.docx','new.md'].includes(m[2])).map(m=>({id:Number(m[1]),dest:'Math/'+(m[2]==='Lecture.docx'?'Lecture.pdf':'new.md')}));
      return {result:{items:selected},reads:[]};
    }
    for(const m of opts.prompt.matchAll(/\d+\. Copy the file "([^"]+)" to "([^"]+)"/g)){
      await f.put(path.join(opts.cwd,m[2]),await fs.readFile(path.resolve(opts.cwd,m[1])));
    }
    return {};
  };
  const {result:plan}=await f.request({phase:'plan'});assert.equal(plan.items.length,2);
  const {result:done}=await f.request({phase:'apply',planId:plan.planId,accept:[0,1]});
  assert.deepEqual(done.failed,[]);assert.equal(done.done.length,2);
  const office=done.done.find(i=>i.name==='Lecture.docx');assert.ok(office?.originalDest);
  assert.deepEqual(await fs.readFile(path.join(f.vault,office.originalDest)),await fs.readFile(f.source('Lecture.docx')));
  assert.equal(await fs.readFile(path.join(f.vault,'Math','new.md'),'utf8'),'xyz');
  assert.equal(await fs.readFile(path.join(f.vault,'Math','Lecture.pdf'),'utf8'),'old unrelated PDF');
});

test('source edits made during conversion are not recorded as the version initially imported',async t=>{
  const f=await fixture(t);
  const after=Buffer.from('teacher changed the document during conversion');
  f.state.convert=async(input)=>{await f.put(f.source('Lecture.docx'),after);brokenOffice(input);};
  const first=(await f.request(nativeScan)).result;
  const failed=(await f.request(nativeApply(first,[first.items.findIndex(i=>i.name==='Lecture.docx')]))).result;
  assert.equal(failed.done.length,0);assert.equal(failed.failed.length,1);
  assert.equal(await f.exists(path.join(f.vault,'Math','Lecture.docx')),false);
  const next=(await f.request(nativeScan)).result;
  f.state.convert=async input=>{await fs.writeFile(input,'converter unexpectedly rewrote input');brokenOffice(input);};
  const saved=(await f.request(nativeApply(next,[next.items.findIndex(i=>i.name==='Lecture.docx')]))).result.done[0];
  assert.deepEqual(await fs.readFile(path.join(f.vault,saved.originalDest)),after);
  const retry={phase:'retryPreview',retryId:saved.preview.retryId};
  f.state.convert=async(_,pdf)=>{await f.put(path.join(f.vault,saved.originalDest),'student edit while making PDF');await f.put(pdf,'%PDF-1.4\nstale');};
  assert.equal((await f.reopen(retry)).status,409);
  assert.equal(await fs.readFile(path.join(f.vault,saved.originalDest),'utf8'),'student edit while making PDF');
  assert.equal((await f.request(nativeScan)).result.items.filter(i=>i.retryPreviewId===retry.retryId).length,1);
});

test('a uniquely moved original in a read-only folder can make a preview in a writable folder; an ambiguous match is left alone',async t=>{
  const f=await fixture(t);f.state.convert=brokenOffice;
  const first=(await f.request(nativeScan)).result;
  const saved=(await f.request(nativeApply(first,[first.items.findIndex(i=>i.name==='Lecture.docx')]))).result.done[0];
  const moved=path.join(f.vault,'Protected','改名.docx');
  await fs.mkdir(path.dirname(moved),{recursive:true});await fs.rename(path.join(f.vault,saved.originalDest),moved);
  const duplicate=path.join(f.vault,'Math','相同副本.docx');await fs.copyFile(moved,duplicate);
  const retry={phase:'retryPreview',retryId:saved.preview.retryId};
  assert.equal((await f.reopen(retry)).status,409);
  assert.ok(!(await f.request(nativeScan)).result.items.some(i=>i.retryPreviewId===retry.retryId));
  await fs.unlink(duplicate);
  const manifest=path.join(f.vault,'.obsidian','plugins','claude-chat','imports.json');
  const previous=await fs.readFile(manifest);
  const next=(await f.reopen(nativeScan)).result, i=next.items.findIndex(item=>item.retryPreviewId===retry.retryId);
  assert.ok(i>=0);assert.equal(next.items[i].originalDest,'Protected/改名.docx');
  assert.equal(next.items[i].dest,'改名.pdf');assert.deepEqual(await fs.readFile(manifest),previous);
  const plan=(await f.request(nativeScan)).result, n=plan.items.findIndex(item=>item.retryPreviewId===retry.retryId);
  assert.equal((await f.request({...nativeApply(plan,[n]),destinations:{[n]:'Protected/改名.pdf'}})).status,400);
  f.state.convert=async(input,pdf)=>{assert.deepEqual(await fs.readFile(input),await fs.readFile(moved));await fs.writeFile(pdf,'%PDF-1.4\nnew');};
  const recovered=(await f.request({...nativeApply(plan,[n]),destinations:{[n]:'Math/改名.pdf'}})).result.done[0];
  assert.equal(recovered.dest,'Math/改名.pdf');assert.equal(recovered.originalDest,'Protected/改名.docx');
  assert.equal((await f.reopen(retry)).result.done[0].dest,'Math/改名.pdf');
  assert.deepEqual(await fs.readdir(path.dirname(moved)),['改名.docx']);
});

test('manifest failures roll back only this import’s unchanged files, preserving user edits and existing destinations',async t=>{
  const f=await fixture(t);f.state.convert=brokenOffice;
  const planOffice=async()=>{const p=(await f.request(nativeScan)).result;return nativeApply(p,[p.items.findIndex(i=>i.name==='Lecture.docx')]);};
  const original=path.join(f.vault,'Math','Lecture.docx');
  f.state.writeManifest=async()=>{throw Error('temporary manifest write failure');};
  const initial=(await f.request(await planOffice())).result;
  assert.equal(initial.done.length,0);assert.equal(initial.failed.length,1);assert.equal(await f.exists(original),false);
  assert.equal(await fs.readFile(f.source('Lecture.docx'),'utf8'),'teacher revised file');
  f.state.writeManifest=null;
  const saved=(await f.request(await planOffice())).result.done[0];
  f.state.convert=async(_,pdf)=>fs.writeFile(pdf,'%PDF-1.4\nnew');
  const retry={phase:'retryPreview',retryId:saved.preview.retryId};
  const before=(await fs.readdir(path.dirname(original))).sort();
  f.state.writeManifest=async()=>{throw Error('unable to save preview index');};
  assert.match((await f.request(retry)).error,/save preview index/);
  assert.deepEqual((await fs.readdir(path.dirname(original))).sort(),before);
  f.state.writeManifest=async(file,data)=>{
    const record=JSON.parse(data).previews[retry.retryId];await fs.writeFile(path.join(f.vault,record.pdfDest),'student edited this new PDF');
    throw Error('temporary manifest write failure');
  };
  assert.match((await f.request(retry)).error,/Kept changed files/);
  const preserved=(await fs.readdir(path.dirname(original))).filter(n=>!before.includes(n));assert.equal(preserved.length,1);
  assert.equal(await fs.readFile(path.join(path.dirname(original),preserved[0]),'utf8'),'student edited this new PDF');
  f.state.writeManifest=null;
  assert.equal((await f.reopen(retry)).result.done[0].preview.status,'ready');
  assert.equal(await fs.readFile(path.join(f.vault,'Math','Lecture.pdf'),'utf8'),'old unrelated PDF');
  assert.equal(await fs.readFile(path.join(path.dirname(original),preserved[0]),'utf8'),'student edited this new PDF');
});
