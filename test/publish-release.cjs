'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {createHash} = require('node:crypto');
const { publishRelease, releaseFiles } = require('../scripts/publish-github');

function setup() {
  const tag = 'v1.2.3', commit = 'a'.repeat(40);
  const files = ['Graphite-Setup-1.2.3.exe','Graphite-Setup-1.2.3.exe.blockmap','latest.yml'].map((name,i) =>
    ({ name, size: 100+i, digest: 'sha256:' + String(i+1).repeat(64) }));
  let release;
  const head = { head: commit, tag: null }, calls = [];
  const remote = {
    find: async () => release ? structuredClone(release) : undefined,
    get: async () => structuredClone(release),
    async create() {
      calls.push('draft');
      release = { id: 5, tag_name: tag, target_commitish: commit, draft: true, prerelease: false,
        assets: [], html_url: 'https://github.com/example/Graphite/releases/tag/' + tag };
    },
    async upload(_id, f) {
      calls.push('upload:' + f.name); release.assets.push({ ...f, id: release.assets.length+1, state:'uploaded' });
    },
    async removeEmpty(id) { calls.push('remove:' + id); release.assets = release.assets.filter(a => a.id !== id); },
    async publish() {
      calls.push('publish'); assert.equal(release.assets.length, files.length);
      head.tag = commit; release.draft = false; return structuredClone(release);
    },
  };
  return { files, head, calls, remote, record: () => release,
    run: () => publishRelease({ remote, refs: () => head, tag, commit, files }) };
}
test('uploads the complete draft before publishing, and rerunning has no effect on public assets', async () => {
  const h = setup();
  assert.match(await h.run(), /v1\.2\.3$/);
  assert.deepEqual(h.calls, ['draft', ...h.files.map(f=>'upload:'+f.name), 'publish']);
  const count = h.calls.length;
  await h.run();
  assert.equal(h.calls.length, count);
  h.record().assets[0].digest='sha256:other';
  await assert.rejects(h.run(), /SHA-256/);
  assert.equal(h.calls.length, count);
});
test('resumes a matching interrupted draft and drops only an abandoned zero-byte starter', async () => {
  const h=setup();
  const upload=h.remote.upload;
  h.remote.upload=async (id,file)=>{
    if(file===h.files[1]){
      h.record().assets.push({id:99,name:file.name,state:'starter',size:0});throw Error('interrupted');
    }
    await upload(id,file);
  };
  await assert.rejects(h.run(), /interrupted/); assert.equal(h.record().draft, true);
  h.remote.upload=upload;
  await h.run();
  assert.deepEqual(h.calls,['draft','upload:'+h.files[0].name,'remove:99','upload:'+h.files[1].name,'upload:latest.yml','publish']);
});
test('won’t promote files of the wrong size or digest, including corruption between upload and publish', async () => {
  const h=setup(), get=h.remote.get;
  h.remote.get=async id=>{const r=await get(id);r.assets[1].size=2;return r;};
  await assert.rejects(h.run(), /SHA-256/); assert.equal(h.record().draft,true);
  h.remote.get=get; h.record().assets[0].digest='sha256:other';
  await assert.rejects(h.run(), /SHA-256/);assert.ok(!h.calls.includes('publish'));
});
test('refuses unpushed source, unrelated tags, and stale draft targets', async () => {
  const h=setup();h.head.head='other';
  await assert.rejects(h.run(), /Push/);assert.deepEqual(h.calls,[]);
  h.head.head='a'.repeat(40);h.head.tag='other';
  await assert.rejects(h.run(), /different commit/);assert.deepEqual(h.calls,[]);
  h.head.tag=null;await h.remote.create();h.record().target_commitish='other';
  await assert.rejects(h.run(), /not pinned/);assert.deepEqual(h.calls,['draft']);
});

test('the release includes a manifest matching the actual installer and refuses stale same-length content',async t=>{
  const dist=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-release-files-'));
  t.after(()=>fs.rm(dist,{recursive:true,force:true}));
  const version='1.2.3', name='Graphite-Setup-'+version+'.exe', bytes=Buffer.from('synthetic file');
  const sha512=createHash('sha512').update(bytes).digest('base64');
  const yaml=['version: '+version,'files:','  - url: '+name,'    sha512: '+sha512,'    size: '+bytes.length,'path: '+name,'sha512: '+sha512].join('\n');
  await Promise.all([fs.writeFile(path.join(dist,name),bytes),fs.writeFile(path.join(dist,name+'.blockmap'),'fixture'),fs.writeFile(path.join(dist,'latest.yml'),yaml)]);
  assert.deepEqual((await releaseFiles(dist,version)).map(f=>f.name),[name,name+'.blockmap','latest.yml']);
  await fs.writeFile(path.join(dist,name),Buffer.alloc(bytes.length,1));
  await assert.rejects(releaseFiles(dist,version),/manifest does not match/);
});
