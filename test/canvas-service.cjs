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
