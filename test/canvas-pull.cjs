'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCanvasService } = require('../canvas-service');
const { courseContent } = require('../canvas-course-content');
const origin='https://oc.sjtu.edu.cn';

test('reads visible syllabus and assignment text with same-course handouts',()=>{
  const html='<p>Assessment &amp; exams</p><ul><li>Lab: 30&#37;</li></ul><p>Files: <a href="/courses/7/files/51?verifier=secret">Lab sheet</a></p>'+
    '<img src="/files/52/preview" alt="Figure"><span hidden>not visible</span><script>unwanted()</script>'+
    '<a href="/courses/9/files/1">Other course</a><a href="https://example.org/files/2">External</a>';
  const d=courseContent(html,'7');
  assert.match(d.text,/Assessment & exams/); assert.match(d.text,/Lab: 30%/);
  assert.doesNotMatch(d.text,/secret|not visible|unwanted/);
  assert.deepEqual(d.attachments.map(a=>a.id),['51','52']);
  assert(d.attachments.every(a=>a.url.startsWith(origin+'/courses/7/files/') && !a.url.includes('?')));
});

async function apiFixture(t) {
  const vault=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-pull-'));
  t.after(()=>fs.rm(vault,{recursive:true,force:true}));
  let data={auth:{accessToken:'fixture'},accountId:'15'};
  const calls=[], answers={offline:false,fileError:false};
  const storage={load:async()=>structuredClone(data),save:async s=>{data=structuredClone(s);}};
  const fetch=async(raw)=>{
    const u=new URL(raw), p=u.pathname;
    calls.push(p);
    if(p==='/api/v1/courses'){
      if(answers.offline)throw Error('offline');
      assert.equal(u.searchParams.get('include[]'),'syllabus_body');
      return Response.json([{id:7,name:'Algorithms',syllabus_body:'<p>Exam 70%</p>'},
        {id:8,name:'Networks',syllabus_body:'<p>Attend labs.</p>'}]);
    }
    if(p==='/api/v1/courses/7/assignments')return Response.json([{id:'33',name:'Sheet',due_at:'2026-12-01T12:00:00Z',
      description:'<p>Show the proof.</p><a href="/courses/7/files/52?verifier=fake">Sheet attachment</a>'}]);
    if(p==='/api/v1/courses/7/files')return Response.json([{id:51,display_name:'Slides.pdf',size:2,modified_at:'2026-11-19T12:00:00Z'}]);
    const file=p.match(/^\/api\/v1\/courses\/7\/files\/(51|52)$/)?.[1];
    if(file) {
      if(file==='52' && answers.fileError)return Response.json({},{status:403});
      return Response.json({id:file,display_name:file==='51'?'Slides.pdf':'Set A.pdf',size:2,url:origin+'/files/'+file+'/download'});
    }
    if(p.endsWith('/download'))return new Response(Buffer.from('OK'));
    return Response.json([]);
  };
  return {vault,calls,answers,service:()=>createCanvasService({vault,storage,fetch}),state:()=>structuredClone(data)};
}

test('one action pulls all courses and reuses verified local files across restarts without overwriting edits',async t=>{
  const f=await apiFixture(t), svc=f.service();
  const [first,again]=await Promise.all([svc.handle('POST','pull'),svc.handle('POST','pull')]);
  assert.deepEqual(first,again);
  assert.equal(first.courses,2); assert.deepEqual(first.notes,{saved:3,unchanged:0});
  assert.deepEqual(first.files,{saved:2,unchanged:0}); assert.deepEqual(first.failed,[]);
  // 1.1.53: no Canvas/ folder. Notes in the course folder (named after the course here), files as downloaded in the
  // hidden store, and the copies the student sees filed into the course folder (the notes link to those).
  const course=path.join(f.vault,'.obsidian','graphite','canvas','Algorithms (7)'), shown=path.join(f.vault,'Algorithms');
  const note=path.join(shown,'作业 Homework','Sheet (33).md');
  assert.equal(require('node:fs').existsSync(path.join(f.vault,'Canvas')),false);
  const text=await fs.readFile(note,'utf8');
  assert.match(text,/Show the proof/);assert.match(text,/2026-12-01/);assert.match(decodeURIComponent(text),/\(\.\.\/课件 Slides\/Slides\.pdf\)/);
  assert.ok(require('node:fs').existsSync(path.join(shown,'课件 Slides','Slides.pdf')));
  assert.match(await fs.readFile(path.join(shown,'课程要求.md'),'utf8'),/Exam 70%/);
  const restarted=f.service();
  assert.deepEqual((await restarted.handle('GET','status')).lastPull,first);
  const second=await restarted.handle('POST','pull');
  assert.equal(second.saved,0);assert.equal(second.unchanged,5);
  assert.equal(f.calls.filter(p=>p==='/files/51/download').length,1);
  await fs.writeFile(note,'My solution');
  await fs.writeFile(path.join(course,'Slides.pdf'),'XX');
  const custom=await restarted.handle('POST','pull',{courseId:'7'});
  assert.equal(custom.courses,1);assert.equal(custom.saved,2);
  assert.equal(await fs.readFile(note,'utf8'),'My solution');
  assert.equal(await fs.readFile(path.join(course,'Slides.pdf'),'utf8'),'XX');
  assert.equal(await fs.readFile(path.join(course,'Slides (2).pdf'),'utf8'),'OK');
  const fourth=await restarted.handle('POST','pull',{courseId:'7'});
  assert.equal(fourth.saved,0);
  f.answers.offline=true;
  const offline=await restarted.handle('POST','pull',{courseId:'7'});
  assert(offline.warnings.some(w=>w.includes('上次同步')));assert.equal(offline.saved,0);
  await assert.rejects(restarted.handle('POST','pull',{courseId:'404'}),e=>e.status===404);
});

