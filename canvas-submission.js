'use strict';

const SITE = 'https://oc.sjtu.edu.cn';
const MAX_TOTAL = 64 * 1024 * 1024;
const MAX_FILES = 20;
const WRITE_SCOPES = [
  'url:GET|/api/v1/courses/:course_id/assignments/:id',
  'url:GET|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id',
  'url:GET|/api/v1/files/:id',
  'url:GET|/api/v1/files/:id/create_success',
  'url:POST|/api/v1/courses/:course_id/assignments/:assignment_id/submissions/:user_id/files',
  'url:POST|/api/v1/courses/:course_id/assignments/:assignment_id/submissions',
];
const validId = value => /^[1-9]\d*$/.test(String(value ?? ''));
const error = (status, code, message) => Object.assign(new Error(message), { status, code });
const unknown = () => error(502, 'submission_unknown', 'Canvas 的提交结果尚未确认。请在原作业查看最新记录，再决定是否重交。');
const escapeText = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function readJson(response) {
  try { return await response.json(); }
  catch { throw error(502, 'canvas_response', 'Canvas 返回的资料不能读取，请稍后重试。'); }
}
async function discard(response) {
  try { await response.body?.cancel(); } catch {}
}
async function rejected(response, label) {
  const status = response.status;
  await discard(response);
  if (status === 401 || status === 403) return error(status, 'submission_access', label + '：请检查学校授权以及这项作业的提交权限。');
  if (status === 413) return error(413, 'upload_too_large', label + '：附件超过学校的限制。');
  return error(status >= 400 && status < 500 ? status : 502, 'canvas_rejected', label + '（HTTP ' + status + '），请到该作业查看学校要求。');
}

function validateMaterial({ type, text, url, files }) {
  if (type === 'online_text_entry') {
    if (typeof text !== 'string' || !text.trim()) throw error(400, 'missing_text', '请先填写要提交的文字。');
    if (Buffer.byteLength(text) > 1024 * 1024) throw error(413, 'text_too_large', '本次提交的文字超过 1 MiB。');
    return { body: '<pre>' + escapeText(text.replace(/\r\n?/g, '\n')) + '</pre>' };
  }
  if (type === 'online_url') {
    let dest;
    try { dest = new URL(url); } catch {}
    if (!dest || !['http:', 'https:'].includes(dest.protocol) || dest.username || dest.password) {
      throw error(400, 'invalid_url', '请填写完整的 http 或 https 作品链接。');
    }
    return { url: dest.href };
  }
  if (type !== 'online_upload') throw error(422, 'unsupported_type', '这种作业请在 Canvas 原站提交。');
  if (!Array.isArray(files) || !files.length || files.length > MAX_FILES) throw error(400, 'file_count', '请选择 1 至 20 个附件。');
  let size = 0;
  for (const file of files) {
    if (!(file instanceof Blob) || typeof file.name !== 'string' || !file.name.trim() || /[\\/\x00-\x1f\x7f]/.test(file.name) || file.name === '.' || file.name === '..') {
      throw error(400, 'invalid_file', '请重新选择要提交的本地文件。');
    }
    size += file.size;
    if (size > MAX_TOTAL) throw error(413, 'upload_too_large', '所有附件合计最多 64 MiB。');
  }
  return { files };
}

function checkCurrent(assignment, sub, input, files) {
  if (String(assignment?.id) !== String(input.assignmentId) || (assignment.course_id != null && String(assignment.course_id) !== String(input.courseId))
      || String(sub?.assignment_id) !== String(input.assignmentId)) {
    throw error(409, 'assignment_changed', '学校返回的作业与当前页面不一致。请同步后重新打开。');
  }
  if (assignment.published === false || assignment.locked_for_user || assignment.submission_types?.includes('not_graded') ||
      Date.parse(assignment.unlock_at) > Date.now() || Date.parse(assignment.lock_at) <= Date.now() || sub.excused) {
    throw error(409, 'assignment_closed', '这项作业尚未开放、已关闭或已获豁免，请在 Canvas 查看当前状态。');
  }
  if (assignment.require_lockdown_browser || (typeof assignment.academic_integrity_pledge === 'string' && assignment.academic_integrity_pledge.trim())) {
    throw error(422, 'school_confirmation', '该作业要求使用学校指定的提交环境或亲自确认声明，请在 Canvas 原站完成。');
  }
  if (!Array.isArray(assignment.submission_types) || !assignment.submission_types.includes(input.type)) {
    throw error(422, 'unsupported_type', '老师没有为这项作业开启所选的提交方式。');
  }
  const current = Number(sub.attempt ?? 0);
  if (!Number.isSafeInteger(current) || current < 0 || current !== input.expectedAttempt) {
    throw error(409, 'attempt_changed', 'Canvas 的提交次数已变化，请同步后核对最新记录。');
  }
  const limit = assignment.allowed_attempts == null ? null : Number(assignment.allowed_attempts);
  if (Number.isInteger(limit) && limit >= 0 && current >= limit + Math.max(0, Number(sub.extra_attempts) || 0)) {
    throw error(409, 'attempts_exhausted', '这项作业的可用提交次数已用完。');
  }
  const extensions = (Array.isArray(assignment.allowed_extensions) ? assignment.allowed_extensions : [])
    .map(e => String(e).toLowerCase().replace(/^\./, '').trim()).filter(Boolean);
  for (const file of files || []) {
    if (extensions.length && !extensions.some(ext => file.name.toLowerCase().endsWith('.' + ext))) {
      throw error(422, 'file_extension', '老师允许的附件格式为 ' + extensions.join('、') + '。');
    }
  }
}

