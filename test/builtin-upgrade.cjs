'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawnSync} = require('node:child_process');

const product = path.resolve(process.env.GRAPHITE_TEST_APP || path.join(__dirname, '..'));

function fixture(t) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'graphite-builtin-upgrade-'));
  t.after(() => fs.rmSync(vault, {recursive:true, force:true, maxRetries:3}));
  const config = path.join(vault, '.obsidian');
  const plugin = path.join(config, 'plugins', 'claude-capture');
  fs.mkdirSync(plugin, {recursive:true});
  return {vault, config, plugin};
}

function start(vault, faultTarget = '') {
  const child = spawnSync(process.execPath, ['-e', `
    const fs = require('node:fs/promises');
    for (const method of ['writeFile','rename']) {
      const original=fs[method];
      fs[method]=async (...args)=>{
        if(process.argv[3] && args[method==='rename'?1:0]===process.argv[3]) {
          throw Object.assign(new Error('Synthetic disk full'),{code:'ENOSPC'});
        }
        return original(...args);
      };
    }
    require(process.argv[1]).start({vault:process.argv[2]}).then(()=>process.exit(0),e=>{console.error(e);process.exit(1)});
  `, path.join(product,'server.js'), vault, faultTarget], {
    timeout:15000, encoding:'utf8', windowsHide:true,
    env:{...process.env, GRAPHITE_HOME:path.join(vault, 'mock-home'), GRAPHITE_CLAUDE_DIR:path.join(vault, 'mock-claude')}
  });
  assert.equal(child.status,0,child.stderr || child.error?.message);
  return child.stderr;
}

test('an unreadable enabled list survives startup and can be repaired before retrying',t=>{
  const {vault,config}=fixture(t), enabled=path.join(config,'community-plugins.json');
  const interrupted='["my-existing-extension",';
  fs.writeFileSync(enabled,interrupted);
  start(vault);
  assert.equal(fs.readFileSync(enabled,'utf8'),interrupted);
  fs.writeFileSync(enabled,'["my-existing-extension"]');
  start(vault);
  const items=JSON.parse(fs.readFileSync(enabled,'utf8'));
  assert.ok(items.includes('my-existing-extension') && items.includes('claude-capture'));
});

test('an interrupted built-in upgrade keeps the previous plugin executable, settings and version',t=>{
  const {vault,plugin}=fixture(t);
  const original={'main.js':'// old working version','data.json':'{"mine":true}', 'manifest.json':'{"id":"claude-capture","version":"0.0.1"}'};
  for(const [name,bytes] of Object.entries(original)) fs.writeFileSync(path.join(plugin,name),bytes);
  assert.match(start(vault,path.join(plugin,'manifest.json')),/Synthetic disk full/);
  for(const [name,bytes] of Object.entries(original)) assert.equal(fs.readFileSync(path.join(plugin,name),'utf8'),bytes,name);
  start(vault);
  assert.equal(fs.readFileSync(path.join(plugin,'data.json'),'utf8'),original['data.json']);
  assert.notEqual(fs.readFileSync(path.join(plugin,'main.js'),'utf8'),original['main.js']);
  assert.notEqual(JSON.parse(fs.readFileSync(path.join(plugin,'manifest.json'),'utf8')).version,'0.0.1');
});

test('a damaged plugin manifest is preserved without disabling other built-ins',t=>{
  const {vault,config,plugin}=fixture(t);
  fs.writeFileSync(path.join(plugin,'manifest.json'),'{"id":');
  fs.writeFileSync(path.join(plugin,'main.js'),'// awaiting repair');
  start(vault);
  assert.equal(fs.readFileSync(path.join(plugin,'manifest.json'),'utf8'),'{"id":');
  assert.equal(fs.readFileSync(path.join(plugin,'main.js'),'utf8'),'// awaiting repair');
  const enabled=JSON.parse(fs.readFileSync(path.join(config,'community-plugins.json'),'utf8'));
  assert.ok(enabled.includes('claude-chat'));
  assert.ok(!enabled.includes('claude-capture'));
});
