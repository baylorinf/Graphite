'use strict';
require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-gemini-network-'));
  const replies = [
    [200, { data: [{ id: 'fixture' }] }],
    [200, { choices: [{ message: { content: 'ok' } }] }],
    [400, { error: { status: 'FAILED_PRECONDITION', message: 'User location is not supported for the API use.' } }],
    [401, { error: { message: 'Invalid key' } }],
  ];
  const requests = [];
  const geminiFetch = async (url, init) => {
    requests.push({ url, headers: init.headers });
    const [status, body] = replies.shift();
    return Response.json(body, { status });
  };
  try {
    const port = await require('../server').start({ vault, geminiFetch });
    async function ask(task) {
      const response = await fetch('http://127.0.0.1:' + port + '/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Vault': '1', 'X-AI-Key': 'synthetic-only' },
        body: JSON.stringify({ provider: 'gemini', model: 'fixture', task, text: 'hello' }),
      });
      return { status: response.status, data: await response.json() };
    }
    assert.deepEqual((await ask('test')).data.models, ['fixture']);
    assert.deepEqual((await ask('chat')).data, { text: 'ok' });
    const region = await ask('test');
    assert.equal(region.status, 403);
    assert.match(region.data.error, /current location/);
    assert.equal((await ask('chat')).status, 401);
    assert.equal(requests.length, 4);
    assert.deepEqual(requests.map(r => new URL(r.url).pathname.split('/').pop()), ['models', 'completions', 'models', 'completions']);
    assert.ok(requests.every(r => new URL(r.url).hostname === 'generativelanguage.googleapis.com' && r.headers.Authorization === 'Bearer synthetic-only'));
    console.log('PASS Gemini model list, generation, regional refusal and invalid credentials');
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
