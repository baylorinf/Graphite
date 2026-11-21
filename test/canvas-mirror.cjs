'use strict';
// Canvas → course folders (canvas-mirror.js): new files go into the linked course folder, sorted into
// 课件 Slides / 作业 Homework / 复习资料; Office files get a PDF copy; duplicates are skipped; nothing is overwritten;
// the index note gets a line of links; each Canvas file is handled once.
//   node test/canvas-mirror.cjs
require('./isolate.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { mirrorToCourses, guessLinks, subfolderFor, addToIndex } = require('../canvas-mirror');

async function setup() {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-mirror-'));
  const put = async (rel, body) => { await fs.mkdir(path.dirname(path.join(vault, rel)), { recursive: true }); await fs.writeFile(path.join(vault, rel), body); };
  await put('Linear Algebra/复习资料 Study Resources.md', '---\ngraph: hide\n---\n1. 课件 Slides。\n\n- [[LA1.pdf|LA1]]\n\n2. 作业 Homework。\n\n- [[HW1.pdf|HW1]]\n');
  await put('Linear Algebra/课件 Slides/LA1.pdf', 'old slides 1');
  await put('Linear Algebra/课件 Slides/LA2.pdf', 'different content');
  const C = 'Canvas/线性代数 (11)/';
  await put(C + 'LA1.pdf', 'old slides 1');          // same bytes: duplicate
  await put(C + 'LA2.pdf', 'new LA2');               // same name, other bytes: "LA2 (2).pdf"
  await put(C + 'LA3.pdf', 'lecture 3');             // new slides
  await put(C + 'HW2.pdf', 'homework 2');            // homework
  await put(C + 'Midterm 2025 solution.pdf', 'sol'); // exams
  await put(C + 'Lecture 4.pptx', 'pptx bytes');     // office: PDF copy
  const files = ['LA1.pdf', 'LA2.pdf', 'LA3.pdf', 'HW2.pdf', 'Midterm 2025 solution.pdf', 'Lecture 4.pptx'].map((name, i) => ({ id: String(i + 1), name }));
  const cache = Object.fromEntries(files.map(f => ['11/' + f.id, { path: C + f.name }]));
  return { vault, files, cache };
}

test('sorts by kind of file', () => {
  assert.equal(subfolderFor('Lecture 3.pdf'), '课件 Slides');
  assert.equal(subfolderFor('HW3.pdf'), '作业 Homework');
  assert.equal(subfolderFor('第三次作业.docx'), '作业 Homework');
  assert.equal(subfolderFor('期末复习.pdf'), '复习资料');
});

test('guesses the vault folder from the Canvas name, a Chinese name, or a code', () => {
  const folders = ['Linear Algebra', 'Program Design', 'Claude Brain', 'Mathematical Analysis'];
  const g = guessLinks([{ id: 1, name: '(2026-2027-1)-MATH1205-线性代数' }, { id: 2, name: 'Program Design (C++)' }, { id: 3, name: '大学化学' }, { id: 4, name: 'MA-honors' }], folders, { MA: 'Mathematical Analysis' });
  assert.deepEqual(g, { 1: 'Linear Algebra', 2: 'Program Design', 4: 'Mathematical Analysis' });
});

test('mirrors new files once, skips duplicates, never overwrites, updates the index', async () => {
  const { vault, files, cache } = await setup();
  const officeToPdf = async (src, dest) => { await fs.writeFile(dest, '%PDF-1.7 from ' + path.basename(src)); return dest; };
  const courses = [{ id: 11, name: '线性代数', files }];
  const { report, mirrored } = await mirrorToCourses({ vault, courses, cache, links: { 11: 'Linear Algebra' }, officeToPdf });
  const added = report.added.map(a => a.path).sort();
  assert.deepEqual(added, [
    'Linear Algebra/作业 Homework/HW2.pdf', 'Linear Algebra/复习资料/Midterm 2025 solution.pdf',
    'Linear Algebra/课件 Slides/LA2 (2).pdf', 'Linear Algebra/课件 Slides/LA3.pdf', 'Linear Algebra/课件 Slides/Lecture 4.pdf',
  ]);
  assert.equal(report.duplicates, 1);
  assert.equal(await fs.readFile(path.join(vault, 'Linear Algebra/课件 Slides/LA2.pdf'), 'utf8'), 'different content', 'never overwritten');
  assert.match(await fs.readFile(path.join(vault, 'Linear Algebra/课件 Slides/Lecture 4.pdf'), 'utf8'), /^%PDF/);
  const index = await fs.readFile(path.join(vault, 'Linear Algebra/复习资料 Study Resources.md'), 'utf8');
  assert.match(index, /- \[\[LA1\.pdf\|LA1\]\]\n- Canvas \d{4}\.\d\d\.\d\d：\[\[LA2 \(2\)\.pdf\|LA2 \(2\)\]\] · \[\[LA3\.pdf\|LA3\]\] · \[\[Lecture 4\.pdf\|Lecture 4\]\]\n\n2\. 作业 Homework/);
  assert.match(index, /\[\[HW1\.pdf\|HW1\]\]\n- Canvas .*\[\[HW2\.pdf\|HW2\]\]/);
  assert.match(index, /3\. 复习资料。\n\n- Canvas .*Midterm 2025 solution/);
  // Deleted by the student: not brought back on the next pull.
  await fs.unlink(path.join(vault, 'Linear Algebra/课件 Slides/LA3.pdf'));
  const again = await mirrorToCourses({ vault, courses, cache, links: { 11: 'Linear Algebra' }, mirrored, officeToPdf });
  assert.equal(again.report.added.length, 0);
});

test('an unlinked course stays in Canvas/ and is reported', async () => {
  const { vault, files, cache } = await setup();
  const { report } = await mirrorToCourses({ vault, courses: [{ id: 11, name: '线性代数', files }], cache, links: { 11: '' } });
  assert.deepEqual(report.unlinked, ['线性代数']);
  assert.equal(report.added.length, 0);
});

test('a course folder without an index note gets one', async () => {
  const text = addToIndex('---\ngraph: hide\n---\n', '课件 Slides', ['[[a.pdf|a]]']);
  assert.match(text, /## 课件 Slides\n\n- Canvas .*\[\[a\.pdf\|a\]\]\n$/);
});
