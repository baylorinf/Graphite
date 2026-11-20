'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCanvasService } = require('../canvas-service');
const { parseCalendar, feedUrl } = require('../canvas-calendar');
const { createCanvasDesktop, studyFilename, publishDownload, downloadDir } = require('../electron/canvas-desktop');
const { EventEmitter } = require('node:events');

const ORIGIN = 'https://oc.sjtu.edu.cn';
const FEED = ORIGIN + '/feeds/calendars/user_fixture.ics';
const ICS = ['BEGIN:VCALENDAR','VERSION:2.0','BEGIN:VEVENT','UID:deadline','DTSTART;TZID=Asia/Shanghai:20261120T193000',
  'SUMMARY:Linear Algebra\\, ',' problem set','URL:https://oc.sjtu.edu.cn/courses/7/assignments/9','END:VEVENT',
  'BEGIN:VEVENT','UID:holiday','DTSTART;VALUE=DATE:20261121','SUMMARY:Study day','END:VEVENT','END:VCALENDAR'].join('\r\n');

function fake() {
  let saved = {}, launch, returned, broken = false, rejectRefresh = false;
  const calls = [], storage = { load: async () => structuredClone(saved), save: async next => { saved = structuredClone(next); } };
  const desktop = { openAuth: (url, cb) => { launch = new URL(url); returned = cb; }, clearSession: async () => {}, openPortal() {} };
  const fetch = async (raw, opts) => {
    const u = new URL(raw), method = opts.method || 'GET';
    calls.push([u.pathname, method]);
    if (u.href === FEED) return new Response(broken ? 'unavailable' : ICS);
    if (u.pathname === '/login/oauth2/token') {
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (opts.body.get('grant_type') === 'refresh_token' && rejectRefresh) return Response.json({}, {status:400});
      const id = opts.body.get('code') || '7';
      return Response.json({ access_token: 'test', refresh_token: 'next', expires_in: rejectRefresh ? 0.01 : 3600,
        user: { id, name: 'Fixture Student' } });
    }
    if (u.pathname === '/api/v1/courses') return Response.json([]);
    throw Error('unexpected request');
  };
  const svc = createCanvasService({ vault: os.tmpdir(), storage, desktop, fetch, clientId: 'fixture-client', clientSecret:'fixture-secret' });
  const handle = (a, body) => svc.handle(a === 'status' ? 'GET' : 'POST', a, body);
  async function login(id, mismatch = false) {
    await handle('connect');
    assert.equal(launch.origin, ORIGIN);
    assert.equal(launch.searchParams.get('redirect_uri'), 'urn:ietf:wg:oauth:2.0:oob');
    assert.equal(launch.searchParams.has('client_secret'), false);
    await returned(ORIGIN + '/login/oauth2/auth?code=' + id + '&state=' + (mismatch ? 'wrong' : launch.searchParams.get('state')));
  }
  return { handle, login, calls, broken: () => { broken = true; }, expire: () => { rejectRefresh = true; } };
}

