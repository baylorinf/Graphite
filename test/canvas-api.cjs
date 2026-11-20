'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { createCanvasApi, SCOPES } = require('../canvas-api');

const origin = 'https://oc.sjtu.edu.cn';
const json = (value, headers = {}, status = 200) => Response.json(value, { headers, status });
const snapshot = { courses: [{ id: '37', name: 'Linear Algebra', files: [{ id: '52', name: 'Slides.pdf' }] }] };
const basic = { id: '52', display_name: 'Slides.pdf', size: 4, url: origin + '/files/52/download' };

async function fixture(t, handler, accessToken = async () => 'test-ticket') {
  const vault = await fsp.mkdtemp(path.join(os.tmpdir(), 'graphite-canvas-api-'));
  t.after(() => fsp.rm(vault, { recursive: true, force: true }));
  const calls = [];
  const fetch = async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    return handler(url, options);
  };
  return { vault, calls, api: createCanvasApi({ fetch, vault, accessToken }) };
}

test('enumerates the current courses through opaque pages and synchronizes student-visible resources', async t => {
  const previous = { courses: [{ id: '37', pages: [{ id: 'old', title: 'Cached' }], quizzes: [{ id: 'stale' }] }, { id: '99' }] };
  const { api, calls } = await fixture(t, url => {
    if (url.pathname === '/api/v1/courses') {
      if (url.searchParams.has('cursor')) return json([{ id: '37', name: 'Duplicate' }, { id: '80', access_restricted_by_date: true }]);
      return json([{ id: '37', name: 'Linear Algebra', course_code: 'LA' }], { link: '<' + origin + '/api/v1/courses.json?cursor=opaque>; rel="next"' });
    }
    if (url.pathname === '/api/v1/courses.json') return json([{ id: '37', name: 'Duplicate' }, { id: '80', access_restricted_by_date: true }]);
    if (url.pathname.endsWith('/assignments')) return json([{ id: '51', name: 'Sheet', due_at: '2026-11-22T15:59:00Z', submission: { workflow_state: 'submitted' } }, { id: '52', name: 'Open date', due_at: null }]);
    if (url.pathname.endsWith('/files')) return json([basic, { id: '53', locked_for_user: true }]);
    if (url.pathname.endsWith('/modules')) return json([{ id: '7', name: 'Week 1', items_count: 2, items: [] }]);
    if (url.pathname.endsWith('/modules/7/items')) return json([{ id: '71', title: 'Notes', type: 'File', content_id: '52' }]);
    if (url.pathname.endsWith('/discussion_topics')) return json(url.searchParams.has('only_announcements') ? [{ id: '10', title: 'Announcement', posted_at: '2026-11-20' }] : [{ id: '11', title: 'Forum' }]);
    if (url.pathname.endsWith('/calendar_events')) return json([{ id: '30', title: 'Seminar', start_at: '2026-11-24T03:00:00Z' }]);
    if (url.pathname.endsWith('/quizzes')) return json([]);
    if (url.pathname.endsWith('/pages')) return json({}, {}, 403);
    throw new Error('unexpected URL');
  });
  const result = await api.sync(previous);
  assert.deepEqual(result.courses.map(c => c.id), ['37']);
  const c = result.courses[0];
  assert.equal(c.assignments[0].dueAt, '2026-11-22T15:59:00Z');
  assert.equal(c.assignments[0].submitted, true);
  assert.equal(c.assignments[1].dueAt, null);
  assert.deepEqual(c.files.map(f => [f.id, f.url]), [['52', origin + '/courses/37/files/52']]);
  assert.equal(c.modules[0].items[0].contentId, '52');
  assert.equal(c.events[0].title, 'Seminar');
  assert.equal(c.announcements[0].id, '10');
  assert.equal(c.discussions[0].id, '11');
  assert.deepEqual(c.pages, previous.courses[0].pages);
  assert.deepEqual(c.quizzes, []);
  assert.equal(c.warnings.length, 1);
  assert(c.warnings[0].includes('权限'));
  assert(calls.every(c => c.options.headers.Authorization === 'Bearer test-ticket'));
  assert(calls.find(c => c.url.pathname.endsWith('/calendar_events')).url.searchParams.get('context_codes[]') === 'course_37');
  assert.equal(calls[0].url.searchParams.get('enrollment_state'), 'active');
  assert(calls.some(c => c.url.searchParams.get('include[]') === 'submission'));
  assert(SCOPES.every(s => s.startsWith('url:GET|')));
});

test('does not use a partial course index or follow an unexpected pagination target', async t => {
  const { api, calls } = await fixture(t, () => json([{ id: '37', name: 'Partial' }], { link: '<https://example.org/api/v1/courses>; rel="next"' }));
  await assert.rejects(api.sync(snapshot), e => e.code === 'invalid_pagination');
  assert.equal(calls.length, 1);
});

