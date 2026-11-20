// Obsidian plugin compatibility layer.
//
// Community plugins are CommonJS bundles that do `require('obsidian')`. We hand them an object that
// implements the commonly used part of Obsidian's API on top of Graphite. Plugins live where Obsidian
// keeps them: <vault>/.obsidian/plugins/<id>/{manifest.json, main.js, styles.css, data.json}, and the
// enabled list is <vault>/.obsidian/community-plugins.json, so existing Obsidian vaults just work.
//
// Supported: commands (+hotkeys), ribbon icons, status bar items, setting tabs, Markdown post-processors,
// code block processors, editor suggest, vault / metadataCache / workspace / fileManager APIs, editor
// access, modals, suggest modals, menus (incl. the file-menu event), notices, icons (Lucide), moment,
// YAML, requestUrl. Not supported: custom views (registerView) and CodeMirror editor extensions.
import * as yaml from '/lib/js-yaml.js';
import katex from '/lib/katex/katex.mjs';
import { t } from '/i18n.js';

let H = null; // host API supplied by app.js
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*(\r?\n|$)/;
const dirName = p => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');

/* =====================================================================
   DOM helpers Obsidian adds to every element (createEl, empty, setText, …)
   ===================================================================== */
function installDomHelpers() {
  if (Element.prototype.createEl) return;
  function make(tag, o, cb) {
    const el = document.createElement(tag);
    if (typeof o === 'string') o = { cls: o };
    o = o || {};
    if (o.cls) el.className = Array.isArray(o.cls) ? o.cls.join(' ') : o.cls;
    if (o.text != null) { if (o.text instanceof Node) el.appendChild(o.text); else el.textContent = o.text; }
    if (o.attr) for (const [k, v] of Object.entries(o.attr)) if (v != null && v !== false) el.setAttribute(k, v === true ? '' : v);
    for (const k of ['title', 'value', 'type', 'placeholder', 'href']) if (o[k] != null) el[k] = o[k];
    if (this && this.appendChild) { if (o.prepend) this.prepend(el); else this.appendChild(el); }
    if (o.parent) o.parent.appendChild(el);
    cb?.(el);
    return el;
  }
  const def = (proto, name, fn) => Object.defineProperty(proto, name, { value: fn, configurable: true, writable: true });
  for (const proto of [Element.prototype, DocumentFragment.prototype]) {
    def(proto, 'createEl', function (tag, o, cb) { return make.call(this, tag, o, cb); });
    def(proto, 'createDiv', function (o, cb) { return make.call(this, 'div', o, cb); });
    def(proto, 'createSpan', function (o, cb) { return make.call(this, 'span', o, cb); });
    def(proto, 'empty', function () { while (this.firstChild) this.removeChild(this.firstChild); });
    def(proto, 'appendText', function (s) { this.appendChild(document.createTextNode(s)); });
  }
  const E = Element.prototype;
  def(E, 'setText', function (v) { this.textContent = ''; if (v instanceof Node) this.appendChild(v); else this.textContent = v ?? ''; });
  def(E, 'addClass', function (...c) { this.classList.add(...c.flat().filter(Boolean)); });
  def(E, 'addClasses', function (c) { this.classList.add(...c); });
  def(E, 'removeClass', function (...c) { this.classList.remove(...c.flat()); });
  def(E, 'removeClasses', function (c) { this.classList.remove(...c); });
  def(E, 'toggleClass', function (c, v) { for (const x of [c].flat()) this.classList.toggle(x, v); });
  def(E, 'hasClass', function (c) { return this.classList.contains(c); });
  def(E, 'setAttr', function (k, v) { if (v == null || v === false) this.removeAttribute(k); else this.setAttribute(k, v === true ? '' : v); });
  def(E, 'setAttrs', function (o) { for (const [k, v] of Object.entries(o)) this.setAttr(k, v); });
  def(E, 'getAttr', function (k) { return this.getAttribute(k); });
  def(E, 'detach', function () { this.remove(); });
  def(E, 'show', function () { this.style.display = ''; });
  def(E, 'hide', function () { this.style.display = 'none'; });
  def(E, 'toggle', function (v) { this.style.display = v ? '' : 'none'; });
  def(E, 'toggleVisibility', function (v) { this.style.visibility = v ? '' : 'hidden'; });
  def(E, 'isShown', function () { return this.offsetParent !== null; });
  def(E, 'find', function (s) { return this.querySelector(s); });
  def(E, 'findAll', function (s) { return [...this.querySelectorAll(s)]; });
  def(E, 'onClickEvent', function (cb, o) { this.addEventListener('click', cb, o); });
  def(E, 'setCssStyles', function (s) { Object.assign(this.style, s); });
  def(E, 'setCssProps', function (p) { for (const [k, v] of Object.entries(p)) this.style.setProperty(k, v); });
  def(E, 'instanceOf', function (T) { return this instanceof T; });
  def(E, 'on', function (type, sel, cb) { const h = e => { const m = e.target.closest?.(sel); if (m && this.contains(m)) cb(e, m); }; this.addEventListener(type, h); });
  def(E, 'trigger', function (type) { this.dispatchEvent(new Event(type)); });
  def(E, 'getText', function () { return this.textContent; });

  const A = Array.prototype;
  def(A, 'contains', function (x) { return this.includes(x); });
  def(A, 'first', function () { return this[0]; });
  def(A, 'last', function () { return this[this.length - 1]; });
  def(A, 'remove', function (x) { const i = this.indexOf(x); if (i >= 0) this.splice(i, 1); });
  def(A, 'unique', function () { return [...new Set(this)]; });
  def(String.prototype, 'contains', function (s) { return this.includes(s); });

  window.createEl = (tag, o, cb) => make.call(null, tag, o, cb);
  window.createDiv = (o, cb) => make.call(null, 'div', o, cb);
  window.createSpan = (o, cb) => make.call(null, 'span', o, cb);
  window.createFragment = cb => { const f = document.createDocumentFragment(); cb?.(f); return f; };
  window.activeDocument = document;
  window.activeWindow = window;
  window.sleep = ms => new Promise(r => setTimeout(r, ms));
  window.nextFrame = () => new Promise(r => requestAnimationFrame(r));
}

/* =====================================================================
   Core classes
   ===================================================================== */
export class Events {
  constructor() { this._ev = new Map(); }
  on(name, fn, ctx) {
    if (!this._ev) this._ev = new Map();
    if (!this._ev.has(name)) this._ev.set(name, new Set());
    const ref = { e: this, name, fn, ctx };
    this._ev.get(name).add(ref);
    return ref;
  }
  off(name, fn) { for (const r of [...(this._ev?.get(name) || [])]) if (r.fn === fn) this._ev.get(name).delete(r); }
  offref(ref) { this._ev?.get(ref.name)?.delete(ref); }
  trigger(name, ...args) {
    for (const r of [...(this._ev?.get(name) || [])]) {
      try { r.fn.apply(r.ctx, args); } catch (e) { console.error(`[plugin] "${name}" handler failed`, e); }
    }
  }
  tryTrigger(ref, args) { try { ref.fn.apply(ref.ctx, args); } catch (e) { console.error(e); } }
}

export class Component {
  constructor() { this._loaded = false; this._cleanups = []; this._children = []; }
  load() {
    if (this._loaded) return;
    this._loaded = true;
    const r = this.onload();
    for (const c of this._children) c.load();
    return r;
  }
  onload() {}
  onunload() {}
  unload() {
    if (!this._loaded) return;
    this._loaded = false;
    for (const c of this._children.splice(0)) { try { c.unload(); } catch (e) { console.error(e); } }
    for (const fn of this._cleanups.splice(0).reverse()) { try { fn(); } catch (e) { console.error(e); } }
    this.onunload();
  }
  addChild(c) { this._children.push(c); if (this._loaded) c.load(); return c; }
  removeChild(c) { const i = this._children.indexOf(c); if (i >= 0) { this._children.splice(i, 1); c.unload(); } return c; }
  register(fn) { this._cleanups.push(fn); }
  registerEvent(ref) { this.register(() => ref.e.offref(ref)); }
  registerDomEvent(el, type, cb, opts) { el.addEventListener(type, cb, opts); this.register(() => el.removeEventListener(type, cb, opts)); }
  registerScopeEvent() {}
  registerInterval(id) { this.register(() => clearInterval(id)); return id; }
}

/* ---------- files ---------- */
export class TAbstractFile {
  constructor(p) { this._set(p); }
  _set(p) { this.path = p; this.name = p === '/' ? '' : p.split('/').pop(); }
  get vault() { return vault; }
  get parent() { if (this.path === '/') return null; const d = dirName(this.path); return d ? folderOf(d) : root(); }
}
export class TFile extends TAbstractFile {
  _set(p) {
    super._set(p);
    const i = this.name.lastIndexOf('.');
    this.basename = i > 0 ? this.name.slice(0, i) : this.name;
    this.extension = i > 0 ? this.name.slice(i + 1).toLowerCase() : '';
  }
  get stat() { const f = H.S.files.get(this.path); return { ctime: f?.mtime || 0, mtime: f?.mtime || 0, size: f?.size ?? f?.content?.length ?? 0 }; }
}
export class TFolder extends TAbstractFile {
  get children() {
    const key = this.path === '/' ? '' : this.path, out = [];
    for (const d of H.S.folders) if (dirName(d) === key) out.push(folderOf(d));
    for (const p of H.S.files.keys()) if (dirName(p) === key) out.push(fileOf(p));
    return out;
  }
  isRoot() { return this.path === '/'; }
}
const fileObjs = new Map(), folderObjs = new Map();
function fileOf(p) { let f = fileObjs.get(p); if (!f) { f = new TFile(p); fileObjs.set(p, f); } return f; }
function folderOf(p) { if (!p || p === '/') return root(); let f = folderObjs.get(p); if (!f) { f = new TFolder(p); folderObjs.set(p, f); } return f; }
let rootObj = null;
function root() { return rootObj || (rootObj = new TFolder('/')); }

export function normalizePath(p) {
  p = String(p ?? '').replace(/\\/g, '/').replace(/\/+/g, '/').replace(/^\/|\/$/g, '').replace(/ | /g, ' ');
  return p || '/';
}

