'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const repo = path.resolve(process.env.GRAPHITE_TEST_APP || path.join(__dirname,'..'));

// A local CLI fixture emits the same events as Codex. Its drive-root request is
// reported as an event only. The fixture never opens the drive or any personal file.
if (process.argv[2] === '--fixture-server') {
  require(path.join(repo,'server.js')).start({vault:process.argv[3],port:0,token:'isolated'}).then(port=>process.send(port));
} else test('confirmed import survives Graphite and CLI permission refusals without gaining new files', {skip:process.platform!=='win32'},async t=>{
  const root = await fs.mkdtemp(path.join(os.tmpdir(),'graphite-authorized-import-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true,maxRetries:3}));
  const vault = path.join(root,'vault'), courses = path.join(root,'courses'), course = path.join(courses,'CS');
  const tag = path.join(root,'scenario'), cli = path.join(root,'codex.cmd');
  process.env.GRAPHITE_HOME = path.join(root,'settings');
  process.env.GRAPHITE_CLAUDE_DIR = path.join(root,'claude');
  process.env.GRAPHITE_PERMISSION_FIXTURE = tag;
  await Promise.all([fs.mkdir(path.join(vault,'Sample'),{recursive:true}),fs.mkdir(course,{recursive:true})]);
  for (const name of ['one','two','leave']) await fs.writeFile(path.join(course,name+'.md'),'Sample '+name);
  await fs.writeFile(cli,'@echo off\r\n"'+process.execPath+'" "%~dp0agent.cjs" %*\r\n');
  const fake = function(){
    const fs = require('node:fs'), path = require('node:path');
    if (process.argv.includes('--version')) {console.log('codex-cli 0.161.0');return;}
    const prompt = fs.readFileSync(0,'utf8'), emit = event=>console.log(JSON.stringify(event));
    const result = value=>{emit({type:'item.completed',item:{type:'agent_message',text:'<graphite-result>'+JSON.stringify(value)+'</graphite-result>'}});emit({type:'turn.completed'});};
    if (!process.argv.includes('workspace-write')) {
      const items = Array.from(prompt.matchAll(/\{"id":(\d+),[^\n]*?"name":"([^"]+)"/g), m=>({id:+m[1],dest:'Sample/'+m[2]}));
      result({items}); return;
    }
    const scenario = fs.readFileSync(process.env.GRAPHITE_PERMISSION_FIXTURE,'utf8');
    if (scenario==='scope') {
      const drive = path.parse(process.cwd()).root;
      emit({type:'item.started',item:{type:'command_execution',command:'Get-ChildItem -LiteralPath "'+drive+'"'}});
      return;
    }
    if (scenario==='denied') {emit({type:'turn.failed',error:{message:'Access is denied reading the selected file'}});process.exitCode=1;return;}
    for (const m of prompt.matchAll(/\d+\. Copy the file "([^"]+)" to "([^"]+)"/g)) {
      if (path.isAbsolute(m[1]) || !m[1].startsWith('.graphite-inputs-')) throw Error('Expected scoped relative input');
      fs.mkdirSync(path.dirname(m[2]),{recursive:true});fs.copyFileSync(m[1],m[2]);
    }
    result({done:[1]});
  };
  await fs.writeFile(path.join(root,'agent.cjs'),'('+fake.toString()+')()');
  const child = require('node:child_process').fork(__filename,['--fixture-server',vault],{windowsHide:true,stdio:['ignore','ignore','inherit','ipc']});
  const {once} = require('node:events');
  t.after(()=>{ if (child.exitCode===null) child.kill(); });
  const [port] = await once(child,'message');
  const post = async (route, data)=>{
    const res = await fetch('http://127.0.0.1:'+port+'/api/'+route,{method:'POST',headers:{'Content-Type':'application/json','X-Vault':'1','X-App-Token':'isolated'},body:JSON.stringify(data)});
    const text = await res.text(), last = JSON.parse(text.trim().split('\n').at(-1));
    return {...last,status:last.status || res.status};
  };
  await post('study-profile',{profile:{courseRoots:[courses],courses:{CS:'Sample'},lookElsewhere:false}});
  const agent = (data,who={framework:'codex',frameworkPaths:{codex:cli}})=>post('agent',{job:'import',...who,...data});
  for (const [scenario,name,executor] of [['scope','one','graphite'],['denied','two','codex']]) {
    await fs.writeFile(tag,scenario);
    const {result:plan} = await agent({phase:'plan'});
    const i = plan.items.findIndex(x=>x.name===name+'.md');assert.ok(i>=0);
    const refusal = await agent({phase:'apply',planId:plan.planId,accept:[i]});
    assert.equal(refusal.code,scenario==='scope'?'outside':'agentPermission',JSON.stringify(refusal));
    assert.equal(refusal.access.source,scenario==='scope'?'graphite':'agent');
    if(scenario==='scope') assert.equal(refusal.access.driveRoot,true);
    assert.equal(refusal.recovery.count,1);
    const pendingFiles = await fs.readdir(path.join(vault,'Sample'));
    assert.ok(!pendingFiles.includes(name+'.md'));
    const resume = {phase:'resumeImport',recoveryId:refusal.recovery.id};
    const graphite = {provider:'graphite'};
    assert.equal((await agent({...resume,accept:[0,1]},graphite)).status,400);
    assert.equal((await agent(resume,{framework:'dsh'})).status,409);
    await fs.writeFile(tag,'allow');
    const completed = await agent(resume,executor==='graphite'?graphite:undefined);
    assert.deepEqual(completed.result?.done.map(x=>x.dest),['Sample/'+name+'.md'],JSON.stringify(completed));
    assert.deepEqual(completed.result.failed,[]);
    assert.equal((await agent(resume,graphite)).status,410);
    assert.equal(await fs.readFile(path.join(vault,'Sample',name+'.md'),'utf8'),'Sample '+name);
    const stage = path.resolve(refusal.stage);
    assert.equal(path.dirname(stage),path.resolve(os.tmpdir()));
    assert.ok(path.basename(stage).startsWith('graphite-stage-'));
    await fs.rm(stage,{recursive:true,force:true});
  }
  assert.deepEqual((await fs.readdir(path.join(vault,'Sample'))).sort(),['one.md','two.md']);
  const closed = once(child,'exit');
  child.kill();
  await closed;
});
