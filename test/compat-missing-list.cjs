'use strict';
require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-key-check-'));
  const calls = [];
  const provider = http.createServer((req, res) => {
    const accepted = req.headers.authorization === 'Bearer synthetic-accepted';
    calls.push(req.method);
    const status = req.method === 'GET' ? 404 : accepted ? 200 : 401;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(status === 200 ? { choices: [{ message: { content: 'ok' } }] } : { error: { message: 'Unavailable' } }));
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  try {
    const port = await require('../server').start({ vault });
    async function ask(task, key) {
      const res = await fetch('http://127.0.0.1:' + port + '/api/ai', {
        method: 'POST', headers: { 'X-Vault': '1', 'X-AI-Key': key, 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider: 'custom', baseUrl: 'http://127.0.0.1:' + provider.address().port, task, model: 'fixture', text: 'demo' }),
      });
      return { status: res.status, data: await res.json() };
    }
    for (const key of ['synthetic-rejected', 'synthetic-accepted']) {
      const list = await ask('test', key);
      assert.equal(list.status, 422);
      assert.match(list.data.error, /could not be verified/);
    }
    assert.deepEqual(calls, ['GET', 'GET']);
    assert.equal((await ask('chat', 'synthetic-rejected')).status, 401);
    assert.equal((await ask('chat', 'synthetic-accepted')).data.text, 'ok');
    console.log('PASS missing list never confirms a key or triggers an inference; manually chosen models still work');
  } finally {
    provider.close();
    await fs.rm(vault, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
