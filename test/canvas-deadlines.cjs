'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { track, changesFor } = require('../canvas-deadlines');
const { createCanvasService } = require('../canvas-service');
const os = require('node:os');

const FRI = '2026-12-04T15:59:00.000Z', WED = '2026-12-02T15:59:00.000Z', MON = '2026-12-07T15:59:00.000Z';
const snap = due => ({ courses: [{ id: '880', name: '设计实验', assignments: [{ id: '8801', title: '实验报告', dueAt: due }, { id: '8802', title: '草图', dueAt: null }] }], warnings: [] });
let n = 0;
const sync = (prev, due, who = { accountId: 'u1', user: '测试生' }) => track(prev, { ...prev, ...who, auth: null, snapshot: snap(due), syncedAt: new Date(Date.UTC(2026, 10, 1) + ++n * 1000).toISOString() });

test('first sync is only a baseline; a moved date is one record; later syncs keep one record', () => {
  let s = sync({}, FRI);
  assert.deepEqual(changesFor(s), []);
  s = sync(s, WED);
  assert.equal(changesFor(s).length, 1);
  assert.deepEqual({ ...changesFor(s)[0], seenAt: undefined }, { courseId: '880', assignmentId: '8801', courseName: '设计实验', title: '实验报告',
    seenAt: undefined, from: FRI, to: WED, kind: 'earlier', url: 'https://oc.sjtu.edu.cn/courses/880/assignments/8801' });
  s = sync(s, WED);
  assert.equal(changesFor(s).length, 1);
  s = sync(s, MON);
  assert.deepEqual(changesFor(s).map(c => [c.from, c.to, c.kind]), [[FRI, MON, 'later']]);
  s = sync(s, FRI);
  assert.deepEqual(changesFor(s), [], 'moving back to the original date removes the record');
});

test('partial saves do not compare, and another account starts from a fresh baseline', () => {
  let s = sync(sync({}, FRI), WED);
  const partial = track(s, { ...s, snapshot: snap(MON) });
  assert.equal(changesFor(partial)[0].to, WED);
  const other = sync(s, MON, { accountId: 'u2', user: '另一位' });
  assert.deepEqual(changesFor(other), []);
  assert.deepEqual(changesFor(sync(other, MON, { accountId: 'u2', user: '另一位' })), []);
  assert.deepEqual(changesFor({ ...s, accountId: 'u2' }), [], 'the list is never shown to another account');
});

test('the status endpoint returns deadlineChanges', async () => {
  let saved = { accountId: 'u1', user: '测试生', auth: { userId: 'u1', accessToken: 'x' }, snapshot: snap(FRI), syncedAt: '2026-11-01T00:00:00Z' };
  saved = sync(sync(saved, FRI), WED);
  const svc = createCanvasService({ vault: os.tmpdir(), storage: { load: async () => structuredClone(saved), save: async () => {} } });
  const status = await svc.handle('GET', 'status');
  assert.equal(status.deadlineChanges.length, 1);
  assert.equal(status.deadlineChanges[0].kind, 'earlier');
});

test('a shared display name alone cannot identify the owner of a saved history', () => {
  const legacy = {portalSyncEnabled:true,user:'Alex',snapshot:snap(WED),
    deadlines:{owner:'name:Alex',base:{'880:8801':FRI},changes:[{title:'Previous session'}]}};
  assert.deepEqual(changesFor(legacy), []);
  const next = track(legacy,{...legacy,syncedAt:'2026-12-01T10:00:00Z'});
  assert.deepEqual(changesFor(next), []);
});

test('the source always opens the assignment whose date changed', () => {
  const baseline = sync({},FRI);
  const snapshot = snap(WED);
  snapshot.courses[0].assignments[0].url = '/courses/880/assignments/9999';
  const state = track(baseline,{...baseline,snapshot,syncedAt:'2026-12-01T10:00:00Z'});
  assert.match(changesFor(state)[0].url,/\/courses\/880\/assignments\/8801$/);
  state.deadlines.changes[0].url = '/courses/880/assignments/9999';
  assert.match(changesFor(state)[0].url,/\/courses\/880\/assignments\/8801$/);
});

