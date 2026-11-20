'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main(){
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-marketplace-')),vault=path.join(root,'vault');
  process.env.GRAPHITE_HOME=path.join(root,'settings');process.env.GRAPHITE_CLAUDE_DIR=path.join(root,'claude');
  const realFetch=globalThis.fetch, repo='fixture/course-notes', id='course-notes';let listReads=0,version='1.0.0',mode='ok';
  globalThis.fetch=async url=>{
    const u=new URL(url);
    if(u.hostname==='raw.githubusercontent.com') {listReads++;return Response.json([{id,name:'Course notes',repo}]);}
    assert.equal(u.origin,'https://github.com');
    const file=u.pathname.split('/').at(-1);
    if(file==='manifest.json')return Response.json({id,name:'Course notes',version});
    if(file==='main.js')return mode==='missingMain'?new Response(null,{status:404}):new Response('// fixture v'+version);
    assert.equal(file,'styles.css');
    if(mode==='busy')return new Response(null,{status:503});
    if(mode==='noStyles')return new Response(null,{status:404});
    return new Response('/* fixture '+version+' */');
  };
  const product=path.resolve(process.argv[2] || path.join(__dirname,'..'));
  const port=await require(path.join(product,'server.js')).start({vault,token:'fixture'});
  const call=async(route,body)=>{
    const response=await realFetch('http://127.0.0.1:'+port+'/api/plugins'+route,{method:body?'POST':'GET',headers:{'X-Vault':'1','X-App-Token':'fixture','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    return {status:response.status,body:await response.json()};
  };
  const dir=path.join(vault,'.obsidian','plugins',id);
  try{
    assert.equal((await call('/community')).body[0].repo,repo);
    assert.equal((await call('/community')).body[0].id,id);assert.equal(listReads,1);
    assert.equal((await call('/install',{repo})).status,200);
    await fs.writeFile(path.join(dir,'data.json'),'{"student":"my settings"}');
    const installed=()=>fs.readFile(path.join(dir,'main.js'),'utf8');
    const style=()=>fs.readFile(path.join(dir,'styles.css'),'utf8');
    const old=await installed(),oldStyles=await style();
    version='1.1.0';mode='missingMain';
    assert.equal((await call('/install',{repo})).status,502);assert.equal(await installed(),old);
    mode='busy';assert.equal((await call('/install',{repo})).status,502,'Temporary upstream failure must not count as successful installation');
    assert.equal(await installed(),old);assert.equal(await style(),oldStyles);
    mode='ok';
    const rename=fs.rename;let refused=0;
    fs.rename=async(from,to)=>{
      if(!refused && to===path.join(dir,'manifest.json')) {refused++;throw Object.assign(new Error('Synthetic disk full'),{code:'ENOSPC'});}
      return rename(from,to);
    };
    try {assert.equal((await call('/install',{repo})).status,500);}
    finally {fs.rename=rename;}
    assert.equal(refused,1);assert.equal(await installed(),old);assert.equal(await style(),oldStyles);
    assert.equal(JSON.parse(await fs.readFile(path.join(dir,'manifest.json'),'utf8')).version,'1.0.0');
    mode='noStyles';assert.equal((await call('/install',{repo})).status,200);
    assert.equal(await installed(),'// fixture v1.1.0');
    const record=(await call('')).body.plugins.find(row=>row.manifest?.id===id);
    assert.equal(record.manifest.version,'1.1.0');assert.equal(record.hasStyles,false);
    assert.equal(await fs.readFile(path.join(dir,'data.json'),'utf8'),'{"student":"my settings"}');
    console.log('PASS marketplace listing/cache, install, interrupted update, removal of obsolete style and preserved plugin settings');
  }finally{globalThis.fetch=realFetch;await fs.rm(root,{recursive:true,force:true,maxRetries:3});}
}
main().then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
