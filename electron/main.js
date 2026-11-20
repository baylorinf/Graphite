// Graphite desktop app (Electron). (Formerly MyObsidian.)
// The app page and server code are the same as the browser version. Here the server runs inside the app,
// on a random port that only this window can use (every request carries a secret token).
'use strict';
const { app, BrowserWindow, dialog, ipcMain, shell, session, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { strings, pickLang } = require('./strings');

const ROOT = path.join(__dirname, '..');
const SAMPLE_VAULT = app.isPackaged ? path.join(process.resourcesPath, 'sample-vault') : path.join(ROOT, 'sample-vault');
const ICON = path.join(ROOT, 'build', 'icon.png');
const CONFIG = () => path.join(app.getPath('userData'), 'config.json');
// The app used to be called MyObsidian, and its settings (vault, language, AI keys…) are in that folder.
// The first time Graphite starts, carry them over.
function carryOverOldSettings() {
  if (process.argv.some(a => a.startsWith('--user-data-dir'))) return;
  try {
    const old = path.join(app.getPath('appData'), 'MyObsidian', 'config.json');
    if (!fs.existsSync(CONFIG()) && fs.existsSync(old)) {
      fs.mkdirSync(path.dirname(CONFIG()), { recursive: true });
      fs.copyFileSync(old, CONFIG());
    }
  } catch (e) { console.error('Could not carry over MyObsidian settings:', e); }
}
const arg = name => { const a = process.argv.find(x => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; };
const SELFTEST = process.argv.includes('--selftest');

let cfg = {};
let win = null;
let VAULT = ''; // the vault actually open in this window
let quitting = false;
let choosingVault = false;
let closing = false;
let codeRunner = null;

async function stopProjectTasks() {
  try { await codeRunner?.dispose(); }
  catch (error) { console.warn('Could not stop the project tools:', error.message); }
}

function loadConfig() { carryOverOldSettings(); try { cfg = JSON.parse(fs.readFileSync(CONFIG(), 'utf8')); } catch { cfg = {}; } }
function saveConfig(strict = false) {
  const dest = CONFIG();
  const tmp = dest + '.' + process.pid + '.tmp';
  try {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, dest);
  } catch (error) {
    if (strict) throw error;
    console.error(error);
  }
}
const tr = () => strings(cfg.lang || pickLang(app.getLocale()));

/* ---------- Updates ----------
   Two places are checked for a newer version:
   - GitHub: the latest release of the repo in package.json → graphite.updateRepo ("owner/name"). Its asset
     Graphite-Setup-<version>.exe is downloaded when you press Update.
   - A local folder (for development): installers named Graphite-Setup-<version>.exe (or MyObsidian-Setup-, the
     old name) in the project's dist/ folder, recorded at build time.
   When either is newer than this app, the page shows an Update button; installing runs the installer silently
   and reopens the app. */
const PKG = require(path.join(ROOT, 'package.json'));
const updateFolder = () => arg('update-folder') || cfg.updateFolder || PKG.myobsidian?.updateFolder || null;
const updateRepo = () => arg('update-repo') || cfg.updateRepo || PKG.graphite?.updateRepo || null;
const { createUpdater, verifyBeforeInstall } = require('./updater');
let pausedUpdateWindow = null;
const updater = createUpdater({
  current: app.getVersion(), getRepo: updateRepo, getFolder: updateFolder, getTemp: () => app.getPath('temp'),
  onState: state => { if (win && !win.isDestroyed()) win.webContents.send('update-state', state); },
  beforeInstall: async () => {
    const target = win;
    if (closing || choosingVault || !target || target.isDestroyed() || !target.isEnabled()) return { ok: false, errorCode: 'unsaved', error: 'The editor is unavailable' };
    // Keep editing available during the download, then freeze input for the final save and handoff.
    target.setEnabled(false);
    pausedUpdateWindow = target;
    return verifyBeforeInstall(
      () => target.webContents.executeJavaScript('window.__moFlush ? window.__moFlush() : null'),
      async () => {
        if (!target.isMaximized() && !target.isFullScreen()) cfg.bounds = target.getBounds();
        cfg.maximized = target.isMaximized();
        await captureStorage(true);
      },
    );
  },
  onReadyToQuit: () => {
    quitting = true;
    setTimeout(async () => { await stopProjectTasks(); app.exit(0); }, 300);
  },
});
const checkForUpdates = options => updater.check(options);
async function installUpdate() {
  const result = await updater.install();
  if (!result.ok && result.errorCode !== 'busy' && pausedUpdateWindow) {
    if (!pausedUpdateWindow.isDestroyed()) pausedUpdateWindow.setEnabled(true);
    pausedUpdateWindow = null;
  }
  return result;
}

async function chooseVault() {
  const target = win;
  if (quitting || closing || choosingVault || !target || target.isDestroyed() || !target.isEnabled()) return false;
  choosingVault = true;
  let paused = false;
  try {
    const next = await askForVault(target);
    if (!next || path.resolve(next) === path.resolve(VAULT) || target.isDestroyed() || !target.isEnabled()) return false;
    target.setEnabled(false);
    paused = true;
    const result = await verifyBeforeInstall(
      () => target.webContents.executeJavaScript('window.__moFlush ? window.__moFlush() : null'),
      () => captureStorage(true),
    );
    if (!result.ok) throw new Error(result.error);
    const previous = cfg.vault;
    try {
      cfg.vault = next;
      saveConfig(true);
      await stopProjectTasks();
      app.relaunch({ args: process.argv.slice(1).filter(a => !a.startsWith('--vault=')) });
    } catch (error) {
      cfg.vault = previous;
      saveConfig();
      throw error;
    }
    quitting = true;
    app.exit(0);
    return true;
  } catch (error) {
    console.warn('Vault switch stopped:', error.message);
    if (!target.isDestroyed()) {
      if (paused) { target.setEnabled(true); paused = false; }
      const t = tr();
      await dialog.showMessageBox(target, {type:'warning', title:t('unsavedTitle'), message:t('unsavedTimeout')});
    }
    return false;
  } finally {
    if (paused && !quitting && !target.isDestroyed()) target.setEnabled(true);
    choosingVault = false;
  }
}

/* ---------- Remembering the page's settings ----------
   The page keeps its settings (language, theme, fonts, layout, last note…) in localStorage. That storage
   belongs to the exact address, and the built-in server uses a new random port at every launch, so we copy
   it into config.json (cfg.storage) and put it back before the page starts (see preload.js). */
let lastStorage = '';
async function captureStorage(strict = false) {
  try {
    if (!win || win.isDestroyed()) throw new Error('The editor is unavailable');
    const json = await win.webContents.executeJavaScript('JSON.stringify(Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)])))');
    if (!json) throw new Error('The editor settings are unavailable');
    if (json !== lastStorage || strict) {
      cfg.storage = JSON.parse(json);
      saveConfig(strict);
      lastStorage = json;
    }
  } catch (error) {
    if (strict) throw error;
  }
}
function storageForPage() {
  const s = { ...(cfg.storage || {}) };
  // Versions up to 1.1.5 lost these settings, but did record the language here: carry it over.
  if (!('mo:lang' in s) && cfg.lang) s['mo:lang'] = JSON.stringify(cfg.lang);
  return s;
}

// Ask the user where their notes live. Returns a folder path, or null if they cancel.
async function askForVault(parent) {
  const t = tr();
  const r = await dialog.showMessageBox(parent, {
    type: 'question', title: t('chooseTitle'), message: t('chooseMessage'), detail: t('chooseDetail'),
    buttons: [t('openExisting'), t('createNew'), t('cancel')], defaultId: 0, cancelId: 2, noLink: true,
  });
  if (r.response === 0) {
    const p = await dialog.showOpenDialog(parent, { title: t('pickFolder'), properties: ['openDirectory', 'createDirectory'] });
    return p.canceled ? askForVault(parent) : p.filePaths[0];
  }
  if (r.response === 1) {
    const p = await dialog.showSaveDialog(parent, {
      title: t('newVault'), buttonLabel: t('createButton'),
      defaultPath: path.join(app.getPath('documents'), 'Graphite Vault'),
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    });
    if (p.canceled || !p.filePath) return askForVault(parent);
    fs.mkdirSync(p.filePath, { recursive: true });
    // A directory containing only .obsidian already belongs to an existing vault.
    if (fs.readdirSync(p.filePath).length === 0 && fs.existsSync(SAMPLE_VAULT)) {
      fs.cpSync(SAMPLE_VAULT, p.filePath, { recursive: true, force: false });
    }
    return p.filePath;
  }
  return null;
}

async function resolveVault() {
  const forced = arg('vault');
  if (forced) return path.resolve(forced);
  if (cfg.vault && fs.existsSync(cfg.vault)) return cfg.vault;
  if (cfg.vault) await dialog.showMessageBox({ type: 'warning', title: 'Graphite', message: tr()('missing', { path: cfg.vault }) });
  const v = await askForVault(null);
  if (v) { cfg.vault = v; saveConfig(); }
  return v;
}

// Builds the right-click menu for what was clicked: the editor, selected text, a link or an image.
function buildContextMenu(p, origin) {
  const t = tr(), items = [], sep = () => { if (items.length && items[items.length - 1].type !== 'separator') items.push({ type: 'separator' }); };
  const send = cmd => () => win.webContents.send('app-command', cmd);
  const sel = (p.selectionText || '').trim();
  if (p.linkURL && !p.linkURL.startsWith(origin)) {
    items.push({ label: t('openLink'), click: () => shell.openExternal(p.linkURL) });
    items.push({ label: t('copyLink'), click: () => require('electron').clipboard.writeText(p.linkURL) });
  }
  if (p.mediaType === 'image') { sep(); items.push({ label: t('copyImage'), click: () => win.webContents.copyImageAt(p.x, p.y) }); }
  if (p.isEditable) {
    sep();
    const f = p.editFlags || {};
    items.push(
      { label: t('undo'), role: 'undo', enabled: f.canUndo !== false }, { label: t('redo'), role: 'redo', enabled: f.canRedo !== false }, { type: 'separator' },
      { label: t('cut'), role: 'cut', enabled: !!f.canCut }, { label: t('copy'), role: 'copy', enabled: !!f.canCopy },
      { label: t('paste'), role: 'paste', enabled: f.canPaste !== false }, { label: t('selectAll'), role: 'selectAll' },
    );
    // Formatting only in the note editor (not in search boxes and such).
    if (p.formControlType === 'text-area' || p.inputFieldType === 'plainText') {
      items.push({ type: 'separator' }, {
        label: t('format'), submenu: [
          { label: t('bold'), accelerator: 'Ctrl+B', click: send({ type: 'wrap', before: '**' }) },
          { label: t('italic'), accelerator: 'Ctrl+I', click: send({ type: 'wrap', before: '*' }) },
          { label: t('highlight'), click: send({ type: 'wrap', before: '==' }) },
          { label: t('strike'), click: send({ type: 'wrap', before: '~~' }) },
          { label: t('code'), click: send({ type: 'wrap', before: '`' }) },
          { label: t('math'), click: send({ type: 'wrap', before: '$' }) },
          { label: t('wikilink'), click: send({ type: 'wrap', before: '[[', after: ']]' }) },
        ],
      });
    }
  } else if (sel) {
    sep();
    items.push({ label: t('copy'), role: 'copy' });
  }
  if (sel) {
    sep();
    const short = sel.length > 30 ? sel.slice(0, 30) + '…' : sel;
    items.push({ label: t('search', { text: short.replace(/\s+/g, ' ') }), click: send({ type: 'search', text: sel }) });
  }
  if (p.isEditable && (p.formControlType === 'text-area' || p.inputFieldType === 'plainText')) {
    sep();
    items.push({ label: t('check'), click: send({ type: 'command', id: 'check-note' }) });
    items.push({ label: t('quiz'), click: send({ type: 'command', id: 'quiz-note' }) });
  }
  return items;
}

function createWindow(url) {
  let b = cfg.bounds || {};
  // A saved position on a monitor that is no longer connected would open the window off-screen: forget it.
  if (b.x != null && b.y != null && b.width && b.height) {
    const area = screen.getDisplayMatching(b).workArea;
    const visible = Math.min(b.x + b.width, area.x + area.width) - Math.max(b.x, area.x) > 100 && Math.min(b.y + b.height, area.y + area.height) - Math.max(b.y, area.y) > 50;
    if (!visible) b = { width: Math.min(b.width, area.width), height: Math.min(b.height, area.height) };
  }
  win = new BrowserWindow({
    width: b.width || 1280, height: b.height || 820, x: b.x, y: b.y,
    minWidth: 640, minHeight: 420,
    show: false, backgroundColor: '#1e1e1e', autoHideMenuBar: true, icon: ICON, title: 'Graphite',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  if (cfg.maximized) win.maximize();
  win.once('ready-to-show', () => {
    if (!SELFTEST) win.show();
    else if (!process.argv.includes('--selftest-hidden')) win.showInactive();
  });

  const origin = new URL(url).origin;
  // Links: external pages open in the normal browser, vault attachments in their default program.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (target.startsWith(origin + '/vault/')) {
      let rel = '';
      try { rel = decodeURIComponent(new URL(target).pathname.slice('/vault/'.length)); } catch { return { action: 'deny' }; }
      const abs = path.resolve(VAULT, rel);
      if (abs.startsWith(path.resolve(VAULT) + path.sep)) shell.openPath(abs);
    } else if (/^https?:|^mailto:/i.test(target)) shell.openExternal(target);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, target) => { if (!target.startsWith(origin)) { e.preventDefault(); if (/^https?:/i.test(target)) shell.openExternal(target); } });

  // Right-click menu (Electron shows none by default). The file list has its own menu inside the page.
  win.webContents.on('context-menu', (_e, p) => {
    const items = buildContextMenu(p, origin);
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // A few app-level shortcuts (there is no menu bar).
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const mod = input.control || input.meta, k = input.key.toLowerCase();
    if (input.key === 'F12' || (mod && input.shift && k === 'i')) { win.webContents.toggleDevTools(); e.preventDefault(); }
    else if (mod && (k === '=' || k === '+')) { win.webContents.setZoomLevel(win.webContents.getZoomLevel() + 0.5); e.preventDefault(); }
    else if (mod && k === '-') { win.webContents.setZoomLevel(win.webContents.getZoomLevel() - 0.5); e.preventDefault(); }
    else if (mod && k === '0') { win.webContents.setZoomLevel(0); e.preventDefault(); }
    else if (input.key === 'F11') { win.setFullScreen(!win.isFullScreen()); e.preventDefault(); }
  });

  // Save unsaved typing before the window closes, and remember the window size.
  // Closing: save every note first. The window only closes once all text is on disk, or you chose what to do
  // with what couldn't be saved (try again, save copies somewhere else, close and keep them as drafts that are
  // retried on next start, or keep editing). A save that hangs is treated like a failed one, never as done.
  win.on('close', e => {
    if (!quitting && (choosingVault || pausedUpdateWindow)) { e.preventDefault(); return; }
    if (!win.isMaximized() && !win.isFullScreen()) cfg.bounds = win.getBounds();
    cfg.maximized = win.isMaximized();
    saveConfig();
    if (quitting) return;
    e.preventDefault();
    if (closing) return;
    closing = true;
    closeSafely().catch(err => console.error(err)).finally(() => { closing = false; });
  });
  async function flushPage() {
    let timer;
    try {
      return await Promise.race([
        win.webContents.executeJavaScript('window.__moFlush ? window.__moFlush() : null').catch(() => null),
        new Promise(resolve => { timer = setTimeout(() => resolve(null), 8000); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  async function closeSafely() {
    const t = tr();
    async function finish() {
      quitting = true;
      await stopProjectTasks();
      win.destroy();
    }
    for (;;) {
      if (!win || win.isDestroyed()) return;
      const r = await flushPage();
      let projectStorageFailed = false;
      // A new server origin is used on the next launch. A project draft held in
      // localStorage is recoverable there only after the desktop settings reach disk.
      try { await captureStorage(!!r?.hasProjectDrafts); }
      catch { projectStorageFailed = true; }
      if (r?.ok && !projectStorageFailed && !r.projectUnsaved && !r.reviewUnsaved) return finish();
      if (r?.reviewUnsaved || r?.projectUnsaved || projectStorageFailed) {
        const answer = await dialog.showMessageBox(win, { type:'warning', title:t('unsavedTitle'),
          message:r?.projectMessage || r?.reviewMessage || t('unsavedTimeout'), buttons:[t('unsavedRetry'), t('cancel')], defaultId:0, cancelId:1, noLink:true });
        if (answer.response === 0) continue;
        return;
      }
      const unsaved = (r && r.unsaved) || [];
      const names = unsaved.map(u => '• ' + u.path).join('\n');
      const { response } = await dialog.showMessageBox(win, {
        type: 'warning', title: t('unsavedTitle'),
        message: r ? t('unsavedMessage', { n: unsaved.length }) : t('unsavedTimeout'),
        detail: (names ? names + '\n\n' : '') + t('unsavedDetail'),
        buttons: [t('unsavedRetry'), t('unsavedSaveCopies'), t('unsavedQuit'), t('cancel')],
        defaultId: 0, cancelId: 3, noLink: true,
      });
      if (response === 0) continue;
      if (response === 1) {
        if (!unsaved.length) continue;
        const pick = await dialog.showOpenDialog(win, { title: t('unsavedPickFolder'), properties: ['openDirectory', 'createDirectory'] });
        if (pick.canceled || !pick.filePaths[0]) continue;
        const failed = [];
        for (const u of unsaved) {
          const name = String(u.path).split('/').pop() || 'note.md';
          const ext = path.extname(name), stem = path.basename(name, ext);
          let dest = path.join(pick.filePaths[0], name), i = 1;
          while (fs.existsSync(dest)) dest = path.join(pick.filePaths[0], `${stem} (${++i})${ext}`);
          const ending = u.eol === 'CRLF' ? '\r\n' : u.eol === 'CR' ? '\r' : '\n';
          const content = u.eol ? (u.bom ? '\uFEFF' : '') + u.text.replace(/\n/g, ending) : u.text;
          try { fs.writeFileSync(dest, content, { flag: 'wx' }); } catch (err) { failed.push(name + ': ' + err.message); }
        }
        if (failed.length) { await dialog.showMessageBox(win, { type: 'error', title: t('unsavedTitle'), message: t('unsavedCopyFailed'), detail: failed.join('\n') }); continue; }
        return finish(); // copies are safe; the drafts also stay for next start
      }
      if (response === 2) return finish(); // drafts stay and are retried next time
      return; // Cancel: keep the window open and keep editing
    }
  }

  win.loadURL(url);
  return win;
}

async function main() {
  loadConfig();
  Menu.setApplicationMenu(null);
  const vault = await resolveVault();
  if (!vault) { app.quit(); return; }
  VAULT = vault;

  const token = crypto.randomBytes(24).toString('hex');
  const { start, atomicWrite, withFileLock, readSource } = require(path.join(ROOT, 'server.js'));
  const canvasOptions = require('./canvas-desktop').createCanvasDesktop({
    app, BrowserWindow, session, safeStorage: require('electron').safeStorage, vault,
  });
  const port = await start({ vault, port: 0, token, canvasOptions });
  const url = `http://127.0.0.1:${port}/`;
  const {createCodeProjects} = require(path.join(ROOT, 'code-projects.js'));
  const projects = createCodeProjects({
    stateFile: path.join(app.getPath('userData'), 'code-project.json'), getVault: () => VAULT,
    atomicWrite, withFileLock, readSource,
    pickDirectory: async () => {
      const selection = await dialog.showOpenDialog(win, {properties:['openDirectory', 'createDirectory']});
      return selection.canceled ? null : selection.filePaths[0] || null;
    },
  });
  let sendCodeEvent;
  const folderProfile = require(path.join(ROOT,'profile.js'))({
    atomicWrite, withFileLock, vault:() => VAULT, claudeDir:() => process.env.GRAPHITE_CLAUDE_DIR || path.join(require('node:os').homedir(),'.claude'),
  });
  const agentFolders = require('./agent-folder-grants').createAgentFolderGrants({
    profile:folderProfile, getVault:() => VAULT, pickDirectory:async () => {
      const pick=await dialog.showOpenDialog(win,{properties:['openDirectory']});
      return pick.canceled ? null : pick.filePaths[0] || null;
    },
  });
  codeRunner = require('./code-runner').createCodeRunner({projects, onEvent: data => sendCodeEvent?.(data)});
  sendCodeEvent = require('./code-workbench').registerCodeWorkbench({
    ipcMain, url, getWindow: () => win, projects, runner:codeRunner, agentFolders,
  });

  // Attach the secret to every request this app makes to its own server.
  session.defaultSession.webRequest.onBeforeSendHeaders({ urls: [`http://127.0.0.1:${port}/*`] }, (details, cb) => {
    details.requestHeaders['X-App-Token'] = token;
    cb({ requestHeaders: details.requestHeaders });
  });

  ipcMain.handle('choose-vault', chooseVault);
  ipcMain.on('set-language', (_e, code) => { if (code && code !== cfg.lang) { cfg.lang = code; saveConfig(); } });
  ipcMain.on('storage-load', e => { e.returnValue = storageForPage(); });
  ipcMain.handle('update-check', (_event, options) => checkForUpdates({ force: options?.force === true }));
  ipcMain.handle('update-install', () => installUpdate());
  ipcMain.handle('copy-text', (_e, text) => { require('electron').clipboard.writeText(String(text)); return true; });

  createWindow(url);
  // Also save settings every 15 s, so they survive even if Windows ends the app without a normal quit.
  setInterval(captureStorage, 15 * 1000);
  // Look for new versions at start, every 10 minutes, and when you come back to the window.
  if (app.isPackaged || arg('update-folder')) {
    setInterval(checkForUpdates, 10 * 60 * 1000);
    let last = 0;
    win.on('focus', () => { if (Date.now() - last > 60 * 1000) { last = Date.now(); checkForUpdates(); } });
  }
  if (SELFTEST) runSelfTest();
}

// `--selftest`: load the app hidden, report errors and a screenshot, then quit. Used to check builds.
function runSelfTest() {
  const errors = [];
  win.webContents.on('console-message', (...a) => {
    const d = a[0] && typeof a[0] === 'object' && 'message' in a[0] ? a[0] : { level: a[1], message: a[2] };
    if (d.level === 3 || d.level === 'error') errors.push(d.message);
  });
  win.webContents.once('did-finish-load', async () => {
    await new Promise(r => setTimeout(r, 2500));
    const info = await win.webContents.executeJavaScript(`({
      title: document.title,
      notes: document.querySelectorAll('.tree-item.file').length,
      desktop: !!window.myobsidianDesktop,
      lang: document.documentElement.lang,
    })`).catch(e => ({ error: String(e) }));
    info.apiOk = await win.webContents.executeJavaScript(`fetch('/api/list').then(r => r.status)`).catch(e => String(e));
    info.version = await win.webContents.executeJavaScript(`fetch('/api/all').then(r => r.json()).then(d => d.version)`).catch(e => String(e));
    info.fonts = await win.webContents.executeJavaScript(`import('/appearance.js').then(m => m.listFonts()).then(f => ({ all: f.all.length, mono: f.mono.length, sampleMono: f.mono.slice(0, 6) }))`).catch(e => String(e));
    info.update = await win.webContents.executeJavaScript(`({ button: !document.querySelector('#update-btn')?.classList.contains('hidden'), label: document.querySelector('#st-update')?.textContent || '' })`).catch(e => String(e));
    info.settings = await win.webContents.executeJavaScript(`({ theme: document.documentElement.dataset.theme, appearance: localStorage.getItem('mo:appearance'), mode: localStorage.getItem('mo:mode') })`).catch(e => String(e));
    // --selftest-eval=<js>: change something (e.g. a setting) before quitting, to test what's remembered.
    // Right-click menu for the editor with some text selected (labels only).
    const label = i => i.type === 'separator' ? '—' : i.label + (i.submenu ? ` [${i.submenu.map(s => s.label).join(', ')}]` : '');
    info.menuEditor = buildContextMenu({ isEditable: true, formControlType: 'text-area', editFlags: { canCut: true, canCopy: true, canPaste: true }, selectionText: 'mitochondria' }, 'http://x').map(label).join(' | ');
    info.menuText = buildContextMenu({ isEditable: false, selectionText: 'some text', linkURL: 'https://obsidian.md' }, 'http://x').map(label).join(' | ');
    const evFile = arg('selftest-eval-file');
    const ev = evFile ? fs.readFileSync(evFile, 'utf8') : arg('selftest-eval');
    if (ev) info.eval = await win.webContents.executeJavaScript(ev).catch(e => String(e));
    const out = arg('shot');
    if (out) { const img = await win.webContents.capturePage(); fs.writeFileSync(out, img.toPNG()); }
    console.log('SELFTEST ' + JSON.stringify({ ...info, errors }));
    await captureStorage(); // as on a normal quit
    quitting = true;
    app.exit(0);
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
  app.whenReady().then(main).catch(e => { dialog.showErrorBox('Graphite', String(e?.stack || e)); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
}
