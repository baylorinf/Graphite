// Code workbench: a project folder (the vault or any folder on this computer), its real folder tree, several
// open files, and C++ compile / run / debug inside Graphite. The desktop app does the file and process work
// (window.myobsidianDesktop.codeProject / codeRun / onCodeRun); every path here is project-relative with '/'.
//
// Unsaved text is never lost: each open file's edits are kept as a draft (per project and file) until they are
// on disk. A file changed on disk keeps your text and says how to recover. Before compiling, the open C++ files
// with changes are saved; if a save fails, nothing is compiled.
import { t } from '/i18n.js';
import { sourceFormat, editorFor } from '/code-editor.js';

const CPP = /\.(cpp|cc|cxx|c\+\+)$/i;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const desk = () => window.myobsidianDesktop;
export const workbenchAvailable = () => !!(desk()?.codeProject && desk()?.codeRun);
const OUT_MAX = 200000;

async function project(action, args = {}) {
  const r = await desk().codeProject(action, args);
  if (!r?.ok) throw Object.assign(new Error(r?.message || t('wb.failed')), { code: r?.code || 'failed' });
  return r;
}
async function runner(action, args = {}) {
  const r = await desk().codeRun(action, args);
  if (!r?.ok) throw Object.assign(new Error(r?.message || t('wb.failed')), { code: r?.code || 'failed' });
  return r;
}
const store = {
  get(k, d) { try { const v = localStorage.getItem('mo:' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { if (v == null) localStorage.removeItem('mo:' + k); else localStorage.setItem('mo:' + k, JSON.stringify(v)); } catch { /* storage full or blocked */ } },
};
const dirOf = p => p.split('/').slice(0, -1).join('/');
const baseOf = p => p.split('/').pop();
const norm = p => String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');

export function createCodeWorkbench(root, { toast, askText, vaultRoot, vaultFolders, onShowTab }) {
  let proj = null;                 // {id, name, root, available}
  let CM = null, cm = null;        // CodeMirror and the one editor (each file is a CodeMirror.Doc)
  const dirs = new Map();          // folder path ('' = root) → entries
  const expanded = new Set(['']);
  let selectedDir = '';
  const buffers = new Map();       // path → {path, doc, disk, revision, eol, bom, editable, reason, conflict, problem}
  let order = [], active = null;
  let breakpoints = new Map();     // path → Set(line numbers, 1-based)
  let tools = null;
  let run = null;                  // {id, mode, phase, status, message}
  let outText = '', diagnostics = [], paused = null;
  let panel = store.get('wb:panel', { open: true, tab: 'output' });
  let unsubscribe = null, built = false, visible = false, cursorLine = null, pausedMark = null;

  /* ---------- layout ---------- */
  function build() {
    if (built) return;
    built = true;
    root.innerHTML = `
      <header class="wb-project">
        <span class="wb-proj-name"></span><span class="wb-proj-root" title=""></span><span class="wb-proj-state"></span>
        <span class="wb-spacer"></span>
        <button type="button" data-wb="choose"></button><button type="button" data-wb="vault"></button>
      </header>
      <div class="wb-unavailable" hidden></div>
      <div class="wb-main">
        <aside class="wb-tree" aria-label="">
          <div class="wb-tree-bar"><b class="wb-tree-title"></b><span class="wb-spacer"></span>
            <button type="button" data-wb="new-file" title=""></button><button type="button" data-wb="new-folder" title=""></button><button type="button" data-wb="refresh" title="">↻</button></div>
          <div class="wb-tree-list scroll" role="tree"></div>
        </aside>
        <section class="wb-editor">
          <div class="wb-tabs" role="tablist"></div>
          <div class="wb-toolbar">
            <button type="button" data-wb="toggle-tree" class="wb-tree-toggle"></button>
            <span class="wb-file"></span><span class="wb-status" role="status"></span>
            <span class="wb-spacer"></span>
            <button type="button" data-wb="save"></button>
            <span class="wb-sep"></span>
            <button type="button" data-wb="build"></button><button type="button" data-wb="run" class="wb-primary"></button><button type="button" data-wb="debug"></button><button type="button" data-wb="stop"></button>
            <span class="wb-debug-controls"><button type="button" data-wb="continue"></button><button type="button" data-wb="next"></button><button type="button" data-wb="step"></button><button type="button" data-wb="finish"></button></span>
          </div>
          <div class="wb-problem" hidden></div>
          <div class="wb-cm"><div class="wb-empty"></div></div>
          <div class="wb-tools" role="status"></div>
        </section>
      </div>
      <footer class="wb-panel">
        <div class="wb-panel-tabs" role="tablist">
          <button type="button" data-panel="output"></button><button type="button" data-panel="input"></button><button type="button" data-panel="problems"></button><button type="button" data-panel="debug"></button>
          <span class="wb-spacer"></span><span class="wb-run-state" role="status"></span><button type="button" data-wb="panel" class="wb-panel-toggle"></button>
        </div>
        <div class="wb-panel-body">
          <pre class="wb-output" data-pane="output" aria-live="polite"></pre>
          <div data-pane="input"><label class="wb-input-label" for="wb-stdin"></label><textarea id="wb-stdin" rows="5" spellcheck="false"></textarea></div>
          <div class="wb-problems" data-pane="problems"></div>
          <div class="wb-debug" data-pane="debug"></div>
        </div>
      </footer>`;
    root.addEventListener('click', onClick);
    root.querySelector('#wb-stdin').addEventListener('input', e => { if (proj) store.set('wb:stdin:' + proj.id, e.target.value); });
    relabel();
  }
  function relabel() {
    if (!built) return;
    const L = (sel, key, title) => { const el = root.querySelector(sel); if (el) { el.textContent = t(key); if (title) el.title = t(title); } };
    L('[data-wb=choose]', 'wb.choose', 'wb.chooseTitle'); L('[data-wb=vault]', 'wb.useVault', 'wb.useVaultTitle');
    L('[data-wb=new-file]', 'wb.newFileShort', 'wb.newFile'); L('[data-wb=new-folder]', 'wb.newFolderShort', 'wb.newFolder');
    root.querySelector('[data-wb=refresh]').title = t('wb.refresh');
    L('[data-wb=save]', 'wb.save', 'wb.saveTitle'); L('[data-wb=build]', 'wb.build', 'wb.buildTitle'); L('[data-wb=run]', 'wb.run', 'wb.runTitle');
    L('[data-wb=debug]', 'wb.debug', 'wb.debugTitle'); L('[data-wb=stop]', 'wb.stop');
    L('[data-wb=continue]', 'wb.continue', 'wb.continueTitle'); L('[data-wb=next]', 'wb.next', 'wb.nextTitle'); L('[data-wb=step]', 'wb.step', 'wb.stepTitle'); L('[data-wb=finish]', 'wb.finish', 'wb.finishTitle');
    L('[data-wb=toggle-tree]', 'wb.files'); L('.wb-tree-title', 'wb.files');
    L('[data-panel=output]', 'wb.output'); L('[data-panel=input]', 'wb.input'); L('[data-panel=problems]', 'wb.problems'); L('[data-panel=debug]', 'wb.variables');
    L('.wb-input-label', 'wb.inputHint');
    root.querySelector('.wb-tree').setAttribute('aria-label', t('wb.files'));
    renderAll();
  }
  function renderAll() { renderProject(); renderTree(); renderTabs(); renderToolbar(); renderPanel(); renderTools(); }

  /* ---------- project ---------- */
  function renderProject() {
    const name = root.querySelector('.wb-proj-name'), rt = root.querySelector('.wb-proj-root'), st = root.querySelector('.wb-proj-state');
    const isVault = proj && norm(proj.root).toLowerCase() === norm(vaultRoot()).toLowerCase();
    name.textContent = proj ? (isVault ? t('wb.thisVault') + ' · ' + proj.name : proj.name) : t('wb.noProject');
    rt.textContent = proj ? proj.root : ''; rt.title = proj ? proj.root : '';
    st.textContent = proj ? (proj.available ? '' : t('wb.unavailableShort')) : '';
    st.className = 'wb-proj-state' + (proj && !proj.available ? ' is-bad' : '');
    root.querySelector('[data-wb=vault]').hidden = !!isVault;
    const un = root.querySelector('.wb-unavailable');
    un.hidden = !(proj && !proj.available);
    if (!un.hidden) un.textContent = t('wb.unavailable', { path: proj.root });
  }
  async function loadProject(p) {
    const changed = !proj || !p || proj.id !== p.id;
    if (changed) persistOpen();
    proj = p;
    if (changed) {
      for (const b of buffers.values()) b.doc = null;
      buffers.clear(); order = []; active = null; dirs.clear(); expanded.clear(); expanded.add(''); selectedDir = '';
      breakpoints = new Map(Object.entries(proj ? store.get('wb:bp:' + proj.id, {}) : {}).map(([k, v]) => [k, new Set(v)]));
      const stdin = root.querySelector('#wb-stdin'); if (stdin) stdin.value = proj ? store.get('wb:stdin:' + proj.id, '') : '';
      if (cm) cm.swapDoc(CM.Doc('', 'text/plain'));
    }
    renderProject();
    if (proj?.available) {
      await listDir('').catch(e => toast(e.message));
      if (changed) {
        // Reopen the files that were open in this project last time (their unsaved drafts included).
        const saved = store.get('wb:open:' + proj.id, null);
        for (const p of saved?.files || []) await openFile(p, { quiet: true, focus: false }).catch(() => {});
        if (saved?.active && buffers.has(saved.active)) activate(saved.active);
        else if (order.length) activate(order[0]);
      }
    }
    renderAll();
  }
  async function refreshStatus() {
    try { const r = await project('status'); await loadProject(r.project); }
    catch (e) { toast(e.message); }
  }
  async function choose() {
    try {
      const r = await project('choose');
      if (r.canceled) return;
      await loadProject(r.project);
      toast(t('wb.switched', { name: r.project.name }));
    } catch (e) { toast(e.message); }
  }
  async function useVault() {
    try { const r = await project('useVault'); await loadProject(r.project); return r.project; }
    catch (e) { toast(e.message); return null; }
  }

  /* ---------- folder tree ---------- */
  async function listDir(path) {
    const r = await project('list', { projectId: proj.id, path });
    dirs.set(path, r.entries);
    return r.entries;
  }
  function renderTree() {
    const host = root.querySelector('.wb-tree-list');
    if (!host) return;
    if (!proj) { host.innerHTML = `<p class="wb-hint">${esc(t('wb.pickFirst'))}</p>`; return; }
    if (!proj.available) { host.innerHTML = ''; return; }
    const rows = [];
    const walk = (path, depth) => {
      for (const e of dirs.get(path) || []) {
        const open = expanded.has(e.path), isDir = e.type === 'directory';
        const cls = ['wb-node', isDir ? 'is-dir' : 'is-file', e.path === active ? 'is-active' : '', isDir && e.path === selectedDir ? 'is-selected' : '', !isDir && buffers.get(e.path) && dirty(buffers.get(e.path)) ? 'is-dirty' : ''].filter(Boolean).join(' ');
        rows.push(`<div class="${cls}" role="treeitem" style="--d:${depth}" data-node="${esc(e.path)}" data-type="${e.type}"${isDir ? ` aria-expanded="${open}"` : ''} title="${esc(e.path)}"><span class="wb-chev">${isDir ? (open ? '▾' : '▸') : ''}</span><span class="wb-node-name">${esc(e.name)}</span></div>`);
        if (isDir && open) walk(e.path, depth + 1);
      }
    };
    walk('', 0);
    host.innerHTML = rows.join('') || `<p class="wb-hint">${esc(t('wb.emptyFolder'))}</p>`;
  }
  async function toggleDir(path) {
    selectedDir = path;
    if (expanded.has(path)) expanded.delete(path);
    else { expanded.add(path); if (!dirs.has(path)) await listDir(path).catch(e => toast(e.message)); }
    renderTree();
  }
  async function revealIn(path) {
    let d = '';
    for (const part of dirOf(path).split('/').filter(Boolean)) { d = d ? d + '/' + part : part; expanded.add(d); if (!dirs.has(d)) await listDir(d).catch(() => {}); }
  }

  /* ---------- open files ---------- */
  const draftKey = path => 'wb:draft:' + proj.id + ':' + path;
  const dirty = b => !!b?.doc && b.doc.getValue() !== b.disk;
  async function ensureEditor() {
    if (cm) return cm;
    const host = root.querySelector('.wb-cm');
    CM = await editorFor(sourceFormat('main.cpp'));
    host.querySelector('.wb-empty')?.remove();
    cm = CM(host, {
      lineNumbers: true, tabSize: 4, indentUnit: 4, indentWithTabs: false, theme: 'graphite', viewportMargin: 12,
      gutters: ['wb-bp-gutter', 'CodeMirror-linenumbers'],
      extraKeys: { Tab: c => (c.somethingSelected() ? c.indentSelection('add') : c.execCommand('insertSoftTab')), 'Shift-Tab': 'indentLess',
        'Ctrl-S': () => saveActive(), 'Cmd-S': () => saveActive(), F5: () => start(run ? 'continue' : 'debug'), 'Ctrl-F5': () => start('run'),
        F9: c => toggleBreakpoint(active, c.getCursor().line + 1), F10: () => debugCmd('next'), F11: () => debugCmd('step'), 'Shift-F11': () => debugCmd('finish') },
    });
    cm.on('gutterClick', (c, line) => toggleBreakpoint(active, line + 1));
    cm.on('cursorActivity', markCursorLine);
    cm.on('change', () => {
      const b = buffers.get(active);
      if (!b) return;
      if (b.problem && !b.conflict) b.problem = '';
      keepDraft(b);
      renderTabs(); renderToolbar(); renderTreeDirty();
    });
    return cm;
  }
  // Drafts: the text of every open file that differs from the disk, with the revision it was based on.
  const draftTimers = new Map();
  function keepDraft(b, now = false) {
    clearTimeout(draftTimers.get(b.path));
    const write = () => store.set(draftKey(b.path), dirty(b) ? { text: b.doc.getValue(), revision: b.revision } : null);
    if (now) write(); else draftTimers.set(b.path, setTimeout(write, 250));
  }
  function persistOpen() {
    if (!proj) return;
    for (const b of buffers.values()) if (b.doc) keepDraft(b, true);
    store.set('wb:open:' + proj.id, { files: order.slice(0, 30), active });
  }
  async function openFile(path, { line = 0, quiet = false, focus = true } = {}) {
    if (!proj) return;
    if (!sourceFormat(path)) { if (!quiet) toast(t('wb.notCode')); return; }
    if (focus) root.classList.remove('show-tree'); // on a narrow pane the tree is a drawer over the editor
    let b = buffers.get(path);
    if (!b) {
      const r = await project('read', { projectId: proj.id, path });
      await ensureEditor();
      const format = sourceFormat(path);
      b = { path, disk: r.editable ? r.content : null, revision: r.revision, eol: r.eol, bom: r.bom, editable: !!r.editable, reason: r.reason || '', conflict: false, problem: '' };
      const draft = store.get(draftKey(path), null);
      let text = r.editable ? r.content : (r.content || '');
      if (draft && typeof draft.text === 'string' && draft.text !== b.disk) {
        // Your unsaved text from before comes back. If the file changed on disk since, it is kept, and saving it
        // needs your decision (keep yours, or load the disk version).
        text = draft.text;
        if (draft.revision !== r.revision) { b.conflict = true; b.problem = t('wb.conflict'); }
      } else if (draft) store.set(draftKey(path), null);
      if (!r.editable) { b.problem = t('wb.readonly'); }
      b.doc = CM.Doc(text, format.mode);
      if (!r.editable) b.doc.cantEdit = true;
      buffers.set(path, b);
      if (!order.includes(path)) order.push(path);
    }
    await revealIn(path);
    if (focus || !active) activate(path);
    if (line) goToLine(line);
    persistOpen();
    renderAll();
  }
  function activate(path) {
    const b = buffers.get(path);
    if (!b || !cm) return;
    active = path;
    cm.swapDoc(b.doc);
    cm.setOption('readOnly', !b.editable);
    cursorLine = null; markCursorLine(); markBreakpoints(); markPaused(); markDiagnostics();
    persistOpen();
    renderTabs(); renderToolbar(); renderTree();
    setTimeout(() => cm.refresh(), 0);
  }
  function goToLine(line) {
    if (!cm || !line) return;
    const pos = { line: Math.max(0, Math.min(line - 1, cm.lastLine())), ch: 0 };
    cm.setCursor(pos); cm.scrollIntoView(pos, 80); cm.focus();
  }
  async function closeFile(path) {
    const b = buffers.get(path);
    if (!b) return;
    if (dirty(b) && !confirm(t('wb.closeDirty', { name: baseOf(path) }))) return;
    store.set(draftKey(path), null);
    buffers.delete(path); order = order.filter(p => p !== path);
    if (active === path) { active = null; if (order.length) activate(order[order.length - 1]); else cm?.swapDoc(CM.Doc('', 'text/plain')); }
    persistOpen(); renderAll();
  }
  async function save(path) {
    const b = buffers.get(path);
    if (!b || !b.editable) return !b ? false : !dirty(b);
    if (!dirty(b)) return true;
    if (b.conflict) { b.problem = t('wb.conflict'); renderToolbar(); return false; }
    const content = b.doc.getValue();
    b.saving = true; renderToolbar();
    try {
      const r = await project('write', { projectId: proj.id, path, content, revision: b.revision });
      b.disk = content; b.revision = r.revision; b.eol = r.eol; b.bom = r.bom; b.problem = '';
      keepDraft(b, true);
      return true;
    } catch (e) {
      // Your text stays in the editor (and its draft); the message says what to do.
      if (e.code === 'changed') { b.conflict = true; b.problem = t('wb.conflict'); }
      else if (e.code === 'project_changed' || e.code === 'project_unavailable') b.problem = t('wb.projectGone');
      else b.problem = t('wb.saveFailed', { msg: e.message });
      keepDraft(b, true);
      return false;
    } finally { b.saving = false; renderAll(); }
  }
  async function saveActive() { if (active) { const ok = await save(active); if (ok) toast(t('wb.saved', { name: baseOf(active) })); } }
  // A changed-on-disk file: keep your text (and save over the disk version), or load the disk version.
  async function resolveConflict(keepMine) {
    const b = buffers.get(active);
    if (!b) return;
    try {
      const r = await project('read', { projectId: proj.id, path: b.path });
      if (keepMine) { b.revision = r.revision; b.disk = r.content; b.conflict = false; b.problem = ''; await save(b.path); }
      else if (confirm(t('wb.discardMine'))) { b.disk = r.content; b.revision = r.revision; b.conflict = false; b.problem = ''; b.doc.setValue(r.content); keepDraft(b, true); }
    } catch (e) { b.problem = e.code === 'not_found' ? t('wb.deleted') : e.message; }
    renderAll();
  }
  async function newEntry(kind) {
    if (!proj?.available) return;
    const name = await askText(kind === 'file' ? t('wb.newFileName') : t('wb.newFolderName'), kind === 'file' ? 'main.cpp' : '', selectedDir ? t('wb.inFolder', { folder: selectedDir }) : t('wb.inRoot'));
    if (!name) return;
    if (/[\\/:]/.test(name) || name === '.' || name === '..') { toast(t('wb.badName')); return; }
    const path = selectedDir ? selectedDir + '/' + name : name;
    try {
      if (kind === 'file') {
        if (!sourceFormat(path)) { toast(t('wb.notCode')); return; }
        await project('create', { projectId: proj.id, path, content: '' });
        await listDir(selectedDir); await openFile(path);
      } else { await project('mkdir', { projectId: proj.id, path }); await listDir(selectedDir); expanded.add(path); dirs.set(path, []); selectedDir = path; renderTree(); }
    } catch (e) { toast(e.code === 'exists' ? t('wb.exists') : e.message); }
  }

  /* ---------- editor marks ---------- */
  function markCursorLine() {
    if (!cm) return;
    const line = cm.getCursor().line;
    if (cursorLine != null) cm.removeLineClass(cursorLine, 'background', 'wb-current-line');
    cursorLine = cm.addLineClass(line, 'background', 'wb-current-line');
    const pos = root.querySelector('.wb-status');
    if (pos && buffers.get(active)) renderToolbar();
  }
  function bpSet(path) { if (!breakpoints.has(path)) breakpoints.set(path, new Set()); return breakpoints.get(path); }
  function toggleBreakpoint(path, line) {
    if (!path || !CPP.test(path) && !/\.(h|hpp|hxx|hh)$/i.test(path)) return;
    const s = bpSet(path);
    s.has(line) ? s.delete(line) : s.add(line);
    store.set('wb:bp:' + proj.id, Object.fromEntries([...breakpoints].filter(([, v]) => v.size).map(([k, v]) => [k, [...v].sort((a, b) => a - b)])));
    markBreakpoints(); renderPanel();
  }
  function markBreakpoints() {
    if (!cm) return;
    cm.clearGutter('wb-bp-gutter');
    for (const line of breakpoints.get(active) || []) {
      if (line - 1 > cm.lastLine()) continue;
      const dot = document.createElement('span'); dot.className = 'wb-bp'; dot.title = t('wb.breakpoint', { line });
      cm.setGutterMarker(line - 1, 'wb-bp-gutter', dot);
    }
  }
  function markPaused() {
    if (!cm) return;
    if (pausedMark != null) { cm.removeLineClass(pausedMark, 'background', 'wb-paused-line'); pausedMark = null; }
    if (paused?.path && paused.path === active && paused.line) pausedMark = cm.addLineClass(paused.line - 1, 'background', 'wb-paused-line');
  }
  let diagMarks = [];
  function markDiagnostics() {
    if (!cm) return;
    for (const m of diagMarks) cm.removeLineClass(m.line, 'wrap', m.cls);
    diagMarks = [];
    for (const d of diagnostics) if (d.path === active && d.line) {
      const cls = d.kind === 'warning' ? 'wb-warn-line' : d.kind === 'note' ? '' : 'wb-error-line';
      if (!cls) continue;
      const line = cm.addLineClass(d.line - 1, 'wrap', cls); diagMarks.push({ line, cls });
    }
  }

  /* ---------- compile, run, debug ---------- */
  function renderTools() {
    const el = root.querySelector('.wb-tools');
    if (!el) return;
    if (!tools) { el.textContent = t('wb.toolsChecking'); return; }
    // "g++.exe (Rev5, Built by MSYS2 project) 16.2.0" -> "16.2.0"; the whole line and the path stay in the tooltip
    const short = v => (String(v || '').match(/\d+(?:\.\d+)+(?=\s*$)/) || String(v || '').match(/\d+(?:\.\d+)+/) || [''])[0];
    const one = (label, x) => x?.found ? `<span class="wb-tool is-ok" title="${esc([x.version, x.path].filter(Boolean).join(' — '))}">✓ ${esc(label)} ${esc(short(x.version))}</span>` : `<span class="wb-tool is-bad">✗ ${esc(t('wb.toolMissing', { tool: label }))}</span>`;
    el.innerHTML = one('g++', tools.compiler) + one('GDB', tools.debugger);
    el.title = [tools.compiler?.path, tools.debugger?.path].filter(Boolean).join('\n');
  }
  async function checkTools() {
    try { tools = await runner('tools'); } catch (e) { tools = { compiler: { found: false }, debugger: { found: false }, error: e.message }; }
    renderTools(); renderToolbar();
  }
  // Other C++ files beside the one you run are compiled with it (a program split into several .cpp files).
  async function sourcesFor(path) {
    const d = dirOf(path);
    const entries = dirs.get(d) || await listDir(d).catch(() => []);
    return entries.filter(e => e.type === 'file' && CPP.test(e.name) && e.path !== path).map(e => e.path);
  }
  async function start(mode) {
    if (mode === 'continue') return debugCmd('continue');
    if (!proj?.available || !active) { toast(t('wb.openCpp')); return; }
    if (!CPP.test(active)) { toast(t('wb.cppOnly')); return; }
    if (run && !run.status) { toast(t('wb.busy')); return; }
    if (!tools?.compiler?.found) { toast(t('wb.toolMissing', { tool: 'g++' })); return; }
    if (mode === 'debug' && !tools?.debugger?.found) { toast(t('wb.toolMissing', { tool: 'GDB' })); return; }
    const entry = active, sources = await sourcesFor(entry);
    // Save what will be compiled first; if a save fails, nothing is compiled.
    for (const b of buffers.values()) {
      if (!dirty(b)) continue;
      if (b.path !== entry && !sources.includes(b.path) && !/\.(h|hpp|hxx|hh)$/i.test(b.path)) continue;
      if (!(await save(b.path))) { activate(b.path); toast(t('wb.notCompiledSave', { name: baseOf(b.path) })); return; }
    }
    outText = ''; diagnostics = []; paused = null; markPaused(); markDiagnostics();
    const bps = mode === 'debug' ? [...breakpoints].flatMap(([path, s]) => [...s].map(line => ({ path, line }))) : [];
    run = { id: null, mode, phase: 'starting', status: null };
    panel = { open: true, tab: 'output' }; store.set('wb:panel', panel);
    renderAll();
    try {
      const r = await runner('start', { projectId: proj.id, path: entry, mode, stdin: root.querySelector('#wb-stdin').value, sources, breakpoints: bps });
      run.id = r.id;
      for (const ev of early.splice(0)) if (ev.id === r.id) onEvent(ev);
    } catch (e) { run.status = 'error'; run.message = e.message; append('stderr', e.message + '\n'); }
    renderAll();
  }
  const early = []; // events that arrive before start() has its id
  function onEvent(ev) {
    if (!run) return;
    if (!run.id) { early.push(ev); return; }
    if (ev.id !== run.id) return;
    if (ev.type === 'phase') run.phase = ev.phase;
    else if (ev.type === 'output') append(ev.stream, ev.text || '');
    else if (ev.type === 'paused') {
      paused = { reason: ev.reason, path: ev.path || null, line: ev.line || null, func: ev.function || '', locals: Array.isArray(ev.locals) ? ev.locals : [] };
      run.phase = 'paused';
      panel = { open: true, tab: 'debug' };
      if (paused.path && buffers.has(paused.path)) { activate(paused.path); goToLine(paused.line); }
      else if (paused.path) openFile(paused.path, { line: paused.line }).catch(() => {});
      markPaused();
    } else if (ev.type === 'end') {
      run.status = ev.status; run.exitCode = ev.exitCode; run.message = ev.message || '';
      paused = null; markPaused();
      diagnostics = parseDiagnostics(outText);
      if (ev.status === 'compile_error' && diagnostics.length) panel = { open: true, tab: 'problems' };
      markDiagnostics();
    }
    renderToolbar(); renderPanel();
  }
  function append(stream, text) {
    outText += stream === 'stderr' ? text.replace(/^/gm, '\u0002') : text; // \u0002 marks stderr lines
    if (outText.length > OUT_MAX) outText = '…\n' + outText.slice(-OUT_MAX);
    renderOutput();
  }
  // g++ messages: "C:/proj/src/main.cpp:12:5: error: …" → the file in the project, line, column, kind.
  function parseDiagnostics(text) {
    const out = [], rootPath = norm(proj?.root || '').toLowerCase();
    for (const raw of text.replace(/\u0002/g, '').split('\n')) {
      const m = /^(.*?):(\d+):(?:(\d+):)?\s*(fatal error|error|warning|note):\s*(.*)$/.exec(raw.trim());
      if (!m) continue;
      let file = norm(m[1]);
      if (rootPath && file.toLowerCase().startsWith(rootPath + '/')) file = file.slice(rootPath.length + 1);
      const inside = !/^[a-z]:\//i.test(file) && !file.startsWith('/');
      out.push({ path: inside ? file : null, file: m[1], line: +m[2], col: +(m[3] || 0), kind: m[4] === 'fatal error' ? 'error' : m[4], text: m[5] });
    }
    return out;
  }
  async function debugCmd(action) {
    if (!run?.id || run.status || run.phase !== 'paused') return;
    run.phase = 'debugging'; renderToolbar();
    try { await runner('debug', { id: run.id, action }); }
    catch (e) { run.phase = 'paused'; toast(e.message); renderToolbar(); }
  }
  async function stop() {
    if (!run?.id || run.status) return;
    try { await runner('stop', { id: run.id }); } catch (e) { toast(e.message); }
  }

  /* ---------- rendering: tabs, toolbar, panel ---------- */
  function renderTabs() {
    const host = root.querySelector('.wb-tabs');
    if (!host) return;
    host.innerHTML = order.map(p => {
      const b = buffers.get(p);
      return `<div class="wb-tab${p === active ? ' is-active' : ''}${dirty(b) ? ' is-dirty' : ''}${b?.conflict ? ' is-conflict' : ''}" role="tab" data-tab="${esc(p)}" title="${esc(p)}"><span>${esc(baseOf(p))}</span><span class="wb-dot" aria-label="${esc(t('wb.unsaved'))}">●</span><button type="button" class="wb-tab-x" data-close="${esc(p)}" aria-label="${esc(t('wb.closeFile', { name: baseOf(p) }))}">×</button></div>`;
    }).join('');
  }
  function renderTreeDirty() {
    for (const el of root.querySelectorAll('.wb-node.is-file')) el.classList.toggle('is-dirty', dirty(buffers.get(el.dataset.node)));
  }
  function renderToolbar() {
    const b = buffers.get(active), busy = run && !run.status;
    const q = s => root.querySelector(s);
    if (!q('.wb-file')) return;
    q('.wb-file').textContent = b ? b.path : '';
    let status = '';
    if (b) {
      const pos = cm ? cm.getCursor() : { line: 0, ch: 0 };
      status = (b.saving ? t('wb.saving') : !b.editable ? t('wb.readonly') : dirty(b) ? t('wb.unsaved') : t('wb.saved0')) + ' · ' + t('wb.lnCol', { line: pos.line + 1, col: pos.ch + 1 });
    }
    q('.wb-status').textContent = status;
    const prob = q('.wb-problem');
    prob.hidden = !b?.problem;
    if (b?.problem) prob.innerHTML = `<span>${esc(b.problem)}</span>${b.conflict ? `<button type="button" data-wb="keep-mine">${esc(t('wb.keepMine'))}</button><button type="button" data-wb="load-disk">${esc(t('wb.loadDisk'))}</button>` : ''}`;
    const cpp = !!b && CPP.test(b.path) && proj?.available;
    q('[data-wb=save]').disabled = !b || !dirty(b) || !b.editable || !!b.conflict || !!b.saving;
    q('[data-wb=build]').disabled = !cpp || busy || !tools?.compiler?.found;
    q('[data-wb=run]').disabled = !cpp || busy || !tools?.compiler?.found;
    q('[data-wb=debug]').disabled = !cpp || busy || !tools?.debugger?.found;
    q('[data-wb=stop]').hidden = !busy;
    const pausedNow = busy && run.phase === 'paused';
    q('.wb-debug-controls').hidden = !(busy && run.mode === 'debug');
    for (const a of ['continue', 'next', 'step', 'finish']) q(`[data-wb=${a}]`).disabled = !pausedNow;
    root.classList.toggle('is-running', !!busy);
  }
  function runStateText() {
    if (!run) return '';
    if (!run.status) return t('wb.phase.' + (run.phase || 'starting'));
    const s = run.status === 'success' ? (run.mode === 'build' ? t('wb.end.built') : t('wb.end.success', { code: run.exitCode ?? 0 }))
      : run.status === 'runtime_error' ? t('wb.end.runtime', { code: run.exitCode ?? '?' }) : t('wb.end.' + run.status);
    return s + (run.message && run.status !== 'success' ? ' · ' + run.message : '');
  }
  function renderOutput() {
    const pre = root.querySelector('.wb-output');
    if (!pre) return;
    pre.innerHTML = outText ? outText.split('\n').map(l => (l.startsWith('\u0002') ? `<span class="wb-err">${esc(l.slice(1))}</span>` : esc(l))).join('\n') : `<span class="wb-hint">${esc(t('wb.outputHint'))}</span>`;
    pre.scrollTop = pre.scrollHeight;
  }
  function renderPanel() {
    const footer = root.querySelector('.wb-panel');
    if (!footer) return;
    footer.classList.toggle('is-collapsed', !panel.open);
    root.querySelector('[data-wb=panel]').textContent = panel.open ? t('wb.collapse') : t('wb.expand');
    root.querySelector('[data-wb=panel]').setAttribute('aria-expanded', String(panel.open));
    for (const b of root.querySelectorAll('[data-panel]')) { b.classList.toggle('is-active', b.dataset.panel === panel.tab); b.setAttribute('aria-selected', String(b.dataset.panel === panel.tab)); }
    for (const p of root.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== panel.tab;
    const errs = diagnostics.filter(d => d.kind === 'error').length, warns = diagnostics.filter(d => d.kind === 'warning').length;
    root.querySelector('[data-panel=problems]').textContent = t('wb.problems') + (errs + warns ? ` (${errs + warns})` : '');
    const rs = root.querySelector('.wb-run-state');
    rs.textContent = runStateText();
    rs.className = 'wb-run-state' + (run?.status && run.status !== 'success' ? ' is-bad' : run?.status === 'success' ? ' is-ok' : '');
    renderOutput();
    root.querySelector('.wb-problems').innerHTML = diagnostics.length ? diagnostics.map((d, i) =>
      `<button type="button" class="wb-diag is-${d.kind}" data-diag="${i}"${d.path ? '' : ' disabled'}><b>${esc(d.kind === 'error' ? t('wb.error') : d.kind === 'warning' ? t('wb.warning') : t('wb.note'))}</b> <span class="wb-diag-at">${esc((d.path || d.file) + ':' + d.line + (d.col ? ':' + d.col : ''))}</span> ${esc(d.text)}</button>`).join('')
      : `<p class="wb-hint">${esc(run?.status === 'compile_error' ? t('wb.compileFailedNoList') : t('wb.noProblems'))}</p>`;
    const bpList = [...breakpoints].flatMap(([p, s]) => [...s].map(l => `<button type="button" class="wb-bp-row" data-goto="${esc(p)}" data-line="${l}">● ${esc(p)}:${l}</button>`)).join('');
    root.querySelector('.wb-debug').innerHTML = (paused
      ? `<p class="wb-paused-at">${esc(t('wb.pausedAt', { where: (paused.path || '?') + ':' + (paused.line || '?') + (paused.func ? ' · ' + paused.func : '') }))}</p>
         ${paused.locals.length ? `<table class="wb-locals"><thead><tr><th>${esc(t('wb.varName'))}</th><th>${esc(t('wb.varValue'))}</th><th>${esc(t('wb.varType'))}</th></tr></thead><tbody>${paused.locals.map(v => `<tr><td>${esc(v.name)}</td><td><code>${esc(v.value)}</code></td><td>${esc(v.type || '')}</td></tr>`).join('')}</tbody></table>` : `<p class="wb-hint">${esc(t('wb.noLocals'))}</p>`}`
      : `<p class="wb-hint">${esc(run?.mode === 'debug' && !run.status ? t('wb.phase.' + (run.phase || 'starting')) : t('wb.debugHint'))}</p>`) +
      `<h4>${esc(t('wb.breakpoints'))}</h4>${bpList || `<p class="wb-hint">${esc(t('wb.noBreakpoints'))}</p>`}`;
  }

  /* ---------- events ---------- */
  async function onClick(e) {
    const tab = e.target.closest('[data-tab]'), x = e.target.closest('[data-close]');
    if (x) { e.stopPropagation(); return closeFile(x.dataset.close); }
    if (tab) return activate(tab.dataset.tab);
    const node = e.target.closest('[data-node]');
    if (node) { if (node.dataset.type === 'directory') return toggleDir(node.dataset.node); selectedDir = dirOf(node.dataset.node); return openFile(node.dataset.node).catch(err => toast(err.message)); }
    const pb = e.target.closest('[data-panel]');
    if (pb) { panel = { open: true, tab: pb.dataset.panel }; store.set('wb:panel', panel); return renderPanel(); }
    const dg = e.target.closest('[data-diag]');
    if (dg) { const d = diagnostics[+dg.dataset.diag]; if (d?.path) await openFile(d.path, { line: d.line }).catch(err => toast(err.message)); return; }
    const gt = e.target.closest('[data-goto]');
    if (gt) return openFile(gt.dataset.goto, { line: +gt.dataset.line }).catch(err => toast(err.message));
    const a = e.target.closest('[data-wb]')?.dataset.wb;
    if (!a) return;
    if (a === 'choose') return choose();
    if (a === 'vault') return useVault();
    if (a === 'refresh') { dirs.clear(); if (proj) await refreshStatus(); return; }
    if (a === 'new-file') return newEntry('file');
    if (a === 'new-folder') return newEntry('folder');
    if (a === 'save') return saveActive();
    if (a === 'keep-mine') return resolveConflict(true);
    if (a === 'load-disk') return resolveConflict(false);
    if (['build', 'run', 'debug'].includes(a)) return start(a);
    if (a === 'stop') return stop();
    if (['continue', 'next', 'step', 'finish'].includes(a)) return debugCmd(a);
    if (a === 'panel') { panel = { ...panel, open: !panel.open }; store.set('wb:panel', panel); return renderPanel(); }
    if (a === 'toggle-tree') { root.classList.toggle('show-tree'); return; }
  }

  /* ---------- the tab ---------- */
  async function init() {
    build();
    if (!unsubscribe && desk()?.onCodeRun) unsubscribe = desk().onCodeRun(onEvent);
    if (!tools) checkTools();
    if (!proj) await refreshStatus();
  }
  return {
    id: 'code-workbench', icon: '⌨',
    title: () => t('wb.title'),
    async show() { visible = true; root.hidden = false; await init(); setTimeout(() => cm?.refresh(), 0); },
    hide() { visible = false; root.hidden = true; persistOpen(); },
    close() { persistOpen(); },
    relabel,
    open: (key) => { /* one workbench tab */ },
    // From "Create a code file": put a new file in the vault (any folder) or in a project folder, then open it.
    async createFile({ where, folder = '', name }) {
      await init();
      if (where === 'vault') {
        const isVault = proj && norm(proj.root).toLowerCase() === norm(vaultRoot()).toLowerCase();
        if (!isVault && !(await useVault())) return false;
      } else if (!proj?.available) return false;
      const path = folder ? folder + '/' + name : name;
      try { await project('create', { projectId: proj.id, path, content: '' }); }
      catch (e) { toast(e.code === 'exists' ? t('wb.exists') : e.message); return false; }
      if (folder) { await revealIn(path); }
      await listDir(folder).catch(() => {});
      onShowTab();
      await openFile(path);
      return true;
    },
    async chooseProject() { await init(); await choose(); return proj; },
    currentProject: () => proj,
    isVaultProject: () => !!proj && norm(proj.root).toLowerCase() === norm(vaultRoot()).toLowerCase(),
    async status() { await init(); return proj; },
    // Before closing, updating or switching vaults: every open file's unsaved text is written to its draft now, so
    // it comes back next time. (These are project files, not vault notes, so they are not reported as `unsaved`.)
    flush() { persistOpen(); return [...buffers.values()].filter(dirty).length; },
    get visible() { return visible; },
  };
}

// The "Create a code file" window: where (any folder of this vault, or a project folder on this computer) and the
// file name. Returns {where, folder, name} or null.
export function newCodeFileDialog({ wb, vaultFolders, startFolder = '' }) {
  return new Promise(resolve => {
    const el = document.body.appendChild(document.createElement('div'));
    el.className = 'review-modal ai-tool wb-new-dialog';
    const folders = ['', ...vaultFolders()];
    const ext = wb.currentProject();
    const extName = ext && !wb.isVaultProject() ? ext : null;
    el.innerHTML = `<div class="review-bg"></div><div class="review-box" role="dialog" aria-labelledby="wb-new-title">
      <div class="review-head"><span class="review-title" id="wb-new-title">${esc(t('wb.newCodeTitle'))}</span><button class="review-x" type="button" aria-label="${esc(t('review.close'))}">×</button></div>
      <div class="review-card wb-new-body">
        <fieldset><legend>${esc(t('wb.where'))}</legend>
          <label class="wb-choice"><input type="radio" name="wb-where" value="vault" checked> ${esc(t('wb.whereVault'))}</label>
          <label class="ai-field wb-indent"><span>${esc(t('wb.folder'))}</span><select data-f="folder">${folders.map(f => `<option value="${esc(f)}"${f === startFolder ? ' selected' : ''}>${esc(f || t('wb.vaultRoot'))}</option>`).join('')}</select></label>
          <label class="wb-choice"><input type="radio" name="wb-where" value="project"> ${esc(t('wb.whereProject'))}</label>
          <div class="wb-indent wb-ext"><span class="wb-ext-name">${esc(extName ? extName.name + ' — ' + extName.root : t('wb.noExternal'))}</span> <button type="button" class="mod-button" data-a="pick">${esc(t('wb.choose'))}</button></div>
          <label class="ai-field wb-indent"><span>${esc(t('wb.subfolder'))}</span><input data-f="sub" placeholder="${esc(t('wb.subfolderPh'))}" spellcheck="false"></label>
        </fieldset>
        <label class="ai-field"><span>${esc(t('wb.fileName'))}</span><input data-f="name" value="main.cpp" spellcheck="false"></label>
        <p class="wb-target muted"></p><p class="mod-error" hidden></p>
      </div>
      <div class="review-actions"><button class="mod-button mod-cta" data-a="create" type="button">${esc(t('wb.create'))}</button><button class="mod-button" data-a="cancel" type="button">${esc(t('fj.cancel'))}</button></div></div>`;
    let extProj = extName;
    const q = s => el.querySelector(s);
    const where = () => q('input[name=wb-where]:checked').value;
    const update = () => {
      const w = where(), name = q('[data-f=name]').value.trim(), sub = q('[data-f=sub]').value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      const folder = w === 'vault' ? q('[data-f=folder]').value : sub;
      q('.wb-target').textContent = w === 'vault' ? t('wb.target', { path: (folder ? folder + '/' : '') + name, place: t('wb.thisVault') })
        : extProj ? t('wb.target', { path: (folder ? folder + '/' : '') + name, place: extProj.root }) : t('wb.pickFolderFirst');
      q('[data-a=create]').disabled = !name || (w === 'project' && !extProj);
      q('[data-f=folder]').disabled = w !== 'vault'; q('[data-f=sub]').disabled = w !== 'project';
    };
    const done = v => { el.remove(); resolve(v); };
    el.addEventListener('input', update); el.addEventListener('change', update);
    q('.review-x').onclick = () => done(null); q('.review-bg').onclick = () => done(null); q('[data-a=cancel]').onclick = () => done(null);
    q('[data-a=pick]').onclick = async () => {
      const p = await wb.chooseProject();
      if (p && !wb.isVaultProject()) { extProj = p; q('.wb-ext-name').textContent = p.name + ' — ' + p.root; q('input[value=project]').checked = true; }
      update();
    };
    q('[data-a=create]').onclick = () => {
      const w = where(), name = q('[data-f=name]').value.trim();
      const err = q('.mod-error');
      if (!name || /[\\/:]/.test(name) || !sourceFormat(name)) { err.textContent = t('wb.badName'); err.hidden = false; return; }
      const folder = w === 'vault' ? q('[data-f=folder]').value : q('[data-f=sub]').value.trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
      if (folder.split('/').some(s => s === '..' || s === '.')) { err.textContent = t('wb.badName'); err.hidden = false; return; }
      done({ where: w, folder, name });
    };
    update();
    setTimeout(() => q('[data-f=name]').select(), 30);
  });
}
