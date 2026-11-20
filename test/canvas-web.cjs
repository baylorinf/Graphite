'use strict';
// Public Canvas markup conventions, with entirely synthetic accounts and assignments.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
const { readSchoolPage, readCourses, verifyWebSubmission } = require('../electron/canvas-web');
const SITE='https://oc.sjtu.edu.cn';
const url=p=>SITE+p;
const link=(p,t)=>'<a href="'+p+'">'+t+'</a>';
let browser, web;
before(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    args:['--disable-background-networking','--disable-gpu','--disable-extensions']});
  web=await browser.newPage();
  await web.route('**/*',r=>r.fulfill({contentType:'text/html',body:'<!DOCTYPE html>'}));
});
after(async()=>{await browser?.close();});
async function inspect(p,markup) {
  await web.goto(url(p));
  await web.setContent('<!DOCTYPE html><meta charset="utf-8"><a id="global_nav_profile_link" href="/users/43/profile"><span class="avatar-name">Test student</span></a><main id="content">'+markup+'</main>');
  return web.evaluate(readSchoolPage);
}

test('dates, attempts, and receipts come from visible official fields; status labels alone never create a timestamp',async()=>{
  for(const label of ['Not yet submitted','Not Submitted!','has not been submitted','尚未提交','未繳交','No entregado']){
    const v=await inspect('/courses/7/assignments/2','<div class="assignment-submission-status">'+label+'</div>');
    assert.equal(v.submitted,false,label);assert.equal(v.verification,'unsubmitted');assert.equal(v.submittedAt,null);
  }
  for(const label of ['View submitted examples','Submission Details','In progress','准备提交']){
    assert.equal((await inspect('/courses/7/assignments/2','<div class="assignment-submission-status">'+label+'</div>')).submitted,null,label);
  }
  const positive=await inspect('/courses/7/assignments/2','<div id="sidebar_content"><div class="details"><div class="header">Submitted!</div><div class="content"><time datetime="2026-11-25T21:30:00+08:00">11月25日</time>'+link('/courses/7/assignments/2/submissions/43','详情')+'</div></div></div><ul class="student-assignment-overview"><li><span class="title">Due</span><span class="value"><span class="date_text"><span class="display_date">Nov 29</span> by <span class="display_time">11:59 pm</span></span></span></li><li><span class="title">Allowed Attempts</span><span class="value">4</span></li><li><span class="title">Attempts</span><span class="value">2</span></li></ul>');
  assert.equal(positive.submitted,true);assert.equal(positive.submittedAt,'2026-11-25T13:30:00.000Z');assert.equal(positive.attempt,2);
  assert.equal(positive.receiptUrl,url('/courses/7/assignments/2/submissions/43'));
  assert.deepEqual(positive.due,{dueAt:null,dueLabel:'Nov 29 by 11:59 pm'});
  const unspecified=await inspect('/courses/7/assignments/2','<div class="assignment-submission-status">已提交</div><div hidden class="submission-details-header__time">Submitted Nov 1</div><p class="description user_content"><span class="due_date">2020-03-01</span></p>');
  assert.equal(unspecified.submitted,true);assert.equal(unspecified.submittedAt,null);assert.equal(unspecified.attempt,null);assert.deepEqual(unspecified.due,{});
  const table=await inspect('/courses/7/assignments/2','<table class="assignment_dates"><thead><tr><th>For</th><th>Due</th></tr></thead><tbody><tr><td>Everyone</td><td><time datetime="2026-12-11T17:00:00+11:00">11 December</time></td></tr></tbody></table>');
  assert.equal(table.due.dueAt,'2026-12-11T06:00:00.000Z');
});
test('checks one current official assignment for the expected student and treats partial pages as unknown',async()=>{
  const href=url('/courses/7/assignments/2'), query={courseId:'7',assignmentId:'2',expectedIdentity:'43'};
  const check=page=>verifyWebSubmission(async address=>{assert.equal(address,href);return page;},query);
  const no=await inspect('/courses/7/assignments/2','<div class="assignment-submission-status">尚未提交</div>');
  assert.deepEqual(await check(no),{status:'unsubmitted',attempt:null,submittedAt:null});
  for(const patch of [{busy:true},{logged:false},{denied:true},{notFound:true},{login:true},{webIdentity:'44'},
    {pageUrl:url('/courses/8/assignments/2')},{verification:undefined}]){
    assert.equal((await check({...no,...patch})).status,'unknown');
  }
  for(const markup of ['<div class="assignment-submission-status">Not graded</div>',
    '<div class="user_content"><div class="assignment-submission-status">Not yet submitted</div></div>',
    '<div class="assignment-submission-status">Not yet submitted</div><div data-testid="submission-status">Submitted</div>']){
    assert.equal((await check(await inspect('/courses/7/assignments/2',markup))).status,'unknown');
  }
  const yes=await inspect('/courses/7/assignments/2','<div class="assignment-submission-status">已提交</div>');
  assert.deepEqual(await check(yes),{status:'submitted',attempt:null,submittedAt:null});
  await assert.rejects(verifyWebSubmission(async()=>{throw Error('offline');},query));
});

