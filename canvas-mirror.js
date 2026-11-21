'use strict';
// Canvas → course folders. After a pull has saved a course's files under Canvas/<Course (id)>/, each new file is
// copied into the vault course folder the student linked to that Canvas course, filed like the obsidian-import skill
// does it: slides in "<Course>/课件 Slides/", homework in "作业 Homework/", exams and solutions in "复习资料/".
// PowerPoint and Word files get a PDF copy instead (made by Office), so they open inside Graphite.
// Never overwrites: a different file with the same name gets "name (2).ext". A file already in the course folder
// (same bytes anywhere in it, or a PDF with the same name) is skipped as a duplicate. Each Canvas file is handled
// once (`mirrored` remembers it), so a copy the student deleted or moved does not come back.
// The course's index note gets one line of links under the folder's section.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { publish } = require('./canvas-api');

const OFFICE = /\.(pptx?|docx?)$/i;
const SKIP_TOP = new Set(['canvas', 'claude brain', 'daily notes', 'ideas', 'templates', '我的大脑知识库', 'my brain', 'attachments']);
// SJTU course names often come in Chinese only; the vault's folders are often English.
const KNOWN = [
  [/线性代数/, 'linear algebra'], [/数学分析/, 'mathematical analysis'], [/高等数学|微积分/, 'calculus'],
  [/程序设计|C\+\+/i, 'program design'], [/理论计算机|计算理论/, 'theoretical computer science'], [/英语|English/i, 'english'],
  [/概率/, 'probability'], [/离散数学/, 'discrete mathematics'], [/数据结构/, 'data structures'], [/大学物理|物理/, 'physics'],
];

const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/[\s_\-·().（）【】\[\]]+/g, ' ').trim();

// A first guess for each course: the vault folder whose name appears in the Canvas course name (or its code).
function guessLinks(courses, folders, codes = {}) {
  const top = folders.filter(f => !f.includes('/') && !f.startsWith('.') && !SKIP_TOP.has(f.toLowerCase()));
  const out = {};
  for (const c of courses) {
    const name = norm(c.name + ' ' + (c.code || ''));
    let hit = top.find(f => norm(f).length > 2 && name.includes(norm(f)));
    if (!hit) for (const [re, en] of KNOWN) if (re.test(c.name || '')) { hit = top.find(f => norm(f) === en); if (hit) break; }
    if (!hit) for (const [code, folder] of Object.entries(codes)) {
      if (code.length > 1 && new RegExp('(^|[^a-z])' + code.toLowerCase() + '([^a-z]|$)').test(name) && top.includes(folder)) { hit = folder; break; }
    }
    if (hit) out[String(c.id)] = hit;
  }
  return out;
}

// Which folder inside the course a file goes to.
function subfolderFor(name) {
  const n = String(name).toLowerCase();
  if (/(^|[^a-z])(hw|homework|assignment|pset|problem ?set|exercise)s?([^a-z]|$)|作业|习题|练习/.test(n)) return '作业 Homework';
  if (/exam|midterm|final|mock|solution|answer|review|quiz|考试|期中|期末|真题|答案|复习|测验/.test(n)) return '复习资料';
  return '课件 Slides';
}

async function sha(file) {
  const h = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
async function listFiles(dir, out = []) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await listFiles(full, out);
    else if (e.isFile()) out.push({ full, name: e.name, size: (await fsp.stat(full)).size });
  }
  return out;
}
const stemOf = name => name.replace(/\.[^.]+$/, '').normalize('NFC').toLowerCase();
const rel = (base, file) => path.relative(base, file).split(path.sep).join('/');
const today = () => { const d = new Date(); return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; };

