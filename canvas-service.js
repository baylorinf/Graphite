'use strict';
const { randomBytes, createHash } = require('node:crypto');
const { createSubmissionClient, WRITE_SCOPES } = require('./canvas-submission');
const { createCanvasApi, SCOPES, defaultFolder, verifiedSubdirectory } = require('./canvas-api');
const { feedUrl, getCalendar } = require('./canvas-calendar');
const { pullMaterials } = require('./canvas-pull');
const { mirrorToCourses, guessLinks } = require('./canvas-mirror');
const { moveCanvasFolder, rewriteLinks } = require('./canvas-migrate');
const { courseContent } = require('./canvas-course-content');
const deadlines = require('./canvas-deadlines');
const fsSync = require('node:fs');

const SITE = 'https://oc.sjtu.edu.cn';
const OOB = 'urn:ietf:wg:oauth:2.0:oob';
const error = (status, message) => Object.assign(new Error(message), { status });

// Which school account a freshly verified session belongs to. A numbered profile is exact; without one, the
// display name is the same fallback the course reader already uses. When neither side can be compared, the answer
// is "changed", so another student's saved courses are never shown.
function accountSwitched(previousIdentity, nextIdentity, previousUser, nextUser) {
  const oldId = String(previousIdentity || '').trim(), newId = String(nextIdentity || '').trim();
  if (oldId || newId) return oldId !== newId;
  const a = String(previousUser || '').trim().toLowerCase(), b = String(nextUser || '').trim().toLowerCase();
  if (a && b) return a !== b;
  return true;
}

