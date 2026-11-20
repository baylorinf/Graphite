'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');

const skipScan = /^(?:\.git|\.vscode|node_modules|videos?|practice|artifacts|build|dist|out|bin|obj|__pycache__|\.venv|venv|env|\.idea|\.obsidian|\.trash)$/i;
const key = p => String(p).replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase();
const fail = (code,message) => Object.assign(new Error(message),{code});
const nativePath = p => process.platform === 'win32' ? p.replace(/^\\\\\?\\UNC\\/i,'\\\\').replace(/^\\\\\?\\(?=[A-Za-z]:\\)/,'') : p;
function scopeProblem(dir, skip, vault) {
  if (!dir || !path.isAbsolute(dir) || /^\\\\[.?]\\/.test(dir) || key(dir) === key(path.parse(dir).root)) return 'volume_root';
  const excluded = new Set(skip.map(s => String(s).toLowerCase()));
  const parts = dir.slice(path.parse(dir).root.length).split(/[\\/]/);
  if (parts.some(part => skipScan.test(part) || excluded.has(part.toLowerCase()))) return 'excluded';
  if (vault && (key(dir) === key(vault) || key(dir).startsWith(key(vault)+'/'))) return 'vault';
  return null;
}
const reasons = {
  volume_root:'请选择一门课程或课程资料所在的具体文件夹。',
  excluded:'该目录位于课程扫描排除范围内。',
  vault:'此目录已在笔记库内。请选择库外的课程来源。',
  unreadable:'Graphite 无法读取这个目录。请检查目录是否存在及当前用户的读取权限。',
};
async function probe(dir, skip, vault, io) {
  const native = nativePath(String(dir));
  const direct = scopeProblem(native,skip,vault);
  if(direct) return {graphiteAllowed:false,processReadable:null,reason:direct};
  try {
    const real = nativePath(await io.realpath(native));
    const reason = scopeProblem(real,skip,vault);
    if(reason) return {graphiteAllowed:false,processReadable:null,reason};
    const handle = await io.opendir(real);
    try {await handle.read();} finally {await handle.close();}
    return {real,graphiteAllowed:true,processReadable:true};
  } catch {return {graphiteAllowed:true,processReadable:false,reason:'unreadable'};}
}

function createAgentFolderGrants({profile,pickDirectory,getVault,io=fs}) {
  async function rows(state) {
    const owned=new Map(state.grants.map(g=>[key(g.path),g.id]));
    return Promise.all(state.roots.map(async dir => {
      const {real,...checks}=await probe(dir,state.skip,getVault(),io);
      const ownedId=owned.get(key(dir));
      const id=ownedId || 'settings-'+createHash('sha256').update(key(dir)).digest('hex');
      return {id,path:dir,...checks,agentAccess:'unverified',revocable:!!ownedId};
    }));
  }
  async function list() { return {folders:await rows(await profile.folderState())}; }
  async function choose(args={}) {
    if(Object.keys(args).length)throw fail('invalid_action','目录必须通过系统选择器选取。');
    const selected=await pickDirectory();
    if(!selected)return {...await list(),canceled:true};
    const vault=getVault();
    let added=false, selectedPath;
    const state=await profile.changeFolders(async current => {
      const check=await probe(selected,current.skip,vault,io);
      if(!check.processReadable)throw fail(check.reason,reasons[check.reason]);
      const real=check.real;
      for(const root of current.roots) {
        if (key(root)===key(real)) {selectedPath=root;return false;}
        const existing=await io.realpath(root).catch(()=>null);
        if(existing && key(existing)===key(real)){selectedPath=root;return false;}
      }
      selectedPath=real.replace(/\\/g,'/');
      current.roots.push(selectedPath);
      current.grants.push({id:randomUUID(),path:selectedPath});
      added=true;
      return true;
    });
    const folders=await rows(state);
    return {folders,added,selectedId:folders.find(f=>key(f.path)===key(selectedPath)).id};
  }
  async function revoke({id}={}) {
    if(typeof id!=='string' || !id || id.length>100)throw fail('invalid_grant','请选择要撤销的目录。');
    const state=await profile.changeFolders(current => {
      const grant=current.grants.find(g=>g.id===id);
      if(!grant)throw fail('not_revocable','这个授权已撤销，或该来源由学习设置管理。');
      current.grants=current.grants.filter(g=>g.id!==id);
      current.roots=current.roots.filter(p=>key(p)!==key(grant.path));
      return true;
    });
    return {folders:await rows(state),removedId:id};
  }
  return {list,choose,revoke};
}
module.exports={createAgentFolderGrants};