/* ---------- vault ---------- */
export class DataAdapter {}
export class FileSystemAdapter extends DataAdapter {
  getName() { return H.vaultName(); }
  getBasePath() { return H.S.vault || ''; }
  get basePath() { return H.S.vault || ''; }
  getResourcePath(p) { return '/vault/' + H.encPath(normalizePath(p)); }
  async read(p) { return (await H.api('GET', 'file', { path: normalizePath(p) })).content; }
  async readBinary(p) { return (await fetch(this.getResourcePath(p))).arrayBuffer(); }
  async write(p, data) { await H.api('PUT', 'file', { path: normalizePath(p) }, data); }
  async writeBinary(p, data) { await H.api('PUT', 'file', { path: normalizePath(p) }, new Blob([data])); }
  async append(p, data) { let cur = ''; try { cur = await this.read(p); } catch { /* new */ } await this.write(p, cur + data); }
  async process(p, fn) { const d = fn(await this.read(p)); await this.write(p, d); return d; }
  async exists(p) {
    p = normalizePath(p);
    if (H.S.files.has(p) || H.S.folders.has(p)) return true;
    try { await H.api('GET', 'file', { path: p }); return true; } catch { return false; }
  }
  async mkdir(p) { await H.api('POST', 'folder', { path: normalizePath(p) }); }
  async remove(p) { await H.api('DELETE', 'file', { path: normalizePath(p) }); }
  async rmdir(p) { await this.remove(p); }
  async trashLocal(p) { await this.remove(p); }
  async trashSystem(p) { await this.remove(p); return true; }
  async rename(a, b) { await H.api('POST', 'rename', {}, { from: normalizePath(a), to: normalizePath(b) }); }
  async copy(a, b) { await this.write(b, await this.read(a)); }
  async stat(p) { const f = H.S.files.get(normalizePath(p)); return f ? { type: 'file', ctime: f.mtime, mtime: f.mtime, size: f.size } : null; }
  async list(p) {
    const key = normalizePath(p) === '/' ? '' : normalizePath(p);
    return {
      files: [...H.S.files.keys()].filter(x => dirName(x) === key),
      folders: [...H.S.folders].filter(x => dirName(x) === key),
    };
  }
}

const VAULT_CONFIG = {
  useMarkdownLinks: false, newLinkFormat: 'shortest', attachmentFolderPath: 'attachments', newFileLocation: 'current',
  promptDelete: true, alwaysUpdateLinks: true, showLineNumber: false, readableLineLength: true, tabSize: 4, useTab: true,
  strictLineBreaks: false, livePreview: false, defaultViewMode: 'source', userIgnoreFilters: [],
};

export class Vault extends Events {
  constructor() { super(); this.adapter = new FileSystemAdapter(); this.configDir = '.obsidian'; }
  getName() { return H.vaultName(); }
  getRoot() { return root(); }
  getConfig(k) { return VAULT_CONFIG[k]; }
  setConfig() {}
  getFiles() { return [...H.S.files.keys()].map(fileOf); }
  getMarkdownFiles() { return [...H.S.files.keys()].filter(H.isMd).map(fileOf); }
  getAllFolders(includeRoot) { const f = [...H.S.folders].map(folderOf); return includeRoot ? [root(), ...f] : f; }
  getAllLoadedFiles() { return [root(), ...this.getAllFolders(), ...this.getFiles()]; }
  getAbstractFileByPath(p) {
    p = normalizePath(p);
    if (p === '/') return root();
    if (H.S.files.has(p)) return fileOf(p);
    if (H.S.folders.has(p)) return folderOf(p);
    return null;
  }
  getFileByPath(p) { const f = this.getAbstractFileByPath(p); return f instanceof TFile ? f : null; }
  getFolderByPath(p) { const f = this.getAbstractFileByPath(p); return f instanceof TFolder ? f : null; }
  async read(file) { return H.readFile(file.path); }
  async cachedRead(file) { return H.readFile(file.path); }
  async readBinary(file) { return this.adapter.readBinary(file.path); }
  getResourcePath(file) { return this.adapter.getResourcePath(file.path); }
  async modify(file, data) { await H.writeNote(file.path, data); }
  async modifyBinary(file, data) { await this.adapter.writeBinary(file.path, data); }
  async append(file, data) { await this.modify(file, (await this.read(file)) + data); }
  async process(file, fn) { const d = fn(await this.read(file)); await this.modify(file, d); return d; }
  async create(p, data = '') {
    p = normalizePath(p);
    if (H.S.files.has(p)) throw new Error('File already exists.');
    const f = await H.createFile(p, data, { silent: true });
    if (!f) throw new Error('Could not create ' + p);
    return fileOf(f.path);
  }
  async createBinary(p, data) { await this.adapter.writeBinary(p, data); await H.sync(); return fileOf(normalizePath(p)); }
  async createFolder(p) { p = normalizePath(p); await H.createFolder(p); return folderOf(p); }
  async delete(file) { await H.deletePath(file.path, { confirm: false }); }
  async trash(file) { await H.deletePath(file.path, { confirm: false }); }
  async rename(file, newPath) { await H.renamePath(file.path, normalizePath(newPath)); }
  async copy(file, newPath) { return this.create(newPath, await this.read(file)); }
  static recurseChildren(folder, cb) { cb(folder); for (const c of folder.children || []) { if (c instanceof TFolder) Vault.recurseChildren(c, cb); else cb(c); } }
}

/* ---------- metadata ---------- */
function posOf(content, start, len) {
  const at = off => { const b = content.slice(0, off); const line = (b.match(/\n/g) || []).length; return { line, col: off - (b.lastIndexOf('\n') + 1), offset: off }; };
  return { start: at(start), end: at(start + len) };
}
function splitOnce(s, ch) { const i = s.indexOf(ch); return i < 0 ? [s, ''] : [s.slice(0, i), s.slice(i + 1)]; }

// Split a note into Obsidian-style sections and list items (with parent line numbers, like Obsidian).
const LIST_RE = /^(\s*)(?:[-*+]|\d+[.)])(?:\s+|$)(?:\[(.)\])?/;
function structure(lines, fmLines) {
  const starts = []; let off = 0;
  for (const l of lines) { starts.push(off); off += l.length + 1; }
  const pos = (s, e) => ({ start: { line: s, col: 0, offset: starts[s] }, end: { line: e, col: lines[e].length, offset: starts[e] + lines[e].length } });
  const indent = ws => ws.replace(/\t/g, '    ').length;
  const sections = [], listItems = [];
  const push = (type, s, e) => sections.push({ type, position: pos(s, e) });
  let i = 0;
  if (fmLines > 0) { push('yaml', 0, fmLines - 1); i = fmLines; }
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) { i++; continue; }
    const fence = l.match(/^\s*(```|~~~)/);
    if (fence) {
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(fence[1])) j++;
      const end = Math.min(j, lines.length - 1);
      push('code', i, end); i = end + 1; continue;
    }
    if (/^#{1,6}\s/.test(l)) { push('heading', i, i); i++; continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(l)) { push('thematicBreak', i, i); i++; continue; }
    if (LIST_RE.test(l)) {
      const stack = []; let j = i, last = i;
      while (j < lines.length) {
        const lj = lines[j];
        if (!lj.trim()) {
          let k = j + 1; while (k < lines.length && !lines[k].trim()) k++;
          if (k < lines.length && (LIST_RE.test(lines[k]) || /^\s+\S/.test(lines[k]))) { j = k; continue; }
          break;
        }
        const m = lj.match(LIST_RE);
        if (m) {
          const ind = indent(m[1]);
          while (stack.length && stack[stack.length - 1].ind >= ind) stack.pop();
          const item = { parent: stack.length ? stack[stack.length - 1].line : -(i || 1), position: pos(j, j) };
          if (m[2] != null) item.task = m[2];
          const id = lj.match(/\s\^([\w-]+)\s*$/); if (id) item.id = id[1];
          listItems.push(item);
          stack.push({ ind, line: j });
        } else if (!/^\s+\S/.test(lj)) break;
        last = j; j++;
      }
      push('list', i, last); i = last + 1; continue;
    }
    if (/^\s*>/.test(l)) {
      let j = i; while (j < lines.length && /^\s*>/.test(lines[j])) j++;
      push(/^\s*>\s*\[!/.test(l) ? 'callout' : 'blockquote', i, j - 1); i = j; continue;
    }
    if (/^\s*\|/.test(l)) {
      let j = i; while (j < lines.length && /^\s*\|/.test(lines[j])) j++;
      push('table', i, j - 1); i = j; continue;
    }
    let j = i + 1;
    while (j < lines.length && lines[j].trim() && !/^#{1,6}\s|^\s*(```|~~~)|^\s*>|^\s*\|/.test(lines[j]) && !LIST_RE.test(lines[j])) j++;
    push('paragraph', i, j - 1); i = j;
  }
  return { sections, listItems };
}

