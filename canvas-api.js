'use strict';

const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { courseContent } = require('./canvas-course-content');
const { submissionEvidence } = require('./canvas-submission');

const ORIGIN = 'https://oc.sjtu.edu.cn';
const MAX_BYTES = 512 * 1024 * 1024;
const SCOPES = [
  '/api/v1/courses', '/api/v1/courses/:course_id/assignments', '/api/v1/courses/:course_id/files',
  '/api/v1/courses/:course_id/files/:id', '/api/v1/courses/:course_id/modules',
  '/api/v1/courses/:course_id/modules/:module_id/items', '/api/v1/courses/:course_id/quizzes',
  '/api/v1/calendar_events', '/api/v1/courses/:course_id/discussion_topics', '/api/v1/courses/:course_id/pages',
  '/files/:file_id/download', '/courses/:course_id/files/:file_id/download',
].map(route => 'url:GET|' + route);

function problem(status, code, message, openUrl) {
  return Object.assign(new Error(message), { status, code, ...(openUrl ? { openUrl } : {}) });
}

function localWebUrl(raw, fallback) {
  try {
    const url = new URL(raw || fallback, ORIGIN);
    if (url.origin === ORIGIN && !url.username && !url.password) {
      url.searchParams.delete('verifier');
      url.searchParams.delete('access_token');
      return url.href;
    }
  } catch {}
  return new URL(fallback, ORIGIN).href;
}

const validId = value => /^(?:0|[1-9]\d*)$/.test(String(value ?? ''));
const sameId = (a, b) => String(a) === String(b);
const shown = row => row.published !== false && !row.hidden_for_user;
const arr = value => Array.isArray(value) ? value : [];
const date = value => typeof value === 'string' ? value : null;

function safeName(name, fallback) {
  let clean = Array.from(String(name || '').normalize('NFC')
    .replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/^[. ]+|[. ]+$/g, '')).slice(0, 105).join('').replace(/[. ]+$/g, '');
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(clean)) clean = '_' + clean;
  return clean || fallback;
}

function courseFolder(course) {
  if (!validId(course.id)) throw problem(400, 'invalid_id', '课程编号无效。');
  return safeName(course.name, 'Course') + ' (' + course.id + ')';
}

function downloadUrl(raw, base, openUrl) {
  let target;
  try { target = new URL(raw, base); } catch {}
  const host = target?.hostname || '';
  const school = host === 'sjtu.edu.cn' || host.endsWith('.sjtu.edu.cn');
  const canvasFiles = /(^|\.)(canvas-user-content\.com|instructure\.com)$/i.test(host)
    || /^instructure-uploads(?:-[a-z0-9-]+)?\.s3(?:[.-][a-z0-9-]+)?\.amazonaws\.com$/i.test(host);
  if (!target || target.protocol !== 'https:' || target.port || target.username || target.password ||
      !(school || canvasFiles) || /^jaccount\./i.test(host) || /^\/login(?:\/|$)/i.test(target.pathname)) {
    throw problem(422, 'file_source', '此文件需要在 Canvas 原站打开。', openUrl);
  }
  return target;
}

async function discard(response) {
  try { await response.body?.cancel(); } catch {}
}

function checkResponse(response) {
  if (response.ok) return;
  const status = response.status;
  if (status === 401) throw problem(401, 'unauthorized', 'Canvas 登录已过期，请重新连接。');
  if (status === 403) throw problem(403, 'forbidden', 'Canvas 未授予读取此内容的权限。');
  if (status === 404 || status === 410) throw problem(status, 'not_found', '此内容未开放，或已从 Canvas 移除。');
  if (status === 429) throw problem(429, 'rate_limited', 'Canvas 请求频繁，请稍后重试。');
  throw problem(status >= 500 ? 502 : status, 'canvas_http', 'Canvas 请求失败（HTTP ' + status + '）。');
}

// Use exclusive publication: a collision, concurrent download or edited local copy can never be replaced.
async function publish(temp, folder, name, digest, size) {
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  for (let n = 1; n <= 1000; n++) {
    const target = path.join(folder, n === 1 ? name : stem + ' (' + n + ')' + ext);
    try {
      try { await fsp.link(temp, target); }
      catch (e) {
        if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'ENOSYS'].includes(e.code)) throw e;
        // Some vaults (e.g. a network share) do not support hard links.
        await fsp.copyFile(temp, target, fs.constants.COPYFILE_EXCL);
      }
      return { target, unchanged: false };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const st = await fsp.lstat(target).catch(e => { if (e.code !== 'ENOENT') throw e; });
      if (!st?.isFile() || st.size !== size) continue;
      const existing = createHash('sha256');
      for await (const chunk of fs.createReadStream(target)) existing.update(chunk);
      if (existing.digest('hex') === digest) return { target, unchanged: true };
    }
  }
  throw problem(409, 'name_conflict', '同名文件过多，请整理课程文件夹后再下载。');
}