test('a restricted attachment is reported while other courses and the assignment instructions are saved',async t=>{
  const f=await apiFixture(t), svc=f.service(); f.answers.fileError=true;
  const first=await svc.handle('POST','pull');
  assert.equal(first.failed[0].id,'52');assert.equal(first.notes.saved,3);assert.equal(first.files.saved,1);
  const note=await fs.readFile(path.join(f.vault,'Algorithms','作业 Homework','Sheet (33).md'),'utf8');
  assert.match(note,/https:\/\/oc.sjtu.edu.cn\/courses\/7\/files\/52/);
  f.answers.fileError=false;
  assert.equal((await svc.handle('POST','pull')).files.saved,1);
});

test('keeps linked jAccount attachments on an offline upgrade and preserves the school deadline label',async t=>{
  const vault=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-offline-assignment-'));
  t.after(()=>fs.rm(vault,{recursive:true,force:true}));
  const file={id:'27',name:'练习 #1.pdf',url:origin+'/courses/9/files/27',updatedAt:null};
  const course={id:'9',name:'Calculus',files:[file],assignments:[{id:'10',title:'Exercises',dueAt:null,
    dueLabel:'11月28日 23:59',description:'Work in pairs.',attachments:[file]}]};
  let state={portalSyncEnabled:true,webVerified:true}, offline=false, fileOffline=false,downloads=0;
  const storage={load:async()=>structuredClone(state),save:async next=>{state=structuredClone(next);}};
  const folder='.obsidian/graphite/canvas/Calculus (9)';
  const desktop={
    syncWeb:async()=>{if(offline)throw Error('network unavailable'); return {user:'Test student',snapshot:{webIdentity:'42',courses:[course],warnings:[]}};},
    downloadWeb:async()=>{
      downloads++;
      if(offline || fileOffline)throw Error('network unavailable');
      const relative=folder+'/练习 #1 (2).pdf'; // A name collision had already been resolved by the desktop downloader.
      const absolute=path.join(vault,relative);
      if (await fs.stat(absolute).catch(()=>null)) return {path:relative,unchanged:true};
      await fs.writeFile(absolute,'official bytes');
      return {path:relative,unchanged:false};
    },
  };
  const pull=()=>createCanvasService({vault,storage,desktop}).handle('POST','pull');
  const note=path.join(vault,'Calculus','作业 Homework','Exercises (10).md');
  assert.deepEqual((await pull()).failed,[]);
  const first=await fs.readFile(note,'utf8');
  assert.match(first,/截止时间：11月28日 23:59/);
  // "练习" is homework: filed next to the note.
  assert.match(first, /\(%E7%BB%83%E4%B9%A0%20%231%20%282%29\.pdf\)/);
  // (1.1.53 dropped the 1.1.44 upgrade path: files moved to the hidden store with their records.)
  offline=false; fileOffline=true;
  const failedFile=await pull();
  assert.equal(downloads,2); assert.equal(failedFile.files.unchanged,1); assert.deepEqual(failedFile.failed,[]);
  assert(failedFile.warnings.some(w=>w.includes('本地副本')));
  assert.equal(await fs.readFile(note,'utf8'),first);
  offline=true;
  await fs.unlink(path.join(vault,state.pullCache.files['9/27'].path));
  const missing=await pull();
  assert.equal(missing.files.unchanged,0);assert.equal(missing.failed[0].id,file.id);
});

test('an authenticated web submission invokes the official form once and reuses its receipt',async t=>{
  const vault=await fs.mkdtemp(path.join(os.tmpdir(),'graphite-submit-web-'));
  t.after(()=>fs.rm(vault,{recursive:true,force:true}));
  const assignment={id:'2',title:'Report',submissionTypes:['online_upload']};
  let state={portalSyncEnabled:true,webVerified:true,snapshot:{webIdentity:'15',courses:[{id:'7',assignments:[assignment]}]}};
  const storage={load:async()=>structuredClone(state),save:async next=>{state=structuredClone(next);}};
  let times=0;
  const desktop={submitWeb:async(body,guard)=>{
    assert.equal(body.expectedWebIdentity,'15');assert.deepEqual(body.assignment,assignment);
    assert.equal(await body.files[0].text(),'answer');
    await guard.beforePost();assert(state.requests[body.requestId].pending);times++;
    return {attempt:1,submittedAt:'2026-11-19T12:00:00Z',url:origin+'/courses/7/assignments/2'};
  }};
  const svc=createCanvasService({vault,storage,desktop});
  const body={requestId:require('node:crypto').randomUUID(),courseId:'7',assignmentId:'2',confirmed:true,type:'online_upload',expectedAttempt:0,
    files:[new File(['answer'],'report.pdf')]};
  assert.equal((await svc.handle('GET','status')).canSubmitFiles,true);
  const a=await svc.handle('POST','submit',body), b=await svc.handle('POST','submit',body);
  assert.deepEqual(a,b);assert.equal(times,1);
  await assert.rejects(svc.handle('POST','submit',{...body,type:'online_text_entry'}),e=>e.status===403);
});
