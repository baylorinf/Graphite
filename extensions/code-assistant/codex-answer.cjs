'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

// Ask the installed CLI which model route it would use, including its normal config layers.
// config/read does not start a thread or a model request. Never persist or log its full result.
async function readConfig({launch, file, cwd, signal, killTree}) {
  const child = launch(file, ['app-server', '--disable', 'plugins', '--disable', 'apps', '--disable', 'hooks'], {
    cwd, env:process.env, stdio:['pipe','pipe','ignore'],
  });
  const lines = readline.createInterface({input:child.stdout});
  const send = (method,params,id) => child.stdin.write(JSON.stringify({method,params,...(id ? {id} : {})}) + '\n');
  try {
    return await new Promise((resolve,reject) => {
      const fail = () => reject(Error('Unable to read Codex model configuration.'));
      const timer = setTimeout(fail,20000);
      const stop = () => fail();
      const settle = (fn,value) => {
        clearTimeout(timer);
        signal?.removeEventListener('abort',stop);
        fn(value);
      };
      child.on('error',() => settle(reject,Error('Could not start Codex.')));
      child.on('close',() => settle(reject,Error('Codex closed before its model configuration was ready.')));
      child.stdin.on('error',() => settle(reject,Error('Could not read Codex model configuration.')));
      signal?.addEventListener('abort',stop,{once:true});
      if (signal?.aborted) return stop();
      lines.on('line',line => {
        let msg;
        try { msg=JSON.parse(line); } catch { return; }
        if (msg.error) return settle(reject,Error('Codex could not resolve its model configuration: '+msg.error.code));
        if (msg.id === 1) {
          send('initialized',{});
          send('config/read',{includeLayers:false,cwd},2);
        }
        if (msg.id === 2 && msg.result?.config) settle(resolve,msg.result.config);
      });
      send('initialize',{clientInfo:{name:'graphite-code-assistant',version:'1.0.0'}},1);
    });
  } finally { lines.close(); child.stdin.end(); killTree(child); }
}

module.exports = async function prepare(options) {
  const {cwd, HttpError} = options;
  const unavailable = () => Object.assign(new HttpError(424,
    '当前 Codex CLI 配置无法在保留原模型和登录的同时隔离个人上下文。请在 Graphite 的 AI 设置中选择其他提供方，或为 Codex 配置使用环境变量密钥的模型服务。'), {code:'codeContextUnavailable',framework:'codex'});
  let config;
  try { config = await readConfig(options); } catch { throw unavailable(); }
  const original = process.env.CODEX_HOME || path.join(os.homedir(),'.codex');
  const provider = config.model_provider || 'openai';
  const route = config.model_providers?.[provider];
  const nativeOrigins = options.nativeOrigins || ['https://api.openai.com','https://chatgpt.com'];
  const destinations = [config.openai_base_url,config.chatgpt_base_url,process.env.OPENAI_BASE_URL,
    process.env.CODEX_APP_SERVER_CHATGPT_BASE_URL];
  const official = provider === 'openai' && !route && destinations.every(address => {
    if (!address) return true;
    try { const url=new URL(address); return !url.username && !url.password && nativeOrigins.includes(url.origin); } catch { return false; }
  });
  if (options.useNativeCodexInstructions && !official) throw new HttpError(400,'此选项仅支持 Codex 官方原生提供商。');
  // A declared non-OpenAI route can retain the identical endpoint and environment key in a fresh home.
  // Project just its transport settings; keep literal secrets, OAuth stores, hooks and plugins in their original home.
  const allowed = new Set(['name','base_url','env_key','env_key_instructions','wire_api','env_http_headers','requires_openai_auth',
    'supports_websockets','supports_standalone_web_search','request_max_retries','stream_max_retries','stream_idle_timeout_ms','websocket_connect_timeout_ms']);
  if (route && provider !== 'openai' && route.base_url && !route.requires_openai_auth &&
      Object.entries(route).every(([key,value])=>value == null || allowed.has(key))) {
    let url;
    try { url = new URL(route.base_url); } catch { throw unavailable(); }
    if (url.username || url.password || url.search || url.hash) throw unavailable();
    if (!/^[\w-]+$/.test(provider) || (route.env_key && !process.env[route.env_key])) throw unavailable();
    const home=path.join(path.dirname(cwd),'codex-profile');
    await fs.mkdir(home,{mode:0o700});
    const lines=['model_provider = '+JSON.stringify(provider)];
    for(const key of ['model','model_reasoning_effort','model_verbosity','service_tier']) {
      if(typeof config[key]==='string') lines.push(key+' = '+JSON.stringify(config[key]));
    }
    lines.push('[model_providers.'+JSON.stringify(provider)+']');
    for (const [key,value] of Object.entries(route)) {
      if(value == null || key==='env_key_instructions') continue;
      if(key==='env_http_headers') {
        if(typeof value !== 'object' || Object.values(value).some(v=>typeof v!=='string'||!/^[A-Za-z_][A-Za-z0-9_]*$/.test(v))) throw unavailable();
        lines.push('env_http_headers = { '+Object.entries(value).map(([k,v])=>JSON.stringify(k)+' = '+JSON.stringify(v)).join(', ')+' }');
      } else if (['string','number','boolean'].includes(typeof value)) lines.push(key+' = '+JSON.stringify(value));
      else throw unavailable();
    }
    await fs.writeFile(path.join(home,'config.toml'),lines.join('\n')+'\n',{mode:0o600});
    return {env:{CODEX_HOME:home},args:[]};
  }
  // Native subscriptions and keyrings stay associated with their original home. The CLI unconditionally
  // inserts a global AGENTS.md from that home, even at project_doc_max_bytes=0. Never submit in that case.
  if (config.model_instructions_file || config.developer_instructions || config.instructions) throw unavailable();
  if (!options.useNativeCodexInstructions) {
    for (const filename of ['AGENTS.override.md','AGENTS.md']) {
      let stat;
      try { stat=await fs.stat(path.join(original,filename)); } catch(e){ if(e.code!=='ENOENT')throw unavailable(); }
      if (!stat?.size) continue;
      if (!official) throw unavailable();
      throw Object.assign(new HttpError(409,'本机 Codex 会把全局 AGENTS.md 一同发送给其原生模型。可以仅为本次提问同意沿用这些说明。'),
        {code:'codexGlobalInstructionsConsent',framework:'codex'});
    }
  }
  const args=[];
  for (const id of Object.keys(config.mcp_servers || {})) {
    if (!/^[\w-]+$/.test(id)) throw unavailable();
    args.push('-c','mcp_servers.'+id+'.enabled=false');
  }
  return {env:{},args};
};
