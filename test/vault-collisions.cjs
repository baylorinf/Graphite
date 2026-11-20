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
    const noteName='Retry after a full disk.md',target=path.join(vault,noteName),marker='Real note after retry';
    const originalOpen=fs.open,originalWrite=fs.writeFile;
    let failureCount=0;
    function partialFault(){failureCount++;throw Object.assign(new Error('Synthetic shortage while creating a note'),{code:'ENOSPC'});}
    fs.writeFile=async(file,body,...other)=>{
      if(file===target && Buffer.from(body).toString()===marker){
        await originalWrite(file,Buffer.from(body).subarray(0,4),...other);partialFault();
      }
      return originalWrite(file,body,...other);
    };
    fs.open=async(file,...args)=>{
      const handle=await originalOpen(file,...args),write=handle.writeFile.bind(handle);
      handle.writeFile=async(body,...other)=>{
        if(typeof file==='string' && path.dirname(file)===vault && Buffer.from(body).toString()===marker){
          await write(Buffer.from(body).subarray(0,4),...other);partialFault();
        }
        return write(body,...other);
      };
      return handle;
    };
    try { assert.equal((await call('file',noteName,'POST',marker)).status,500); }
    finally { fs.writeFile=originalWrite;fs.open=originalOpen; }
    assert.equal(failureCount,1);
    await assert.rejects(fs.stat(target),{code:'ENOENT'},'A failed create must not leave a truncated note');
    assert.equal((await call('file',noteName,'POST',marker)).status,200,'Retry the original filename');
    assert.equal(await fs.readFile(target,'utf8'),marker);
    console.log('PASS failed first save leaves no truncated note, retry preserves name and contents');
    const realLink=fs.link;
    fs.link=async()=>{throw Object.assign(new Error('Synthetic removable drive'),{code:'ENOTSUP'});};
    try {
      const competing=await Promise.all(['one','two'].map(text=>call('file','Removable.md','POST',text)));
      assert.deepEqual(competing.map(r=>r.status).sort(),[200,409]);
      assert.equal(await fs.readFile(path.join(vault,'Removable.md'),'utf8'),competing[0].status===200?'one':'two');
      assert.equal((await fs.readdir(vault)).some(name=>name.startsWith('.graphite-create-')),false);
    } finally { fs.link=realLink; }
    console.log('PASS exclusive creation also keeps the winner and cleans up on a drive without hard links');
    await fs.writeFile(path.join(vault,'Grade 100%.md'),'final grade');
    const link=tail=>fetch('http://127.0.0.1:'+port+'/vault/'+tail,{headers:{'X-App-Token':'fixture'}});
    for(const url of ['Grade%20100%25.md','Grade%20100%.md']){
      const response=await link(url);assert.equal(response.status,200);assert.equal(await response.text(),'final grade');
    }
    assert.equal((await link('broken%E4.md')).status,400);
    console.log('PASS encoded and literal percent in filenames, invalid UTF-8 in a URL reports a client error');
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
