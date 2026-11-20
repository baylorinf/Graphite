'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { createHash, randomUUID } = require('node:crypto');
const fsp = fs.promises;
const SITE = 'https://oc.sjtu.edu.cn';
const { readSchoolPage, readCourses } = require('./canvas-web');
const { feedUrl } = require('../canvas-calendar');
const { courseFolder } = require('../canvas-api');
const { submitThroughSchool } = require('./canvas-web-submit');

function schoolUrl(raw) {
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' && !u.username && !u.password && !u.port &&
        (u.hostname === 'sjtu.edu.cn' || u.hostname.endsWith('.sjtu.edu.cn'))) return u;
  } catch {}
  return null;
}

function studyFilename(raw) {
  let name = path.win32.basename(String(raw)).replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/^[ .]+|[ .]+$/g, '');
  const ext = path.extname(name);
  if (!ext || !/^\.(pdf|docx?|pptx?|xlsx?|od[tpfs]|rtf|txt|md|csv|tsv|tex|bib|jpe?g|png|gif|webp|zip|7z|rar|tar|gz|ipynb|mp[34]|wav|webm|m4[av]|c|cpp|cc|cxx|h|hpp|java|py|go|rs|ts|js|css|sql|json|ya?ml|r|m|mat|dat|sav|s|asm|v|vhd|step|stp)$/i.test(ext)) return null;
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(name)) name = '_' + name;
  return name.slice(0, -ext.length).slice(0, 150) + ext;
}

function downloadDir(vault, folder = 'Downloads') {
  let p = fs.realpathSync(vault);
  for (const part of ['Canvas', folder]) {
    p = path.join(p, part);
    try { fs.mkdirSync(p); } catch (e) { if (e.code !== 'EEXIST') throw e; }
    if (fs.lstatSync(p).isSymbolicLink() || !fs.statSync(p).isDirectory()) throw new Error('Canvas 下载目录不可用。');
  }
  return p;
}
async function publishDownload(vault, tmp, name, folder = 'Downloads') {
  const dir = downloadDir(vault, folder), ext = path.extname(name), base = name.slice(0, -ext.length);
  if (path.dirname(tmp) !== dir) throw new Error('Canvas 下载目录已改变。');
  for (let i = 0; i < 1000; i++) {
    const candidate = i ? base + ' (' + (i + 1) + ')' + ext : name;
    try {
      await fsp.link(tmp, path.join(dir, candidate));
      return 'Canvas/' + folder + '/' + candidate;
    } catch (e) {
      if (['ENOTSUP','EPERM','EOPNOTSUPP','EXDEV','ENOSYS'].includes(e.code)) {
        try { await fsp.copyFile(tmp,path.join(dir,candidate),fs.constants.COPYFILE_EXCL); return 'Canvas/' + folder + '/' + candidate; }
        catch (copy) { if (copy.code !== 'EEXIST') throw copy; }
      } else if (e.code !== 'EEXIST') throw e;
      if (folder !== 'Downloads') {
        const target = path.join(dir,candidate), st = await fsp.lstat(target);
        if (st.isFile() && st.size === (await fsp.stat(tmp)).size) {
          async function digest(p) { const h=createHash('sha256'); for await (const chunk of fs.createReadStream(p)) h.update(chunk); return h.digest('hex'); }
          if (await digest(target) === await digest(tmp)) return { path:'Canvas/'+folder+'/'+candidate, unchanged:true };
        }
      }
    }
  }
  throw new Error('同名课件过多。');
}

