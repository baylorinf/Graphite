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
    vault:()=>state.activeVault || vault, inVault:rel=>path.join(vault,rel), toRel:p=>path.relative(vault,p).split(path.sep).join('/'), exists,
    HttpError, COMPAT:{}, LANG_NAMES:{}, readBody:async req=>Buffer.from(JSON.stringify(req.body)),
    withFileLock:(_,f)=>f(), atomicWrite:(file,data)=>state.writeManifest ? state.writeManifest(file,data) : put(file,data),
    officeToPdf:async (source,pdf)=>state.convert ? state.convert(source,pdf) : put(pdf,Buffer.concat([Buffer.from('%PDF-1.4\n'),await fs.readFile(source)])),
    uniquePath:async file=>{ const ext=path.extname(file), stem=file.slice(0,-ext.length); let target=file, n=1;
      while(await exists(target)) target=stem+' ('+(++n)+')'+ext;return target; },
    study:{load:async()=>({courseRoots:state.courseRoots || [courses],courses:{M:'Math'},skipFolders:[],readOnlyFolders:state.readOnly || ['Protected'],lookElsewhere:false}),file:()=>''},
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

test('independently confirmed previews reuse a matching copy but keep later student edits',async t=>{
  const f=await fixture(t);
  const plans=await Promise.all([f.request(nativeScan),f.request(nativeScan),f.request(nativeScan)]);
  async function confirm({result:plan}) {
    const index=plan.items.findIndex(item=>item.name==='new.md');
    return (await f.request({...nativeScan,phase:'apply',planId:plan.planId,accept:[index]})).result.done[0].dest;
  }
  const first=await confirm(plans[0]);
  assert.equal(await confirm(plans[1]),first);
  await f.put(path.join(f.vault,first),'student revision');
  const copy=await confirm(plans[2]);
  assert.notEqual(copy,first);
  assert.equal(await fs.readFile(path.join(f.vault,first),'utf8'),'student revision');
  assert.equal(await fs.readFile(path.join(f.vault,copy),'utf8'),'xyz');
});
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

async function frameworkImport(t) {
  const f=await fixture(t);
  const documents=new Map([['A.md','locked source'],['B.md','good source'],['C.md','left unticked']]);
  for (const [name,content] of documents) await f.put(f.source(name),content);
  const locked=new Set(), writes=[];
  const io=require('node:fs'), {Readable}=require('node:stream'), open=io.createReadStream;
  t.mock.method(io,'createReadStream',function(file,options) {
    if (locked.has(file)) return Readable.from((async function*(){
      yield Buffer.from('partial input');
      throw Object.assign(new Error('sharing violation'),{code:'EBUSY'});
    })());
    return open.call(this,file,options);
  });
  f.state.frameworkRun=async options=>{
    if (options.mode==='read') {
      const items=[];
      for (const m of options.prompt.matchAll(/\{"id":(\d+),[^\n]*?"name":"([^"]+)"/g)) {
        if (documents.has(m[2])) items.push({id:Number(m[1]),dest:'Math/'+m[2]});
      }
      return {result:{items},reads:[]};
    }
    const inputDir=(await fs.readdir(options.cwd)).find(entry=>entry.startsWith('.graphite-inputs-'));
    const steps=[...options.prompt.matchAll(/\d+\. Copy the file "([^"]+)" to "([^"]+)"/g)];
    const stagedInputs=await fs.readdir(path.join(options.cwd,inputDir));
    assert.deepEqual(stagedInputs.sort(),steps.map(m=>path.basename(m[1])).sort());
    assert.deepEqual(options.allow.roots,[options.cwd]);
    writes.push(steps.map(m=>m[2]));
    for (const m of steps) {
      assert.equal(path.isAbsolute(m[1]),false);
      await f.put(path.join(options.cwd,m[2]),await fs.readFile(path.join(options.cwd,m[1])));
    }
    await f.state.afterWrite?.(options);
    return {};
  };
  const plan=async()=> (await f.request({phase:'plan'})).result;
  const apply=(p,names,progress)=>f.request({phase:'apply',lang:'zh-CN',planId:p.planId,
    accept:p.items.flatMap((it,i)=>names.includes(it.name)?[i]:[])},progress);
  const saved=name=>path.join(f.vault,'Math',name);
  return {...f,locked,writes,plan,apply,saved};
}

