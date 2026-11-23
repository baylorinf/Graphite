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
