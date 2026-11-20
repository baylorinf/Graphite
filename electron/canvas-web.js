'use strict';
// Read only the official web pages as rendered in Graphite's isolated school browser.
// This code runs in an isolated JS world. It never reads cookies, web storage or login form fields.
function readSchoolPage() {
  const root = document.querySelector('#content,main,[role=main]') || document.body;
  const visible = el => !!el && el.getClientRects().length && !el.closest('[hidden],[aria-hidden="true"],.hidden') && getComputedStyle(el).visibility !== 'hidden';
  const text = el => String(el?.innerText || el?.textContent || '').trim().replace(/\s+/g, ' ');
  const official = raw => {
    try { const u = new URL(raw, location.href); return u.origin === 'https://oc.sjtu.edu.cn' && !u.username && !u.password ? u : null; }
    catch { return null; }
  };
  const url = official(location.href);
  if (!url || /\/login(?:\/|$)/.test(url.pathname)) return { login: true };
  const account = document.querySelector('#global_nav_profile_link, a[href="/profile/settings"],a[href="/logout"],form[action="/logout"]');
  const hasCourseTable = !!document.querySelector('#my_courses_table');
  const logged = !!account || hasCourseTable;
  const shownName = text(account?.querySelector('.avatar-name,.user_name')) || account?.querySelector('img[alt]')?.alt?.trim() || '';
  const accountName = /^(?:account|profile|avatar|user|user account|profile picture|账户|帐户|帳戶|个人资料|個人資料|头像|頭像)$/i.test(shownName) ? '' : shownName;
  const mainText = text(root);
  const heading = text(root.querySelector('h1,h2'));
  const denied = /access denied|unauthorized|you do not have permission|accès refusé|acceso denegado|无权访问|无访问权限|未获授权|未授权|拒绝访问|拒絕存取|無權限|アクセスが拒否/i.test(heading + ' ' + text(root.querySelector('.ic-flash-error')));
  const notFound = /^(?:404\b|page not found|not found|页面不存在|未找到页面|找不到網頁|página no encontrada|page introuvable)/i.test(heading);
  // Record the identity only when the page actually links the current account to its numbered profile.
  const profile = official(account?.getAttribute('href') || '');
  const identity = account && profile?.pathname.match(/^\/(?:users\/(\d+)(?:\/profile)?|about\/(\d+))\/?$/);
  const mainLinks = Array.from(root.querySelectorAll('a[href]')).filter(visible);
  const parseClock = value => {
    const s = String(value || '').trim();
    if (/^\d{4}-\d\d-\d\d$/.test(s)) return s;
    if (/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d/.test(s)) {
      const v = s.replace(' ', 'T');
      if (!/(?:Z|[+-]\d\d:?\d\d)$/i.test(v)) return null;
      const n = Date.parse(v);
      return Number.isFinite(n) ? new Date(n).toISOString() : null;
    }
    // Locale-specific dates without a year or a time zone are ambiguous. Keep the
    // source label so the student can still see the wording printed by the school.
    const m = s.match(/(20\d\d)\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日(?:[^\d]*(\d{1,2}):(\d{2}))?/);
    if (m) {
      const d = m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
      if (m[4] && !/北京(?:时间|時間)|UTC\+0?8\b|GMT\+0?8\b/i.test(s)) return null;
      const n=Date.parse(d+'T'+(m[4]||'00').padStart(2,'0')+':'+(m[5]||'00')+':00+08:00');
      return Number.isFinite(n) ? (m[4] ? new Date(n).toISOString() : d) : null;
    }
    return null;
  };
  function dueInfo(row) {
    const dueHeading = /^(due|截止(?:日期|时间|時間)?|到期(?:日|日期)?|fecha de entrega|échéance|期限)[:：]?$/i;
    const overview = [...row?.querySelectorAll('.student-assignment-overview > li') || []];
    const labelled = overview.filter(el=>dueHeading.test(text(el.querySelector('.title')))).map(el=>el.querySelector('.value'));
    const table=row?.querySelector('table.assignment_dates');
    if (table && visible(table)) {
      const col=[...table.querySelectorAll('thead th')].findIndex(el=>dueHeading.test(text(el)));
      const rows=[...table.querySelectorAll('tbody tr')].filter(visible);
      if(col>=0 && rows.length===1)labelled.push(rows[0].cells[col]);
    }
    const candidates = row?.querySelectorAll('[data-due-at], .due_date, .due-date, [data-testid*="due-date" i], [class*="dueDate"], [class*="DueDate"], .assignment-date-due');
    for (const el of [...labelled,...candidates || []]) {
      if (!visible(el) || el.closest('.user_content,.description,.discussion-entry')) continue;
      const time = el.matches('time') ? el : el.querySelector('time[datetime], [data-datetime]');
      const label = text(el), value = el.dataset.dueAt || time?.getAttribute('datetime') || time?.dataset.datetime || el.getAttribute('datetime') || el.title || label;
      if (value) return { dueAt: parseClock(value), dueLabel: label || value };
    }
    return {};
  }
  function reportedStatus(label) {
    const s=String(label||'').trim().replace(/\s+/g,' ');
    if (/\b(?:not|never|unsubmitted|missing|incomplete|no submission|no entregad[oa]|non remis|pas soumis)\b|(?:未|尚未|还未|還未|没有|沒有).{0,8}(?:提交|繳交|交付)|未提出|미제출/i.test(s)) return false;
    if (/^(?:(?:successfully\s+)?submitted(?:\s+(?:successfully|late|on time))?|(?:已(?:成功)?提交|提交成功|已繳交|已交|已提交，逾期)|entregad[oa]|enviad[oa]|soumis(?:e)?|remis(?:e)?|提出済み|제출됨)[!！.。]?$/i.test(s)) return true;
    return null;
  }
  function receiptInfo() {
    const candidates = document.querySelectorAll('.assignment-submission-status,[data-testid="submission-status"],.submission-details-header .submission_status,#sidebar_content .details .header');
    let state = null, negative=false, explicitNegative=false;
    for (const el of candidates) if (visible(el) && !el.closest('.user_content,.description,.discussion-entry')) {
      const label=text(el), v=reportedStatus(label);
      if(v===false) {
        negative=true;
        if (/^(?:(?:not (?:yet )?submitted|has not been submitted|never submitted|unsubmitted|no submission)|(?:尚未|还未|還未|未)(?:提交|繳交|交付)|no entregad[oa]|non remis(?:e)?|pas soumis(?:e)?|未提出|미제출)[.!！。]?$/i.test(label)) explicitNegative=true;
      }
      if(v===true) state=true;
    }
    const stamp=[...document.querySelectorAll('.submission-details-header__time,[data-testid="submission-timestamp"],[data-testid="submitted-at"]')]
      .find(el=>visible(el) && text(el) && !el.closest('.user_content,.description,.discussion-entry'));
    // The classic official sidebar renders the date immediately after its Submitted header.
    const holder=stamp || (state===true && document.querySelector('#sidebar_content .details .content'));
    const clock=holder && (holder.matches('time[datetime]') ? holder : holder.querySelector('time[datetime],[data-datetime]'));
    const submittedAt=holder ? parseClock(clock?.getAttribute('datetime') || clock?.dataset.datetime || stamp?.textContent) : null;
    if (negative) return {submitted:false,attempt:null,submittedAt:null,
      verification:explicitNegative && state!==true && !stamp && !submittedAt ? 'unsubmitted' : 'unknown'};
    const positiveLabel=state===true;
    if (stamp && reportedStatus(text(stamp))!==false && !stamp.closest('.user_content')) state=true;
    let attempt=null;
    if(state===true) {
      for(const box of document.querySelectorAll('.submission-details-header__attempts_info,.student-assignment-overview li')) {
        const label=text(box.querySelector('.bold,.title'));
        const number=text(box.querySelector('.value,span:last-child'));
        if(visible(box) && /^(?:Attempts|已尝试次数|尝试次数|嘗試次數|提交次数|提交次數|intentos|tentatives|試行回数)$/i.test(label) && /^[1-9]\d*$/.test(number)) {attempt=Number(number);break;}
      }
    }
    return {submitted:state,attempt,submittedAt:state===true ? submittedAt : null,
      verification:state===true && (positiveLabel || submittedAt) ? 'submitted' : 'unknown'};
  }
  const links = [];
  for (const a of mainLinks) {
    const u = official(a.href); if (!u) continue;
    const title = text(a) || a.getAttribute('aria-label') || a.title;
    const row = a.closest('li.assignment, .ig-row, .assignment, tr, [role=row], .ef-item-row, li') || a.parentElement;
    const moduleRow=a.closest('.context_module_item,[data-testid="module-item"]') || a.closest('.ig-row') || row;
    const moduleFile=!moduleRow.matches('.locked,[aria-disabled="true"]') && (moduleRow.matches('.attachment,.file') || !!moduleRow.querySelector('.type_icon.icon-paperclip,.type_icon.icon-document,.type_icon .icon-paperclip,.ig-type-icon .icon-paperclip,.icon-attachment,[title="File"],[title="文件"],[aria-label="File"]'));
    const preview=u.searchParams.get('preview');
    if (/^\/courses\/\d+\/files(?:\/folder\/.*)?\/?$/.test(u.pathname) && /^\d+$/.test(preview || '')) {
      const course=u.pathname.split('/')[2]; u.pathname='/courses/'+course+'/files/'+preview; u.search='';
    }
    const status=[...row.querySelectorAll('[data-submitted],.submission_status,.submission-status,[title="Submitted"],[aria-label="Submitted"],[title="已提交"]')].find(visible);
    links.push({ href: u.href, title: title || '', ...dueInfo(row), moduleFile,
      submitted: status ? (status.dataset.submitted==='true' || (status.dataset.submitted==='false' ? false : reportedStatus(text(status)||status.title||status.getAttribute('aria-label')))) : null });
  }
  const tabs = Array.from(document.querySelectorAll('#section-tabs a[href],#courseNavToggle + nav a[href],nav[aria-label*="Course"] a[href]'))
    .filter(a => visible(a) && !a.closest('.section-tab-hidden')).map(a => official(a.href)?.href).filter(Boolean);
  const enrollments = Array.from(document.querySelectorAll('#my_courses_table .course-list-course-title-column a[href],#my_courses_table tbody a[href],.ic-DashboardCard__header-link'))
    .filter(visible).map(a=>({href:official(a.href)?.href,title:text(a)||a.title})).filter(x=>x.href && x.title);
  const pager = Array.from(root.querySelectorAll('a[rel~=next],.pagination a,.pagination button,nav[aria-label*="pagin" i] a,nav[aria-label*="pagin" i] button,[aria-label="Next page"],[aria-label="下一页"],[aria-label="下一頁"]'))
    .filter(el=>visible(el) && !el.matches(':disabled,[aria-disabled=true],.disabled') && !el.closest('.disabled') && (el.matches('a[rel~=next],.next a,a.next') || /next|下一[页頁]|suivant|siguiente|次のページ|다음/i.test(el.getAttribute('aria-label')||el.title||text(el))));
  const next=pager.filter(a=>a.matches('a[href]') && !a.getAttribute('href').startsWith('#')).map(a=>official(a.href)?.href).filter(Boolean);
  const currentFile = url.pathname.match(/\/files\/(\d+)\/?$/)?.[1] || url.searchParams.get('preview');
  const download = mainLinks.find(a=>{
    const u=official(a.href), id=u?.pathname.match(/\/files\/(\d+)\/download\/?$/)?.[1];
    return id && (!currentFile || id===currentFile);
  });
  const due = dueInfo(root);
  const assignment = url.pathname.match(/^\/courses\/(\d+)\/assignments\/(\d+)\/?$/);
  const rich = assignment ? root.querySelector('[data-resource-type="assignment.body"],#assignment_show .description.user_content,[data-testid="assignment-description"],.a2-toggle-details-container .user_content')
    : root.querySelector('#course_syllabus,#syllabus_body,[data-testid="course-syllabus"]');
  const body = rich && visible(rich) ? String(rich.innerText).trim() : '';
  const bodyLinks = rich && visible(rich) ? Array.from(rich.querySelectorAll('a[href]')).filter(visible)
    .map(a=>({href:official(a.href)?.href,title:text(a)||a.title})).filter(l=>l.href && l.title) : [];
  const form = document.querySelector('#submit_assignment form#submit_online_upload_form');
  const opener = document.querySelector('#assignment_show .assignment-buttons .submit_assignment_link');
  const enhanced = assignment && root.querySelector('[data-testid="assignments-2-student-view"]');
  const upload = assignment && form && !form.closest('.user_content') && form.method==='post' &&
    official(form.action)?.pathname===url.pathname.replace(/\/$/,'')+'/submissions' &&
    form.querySelector('#submit_file_button') && (visible(form) || (visible(opener) && !opener.disabled));
  const receipt = receiptInfo();
  const receiptFiles = assignment ? [...document.querySelectorAll('#sidebar_content .details .content a[href]')].filter(visible).flatMap(a=>{
    const u=official(a.href);
    if(!u || !new RegExp('^/courses/'+assignment[1]+'/assignments/'+assignment[2]+'/submissions/(?:self|[0-9]+)/?$').test(u.pathname) ||
      !/^\d+$/.test(u.searchParams.get('download')||'') || u.searchParams.has('comment_id'))return [];
    return [{id:u.searchParams.get('download'),name:(a.download || text(a).replace(/^(?:download\s+|下载\s*|下載\s*|télécharger\s+|descargar\s+)/i,'')).trim()}];
  }) : [];
  let enhancedUpload=false;
  if(enhanced && !enhanced.closest('.user_content')){
    const select=enhanced.querySelector('[data-testid="attemptSelect"]');
    const attemptInput=select?.matches('input,select')?select:select?.querySelector('input,select');
    const attemptLabel=attemptInput?.selectedOptions?.[0]?.textContent || attemptInput?.value || text(select);
    const n=String(attemptLabel).trim().match(/^(?:Attempt\s+(\d+)|第\s*(\d+)\s*次(?:尝试|嘗試|提交)?|(?:尝试|嘗試)\s*(\d+))$/i);
    const number=n && Number(n[1]||n[2]||n[3]);
    const status=enhanced.querySelector('[data-testid="submission-workflow-tracker-title"]');
    const submit=enhanced.querySelector('button[data-testid="submit-button"]');
    const pane=enhanced.querySelector('[data-testid="upload-pane"]');
    const choice=enhanced.querySelector('[data-testid="submission-type-selector"] [data-testid="online_upload"] button');
    const progress=/^(?:in progress|进行中|正在进行|進行中)$/i.test(text(status));
    // An editable first draft and a published file preview are distinct Canvas states.
    if(number===1 && progress && visible(submit) && (visible(pane)||visible(choice))){
      receipt.submitted=false;receipt.attempt=0;enhancedUpload=true;
    }
    const preview=enhanced.querySelector('[data-testid="file-preview"] [data-testid="uploaded_files_table"]');
    if(number && visible(preview) && status && !progress && /submitted|review feedback|已提交|提交于|提交於|查看反馈|查看回饋/i.test(text(status)+' '+text(enhanced.querySelector('[data-testid="submission-workflow-tracker-subtitle"]')))){
      receipt.submitted=true;receipt.attempt=number;
      for(const row of preview.querySelectorAll('tbody tr')){
        const cell=row.querySelector('[data-testid="download-file"]')?.previousElementSibling;
        const nameCell=row.cells[1];
        if(!cell || !nameCell)continue;
        // The full accessible name follows the visually shortened name in Canvas' file preview.
        const fullName=nameCell.lastElementChild?.textContent?.trim() || text(nameCell);
        if(fullName)receiptFiles.push({name:fullName});
      }
    }
  }
  if (receipt.submitted == null && visible(opener) && /^(?:start assignment|开始作业|開始作業)$/i.test(text(opener))) receipt.submitted=false;
  const receiptLink=assignment && [...document.querySelectorAll('#sidebar_content .details a[href],a[data-testid="submission-details-link"]')].find(a=>{
    const u=official(a.href); return visible(a) && u && !u.search && new RegExp('^/courses/'+assignment[1]+'/assignments/'+assignment[2]+'/submissions/(?:self|[0-9]+)/?$').test(u.pathname);
  });
  const recognizableEmpty = /you are not enrolled in any courses|未注册任何课程|尚未注册任何课程|没有注册任何课程|您未加入任何课程|未註冊任何課程|您沒有註冊任何課程|未选修任何课程|no (?:está|estás) (?:inscrit[oa]|matriculad[oa]) en ningún curso|aucun cours|登録されているコースはありません|등록된 강좌가 없습니다/i.test(mainText)
    || (url.pathname==='/courses' && !!document.querySelector('#past_enrollments_table,#future_enrollments_table') && !hasCourseTable);
  const busy = !!root.querySelector('[aria-busy="true"],.loadingIndicator,[data-testid="loading-spinner"]');
  return { logged, user: accountName, webIdentity:identity ? (identity[1]||identity[2]) : null, pageUrl:url.href, denied, notFound,
    enrollments, hasCourseTable, recognizableEmpty, links, tabs, next, extraPages:pager.length>next.length,
    download: download?.href || null, receiptUrl: receiptLink?.href || null, receiptFiles,body,bodyLinks,syllabus:!!rich&&!assignment,upload:!!upload||enhancedUpload,due,...receipt,busy };
}
const SITE = 'https://oc.sjtu.edu.cn';
const valid = raw => { try { const u=new URL(raw); return u.origin === SITE && !u.username && !u.password ? u : null; } catch { return null; } };
const fail = (status,message) => Object.assign(new Error(message),{status});
const sections = { assignments:'assignments', files:'files', modules:'modules', announcements:'announcements', quizzes:'quizzes', discussions:'discussion_topics', pages:'pages' };
const keys = { assignments:'assignments', files:'files', modules:'modules', announcements:'discussion_topics', quizzes:'quizzes', discussions:'discussion_topics',pages:'pages' };