function buildCache(f) {
  // For the open note, use what is in the editor right now (not the last save).
  const c = (f.path === H.S.current ? H.editorEl.value : f.content) || '';
  // Blank out code so links/tags inside code are ignored but offsets stay correct.
  const masked = c.replace(/^[ \t]*(```|~~~)[\s\S]*?^[ \t]*\1.*$/gm, s => s.replace(/[^\n]/g, ' ')).replace(/`[^`\n]*`/g, s => ' '.repeat(s.length));
  const out = { links: [], embeds: [], tags: [], headings: [], listItems: [], sections: [] };
  const fm = c.match(FM_RE);
  if (fm) {
    try { out.frontmatter = yaml.load(fm[1]) || {}; } catch { out.frontmatter = f.fm || {}; }
    out.frontmatterPosition = posOf(c, 0, fm[0].trimEnd().length);
  }
  const body = fm ? ' '.repeat(fm[0].length) + masked.slice(fm[0].length) : masked;
  let m;
  const re = /(!?)\[\[([^\[\]\n]+?)\]\]/g;
  while ((m = re.exec(body))) {
    const [target, alias] = splitOnce(m[2], '|');
    const entry = { link: target.trim(), original: m[0], displayText: alias.trim() || target.trim(), position: posOf(c, m.index, m[0].length) };
    (m[1] ? out.embeds : out.links).push(entry);
  }
  const mre = /(!?)\[([^\]\n]*)\]\(([^)\s]+?\.md)(#[^)]*)?\)/gi;
  while ((m = mre.exec(body))) {
    if (/^[a-z]+:/i.test(m[3])) continue;
    let link = m[3]; try { link = decodeURIComponent(link); } catch { /* keep */ }
    (m[1] ? out.embeds : out.links).push({ link: link + (m[4] || ''), original: m[0], displayText: m[2], position: posOf(c, m.index, m[0].length) });
  }
  const tre = /(^|[\s(,])#([\p{L}_\-/][\p{L}\p{N}_\-/]*)/gu;
  while ((m = tre.exec(body))) { const st = m.index + m[1].length; out.tags.push({ tag: '#' + m[2], position: posOf(c, st, m[2].length + 1) }); }
  const lines = c.split('\n'); let off = 0;
  const maskedLines = body.split('\n');
  lines.forEach((line, i) => {
    const ml = maskedLines[i] ?? '';
    const h = ml.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (h) out.headings.push({ heading: line.match(/^#{1,6}\s+(.+?)\s*#*\s*$/)?.[1] ?? h[2], level: h[1].length, position: posOf(c, off, line.length) });
    off += line.length + 1;
  });
  const fmLines = fm ? fm[0].replace(/\r?\n$/, '').split('\n').length : 0;
  Object.assign(out, structure(lines, fmLines));
  return out;
}

export class MetadataCache extends Events {
  getFileCache(file) { return file ? this.getCache(file.path) : null; }
  getCache(p) { const f = H.S.files.get(p); return f && H.isMd(p) && f.content != null ? buildCache(f) : null; }
  getFirstLinkpathDest(linkpath, sourcePath) { const p = H.resolve(getLinkpath(linkpath), sourcePath || ''); return p ? fileOf(p) : null; }
  fileToLinktext(file, sourcePath, omitMdExtension = true) { const n = H.linkNameFor(file.path); return omitMdExtension ? n : (H.isMd(file.path) ? n + '.md' : n); }
  getLinkSuggestions() { return [...H.S.files.keys()].map(p => ({ file: fileOf(p), path: p })); }
  getTags() { const out = {}; for (const f of H.S.files.values()) for (const tg of f.tags || []) out['#' + tg] = (out['#' + tg] || 0) + 1; return out; }
  getBacklinksForFile(file) { const data = new Map(); for (const [src, dsts] of Object.entries(this.resolvedLinks)) if (dsts[file.path]) data.set(src, []); return { data, keys: () => [...data.keys()], get: k => data.get(k) }; }
  get resolvedLinks() { return linkMaps().resolved; }
  get unresolvedLinks() { return linkMaps().unresolved; }
}
function linkMaps() {
  const resolved = {}, unresolved = {};
  for (const f of H.S.files.values()) {
    if (!H.isMd(f.path)) continue;
    resolved[f.path] = {}; unresolved[f.path] = {};
    for (const l of f.links || []) {
      const dst = H.resolve(l.name, f.path);
      if (dst) resolved[f.path][dst] = (resolved[f.path][dst] || 0) + 1;
      else unresolved[f.path][l.name] = (unresolved[f.path][l.name] || 0) + 1;
    }
  }
  return { resolved, unresolved };
}

/* ---------- editor & views ---------- */
export class Editor {}
const editor = Object.create(Editor.prototype);
function ta() { return H.editorEl; }
function lines() { return ta().value.split('\n'); }
function toOffset(pos) {
  if (typeof pos === 'number') return pos;
  const ls = lines(); const line = Math.max(0, Math.min(pos?.line ?? 0, ls.length - 1));
  let off = 0; for (let i = 0; i < line; i++) off += ls[i].length + 1;
  return off + Math.max(0, Math.min(pos?.ch ?? 0, ls[line].length));
}
function toPos(off) { const b = ta().value.slice(0, off); return { line: (b.match(/\n/g) || []).length, ch: off - (b.lastIndexOf('\n') + 1) }; }
Object.assign(editor, {
  getValue: () => ta().value,
  setValue: v => H.replaceRange(0, ta().value.length, v),
  getLine: n => lines()[n] ?? '',
  setLine(n, text) { const s = toOffset({ line: n, ch: 0 }); H.replaceRange(s, s + (lines()[n] ?? '').length, text); },
  lineCount: () => lines().length,
  lastLine: () => lines().length - 1,
  getCursor: (which = 'head') => toPos(which === 'from' || which === 'anchor' ? ta().selectionStart : ta().selectionEnd),
  setCursor(pos, ch) { if (typeof pos === 'number') pos = { line: pos, ch: ch ?? 0 }; const o = toOffset(pos); ta().focus(); ta().setSelectionRange(o, o); },
  getSelection: () => ta().value.slice(ta().selectionStart, ta().selectionEnd),
  replaceSelection: text => H.replaceRange(ta().selectionStart, ta().selectionEnd, text),
  replaceRange: (text, from, to) => H.replaceRange(toOffset(from), toOffset(to || from), text),
  getRange: (from, to) => ta().value.slice(toOffset(from), toOffset(to)),
  setSelection(a, h) { const x = toOffset(a), y = toOffset(h || a); ta().focus(); ta().setSelectionRange(Math.min(x, y), Math.max(x, y)); },
  setSelections(sel) { if (sel?.[0]) editor.setSelection(sel[0].anchor, sel[0].head); },
  listSelections: () => [{ anchor: editor.getCursor('from'), head: editor.getCursor('to') }],
  somethingSelected: () => ta().selectionStart !== ta().selectionEnd,
  posToOffset: toOffset,
  offsetToPos: toPos,
  focus: () => ta().focus(),
  blur: () => ta().blur(),
  hasFocus: () => document.activeElement === ta(),
  getDoc() { return editor; },
  refresh() {},
  scrollIntoView() {},
  scrollTo() {},
  getScrollInfo: () => ({ top: 0, left: 0, height: ta().scrollHeight, width: ta().clientWidth }),
  undo: () => { ta().focus(); document.execCommand('undo'); },
  redo: () => { ta().focus(); document.execCommand('redo'); },
  exec() {},
  wordAt(pos) {
    const line = lines()[pos.line] || ''; let s = pos.ch, e = pos.ch;
    while (s > 0 && /[\p{L}\p{N}_]/u.test(line[s - 1])) s--;
    while (e < line.length && /[\p{L}\p{N}_]/u.test(line[e])) e++;
    return s === e ? null : { from: { line: pos.line, ch: s }, to: { line: pos.line, ch: e } };
  },
  transaction(tx) {
    const changes = [...(tx.changes || [])].map(c => ({ s: toOffset(c.from), e: toOffset(c.to || c.from), text: c.text }));
    changes.sort((a, b) => b.s - a.s).forEach(c => H.replaceRange(c.s, c.e, c.text));
    if (tx.selection) editor.setSelection(tx.selection.from, tx.selection.to);
  },
  processLines(read, write) {
    const ls = lines(); const states = ls.map((l, i) => read(i, l));
    for (let i = ls.length - 1; i >= 0; i--) { const ch = write(i, ls[i], states[i]); if (ch) editor.replaceRange(ch.text, ch.from, ch.to); }
  },
});

export class View extends Component {
  constructor(leaf) { super(); this.leaf = leaf; this.app = app; this.containerEl = createDiv('view-container'); this.navigation = false; }
  getViewType() { return ''; }
  getDisplayText() { return ''; }
  getIcon() { return 'file'; }
  getState() { return {}; }
  async setState() {}
  onPaneMenu() {}
}
export class ItemView extends View {
  constructor(leaf) { super(leaf); this.contentEl = this.containerEl.createDiv('view-content'); }
  addAction(icon, title, cb) { const el = createDiv('clickable-icon'); setIcon(el, icon); el.title = title; el.onclick = cb; return el; }
}
export class FileView extends ItemView {}
export class EditableFileView extends FileView {}
export class TextFileView extends EditableFileView {}
export class MarkdownView extends TextFileView {}
export class MarkdownPreviewView {}

const activeView = Object.create(MarkdownView.prototype);
Object.defineProperties(activeView, {
  file: { get: () => (H.S.current ? fileOf(H.S.current) : null) },
  editor: { get: () => editor },
  app: { get: () => app },
  leaf: { get: () => mainLeaf },
  containerEl: { get: () => document.querySelector('#doc') },
  contentEl: { get: () => document.querySelector('#panes') },
  data: { get: () => ta().value },
  previewMode: { get: () => ({ containerEl: document.querySelector('#preview-wrap'), rerender: () => H.rerender(), get: () => ta().value }) },
  currentMode: { get: () => activeView.previewMode },
});
Object.assign(activeView, {
  getMode: () => (H.getMode() === 'preview' ? 'preview' : 'source'),
  getViewType: () => 'markdown',
  getDisplayText: () => (H.S.current ? H.baseName(H.S.current) : ''),
  getViewData: () => ta().value,
  setViewData: d => editor.setValue(d),
  getState: () => ({ file: H.S.current, mode: activeView.getMode() }),
  async setState(s) { if (s?.mode) H.setMode(s.mode === 'preview' ? 'preview' : 'split'); },
  getIcon: () => 'file-text',
  addAction: () => createDiv(),
  requestSave: () => H.saveNow(),
  save: () => H.saveNow(),
  showSearch() {},
});

export class WorkspaceLeaf extends Events {}
function makeLeaf(main) {
  const leaf = Object.create(WorkspaceLeaf.prototype);
  leaf._ev = new Map();
  Object.defineProperty(leaf, 'view', { get: () => (main && H.S.current ? activeView : null) });
  Object.assign(leaf, {
    app,
    async openFile(file, state) { await H.openNote(file.path); if (state?.eState?.subpath) H.openLink('', state.eState.subpath.replace(/^#/, '')); },
    async setViewState(st) {
      if (st?.type === 'markdown' && st.state?.file) return H.openNote(st.state.file);
      if (st?.type && st.type !== 'empty') new Notice(t('plugins.noViews'));
    },
    getViewState: () => ({ type: main && H.S.current ? 'markdown' : 'empty', state: { file: H.S.current } }),
    getDisplayText: () => activeView.getDisplayText(),
    detach() {}, setPinned() {}, togglePinned() {}, setGroup() {}, getRoot: () => workspace.rootSplit,
    getContainer: () => workspace.rootSplit, isDeferred: false, async loadIfDeferred() {},
  });
  return leaf;
}
let mainLeaf = null;

export class Workspace extends Events {
  constructor() {
    super();
    this.layoutReady = false;
    this.rootSplit = { children: [] }; this.leftSplit = { collapsed: false, expand() {}, collapse() {} }; this.rightSplit = { collapsed: false, expand() {}, collapse() {} };
    this.leftRibbon = {}; this.rightRibbon = {};
  }
  get containerEl() { return document.querySelector('#main'); }
  get activeLeaf() { return mainLeaf; }
  get activeEditor() { return H.S.current ? { editor, file: fileOf(H.S.current) } : null; }
  onLayoutReady(cb) { if (this.layoutReady) setTimeout(cb); else { const ref = this.on('layout-ready', () => { this.offref(ref); cb(); }); } }
  // Like Obsidian: the PDF / image / other file in front when one is open, otherwise the note.
  getActiveFile() { const p = H.S.view === 'file' && H.S.filePath ? H.S.filePath : H.S.current; return p ? fileOf(p) : null; }
  getActiveViewOfType(type) { return H.S.current && H.S.view === 'note' && activeView instanceof type ? activeView : null; }
  getLeaf() { return mainLeaf; }
  getUnpinnedLeaf() { return mainLeaf; }
  getMostRecentLeaf() { return mainLeaf; }
  getLeafById() { return mainLeaf; }
  createLeafBySplit() { return mainLeaf; }
  splitActiveLeaf() { return mainLeaf; }
  getRightLeaf() { return makeLeaf(false); }
  getLeftLeaf() { return makeLeaf(false); }
  ensureSideLeaf() { return makeLeaf(false); }
  getLeavesOfType(type) { return type === 'markdown' && H.S.current ? [mainLeaf] : []; }
  detachLeavesOfType() {}
  revealLeaf() { return Promise.resolve(); }
  setActiveLeaf() {}
  iterateAllLeaves(cb) { cb(mainLeaf); }
  iterateRootLeaves(cb) { cb(mainLeaf); }
  getLastOpenFiles() { return H.S.history.slice().reverse(); }
  async openLinkText(linktext, sourcePath) { const { path, subpath } = parseLinktext(linktext); await H.openLink(path, subpath.replace(/^#/, '')); }
  requestSaveLayout() {}
  updateOptions() {}
}

/* ---------- UI classes ---------- */
const ALIAS = {
  dice: 'dice-5', gear: 'settings', help: 'circle-help', cross: 'x', trash: 'trash-2', document: 'file-text', documents: 'files',
  checkmark: 'check', 'calendar-with-checkmark': 'calendar-check', reset: 'rotate-ccw', 'sheets-in-box': 'archive',
  'up-chevron-glyph': 'chevron-up', 'down-chevron-glyph': 'chevron-down', 'left-arrow': 'arrow-left', 'right-arrow': 'arrow-right',
  'three-horizontal-bars': 'menu', 'bullet-list': 'list', 'vertical-three-dots': 'more-vertical', 'plus-with-circle': 'circle-plus',
  'popup-open': 'external-link', 'paper-plane': 'send', 'lines-of-text': 'align-left', install: 'download', 'image-file': 'image',
  'bar-graph': 'bar-chart-2', 'pdf-file': 'file-text', 'audio-file': 'file-audio', 'presentation': 'presentation',
};
const iconCache = new Map(), customIcons = new Map();
export function addIcon(name, svg) { customIcons.set(name, `<svg class="svg-icon" viewBox="0 0 100 100" fill="currentColor">${svg}</svg>`); }
export function setIcon(el, name) {
  if (!el) return;
  el.textContent = '';
  if (!name) return;
  if (customIcons.has(name)) { el.innerHTML = customIcons.get(name); return; }
  const n = ALIAS[name] || String(name).replace(/^lucide-/, '');
  if (!/^[a-z0-9-]+$/.test(n)) return;
  const apply = svg => { if (svg && el.isConnected !== false) { el.innerHTML = svg; el.querySelector('svg')?.classList.add('svg-icon'); } };
  const cached = iconCache.get(n);
  if (typeof cached === 'string') return apply(cached);
  const p = cached || fetch(`/lib/lucide/${n}.svg`).then(r => (r.ok ? r.text() : '')).then(s => {
    const svg = s.replace(/<!--[\s\S]*?-->/g, '').trim(); iconCache.set(n, svg); return svg;
  }).catch(() => '');
  if (!cached) iconCache.set(n, p);
  p.then(apply);
}
export function getIcon(name) { const s = document.createElement('span'); s.className = 'svg-icon-wrap'; setIcon(s, name); return s; }
export function getIconIds() { return [...customIcons.keys()]; }

let noticeBox = null;
export class Notice {
  constructor(message, timeout = 4500) {
    if (!noticeBox) noticeBox = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'notice-container' }));
    this.noticeEl = noticeBox.createDiv('notice');
    this.messageEl = this.noticeEl;
    this.setMessage(message);
    this.noticeEl.onclick = () => this.hide();
    if (timeout) setTimeout(() => this.hide(), timeout);
  }
  setMessage(m) { this.noticeEl.setText(m instanceof DocumentFragment ? m : String(m ?? '')); return this; }
  hide() { this.noticeEl.remove(); }
}

export class Scope { constructor(parent) { this.parent = parent; } register() { return {}; } unregister() {} }
export const Keymap = {
  isModEvent: e => (e && (e.ctrlKey || e.metaKey) ? 'tab' : false),
  isModifier: (e, m) => ({ Mod: e.ctrlKey || e.metaKey, Ctrl: e.ctrlKey, Meta: e.metaKey, Shift: e.shiftKey, Alt: e.altKey }[m] || false),
};

export class Modal {
  constructor(a) {
    this.app = a;
    this.scope = new Scope();
    this.shouldRestoreSelection = false;
    this.containerEl = createDiv('modal-container plugin-modal');
    this.containerEl.createDiv('modal-bg').addEventListener('mousedown', () => this.close());
    this.modalEl = this.containerEl.createDiv('modal');
    this.closeButtonEl = this.modalEl.createDiv({ cls: 'modal-close-button', text: '×' });
    this.closeButtonEl.onclick = () => this.close();
    this.titleEl = this.modalEl.createDiv('modal-title');
    this.contentEl = this.modalEl.createDiv('modal-content');
    this._esc = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); } };
  }
  open() { document.body.appendChild(this.containerEl); document.addEventListener('keydown', this._esc, true); this.onOpen(); }
  close() { if (!this.containerEl.isConnected) return; document.removeEventListener('keydown', this._esc, true); this.containerEl.remove(); this.onClose(); }
  setTitle(s) { this.titleEl.setText(s); return this; }
  setContent(c) { this.contentEl.setText(c); return this; }
  onOpen() {}
  onClose() {}
}

export class SuggestModal extends Modal {
  constructor(a) {
    super(a);
    this.limit = 100; this.emptyStateText = 'No results found.'; this.items = []; this.sel = 0;
    this.modalEl.empty();
    this.modalEl.addClass('prompt');
    this.inputEl = this.modalEl.createEl('input', { cls: 'prompt-input', attr: { spellcheck: 'false' } });
    this.resultContainerEl = this.modalEl.createDiv('prompt-results');
    this.instructionsEl = this.modalEl.createDiv('prompt-instructions');
    this.inputEl.addEventListener('input', () => this._update());
    this.inputEl.addEventListener('keydown', e => {
      const n = this.items.length;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); if (n) { this.sel = (this.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; this._draw(); } }
      else if (e.key === 'Enter') { e.preventDefault(); this._choose(this.sel, e); }
    });
  }
  setPlaceholder(p) { this.inputEl.placeholder = p; }
  setInstructions(list) { this.instructionsEl.empty(); for (const i of list || []) { const d = this.instructionsEl.createDiv('prompt-instruction'); d.createSpan({ cls: 'prompt-instruction-command', text: i.command }); d.createSpan({ text: ' ' + i.purpose }); } }
  open() { super.open(); this.inputEl.focus(); this._update(); }
  async _update() { const items = await this.getSuggestions(this.inputEl.value); this.items = (items || []).slice(0, this.limit); this.sel = 0; this._draw(); }
  _draw() {
    this.resultContainerEl.empty();
    if (!this.items.length) { this.onNoSuggestion(); return; }
    this.items.forEach((it, i) => {
      const el = this.resultContainerEl.createDiv('suggestion-item' + (i === this.sel ? ' is-selected' : ''));
      try { this.renderSuggestion(it, el); } catch (e) { console.error(e); }
      el.addEventListener('mousedown', ev => { ev.preventDefault(); this._choose(i, ev); });
      el.addEventListener('mousemove', () => { if (this.sel !== i) { this.sel = i; this._draw(); } });
    });
    this.resultContainerEl.children[this.sel]?.scrollIntoView({ block: 'nearest' });
  }
  _choose(i, evt) { const it = this.items[i]; if (it === undefined) return; this.close(); this.onChooseSuggestion(it, evt); }
  selectSuggestion(it, evt) { this.close(); this.onChooseSuggestion(it, evt); }
  onNoSuggestion() { this.resultContainerEl.createDiv({ cls: 'suggestion-empty', text: this.emptyStateText }); }
  getSuggestions() { return []; }
  renderSuggestion(it, el) { el.setText(String(it)); }
  onChooseSuggestion() {}
}
export class FuzzySuggestModal extends SuggestModal {
  getSuggestions(q) {
    const out = [];
    for (const item of this.getItems()) { const match = prepareFuzzySearch(q)(this.getItemText(item)); if (match || !q) out.push({ item, match: match || { score: 0, matches: [] } }); }
    return q ? out.sort((a, b) => b.match.score - a.match.score) : out;
  }
  renderSuggestion(r, el) { el.setText(this.getItemText(r.item)); }
  onChooseSuggestion(r, evt) { this.onChooseItem(r.item, evt); }
}

export class Menu {
  constructor() { this.items = []; this._onHide = null; }
  addItem(cb) { const it = new MenuItem(); cb(it); this.items.push(it); return this; }
  addSeparator() { this.items.push('-'); return this; }
  setNoIcon() { return this; }
  setUseNativeMenu() { return this; }
  _hostItems() { return this.items.filter(i => i === '-' || !i.isLabel).map(i => i === '-' ? '-' : { label: i.title, danger: i.warning, run: e => i.cb?.(e) }); }
  showAtMouseEvent(e) { H.showMenu(e.clientX, e.clientY, this._hostItems()); return this; }
  showAtPosition(p) { H.showMenu(p.x, p.y, this._hostItems()); return this; }
  hide() { H.hideMenu(); this._onHide?.(); return this; }
  close() { return this.hide(); }
  onHide(cb) { this._onHide = cb; }
}
export class MenuItem {
  setTitle(s) { this.title = s instanceof Node ? s.textContent : String(s); return this; }
  setIcon() { return this; }
  setSection(s) { this.section = s; return this; }
  setDisabled(b) { this.disabled = b; return this; }
  setChecked(b) { this.checked = b; return this; }
  setWarning(b) { this.warning = b; return this; }
  setIsLabel(b) { this.isLabel = b; return this; }
  setSubmenu() { return new Menu(); }
  onClick(cb) { this.cb = cb; return this; }
}

/* ---------- settings UI components ---------- */
export class BaseComponent { constructor() { this.disabled = false; } then(cb) { cb(this); return this; } setDisabled(b) { this.disabled = b; return this; } }
export class ValueComponent extends BaseComponent { registerOptionListener(listeners, key) { return this; } }
export class TextComponent extends ValueComponent {
  constructor(el, tag = 'input') {
    super();
    this.inputEl = el.createEl(tag, { cls: tag === 'input' ? 'setting-input' : 'setting-textarea' });
    if (tag === 'input') this.inputEl.type = 'text';
    this.inputEl.addEventListener('input', () => this._cb?.(this.inputEl.value));
  }
  getValue() { return this.inputEl.value; }
  setValue(v) { this.inputEl.value = v ?? ''; return this; }
  setPlaceholder(p) { this.inputEl.placeholder = p ?? ''; return this; }
  setDisabled(b) { this.inputEl.disabled = b; return this; }
  onChange(cb) { this._cb = cb; return this; }
  onChanged() {}
}
export class SearchComponent extends TextComponent { constructor(el) { super(el); this.inputEl.type = 'search'; } setClass(c) { this.inputEl.addClass(c); return this; } }
export class TextAreaComponent extends TextComponent { constructor(el) { super(el, 'textarea'); } }
export class MomentFormatComponent extends TextComponent {
  setDefaultFormat(f) { this.defaultFormat = f; this.inputEl.placeholder = f; this._sample(); return this; }
  setSampleEl(el) { this.sampleEl = el; this._sample(); return this; }
  setValue(v) { super.setValue(v); this._sample(); return this; }
  _sample() { if (this.sampleEl && window.moment) this.sampleEl.setText(window.moment().format(this.inputEl.value || this.defaultFormat || '')); }
  onChange(cb) { return super.onChange(v => { this._sample(); cb(v); }); }
}
export class ToggleComponent extends ValueComponent {
  constructor(el) {
    super();
    // A switch people can use without a mouse: in the Tab order, Space or Enter flips it, and screen readers hear
    // its name (the setting's label, see Setting), whether it is on, and whether it is unavailable. Same element
    // and classes as before, so plugins that style or click it keep working.
    const sw = this.toggleEl = el.createDiv('checkbox-container');
    sw.setAttribute('role', 'switch');
    sw.tabIndex = 0;
    sw.setAttribute('aria-checked', 'false');
    const flip = () => { if (!this.disabled) { this.setValue(!this.value); this._cb?.(this.value); } };
    sw.addEventListener('click', flip);
    sw.addEventListener('keydown', e => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); flip(); } });
    this.value = false;
  }
  getValue() { return this.value; }
  setValue(v) { this.value = !!v; this.toggleEl.toggleClass('is-enabled', this.value); this.toggleEl.setAttribute('aria-checked', String(this.value)); return this; }
  setDisabled(b) { super.setDisabled(!!b); this.toggleEl.toggleClass('is-disabled', !!b); this.toggleEl.setAttribute('aria-disabled', String(!!b)); return this; }
  setTooltip(s) { this.toggleEl.title = s; if (!this.toggleEl.hasAttribute('aria-labelledby') && !this.toggleEl.hasAttribute('aria-label')) this.toggleEl.setAttribute('aria-label', s); return this; }
  onChange(cb) { this._cb = cb; return this; }
  onClick() { this.toggleEl.click(); }
}
export class DropdownComponent extends ValueComponent {
  constructor(el) { super(); this.selectEl = el.createEl('select', { cls: 'dropdown' }); this.selectEl.addEventListener('change', () => this._cb?.(this.selectEl.value)); }
  addOption(v, d) { this.selectEl.createEl('option', { value: v, text: d }); return this; }
  addOptions(o) { for (const [v, d] of Object.entries(o)) this.addOption(v, d); return this; }
  getValue() { return this.selectEl.value; }
  setValue(v) { this.selectEl.value = v; return this; }
  setDisabled(b) { this.selectEl.disabled = b; return this; }
  onChange(cb) { this._cb = cb; return this; }
}
export class SliderComponent extends ValueComponent {
  constructor(el) { super(); this.sliderEl = el.createEl('input', { cls: 'slider', type: 'range' }); this.sliderEl.addEventListener('input', () => { this._tip(); this._cb?.(Number(this.sliderEl.value)); }); }
  setLimits(min, max, step) { Object.assign(this.sliderEl, { min, max, step: step === 'any' ? 'any' : step }); return this; }
  setDynamicTooltip() { this._dyn = true; this._tip(); return this; }
  showTooltip() { return this; }
  setInstant() { return this; }
  _tip() { if (this._dyn) this.sliderEl.title = this.sliderEl.value; }
  getValue() { return Number(this.sliderEl.value); }
  setValue(v) { this.sliderEl.value = v; this._tip(); return this; }
  onChange(cb) { this._cb = cb; return this; }
}
export class ColorComponent extends ValueComponent {
  constructor(el) { super(); this.colorPickerEl = el.createEl('input', { type: 'color' }); this.colorPickerEl.addEventListener('input', () => this._cb?.(this.colorPickerEl.value)); }
  getValue() { return this.colorPickerEl.value; }
  setValue(v) { this.colorPickerEl.value = v; return this; }
  onChange(cb) { this._cb = cb; return this; }
}
export class ButtonComponent extends BaseComponent {
  constructor(el) { super(); this.buttonEl = el.createEl('button', { cls: 'mod-button' }); this.buttonEl.addEventListener('click', e => this._cb?.(e)); }
  setButtonText(s) { this.buttonEl.setText(s); return this; }
  setCta() { this.buttonEl.addClass('mod-cta'); return this; }
  removeCta() { this.buttonEl.removeClass('mod-cta'); return this; }
  setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
  setIcon(i) { setIcon(this.buttonEl, i); return this; }
  setTooltip(s) { this.buttonEl.title = s; return this; }
  setClass(c) { this.buttonEl.addClass(c); return this; }
  setDisabled(b) { this.buttonEl.disabled = b; return this; }
  onClick(cb) { this._cb = cb; return this; }
}
export class ExtraButtonComponent extends BaseComponent {
  constructor(el) { super(); this.extraSettingsEl = el.createDiv('clickable-icon extra-setting-button'); this.extraSettingsEl.addEventListener('click', e => this._cb?.(e)); setIcon(this.extraSettingsEl, 'settings'); }
  setIcon(i) { setIcon(this.extraSettingsEl, i); return this; }
  setTooltip(s) { this.extraSettingsEl.title = s; return this; }
  setDisabled(b) { this.extraSettingsEl.toggleClass('is-disabled', b); return this; }
  onClick(cb) { this._cb = cb; return this; }
}
export class ProgressBarComponent extends ValueComponent {
  constructor(el) { super(); this.progressBar = el.createEl('progress', { attr: { max: 100 } }); }
  getValue() { return this.progressBar.value; }
  setValue(v) { this.progressBar.value = v; return this; }
}

let settingIds = 0;
export class Setting {
  constructor(containerEl) {
    this.settingEl = containerEl.createDiv('setting-item');
    this.infoEl = this.settingEl.createDiv('setting-item-info');
    this.nameEl = this.infoEl.createDiv('setting-item-name');
    this.descEl = this.infoEl.createDiv('setting-item-description');
    this.controlEl = this.settingEl.createDiv('setting-item-control');
    this.components = [];
  }
  setName(n) { this.nameEl.setText(n); return this; }
  setDesc(d) { this.descEl.setText(d); return this; }
  setClass(c) { this.settingEl.addClass(c); return this; }
  setTooltip(s) { this.settingEl.title = s; return this; }
  setHeading() { this.settingEl.addClass('setting-item-heading'); return this; }
  setDisabled(b) { this.settingEl.toggleClass('is-disabled', b); for (const c of this.components) c.setDisabled?.(b); return this; }
  _add(C, cb) {
    const c = new C(this.controlEl); this.components.push(c);
    // A switch is named by this row's label and described by its description (whatever order they are set in).
    if (c.toggleEl) {
      this.nameEl.id ||= 'setting-name-' + (++settingIds); this.descEl.id ||= 'setting-desc-' + settingIds;
      c.toggleEl.setAttribute('aria-labelledby', this.nameEl.id); c.toggleEl.setAttribute('aria-describedby', this.descEl.id);
    }
    cb?.(c); return this;
  }
  addText(cb) { return this._add(TextComponent, cb); }
  addSearch(cb) { return this._add(SearchComponent, cb); }
  addTextArea(cb) { return this._add(TextAreaComponent, cb); }
  addMomentFormat(cb) { return this._add(MomentFormatComponent, cb); }
  addToggle(cb) { return this._add(ToggleComponent, cb); }
  addDropdown(cb) { return this._add(DropdownComponent, cb); }
  addSlider(cb) { return this._add(SliderComponent, cb); }
  addColorPicker(cb) { return this._add(ColorComponent, cb); }
  addButton(cb) { return this._add(ButtonComponent, cb); }
  addExtraButton(cb) { return this._add(ExtraButtonComponent, cb); }
  addProgressBar(cb) { return this._add(ProgressBarComponent, cb); }
  addComponent(fn) { const c = fn(this.controlEl); this.components.push(c); return this; }
  then(cb) { cb(this); return this; }
  clear() { this.controlEl.empty(); this.components = []; return this; }
}
export class SettingTab { constructor(a) { this.app = a; this.containerEl = createDiv('vertical-tab-content'); } display() {} hide() { this.containerEl.empty(); } }
export class PluginSettingTab extends SettingTab { constructor(a, plugin) { super(a); this.plugin = plugin; } }

export class MarkdownRenderChild extends Component { constructor(containerEl) { super(); this.containerEl = containerEl; } }
export class MarkdownRenderer extends MarkdownRenderChild {
  static async render(a, markdown, el, sourcePath, component) { el.addClass('markdown'); H.renderInto(el, markdown, sourcePath || '', 1); runPostProcessors(el, sourcePath || '', component); }
  static async renderMarkdown(markdown, el, sourcePath, component) { return MarkdownRenderer.render(app, markdown, el, sourcePath, component); }
}
export class HoverPopover extends Component {}
export class PopoverSuggest { constructor(a) { this.app = a; } open() {} close() {} }
export class AbstractInputSuggest extends PopoverSuggest {
  constructor(a, inputEl) { super(a); this.inputEl = inputEl; this.limit = 100; }
  setValue(v) { this.inputEl.value = v; } getValue() { return this.inputEl.value; }
  onSelect(cb) { this._sel = cb; return this; }
}
export class EditorSuggest extends PopoverSuggest {
  constructor(a) { super(a); this.context = null; this.limit = 100; this.instructions = []; }
  setInstructions(i) { this.instructions = i; }
  close() { closeEditorSuggest(); }
}

/* ---------- helpers ---------- */
export function debounce(fn, wait = 0, resetTimer = false) {
  let tm = null, args = [];
  const d = (...a) => {
    args = a;
    if (tm && !resetTimer) return d;
    clearTimeout(tm);
    tm = setTimeout(() => { tm = null; fn(...args); }, wait);
    return d;
  };
  d.cancel = () => { clearTimeout(tm); tm = null; return d; };
  d.run = () => { if (tm) { clearTimeout(tm); tm = null; return fn(...args); } };
  return d;
}
export function prepareFuzzySearch(q) { return text => { const r = H.fuzzy(q, text || ''); return r ? { score: r.score, matches: r.idx.map(i => [i, i + 1]) } : null; }; }
export function prepareSimpleSearch(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  return text => { const tl = (text || '').toLowerCase(); return words.every(w => tl.includes(w)) ? { score: 0, matches: [] } : null; };
}
export function renderResults(el, text) { el.setText(text); }
export function renderMatches(el, text) { el.setText(text); }
export function parseYaml(s) { return yaml.load(s); }
export function stringifyYaml(o) { return yaml.dump(o); }
export function getLinkpath(linktext) { return String(linktext).split(/[#|]/)[0]; }
export function parseLinktext(linktext) { const i = linktext.indexOf('#'); return i < 0 ? { path: linktext, subpath: '' } : { path: linktext.slice(0, i), subpath: linktext.slice(i) }; }
export function stripHeading(h) { return String(h).replace(/[#|^\\%\[\]:]+/g, ' ').replace(/\s+/g, ' ').trim(); }
export function parseFrontMatterTags(fm) {
  const v = fm?.tags ?? fm?.tag; if (v == null) return null;
  return (Array.isArray(v) ? v : String(v).split(/[,\s]+/)).filter(Boolean).map(x => '#' + String(x).replace(/^#/, ''));
}
export function parseFrontMatterAliases(fm) {
  const v = fm?.aliases ?? fm?.alias; if (v == null) return null;
  return (Array.isArray(v) ? v : String(v).split(',')).map(x => String(x).trim()).filter(Boolean);
}
export function parseFrontMatterEntry(fm, key) { return fm?.[key] ?? null; }
export function parseFrontMatterStringArray(fm, key) { const v = fm?.[key]; return v == null ? null : (Array.isArray(v) ? v.map(String) : [String(v)]); }
export function getAllTags(cache) { if (!cache) return null; return [...(cache.tags || []).map(x => x.tag), ...(parseFrontMatterTags(cache.frontmatter) || [])]; }
export function getFrontMatterInfo(content) { const m = content.match(FM_RE); return m ? { exists: true, frontmatter: m[1], from: 4, to: 4 + m[1].length, contentStart: m[0].length } : { exists: false, frontmatter: '', from: 0, to: 0, contentStart: 0 }; }
export function htmlToMarkdown(html) { const d = document.createElement('div'); d.innerHTML = typeof html === 'string' ? html : html.outerHTML; return d.innerText; }
export function sanitizeHTMLToDom(html) { const tpl = document.createElement('template'); tpl.innerHTML = html; tpl.content.querySelectorAll('script,iframe,object').forEach(s => s.remove()); return tpl.content; }
export function arrayBufferToBase64(buf) { let s = ''; for (const b of new Uint8Array(buf)) s += String.fromCharCode(b); return btoa(s); }
export function base64ToArrayBuffer(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer; }
export function arrayBufferToHex(buf) { return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join(''); }
export function requireApiVersion() { return true; }
export const apiVersion = '1.7.7';
export const Platform = {
  isDesktop: true, isMobile: false, isDesktopApp: true, isMobileApp: false, isIosApp: false, isAndroidApp: false,
  isPhone: false, isTablet: false, isMacOS: /Mac/.test(navigator.platform), isWin: /Win/.test(navigator.platform),
  isLinux: /Linux/.test(navigator.platform), isSafari: false, resourcePathPrefix: '/vault/',
};
export async function requestUrl(req) {
  if (typeof req === 'string') req = { url: req };
  let body = req.body;
  if (body instanceof ArrayBuffer) body = new TextDecoder().decode(body);
  const headers = { ...(req.headers || {}) };
  if (req.contentType) headers['Content-Type'] = req.contentType;
  const r = await H.api('POST', 'fetch', {}, { url: req.url, method: req.method || 'GET', headers, body });
  const bytes = Uint8Array.from(atob(r.body), c => c.charCodeAt(0));
  const text = new TextDecoder().decode(bytes);
  if (req.throw !== false && r.status >= 400) { const e = new Error(`Request failed, status ${r.status}`); e.status = r.status; throw e; }
  return { status: r.status, headers: r.headers, arrayBuffer: bytes.buffer, text, get json() { return JSON.parse(text); } };
}
export async function request(req) { return (await requestUrl(req)).text; }
export function loadMermaid() { return Promise.reject(new Error('Mermaid is not available in Graphite')); }
export function loadMathJax() { return Promise.resolve(); }
export function loadPdfJs() { return Promise.reject(new Error('PDF.js is not available in Graphite')); }
export function loadPrism() { return Promise.resolve(window.Prism); }
export function renderMath(src, display = false) {
  const el = document.createElement(display ? 'div' : 'span');
  el.className = display ? 'math math-block' : 'math math-inline';
  try { katex.render(String(src), el, { displayMode: display, throwOnError: false, strict: 'ignore' }); } catch { el.textContent = src; }
  return el;
}
export function finishRenderMath() { return Promise.resolve(); }

/* =====================================================================
   App object & plugin base class
   ===================================================================== */
const vault = new Vault();
const metadataCache = new MetadataCache();
const workspace = new Workspace();
const commandsById = {};
export class App {}
export const app = Object.create(App.prototype);
Object.assign(app, {
  vault, metadataCache, workspace,
  keymap: { pushScope() {}, popScope() {} },
  scope: new Scope(),
  lastEvent: null,
  isMobile: false,
  appId: 'myobsidian',
  fileManager: {
    async renameFile(file, newPath) { await H.renamePath(file.path, normalizePath(newPath)); },
    generateMarkdownLink(file, sourcePath, subpath = '', alias = '') { return `[[${H.linkNameFor(file.path)}${subpath || ''}${alias ? '|' + alias : ''}]]`; },
    async processFrontMatter(file, fn) {
      const text = await vault.read(file);
      const m = text.match(FM_RE);
      const obj = m ? (yaml.load(m[1]) || {}) : {};
      fn(obj);
      const body = m ? text.slice(m[0].length) : text;
      await vault.modify(file, Object.keys(obj).length ? `---\n${yaml.dump(obj)}---\n${body}` : body);
    },
    getNewFileParent(sourcePath) { const d = dirName(sourcePath || H.S.current || ''); return d ? folderOf(d) : root(); },
    async trashFile(file) { await vault.trash(file); },
    async getAvailablePathForAttachment(name) { return 'attachments/' + name; },
  },
  commands: {
    commands: commandsById,
    editorCommands: {},
    executeCommandById(id) { return H.runCommand(id) !== false; },
    listCommands() { return Object.values(commandsById); },
    findCommand(id) { return commandsById[id]; },
  },
  plugins: {
    plugins: {}, manifests: {}, enabledPlugins: new Set(),
    getPlugin(id) { return this.plugins[id] || null; },
    async enablePluginAndSave(id) { await enablePlugin(id); },
    async disablePluginAndSave(id) { await disablePlugin(id); },
  },
  internalPlugins: {
    plugins: { 'daily-notes': { enabled: true, instance: { options: { folder: 'Daily Notes', format: 'YYYY-MM-DD', template: '' } } } },
    getPluginById(id) { return this.plugins[id] || null; },
    getEnabledPluginById(id) { return this.plugins[id]?.enabled ? this.plugins[id].instance : null; },
  },
  setting: { open() { H.openSettings(); }, openTabById(id) { H.openSettings(id); }, close() { H.closeSettings(); } },
  loadLocalStorage(k) { try { return JSON.parse(localStorage.getItem('mo:app:' + k)); } catch { return null; } },
  saveLocalStorage(k, v) { try { if (v == null) localStorage.removeItem('mo:app:' + k); else localStorage.setItem('mo:app:' + k, JSON.stringify(v)); } catch { /* ignore */ } },
  emulateMobile() {},
  openWithDefaultApp(p) { window.open('/vault/' + H.encPath(p), '_blank'); },
  showInFolder(p) { H.api('POST', 'reveal', { path: dirName(p) }); },
});

const settingTabs = [];          // { plugin, tab }
const postProcessors = [];       // { fn, order, plugin }
const codeBlocks = new Map();    // lang -> fn
const editorSuggests = [];       // EditorSuggest instances
const hotkeys = [];              // { id, hk }

// The plugins that ship with Graphite are Graphite's own features: they show under Graphite's names in the user's
// language ("Graphite study assistant"…), whichever AI does the work. Their ids (claude-chat…), folders, settings
// and files keep the old names, so nothing a user already has moves or disappears.
const GRAPHITE_PLUGINS = new Set(['claude-chat', 'claude-capture', 'claude-quizzes']);
export function pluginName(m) {
  if (m && GRAPHITE_PLUGINS.has(m.id)) { const k = `plug.${m.id}.name`, v = t(k); if (v !== k) return v; }
  return m?.name || m?.id || '';
}
export function pluginDesc(m) {
  if (m && GRAPHITE_PLUGINS.has(m.id)) { const k = `plug.${m.id}.desc`, v = t(k); if (v !== k) return v; }
  return m?.description || '';
}
export class Plugin extends Component {
  constructor(a, manifest) { super(); this.app = a; this.manifest = manifest; }
  addCommand(cmd) {
    const id = `${this.manifest.id}:${cmd.id}`;
    const full = { ...cmd, id, name: `${pluginName(this.manifest)}: ${cmd.name}` };
    commandsById[id] = full;
    const available = () => {
      try {
        if (cmd.checkCallback) return !!cmd.checkCallback(true);
        if (cmd.editorCheckCallback) return !!(H.S.current && cmd.editorCheckCallback(true, editor, activeView));
        if (cmd.editorCallback) return !!H.S.current;
        return true;
      } catch (e) { console.error(e); return false; }
    };
    const run = () => {
      if (cmd.checkCallback) return cmd.checkCallback(false);
      if (cmd.editorCheckCallback) return cmd.editorCheckCallback(false, editor, activeView);
      if (cmd.editorCallback) return cmd.editorCallback(editor, activeView);
      return cmd.callback?.();
    };
    const hk = (cmd.hotkeys || [])[0];
    H.registerCommand({ id, name: full.name, label: full.name, plugin: this.manifest.id, available, run: () => { try { const r = run(); r?.catch?.(err => pluginError(this.manifest, err)); } catch (err) { pluginError(this.manifest, err); } }, kbd: hk ? hotkeyLabel(hk) : undefined });
    for (const h of cmd.hotkeys || []) hotkeys.push({ id, hk: h, available });
    this.register(() => { H.unregisterCommand(id); delete commandsById[id]; for (let i = hotkeys.length - 1; i >= 0; i--) if (hotkeys[i].id === id) hotkeys.splice(i, 1); });
    return full;
  }
  removeCommand(id) { H.unregisterCommand(`${this.manifest.id}:${id}`); delete commandsById[`${this.manifest.id}:${id}`]; }
  addRibbonIcon(iconName, title, cb) {
    const el = H.addRibbonButton(title);
    setIcon(el, iconName);
    el.addEventListener('click', e => { try { cb(e); } catch (err) { pluginError(this.manifest, err); } });
    this.register(() => el.remove());
    return el;
  }
  addStatusBarItem() {
    const el = createDiv('status-bar-item plugin-' + this.manifest.id.replace(/[^\w-]/g, ''));
    document.querySelector('#status').prepend(el);
    this.register(() => el.remove());
    return el;
  }
  addSettingTab(tab) { const rec = { plugin: this, tab }; settingTabs.push(rec); this.register(() => settingTabs.remove(rec)); }
  registerMarkdownPostProcessor(fn, sortOrder = 0) {
    const rec = { fn, order: sortOrder, plugin: this.manifest };
    postProcessors.push(rec); postProcessors.sort((a, b) => a.order - b.order);
    this.register(() => postProcessors.remove(rec));
    H.rerender();
    return fn;
  }
  registerMarkdownCodeBlockProcessor(lang, fn) {
    codeBlocks.set(lang, { fn, plugin: this.manifest });
    this.register(() => codeBlocks.delete(lang));
    H.rerender();
    return fn;
  }
  registerEditorSuggest(s) { editorSuggests.push(s); this.register(() => editorSuggests.remove(s)); }
  registerView(type) { console.warn(`[${this.manifest.id}] registerView("${type}") is not supported in Graphite`); }
  registerExtensions() {}
  registerEditorExtension() { console.warn(`[${this.manifest.id}] CodeMirror editor extensions are not supported in Graphite`); }
  registerObsidianProtocolHandler() {}
  registerHoverLinkSource() {}
  registerCliHandler() {}
  async loadData() { try { return JSON.parse((await H.api('GET', 'file', { path: this.manifest.dir + '/data.json' })).content); } catch { return null; } }
  async saveData(d) { await H.api('PUT', 'file', { path: this.manifest.dir + '/data.json' }, JSON.stringify(d, null, 2)); }
  onExternalSettingsChange() {}
}

function hotkeyLabel(h) {
  const mods = (h.modifiers || []).map(m => ({ Mod: 'Ctrl', Meta: 'Win' }[m] || m));
  return [...mods, String(h.key).length === 1 ? h.key.toUpperCase() : h.key].join('+');
}

/* =====================================================================
   The `obsidian` module handed to require()
   ===================================================================== */
function inertModule() {
  // Stand-in for CodeMirror/Lezer imports: any access or call returns itself, so plugins that only
  // *also* ship an editor extension still load (their editor extension just does nothing).
  const fn = function () {};
  const p = new Proxy(fn, {
    get: (_, k) => (k === 'prototype' ? {} : k === Symbol.toPrimitive ? () => '' : k === 'then' ? undefined : p),
    apply: () => p,
    construct: () => p,
  });
  return p;
}
let OBSIDIAN = null;
function obsidianModule() {
  if (OBSIDIAN) return OBSIDIAN;
  OBSIDIAN = {
    App, Plugin, Component, Events, Notice, Modal, SuggestModal, FuzzySuggestModal, Menu, MenuItem, Setting, SettingTab, PluginSettingTab,
    BaseComponent, ValueComponent, TextComponent, SearchComponent, TextAreaComponent, MomentFormatComponent, ToggleComponent,
    DropdownComponent, SliderComponent, ColorComponent, ButtonComponent, ExtraButtonComponent, ProgressBarComponent,
    TAbstractFile, TFile, TFolder, Vault, DataAdapter, FileSystemAdapter, MetadataCache, Workspace, WorkspaceLeaf,
    View, ItemView, FileView, EditableFileView, TextFileView, MarkdownView, MarkdownPreviewView, Editor,
    MarkdownRenderer, MarkdownRenderChild, HoverPopover, PopoverSuggest, AbstractInputSuggest, EditorSuggest, Scope, Keymap,
    Platform, apiVersion, requireApiVersion, normalizePath, debounce, setIcon, getIcon, addIcon, getIconIds,
    prepareFuzzySearch, prepareSimpleSearch, renderResults, renderMatches, parseYaml, stringifyYaml, getLinkpath, parseLinktext,
    stripHeading, parseFrontMatterTags, parseFrontMatterAliases, parseFrontMatterEntry, parseFrontMatterStringArray, getAllTags,
    getFrontMatterInfo, htmlToMarkdown, sanitizeHTMLToDom, arrayBufferToBase64, base64ToArrayBuffer, arrayBufferToHex,
    requestUrl, request, loadMermaid, loadMathJax, loadPdfJs, loadPrism, renderMath, finishRenderMath,
    // CodeMirror state fields: only used inside editor extensions, which Graphite does not run.
    editorInfoField: inertModule(), editorLivePreviewField: inertModule(), editorEditorField: inertModule(), editorViewField: inertModule(),
    moment: window.moment,
  };
  return OBSIDIAN;
}
function requireShim(name) {
  if (name === 'obsidian') return obsidianModule();
  if (name === 'moment') return window.moment;
  if (/^@codemirror\/|^@lezer\//.test(name)) return inertModule();
  throw new Error(`Module "${name}" is not available in Graphite`);
}

/* =====================================================================
   Plugin manager
   ===================================================================== */
const loaded = new Map();     // id -> { inst, styleEl, manifest }
const errors = new Map();     // id -> message
let installed = [];           // from /api/plugins
let enabled = new Set();
let pluginDirPath = '';

const PLUGINS_ON_KEY = 'mo:pluginsOn';
export const pluginsOn = () => { try { return localStorage.getItem(PLUGINS_ON_KEY) === '1'; } catch { return false; } };

function pluginError(manifest, err) {
  console.error(`[plugin ${manifest.id}]`, err);
  new Notice(t('plugins.runtimeError', { name: pluginName(manifest), msg: err?.message || String(err) }), 8000);
}

export async function refreshInstalled() {
  const r = await H.api('GET', 'plugins');
  installed = r.plugins; enabled = new Set(r.enabled); pluginDirPath = r.dir;
  for (const p of installed) if (p.manifest) app.plugins.manifests[p.manifest.id] = { ...p.manifest, dir: `.obsidian/plugins/${p.dir}` };
  return installed;
}
export const getInstalled = () => installed;
export const getPluginDir = () => pluginDirPath;
export const isEnabled = id => enabled.has(id);
// Plugins that ship with Graphite (extensions/obsidian-plugins): they run in restricted mode too.
export const isBuiltin = id => installed.some(p => p.manifest?.id === id && p.builtin);
export const isLoaded = id => loaded.has(id);
export const getError = id => errors.get(id);
export const getSettingTabs = () => settingTabs.filter(r => loaded.has(r.plugin.manifest.id));

async function saveEnabled() {
  await H.api('PUT', 'file', { path: '.obsidian/community-plugins.json' }, JSON.stringify([...enabled], null, 2));
}

async function loadPlugin(info) {
  const id = info.manifest.id;
  if (loaded.has(id)) return;
  errors.delete(id);
  const dir = `.obsidian/plugins/${info.dir}`;
  const manifest = { ...info.manifest, dir };
  try {
    if (!info.hasMain) throw new Error('main.js is missing');
    const code = (await H.api('GET', 'file', { path: dir + '/main.js' })).content;
    let styleEl = null;
    if (info.hasStyles) {
      const css = (await H.api('GET', 'file', { path: dir + '/styles.css' })).content;
      styleEl = document.head.appendChild(Object.assign(document.createElement('style'), { textContent: css }));
      styleEl.dataset.plugin = id;
    }
    const module = { exports: {} };
    // eslint-disable-next-line no-new-func
    new Function('require', 'module', 'exports', `${code}\n//# sourceURL=plugin:${encodeURIComponent(id)}/main.js`)(requireShim, module, module.exports);
    const Cls = module.exports?.default || module.exports;
    if (typeof Cls !== 'function') { styleEl?.remove(); throw new Error('main.js does not export a plugin class'); }
    const inst = new Cls(app, manifest);
    loaded.set(id, { inst, styleEl, manifest });
    app.plugins.plugins[id] = inst;
    app.plugins.enabledPlugins.add(id);
    await inst.load();
  } catch (e) {
    console.error(`[plugin ${id}] failed to load`, e);
    errors.set(id, e?.message || String(e));
    const rec = loaded.get(id);
    if (rec) { try { rec.inst.unload(); } catch { /* ignore */ } rec.styleEl?.remove(); loaded.delete(id); delete app.plugins.plugins[id]; app.plugins.enabledPlugins.delete(id); }
    new Notice(t('plugins.loadFailed', { name: pluginName(info.manifest), msg: e?.message || String(e) }), 8000);
  }
}

function unloadPlugin(id) {
  const rec = loaded.get(id);
  if (!rec) return;
  try { rec.inst.unload(); } catch (e) { console.error(e); }
  rec.styleEl?.remove();
  loaded.delete(id);
  delete app.plugins.plugins[id];
  app.plugins.enabledPlugins.delete(id);
  H.rerender();
}

export async function enablePlugin(id) {
  enabled.add(id); await saveEnabled();
  const info = installed.find(p => p.manifest?.id === id);
  if (info && (pluginsOn() || info.builtin)) await loadPlugin(info);
}
export async function disablePlugin(id) {
  enabled.delete(id); await saveEnabled();
  errors.delete(id);
  unloadPlugin(id);
}
export async function uninstallPlugin(id) {
  const info = installed.find(p => p.manifest?.id === id);
  await disablePlugin(id);
  if (info) await H.api('DELETE', 'file', { path: `.obsidian/plugins/${info.dir}` });
  await refreshInstalled();
}
export async function installPlugin(repo) {
  const r = await H.api('POST', 'plugins/install', {}, { repo });
  await refreshInstalled();
  return r;
}
export async function fetchCommunity() { return H.api('GET', 'plugins/community'); }

export async function setPluginsOn(on) {
  try { localStorage.setItem(PLUGINS_ON_KEY, on ? '1' : '0'); } catch { /* ignore */ }
  if (on) await loadEnabled();
  else for (const id of [...loaded.keys()]) if (!isBuiltin(id)) unloadPlugin(id);
}
export async function reloadAll() {
  for (const id of [...loaded.keys()]) unloadPlugin(id);
  await refreshInstalled();
  await loadEnabled();
}
async function loadEnabled() {
  for (const id of enabled) {
    const info = installed.find(p => p.manifest?.id === id);
    if (info && (pluginsOn() || info.builtin)) await loadPlugin(info);
  }
}

/* =====================================================================
   Hooks called by the host app
   ===================================================================== */
// Render children (e.g. Dataview query views) belong to the element they were rendered into and are
// unloaded when that element is rendered again, so live views don't pile up while you type.
const renderChildren = new WeakMap();
export function runPostProcessors(el, sourcePath, component) {
  for (const c of renderChildren.get(el) || []) { try { c.unload(); } catch (e) { console.error(e); } }
  renderChildren.delete(el);
  if (!codeBlocks.size && !postProcessors.length) return;
  const f = H.S.files.get(sourcePath);
  const kids = [];
  renderChildren.set(el, kids);
  const addChild = c => { if (component?.addChild) component.addChild(c); else { kids.push(c); c.load?.(); } return c; };
  const ctx = { sourcePath, docId: sourcePath, frontmatter: f?.fm || undefined, containerEl: el, addChild, getSectionInfo: () => null, displayMode: true, remainingNestLevel: 4 };
  if (codeBlocks.size) {
    for (const code of el.querySelectorAll('pre > code[class*="language-"]')) {
      const lang = [...code.classList].find(c => c.startsWith('language-'))?.slice(9);
      const rec = lang && codeBlocks.get(lang);
      if (!rec) continue;
      const div = createDiv('block-language-' + lang);
      code.parentElement.replaceWith(div);
      try { const r = rec.fn(code.textContent.replace(/\n$/, ''), div, ctx); r?.catch?.(e => pluginError(rec.plugin, e)); } catch (e) { pluginError(rec.plugin, e); }
    }
  }
  for (const rec of postProcessors) {
    try { const r = rec.fn(el, ctx); r?.catch?.(e => pluginError(rec.plugin, e)); } catch (e) { pluginError(rec.plugin, e); }
  }
}

export function emitVault(type, path, oldPath) {
  if (type === 'rename') {
    for (const map of [fileObjs, folderObjs]) {
      for (const [k, obj] of [...map]) {
        let np = null;
        if (k === oldPath) np = path; else if (k.startsWith(oldPath + '/')) np = path + k.slice(oldPath.length);
        if (np) { map.delete(k); obj._set(np); map.set(np, obj); }
      }
    }
    const obj = H.S.folders.has(path) ? folderOf(path) : fileOf(path);
    vault.trigger('rename', obj, oldPath);
    return;
  }
  const obj = type !== 'delete' && H.S.folders.has(path) ? folderOf(path) : (fileObjs.get(path) || folderObjs.get(path) || fileOf(path));
  vault.trigger(type, obj);
  if (type === 'delete') { fileObjs.delete(path); metadataCache.trigger('deleted', obj, null); }
}
export function emitMetadata(path) {
  const f = H.S.files.get(path);
  if (!f) return;
  const file = fileOf(path);
  metadataCache.trigger('changed', file, f.content, metadataCache.getCache(path));
  metadataCache.trigger('resolve', file);
  metadataCache.trigger('resolved');
}
export function emitFileOpen(path) {
  const file = path ? fileOf(path) : null;
  workspace.trigger('file-open', file);
  workspace.trigger('active-leaf-change', mainLeaf);
}
export function emitLayoutChange() { workspace.trigger('layout-change'); }
export function emitEditorChange() {
  workspace.trigger('editor-change', editor, activeView);
  updateEditorSuggest();
}
// Ask plugins for extra file context-menu items ("file-menu" event).
export function fileMenuItems(path, isFolder) {
  const menu = new Menu();
  const file = isFolder ? folderOf(path) : fileOf(path);
  workspace.trigger('file-menu', menu, file, 'file-explorer-context-menu', mainLeaf);
  return menu._hostItems();
}
export function editorMenuItems() {
  const menu = new Menu();
  workspace.trigger('editor-menu', menu, editor, activeView);
  return menu._hostItems();
}

/* ---------- editor suggest popup ---------- */
let esState = null; // { suggest, items, sel, el }
function closeEditorSuggest() { esState?.el.remove(); esState = null; }
async function updateEditorSuggest() {
  if (!editorSuggests.length || !H.S.current) return closeEditorSuggest();
  const cursor = editor.getCursor(), file = fileOf(H.S.current);
  for (const s of editorSuggests) {
    let trig = null;
    try { trig = s.onTrigger(cursor, editor, file); } catch (e) { console.error(e); }
    if (!trig) continue;
    const ctx = { ...trig, editor, file };
    s.context = ctx;
    let items = [];
    try { items = (await s.getSuggestions(ctx)) || []; } catch (e) { console.error(e); }
    if (!items.length) continue;
    showEditorSuggest(s, items.slice(0, s.limit || 100), toOffset(trig.start));
    return;
  }
  closeEditorSuggest();
}
function showEditorSuggest(s, items, offset) {
  if (!esState) esState = { el: document.body.appendChild(Object.assign(document.createElement('div'), { className: 'suggest-popup' })) };
  Object.assign(esState, { suggest: s, items, sel: 0 });
  drawEditorSuggest();
  const c = H.caretCoords(offset), box = esState.el, lh = 27;
  box.style.left = Math.max(8, Math.min(c.x, innerWidth - box.offsetWidth - 8)) + 'px';
  box.style.top = (c.y + box.offsetHeight + 8 > innerHeight ? c.y - lh - box.offsetHeight - 4 : c.y + 4) + 'px';
}
function drawEditorSuggest() {
  const { el, items, suggest, sel } = esState;
  el.empty();
  items.forEach((it, i) => {
    const row = el.createDiv('sg-item suggestion-item' + (i === sel ? ' sel is-selected' : ''));
    try { suggest.renderSuggestion(it, row); } catch (e) { row.setText(String(it)); }
    row.addEventListener('mousedown', e => { e.preventDefault(); chooseEditorSuggest(i, e); });
  });
  el.children[sel]?.scrollIntoView({ block: 'nearest' });
}
function chooseEditorSuggest(i, evt) {
  const { suggest, items } = esState;
  closeEditorSuggest();
  try { suggest.selectSuggestion(items[i], evt); } catch (e) { console.error(e); }
}

/* =====================================================================
   Init
   ===================================================================== */
export async function initPlugins(host) {
  H = host;
  installDomHelpers();
  mainLeaf = makeLeaf(true);
  window.app = app;
  if (window.moment) window.moment.locale(document.documentElement.lang || 'en');

  // Editor suggest keyboard handling runs before the app's own editor shortcuts.
  H.editorEl.addEventListener('keydown', e => {
    if (!esState) return;
    const n = esState.items.length;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); esState.sel = (esState.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n; drawEditorSuggest(); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); chooseEditorSuggest(esState.sel, e); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeEditorSuggest(); }
  }, true);
  H.editorEl.addEventListener('blur', () => setTimeout(closeEditorSuggest, 150));

  // Plugin hotkeys.
  document.addEventListener('keydown', e => {
    if (!hotkeys.length || e.repeat) return;
    for (const { id, hk, available } of hotkeys) {
      const mods = hk.modifiers || [];
      const want = { ctrl: mods.includes('Mod') || mods.includes('Ctrl'), shift: mods.includes('Shift'), alt: mods.includes('Alt'), meta: mods.includes('Meta') };
      if ((e.ctrlKey || (want.ctrl && e.metaKey)) !== want.ctrl || e.shiftKey !== want.shift || e.altKey !== want.alt) continue;
      if (e.key.toLowerCase() !== String(hk.key).toLowerCase()) continue;
      if (!available()) continue;
      e.preventDefault(); e.stopPropagation();
      H.runCommand(id);
      return;
    }
  }, true);

  window.addEventListener('mousemove', e => { app.lastEvent = e; }, { passive: true });
  try { await refreshInstalled(); } catch (e) { console.warn('Could not list plugins', e); }
  await loadEnabled();
  workspace.layoutReady = true;
  workspace.trigger('layout-ready');
  metadataCache.trigger('resolved');
}
export function setMomentLocale(lang) { if (window.moment) window.moment.locale(lang); }
