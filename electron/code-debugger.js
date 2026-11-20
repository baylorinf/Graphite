'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const {createInterface} = require('node:readline');
const {StringDecoder} = require('node:string_decoder');

// Decode the tuples, lists and C strings used by GDB's machine interface.
function miFields(text) {
  let at=0;
  function string() {
    at++; const bytes=[];
    while(at<text.length && text[at]!=='"') {
      if(text[at]!=='\\'){
        const start=at;while(at<text.length && !['"','\\'].includes(text[at]))at++;
        bytes.push(Buffer.from(text.slice(start,at)));continue;
      }
      at++;const oct=/^[0-7]{1,3}/.exec(text.slice(at));
      if(oct){bytes.push(Buffer.from([parseInt(oct[0],8)]));at+=oct[0].length;continue;}
      const ch=text[at++];bytes.push(Buffer.from(({n:'\n',r:'\r',t:'\t',b:'\b',f:'\f'}[ch]??ch)));
    }
    at++;return Buffer.concat(bytes).toString('utf8');
  }
  function fields(end,list=false) {
    const out=list?[]:{};
    while(at<text.length && text[at]!==end) {
      const start=at;
      while(at<text.length && /[\w-]/.test(text[at]))at++;
      let name;
      if(at>start && text[at]==='='){name=text.slice(start,at);at++;}
      else at=start;
      let val;
      if(text[at]==='"')val=string();
      else if(text[at]==='[' || text[at]==='{'){
        const isList=text[at++]==='[';val=fields(isList?']':'}',isList);at++;
      } else {
        const raw=at;while(at<text.length && !',}]'.includes(text[at]))at++;
        val=text.slice(raw,at);
      }
      if(list)out.push(val);else if(name)out[name]=val;
      if(text[at]!==',')break;at++;
    }
    return out;
  }
  return fields('');
}
const unixPath = file=>file.split(path.sep).join('/');
const quote = str=>JSON.stringify(str);
function redirect(file) {
  // Only generated scratch paths reach GDB's run command. User paths and data go
  // through MI arguments or through the stdin file, never through a shell command.
  if(process.platform!=='win32')return "'"+file.replace(/'/g,"'\\''")+"'";
  if(/[\r\n"%!]/.test(file))throw Error('The system temporary folder cannot be used for debugger I/O');
  return '"'+unixPath(file)+'"';
}

async function debugProgram({child,exe,root,inferiorDir,dir,stdin,breakpoints,fileToAlias,aliasToFile,onPause,onRun,output,active,abort}) {
  let next=0, ended=false,paused=false,commandPending=false,exitCode=null,closed=false;
  const awaiting=new Map(),control={};
  const files=Object.fromEntries(['stdin','stdout','stderr'].map(name=>[name,path.join(dir,name+'.txt')]));
  let drain=Promise.resolve();
  const streams=[];
  const lines=createInterface({input:child.stdout,crlfDelay:Infinity});
  function request(command,timeout=15000) {
    if(closed || !active())return Promise.reject(Error('Debugger stopped'));
    const id=++next;
    return new Promise((resolve,reject)=>{
      const timer=timeout && setTimeout(()=>{
        if(awaiting.delete(id))reject(Error('Debugger did not respond to '+command.split(' ')[0]));
      },timeout);
      const task={resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}};
      awaiting.set(id,task);child.stdin.write(id+command+'\n',err=>{
        if(err && awaiting.delete(id))task.reject(err);
      });
    });
  }
  function drainOutput() {
    // Read by position so even a long run streams to the console with bounded memory.
    drain=drain.then(async()=>{
      for(const s of streams) {
        const limit=(await s.fd.stat()).size;
        while(s.offset<limit && active()){
          const b=Buffer.allocUnsafe(Math.min(65536,limit-s.offset));
          const {bytesRead}=await s.fd.read(b,0,b.length,s.offset);if(!bytesRead)break;
          s.offset+=bytesRead;output(s.name,s.decoder.write(b.subarray(0,bytesRead)));
        }
      }
    });
    return drain;
  }
  let terminalError;
  const finish=async()=>{
    if(ended)return;
    ended=true;
    try {await drainOutput();if(active())await request('-gdb-exit');}catch(err){if(active())abort(err);}
  };
  const onStopped=async data=>{
    if(!active()||ended)return;
    if(['exited','exited-normally','exited-signalled'].includes(data.reason)){
      if(data['exit-code']!=null)exitCode=parseInt(data['exit-code'],8);
      if(data.reason==='exited-normally')exitCode=0;
      if(data.reason==='exited-signalled')terminalError='Program terminated by '+(data['signal-name']||'signal');
      return finish();
    }
    await drainOutput();
    const vars=await request('-stack-list-variables --all-values');
    if(!active())return;
    const f=data.frame||{};
    const debuggerFile=f.fullname || (f.file && path.resolve(inferiorDir,f.file));
    const belowWorkingDir=debuggerFile && path.relative(inferiorDir,debuggerFile);
    const fromWorkingDir=belowWorkingDir && !path.isAbsolute(belowWorkingDir) &&
      belowWorkingDir!=='..' && !belowWorkingDir.startsWith('..'+path.sep);
    const abs=aliasToFile.get(path.basename(f.file||'')) ||
      (fromWorkingDir ? path.join(root,belowWorkingDir) : debuggerFile);
    const rel=abs && path.relative(root,abs), inside=rel && !path.isAbsolute(rel) && rel!=='..' && !rel.startsWith('..'+path.sep);
    paused=true;
    onPause({reason:data.reason||'stopped',path:inside?unixPath(rel):null,line:Number(f.line)||null,
      function:f.func||'',locals:(vars.variables||[]).map(({name,type,value})=>({name,type:type||'',value:value??''}))});
  };
  child.stderr.setEncoding('utf8');child.stderr.on('data',s=>output('stderr',s));
  lines.on('line',line=>{
    const match=/^(\d*)([\^*=])([a-zA-Z-]+)(?:,(.*))?$/.exec(line);
    if(!match)return;
    const [,token,kind,state,args]=match;
    try {
      if(kind==='^' && awaiting.has(Number(token))){
        const pending=awaiting.get(Number(token));awaiting.delete(Number(token));
        const vals=miFields(args||'');
        if(state==='error')pending.reject(Error(vals.msg||'Debugger command failed'));
        else pending.resolve(vals);
      } else if(kind==='*' && state==='stopped')onStopped(miFields(args||'')).catch(err=>{if(active())abort(err);});
      else if(kind==='=' && state==='thread-group-exited' && args){const code=miFields(args)['exit-code'];if(code!=null)exitCode=parseInt(code,8);}
    }catch(err){if(active())abort(err);}
  });
  // Register for termination before sending the first command.
  const close=new Promise(resolve=>{
    const done=(code,error)=>{
      if(closed)return;closed=true;
      for(const task of awaiting.values())task.reject(error||Error('Debugger exited'));
      awaiting.clear();resolve({code,error});
    };
    child.once('error',err=>done(null,err));child.once('close',code=>done(code,null));
  });
  child.stdin.on('error',()=>{}); // rejection is delivered through request()/close
  const ticker=setInterval(()=>{if(!ended && streams.length)drainOutput().catch(e=>{if(active())abort(e);});},125);
  try {
    await fs.writeFile(files.stdin,stdin);
    for(const name of ['stdout','stderr']){
      const fd=await fs.open(files[name],'w+');
      streams.push({name,fd,decoder:new StringDecoder('utf8'),offset:0});
    }
    await request('-gdb-set pagination off');
    await request('-gdb-set confirm off');
    await request('-gdb-set print elements 32');
    await request('-environment-cd '+quote(unixPath(inferiorDir)));
    if(fileToAlias.size)await request('-environment-directory '+quote(unixPath(dir)));
    await request('-file-exec-and-symbols '+quote(unixPath(exe)));
    for(const b of breakpoints)await request('-break-insert --source '+quote(fileToAlias.get(b.file)||unixPath(b.file))+' --line '+b.line);
    if(!breakpoints.length)await request('-break-insert -t main');
    control.command=async action=>{
      const commands={next:'-exec-next',step:'-exec-step',continue:'-exec-continue',finish:'-exec-finish'};
      if(!Object.hasOwn(commands,action) || !paused || commandPending)throw Error('The debugger must be paused for this action');
      paused=false;commandPending=true;
      try{await request(commands[action]);return {ok:true};}catch(e){paused=true;throw e;}finally{commandPending=false;}
    };
    onRun(control);
    // GDB is in async MI mode; use "run" only to give the inferior dedicated stdin/stdout/stderr.
    await request('-interpreter-exec console '+quote('run < '+redirect(files.stdin)+' > '+redirect(files.stdout)+' 2> '+redirect(files.stderr)),0);
    const closedState=await close;
    if(closedState.error)throw closedState.error;
    if(terminalError)throw Error(terminalError);
    if(active() && (!ended || exitCode===null))throw Error('Debugger exited before the program finished');
    return exitCode;
  }finally{
    clearInterval(ticker);lines.close();await drain.catch(()=>{});
    for(const s of streams){output(s.name,s.decoder.end());await s.fd.close().catch(()=>{});}
  }
}
module.exports={debugProgram};
