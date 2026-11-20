'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {spawn} = require('node:child_process');
const pause = ms => new Promise(resolve=>setTimeout(resolve,ms));
const serverPath = require.resolve(process.env.GRAPHITE_LOCK_TEST_SERVER || '../server');
const {withFileLock} = require(serverPath);

async function fixture(t) {
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-file-lock-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true,maxRetries:3}));
  const file=path.join(dir,'Example.md'), lock=path.join(dir,'.Example.md.graphite-lock');
  await fs.writeFile(file,'original\n');
  return {file,lock};
}

for(const code of ['EPERM','EBUSY','EACCES']){
  test('exclusive creation retries transient '+code,async t=>{
    const {file,lock}=await fixture(t), open=fs.open;let attempts=0,callbacks=0;
    t.mock.method(fs,'open',function(name,flags,...args){
      if(name===lock && flags==='wx' && ++attempts<=2)throw Object.assign(new Error('temporary '+code),{code});
      return open.call(this,name,flags,...args);
    });
    await withFileLock(file,async()=>{callbacks++;await fs.appendFile(file,'accepted\n');});
    assert.ok(attempts>=3);assert.equal(callbacks,1);
    assert.equal(await fs.readFile(file,'utf8'),'original\naccepted\n');
  });
}

test('a persistent access denial returns the original error without running the write',async t=>{
  const {file,lock}=await fixture(t), open=fs.open;let attempts=0;
  const denied=Object.assign(new Error('fixture: ACL denies lock creation'),{code:'EACCES',path:lock});
  t.mock.method(fs,'open',function(name,flags,...args){
    if(name===lock && flags==='wx'){attempts++;throw denied;}return open.call(this,name,flags,...args);
  });
  const began=Date.now();
  await assert.rejects(withFileLock(file,()=>assert.fail('write was called')),e=>e===denied);
  assert.ok(attempts>1 && Date.now()-began<8000,'real permission errors must be bounded');
  assert.equal(await fs.readFile(file,'utf8'),'original\n');
});

test('temporary sharing on release does not strand the next write',async t=>{
  const {file,lock}=await fixture(t), unlink=fs.unlink;
  let calls=0;
  t.mock.method(fs,'unlink',function(name,...args){
    if(name===lock && ++calls<=2)throw Object.assign(new Error('fixture: pending Windows release'),{code:'EPERM'});
    return unlink.call(this,name,...args);
  });
  await withFileLock(file,()=>fs.appendFile(file,'first\n'));
  await withFileLock(file,()=>fs.appendFile(file,'second\n'));
  assert.ok(calls>=4);
  assert.equal(await fs.readFile(file,'utf8'),'original\nfirst\nsecond\n');
});

async function otherWriter(t,file) {
  const program=`const fs=require('node:fs/promises'),file=process.argv[2];
    require(process.argv[1]).withFileLock(file,async()=>{
      const text=await fs.readFile(file,'utf8');
      process.send('held');
      const instruction=await new Promise(resolve=>process.once('message',resolve));
      if(instruction==='crash')process.exit(0); // exercise unexpected exit before the lock is released
      await fs.writeFile(file,text+'first\\n');
    }).then(()=>process.exit(0),e=>{console.error(e);process.exit(1);});`;
  const child=spawn(process.execPath,['-e',program,serverPath,file],{windowsHide:true,stdio:['ignore','ignore','inherit','ipc']});
  const exited=new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  await Promise.race([new Promise(resolve=>child.once('message',resolve)),exited.then(code=>{throw Error('Writer exited early: '+code);})]);
  return async instruction=>{child.send(instruction);assert.equal(await exited,0);};
}

test('another Graphite process still owns its lock after ten seconds',async t=>{
  const {file,lock}=await fixture(t), finish=await otherWriter(t,file);
  await pause(10350);
  const lastBeat=(await fs.stat(lock)).mtimeMs;
  assert.ok(Date.now()-lastBeat<5000,'a live holder should renew its lock for other machines');
  const old=new Date(Date.now()-60000);await fs.utimes(lock,old,old); // missed heartbeat still has a live local owner
  let secondEntered=false;
  const second=withFileLock(file,async()=>{
    secondEntered=true;const text=await fs.readFile(file,'utf8');await fs.writeFile(file,text+'second\n');
  });
  await pause(300);const overlapped=secondEntered;await finish('release');await second;
  assert.equal(overlapped,false,'the second callback entered before the first released its lock');
  assert.equal(await fs.readFile(file,'utf8'),'original\nfirst\nsecond\n');
});

test('recovers a lock left by an exited Graphite process',async t=>{
  const {file,lock}=await fixture(t), finish=await otherWriter(t,file);
  await finish('crash');
  assert.ok((await fs.readFile(lock,'utf8')).length>0);
  const old=new Date(Date.now()-60000);await fs.utimes(lock,old,old);
  // Also recover a prior cleanup process that stopped after claiming an old lock.
  await fs.mkdir(lock+'.recover');await fs.utimes(lock+'.recover',old,old);
  await withFileLock(file,()=>fs.appendFile(file,'recovered\n'));
  assert.equal(await fs.readFile(file,'utf8'),'original\nrecovered\n');
});

test('an abandoned empty lock from a previous version recovers without losing parallel writes',async t=>{
  const {file,lock}=await fixture(t);await fs.writeFile(lock,'');
  const old=new Date(Date.now()-60000);await fs.utimes(lock,old,old);
  let owners=0,peak=0;
  const writes=Array.from({length:12},(_,i)=>withFileLock(file,async()=>{
    peak=Math.max(peak,++owners);
    try{
      const text=await fs.readFile(file,'utf8');await pause(30);await fs.writeFile(file,text+i+'\n');
    }finally{owners--;}
  }));
  await Promise.all(writes);assert.equal(peak,1);
  const saved=(await fs.readFile(file,'utf8')).trim().split('\n');assert.equal(saved.shift(),'original');
  assert.deepEqual(saved.map(Number).sort((a,b)=>a-b),Array.from({length:12},(_,i)=>i));
});
