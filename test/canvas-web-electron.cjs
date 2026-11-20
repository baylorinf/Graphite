// node test/canvas-web-electron.cjs [path to unpacked application]
// Native, headless fixtures for the jAccount flow. No school site is contacted.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const origin = 'https://oc.sjtu.edu.cn';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const incoming = Buffer.from('Synthetic worksheet\n');
const feedUrl = origin + '/feeds/calendars/example_native_fixture.ics';

async function until(read, check, label, timeout=45000) {
  const end = Date.now()+timeout;
  let result;
  do {
    result = await read();
    if (check(result)) return result;
    await sleep(120);
  } while(Date.now()<end);
  throw new Error('Timed out waiting for '+label+': '+JSON.stringify(result));
}

async function runElectron() {
  const {app,BrowserWindow,session,safeStorage} = require('electron');
  const temp = process.env.GRAPHITE_NATIVE_FIXTURE_ROOT;
  assert(temp && path.dirname(temp)===os.tmpdir());
  const project = process.env.GRAPHITE_NATIVE_FIXTURE_APP;
  app.setPath('userData',path.join(temp,'profile'));
  app.on('window-all-closed',()=>{});
  await app.whenReady();
  const vault = path.join(temp,'vault');
  const requests = [], wrongHost = [], protocolSessions = new Set();
  let logged=true, denyFiles=false, submitted=false, windowShown=false;
  function html(main, extra='') {
    const account=logged ? '<a id="global_nav_profile_link" href="/profile/settings"><span class="avatar-name">Native Fixture</span></a>' : '';
    return '<!doctype html><meta charset="utf-8">'+account+extra+'<main id="content">'+main+'</main>';
  }
  function link(url,text) { return '<a href="'+url+'">'+text+'</a>'; }
  function render(u) {
    const p=u.pathname;
    if(!logged) return html('<h1>学校登录</h1><button>jAccount</button>');
    if(p==='/courses') return html('<table id="my_courses_table"><tbody><tr><td class="course-list-course-title-column">'+
      link('/courses/110','示例代数')+'</td></tr></tbody></table>');
    if(p==='/courses/110') return html('<h1>示例代数</h1>',
      '<nav id="section-tabs">'+link('/courses/110/assignments','作业')+link('/courses/110/files','文件')+
      '<span class="section-tab-hidden">'+link('/courses/110/pages','未启用')+'</span></nav>');
    if(p==='/courses/110/assignments') return html('<ul><li class="assignment">'+link('/courses/110/assignments/310','矩阵作业')+
      ' <span class="due_date"><time datetime="2026-11-25T18:00:00+08:00">11 月 25 日 18:00</time></span></li></ul>');
    if(p==='/courses/110/assignments/310') return html('<h1>矩阵作业</h1><p class="assignment-submission-status">'+
      (submitted?'已提交':'Not yet submitted')+'</p><p class="due_date"><time datetime="2026-11-25T18:00:00+08:00">11 月 25 日 18:00</time></p>');
    if(p==='/courses/110/files' && denyFiles) return html('<h1>Access Denied</h1><div class="ic-flash-error">You do not have permission.</div>');
    if(p==='/courses/110/files') return html('<ul><li>'+link('/courses/110/files/folder/week1','第 1 周')+'</li></ul>');
    if(p==='/courses/110/files/folder/week1') return html('<p>'+link('/courses/110/files/folder/week1?preview=510','讲义.txt')+'</p>');
    if(p==='/courses/110/files/510') return html('<h1>讲义.txt</h1>'+link('/courses/110/files/510/download','下载'));
    if(p==='/calendar') return html('<button id="calendar-feed-button" onclick="document.querySelector(\'#calendar_feed_box\').hidden=false">订阅源</button>'+
      '<div id="calendar_feed_box" hidden>'+link(feedUrl,'本课程日程')+'</div>');
    return html('<h1>Not found</h1>');
  }
  function register(partition) {
    if(protocolSessions.has(partition)) return;
    protocolSessions.add(partition);
    partition.webRequest.onBeforeRequest((details,done)=>{
      const url=new URL(details.url);
      const allow=details.url==='about:blank' || url.origin===origin;
      if(!allow) wrongHost.push(url.origin);
      done({cancel:!allow});
    });
    partition.protocol.handle('https',async req=>{
      const url=new URL(req.url);
      if(url.origin!==origin) throw new Error('Test refused external origin');
      requests.push(url.pathname+url.search);
      if(url.pathname==='/courses/110/files/510/download') {
        return new Response(incoming,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':'attachment; filename="lecture.txt"','Content-Length':String(incoming.length)}});
      }
      return new Response(render(url),{headers:{'Content-Type':'text/html; charset=utf-8'}});
    });
  }
  const privateSession={ fromPartition(name) {const part=session.fromPartition(name);register(part);return part;} };
  // Only override presentation. Isolated renderer processes, network protocol, navigation and downloads are native.
  const testWindows=[];
  function HiddenWindow(options) {
    const w=new BrowserWindow({...options,show:false,paintWhenInitiallyHidden:true});
    testWindows.push(w);
    w.on('show',()=>{windowShown=true;});
    w.focus=()=>{};
    return w;
  }
  const {desktop,storage}=require(path.join(project,'electron/canvas-desktop.js')).createCanvasDesktop({
    app,BrowserWindow:HiddenWindow,session:privateSession,safeStorage,vault
  });
  const feedText=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Graphite test//EN','BEGIN:VEVENT','UID:deadline-1',
    'DTSTAMP:20261120T000000Z','DTSTART:20261125T100000Z','DTEND:20261125T110000Z','SUMMARY:作业日程',
    'END:VEVENT','END:VCALENDAR',''].join('\r\n');
  const service=require(path.join(project,'canvas-service.js')).createCanvasService({vault,storage,desktop,
    clientId:'',clientSecret:'',fetch:async url=>{assert.equal(String(url),feedUrl);return new Response(feedText);}});
  const status=()=>service.handle('GET','status');
  const act=(action,body)=>service.handle('POST',action,body);
  try {
    const initial=await status();
    assert(!initial.configured && !initial.connected && initial.portalSupported);
    assert.equal((await act('web-connect')).opened,true);
    const s=await until(status,s=>s.syncedAt && !s.authPending,'isolated school sync');
    assert.equal(s.connected,true);assert.equal(s.canSubmit,false);assert.equal(s.authMode,'web');
    assert.equal(s.user,'Native Fixture');
    const [course]=s.snapshot.courses;
    assert.equal(course.name,'示例代数');assert.deepEqual(course.assignments.map(x=>[x.id,x.dueAt,x.submitted]),[['310','2026-11-25T10:00:00.000Z',false]]);
    assert.deepEqual(course.files.map(x=>[x.id,x.name]),[['510','讲义.txt']]);
    assert(!requests.includes('/courses/110/pages'));
    assert(s.calendar.events.some(x=>x.title==='作业日程'));
    const restored=await storage.load();
    assert.equal(restored.webVerified,true);
    assert.equal(restored.snapshot.courses[0].assignments[0].id,'310');
    console.log('PASS native hidden window, DOM collection, declared deadline, visible file folder and subscribed calendar');
    await act('portal',{courseId:'110',assignmentId:'310'});
    await until(()=>testWindows.find(w=>!w.isDestroyed() && w.webContents.getURL().endsWith('/assignments/310')),Boolean,'official assignment');
    submitted=true;
    const after=await act('sync');
    assert.equal(after.snapshot.courses[0].assignments[0].submitted,true);
    console.log('PASS official assignment and updated submission status after a school-side change');
    const downloaded=await Promise.race([act('download',{courseId:'110',fileId:'510'}),
      sleep(20000).then(()=>{throw new Error('Native attachment did not arrive');})]);
    assert.deepEqual(await fs.promises.readFile(path.join(vault,downloaded.path)),incoming);
    assert.equal((await status()).lastDownload,downloaded.path);
    console.log('PASS native desktop download, vault copy and exact bytes');
    denyFiles=true;
    const partial=await act('sync');
    assert(partial.snapshot.courses[0].warnings.some(w=>w.includes('学校未开放')));
    assert.equal(partial.snapshot.courses[0].assignments[0].title,'矩阵作业');
    logged=false;
    await assert.rejects(act('sync'),e=>e.status===401);
    const expired=await status();assert(!expired.connected && expired.authError);
    assert(expired.snapshot.courses.length);assert(!windowShown);assert.deepEqual(wrongHost,[]);
    await act('disconnect');
    assert.equal((await status()).snapshot.courses.length,0);
    console.log('PASS restricted course section, expired login, previous account reset and zero visible windows');
  } finally {
    for(const w of BrowserWindow.getAllWindows()) if(!w.isDestroyed()) w.destroy();
    for(const part of protocolSessions) part.protocol.unhandle('https');
  }
}

if (process.versions.electron && process.env.GRAPHITE_NATIVE_FIXTURE_ROOT) {
  runElectron().then(()=>require('electron').app.exit(0),error=>{console.error(error);require('electron').app.exit(1);});
} else {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'graphite-native-canvas-'));
  const profile=path.join(root,'profile');
  fs.mkdirSync(profile);fs.mkdirSync(path.join(root,'vault'));
  const project=path.resolve(process.argv[2] || path.join(__dirname,'..'));
  const binary=process.env.GRAPHITE_TEST_ELECTRON || require('electron');
  const env={...process.env,GRAPHITE_NATIVE_FIXTURE_ROOT:root,GRAPHITE_NATIVE_FIXTURE_APP:project};
  delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(binary,['--user-data-dir='+profile,'--disable-gpu','--disable-background-networking',
    '--host-resolver-rules=MAP * ~NOTFOUND',__filename],{env,windowsHide:true,stdio:'inherit'});
  child.on('exit',code=>{try{fs.rmSync(root,{recursive:true,force:true,maxRetries:2});}catch{}process.exitCode=code ?? 1;});
}
