import { t } from '/i18n.js';
import formats from '/source-formats.json' with { type: 'json' };

export function sourceFormat(path) {
  const ext=(/\.([^./]+)$/.exec(path || '')?.[1] || '').toLowerCase();
  return Object.hasOwn(formats,ext) ? formats[ext] : null;
}
const vendor = '/vendor/codemirror-5.65.20/';
const assets = new Map();
function script(file) {
  if (!assets.has(file)) assets.set(file, new Promise((resolve, reject) => {
    const el = document.createElement('script');
    el.src = vendor + file; el.onload = resolve;
    el.onerror = () => { el.remove(); assets.delete(file); reject(new Error(t('code.editorFailed'))); };
    document.head.append(el);
  }));
  return assets.get(file);
}
async function editorFor(format) {
  await script('lib/codemirror.js');
  if (format.module === 'rust') await script('addon/mode/simple.js');
  if (format.module === 'jsx') await Promise.all(['xml','javascript'].map(m => script('mode/' + m + '/' + m + '.js')));
  await Promise.all([script('mode/' + format.module + '/' + format.module + '.js'), script('addon/search/searchcursor.js')]);
  return window.CodeMirror;
}

function attachFind(body, cm) {
  const button=body.querySelector('#code-find');
  const bar=document.createElement('div');
  bar.className='code-search'; bar.hidden=true;
  bar.innerHTML='<input id="code-find-text" type="search" spellcheck="false"><button id="code-find-prev" type="button"></button><button id="code-find-next" type="button"></button><button id="code-find-close" type="button"></button><span id="code-find-result" role="status"></span>';
  body.querySelector('#code-editor').before(bar);
  const input=bar.querySelector('input'), result=bar.querySelector('[role=status]');
  const prev=bar.querySelector('#code-find-prev'), next=bar.querySelector('#code-find-next'), exit=bar.querySelector('#code-find-close');
  button.hidden=false; button.textContent=t('code.find');
  input.placeholder=t('code.find'); input.setAttribute('aria-label',t('code.find'));
  prev.textContent=t('code.findPrev'); next.textContent=t('code.findNext'); exit.textContent=t('review.close');
  let origin=null;
  function search(reverse=false, fresh=false) {
    if (bar.hidden) { show(); return; }
    const query=input.value;
    if (!query) { result.textContent=''; return; }
    const start=fresh?origin:cm.getCursor(reverse?'from':'to');
    let cursor=cm.getSearchCursor(query,start,{caseFold:true});
    let found=cursor.find(reverse);
    if (!found) {
      const line=cm.lastLine(), edge=reverse?{line,ch:cm.getLine(line).length}:{line:cm.firstLine(),ch:0};
      cursor=cm.getSearchCursor(query,edge,{caseFold:true});
      found=cursor.find(reverse);
    }
    if (!found) { result.textContent=t('code.noMatch'); return; }
    cm.setSelection(cursor.from(),cursor.to());
    cm.scrollIntoView({from:cursor.from(),to:cursor.to()},35);
    result.textContent=t('code.lineN',{n:cursor.from().line+1});
  }
  function show() {
    origin=cm.getCursor('from');
    const selected=cm.getSelection();
    if (selected && !selected.includes('\n')) input.value=selected;
    bar.hidden=false; input.focus(); input.select();
    search(false,true);
  }
  function hide() { bar.hidden=true; cm.focus(); }
  button.onclick=show; exit.onclick=hide;
  prev.onclick=()=>search(true); next.onclick=()=>search();
  input.oninput=()=>search(false,true);
  bar.onkeydown=e=>{
    if (e.key==='Escape') hide();
    else if (e.key==='Enter' || e.key==='F3') search(e.shiftKey);
    else if ((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='f') { input.focus(); input.select(); }
    else return;
    e.preventDefault(); e.stopPropagation();
  };
  cm.addKeyMap({'Ctrl-F':show,'Cmd-F':show,F3:()=>search(),'Shift-F3':()=>search(true),
    Esc:()=>{ if (!bar.hidden) hide(); else return window.CodeMirror.Pass; }});
}
async function source(method, path, text, revision, format) {
  const headers = { 'X-Vault': '1' };
  if (method !== 'GET') headers['Content-Type'] = 'text/plain; charset=utf-8';
  if (revision) headers['X-Base-Hash'] = revision;
  if (method === 'POST' && format) {
    headers['X-Source-EOL'] = format.eol;
    headers['X-Source-BOM'] = format.bom ? '1' : '0';
  }
  const r = await fetch('/api/source?path=' + encodeURIComponent(path), {method, headers, body:text});
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status:r.status });
  return data;
}
const prefix = vault => 'mo:source-draft:' + encodeURIComponent(vault) + ':';
const key = (vault, path) => prefix(vault) + path;

