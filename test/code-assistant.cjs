'use strict';

require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { setTimeout: sleep } = require('node:timers/promises');
const fake = require('./fake-llm.cjs');

// Run with --installed to additionally route the installed DSH and Codex through an isolated, offline model fixture.
async function main() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-code-answer-qa-'));
  const vault = path.join(dir, 'vault');
  await fs.mkdir(vault);
  const secret = 'UNSELECTED-SYNTHETIC-MARKER';
  await fs.writeFile(path.join(vault, 'private.txt'), secret);
  await fs.mkdir(process.env.GRAPHITE_HOME, { recursive: true });
  await fs.writeFile(path.join(process.env.GRAPHITE_HOME, 'study.json'), JSON.stringify({ about: secret }));
  const context = { action: 'diagnose', filename: 'examples/练习.cpp', selection: 'int a = ; // SELECTED',
    diagnostics: 'line 1: expected expression', question: 'Why here?',
    history: [{ role: 'system', content: secret }, { role: 'user', content: 'Earlier question' }, { role: 'assistant', content: 'Earlier answer' }],
    root: vault, note: { content: secret }, files: [secret], __system: secret, study: secret };
  const expected = 'The initializer needs an expression.';
  const service = await fake.start(() => ({ text: expected }));
  Object.assign(process.env, { ANTHROPIC_BASE_URL: service.url, GRAPHITE_TEST_AI_BASE: service.url + '/v1' });
  const port = await require('../server').start({ vault });
  const origin = 'http://127.0.0.1:' + port;
  async function ask(input, signal, endpoint = 'code-assistant') {
    return fetch(origin + '/api/' + endpoint, { method: 'POST', headers: { 'X-Vault':'1', 'X-AI-Key':'fake-key', 'Content-Type':'application/json' },
      body: JSON.stringify(input), signal });
  }
  function checkPrompt(body) {
    const s = JSON.stringify(body);
    for (const marker of ['SELECTED', 'expected expression', 'Why here?', 'Earlier answer']) assert.ok(s.includes(marker), marker);
    assert.ok(!s.includes(secret), 'Unselected content in the request');
    assert.ok(!s.includes('private.txt'));
  }
  let watcher;
  try {
    for (const provider of ['custom', 'anthropic']) {
      const response = await ask({ ...context, provider, model: 'fixture-model', baseUrl: service.url + '/v1' });
      assert.deepEqual(await response.json(), { text: expected });
      const call = service.log.at(-1);
      assert.equal(call.body.model, 'fixture-model');
      assert.equal(call.headers.authorization || 'Bearer ' + call.headers['x-api-key'], 'Bearer fake-key');
      checkPrompt(call.body);
      assert.equal(call.body.tools, undefined);
      console.log('PASS', provider, 'selected model, question, selection, diagnostic and bounded conversation');
    }
    const before = service.log.length;
    for (const invalid of [{action:'ask'}, {action:'explain'}, {action:'diagnose', selection:'code'}, {action:'ask', question:'?', filename:'../a'},
      {action:'ask', question:'?', filename:'C:/a'}, {action:'ask', question:'?', history:{}}, {action:'ask', question:'?', provider:'off'},
      {action:'ask', question:'?', provider:'__proto__'}]) assert.equal((await ask({provider:'custom', ...invalid})).status, 400);
    assert.equal((await ask({...context,provider:'custom',selection:'x'.repeat(64001)})).status, 413);
    assert.equal(service.log.length, before);
    const history = Array.from({length:20}, (_,i) => ({role:i % 2 ? 'assistant':'user',content:'history-'+i+'!'}));
    await ask({...context,provider:'custom',model:'fixture-model',baseUrl:service.url,history});
    const body = service.log.at(-1).body;
    assert.equal(body.messages.length, 10);
    assert.equal(body.messages[1].content,'history-12!');
    assert.equal(body.messages[8].content,'history-19!');
    const old = await ask({provider:'custom',model:'fixture-model',baseUrl:service.url,task:'chat',text:'ordinary note chat',note:{title:'old',content:'old-note-context'}},undefined,'ai');
    assert.deepEqual(await old.json(),{text:expected});
    assert.ok(JSON.stringify(service.log.at(-1).body).includes('old-note-context'));
    console.log('PASS validation, bounded history and legacy note chat');

    const cc = {...context,provider:'claude-code'};
    assert.equal((await ask(cc)).status,424);
    const chat = path.join(vault,'.obsidian/plugins/claude-chat/chat');
    await fs.mkdir(chat,{recursive:true});
    watcher = spawn(process.execPath,[path.resolve(__dirname,'../extensions/claude-code/skills/obsidian-chat/scripts/watch.js'),chat],{
      env:{...process.env,GRAPHITE_CONFIG:path.join(dir,'fixture-bridge-config.json')},stdio:['ignore','pipe','pipe'],windowsHide:true});
    let lines = '';
    watcher.stdout.on('data',d => { lines += d; });
    async function until(fn) { for (let i=0;i<240;i++) { const value=await fn(); if(value)return value; await sleep(45); } throw Error('Timed out waiting for listener'); }
    await until(()=>fs.access(path.join(chat,'status.json')).then(()=>true,()=>false));
    const pending = ask(cc);
    const event = await until(() => lines.split('\n').find(l=>l.startsWith('TASK ')));
    const item = JSON.parse(event.slice(5));
    assert.equal(item.task,'ai-code-assistant');
    const task = JSON.parse(await fs.readFile(path.join(chat,'tasks',item.id+'.json')));
    assert.equal(task.studySettings,undefined);
    assert.equal(task.note,undefined);
    checkPrompt(task);
    await fs.writeFile(path.join(chat,'replies',item.id+'.json'),JSON.stringify({text:expected}));
    assert.deepEqual(await (await pending).json(), {text:expected});
    assert.deepEqual(await fs.readdir(path.join(chat,'tasks')),[]);
    const ctl = new AbortController();
    const stopped = ask(cc,ctl.signal).catch(e=>e);
    await until(async()=> (await fs.readdir(path.join(chat,'tasks'))).some(n=>n.endsWith('.json')));
    ctl.abort();
    await stopped;
    await until(async()=> !(await fs.readdir(path.join(chat,'tasks'))).length);
    console.log('PASS real Claude listener, offline state, reply and cancellation cleanup');

    if (process.argv.includes('--installed')) {
      const codexHome=path.join(dir,'codex-home'), dshHome=path.join(dir,'dsh-home');
      for(const home of [codexHome,dshHome]) {
        await fs.mkdir(home);
        await fs.writeFile(path.join(home,'AGENTS.md'),secret);
      }
      // No credentials, settings or model endpoints from the host profile enter these runs.
      await fs.writeFile(path.join(codexHome,'config.toml'), [
        'model = "fixture-codex-model"', 'model_provider = "fixture"', '[model_providers.fixture]', 'name = "Local QA"',
        'base_url = "' + service.url + '/v1"', 'env_key = "GRAPHITE_QA_FAKE_KEY"', 'wire_api = "responses"', 'supports_websockets = false',
        '[mcp_servers.graphite_qa]', 'command = "'+process.execPath.replaceAll('\\','\\\\')+'"',
        'args = ' + JSON.stringify(['-e','require("fs").writeFileSync('+JSON.stringify(path.join(dir,'mcp-started'))+',"unexpected")']), '',
      ].join('\n'));
      Object.assign(process.env,{DSH_HOME:dshHome,DEEPSEEK_BASE_URL:service.url,DEEPSEEK_API_KEY:'sk-test-fake-00000000000000000000000',
        DSH_TELEMETRY_DISABLED:'1',CODEX_HOME:codexHome,GRAPHITE_QA_FAKE_KEY:'codex-fake'});
      for(const provider of ['dsh','codex']) {
        const first=service.log.length;
        const response = await ask({...context,provider});
        const answered=await response.json();
        assert.equal(response.status,200,JSON.stringify(answered));
        assert.equal(answered.text.trim(),expected);
        const call=service.log.slice(first).find(request=>JSON.stringify(request.body).includes('SELECTED'));
        assert.ok(call,'No request from '+provider);checkPrompt(call.body);
        if(provider==='dsh') assert.equal(call.body.tools?.length||0,0,'DSH sent model tools');
        if(provider==='codex'){
          assert.equal(call.body.model,'fixture-codex-model');
          assert.equal(call.headers.authorization,'Bearer codex-fake');
          assert.equal(await fs.access(path.join(dir,'mcp-started')).then(()=>true,()=>false),false,'External MCP server started');
          assert.equal(call.body.tools?.length||0,0,'Codex advertised tools');
        }
        console.log('PASS installed '+provider+' → fixture provider, scoped context, separate workspace');
      }
      const optIn={...context,provider:'codex',useNativeCodexInstructions:true};
      assert.equal((await ask(optIn)).status,400,'custom Codex routing must not accept native consent');
      assert.equal((await ask({...optIn,provider:'custom'})).status,400);
      const nativeHome=path.join(dir,'native-home');
      await fs.mkdir(nativeHome);
      const global='GLOBAL-NATIVE-INSTRUCTIONS-FIXTURE';
      const originalConfig=['model = "gpt-5.4"','model_provider = "openai"','forced_login_method = "api"',
        'openai_base_url = "'+service.url+'/v1"', '[mcp_servers.native_qa]', 'command = "'+process.execPath.replaceAll('\\','\\\\')+'"',
        'args = '+JSON.stringify(['-e','require("fs").writeFileSync('+JSON.stringify(path.join(dir,'native-mcp-started'))+',"unexpected")']), ''].join('\n');
      const originalAuth=JSON.stringify({auth_mode:'apikey',OPENAI_API_KEY:'sk-qa-stored-native-account-key'});
      await fs.writeFile(path.join(nativeHome,'config.toml'),originalConfig);
      await fs.writeFile(path.join(nativeHome,'auth.json'),originalAuth);
      await fs.writeFile(path.join(nativeHome,'AGENTS.md'),global);
      process.env.CODEX_HOME=nativeHome;
      const firstNative=service.log.length;
      assert.equal((await ask(optIn)).status,400,'a third-party base URL cannot receive native consent');
      // Simulate only the official service origin. All CLI configuration, auth reads and network requests are real.
      const key=require.resolve('../extensions/code-assistant/codex-answer.cjs');
      const prepare=require(key);
      require.cache[key].exports=options=>prepare({...options,nativeOrigins:[service.url,'https://api.openai.com','https://chatgpt.com']});
      try {
        const native={...context,provider:'codex'};
        for (const env of ['OPENAI_BASE_URL','CODEX_APP_SERVER_CHATGPT_BASE_URL']) {
          const previous=process.env[env];
          process.env[env]='https://another-provider.invalid/v1';
          try { assert.equal((await ask(optIn)).status,400); }
          finally { if(previous===undefined)delete process.env[env];else process.env[env]=previous; }
        }
        const firstTry=await ask(native);
        assert.equal(firstTry.status,409,JSON.stringify(await firstTry.clone().json()));
        assert.equal((await firstTry.json()).code,'codexGlobalInstructionsConsent');
        assert.equal(service.log.length,firstNative);
        const afterConsent=await ask({...native,useNativeCodexInstructions:true});
        const answer=await afterConsent.json();assert.equal(afterConsent.status,200,JSON.stringify(answer));
        assert.equal(answer.text.trim(),expected);
        const request=service.log.slice(firstNative).find(req=>JSON.stringify(req.body).includes('SELECTED'));
        assert.ok(request);
        checkPrompt(request.body);assert.ok(JSON.stringify(request.body).includes(global));
        assert.equal(request.headers.authorization,'Bearer sk-qa-stored-native-account-key');
        assert.equal(request.body.model,'gpt-5.4');assert.equal(request.body.tools?.length||0,0);
        assert.equal(await fs.access(path.join(dir,'native-mcp-started')).then(()=>true,()=>false),false);
        const after=service.log.length;assert.equal((await ask(native)).status,409);
        assert.equal(service.log.length,after,'consent never persists to the next question');
        assert.equal(await fs.readFile(path.join(nativeHome,'config.toml'),'utf8'),originalConfig);
        assert.equal(await fs.readFile(path.join(nativeHome,'auth.json'),'utf8'),originalAuth);
        console.log('PASS native Codex: no model request before consent, original stored identity and model after one-time consent, zero tools');
      } finally {require.cache[key].exports=prepare;}
    }
  } finally {
    if(watcher){ const closed=once(watcher,'close');watcher.kill();await closed; }
    service.close();
    await fs.rm(dir,{recursive:true,force:true,maxRetries:3});
  }
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
