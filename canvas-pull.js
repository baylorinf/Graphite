'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { safeName, courseFolder, verifiedSubdirectory, publish, storeDir, defaultFolder } = require('./canvas-api');
const fsp = fs.promises;

async function fingerprint(base, relative) {
  if (typeof relative !== 'string' || !relative || relative.startsWith('/') || relative.split('/').includes('..')) return null;
  const file = path.resolve(base,relative);
  try {
    const remainder=path.relative(base,file);
    if (!remainder || remainder === '..' || remainder.startsWith('..'+path.sep) || path.isAbsolute(remainder) ||
        (await fsp.realpath(file)) !== file || !(await fsp.lstat(file)).isFile()) return null;
    const h = createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) h.update(chunk);
    return h.digest('hex');
  } catch (e) { if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return null; throw e; }
}

const escapeText = s => String(s || '').replace(/([\\`*_{}\[\]<>#!|~])/g,'\\$1');
const href = s => s.split('/').map(part=>encodeURIComponent(part).replace(/[()]/g,c=>'%'+c.charCodeAt(0).toString(16))).join('/');
function sourceLink(url) {
  try {
    const u = new URL(url);
    if (u.origin === 'https://oc.sjtu.edu.cn' && !u.username && !u.password) return u.origin + u.pathname.replace(/[()]/g,c=>'%'+c.charCodeAt(0).toString(16));
  } catch {}
  return null;
}

function deadline({dueAt, dueLabel}) {
  if (typeof dueAt === 'string' && /^\d{4}-\d\d-\d\d$/.test(dueAt)) return dueAt;
  if (typeof dueAt === 'string' && /(?:Z|[+-]\d\d:\d\d)$/i.test(dueAt)) {
    const date = new Date(dueAt);
    if (Number.isFinite(+date)) return new Intl.DateTimeFormat('sv-SE', {
      year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', timeZoneName:'shortOffset',
    }).format(date);
  }
  return cleanLabel(dueLabel);
}
// The school page's label can repeat its own heading and the date ("截止时间 12月13日 23:59 12月13日 23:59").
function cleanLabel(label) {
  let s = String(label || '').replace(/\s+/g, ' ').trim().replace(/^(?:截止时间|截止日期|截止|Due(?: date)?)\s*[:：]?\s*/i, '');
  const words = s.split(' ');
  if (words.length % 2 === 0 && words.length) {
    const half = words.length / 2;
    if (words.slice(0, half).join(' ') === words.slice(half).join(' ')) s = words.slice(0, half).join(' ');
  }
  return s;
}

async function saveNote(base, folder, name, item, text, locals, due, previous, writer) {
  // A record of the school's page, not a knowledge note: kept off the graph and out of "related notes".
  const lines = ['---', 'graph: hide', '---', '# ' + escapeText(item.title), ''];
  if (due) lines.push('截止时间：' + escapeText(due), '');
  if (text) lines.push(escapeText(text), '');
  const attachments = item.attachments || [];
  if (attachments.length) {
    lines.push('## 附件', '');
    for (const f of attachments) {
      const local = locals.get(String(f.id));
      const dest = local ? href(path.relative(folder,path.join(base,local)).split(path.sep).join('/')) : sourceLink(f.url);
      lines.push(dest ? '- ['+escapeText(f.name)+']('+dest+')' : '- '+escapeText(f.name));
    }
    lines.push('');
  }
  const source = sourceLink(item.url);
  if (source) lines.push('[在 Canvas 查看]('+source+')', '');
  const bytes = Buffer.from(lines.join('\n')), digest=createHash('sha256').update(bytes).digest('hex');
  // Keep references to earlier generated notes stable. An app-edited note is
  // protected by the same lock and last-byte check as the normal vault editor.
  if (previous?.path && path.dirname(path.resolve(base,previous.path)) === folder && path.extname(previous.path)==='.md') {
    const target=path.join(base,previous.path);
    if (await fingerprint(base,previous.path) === digest) return {...previous,digest,unchanged:true};
    if (previous.owned && writer) {
      const conflict=new Error('笔记已在本地修改。');
      try {
        return await writer.withFileLock(target,async()=>{
          const guard=async()=>{if(await fingerprint(base,previous.path)!==previous.digest) throw conflict;};
          await guard();
          await writer.atomicWrite(target,bytes,{beforeReplace:guard});
          return {...previous,digest,unchanged:false};
        });
      } catch(e) {if(e!==conflict)throw e;}
    }
  }
  const tmp = path.join(folder,'.canvas-part-' + randomUUID());
  try {
    await fsp.writeFile(tmp, bytes, {flag:'wx',mode:0o600});
    const saved = await publish(tmp,folder,name,digest,bytes.length);
    return { path:path.relative(base,saved.target).split(path.sep).join('/'), owned:!saved.unchanged,digest,unchanged:saved.unchanged };
  } finally { await fsp.unlink(tmp).catch(()=>{}); }
}

// Files as downloaded go to the hidden store (.obsidian/graphite/canvas/<Course (id)>/); `place` files them into
// the course folder the student sees and says where each one is, so the notes link to those copies. Notes (course
// requirements, assignments) go to the course folder from `noteDir` (assignments in "作业 Homework").
async function pullMaterials({ vault, courses, download, previous={}, previousNotes={}, noteWriter, warnings=[], usingSnapshot=false, onProgress,
    noteDir = null, place = null }) {
  const base = await fsp.realpath(vault);
  const root = await storeDir(base), cache = {...previous}, noteCache={...previousNotes};
  const result = { courses:courses.length, path:'', saved:0, unchanged:0, skipped:0, failed:[],
    notes:{saved:0,unchanged:0}, files:{saved:0,unchanged:0}, warnings:[...warnings] };
  let done = 0, unauthorized = false;
  const plan = courses.map(course => {
    const requirements = course.requirements;
    const notes = [];
    if (requirements && (requirements.text || requirements.attachments?.length)) {
      notes.push({ item:{...requirements,title:course.name+' · 课程要求'}, text:requirements.text, name:'课程要求.md' });
    }
    for (const a of course.assignments || []) {
      if (!/^\d+$/.test(String(a.id))) continue;
      notes.push({ item:a, text:a.description, assignment:true, name:safeName(a.title,'作业')+' ('+a.id+').md' });
    }
    const files = [...new Map((course.files || []).map(f=>[String(f.id),f])).values()];
    return {course,notes,files};
  });
  const total = plan.reduce((n,c)=>n+c.files.length+c.notes.length,0);
  onProgress({ done,total,name:'' });
  const count = (kind,unchanged) => { const label=unchanged?'unchanged':'saved'; result[label]++; result[kind][label]++; };
  for (const {course,notes,files} of plan) {
    const cid = String(course.id);
    let folder, notesHere;
    try {
      folder = await verifiedSubdirectory(root,courseFolder(course));
      notesHere = noteDir ? await noteDir(course) : await verifiedSubdirectory(base,defaultFolder(course));
      const shown = path.relative(base,notesHere).split(path.sep).join('/');
      result.path = result.path ? result.path + '、' + shown : shown;
    }
    catch (e) {
      result.failed.push({courseId:cid,id:cid,name:course.name,error:e.message});
      result.skipped+=files.length+notes.length;
      done+=files.length+notes.length;
      continue;
    }
    const locals = new Map();
    let usedLocal = 0;
    for (const file of files) {
      const id=String(file.id), key=cid+'/'+id;
      const revision = file.updatedAt ? JSON.stringify([file.updatedAt,file.size,file.name]) : null;
      onProgress({ done,total,name:course.name+' · '+file.name });
      let localPath;
      try {
        const old = cache[key];
        const candidate = old?.path;
        const knownDigest = candidate && path.dirname(path.resolve(base,candidate)) === folder ? await fingerprint(base,candidate) : null;
        if (knownDigest) {
          localPath = candidate;
          if (!old) cache[key] = {path:candidate, revision:null, digest:knownDigest};
        }
        if (revision && old?.revision === revision && knownDigest && knownDigest === old.digest) {
          locals.set(id,old.path);
          count('files',true);
        } else if ((usingSnapshot || unauthorized) && localPath) {
          locals.set(id,localPath);
          count('files',true);
          usedLocal++;
        } else if (unauthorized) {
          result.skipped++;
        } else {
          const saved = await download(cid,id);
          if (!saved?.path) throw new Error('未收到文件保存位置。');
          cache[key] = { path:saved.path, revision, digest:await fingerprint(base,saved.path) };
          locals.set(id,saved.path);
          count('files',saved.unchanged);
        }
      } catch (e) {
        if (e.status === 401) unauthorized = true;
        if (localPath) {
          locals.set(id,localPath);
          count('files',true);
          usedLocal++;
        } else result.failed.push({ courseId:cid,id,name:file.name,error:e.message });
      }
      done++;
    }
    if (usedLocal) result.warnings.push(course.name+' · '+usedLocal+' 份附件已保留本地副本，暂时无法确认校方最新版。');
    // Into the course folder: links in the notes point to the copies there.
    if (place && locals.size) {
      try { const shown = await place(course, cache, [...locals.keys()]); for (const [id, p] of shown) if (p) locals.set(id, p); }
      catch (e) { result.warnings.push(course.name+' · '+e.message); }
    }
    for (const n of notes) {
      onProgress({done,total,name:course.name+' · '+n.name});
      try {
        const dir = n.assignment ? await verifiedSubdirectory(notesHere,'作业 Homework') : notesHere;
        const key=cid+'/'+(n.assignment?n.item.id:'syllabus');
        const saved = await saveNote(base,dir,n.name,n.item,n.text,locals,deadline(n.item),noteCache[key],noteWriter);
        noteCache[key]={path:saved.path,digest:saved.digest,owned:saved.owned};
        count('notes',saved.unchanged);
      } catch (e) { result.failed.push({courseId:cid,id:String(n.item.id||'syllabus'),name:n.name,error:e.message}); }
      done++;
    }
  }
  onProgress({done,total,name:''});
  return {result,cache,noteCache};
}

module.exports = { pullMaterials };