function storageUrl(raw) {
  let u;
  try { u = new URL(raw, SITE); } catch {}
  const host = u?.hostname || '';
  const allowed = host === 'oc.sjtu.edu.cn' || (host.endsWith('.sjtu.edu.cn') && !host.startsWith('jaccount.'))
    || /(^|\.)(instructure\.com|canvas-user-content\.com)$/i.test(host)
    || /^(?:instructure-uploads|sjtu-canvas)(?:-[a-z0-9-]+)?\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com(?:\.cn)?$/i.test(host);
  if (typeof raw !== 'string' || !raw.trim() || !u || u.protocol !== 'https:' || u.username || u.password || u.port || !allowed || /^\/login(?:\/|$)/i.test(u.pathname)) {
    throw error(422, 'upload_destination', '学校返回的附件存储地址尚未支持，请在原作业上传。');
  }
  return u;
}

function confirmationUrl(raw, target) {
  let u;
  try { u = new URL(raw, target); } catch {}
  if (!u || u.origin !== SITE || u.username || u.password || !/^\/api\/v1\/files\/[1-9]\d*(?:\/create_success)?(?:\.json)?$/.test(u.pathname)) {
    throw error(502, 'upload_confirmation', '附件没有获得学校的确认地址，作业尚未提交。');
  }
  return u;
}