test('only current published courses, same-site pagination and file links are read from the real DOM',async()=>{
  const index=await inspect('/courses','<table id="past_enrollments_table"><tr><td>'+link('/courses/999','去年')+'</td></tr></table><p>No está inscrito en ningún curso.</p>');
  assert.equal(index.enrollments.length,0);assert.equal(index.recognizableEmpty,true);assert.equal(index.webIdentity,'43');
  const files=await inspect('/courses/7/files/folder/Week%201',link('/courses/7/files/folder/Week%201?preview=24','课件.pdf')+'<nav aria-label="Pagination"><a href="/courses/7/files/folder/Week%201?page=2" aria-label="Next page">Next</a><button aria-label="Next page" disabled>Next</button></nav>');
  assert.equal(files.links[0].href,url('/courses/7/files/24'));assert.equal(files.next.length,1);assert(!files.extraPages);
  const direct=await inspect('/courses/7/files/24',link('/courses/7/files/70/download','另一文件')+link('/files/24/download?download_frd=1','下载'));
  assert.equal(direct.download,url('/files/24/download?download_frd=1'));
  const module=await inspect('/courses/7/modules','<li class="context_module_item attachment"><div class="ig-row">'+link('/courses/7/modules/items/8','Slides')+'</div></li><li class="context_module_item external_tool"><div class="ig-row">'+link('/courses/7/modules/items/9','Tool')+'</div></li>');
  assert.deepEqual(module.links.map(l=>l.moduleFile),[true,false]);
});

test('follows only visible module attachments, folder pages and a recognized submission receipt',async()=>{
  const calls=[];
  const pages={
    '/courses':{hasCourseTable:true,enrollments:[{href:url('/courses/7'),title:'Test'}]},
    '/courses/7':{tabs:['modules','files','assignments'].map(s=>url('/courses/7/'+s))},
    '/courses/7/modules':{links:[{href:url('/courses/7/modules/items/80'),title:'From module',moduleFile:true},{href:url('/courses/7/modules/items/81'),title:'Other tool',moduleFile:false}]},
    '/courses/7/modules/items/80':{pageUrl:url('/courses/7/files/100?module_item_id=80')},
    '/courses/7/files':{links:[{href:url('/courses/7/files/folder/Week1'),title:'Week1'},{href:url('/courses/7/files?preview=102'),title:'Overview'}]},
    '/courses/7/files/folder/Week1':{links:[{href:url('/courses/7/files/folder/Week1?preview=103'),title:'Second.pdf'}],next:[url('/courses/7/files/folder/Week1?page=2')]},
    '/courses/7/files/folder/Week1?page=2':{links:[{href:url('/courses/7/files/104'),title:'Third.pdf'}]},
    '/courses/7/assignments':{links:[{href:url('/courses/7/assignments/9'),title:'Sheet'}]},
    '/courses/7/assignments/9':{submitted:true,receiptUrl:url('/courses/7/assignments/9/submissions/43'),due:{dueLabel:'Friday',dueAt:null}},
    '/courses/7/assignments/9/submissions/43':{submitted:true,attempt:2,submittedAt:'2026-11-22T14:00:00Z'},
  };
  const result=await readCourses(async h=>{const p=h.slice(SITE.length);calls.push(p);assert(pages[p],p);return {logged:true,...pages[p]};});
  const c=result.snapshot.courses[0];assert.deepEqual(c.files.map(f=>f.id).sort(),['100','102','103','104']);
  assert.equal(c.assignments[0].attempt,2);assert.equal(c.assignments[0].dueLabel,'Friday');
  assert(!calls.includes('/courses/7/modules/items/81'));
});

