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
  const agent=createAgent({
    vault:()=>vault, inVault:rel=>path.join(vault,rel), toRel:p=>path.relative(vault,p).split(path.sep).join('/'), exists,
    HttpError, COMPAT:{}, LANG_NAMES:{}, readBody:async req=>Buffer.from(JSON.stringify(req.body)),
    withFileLock:(_,f)=>f(), atomicWrite:put,
    officeToPdf:async (source,pdf)=>put(pdf,Buffer.concat([Buffer.from('%PDF mock\n'),await fs.readFile(source)])),
    uniquePath:async file=>{ const ext=path.extname(file), stem=file.slice(0,-ext.length); let target=file, n=1;
      while(await exists(target)) target=stem+' ('+(++n)+')'+ext;return target; },
    study:{load:async()=>({courseRoots:[courses],courses:{M:'Math'},skipFolders:[],readOnlyFolders:['Protected'],lookElsewhere:false}),file:()=>''},
    PROFILE:{outputLanguage:()=> 'English',promptBlock:()=>''},
    frameworks:{ids:['codex','dsh'],run:async id=>{
      state.calls.push(id);
      if(state.error)throw Object.assign(new Error('Framework stopped'),{code:state.error,framework:id});
      return {result:{items:[]},reads:[]};
    }},
  });
  async function request(body) {
    const resp=new EventEmitter(), lines=[];
    resp.writeHead=()=>{};resp.write=line=>lines.push(JSON.parse(line));resp.end=()=>{};
    try { await agent.handle({headers:{},body:{job:'import',framework:'codex',...body}},resp); }
    catch(e) {return {error:e.message,status:e.status};}
    return lines.at(-1);
  }
  return {state,vault,request,source,original,exists,put};
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
