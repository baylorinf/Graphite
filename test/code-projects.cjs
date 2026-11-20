'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {createCodeProjects}=require('../code-projects');
const {atomicWrite,withFileLock,readSource}=require('../server');

async function setup(t, overrides={}) {
  const tmp=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-code-project-'));
  t.after(()=>{
    assert.equal(path.dirname(path.resolve(tmp)),path.resolve(os.tmpdir()));
    assert.ok(path.basename(tmp).startsWith('graphite-code-project-'));
    return fs.rm(tmp,{recursive:true,force:true,maxRetries:3});
  });
  const project=path.join(tmp,'高等 程序设计'), vault=path.join(tmp,'vault'), stateFile=path.join(tmp,'app-data','code-project.json');
  await fs.mkdir(project);await fs.mkdir(vault);
  const ui={picked:project};
  const options={stateFile, getVault:()=>vault, pickDirectory:async()=>ui.picked,atomicWrite,withFileLock,readSource,...overrides};
  const service=createCodeProjects(options);
  return {tmp,vault,project,stateFile,options,service,ui};
}

test('directory chosen outside the vault is remembered across restarts and a canceled picker preserves it',async t=>{
  const {service,options,ui,tmp,project,vault}=await setup(t);
  assert.deepEqual(await service.status(),{project:null});
  const picked=await service.choose(), p=picked.project;
  assert.equal(picked.canceled,false);assert.equal(p.root,await fs.realpath(project));assert.equal(p.name,path.basename(project));assert.equal(p.available,true);
  const reopened=createCodeProjects(options);
  assert.deepEqual(await reopened.status(),{project:p});
  assert.equal((await reopened.choose()).project.id,p.id);
  ui.picked=null;assert.deepEqual(await service.choose(),{canceled:true,project:p});
  const {project:v}=await reopened.useVault();assert.notEqual(v.id,p.id);assert.equal(v.root,await fs.realpath(vault));
  await assert.rejects(service.list({projectId:p.id}),{code:'project_changed'});
  ui.picked=project;const active=(await service.choose()).project;
  await fs.rename(project,path.join(tmp,'moved'));await fs.mkdir(project);
  assert.equal((await service.status()).project.available,false);
  await assert.rejects(service.create({projectId:active.id,path:'a.py'}),{code:'project_unavailable'});
  const again=(await service.choose()).project;assert.notEqual(again.id,active.id);assert.equal(again.available,true);
});

test('opening A, then B, then A restores the same draft namespace without reviving an old write grant',async t=>{
  const {service,options,ui,project,vault,tmp}=await setup(t);
  const {project:a}=await service.choose();
  const {project:b}=await service.useVault();
  assert.notEqual(a.workspaceId,b.workspaceId);
  ui.picked=project;
  const {project:again}=await createCodeProjects(options).choose();
  assert.equal(again.workspaceId,a.workspaceId);
  assert.notEqual(again.id,a.id);
  await assert.rejects(service.create({projectId:a.id,path:'old.cpp'}),{code:'project_changed'});
  assert.equal((await service.status()).project.workspaceId,a.workspaceId);
  await fs.rename(project,path.join(tmp,'retained-directory'));
  await fs.mkdir(project);
  const {project:replacement}=await service.choose();
  assert.notEqual(replacement.workspaceId,a.workspaceId);
  assert.deepEqual(await fs.readdir(vault),[]);
});

test('the currently selected pre-upgrade project keeps its original unsaved draft key after a round trip',async t=>{
  const {service,options,ui,project,stateFile}=await setup(t);
  await service.choose();
  const {id,root,dev,ino}=JSON.parse(await fs.readFile(stateFile,'utf8'));
  await fs.writeFile(stateFile,JSON.stringify({id,root,dev,ino}));
  assert.equal((await service.status()).project.workspaceId,id);
  const {project:other}=await service.useVault();
  ui.picked=project;
  const {project:restored}=await createCodeProjects(options).choose();
  assert.equal(restored.workspaceId,id);
  assert.notEqual(restored.id,id);
  assert.equal((await service.useVault()).project.workspaceId,other.workspaceId);
});

