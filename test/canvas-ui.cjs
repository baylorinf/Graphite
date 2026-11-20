// node test/canvas-ui.cjs [unpacked app directory]
// The browser uses Graphite's actual pages. The fixture replaces only Canvas HTTP responses.
require('./isolate.cjs');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '',
  '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const project = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const site = 'https://oc.sjtu.edu.cn';
const feedUrl = site + '/feeds/calendars/user_fixture.ics';
const savedPath = 'Canvas/示例代数 (101)/讲义.md';
const when = days => new Date(Date.now() + days * 86400000).toISOString();

function makeSnapshot() {
  const assignment = (id, title, dueAt, submitted) => ({id, title, dueAt, submitted, url: site + '/courses/101/assignments/' + id});
  const course = {
    id: '101', name: '示例代数', code: 'DEMO-A', url: site + '/courses/101', warnings: [],
    requirements: {text:'期末占 60%。\n作业按周提交。', attachments:[{id:'505',name:'课程说明.pdf',url:site+'/courses/101/files/505'}]},
    assignments: [assignment('301', '未交矩阵作业', when(2), false), assignment('302', '已上传向量习题', when(3), true),
      assignment('303', '往期小作业', when(-2), false), assignment('304', '下学期项目', when(50), false)],
    files: [{id:'501', name:'讲义.md', size:45, updatedAt:when(-1), url:site + '/courses/101/files/501'}],
    announcements: [{id:'601', title:'教室变更通知', at:when(-1), url:site + '/courses/101/discussion_topics/601'}],
    modules: [{id:'701', title:'第三讲', items:[{id:'702',title:'矩阵示例',url:site + '/courses/101/modules/items/702'}]}],
    quizzes: [{id:'401', title:'周测', assignmentId:null, dueAt:when(6), url:site + '/courses/101/quizzes/401'}],
    pages: [{id:'p1', title:'课程大纲', url:site + '/courses/101/pages/syllabus'}],
    discussions: [{id:'801', title:'问题讨论', url:site + '/courses/101/discussion_topics/801'}],
    events: [{id:'901', title:'答疑课', startAt:when(7), url:site + '/calendar?event_id=901'}],
  };
  const second = {id:'202', name:'示例物理', code:'DEMO-B', url:site + '/courses/202', warnings:[],
    files:[{id:'502',name:'实验步骤.pdf',size:16,url:site + '/courses/202/files/502'}]};
  course.events.push({...course.events[0],id:'902',title:'实验室开放',url:site+'/calendar?event_id=902'});
  course.quizzes.push({id:'402',title:'向量习题（测验入口）',assignmentId:'302',dueAt:course.assignments[1].dueAt,url:site+'/courses/101/quizzes/402'});
  return {courses:[course,second],warnings:[]};
}