test('a failed read leaves the baseline alone; two completed reads can share a timestamp', async () => {
  let due = FRI, offline = false;
  let state = {portalSyncEnabled:true,webVerified:true,user:'Demo',webSessionId:'session'};
  const start = () => createCanvasService({vault:os.tmpdir(),autoPullMs:0,migrate:false,
    desktop:{syncWeb:async ({onCourse})=>{
      const snapshot = {...snap(due),webIdentity:'7'};
      await onCourse({...snapshot,total:1});
      if (offline) throw new Error('offline');
      return {snapshot,user:'Demo',syncedAt:'2026-11-24T09:00:00Z'};
    }},storage:{load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v);}}});
  let svc=start();
  await svc.handle('POST','sync');
  due=WED; offline=true;
  await assert.rejects(svc.handle('POST','sync'),/offline/);
  assert.deepEqual((await svc.handle('GET','status')).deadlineChanges,[]);
  offline=false;
  await svc.handle('POST','sync');
  svc=start();
  assert.deepEqual((await svc.handle('GET','status')).deadlineChanges.map(c=>c.to),[WED]);
});

test('a newer official API sync wins over a slow pull for the same account', async t => {
  const fs = require('node:fs/promises'), path = require('node:path');
  const vault = await fs.mkdtemp(path.join(os.tmpdir(),'graphite-api-order-'));
  t.after(()=>fs.rm(vault,{recursive:true,force:true}));
  let state = sync({},FRI);
  state.auth={userId:'u1',accessToken:'fixture'};
  const started=Promise.withResolvers(), unblock=Promise.withResolvers();
  let count=0;
  const fetch=async raw=>{
    const url=new URL(raw);
    if (url.pathname==='/api/v1/courses') return Response.json([{id:880,name:'Demo'}]);
    if (url.pathname.endsWith('/assignments')) {
      const first=++count===1;
      if(first){started.resolve();await unblock.promise;}
      return Response.json([{id:8801,name:'Report',due_at:first?FRI:WED}]);
    }
    return Response.json([]);
  };
  const svc=createCanvasService({vault,fetch,autoPullMs:0,migrate:false,
    storage:{load:async()=>structuredClone(state),save:async v=>{state=structuredClone(v);}}});
  const pull=svc.handle('POST','pull',{});
  await started.promise;
  try {await svc.handle('POST','sync');} finally {unblock.resolve();await pull;}
  const end=await svc.handle('GET','status');
  assert.equal(end.snapshot.courses[0].assignments[0].dueAt,WED);
  assert.deepEqual(end.deadlineChanges.map(c=>c.to),[WED]);
});

for (const capped of [false,true]) test('a slow material read keeps the newer date' + (capped ? ' and refreshes missing materials' : ''), async t => {
  const fs = require('node:fs/promises'), path = require('node:path');
  const vault = await fs.mkdtemp(path.join(os.tmpdir(),'graphite-date-order-'));
  t.after(() => fs.rm(vault,{recursive:true,force:true}));
  const snapshot = date => ({...snap(date),webIdentity:'7'});
  let saved = track({}, {portalSyncEnabled:true,webVerified:true,user:'Demo',webSessionId:'session',
    snapshot:snapshot(FRI),syncedAt:'2026-11-23T08:00:00Z'});
  const started = Promise.withResolvers(), unblock = Promise.withResolvers();
  let fullReads = 0;
  const desktop = {syncWeb: async ({fullMaterials,onCourse}) => {
    const old = fullMaterials && ++fullReads === 1;
    if (old) { started.resolve(); await unblock.promise; }
    const s = snapshot(old ? FRI : WED);
    if (capped && !fullMaterials) s.warnings.push('此栏目超过 100 页');
    if (capped && fullMaterials && !old) s.courses[0].assignments[0].description='Complete material';
    await onCourse({...s,total:1});
    return {snapshot:s,user:'Demo',syncedAt:fullMaterials?'2026-11-24T09:01:00Z':'2026-11-24T09:00:00Z'};
  }};
  const svc = createCanvasService({vault,desktop,autoPullMs:0,migrate:false,
    storage:{load:async()=>structuredClone(saved),save:async v=>{saved=structuredClone(v);}}});
  const pull=svc.handle('POST','pull',{});
  await started.promise;
  try {
    const fast=await svc.handle('POST','sync');
    assert.equal(fast.deadlineChanges[0]?.to,WED);
  } finally { unblock.resolve(); await pull; }
  const end=await svc.handle('GET','status');
  assert.equal(fullReads,capped?2:1);
  if (capped) assert.equal(end.snapshot.courses[0].assignments[0].description,'Complete material');
  assert.equal(end.snapshot.courses[0].assignments[0].dueAt,WED);
  assert.deepEqual(end.deadlineChanges.map(c=>c.to),[WED]);
});
