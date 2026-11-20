'use strict';
// Uses Graphite's HTTP routes, synthetic course data and a model served only on loopback.
require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {start:modelServer} = require('./fake-llm.cjs');
function latch() {
  let resolve;
  const promise = new Promise(done=>{resolve=done;});
  return {promise,resolve};
}
async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(),'graphite-record-revisions-'));
  const name='Claude Brain/log.md', file=path.join(vault,name);
  const old='Original personal record.\n', fresh='Another window added a separate sentence.\n';
  let readByModel, respond;
  const model=await modelServer(async({body})=>{
    const result=body.messages.find(m=>m.role==='tool');
    if(!result)return {tool:{name:'read_file',input:{path:name}}};
    readByModel.resolve(result.content);
    await respond.promise;
    return {tool:{name:'submit_plan',input:{items:[],edits:[{path:name,content:old+'Proposed evidence.\n'}],summary:'Record the fixture evidence.'}}};
  });
  process.env.GRAPHITE_TEST_AI_BASE=model.url+'/v1';
  const server=await require('../server').start({vault});
  async function request(body) {
    const response=await fetch('http://127.0.0.1:'+server+'/api/agent',{method:'POST',
      headers:{'Content-Type':'application/json','X-Vault':'1','X-AI-Key':'fixture'},body:JSON.stringify({
        provider:'custom',model:'fixture',baseUrl:model.url+'/v1',phase:'plan',history:[{role:'user',content:'Synthetic evidence.'}],...body})});
    return JSON.parse((await response.text()).trim().split('\n').at(-1));
  }
  try {
    await fs.mkdir(path.dirname(file));
    await fs.writeFile(path.join(vault,'Claude Inbox.md'),'# Inbox\n- [ ] **Interesting** · 2026-11-20 · [[A]] %%cap-1%%\n  > Fixture capture.\n');
    for(const job of ['brain','inbox']){
      for(const change of ['edited','same metadata','created','deleted']){
        if(change==='created')await fs.rm(file,{force:true});else await fs.writeFile(file,old);
        readByModel=latch();respond=latch();const pending=request({job});
        const previous=await Promise.race([readByModel.promise,pending.then(data=>{throw new Error('Stopped before review: '+JSON.stringify(data));})]);
        if(change!=='created')assert.equal(previous,old);
        const replacement=change==='same metadata' ? old.replace('Original','Personal') : fresh;
        if(change==='deleted')await fs.unlink(file);
        else if(change==='same metadata'){
          const stat=await fs.stat(file);await fs.writeFile(file,replacement);await fs.utimes(file,stat.atime,stat.mtime);
        }else await fs.writeFile(file,replacement);
        respond.resolve();const plan=await pending;
        assert.match(plan.error,/changed while preparing/i);assert.equal(plan.result?.planId,undefined);
        assert.equal(await fs.readFile(file,'utf8').catch(e=>{if(e.code==='ENOENT')return null;throw e;}),change==='deleted'?null:replacement);
        console.log('PASS',job,change,'while planning: no stale replacement offered or written');
      }
    }
    await fs.writeFile(file,old);readByModel=latch();respond=latch();respond.resolve();
    const prepared=await request({job:'brain'});assert.ok(prepared.result.planId);
    await fs.writeFile(file,fresh);
    const applied=await request({job:'brain',phase:'apply',planId:prepared.result.planId,acceptEdits:[0]});
    assert.equal(applied.result.failed.length,1);assert.deepEqual(applied.result.edited,[]);assert.equal(await fs.readFile(file,'utf8'),fresh);
    console.log('PASS changes made after the preview survive confirmation');
    for(const createdMeanwhile of [false,true]){
      await fs.rm(file,{force:true});readByModel=latch();respond=latch();respond.resolve();
      const plan=await request({job:'brain'});assert.ok(plan.result.planId);
      if(createdMeanwhile)await fs.writeFile(file,fresh);
      const result=await request({job:'brain',phase:'apply',planId:plan.result.planId,acceptEdits:[0]});
      assert.equal(result.result.failed.length,createdMeanwhile?1:0);
      assert.equal(await fs.readFile(file,'utf8'),createdMeanwhile?fresh:old+'Proposed evidence.\n');
      console.log('PASS',createdMeanwhile?'an independently created note survives confirmation':'a confirmed new study record is written in full');
    }
  } finally {
    respond?.resolve();await model.close();await fs.rm(vault,{recursive:true,force:true,maxRetries:3});
  }
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});