test('project tree, source, headers, plain text, empty files, UTF-8 BOM/CRLF and existing format stay in place',async t=>{
  const {service,project,vault}=await setup(t), {id:projectId}=(await service.choose()).project;
  const file=p=>({projectId,path:p});
  await service.mkdir(file('src'));
  const text='#include "../helper.h"\nint main() {return 0;}\n';
  const created=await service.create({...file('src/主 程序.cpp'),content:text,eol:'CRLF',bom:true});
  await service.create({...file('helper.h'),content:'#pragma once\n'});await service.create(file('Makefile'));await service.create(file('.gitignore'));
  assert.deepEqual((await fs.readdir(vault)),[]);
  assert.deepEqual((await service.list({projectId})).entries.map(x=>x.name),['src','.gitignore','helper.h','Makefile']);
  assert.deepEqual((await service.list(file('src'))).entries,[{name:'主 程序.cpp',path:'src/主 程序.cpp',type:'file'}]);
  const read=await service.read(file('src/主 程序.cpp'));
  assert.equal(read.content,text);assert.equal(read.revision,created.revision);assert.equal(read.editable,true);
  await service.write({...file('src/主 程序.cpp'),revision:read.revision,content:text+'// 更新\n'});
  const raw=await fs.readFile(path.join(project,'src','主 程序.cpp'));
  assert.deepEqual(raw,Buffer.from('\uFEFF'+(text+'// 更新\n').replace(/\n/g,'\r\n')));
  assert.equal((await service.resolveFile(file('helper.h'))).file,path.join(await fs.realpath(project),'helper.h'));
  assert.equal(await service.resolveRoot({projectId}),await fs.realpath(project));
  assert.equal((await service.read(file('Makefile'))).content,'');
  await assert.rejects(service.create({...file('helper.h'),content:'replacement'}),{code:'exists'});
  await assert.rejects(service.mkdir(file('src')),{code:'exists'});
});

test('simultaneous saves and outside editor changes cannot silently replace a newer revision',async t=>{
  const {service,options,project}=await setup(t),{id:projectId}=(await service.choose()).project;
  const file={projectId,path:'calc.py'},original=await service.create({...file,content:'original'});
  const second=createCodeProjects(options);
  const saved=await Promise.allSettled([service.write({...file,revision:original.revision,content:'window-one'}),
    second.write({...file,revision:original.revision,content:'window-two'})]);
  assert.equal(saved.filter(s=>s.status==='fulfilled').length,1);
  assert.equal(saved.find(s=>s.status==='rejected').reason.code,'changed');
  const fresh=await service.read(file);
  await fs.writeFile(path.join(project,file.path),'external editing');
  await assert.rejects(service.write({...file,revision:fresh.revision,content:'my unsaved change'}),{code:'changed'});
  await assert.rejects(service.write({...file,content:'no version'}),{code:'revision_required'});
  assert.equal(await fs.readFile(path.join(project,file.path),'utf8'),'external editing');
  await fs.unlink(path.join(project,file.path));
  await assert.rejects(service.write({...file,revision:fresh.revision,content:'my draft'}),{code:'changed'});
  assert.deepEqual(await fs.readdir(project),[]);
});

test('failed replacement preserves the current source and reports conflict before publishing',async t=>{
  const {service,options,project}=await setup(t),{id:projectId}=(await service.choose()).project;
  const file={projectId,path:'main.c'}, saved=await service.create({...file,content:'initial'});
  const injected=createCodeProjects({...options,atomicWrite:async(abs,bytes,options)=>{
    assert.equal(abs,path.join(project,'main.c'));await fs.writeFile(abs,'external edit');await options.beforeReplace();
    assert.fail('the changed version must not be replaced');
  }});
  await assert.rejects(injected.write({...file,revision:saved.revision,content:'ours'}),{code:'changed'});
  assert.equal(await fs.readFile(path.join(project,'main.c'),'utf8'),'external edit');
});