test('after confirmation a busy source fails individually; rescan retries only that source with the same framework',async t=>{
  const f=await frameworkImport(t);
  const first=await f.plan();
  assert.deepEqual(first.items.map(i=>i.name).sort(),['A.md','B.md','C.md']);
  assert.deepEqual(f.writes,[]);assert.equal(await f.exists(f.saved('B.md')),false);
  const cancelled=await f.apply(first,[]);
  assert.deepEqual(cancelled.result.done,[]);assert.deepEqual(f.writes,[]);
  const confirmed=await f.plan();
  f.locked.add(f.source('A.md'));
  const {result}=await f.apply(confirmed,['A.md','B.md']);
  assert.equal(result.framework,'codex');assert.deepEqual(result.done.map(i=>i.name),['B.md']);
  assert.deepEqual(result.failed,[{src:confirmed.items.find(it=>it.name==='A.md').src,name:'A.md',dest:'Math/A.md',code:'sourceBusy',error:'来源文件正被占用，关闭后可重试。'}]);
  assert.deepEqual(f.writes,[['Math/B.md']]);assert.equal(await fs.readFile(f.saved('B.md'),'utf8'),'good source');
  assert.equal(await f.exists(f.saved('A.md')),false);assert.equal(await f.exists(f.saved('C.md')),false);
  f.locked.clear();
  const retry=await f.plan();
  assert.deepEqual(retry.items.map(i=>i.name).sort(),['A.md','C.md']);
  const {result:finished}=await f.apply(retry,['A.md']);
  assert.equal(finished.framework,'codex');assert.deepEqual(finished.failed,[]);
  assert.deepEqual(f.writes,[['Math/B.md'],['Math/A.md']]);assert.equal(await fs.readFile(f.saved('A.md'),'utf8'),'locked source');
  assert.deepEqual((await fs.readdir(path.dirname(f.saved('B.md')))).filter(n=>/^[ABC]/.test(n)).sort(),['A.md','B.md']);
  assert.deepEqual([...new Set(f.state.calls)],['codex']);
});

test('all selected sources unavailable reports every file without running the framework writer',async t=>{
  const f=await frameworkImport(t), plan=await f.plan();
  f.locked.add(f.source('A.md'));await fs.unlink(f.source('B.md'));
  const {result}=await f.apply(plan,['A.md','B.md']);
  assert.deepEqual(result.done,[]);assert.equal(result.framework,'codex');
  assert.deepEqual(Object.fromEntries(result.failed.map(it=>[it.name,it.code])),{'A.md':'sourceBusy','B.md':'sourceMissing'});
  assert.ok(result.failed.every(it=>it.error && it.src && it.dest));assert.deepEqual(f.writes,[]);
  assert.equal(result.retry.count,2);assert.equal(result.retry.framework,'codex');
  assert.deepEqual(f.state.calls,['codex']);assert.equal(await f.exists(path.join(f.vault,'.obsidian')),false);
});

test('one-click retry preserves the confirmed executor and only imports failed items, even when new files arrive',async t=>{
  const f=await frameworkImport(t), plan=await f.plan();
  f.locked.add(f.source('A.md'));
  const {result}=await f.apply(plan,['A.md','B.md']);
  assert.equal(result.retry.count,1);assert.equal(result.retry.framework,'codex');
  const resume={job:'import',phase:'resumeImport',recoveryId:result.retry.id};
  assert.equal((await f.request({...resume,framework:null,provider:'graphite'})).status,409);
  assert.equal((await f.request({...resume,framework:'dsh'})).status,409);
  assert.equal((await f.request({...resume,accept:[0,1]})).status,400);
  assert.equal((await f.request({...resume,destinations:{0:'Other/A.md'}})).status,400);
  assert.equal((await f.reopen(resume)).status,410);
  f.state.activeVault=path.join(f.vault,'different');
  assert.equal((await f.request(resume)).status,409);f.state.activeVault=null;
  await f.put(f.source('D.md'),'arrived after selection');
  const busy=(await f.request(resume)).result;
  assert.equal(busy.framework,'codex');assert.equal(busy.retry.count,1);assert.notEqual(busy.retry.id,result.retry.id);
  assert.equal((await f.request(resume)).status,410);
  f.locked.clear();
  const results=await Promise.all([1,2].map(()=>f.request({...resume,recoveryId:busy.retry.id})));
  assert.equal(results.filter(r=>r.status===410).length,1);
  const {result:saved}=results.find(r=>r.result);
  assert.deepEqual(saved.done.map(it=>it.dest),['Math/A.md']);assert.deepEqual(saved.failed,[]);assert.equal(saved.retry,undefined);
  assert.deepEqual(f.writes,[['Math/B.md'],['Math/A.md']]);assert.equal(await f.exists(f.saved('C.md')),false);
  assert.equal(await f.exists(f.saved('D.md')),false);assert.equal(await fs.readFile(f.saved('A.md'),'utf8'),'locked source');
});