function createFixture(configured, portalSupported=false) {
  const sample = makeSnapshot();
  const empty = () => ({ connected:false, configured, portalSupported, portalSyncEnabled:false, authMode:null,
    sessionOnly:false, user:'', authPending:false, canSubmit:false,
    authError:'', syncedAt:null, snapshot:{courses:[],warnings:[]}, calendar:null, portalOpened:false });
  let state = empty();
  const calls = [];
  const fixture = { calls, failSync:false, partial:false, failDownload:false, failFeed:false, failStatus:false,
    submitMode:'ok', submissions:[],
    activate(canSubmit=false,mode='oauth') { state.connected = true; state.canSubmit=canSubmit; state.canSubmitFiles=mode==='web'||canSubmit; state.authMode=mode; state.authPending = false; state.user = '课程测试生'; state.accountKey='fixture-student-'+mode; },
    expire() { state.connected=false; state.canSubmit=false; state.canSubmitFiles=false; state.authError='请重新登录学校网站。'; },
    markAcceptedAtSchool(id) {
      const row = sample.courses[0].assignments.find(a=>a.id === id);
      row.submitted=true;row.attempt=(row.attempt || 0)+1;
    },
    offerHomework() {
      const first = sample.courses[0];
      for (const [id,type,title] of [['310','online_text_entry','矩阵文字作业'],['311','online_url','实验网页作业'],['312','online_upload','上传演算作品']]) {
        first.assignments.push({id,title,attempt:0,submitted:false,excused:false,dueAt:when(4),
          submissionEvidence:{status:'unsubmitted',attempt:0,submittedAt:null},
          submissionTypes:[type],description:'请提交两个文件，保留 <draft> 符号。',attachments:[{id:'506',name:'题目.pdf',url:site+'/courses/101/files/506'}],url:site+'/courses/101/assignments/'+id});
      }
    },
    async handle(route) {
      const request = route.request(), action = new URL(request.url()).pathname.split('/').pop();
      let body;
      if (action === 'submit') {
        const decoded = await new Response(request.postDataBuffer(), {headers:{'Content-Type':request.headers()['content-type']}}).formData();
        body = {files:[]};
        for (const [field,value] of decoded) {
          if (typeof value === 'string') body[field]=value;
          else body.files.push({field,name:value.name,mime:value.type,bytes:Buffer.from(await value.arrayBuffer()).toString('hex')});
        }
      } else body = request.postDataJSON() || null;
      calls.push({action, body, method:request.method()});
      const respond = (json, status=200) => route.fulfill({status,json});
      if (action === 'status' && request.method() === 'GET') {
        if (fixture.failStatus) { fixture.failStatus = false; return respond({error:'无法加载连接状态'},503); }
        return respond(state);
      }
      if (request.method() !== 'POST') return respond({error:'意外的请求方法'},405);
      switch (action) {
        case 'portal': {
          state.portalOpened=true;
          const target=body?.assignmentId ? site+'/courses/'+body.courseId+'/assignments/'+body.assignmentId : site;
          return respond({url:target});
        }
        case 'connect': state.authPending = true; return respond({opened:true});
        case 'web-connect': state.portalOpened=true;state.portalSyncEnabled=true;return respond({opened:true});
        case 'calendar': {
          if (fixture.failFeed || body?.url !== feedUrl) return respond({error:'日历订阅地址无效'},422);
          const submitted = sample.courses[0].assignments[1];
          state.calendar = {syncedAt:when(0),events:[
            {id:'feed1',title:'课程开放日',startAt:when(1),allDay:false,url:site+'/calendar'},
            {id:'feed2',title:submitted.title,startAt:submitted.dueAt,allDay:false,url:submitted.url},
          ]};
          return respond(state);
        }
        case 'calendar-remove': state.calendar=null; return respond(state);
        case 'sync': {
          if (fixture.failSync) return respond({error:'学校暂时无法连接，请稍后重试。'},503);
          if (state.connected) {
            state.snapshot = structuredClone(sample);
            state.syncedAt = when(0);
            if (fixture.partial) state.snapshot.courses[0].warnings=['课件暂时无法读取，已保留上次记录。'];
          }
          return respond(state);
        }
        case 'download': {
          if (String(body?.courseId) !== '101' || String(body?.fileId) !== '501') return respond({error:'课程或文件不匹配'},404);
          if (fixture.failDownload) return respond({error:'该课件暂时无法下载'},502);
          return respond({path:savedPath, unchanged:false});
        }
        case 'download-course': return respond({saved:0,unchanged:0,failed:[{id:'502',name:'实验步骤.pdf',error:'实验课件暂时不可用'}]});
        case 'pull': {
          state.snapshot=structuredClone(sample);
          const saved = state.lastPull ? 0 : 3;
          state.lastPull={saved,unchanged:3-saved,skipped:0,courses:2,failed:[{courseId:'202',name:'实验附录',error:'暂不可用'}],warnings:[],path:'Canvas'};
          return respond(state.lastPull);
        }
        case 'verify-submission': {
          if (!state.connected || body.accountKey!==state.accountKey) return respond({error:'当前账号已改变'},409);
          const assignment=sample.courses.find(c=>c.id===body.courseId)?.assignments.find(a=>a.id===body.assignmentId);
          if (!assignment) return respond({error:'作业不存在'},404);
          return respond({...body,status:assignment.submitted===true?'submitted':assignment.submitted===false?'unsubmitted':'unknown',
            attempt:assignment.attempt??null,submittedAt:assignment.submittedAt??null});
        }
        case 'submit': {
          fixture.submissions.push(body);
          if (!state.canSubmit && !(state.canSubmitFiles && body.type==='online_upload')) return respond({error:'申请提交权限后再试。'},403);
          if (fixture.submitMode === 'invalid') return respond({error:'课程未接受本次提交，请检查作业格式。'},422);
          if (fixture.submitMode === 'unknown') return respond({error:'学校可能已收到本次提交，请到原站核对。',code:'submission_unknown'},502);
          const assignment=sample.courses[0].assignments.find(a=>a.id===body.assignmentId);
          assignment.submitted=true;
          assignment.attempt=Number(body.expectedAttempt)+1;
          return respond({id:'7001',courseId:body.courseId,assignmentId:assignment.id,submittedAt:when(0),attempt:assignment.attempt,url:assignment.url});
        }
        case 'disconnect': state = empty(); return respond(state);
        default: return respond({error:'测试夹具未定义此操作：'+action},404);
      }
    },
  };
  return fixture;
}

