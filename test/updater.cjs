'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createUpdater, verifyBeforeInstall } = require('../electron/updater');

const REPO = 'baylorinf/Graphite';
const LATEST = 'https://api.github.com/repos/' + REPO + '/releases/latest';
const current = '1.1.41', next = '1.1.42';
const sample = Buffer.from('A local test fixture, never an executable.');

function release(version, bytes = sample) {
  const name = 'Graphite-Setup-' + version + '.exe';
  return {
    tag_name: 'v' + version, prerelease: false, draft: false, body: 'Update notes',
    assets: [{ name, state: 'uploaded', size: bytes.length,
      browser_download_url: 'https://github.com/' + REPO + '/releases/download/v' + version + '/' + name,
      digest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }],
  };
}

async function scenario(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-update-test-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const dist = path.join(dir, 'dist'), temp = path.join(dir, 'temp');
  await Promise.all([fs.mkdir(dist), fs.mkdir(temp)]);
  const state = {
    release: release(next), checks: 0, downloads: 0, launched: [], quits: 0, notices: [],
    checkFailure: null, save: async () => ({ ok: true }),
    data: async () => new Response(sample, { headers: { 'content-length': String(sample.length) } }),
    launch: async () => {},
  };
  const updater = createUpdater({
    current, getRepo: () => REPO, getFolder: () => dist, getTemp: () => temp,
    fetchImpl: async resource => {
      const u = String(resource?.url || resource);
      if (u === LATEST) {
        state.checks++;
        if (state.checkFailure) return state.checkFailure();
        return Response.json(state.release);
      }
      assert.ok(state.release.assets.some(asset => asset.browser_download_url === u), 'Unexpected network request: ' + u);
      state.downloads++;
      return state.data();
    },
    beforeInstall: () => state.save(),
    launch: async file => { state.launched.push(file); return state.launch(file); },
    onReadyToQuit: () => { state.quits++; },
    onState: value => state.notices.push(value),
  });
  return { state, updater, dist };
}

test('finds the official release, downloads its exact bytes and hands off once', async t => {
  const { state, updater } = await scenario(t);
  const found = await updater.check();
  assert.equal(found.source, 'github');
  assert.equal(found.available, next);
  state.launch = async file => { assert.deepEqual(await fs.readFile(file), sample); assert.equal(state.quits, 0); };
  assert.equal((await updater.install()).ok, true);
  assert.equal(state.launched.length, 1);
  assert.equal(state.quits, 1);
});

test('automatic checks can use cache, an explicit check sees a newly published release immediately', async t => {
  const { updater, state } = await scenario(t);
  state.release = release(current);
  assert.equal((await updater.check()).available, null);
  await updater.check();
  assert.equal(state.checks, 1);
  state.release = release(next);
  const found = await updater.check({ force: true });
  assert.equal(state.checks, 2);
  assert.equal(found.available, next);
});

test('reports failed release checks separately from being up to date and can recover', async t => {
  const { updater, state } = await scenario(t);
  state.checkFailure = () => { throw new Error('Offline for this test'); };
  const offline = await updater.check();
  assert.ok(offline.checkError);
  state.checkFailure = () => Response.json({ message: 'API rate limit exceeded' }, {
    status: 403, headers: { 'x-ratelimit-remaining': '0' } });
  const exhausted = await updater.check({ force: true });
  assert.ok(exhausted.checkError);
  state.checkFailure = null;
  const healthy = await updater.check({ force: true });
  assert.equal(healthy.available, next);
  assert.ok(!healthy.checkError);
});

test('ignores an incomplete local build and recognizes a completed newer installer', async t => {
  const { updater, state, dist } = await scenario(t);
  state.release = release(current);
  const file = path.join(dist, 'Graphite-Setup-' + next + '.exe');
  await fs.writeFile(file, sample);
  assert.equal((await updater.check()).available, null);
  await fs.writeFile(file + '.blockmap', 'complete');
  const found = await updater.check();
  assert.equal(found.available, next);
  assert.equal(found.source, 'folder');
  state.launch = async tmp => {
    assert.notEqual(tmp, file);
    assert.deepEqual(await fs.readFile(tmp), sample);
  };
  assert.equal((await updater.install()).ok, true);
});

test('an unsaved note prevents handoff and exit, saving it allows a retry', async t => {
  const { updater, state } = await scenario(t);
  await updater.check();
  state.save = () => verifyBeforeInstall(async () => ({ ok: false, unsaved: [{ path: 'Course/Draft.md' }] }), async () => {});
  assert.equal((await updater.install()).ok, false);
  assert.equal(state.launched.length, 0);
  assert.equal(state.quits, 0);
  state.save = () => verifyBeforeInstall(async () => ({ ok: true, unsaved: [] }), async () => {});
  assert.equal((await updater.install()).ok, true);
  assert.equal(state.launched.length, 1);
});

test('a rejected or stalled renderer save does not launch an installer', async t => {
  const { updater, state } = await scenario(t);
  await updater.check();
  for (const flush of [async () => { throw Error('Renderer closed'); }, () => new Promise(() => {})]) {
    state.save = () => verifyBeforeInstall(flush, async () => {}, 20);
    assert.equal((await updater.install()).ok, false);
  }
  assert.equal(state.launched.length, 0);
  assert.equal(state.quits, 0);
});

test('rejects short transfers even when Content-Length matches the short body, and rejects incorrect same-length bytes', async t => {
  const { updater, state } = await scenario(t);
  await updater.check();
  const wrong = [Buffer.from('short'), Buffer.alloc(sample.length, 1)];
  for (const body of wrong) {
    state.data = async () => new Response(body, { headers: { 'content-length': String(body.length) } });
    assert.equal((await updater.install()).ok, false);
    assert.equal(state.launched.length, 0);
    assert.equal(state.quits, 0);
  }
});

test('a network failure part way through a stream is recoverable on retry', async t => {
  const { updater, state } = await scenario(t);
  await updater.check();
  state.data = async () => {
    let sent = false;
    return new Response(new ReadableStream({
      pull(controller) {
        if (!sent) { sent = true; controller.enqueue(new Uint8Array([1, 2])); }
        else controller.error(new Error('Disconnected'));
      },
    }));
  };
  assert.equal((await updater.install()).ok, false);
  assert.equal(state.launched.length, 0);
  assert.equal(state.quits, 0);
  state.data = async () => new Response(sample);
  assert.equal((await updater.install()).ok, true);
});

test('two install clicks start at most one installer', async t => {
  const { updater, state } = await scenario(t);
  await updater.check();
  let reached, resume;
  const entered = new Promise(resolve => { reached = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  state.data = async () => { reached(); await gate; return new Response(sample); };
  const one = updater.install();
  await entered;
  const two = updater.install();
  resume();
  await Promise.all([one, two]);
  assert.equal(state.downloads, 1);
  assert.equal(state.launched.length, 1);
  assert.equal(state.quits, 1);
});

test('failed installer launch leaves the app open and allows another attempt', async t => {
  const { updater, state } = await scenario(t);
  await updater.check();
  state.launch = async () => { throw new Error('Installer is busy'); };
  assert.equal((await updater.install()).ok, false);
  assert.equal(state.quits, 0);
  state.launch = async () => {};
  assert.equal((await updater.install()).ok, true);
  assert.equal(state.quits, 1);
});
