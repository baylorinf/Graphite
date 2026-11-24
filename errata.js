'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const {createFile} = require('./new-file');
const {verifiedSubdirectory} = require('./canvas-api');
const {results,csvNumber,numberAt,locate,skeleton,fail} = require('./errata-math');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const conflict = message => { throw Object.assign(new Error(message),{status:409}); };
const versionId = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file,'utf8')); }
  catch (e) { if (e.code==='ENOENT') return null; throw e; }
}
function visiblePath(rel,ext) {
  if(typeof rel!=='string' || rel.includes('\\') || rel.split('/').some(s=>!s || s.startsWith('.') ||
      /[:\x00-\x1f]/u.test(s) || s.toLowerCase()==='node_modules') || path.posix.extname(rel).toLowerCase()!==ext) {
    fail('请选择笔记库内的 '+ext+' 文件。');
  }
  return rel;
}
async function visibleFile(root,rel,ext) {
  visiblePath(rel,ext);
  const file=path.join(root,...rel.split('/'));
  try {
    const actual=await fs.realpath(file);
    if(path.relative(file,actual)!=='' || !(await fs.lstat(file)).isFile()) fail('请选择笔记库中的普通文件。');
    return actual;
  } catch(e) { if(e.code==='ENOENT') fail('文件不存在：'+rel); throw e; }
}
async function readVisible(root,rel,ext) {
  return fs.readFile(await visibleFile(root,rel,ext));
}
async function extract(bytes) {
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const {paragraphs} = await import('./public/pdf-paragraphs.mjs');
  const base = path.dirname(require.resolve('pdfjs-dist/package.json')).split(path.sep).join('/');
  const task = getDocument({data:Uint8Array.from(bytes),useSystemFonts:false,isEvalSupported:false,
    cMapPacked:true,cMapUrl:base+'/cmaps/',standardFontDataUrl:base+'/standard_fonts/'});
  try {
    const pdf=await task.promise;
    const out=[];
    for(let n=1;n<=pdf.numPages;n++) {
      const page=await pdf.getPage(n);
      for(const {id,text,fp} of paragraphs(await page.getTextContent(),n)) out.push({id,text,fp});
      page.cleanup();
    }
    return {pages:pdf.numPages,paragraphs:out};
  } catch(e) { fail('无法读取 PDF 文字：'+e.message); }
  finally { await task.destroy(); }
}
function createErrata({vault,atomicWrite,withFileLock}) {
  async function dirs() {
    const root=await fs.realpath(vault());
    let dir=root;
    for(const part of ['.obsidian','graphite','errata']) dir=await verifiedSubdirectory(dir,part);
    const versions=await verifiedSubdirectory(dir,'versions');
    return {root,dir,versions,state:path.join(dir,'state.json')};
  }
  async function stateOf(d, locked=false) {
    const state=(await readJson(d.state)) || {revision:0,tracks:[],receipts:{}};
    if(!state.pending) return state;
    if(!locked) return withFileLock(d.state,()=>stateOf(d,true));
    const {token,stage,next}=state.pending;
    if(!versionId(token) || !/^\.draft-[a-z0-9]{6}$/i.test(stage) || !next?.receipts?.[token]) {
      conflict('勘误草稿的恢复记录无效，请检查笔记库。');
    }
    const home=await verifiedSubdirectory(d.root,'勘误草稿');
    const final=path.join(home,token.slice(0,20)), temp=path.join(home,stage);
    const already=await fs.lstat(final).catch(e=>{if(e.code!=='ENOENT') throw e;});
    if(!already) {
      const staged=await fs.lstat(temp).catch(e=>{if(e.code!=='ENOENT') throw e;});
      if(!staged?.isDirectory() || (await fs.readFile(path.join(temp,'.receipt'),'utf8'))!==token) {
        delete state.pending;
        await atomicWrite(d.state,JSON.stringify(state));
        conflict('暂存草稿已移动，请重新预览。');
      }
      await fs.rename(temp,final);
    } else if(!already.isDirectory() || await fs.readFile(path.join(final,'.receipt'),'utf8').catch(()=>null)!==token) {
      delete state.pending;
      await atomicWrite(d.state,JSON.stringify(state));
      conflict('草稿目标位置已有其他文件，请保留原文件并更换位置。');
    }
    await atomicWrite(d.state,JSON.stringify(next));
    return next;
  }
  const publicState = state=>({revision:state.revision,tracks:state.tracks});
  async function changedDocuments(d,state) {
    const groups=new Map(), versions=new Map(), documents=[];
    for(const t of state.tracks) {
      const current=t.currentPath || t.pdf;
      const key=JSON.stringify([t.pdf,current]);
      if(!groups.has(key)) groups.set(key,{pdf:t.pdf,path:current,baseline:new Set()});
      groups.get(key).baseline.add(t.version);
    }
    for(const {pdf,path:rel,baseline} of groups.values()) {
      if(!versions.has(rel)) {
        try {
          const file=await visibleFile(d.root,rel,'.pdf');
          const hash=createHash('sha256');
          for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
          versions.set(rel,hash.digest('hex'));
        } catch(e) {
          if(e.code!=='ENOENT' && e.status!==422) throw e;
          versions.set(rel,null);
        }
      }
      const version=versions.get(rel);
      if(version && baseline.size===1 && baseline.has(version)) continue;
      documents.push({pdf,path:rel,version,status:version?'updated':'missing'});
    }
    return {documents};
  }
  async function document(d, rel) {
    const bytes=await readVisible(d.root,rel,'.pdf'), version=digest(bytes);
    const cache=path.join(d.versions,version+'.json');
    return withFileLock(cache,async()=>{
      const saved=await readJson(cache);
      if(saved) return saved;
      const indexed={version,...await extract(bytes)};
      const file=path.join(d.versions,version+'.pdf');
      try { await createFile(file,bytes); } catch(e) { if(e.code!=='EEXIST') throw e; }
      await atomicWrite(cache,JSON.stringify(indexed));
      return indexed;
    });
  }
  async function archived(d,version) {
    if(!versionId(version)) fail('文档版本无效。');
    const index=await readJson(path.join(d.versions,version+'.json'));
    if(!index) fail('找不到原文快照，请重新选择讲义。');
    return index;
  }
  async function calculation(d,spec,text) {
    if(spec==null) return null;
    if(!Number.isSafeInteger(spec.numberIndex) || spec.numberIndex<0 || typeof spec.unit!=='string' ||
       !Array.isArray(spec.inputs) || !Array.isArray(spec.steps) || !spec.steps.length) fail('请指定数字、单位、输入及计算步骤。');
    const inputs=[];
    for(const i of spec.inputs) {
      if (!i || typeof i!=='object') fail('输入配置无效。');
      if(i.csv!==undefined) {
        const bytes=await readVisible(d.root,i.csv,'.csv');
        inputs.push({name:i.name,csv:i.csv,column:i.column,row:i.row,sha256:digest(bytes),value:csvNumber(bytes.toString('utf8'),i.column,i.row)});
      } else inputs.push({name:i.name,value:i.value});
    }
    const opts={parameter:spec.parameter,numberIndex:spec.numberIndex,unit:spec.unit,inputs,
      steps:spec.steps.map(s=>({name:s?.name,formula:s?.formula,unit:String(s?.unit||'')}))};
    results(opts,text);
    return opts;
  }
  async function plan(d,state,b) {
    visiblePath(b.pdf,'.pdf');
    const selected=state.tracks.filter(t=>t.pdf===b.pdf);
    if(!selected.length) fail('这份讲义还没有追踪引用。');
    const doc=await document(d,b.path);
    const choices=b.choices || {}, reports=new Map(), originals=new Map(), items=[];
    for(const t of selected) {
      if(!originals.has(t.version)) originals.set(t.version,await archived(d,t.version));
      const before=originals.get(t.version);
      const same=t.version===doc.version;
      const match=locate(before.paragraphs,doc.paragraphs,t.source,same?t.source:choices[t.id]);
      const item={id:t.id,report:t.report,oldVersion:t.version,calculation:t.calculation,...match,affected:match.status==='changed'};
      if(item.status==='changed') {
        if(!t.calculation) item.reason='引用原文已变，请复核报告。';
        else if(t.needsRebind) item.reason='此参数需要重新绑定后才能试算。';
        else if(skeleton(item.old.text)!==skeleton(item.new.text)) item.reason='段落措辞或单位有变，请人工核对计算条件。';
        else {
          try {
            const from=results(t.calculation,item.old.text), to=results(t.calculation,item.new.text);
            for(const i of t.calculation.inputs.filter(i=>i.csv)) {
              const bytes=await readVisible(d.root,i.csv,'.csv');
              if(digest(bytes)!==i.sha256) fail('原始测量表已改变，请复核输入后再计算。');
            }
            const c=t.calculation;
            item.affected=numberAt(item.old.text,c.numberIndex,c.unit)!==numberAt(item.new.text,c.numberIndex,c.unit);
            if(item.affected) item.results=from.map((v,k)=>({name:v.name,unit:v.unit,from:v.value,to:to[k].value}));
          } catch(e) { if(e.status!==422) throw e; item.reason=e.message; }
        }
        if(item.affected && !reports.has(t.report)) {
          try { reports.set(t.report,await readVisible(d.root,t.report,'.md')); }
          catch(e) {
            if(e.status!==422) throw e;
            item.reportMissing=true;
            item.reason='关联的报告已移动或无法读取，请重新关联。';
          }
        }
      }
      items.push(item);
    }
    const hashes=[...reports].map(([name,bytes])=>[name,digest(bytes)]);
    const token=digest(JSON.stringify([state.revision,b.pdf,b.path,doc.version,items,hashes]));
    return {preview:{pdf:b.pdf,path:b.path,version:doc.version,revision:state.revision,token,
      canApply:items.every(i=>i.new && !i.reportMissing),items},reports};
  }
  async function stageDrafts(d,plan) {
    const {preview,reports}=plan;
    if(!reports.size) return {drafts:[]};
    const home=await verifiedSubdirectory(d.root,'勘误草稿');
    const name=preview.token.slice(0,20);
    const temp=await fs.mkdtemp(path.join(home,'.draft-'));
    const drafts=[];
    try {
      // Keep exact, independent evidence copies so a draft's normal Graphite PDF links
      // still resolve after the working PDF is overwritten, moved or deleted.
      const evidenceDir='_pdf';
      const versions=new Set([preview.version,...preview.items.filter(i=>i.affected).map(i=>i.oldVersion)]);
      await fs.mkdir(path.join(temp,evidenceDir));
      for(const version of versions) await fs.copyFile(path.join(d.versions,version+'.pdf'),path.join(temp,evidenceDir,version+'.pdf'));
      function citation(version,para,label) {
        const page=para.id.match(/^P(\d+)S/)[1];
        return '[['+['勘误草稿',name,evidenceDir,version+'.pdf'].join('/')+'#page='+page+'&source='+para.id+'&fp='+para.fp+'|'+label+' '+para.id+']]';
      }
      for(const [rel,bytes] of reports) {
        const entries=preview.items.filter(i=>i.report===rel && i.affected);
        const section=['','## 讲义勘误复核','', '来源讲义：'+preview.path];
        for(const x of entries) {
          section.push('', citation(x.oldVersion,x.old,'旧版原文'),'',...x.old.text.split('\n').map(s=>'    '+s),
            '', citation(preview.version,x.new,'新版原文'),'',...x.new.text.split('\n').map(s=>'    '+s));
          if(x.reason) section.push('',x.reason);
          if(x.results.length) {
            for(const i of x.calculation.inputs) section.push('','    '+i.name+' = '+i.value+
              (i.csv?' ('+i.csv+' · '+i.column+' · 数据行 '+i.row+' · SHA-256 '+i.sha256+')':''));
            for(const [k,r] of x.results.entries()) section.push('','    '+r.name+' = '+x.calculation.steps[k].formula+
              '    '+r.from+' → '+r.to+' '+r.unit);
          }
        }
        const target=path.join(temp,rel);
        await fs.mkdir(path.dirname(target),{recursive:true});
        await fs.writeFile(target,Buffer.concat([bytes,Buffer.from('\n'+section.join('\n')+'\n')]),{flag:'wx'});
        drafts.push(['勘误草稿',name,rel].join('/'));
      }
      await fs.writeFile(path.join(temp,'.receipt'),preview.token,{flag:'wx'});
      return {drafts,temp};
    } catch(e) { await fs.rm(temp,{recursive:true,force:true}); throw e; }
  }
  async function handle(action,b={}) {
    const d=await dirs();
    if(action==='state') return publicState(await stateOf(d));
    if(action==='changes') return changedDocuments(d,await stateOf(d));
    if(action==='document') return document(d,b.path);
    if(action==='pdf') return fs.readFile(await archivedFile(d,b.version));
    if(action==='preview') return (await plan(d,await stateOf(d),b)).preview;
    return withFileLock(d.state,async()=>{
      const state=await stateOf(d,true);
      if(action==='track') {
        visiblePath(b.pdf,'.pdf');
        if(b.path && b.path!==b.pdf && !state.tracks.some(t=>t.pdf===b.pdf && t.version===b.version)) conflict('该版本尚未关联到原讲义。');
        const doc=await document(d,b.path || b.pdf);
        if(doc.version!==b.version) conflict('原讲义在选择引用后已更新，请重新打开。');
        const p=doc.paragraphs.find(p=>p.id===b.source);
        if(!p) fail('请选择有文字的具体段落。');
        if(b.fp && p.fp!==b.fp) conflict('旧引用的原文与当前段落不同，请重新选择。');
        await readVisible(d.root,b.report,'.md');
        const calc=await calculation(d,b.calculation,p.text);
        const same=state.tracks.find(t=>t.pdf===b.pdf && t.version===b.version && t.source===p.id &&
          t.report===b.report && JSON.stringify(t.calculation)===JSON.stringify(calc));
        if(same && !same.needsRebind) return publicState(state);
        if(same) delete same.needsRebind;
        else state.tracks.push({id:randomUUID(),pdf:b.pdf,currentPath:b.path || b.pdf,version:b.version,source:p.id,text:p.text,fp:p.fp,report:b.report,calculation:calc});
      } else if(action==='remove') {
        if(b.revision!==state.revision) conflict('追踪清单已变更，请刷新。');
        state.tracks=state.tracks.filter(t=>t.id!==b.id);
      } else if(action==='apply') {
        if(!versionId(b.token)) fail('请先查看这次变更。');
        const prior=state.receipts[b.token];
        if(prior && prior.pdf===b.pdf && prior.path===b.path) return {revision:state.revision,drafts:prior.drafts};
        const next=await plan(d,state,b), p=next.preview;
        if(p.token!==b.token) conflict('文件或追踪设置已有变更，请重新试算。');
        if(!p.canApply) conflict('请先确认未匹配的段落或重新关联缺失的报告。');
        if(state.tracks.filter(t=>t.pdf===b.pdf).every(t=>t.version===p.version && (t.currentPath || t.pdf)===b.path)) return {revision:state.revision,drafts:[]};
        const previous=structuredClone(state);
        const {drafts,temp}=await stageDrafts(d,next);
        const updates=new Map(p.items.map(i=>[i.id,i]));
        for(const t of state.tracks) if(updates.has(t.id)) {
          const item=updates.get(t.id), v=item.new;
          if(t.calculation && item.reason) t.needsRebind=true;
          Object.assign(t,{source:v.id,text:v.text,fp:v.fp,version:p.version,currentPath:b.path});
        }
        state.receipts[b.token]={pdf:b.pdf,path:b.path,drafts};
        state.revision++;
        if(temp) {
          previous.pending={token:b.token,stage:path.basename(temp),next:state};
          try { await atomicWrite(d.state,JSON.stringify(previous)); }
          catch(e) { await fs.rm(temp,{recursive:true,force:true}); throw e; }
          await stateOf(d,true);
        } else await atomicWrite(d.state,JSON.stringify(state));
        return {revision:state.revision,drafts};
      } else fail('未知的勘误操作。');
      state.revision++;
      await atomicWrite(d.state,JSON.stringify(state));
      return publicState(state);
    });
  }
  async function archivedFile(d,version) {
    if(!versionId(version)) fail('文档版本无效。');
    const target=path.join(d.versions,version+'.pdf');
    const stat=await fs.lstat(target).catch(e=>{if(e.code!=='ENOENT') throw e;});
    if(!stat?.isFile()) fail('未找到原文的存档版本。');
    return target;
  }
  return {handle, archivedFile:async version=>archivedFile(await dirs(),version)};
}
module.exports={createErrata};
