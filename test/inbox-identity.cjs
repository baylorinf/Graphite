'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const createAgent = require('../agent.js');

const marker = 'cap-20261121-045959';
const note = 'Claude Inbox.md';
function entry(quote, id=marker, filed=false) {
  return '- ['+(filed?'x':' ')+'] **Interesting** · 2026-11-21 · [[Lesson]] %%'+id+'%%'+
    (filed?' → [[Previously filed]] (2026-11-20)':'')+'\r\n  > '+quote+'\r\n';
}

async function fixture(t, fw) {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(),'graphite-capture-identity-'));
  t.after(()=>fs.rm(vault,{recursive:true,force:true}));
  const read = rel=>fs.readFile(path.join(vault,rel),'utf8');
  const write = (rel,value)=>fs.writeFile(path.join(vault,rel),value);
  const hash = bytes=>createHash('sha256').update(bytes).digest('hex');
  const state = {}, locks = new Map();
  function answer(prompt) {
    const captures = prompt.match(/<captures>\n([\s\S]*?)\n<\/captures>/)[1].split('\n').map(JSON.parse);
    return {items:captures.map(c=>({id:c.id,target:'Filed.md',text:'FILED '+c.quote,shown:c.quote}))};
  }
  const config = {
    HttpError:class extends Error {constructor(status,message) {super(message);this.status=status;}},
    hash, vault:()=>vault, inVault:rel=>path.join(vault,rel), toRel:p=>path.relative(vault,p).replaceAll('\\','/'),
    exists:async p=>!!(await fs.stat(p).catch(()=>null)), LANG_NAMES:{},COMPAT:{custom:{}},
    parseJsonReply:s=>JSON.parse(s),
    readBody:async req=>{const chunks=[];for await (const chunk of req) chunks.push(chunk);return Buffer.concat(chunks);},
    atomicWrite:async (file,data,opts)=>{await state.beforeWrite?.(file,data);await opts?.beforeReplace?.();await fs.writeFile(file,data);},
    withFileLock:async(file,fn)=>{
      const previous=locks.get(file) || Promise.resolve();
      const pending=previous.then(fn); locks.set(file,pending.catch(()=>{}));
      return pending;
    },
    compatCaller:()=>({P:{},call:async (route,opts)=>({choices:[{message:{content:JSON.stringify(answer(JSON.parse(opts.body).messages[1].content))}}]})}),
    frameworks:{ids:['codex'],run:async(id,opts)=>{
      if (opts.mode==='read') return {result:answer(opts.prompt),reads:[]};
      state.writes=(state.writes || 0)+1;
      for (const m of opts.prompt.matchAll(/Write the file "([^"]+)"[^\n]*\n<<<GRAPHITE-FILE\n([\s\S]*?)\nGRAPHITE-FILE>>>/g)) {
        await fs.writeFile(path.join(opts.cwd,m[1]),m[2]+'\n');
      }
      await state.onStage?.();
      return {result:{done:[]}};
    }}
  };
  let agent=createAgent(config);
  const server=http.createServer((req,res)=>agent.handle(req,res).catch(e=>{res.writeHead(e.status || 500);res.end(JSON.stringify({error:e.message}));}));
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve); server.closeAllConnections();}));
  async function request(body) {
    const who=fw?{framework:'codex'}:{provider:'custom',model:'fixture'};
    const res=await fetch('http://127.0.0.1:'+server.address().port,{method:'POST',body:JSON.stringify({job:'inbox',...who,...body})});
    return JSON.parse((await res.text()).trim().split('\n').at(-1));
  }
  await write('Filed.md','Original\n');
  return {write,read,state,open:()=>{agent=createAgent(config);},plan:async()=> (await request({phase:'plan'})).result,
    apply:(p,accept)=>request({phase:'apply',planId:p.planId,accept,acceptEdits:[]})};
}

