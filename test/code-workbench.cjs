'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(process.env.GRAPHITE_TEST_APP || path.join(__dirname,'..'));
const {registerCodeWorkbench} = require(path.join(root,'electron/code-workbench'));

test('an editor window can choose a project and receive output, preview frames cannot start tools',async () => {
  const handlers = new Map(), outputs = [], calls = [];
  const frame = {url:'http://127.0.0.1:12345/'};
  const contents = {mainFrame:frame,send:(...args)=>outputs.push(args)};
  const sender = {sender:contents,senderFrame:frame};
  const send = registerCodeWorkbench({
    ipcMain:{handle:(channel,handler)=>handlers.set(channel,handler)},url:frame.url,
    getWindow:()=>({isDestroyed:()=>false,webContents:contents}),
    projects:{choose:async()=>({project:{id:'test'}})},
    runner:{start:async args=>{calls.push(args);return {id:'run'};},stop:()=>{throw Object.assign(new Error('This task has finished'),{code:'finished'});}},
  });
  const project = handlers.get('code-project'), run = handlers.get('code-run');
  assert.deepEqual(await project(sender,'choose'),{ok:true,project:{id:'test'}});
  const args = {projectId:'test',path:'main.cpp'};
  assert.deepEqual(await run(sender,'start',args),{ok:true,id:'run'});
  assert.equal((await project(sender,'resolveFile',args)).code,'invalid_action');
  assert.equal((await run(sender,'constructor',{})).code,'invalid_action');
  assert.equal((await run(sender,'stop',{id:'old'})).code,'finished');
  send({id:'run',type:'end'});assert.equal(outputs.length,1);
  assert.equal((await run({...sender,senderFrame:{url:frame.url}},'start',args)).code,'wrong_window');
  assert.equal((await run({...sender,sender:{}},'start',args)).code,'wrong_window');
  frame.url += 'vault/demo.html';
  assert.equal((await run(sender,'start',args)).code,'wrong_window');
  send({id:'run',type:'output'});assert.equal(outputs.length,1);
  assert.deepEqual(calls,[args]);
});