async function readCourses(loadPage, options = {}) {
  const safe = async raw => {
    const page=await loadPage(raw);
    if (!page || page.login || !page.logged) throw fail(401,'交大 Canvas 登录已过期，请用自己的 jAccount 重新登录。');
    if (page.denied) throw fail(403,'学校未开放此页面。');
    if (page.notFound) throw fail(404,'学校显示此页不存在或未开放。');
    if (page.busy) throw fail(503,'学校页面尚未加载完毕，请稍后同步。');
    return page;
  };
  const index=await safe(SITE+'/courses');
  if (!index.hasCourseTable && !index.recognizableEmpty && !index.enrollments?.length) throw fail(422,'未识别学校的课程列表，已保留上次的同步结果。');
  const courses=[], seen=new Set(), warnings=[];
  const previous=options.previousSnapshot;
  const previousCourses=index.webIdentity && previous?.webIdentity===index.webIdentity ? previous.courses || [] : [];
  const sameDisplayName=!index.webIdentity && !previous?.webIdentity && index.user && index.user===options.previousUser;
  for (const item of index.enrollments || []) {
    const id=valid(item.href)?.pathname.match(/^\/courses\/(\d+)\/?$/)?.[1];
    if(!id || seen.has(id))continue;
    seen.add(id);
    const url=SITE+'/courses/'+id;
    const c={id,name:item.title,code:'',url,files:[],assignments:[],announcements:[],quizzes:[],modules:[],events:[],pages:[],discussions:[],warnings:[]};
    const old=previousCourses.find(course=>course.id===id);
    const previousMaterial=old || (sameDisplayName && previous?.courses?.find(course=>course.id===id));
    const moduleFiles=new Map();
    courses.push(c);
    let home;
    try { home=await safe(url); } catch(e){if(e.status===401)throw e;c.warnings.push(e.message);continue;}
    const approved=new Set((home.tabs || []).map(h=>valid(h)?.pathname?.replace(/\/$/,'')));
    const coursePath='/courses/'+id+'/';
    if(!approved.size) c.warnings.push('未识别课程导航，仅列出主页中已发布的链接。');
    function record(key, entry) {
      const u=valid(entry.href); if (!u || !entry.title) return;
      const prefix=coursePath+keys[key]+'/';
      let tail;
      if (key==='files') {
        const preview=u.searchParams.get('preview'), filePath=coursePath+'files';
        if (/^\d+$/.test(preview||'') && (u.pathname===filePath || u.pathname===filePath+'/' || u.pathname.startsWith(filePath+'/folder/'))) tail=preview;
        else tail=(u.pathname.match(new RegExp('^'+filePath+'/(\\d+)(?:/download)?/?$')) || u.pathname.match(/^\/files\/(\d+)(?:\/download)?\/?$/))?.[1];
      } else if (u.pathname.startsWith(prefix)) tail=u.pathname.slice(prefix.length).replace(/\/$/,'');
      if(!tail)return;
      if(key==='modules')return;
      if(key==='pages' ? !/^[^/]+$/.test(tail) || ['new','front_page'].includes(tail) : !/^\d+$/.test(tail))return;
      const existing=c[key].find(x=>x.id===tail);
      if(existing){
        if(!existing.dueAt && entry.dueAt)existing.dueAt=entry.dueAt;
        if(!existing.dueLabel && entry.dueLabel)existing.dueLabel=entry.dueLabel;
        if(key==='assignments' && typeof entry.submitted==='boolean')existing.submitted=entry.submitted;
        return;
      }
      const ref={id:tail,title:entry.title,url:u.origin+u.pathname};
      if(key==='files') c.files.push({id:tail,name:entry.title,url:SITE+prefix+tail,size:null,updatedAt:null});
      else c[key].push({...ref, dueAt:entry.dueAt || null, dueLabel:entry.dueLabel || '', submitted:entry.submitted ?? null,
        ...(key==='assignments' ? {submissionEvidence:{status:'unknown',attempt:null,submittedAt:null}} : {})});
    }
    // The file detail URL is also linked from rich-text pages and course modules.
    function collect(page, key) {
      for (const link of page.links || []) {
        if(key) record(key,link);
        record('files',link); record('assignments',link); record('quizzes',link);
        if(key==='modules' || !key) {
          const u=valid(link.href);
          if(u && u.pathname.startsWith(coursePath+'modules/items/') && link.title) {
            const itemId=u.pathname.slice((coursePath+'modules/items/').length);
            if(!/^\d+$/.test(itemId))continue;
            if(!c.modules.length)c.modules.push({id:'published',title:'课程单元',url:url+'/modules',items:[]});
            const items=c.modules[0].items;
            if(!items.some(i=>i.id===itemId))items.push({id:itemId,title:link.title,url:u.origin+u.pathname});
            if(link.moduleFile)moduleFiles.set(itemId,link);
          }
        }
      }
    }
    function resources(page) {
      const attachments=[];
      for(const link of page.bodyLinks || []) {
        const u=valid(link.href);
        if(!u)continue;
        // Accept file links already displayed in the course's instructions, including the preview variant.
        const direct=u.pathname.match(new RegExp('^(?:'+coursePath.slice(0,-1)+')?/files/(\\d+)(?:/download)?/?$'));
        const preview=u.pathname===coursePath+'files' || u.pathname.startsWith(coursePath+'files/folder/') ? u.searchParams.get('preview') : null;
        const fileId=direct?.[1] || (/^\d+$/.test(preview||'') ? preview : null);
        if(!fileId || attachments.some(a=>a.id===fileId))continue;
        record('files',link);
        const file=c.files.find(f=>f.id===fileId);
        if(file)attachments.push({id:fileId,name:file.name,url:file.url});
      }
      return {text:page.body||'',url:page.pageUrl,attachments};
    }
    collect(home);
    const syllabus=coursePath+'assignments/syllabus';
    const syllabusLink=(home.links||[]).some(l=>valid(l.href)?.pathname===syllabus);
    if(approved.has(syllabus) || syllabusLink || home.syllabus) {
      try {
        const page=home.syllabus ? home : await safe(SITE+syllabus);
        if(page.body || page.bodyLinks?.length)c.requirements=resources(page);
      } catch(e){if(e.status===401)throw e;c.warnings.push('课程大纲：'+e.message);}
    }
    for(const [key,slug] of Object.entries(sections)) {
      const pagePath=coursePath+slug;
      if (!approved.has(pagePath)) continue;
      // Do not request tabs a course has not exposed in its navigation.
      const queue=[SITE+pagePath], visited=new Set();
      try {
        while(queue.length) {
          const current=queue.shift(), u=valid(current);
          if(!u || visited.has(u.href))continue;
          visited.add(u.href);
          if(!options.fullMaterials && visited.size>100){c.warnings.push('此栏目超过 100 页，可使用一键拉取继续读取。');break;}
          const page=await safe(u.href); collect(page,key);
          if(page.extraPages && !c.warnings.includes('有些分页只在学校网页内提供翻页按钮。')) c.warnings.push('有些分页只在学校网页内提供翻页按钮。');
          const candidates=[...(page.next||[])];
          if(key==='files') candidates.push(...(page.links||[]).filter(l=>{
            const f=valid(l.href);return f && !f.searchParams.has('preview') && (f.pathname.startsWith(pagePath+'/folder/') ||
              (f.pathname===pagePath && ['folder','folder_id'].some(k=>f.searchParams.has(k))));
          }).map(l=>l.href));
          for(const raw of candidates){const to=valid(raw);
            if(to && (to.pathname===pagePath || (key==='files' && to.pathname.startsWith(pagePath+'/folder/'))) && !visited.has(to.href))queue.push(to.href);}
        }
      } catch(e){if(e.status===401)throw e;c.warnings.push(slug+'：'+e.message);}
    }
    // Follow only attachments explicitly offered as such by a visible module item. Never open
    // untyped module links, external tools or quiz launches just to determine their type.
    const fileBudget=options.fullMaterials ? moduleFiles.size : options.background ? 12 : 90;
    for(const link of [...moduleFiles.values()].slice(0,fileBudget)){
      try {
        const detail=await safe(link.href), final=valid(detail.pageUrl), direct=valid(detail.download);
        if(final && (final.pathname.startsWith(coursePath+'files') || /^\/files\/\d+\/?$/.test(final.pathname)))
          record('files',{href:final.href,title:link.title});
        else if(direct && (direct.pathname.startsWith(coursePath+'files/') || /^\/files\/\d+\/download\/?$/.test(direct.pathname)))
          record('files',{href:direct.href,title:link.title});
      }catch(e){if(e.status===401)throw e;c.warnings.push(link.title+'：'+e.message);}
    }
    if(moduleFiles.size>fileBudget)c.warnings.push('部分单元附件仍可从原站的单元链接打开。');
    if(options.details !== false) {
      let checked=0;
      for(const a of c.assignments){
        const past=old?.assignments?.find(other=>other.id===a.id);
        const material=previousMaterial?.assignments?.find(other=>other.id===a.id);
        if(options.background && material){
          for(const field of ['description','attachments','submissionTypes']) if(material[field]!=null)a[field]=material[field];
          for(const file of a.attachments||[])record('files',{href:file.url,title:file.name});
        }
        if(options.background && past){
          if(!a.dueLabel && !a.dueAt){a.dueAt=past.dueAt || null;a.dueLabel=past.dueLabel || '';}
          if(a.submitted==null && past.checkedAt){a.submitted=past.submitted;a.checkedAt=past.checkedAt;}
          if(a.submitted===false)a.attempt=0;
          if(a.submitted===true && past.submitted===true){a.attempt=past.attempt ?? null;a.submittedAt=past.submittedAt ?? null;}
        }
        if(options.background && (a.dueAt || a.dueLabel || past?.checkedAt || checked>=2)) continue;
        if(!options.fullMaterials && checked >= 120){c.warnings.push('作业详情超过本次读取上限，其余作业可用一键拉取读取。');break;}
        checked++;
        try{
          const page=await safe(a.url);
          const material=resources(page);
          a.description=material.text;
          a.attachments=material.attachments;
          a.submissionTypes=page.upload ? ['online_upload'] : [];
          if(page.due?.dueAt || page.due?.dueLabel) {a.dueAt=page.due.dueAt||null;a.dueLabel=page.due.dueLabel||'';}
          if(typeof page.submitted==='boolean')a.submitted=page.submitted;
          a.attempt=page.attempt??null;a.submittedAt=page.submittedAt??null;
          if(a.submitted===false)a.attempt=0;
          if(!options.background && a.submitted===true && (!a.submittedAt || !a.attempt) && page.receiptUrl){
            const receipt=valid(page.receiptUrl);
            if(receipt && !receipt.search && new RegExp('^'+coursePath+'assignments/'+a.id+'/submissions/(?:self|[0-9]+)/?$').test(receipt.pathname)) {
              const detail=await safe(receipt.href);
              if(detail.submitted===true){a.attempt=detail.attempt??a.attempt;a.submittedAt=detail.submittedAt??a.submittedAt;}
            }
          }
          if (String(page.webIdentity || '')===String(index.webIdentity || '') && index.webIdentity && page.pageUrl &&
              new URL(page.pageUrl).href.replace(/\/$/,'')===a.url && !page.busy && !page.denied && !page.notFound &&
              ['submitted','unsubmitted'].includes(page.verification)) {
            a.submissionEvidence={status:page.verification,
              attempt:page.verification==='submitted' && Number.isSafeInteger(page.attempt) && page.attempt>0 ? page.attempt : null,
              submittedAt:page.verification==='submitted' ? page.submittedAt || null : null};
          }
          a.checkedAt=new Date().toISOString();
        }
        catch(e){if(e.status===401)throw e;c.warnings.push(a.title+'：'+e.message);}
      }
    }
  }
  return { user:index.user||'', snapshot:{courses,warnings,webIdentity:index.webIdentity||null}, syncedAt:new Date().toISOString() };
}
async function verifyWebSubmission(loadPage,{courseId,assignmentId,expectedIdentity}) {
  const unknown={status:'unknown',attempt:null,submittedAt:null};
  if (![courseId,assignmentId,expectedIdentity].every(id=>/^[1-9]\d*$/.test(String(id)))) return unknown;
  const url=SITE+'/courses/'+courseId+'/assignments/'+assignmentId;
  function valid(page,address) {
    if(!page?.logged || page.login || page.denied || page.notFound || page.busy || String(page.webIdentity)!==String(expectedIdentity))return false;
    try { const u=new URL(page.pageUrl);return !u.search && !u.hash && u.origin+u.pathname.replace(/\/$/,'')===address; }
    catch { return false; }
  }
  const first=await loadPage(url);
  if(!valid(first,url))return unknown;
  if(first.verification==='unsubmitted')return {status:'unsubmitted',attempt:null,submittedAt:null};
  if(first.verification!=='submitted')return unknown;
  let record=first;
  if(!Number.isInteger(first.attempt) && first.receiptUrl){
    const receipt=new URL(first.receiptUrl,url);
    if(receipt.origin===SITE && !receipt.search && !receipt.hash &&
       new RegExp('^/courses/'+courseId+'/assignments/'+assignmentId+'/submissions/(?:self|[1-9]\\d*)/?$').test(receipt.pathname)) {
      const address=SITE+receipt.pathname.replace(/\/$/,'');
      const detail=await loadPage(address);
      if(!valid(detail,address) || detail.verification!=='submitted')return unknown;
      record=detail;
    }
  }
  return {status:'submitted',attempt:Number.isSafeInteger(record.attempt) && record.attempt>0 ? record.attempt : null,
    submittedAt:record.submittedAt || first.submittedAt || null};
}
module.exports={readSchoolPage,readCourses,verifyWebSubmission};
