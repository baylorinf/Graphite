'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSubmissionClient, WRITE_SCOPES } = require('../canvas-submission');

const site = 'https://oc.sjtu.edu.cn';
const path = '/api/v1/courses/3/assignments/19';
const route = path + '/submissions';
const response = (v, status = 200) => Response.json(v, { status });
const input = { courseId: '3', assignmentId: '19', type: 'online_text_entry', expectedAttempt: 0, text: '第一行\n  <script> & 2' };
const assignment = { id: '19', course_id: '3', allowed_attempts: -1, allowed_extensions: [],
  submission_types: ['online_upload','online_text_entry','online_url'], due_at: '2020-01-01T00:00:00Z' };
const actual = { id: '27', user_id: '15', assignment_id: '19', attempt: null, submitted_at: null };
const delivered = { id: '27', user_id: '15', assignment_id: '19', attempt: 1, submitted_at: '2026-11-21T13:45:22Z', workflow_state: 'submitted' };
const pdf = () => new File([new Uint8Array([0,1,2,3])], '第一份.pdf', { type: 'application/pdf' });
const textFile = () => new File(['second'], '第二份.txt', { type: 'text/plain' });

function harness(handler) {
  const calls = [];
  const fetch = async (url, opts) => {
    const u = new URL(url);
    calls.push({ u, opts });
    const custom = await handler?.(u, opts, calls);
    if (custom !== undefined) return custom;
    if (u.pathname === path && !opts.method) return response(assignment);
    if (u.pathname === route + '/self' && !opts.method) return response(actual);
    if (u.pathname === route && opts.method === 'POST') return response(delivered, 201);
    throw Error('unexpected call ' + u.pathname);
  };
  const accessToken = async () => 'fixture-local';
  return { client: createSubmissionClient({ fetch, accessToken }), calls, posts: () => calls.filter(c => c.u.pathname === route && c.opts.method === 'POST') };
}

test('late but open text submission preserves text and lines, records before sending, returns a matching receipt', async () => {
  const h = harness();
  const out = await h.client.submit(input, { beforePost: async () => assert.equal(h.posts().length, 0) });
  assert.equal(out.assignmentId, '19');
  assert.equal(out.id, '27');
  assert.equal(out.attempt, 1);
  assert.equal(out.submittedAt, delivered.submitted_at);
  assert.equal(out.url, site + '/courses/3/assignments/19');
  assert.deepEqual(h.posts().map(p => p.opts.body.get('submission[body]')), ['<pre>第一行\n  &lt;script&gt; &amp; 2</pre>']);
  assert(WRITE_SCOPES.includes('url:POST|/api/v1/courses/:course_id/assignments/:assignment_id/submissions'));
});

test('URL submissions send the URL only and do not request the student-provided website', async () => {
  const h = harness();
  await h.client.submit({ ...input, type: 'online_url', url: 'https://work.example.org/exercise?x=1&y=2' });
  assert(h.calls.every(c => c.u.origin === site));
  assert.equal(h.posts()[0].opts.body.get('submission[url]'), 'https://work.example.org/exercise?x=1&y=2');
  assert(!h.posts()[0].opts.body.has('submission[body]'));
});

test('missing material, unsafe URLs, size/count limits and unsupported submission types never reach the school', async () => {
  const h = harness();
  for (const overrides of [{ text: ' \n' }, { type: 'online_url', url: 'javascript:alert()' }, { type: 'online_url', url: 'https://user:password@example.org/' },
    { type: 'online_upload', files: [] }, { type: 'online_upload', files: new Array(21).fill(pdf()) }, { type: 'external_tool' },
    { type: 'online_upload', files: [new File([new Blob([new Uint8Array(65536)])], '../oops.pdf')] },
    { type: 'online_upload', files: [new File(new Array(1025).fill(new Blob([new Uint8Array(65536)])), 'large.pdf')] },
    { expectedAttempt: undefined }]) {
    await assert.rejects(h.client.submit({ ...input, ...overrides }));
  }
  assert.equal(h.calls.length, 0);
});

test('checks the current user, timing, allowed file types, attempts and excused status before preparing any upload', async () => {
  for (const [code, patch, submission, form] of [
    ['assignment_closed', { locked_for_user: true }, {}, {}],
    ['assignment_closed', { lock_at: '2020-01-01T00:00:00Z' }, {}, {}],
    ['assignment_closed', { unlock_at: '2099-12-31T15:59:59Z' }, {}, {}],
    ['assignment_closed', {}, { excused: true }, {}],
    ['school_confirmation', { academic_integrity_pledge: 'Accept the actual campus declaration' }, {}, {}],
    ['school_confirmation', { require_lockdown_browser: true }, {}, {}],
    ['unsupported_type', { submission_types: ['online_url'] }, {}, {}],
    ['attempt_changed', {}, { attempt: 1 }, {}],
    ['attempts_exhausted', { allowed_attempts: 1 }, { attempt: 1 }, { expectedAttempt: 1 }],
    ['file_extension', { allowed_extensions: ['ZIP'] }, {}, { type: 'online_upload', files: [pdf()] }],
  ]) {
    const h = harness(u => u.pathname === path ? response({ ...assignment, ...patch }) : u.pathname === route + '/self' ? response({ ...actual, ...submission }) : undefined);
    await assert.rejects(h.client.submit({ ...input, ...form }), e => e.code === code);
    assert(h.calls.every(c => !c.opts.method));
  }
  const allowed = harness(u => u.pathname === path ? response({ ...assignment, allowed_attempts: 0 }) : u.pathname === route + '/self' ? response({ ...actual, extra_attempts: 1 }) : undefined);
  assert.equal((await allowed.client.submit(input)).attempt, 1);
});

