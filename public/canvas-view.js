import { getLang } from '/i18n.js';
import { canvasText } from '/canvas-strings.js';
import { createSubmissionDialog, supportedTypes, answersDraft, evidenceOf, explicitEvidence, verdict } from '/canvas-submit.js';

const ORIGIN = 'https://oc.sjtu.edu.cn';
const GROUPS = ['files', 'assignments', 'requirements', 'announcements', 'modules', 'quizzes', 'events', 'discussions', 'pages'];
const STEP = 12;
const label = key => canvasText(getLang(), key);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function schoolLink(value) {
  if (!value) return '';
  try {
    const url = new URL(value, ORIGIN);
    return url.origin === ORIGIN && !url.username && !url.password ? url.href : '';
  } catch { return ''; }
}
const link = (title, url) => {
  const href = schoolLink(url);
  return href ? `<a href="${esc(href)}" data-cv-read="${esc(href)}">${esc(title)}</a>` : esc(title);
};
const button = (action, text, cls = '', attrs = '') =>
  `<button type="button" class="mod-button ${cls}" data-cv="${action}" ${attrs}>${esc(text)}</button>`;
const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(value);
function dateValue(value) {
  if (!value) return null;
  const date = new Date(dateOnly(value) ? value + 'T00:00:00' : value);
  return Number.isNaN(+date) ? null : date;
}
function formatTime(value, allDay = false) {
  const date = dateValue(value);
  if (!date) return '';
  const formatter = new Intl.DateTimeFormat(getLang(), {
    year: 'numeric', month: 'short', day: 'numeric', ...(allDay || dateOnly(value) ? {} : { hour: 'numeric', minute: '2-digit' }),
  });
  return formatter.format(date);
}
function fileSize(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes)) || bytes < 0) return '';
  const unit = bytes < 1024 ? 'byte' : bytes < 1024 ** 2 ? 'kilobyte' : 'megabyte';
  const divisor = unit === 'byte' ? 1 : unit === 'kilobyte' ? 1024 : 1024 ** 2;
  return new Intl.NumberFormat(getLang(), { style: 'unit', unit, unitDisplay: 'short', maximumFractionDigits: 1 }).format(bytes / divisor);
}

function upcoming(state) {
  const now = new Date(), cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + 30);
  const startOfDay = new Date(now).setHours(0, 0, 0, 0);
  const items = [], seen = new Set(), completed = new Set(), names = new Map();
  const signature = (title, value) => String(title).trim().toLowerCase() + '|' + Number(dateValue(value));
  function resourceKeys(item, course, kind) {
    const keys = [];
    const href = schoolLink(item.url);
    if (href) {
      const url = new URL(href), path = url.pathname.replace(/\/$/, '');
      if (/^\/courses\/\d+\/(assignments|quizzes|discussion_topics)\/\d+$/.test(path) || /^\/calendar_events\/\d+$/.test(path)) keys.push(path);
      else if (url.searchParams.has('event_id')) keys.push('calendar:' + url.searchParams.get('event_id'));
    }
    const cid = course?.id ?? item.courseId;
    const assignment = item.assignmentId ?? (kind === 'assignments' ? item.id : null);
    if (cid != null && assignment != null) keys.push('/courses/' + cid + '/assignments/' + assignment);
    if (item.id != null) keys.push([cid ?? 'feed', kind, item.id].join(':'));
    return [...new Set(keys)];
  }
  function add(item, date, course, kind) {
    const time = dateValue(date);
    if (!time || time < (dateOnly(date) || item.allDay ? startOfDay : now) || time > cutoff) return;
    const sig = signature(item.title, date);
    const keys = resourceKeys(item, course, kind);
    const occurrences = keys.map(key => key + '|' + Number(time));
    if (kind === 'feed' && !schoolLink(item.url) && !item.assignmentId && names.get(sig)?.size === 1) return;
    const existing = keys.some(key => completed.has(key)) || occurrences.some(key => seen.has(key));
    for (const key of occurrences) seen.add(key);
    if (existing) return;
    items.push({ title: item.title, url: item.url, date, course: course?.name, courseId: course?.id, assignmentId: kind === 'assignments' ? item.id : null, allDay: item.allDay || dateOnly(date), time: +time });
  }
  const courses = state.snapshot?.courses || [];
  for (const course of courses) {
    for (const kind of ['assignments', 'quizzes', 'events']) {
      for (const item of course[kind] || []) {
        const date = kind === 'events' ? item.startAt : item.dueAt;
        const keys = resourceKeys(item, course, kind), sig = signature(item.title, date);
        if (!names.has(sig)) names.set(sig, new Set());
        // Match an unlinked feed entry by name and time only when one course item can account for it.
        names.get(sig).add(keys[0] || Symbol());
        if (item.submitted || item.excused) { for (const key of keys) completed.add(key); }
      }
    }
  }
  for (const course of courses) {
    for (const kind of ['assignments', 'quizzes', 'events']) for (const item of course[kind] || []) {
      if (!item.submitted && !item.excused) add(item, kind === 'events' ? item.startAt : item.dueAt, course, kind);
    }
  }
  for (const item of state.calendar?.events || []) add(item, item.startAt, null, 'feed');
  return items.sort((a, b) => a.time - b.time || String(a.title).localeCompare(String(b.title), getLang()));
}

