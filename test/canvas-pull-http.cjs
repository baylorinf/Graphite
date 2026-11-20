'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');

async function main() {
  const repo=process.argv[2] || path.resolve(__dirname,'..');
  const vault=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-canvas-pull-http-'));
  const folder=path.join(vault,'Canvas','Systems (9)'), syllabus=path.join(folder,'课程要求.md');
  let revision=1, identity=null, username='Student', syncs=0, bonus=false;
  let state={portalSyncEnabled:true,webVerified:true,requests:{old:{pending:true}}};
  const snapshot=()=>({webIdentity:identity,courses:[{id:'9',name:'Systems',files:[],
    requirements:{text:'Policy version '+revision,url:'https://oc.sjtu.edu.cn/courses/9/assignments/syllabus'},
    assignments:[{id:'10',title:'Essay',description:'Write revision '+revision,dueAt:'2026-12-01T12:00:00Z'},
      ...(bonus ? [{id:'11',title:'Lab',description:'Lab version '+revision}] : [])]}]});
  try {
    const {start}=require(path.join(repo,'server.js'));
    const port=await start({vault,port:0,token:'graphite-fixture',canvasOptions:{
      desktop:{syncWeb:async opts=>{
        assert.equal(opts.fullMaterials,true); syncs++;
        return {user:username,snapshot:snapshot(),syncedAt:new Date().toISOString()};
      }},
      storage:{load:async()=>structuredClone(state),save:async next=>{state=structuredClone(next);}}
    }});
    const endpoint='http://127.0.0.1:'+port+'/api/canvas/pull';
    const pull=async()=>{
      const res=await fetch(endpoint,{method:'POST',headers:{'X-App-Token':'graphite-fixture','X-Vault':'1','Content-Type':'application/json'},body:'{}'});
      assert.equal(res.status,200);
      return res.json();
    };
    const essay=path.join(folder,'作业','Essay (10).md');
    assert.equal((await pull()).notes.saved,2);
    revision++;
    assert.equal((await pull()).notes.saved,2);
    assert.match(await fs.readFile(syllabus,'utf8'),/Policy version 2/);
    assert.match(await fs.readFile(essay,'utf8'),/Write revision 2/);
    assert.deepEqual((await fs.readdir(folder)).sort(),['作业','课程要求.md'].sort());
    await fs.writeFile(essay,'My own solution');
    revision++;
    await pull();
    const official=path.join(folder,'作业','Essay (10) (2).md');
    assert.equal(await fs.readFile(essay,'utf8'),'My own solution');
    assert.match(await fs.readFile(official,'utf8'),/Write revision 3/);
    assert.equal((await pull()).notes.saved,0);
    revision++;
    await pull();
    assert.match(await fs.readFile(official,'utf8'),/Write revision 4/);
    assert.deepEqual((await fs.readdir(path.dirname(essay))).sort(),['Essay (10).md','Essay (10) (2).md'].sort());
    username='Another student';
    assert(state.requests.old.pending);
    revision++;
    await pull();
    assert.match(await fs.readFile(official,'utf8'),/Write revision 4/);
    assert.match(await fs.readFile(syllabus,'utf8'),/Policy version 4/);
    assert.equal(syncs,6);
    assert.equal(state.requests,undefined);
    bonus=true;
    const lab=path.join(folder,'作业','Lab (11).md');
    const before='# Lab\n\nLab version '+revision+'\n';
    await fs.writeFile(lab,before);
    await pull();revision++;await pull();
    assert.equal(await fs.readFile(lab,'utf8'),before);
    assert.match(await fs.readFile(path.join(folder,'作业','Lab (11) (2).md'),'utf8'),/Lab version 6/);
    console.log('PASS full jAccount pull, same-path official changes, preserved user edits, stable alternative note and account isolation');
  } finally { await fs.rm(vault,{recursive:true,force:true}); }
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);});
