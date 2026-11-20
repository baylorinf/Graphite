import { getLang } from '/i18n.js';
import { canvasText } from '/canvas-strings.js';

const TYPES = ['online_text_entry', 'online_url', 'online_upload'];
const t = key => canvasText(getLang(), key);
export function supportedTypes(assignment, mode) {
  const max = assignment.allowedAttempts;
  if (assignment.locked || (max != null && max >= 0 && Number(assignment.attempt || 0) >= max + Number(assignment.extraAttempts || 0))) return [];
  if (mode === 'web') {
    if (assignment.submitted && !Number.isInteger(assignment.attempt)) return [];
    return assignment.submissionTypes?.includes('online_upload') ? ['online_upload'] : [];
  }
  return TYPES.filter(value => assignment.submissionTypes?.includes(value));
}

// What Canvas said about the student's submission when the assignment was read: `submissionEvidence`
// {status: submitted | unsubmitted | unknown, attempt, submittedAt}. Old records have no such field, and the
// `attempt` shown in lists defaults to 0, which is no evidence of anything, so it is never used here.
const count = value => (typeof value === 'number' || (typeof value === 'string' && /^\d+$/.test(value))) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : null;
export function evidenceOf(raw) {
  if (!raw || typeof raw !== 'object' || !['submitted', 'unsubmitted', 'unknown'].includes(raw.status)) return null;
  return Object.freeze({status: raw.status, attempt: count(raw.attempt), submittedAt: typeof raw.submittedAt === 'string' ? raw.submittedAt : null});
}
// Evidence clear enough to compare against later: not submitted (and no attempt counted), or submitted with a
// known attempt number.
export function explicitEvidence(e) {
  return !!e && ((e.status === 'unsubmitted' && !(e.attempt > 0)) || (e.status === 'submitted' && e.attempt != null));
}
// A Canvas answer counts for a draft only when it names the same account (a non-empty string, exactly the draft's
// owner; an array or a number is never an identity), the same course and the same assignment (each a non-empty
// string or a whole number, never an array or an object that merely prints the same).
const accountId = value => typeof value === 'string' && value.trim() !== '';
const recordId = value => (typeof value === 'string' && value.trim() !== '') || (typeof value === 'number' && Number.isSafeInteger(value) && value > 0);
export function answersDraft(v, owner, courseId, assignmentId) {
  return !!v && typeof v === 'object' && accountId(owner) && accountId(v.accountKey) && v.accountKey === owner &&
    [v.courseId, v.assignmentId, courseId, assignmentId].every(recordId) &&
    String(v.courseId) === String(courseId) && String(v.assignmentId) === String(assignmentId);
}
// After an unclear submission, what a fresh Canvas answer means compared with the draft's baseline:
// 'received' | 'not-received' | 'unknown'. Contradictions (the baseline had a submission, and now Canvas says
// nothing was submitted) stay unknown: no restoring, nothing sent again.
export function verdict(baseline, v) {
  if (!explicitEvidence(baseline)) return 'unknown';
  const now = evidenceOf(v);
  if (!now) return 'unknown';
  if (now.status === 'submitted') {
    if (baseline.status === 'unsubmitted') return 'received';
    return now.attempt != null && now.attempt > baseline.attempt ? 'received' : 'unknown';
  }
  if (now.status === 'unsubmitted' && !(now.attempt > 0) && baseline.status === 'unsubmitted') return 'not-received';
  return 'unknown';
}