async function verifiedSubdirectory(parent, name) {
  const folder = path.join(parent, name);
  try { await fsp.mkdir(folder); } catch (e) { if (e.code !== 'EEXIST') throw e; }
  const real = await fsp.realpath(folder);
  if (!(await fsp.lstat(folder)).isDirectory() || path.relative(parent, real) !== name) {
    throw problem(409, 'destination_changed', '课程文件夹的位置已改变，请检查后重试。');
  }
  return real;
}

function createCanvasApi({ fetch: fetchImpl = globalThis.fetch, accessToken, vault, getAccountId }) {
  let refreshing = null;
  async function request(url, options = {}) {
    try { return await fetchImpl(url.href, { redirect: 'manual', signal: AbortSignal.timeout(45000), ...options }); }
    catch { throw problem(502, 'canvas_network', '无法连接交大 Canvas，请检查网络后重试。'); }
  }
  async function onSite(url, headers = {}, options = {}) {
    if (url.origin !== ORIGIN || url.username || url.password) throw problem(502, 'unexpected_origin', 'Canvas 返回了意外的地址。');
    let token = await accessToken();
    function send() { return request(url, { ...options, headers: { ...headers, Authorization: 'Bearer ' + token } }); }
    let response = await send();
    if (response.status === 401) {
      // Canvas distinguishes a restricted resource from an expired credential
      // with WWW-Authenticate. The course index remains our login check.
      if (!response.headers.has('www-authenticate') && !/^\/api\/v1\/courses(?:\.json)?$/.test(url.pathname)) {
        await discard(response);
        throw problem(403, 'forbidden', 'Canvas 未授予读取此内容的权限。');
      }
      await discard(response);
      const current = await accessToken();
      if (current !== token) token = current;
      else {
        if (!refreshing) refreshing = Promise.resolve(accessToken(true)).finally(() => { refreshing = null; });
        token = await refreshing;
      }
      response = await send();
    }
    return response;
  }

  async function json(url) {
    const response = await onSite(url, { Accept: 'application/json+canvas-string-ids' });
    if (!response.ok) { await discard(response); checkResponse(response); }
    let value;
    try { value = await response.json(); }
    catch { throw problem(502, 'invalid_canvas_response', 'Canvas 返回的数据无法读取。'); }
    return { value, link: response.headers.get('link') || '' };
  }

  async function list(route, params = {}) {
    const first = new URL('/api/v1/' + route, ORIGIN);
    first.search = new URLSearchParams({ per_page: '100', ...params }).toString();
    const result = [], seen = new Set();
    let next = first;
    while (next) {
      if (next.origin !== ORIGIN || next.pathname.replace(/\.json$/, '') !== first.pathname ||
          next.username || next.password || seen.has(next.href) || seen.size >= 2000) {
        throw problem(502, 'invalid_pagination', 'Canvas 分页异常，未覆盖上次完整记录。');
      }
      seen.add(next.href);
      const { value, link } = await json(next);
      if (!Array.isArray(value)) throw problem(502, 'invalid_canvas_response', 'Canvas 列表格式异常。');
      result.push(...value);
      const match = /<([^>]+)>\s*;\s*rel\s*=\s*"?next"?/i.exec(link);
      next = match ? new URL(match[1], next) : null;
    }
    return result;
  }

  async function sync(previous = {}) {
    // Never replace the entire previous snapshot if the course index itself failed.
    const allCourses = await list('courses', { enrollment_state: 'active', 'include[]': 'syllabus_body' });
    const courses = [], previousCourses = arr(previous?.courses), visited = new Set();
    for (const c of allCourses) {
      if (!validId(c.id) || !c.name || c.access_restricted_by_date || visited.has(String(c.id))) continue;
      const id = String(c.id), route = 'courses/' + id + '/', web = '/' + route;
      visited.add(id);
      const old = previousCourses.find(x => sameId(x.id, id)) || {};
      const out = { id, name: String(c.name), code: String(c.course_code || ''), url: ORIGIN + web.slice(0,-1), warnings: [] };
      out.requirements = { ...courseContent(c.syllabus_body, id), url: ORIGIN + web + 'assignments/syllabus' };
      const title = x => String(x.title || x.name || '');
      const resource = (x, section) => ({ id: String(x.id), title: title(x), url: localWebUrl(x.html_url, web + section + '/' + x.id) });
      const warning = (label, error) => {
        if (error.status === 401) throw error;
        out.warnings.push(label + '：' + (error.code ? error.message : '暂时无法读取。') + ' 若有上次记录则保留。');
      };
      async function section(key, label, loadRows) {
        try { out[key] = await loadRows(); }
        catch (e) {
          warning(label, e);
          out[key] = key==='assignments' ? arr(old[key]).map(row=>({...row,submissionEvidence:submissionEvidence(null)})) : arr(old[key]).slice();
        }
      }
      await section('assignments', '作业', async () => (await list(route + 'assignments', { 'include[]': 'submission' }))
        .filter(shown).map(x => {
          const sub = x.submission;
          const owner=getAccountId?.();
          const matches=sub && (!sub.assignment_id || sameId(sub.assignment_id,x.id)) && (!sub.course_id || sameId(sub.course_id,id)) &&
            (!owner || !sub.user_id || sameId(sub.user_id,owner));
          const submitted = sub ? Boolean(sub.submitted_at || (!sub.missing && ['submitted', 'graded', 'pending_review'].includes(sub.workflow_state))) : null;
          const details = courseContent(x.locked_for_user ? '' : x.description, id);
          return { ...resource(x, 'assignments'), description: details.text, attachments: details.attachments,
            dueAt: date(x.due_at), submitted, excused: Boolean(sub?.excused), submissionEvidence:submissionEvidence(matches ? sub : null),
            submittedAt: date(sub?.submitted_at), attempt: Number(sub?.attempt) || 0,
            allowedAttempts: x.allowed_attempts == null ? null : Number(x.allowed_attempts),
            extraAttempts: Number(sub?.extra_attempts) || 0,
            groupAssignment: Boolean(x.group_category_id),
            locked: Boolean(x.locked_for_user || x.published === false),
            submissionTypes: arr(x.submission_types).filter(s => typeof s === 'string'),
            allowedExtensions: arr(x.allowed_extensions).filter(s => typeof s === 'string') };
        }));
      await section('files', '课件', async () => (await list(route + 'files')).filter(x => shown(x) && !x.locked_for_user)
        .map(x => ({ id: String(x.id), name: String(x.display_name || x.filename || x.id), size: x.size ?? null,
          updatedAt: date(x.modified_at || x.updated_at), url: ORIGIN + web + 'files/' + x.id })));
      await section('announcements', '公告', async () => (await list(route + 'discussion_topics', { only_announcements: 'true' }))
        .filter(shown).map(x => ({ ...resource(x, 'discussion_topics'), at: date(x.posted_at || x.created_at) })));
      await section('modules', '课程单元', async () => {
        const result = [];
        for (const m of await list(route + 'modules', { 'include[]': 'items' })) {
          if (!shown(m) || !validId(m.id)) continue;
          let items;
          try {
            const rows = Array.isArray(m.items) && m.items.length >= Number(m.items_count || 0) ? m.items
              : await list(route + 'modules/' + m.id + '/items');
            items = rows.filter(shown).map(x => ({ ...resource(x, 'modules/items'), type: String(x.type || ''),
              contentId: validId(x.content_id) ? String(x.content_id) : null, locked: Boolean(x.content_details?.locked_for_user || x.locked_for_user || m.state === 'locked') }));
          } catch (e) {
            warning('单元「' + title(m) + '」', e);
            items = arr(arr(old.modules).find(x => sameId(x.id, m.id))?.items);
          }
          result.push({ id: String(m.id), title: title(m), url: ORIGIN + web + 'modules#module_' + m.id, items });
        }
        return result;
      });
      // Some instructors share course materials through Modules with Files navigation disabled.
      // These entries are links the student was shown; download still checks fresh file metadata.
      const knownFiles = new Set(out.files.map(f => String(f.id)));
      for (const owner of [out.requirements, ...out.assignments]) {
        for (const file of arr(owner.attachments)) {
          if (!validId(file.id) || knownFiles.has(file.id)) continue;
          knownFiles.add(file.id);
          out.files.push({ ...file, size:null, updatedAt:null });
        }
      }
      for (const module of out.modules) for (const item of arr(module.items)) {
        const fileId = String(item.contentId);
        if (item.type !== 'File' || item.locked || !validId(fileId) || knownFiles.has(fileId)) continue;
        knownFiles.add(fileId);
        out.files.push({ id: fileId, name: item.title, size: null, updatedAt: null, url: item.url });
      }
      await section('quizzes', '测验', async () => (await list(route + 'quizzes')).filter(shown)
        .map(x => ({ ...resource(x, 'quizzes'), dueAt: date(x.due_at), assignmentId: validId(x.assignment_id) ? String(x.assignment_id) : null })));
      await section('events', '日程', async () => (await list('calendar_events', { 'context_codes[]': 'course_' + id, all_events: 'true', type: 'event' }))
        .map(x => ({ id: String(x.id), title: title(x), url: localWebUrl(x.html_url, '/calendar?event_id=' + encodeURIComponent(x.id)), startAt: date(x.start_at), endAt: date(x.end_at), allDay: Boolean(x.all_day) })));
      await section('discussions', '讨论', async () => (await list(route + 'discussion_topics')).filter(x => shown(x) && !x.is_announcement)
        .map(x => ({ ...resource(x, 'discussion_topics'), at: date(x.posted_at || x.created_at) })));
      await section('pages', '课程页面', async () => (await list(route + 'pages')).filter(shown)
        .map(x => ({ id: String(x.page_id || x.url), title: title(x), url: localWebUrl(x.html_url, web + 'pages/' + encodeURIComponent(x.url || x.page_id)), at: date(x.updated_at) })));
      courses.push(out);
    }
    return { courses, warnings: [] };
  }

  async function download(courseId, fileId, snapshot) {
    if (!validId(courseId) || !validId(fileId)) throw problem(400, 'invalid_id', '课程或文件编号无效。');
    const course = arr(snapshot?.courses).find(c => sameId(c.id, courseId));
    const known = arr(course?.files).some(f => sameId(f.id, fileId))
      || arr(course?.modules).some(m => arr(m.items).some(i => i.type === 'File' && !i.locked && sameId(i.contentId, fileId)));
    if (!known) throw problem(404, 'unknown_file', '请先同步包含该文件的课程。');
    const viewerUrl = ORIGIN + '/courses/' + courseId + '/files/' + fileId;
    const { value: info } = await json(new URL(ORIGIN + '/api/v1/courses/' + courseId + '/files/' + fileId));
    if (!info || !sameId(info.id, fileId) || info.locked_for_user || info.hidden_for_user || !info.url) {
      throw problem(403, 'forbidden', '此文件当前不可下载，可在 Canvas 查看开放状态。', viewerUrl);
    }
    const expected = Number(info.size ?? NaN);
    const tooBig = () => problem(413, 'file_too_large', '文件超过 512 MiB，请在 Canvas 原站下载。', viewerUrl);
    if (expected > MAX_BYTES) throw tooBig();
    let target = downloadUrl(info.url, ORIGIN, viewerUrl);
    let response;
    for (let hop = 0; hop < 6; hop++) {
      response = target.origin === ORIGIN ? await onSite(target, {}, { signal: AbortSignal.timeout(300000) })
        : await request(target, { signal: AbortSignal.timeout(300000) });
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      await discard(response);
      if (!location || hop === 5) throw problem(502, 'file_redirect', 'Canvas 下载地址跳转异常，请从原站打开。', viewerUrl);
      target = downloadUrl(location, target, viewerUrl);
    }
    if (!response.ok) { await discard(response); checkResponse(response); }
    if (response.status === 206) {
      await discard(response);
      throw problem(502, 'incomplete_file', 'Canvas 只返回了部分文件，请重试。', viewerUrl);
    }
    if (Number(response.headers.get('content-length')) > MAX_BYTES) { await discard(response); throw tooBig(); }
    const type = response.headers.get('content-type') || '';
    const name = safeName(info.display_name || info.filename, 'file-' + fileId);
    if (/text\/html/i.test(type) && !/\.html?$/i.test(name) && !/text\/html/i.test(info['content-type'] || '')) {
      await discard(response);
      throw problem(422, 'file_not_binary', 'Canvas 返回了网页，请在原站重新登录或打开文件。', viewerUrl);
    }
    let base, folder;
    try {
      base = await fsp.realpath(typeof vault === 'function' ? vault() : vault);
      folder = await verifiedSubdirectory(await verifiedSubdirectory(base, 'Canvas'), courseFolder(course));
    } catch (e) { await discard(response); throw e; }
    const temp = path.join(folder, '.canvas-part-' + randomUUID());
    let size = 0;
    const digest = createHash('sha256');
    const meter = new Transform({ transform(chunk, encoding, cb) {
      size += chunk.length;
      if (size > MAX_BYTES) return cb(tooBig());
      digest.update(chunk);
      cb(null, chunk);
    } });
    try {
      const body = response.body ? Readable.fromWeb(response.body) : Readable.from([]);
      await pipeline(body, meter, fs.createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
      if (Number.isFinite(expected) && expected !== size) throw problem(502, 'incomplete_file', '下载的文件大小不完整，请重试。', viewerUrl);
      const saved = await publish(temp, folder, name, digest.digest('hex'), size);
      return { path: path.relative(base, saved.target).split(path.sep).join('/'), unchanged: saved.unchanged };
    } finally { await fsp.unlink(temp).catch(() => {}); }
  }
  return { sync, download };
}

module.exports = { createCanvasApi, SCOPES, safeName, courseFolder, verifiedSubdirectory, publish };