function createCanvasDesktop({ app, BrowserWindow, session, safeStorage, vault }) {
  const real = fs.realpathSync(vault);
  const key = createHash('sha256').update(process.platform === 'win32' ? real.toLowerCase() : real).digest('hex');
  const file = path.join(app.getPath('userData'), 'canvas', key + '.bin');
  const storage = {
    async load() {
      let bytes;
      try { bytes = await fsp.readFile(file); } catch (e) { if (e.code === 'ENOENT') return {}; throw e; }
      try { return JSON.parse((await safeStorage.decryptStringAsync(bytes)).result); }
      catch { throw new Error('操作系统未能解锁已保存的 Canvas 连接。'); }
    },
    async save(state) {
      if (!Object.keys(state).length) { await fsp.rm(file, { force: true }); return; }
      if (!await safeStorage.isAsyncEncryptionAvailable() ||
          (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) throw new Error('系统加密存储暂不可用。');
      const bytes = await safeStorage.encryptStringAsync(JSON.stringify(state));
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const tmp = file + '.' + randomUUID() + '.tmp';
      try { await fsp.writeFile(tmp, bytes, { flag: 'wx', mode: 0o600 }); await fsp.rename(tmp, file); }
      finally { await fsp.rm(tmp, { force: true }); }
    },
  };

  const domainSession = session.fromPartition('persist:graphite-sjtu-' + key);
  domainSession.setPermissionRequestHandler((_content, _permission, callback) => callback(false));
  domainSession.setPermissionCheckHandler(() => false);
  let portal, auth, login, lastDownload;
  const downloads = new Set();
  const webTransfers = new Map(), workers = new Set();
  domainSession.on('will-download', (e, item, sender) => {
    const transfer=webTransfers.get(sender);
    const name = studyFilename(item.getFilename());
    if ((!transfer && (!portal || sender !== portal.webContents)) || !name || !schoolUrl(sender.getURL()) ||
        !item.getURLChain().every(raw => /^https:\/\//i.test(raw))) {
      e.preventDefault();
      transfer?.reject(new Error('该文件类型请在学校原站下载。'));
      if (portal && !portal.isDestroyed()) portal.setTitle('Graphite · 此文件请在系统浏览器下载');
      return;
    }
    let tmp;
    try { tmp = path.join(downloadDir(vault,transfer?.folder), '.' + randomUUID() + '.part'); item.setSavePath(tmp); }
    catch { e.preventDefault(); transfer?.reject(new Error('无法创建课程文件夹。')); portal?.setTitle('Graphite · 无法写入 Canvas/Downloads'); return; }
    if(transfer)transfer.item=item;
    downloads.add(item);
    if (transfer) {
      const limit=512*1024*1024;
      if(item.getTotalBytes()>limit)item.cancel();
      item.on('updated',()=>{if(item.getReceivedBytes()>limit)item.cancel();});
    }
    item.once('done', async (_event, state) => {
      try {
        if (state === 'completed') {
          const result=await publishDownload(vault, tmp, name, transfer?.folder);
          lastDownload = typeof result === 'string' ? result : result.path;
          transfer?.resolve(typeof result === 'string' ? {path:result,unchanged:false} : result);
          if (portal && !portal.isDestroyed()) portal.setTitle('Graphite · 已保存 ' + lastDownload);
        } else transfer?.reject(new Error('下载中断，请重试。'));
      } catch (e) { transfer?.reject(e); if (portal && !portal.isDestroyed()) portal.setTitle('Graphite · 保存失败，请重新下载'); }
      finally { downloads.delete(item); await fsp.rm(tmp, { force: true }).catch(() => {}); }
    });
  });

  function makeWindow(first, callback, hidden = false) {
    const w = new BrowserWindow({ width: 1080, height: 780, show:!hidden, autoHideMenuBar: true, title: '交大 Canvas',
      webPreferences: { session: domainSession, sandbox: true, contextIsolation: true,
        nodeIntegration: false, webviewTag: false } });
    w.removeMenu();
    let done = false;
    function finish(raw) { if (!done && callback) { done = true; void Promise.resolve(callback(raw)).catch(() => {}); } }
    function redirect(event, legacyUrl) {
      if (event.isMainFrame === false) return;
      const raw = event.url || legacyUrl, u = schoolUrl(raw);
      if (!u) { event.preventDefault(); return; }
      if (callback && u.origin === SITE && u.pathname === '/login/oauth2/auth' &&
          (u.searchParams.has('code') || u.searchParams.has('error'))) {
        event.preventDefault(); finish(raw); w.close();
      }
    }
    w.webContents.on('will-navigate', redirect);
    w.webContents.on('will-redirect', redirect);
    w.webContents.setWindowOpenHandler(({ url }) => {
      if (schoolUrl(url)) setImmediate(() => { if (!w.isDestroyed()) w.loadURL(url).catch(() => {}); });
      return { action: 'deny' };
    });
    w.once('closed', () => { finish(null); if (w === auth) auth = null; if (w === portal) portal = null; });
    if (first) w.loadURL(first).catch(() => { if (!w.isDestroyed()) w.setTitle('Graphite · 校网连接失败'); });
    return w;
  }
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const isolated=(w,code)=>w.webContents.executeJavaScriptInIsolatedWorld(1004,[{code}]);
  async function loadPage(w,raw) {
    if(!schoolUrl(raw) || new URL(raw).origin!==SITE)throw new Error('无效的校方页面。');
    let timer;
    try { await Promise.race([w.loadURL(raw),new Promise((_,reject)=>{timer=setTimeout(()=>{if(!w.isDestroyed())w.webContents.stop();reject(new Error('学校页面加载超时。'));},30000);})]); }
    finally {clearTimeout(timer);}
    const target = new URL(w.webContents.getURL());
    if(target.origin!==SITE || /^\/login(?:\/|$)/.test(target.pathname))return {login:true};
    let page, previous='', stable=0;
    for(let i=0;i<16;i++){
      await wait(250);
      page=await isolated(w,'('+readSchoolPage.toString()+')()');
      if(page.login || page.denied)break;
      const signature=(page.links?.length||0)+'/'+(page.enrollments?.length||0)+'/'+(page.tabs?.length||0);
      stable=signature===previous?stable+1:0;previous=signature;
      if(!page.busy && stable>=3 && (page.links?.length || page.hasCourseTable || i>=7))break;
    }
    return page;
  }
  async function withWorker(fn){
    const w=makeWindow(null,null,true); workers.add(w);
    try{return await fn(w);}finally{workers.delete(w);if(!w.isDestroyed())w.destroy();}
  }
  const desktop = {
    openPortal(target) {
      const url=target || SITE;
      if (portal && !portal.isDestroyed()){if(target)portal.loadURL(url).catch(()=>{});portal.focus();}
      else portal = makeWindow(url);
    },
    openWebLogin(callback) {
      if(login && !login.isDestroyed()){login.focus();return;}
      const w=makeWindow(null);login=w;
      let complete=false;
      w.once('closed',()=>{login=null;if(!complete)callback(false);});
      w.webContents.on('did-finish-load',async()=>{
        try{
          const u=schoolUrl(w.webContents.getURL());
          if(complete || u?.origin!==SITE || /^\/login(?:\/|$)/.test(u.pathname))return;
          const isLogged=await isolated(w,'!!document.querySelector("#global_nav_profile_link,#my_courses_table,a[href=\'/profile/settings\'],form[action=\'/logout\']")');
          if(!isLogged)return;
          complete=true;callback(true);w.close();
        }catch{}
      });
      w.loadURL(SITE+'/courses').catch(()=>{});
    },
    syncWeb:(options={})=>withWorker(async w=>{
      const result=await readCourses(url=>loadPage(w,url),options);
      try{
        const cal=await loadPage(w,SITE+'/calendar');
        if(cal.logged && !cal.denied){
          const raw=await isolated(w,`(async()=>{const btn=document.querySelector('#calendar-feed-button,#calendar_feed');if(btn)btn.click();for(let i=0;i<10;i++){const el=document.querySelector('#calendar_feed_box a[href*="/feeds/calendars/"],a[href*="/feeds/calendars/"][href*=".ics"]');if(el && el.getClientRects().length)return el.href;await new Promise(r=>setTimeout(r,100));}return null;})()`);
          if(raw)result.feed=feedUrl(raw);
        }
      }catch{}
      return result;
    }),
    downloadWeb:(course,file)=>withWorker(async w=>{
      const page=await loadPage(w,SITE+'/courses/'+course.id+'/files/'+file.id);
      if(page.login || !page.logged)throw Object.assign(new Error('学校登录已过期，请重新登录。'),{status:401});
      const url=schoolUrl(page.download);
      if(!url || url.origin!==SITE || !url.pathname.endsWith('/files/'+file.id+'/download'))throw new Error('学校页面没有提供下载链接，可在原站查看。');
      const folder=courseFolder(course);
      let t;
      try{return await new Promise((resolve,reject)=>{
        const x={folder,resolve,reject};webTransfers.set(w.webContents,x);
        t=setTimeout(()=>{x.item?.cancel();reject(new Error('下载超时，请重试。'));},300000);
        w.webContents.downloadURL(url.href);
      });}finally{clearTimeout(t);webTransfers.delete(w.webContents);}
    }),
    submitWeb:(body,{beforePost})=>withWorker(w=>submitThroughSchool(w,body,{beforePost,loadPage,isolated})),
    openAuth(url, callback) { if (auth && !auth.isDestroyed()) auth.close(); auth = makeWindow(url, callback); },
    async clearSession() {
      if(login && !login.isDestroyed())login.close();
      for(const w of workers)if(!w.isDestroyed())w.destroy();
      if (auth && !auth.isDestroyed()) auth.close();
      if (portal && !portal.isDestroyed()) portal.close();
      for (const item of downloads) item.cancel();
      await domainSession.clearStorageData(); await domainSession.clearCache();
      lastDownload = null;
    },
    lastDownload: () => lastDownload || null,
  };
  return { desktop, storage };
}
module.exports = { createCanvasDesktop, studyFilename, publishDownload, downloadDir };