// Submission drafts, including File handles, live in this tab's memory. The final request is sent only
// from the explicit confirmation button. A missing network response can still mean Canvas accepted it.
//
// Every draft belongs to one Canvas account: the accountKey from /api/canvas/status (never the display name,
// which two students can share). When the session or the identity changes, the open window closes and every
// request still running for it (file list, preview, verification) is ignored when it answers:
//  - the session expired, or the identity is briefly unknown (signing in again): the drafts are kept, sending is
//    impossible, and a draft that was being previewed must be previewed again;
//  - the same accountKey comes back: the drafts are there again, still asking for a new preview;
//  - another accountKey, or you disconnect: the previous account's drafts are deleted.
// Nothing is ever sent without the confirmation button, and nothing is sent again by itself after an unclear result.
export function createSubmissionDialog({esc, formatTime, getState, listFiles, authorize, openOfficial, onAccepted, verify}) {
  const drafts = new Map();      // `${accountKey}/${courseId}/${assignmentId}` → draft
  let dialog = null, active = null;
  let epoch = 0;                 // bumped on every session or identity change; older answers are dropped
  let lastKey = null;            // the account the drafts in memory belong to
  const keyOf = state => (state && state.accountKey) || null;
  function dismiss() {
    if (!dialog) return;
    dialog.close(); dialog.remove(); dialog = null; active = null;
  }
  function control(action, label, primary = false) {
    return `<button type="button" class="mod-button${primary ? ' mod-cta' : ''}" data-submit-action="${action}">${esc(t(label))}</button>`;
  }
  function chosen(d) {
    return [...d.files, ...d.vault.values()];
  }
  // Names chosen twice (from the computer, the vault or both): marked so the student can remove one.
  function sameNames(files) {
    const count = new Map();
    for (const f of files) { const k = f.name.normalize('NFC').toLowerCase(); count.set(k, (count.get(k) || 0) + 1); }
    return k => count.get(k.normalize('NFC').toLowerCase()) > 1;
  }
  function attachmentList(files, editable = false) {
    const dup = sameNames(files);
    return files.length ? '<ul class="cv-attachment-list">' + files.map((f, i) => `<li${dup(f.name) ? ' class="cv-dup"' : ''}><span>${esc(f.path || f.name)}</span> <small class="cv-meta">${esc(new Intl.NumberFormat(getLang(), {style:'unit',unit:'byte',unitDisplay:'short'}).format(f.size))}</small>${dup(f.name) ? ` <small class="cv-error">${esc(t('sameName'))}</small>` : ''}${editable ? ` <button type="button" class="cv-remove" aria-label="${esc(t('removeFile') + ' · ' + f.name)}" data-submit-action="remove" data-index="${i}">×</button>` : ''}</li>`).join('') + '</ul>' : '';
  }
  function allowedToSend(d) {
    const state = getState();
    // Only the account the draft was written for may send it. (A session the school can't identify, accountKey
    // null on both sides, still sends as before; any change of identity pauses the draft — see sessionChanged.)
    if (!state?.connected || d.paused || keyOf(state) !== d.owner) return false;
    return state.authMode === 'web' ? state.canSubmitFiles === true && supportedTypes(d.item, 'web').includes(d.type) : state.canSubmit;
  }
  function vaultRows(d) {
    const needle = d.filter.trim().toLowerCase();
    const matches = (d.index || []).filter(f => !needle || f.path.toLowerCase().includes(needle));
    return matches.length ? matches.slice(0,d.limit).map(f => `<label><input type="checkbox" data-vault-path="${esc(f.path)}" ${d.vault.has(f.path) ? 'checked' : ''}><span>${esc(f.path)}</span></label>`).join('') +
      (matches.length > d.limit ? control('more-files','more') : '') : '<p class="cv-meta">' + esc(t('noFiles')) + '</p>';
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
    const files = chosen(d);
    if (!files.length) return t('chooseFiles');
    if (files.length > 20 || files.reduce((sum,f) => sum + f.size, 0) > 64 * 1024 ** 2) return t('sizes');
    if (new Set(files.map(f => f.name.normalize('NFC').toLowerCase())).size !== files.length) return t('duplicateName');
    const allowed = extensions(d.item);
    if (allowed.length && files.some(f => !allowed.some(ext => f.name.toLowerCase().endsWith('.' + ext)))) return t('extensions') + ' · ' + allowed.join(', ');
    return '';
  }
  async function flushSelected(d) {
    if (!d.vault.size || !window.__moFlush) return;
    let timer;
    try {
      const result = await Promise.race([window.__moFlush(), new Promise(resolve => { timer = setTimeout(() => resolve(null), 8000); })]);
      // Review progress that couldn't be saved doesn't stop a submission; unsaved selected notes do.
      if (!result?.ok && (!result?.unsaved?.length ? !result?.reviewUnsaved : result.unsaved.some(f => d.vault.has(f.path)))) throw new Error();
    } catch { throw new Error(t('saveSelected')); }
    finally { clearTimeout(timer); }
  }
  async function preview(d) {
    d.error = validation(d);
    if (d.error) { draw(); return; }
    const mine = epoch;
    d.preparing = true; draw();
    try {
      const files = [...d.files];
      let total = files.reduce((sum,f) => sum + f.size, 0);
      if (d.type === 'online_upload') await flushSelected(d);
      if (d.type === 'online_upload') for (const selected of d.vault.values()) {
        const query = new URLSearchParams({path:selected.path});
        const response = await fetch('/api/canvas/vault-file?' + query, {headers:{'X-Vault':'1'},cache:'no-store'});
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.error || t('fileChanged'));
        const remaining = 64 * 1024 ** 2 - total;
        if (Number(response.headers.get('content-length')) > remaining) { await response.body?.cancel(); throw new Error(t('sizes')); }
        const bytes = await response.blob();
        if (bytes.size > remaining) throw new Error(t('sizes'));
        selected.size = bytes.size; total += bytes.size;
        files.push(new File([bytes], selected.name, {type:response.headers.get('X-Graphite-File-Type') || bytes.type}));
      }
      if (mine !== epoch) return; // the session or account changed meanwhile: this preview no longer counts
      d.prepared = files; d.phase = 'preview'; d.repreview = false;
    } catch (error) { if (mine === epoch) d.error = error.message || t('fileChanged'); }
    finally { d.preparing = false; if (d === active) draw(); }
  }
  function body(d) {
    if (d.preparing || d.verifying) return '';
    if (d.phase === 'done') {
      const r = d.receipt;
      return `<div data-submit-receipt role="status"><h3>${esc(t('receipt'))}</h3><p>${esc(t('attempt'))} · ${esc(r.attempt ?? '—')}</p><p>${esc(t('submittedAt'))} · ${esc(formatTime(r.submittedAt) || '—')}</p></div>`;
    }
    if (d.phase === 'unknown') return `<p data-submit-unknown role="alert">${esc(t('unknown'))}</p><p class="cv-meta">${esc(t('verifyFirst'))}</p>`;
    if (d.phase === 'not-received') return `<p data-submit-not-received role="status">${esc(t('notReceived'))}</p>`;
    if (d.phase === 'preview' || d.sending) {
      let content = '';
      if (d.type === 'online_upload') content = attachmentList(d.sending ? d.prepared : chosen(d));
      else content = `<div class="cv-answer">${esc(d.type === 'online_url' ? d.url : d.text)}</div>`;
      return `<h3>${esc(t(d.type))}</h3>${content}`;
    }
    const types = supportedTypes(d.item, getState()?.authMode);
    const selector = `<label for="cv-submit-type">${esc(t('type'))}</label>
      <select id="cv-submit-type">${types.map(v => `<option value="${v}"${v === d.type ? ' selected' : ''}>${esc(t(v))}</option>`).join('')}</select>`;
    if (d.type === 'online_text_entry') return selector + `<label for="cv-submit-text">${esc(t('answer'))}</label><textarea id="cv-submit-text" rows="6">${esc(d.text)}</textarea>`;
    if (d.type === 'online_url') return selector + `<label for="cv-submit-url">${esc(t(d.type))}</label><input id="cv-submit-url" type="url" value="${esc(d.url)}" autocomplete="off" placeholder="https://">`;
    const allowed = extensions(d.item);
    return selector + `<div class="cv-source-row">${control('vault','vaultFiles')}</div>
      ${d.showVault ? `<div class="cv-picker"><label for="cv-file-filter">${esc(t('filterFiles'))}</label><input type="search" id="cv-file-filter" value="${esc(d.filter)}"><div class="cv-options" data-vault-options>${d.loading ? esc(t('loading')) : vaultRows(d)}</div></div>` : ''}
      <label for="cv-submit-files">${esc(t('deviceFiles'))}</label>
      <input id="cv-submit-files" type="file" multiple${allowed.length ? ' accept="' + esc(allowed.map(x => '.' + x).join(',')) + '"' : ''}>
      <p class="cv-meta">${esc(t('sizes'))}${allowed.length ? ' ' + esc(t('extensions') + ' · ' + allowed.join(', ')) : ''}</p><div data-submit-files-list>${attachmentList(chosen(d), true)}</div>`;
  }
  function draw() {
    if (!dialog || !active) return;
    const d = active;
    let actions = '';
    if (d.sending || d.preparing || d.verifying) actions = '<span role="status">' + esc(t(d.sending ? 'sending' : 'loading')) + '</span>';
    else if (d.phase === 'edit') actions = control('preview','preview',true);
    else if (d.phase === 'preview') actions = control('edit','editDraft') +
      (allowedToSend(d) ? control('confirm','confirmSubmit',true) : getState()?.authMode === 'web' || d.paused ? '' : control('authorize','authorizeWrite',true));
    else if (d.phase === 'unknown') actions = verify ? control('verify','verify',true) : '';
    else if (d.phase === 'not-received') actions = control('restore','restoreDraft',true);
    const paused = d.paused ? `<p role="status" class="cv-feedback cv-error" data-submit-paused>${esc(t('sessionPaused'))}</p>` : '';
    const again = !d.paused && d.repreview && d.phase === 'edit' ? `<p role="status" class="cv-feedback" data-submit-repreview>${esc(t('repreview'))}</p>` : '';
    dialog.innerHTML = `<div class="cv-submit-inner"><header class="cv-head"><h2 id="cv-submit-title">${esc(t(d.item.submitted ? 'resubmit' : 'submitTask'))}</h2>
      ${!d.sending ? control('close','close') : ''}</header>
      <p class="cv-subject"><strong>${esc(d.item.title)}</strong><br>${esc(d.course.name)}${d.item.groupAssignment ? ' · ' + esc(t('groupAssignment')) : ''}</p>
      <p class="cv-meta">${esc(t('due'))} · ${esc(formatTime(d.item.dueAt) || d.item.dueLabel || t('undated'))}　 ${esc(t('attempts'))} · ${esc(d.attempt)}</p>
      ${paused}${again}${body(d)}${d.awaitingScope && !getState()?.canSubmit ? `<p role="status" class="cv-feedback">${esc(getState()?.authError || t('waiting'))}</p>` : ''}
      ${d.error ? `<p role="alert" class="cv-feedback cv-error">${esc(d.error)}</p>` : ''}
      <footer class="cv-submit-actions">${!d.sending ? control('portal','origTask') : ''}${actions}</footer></div>`;
  }
  // Old records (no evidence) and records Canvas left unclear: before the first submission, ask Canvas for the
  // current record of this assignment and this account. Kept only when it answers for this draft, clearly; set once.
  async function ensureBaseline(d) {
    if (explicitEvidence(d.baseline)) return true;
    if (!verify || !accountId(d.owner)) return false;
    const mine = epoch;
    try {
      const v = await verify(d.course.id, d.item.id, d.owner);
      if (mine !== epoch || !answersDraft(v, d.owner, d.course.id, d.item.id)) return false;
      const e = evidenceOf(v);
      if (!explicitEvidence(e)) return false;
      if (!explicitEvidence(d.baseline)) d.baseline = e;
      return true;
    } catch { return false; }
  }
  async function send(d) {
    if (d.sending || d.phase !== 'preview' || !allowedToSend(d)) return;
    if (!explicitEvidence(d.baseline)) {
      d.verifying = true; d.error = ''; draw();
      const ok = await ensureBaseline(d).finally(() => { d.verifying = false; });
      // No clear record: the draft stays as it is (nothing is sent); the student can try again or check the original.
      if (!ok) { if (d.phase === 'preview') d.error = t('baselineUnknown'); if (d === active) draw(); return; }
      if (d.phase !== 'preview' || !allowedToSend(d)) { if (d === active) draw(); return; }
    }
    const form = new FormData();
    const common = {courseId: d.course.id, assignmentId: d.item.id, type: d.type,
      expectedAttempt: d.baseline.attempt ?? 0, requestId: d.requestId || crypto.randomUUID(), confirmed: 'true'};
    d.requestId = common.requestId;
    for (const [key, value] of Object.entries(common)) form.set(key, String(value));
    if (d.type === 'online_text_entry') form.set('text', d.text);
    else if (d.type === 'online_url') form.set('url', d.url.trim());
    else for (const file of d.prepared) form.append('files', file, file.name); // exactly the files in the preview
    const mine = epoch;
    d.sending = true; d.error = ''; draw();
    try {
      const response = await fetch('/api/canvas/submit', {method:'POST',headers:{'X-Vault':'1'},body:form});
      const result = await response.json().catch(() => null);
      if (response.ok && result?.attempt != null && String(result.assignmentId) === String(d.item.id)) {
        d.receipt = result; d.phase = 'done'; d.files = []; d.vault.clear(); d.prepared = []; d.text = ''; d.url = '';
        if (mine === epoch && keyOf(getState()) === d.owner) onAccepted(d.course.id, d.item.id, result, d.owner);
      } else if (!result || response.ok || result.code === 'submission_unknown') {
        d.phase = 'unknown';
      } else if (mine !== epoch) {
        d.phase = 'unknown'; // answered after the session changed: check before anything else
      } else {
        d.error = result.error || t('error');
        if (result.code === 'attempt_changed' || result.code === 'submission_conflict') d.phase = 'unknown';
        else { d.phase = 'edit'; d.prepared = []; d.requestId = null; }
      }
    } catch { d.phase = 'unknown'; }
    finally { d.sending = false; if (d === active) draw(); }
  }
  // An unclear result: ask Canvas first (POST /api/canvas/verify-submission through `verify`). Only an answer for
  // this assignment and this account counts:
  //  - received: the attempt count went up, or the assignment was clearly not submitted before and now clearly is;
  //  - not received (status "unsubmitted"): the student may restore the draft, preview and confirm again;
  //  - anything else, or no answer: still unknown.
  // Checking never sends anything.
  async function check(d) {
    if (!verify || d.verifying) return;
    const mine = epoch;
    d.verifying = true; d.error = ''; draw();
    try {
      if (!accountId(d.owner)) { d.error = t('noNewAttempt'); return; } // no account to check against: still unknown
      const v = await verify(d.course.id, d.item.id, d.owner);
      if (mine !== epoch) return;
      const result = answersDraft(v, d.owner, d.course.id, d.item.id) ? verdict(d.baseline, v) : 'unknown';
      if (result === 'received') {
        d.receipt = {attempt: count(v.attempt), submittedAt: v.submittedAt, assignmentId: d.item.id};
        d.phase = 'done'; d.files = []; d.vault.clear(); d.prepared = []; d.text = ''; d.url = '';
        if (keyOf(getState()) === d.owner) onAccepted(d.course.id, d.item.id, d.receipt, d.owner);
      } else if (result === 'not-received') d.phase = 'not-received';
      else d.error = t(evidenceOf(v)?.status === 'unsubmitted' ? 'recordConflict' : 'noNewAttempt'); // still unknown
    } catch (error) { if (mine === epoch) d.error = error.message || t('error'); }
    finally { d.verifying = false; if (d === active) draw(); }
  }
  function open(course, item) {
    dismiss();
    // While the identity is briefly unknown (signing in again), the drafts of the last account are shown, paused.
    const owner = keyOf(getState()) || lastKey;
    const key = (owner || 'none') + '/' + String(course.id) + '/' + String(item.id);
    const attempt = Number.isInteger(Number(item.attempt)) ? Number(item.attempt) : 0;
    const evidence = evidenceOf(item.submissionEvidence);
    let d = drafts.get(key);
    // An unclear draft is replaced only when the list now clearly shows a newer attempt than its own baseline.
    const newer = explicitEvidence(d?.baseline) && d.baseline.attempt != null && evidence?.status === 'submitted' && evidence.attempt != null && evidence.attempt > d.baseline.attempt;
    if (d?.phase === 'done' || (!d?.sending && ['unknown', 'not-received'].includes(d?.phase) && newer)) d = null;
    if (!d) {
      // baseline: what Canvas said when this draft was created (null for old records; fetched before the first send).
      d = {course,item,owner,baseline:evidence,type:supportedTypes(item, getState()?.authMode)[0],text:'',url:'',files:[],vault:new Map(),prepared:[],filter:'',limit:40,index:null,phase:'edit',error:'',requestId:null,attempt,sending:false};
      drafts.set(key,d); // also while the school can't identify the session (owner null); see sessionChanged
    }
    d.paused = !getState()?.connected || keyOf(getState()) !== owner;
    active = d;
    dialog = document.createElement('dialog');
    dialog.id = 'cv-submit-dialog'; dialog.setAttribute('aria-labelledby','cv-submit-title');
    document.body.append(dialog);
    dialog.addEventListener('cancel', e => { e.preventDefault(); if (!d.sending) dismiss(); });
    dialog.addEventListener('input', e => {
      if (e.target.id === 'cv-submit-text') d.text = e.target.value;
      if (e.target.id === 'cv-submit-url') d.url = e.target.value;
      if (e.target.id === 'cv-file-filter') {
        d.filter = e.target.value; d.limit = 40;
        dialog.querySelector('[data-vault-options]').innerHTML = vaultRows(d);
      }
    });
    dialog.addEventListener('change', e => {
      if (e.target.id === 'cv-submit-type') { d.type = e.target.value; d.error = ''; draw(); }
      if (e.target.id === 'cv-submit-files') {
        // Choosing again adds to what is already chosen (the same file twice is kept once).
        for (const f of Array.from(e.target.files)) {
          if (!d.files.some(x => x.name === f.name && x.size === f.size && x.lastModified === f.lastModified)) d.files.push(f);
        }
        e.target.value = '';
        d.error = '';
        dialog.querySelector('[data-submit-files-list]').innerHTML = attachmentList(chosen(d), true);
      }
      if (e.target.hasAttribute('data-vault-path')) {
        const path = e.target.dataset.vaultPath;
        const entry = d.index?.find(f => f.path === path);
        if (entry && e.target.checked) d.vault.set(path, entry); else d.vault.delete(path);
        dialog.querySelector('[data-submit-files-list]').innerHTML = attachmentList(chosen(d), true);
      }
    });
    dialog.addEventListener('click', async e => {
      const button = e.target.closest('[data-submit-action]'), action = button?.dataset.submitAction;
      if (!action || d.sending || d.preparing || d.verifying) return;
      if (action === 'close') { dismiss(); return; }
      if (action === 'preview') return preview(d);
      if (action === 'edit') { d.phase = 'edit'; d.prepared = []; d.error = ''; draw(); return; }
      if (action === 'verify') return check(d);
      // Only here (Canvas confirmed nothing arrived, and the student chose to restore) does the draft get a new
      // request id; until then a retry would still match the unclear attempt's record.
      if (action === 'restore') { if (d.phase !== 'not-received') return; d.phase = 'edit'; d.prepared = []; d.error = ''; d.repreview = true; d.requestId = null; draw(); return; }
      if (action === 'vault') {
        d.showVault = !d.showVault; d.error = '';
        if (!d.showVault) { draw(); return; }
        const mine = epoch;
        d.loading = true; draw();
        try {
          const result = await listFiles();
          if (mine !== epoch) return;
          d.index = result.files.map(f => ({path:f.path,name:f.path.split('/').pop(),size:f.size})).sort((a,b) => a.path.localeCompare(b.path,getLang()));
        } catch (error) { if (mine === epoch) d.error = error.message || t('error'); }
        finally { d.loading = false; if (active === d) { draw(); dialog?.querySelector('#cv-file-filter')?.focus(); } }
        return;
      }
      if (action === 'more-files') { d.limit += 40; dialog.querySelector('[data-vault-options]').innerHTML = vaultRows(d); return; }
      if (action === 'remove') {
        const index = Number(button.dataset.index);
        if (index < d.files.length) d.files.splice(index,1); else d.vault.delete(chosen(d)[index]?.path);
        d.error = '';
        draw(); return;
      }
      if (action === 'confirm') return send(d);
      try {
        if (action === 'authorize') { d.error = ''; d.awaitingScope = true; await authorize(); }
        if (action === 'portal') await openOfficial(d.course.id, d.item.id);
      } catch (error) { d.error = error.message || t('error'); }
      if (active === d) draw();
    });
    draw(); dialog.showModal();
  }
  // The session or identity changed (see the top of this function).
  function sessionChanged(previous, next) {
    const nextKey = keyOf(next), was = previous?.connected, now = !!next.connected;
    const sameSession = (previous ? keyOf(previous) : lastKey) === nextKey && !!was === now;
    if (sameSession) return false;
    epoch++;
    dismiss();
    if (nextKey && lastKey && nextKey !== lastKey) drafts.clear();            // another student: nothing carries over
    // Drafts written while the school couldn't say who was signed in can't be given to the account that now shows
    // up (the display name is no proof), so they go.
    if (nextKey) for (const [k, d] of drafts) if (!d.owner) drafts.delete(k);
    for (const d of drafts.values()) {
      if (!now || nextKey !== d.owner) d.paused = true;
      else if (d.paused) d.paused = false;
      // Whatever was previewed before the change must be previewed again (and confirmed by the student).
      if (d.phase === 'preview' || d.preparing) { d.phase = 'edit'; d.prepared = []; d.preparing = false; d.repreview = true; }
      d.verifying = false; d.loading = false;
    }
    if (nextKey) lastKey = nextKey;
    return true;
  }
  return { open, dismiss,
    statusChanged(previous, next) {
      if (sessionChanged(previous, next)) return;
      if (active && active.phase === 'preview' && (previous?.canSubmit !== next.canSubmit || previous?.canSubmitFiles !== next.canSubmitFiles || previous?.authError !== next.authError)) draw();
    },
    clear() { epoch++; dismiss(); drafts.clear(); lastKey = null; },
  };
}