// The desktop owns encrypted storage and the isolated school window. The browser
// preview can use a calendar for this server session without persisting a private URL.
function createCanvasService({ vault, storage, desktop, noteWriter, officeToPdf, autoPullMs = desktop ? 3 * 3600000 : 0, migrate = !!desktop, fetch: fetchImpl = fetch,
    clientId = process.env.GRAPHITE_CANVAS_CLIENT_ID, clientSecret = process.env.GRAPHITE_CANVAS_CLIENT_SECRET }) {
  let data, pending, tail = Promise.resolve(), authError = '', refreshing, webSyncing = false, readingSchool = 0, pullProgress = null, activePull = null;
  const shownPaths = new Map(); // a download as saved → the copy in the course folder (for "latest file")
  let readNumber = 0, lastSavedRead = 0;
  const configured = !!(clientId && clientSecret && desktop?.openAuth);
  function exclusive(fn) {
    const result = tail.then(fn, fn);
    tail = result.catch(() => {});
    return result;
  }
  async function ready() {
    if (!data) data = (await storage?.load()) || {};
  }
  async function save(next, read = 0) {
    if (read && read < lastSavedRead) return false;
    next = deadlines.track(data, next, new Date(), read > 0);
    if (storage) await storage.save(next);
    data = next;
    if (read) lastSavedRead = read;
    return true;
  }
  // One writer at a time for the saved state. A long school read never holds the lock: it saves its progress
  // through this, so signing in, syncing and the other actions stay responsive while courses are read.
  const writeState = (mutate, read = 0) => exclusive(async () => {
    const next = mutate(data);
    return next ? save(next, read) : false;
  });
  // Top-level vault folders a Canvas course can be linked to (its new files are copied there).
  function vaultFolders() {
    try {
      const base = typeof vault === 'function' ? vault() : vault;
      return fsSync.readdirSync(base, { withFileTypes: true }).filter(e => e.isDirectory() && !e.name.startsWith('.') && e.name !== 'Canvas').map(e => e.name).sort();
    } catch { return []; }
  }
  // Every course has a vault folder: the one the student chose, else a guess (线性代数 → Linear Algebra), else a
  // new folder named after the course. Canvas never gets a folder of its own.
  function courseLinks() {
    const courses = data?.snapshot?.courses || [];
    const guess = guessLinks(courses, vaultFolders()), chosen = data?.courseLinks || {};
    return Object.fromEntries(courses.map(c => [String(c.id), chosen[String(c.id)] || guess[String(c.id)] || defaultFolder(c)]));
  }
  const vaultBase = () => (typeof vault === 'function' ? vault() : vault);
  // The course folder (created if needed), for its notes.
  async function courseDir(course) {
    const base = await fsSync.promises.realpath(vaultBase());
    let dir = base;
    for (const part of courseLinks()[String(course.id)].split('/')) dir = await verifiedSubdirectory(dir, part);
    return dir;
  }
  // File downloaded Canvas files into the course folders; returns id → the copy the student sees.
  async function placeFiles(course, cache, ids, report) {
    const pc = data.pullCache || {};
    const m = await mirrorToCourses({ vault: vaultBase(), courses: [course], cache, links: courseLinks(), mirrored: pc.mirrored || {}, officeToPdf, writer: noteWriter });
    data = { ...data, pullCache: { ...pc, mirrored: m.mirrored } };
    if (report) { report.added.push(...m.report.added); report.duplicates += m.report.duplicates; report.failed.push(...m.report.failed);
      for (const i of m.report.index || []) if (!report.index.includes(i)) report.index.push(i); }
    const shown = new Map();
    for (const id of ids) {
      const p = m.mirrored[String(course.id) + '/' + id];
      if (p && p !== 'duplicate' && fsSync.existsSync(require('node:path').join(vaultBase(), p))) shown.set(String(id), p);
    }
    return shown;
  }
  // The school window can stay open past the UI polling deadline.
  const waitingForWebLogin = () => !!pending?.web;
  function view() {
    const hidden = waitingForWebLogin() || data.webReconnect;
    const visible = hidden ? {} : data;
    const web = waitingForWebLogin() || !!data.portalSyncEnabled;
    // Remains comparable during an expired session. Only connected accounts may send.
    // A display name (or a temporary cache owner) cannot identify the owner of a draft.
    const id = String((web ? visible.snapshot?.webIdentity : visible.accountId || visible.auth?.userId) || '').trim();
    const accountKey = id ? createHash('sha256').update(JSON.stringify([SITE, web ? 'web' : 'oauth', id])).digest('hex') : null;
    return { connected: web ? !!visible.webVerified : !!visible.auth, configured, sessionOnly: !storage, user: visible.user || '',
      accountKey,
      portalSupported: !!desktop?.openWebLogin, portalSyncEnabled: web,syncing:readingSchool>0, canSubmit: !web && !!visible.auth && !!visible.writeEnabled,
      canSubmitFiles: web ? !!visible.webVerified && !!desktop?.submitWeb : !!visible.auth && !!visible.writeEnabled,
      lastPull: visible.lastPull || null, pullProgress: hidden ? null : pullProgress,
      syncProgress: hidden || readingSchool<=0 ? null : (data.syncProgress || null),
      authMode: web ? 'web' : (visible.auth || configured ? 'oauth' : null), authPending: !!pending && pending.until > Date.now(),
      authError, syncedAt: visible.syncedAt || null, snapshot: visible.snapshot || { courses: [], warnings: [] },
      deadlineChanges: hidden ? [] : deadlines.changesFor(visible),
      calendar: visible.calendar || null, migration: data.migration || null, courseLinks: hidden ? {} : courseLinks(), vaultFolders: vaultFolders(), autoMirror: data.autoMirror !== false, autoPull: !!autoPullMs, portalOpened: !!visible.portalOpened, lastDownload: hidden ? null : (raw => shownPaths.get(raw) || raw)(desktop?.lastDownload?.() || null) };
  }
  async function tokenRequest(parameters) {
    let res;
    try {
      res = await fetchImpl(SITE + '/login/oauth2/token', { method: 'POST', redirect: 'error',
        signal: AbortSignal.timeout(25000), body: new URLSearchParams({ client_id: clientId,
          client_secret: clientSecret, ...parameters }) });
    } catch { throw error(502, '暂时无法连接学校的授权服务，请稍后重试。'); }
    if (!res.ok) throw error(res.status === 400 || res.status === 401 ? 401 : 502, '学校未接受本次授权，请重新连接。');
    const t = await res.json();
    if (!t.access_token) throw error(502, '学校没有返回有效的授权。');
    return { accessToken: t.access_token, refreshToken: t.refresh_token, userId: t.user?.id == null ? '' : String(t.user.id),
      user: String(t.user?.name || ''), expires: t.expires_in ? Date.now() + Number(t.expires_in) * 1000 : null };
  }
  async function accessToken(force = false) {
    const auth = data.auth;
    if (!auth) throw error(401, '请先连接交大 Canvas。');
    if (!force && (!auth.expires || auth.expires > Date.now() + 20000)) return auth.accessToken;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      try {
        if (!auth.refreshToken) throw error(401, '授权已过期，请重新连接交大 Canvas。');
        const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken });
        const previousId = String(data.accountId || auth.userId || '');
        if (previousId && t.userId && t.userId !== previousId) throw error(401, '学校账户已改变，请重新连接交大 Canvas。');
        await save({ ...data, auth: { ...t, refreshToken: t.refreshToken || auth.refreshToken,
          userId: t.userId || previousId }, accountId: t.userId || previousId });
        return t.accessToken;
      } catch (e) {
        if (e.status === 401) { authError = e.message; await save({ ...data, accountId: data.accountId || auth.userId || null, auth: null }); }
        throw e;
      }
    })();
    try { return await refreshing; } finally { refreshing = null; }
  }
  const api = createCanvasApi({ vault, fetch: fetchImpl, accessToken, getAccountId:()=>data.accountId || data.auth?.userId });
  const submissions = createSubmissionClient({fetch:fetchImpl, accessToken});
  let normalRead = null, normalSession;
  // A second ordinary read joins the one already running (no double requests); a pull's full read is its own, so
  // signing in or pressing sync never waits for it. A new sign-in gets its own session id and never joins.
  function syncWeb(background=false,fullMaterials=false,options={}) {
    if (options.locked) return syncWebNow(background,fullMaterials,options);
    if (fullMaterials && !options.joinNormal) return syncWebNow(background,true,options);
    if (!fullMaterials && normalRead && normalSession === (data.webSessionId || null)) return normalRead;
    normalSession = data.webSessionId || null;
    const run = syncWebNow(background,fullMaterials,options);
    normalRead = run;
    run.then(() => { if (normalRead === run) normalRead = null; }, () => { if (normalRead === run) normalRead = null; });
    return run;
  }
  async function syncWebNow(background=false,fullMaterials=false,{locked=false}={}) {
    // Under the lock (a session that has not confirmed its account yet) write directly; otherwise every save goes
    // through writeState so a minutes-long read never blocks signing in or the other short actions.
    const write = (mutate, completedRead = 0) => locked
      ? Promise.resolve().then(() => { const next = mutate(data); return next ? save(next, completedRead) : false; })
      : writeState(mutate, completedRead);
    // This read belongs to the sign-in it started with. A later sign-in for another account gets a new session id,
    // so nothing this read collected (even a course saved halfway) can land under that account.
    const session = data.webSessionId;
    const read = ++readNumber;
    const initialIdentity = data.snapshot?.webIdentity;
    const initialUser = data.user;
    const mine = cur => cur.portalSyncEnabled && String(cur.webSessionId||'') === String(session||'') && read >= lastSavedRead;
    readingSchool++;
    try {
      const keepPrevious = !data.webReconnect || !!data.snapshot?.webIdentity;
      const result = await desktop.syncWeb({background,fullMaterials,previousSnapshot:keepPrevious ? data.snapshot : undefined,previousUser:keepPrevious ? data.user : '',
        // A finished course is saved at once: closing Graphite mid-read keeps what has already arrived, and the
        // course list fills in while the rest is still being read.
        onCourse: partial => write(cur => {
          if (!mine(cur)) return null;
          if ((initialIdentity || cur.snapshot?.courses?.length) &&
              String(cur.snapshot?.webIdentity || '') !== String(partial.webIdentity || '')) return null;
          // Partial: the courses read so far replace their old copy, the ones not visited yet stay visible, and
          // "last synced" only moves when the whole read ends.
          const seen=new Set((partial.courses || []).map(c=>String(c.id)));
          const kept=(cur.snapshot?.courses || []).filter(c=>!seen.has(String(c.id)));
          return {...cur,
            snapshot:{courses:[...(partial.courses || []),...kept],warnings:partial.warnings || [],webIdentity:partial.webIdentity ?? cur.snapshot?.webIdentity ?? null},
            syncProgress:{done:partial.courses.length,total:partial.total || partial.courses.length}};
        })});
      if (!mine(data)) return false;
      const oldUser=String(initialUser||'').trim(), user=String(result.user||'').trim();
      const previousIdentity=initialIdentity, nextIdentity=result.snapshot.webIdentity;
      const changedName=oldUser && user && oldUser!==user;
      const sameName=!!oldUser && !!user && oldUser===user;
      // A numbered profile decides; without one, the same display name keeps the account. An unnamed session only
      // counts as a switch while the account is still unconfirmed.
      const switched=previousIdentity || nextIdentity ? String(previousIdentity || '') !== String(nextIdentity || '')
        : Boolean(changedName) || (!sameName && !!data.webReconnect);
      if (switched) desktop.clearLastDownload?.();
      let calendar=switched?null:data.calendar, url=switched?null:data.feed;
      const muted=switched?false:data.feedMuted;
      if (!muted && result.feed) {
        if (url !== result.feed) calendar=null;
        url=result.feed;
        try { calendar=await getCalendar(url,fetchImpl); }
        catch(e){result.snapshot.warnings.push(e.message);}
      } else if (data.feedAutomatic && !result.feed) { calendar=null;url=null; }
      else if (url) {
        try {calendar=await getCalendar(url,fetchImpl);}catch(e){result.snapshot.warnings.push(e.message);}
      }
      if(calendar) {
        for(const entry of calendar.events) {
          let u;
          try{u=new URL(entry.url);}catch{continue;}
          const match=u.origin===SITE && u.pathname.match(/^\/courses\/(\d+)\/(assignments|quizzes)\/(\d+)\/?$/);
          if(!match)continue;
          const c=result.snapshot.courses.find(course=>String(course.id)===match[1]);
          const item=c?.[match[2]]?.find(item=>String(item.id)===match[3]);
          if(item && !item.dueAt)item.dueAt=entry.startAt;
        }
      }
      // A foreground read that hit no cap is complete enough to pull from: remember when it finished. A capped or
      // background read is not, so a pull must read again.
      const truncated = [result.snapshot, ...(result.snapshot.courses || [])]
        .some(page => (page.warnings || []).some(w => /部分单元附件|超过 100 页|作业详情超过/.test(w)));
      const committed = await write(cur => !mine(cur) ? null : ({...cur,
        ...(switched ? {requests:undefined,lastPull:null,pullCache:undefined,pullSessionId:null} : {}),
        webVerified:true, webReconnect:false, user:result.user, snapshot:result.snapshot, syncedAt:result.syncedAt,
        pullReadyAt:background || truncated ? null : new Date().toISOString(),
        feed:url, calendar, feedMuted:muted, feedAutomatic:!!result.feed && !muted, syncProgress:null, syncError:null}), read);
      if (committed) authError='';
      return committed;
    } catch(e) {
      if (!mine(data)) return false;
      authError=e.message;
      // A single page failing is not a failed sign-in: keep the account and the courses already read. Only the
      // school saying the session is gone asks for a new login.
      await write(cur => !mine(cur) ? null : ({...cur,syncProgress:null,syncError:e.message,...(e.status===401?{webVerified:false}:{})})).catch(()=>{});
      throw e;
    } finally {readingSchool=Math.max(0,readingSchool-1);}
  }
  async function downloadOne(courseId,fileId,session) {
    if (data.portalSyncEnabled) {
      if (!data.webVerified) throw error(401,'请重新登录学校网站。');
      const course=data.snapshot?.courses.find(c=>String(c.id)===String(courseId));
      // A file linked from a page or an assignment (read in Graphite) may not be in the course's file list yet.
      const file=course?.files?.find(f=>String(f.id)===String(fileId)) || (course && /^\d+$/.test(String(fileId)) ? {id:String(fileId),name:''} : null);
      if (!file || !/^\d+$/.test(String(file.id))) throw error(404,'请先同步此课件。');
      return session ? session.download(course,file) : desktop.downloadWeb(course,file);
    }
    if (!data.auth) throw error(401,'请先连接交大 Canvas。');
    return api.download(courseId,fileId,data.snapshot||{});
  }
  async function submit(body) {
    const web = !!data.portalSyncEnabled;
    if(web ? !view().canSubmitFiles || body.type !== 'online_upload' : !data.auth || !data.writeEnabled)
      throw error(403,'当前连接不支持此提交方式，可在学校原站提交。');
    const {requestId,courseId,assignmentId}=body;
    if(body.confirmed!==true || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId||''))throw error(400,'请核对作业后确认提交。');
    const assignment=data.snapshot?.courses.find(c=>String(c.id)===courseId)?.assignments?.find(a=>String(a.id)===assignmentId);
    if(!assignment)throw error(404,'请先同步此作业。');
    const h=createHash('sha256').update(JSON.stringify([courseId,assignmentId,body.expectedAttempt,body.type,body.text||'',body.url||'']));
    for(const file of body.files||[]) h.update(JSON.stringify([file.name,file.size])).update(Buffer.from(await file.arrayBuffer()));
    const signature=h.digest('hex');
    const old=data.requests?.[requestId], openUrl=SITE+'/courses/'+courseId+'/assignments/'+assignmentId;
    const unknown=()=>Object.assign(error(502,'学校可能已经收到作业，请先在原站核对提交记录。'),{code:'submission_unknown',openUrl});
    if(old){if(old.signature!==signature)throw error(409,'这份提交的内容已改变，请重新核对。');if(old.receipt)return old.receipt;throw unknown();}
    let started=false;
    const update=async value=>{
      const requests={...data.requests};
      if(value) requests[requestId]={signature,...value}; else delete requests[requestId];
      const recent=Object.entries(requests).slice(-200);
      await save({...data,requests:Object.fromEntries(recent)});
    };
    let result;
    try {
      const guard={beforePost:async()=>{await update({pending:true});started=true;}};
      result=web ? await desktop.submitWeb({...body,assignment,expectedWebIdentity:data.snapshot.webIdentity||null,expectedWebUser:data.user||''},guard)
        : await submissions.submit(body,guard);
    } catch(e) {
      if(started && e.code==='submission_unknown') throw unknown();
      if(started) await update(null);
      throw e;
    }
    try {
      await update({receipt:result});
      const snapshot=structuredClone(data.snapshot);
      const assignment=snapshot.courses.find(c=>String(c.id)===courseId).assignments.find(a=>String(a.id)===assignmentId);
      Object.assign(assignment,{submitted:true,attempt:result.attempt,submittedAt:result.submittedAt,
        submissionEvidence:{status:'submitted',attempt:result.attempt,submittedAt:result.submittedAt}});
      await save({...data,snapshot});
    } catch { if(!data.requests?.[requestId]?.receipt)throw unknown(); }
    return result;
  }
  async function finishAuth(expected, raw) {
    if (pending !== expected) return;
    pending = null;
    if (!raw) { authError = ''; return; } // user closed the official window
    try {
      const cb = new URL(raw);
      if (cb.origin !== SITE || cb.pathname !== '/login/oauth2/auth' ||
          expected.until < Date.now() || cb.searchParams.get('state') !== expected.state) throw error(400, '授权请求已失效，请重新连接。');
      if (!cb.searchParams.get('code') || cb.searchParams.has('error')) throw error(401, '本次连接未获授权。');
      const t = await tokenRequest({ grant_type: 'authorization_code', code: cb.searchParams.get('code'), redirect_uri: OOB });
      const previousId = String(data.accountId || data.auth?.userId || '');
      const same = !data.portalSyncEnabled && !!t.userId && previousId === t.userId;
      if (!same) desktop.clearLastDownload?.();
      await save({ ...data, auth: t, user: t.user, accountId: t.userId, portalSyncEnabled:false,webReconnect:false,
        writeEnabled:expected.submit,requests:same?data.requests:undefined,
        pullCache:same?data.pullCache:undefined,lastPull:same?data.lastPull:null,
        snapshot: same ? data.snapshot : null, syncedAt: same ? data.syncedAt : null,
        // A separately added private feed belongs to its own subscription; never carry it across a known account switch.
        ...((previousId || data.portalSyncEnabled) && !same ? { feed: null, calendar: null } : {}) });
      authError = '';
    } catch (e) { authError = e.message; }
  }

  async function handle(method, action, body = {}) {
    if(method==='GET' && action==='status' && data)return view();
    if (method==='POST' && action==='pull') return runPull(body.courseId == null ? null : String(body.courseId));
    // Reading one page can take several seconds on the school site: outside the lock, like a pull.
    if (method==='POST' && action==='read') return readPage(body);
    // A web sync reads every course page for minutes: never hold the lock for it either.
    if (method==='POST' && action==='sync') return runSync();
    return exclusive(() => handleOther(method, action, body));
  }
  async function runSync() {
    await exclusive(ready);
    if (waitingForWebLogin()) throw error(401,'请先完成学校登录并核对账户。');
    if (data.portalSyncEnabled) { await syncWeb(); return view(); }
    return exclusive(() => handleOther('POST','sync',{}));
  }
  // One Canvas page for Graphite's reader (assignment, announcement, page, discussion, syllabus).
  async function readPage(body) {
    await exclusive(ready);
    if (waitingForWebLogin() || data.webReconnect) throw error(401, '请先完成学校登录并核对账户。');
    if (!view().connected) throw error(401, '请先连接交大 Canvas。');
    if (data.portalSyncEnabled) {
      if (!desktop?.readWeb) throw error(409, '这个页面暂时不能在 Graphite 里显示。');
      let u; try { u = new URL(String(body.url || ''), SITE); } catch { throw error(400, '无效的 Canvas 地址。'); }
      if (u.origin !== SITE) throw error(400, '无效的 Canvas 地址。');
      const page = await desktop.readWeb(u.href);
      const cid = u.pathname.match(/^\/courses\/(\d+)/)?.[1] || '';
      const content = courseContent(page?.html || '', cid);
      return { url: u.href, courseId: cid, title: page?.title || '', text: content.text, attachments: content.attachments };
    }
    return api.read(String(body.url || ''));
  }
  async function runPull(courseId, auto = false) {
    {
      if (activePull) {
        if (activePull.courseId===courseId) return activePull.task;
        throw error(409,'正在拉取课程资料，请等本次完成。');
      }
      // Only the short steps that read or write the saved state hold the lock. Reading the school site and
      // downloading every file can take minutes; signing in, syncing and the other actions must not wait for it.
      const task = (async () => {
        await exclusive(ready);
        if (!view().connected) throw error(401,'请先连接交大 Canvas。');
        pullProgress = {done:0,total:0,name:''};
        const warnings = [];
        let usingSnapshot = false;
        const login = data.webSessionId, web = !!data.portalSyncEnabled, ownerAtStart = deadlines.ownerOf(data);
        const checkOwner = () => {
          if (!(web ? data.webVerified : data.auth) || web !== !!data.portalSyncEnabled || login !== data.webSessionId ||
              (ownerAtStart && ownerAtStart !== deadlines.ownerOf(data))) throw error(409,'课程账户已变更，请重新拉取资料。');
        };
        try {
          if (data.portalSyncEnabled) {
            // A deep read that just finished already holds every course, assignment and file: download from it
            // instead of reading the whole school site again. The shortcut is used once; the next pull reads again.
            if (normalRead) { try { await normalRead; } catch { /* reported by the read itself */ } }
            const ready = !data.syncError && data.pullReadyAt &&
              Date.now() - (Date.parse(data.pullReadyAt) || 0) < 10 * 60000;
            if (ready) await exclusive(() => save({...data, pullReadyAt:null}));
            else {
              const saved = await syncWeb(auto, true);
              checkOwner();
              // A more recent short sync can satisfy the pull if it read all materials.
              // If it hit a cap, run a fresh full read and let new manual syncs join it.
              if (!saved && !data.pullReadyAt) await syncWeb(auto,true,{joinNormal:true});
              // This pull's own read is not handed to the next one: by then the school may have changed.
              await exclusive(() => save({...data, pullReadyAt:null}));
            }
          }
          else {
            const read = ++readNumber;
            const snapshot = await api.sync(data.snapshot || undefined);
            await exclusive(() => { checkOwner(); return save({...data,snapshot,syncedAt:new Date().toISOString()},read); });
          }
        } catch (e) {
          if (e.status===401 || e.status===403 || e.status===409 || !data.snapshot?.courses?.length) throw e;
          usingSnapshot = true;
          warnings.push('课程列表未能刷新，已采用上次同步的资料。'+e.message);
        }
        checkOwner();
        const courses=(data.snapshot?.courses || []).filter(c=>courseId===null || String(c.id)===courseId);
        if (courseId!==null && !courses.length) throw error(404,'找不到所选课程，请重新同步。');
        warnings.push(...data.snapshot?.warnings || []);
        for (const c of courses) for (const message of c.warnings || []) warnings.push(c.name+' · '+message);
        // Older school sessions might only expose a name. Scope that cache to
        // this local login; explicit reconnection always starts a new one.
        const sessionId=data.portalSyncEnabled ? (data.pullSessionId || randomBytes(16).toString('hex')) : null;
        const owner=data.portalSyncEnabled?'web:'+(data.snapshot?.webIdentity||sessionId):'api:'+data.accountId;
        const cached=data.pullCache?.owner===owner ? data.pullCache : {};
        // Files are filed into the course folders as each course finishes; its notes link to those copies.
        const mirror = { added: [], duplicates: 0, failed: [], unlinked: [], index: [] };
        if (cached.mirrored && data.pullCache?.owner === owner) data = { ...data, pullCache: { ...data.pullCache, mirrored: cached.mirrored } };
        // One hidden window serves every file of this pull; closing it stops any download still running.
        let dl=null;
        try{ dl=desktop?.createDownloader?.()||null; }catch{ dl=null; }
        let pulled;
        try {
          pulled = await pullMaterials({vault,courses,warnings,usingSnapshot,download:(cid,id)=>downloadOne(cid,id,dl),noteWriter,
            previous:cached.files,previousNotes:cached.notes,
            noteDir: courseDir, place: (course, files, ids) => placeFiles(course, files, ids, mirror),
            onProgress:progress=>{pullProgress=progress;}});
        } finally { if(dl) await Promise.resolve(dl.close()).catch(()=>{}); }
        const { result,cache,noteCache } = pulled;
        result.mirror = mirror;
        result.finishedAt=new Date().toISOString();
        if (auto) result.auto = true;
        const mirrored = data.pullCache?.mirrored || {};
        await exclusive(async () => {
          // Signed out or another account meanwhile: this pull's record belongs to nobody now.
          const now=data.portalSyncEnabled?'web:'+(data.snapshot?.webIdentity||sessionId):'api:'+data.accountId;
          if (!view().connected || now!==owner) return;
          await save({...data,lastPull:result,pullSessionId:sessionId,pullCache:{owner,files:cache,notes:noteCache,mirrored}});
        });
        return result;
      })();
      activePull={courseId,task};
      try {return await task;} finally {activePull=null;pullProgress=null;}
    }
  }
  // One downloaded file, filed into its course folder: the path the student opens.
  async function shownCopy(courseId, fileId, saved) {
    const course = data.snapshot?.courses?.find(c => String(c.id) === String(courseId));
    if (!course || !saved?.path) return saved?.path;
    const known = course.files?.some(f => String(f.id) === String(fileId)) ? course : { ...course, files: [...(course.files || []), { id: String(fileId), name: '' }] };
    const shown = await placeFiles(known, { [String(courseId) + '/' + fileId]: { path: saved.path } }, [String(fileId)]);
    await save({ ...data });
    const visible = shown.get(String(fileId)) || saved.path;
    shownPaths.set(saved.path, visible);
    return visible;
  }
  async function handleOther(method, action, body) {
    {
      await ready();
      if (method === 'GET' && action === 'status') return view();
      if (method !== 'POST') throw error(405, 'Method not allowed');
      if (waitingForWebLogin() || data.webReconnect) {
        const allowed=waitingForWebLogin() ? ['portal','web-connect','disconnect'] : ['portal','web-connect','disconnect','connect','sync'];
        if (!allowed.includes(action)) throw error(401,'请先完成学校登录并核对账户。');
      }
      if (action === 'portal') {
        let target;
        // Any page on the school site opens in Graphite's own Canvas window (never an outside browser).
        if (body.url) { let u; try { u = new URL(String(body.url), SITE); } catch {} if (u?.origin === SITE && !u.username && !u.password) target = u.href; }
        if(!target && (body.courseId || body.assignmentId)) {
          if(!/^\d+$/.test(body.courseId) || !/^\d+$/.test(body.assignmentId))throw error(400,'无效的课程或作业。');
          target=SITE+'/courses/'+body.courseId+'/assignments/'+body.assignmentId;
        }
        if (!desktop) return { url: target||SITE };
        await desktop.openPortal(target);
        await save({ ...data, portalOpened: true });
        return { opened: true };
      }
      if(action==='web-connect') {
        if(!desktop?.openWebLogin)return {url:SITE};
        if(pending?.web && pending.until>Date.now())return {opened:true};
        // Reopening an existing desktop window focuses it. Its original completion callback is still active.
        const previous=pending?.web ? pending : null, request=previous || {web:true};
        request.until=Date.now()+15*60000;pending=request;authError='';
        const onLogin=ok=>{
          if(pending!==request)return;
          if(!ok){pending=null;return;}
          const confirmed=exclusive(async()=>{
            if(pending!==request)return {sync:false};
            let account=null, unreadable=false;
            // Who is signed in? One school page, so signing in no longer waits for the whole course read.
            for(let attempt=0;attempt<2 && !account;attempt++){
              try{account=await desktop.verifyWeb?.()||null;}
              catch{unreadable=true;}
            }
            if(!account){
              if(!desktop.verifyWeb || unreadable){
                // No quick check (browser preview or an unreadable page): keep the careful path that confirms the
                // account by reading the courses first, and keep the previous data private until it does.
                try{
                  await save({...(data.portalSyncEnabled ? data : {}),portalSyncEnabled:true,portalOpened:true,
                    webVerified:false,webReconnect:true,auth:null,accountId:null,writeEnabled:false,
                    webSessionId:randomBytes(16).toString('hex')});
                  await syncWeb(false,false,{locked:true});
                } catch(e){authError=e.message;}
                finally {if(pending===request)pending=null;}
                return {sync:false};
              }
              authError='学校登录未完成，请重试。';
              return {sync:false};
            }
            if(!account.logged){authError='学校登录未完成，请重试。';return {sync:false};}
            // A different student's courses, drafts and downloads never appear under this one.
            const switched=accountSwitched(data.snapshot?.webIdentity,account.webIdentity,data.user,account.user);
            if(switched)desktop.clearLastDownload?.();
            // Clicking sign-in again on a session that is already confirmed changes nothing and starts no read —
            // unless the last read failed, in which case this is the retry.
            const fresh=!switched && data.webVerified && !data.syncError && data.syncedAt &&
              Date.now()-(Date.parse(data.syncedAt)||0)<10*60000;
            await save(switched
              ? {portalSyncEnabled:true,portalOpened:true,webVerified:true,webReconnect:false,auth:null,accountId:null,
                 writeEnabled:false,user:account.user||'',snapshot:null,syncedAt:null,lastPull:null,pullCache:undefined,
                 pullSessionId:null,requests:undefined,feed:null,calendar:null,feedAutomatic:false,feedMuted:false,
                 webSessionId:randomBytes(16).toString('hex'),syncError:null}
              : {...data,portalSyncEnabled:true,portalOpened:true,webVerified:true,webReconnect:false,auth:null,
                 accountId:null,writeEnabled:false,user:account.user||data.user||'',
                 ...(fresh && data.pullReadyAt ? {pullReadyAt:new Date().toISOString()} : {}),
                 webSessionId:data.webSessionId||randomBytes(16).toString('hex')});
            authError='';
            pending=null;
            return {sync:!fresh};
          });
          confirmed.then(result=>{if(result?.sync)void syncWeb().catch(e=>{authError=e.message;});},
            e=>{authError=e.message||String(e);})
            .finally(()=>{if(pending===request)pending=null;});
          // Resolves once the account is confirmed (and, without a quick check, once that first read is done).
          return confirmed;
        };
        try { await desktop.openWebLogin(onLogin); }
        catch(e) {
          if (pending===request) { if(previous)request.until=0; else pending=null; }
          throw e;
        }
        return {opened:true};
      }
      if (action === 'connect') {
        if (!configured) throw error(409, '课程自动同步需要学校启用 Graphite 的 Canvas 应用授权。下载课件和日历订阅可单独使用。');
        const request = { state: randomBytes(32).toString('hex'), until: Date.now() + 10 * 60000, submit:body.submit===true };
        pending = request;
        authError = '';
        const url = new URL('/login/oauth2/auth', SITE);
        url.search = new URLSearchParams({ client_id: clientId, response_type: 'code', state: request.state,
          redirect_uri: OOB, scope: [...new Set([...SCOPES,...(request.submit?WRITE_SCOPES:[])])].join(' '), purpose: 'Graphite · SJTU Canvas' });
        try { await desktop.openAuth(url.href, raw => exclusive(() => finishAuth(request, raw))); }
        catch { pending = null; throw error(502, '无法打开学校授权窗口。'); }
        return { opened: true };
      }
      if (action === 'calendar') {
        const url = feedUrl(body.url);
        const calendar = await getCalendar(url, fetchImpl);
        await save({ ...data, feed: url, calendar, feedAutomatic:false, feedMuted:false });
        return view();
      }
      if (action === 'calendar-remove') {
        await save({ ...data, feed: null, calendar: null,feedMuted:true,feedAutomatic:false });
        return view();
      }
      if (action === 'sync') {
        // The web path is handled by runSync(), outside this lock. This branch is the optional official API.
        if (!data.auth && !data.feed) throw error(401, '请先连接 Canvas 或添加日历订阅。');
        const issues = [];
        let done = false, firstError;
        if (data.auth) {
          try {
            const read = ++readNumber;
            const snapshot = await api.sync(data.snapshot || undefined);
            await save({ ...data, snapshot, syncedAt: new Date().toISOString() }, read);
            done = true;
          } catch (e) { firstError = e; issues.push(e.message); }
        }
        if (data.feed) {
          try {
            const calendar = await getCalendar(data.feed, fetchImpl);
            await save({ ...data, calendar });
            done = true;
          } catch (e) { firstError ||= e; issues.push(e.message); }
        }
        if (!done) throw firstError;
        const result = view();
        if (issues.length) result.snapshot = { ...result.snapshot, warnings: [...result.snapshot.warnings || [], ...issues] };
        return result;
      }
      if (action === 'download') {
        const saved = await downloadOne(body.courseId,body.fileId);
        return { ...saved, path: await shownCopy(body.courseId, body.fileId, saved) };
      }
      if (action === 'verify-submission') {
        const current=view(),courseId=String(body.courseId || ''),assignmentId=String(body.assignmentId || '');
        if(!current.connected || !current.accountKey || body.accountKey!==current.accountKey) throw error(409,'请先核对当前学校账户。');
        if(!/^[1-9]\d*$/.test(courseId) || !/^[1-9]\d*$/.test(assignmentId)) throw error(400,'无效的课程或作业。');
        let record;
        try {
          record=data.portalSyncEnabled
            ? await desktop?.verifyWebSubmission?.({courseId,assignmentId,expectedIdentity:String(data.snapshot.webIdentity)})
            : await submissions.verify(courseId,assignmentId,data.accountId || data.auth?.userId);
        } catch (e) {
          if(e.status)throw e;
          throw error(502,'暂时无法核对学校的提交记录，请稍后再试。');
        }
        if(!record)record={status:'unknown',attempt:null,submittedAt:null};
        return {courseId,assignmentId,accountKey:current.accountKey,...record};
      }
      if(action==='submit') return submit(body);
      if (action === 'link') {
        const id = String(body.courseId || ''), folder = String(body.folder ?? '');
        if (!/^\d+$/.test(id) || (folder && !vaultFolders().includes(folder) && folder !== courseLinks()[id])) throw error(400, '无效的课程或文件夹。');
        await save({ ...data, courseLinks: { ...(data.courseLinks || {}), [id]: folder } });
        return view();
      }
      if (action === 'auto-mirror') { await save({ ...data, autoMirror: body.enabled !== false }); return view(); }
      if (action === 'download-course') {
        if (!view().connected) throw error(401, '请先连接交大 Canvas。');
        const course = data.snapshot?.courses.find(c => String(c.id) === String(body.courseId));
        if (!course) throw error(404, '请先同步此课程。');
        const result = { saved: 0, unchanged: 0, failed: [] };
        for (const file of course.files) {
          try {
            const item = await downloadOne(course.id,file.id);
            item.path = await shownCopy(course.id, file.id, item);
            result[item.unchanged ? 'unchanged' : 'saved']++;
            if (!result.path) result.path = item.path.split('/').slice(0, -1).join('/');
          } catch (e) {
            result.failed.push({ id: file.id, name: file.name, error: e.message });
            if (e.status === 401) {
              result.skipped = course.files.length - result.saved - result.unchanged - result.failed.length;
              break;
            }
          }
        }
        return result;
      }
      if (action === 'disconnect') {
        pending = null;
        authError = '';
        const token = data.auth?.accessToken;
        await desktop?.clearSession();
        await save({});
        if (token) {
          try {
            const r = await fetchImpl(SITE + '/login/oauth2/token', { method: 'DELETE', redirect: 'error',
              signal: AbortSignal.timeout(5000), headers: { Authorization: 'Bearer ' + token } });
            if (!r.ok && r.status !== 401) throw new Error();
          } catch { authError = '本机已断开。学校未确认撤销，可在 Canvas 的账户设置中移除此授权。'; }
        }
        return view();
      }
      throw error(404, 'Unknown Canvas action');
    }
  }
  // 1.1.53: the old Canvas/ folder is split into the course folders, once (see canvas-migrate.js). Runs again on a
  // later start if something was left (a file open in another program).
  async function migrateLegacy() {
    await ready();
    const base = await fsSync.promises.realpath(vaultBase());
    if (!fsSync.existsSync(require('node:path').join(base, 'Canvas'))) return null;
    const courses = data.snapshot?.courses || [];
    // Courses only known from their old folder name ("线性代数（荣誉） (98418)") are matched to a folder too.
    const named = fsSync.readdirSync(require('node:path').join(base, 'Canvas')).map(n => ({ id: n.match(/\((\d+)\)$/)?.[1], name: n.replace(/\s*\(\d+\)$/, '') })).filter(c => c.id);
    const links = { ...guessLinks(named, vaultFolders()), ...courseLinks() };
    for (const c of named) links[c.id] ||= defaultFolder(c);
    const { moved, notes, left } = await moveCanvasFolder({ vault: base, links, courses });
    const map = p => (typeof p === 'string' && moved.get(p)) || p;
    const pc = data.pullCache || {};
    const files = Object.fromEntries(Object.entries(pc.files || {}).map(([k, v]) => [k, { ...v, path: map(v.path) }]));
    const mirrored = Object.fromEntries(Object.entries(pc.mirrored || {}).map(([k, v]) => [k, map(v)]));
    data = { ...data, courseLinks: { ...links, ...(data.courseLinks || {}) }, pullCache: { ...pc, files, mirrored } };
    // The files as downloaded are now in the store: file the ones the course folders don't have yet.
    const report = { added: [], duplicates: 0, failed: [], unlinked: [], index: [] }, shownOf = new Map();
    for (const c of courses) {
      const ids = (c.files || []).map(f => String(f.id)).filter(id => files[c.id + '/' + id]);
      if (!ids.length) continue;
      try { for (const [id, p] of await placeFiles(c, files, ids, report)) shownOf.set(files[c.id + '/' + id].path, p); }
      catch (e) { report.failed.push({ course: c.name, name: '', error: e.message }); }
    }
    const digests = await rewriteLinks({ vault: base, notes, moved, shown: old => shownOf.get(map(old)) });
    const noteCache = Object.fromEntries(Object.entries(pc.notes || {}).map(([k, v]) => {
      const p = map(v.path), d = digests.get(p);
      // Rewritten links keep a generated note Graphite's own; a note the student edited stays theirs.
      return [k, { ...v, path: p, digest: d && d.before === v.digest ? d.after : v.digest }];
    }));
    const migration = { at: new Date().toISOString(), moved: moved.size, notes: notes.length, added: report.added.length, left,
      folders: [...new Set([...moved.values()].map(p => p.split('/')[0]).filter(f => f !== '.obsidian'))] };
    await save({ ...data, pullCache: { ...data.pullCache, files, notes: noteCache }, migration });
    return migration;
  }
  if (migrate) { const t = setTimeout(() => exclusive(migrateLegacy).catch(e => { authError ||= e.message; }), 1500); t.unref?.(); }
  // Automatic pull: shortly after the app starts, then every few hours while connected. Files already pulled are
  // not downloaded again; new ones are copied into the linked course folders (see canvas-mirror.js).
  if (autoPullMs) {
    const autoPull = async () => {
      try {
        await exclusive(ready);
        if (activePull || data.autoMirror === false || !view().connected || waitingForWebLogin()) return;
        if (data.portalSyncEnabled && !desktop?.syncWeb) return;
        await runPull(null, true);
      } catch { /* shown on the next manual pull */ }
    };
    const first = setTimeout(autoPull, 120000); first.unref?.();
    const every = setInterval(autoPull, autoPullMs); every.unref?.();
  }
  if(desktop?.syncWeb) {
    const tick=setInterval(async()=>{
      if(webSyncing)return;
      webSyncing=true;
      try{
        // Only the check holds the lock; the read itself saves course by course and stays usable meanwhile.
        await exclusive(ready);
        if(data.portalSyncEnabled && data.webVerified && Date.now()-(Date.parse(data.syncedAt)||0)>14*60000) await syncWeb(true);
      }
      catch{}finally{webSyncing=false;}
    },15*60000);tick.unref?.();
  }
  return { handle, migrateLegacy: () => exclusive(migrateLegacy) };
}
module.exports = { createCanvasService };
