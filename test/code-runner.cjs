'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {EventEmitter,once}=require('node:events');
const createCodeRunner=require('../electron/code-runner');

test('real C++ project build, run, cancellation and debugger',{timeout:120000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'graphite cpp study '));
  const id='fixture',events=[],bus=new EventEmitter();
  const chineseRoot=path.join(root,'学生项目');
  const projects={
    async resolveRoot({projectId}){if(projectId==='chinese')return chineseRoot;assert.equal(projectId,id);return root;},
    async resolveFile({projectId,path:rel}){
      const active=await this.resolveRoot({projectId});
      const f=await fs.realpath(path.resolve(active,rel));
      if(!f.startsWith(active+path.sep))throw Error('File outside project');
      return {root:active,file:f};
    }
  };
  const runner=createCodeRunner({projects,onEvent:e=>{
    events.push(e);bus.emit('event',e);
    if(process.env.GRAPHITE_RUN_TEST_TRACE)console.log(JSON.stringify(e));
  }});
  t.after(async()=>{await runner.dispose();await fs.rm(root,{recursive:true,force:true,maxRetries:4});});
  const tools=await runner.tools();
  if(!tools.compiler.found || !tools.debugger.found)return t.skip('Requires installed g++ and GDB');
  console.log(tools.compiler.version,tools.debugger.version);
  const start=(file,mode,m={})=>runner.start({projectId:id,path:file,mode,...m});
  const waitFor=async (job,type,after=0)=>{
    const end=Date.now()+30000;
    for(;;){
      const e=events.slice(after).find(e=>e.id===job.id && (e.type===type||e.type==='end'));
      if(e){assert.equal(e.type,type,JSON.stringify(e));return e;}
      const left=end-Date.now();assert.ok(left>0,'timed out waiting for '+type);
      await once(bus,'event',{signal:AbortSignal.timeout(left)});
    }
  };
  const textOf=(job,kind)=>events.filter(e=>e.id===job.id && e.type==='output' && e.stream===kind).map(e=>e.text).join('');
  const source=['#include <iostream>','#include <fstream>','int add(int x);','int main() {',
    '  int pair[2]={3,9}, n=0;','  std::cin >> n;','  int total=add(n);','  ++total;',
    '  std::cout << total << "\\n";','  std::cerr << "trace:" << n << "\\n";',
    '  std::ofstream("student-output.txt") << total;','  return 0;','}'].join('\n');
  await fs.writeFile(path.join(root,'main.cpp'),source);
  await fs.writeFile(path.join(root,'math helper.cpp'),'int add(int x) {return x+10;}\n');
  const args={sources:['math helper.cpp'],stdin:'31\n'};
  await t.test('build does not run; normal run uses selected sources and project working directory',async()=>{
    const built=await start('main.cpp','build',args);
    assert.equal((await waitFor(built,'end')).status,'success');
    await assert.rejects(fs.access(path.join(root,'student-output.txt')));
    const job=await start('main.cpp','run',args);
    assert.equal((await waitFor(job,'end')).exitCode,0);
    assert.equal(textOf(job,'stdout').trim(),'42');assert.equal(textOf(job,'stderr').trim(),'trace:31');
    assert.equal(await fs.readFile(path.join(root,'student-output.txt'),'utf8'),'42');
  });
  await t.test('debugger hits requested line, reports actual locals, steps and continues, with redirected input and output',async()=>{
    const job=await start('main.cpp','debug',{...args,breakpoints:[{path:'main.cpp',line:8}]});
    const at=await waitFor(job,'paused');
    assert.equal(at.path,'main.cpp');assert.equal(at.line,8);
    assert.ok(at.locals.some(x=>x.name==='n' && x.value==='31'),JSON.stringify(at));
    assert.ok(at.locals.some(x=>x.name==='total' && x.value==='41'),JSON.stringify(at));
    assert.ok(at.locals.some(x=>x.name==='pair' && /3,\s*9/.test(x.value)),JSON.stringify(at));
    const cursor=events.length;
    await runner.debug({id:job.id,action:'next'});
    const next=await waitFor(job,'paused',cursor);
    assert.equal(next.line,9);assert.ok(next.locals.some(x=>x.name==='total' && x.value==='42'));
    await runner.debug({id:job.id,action:'continue'});
    assert.equal((await waitFor(job,'end')).status,'success');
    assert.equal(textOf(job,'stdout').trim(),'42');assert.equal(textOf(job,'stderr').trim(),'trace:31');
  });
  await t.test('compiler diagnostics and nonzero program exit are distinguishable',async()=>{
    await fs.writeFile(path.join(root,'bad.cpp'),'int main() { not_valid_cpp; }');
    const broken=await start('bad.cpp','run');
    assert.equal((await waitFor(broken,'end')).status,'compile_error');
    assert.match(textOf(broken,'stderr'),/bad\.cpp/);
    await fs.writeFile(path.join(root,'exit.cpp'),'int main() {return 17;}');
    const program=await start('exit.cpp','run');
    assert.equal((await waitFor(program,'end')).exitCode,17);
  });
  await t.test('Chinese folder and file names, stepping into and out of a function and nonzero debug exit',async sub=>{
    sub.after(()=>runner.dispose());
    const rel='练习/第二题.cpp',helper='解法/第二题.cpp';
    for(const folder of ['练习','解法'])await fs.mkdir(path.join(chineseRoot,folder),{recursive:true});
    await fs.writeFile(path.join(chineseRoot,'练习/函数.hpp'),'int calc(int n);');
    await fs.writeFile(path.join(chineseRoot,helper),'#include "../练习/函数.hpp"\nint calc(int n) {\n  return n*2;\n}\n');
    await fs.writeFile(path.join(chineseRoot,rel),[
      '#include "函数.hpp"','#include <fstream>','','int main() {','  int n=8;',
      '  int out=calc(n);','  std::ofstream("source-path.txt") << __FILE__;','  return out+1;','}'].join('\n'));
    const job=await start(rel,'debug',{projectId:'chinese',sources:[helper],breakpoints:[{path:rel,line:6}]});
    const stop=await waitFor(job,'paused');assert.equal(stop.path,rel);assert.equal(stop.line,6);
    assert.ok(stop.locals.some(v=>v.name==='n' && v.value==='8'));
    let cursor=events.length;await runner.debug({...job,action:'step'});
    const inside=await waitFor(job,'paused',cursor);assert.equal(inside.function,'calc');assert.equal(inside.path,helper);
    assert.ok(inside.locals.some(v=>v.name==='n' && v.value==='8'));
    cursor=events.length;await runner.debug({...job,action:'finish'});
    const back=await waitFor(job,'paused',cursor);assert.equal(back.function,'main');
    await runner.debug({...job,action:'continue'});const result=await waitFor(job,'end');
    assert.equal(result.exitCode,17);assert.equal(result.status,'runtime_error');
    assert.equal(path.normalize(await fs.readFile(path.join(chineseRoot,'source-path.txt'),'utf8')),path.join(chineseRoot,rel));
  });
  await t.test('only owned jobs are stopped; stop works during a running program and paused debugging',async()=>{
    await fs.writeFile(path.join(root,'loop.cpp'),'#include <cstdio>\nint main(){puts("started");fflush(stdout);for(;;){} }');
    const job=await start('loop.cpp','run');
    await waitFor(job,'output');
    await assert.rejects(start('loop.cpp','run'),e=>e.code==='busy');
    await runner.stop(job);assert.equal((await waitFor(job,'end')).status,'stopped');
    const debug=await start('loop.cpp','debug');await waitFor(debug,'paused');
    await runner.stop(debug);assert.equal((await waitFor(debug,'end')).status,'stopped');
    assert.equal(events.filter(e=>e.type==='end'&&e.id===debug.id).length,1);
  });
  assert.ok(!(await fs.readdir(root)).some(file=>file.endsWith('.exe')),'build artifact left in project');
});