test('Canvas iCal handles Shanghai local time, folded text, all-day dates and cancellation', () => {
  const events = parseCalendar(ICS);
  assert.equal(events.length, 2);
  assert.equal(events[0].startAt, '2026-11-20T11:30:00.000Z');
  assert.equal(events[0].title, 'Linear Algebra, problem set');
  assert.equal(events[1].startAt, '2026-11-21');
  assert.equal(events[1].allDay, true);
  assert.equal(parseCalendar(ICS.replace('UID:holiday','UID:holiday\r\nSTATUS:CANCELLED')).length, 1);
  assert.equal(feedUrl(FEED.replace('https:', 'webcal:')), FEED);
  assert.throws(() => feedUrl('https://example.com/feeds/calendars/user_x.ics'));
});
test('recurring deadlines respect EXDATE and changed occurrence', () => {
  const recurrence=['BEGIN:VCALENDAR','BEGIN:VEVENT','UID:r','DTSTART:20261120T010000Z','SUMMARY:Class',
    'RRULE:FREQ=DAILY;COUNT=3','EXDATE:20261121T010000Z','END:VEVENT','BEGIN:VEVENT','UID:r',
    'RECURRENCE-ID:20261122T010000Z','DTSTART:20261122T030000Z','SUMMARY:Moved','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const out=parseCalendar(recurrence,Date.UTC(2026,10,20));
  assert.deepEqual(out.map(x=>x.startAt),['2026-11-20T01:00:00.000Z','2026-11-22T03:00:00.000Z']);
});
test('failed feed refresh keeps old events and subscription is never returned', async () => {
  const f = fake();
  const result = await f.handle('calendar', { url: FEED });
  assert.equal(result.calendar.events.length, 2);
  assert.ok(!JSON.stringify(result).includes('user_fixture'));
  f.broken();
  await assert.rejects(f.handle('sync'));
  assert.equal((await f.handle('status')).calendar.syncedAt, result.calendar.syncedAt);
  assert.equal((await f.handle('calendar-remove')).calendar, null);
});
test('OAuth validates state, completes official flow and cleans another account’s cache', async () => {
  const f = fake();
  await f.login('8',true);
  assert.equal((await f.handle('status')).connected,false);
  assert.equal(f.calls.length,0);
  await f.login('8');
  assert.equal((await f.handle('status')).connected,true);
  await f.handle('calendar',{url:FEED});
  const result = await f.handle('sync');
  assert.equal(result.user,'Fixture Student'); assert.ok(result.syncedAt);
  assert.ok(!JSON.stringify(result).includes('refreshToken'));
  await f.login('9');
  assert.equal((await f.handle('status')).syncedAt,null);
  assert.equal((await f.handle('status')).calendar,null);
  const after=await f.handle('disconnect'); assert.equal(after.connected,false); assert.equal(after.user,'');
  assert.ok(f.calls.some(([p,m])=>p === '/login/oauth2/token' && m === 'DELETE'));
});
test('expired authorization leaves the calendar usable', async () => {
  const f=fake(); f.expire(); await f.login('8'); await f.handle('calendar',{url:FEED});
  const result=await f.handle('sync');
  assert.equal(result.connected,false); assert.equal(result.calendar.events.length,2); assert.ok(result.snapshot.warnings.length);
});
test('checking a submission requires this signed-in account and reads a fresh record without replaying a pending request', async () => {
  let state={portalSyncEnabled:true,webVerified:true,user:'同名同学',snapshot:{webIdentity:'31',courses:[{id:'7',
    assignments:[{id:'10',submitted:true,attempt:3,submissionEvidence:{status:'submitted',attempt:3}}]}]},
    requests:{previous:{pending:true}}};
  const calls=[],unknown={status:'unknown',attempt:null,submittedAt:null};
  const svc=createCanvasService({storage:{load:async()=>structuredClone(state),save:async next=>{state=next;}},
    desktop:{verifyWebSubmission:async args=>{calls.push(args);if(calls.length===1)throw Error('offline');return unknown;}}});
  const accountKey=(await svc.handle('GET','status')).accountKey, form={courseId:'7',assignmentId:'10',accountKey};
  await assert.rejects(svc.handle('POST','verify-submission',{...form,accountKey:'other'}),{status:409});
  await assert.rejects(svc.handle('POST','verify-submission',{...form,assignmentId:'bad'}),{status:400});assert.equal(calls.length,0);
  await assert.rejects(svc.handle('POST','verify-submission',form),{status:502});
  assert.deepEqual(await svc.handle('POST','verify-submission',form),{...form,...unknown});
  assert.deepEqual(calls,[1,2].map(()=>({courseId:'7',assignmentId:'10',expectedIdentity:'31'})));
  assert.equal(state.requests.previous.pending,true);assert.equal(state.snapshot.courses[0].assignments[0].attempt,3);
});
test('draft owner survives an expired OAuth session and a new authorization for the same person', async () => {
  const f = fake();
  assert.equal((await f.handle('status')).accountKey,null);
  f.expire();
  await f.login('81234');
  const signedIn = await f.handle('status');
  assert.match(signedIn.accountKey,/^[a-f0-9]{64}$/);
  await assert.rejects(f.handle('sync'));
  const expired = await f.handle('status');
  assert.equal(expired.connected,false); assert.equal(expired.accountKey,signedIn.accountKey);
  await f.login('81234');
  assert.equal((await f.handle('status')).accountKey,signedIn.accountKey);
  await f.login('81235');
  const switched = await f.handle('status');
  assert.equal(switched.user,signedIn.user); assert.notEqual(switched.accountKey,signedIn.accountKey);
  assert.equal((await f.handle('disconnect')).accountKey,null);
});
test('legacy OAuth owner survives refresh failure, including a refresh for a different user', async () => {
  for (const mismatch of [false,true]) {
    let state = {user:'同名同学',auth:{accessToken:'fixture-a',refreshToken:'fixture-b',userId:'81234',expires:1}};
    const svc = createCanvasService({storage:{load:async()=>state,save:async v=>{state=v;}},
      fetch:async () => mismatch ? Response.json({access_token:'wrong',user:{id:'81235',name:'同名同学'}}) : Response.json({}, {status:401})});
    const signedIn = await svc.handle('GET','status');
    assert.match(signedIn.accountKey,/^[a-f0-9]{64}$/);
    await assert.rejects(svc.handle('POST','sync'));
    const expired = await svc.handle('GET','status');
    assert.equal(expired.connected,false); assert.equal(expired.accountKey,signedIn.accountKey);
    assert.equal(state.auth,null);
  }
});
test('jAccount drafts use school identity, independent of display name and the OAuth namespace', async () => {
  const oauth = fake(); await oauth.login('81234');
  const oauthKey = (await oauth.handle('status')).accountKey;
  let state={}, id='81234',expired=false,finish;
  const desktop = {
    openWebLogin:cb=>{finish=cb;},clearSession:async()=>{},
    syncWeb:async()=>{
      if (expired) throw Object.assign(new Error('return to login'),{status:401});
      return {user:'同名同学',snapshot:{courses:[],warnings:[],webIdentity:id},syncedAt:new Date().toISOString()};
    },
  };
  const svc=createCanvasService({desktop,storage:{load:async()=>state,save:async next=>{state=next;}}});
  const login=async()=>{await svc.handle('POST','web-connect'); await finish(true); return svc.handle('GET','status');};
  const initial = await login();
  assert.equal(initial.connected,true); assert.match(initial.accountKey,/^[a-f0-9]{64}$/);
  assert.notEqual(initial.accountKey,oauthKey);
  expired=true; await assert.rejects(svc.handle('POST','sync'));
  assert.equal((await svc.handle('GET','status')).accountKey,initial.accountKey);
  assert.equal((await svc.handle('GET','status')).connected,false);
  expired=false; assert.equal((await login()).accountKey,initial.accountKey);
  id='81235'; const switched=await svc.handle('POST','sync');
  assert.equal(switched.user,initial.user); assert.notEqual(switched.accountKey,initial.accountKey);
  id=null; const unidentified=await svc.handle('POST','sync');
  assert.equal(unidentified.connected,true); assert.equal(unidentified.accountKey,null);
  assert.equal((await svc.handle('POST','disconnect')).accountKey,null);
});
test('web reconnection temporarily hides history and restores it only after confirming the same school ID', async () => {
  const initial={portalSyncEnabled:true,webVerified:true,user:'同名同学',snapshot:{webIdentity:'801',courses:[{id:'6',name:'旧课程'}]},
    calendar:{events:[]},lastPull:{saved:4},pullCache:{owner:'web:801',files:{a:'previous attachment'}},
    requests:{pendingAttempt:{pending:true},confirmedAttempt:{receipt:{id:'31'}}},pullSessionId:'previous session'};
  let state, finish, nextId, broken, lastPath;
  const service=()=>createCanvasService({
    storage:{load:async()=>structuredClone(state),save:async next=>{state=structuredClone(next);}},
    desktop:{openWebLogin:cb=>{finish=cb;},lastDownload:()=>lastPath,clearLastDownload:()=>{lastPath=null;},
      syncWeb:async options=>{
        if (broken) throw Error('network unavailable');
        assert.equal(options.previousSnapshot?.webIdentity,'801');
        return {user:'同名同学',snapshot:{webIdentity:nextId,courses:[{id:'7',name:'当前课程'}]},syncedAt:new Date().toISOString()};
      },
    },
  });
  for(const next of ['801','802',null]) {
    state=structuredClone(initial); nextId=next; broken=false; lastPath='old-local.pdf';
    let svc=service();
    const handle=(action,body)=>svc.handle(action==='status'?'GET':'POST',action,body);
    const first=await handle('status');
    await handle('web-connect');
    function hidden(v) {
      assert.equal(v.connected,false); assert.equal(v.accountKey,null); assert.deepEqual(v.snapshot.courses,[]);
      assert.equal(v.canSubmitFiles,false); assert.equal(v.lastPull,null); assert.equal(v.lastDownload,null); assert.equal(v.calendar,null);
    }
    hidden(await handle('status')); await assert.rejects(handle('pull')); await assert.rejects(handle('download',{}));
    await finish(false); assert.deepEqual((await handle('status')).snapshot,initial.snapshot);
    assert.deepEqual(state,initial);
    broken=true; await handle('web-connect'); await finish(true);
    hidden(await handle('status')); assert.deepEqual(state.pullCache,initial.pullCache);
    svc=service(); hidden(await handle('status')); await assert.rejects(handle('pull')); await assert.rejects(handle('submit',{}));
    broken=false; const after=await handle('sync');
    assert.equal(after.connected,true); assert.equal(after.snapshot.courses[0].name,'当前课程');
    if(next==='801') {
      assert.equal(after.accountKey,first.accountKey); assert.deepEqual(after.lastPull,initial.lastPull); assert.deepEqual(state.requests,initial.requests);
      assert.deepEqual(state.pullCache,initial.pullCache); assert.equal(after.lastDownload,'old-local.pdf');
    } else {
      assert.notEqual(after.accountKey,first.accountKey); assert.equal(after.accountKey===null,next===null); assert.equal(after.lastPull,null);
      assert.equal(state.pullCache,undefined); assert.equal(state.requests,undefined); assert.equal(state.pullSessionId,null);
      assert.equal(after.calendar,null); assert.equal(after.lastDownload,null);
    }
  }
});
test('a long-open school login stays private and its original window handles retry, cancellation or success', async t => {
  let now=Date.now(),failOpen=false;
  t.mock.method(Date,'now',()=>now);
  let state={portalSyncEnabled:true,webVerified:true,user:'同名同学',snapshot:{webIdentity:'71',courses:[{id:'2'}]},
    lastPull:{saved:1}},callback,opened=0;
  const svc=createCanvasService({storage:{load:async()=>state,save:async v=>{state=v;}},
    desktop:{openWebLogin:cb=>{
      if(failOpen)throw Error('window failed');
      opened++; if(!callback)callback=cb; // desktop focuses the existing window and keeps its first callback.
    },syncWeb:async()=>({user:'同名同学',snapshot:{webIdentity:'71',courses:[{id:'2'}]},syncedAt:new Date().toISOString()})}});
  const run=action=>svc.handle(action==='status'?'GET':'POST',action);
  const original=(await run('status')).accountKey;assert.ok(original);
  failOpen=true;await assert.rejects(run('web-connect'));assert.equal((await run('status')).accountKey,original);failOpen=false;
  for(const accept of [false,true]) {
    await run('web-connect');await run('web-connect');const count=opened;
    now+=16*60000;
    const waiting=await run('status');assert.equal(waiting.authPending,false);assert.equal(waiting.accountKey,null);assert.deepEqual(waiting.snapshot.courses,[]);
    await assert.rejects(run('sync'));await assert.rejects(run('connect'));
    failOpen=true;await assert.rejects(run('web-connect'));assert.equal((await run('status')).accountKey,null);failOpen=false;
    await run('web-connect');assert.equal(opened,count+1);assert.equal((await run('status')).authPending,true);
    await callback(accept);callback=null;
    const done=await run('status');assert.equal(done.authPending,false);assert.equal(done.accountKey,original);assert.equal(done.lastPull.saved,1);
  }
});
test('official window downloads keep same-name material and hide unfinished files', async () => {
  const vault=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-canvas-docs-'));
  try {
    assert.equal(studyFilename('../课程/notes.pdf'),'notes.pdf'); assert.equal(studyFilename('class.exe'),null);
    assert.equal(studyFilename('CON.docx'),'_CON.docx');
    const dir=downloadDir(vault), temp=path.join(dir,'.tmp');
    await fs.writeFile(temp,'new'); await fs.writeFile(path.join(dir,'slides.pdf'),'old');
    assert.equal(await publishDownload(vault,temp,'slides.pdf'),'Canvas/Downloads/slides (2).pdf');
    assert.equal(await fs.readFile(path.join(dir,'slides.pdf'),'utf8'),'old');
  } finally { await fs.rm(vault,{recursive:true,force:true}); }
});
test('desktop portal uses a separate session and only the school callback completes OAuth', async () => {
  const vault=await fs.mkdtemp(path.join(os.tmpdir(),'canvas-portal-'));
  const ses=Object.assign(new EventEmitter(),{setPermissionRequestHandler(){},setPermissionCheckHandler(){},clearCache:async()=>{},clearStorageData:async()=>{}});
  const windows=[]; let partition;
  class Window extends EventEmitter {
    constructor(options) { super(); this.options=options; this.webContents=new EventEmitter();
      this.webContents.setWindowOpenHandler=()=>{}; windows.push(this); }
    isDestroyed(){return this.closed;} removeMenu(){} async loadURL(u){this.url=u;} close(){this.closed=true;this.emit('closed');}
  }
  try {
    const {desktop}=createCanvasDesktop({app:{getPath:()=>vault},BrowserWindow:Window,session:{fromPartition:p=>(partition=p,ses)},safeStorage:{},vault});
    desktop.openPortal(); assert.equal(windows[0].url,ORIGIN); assert.ok(partition.startsWith('persist:graphite-sjtu-'));
    let cb=null; desktop.openAuth(ORIGIN+'/login/oauth2/auth',u=>{cb=u;});
    assert.equal(windows[1].options.webPreferences.nodeIntegration,false);
    const event=url=>({url,isMainFrame:true,preventDefault(){this.prevented=true;}});
    let ev=event('https://example.com/login/oauth2/auth?code=test'); windows[1].webContents.emit('will-redirect',ev);
    assert.ok(ev.prevented); assert.equal(cb,null);
    ev=event(ORIGIN+'/login/oauth2/auth?code=test&state=test');windows[1].webContents.emit('will-redirect',ev);
    assert.equal(cb,ev.url);
  } finally { await fs.rm(vault,{recursive:true,force:true}); }
});
