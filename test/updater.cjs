'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createUpdater, verifyBeforeInstall, parseUpdateManifest } = require('../electron/updater');
const { buildBlockMap } = require('app-builder-lib/out/targets/blockmap/blockmap');

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
    fetchImpl: async (resource, options) => {
      const u = String(resource?.url || resource);
      if (u === LATEST) {
        state.checks++;
        if (state.checkFailure) return state.checkFailure();
        return Response.json(state.release);
      }
      if (state.fallback && !state.release.assets.some(asset => asset.browser_download_url === u)) return state.fallback(u, options);
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

const nameFor = v=>'Graphite-Setup-'+v+'.exe';
const webLatest = 'https://github.com/'+REPO+'/releases/latest';
const tagUrl = v=>'https://github.com/'+REPO+'/releases/tag/v'+v;
const ymlUrl = v=>'https://github.com/'+REPO+'/releases/download/v'+v+'/latest.yml';
const sha512 = bytes=>createHash('sha512').update(bytes).digest('base64');
function manifest(version=next, bytes=sample, name=nameFor(version)) {
  return 'version: '+version+'\nfiles:\n  - url: '+name+'\n    sha512: '+sha512(bytes)+'\n    size: '+bytes.length+
    '\npath: '+name+'\nsha512: '+sha512(bytes)+'\n';
}

test('the Windows update manifest binds the exact installer, version, length and both SHA-512 fields',()=>{
  const yml = manifest();
  assert.deepEqual(parseUpdateManifest(yml,next,nameFor(next)),{size:sample.length,sha512:sha512(sample)});
  for (const bad of [yml.replace('version: '+next,'version: '+current),yml.replace('  - url: ','  - url: ../'),yml.replace('    size: '+sample.length,'    size: 0'),
    yml.replace('    sha512: '+sha512(sample),'    sha512: '+sha512('incorrect')),yml+'path: unknown.exe\n',yml.replace('path:','  - url: another.exe\npath:')]) {
    assert.throws(()=>parseUpdateManifest(bad,next,nameFor(next)));
  }
});

test('explicit API limit uses the official stable release page, checking the exact repo even when already current',async t=>{
  const {updater,state}=await scenario(t);
  const reset=Math.ceil(Date.now()/1000)+120;
  state.checkFailure=()=>new Response(null,{status:403,headers:{'x-ratelimit-remaining':'0','x-ratelimit-reset':String(reset)}});
  let destination=tagUrl(current);
  state.fallback=async(u,options)=>{
    assert.equal(u,webLatest);assert.equal(options.method,'HEAD');assert.equal(options.redirect,'manual');
    return new Response(null,{status:302,headers:{location:destination}});
  };
  const checked=await updater.check();assert.equal(checked.available,null);assert.equal(checked.checkError,null);
  for (const wrong of [tagUrl(current).replace(REPO,'other/Graphite'),tagUrl(next)+'-rc.1',tagUrl(next).replace('github.com','other.invalid')]) {
    destination=wrong;
    const status=await updater.check({force:true});
    assert.equal(status.available,null);assert.equal(status.checkError,'rateLimit');
    assert.equal(status.releasePage,webLatest);assert.equal(status.retryAt,new Date(reset*1000).toISOString());
  }
  assert.equal(state.downloads,0);assert.equal(state.launched.length,0);assert.equal(state.quits,0);
});

test('rate-limited newer release requires its own official manifest and verifies the asset SHA-512 before handoff',async t=>{
  const {updater,state}=await scenario(t);
  state.checkFailure=()=>new Response(null,{status:429,headers:{'retry-after':'120'}});
  const cdn='https://release-assets.githubusercontent.com/a/signed-fixture';
  let mode='missing';
  state.fallback=async(u,opts)=>{
    if(u===webLatest)return new Response(null,{status:302,headers:{location:tagUrl(next)}});
    if(u===ymlUrl(next)){
      if(mode==='missing')return new Response(null,{status:404});
      if(mode==='alien')return new Response(null,{status:302,headers:{location:'https://unrelated.invalid/latest.yml'}});
      return new Response(null,{status:302,headers:{location:cdn}});
    }
    assert.equal(u,cdn);assert.equal(opts.redirect,'error');
    return new Response(mode==='wrong' ? manifest(current) : manifest(),{status:200});
  };
  for(mode of ['missing','alien','wrong']) {
    const checked=await updater.check({force:true});
    assert.equal(checked.available,null);assert.equal(checked.checkError,'rateLimit');assert.ok(Date.parse(checked.retryAt)>Date.now());
    assert.equal((await updater.install()).errorCode,'noInstaller');
  }
  mode='ok';const ok=await updater.check({force:true});
  assert.equal(ok.available,next);assert.equal(ok.checkError,null);assert.equal(ok.sha512,sha512(sample));
  state.data=async()=>new Response(Buffer.alloc(sample.length,1));
  assert.equal((await updater.install()).errorCode,'integrity');
  assert.equal(state.launched.length,0);assert.equal(state.quits,0);
  state.data=async()=>new Response(sample);
  state.launch=async f=>assert.deepEqual(await fs.readFile(f),sample);
  assert.equal((await updater.install()).ok,true);assert.equal(state.launched.length,1);assert.equal(state.quits,1);
});

test('permission, offline and ordinary HTTP failures do not consult the release page',async t=>{
  const {state,updater}=await scenario(t);
  let webRequests=0;
  state.fallback=()=>{webRequests++;throw Error('unexpected fallback');};
  for(const status of [403,404,500]){
    state.checkFailure=()=>new Response(null,{status});
    assert.equal((await updater.check({force:true})).checkError,'release');
  }
  state.checkFailure=()=>{throw Error('offline');};
  assert.equal((await updater.check({force:true})).checkError,'offline');
  assert.equal(webRequests,0);
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
  await buildBlockMap(file, 'gzip', file + '.blockmap');
  const found = await updater.check();
  assert.equal(found.available, next);
  assert.equal(found.source, 'folder');
  state.launch = async tmp => {
    assert.notEqual(tmp, file);
    assert.deepEqual(await fs.readFile(tmp), sample);
  };
  assert.equal((await updater.install()).ok, true);
});

test('a synced blockmap cannot make a truncated or damaged local file installable; completing the copy allows retry', async t => {
  const {updater, state, dist} = await scenario(t);
  state.release = release(current);
  const file = path.join(dist,'Graphite-Setup-'+next+'.exe');
  const original = Buffer.from('These are inert test bytes, not Windows instructions.\n'.repeat(8000));
  await fs.writeFile(file,original);
  await buildBlockMap(file,'gzip',file+'.blockmap');
  assert.equal((await updater.check()).source,'folder');
  let saves=0;
  state.save=async()=>{saves++;return {ok:true};};
  const damaged=Buffer.from(original);
  damaged[damaged.length-500]^=1;
  for(const bytes of [original.subarray(0,2000),damaged]) {
    await fs.writeFile(file,bytes);
    const result=await updater.install();
    assert.equal(result.errorCode,'integrity',JSON.stringify({result,launches:state.launched.length,quits:state.quits}));
    assert.equal(state.launched.length,0);assert.equal(state.quits,0);assert.equal(saves,0);
  }
  await fs.writeFile(file,original);
  state.launch=async staged=>assert.deepEqual(await fs.readFile(staged),original);
  assert.equal((await updater.install()).ok,true);assert.equal(saves,1);
  assert.equal(state.launched.length,1);assert.equal(state.quits,1);
});

test('a matching builder manifest must match the staged bytes, and an incomplete blockmap cannot authorize them',async t=>{
  const {state,updater,dist}=await scenario(t);
  state.release=release(current);
  const name=nameFor(next),file=path.join(dist,name), yml=path.join(dist,'latest.yml');
  await fs.writeFile(file,sample);await buildBlockMap(file,'gzip',file+'.blockmap');
  await updater.check();
  for (const invalid of [manifest(next,Buffer.alloc(sample.length)),manifest(next,Buffer.alloc(sample.length+1)),'version: [unfinished','version: '+next]) {
    await fs.writeFile(yml,invalid);
    assert.equal((await updater.install()).errorCode,'integrity');
  }
  const good=await fs.readFile(file+'.blockmap');await fs.writeFile(yml,manifest());
  await fs.writeFile(file+'.blockmap',good.subarray(0,12));
  assert.equal((await updater.install()).errorCode,'integrity');
  assert.equal(state.launched.length,0);assert.equal(state.quits,0);
  await fs.writeFile(file+'.blockmap',good);
  assert.equal((await updater.install()).ok,true);assert.equal(state.quits,1);
});

test('an older differently named local build uses its own real blockmap when latest.yml describes another installer',async t=>{
  const {state,updater,dist}=await scenario(t);state.release=release(current);
  const name='MyObsidian-Setup-'+next+'.exe',file=path.join(dist,name);
  await fs.writeFile(file,sample);await buildBlockMap(file,'gzip',file+'.blockmap');
  await fs.writeFile(path.join(dist,'latest.yml'),manifest('1.1.45',Buffer.from('unrelated newer file')));
  assert.equal((await updater.check()).name,name);
  assert.equal((await updater.install()).ok,true);assert.equal(state.quits,1);
});

test('real packaged installer matches electron-builder latest.yml and all compressed blockmap checksums', {skip:!process.env.GRAPHITE_TEST_UPDATE_DIR}, async t=>{
  const dist=path.resolve(process.env.GRAPHITE_TEST_UPDATE_DIR);
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-known-update-'));
  t.after(()=>fs.rm(temp,{recursive:true,force:true}));
  const metadata=await fs.readFile(path.join(dist,'latest.yml'),'utf8');
  const doc=require('js-yaml').load(metadata);
  const expected=parseUpdateManifest(metadata,doc.version,doc.path);
  let launched=0,quits=0;
  const updater=createUpdater({current:'0.0.0',getRepo:()=>null,getFolder:()=>dist,getTemp:()=>temp,
    beforeInstall:async()=>({ok:true}),onReadyToQuit:()=>{quits++;},
    launch:async staged=>{
      launched++;
      assert.equal(path.basename(staged),doc.path);
      const bytes=await fs.readFile(staged);
      assert.equal(bytes.length,expected.size);assert.equal(sha512(bytes),expected.sha512);
    }});
  assert.equal((await updater.check()).name,doc.path);
  assert.equal((await updater.install()).ok,true);assert.equal(launched,1);assert.equal(quits,1);
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