// Graphite's tabs keep the original note open while the student checks a deadline or downloads a file.
export function createCanvasView(root, { api, openFile, onSeen }) {
  let state = null, message = '', failed = false, busy = '', readVersion = 0, poll = 0, authUntil = 0;
  let awaitWrite = false, pendingVerification = null, summaryReceipt = '', firstSyncUntil = 0;
  let selected = '', group = 'files', limit = STEP, dateLimit = STEP, confirmDisconnect = false;
  let receipt = null, bulkFailures = [], visible = false, lastPull = null, progressTimer = 0, reader = null;
  const call = (method, name, body) => api(method, 'canvas/' + name, {}, body);
  // By ID only (two courses or assignments can share a name).
  const findAssignment = (courseId, assignmentId) => state?.snapshot?.courses?.find(c => String(c.id) === String(courseId))?.assignments?.find(a => String(a.id) === String(assignmentId)) || null;
  const submission = createSubmissionDialog({
    esc, formatTime, getState: () => state, listFiles: () => api('GET', 'list'),
    authorize: async () => { const error = await perform('connect', {submit:true}); if (error) throw new Error(error); },
    openOfficial: async (courseId, assignmentId) => { const error = await perform('portal', {courseId, assignmentId}); if (error) throw new Error(error); },
    onAccepted(courseId, assignmentId, result, owner) {
      // Written into the course list only while the same account is still signed in: never into another student's
      // list (even one with a course or assignment of the same name or ID).
      if (!owner || owner !== state?.accountKey) return;
      const item = findAssignment(courseId, assignmentId);
      if (item) Object.assign(item, {submitted:true, attempt:result.attempt, submittedAt:result.submittedAt,
        submissionEvidence:{status:'submitted', attempt:result.attempt ?? null, submittedAt:result.submittedAt ?? null}});
      summaryReceipt = [label('receipt'), item?.title, label('attempt') + ' ' + result.attempt, formatTime(result.submittedAt)].filter(Boolean).join(' · ');
      render();
    },
    // An unclear submission: ask Canvas what it has for this assignment and this account. A network error or an
    // answer without the same identifiers leaves the result unknown (the dialog decides).
    verify: async (courseId, assignmentId, accountKey) => {
      if (!accountKey) return null; // no account to check against: the dialog keeps the result unknown
      const result = await call('POST', 'verify-submission', { courseId, assignmentId, accountKey });
      // Before writing into the course list: the answer names this account, course and assignment, and that account
      // is still the one signed in (an answer for A that arrives after switching to B is not written into B's list).
      if (result?.status === 'submitted' && result.attempt != null && answersDraft(result, accountKey, courseId, assignmentId) && state?.accountKey === accountKey) {
        const item = findAssignment(courseId, assignmentId);
        if (item) Object.assign(item, { submitted: true, attempt: result.attempt, submittedAt: result.submittedAt,
          submissionEvidence: { status: 'submitted', attempt: result.attempt, submittedAt: result.submittedAt ?? null } });
      }
      return result;
    },
  });
  function updateState(next) {
    // A different student (accountKey, never the display name, which two students can share).
    const otherAccount = !!(state?.accountKey && next.accountKey && state.accountKey !== next.accountKey);
    if (otherAccount || (state?.connected && !next.connected && !next.snapshot?.courses?.length)) {
      selected = ''; receipt = null; bulkFailures = []; lastPull = null; limit = STEP; dateLimit = STEP; summaryReceipt = ''; pendingVerification = null;
    }
    const previous = state;
    state = next;
    if (next.lastPull) lastPull = next.lastPull;
    if (next.connected && next.authMode === 'web' && !next.syncedAt && !previous?.connected) firstSyncUntil = Date.now() + 3 * 60_000;
    if (next.syncedAt || !next.connected) firstSyncUntil = 0;
    if ((next.connected && (!awaitWrite || next.canSubmit) || next.authError) && authUntil) { authUntil = 0; awaitWrite = false; clearTimeout(poll); message = ''; }
    submission.statusChanged(previous, next);
  }
  function notice(text, isError = false) { message = text; failed = isError; }
  function feedback() {
    return `<div class="cv-feedback${failed ? ' cv-error' : ''}" aria-live="polite" aria-atomic="true">${esc(message)}</div>`;
  }
  function pullReport() {
    if (!lastPull) return '';
    const counts = [label('saved') + ' ' + lastPull.saved, label('unchanged') + ' ' + lastPull.unchanged];
    if (lastPull.skipped) counts.push(label('skipped') + ' ' + lastPull.skipped);
    if (lastPull.failed?.length) counts.push(label('failed') + ' ' + lastPull.failed.length);
    const issues = [...(lastPull.warnings || []), ...(lastPull.failed || []).map(f => {
      const course = state.snapshot?.courses?.find(c => String(c.id) === String(f.courseId));
      return [course?.name, f.name, f.error].filter(Boolean).join(' · ');
    })];
    const detail = lastPull.notes && lastPull.files ? [label('files') + ' ' + lastPull.files.saved, label('pullNotes') + ' ' + lastPull.notes.saved].join(' / ') : '';
    return `<div class="cv-pull-result" role="status" data-pull-result><span class="cv-meta">${esc([lastPull.path || label('title'), ...counts].join(' · '))}${detail ? ` (${esc(detail)})` : ''}</span>${warnings(issues)}</div>`;
  }
  function pullProgress(progress) {
    return [label('pulling'), progress?.total ? progress.done + '/' + progress.total : '', progress?.name].filter(Boolean).join(' · ');
  }
  function warnings(list = []) {
    if (!list.length) return '';
    return `<details class="cv-warnings"><summary>${esc(label('partial'))} (${list.length})</summary><ul>${list.map(value => `<li>${esc(value)}</li>`).join('')}</ul></details>`;
  }
  function calendarForm() {
    const feed = state.calendar;
    return `<details class="cv-feed" data-keep="feed"><summary>${esc(label('feed'))}${feed ? ` <small>${esc(label('feedActive'))}</small>` : ''}</summary>
      ${feed ? `<div class="cv-bar"><span>${esc(label('synced'))} · ${esc(formatTime(feed.syncedAt))}</span>${button('calendar-remove', label('unsubscribe'))}</div>` :
        `<p id="cv-feed-help">${esc(label('feedHelp'))}</p><form data-cv-form><label for="cv-feed-input">${esc(label('feedUrl'))}</label><div class="cv-feed-row"><input id="cv-feed-input" type="password" autocomplete="off" spellcheck="false" required aria-describedby="cv-feed-help"><button class="mod-button" type="submit">${esc(label('subscribe'))}</button></div></form>`}
      </details>`;
  }
  function row(title, url, meta, action = '') {
    return `<li class="cv-row"><div class="cv-row-text"><div class="cv-title">${link(title, url)}</div>${meta ? `<div class="cv-meta">${esc(meta)}</div>` : ''}</div>${action}</li>`;
  }
  function instructions(text, attachments = []) {
    const files = attachments.filter(f => f.name && schoolLink(f.url));
    return (text ? `<p class="cv-instructions">${esc(text)}</p>` : !files.length ? `<p class="cv-meta">${esc(label('noRequirements'))}</p>` : '') +
      (files.length ? `<ul class="cv-attachment-list">${files.map(f => `<li>${link(f.name, f.url)}</li>`).join('')}</ul>` : '');
  }
  function canOpenSubmission(item) {
    return state.connected && !item.excused && (state.authMode !== 'web' || state.canSubmitFiles) && supportedTypes(item, state.authMode).length > 0;
  }
  function daysLeft(item) {
    const start = new Date().setHours(0, 0, 0, 0), d = new Date(item.time).setHours(0, 0, 0, 0);
    const n = Math.round((d - start) / 86400000);
    return `<span class="cv-due${n <= 1 ? ' cv-due-soon' : n <= 3 ? ' cv-due-near' : ''}">${esc(n <= 0 ? label('today') : n === 1 ? label('tomorrow') : label('inDays').replace('{n}', n))}</span>`;
  }
  function agenda() {
    const entries = upcoming(state);
    return `<section class="cv-block cv-agenda"><h2>${esc(label('upcoming'))}</h2>${entries.length
      ? `<ul class="cv-list">${entries.slice(0, dateLimit).map(item => {
        const a = item.assignmentId != null ? findAssignment(item.courseId, item.assignmentId) : null;
        const quick = a && canOpenSubmission(a) ? button('quick-submit', label('submitTask'), 'mod-cta cv-quick', `data-course="${esc(item.courseId)}" data-assignment="${esc(item.assignmentId)}"`) : '';
        return `<li class="cv-row">${daysLeft(item)}<div class="cv-row-text"><div class="cv-title">${link(item.title, item.url)}</div><div class="cv-meta">${esc([formatTime(item.date, item.allDay), item.allDay ? label('allDay') : '', item.course].filter(Boolean).join(' · '))}</div></div>${quick}</li>`;
      }).join('')}</ul>${entries.length > dateLimit ? button('more-dates', label('more')) : ''}`
      : `<p class="cv-meta">${esc(label('noDates'))}</p>`}</section>`;
  }
  // What the last pull put into the course folders (slides, homework, exams), with buttons to open them.
  function newFiles() {
    const m = lastPull?.mirror;
    if (!m || (!m.added?.length && !m.unlinked?.length && !m.failed?.length)) return '';
    const added = m.added || [];
    return `<section class="cv-block cv-new" data-cv-new><h2>${esc(label('newFiles'))} <small>${esc(formatTime(lastPull.finishedAt))}</small></h2>
      ${added.length ? `<ul class="cv-list">${added.slice(0, 30).map(f => `<li class="cv-row"><div class="cv-row-text"><div class="cv-title">${esc(f.path.split('/').pop())}</div><div class="cv-meta">${esc(f.path.split('/').slice(0, -1).join(' / '))}</div></div>${button('open-path', label('openFile'), '', `data-path="${esc(f.path)}"`)}</li>`).join('')}</ul>` : `<p class="cv-meta">${esc(label('noNewFiles'))}</p>`}
      ${m.duplicates ? `<p class="cv-meta">${esc(label('duplicates').replace('{n}', m.duplicates))}</p>` : ''}
      ${m.unlinked?.length ? `<p class="cv-meta">${esc(label('unlinked'))} ${esc(m.unlinked.join('、'))}</p>` : ''}
      ${m.index?.length ? `<p class="cv-meta">${esc(label('indexUpdated'))} ${m.index.map(p => `<a href="#" data-open-path="${esc(p)}">${esc(p.split('/').pop().replace(/\.md$/, ''))}</a>`).join('、')}</p>` : ''}
      ${warnings((m.failed || []).map(f => [f.course, f.name, f.error].filter(Boolean).join(' · ')))}</section>`;
  }
  // A Canvas page read inside Graphite (no browser): text, the files it links, and what you can do next.
  function readerPanel() {
    const r = reader;
    const files = r.data?.attachments || [];
    const course = state.snapshot?.courses?.find(c => String(c.id) === String(r.data?.courseId || r.courseId));
    const assignment = r.assignment ? findAssignment(r.assignment.courseId, r.assignment.id) : null;
    return `<section class="cv-block cv-reader" data-cv-reader><div class="cv-reader-bar">${button('reader-back', '← ' + label('back'))}${button('portal-url', label('inWindow'), '', `data-url="${esc(r.url)}"`)}</div>
      <h2>${esc(r.data?.title || r.title || '')}</h2>
      <p class="cv-meta">${esc([course?.name, r.data?.dueAt ? label('due') + ' ' + formatTime(r.data.dueAt) : '', r.data?.at ? formatTime(r.data.at) : ''].filter(Boolean).join(' · '))}</p>
      ${r.loading ? `<p class="cv-meta">${esc(label('loading'))}</p>` : r.error ? `<p class="cv-feedback cv-error">${esc(r.error)}</p>` :
        `<div class="cv-reader-text">${r.data?.text ? esc(r.data.text) : `<span class="cv-meta">${esc(label('emptyPage'))}</span>`}</div>`}
      ${files.length ? `<h3>${esc(label('files'))}</h3><ul class="cv-list">${files.map(f => `<li class="cv-row"><div class="cv-row-text"><div class="cv-title">${esc(f.name)}</div></div>${state.connected ? button('open-attachment', label('saveOpen'), '', `data-course="${esc(r.data.courseId)}" data-file="${esc(f.id)}"`) : ''}</li>`).join('')}</ul>` : ''}
      ${assignment && canOpenSubmission(assignment) ? `<div class="cv-reader-actions">${button('quick-submit', label(assignment.submitted ? 'resubmit' : 'submitTask'), 'mod-cta', `data-course="${esc(r.assignment.courseId)}" data-assignment="${esc(assignment.id)}"`)}</div>` : ''}
    </section>`;
  }
  // The vault folder this course lives in (its notes, slides, homework). A new folder is made when none fits.
  function linkPicker(course) {
    const cur = state.courseLinks?.[String(course.id)] || '';
    const folders = [...new Set([...(state.vaultFolders || []), cur].filter(Boolean))].sort((a, b) => a.localeCompare(b, getLang()));
    return `<div class="cv-link"><label for="cv-link">${esc(label('linkFolder'))}</label><select id="cv-link" data-course="${esc(course.id)}">${folders.map(f => `<option value="${esc(f)}"${f === cur ? ' selected' : ''}>${esc(f)}${(state.vaultFolders || []).includes(f) ? '' : ' · ' + esc(label('newFolder'))}</option>`).join('')}</select></div>`;
  }
  // The one-time move of the old Canvas/ folder into the course folders.
  function migrationNote() {
    const m = state.migration;
    if (!m || Date.now() - Date.parse(m.at) > 14 * 86400000) return '';
    return `<p class="cv-feedback" data-cv-migration>${esc(label('migrated').replace('{n}', m.moved).replace('{folders}', (m.folders || []).join('、')))}${m.left ? ' ' + esc(label('migrateLeft')) : ''}</p>`;
  }
  function resource(item) {
    if (group === 'modules') {
      const children = item.items || [];
      return `<li class="cv-module"><details data-keep="m-${esc(item.id)}"><summary>${esc(item.title)} <small>${children.length}</small></summary>${children.length ? `<ul class="cv-list">${children.map(child => row(child.title, child.url, '')).join('')}</ul>` : `<span class="cv-meta">${link(item.title, item.url)}</span>`}</details></li>`;
    }
    if (group === 'files') {
      const saved = receipt?.course === selected && receipt.file === String(item.id);
      const action = saved ? button('open-file', label('openFile')) :
        state.connected ? button('download', label('save'), '', `data-file="${esc(item.id)}"`) : '';
      return row(item.name, item.url, [fileSize(item.size), formatTime(item.updatedAt), saved ? receipt.path : ''].filter(Boolean).join(' · '), action);
    }
    let meta = formatTime(item.at || item.startAt, item.allDay);
    if (group === 'assignments' || group === 'quizzes') meta = [formatTime(item.dueAt) || item.dueLabel || label('undated'), item.excused ? label('excused') : item.submitted ? label('submitted') : ''].filter(Boolean).join(' · ');
    if (group === 'assignments' && item.groupAssignment) meta += ' · ' + label('groupAssignment');
    let action = '';
    if (group === 'assignments') {
      const direct = !canOpenSubmission(item);
      action = button('submission', label(direct ? 'origTask' : item.submitted ? 'resubmit' : 'submitTask'), '', `data-assignment="${esc(item.id)}"`);
    }
    if (group === 'assignments') {
      return `<li class="cv-row"><details class="cv-row-text" data-keep="a-${esc(selected)}-${esc(item.id)}"><summary><span class="cv-title">${esc(item.title)}</span><span class="cv-meta">${esc(meta)}</span></summary><div class="cv-details"><h3>${esc(label('assignmentDetails'))}</h3>${instructions(item.description, item.attachments)}</div></details>${action}</li>`;
    }
    return row(item.title, item.url, meta, action);
  }
  function coursePanel() {
    const courses = state.snapshot?.courses || [];
    if (!courses.length) return `<section class="cv-block"><h2>${esc(label('sections'))}</h2><p class="cv-meta">${esc(label(state.syncing ? 'syncRunning' : state.syncedAt ? 'noCourses' : 'firstSync'))}</p></section>`;
    const course = courses.find(c => String(c.id) === selected) || courses[0];
    selected = String(course.id);
    const items = course[group] || [];
    return `<section class="cv-block"><h2>${esc(label('sections'))}</h2><label for="cv-course">${esc(label('choose'))}</label>
      <select id="cv-course">${courses.map(c => `<option value="${esc(c.id)}"${String(c.id) === selected ? ' selected' : ''}>${esc(c.name)}${c.code && c.code !== c.name ? ` · ${esc(c.code)}` : ''}</option>`).join('')}</select>
      ${state.connected ? linkPicker(course) : ''}
      ${warnings(course.warnings)}
      ${state.connected && course.files?.length ? `<div class="cv-bulk">${button('download-course', label('courseDownload') + ' (' + course.files.length + ')')}</div>` : ''}
      ${bulkFailures.length ? warnings(bulkFailures) : ''}
      <div class="cv-groups">${GROUPS.filter(key => key === 'requirements' || course[key]?.length || key === group).map(key => `<button type="button" data-group="${key}" aria-pressed="${key === group}">${esc(label(key))}${key === 'requirements' ? '' : ` <small>${course[key]?.length || 0}</small>`}</button>`).join('')}</div>
      ${group === 'requirements' ? instructions(course.requirements?.text, course.requirements?.attachments) : items.length ? `<ul class="cv-list">${items.slice(0, limit).map(resource).join('')}</ul>${items.length > limit ? button('more', label('more')) : ''}` : `<p class="cv-meta">${esc(label('empty'))}</p>`}</section>`;
  }
  function render() {
    if (!visible) return;
    const open = new Set([...root.querySelectorAll('details[data-keep][open]')].map(el => el.dataset.keep));
    const draft = root.querySelector('#cv-feed-input')?.value || '';
    const focus = document.activeElement;
    const restore = root.contains(focus) && (focus.id || ['cv','group'].some(key => key in focus.dataset)) ? {id:focus.id, action:focus.dataset.cv, group:focus.dataset.group, file:focus.dataset.file} : null;
    const header = `<header class="cv-head"><div class="cv-head-title"><h1>${esc(label('title'))}</h1>${state?.user ? `<div class="cv-meta">${esc(state.user)}</div>` : ''}</div>${button('portal', label('portal'))}</header>`;
    if (!state) {
      root.innerHTML = `<div class="cv-inner">${header}${feedback()}${failed ? button('refresh', label('retry')) : `<p>${esc(label('loading'))}</p>`}</div>`;
      return;
    }
    const connected = state.connected;
    const hasData = connected || state.calendar || state.snapshot?.courses?.length;
    const latest = [state.syncedAt, state.calendar?.syncedAt].filter(Boolean).sort().at(-1);
    const logoutLabel = label(connected ? 'disconnect' : 'portalLogout');
    const logout = connected || state.portalOpened
      ? `<div class="cv-account">${connected ? `<span>${esc(label('connected'))}</span>` : ''}${confirmDisconnect
        ? `<span>${esc(label('disconnectQ'))}</span>${button('confirm-disconnect', logoutLabel)}${button('cancel-disconnect', label('cancel'))}`
        : button('disconnect', logoutLabel)}</div>` : '';
    root.innerHTML = `<div class="cv-inner">${header}${feedback()}
      <div class="cv-context">
      ${state.authError ? `<p class="cv-feedback cv-error" role="alert">${esc(state.authError)}</p>` : ''}
      ${state.authPending && !state.syncing && (!connected || awaitWrite) && !authUntil ? `<p class="cv-meta">${esc(label('waiting'))}</p>` : ''}
      ${!connected ? `<p>${esc(label(state.portalSupported ? 'webHelp' : state.configured ? 'authHint' : 'browserHelp'))}</p>
      ${button(state.portalSupported ? 'web-connect' : state.configured ? 'connect' : 'login-portal', label('login'), 'mod-cta')}` : ''}${logout}
      ${state.configured && state.portalSupported && (!connected || state.authMode === 'web') ? button('connect', label('apiConnect')) : ''}
      ${summaryReceipt ? `<p class="cv-feedback" data-cv-receipt>${esc(summaryReceipt)}</p>` : ''}
      ${pendingVerification ? `<div class="cv-bar"><span class="cv-meta">${esc(pendingVerification.title)}</span>${button('verify-submission',label('verify'))}</div>` : ''}
      ${state.lastDownload ? `<div class="cv-bar"><span class="cv-meta">${esc(label('latestFile'))} · ${esc(state.lastDownload)}</span>${button('open-latest', label('openFile'))}</div>` : ''}
      ${state.sessionOnly && (connected || state.calendar) ? `<p class="cv-meta">${esc(label('sessionOnly'))}</p>` : ''}
      ${migrationNote()}${calendarForm()}</div>
      ${hasData ? `<div class="cv-bar cv-sync"><label class="cv-auto" title="${esc(label('autoHelp'))}"><input type="checkbox" data-cv-auto${state.autoMirror !== false ? ' checked' : ''}> ${esc(label('auto'))}</label><span class="cv-meta">${esc([state.syncing ? label('syncRunning') : '', latest ? label('synced') + ' · ' + formatTime(latest) : ''].filter(Boolean).join('　'))}</span><div class="cv-actions">${(connected || state.calendar) && !state.syncing ? button('sync', label('sync')) : ''}${connected ? button('pull', label('pullAll'), 'mod-cta') : ''}</div></div>${pullReport()}${state.snapshot?.courses?.length && (!connected || state.syncing || state.authError) ? `<p class="cv-meta">${esc(label('cache'))}</p>` : ''}${warnings(state.snapshot?.warnings)}` : ''}
      <div class="cv-grid"><div class="cv-col">${hasData ? newFiles() + agenda() : ''}</div>
      <div class="cv-col cv-col-main">${reader ? readerPanel() : connected || state.snapshot?.courses?.length ? coursePanel() : ''}</div></div></div>`;
    for (const el of root.querySelectorAll('details[data-keep]')) el.open = open.has(el.dataset.keep);
    const input = root.querySelector('#cv-feed-input'); if (input && draft) input.value = draft;
    if (restore) {
      const candidates = [...root.querySelectorAll('button,input,select')];
      const target = candidates.find(el => restore.id ? el.id === restore.id : restore.group ? el.dataset.group === restore.group : el.dataset.cv === restore.action && el.dataset.file === restore.file);
      target?.focus({preventScroll:true});
    }
    busyControls();
  }
  function busyControls() {
    root.setAttribute('aria-busy', String(!!busy));
    for (const el of root.querySelectorAll('button,select,input')) el.disabled = !!busy;
    const status = root.querySelector('.cv-feedback');
    if (busy && status) { status.classList.remove('cv-error'); status.textContent = busy === 'pull' ? pullProgress(state.pullProgress) : label(busy === 'sync' ? 'syncRunning' : 'working'); }
    if (state?.pullProgress && !busy) {
      const pull = root.querySelector('[data-cv="pull"]'); if (pull) pull.disabled = true;
      if (status) status.textContent = pullProgress(state.pullProgress);
    }
  }
  function schedulePoll() {
    clearTimeout(poll);
    if (!visible || document.hidden) return;
    const watchAuth = (authUntil > Date.now() || state?.authPending) && (!state?.connected || awaitWrite);
    const watchSync = state?.syncing || state?.pullProgress || firstSyncUntil > Date.now();
    if (watchAuth || watchSync) poll = setTimeout(() => refresh(true), 2200);
    else if (state?.connected) poll = setTimeout(() => refresh(true), 60_000);
  }
  async function refresh(quiet = false) {
    if (busy || !visible) { schedulePoll(); return; }
    const version = ++readVersion;
    try {
      const next = await call('GET', 'status');
      if (version !== readVersion || !visible) return;
      const changed = JSON.stringify(state) !== JSON.stringify(next);
      if (failed && !quiet) notice('');
      updateState(next);
      if (changed || !quiet) render();
    } catch (error) {
      if (version === readVersion && visible && !quiet) { notice(error.message || label('error'), true); render(); }
    } finally { schedulePoll(); }
  }
  async function perform(action, requestBody) {
    if (busy) return;
    let actionError = '';
    busy = action; ++readVersion; notice(''); busyControls();
    if (action === 'pull') {
      const report = async () => {
        if (busy !== 'pull') return;
        if (visible) {
          try {
            const result = await call('GET', 'status');
            if (busy !== 'pull' || !state || result?.accountKey !== state.accountKey) return; // another account by now
            state.pullProgress = result.pullProgress;
            busyControls();
          } catch { /* The active request still owns the final result. */ }
        }
        if (busy === 'pull') progressTimer = setTimeout(report, 1800);
      };
      progressTimer = setTimeout(report, 900);
    }
    try {
      const result = await call('POST', action, requestBody);
      if (action === 'portal' || action === 'connect' || action === 'web-connect') {
        if (!result.opened) {
          const url = schoolLink(result.url);
          if (!url) throw new Error(label('error'));
          window.open(url, '_blank', 'noopener,noreferrer');
        }
        if (action !== 'portal') { authUntil = Date.now() + 10 * 60_000; awaitWrite = !!requestBody?.submit; notice(label('waiting')); }
        updateState(await call('GET', 'status'));
      } else if (action === 'download') {
        receipt = {file: String(requestBody.fileId), course: String(requestBody.courseId), path: result.path};
        notice(label(result.unchanged ? 'unchanged' : 'saved') + ' · ' + result.path);
      } else if (action === 'pull') {
        lastPull = result;
        updateState(await call('GET', 'status'));
      } else if (action === 'download-course') {
        bulkFailures = (result.failed || []).map(f => [f.name, f.error].filter(Boolean).join(' · '));
        notice([label('saved') + ' ' + result.saved, label('unchanged') + ' ' + result.unchanged, label('failed') + ' ' + bulkFailures.length].join(' · '), bulkFailures.length > 0);
      } else {
        updateState(result);
        if (action === 'calendar') { const input = root.querySelector('#cv-feed-input'); if (input) input.value = ''; }
        if (action === 'disconnect') { submission.clear(); pendingVerification = null; summaryReceipt = ''; }
        if (action === 'sync' && pendingVerification) {
          // Submitted on the school site: ask Canvas for this assignment's record, and compare it with the record
          // from before (never with the list's default attempt 0). Only for the account that opened it.
          const v = pendingVerification;
          let answer = null;
          if (v.owner && v.owner === state?.accountKey) answer = await call('POST', 'verify-submission', {courseId:v.courseId, assignmentId:v.assignmentId, accountKey:v.owner}).catch(() => null);
          const same = v === pendingVerification && v.owner === state?.accountKey && answersDraft(answer, v.owner, v.courseId, v.assignmentId);
          if (same && verdict(v.baseline, answer) === 'received') {
            const item = findAssignment(v.courseId, v.assignmentId);
            summaryReceipt = [label('receipt'), item?.title || v.title, answer.attempt != null ? label('attempt') + ' ' + answer.attempt : '', formatTime(answer.submittedAt)].filter(Boolean).join(' · ');
            pendingVerification = null;
          } else if (v === pendingVerification) { notice(label(same && evidenceOf(answer)?.status === 'unsubmitted' && v.baseline?.status === 'submitted' ? 'recordConflict' : 'noNewAttempt')); }
        }
      }
    } catch (error) {
      let msg = error.message || label('error');
      if (/(401|unauthori[sz]ed|expired|重新授权)/i.test(msg)) {
        try { updateState(await call('GET', 'status')); } catch { /* Keep the last snapshot available. */ }
        msg = label('authExpired');
      }
      notice(msg, true);
      actionError = msg;
    } finally { clearTimeout(progressTimer); if (action === 'pull' && state) state.pullProgress = null; busy = ''; confirmDisconnect = false; render(); schedulePoll(); }
    return actionError;
  }
  async function openReader(url, title) {
    const path = new URL(url).pathname;
    // A file link: save it into the vault and open it in Graphite.
    const file = path.match(/^\/courses\/(\d+)\/files\/(\d+)/);
    if (file) return void saveAndOpen(file[1], file[2]);
    const m = path.match(/^\/courses\/(\d+)\/assignments\/(\d+)/);
    reader = { url, title, loading: true, assignment: m ? { courseId: m[1], id: m[2] } : null, courseId: path.match(/^\/courses\/(\d+)/)?.[1] };
    const mine = reader; render();
    root.querySelector('[data-cv-reader]')?.scrollIntoView({ block: 'nearest' });
    try { mine.data = await call('POST', 'read', { url }); }
    catch (error) {
      const a = mine.assignment && findAssignment(mine.assignment.courseId, mine.assignment.id);
      // Offline or not readable: the assignment text from the last sync.
      if (a) mine.data = { title: a.title, text: a.description, attachments: a.attachments || [], courseId: mine.assignment.courseId, dueAt: a.dueAt };
      else mine.error = error.message || label('error');
    }
    mine.loading = false;
    if (reader === mine) render();
  }
  async function saveAndOpen(courseId, fileId) {
    if (busy) return;
    busy = 'download'; busyControls();
    try { const r = await call('POST', 'download', { courseId, fileId }); await openFile(r.path); }
    catch (error) { notice(error.message || label('error'), true); }
    finally { busy = ''; render(); }
  }
  root.addEventListener('click', e => {
    const a = e.target.closest('a[data-cv-read], a[data-open-path]');
    if (a) {
      e.preventDefault();
      if (a.dataset.openPath) return void openFile(a.dataset.openPath).catch(error => { notice(error.message, true); render(); });
      return void openReader(a.dataset.cvRead, a.textContent);
    }
    const el = e.target.closest('button');
    if (!el || busy) return;
    if (el.dataset.group) { group = el.dataset.group; limit = STEP; reader = null; render(); return; }
    const action = el.dataset.cv;
    if (action === 'refresh') return void refresh();
    if (action === 'reader-back') { reader = null; render(); return; }
    if (action === 'portal-url') return void perform('portal', { url: el.dataset.url });
    if (action === 'open-attachment') return void saveAndOpen(el.dataset.course, el.dataset.file);
    if (action === 'open-path') return void openFile(el.dataset.path).catch(error => { notice(error.message, true); render(); });
    if (action === 'quick-submit') {
      const course = state.snapshot?.courses?.find(c => String(c.id) === String(el.dataset.course));
      const item = course?.assignments?.find(x => String(x.id) === String(el.dataset.assignment));
      if (course && item) submission.open(course, item, { quick: true, folder: state.courseLinks?.[String(course.id)] || '' });
      return;
    }
    if (action === 'more' || action === 'more-dates') {
      if (action === 'more') limit += STEP; else dateLimit += STEP;
      render(); return;
    }
    if (action === 'download') return void perform(action, { courseId: selected, fileId: el.dataset.file });
    if (action === 'download-course') return void perform(action, {courseId:selected});
    if (action === 'verify-submission') return void perform('sync');
    if (action === 'login-portal') return void perform('portal');
    if (action === 'submission') {
      const course = state.snapshot?.courses?.find(c => String(c.id) === selected);
      const item = course?.assignments?.find(a => String(a.id) === el.dataset.assignment);
      if (!item) return;
      if (!canOpenSubmission(item)) {
        const v = pendingVerification = {courseId:course.id, assignmentId:item.id, owner:state.accountKey || null, baseline:evidenceOf(item.submissionEvidence), title:item.title, checkOnReturn:true};
        // No clear record in the list (older data, or the web portal): read it from Canvas before the student submits there.
        if (!explicitEvidence(v.baseline) && v.owner) call('POST', 'verify-submission', {courseId:v.courseId, assignmentId:v.assignmentId, accountKey:v.owner}).then(answer => {
          const e = evidenceOf(answer);
          if (pendingVerification === v && state?.accountKey === v.owner && answersDraft(answer, v.owner, v.courseId, v.assignmentId) && explicitEvidence(e) && !explicitEvidence(v.baseline)) v.baseline = e;
        }).catch(() => {});
        return void perform('portal',{courseId:course.id,assignmentId:item.id});
      }
      return submission.open(course,item);
    }
    if (action === 'open-file' || action === 'open-latest') {
      const path = action === 'open-latest' ? state.lastDownload : receipt?.path;
      if (path) void openFile(path).catch(error => { notice(error.message, true); render(); });
      return;
    }
    if (action === 'disconnect' || action === 'cancel-disconnect') { confirmDisconnect = action === 'disconnect'; render(); return; }
    if (action === 'confirm-disconnect') return void perform('disconnect');
    if (['portal','connect','web-connect','sync','calendar-remove','pull'].includes(action)) void perform(action);
  });
  root.addEventListener('change', e => {
    if (e.target.id === 'cv-link') return void perform('link', { courseId: e.target.dataset.course, folder: e.target.value });
    if (e.target.matches('[data-cv-auto]')) return void perform('auto-mirror', { enabled: e.target.checked });
    if (e.target.id === 'cv-course') { reader = null; selected = e.target.value; group = 'files'; limit = STEP; bulkFailures = []; notice(''); render(); }
  });
  root.addEventListener('submit', e => {
    if (!e.target.matches('[data-cv-form]')) return;
    e.preventDefault();
    const url = root.querySelector('#cv-feed-input').value.trim();
    if (url) void perform('calendar', {url});
  });
  window.addEventListener('focus', () => {
    if (!visible) return;
    if (pendingVerification?.checkOnReturn && !busy) { pendingVerification.checkOnReturn = false; void perform('sync'); }
    else void refresh(true);
  });
  document.addEventListener('visibilitychange', () => { if (visible && !document.hidden) void refresh(true); });
  return {
    id: 'sjtu-canvas', title: () => label('title'),
    show() { visible = true; root.hidden = false; render(); void refresh(); (onSeen || this.onSeen)?.(); },
    // For the ribbon badge: the latest status (it holds the last pull and its "new files" summary).
    status: () => call('GET', 'status'),
    hide() { visible = false; root.hidden = true; submission.dismiss(); clearTimeout(poll); ++readVersion; },
    close() { root.replaceChildren(); submission.clear(); state = null; receipt = null; lastPull = null; bulkFailures = []; message = ''; failed = false; authUntil = 0; awaitWrite = false; confirmDisconnect = false; pendingVerification = null; summaryReceipt = ''; },
    relabel() { if (visible) render(); },
  };
}