// The note that lists the course's files: an index-like note at the top of the course folder, else a new one.
async function indexNote(courseDir, course) {
  let names = [];
  try { names = (await fsp.readdir(courseDir)).filter(n => n.toLowerCase().endsWith('.md')); } catch { /* new folder */ }
  const pick = names.find(n => /目录|index/i.test(n)) || names.find(n => /资料|resources/i.test(n));
  if (pick) return path.join(courseDir, pick);
  for (const n of names) {
    const text = await fsp.readFile(path.join(courseDir, n), 'utf8').catch(() => '');
    if (/\[\[[^\]]+\.pdf/i.test(text)) return path.join(courseDir, n);
  }
  return path.join(courseDir, course + ' index.md');
}

function addToIndex(text, sub, links) {
  const line = `- Canvas ${today()}：` + links.join(' · ');
  const lines = text.split('\n');
  const esc = sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const headRe = new RegExp('^\\s*(?:\\d+\\.|#{1,6})\\s*' + esc);
  const start = lines.findIndex(l => headRe.test(l));
  if (start >= 0) {
    let end = lines.length;
    for (let i = start + 1; i < lines.length; i++) if (/^\s*\d+\.\s+\S/.test(lines[i]) && !/^\s{2,}/.test(lines[i]) || /^#{1,6}\s/.test(lines[i])) { end = i; break; }
    let at = end;
    while (at > start + 1 && !lines[at - 1].trim()) at--;
    lines.splice(at, 0, ...(at === start + 1 ? ['', line] : [line]));
    return lines.join('\n');
  }
  const nums = lines.map(l => /^(\d+)\.\s/.exec(l)?.[1]).filter(Boolean).map(Number);
  const head = nums.length ? `${Math.max(...nums) + 1}. ${sub}。` : `## ${sub}`;
  return text.replace(/\s*$/, '') + `\n\n${head}\n\n${line}\n`;
}

async function mirrorToCourses({ vault, courses, cache = {}, links = {}, mirrored = {}, officeToPdf, writer }) {
  const base = await fsp.realpath(vault);
  const report = { added: [], duplicates: 0, failed: [], unlinked: [] };
  const done = { ...mirrored };
  for (const course of courses) {
    const cid = String(course.id);
    const folder = links[cid];
    const fresh = (course.files || []).filter(f => cache[cid + '/' + f.id]?.path && !done[cid + '/' + f.id]);
    if (!folder) { if (fresh.length) report.unlinked.push(course.name); continue; }
    if (folder.includes('..') || path.isAbsolute(folder)) continue;
    const courseDir = path.join(base, folder);
    if (path.relative(base, courseDir).startsWith('..')) continue;
    if (!fresh.length) continue;
    const existing = await listFiles(courseDir);
    const stems = new Set(existing.filter(f => /\.pdf$/i.test(f.name)).map(f => stemOf(f.name)));
    const hashes = new Map(); // full path → hash, filled lazily
    const sameBytes = async (src, size) => {
      const digest = await sha(src);
      for (const f of existing) if (f.size === size) {
        if (!hashes.has(f.full)) hashes.set(f.full, await sha(f.full).catch(() => ''));
        if (hashes.get(f.full) === digest) return { digest, dup: true };
      }
      return { digest, dup: false };
    };
    const byFolder = new Map();
    for (const file of fresh) {
      const key = cid + '/' + file.id;
      const src = path.join(base, cache[key].path);
      try {
        const st = await fsp.stat(src);
        const name = path.basename(src), office = OFFICE.test(name);
        const sub = subfolderFor(name);
        const { digest, dup } = await sameBytes(src, st.size);
        if (dup || (office && stems.has(stemOf(name)))) { done[key] = 'duplicate'; report.duplicates++; continue; }
        const dir = path.join(courseDir, sub);
        await fsp.mkdir(dir, { recursive: true });
        let target;
        if (office && officeToPdf) {
          try { target = await officeToPdf(src, path.join(dir, name.replace(/\.[^.]+$/, '.pdf')), { asNew: true }); }
          catch (e) { report.failed.push({ course: course.name, name, error: 'PDF: ' + (e.message || e) }); }
        }
        if (!target) {
          const tmp = path.join(dir, '.canvas-part-' + randomUUID());
          try { await fsp.copyFile(src, tmp, fs.constants.COPYFILE_EXCL); target = (await publish(tmp, dir, name, digest, st.size)).target; }
          finally { await fsp.unlink(tmp).catch(() => {}); }
        }
        stems.add(stemOf(path.basename(target)));
        existing.push({ full: target, name: path.basename(target), size: (await fsp.stat(target)).size });
        done[key] = rel(base, target);
        report.added.push({ courseId: cid, course: course.name, folder, path: rel(base, target) });
        if (!byFolder.has(sub)) byFolder.set(sub, []);
        byFolder.get(sub).push(path.basename(target));
      } catch (e) { report.failed.push({ course: course.name, name: file.name, error: e.message || String(e) }); }
    }
    for (const [sub, names] of byFolder) {
      try {
        const note = await indexNote(courseDir, path.basename(folder));
        const isNew = !fs.existsSync(note);
        const before = isNew ? `---\ngraph: hide\ntags: [${path.basename(folder)}]\ncreated: ${today()}\n---\n` : await fsp.readFile(note, 'utf8');
        const after = addToIndex(before, sub, names.map(n => `[[${n}|${n.replace(/\.[^.]+$/, '')}]]`));
        const write = () => writer?.atomicWrite ? writer.atomicWrite(note, Buffer.from(after)) : fsp.writeFile(note, after);
        if (writer?.withFileLock) await writer.withFileLock(note, write); else await write();
        report.index = report.index || [];
        if (!report.index.includes(rel(base, note))) report.index.push(rel(base, note));
      } catch (e) { report.failed.push({ course: course.name, name: 'index', error: e.message || String(e) }); }
    }
  }
  return { report, mirrored: done };
}

module.exports = { mirrorToCourses, guessLinks, subfolderFor, addToIndex };
