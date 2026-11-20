'use strict';
// node test/agent-folder-grants.cjs [--app <unpacked Graphite application>]
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const appIndex = process.argv.indexOf('--app');
const repo = path.resolve(appIndex < 0 ? (process.env.GRAPHITE_TEST_APP || path.join(__dirname, '..')) : process.argv[appIndex + 1]);
const native = value => path.resolve(value);
const match = (row, file) => native(row.path) === native(file);

async function verify(temp) {
  const vault = path.join(temp, 'notes');
  const manual = path.join(temp, 'settings folder');
  const first = path.join(temp, '中文资料 A');
  const second = path.join(temp, 'second course');
  const excluded = path.join(second, 'M', 'ExcludedQA');
  const alias = path.join(temp, 'first-alias'), forbiddenAlias = path.join(temp, 'looks-normal');
  process.env.GRAPHITE_HOME = path.join(temp, 'app-settings');
  process.env.GRAPHITE_CLAUDE_DIR = path.join(temp, 'agent-settings');
  await Promise.all([vault, manual, first, excluded, process.env.GRAPHITE_CLAUDE_DIR].map(file => fs.mkdir(file, {recursive:true})));
  const mirrorPath = path.join(process.env.GRAPHITE_CLAUDE_DIR, 'graphite.json');
  await fs.writeFile(mirrorPath, JSON.stringify({vault, previousSetting:'preserved'}));
  await fs.writeFile(path.join(first, '直接.md'), '# One');
  await fs.writeFile(path.join(second, 'M', '课件.md'), '# Synthetic course slides');
  await fs.writeFile(path.join(excluded, 'Excluded.md'), '# Must stay outside the scan');
  await fs.symlink(first, alias, 'junction');
  await fs.symlink(excluded, forbiddenAlias, 'junction');

  const {atomicWrite, withFileLock, start} = require(path.join(repo, 'server'));
  const profileFactory = require(path.join(repo, 'profile'));
  const {createAgentFolderGrants} = require(path.join(repo,'electron/agent-folder-grants'));
  const getVault = () => vault;
  const makeProfile = () => profileFactory({atomicWrite, withFileLock, vault:getVault, claudeDir:() => process.env.GRAPHITE_CLAUDE_DIR});
  const profile = makeProfile();
  const initial = {courseRoots:[manual], skipFolders:['ExcludedQA'], courses:{M:'Math QA'}, about:'Synthetic private note', readOnlyFolders:['Locked'], recentFolders:[], lookElsewhere:false};
  await profile.save(initial, {futureSetting:'existing'}, {mirror:false});
  const port = await start({vault, port:0});
  const url = 'http://127.0.0.1:' + port + '/api/study-profile';
  async function settings(body) {
    const res = await fetch(url, body ? {method:'POST', headers:{'Content-Type':'application/json','X-Vault':'1'},body:JSON.stringify({profile:body})} : undefined);
    assert.equal(res.status, 200);
    return (await res.json()).profile;
  }
  let selected = null, pickerCalls = 0;
  const service = createAgentFolderGrants({profile, getVault, pickDirectory:async () => { pickerCalls++; return selected; }});
  const {registerCodeWorkbench} = require(path.join(repo,'electron/code-workbench'));
  const handlers = new Map();
  const frame = {url:'http://127.0.0.1:' + port + '/'};
  const contents = {mainFrame:frame};
  const sender = {sender:contents, senderFrame:frame};
  let destroyed = false;
  registerCodeWorkbench({ipcMain:{handle:(channel, fn) => handlers.set(channel, fn)}, url:frame.url,
    getWindow:() => ({webContents:contents, isDestroyed:() => destroyed}), projects:{}, runner:{}, agentFolders:service});
  const ipc = handlers.get('agent-folders');
  assert.equal(typeof ipc, 'function');
  const call = (action, args) => ipc(sender, action, args);
  const listed = await call('list');
  const manualRow = listed.folders[0];
  assert.equal(listed.ok, true);
  assert.equal(listed.folders.length, 1);
  assert.equal(match(manualRow, manual), true);
  assert.deepEqual([manualRow.graphiteAllowed,manualRow.processReadable,manualRow.agentAccess,manualRow.revocable],[true,true,'unverified',false]);
  assert.equal((await ipc({...sender, senderFrame:{url:frame.url}}, 'choose')).code, 'wrong_window');
  assert.equal((await ipc({...sender, sender:{}}, 'choose')).code, 'wrong_window');
  const originalUrl = frame.url;
  for (const page of [originalUrl+'vault/preview.html','https://school.invalid/']) {
    frame.url = page;
    assert.equal((await call('choose')).code, 'wrong_window');
  }
  frame.url = originalUrl;
  destroyed = true;
  assert.equal((await call('choose')).code, 'wrong_window');
  destroyed = false;
  assert.equal((await call('constructor')).code, 'invalid_action');
  assert.equal((await call('choose', {path:first})).code, 'invalid_action');
  assert.equal(pickerCalls, 0);
  const before = await fs.readFile(profile.file(), 'utf8');
  assert.equal((await call('choose')).canceled, true);
  for (const [dir, reason] of [[path.parse(first).root,'volume_root'],[vault,'vault'],[excluded,'excluded'],[forbiddenAlias,'excluded'],[path.join(first,'node_modules'),'excluded'],[path.join(first,'absent'),'unreadable']]) {
    selected = dir;
    assert.equal((await call('choose')).code, reason);
  }
  const denied = {...fs, opendir:async () => {throw Object.assign(new Error('Denied'),{code:'EACCES'});}};
  const restricted = createAgentFolderGrants({profile, getVault, pickDirectory:() => first, io:denied});
  await assert.rejects(restricted.choose(), {code:'unreadable'});
  const unreadable = (await restricted.list()).folders[0];
  assert.deepEqual([unreadable.graphiteAllowed,unreadable.processReadable,unreadable.agentAccess],[true,false,'unverified']);
  assert.equal((await call('revoke',{id:manualRow.id})).code, 'not_revocable');
  assert.equal(await fs.readFile(profile.file(), 'utf8'), before);
  console.log('PASS native sender checks, native picker only, cancellation, unreadable and excluded directories');

  const staleBeforeAdd = await settings();
  selected = first;
  const sibling = createAgentFolderGrants({profile:makeProfile(), getVault, pickDirectory:() => second});
  const [addFirst, addSecond] = await Promise.all([call('choose'), sibling.choose()]);
  assert.equal(addFirst.added && addSecond.added, true);
  const both = (await call('list')).folders;
  assert.equal(both.length, 3);
  for (const folder of [first,second]) {
    const row = both.find(r => match(r,folder));
    assert.deepEqual([row.graphiteAllowed,row.processReadable,row.agentAccess,row.revocable],[true,true,'unverified',true]);
  }
  selected = alias;
  const duplicate = await call('choose');
  assert.equal(duplicate.added, false);
  assert.equal(duplicate.selectedId, addFirst.selectedId);
  selected = manual;
  const existing = await call('choose');
  assert.equal(existing.added, false);
  assert.equal(existing.selectedId, manualRow.id);
  const mirror = JSON.parse(await fs.readFile(mirrorPath,'utf8'));
  assert.deepEqual(mirror.studyRoots.map(native).sort(), [manual,first,second].sort());
  assert.equal(mirror.previousSetting, 'preserved');
  assert.equal(mirror.about, undefined);
  assert.deepEqual(mirror.skipFolders, ['ExcludedQA']);
  const afterSave = await settings({...staleBeforeAdd, about:'Updated in Settings'});
  assert.equal(afterSave.about,'Updated in Settings');
  assert.deepEqual(afterSave.courseRoots.map(native).sort(), [manual,first,second].sort());
  assert.deepEqual(afterSave.readOnlyFolders, ['Locked']);
  assert.equal(JSON.parse(await fs.readFile(profile.file(), 'utf8')).futureSetting, 'existing');
  assert.equal((await sibling.list()).folders.find(r => match(r,first)).id, addFirst.selectedId);
  assert.deepEqual(profileFactory.profileFor('import', afterSave).courseRoots, afterSave.courseRoots);
  console.log('PASS two independent pickers, shared HTTP settings, stable ownership, duplicate junction and stale forms');

  const scanner = path.join(repo,'extensions/claude-code/skills/obsidian-import/scripts/scan.js');
  function scan() {
    const env = {...process.env,GRAPHITE_CONFIG:mirrorPath,OBSIDIAN_VAULT:vault};
    return JSON.parse(execFileSync(process.execPath,[scanner],{env,encoding:'utf8',windowsHide:true})).candidates;
  }
  const found = scan();
  assert.deepEqual(found.map(f => f.name).sort(), ['直接.md','课件.md'].sort());
  assert.equal(found.find(f => f.name === '课件.md').course, 'Math QA');
  assert.equal(found.find(f => f.name === '直接.md').course, path.basename(first));
  selected = path.join(second, 'M');
  const overlap = await call('choose');
  assert.equal(overlap.added,true);
  assert.equal(scan().filter(f => f.name === '课件.md').length, 1);
  assert.equal((await call('revoke',{id:overlap.selectedId})).ok, true);
  const staleBeforeRevoke = await settings();
  const removed = await call('revoke',{id:addSecond.selectedId});
  assert.equal(removed.ok, true);
  assert.equal(removed.removedId, addSecond.selectedId);
  await settings({...staleBeforeRevoke, noteLanguage:'English'});
  assert.deepEqual((await settings()).courseRoots.map(native).sort(), [manual,first].sort());
  assert.deepEqual(scan().map(f => f.name), ['直接.md']);
  assert.equal(await fs.readFile(path.join(second, 'M','课件.md'), 'utf8'), '# Synthetic course slides');
  selected = second;
  const addedAgain = await call('choose');
  assert.notEqual(addedAgain.selectedId, addSecond.selectedId);
  assert.equal((await call('revoke',{id:addSecond.selectedId})).code, 'not_revocable');
  const current = await settings();
  await settings({...current,skipFolders:[...current.skipFolders,path.basename(first)]});
  const nowExcluded = (await call('list')).folders.find(r => match(r,first));
  assert.deepEqual([nowExcluded.graphiteAllowed,nowExcluded.processReadable,nowExcluded.agentAccess], [false,null,'unverified']);
  assert.deepEqual(scan().map(f => f.name), ['课件.md']);
  assert.equal((await call('revoke',{id:addFirst.selectedId})).ok, true);
  assert.equal((await settings()).noteLanguage,'English');
  console.log('PASS real bundled scanner, direct and mapped files, nested exclusions, overlap, revoke and re-grant');
}

(async () => {
  const temp = await fs.mkdtemp(path.join(os.tmpdir(),'graphite-folder-grants-'));
  try { await verify(temp); }
  finally { await fs.rm(temp,{recursive:true,force:true}); }
})().then(() => process.exit(0), error => {console.error(error);process.exit(1);});