function createSubmissionClient({ fetch: fetchImpl = globalThis.fetch, accessToken }) {
  async function request(url, options) {
    try { return await fetchImpl(url, { redirect: 'manual', signal: AbortSignal.timeout(60000), ...options }); }
    catch { throw error(502, 'canvas_network', '无法连接学校，作业尚未提交。'); }
  }
  async function read(pathOrUrl) {
    const url = new URL(pathOrUrl, SITE);
    const get = async force => request(url.href, { headers: {
      Accept: 'application/json+canvas-string-ids', Authorization: 'Bearer ' + await accessToken(force),
    } });
    let res = await get(false);
    if (res.status === 401 && res.headers.has('www-authenticate')) { await discard(res); res = await get(true); }
    if (!res.ok) throw await rejected(res, '无法读取学校记录');
    return readJson(res);
  }

  async function upload(route, file) {
    const sign = await request(SITE + route + '/self/files', {
      method: 'POST', headers: { Accept: 'application/json+canvas-string-ids', Authorization: 'Bearer ' + await accessToken() },
      body: new URLSearchParams({ name: file.name, size: String(file.size), content_type: file.type || 'application/octet-stream',
        on_duplicate: 'rename', submit_assignment: 'false' }),
    });
    if (!sign.ok) throw await rejected(sign, '学校没有批准本次附件上传');
    const signed = await readJson(sign);
    const target = storageUrl(signed?.upload_url);
    const params = signed?.upload_params;
    if (!params || typeof params !== 'object' || Array.isArray(params) || Object.hasOwn(params, 'file')) throw error(502, 'upload_parameters', '学校返回的附件上传信息不完整。');
    const multipart = new FormData();
    for (const [name, value] of Object.entries(params)) {
      if (typeof value !== 'string' && typeof value !== 'number') throw error(502, 'upload_parameters', '学校返回的附件签名格式不受支持。');
      multipart.append(name, String(value));
    }
    // Canvas signs every form field; the file must be last. The storage server gets no bearer token.
    multipart.append('file', file, file.name);
    const stored = await request(target.href, { method: 'POST', body: multipart, signal: AbortSignal.timeout(300000) });
    const location = stored.headers.get('location');
    let info, expectedId;
    if ((stored.status === 201 || [301, 302, 303, 307, 308].includes(stored.status)) && location) {
      await discard(stored);
      const confirm = confirmationUrl(location, target);
      expectedId = confirm.pathname.match(/\/files\/(\d+)/)[1];
      info = await read(confirm);
    } else if ([200, 201].includes(stored.status) && target.origin === SITE) {
      // Local Canvas storage can return the final File directly.
      info = await readJson(stored);
    } else if (stored.ok) {
      await discard(stored);
      throw error(502, 'upload_confirmation', '附件尚未获得学校确认，作业未提交。');
    } else throw await rejected(stored, '附件上传失败');
    if (!validId(info?.id) || (expectedId && String(info.id) !== expectedId) || (info.size != null && Number(info.size) !== file.size)) {
      throw error(502, 'upload_confirmation', '学校返回的附件信息不符，作业未提交。');
    }
    return { id: String(info.id), name: String(info.display_name || info.filename || file.name) };
  }

  async function submit(input, { beforePost = async () => {} } = {}) {
    if (!validId(input?.courseId) || !validId(input?.assignmentId)) throw error(400, 'invalid_assignment', '作业或课程编号无效。');
    if (!Number.isSafeInteger(input.expectedAttempt) || input.expectedAttempt < 0) throw error(409, 'attempt_required', '请先同步这项作业的最新提交次数。');
    const material = validateMaterial(input), assignmentPath = '/api/v1/courses/' + input.courseId + '/assignments/' + input.assignmentId;
    const route = assignmentPath + '/submissions';
    async function preflight() {
      const assignment = await read(assignmentPath + '?include%5B%5D=academic_integrity_pledge');
      const sub = await read(route + '/self');
      checkCurrent(assignment, sub, input, material.files);
      return sub;
    }
    let current = await preflight();
    const fileList = [];
    for (const file of material.files || []) fileList.push(await upload(route, file));
    if (fileList.length) {
      if (new Set(fileList.map(f => f.id)).size !== fileList.length) throw error(502, 'upload_confirmation', '学校未为每个附件返回独立编号，作业未提交。');
      current = await preflight(); // the deadline or another Canvas window may have changed during upload
    }
    const body = new URLSearchParams({ 'submission[submission_type]': input.type });
    if (material.body) body.set('submission[body]', material.body);
    if (material.url) body.set('submission[url]', material.url);
    for (const file of fileList) body.append('submission[file_ids][]', file.id);
    const token = await accessToken();
    await beforePost();
    let res;
    try {
      // Do not retry after this point, even on 401: this is an actual graded attempt.
      res = await fetchImpl(SITE + route, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(60000),
        headers: { Accept: 'application/json+canvas-string-ids', Authorization: 'Bearer ' + token }, body });
    } catch { throw unknown(); }
    if (!res.ok) {
      if (res.status >= 400 && res.status < 500 && res.status !== 408) throw await rejected(res, '学校拒绝了本次作业提交');
      await discard(res); throw unknown();
    }
    let receipt;
    try { receipt = await res.json(); } catch { throw unknown(); }
    const attempt = Number(receipt?.attempt);
    if (!validId(receipt?.id) || String(receipt.assignment_id) !== String(input.assignmentId) ||
        (current.user_id != null && String(receipt.user_id) !== String(current.user_id)) ||
        !Number.isSafeInteger(attempt) || attempt <= input.expectedAttempt || !Number.isFinite(Date.parse(receipt.submitted_at)) ||
        (receipt.submission_type && receipt.submission_type !== input.type) || receipt.workflow_state === 'unsubmitted') throw unknown();
    if (fileList.length && Array.isArray(receipt.attachments)) {
      const attachedIds = new Set(receipt.attachments.map(file => String(file.id)));
      if (fileList.some(file => !attachedIds.has(file.id))) throw unknown();
    }
    return { id: String(receipt.id), assignmentId: String(input.assignmentId), attempt,
      submittedAt: receipt.submitted_at, url: SITE + '/courses/' + input.courseId + '/assignments/' + input.assignmentId,
      ...(fileList.length ? { files: fileList } : {}) };
  }
  return { submit };
}

module.exports = { createSubmissionClient, WRITE_SCOPES };