function uploader(u, opts, calls) {
  const uploadCount = calls.filter(c => c.u.pathname === route + '/self/files').length;
  const id = 450 + uploadCount;
  if (u.pathname === route + '/self/files') {
    assert.equal(opts.body.get('submit_assignment'), 'false');
    assert.equal(opts.body.get('on_duplicate'), 'rename');
    assert.equal(opts.headers.Authorization, 'Bearer fixture-local');
    return response({ upload_url: 'https://storage.canvas-user-content.com/receive', upload_params: { key: 'file-' + id, signature: 'example' } });
  }
  if (u.pathname === '/receive') {
    assert.deepEqual([...opts.body.keys()], ['key','signature','file']);
    assert.equal(opts.body.get('signature'), 'example');
    assert.equal(opts.body.get('file').name, uploadCount === 1 ? '第一份.pdf' : '第二份.txt');
    assert(!opts.headers?.Authorization);
    assert.equal(opts.redirect, 'manual');
    return new Response(null, { status: uploadCount === 1 ? 303 : 201, headers: { location: site + '/api/v1/files/' + id + '/create_success?uuid=example' } });
  }
  if (u.pathname.includes('/create_success')) {
    assert.equal(u.origin, site);
    assert.equal(opts.headers.Authorization, 'Bearer fixture-local');
    return response({ id: String(id), size: uploadCount === 1 ? 4 : 6 });
  }
}
test('uploads two selected files through signed fields, confirms each at Canvas, preflights again and submits exactly one attempt', async () => {
  const h = harness(uploader);
  const log = [];
  const out = await h.client.submit({ ...input, type: 'online_upload', files: [pdf(), textFile()] }, { beforePost: async () => {
    log.push('ready');
    assert.equal(h.posts().length, 0);
    assert.equal(h.calls.filter(c => c.u.pathname.includes('/create_success')).length, 2);
    assert.equal(h.calls.filter(c => c.u.pathname === route + '/self').length, 2);
  } });
  assert.deepEqual(log, ['ready']);
  assert.equal(h.posts().length, 1);
  assert.deepEqual(h.posts()[0].opts.body.getAll('submission[file_ids][]'), ['451','452']);
  assert.deepEqual(out.files, [{ id: '451', name: '第一份.pdf' }, { id: '452', name: '第二份.txt' }]);
});

test('untrusted storage and redirected confirmations, failed uploads, changed attempts and failed persistence never submit the assignment', async () => {
  const requests = [
    (u, opts, calls) => u.pathname === route + '/self/files' ? response({ upload_url: 'https://unrelated.example.org/', upload_params: {} }) : uploader(u,opts,calls),
    (u, opts, calls) => u.pathname === '/receive' ? new Response(null, { status: 302, headers: { location: 'https://unrelated.example.org/' } }) : uploader(u,opts,calls),
    (u, opts, calls) => u.pathname === '/receive' ? new Response(null, { status: 400 }) : uploader(u,opts,calls),
    (u, opts, calls) => u.pathname === route + '/self' && calls.filter(c => c.u.pathname === route + '/self').length === 2 ? response({ ...actual, attempt: 1 }) : uploader(u,opts,calls),
  ];
  for (const f of requests) {
    const h = harness(f);
    let marked = false;
    await assert.rejects(h.client.submit({ ...input, type: 'online_upload', files: [pdf()] }, { beforePost: async () => { marked = true; } }));
    assert.equal(marked, false);
    assert.equal(h.posts().length, 0);
    assert(h.calls.every(c => c.u.hostname !== 'unrelated.example.org'));
  }
  const h = harness();
  await assert.rejects(h.client.submit(input, { beforePost: async () => { throw new Error('disk full'); } }), /disk full/);
  assert.equal(h.posts().length, 0);
});

test('an uncertain final result is reported without replay; a definite rejection remains separate', async () => {
  for (const outcome of [
    () => { throw new Error('connection reset'); },
    () => response({}, 503), () => response({}, 408),
    () => new Response('Not a receipt'), () => response({ ...delivered, assignment_id: '71' }),
    () => response({ ...delivered, attempt: 0 }), () => response({ ...delivered, user_id: '45' }),
  ]) {
    const h = harness((u, opts) => u.pathname === route && opts.method === 'POST' ? outcome() : undefined);
    await assert.rejects(h.client.submit(input), e => e.code === 'submission_unknown');
    assert.equal(h.posts().length, 1);
  }
  const refused = harness((u, opts) => u.pathname === route && opts.method === 'POST' ? response({}, 422) : undefined);
  await assert.rejects(refused.client.submit(input), e => e.status === 422 && e.code === 'canvas_rejected');
  assert.equal(refused.posts().length, 1);
});

test('attachment IDs in a school receipt must match the files that were uploaded', async () => {
  const h = harness((u,opts,calls) => u.pathname === route && opts.method === 'POST'
    ? response({ ...delivered, attachments: [{ id: '99' }] }) : uploader(u,opts,calls));
  await assert.rejects(h.client.submit({ ...input, type: 'online_upload', files: [pdf()] }), e => e.code === 'submission_unknown');
  assert.equal(h.posts().length, 1);
});
