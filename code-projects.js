'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const LIMIT = 2 * 1024 * 1024; // same as the Graphite source editor
const error = (status, code, message) => Object.assign(new Error(message), { status, code });
const missing = err => err.code === 'ENOENT' || err.code === 'ENOTDIR';
const samePath = (a, b) => path.relative(a, b) === '';
const changed = () => error(409, 'changed', 'The file changed on disk. Reload before saving.');
const projectChanged = () => error(409, 'project_changed', 'The selected project changed. Reopen the file.');
const invalidPath = () => error(400, 'invalid_path', 'Choose a relative path inside the project.');
const unsupported = () => error(400, 'not_regular', 'This is not an ordinary project file or directory.');

function pathParts(value, allowRoot = false) {
  if (allowRoot && value === '') return [];
  if (typeof value !== 'string' || !value || path.win32.isAbsolute(value) || path.posix.isAbsolute(value)) throw invalidPath();
  const parts = value.split(/[\\/]/);
  for (const part of parts) {
    if (!part || part === '.' || part === '..' || /^\..+\.graphite-lock$/i.test(part) || /[:\x00-\x1f]/.test(part) ||
        (process.platform === 'win32' && (/[<>"|?*]|[. ]$/.test(part) ||
          /^(?:con|prn|aux|nul|conin\$|conout\$|(?:com|lpt)[1-9¹²³])(?:\.|$)/i.test(part)))) throw invalidPath();
  }
  return parts;
}

// The renderer submits relative paths and a project ID. Only native folder selection (or the
// vault already selected by the user) may introduce an absolute root into the stored grant.
function createCodeProjects({ stateFile, pickDirectory, getVault, atomicWrite, withFileLock, readSource }) {
  async function load() {
    let raw;
    try { raw = await fs.readFile(stateFile, 'utf8'); }
    catch (err) { if (err.code === 'ENOENT') return null; throw err; }
    let s;
    try { s = JSON.parse(raw); } catch { /* reported below */ }
    if (!s || typeof s.id !== 'string' || typeof s.root !== 'string' || !path.isAbsolute(s.root) ||
        typeof s.dev !== 'string' || typeof s.ino !== 'string') throw error(409, 'invalid_state', 'Choose the project folder again.');
    return s;
  }

  async function verifyRoot(s) {
    try {
      const real = await fs.realpath(s.root);
      const st = await fs.stat(real, { bigint: true });
      if (samePath(s.root, real) && st.isDirectory() && s.dev === String(st.dev) && s.ino === String(st.ino)) return real;
    } catch (err) {
      if (!missing(err) && !['EACCES','EPERM'].includes(err.code)) throw err;
    }
    throw error(404, 'project_unavailable', 'The project folder has moved or is unavailable. Choose it again.');
  }
  const describe = (s, available) => ({ id:s.id, name:path.basename(s.root) || s.root, root:s.root, available });
  async function status() {
    const s = await load();
    if (!s) return { project:null };
    try { await verifyRoot(s); return { project:describe(s, true) }; }
    catch (err) { if (err.code !== 'project_unavailable') throw err; return { project:describe(s, false) }; }
  }
  async function select(folder) {
    if (typeof folder !== 'string' || !path.isAbsolute(folder)) throw invalidPath();
    const root = await fs.realpath(folder);
    const st = await fs.stat(root, { bigint:true });
    if (!st.isDirectory()) throw unsupported();
    const dev=String(st.dev), ino=String(st.ino);
    return withFileLock(stateFile, async () => {
      let prev;
      try { prev = await load(); } catch (err) { if (err.code !== 'invalid_state') throw err; }
      const keep = prev && samePath(prev.root, root) && dev === prev.dev && ino === prev.ino;
      const s = { id: keep ? prev.id : randomUUID(), root, dev, ino };
      await verifyRoot(s);
      await atomicWrite(stateFile, JSON.stringify(s)+'\n', {mode:0o600});
      return { project:describe(s, true) };
    });
  }
  async function resolveRoot({ projectId } = {}) {
    const s = await load();
    if (!s || typeof projectId !== 'string' || s.id !== projectId) throw projectChanged();
    return verifyRoot(s);
  }

  async function resolveEntry(input, kind, newEntry = false) {
    const root = await resolveRoot(input), parts = pathParts(input.path, kind === 'directory' && !newEntry);
    let current = root;
    for (let i=0; i<parts.length; i++) {
      current = path.join(current, parts[i]);
      if (newEntry && i === parts.length-1) break;
      let st;
      try { st = await fs.lstat(current); } catch (err) { if (missing(err)) throw error(404,'not_found','The project entry no longer exists.'); throw err; }
      if (st.isSymbolicLink() || !(i === parts.length-1 && kind === 'file' ? st.isFile() : st.isDirectory())) throw unsupported();
      if (!samePath(current,await fs.realpath(current))) throw invalidPath();
    }
    // If a student selects a directory containing Graphite's app data, the project's
    // own grant file must not become an editable way of selecting a different root.
    if (samePath(current,stateFile)) throw invalidPath();
    return { root, file:current, path:parts.join('/') };
  }
  const resolveFile = input => resolveEntry(input, 'file');
  async function list(input) {
    const at=await resolveEntry({...input,path:input?.path ?? ''}, 'directory');
    const entries=[];
    for (const e of await fs.readdir(at.file, {withFileTypes:true})) {
      if (!e.isDirectory() && !e.isFile()) continue;
      const rel=at.path ? at.path+'/'+e.name : e.name;
      if (samePath(path.join(at.file,e.name),stateFile) || /^\..+\.graphite-lock$/.test(e.name)) continue;
      entries.push({name:e.name,path:rel,type:e.isDirectory()?'directory':'file'});
    }
    await resolveEntry({...input,path:at.path}, 'directory');
    entries.sort((a,b) => Number(a.type!=='directory')-Number(b.type!=='directory') || a.name.localeCompare(b.name, undefined, {numeric:true}));
    return {entries};
  }
  async function read(input) {
    const target=await resolveFile(input), result=await readSource(target.file);
    await resolveFile(input);
    if (result.editable && !(result.mode & 0o222)) return {...result,path:target.path,editable:false,reason:'readonly'};
    return {...result,path:target.path};
  }
  async function publishNew(input, target, bytes) {
    const temp=path.join(path.dirname(target),'.graphite-create-'+randomUUID()+'.tmp');
    const handle=await fs.open(temp,'wx');
    try {
      try { await handle.writeFile(bytes); } finally { await handle.close(); }
      await resolveEntry(input,'file',true);
      try {
        // Publish complete contents without replacing an entry created since the preview.
        await fs.link(temp,target);
      } catch (err) {
        if (!['EPERM','ENOSYS','ENOTSUP','EOPNOTSUPP'].includes(err.code)) throw err;
        // Some removable drives do not implement hard links. copyFile also supports exclusive creation.
        await fs.copyFile(temp,target,fs.constants.COPYFILE_EXCL);
      }
    } catch (err) {
      if(err.code==='EEXIST') throw error(409,'exists','A file or folder already exists at this path.');
      throw err;
    } finally { await fs.unlink(temp).catch(()=>{}); }
  }
  async function writeFile(input, creating) {
    if (!input || typeof input.content!=='string' || input.content.includes('\0') || !input.content.isWellFormed()) {
      throw error(400,'invalid_text','Expected ordinary UTF-8 text.');
    }
    if (Buffer.byteLength(input.content)>LIMIT) throw error(413,'size','This file exceeds the source editor size limit.');
    if (!creating && !/^[a-f\d]{64}$/.test(input.revision || '')) throw error(428,'revision_required','Reopen the file before saving.');
    const target=await resolveEntry(input, 'file', creating);
    // Use the same cross-process lock as the vault editor when the project overlaps the vault.
    return withFileLock(target.file, async () => {
      await resolveEntry(input, 'file', creating);
      const current=creating ? null : await readSource(target.file);
      if (current && !current.editable) throw changed();
      const eol=creating ? (input.eol ?? 'LF') : current.eol, bom=creating ? (input.bom ?? false) : current.bom;
      if (!['LF','CRLF','CR'].includes(eol) || typeof bom!=='boolean') throw error(400,'invalid_format','Invalid source file format.');
      const content=input.content.replace(/\r\n|\r|\n/g, {LF:'\n',CRLF:'\r\n',CR:'\r'}[eol]);
      const bytes=Buffer.from((bom?'\uFEFF':'')+content);
      if (bytes.length>LIMIT) throw error(413,'size','This file exceeds the source editor size limit.');
      const revision=createHash('sha256').update(bytes).digest('hex');
      if (creating) {
        await publishNew(input,target.file,bytes);
      } else if (revision !== current.revision) {
        if (input.revision!==current.revision) throw changed();
        if (!(current.mode & 0o222)) throw error(403,'readonly','The file is read-only.');
        await atomicWrite(target.file, bytes, {mode:current.mode,beforeReplace:async()=>{
          await resolveFile(input);
          if((await readSource(target.file)).revision!==input.revision)throw changed();
        }});
      }
      await resolveFile(input);
      return {path:target.path,revision,eol,bom,mtime:(await fs.stat(target.file)).mtimeMs};
    });
  }
  async function mkdir(input) {
    const target=await resolveEntry(input,'directory',true);
    try { await fs.mkdir(target.file); }
    catch (err) { if(err.code==='EEXIST')throw error(409,'exists','A file or folder already exists at this path.'); throw err; }
    await resolveEntry(input,'directory');return {path:target.path};
  }
  async function write(input) {
    try { return await withFileLock(stateFile,()=>writeFile(input,false)); }
    catch (err) { if (err.code==='not_found' || missing(err)) throw changed(); throw err; }
  }
  return {
    status, list, read, write, resolveRoot, resolveFile,
    async choose() { const p=await pickDirectory();return p ? {canceled:false,...await select(p)} : {canceled:true,...await status()}; },
    useVault:()=>select(getVault()),
    mkdir:input=>withFileLock(stateFile,()=>mkdir(input)),
    create:input=>withFileLock(stateFile,()=>writeFile({...input,content:input?.content??''},true)),
  };
}
module.exports={createCodeProjects};
