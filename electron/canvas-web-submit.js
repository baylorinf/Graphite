'use strict';
const {validateMaterial} = require('../canvas-submission');
const {readSchoolPage} = require('./canvas-web');
const SITE = 'https://oc.sjtu.edu.cn';
const failure = (status, code, message) => Object.assign(new Error(message), {status, code});
const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));

// Runs in a private renderer world on one official assignment. Canvas receives only user-selected Files
// through its own upload controls; the site's form handles validation, storage and submission.
async function schoolForm(pathname, action, arg) {
  if(location.origin!=='https://oc.sjtu.edu.cn' || location.pathname.replace(/\/$/,'')!==pathname) return false;
  const classic=document.querySelector('#submit_assignment form#submit_online_upload_form');
  const enhanced=!classic && document.querySelector('[data-testid="assignments-2-student-view"]');
  const form=classic || enhanced;
  const visible=el=>!!el && el.getClientRects().length && getComputedStyle(el).visibility!=='hidden' && !el.closest('[hidden],[aria-hidden="true"],.hidden');
  if(!form || form.closest('.user_content') || (classic && (form.method!=='post' || new URL(form.action).origin!==location.origin ||
    new URL(form.action).pathname!==pathname+'/submissions')))return false;
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  async function until(fn) {
    for(let i=0;i<45;i++){const match=fn();if(match)return match;await pause(100);}
    return null;
  }
  const button=()=>form.querySelector(enhanced?'button#submit-button[data-testid="submit-button"]':'button#submit_file_button[type=submit]');
  const inputs=()=>[...form.querySelectorAll(enhanced?'[data-testid="upload-box"] input[type=file]':'input[type=file]')].filter(el=>!el.disabled && !el.closest('#submission_attachment_blank,[hidden]') &&
    (visible(el) || visible(el.closest('.submission_attachment,.attachment_wrapper,[data-testid="upload-box"]'))));
  const enhancedRows=()=>[...form.querySelectorAll('[data-testid="upload-pane"] [data-testid="uploaded_files_table"] tbody tr')];
  const needsPersonalAction=()=>[...form.querySelectorAll('input[type=checkbox],input[type=radio]')]
    .some(el=>!el.checked && !el.disabled && el.name!=='submission[group_comment]' && (visible(el) || el.required)) ||
    !!form.querySelector('[id^=turnitin_pledge_container_],[data-pledge]') ||
    [...document.querySelectorAll('#assignment_asset_processor_eula input[type=checkbox]')].some(el=>!el.checked);
  const ready=()=>visible(form) && visible(button()) && !button().disabled && !needsPersonalAction() &&
    ![...form.querySelectorAll('.bad_ext_msg,.error_message,[role=alert]')].some(el=>visible(el) && el.textContent.trim());
  if(action==='open') {
    if(enhanced){
      if(!inputs().length){
        if([...form.querySelectorAll('textarea,input[type=url],[contenteditable=true]')].some(el=>visible(el) && String(el.value||el.textContent||'').trim()) ||
          form.querySelector('[data-testid="attempt-tab"] iframe'))return false;
        const choice=form.querySelector('[data-testid="submission-type-selector"] [data-testid="online_upload"] button');
        if(!visible(choice)||choice.disabled)return false;
        choice.click();
      }
      if(!await until(()=>inputs().length) || enhancedRows().length)return false;
    } else if(!visible(form)) {
      const start=document.querySelector('#assignment_show .assignment-buttons .submit_assignment_link');
      if(!visible(start) || start.disabled || start.closest('.user_content'))return false;
      start.click();
      const tab=await until(()=>{const a=document.querySelector('#submit_assignment_tabs a[href="#submit_online_upload_form"]');return visible(form) || (visible(a)&&a);});
      if(!tab)return false;
      if(tab!==true)tab.click();
    }
    if(!await until(()=>visible(form) && inputs().length) || needsPersonalAction())return false;
    globalThis.graphiteSelection={guard:e=>e.preventDefault(),files:[],parts:[]};
    form.addEventListener('submit',globalThis.graphiteSelection.guard,true);
    return true;
  }
  const staged=globalThis.graphiteSelection;
  if(!staged || !visible(form) || needsPersonalAction())return false;
  if(action==='chunk') {
    const str=atob(arg);
    staged.parts.push(Uint8Array.from(str,ch=>ch.charCodeAt(0)));
    return true;
  }
  if(action==='file') {
    const f=new File(staged.parts,arg.name,{type:arg.type});
    if(f.size!==arg.size)return false;
    staged.files.push(f); staged.parts=[];return true;
  }
  if(action==='fill') {
    const files=staged.files;
    if(!files.length || files.length!==arg)return false;
    const first=inputs()[0];
    if(!first)return false;
    async function fill(el, selected) {
      const allow=el.accept.toLowerCase().split(',').map(t=>t.trim()).filter(Boolean);
      if(allow.length && selected.some(f=>!allow.some(ext=>ext.startsWith('.') ? f.name.toLowerCase().endsWith(ext) :
        (ext.endsWith('/*') ? f.type.startsWith(ext.slice(0,-1)) : f.type===ext))))return false;
      const transfer=new DataTransfer();for(const f of selected)transfer.items.add(f);
      el.files=transfer.files;
      el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));
      return true;
    }
    if(first.multiple){if(!await fill(first,files))return false;}
    else {
      for(let i=0;i<files.length;i++){
        if(!inputs()[i]){
          const add=form.querySelector('.add_another_file_link');
          if(!visible(add)||add.disabled)return false;
          add.addEventListener('click',event=>event.preventDefault(),{capture:true,once:true});
          add.click();if(!await until(()=>inputs()[i]))return false;
        }
        if(!await fill(inputs()[i],[files[i]]))return false;
      }
    }
    return true;
  }
  if(action==='ready' || action==='send') {
    const selected=inputs().flatMap(el=>[...el.files]);
    if(classic && (!ready() || !form.checkValidity() || selected.length!==staged.files.length ||
      selected.some((f,i)=>f.name!==staged.files[i].name || f.size!==staged.files[i].size)))return false;
    if(enhanced) {
      // React can clear the picker after it has read the files. Match Canvas' draft table itself.
      const matches=()=>{
        if(!ready())return false;
        const rows=enhancedRows();
        return rows.length===staged.files.length && staged.files.every((f,i)=>[...rows[i].cells[1]?.querySelectorAll('*')||[]]
          .some(el=>el.textContent.trim()===f.name) || rows[i].cells[1]?.textContent.trim()===f.name);
      };
      if(action==='ready' ? !await until(matches) : !matches())return false;
    }
    if(action==='send'){form.removeEventListener('submit',staged.guard,true);button().click();}
    return true;
  }
  return false;
}