test('source retry honors current grants, expiry and the original manual destination',async t=>{
  const f=await frameworkImport(t);
  const {result:plan}=await f.request(nativeScan), i=plan.items.findIndex(it=>it.name==='A.md');
  f.locked.add(f.source('A.md'));
  async function fail(plan,i) {
    return (await f.request({...nativeApply(plan,[i]),destinations:{[i]:'Chosen/A.md'}})).result.retry;
  }
  const token=await fail(plan,i);
  assert.equal(token.provider,'graphite');
  const request={...nativeScan,phase:'resumeImport',recoveryId:token.id};
  f.state.courseRoots=[];assert.equal((await f.request(request)).status,409);f.state.courseRoots=null;
  f.state.readOnly=['Chosen'];assert.equal((await f.request(request)).status,400);f.state.readOnly=null;
  f.locked.clear();
  assert.deepEqual((await f.request(request)).result.done.map(it=>it.dest),['Chosen/A.md']);
  assert.equal(await f.exists(f.saved('A.md')),false);
  const pending=(await f.request(nativeScan)).result, b=pending.items.findIndex(it=>it.name==='B.md');
  f.locked.add(f.source('B.md'));
  const last=(await f.request(nativeApply(pending,[b]))).result.retry;
  const later=Date.now()+3600_001;
  t.mock.method(Date,'now',()=>later);
  assert.equal((await f.request({...request,recoveryId:last.id})).status,410);
  assert.equal(await f.exists(f.saved('B.md')),false);
});

test('retry after another scan already imported the same source preserves the existing copy and collisions',async t=>{
  const f=await frameworkImport(t), plan=await f.plan();
  f.locked.add(f.source('A.md'));
  const {result:failed}=await f.apply(plan,['A.md']);
  await f.put(f.saved('A.md'),'unrelated existing notes');f.locked.clear();
  const {result:other}=await f.apply(await f.plan(),['A.md']);
  assert.equal(other.done[0].dest,'Math/A 1.md');
  const {result:retry}=await f.request({phase:'resumeImport',recoveryId:failed.retry.id});
  assert.deepEqual(retry.done.map(it=>it.dest),['Math/A 1.md']);assert.deepEqual(retry.failed,[]);
  assert.equal(await fs.readFile(f.saved('A.md'),'utf8'),'unrelated existing notes');
  assert.equal(await fs.readFile(f.saved('A 1.md'),'utf8'),'locked source');
  assert.equal(await f.exists(f.saved('A 2.md')),false);
});

test('a genuine framework failure remains separate from unavailable inputs and publishes nothing',async t=>{
  const f=await frameworkImport(t), plan=await f.plan(); f.locked.add(f.source('A.md'));
  f.state.afterWrite=()=>{throw Object.assign(new Error('framework unavailable'),{code:'auth',framework:'codex'});};
  const failure=await f.apply(plan,['A.md','B.md']);
  assert.equal(failure.code,'auth');assert.equal(failure.framework,'codex');assert.equal(failure.result,undefined);
  assert.deepEqual(failure.failed.map(item=>[item.name,item.code]),[['A.md','sourceBusy']]);
  assert.equal(failure.recovery,undefined);assert.equal(await f.exists(f.saved('B.md')),false);
  assert.deepEqual(f.writes,[['Math/B.md']]);
  // The app retains a failed runner's own stage for inspection.
  if (failure.stage) await fs.rm(failure.stage,{recursive:true,force:true});
});

test('a source changed while the framework was copying is not recorded as a successful import',async t=>{
  const f=await frameworkImport(t), plan=await f.plan();
  f.state.afterWrite=()=>f.put(f.source('A.md'),'edited source');
  const {result}=await f.apply(plan,['A.md','B.md']);
  assert.deepEqual(result.done.map(it=>it.name),['B.md']);assert.deepEqual(result.failed.map(it=>it.code),['sourceChanged']);
  assert.equal(await f.exists(f.saved('A.md')),false);assert.equal(await fs.readFile(f.saved('B.md'),'utf8'),'good source');
  assert.ok((await f.plan()).items.some(it=>it.name==='A.md'));
});

test('a full staging disk is reported as a job error before the framework runs',async t=>{
  const f=await frameworkImport(t), plan=await f.plan(), write=fs.writeFile;
  t.mock.method(fs,'writeFile',async function(file,...args) {
    if (path.basename(path.dirname(file)).startsWith('.graphite-inputs-')) {
      throw Object.assign(new Error('staging disk full'),{code:'ENOSPC'});
    }
    return write.call(this,file,...args);
  });
  const failure=await f.apply(plan,['A.md','B.md']);
  assert.equal(failure.code,'ENOSPC');assert.equal(failure.failed,undefined);
  assert.deepEqual(f.writes,[]);assert.equal(await f.exists(f.saved('A.md')),false);assert.equal(await f.exists(f.saved('B.md')),false);
});

test('closing the import during the framework check prevents publication',async t=>{
  const f=await frameworkImport(t), plan=await f.plan();
  const failure=await f.apply(plan,['A.md','B.md'],(progress,res)=>{if(progress.step==='check')res.emit('close');});
  assert.ok(failure.error);assert.equal(failure.result,undefined);
  assert.equal(await f.exists(f.saved('A.md')),false);assert.equal(await f.exists(f.saved('B.md')),false);
  assert.equal(await f.exists(path.join(f.vault,'.obsidian')),false);
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