test('background checks have a detail budget, trust previous receipts only for a matching numbered account, and respect explicit unsubmitted status',async()=>{
  const entries=[1,2,3,4,5,6].map(n=>({href:url('/courses/7/assignments/'+n),title:'Sheet '+n,...(n===5?{submitted:false}:{})}));
  const cached={webIdentity:'43',courses:[{id:'7',assignments:[{id:'1',submitted:true,attempt:3,checkedAt:'old',dueLabel:'Friday'},{id:'5',submitted:true,attempt:1,checkedAt:'old'}]}]};
  async function run(id){
    let details=0;
    const result=await readCourses(async h=>{
      const p=new URL(h).pathname;
      if(p==='/courses')return {logged:true,webIdentity:id,hasCourseTable:true,enrollments:[{href:url('/courses/7'),title:'Test'}]};
      if(p==='/courses/7')return {logged:true,tabs:[url('/courses/7/assignments')]};
      if(p.endsWith('/assignments'))return {logged:true,links:entries};
      details++;return {logged:true,submitted:null};
    },{background:true,previousSnapshot:cached});
    assert.equal(details,2);
    return result.snapshot.courses[0].assignments;
  }
  const same=await run('43');assert.equal(same[0].attempt,3);assert.equal(same[4].submitted,false);
  const different=await run('44');assert.notEqual(different[0].submitted,true);assert(!different[0].attempt);
  const unknown=await run(null);assert.notEqual(unknown[0].submitted,true);
});

test('a matching school display name keeps downloaded coursework on refresh without reusing a personal receipt',async()=>{
  const file={id:'12',name:'Sheet.pdf',url:url('/courses/7/files/12')};
  const previousSnapshot={webIdentity:null,courses:[{id:'7',assignments:[{id:'1',description:'Solve both questions',attachments:[file],
    submissionTypes:['online_upload'],submitted:true,attempt:2,submittedAt:'2026-11-10',checkedAt:'old'}]}]};
  const run=async user=>{
    const result=await readCourses(async href=>{
      const p=new URL(href).pathname;
      if(p==='/courses')return {logged:true,user,hasCourseTable:true,enrollments:[{href:url('/courses/7'),title:'Course'}]};
      if(p==='/courses/7')return {logged:true,tabs:[url('/courses/7/assignments')]};
      if(p==='/courses/7/assignments')return {logged:true,links:[{href:url('/courses/7/assignments/1'),title:'Task',dueLabel:'Friday'}]};
      throw Error('Unexpected page '+p);
    },{background:true,previousUser:'Student A',previousSnapshot});
    return result.snapshot.courses[0];
  };
  const same=await run('Student A');
  assert.equal(same.assignments[0].description,'Solve both questions');
  assert.deepEqual(same.assignments[0].submissionTypes,['online_upload']);
  assert.equal(same.files[0].id,'12');
  assert.notEqual(same.assignments[0].submitted,true);
  assert.equal(same.assignments[0].attempt,undefined);
  for(const user of ['Student B','']){
    const other=await run(user);
    assert.equal(other.assignments[0].description,undefined);assert.equal(other.files.length,0);
  }
});
