'use strict';
const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { BUILTIN_READ_ONLY } = require('./profile');

function fail(status, code, message, paths = []) {
  return Object.assign(new Error(message), {status, code, paths});
}

function notePath(value) {
  if (typeof value !== 'string' || !/\.md$/i.test(value) || /[:\x00-\x1f]/.test(value)) {
    throw fail(400, 'invalid_note', '请选择 Markdown 笔记。', typeof value === 'string' ? [value] : []);
  }
  const rel = value.replace(/\\/g, '/');
  if (rel.split('/').some(s => !s || s.startsWith('.') || s.toLowerCase() === 'node_modules')) {
    throw fail(400, 'invalid_note', '请选择笔记库中可见的笔记。', [rel]);
  }
  return rel;
}

const stem = rel => rel.replace(/\.md$/i, '');
const folder = rel => path.posix.dirname(rel);
function reference(rel) {
  const full = (rel.includes('/') ? '' : '/') + rel;
  if (!/[#|\[\]]/.test(rel)) return '[[' + (/\.md\.md$/i.test(rel) ? full : stem(full)) + ']]';
  const url = full.split('/').map(s => encodeURIComponent(s).replace(/\(/g, '%28').replace(/\)/g, '%29')).join('/');
  const label = stem(path.posix.basename(rel)).replace(/[&<>*_\x60[\]\\]/g, c => '&#' + c.charCodeAt(0) + ';');
  return '[' + label + '](' + url + ')';
}

function resolver(paths) {
  const byPath = new Map(), shortNames = new Map();
  for (const rel of paths) {
    const lower = rel.toLowerCase();
    byPath.set(lower, rel);
    const name = stem(path.posix.basename(lower));
    if (!shortNames.has(name)) shortNames.set(name, []);
    shortNames.get(name).push(rel);
  }
  const exact = name => byPath.get(name) || byPath.get(name + '.md');
  return (name, from) => {
    name = name.trim().replace(/\\/g, '/').toLowerCase();
    if (!name) return;
    if (name.startsWith('/')) return exact(name.slice(1));
    if (/^\.\.?\//.test(name)) return exact(path.posix.join(folder(from).toLowerCase(), name));
    let hits;
    if (name.includes('/')) {
      const full = exact(name);
      if (full) return full;
      const suffix = '/' + (name.endsWith('.md') ? name : name + '.md');
      hits = paths.filter(p => p.toLowerCase().endsWith(suffix));
    } else {
      hits = shortNames.get(stem(name)) || [];
    }
    if (hits.length === 1) return hits[0];
    const local = hits.filter(p => folder(p) === folder(from));
    if (local.length === 1) return local[0];
    // Several equally named notes elsewhere: add an explicit link to the selected one.
  };
}

const frontmatter = /^\uFEFF?---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
// Mask non-prose while preserving offsets, so edits can splice the original bytes at a visible line.
function visibleMarkdown(text) {
  const mask = part => part.replace(/[^\r\n]/g, '\u0000');
  return text.replace(frontmatter, mask).replace(/^\uFEFF/, ' ')
    .replace(/^ {0,3}(\x60{3,}|~{3,})[^\n]*(?:\n[\s\S]*?^ {0,3}\1[\x60~]*[ \t]*\r?(?=\n|$)|[\s\S]*$)/gm, mask)
    .replace(/(\x60+)[^\n]*?\1/g, mask).replace(/%%[\s\S]*?(?:%%|$)|<!--[\s\S]*?(?:-->|$)|\$\$[\s\S]*?(?:\$\$|$)/g, mask);
}
function linkedNotes(text, from, resolve) {
  const visible = visibleMarkdown(text);
  const links = new Set();
  for (const m of visible.matchAll(/(?<!\\)\[\[([^[\]\n]+?)\]\]/g)) {
    links.add(resolve(m[1].split(/[|#]/, 1)[0], from));
  }
  for (const m of visible.matchAll(/(?<!\\)\[[^\]\n]*\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/gi)) {
    try { links.add(resolve(decodeURIComponent(m[1]), from)); } catch { /* incomplete URL in note text */ }
  }
  return links;
}

function addLinks(note, resolve) {
  const text = note.bytes.toString('utf8');
  const eol = text.match(/\r\n|\n|\r/)?.[0] || '\n';
  const refs = note.add.map(reference).join(' ');
  const line = '相关 Related: ' + refs + eol;
  const related = /^[ \t]*(?:\*\*)?相关[ \t]*Related(?:\*\*)?[ \t]*[:：]/m.exec(visibleMarkdown(text));
  if (related) {
    const start = related.index + related[0].length;
    const suffix = text.slice(start).match(/^[^\r\n]*/)[0];
    const at = start + suffix.trimEnd().length;
    const updated = text.slice(0, at) + ' ' + refs + text.slice(at);
    const added = linkedNotes(updated, note.rel, resolve);
    if (note.add.every(p => added.has(p))) return Buffer.from(updated);
    // An unclosed inline comment on the Related line hides its tail. Insert ahead of it.
    const early = text.slice(0, start) + ' ' + refs + ' ' + text.slice(start);
    const earlyLinks = linkedNotes(early, note.rel, resolve);
    if (note.add.every(p => earlyLinks.has(p))) return Buffer.from(early);
  }
  const appended = text + (text ? (text.endsWith(eol) ? eol : eol + eol) : '') + line;
  const linked = linkedNotes(appended, note.rel, resolve);
  if (note.add.every(rel => linked.has(rel))) return Buffer.from(appended);
  // An unfinished fenced block or comment at EOF would swallow the links. Keep its text intact.
  const prefix = text.match(frontmatter)?.[0] || (text.startsWith('\uFEFF') ? '\uFEFF' : '');
  const inserted = prefix + (prefix && prefix !== '\uFEFF' && !prefix.endsWith(eol) ? eol : '') + line + eol + text.slice(prefix.length);
  const visible = linkedNotes(inserted, note.rel, resolve);
  const ambiguous = note.add.filter(rel => !visible.has(rel));
  if (ambiguous.length) throw fail(422, 'ambiguous_link', '这些路径无法明确指向所选笔记，请检查文件名。', ambiguous);
  return Buffer.from(inserted);
}

async function snapshot(root, rel) {
  const abs = path.join(root, rel);
  try {
    if (path.relative(abs, await fs.realpath(abs)) !== '') throw fail(400, 'invalid_note', '请选择笔记库中的原文件。', [rel]);
    const handle = await fs.open(abs, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const st = await handle.stat();
      if (!st.isFile()) throw fail(400, 'invalid_note', '请选择一个 Markdown 文件。', [rel]);
      if (!(st.mode & 0o222)) throw fail(403, 'read_only', '这篇笔记为只读。', [rel]);
      const bytes = await handle.readFile();
      if (bytes.includes(0) || !Buffer.from(bytes.toString('utf8')).equals(bytes)) {
        throw fail(422, 'invalid_note', '请将笔记保存为 UTF-8 文本后重试。', [rel]);
      }
      return {rel, abs, bytes, mode: st.mode & 0o777, add: []};
    } finally { await handle.close(); }
  } catch (e) {
    if (e.status) throw e;
    if (e.code === 'ENOENT' || e.code === 'ENOTDIR') throw fail(404, 'note_missing', '笔记已被移动或删除，请重新选择。', [rel]);
    if (e.code === 'EPERM' || e.code === 'EACCES') throw fail(403, 'read_only', '无法读写所选笔记。', [rel]);
    throw fail(500, 'note_read_failed', '无法读取所选笔记。', [rel]);
  }
}

module.exports = function createNoteLinks({ vault, study, listNotes, withFileLock, atomicWrite }) {
  async function writable(paths) {
    const profile = await study.get();
    const folders = [...BUILTIN_READ_ONLY, ...profile.readOnlyFolders].map(s => s.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase());
    const denied = paths.filter(p => folders.some(f => p.toLowerCase() === f || p.toLowerCase().startsWith(f + '/')));
    if (denied.length) throw fail(403, 'read_only', '学习设置中的只读笔记不能添加双向链接。', denied);
  }
  return async function connect(selection) {
    if (!Array.isArray(selection?.targets)) throw fail(400, 'invalid_selection', '请选择要关联的笔记。');
    const source = notePath(selection.source), targets = [...new Set(selection.targets.map(notePath))];
    if (targets.includes(source)) throw fail(400, 'invalid_selection', '请选择另一篇笔记。', [source]);
    const paths = [source, ...targets];
    await writable(paths);
    const root = await fs.realpath(vault()), names = await listNotes();
    const visible = new Set(names);
    const missing = paths.filter(p => !visible.has(p));
    if (missing.length) throw fail(404, 'note_missing', '笔记已被移动、删除或隐藏，请重新选择。', missing);
    const resolve = resolver(names);
    const locks = paths.map(rel => path.join(root, rel)).sort();
    const lock = i => i === locks.length ? apply() : withFileLock(locks[i], () => lock(i + 1));
    try { return await lock(0); }
    catch (e) {
      if (e.paths) throw e;
      throw fail(e.status || 500, 'note_links_busy', '无法完成关联，请检查笔记是否正在使用后重试。', paths);
    }

    async function apply() {
      await writable(paths);
      const notes = await Promise.all(paths.map(rel => snapshot(root, rel)));
      const [first, ...others] = notes, linked = [], unchanged = [];
      const outward = linkedNotes(first.bytes.toString('utf8'), source, resolve);
      for (const other of others) {
        const forward = outward.has(other.rel);
        const back = linkedNotes(other.bytes.toString('utf8'), other.rel, resolve).has(source);
        if (!forward) first.add.push(other.rel);
        if (!back) other.add.push(source);
        (forward && back ? unchanged : linked).push(other.rel);
      }
      const written = [];
      async function compare(note, expected) {
        const current = await snapshot(root, note.rel);
        if (!current.bytes.equals(expected) || current.mode !== note.mode) throw fail(409, 'note_changed', '笔记已被其他程序修改，请重试。', [note.rel]);
      }
      async function replace(note, before, after) {
        try {
          await atomicWrite(note.abs, after, {mode:note.mode, beforeReplace:async () => {
            await writable([note.rel]);
            await compare(note, before);
          }});
        } catch (e) {
          if (e.paths) throw e;
          throw fail(e.status || 500, 'link_write_failed', '保存双向链接失败，请检查磁盘后重试。', [note.rel]);
        }
      }
      try {
        for (const note of notes.filter(n => n.add.length)) {
          note.after = addLinks(note, resolve);
          await replace(note, note.bytes, note.after);
          written.push(note);
        }
        for (const note of notes) await compare(note, note.after || note.bytes);
      } catch (e) {
        const conflicts = [];
        for (const note of written.reverse()) {
          try { await replace(note, note.after, note.bytes); } catch { conflicts.push(note.rel); }
        }
        if (conflicts.length) throw fail(409, 'link_rollback_conflict', '未能撤销以下笔记的链接，请检查后重试。', conflicts);
        throw e;
      }
      return {linked, unchanged};
    }
  };
};
