'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const os = require('node:os');
const {randomUUID} = require('node:crypto');
const {spawn, execFile} = require('node:child_process');
const {promisify} = require('node:util');
const {debugProgram} = require('./code-debugger');

const exec = promisify(execFile), win=process.platform==='win32';
const MAX_INPUT=1024*1024, MAX_OUTPUT=4*1024*1024, CPP=/\.(?:cpp|cxx|cc|c\+\+)$/i;
const fail=(code,message)=>Object.assign(Error(message),{code});
// g++ arguments. Debugging always builds -O0 with debug information (stepping and variables match the code);
// "O2" (optimize) builds an optimised program for Run and Compile.
function compileArgs({mode,optimize=false,debugFlags=[],files=[],exe}){
  const opt=optimize && mode!=='debug' ? ['-O2'] : ['-g','-O0'];
  return ['-std=c++20',...opt,...(mode==='debug'?debugFlags:[]),...files,'-o',exe];
}

async function findTool(name){
  const dirs=(process.env.PATH||'').split(path.delimiter).filter(p=>path.isAbsolute(p));
  if(win)for(const drive of [process.env.SystemDrive||'C:','D:']){
    for(const arch of ['ucrt64','mingw64'])dirs.push(path.join(drive+'\\','msys64',arch,'bin'));
  }
  for(const dir of new Set(dirs)){
    const file=path.join(dir,name+(win?'.exe':''));
    try{
      if(!(await fs.stat(file)).isFile())continue;
      const {stdout}=await exec(file,['--version'],{windowsHide:true,timeout:4000,maxBuffer:16384});
      return {found:true,path:file,version:stdout.split(/\r?\n/)[0]};
    }catch{/* try the next installed tool */}
  }
  return {found:false,path:null,version:null};
}