export function createCodeEditor({vault, askName, openCreated, savedFile, copyLine, toast}) {
  let active = null, draftTimer;
  const pending = new Map(), drafts = new Map(), unsynced = new Set();
  const positions = new Map();

  function draft(k) {
    if (!drafts.has(k)) {
      try { const d = JSON.parse(localStorage.getItem(k)); if (typeof d?.text === 'string' && typeof d.revision === 'string') drafts.set(k,d); } catch { /* invalid stored draft */ }
    }
    return drafts.get(k);
  }
  function writeDrafts() {
    clearTimeout(draftTimer);
    for (const k of [...unsynced]) {
      try {
        const d = drafts.get(k);
        if (d) localStorage.setItem(k,JSON.stringify(d)); else localStorage.removeItem(k);
        unsynced.delete(k);
      } catch { /* retain the in-memory copy; flush() also attempts a checked file save */ }
    }
  }
  function remember(k, d) {
    if (d) drafts.set(k,d); else drafts.delete(k);
    unsynced.add(k); clearTimeout(draftTimer);
    draftTimer = setTimeout(writeDrafts,150);
  }
  function hasDraft(path) {
    const k=key(vault(),path);
    return !!(unsynced.has(k) ? drafts.get(k) : draft(k));
  }
  function currentDraft(k) { return unsynced.has(k) ? drafts.get(k) : draft(k); }
  function close() {
    if (active?.cm) {
      positions.set(active.key,{cursor:active.cm.getCursor(),scroll:active.cm.getScrollInfo().top});
      active.cm.toTextArea();
    }
    active = null;
    writeDrafts();
  }
  function status() {
    const a = active;
    if (!a?.cm) return;
    const dirty = !!currentDraft(a.key);
    a.status.textContent = a.problem || t(pending.has(a.key) ? 'code.saving' : dirty ? 'code.unsaved' : 'code.saved');
    a.save.disabled = !dirty || a.conflict || pending.has(a.key);
    a.copy.hidden = !dirty;
    a.reload.hidden = !a.problem;
  }
  function showProblem(a, error) {
    if (a !== active) return;
    a.conflict = [404,409].includes(error.status);
    a.problem = a.conflict ? t('code.conflict') : t('code.error', { msg:error.message });
    status();
  }
  async function save(k = active?.key, path = active?.path) {
    if (!k || !path) return;
    if (pending.has(k)) {
      const success=await pending.get(k);
      if (success && currentDraft(k)) return save(k,path);
      return;
    }
    const d = currentDraft(k);
    if (!d || (active?.key === k && active.conflict)) return;
    const operation = (async () => {
      try {
        const result = await source('PUT',path,d.text,d.revision);
        const latest = currentDraft(k);
        if (latest?.revision === d.revision) remember(k, latest.text === d.text ? null : {...latest,revision:result.revision});
        if (active?.key === k) {
          active.revision = result.revision; active.disk = d.text; active.problem = ''; active.conflict = false;
          active.eol = result.eol; active.bom = result.bom;
          const now = active.cm?.getValue();
          if (now !== undefined && now !== d.text) remember(k,{text:now,revision:result.revision,eol:result.eol,bom:result.bom});
        }
        writeDrafts(); savedFile(path,result);
        return true;
      } catch (err) { if (active?.key === k) showProblem(active,err); return false; }
    })();
    pending.set(k,operation); status();
    try { await operation; } finally { pending.delete(k); status(); }
  }
  async function copy(a) {
    const dot=a.path.lastIndexOf('.'), slash=a.path.lastIndexOf('/');
    const name = await askName(a.path.slice(slash+1,dot)+' (copy)'+a.path.slice(dot));
    if (!name || a !== active) return;
    const target=a.path.slice(0,slash+1)+name;
    if (!sourceFormat(target) || target === a.path || /[\\/]/.test(name)) { toast(t('code.badName')); return; }
    const content=a.cm.getValue();
    try {
      const result=await source('POST',target,content,undefined,a);
      // A keystroke during a slow copy belongs to the original draft.
      if (currentDraft(a.key)?.text === content) { remember(a.key,null); writeDrafts(); }
      if (a === active && a.cm.getValue() === content) await openCreated(target,result);
      else { savedFile(target,result); toast(t('code.copySaved',{path:target})); }
    } catch (err) { toast(err.status===409 ? t('code.exists') : t('code.error',{msg:err.message})); }
  }
  function goTo(line) {
    if (!active) return;
    active.line = line;
    if (!active.cm || !line) return;
    const cursor = { line:Math.max(0,Math.min(line-1,active.cm.lastLine())), ch:0 };
    active.cm.setCursor(cursor); active.cm.scrollIntoView(cursor,60);
    active.cm.focus();
  }
  async function open(body,path,heading='',knownDisk) {
    close();
    const a=active={body,path,key:key(vault(),path),line:Number(/^L(\d+)$/i.exec(heading)?.[1])||0};
    const format=sourceFormat(path);
    body.innerHTML='<div class="code-toolbar"><b class="code-language"></b><span id="code-status" role="status"></span><button id="code-find" type="button" hidden></button><button id="code-link" type="button" hidden></button><button id="code-reload" type="button" hidden></button><button id="code-save-copy" type="button" hidden></button><button id="code-save" type="button" disabled></button></div><div id="code-editor"></div>';
    const find=s=>body.querySelector(s);
    a.status=find('#code-status'); a.save=find('#code-save'); a.copy=find('#code-save-copy'); a.reload=find('#code-reload');
    const link=find('#code-link'), host=find('#code-editor');
    find('.code-language').textContent=format.language; a.status.textContent=t('code.loading');
    a.save.textContent=t('code.save'); a.copy.textContent=t('code.copy'); a.reload.textContent=t('code.reload'); link.textContent=t('code.lineLink');
    try {
      await pending.get(a.key);
      if (active !== a) return;
      const snapshot = currentDraft(a.key);
      let disk;
      try { disk=knownDisk || await source('GET',path); }
      catch (error) { if (error.status!==404 || !snapshot) throw error; disk={editable:false,reason:'deleted'}; }
      if (active !== a) return;
      if (!disk.editable && !snapshot) {
        const msg=document.createElement('p'); msg.id='code-readonly'; msg.textContent=t('code.readonly.'+disk.reason);
        host.replaceChildren(msg); a.status.textContent=t('code.readonly'); a.save.hidden=true;
        if (disk.content) { const pre=document.createElement('pre'); pre.textContent=disk.content; host.append(pre); }
        return;
      }
      const CM=await editorFor(format);
      if (active !== a) return;
      a.disk=disk.editable?disk.content:null;
      a.revision=snapshot?.revision || disk.revision;
      a.eol=snapshot?.eol ?? disk.eol ?? 'LF';
      a.bom=snapshot?.bom ?? disk.bom ?? false;
      let recovered=snapshot;
      if (snapshot && snapshot.text===a.disk) {
        remember(a.key,null); writeDrafts(); recovered=null;
        a.revision=disk.revision; a.eol=disk.eol; a.bom=disk.bom;
      }
      a.conflict=!!(recovered && (!disk.editable || recovered.revision!==disk.revision));
      a.problem=a.conflict?t('code.conflict'):'';
      const area=document.createElement('textarea'); area.value=recovered?.text ?? a.disk ?? ''; host.append(area);
      a.cm=CM.fromTextArea(area,{
        mode:format.mode, lineNumbers:true, tabSize:4, indentUnit:4, indentWithTabs:false,
        screenReaderLabel:path, theme:'graphite', viewportMargin:12,
        extraKeys:{Tab:cm=>cm.somethingSelected()?cm.indentSelection('add'):cm.execCommand('insertSoftTab'),
          'Shift-Tab':'indentLess','Ctrl-S':()=>save(),'Cmd-S':()=>save()},
      });
      attachFind(body,a.cm);
      const pos=positions.get(a.key);
      if (pos) { a.cm.setCursor(pos.cursor); a.cm.scrollTo(null,pos.scroll); }
      if (a.line) goTo(a.line);
      a.cm.on('change',()=>{
        const text=a.cm.getValue();
        // Undo can return to the old disk text while a different edit is still being saved.
        // Keep that newer intent when switching tabs, then rebase it on the completed write.
        remember(a.key,text === a.disk && !a.conflict && !pending.has(a.key) ? null : {text,revision:a.revision,eol:a.eol,bom:a.bom});
        if (!a.conflict) a.problem=''; status();
      });
      a.save.onclick=()=>save(); a.copy.onclick=()=>copy(a); link.hidden=false;
      link.onclick=()=>copyLine(a.path,a.cm.getCursor().line+1);
      a.reload.onclick=async()=>{
        if (currentDraft(a.key) && !confirm(t('code.discard'))) return;
        const prior=a.cm.getValue();
        // Make sure the disk copy is readable before giving up the user's draft.
        try { const latest=await source('GET',a.path); if (active!==a || a.cm.getValue()!==prior) return;
          if (!latest.editable) { toast(t('code.readonly.'+latest.reason)); return; }
          remember(a.key,null); writeDrafts(); await open(a.body,a.path,'',latest);
        } catch(err) { showProblem(a,err); }
      };
      status();
    } catch (error) {
      if (a===active) a.status.textContent=t('code.error',{msg:error.message});
    }
  }
  async function external(path) {
    const a=active; if (!a?.cm || a.path!==path) return;
    await pending.get(a.key);
    if (a!==active) return;
    try {
      const fresh=await source('GET',path);
      if (a!==active || fresh.revision===a.revision) return;
      if (currentDraft(a.key)) showProblem(a,{status:409});
      else await open(a.body,path,'',fresh);
    } catch(err) { if (a===active) showProblem(a,err); }
  }
  function draftPaths() {
    const base=prefix(vault());
    const keys=new Set([...drafts.keys(),...Object.keys(localStorage).filter(k=>k.startsWith(base))]);
    return [...keys].filter(k=>k.startsWith(base) && currentDraft(k)).map(k=>k.slice(base.length));
  }
  async function flush() {
    writeDrafts();
    const remaining=[];
    for (const path of draftPaths()) {
      const k=key(vault(),path); await save(k,path);
      const d=currentDraft(k); if(d) remaining.push({path,text:d.text,eol:d.eol || 'LF',bom:!!d.bom});
    }
    return remaining;
  }
  function renamed(pairs) {
    for(const [oldPath,newPath] of pairs) {
      const old=key(vault(),oldPath), next=key(vault(),newPath), d=currentDraft(old);
      if(d) { remember(next,d); remember(old,null); }
      if (positions.has(old)) { positions.set(next,positions.get(old)); positions.delete(old); }
    }
    writeDrafts();
  }
  return {open,close,save,goTo,hasDraft,draftPaths,flush,writeDrafts,external,renamed,
    get activePath(){return active?.path;}, idle:()=>Promise.all([...pending.values()]),
    create:(path,text='')=>source('POST',path,text)};
}
