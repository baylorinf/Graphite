// Run through Graphite's real local HTTP routes, using only an isolated vault and simulated school.
'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
async function main() {
  const vault=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-canvas-roundtrip-'));
  const state={auth:{accessToken:'fixture-token',expires:null},accountId:'5',writeEnabled:true,user:'Student',
    snapshot:{courses:[{id:'3',assignments:[{id:'19',title:'Practice'}]}],warnings:[]}};
  let stored=state,posts=0,unknown=false;
  const school=async(raw,opts)=>{
    const p=new URL(raw).pathname;
    if(p.endsWith('/19'))return Response.json({id:'19',course_id:'3',allowed_attempts:-1,submission_types:['online_text_entry']});
    if(p.endsWith('/self'))return Response.json({id:31,user_id:5,assignment_id:19,attempt:posts,submitted_at:null});
    if(p.endsWith('/submissions')&&opts.method==='POST'){
      posts++;if(unknown)throw new Error('lost connection');
      return Response.json({id:31,user_id:5,assignment_id:19,attempt:posts,submitted_at:new Date().toISOString(),workflow_state:'submitted'});
    }
    throw Error('Unexpected school request');
  };
  const repo=process.argv[2]||path.resolve(__dirname,'..');
  const {start}=require(path.join(repo,'server.js'));
  const port=await start({vault,port:0,token:'test-graphite',canvasOptions:{
    storage:{load:async()=>stored,save:async s=>{stored=structuredClone(s);}},fetch:school}});
  try{
    const endpoint='http://127.0.0.1:'+port+'/api/canvas/', headers={'X-App-Token':'test-graphite','X-Vault':'1'};
    const folder = '计算材料', name = folder + '/实验 #1 + 答案.pdf';
    const original = Buffer.from([0x25,0x50,0x44,0x46,0,0xff,0x0a]);
    await fs.mkdir(path.join(vault,folder));
    await fs.writeFile(path.join(vault,name),original);
    const attachment = rel => fetch(endpoint+'vault-file?'+new URLSearchParams({path:rel}),{headers});
    const selected = await attachment(name);
    assert.equal(selected.status,200);
    assert.equal(selected.headers.get('content-type'),'application/octet-stream');
    assert.equal(selected.headers.get('x-graphite-file-type'),'application/pdf');
    assert.deepEqual(Buffer.from(await selected.arrayBuffer()),original);
    assert.equal((await attachment(folder)).status,400);
    await fs.writeFile(path.join(vault,folder,'empty.txt'),'');
    assert.equal((await (await attachment(folder+'/empty.txt')).arrayBuffer()).byteLength,0);
    await fs.unlink(path.join(vault,name));
    assert.equal((await attachment(name)).status,404);
    const send=(uuid,n,yes=true,answer='my original answer')=>{
      const form=new FormData();
      for(const [key,value] of Object.entries({type:'online_text_entry',text:answer,courseId:'3',assignmentId:'19',
        expectedAttempt:n,confirmed:yes,requestId:uuid}))form.set(key,String(value));
      return fetch(endpoint+'submit',{method:'POST',headers,body:form});
    };
    const key=randomUUID();
    assert.equal((await send(key,0,false)).status,400);assert.equal(posts,0);
    const results=await Promise.all([send(key,0),send(key,0)]);
    assert.deepEqual(results.map(x=>x.status),[200,200]);
    assert.equal((await results[0].json()).attempt,1);assert.equal(posts,1);
    assert.equal((await send(key,0,true,'another draft')).status,409);assert.equal(posts,1);
    const current=await (await fetch(endpoint+'status',{headers})).json();
    assert.equal(current.snapshot.courses[0].assignments[0].submitted,true);
    assert.ok(!JSON.stringify(current).includes('fixture-token'));
    unknown=true;
    const key2=randomUUID(), first=await send(key2,1), retry=await send(key2,1);
    assert.equal(first.status,502); assert.equal((await first.json()).code,'submission_unknown');
    assert.equal(retry.status,502); assert.equal(posts,2);
    assert.equal(stored.requests[key2].pending,true);
    console.log('PASS multipart → authorized confirmation → remote receipt, concurrent deduplication and uncertain delivery without re-post');
  }finally{await fs.rm(vault,{recursive:true,force:true});}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
