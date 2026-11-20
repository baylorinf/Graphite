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
  let logged=true, denyFiles=false, submitted=false, windowShown=false, pledge=false, attempt=0, enhanced=false, previousDraft=false;
  const received=[];
  function html(main, extra='') {
    const account=logged ? '<a id="global_nav_profile_link" href="/users/55/profile"><span class="avatar-name">Native Fixture</span></a>' : '';
    return '<!doctype html><meta charset="utf-8">'+account+extra+'<main id="content">'+main+'</main>';
  }
  function link(url,text) { return '<a href="'+url+'">'+text+'</a>'; }
  function enhancedFixture(){
    const tracker='<input data-testid="attemptSelect" value="Attempt 1" readonly><p data-testid="submission-workflow-tracker-title">'+(submitted?'Submitted on November 21':'In Progress')+'</p>';
    const files=received.at(-1)||[];
    const complete='<div data-testid="file-preview"><table data-testid="uploaded_files_table"><tbody>'+
      files.map(f=>'<tr><td></td><td><span>'+f.name+'</span></td><td>size</td><td data-testid="download-file">Download</td></tr>').join('')+'</tbody></table></div>';
    const draft='<div data-testid="submission-type-selector"><span data-testid="online_upload"><button type="button" id="choose-type">File upload</button></span></div>'+
      '<div data-testid="upload-pane" hidden><div data-testid="upload-box"><input type="file" id="inputFileDrop" multiple></div>'+
      '<table data-testid="uploaded_files_table"><tbody id="selected-files">'+(previousDraft?'<tr><td></td><td>previous draft.txt</td></tr>':'')+'</tbody></table></div>'+
      '<button id="submit-button" data-testid="submit-button">Submit Assignment</button>'+
      '<script>document.getElementById("choose-type").onclick=()=>document.querySelector("[data-testid=upload-pane]").hidden=false;'+
      'const picker=document.querySelector("#inputFileDrop"),table=document.querySelector("#selected-files");'+
      'picker.onchange=()=>{for(const f of picker.files){const row=table.insertRow();row.insertCell();row.insertCell().textContent=f.name;}};'+
      'document.getElementById("submit-button").onclick=async()=>{const body=new FormData();for(const f of picker.files)body.append("attachment[]",f);'+
      'await fetch(location.pathname+"/submissions",{method:"POST",body});location.reload();};</script>';
    return html('<div data-testid="assignments-2-student-view">'+tracker+(submitted?complete:draft)+'</div>');
  }
  function render(u) {
    const p=u.pathname;
    if(!logged) return html('<h1>学校登录</h1><button>jAccount</button>');
    if(p==='/courses/110/assignments/310' && enhanced)return enhancedFixture();
    if(p==='/courses') return html('<table id="my_courses_table"><tbody><tr><td class="course-list-course-title-column">'+
      link('/courses/110','示例代数')+'</td></tr></tbody></table>');
    if(p==='/courses/110') return html('<h1>示例代数</h1>',
      '<nav id="section-tabs">'+link('/courses/110/assignments','作业')+link('/courses/110/files','文件')+link('/courses/110/assignments/syllabus','课程大纲')+
      '<span class="section-tab-hidden">'+link('/courses/110/pages','未启用')+'</span></nav>');
    if(p==='/courses/110/assignments') return html('<ul><li class="assignment">'+link('/courses/110/assignments/310','矩阵作业')+
      ' <span class="due_date"><time datetime="2026-11-25T18:00:00+08:00">11 月 25 日 18:00</time></span></li></ul>');
    if(p==='/courses/110/assignments/syllabus')return html('<section id="course_syllabus">每周完成习题。'+link('/courses/110/files/510','讲义.txt')+'</section>');
    if(p==='/courses/110/assignments/310') return html('<div id="assignment_show"><h1>矩阵作业</h1><div class="description user_content">提交解答和图表。'+link('/files/511/download','题目.pdf')+'</div><div class="assignment-buttons"><button class="submit_assignment_link" onclick="document.querySelector(\'#submit_assignment\').hidden=false">Start Assignment</button></div></div><p class="assignment-submission-status">'+
      (submitted?'已提交':'Not yet submitted')+'</p><p class="due_date"><time datetime="2026-11-25T18:00:00+08:00">11 月 25 日 18:00</time></p>'+
      '<ul class="student-assignment-overview"><li><span class="title">Attempts</span><span class="value">'+attempt+'</span></li></ul>'+
      '<div id="sidebar_content"><div class="details"><div class="content">'+(received.at(-1)||[]).map((f,i)=>link('/courses/110/assignments/310/submissions/42?download='+(71+i),'Download '+f.name)).join('')+'</div></div></div>'+
      '<div id="submit_assignment" hidden><form id="submit_online_upload_form" method="post" enctype="multipart/form-data" action="/courses/110/assignments/310/submissions">'+
      '<input type="file" name="attachment[]" accept=".pdf,.txt"><button type="button" class="add_another_file_link" onclick="this.before(this.form.querySelector(\'input[type=file]\').cloneNode())">Add Another File</button>'+
      (pledge?'<label><input type="checkbox" required>I agree</label>':'')+'<button id="submit_file_button" type="submit">Submit Assignment</button></form></div>');
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
      if(url.pathname==='/courses/110/assignments/310/submissions' && req.method==='POST'){
        const payload=await req.formData();
        const attachments=await Promise.all(payload.getAll('attachment[]').map(async f=>({name:f.name,contents:await f.text()})));
        received.push(attachments);submitted=true;attempt++;
        return new Response('<script>location.replace("/courses/110/assignments/310")</script>',{headers:{'Content-Type':'text/html'}});
      }
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
    const verify=()=>act('verify-submission',{courseId:'110',assignmentId:'310',accountKey:s.accountKey});
    assert.equal((await verify()).status,'unsubmitted');
    const [course]=s.snapshot.courses;
    assert.equal(course.name,'示例代数');assert.deepEqual(course.assignments.map(x=>[x.id,x.dueAt,x.submitted]),[['310','2026-11-25T10:00:00.000Z',false]]);
    assert.deepEqual(course.files.map(x=>[x.id,x.name]),[['510','讲义.txt'],['511','题目.pdf']]);
    assert(course.requirements.text.includes('每周完成习题'));assert.equal(course.requirements.attachments[0].id,'510');
    assert(course.assignments[0].description.includes('提交解答'));assert.equal(course.assignments[0].attachments[0].id,'511');
    assert.deepEqual(course.assignments[0].submissionTypes,['online_upload']);
    assert(!requests.includes('/courses/110/pages'));
    assert(s.calendar.events.some(x=>x.title==='作业日程'));
    const restored=await storage.load();
    assert.equal(restored.webVerified,true);
    assert.equal(restored.snapshot.courses[0].assignments[0].id,'310');
    console.log('PASS native hidden window, DOM collection, declared deadline, visible file folder and subscribed calendar');
    const body={courseId:'110',assignmentId:'310',type:'online_upload',expectedAttempt:0,confirmed:true,
      requestId:require('node:crypto').randomUUID(),files:[new File(['proof'],'解答.pdf'),new File(['results'],'results.txt')]};
    assert.equal(s.canSubmitFiles,true);
    pledge=true;
    await assert.rejects(act('submit',body),e=>e.code==='school_form');
    assert.equal(received.length,0);
    pledge=false;
    const receipt=await act('submit',body);
    assert.equal(receipt.attempt,1);assert.equal(receipt.assignmentId,'310');
    assert.deepEqual(received,[[{name:'解答.pdf',contents:'proof'},{name:'results.txt',contents:'results'}]]);
    assert.deepEqual(await act('submit',body),receipt);assert.equal(received.length,1);
    console.log('PASS official multipart form from jAccount, exact selected bytes, two attachments, school receipt, duplicate confirmation and pledge fallback');
    await act('portal',{courseId:'110',assignmentId:'310'});
    await until(()=>testWindows.find(w=>!w.isDestroyed() && w.webContents.getURL().endsWith('/assignments/310')),Boolean,'official assignment');
    submitted=true;
    const after=await act('sync');
    assert.equal(after.snapshot.courses[0].assignments[0].submitted,true);
    console.log('PASS official assignment and updated submission status after a school-side change');
    enhanced=true;submitted=false;attempt=0;previousDraft=true;
    const another={...body,requestId:require('node:crypto').randomUUID()};
    const fresh=await act('sync');
    assert.deepEqual(fresh.snapshot.courses[0].assignments[0].submissionTypes,['online_upload']);
    assert.deepEqual(fresh.snapshot.courses[0].assignments[0].submissionEvidence,{status:'unsubmitted',attempt:0,submittedAt:null});
    assert.equal((await verify()).status,'unsubmitted');
    await assert.rejects(act('submit',another),e=>e.code==='school_form');
    assert.equal(received.length,1);
    previousDraft=false;
    const enhancedReceipt=await Promise.race([act('submit',another),sleep(30000).then(()=>{throw Error('Enhanced upload did not produce a receipt');})]);
    assert.equal(enhancedReceipt.attempt,1);assert.deepEqual(received[1],received[0]);
    const verified=await verify();assert.equal(verified.status,'submitted');assert.equal(verified.attempt,1);assert.equal(received.length,2);
    console.log('PASS enhanced first attempt through file picker, exact draft and submitted file table, preserving other school drafts');
    enhanced=false;
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
