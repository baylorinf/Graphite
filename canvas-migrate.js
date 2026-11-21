'use strict';
// One-time move (1.1.53) of the old Canvas/ folder into the course folders.
//
// Before, every Canvas course had its own Canvas/<Course (id)>/ folder next to the student's own course folders.
// Now each course lives in one folder: the student's own (Linear Algebra), or one named after the course (网球).
//  - Notes Graphite wrote (课程要求.md, 作业/*.md): into that folder (assignments in 作业 Homework/).
//  - Files as downloaded: into the hidden store .obsidian/graphite/canvas/<Course (id)>/, so a later sync knows them;
//    the copies the student sees are filed into the course folder by canvas-mirror.js (with PDF copies, no duplicates).
//  - Canvas/Downloads (files saved from the Canvas window): into Downloads/.
// Nothing is overwritten: an identical file already at the destination replaces nothing and the old copy goes; a
// different one gets "name (2)". Links inside the moved notes are rewritten to where their files are now.
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { createHash } = require('node:crypto');
const { STORE_PATH, defaultFolder } = require('./canvas-api');

const rel = (base, p) => path.relative(base, p).split(path.sep).join('/');
async function sha(file) {
  const h = createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}
async function walk(dir, out = []) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) await walk(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}
// Move without overwriting. Returns the new path (or the identical file already there).
async function moveFile(src, dest) {
  await fsp.mkdir(path.dirname(dest), { recursive: true });
  const ext = path.extname(dest), stem = dest.slice(0, dest.length - ext.length);
  for (let n = 1; n < 1000; n++) {
    const target = n === 1 ? dest : `${stem} (${n})${ext}`;
    let st = null;
    try { st = await fsp.stat(target); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (!st) {
      try { await fsp.rename(src, target); }
      catch (e) { if (e.code !== 'EXDEV') throw e; await fsp.copyFile(src, target, fs.constants.COPYFILE_EXCL); await fsp.unlink(src); }
      return target;
    }
    if (st.isFile() && st.size === (await fsp.stat(src)).size && await sha(target) === await sha(src)) { await fsp.unlink(src); return target; }
  }
  throw new Error('Too many files named ' + path.basename(dest));
}
async function removeEmpty(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])) if (e.isDirectory()) await removeEmpty(path.join(dir, e.name));
  if (!(await fsp.readdir(dir).catch(() => ['x'])).length) await fsp.rmdir(dir).catch(() => {});
}

// links: course id → vault folder. Returns the moves (old vault path → new), the moved notes and what was left.
async function moveCanvasFolder({ vault, links = {}, courses = [] }) {
  const base = await fsp.realpath(vault);
  const root = path.join(base, 'Canvas');
  const moved = new Map(), notes = [];
  let st;
  try { st = await fsp.lstat(root); } catch { return { moved, notes, left: false }; }
  if (!st.isDirectory() || st.isSymbolicLink()) return { moved, notes, left: true };
  for (const e of await fsp.readdir(root, { withFileTypes: true })) {
    const full = path.join(root, e.name);
    if (e.isFile()) { moved.set(rel(base, full), rel(base, await moveFile(full, path.join(base, 'Downloads', e.name)))); continue; }
    if (!e.isDirectory()) continue;
    if (e.name === 'Downloads') {
      for (const f of await walk(full)) moved.set(rel(base, f), rel(base, await moveFile(f, path.join(base, 'Downloads', path.relative(full, f)))));
      continue;
    }
    const id = e.name.match(/\((\d+)\)$/)?.[1];
    const course = courses.find(c => String(c.id) === id) || { id, name: e.name.replace(/\s*\(\d+\)$/, '') };
    const folder = (id && links[id]) || defaultFolder(course);
    for (const f of await walk(full)) {
      const r = path.relative(full, f), parts = r.split(path.sep);
      let dest;
      if (/\.md$/i.test(f)) dest = parts[0] === '作业' && parts.length > 1 ? path.join(base, folder, '作业 Homework', ...parts.slice(1)) : path.join(base, folder, r);
      else dest = path.join(base, ...STORE_PATH.split('/'), e.name, r);
      const now = await moveFile(f, dest);
      moved.set(rel(base, f), rel(base, now));
      if (/\.md$/i.test(f)) notes.push({ from: rel(base, f), to: rel(base, now) });
    }
  }
  await removeEmpty(root);
  return { moved, notes, left: fs.existsSync(root) };
}

// Point the links in the moved notes ([name](relative/path)) at where those files are now: `shown(oldPath)` gives
// the copy in the course folder when there is one. Returns note path → its SHA-256 before and after (for the
// pull's records: a note the student had edited stays theirs).
async function rewriteLinks({ vault, notes, moved, shown = () => null }) {
  const base = await fsp.realpath(vault);
  const digests = new Map();
  const href = s => s.split('/').map(p => encodeURIComponent(p).replace(/[()]/g, c => '%' + c.charCodeAt(0).toString(16))).join('/');
  for (const n of notes) {
    const abs = path.join(base, n.to);
    let text;
    try { text = await fsp.readFile(abs, 'utf8'); } catch { continue; }
    const oldDir = path.posix.dirname(n.from), newDir = path.posix.dirname(n.to);
    const next = text.replace(/\]\(([^)\s]+)\)/g, (all, dest) => {
      if (/^[a-z]+:/i.test(dest) || dest.startsWith('#')) return all;
      let target;
      try { target = path.posix.normalize(path.posix.join(oldDir, decodeURIComponent(dest))); } catch { return all; }
      const now = shown(target) || moved.get(target);
      return now ? '](' + href(path.posix.relative(newDir, now)) + ')' : all;
    });
    if (next !== text) await fsp.writeFile(abs, next);
    const h = t => createHash('sha256').update(t).digest('hex');
    digests.set(n.to, { before: h(text), after: h(next) });
  }
  return digests;
}

module.exports = { moveCanvasFolder, rewriteLinks };