async function submitThroughSchool(w, input, {beforePost, loadPage, isolated, receiptTimeout=600000}) {
  const {courseId,assignmentId,expectedAttempt,expectedWebIdentity}=input;
  if(!/^[1-9]\d*$/.test(courseId) || !/^[1-9]\d*$/.test(assignmentId) || input.type!=='online_upload')
    throw failure(422,'school_form','这项作业请在 Graphite 的学校作业页完成。');
  if(!Number.isSafeInteger(expectedAttempt)||expectedAttempt<0)throw failure(409,'attempt_changed','请先同步学校的最新提交次数。');
  const {files}=validateMaterial(input);
  const path='/courses/'+courseId+'/assignments/'+assignmentId, url=SITE+path;
  const schoolFormRequired=()=>failure(422,'school_form','学校这份作业需要在 Graphite 的学校作业页完成，请在那里核对要求并提交。');
  const changed=()=>failure(409,'attempt_changed','学校的最新提交记录与当前选择不同，请同步后重新核对。');
  const unknown=()=>failure(502,'submission_unknown','学校可能已收到文件，请核对作业回执后再决定是否重交。');
  const page=await loadPage(w,url);
  if(page.login || !page.logged)throw failure(401,'submission_access','请重新使用 jAccount 登录。');
  if(page.denied || !page.upload || page.notFound || page.busy || !page.pageUrl || new URL(page.pageUrl).pathname.replace(/\/$/,'')!==path)throw schoolFormRequired();
  if(!expectedWebIdentity && !input.expectedWebUser)throw schoolFormRequired();
  const sameUser=p=>expectedWebIdentity ? String(p.webIdentity)===String(expectedWebIdentity) : p.user===input.expectedWebUser;
  if(!sameUser(page))throw changed();
  const attempt = p=>p?.submitted===false ? 0 : p?.submitted===true && Number.isSafeInteger(p.attempt) ? p.attempt : null;
  if(attempt(page)!==expectedAttempt)throw changed();
  const command=(name,arg=null)=>isolated(w,'('+schoolForm.toString()+')('+[path,name,arg].map(x=>JSON.stringify(x)).join(',')+')');
  if(!await command('open'))throw schoolFormRequired();
  for(const file of files){
    for(let start=0;start<file.size;start+=384*1024){
      const bytes=Buffer.from(await file.slice(start,start+384*1024).arrayBuffer());
      if(!await command('chunk',bytes.toString('base64')))throw schoolFormRequired();
    }
    if(!await command('file',{name:file.name,size:file.size,type:file.type}))throw schoolFormRequired();
  }
  if(!await command('fill',files.length) || !await command('ready'))throw schoolFormRequired();
  const read=()=>isolated(w,'('+readSchoolPage.toString()+')()');
  const before=await read();
  if(attempt(before)!==expectedAttempt || !sameUser(before))throw changed();
  await beforePost();
  try {
    // Navigation can destroy the execution context immediately after the official button is pressed.
    // In that case wait for the actual receipt and never click again.
    let sent;
    try { sent=await command('send'); } catch {}
    if(sent===false)throw schoolFormRequired();
    const end=Date.now()+receiptTimeout;
    do {
      await wait(350);
      const live=await read().catch(()=>null);
      if(!live?.logged || live.denied || !live.pageUrl || new URL(live.pageUrl).pathname.replace(/\/$/,'')!==path ||
        live.submitted!==true || !sameUser(live))continue;
      const names=(live.receiptFiles||[]).map(f=>f.name).sort();
      if(names.length!==files.length || files.map(f=>f.name).sort().some((name,i)=>name!==names[i]))continue;
      const next=live.attempt ?? (expectedAttempt===0 && before.submitted===false ? 1 : null);
      if(next!==expectedAttempt+1)continue;
      return {assignmentId:String(assignmentId),attempt:next,submittedAt:live.submittedAt||null,url,files:live.receiptFiles};
    } while(Date.now()<end && !w.isDestroyed());
  } catch(e){if(e.code==='school_form')throw e;throw unknown();}
  throw unknown();
}
module.exports={submitThroughSchool};
