import { getLang } from '/i18n.js';
import { canvasText } from '/canvas-strings.js';

const TYPES = ['online_text_entry', 'online_url', 'online_upload'];
const t = key => canvasText(getLang(), key);
export function supportedTypes(assignment) {
  const max = assignment.allowedAttempts;
  if (assignment.locked || (max != null && max >= 0 && Number(assignment.attempt || 0) >= max + Number(assignment.extraAttempts || 0))) return [];
  return TYPES.filter(value => assignment.submissionTypes?.includes(value));
}

// Submission drafts, including File handles, live in this tab's memory. The final request is sent only
// from the explicit confirmation button. A missing network response can still mean Canvas accepted it.
export function createSubmissionDialog({esc, formatTime, getState, authorize, openOfficial, onAccepted}) {
  const drafts = new Map();
  let dialog = null, active = null;
  function dismiss() {
    if (!dialog) return;
    dialog.close(); dialog.remove(); dialog = null; active = null;
  }
  function control(action, label, primary = false) {
    return `<button type="button" class="mod-button${primary ? ' mod-cta' : ''}" data-submit-action="${action}">${esc(t(label))}</button>`;
  }
  function attachmentList(files) {
    return files.length ? '<ul class="cv-attachment-list">' + files.map(f => '<li>' + esc(f.name) + '</li>').join('') + '</ul>' : '';
  }
  function extensions(item) {
    return (item.allowedExtensions || []).map(x => String(x).replace(/^\./,'').toLowerCase()).filter(x => /^[a-z0-9][a-z0-9._+-]*$/.test(x));
  }
  function validation(d) {
    if (d.type === 'online_text_entry') return d.text.trim() ? '' : t('enterAnswer');
    if (d.type === 'online_url') {
      try { const u = new URL(d.url); if (['https:','http:'].includes(u.protocol) && u.hostname && !u.username && !u.password) return ''; } catch { /* Presented below. */ }
      return t('enterUrl');
    }
    if (!d.files.length) return t('chooseFiles');
    if (d.files.length > 20 || d.files.reduce((sum,f) => sum + f.size, 0) > 64 * 1024 ** 2) return t('sizes');
    const allowed = extensions(d.item);
    if (allowed.length && d.files.some(f => !allowed.some(ext => f.name.toLowerCase().endsWith('.' + ext)))) return t('extensions') + ' · ' + allowed.join(', ');
    return '';
  }
  function body(d) {
    if (d.phase === 'done') {
      const r = d.receipt;
      return `<div data-submit-receipt role="status"><h3>${esc(t('receipt'))}</h3><p>${esc(t('attempt'))} · ${esc(r.attempt ?? '—')}</p><p>${esc(t('submittedAt'))} · ${esc(formatTime(r.submittedAt) || '—')}</p></div>`;
    }
    if (d.phase === 'unknown') return `<p data-submit-unknown role="alert">${esc(t('unknown'))}</p>`;
    if (d.phase === 'preview' || d.sending) {
      let content = '';
      if (d.type === 'online_upload') content = attachmentList(d.files);
      else content = `<div class="cv-answer">${esc(d.type === 'online_url' ? d.url : d.text)}</div>`;
      return `<h3>${esc(t(d.type))}</h3>${content}`;
    }
    const types = supportedTypes(d.item);
    const selector = `<label for="cv-submit-type">${esc(t('type'))}</label>
      <select id="cv-submit-type">${types.map(v => `<option value="${v}"${v === d.type ? ' selected' : ''}>${esc(t(v))}</option>`).join('')}</select>`;
    if (d.type === 'online_text_entry') return selector + `<label for="cv-submit-text">${esc(t('answer'))}</label><textarea id="cv-submit-text" rows="6">${esc(d.text)}</textarea>`;
    if (d.type === 'online_url') return selector + `<label for="cv-submit-url">${esc(t(d.type))}</label><input id="cv-submit-url" type="url" value="${esc(d.url)}" autocomplete="off" placeholder="https://">`;
    const allowed = extensions(d.item);
    return selector + `<label for="cv-submit-files">${esc(t('attachments'))}</label>
      <input id="cv-submit-files" type="file" multiple${allowed.length ? ' accept="' + esc(allowed.map(x => '.' + x).join(',')) + '"' : ''}>
      <p class="cv-meta">${esc(t('sizes'))}${allowed.length ? ' ' + esc(t('extensions') + ' · ' + allowed.join(', ')) : ''}</p><div data-submit-files-list>${attachmentList(d.files)}</div>`;
  }
  function draw() {
    if (!dialog || !active) return;
    const d = active;
    let actions = '';
    if (d.sending) actions = '<span role="status">' + esc(t('sending')) + '</span>';
    else if (d.phase === 'edit') actions = control('preview','preview',true);
    else if (d.phase === 'preview') actions = control('edit','editDraft') +
      (getState()?.canSubmit ? control('confirm','confirmSubmit',true) : control('authorize','authorizeWrite',true));
    dialog.innerHTML = `<div class="cv-submit-inner"><header class="cv-head"><h2 id="cv-submit-title">${esc(t(d.item.submitted ? 'resubmit' : 'submitTask'))}</h2>
      ${!d.sending ? control('close','close') : ''}</header>
      <p class="cv-subject"><strong>${esc(d.item.title)}</strong><br>${esc(d.course.name)}${d.item.groupAssignment ? ' · ' + esc(t('groupAssignment')) : ''}</p>
      <p class="cv-meta">${esc(t('due'))} · ${esc(formatTime(d.item.dueAt) || d.item.dueLabel || t('undated'))}　 ${esc(t('attempts'))} · ${esc(d.attempt)}</p>
      ${body(d)}${d.awaitingScope && !getState()?.canSubmit ? `<p role="status" class="cv-feedback">${esc(getState()?.authError || t('waiting'))}</p>` : ''}
      ${d.error ? `<p role="alert" class="cv-feedback cv-error">${esc(d.error)}</p>` : ''}
      <footer class="cv-submit-actions">${!d.sending ? control('portal','origTask') : ''}${actions}</footer></div>`;
  }
  async function send(d) {
    if (d.sending || d.phase !== 'preview' || !getState()?.canSubmit) return;
    const form = new FormData();
    const common = {courseId: d.course.id, assignmentId: d.item.id, type: d.type,
      expectedAttempt: d.attempt, requestId: d.requestId || crypto.randomUUID(), confirmed: 'true'};
    d.requestId = common.requestId;
    for (const [key, value] of Object.entries(common)) form.set(key, String(value));
    if (d.type === 'online_text_entry') form.set('text', d.text);
    else if (d.type === 'online_url') form.set('url', d.url.trim());
    else for (const file of d.files) form.append('files', file, file.name);
    d.sending = true; d.error = ''; draw();
    try {
      const response = await fetch('/api/canvas/submit', {method:'POST',headers:{'X-Vault':'1'},body:form});
      const result = await response.json().catch(() => null);
      if (response.ok && result?.attempt != null && String(result.assignmentId) === String(d.item.id)) {
        d.receipt = result; d.phase = 'done'; d.files = []; d.text = ''; d.url = '';
        onAccepted(d.course.id, d.item.id, result);
      } else if (!result || response.ok || result.code === 'submission_unknown') {
        d.phase = 'unknown';
      } else {
        d.error = result.error || t('error');
        if (result.code === 'attempt_changed' || result.code === 'submission_conflict') d.phase = 'unknown';
        else { d.phase = 'edit'; d.requestId = null; }
      }
    } catch { d.phase = 'unknown'; }
    finally { d.sending = false; if (d === active) draw(); }
  }
  function open(course, item) {
    dismiss();
    const key = String(course.id) + '/' + String(item.id);
    const attempt = Number.isInteger(Number(item.attempt)) ? Number(item.attempt) : 0;
    let d = drafts.get(key);
    if (d?.phase === 'done' || (!d?.sending && d?.phase === 'unknown' && attempt > d.attempt)) d = null;
    if (!d) {
      d = {course,item,type:supportedTypes(item)[0],text:'',url:'',files:[],phase:'edit',error:'',requestId:null,attempt,sending:false};
      drafts.set(key,d);
    }
    active = d;
    dialog = document.createElement('dialog');
    dialog.id = 'cv-submit-dialog'; dialog.setAttribute('aria-labelledby','cv-submit-title');
    document.body.append(dialog);
    dialog.addEventListener('cancel', e => { e.preventDefault(); if (!d.sending) dismiss(); });
    dialog.addEventListener('input', e => {
      if (e.target.id === 'cv-submit-text') d.text = e.target.value;
      if (e.target.id === 'cv-submit-url') d.url = e.target.value;
    });
    dialog.addEventListener('change', e => {
      if (e.target.id === 'cv-submit-type') { d.type = e.target.value; d.error = ''; draw(); }
      if (e.target.id === 'cv-submit-files') {
        d.files = Array.from(e.target.files);
        dialog.querySelector('[data-submit-files-list]').innerHTML = attachmentList(d.files);
      }
    });
    dialog.addEventListener('click', async e => {
      const action = e.target.closest('[data-submit-action]')?.dataset.submitAction;
      if (!action || d.sending) return;
      if (action === 'close') { dismiss(); return; }
      if (action === 'preview') { d.error = validation(d); if (!d.error) d.phase = 'preview'; draw(); return; }
      if (action === 'edit') { d.phase = 'edit'; d.error = ''; draw(); return; }
      if (action === 'confirm') return send(d);
      try {
        if (action === 'authorize') { d.error = ''; d.awaitingScope = true; await authorize(); }
        if (action === 'portal') await openOfficial(d.course.id, d.item.id);
      } catch (error) { d.error = error.message || t('error'); }
      if (active === d) draw();
    });
    draw(); dialog.showModal();
  }
  return { open, dismiss,
    statusChanged(previous, next) {
      if (previous?.user && next.user && previous.user !== next.user) { dismiss(); drafts.clear(); return; }
      if (active && active.phase === 'preview' && (previous?.canSubmit !== next.canSubmit || previous?.authError !== next.authError)) draw();
    },
    clear() { dismiss(); drafts.clear(); },
  };
}
