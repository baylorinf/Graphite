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
