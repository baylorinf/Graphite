'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const repo = path.resolve(process.argv[2] || path.join(__dirname,'..'));
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'graphite-vault-collisions-'));
  process.env.GRAPHITE_HOME = path.join(root,'settings');
  process.env.GRAPHITE_CLAUDE_DIR = path.join(root,'claude');
  const vault = path.join(root,'vault');
  const port = await require(path.join(repo,'server.js')).start({vault,port:0,token:'fixture'});
  const call = async (action,rel,method='GET',body)=>{
    const url = new URL('http://127.0.0.1:'+port+'/api/'+action);
    url.searchParams.set('path',rel);
    const response = await fetch(url,{method,body,headers:{'X-Vault':'1','X-App-Token':'fixture'}});
    return {status:response.status,body:await response.json()};
  };
  try {
    const bytes = Array.from({length:10},(_,i)=>Buffer.from([i,0,255,7]));
    const uploads = await Promise.all(bytes.map(b=>call('upload','附件/题图 一.png','POST',b)));
    for (const r of uploads) assert.equal(r.status,200);
    const names = uploads.map(r=>r.body.path);
    assert.equal(new Set(names).size,bytes.length,'Simultaneous attachments must each keep a distinct name');
    for (const [i,name] of names.entries()) assert.deepEqual(await fs.readFile(path.join(vault,name)),bytes[i]);
    const notes = Array.from({length:8},(_,i)=>'Course '+i+'/作业.md');
    const created = await Promise.all(notes.map((rel,i)=>call('file',rel,'POST','submission '+i)));
    for (const r of created) assert.equal(r.status,200);
    const removed = await Promise.all(notes.map(rel=>call('file',rel,'DELETE')));
    for (const r of removed) assert.equal(r.status,200);
    const trash = path.join(vault,'.trash');
    const saved = await Promise.all((await fs.readdir(trash)).map(n=>fs.readFile(path.join(trash,n),'utf8')));
    assert.deepEqual(saved.sort(),notes.map((_,i)=>'submission '+i).sort(),'All same-named trashed notes must remain recoverable');
    await call('file','first.md','POST','first');
    await call('file','second.md','POST','second');
    const conflict = await call('rename','','POST',JSON.stringify({from:'first.md',to:'second.md'}));
    assert.equal(conflict.status,409);
    assert.equal((await call('file','first.md')).body.content,'first');
    assert.equal((await call('file','second.md')).body.content,'second');
    const raced = await Promise.all(['first.md','second.md'].map(from=>call('rename','','POST',JSON.stringify({from,to:'共同.md'}))));
    assert.deepEqual(raced.map(r=>r.status).sort(),[200,409]);
    const winner = raced[0].status===200 ? 'first':'second', other = winner==='first'?'second':'first';
    assert.equal((await call('file','共同.md')).body.content,winner);
    assert.equal((await call('file',other+'.md')).body.content,other);
    console.log('PASS simultaneous binary attachments, same-name trash recovery, overlapping renames keep both notes');
  } finally {
    await fs.rm(root,{recursive:true,force:true,maxRetries:3});
  }
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