async function startPage(browser, origin, fixture) {
  const context = await browser.newContext({locale:'zh-CN',viewport:{width:1365,height:850}});
  await context.addInitScript(() => {
    localStorage.setItem('mo:lang','"zh-CN"');
    window.testOpenedUrls = [];
    window.open = url => { window.testOpenedUrls.push(String(url)); return null; };
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    return url.pathname.startsWith('/api/canvas/') && url.pathname!=='/api/canvas/vault-file' ? fixture.handle(route) : route.continue();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  await page.goto(origin);
  await page.waitForFunction(() => document.querySelector('#tree .file'));
  const home = page.locator('#empty-state [data-cmd="sjtu-canvas"]');
  await home.waitFor();
  await home.click();
  const view = page.locator('#canvas-view');
  const button = name => view.locator('[data-cv="'+name+'"]');
  return {context, page, view, button};
}

function textVisible(root, text) { return root.getByText(text,{exact:true}).first().waitFor(); }
async function showFeed(view) {
  const feed = view.locator('details[data-keep="feed"]');
  if (!await feed.evaluate(el => el.open)) await feed.locator('summary').click();
}
async function addCalendar(view) {
  await showFeed(view);
  await view.locator('#cv-feed-input').fill(feedUrl);
  await view.locator('[data-cv-form] button[type=submit]').click();
  await textVisible(view,'课程开放日');
}

async function calendarWithoutOAuth(browser, origin) {
  const fixture = createFixture(false);
  fixture.failStatus = true;
  const {context,page,view,button} = await startPage(browser,origin,fixture);
  try {
    await textVisible(view,'无法加载连接状态');
    await button('refresh').click();
    await showFeed(view);
    assert.equal(await button('connect').count(),0);
    await button('portal').click();
    await page.waitForFunction(()=>window.testOpenedUrls.length===1);
    assert.equal(new URL((await page.evaluate(()=>window.testOpenedUrls))[0]).origin,site);
    fixture.failFeed=true;
    await view.locator('#cv-feed-input').fill(feedUrl);
    await view.locator('[data-cv-form] button[type=submit]').click();
    await textVisible(view,'日历订阅地址无效');
    fixture.failFeed=false;
    await addCalendar(view);
    assert.equal(fixture.calls.filter(c=>c.action==='calendar').length,2);
    assert.equal(await view.locator('#cv-feed-input').count(),0);
    assert(!((await view.innerText()).includes(feedUrl)));
    await button('calendar-remove').click();
    await view.locator('#cv-feed-input').waitFor();
    assert.equal(await view.getByText('课程开放日',{exact:true}).count(),0);
    console.log('PASS homepage, unavailable application authorization, university portal, status retry, calendar error/subscription/removal');
  } finally { await context.close(); }
}

async function authorizedCourses(browser, origin) {
  const fixture = createFixture(true);
  const {context,page,view,button} = await startPage(browser,origin,fixture);
  try {
    await button('connect').click();
    await view.getByText(/Canvas 窗口.*授权/).first().waitFor();
    assert.equal(fixture.calls.filter(c=>c.action==='connect').length,1);
    fixture.activate(); await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await textVisible(view,'课程测试生');
    await button('sync').click();
    const course=view.locator('#cv-course');
    await course.waitFor();
    assert.deepEqual(await course.locator('option').evaluateAll(items=>items.map(o=>o.value)),['101','202']);
    const agenda = view.locator('.cv-block').filter({has:page.getByRole('heading',{name:/30/})});
    await textVisible(agenda,'未交矩阵作业');
    for (const name of ['已上传向量习题','向量习题（测验入口）','往期小作业','下学期项目']) {
      assert.equal(await agenda.getByText(name,{exact:true}).count(),0,'Upcoming list should omit '+name);
    }
    for(const name of ['答疑课','实验室开放']) await textVisible(agenda,name);
    const group = key => view.locator('[data-group="'+key+'"]');
    const details = view.locator('.cv-block').filter({has:page.locator('#cv-course')});
    await group('assignments').click();
    const submitted = details.locator('li').filter({hasText:'已上传向量习题'});
    assert.match(await submitted.innerText(),/已提交/);
    for (const [key,title] of [['announcements','教室变更通知'],['quizzes','周测'],['pages','课程大纲'],['discussions','问题讨论'],['events','答疑课']]) {
      await group(key).click(); await textVisible(details,title);
    }
    await group('modules').click();
    await details.locator('summary').filter({hasText:'第三讲'}).click();
    await textVisible(details,'矩阵示例');
    await course.selectOption('202');
    await textVisible(details,'实验步骤.pdf');
    assert.equal(await details.getByText('讲义.md',{exact:true}).count(),0);
    await button('download-course').click();
    await view.getByText(/实验课件暂时不可用/).first().waitFor({state:'attached'});
    assert.deepEqual(fixture.calls.find(c=>c.action==='download-course').body,{courseId:'202'});
    await course.selectOption('101');
    fixture.failSync = true; await button('sync').click();
    await textVisible(view,'学校暂时无法连接，请稍后重试。');await textVisible(details,'讲义.md');
    fixture.failSync = false; fixture.partial = true;await button('sync').click();
    await details.locator('.cv-warnings summary').click();await textVisible(details,'课件暂时无法读取，已保留上次记录。');
    await textVisible(details,'讲义.md');
    fixture.failDownload=true;await button('download').click();await textVisible(view,'该课件暂时无法下载');
    fixture.failDownload=false;await button('download').click();await button('open-file').waitFor();
    assert.match(await view.locator('.cv-feedback').innerText(),/Canvas\/示例代数 \(101\)\/讲义.md/);
    const downloads=fixture.calls.filter(c=>c.action==='download');
    assert.deepEqual(downloads.map(c=>c.body),[{courseId:'101',fileId:'501'},{courseId:'101',fileId:'501'}]);
    await button('open-file').click();
    await page.waitForFunction(()=>document.title.includes('讲义'));
    await page.locator('#tabbar .tab').filter({hasText:'交大 Canvas'}).click();
    await course.waitFor();
    await addCalendar(view);
    assert.equal(await agenda.getByText('已上传向量习题',{exact:true}).count(),0,'Same submitted assignment from the private feed should not reappear in upcoming work');
    await button('disconnect').click();await button('cancel-disconnect').click();assert.equal(fixture.calls.filter(c=>c.action==='disconnect').length,0);
    await button('disconnect').click();await button('confirm-disconnect').click();await button('connect').waitFor();
    assert.equal(await course.count(),0);assert.equal(await view.getByText('课程测试生',{exact:true}).count(),0);
    assert.equal(await view.getByText('课程开放日',{exact:true}).count(),0);
    await page.keyboard.press('Control+,');
    const settingsEntry=page.locator('#settings-canvas-open');
    await settingsEntry.waitFor();await settingsEntry.click();await button('connect').waitFor();
    console.log('PASS authorization, eight course resource sections, date filtering, submitted work, two courses, stale/partial sync, download retry, disconnect and settings entry');
  } finally {await context.close();}
}

async function assignmentSubmissions(browser, origin) {
  const fixture = createFixture(true);
  fixture.activate();
  fixture.offerHomework();
  const {context, page, view, button} = await startPage(browser, origin, fixture);
  const dialog = page.locator('#cv-submit-dialog');
  const action = name => dialog.locator('[data-submit-action="'+name+'"]');
  const open = id => view.locator('[data-cv="submission"][data-assignment="'+id+'"]').click();
  const confirmTwice = async () => {
    // Two rapid clicks from the same user event loop must produce one request to Canvas.
    await action('confirm').evaluate(el=>{el.click();el.click();});
  };
  try {
    await button('sync').click();
    await view.locator('[data-group="assignments"]').click();
    await open('310');
    const textInput=dialog.locator('#cv-submit-text');
    const answer='线性代数练习：A+B=B+A。\n仅供本机测试。';
    await textInput.fill(answer);
    await action('preview').click();
    await action('authorize').waitFor();
    assert.equal(fixture.submissions.length,0);
    await Promise.all([page.waitForResponse(r=>new URL(r.url()).pathname==='/api/canvas/connect'),action('authorize').click()]);
    assert.deepEqual(fixture.calls.filter(c=>c.action==='connect').map(c=>c.body),[{submit:true}]);
    fixture.activate(true);
    await Promise.all([page.waitForResponse(async r=>new URL(r.url()).pathname==='/api/canvas/status' && (await r.json()).canSubmit),
      page.evaluate(()=>window.dispatchEvent(new Event('focus')))]);
    if (!await dialog.isVisible()) await open('310');
    await action('confirm').waitFor();
    assert.equal(fixture.submissions.length,0);
    assert((await dialog.innerText()).includes('A+B=B+A'));
    await action('edit').click();
    assert.equal(await textInput.inputValue(),answer);
    await action('preview').click();
    fixture.submitMode='invalid';
    await confirmTwice();
    await dialog.getByText(/课程未接受本次提交/).waitFor();
    assert.equal(fixture.submissions.length,1);
    fixture.submitMode='ok';
    if (!await action('confirm').isVisible()) await action('preview').click();
    await confirmTwice();
    await dialog.locator('[data-submit-receipt]').waitFor();
    assert.equal(fixture.submissions.length,2);
    const posted=fixture.submissions.at(-1);
    assert.equal(posted.courseId,'101');assert.equal(posted.assignmentId,'310');
    assert.equal(posted.type,'online_text_entry');assert.equal(posted.text.replace(/\r\n/g,'\n'),answer);assert.equal(posted.confirmed,'true');
    assert.equal(posted.expectedAttempt,'0');assert.ok(posted.requestId);
    await action('close').click();

    await open('311');
    await dialog.locator('#cv-submit-url').fill('https://example.org/course/demo');
    await action('preview').click();
    fixture.submitMode='ok';
    await confirmTwice();
    await dialog.locator('[data-submit-receipt]').waitFor();
    assert.equal(fixture.submissions.length,3);
    const url=fixture.submissions.at(-1);
    assert.equal(url.assignmentId,'311');assert.equal(url.type,'online_url');assert.equal(url.url,'https://example.org/course/demo');
    await action('close').click();

    await open('312');
    const files=[
      {name:'演算过程.txt',mimeType:'text/plain',buffer:Buffer.from('演算第一行\n')},
      {name:'figure.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71,13,10,26,10])},
    ];
    await dialog.locator('#cv-submit-files').setInputFiles(files);
    await action('preview').click();
    for (const f of files) assert((await dialog.innerText()).includes(f.name));
    assert.equal(fixture.submissions.length,3);
    fixture.submitMode='unknown';
    await confirmTwice();
    await dialog.locator('[data-submit-unknown]').waitFor();
    assert.equal(fixture.submissions.length,4);
    assert.equal(await action('confirm').count(),0);
    assert.equal(await action('preview').count(),0);
    const uploaded=fixture.submissions.at(-1);
    assert.equal(uploaded.type,'online_upload');assert.equal(uploaded.assignmentId,'312');
    assert.deepEqual(uploaded.files,files.map(f=>({field:'files',name:f.name,mime:f.mimeType,bytes:f.buffer.toString('hex')})));
    assert.notEqual(uploaded.requestId,posted.requestId);
    await action('portal').click();
    await page.waitForFunction(()=>window.testOpenedUrls.includes('https://oc.sjtu.edu.cn/courses/101/assignments/312'));
    assert.equal(fixture.submissions.length,4);
    await action('close').click();await open('312');
    await dialog.locator('[data-submit-unknown]').waitFor();
    assert.equal(await action('confirm').count(),0);
    console.log('PASS submission authorization, review before posting, text/URL/multipart bytes, duplicate-click, definite failure/retry, receipt and ambiguous-result recovery via Canvas');
  } finally {await context.close();}
}

async function nativeSchoolSession(browser, origin, vault) {
  const fixture = createFixture(false,true);
  fixture.offerHomework();
  const {context,page,view,button} = await startPage(browser,origin,fixture);
  try {
    await button('web-connect').click();
    assert.equal(fixture.calls.filter(c=>c.action==='web-connect').length,1);
    assert.equal(fixture.calls.filter(c=>c.action==='connect').length,0);
    fixture.activate(false,'web');
    await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await textVisible(view,'课程测试生');
    await button('pull').evaluate(el=>{el.click();el.click();});
    const report=view.locator('[data-pull-result]');
    await textVisible(report,/已保存 3/);
    assert.equal(fixture.calls.filter(c=>c.action==='pull').length,1);
    assert.equal(fixture.calls.filter(c=>c.action==='download').length,0);
    await report.locator('summary').click();
    await textVisible(report,'示例物理 · 实验附录 · 暂不可用');
    await button('pull').click(); await textVisible(report,/文件已在笔记库中 3/);
    await view.locator('[data-group="requirements"]').click();
    await textVisible(view,/期末占 60%/); await textVisible(view,'课程说明.pdf');
    await view.locator('[data-group="assignments"]').click();
    const uploadRow=view.locator('li.cv-row:has([data-cv="submission"][data-assignment="312"])');
    await uploadRow.locator('summary').click();
    await textVisible(uploadRow,/保留 <draft> 符号/); await textVisible(uploadRow,'题目.pdf');
    await view.locator('[data-cv="submission"][data-assignment="310"]').click();
    await page.waitForFunction(()=>window.testOpenedUrls.includes('https://oc.sjtu.edu.cn/courses/101/assignments/310'));
    const calls=fixture.calls.filter(c=>c.action==='portal');
    assert.deepEqual(calls.at(-1).body,{courseId:'101',assignmentId:'310'});
    assert.equal(await page.locator('#cv-submit-dialog').count(),0);
    assert.equal(fixture.submissions.length,0);
    fixture.markAcceptedAtSchool('310');
    await button('verify-submission').click();
    await page.waitForFunction(()=>[...document.querySelectorAll('#canvas-view li.cv-row')].some(row=>
      row.querySelector('.cv-title')?.textContent==='矩阵文字作业' && row.querySelector('.cv-meta')?.textContent.includes('已提交')));
    assert.equal(fixture.submissions.length,0);
    await uploadRow.locator('[data-cv="submission"]').click();
    const dialog=page.locator('#cv-submit-dialog');
    const action=name=>dialog.locator('[data-submit-action="'+name+'"]');
    await action('vault').click();
    const filter=dialog.locator('#cv-file-filter');
    const first='我的作业/答案 #1 & 草稿.pdf', second='我的作业/解题步骤.txt';
    const check=name=>dialog.getByRole('checkbox',{name,exact:true});
    await filter.fill('我的作业');
    await check(first).check(); await check(second).check();
    await dialog.locator('#cv-submit-files').setInputFiles({name:'解题步骤.txt',mimeType:'text/plain',buffer:Buffer.from('重复')});
    await action('preview').click(); await textVisible(dialog,/附件名称重复/);
    await dialog.getByRole('button',{name:'移除附件 · 解题步骤.txt'}).first().click();
    await page.evaluate(path=>{
      window.testFlush=window.__moFlush;
      window.__moFlush=async()=>({ok:false,unsaved:[{path}]});
    },first);
    await action('preview').click(); await textVisible(dialog,/请先保存选中的文件/);
    assert.equal(fixture.submissions.length,0);
    await page.evaluate(()=>{window.__moFlush=window.testFlush;});
    await action('preview').click();
    await action('confirm').waitFor();
    assert.equal(fixture.submissions.length,0);
    await textVisible(dialog,first); await textVisible(dialog,second);
    await fs.writeFile(path.join(vault,second),'用户预览之后另存的内容');
    await action('confirm').evaluate(el=>{el.click();el.click();});
    await dialog.locator('[data-submit-receipt]').waitFor();
    assert.equal(fixture.submissions.length,1);
    const received=fixture.submissions[0];
    assert.equal(received.courseId,'101');assert.equal(received.assignmentId,'312');
    assert.deepEqual(received.files.map(f=>[f.name,f.bytes]),[
      ['答案 #1 & 草稿.pdf',Buffer.from([37,80,68,70,0,255,1]).toString('hex')],
      ['解题步骤.txt',Buffer.from('预览中的解题步骤').toString('hex')],
    ]);
    assert.deepEqual(received.files.map(f=>f.mime),['application/pdf','text/plain']);
    assert.equal(fixture.calls.filter(c=>c.action==='connect').length,0);
    assert.equal(fixture.calls.filter(c=>c.action==='portal').length,1);
    await action('close').click();
    fixture.expire();await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
    await button('web-connect').waitFor();
    assert.equal(await button('pull').count(),0);
    await uploadRow.getByRole('button',{name:'在 Canvas 查看作业'}).click();
    await page.waitForFunction(()=>window.testOpenedUrls.includes('https://oc.sjtu.edu.cn/courses/101/assignments/312'));
    assert.equal(fixture.submissions.length,1);
    console.log('PASS jAccount course pull, partial and repeat results, inline course/assignment instructions, official fallback, vault multiselect, unsaved files, duplicate names, previewed bytes and one confirmed submission');
  } finally {await context.close();}
}

async function main() {
  const vault = await fs.mkdtemp(path.join(process.env.GRAPHITE_TEST_ISOLATED,'canvas-vault-'));
  await fs.writeFile(path.join(vault,'示例课程.md'),'# 测试笔记\n');
  await fs.mkdir(path.dirname(path.join(vault,savedPath)),{recursive:true});
  await fs.writeFile(path.join(vault,savedPath),'# 课程下载测试样本\n');
  await fs.mkdir(path.join(vault,'我的作业'));
  await fs.writeFile(path.join(vault,'我的作业','答案 #1 & 草稿.pdf'),Buffer.from([37,80,68,70,0,255,1]));
  await fs.writeFile(path.join(vault,'我的作业','解题步骤.txt'),'预览中的解题步骤');
  const port = await require(path.join(project,'server.js')).start({vault});
  const origin='http://127.0.0.1:'+port;
  const browser=await chromium.launch({headless:true,executablePath:process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args:['--disable-background-networking']});
  try {
    await calendarWithoutOAuth(browser,origin);
    await authorizedCourses(browser,origin);
    await nativeSchoolSession(browser,origin,vault);
    await assignmentSubmissions(browser,origin);
  }
  finally { await browser.close(); }
}
main().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});
