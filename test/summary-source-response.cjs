'use strict';
require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

async function main() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-summary-source-'));
  const answer = {
    title: 'Reservoirs', overview: 'Two kinds of reservoirs.',
    sections: [{ heading: 'Cooling', page: 2, source: 'P2S1', points: [
      { text: 'The blue tank is cold.', page: 2, source: 'P2S2' },
      { text: 'Old response.', page: 3 },
      { text: 'Conflicting page.', page: 2, source: 'P3S1' },
      { text: 'Unusable ID.', page: 2, source: { paragraph: 4 } },
    ] }],
    concepts: [{ term: 'coolant', meaning: 'liquid', page: 2, source: 'P2S2' }],
    formulas: [{ latex: 'a=b', meaning: 'equilibrium', page: 2, source: 'P2S1' }],
  };
  const geminiFetch = async (_url, init) => {
    const { messages } = JSON.parse(init.body);
    assert.match(messages[0].content, /supporting paragraph ID/);
    assert.match(messages[1].content, /\[P2S2\] The blue tank/);
    return Response.json({ choices: [{ message: { content: JSON.stringify(answer) } }] });
  };
  try {
    const port = await require('../server').start({ vault, geminiFetch });
    const response = await fetch('http://127.0.0.1:' + port + '/api/ai', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Vault': '1', 'X-AI-Key': 'fixture' },
      body: JSON.stringify({ task: 'summary', provider: 'gemini', model: 'fixture',
        content: '--- page 2 ---\n[P2S1] Cooling.\n[P2S2] The blue tank is cold.' }),
    });
    assert.equal(response.status, 200);
    const result = await response.json();
    const [section] = result.sections;
    assert.equal(section.source, 'P2S1');
    assert.deepEqual(section.points.map(p => p.source), ['P2S2', undefined, undefined, undefined]);
    assert.deepEqual(section.points.map(p => p.page), [2, 3, 2, 2]);
    assert.equal(result.concepts[0].source, 'P2S2');
    assert.equal(result.formulas[0].source, 'P2S1');
    console.log('PASS structured paragraph references, legacy replies, mismatched pages and malformed IDs');
  } finally {
    await fs.rm(vault, { recursive: true, force: true });
  }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
