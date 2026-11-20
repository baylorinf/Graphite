'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

async function main() {
  const app = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-links-'));
  const vault = path.join(tmp, 'vault');
  process.env.GRAPHITE_HOME = path.join(tmp, 'home');
  process.env.GRAPHITE_CLAUDE_DIR = path.join(tmp, 'claude');
  const file = rel => path.join(vault, rel);
  const put = async (rel, bytes) => { await fs.mkdir(path.dirname(file(rel)), {recursive:true}); await fs.writeFile(file(rel), bytes); };
  const read = rel => fs.readFile(file(rel), 'utf8');
  const seed = async paths => { for (const rel of paths) await put(rel, '# ' + rel + '\n'); };
  const fixtures = ['Course/A.md', 'Course/B.md', 'Other/B.md', 'Root.md', 'Course/Root.md', 'Locked/L.md', 'My Brain/M.md'];
  const [a, b, other, root, localRoot, locked, brain] = fixtures;
  const rename = fs.rename;
  let count = 0;
  async function test(name, fn) { await fn(); console.log('PASS ' + (++count) + ' ' + name); }
  try {
    await seed(fixtures);
    const origin = 'http://127.0.0.1:' + await require(path.join(app, 'server.js')).start({vault});
    async function post(route, data) {
      const res = await fetch(origin + '/api/' + route, {method:'POST', headers:{'Content-Type':'application/json','X-Vault':'1'}, body:JSON.stringify(data)});
      return {status:res.status, body:await res.json()};
    }
    const connect = (source, targets) => post('note-links', {source, targets});
    const expectOk = async (source, targets, linked, unchanged) =>
      assert.deepEqual(await connect(source, targets), {status:200, body:{linked, unchanged}});
    async function expectError(promise, status, code, paths) {
      const res = await promise;
      assert.equal(res.status, status, JSON.stringify(res.body));
      assert.equal(res.body.code, code);
      assert.deepEqual(res.body.paths, paths);
    }
    assert.equal((await post('study-profile', {profile:{readOnlyFolders:['Locked']}})).status, 200);

    await test('existing alias/heading, selection, duplicates, BOM and CRLF preserved', async () => {
      const original = '\uFEFF# A\r\n\r\n[[B#Proof|lecture]]\r\nExisting student line\r\n';
      await put(a, original); await put(b, 'My B'); await put(other, 'My other B\r\n');
      await expectOk(a, [b, other, b], [b, other], []);
      assert.equal(await read(a), original + '\r\n相关 Related: [[Other/B]]\r\n');
      assert.equal(await read(b), 'My B\n\n相关 Related: [[Course/A]]\n');
      assert.equal(await read(other), 'My other B\r\n\r\n相关 Related: [[Course/A]]\r\n');
      const prior = await fs.stat(file(a));
      await expectOk(a, [other, b], [], [other, b]);
      assert.equal((await fs.stat(file(a))).mtimeMs, prior.mtimeMs);
    });
    await test('root duplicate distinguished from same-folder note; Markdown links and explicit relatives deduplicated', async () => {
      await put(a, '[[Root]]\n[elsewhere](../Other/B.md#topic)\n'); await put(root, ''); await put(localRoot, '[[./A.md|local]]'); await put(other, '[[Course/A#^block]]');
      await expectOk(a, [root, localRoot, other], [root], [localRoot, other]);
      assert.match(await read(a), /\[\[\/Root\]\]/); assert.equal(await read(localRoot), '[[./A.md|local]]');
      await expectOk(a, [root, localRoot], [], [root,localRoot]);
    });
    await test('ambiguous remote short names do not suppress a full-path reference', async () => {
      await put('Third/A.md', '[[B]]\n'); await expectOk('Third/A.md',[other],[other],[]);
      assert.match(await read('Third/A.md'), /\[\[Other\/B\]\]/);
    });
    await test('link examples in frontmatter, code and comments are not real links; unfinished fence stays intact', async () => {
      const examples = '\uFEFF---\r\nexample: "[[B]]"\r\n---\r\n# A\r\n<!-- [[B]] -->\r\n' +
        '\x60[[B]]\x60\r\n\x60\x60\x60md\r\n[[B]]\r\n';
      await put(a, examples); await put(b, '[[Course/A]]');
      await expectOk(a, [b], [b], []);
      const updated = await read(a);
      assert.ok(updated.includes('相关 Related: [[Course/B]]\r\n'));
      assert.ok(updated.indexOf('相关 Related: [[Course/B]]') < updated.indexOf('\x60\x60\x60md'));
      assert.equal(updated.replace('相关 Related: [[Course/B]]\r\n\r\n',''), examples);
      await expectOk(a, [b], [], [b]);
    });
    await test('extend the existing visible Related line, retaining bold, colon, trailing spaces and nearby headings', async () => {
      const original = '\uFEFF---\r\n相关 Related: YAML\r\n---\r\n# A\r\n~~~example\r\n相关 Related: fenced\r\n~~~\r\n' +
        '<!--\r\n相关 Related: hidden comment\r\n-->\r\n**相关 Related**： [[Other/B]]  \r\n## Keep this heading\r\n';
      await put(a, original); await put(b, '相关 Related:  \n');
      await expectOk(a,[b],[b],[]);
      assert.equal(await read(a), original.replace('[[Other/B]]  ', '[[Other/B]] [[Course/B]]  '));
      assert.equal(await read(b),'相关 Related: [[Course/A]]  \n');
      await expectOk(a,[b],[],[b]);
    });
    await test('literal wiki delimiters and spaces in filenames use an idempotent encoded Markdown link', async () => {
      const named = 'Course/Notes [1] #1.md';
      await put(named, 'Hello'); await put(a, 'Original');
      await expectOk(a,[named],[named],[]);
      assert.match(await read(a), /Notes%20%5B1%5D%20%231\.md\)/);
      assert.match(await read(a), /\[Notes &#91;1&#93; #1\]/);
      await expectOk(a,[named],[],[named]);
    });
    await test('read-only source, selected target, mirror and hidden/moved target leave all notes untouched', async () => {
      await seed(fixtures);
      const original = await Promise.all(fixtures.map(read));
      for (const [source, targets, denied] of [[a,[b,locked],locked],[locked,[b],locked],[a,[brain],brain]]) {
        await expectError(connect(source,targets),403,'read_only',[denied]);
      }
      await put('.private/Hidden.md','hidden');
      await expectError(connect(a,[b,'.private/Hidden.md']),400,'invalid_note',['.private/Hidden.md']);
      await expectError(connect(a,[b,'Course/Moved.md']),404,'note_missing',['Course/Moved.md']);
      await expectError(connect(a,[a]),400,'invalid_selection',[a]);
      await expectOk(a,[],[],[]);
      assert.deepEqual(await Promise.all(fixtures.map(read)), original);
    });
    await test('second-target disk-full rolls back every earlier write, retry is idempotent', async () => {
      await seed([a,b,other]);
      const before = await Promise.all([a,b,other].map(read));
      fs.rename = async (from,to) => {
        if (to === file(other)) throw Object.assign(new Error('temporary synthetic full disk'),{code:'ENOSPC'});
        return rename(from,to);
      };
      try { await expectError(connect(a,[b,other]),500,'link_write_failed',[other]); }
      finally { fs.rename = rename; }
      assert.deepEqual(await Promise.all([a,b,other].map(read)), before);
      await expectOk(a,[b,other],[b,other],[]); await expectOk(a,[b,other],[],[b,other]);
    });
    await test('failure after an independent writer edits the first note preserves the edit and reports its path', async () => {
      await seed([a,b,other]);
      fs.rename = async (from,to) => {
        if (to === file(other)) {
          await fs.appendFile(file(a), 'Independent student edit\n');
          throw Object.assign(new Error('temporary synthetic full disk'), {code:'ENOSPC'});
        }
        return rename(from,to);
      };
      try { await expectError(connect(a,[b,other]),409,'link_rollback_conflict',[a]); }
      finally { fs.rename = rename; }
      assert.equal(await read(b), '# Course/B.md\n'); assert.equal(await read(other), '# Other/B.md\n');
      assert.ok((await read(a)).endsWith('Independent student edit\n'));
      await expectOk(a,[b,other],[b,other],[]);
      assert.equal((await read(a)).split('[[Other/B]]').length,2);
      assert.ok((await read(a)).endsWith('Independent student edit\n'));
    });
    await test('moved target during save is not recreated; independent latest source and target lines merge normally', async () => {
      await seed([a,b]); const before = await read(a);
      let moved = false;
      fs.rename = async (from,to) => {
        await rename(from,to);
        if (!moved && to === file(a)) { moved = true; await rename(file(b),file('Course/Moved.md')); }
      };
      try { await expectError(connect(a,[b]),404,'note_missing',[b]); }
      finally { fs.rename = rename; }
      assert.equal(await read(a), before);
      await assert.rejects(read(b), {code:'ENOENT'}); assert.ok(await read('Course/Moved.md'));
      await rename(file('Course/Moved.md'),file(b));
      await fs.appendFile(file(a),'Latest source line\n'); await fs.appendFile(file(b),'Latest target line\n');
      await expectOk(a,[b],[b],[]); assert.match(await read(a),/Latest source line/); assert.match(await read(b),/Latest target line/);
    });
    await test('opposite directions lock in the same order and concurrent confirmation writes once', async () => {
      await seed([a,b]); const requests = await Promise.all([connect(a,[b]),connect(b,[a]),connect(a,[b])]);
      assert.ok(requests.every(r => r.status === 200), JSON.stringify(requests));
      assert.equal(requests.filter(r => r.body.linked.length).length,1);
      assert.equal((await read(a)).split('[[Course/B]]').length,2);
      assert.equal((await read(b)).split('[[Course/A]]').length,2);
    });
  } finally { fs.rename = rename; await fs.rm(tmp, {recursive:true,force:true}); }
}
main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