test('invalid project paths, binary/oversized text and mixed line endings are handled',async t=>{
  const {service,project}=await setup(t),{id:projectId}=(await service.choose()).project;
  const file=p=>({projectId,path:p});
  for(const bad of ['../other','sub/../other','/abs','C:\\outside','doc:stream','bad\0name','sub//bad','.note.graphite-lock'])
    await assert.rejects(service.create(file(bad)),{code:'invalid_path'});
  for(const [name,bytes,reason] of [['binary.bin',Buffer.from([0,1]),'encoding'],['mixed.cpp',Buffer.from('a\r\nb\n'),'mixed-eol'],
    ['large.json',Buffer.alloc(2*1024*1024+1,0x20),'size']]){
    await fs.writeFile(path.join(project,name),bytes);const result=await service.read(file(name));
    assert.equal(result.editable,false);assert.equal(result.reason,reason);
    await assert.rejects(service.write({...file(name),revision:'a'.repeat(64),content:'changed'}),{code:'changed'});
  }
});
test('project file operations stop at a directory link',async t=>{
  const {service,project,vault}=await setup(t),{id:projectId}=(await service.choose()).project;
  try { await fs.symlink(vault,path.join(project,'linked'),process.platform==='win32'?'junction':'dir'); }
  catch(err){if(err.code==='EPERM'||err.code==='EACCES')return t.skip('This environment cannot create a directory link');throw err;}
  assert.ok(!(await service.list({projectId})).entries.some(e=>e.name==='linked'));
  await assert.rejects(service.create({projectId,path:'linked/not-created.py'}),{code:'not_regular'});
  assert.deepEqual(await fs.readdir(vault),[]);
});

test('quick open ranks file names and relative paths, including Chinese and nested copies',async t=>{
  const {service,project}=await setup(t,{readSource:()=>assert.fail('a file-name search must not read contents')});
  const {id:projectId}=(await service.choose()).project;
  const names=['main.cpp','src/main.cpp','src/算法/main.cpp','src/算法/主程序.cpp',
    'src/算法/第一讲 练习.hpp','Maintain.txt','domain.txt','.gitignore','sample2.h','sample10.h'];
  for(const name of names){
    const file=path.join(project,name);
    await fs.mkdir(path.dirname(file),{recursive:true});
    await fs.writeFile(file,'');
  }
  const find=(query,limit)=>service.findFiles({projectId,query,limit});
  const found=await find('MAIN');
  assert.deepEqual(found.entries.map(e=>e.path),['main.cpp','src/main.cpp','src/算法/main.cpp','Maintain.txt','domain.txt']);
  assert.ok(found.entries.every(e=>e.type==='file' && e.name===path.posix.basename(e.path)));
  assert.equal(found.total,5);assert.equal(found.truncated,false);
  assert.deepEqual((await find('src\\算法\\主')).entries.map(e=>e.path),['src/算法/主程序.cpp']);
  assert.deepEqual((await find('.\\src\\算法\\主')).entries.map(e=>e.path),['src/算法/主程序.cpp']);
  assert.deepEqual((await find(' 算法   练习 ')).entries.map(e=>e.path),['src/算法/第一讲 练习.hpp']);
  assert.deepEqual((await find('sample')).entries.map(e=>e.name),['sample2.h','sample10.h']);
  assert.equal((await find('src/算法/main.cpp',1)).entries[0].path,'src/算法/main.cpp');
  assert.equal((await find('.gitignore')).entries[0].name,'.gitignore');
  assert.deepEqual(await find('没有该文件'),{entries:[],total:0,truncated:false});
  await fs.rename(path.join(project,'main.cpp'),path.join(project,'renamed.cpp'));
  assert.equal((await find('main.cpp')).total,2);
  assert.equal((await find('renamed.cpp')).total,1);
});