test('lists a linked module file even when the Files tab is unavailable and retains an old complete resource page', async t => {
  const old = { courses: [{ id: '37', files: [], pages: [{ id: '22', title: 'Last full page' }] }] };
  const { api } = await fixture(t, url => {
    if (url.pathname === '/api/v1/courses') return json([{ id: '37', name: 'Test' }]);
    if (url.pathname.endsWith('/files')) return json({}, {}, 401);
    if (url.pathname.endsWith('/modules')) return json([{ id: '7', name: 'Week', items: [
      { id: '51', type: 'File', content_id: '71', title: 'Visible attachment' },
      { id: '52', type: 'File', content_id: '72', title: 'Locked attachment', content_details: { locked_for_user: true } },
    ] }]);
    if (url.pathname.endsWith('/pages')) {
      if (url.searchParams.has('cursor')) return json({}, {}, 503);
      return json([{ page_id: 5, title: 'Partial' }], { link: '<' + origin + '/api/v1/courses/37/pages?cursor=next>; rel="next"' });
    }
    return json([]);
  });
  const out = (await api.sync(old)).courses[0];
  assert.deepEqual(out.files.map(f => f.id), ['71']);
  assert.equal(out.warnings.length, 2);
  assert.deepEqual(out.pages, old.courses[0].pages);
  assert.deepEqual(old.courses[0].files, []);
});

test('refreshes an expired access token once and distinguishes a revoked session', async t => {
  let ticket = 'expired', refreshed = 0;
  const access = async renew => { if (renew) { refreshed++; ticket = 'fresh'; } return ticket; };
  const { api } = await fixture(t, (_, opts) => opts.headers.Authorization === 'Bearer fresh' ? json([]) : json({}, {}, 401), access);
  assert.deepEqual((await api.sync()).courses, []);
  assert.equal(refreshed, 1);
  const second = await fixture(t, () => json({}, {}, 401), access);
  await assert.rejects(second.api.sync(snapshot), e => e.status === 401);
  assert.equal(second.calls.length, 2);
});

test('follows a trusted file redirect without an Authorization header, keeps edits and reuses identical content', async t => {
  let data = 'PDF1';
  const { api, vault, calls } = await fixture(t, url => {
    if (url.pathname === '/api/v1/courses/37/files/52') return json(basic);
    if (url.pathname === '/files/52/download') return new Response(null, { status: 302, headers: { location: 'https://files.canvas-user-content.com/doc' } });
    return new Response(data, { headers: { 'content-type': 'application/pdf' } });
  });
  const a = await api.download(37, 52, snapshot);
  assert.equal(a.unchanged, false);
  assert.equal(await fsp.readFile(path.join(vault, a.path), 'utf8'), 'PDF1');
  await fsp.writeFile(path.join(vault, a.path), 'My notes');
  data = 'PDF2';
  const b = await api.download(37, 52, snapshot);
  assert.notEqual(b.path, a.path);
  const c = await api.download(37, 52, snapshot);
  assert.deepEqual(c, { path: b.path, unchanged: true });
  assert.equal(await fsp.readFile(path.join(vault, a.path), 'utf8'), 'My notes');
  assert.equal(await fsp.readFile(path.join(vault, b.path), 'utf8'), 'PDF2');
  assert(calls.filter(c => c.url.origin !== origin).every(c => !c.options.headers?.Authorization));
  assert(calls.filter(c => c.url.origin === origin).every(c => c.options.headers?.Authorization));
});

test('validates synchronized IDs, fresh metadata, file origin and stream completeness', async t => {
  for (const [expected, meta, body] of [
    ['forbidden', { ...basic, locked_for_user: true }],
    ['file_source', { ...basic, url: 'https://example.org/file' }],
    ['file_source', { ...basic, url: 'https://jaccount.sjtu.edu.cn/' }],
    ['file_too_large', { ...basic, size: 1024 ** 3 }],
    ['incomplete_file', basic, new Response('x')],
    ['incomplete_file', basic, new Response('xy', { status: 206 })],
    ['file_not_binary', basic, new Response('<html>', { headers: { 'content-type': 'text/html' } })],
  ]) {
    const { api, calls, vault } = await fixture(t, u => u.pathname.includes('/api/v1/') ? json(meta) : body);
    await assert.rejects(api.download('37', '52', snapshot), e => e.code === expected);
    assert(!calls.some(c => c.url.origin !== origin));
    assert(!(await fsp.readdir(vault, { recursive: true })).some(p => /canvas-part|\.pdf$/i.test(p)));
  }
  const { api, calls } = await fixture(t, () => json({}));
  await assert.rejects(api.download(37, 99, snapshot), e => e.code === 'unknown_file');
  assert.equal(calls.length, 0);
});

test('concurrent transfers publish one complete version', async t => {
  const handler = u => u.pathname.includes('/api/v1/') ? json(basic) : new Response('PDF1');
  const { api, vault } = await fixture(t, handler);
  const entries = await Promise.all([api.download('37','52',snapshot), api.download('37','52',snapshot)]);
  assert.equal(entries[0].path, entries[1].path);
  assert.deepEqual(entries.map(e => e.unchanged).sort(), [false, true]);
  assert.equal(await fsp.readFile(path.join(vault, entries[0].path), 'utf8'), 'PDF1');
});

test('a redirected course directory cannot escape the vault', async t => {
  const handler = u => u.pathname.includes('/api/v1/') ? json(basic) : new Response('PDF1');
  const { vault } = await fixture(t, handler);
  const trap = await fixture(t, handler);
  try {
    await fsp.symlink(vault, path.join(trap.vault, 'Canvas'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (e) {
    if (e.code === 'EPERM') return t.skip('This environment does not allow temporary directory links');
    throw e;
  }
  await assert.rejects(trap.api.download('37','52',snapshot), e => e.code === 'destination_changed');
  assert.deepEqual(await fsp.readdir(vault), []);
});
