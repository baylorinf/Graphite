'use strict';
// 1.1.53: the old Canvas/ folder is split into the course folders, once. Mirrors the real layout:
// Canvas/<课程 (id)>/ with files, 课程要求.md and 作业/*.md; the student's own Linear Algebra folder.
//   node test/canvas-migrate.cjs
require('./isolate.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fss = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createCanvasService } = require('../canvas-service');

async function setup() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-migrate-'));
  const put = async (rel, body) => { await fs.mkdir(path.dirname(path.join(vault, rel)), { recursive: true }); await fs.writeFile(path.join(vault, rel), body); };
  await put('Linear Algebra/课件 Slides/LA1.pdf', 'slides 1');
  await put('Linear Algebra/我的笔记.md', '# mine\n');
  const C = 'Canvas/线性代数（荣誉） (98418)/';
  await put(C + 'LA1.pdf', 'slides 1');           // already in the course folder
  await put(C + 'LA2.pdf', 'slides 2');           // new
  await put(C + 'HWOct10.pdf', 'hw');
  await put(C + '课程要求.md', '# 线性代数 · 课程要求\n');
  await put(C + '作业/HW1 (5).md', '# HW1\n\n## 附件\n\n- [HWOct10.pdf](../HWOct10.pdf)\n\n[在 Canvas 查看](https://oc.sjtu.edu.cn/courses/98418/assignments/5)\n');
  await put('Canvas/网球 (98163)/作业/体测 (9).md', '# 体测\n');
  await put('Canvas/Downloads/saved.pdf', 'dl');
  return vault;
}

test('splits Canvas/ into the course folders, files new slides, rewrites links, keeps records', async () => {
  const vault = await setup();
  let state = { portalSyncEnabled: true, webVerified: true, snapshot: { webIdentity: '1', courses: [
    { id: '98418', name: '线性代数（荣誉）', files: [{ id: '1', name: 'LA1.pdf' }, { id: '2', name: 'LA2.pdf' }, { id: '3', name: 'HWOct10.pdf' }] },
    { id: '98163', name: '网球', files: [] }] },
    pullCache: { owner: 'web:1', files: {
      '98418/1': { path: 'Canvas/线性代数（荣誉） (98418)/LA1.pdf' }, '98418/2': { path: 'Canvas/线性代数（荣誉） (98418)/LA2.pdf' },
      '98418/3': { path: 'Canvas/线性代数（荣誉） (98418)/HWOct10.pdf' } },
      notes: { '98418/5': { path: 'Canvas/线性代数（荣誉） (98418)/作业/HW1 (5).md', digest: 'x', owned: true } } } };
  const svc = createCanvasService({ vault, migrate: false, storage: { load: async () => structuredClone(state), save: async v => { state = v; } } });
  const out = await svc.migrateLegacy();
  assert.ok(out && !out.left, JSON.stringify(out));
  assert.equal(fss.existsSync(path.join(vault, 'Canvas')), false, 'Canvas/ is gone');
  // Notes into the course folders; a course without a folder gets one named after it.
  assert.ok(fss.existsSync(path.join(vault, 'Linear Algebra/课程要求.md')));
  assert.ok(fss.existsSync(path.join(vault, 'Linear Algebra/作业 Homework/HW1 (5).md')));
  assert.ok(fss.existsSync(path.join(vault, '网球/作业 Homework/体测 (9).md')));
  assert.ok(fss.existsSync(path.join(vault, 'Downloads/saved.pdf')));
  // Raw files in the hidden store; new ones filed, the one already there not copied twice.
  assert.ok(fss.existsSync(path.join(vault, '.obsidian/graphite/canvas/线性代数（荣誉） (98418)/LA2.pdf')));
  assert.equal(await fs.readFile(path.join(vault, 'Linear Algebra/课件 Slides/LA2.pdf'), 'utf8'), 'slides 2');
  assert.equal(fss.existsSync(path.join(vault, 'Linear Algebra/课件 Slides/LA1 (2).pdf')), false);
  assert.ok(fss.existsSync(path.join(vault, 'Linear Algebra/作业 Homework/HWOct10.pdf')));
  // The note's link points at the filed copy.
  assert.match(await fs.readFile(path.join(vault, 'Linear Algebra/作业 Homework/HW1 (5).md'), 'utf8'), /\[HWOct10\.pdf\]\(HWOct10\.pdf\)/);
  // Records follow the files (so the next sync downloads nothing again).
  assert.equal(state.pullCache.files['98418/2'].path, '.obsidian/graphite/canvas/线性代数（荣誉） (98418)/LA2.pdf');
  assert.equal(state.pullCache.notes['98418/5'].path, 'Linear Algebra/作业 Homework/HW1 (5).md');
  assert.equal(state.pullCache.notes['98418/5'].digest, 'x', 'an edited note (digest differs) stays the student\'s');
  assert.equal(state.courseLinks['98418'], 'Linear Algebra');
  assert.equal(await fs.readFile(path.join(vault, 'Linear Algebra/我的笔记.md'), 'utf8'), '# mine\n');
  // Nothing left: running again does nothing.
  assert.equal(await svc.migrateLegacy(), null);
});
