'use strict';
const { randomBytes, createHash } = require('node:crypto');
const { createSubmissionClient, WRITE_SCOPES } = require('./canvas-submission');
const { createCanvasApi, SCOPES } = require('./canvas-api');
const { feedUrl, getCalendar } = require('./canvas-calendar');

const SITE = 'https://oc.sjtu.edu.cn';
const OOB = 'urn:ietf:wg:oauth:2.0:oob';
const error = (status, message) => Object.assign(new Error(message), { status });

// The desktop owns encrypted storage and the isolated school window. The browser
// preview can use a calendar for this server session without persisting a private URL.
function createCanvasService({ vault, storage, desktop, fetch: fetchImpl = fetch,
    clientId = process.env.GRAPHITE_CANVAS_CLIENT_ID, clientSecret = process.env.GRAPHITE_CANVAS_CLIENT_SECRET }) {
  let data, pending, tail = Promise.resolve(), authError = '', refreshing, webSyncing = false, readingSchool = false;
  const configured = !!(clientId && clientSecret && desktop?.openAuth);
  function exclusive(fn) {
    const result = tail.then(fn, fn);
    tail = result.catch(() => {});
    return result;
  }
  async function ready() {
    if (!data) data = (await storage?.load()) || {};
  }
  async function save(next) {
    if (storage) await storage.save(next);
    data = next;
  }
  function view() {
    const web = !!data.portalSyncEnabled;
    return { connected: web ? !!data.webVerified : !!data.auth, configured, sessionOnly: !storage, user: data.user || '',
      portalSupported: !!desktop?.openWebLogin, portalSyncEnabled: web,syncing:readingSchool, canSubmit: !web && !!data.auth && !!data.writeEnabled,
      authMode: web ? 'web' : (data.auth || configured ? 'oauth' : null), authPending: !!pending && pending.until > Date.now(),
      authError, syncedAt: data.syncedAt || null, snapshot: data.snapshot || { courses: [], warnings: [] },
      calendar: data.calendar || null, portalOpened: !!data.portalOpened, lastDownload: desktop?.lastDownload?.() || null };
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
        await save({ ...data, auth: { ...t, refreshToken: t.refreshToken || auth.refreshToken,
          userId: t.userId || auth.userId } });
        return t.accessToken;
      } catch (e) {
        if (e.status === 401) { authError = '授权已过期，请重新连接交大 Canvas。'; await save({ ...data, auth: null }); }
        throw e;
      }
    })();
    try { return await refreshing; } finally { refreshing = null; }
  }
  const api = createCanvasApi({ vault, fetch: fetchImpl, accessToken });
  const submissions = createSubmissionClient({fetch:fetchImpl, accessToken});
  async function syncWeb(background=false) {
    readingSchool=true;
    try {
      const result = await desktop.syncWeb({background, previousSnapshot:data.snapshot, previousUser:data.user});
      if (!data.portalSyncEnabled) return;
      let calendar = data.calendar, url=data.feed;
      if (!data.feedMuted && result.feed) {
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
      authError='';
      await save({...data, webVerified:true, user:result.user, snapshot:result.snapshot, syncedAt:result.syncedAt,
        feed:url, calendar, feedAutomatic:!!result.feed && !data.feedMuted});
    } catch(e) {
      authError=e.message;
      if(e.status===401) await save({...data,webVerified:false});
      throw e;
    } finally {readingSchool=false;}
  }
  async function downloadOne(courseId,fileId) {
    if (data.portalSyncEnabled) {
      if (!data.webVerified) throw error(401,'请重新登录学校网站。');
      const course=data.snapshot?.courses.find(c=>String(c.id)===String(courseId));
      const file=course?.files.find(f=>String(f.id)===String(fileId));
      if (!file || !/^\d+$/.test(String(file.id))) throw error(404,'请先同步此课件。');
      return desktop.downloadWeb(course,file);
    }
    if (!data.auth) throw error(401,'请先连接交大 Canvas。');
    return api.download(courseId,fileId,data.snapshot||{});
  }
  async function submit(body) {
    if(!data.auth || data.portalSyncEnabled || !data.writeEnabled) throw error(403,'请先授权提交作业，或在学校原站提交。');
    const {requestId,courseId,assignmentId}=body;
    if(body.confirmed!==true || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(requestId||''))throw error(400,'请核对作业后确认提交。');
    if(!data.snapshot?.courses.some(c=>String(c.id)===courseId && c.assignments.some(a=>String(a.id)===assignmentId)))throw error(404,'请先同步此作业。');
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
      result=await submissions.submit(body,{beforePost:async()=>{await update({pending:true});started=true;}});
    } catch(e) {
      if(started && e.code==='submission_unknown') throw unknown();
      if(started) await update(null);
      throw e;
    }
    try {
      await update({receipt:result});
      const snapshot=structuredClone(data.snapshot);
      const assignment=snapshot.courses.find(c=>String(c.id)===courseId).assignments.find(a=>String(a.id)===assignmentId);
      Object.assign(assignment,{submitted:true,attempt:result.attempt,submittedAt:result.submittedAt});
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
      const same = !!t.userId && data.accountId === t.userId;
      await save({ ...data, auth: t, user: t.user, accountId: t.userId, portalSyncEnabled:false,
        writeEnabled:expected.submit,requests:same?data.requests:undefined,
        snapshot: same ? data.snapshot : null, syncedAt: same ? data.syncedAt : null,
        // A separately added private feed belongs to its own subscription; never carry it across a known account switch.
        ...(data.accountId && !same ? { feed: null, calendar: null } : {}) });
      authError = '';
    } catch (e) { authError = e.message; }
  }

  async function handle(method, action, body = {}) {
    if(method==='GET' && action==='status' && data)return view();
    return exclusive(async () => {
      await ready();
      if (method === 'GET' && action === 'status') return view();
      if (method !== 'POST') throw error(405, 'Method not allowed');
      if (action === 'portal') {
        let target;
        if(body.courseId || body.assignmentId) {
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
        const request={web:true,until:Date.now()+15*60000}; pending=request;authError='';
        await desktop.openWebLogin(ok=>exclusive(async()=>{
          if(pending!==request)return;
          if(!ok){pending=null;return;}
          try{
            await save({...data,portalSyncEnabled:true,portalOpened:true,webVerified:true,user:'',snapshot:null,syncedAt:null,
              calendar:null,feed:null,feedAutomatic:false,feedMuted:false,auth:null,accountId:null,requests:undefined,writeEnabled:false});
            await syncWeb();
          } catch(e){authError=e.message;}finally{if(pending===request)pending=null;}
        }));
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
        if(data.portalSyncEnabled){await syncWeb();return view();}
        if (!data.auth && !data.feed) throw error(401, '请先连接 Canvas 或添加日历订阅。');
        const issues = [];
        let done = false, firstError;
        if (data.auth) {
          try {
            const snapshot = await api.sync(data.snapshot || undefined);
            await save({ ...data, snapshot, syncedAt: new Date().toISOString() });
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
        return downloadOne(body.courseId,body.fileId);
      }
      if(action==='submit') return submit(body);
      if (action === 'download-course') {
        if (!view().connected) throw error(401, '请先连接交大 Canvas。');
        const course = data.snapshot?.courses.find(c => String(c.id) === String(body.courseId));
        if (!course) throw error(404, '请先同步此课程。');
        const result = { saved: 0, unchanged: 0, failed: [] };
        for (const file of course.files) {
          try {
            const item = await downloadOne(course.id,file.id);
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
    });
  }
  if(desktop?.syncWeb) {
    const tick=setInterval(async()=>{
      if(webSyncing)return;
      webSyncing=true;
      try{await exclusive(async()=>{await ready();if(data.portalSyncEnabled && data.webVerified && Date.now()-(Date.parse(data.syncedAt)||0)>14*60000)await syncWeb(true);});}
      catch{}finally{webSyncing=false;}
    },15*60000);tick.unref?.();
  }
  return { handle };
}
module.exports = { createCanvasService };