for (const local of [false,true]) {
  const label=local?'staged framework':'API';
  test(label+' files only the selected legacy duplicate, preserving both old checked rows and CRLF',async t=>{
    const f=await fixture(t,local);
    const before=entry('earlier',marker,true)+entry('first')+entry('second')+entry('unique','cap-unique');
    await f.write(note,before);
    const p=await f.plan();
    assert.equal(p.items.length,3);
    assert.notEqual(p.items[0].id,p.items[1].id);
    assert.equal(p.items[2].id,'cap-unique');
    await f.write(note,'# unrelated new line\r\n'+before);
    const {result}=await f.apply(p,[1]);
    assert.deepEqual(result.failed,[]);
    assert.deepEqual(result.done.map(i=>i.id),[p.items[1].id]);
    assert.equal(await f.read('Filed.md'),'Original\n\nFILED second\n');
    const saved=await f.read(note);
    assert.ok(saved.startsWith('# unrelated new line\r\n'+entry('earlier',marker,true)+entry('first')));
    assert.match(saved,/%% → \[\[Filed\|second\]\] \(\d{4}-\d{2}-\d{2}\)\r\n  > second/);
    f.open();
    const remaining=await f.plan();
    assert.deepEqual(remaining.items.map(i=>i.quote),['first','unique']);
    assert.equal(remaining.items[0].id,p.items[0].id);
  });
  test(label+' excludes edited and already filed entries from stale confirmations across windows',async t=>{
    const f=await fixture(t,local);
    await f.write(note,entry('first')+entry('second')+entry('long original','cap-unique'));
    const a=await f.plan(), b=await f.plan();
    assert.equal((await f.apply(a,[1])).result.done.length,1);
    await f.write(note,(await f.read(note)).replace('  > long original','  > user revision'));
    const {result}=await f.apply(b,[1,2]);
    assert.equal(result.done.length,0); assert.equal(result.failed.length,2);
    assert.equal(await f.read('Filed.md'),'Original\n\nFILED second\n');
    assert.match(await f.read(note),/\[ \].*cap-unique%%\r?\n  > user revision/);
    if (local) assert.equal(f.state.writes,1);
  });
  test(label+' can select the second byte-identical entry; a changed count requires refreshing',async t=>{
    const f=await fixture(t,local);
    await f.write(note,entry('same')+entry('same'));
    const p=await f.plan();
    assert.equal((await f.apply(p,[1])).result.done.length,1);
    assert.ok((await f.read(note)).startsWith(entry('same')+'- [x] '));
    const fresh=await f.plan();
    await f.write(note,(await f.read(note))+entry('same'));
    assert.equal((await f.apply(fresh,[0])).result.failed.length,1);
    assert.equal(await f.read('Filed.md'),'Original\n\nFILED same\n');
  });
}

test('staged write rechecks inbox identity before writing any target; newer edits survive rollback',async t=>{
  const f=await fixture(t,true);
  await f.write(note,entry('first'));
  const first=await f.plan();
  f.state.onStage=async()=>{await f.write(note,entry('edited while staging'));};
  const stale=await f.apply(first,[0]);
  assert.equal(stale.code,'applyFailed'); assert.equal(await f.read('Filed.md'),'Original\n');
  assert.equal(await f.read(note),entry('edited while staging'));
  const next=await f.plan();
  delete f.state.onStage;
  const external='# changed by another writer\r\n';
  f.state.beforeWrite=async file=>{
    if (path.basename(file)==='Filed.md') {await f.write(note,external);throw new Error('simulated target write refusal');}
  };
  const conflict=await f.apply(next,[0]);
  assert.equal(conflict.code,'applyChanged',JSON.stringify(conflict));
  assert.equal(await f.read(note),external); assert.equal(await f.read('Filed.md'),'Original\n');
  for (const stage of [stale.stage,conflict.stage]) {
    assert.equal(path.dirname(path.resolve(stage)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(stage).startsWith('graphite-stage-'));
    await fs.rm(stage,{recursive:true,force:true});
  }
});