test('quick open bounds results and preserves the best match in a later folder',async t=>{
  const {service,project}=await setup(t), {id:projectId}=(await service.choose()).project;
  await fs.mkdir(path.join(project,'讲义'));
  for(let i=0;i<115;i++)await fs.writeFile(path.join(project,'unit-'+i+'.cpp'),'');
  await fs.writeFile(path.join(project,'讲义','unit.cpp'),'');
  const find=(query,limit)=>service.findFiles({projectId,query,limit});
  const first=await find('unit',1);
  assert.deepEqual(first,{entries:[{name:'unit.cpp',path:'讲义/unit.cpp',type:'file'}],total:116,truncated:true});
  const all=await find('');
  assert.equal(all.entries.length,50);assert.equal(all.total,116);assert.equal(all.truncated,true);
  assert.equal((await find('',400)).entries.length,100);
  for(const limit of [0,-1,1.5,'1'])await assert.rejects(find('',limit),{code:'invalid_limit'});
  await assert.rejects(find({}),{code:'invalid_query'});
});

test('quick open skips dependency and build directories before traversal and keeps them in the manual tree',async t=>{
  const {service,project}=await setup(t), {id:projectId}=(await service.choose()).project;
  const skipped=['.git','nested/node_modules','nested/dist','build','CMakeFiles','cmake-build-debug','target','nested/.venv'];
  for(const name of skipped){
    await fs.mkdir(path.join(project,name),{recursive:true});
    await fs.writeFile(path.join(project,name,'generated.cpp'),'');
  }
  await fs.writeFile(path.join(project,'nested','main.cpp'),'');
  await fs.writeFile(path.join(project,'.main.cpp.graphite-lock'),'');
  const original=fs.readdir;
  const visited=[];
  const hook=t.mock.method(fs,'readdir',async function(dir,...args){
    visited.push(path.relative(project,dir).split(path.sep).join('/'));return original(dir,...args);
  });
  assert.deepEqual((await service.findFiles({projectId})).entries,[{name:'main.cpp',path:'nested/main.cpp',type:'file'}]);
  assert.deepEqual(visited.sort(),['','nested']);
  hook.mock.restore();
  assert.ok((await service.list({projectId,path:'nested'})).entries.some(e=>e.name==='node_modules'));
  assert.equal((await service.list({projectId,path:'nested/node_modules'})).entries[0].name,'generated.cpp');
});

test('quick open ignores directory links and a project switched during a shared scan discards all its results',async t=>{
  const {service,project,vault}=await setup(t),{id:projectId}=(await service.choose()).project;
  await fs.mkdir(path.join(project,'src'));
  await fs.writeFile(path.join(project,'src','original.cpp'),'');
  await fs.writeFile(path.join(vault,'separate.cpp'),'');
  try{await fs.symlink(vault,path.join(project,'linked'),process.platform==='win32'?'junction':'dir');}
  catch(err){if(!['EACCES','EPERM'].includes(err.code))throw err;t.diagnostic('Directory links are unavailable on this system');}
  assert.deepEqual((await service.findFiles({projectId})).entries.map(e=>e.path),['src/original.cpp']);
  const original=fs.readdir;
  let resume,entered;
  const waiting=new Promise(resolve=>{entered=resolve;});
  const released=new Promise(resolve=>{resume=resolve;});
  let scans=0;
  t.mock.method(fs,'readdir',async function(dir,...args){
    if(path.relative(dir,path.join(project,'src'))===''){scans++;entered();await released;}
    return original(dir,...args);
  });
  const first=service.findFiles({projectId,query:'orig'});
  await waiting;
  const all=Promise.allSettled([first,service.findFiles({projectId,query:'original'})]);
  let selected;
  try{selected=(await service.useVault()).project;}finally{resume();}
  for(const result of await all){assert.equal(result.status,'rejected');assert.equal(result.reason.code,'project_changed');}
  assert.equal(scans,1);
  await assert.rejects(service.findFiles({projectId}),{code:'project_changed'});
  assert.deepEqual((await service.findFiles({projectId:selected.id})).entries.map(e=>e.path),['separate.cpp']);
});