function createCodeRunner({projects,onEvent}){
  const jobs=new Map(),projectsInUse=new Set();let detecting=null, projectEpoch=0;
  async function tools(){
    if(!detecting)detecting=Promise.all([findTool('g++'),findTool('gdb')])
      .then(([compiler,debuggerTool])=>({compiler,debugger:debuggerTool})).finally(()=>{detecting=null;});
    return detecting;
  }
  const emit=(j,msg)=>onEvent({id:j.id,projectId:j.projectId,...msg});
  function output(j,stream,text){
    if(!text || j.stopped || j.error)return;
    j.bytes+=Buffer.byteLength(text);
    if(j.bytes>MAX_OUTPUT){
      j.error=fail('output_limit','Program output exceeded 4 MiB');void terminate(j);return;
    }
    emit(j,{type:'output',stream,text});
  }
  async function terminate(j){
    const p=j.child;
    if(!p || !p.pid || p.exitCode!=null || p.signalCode!=null)return;
    if(j.termination?.child===p)return j.termination.done;
    const done=(async()=>{
      if(win){
        const taskkill=path.join(process.env.SystemRoot||'C:\\Windows','System32','taskkill.exe');
        try{await exec(taskkill,['/PID',String(p.pid),'/T','/F'],{windowsHide:true,timeout:5000});}
        catch{if(p.exitCode==null && p.signalCode==null)p.kill();}
      }else{
        try{process.kill(-p.pid,'SIGKILL');}catch{p.kill('SIGKILL');}
      }
    })();
    j.termination={child:p,done};return done;
  }
  function launch(j,executable,args,cwd,env){
    if(j.stopped || j.error)throw j.error||fail('stopped','Stopped');
    const child=spawn(executable,args,{cwd,env,windowsHide:true,detached:!win,stdio:['pipe','pipe','pipe']});
    j.child=child;
    j.childClosed=new Promise(resolve=>{child.once('close',resolve);});
    return child;
  }
  async function childRun(j,executable,args,cwd,env,input=''){
    const child=launch(j,executable,args,cwd,env);
    for(const stream of ['stdout','stderr']){child[stream].setEncoding('utf8');child[stream].on('data',s=>output(j,stream,s));}
    child.stdin.on('error',()=>{});child.stdin.end(input);
    return new Promise((resolve,reject)=>{
      child.once('error',reject);
      child.once('close',(code,signal)=>resolve({code,signal}));
    });
  }
  function assertRunning(j){if(j.error)throw j.error;if(j.stopped)throw fail('stopped','Stopped');}
  async function run(j,req,entry){
    let dir=null, end={status:'error',exitCode:null};
    try{
      const found=await tools();assertRunning(j);
      if(!found.compiler.found)throw fail('compiler_missing','Install GCC (g++) to compile C++');
      if(req.mode==='debug' && !found.debugger.found)throw fail('debugger_missing','Install GDB to debug C++');
      dir=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-build-'));
      const exe=path.join(dir,win?'program.exe':'program');
      const env={...process.env,PATH:[path.dirname(found.compiler.path),process.env.PATH||''].join(path.delimiter)};
      const files=new Set([entry.file]);
      for(const rel of req.sources||[]){
        const s=await projects.resolveFile({projectId:req.projectId,path:rel});
        if(s.root!==entry.root || !CPP.test(s.file))throw fail('invalid_source','Choose C++ source files in this project');
        files.add(s.file);
      }
      const stops=[];
      for(const b of req.breakpoints||[]){
        if(!b || typeof b.path!=='string' || !Number.isSafeInteger(b.line) || b.line<1)throw fail('invalid_breakpoint','Choose a valid source line');
        const s=await projects.resolveFile({projectId:req.projectId,path:b.path});
        if(s.root!==entry.root)throw fail('project_changed','The selected project changed');
        stops.push({file:s.file,line:b.line});
      }
      assertRunning(j);emit(j,{type:'phase',phase:'compiling'});
      const aliasToFile=new Map(),fileToAlias=new Map(),debugFlags=[];
      let inferiorDir=entry.root;
      if(win && req.mode==='debug'){
        // MinGW GDB can hang resolving a non-ASCII --source. Only debug metadata is renamed:
        // GCC still compiles the original inputs, and include lookup and __FILE__ keep their meaning.
        const paths=new Set([...files,...stops.map(stop=>stop.file)]);
        for(const file of paths){
          if(!/[^\x00-\x7f]/.test(file))continue;
          const name='__graphite_'+path.basename(dir)+'_'+fileToAlias.size+path.extname(file);
          fileToAlias.set(file,name);aliasToFile.set(name,file);
          await fs.copyFile(file,path.join(dir,name));
          debugFlags.push('-fdebug-prefix-map='+file+'='+name);
        }
        if(/[^\x00-\x7f]/.test(entry.root)){
          inferiorDir=path.join(dir,'project');
          await fs.symlink(entry.root,inferiorDir,'junction');
          debugFlags.unshift('-fdebug-prefix-map='+entry.root+'=.');
        }
      }
      const compiled=await childRun(j,found.compiler.path,compileArgs({mode:req.mode,optimize:req.optimize===true,debugFlags,files:[...files],exe}),entry.root,env);
      assertRunning(j);
      if(compiled.code!==0){end={status:'compile_error',exitCode:compiled.code,message:'Compilation failed'};return;}
      if(req.mode==='build'){end={status:'success',exitCode:0};return;}
      if(await projects.resolveRoot({projectId:req.projectId})!==entry.root)throw fail('project_changed','The selected project changed');
      let code;
      if(req.mode==='debug'){
        const args=['--nx','--nh','--quiet','--interpreter=mi2','-iex','set auto-load off'];
        const child=launch(j,found.debugger.path,args,dir,env);
        code=await debugProgram({child,exe,root:entry.root,inferiorDir,dir,stdin:req.stdin||'',breakpoints:stops,
          fileToAlias,aliasToFile,
          output:(stream,text)=>output(j,stream,text),active:()=>!j.stopped && !j.error,
          abort:err=>{j.error=err;void terminate(j);},
          onPause:state=>emit(j,{type:'paused',...state}),
          onRun:control=>{j.control=control;emit(j,{type:'phase',phase:'debugging'});}
        });
      }else{
        assertRunning(j);emit(j,{type:'phase',phase:'running'});
        const child=await childRun(j,exe,[],entry.root,env,req.stdin||'');code=child.code;
        if(child.signal)end.message='Program terminated by '+child.signal;
      }
      assertRunning(j);
      end={...end,status:code===0?'success':'runtime_error',exitCode:code};
    }catch(err){
      end={status:'error',exitCode:null,code:err.code||'run_failed',message:err.message};
      await terminate(j);
    }finally{
      if(j.childClosed)await j.childClosed;
      if(dir)await fs.rm(dir,{recursive:true,force:true,maxRetries:4,retryDelay:75}).catch(()=>{});
      jobs.delete(j.id);projectsInUse.delete(j.projectId);
      if(j.stopped)end={status:'stopped',exitCode:null};
      emit(j,{type:'end',...end});
    }
  }
  async function start(req){
    if(!req || typeof req.projectId!=='string' || typeof req.path!=='string' || !['build','run','debug'].includes(req.mode))throw fail('invalid_request','Choose a project source and action');
    if(req.stdin!=null && (typeof req.stdin!=='string' || Buffer.byteLength(req.stdin)>MAX_INPUT))throw fail('invalid_input','Input must be text under 1 MiB');
    if(req.sources!=null && (!Array.isArray(req.sources)||req.sources.length>256||req.sources.some(s=>typeof s!=='string')))throw fail('invalid_source','Choose up to 256 source files');
    if(req.breakpoints!=null && (!Array.isArray(req.breakpoints)||req.breakpoints.length>512))throw fail('invalid_breakpoint','Choose up to 512 breakpoints');
    if(req.optimize!=null && typeof req.optimize!=='boolean')throw fail('invalid_request','optimize must be true or false');
    const epoch=projectEpoch;
    const entry=await projects.resolveFile({projectId:req.projectId,path:req.path});
    if(epoch!==projectEpoch)throw fail('project_changed','The selected project changed');
    if(!CPP.test(entry.file))throw fail('invalid_source','Select a C++ source file (.cpp, .cc or .cxx)');
    if(projectsInUse.has(req.projectId))throw fail('busy','Stop the current job before starting another');
    const j={id:randomUUID(),projectId:req.projectId,bytes:0,stopped:false};
    jobs.set(j.id,j);projectsInUse.add(j.projectId);
    j.done=new Promise(resolve=>setImmediate(resolve)).then(()=>run(j,req,entry));
    return {id:j.id};
  }
  async function stop({id}){
    const j=jobs.get(id);if(!j)return {ok:true};
    j.stopped=true;await terminate(j);await j.done;return {ok:true};
  }
  async function debug({id,action}){
    const j=jobs.get(id);
    if(!j?.control || j.stopped)throw fail('debug_not_ready','The debugger is not ready');
    return j.control.command(action);
  }
  async function dispose(){projectEpoch++;await Promise.all([...jobs.keys()].map(id=>stop({id})));}
  return {tools,start,stop,debug,dispose};
}

module.exports=createCodeRunner;
module.exports.createCodeRunner=createCodeRunner;
module.exports.compileArgs=compileArgs;
