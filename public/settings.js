// Settings window: General options, Community plugins (install / enable / browse) and plugin setting tabs.
import { t, LANGS, getLang } from '/i18n.js';
import * as PM from '/plugins.js';
import { DEFAULTS, loadAppearance, saveAppearance, listFonts, isInstalled } from '/appearance.js';
import { reviewSettings, setReviewSettings } from '/review.js';
import * as AI from '/ai.js';
import { enhanceAISelect, modelPicker } from '/aipicker.js';
import { folderPanel } from '/filejobs.js';

let H = null;
let root = null, nav = null, content = null;
let current = 'general';
let activeTab = null;      // plugin setting tab currently shown
let renderToken = 0;
let community = null;      // cached community plugin list

export function initSettings(host) { H = host; }

// Esc closes; Tab and Shift+Tab stay inside the Settings window (a dialog), so keyboard users never end up in
// the page behind it.
const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';
const onKey = e => {
  if (document.querySelector('.plugin-modal')) return;
  // Esc in an open model list (or the custom model box) closes that, not Settings.
  if (e.key === 'Escape' && document.querySelector('.model-picker.is-open') || (e.key === 'Escape' && document.activeElement?.matches?.('.model-custom'))) return;
  if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSettings(); return; }
  if (e.key !== 'Tab' || e.ctrlKey || e.metaKey || e.altKey) return;
  const box = root?.querySelector('.settings-box');
  const list = box ? [...box.querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null || el === document.activeElement) : [];
  if (!list.length) return;
  const i = list.indexOf(document.activeElement);
  if (i < 0 || (e.shiftKey && i === 0) || (!e.shiftKey && i === list.length - 1)) {
    e.preventDefault();
    list[i < 0 ? (e.shiftKey ? list.length - 1 : 0) : e.shiftKey ? list.length - 1 : 0].focus();
  }
};
let returnFocus = null;

export function openSettings(tab) {
  if (!root) build();
  const wasOpen = settingsOpen();
  if (!wasOpen) returnFocus = document.activeElement;
  root.classList.remove('hidden');
  document.addEventListener('keydown', onKey, true);
  if (!wasOpen) setTimeout(() => { if (settingsOpen() && !root.contains(document.activeElement)) nav.querySelector('.settings-nav-item.active')?.focus(); }, 0);
  show(tab ? (tab.startsWith('plugin:') || ['general', 'appearance', 'review', 'study', 'ai', 'claude', 'sync', 'plugins'].includes(tab) ? tab : 'plugin:' + tab) : current);
}
export function closeSettings() {
  if (!root || root.classList.contains('hidden')) return;
  hideActiveTab();
  root.classList.add('hidden');
  document.removeEventListener('keydown', onKey, true);
  if (returnFocus?.isConnected) returnFocus.focus?.();
  returnFocus = null;
}
export const settingsOpen = () => root && !root.classList.contains('hidden');
// Re-render (e.g. after a language change).
export function refreshSettings(tab) { if (settingsOpen() && (!tab || tab === current)) show(current); }

function build() {
  root = document.body.appendChild(createDiv('settings-modal hidden'));
  root.createDiv('settings-bg').addEventListener('mousedown', closeSettings);
  const box = root.createDiv('settings-box');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', t('settings.title'));
  nav = box.createDiv('settings-nav scroll');
  content = box.createDiv('settings-content scroll');
  const close = box.createEl('button', { cls: 'settings-close', text: '×', attr: { 'aria-label': t('review.close') } });
  close.addEventListener('click', closeSettings);
}

function hideActiveTab() { if (activeTab) { try { activeTab.hide(); } catch (e) { console.error(e); } activeTab = null; } }

function drawNav() {
  nav.empty();
  // Each section can be reached with Tab and opened with Enter or Space; the open one is marked as current.
  const item = (id, label) => {
    const el = nav.createDiv({ cls: 'settings-nav-item' + (id === current ? ' active' : ''), text: label, attr: { role: 'button', tabindex: '0', ...(id === current ? { 'aria-current': 'page' } : {}) } });
    el.onclick = () => show(id);
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(id); nav.querySelector('.settings-nav-item.active')?.focus(); } };
  };
  nav.createDiv({ cls: 'settings-nav-heading', text: t('settings.options') });
  item('general', t('settings.general'));
  item('appearance', t('settings.appearance'));
  item('review', t('settings.review'));
  item('study', t('study.title'));
  item('ai', t('settings.ai'));
  item('claude', t('claude.title'));
  item('sync', t('settings.sync'));
  item('plugins', t('settings.plugins'));
  const tabs = PM.getSettingTabs();
  if (tabs.length) {
    nav.createDiv({ cls: 'settings-nav-heading', text: t('settings.pluginOptions') });
    for (const r of tabs) item('plugin:' + r.plugin.manifest.id, PM.pluginName(r.plugin.manifest));
  }
}

async function show(id) {
  hideActiveTab();
  current = id;
  const token = ++renderToken;
  drawNav();
  content.empty();
  content.scrollTop = 0;
  if (id === 'general') return renderGeneral();
  if (id === 'appearance') return renderAppearance(token);
  if (id === 'review') return renderReview();
  if (id === 'study') return renderStudy(token);
  if (id === 'ai') return renderAI();
  if (id === 'claude') return renderClaude(token);
  if (id === 'sync') return renderSync(token);
  if (id === 'plugins') return renderPlugins(token);
  if (id === 'browse') return renderBrowse(token);
  if (id.startsWith('plugin:')) {
    const rec = PM.getSettingTabs().find(r => r.plugin.manifest.id === id.slice(7));
    if (!rec) return show('plugins');
    content.appendChild(rec.tab.containerEl);
    rec.tab.containerEl.empty();
    activeTab = rec.tab;
    try { rec.tab.display(); } catch (e) { rec.tab.containerEl.createEl('p', { cls: 'mod-error', text: String(e?.message || e) }); console.error(e); }
  }
}

function heading(text) { content.createEl('h2', { cls: 'settings-h', text }); }

function renderGeneral() {
  heading(t('settings.general'));
  new PM.Setting(content).setName(t('cmd.sjtu-canvas')).setDesc(t('canvas.settings')).addButton(button => {
    button.buttonEl.id = 'settings-canvas-open';
    button.setButtonText(t('canvas.open')).onClick(() => { closeSettings(); H.runCommand('sjtu-canvas'); });
  });
  new PM.Setting(content).setName(t('settings.language')).setDesc(t('settings.languageDesc')).addDropdown(d => {
    for (const l of LANGS) d.addOption(l.code, `${l.name}  ·  ${l.english}`);
    d.setValue(getLang()).onChange(v => H.changeLanguage(v));
  });
  // The ribbon's language and theme buttons repeat these settings, so they are optional (off by default).
  new PM.Setting(content).setName(t('settings.ribbonExtras')).setDesc(t('settings.ribbonExtrasDesc'))
    .addToggle(tg => tg.setValue(!!H.store.get('ribbonExtras', false)).onChange(v => { H.store.set('ribbonExtras', v); H.applyRibbonExtras(); }));
  const vaultRow = new PM.Setting(content).setName(t('settings.vault')).setDesc(H.S.vault || '');
  // Desktop app only: switch to another vault folder (the app restarts on it).
  if (window.myobsidianDesktop) vaultRow.addButton(b => b.setButtonText(t('settings.switchVault')).onClick(() => window.myobsidianDesktop.chooseVault()));
  vaultRow.addButton(b => b.setButtonText(t('settings.reveal')).onClick(() => H.api('POST', 'reveal')));
  new PM.Setting(content).setName(t('settings.version')).setDesc(`Graphite ${H.S.version || ''}`);
  new PM.Setting(content).setName(t('settings.credits')).setDesc(t('settings.creditsDesc', { author: 'MistZero', co: 'Claude' }));
  if (window.myobsidianDesktop?.checkUpdates) { // desktop app only
    const u = H.S.update;
    const messages = [];
    if (u?.available) messages.push(t('update.tooltip', { version: u.available }));
    if (u?.checkError) messages.push(t('update.check.' + u.checkError));
    if (!messages.length) messages.push(u ? t('update.upToDate', { version: u.current || H.S.version || '' }) : t('update.notChecked'));
    new PM.Setting(content).setName(t('settings.updates'))
      .setDesc(messages.join(' '))
      .then(s => {
        if (u?.available) s.addButton(b => b.setButtonText(t('update.install')).setCta().onClick(() => H.installUpdate()));
        s.addButton(b => b.setButtonText(t('update.check')).onClick(() => H.checkUpdates(true)));
      });
  }
  new PM.Setting(content).setName(t('settings.help')).setDesc(t('settings.helpDesc')).addButton(b => b.setButtonText(t('settings.openHelp')).onClick(() => { closeSettings(); H.showHelp('guide'); }));
}

function renderReview() {
  heading(t('settings.review'));
  content.createEl('p', { cls: 'setting-note', text: t('review.intro') });
  const r = reviewSettings();
  new PM.Setting(content).setName(t('settings.checkAfter')).setDesc(t('settings.checkAfterDesc'))
    .addToggle(tg => tg.setValue(r.checkAfterWriting).onChange(v => setReviewSettings({ checkAfterWriting: v })));
  const per = new PM.Setting(content).setName(t('settings.newPerDay'));
  const desc = n => per.setDesc(`${t('settings.newPerDayDesc')} (${n})`);
  desc(r.newPerDay);
  per.addSlider(sl => sl.setLimits(0, 50, 1).setValue(r.newPerDay).setDynamicTooltip().onChange(v => { setReviewSettings({ newPerDay: v }); desc(v); H.onReviewChange(); }));
  // Which notes daily review draws from. "Quiz this note" still works on any note.
  const list = v => (Array.isArray(v) ? v : []).join(', ');
  const parse = v => v.split(',').map(s => s.trim()).filter(Boolean);
  new PM.Setting(content).setName(t('settings.reviewFolders')).setDesc(t('settings.reviewFoldersDesc'))
    .addText(tx => tx.setPlaceholder(t('settings.reviewFoldersPh')).setValue(list(r.reviewFolders)).onChange(v => { setReviewSettings({ reviewFolders: parse(v) }); H.onReviewChange(); }));
  new PM.Setting(content).setName(t('settings.reviewExclude')).setDesc(t('settings.reviewExcludeDesc'))
    .addText(tx => tx.setPlaceholder(t('settings.reviewExcludePh')).setValue(list(r.reviewExclude)).onChange(v => { setReviewSettings({ reviewExclude: parse(v) }); H.onReviewChange(); }));
  new PM.Setting(content).setName(t('ai.questions')).setDesc(t('ai.questionsMoved'))
    .addButton(b => b.setButtonText(t('settings.ai')).onClick(() => show('ai')));
  new PM.Setting(content).setName(t('review.title')).setDesc(t('review.openDesc'))
    .addButton(b => b.setButtonText(t('cmd.review')).setCta().onClick(() => { closeSettings(); H.runCommand('review'); }));
}

// Study settings: folders, courses, languages and a few words about you, saved once and used by every AI that does
// a job (Claude Code, DeepSeek Harness, Codex CLI, an API model, frameworks added later). Saved by the server in
// one file (shown on the page) that outside agents can read too.
async function renderStudy(token) {
  heading(t('study.title'));
  content.createEl('p', { cls: 'setting-note', text: t('study.intro') });
  let st;
  try { st = await AI.studySettings(true); } catch (e) { content.createEl('p', { cls: 'mod-error', text: e.message }); return; }
  if (token !== renderToken) return;
  const p = { ...st.profile };
  delete p.differences;
  const list = v => String(v || '').split(/[,，\n]/).map(x => x.trim()).filter(Boolean);
  const pairs = o => Object.entries(o || {}).map(([k, v]) => `${k} = ${v}`).join('\n');
  const parsePairs = txt => Object.fromEntries(String(txt).split(/\r?\n/).map(l => l.split('=')).filter(x => x.length >= 2 && x[0].trim()).map(([k, ...v]) => [k.trim(), v.join('=').trim()]));
  let dirty = false;
  const set = patch => { Object.assign(p, patch); dirty = true; saveBtn?.setDisabled(false); state.setText(t('study.unsaved')); };

  // Left over from the move: the two old places said different things. Both values were kept; check them once.
  const diffs = st.differences || st.profile?.differences || [];
  if (diffs.length) {
    const box = content.createDiv('settings-callout is-warn study-diffs');
    box.createEl('h3', { text: t('study.diffTitle') });
    box.createEl('p', { text: t('study.diffDesc') });
    const ul = box.createEl('ul');
    const show = v => (Array.isArray(v) ? v.join(', ') || '—' : typeof v === 'boolean' ? (v ? '✓' : '✗') : String(v ?? '—'));
    for (const d of diffs) ul.createEl('li', { text: t('study.diffRow', { field: t('study.f.' + d.field), claude: show(d.claude), ai: show(d.ai), kept: show(d.field === 'lookElsewhere' ? d.ai : [...new Set([...(d.claude || []), ...(d.ai || [])])]) }) });
  }

  new PM.Setting(content).setName(t('study.f.vault')).setDesc(H.S.vault || st.vault || '');
  // Course folders, each checked: found, not a full path, or missing.
  const rootsRow = new PM.Setting(content).setName(t('study.f.courseRoots')).setDesc(t('study.d.courseRoots')).addTextArea(ta => {
    ta.setPlaceholder('D:/University').setValue((p.courseRoots || []).join('\n')).onChange(v => { set({ courseRoots: list(v) }); checkRoots(); });
    ta.inputEl.rows = 3; ta.inputEl.dataset.study = 'courseRoots';
  });
  const rootsInfo = rootsRow.descEl.createDiv({ cls: 'fw-roots' });
  let rootsTimer = null;
  const checkRoots = () => {
    clearTimeout(rootsTimer);
    rootsTimer = setTimeout(async () => {
      const r = await fetch('/api/check-folders', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: p.courseRoots || [] }) }).then(x => x.json()).catch(() => []);
      rootsInfo.empty();
      for (const f of r) rootsInfo.createDiv({ cls: 'fw-root ' + (f.ok ? 'is-ok' : 'is-bad'), text: (f.ok ? '✓ ' : '✗ ') + f.path + (f.ok ? '' : ' — ' + t('agent.root.' + f.reason)) });
    }, 300);
  };
  checkRoots();
  new PM.Setting(content).setName(t('study.f.courses')).setDesc(t('study.d.courses'))
    .addTextArea(x => { x.setPlaceholder('LA = Linear Algebra\nCALC = Calculus').setValue(pairs(p.courses)).onChange(v => set({ courses: parsePairs(v) })); x.inputEl.rows = 5; x.inputEl.dataset.study = 'courses'; });
  new PM.Setting(content).setName(t('study.f.skipFolders')).setDesc(t('study.d.skipFolders'))
    .addText(x => { x.setPlaceholder('OLD, Archive').setValue((p.skipFolders || []).join(', ')).onChange(v => set({ skipFolders: list(v) })); x.inputEl.dataset.study = 'skipFolders'; });
  new PM.Setting(content).setName(t('study.f.lookElsewhere')).setDesc(t('study.d.lookElsewhere', { days: p.recentDays || 180 }))
    .addToggle(tg => { tg.setValue(!!p.lookElsewhere).onChange(v => set({ lookElsewhere: v })); tg.toggleEl.dataset.study = 'lookElsewhere'; })
    .addText(x => { x.setValue((p.recentFolders || []).join(', ')).onChange(v => set({ recentFolders: list(v) })); x.inputEl.dataset.study = 'recentFolders'; });
  new PM.Setting(content).setName(t('study.f.readOnlyFolders')).setDesc(t('study.d.readOnlyFolders'))
    .addText(x => { x.setPlaceholder('My Brain').setValue((p.readOnlyFolders || []).join(', ')).onChange(v => set({ readOnlyFolders: list(v) })); x.inputEl.dataset.study = 'readOnlyFolders'; });
  // Source folders a local AI may read for imports (desktop app): the same list, picker and Revoke as on the
  // import's access page, reachable here at any time.
  if (window.myobsidianDesktop?.agentFolders) {
    const panel = createDiv({ cls: 'fj-folders study-folders', attr: { hidden: '' } });
    new PM.Setting(content).setName(t('study.f.sourceFolders')).setDesc(t('study.d.sourceFolders'))
      .addButton(b => { b.setButtonText(t('study.manageFolders')); b.buttonEl.dataset.study = 'manageFolders'; b.buttonEl.setAttribute('aria-expanded', 'false');
        b.onClick(() => { const open = panel.hasAttribute('hidden'); panel.toggleAttribute('hidden', !open); b.buttonEl.setAttribute('aria-expanded', String(open)); if (open && !panel.dataset.ready) { panel.dataset.ready = '1'; folderPanel(panel); } }); });
    content.appendChild(panel);
  }
  new PM.Setting(content).setName(t('study.f.brainFolder')).setDesc(t('study.d.brainFolder'))
    .addText(x => { x.setValue(p.brainFolder || 'Claude Brain').onChange(v => set({ brainFolder: v.trim() })); x.inputEl.dataset.study = 'brainFolder'; });
  new PM.Setting(content).setName(t('study.f.studyPagesFolder')).setDesc(t('study.d.studyPagesFolder'))
    .addText(x => { x.setValue(p.studyPagesFolder || '').onChange(v => set({ studyPagesFolder: v.trim() })); x.inputEl.dataset.study = 'studyPagesFolder'; });
  new PM.Setting(content).setName(t('study.f.about')).setDesc(t('study.d.about'))
    .addTextArea(x => { x.setPlaceholder(t('study.p.about')).setValue(p.about || '').onChange(v => set({ about: v })); x.inputEl.rows = 2; x.inputEl.dataset.study = 'about'; });
  for (const k of ['chatLanguage', 'readingLanguages', 'noteLanguage'])
    new PM.Setting(content).setName(t('study.f.' + k)).setDesc(t('study.d.' + k))
      .addText(x => { x.setPlaceholder(t('study.p.' + k)).setValue(p[k] || '').onChange(v => set({ [k]: v })); x.inputEl.dataset.study = k; });

  // Which job uses what (so it is clear nothing more than needed is handed over).
  const det = content.createEl('details', { cls: 'setting-note study-uses' });
  det.createEl('summary', { text: t('study.usesTitle') });
  for (const k of ['import', 'inbox', 'chat', 'quiz', 'summary', 'other']) det.createEl('p', { text: t('study.uses.' + k) });

  let saveBtn = null;
  const row = new PM.Setting(content).setName(t('study.save')).setDesc(t('study.where', { file: st.file || '' }))
    .addButton(b => { saveBtn = b; b.setButtonText(t('study.save')).setCta().onClick(async () => {
      b.setDisabled(true);
      try { await AI.saveStudySettings(p); dirty = false; state.setText(t('study.saved')); H.toast(t('study.saved')); if (diffs.length) show('study'); }
      catch (e) { state.setText(e.message); b.setDisabled(false); }
    }); b.buttonEl.dataset.studySave = '1'; });
  const state = row.descEl.createDiv({ cls: 'study-state muted', text: st.saved ? '' : t('study.unsaved') });
  saveBtn.setDisabled(st.saved && !diffs.length);
  void dirty;
}

// AI: which AI does each job, and optional API keys. Keys stay on this computer and go only to their provider.
function renderAI() {
  heading(t('settings.ai'));
  content.createEl('p', { cls: 'setting-note', text: t('ai.intro2') });

  // 1. Which AI does each job
  content.createEl('h3', { cls: 'settings-sub', text: t('ai.jobs') });
  for (const f of AI.FEATURES) {
    new PM.Setting(content).setName(t('ai.job.' + f)).setDesc(t('ai.job.' + f + 'Desc')).addDropdown(d => {
      for (const o of AI.options(f)) {
        d.addOption(o.value, o.label);
        if (!o.ready) d.selectEl.lastElementChild.disabled = true;
      }
      d.setValue(AI.choice(f)).onChange(v => AI.setChoice(f, v));
      enhanceAISelect(d.selectEl, f);
    });
  }
  const cc = content.createEl('p', { cls: 'setting-note' });
  cc.textContent = '…';
  AI.ccListening().then(on => { cc.textContent = on ? t('ai.ccOn') : t('ai.ccOffNote'); cc.classList.toggle('mod-warning', !on); });

  // 1b. Jobs on your files (find new course files, file captures): Claude Code, or Graphite's own agent with an
  // API model, which may read only the folders listed here and always asks before copying or writing.
  content.createEl('h3', { cls: 'settings-sub', text: t('agent.jobs') });
  content.createEl('p', { cls: 'setting-note', text: t('agent.jobsDesc') });
  for (const f of AI.AGENT_FEATURES) {
    new PM.Setting(content).setName(t('ai.job.' + f)).setDesc(t('ai.job.' + f + 'Desc')).addButton(b => { b.setButtonText(t('fj.run')).onClick(() => { closeSettings?.(); H.runCommand(f === 'import' ? 'find-course-files' : 'file-inbox'); }); b.buttonEl.dataset.fjRun = f; }).then(st => { if (f === 'import') st.addButton(b2 => { b2.setButtonText(t('fj.manualScan')).onClick(() => { closeSettings?.(); H.runCommand('find-course-files-manual'); }); b2.buttonEl.dataset.fjManual = '1'; }); }).addDropdown(d => {
      for (const o of AI.options(f)) {
        d.addOption(o.value, o.label);
        if (!o.ready) d.selectEl.lastElementChild.disabled = true;
      }
      d.setValue(AI.choice(f)).onChange(v => AI.setChoice(f, v));
      enhanceAISelect(d.selectEl, f);
    });
  }
  // The folders these jobs may read (and everything else about you) are in Study settings, shared by every AI.
  new PM.Setting(content).setName(t('study.title')).setDesc(t('study.usedBy'))
    .addButton(b => { b.setButtonText(t('study.open')).onClick(() => show('study')); b.buttonEl.dataset.openStudy = '1'; });

  // 1c. Local agent frameworks: found on this computer or not (and why), their version, an optional custom path.
  content.createEl('h3', { cls: 'settings-sub', text: t('fw.title') });
  content.createEl('p', { cls: 'setting-note', text: t('fw.desc') });
  const fwBox = content.createDiv({ cls: 'fw-list' });
  const drawFw = () => {
    fwBox.empty();
    const ccRow = new PM.Setting(fwBox).setName('Claude Code');
    ccRow.descEl.createSpan({ cls: 'fw-status', text: '…' });
    AI.ccListening().then(on => { const el = ccRow.descEl.querySelector('.fw-status'); if (el) { el.textContent = on ? t('fw.ccOn') : t('fw.ccOff'); el.classList.toggle('is-ok', on); el.classList.toggle('is-warn', !on); } });
    for (const [id, F] of Object.entries(AI.LOCAL)) {
      const st = AI.fwStatus(id), info = AI.frameworks()[id] || {};
      const row = new PM.Setting(fwBox).setName(F.label);
      row.settingEl.dataset.fw = id;
      row.descEl.createSpan({ cls: 'fw-status' + (st.ok ? ' is-ok' : st.ok === false ? ' is-bad' : ''), text: st.text });
      if (info.path) row.descEl.createDiv({ cls: 'fw-path', text: info.path });
      row.addText(tx => {
        tx.setPlaceholder(t('fw.pathPh')).setValue(AI.fwPath(id));
        tx.inputEl.dataset.fwPath = id; tx.inputEl.spellcheck = false;
        tx.inputEl.addEventListener('change', async () => { await AI.setFwPath(id, tx.getValue()); drawFw(); });
      });
    }
    new PM.Setting(fwBox).addButton(b => b.setButtonText(t('fw.recheck')).onClick(async () => { b.setDisabled(true); b.setButtonText(t('fw.checking')); await AI.refreshFrameworks(true); drawFw(); }));
  };
  drawFw();
  AI.refreshFrameworks().then(() => { if (fwBox.isConnected) drawFw(); });

  // 2. API keys, one box per provider (open when it has a key)
  content.createEl('h3', { cls: 'settings-sub', text: t('ai.keys') });
  content.createEl('p', { cls: 'setting-note', text: t('ai.keysDesc') });
  for (const [p, P] of Object.entries(AI.PROVIDERS)) renderProvider(p, P);
  content.createEl('p', { cls: 'setting-note', text: t('ai.privacy2') });
}

function renderProvider(p, P) {
  const has = () => (p === 'custom' ? !!AI.baseUrl() : !!AI.keyOf(p));
  const box = content.createEl('details', { cls: 'ai-provider' });
  box.open = has();
  const sum = box.createEl('summary');
  const name = sum.createSpan({ cls: 'ai-provider-name', text: P.label });
  const badge = sum.createSpan({ cls: 'ai-provider-badge' });
  const mark = () => { badge.textContent = has() ? t('ai.ready', { model: AI.modelOf(p) || '?' }) : t('ai.notSet'); badge.classList.toggle('on', has()); };
  mark();
  name.title = P.site || '';

  if (p === 'custom') {
    new PM.Setting(box).setName(t('ai.baseUrl')).setDesc(t('ai.customDesc'))
      .addText(tx => { tx.inputEl.spellcheck = false; tx.setPlaceholder('https://example.com/v1').setValue(AI.baseUrl()).onChange(v => { AI.setBaseUrl(v); mark(); picker?.refresh(); clearStatus?.(); }); });
  }
  const status = createEl('p', { cls: 'setting-note' });
  let picker = null;
  // The status line follows the same rule as the model list: only the newest check, for the key and address set
  // now, may write it (a late success or failure of an older check is ignored); changing them clears it.
  let checkSeq = 0;
  const context = () => AI.keyOf(p) + '|' + (p === 'custom' ? AI.baseUrl() : '');
  const clearStatus = () => { checkSeq++; status.textContent = ''; status.classList.remove('mod-error'); };
  const test = async () => {
    if (!has()) return;
    const me = ++checkSeq, ctx = context();
    const current = () => me === checkSeq && ctx === context();
    status.textContent = '…'; status.classList.remove('mod-error');
    try {
      const r = await AI.testProvider(p);
      if (!current() || r.stale) return; // the key or address changed meanwhile, or a newer check is running
      status.textContent = t('ai.testOk') + (r.models?.length ? ' ' + t('ai.modelsFound', { n: r.models.length }) : '') + (r.balance ? ' ' + t('ai.balance', { balance: r.balance }) : '');
      if (r.available === false) { status.textContent += ' ' + t('ai.noBalance'); status.classList.add('mod-error'); }
      picker?.refresh(); mark();
    } catch (e) { if (current()) { status.textContent = t('ai.failed', { msg: e.message }); status.classList.add('mod-error'); } }
  };
  const keyRow = new PM.Setting(box).setName(t('ai.key')).setDesc(P.site ? t('ai.keyDesc', { site: P.site }) : '')
    .addText(tx => {
      Object.assign(tx.inputEl, { type: 'password', autocomplete: 'off', spellcheck: false });
      tx.setPlaceholder(P.keyPh || t('ai.keyOptional')).setValue(AI.keyOf(p)).onChange(v => { AI.setKey(p, v); mark(); picker?.refresh(); clearStatus(); }); // another key: the old list and its status no longer show
      tx.inputEl.addEventListener('change', () => { if (tx.inputEl.value.trim()) test(); }); // check a newly pasted key right away
    })
    .addButton(b => b.setButtonText(t('ai.test')).onClick(test));
  keyRow.addButton(b => b.setButtonText(t('ai.remove')).onClick(() => { AI.setKey(p, ''); if (p === 'custom') AI.setBaseUrl(''); show('ai'); }));
  const modelRow = new PM.Setting(box).setName(t('ai.model')).setDesc(t('ai.modelDesc2'));
  picker = modelPicker(modelRow.controlEl, p, P, { onPick: mark });
  // Its name: "Model" and the model chosen now.
  const mbtn = picker.el.querySelector('.model-picker-btn');
  modelRow.nameEl.id ||= 'model-name-' + p; mbtn.id = 'model-btn-' + p; modelRow.descEl.id ||= 'model-desc-' + p;
  mbtn.setAttribute('aria-labelledby', modelRow.nameEl.id + ' ' + mbtn.id); mbtn.setAttribute('aria-describedby', modelRow.descEl.id);
  box.appendChild(status);
}

async function renderAppearance(token) {
  heading(t('settings.appearance'));
  const p = loadAppearance();
  const set = patch => { Object.assign(p, patch); saveAppearance(p); };

  new PM.Setting(content).setName(t('settings.theme')).setDesc(t('settings.themeDesc')).addDropdown(d => {
    d.addOption('dark', t('settings.dark')).addOption('light', t('settings.light'));
    d.setValue(document.documentElement.dataset.theme || 'dark').onChange(v => H.applyTheme(v));
  });

  const loading = content.createEl('p', { cls: 'muted browse-info', text: t('settings.fontsLoading') });
  const fonts = await listFonts();
  if (token !== renderToken) return;
  loading.remove();

  // A font picker: installed fonts (each shown in its own typeface), "Default", or any name typed in.
  const CUSTOM = '__custom__';
  const fontRow = (key, name, desc, list) => {
    const s = new PM.Setting(content).setName(name).setDesc(desc);
    const known = !p[key] || list.includes(p[key]);
    let input, warn;
    const check = v => { warn.setText(v && !isInstalled(v) ? t('settings.fontMissing') : ''); };
    s.addDropdown(d => {
      d.addOption('', t('settings.fontDefault'));
      for (const f of list) d.addOption(f, f);
      d.addOption(CUSTOM, t('settings.fontCustom'));
      for (const o of d.selectEl.options) if (o.value && o.value !== CUSTOM) o.style.fontFamily = `"${o.value}"`;
      d.setValue(known ? p[key] : CUSTOM);
      d.onChange(v => {
        if (v === CUSTOM) { input.inputEl.show(); input.inputEl.focus(); return; }
        input.inputEl.hide(); input.setValue(''); warn.setText('');
        set({ [key]: v });
      });
    });
    s.addText(tx => {
      input = tx;
      tx.setPlaceholder(t('settings.fontCustomPh')).setValue(known ? '' : p[key]).onChange(v => { set({ [key]: v.trim() }); check(v.trim()); });
      tx.inputEl.addClass('font-custom');
      if (known) tx.inputEl.hide();
    });
    warn = s.descEl.createDiv({ cls: 'font-missing' });
    if (!known) check(p[key]);
  };
  fontRow('textFont', t('settings.textFont'), t('settings.textFontDesc'), fonts.all);
  fontRow('codeFont', t('settings.codeFont'), t('settings.codeFontDesc'), fonts.mono.length ? fonts.mono : fonts.all);
  // Code font size: the project editor and source files only (note text keeps "Font size" below).
  const codeSizeRow = new PM.Setting(content).setName(t('settings.codeSize')).setDesc(t('settings.codeSizeDesc'));
  codeSizeRow.addText(tx => {
    Object.assign(tx.inputEl, { type: 'number', min: 10, max: 28, step: 1 });
    tx.inputEl.setAttribute('aria-label', t('settings.codeSize')); tx.inputEl.dataset.appearance = 'codeSize';
    tx.setValue(String(p.codeSize || DEFAULTS.codeSize));
    tx.inputEl.addEventListener('change', () => { const v = Math.min(28, Math.max(10, Math.round(Number(tx.inputEl.value) || DEFAULTS.codeSize))); tx.inputEl.value = String(v); set({ codeSize: v }); });
  });

  const size = new PM.Setting(content).setName(t('settings.fontSize'));
  const sizeDesc = () => size.setDesc(`${t('settings.fontSizeDesc')} (${p.fontSize}px)`);
  sizeDesc();
  size.addSlider(sl => sl.setLimits(12, 24, 1).setValue(p.fontSize).setDynamicTooltip().onChange(v => { set({ fontSize: v }); sizeDesc(); }));

  new PM.Setting(content).setName(t('settings.editorMono')).setDesc(t('settings.editorMonoDesc'))
    .addToggle(tg => tg.setValue(p.editorMono).onChange(v => set({ editorMono: v })));

  // Live preview: uses the same styles as notes, so changes show immediately.
  new PM.Setting(content).setName(t('settings.preview')).setHeading();
  const box = content.createDiv('appearance-preview markdown');
  H.renderInto(box, `${t('settings.previewText')} \`const answer = 42;\`\n\n\`\`\`js\nfunction greet(name) {\n  return "Hello, " + name; // 0O 1lI {}[] => !=\n}\n\`\`\``, '', 1);

  new PM.Setting(content).setName(t('settings.reset')).setDesc(t('settings.resetDesc'))
    .addButton(b => b.setButtonText(t('settings.reset')).onClick(() => { saveAppearance({ ...DEFAULTS }); show('appearance'); }));
}

async function renderSync(token) {
  heading(t('sync.title'));
  let info = null;
  try { info = await H.api('GET', 'sync-info'); } catch { /* shown as not synced */ }
  if (token !== renderToken) return;

  // Status: is the vault inside a cloud folder?
  // Three cases: inside a folder a cloud app on this PC is set up to sync ("configured": Graphite can't see
  // whether uploads finished, so it never says they did); only *named* like a cloud folder; or not synced.
  const kind = info?.provider ? 'configured' : info?.nameOnly ? 'nameOnly' : 'none';
  const status = content.createDiv('settings-callout' + (kind === 'configured' ? ' is-ok' : kind === 'nameOnly' ? ' is-warn' : ''));
  if (kind === 'configured') {
    status.createEl('h3', { text: t('sync.inProviderTitle', { provider: info.provider }) });
    status.createEl('p', { text: t('sync.inProvider', { provider: info.provider }) });
    status.createEl('p', { cls: 'setting-item-description', text: t('sync.uploadUnknown', { provider: info.provider }) });
  } else if (kind === 'nameOnly') {
    status.createEl('h3', { text: t('sync.nameOnlyTitle', { provider: info.nameOnly }) });
    status.createEl('p', { text: t('sync.nameOnly', { provider: info.nameOnly }) });
  } else {
    status.createEl('h3', { text: t('sync.notSyncedTitle') });
    status.createEl('p', { text: t('sync.notSynced') });
  }
  if (!info?.provider) for (const r of info?.available || []) status.createEl('p', { text: t('sync.moveHint', { provider: r.provider, path: r.root }) });
  new PM.Setting(content).setName(t('settings.vault')).setDesc(info?.vault || H.S.vault || '').then(s => {
    if (window.myobsidianDesktop) s.addButton(b => b.setButtonText(t('settings.switchVault')).onClick(() => window.myobsidianDesktop.chooseVault()));
    s.addButton(b => b.setButtonText(t('settings.reveal')).onClick(() => H.api('POST', 'reveal')));
  });

  // How to set it up, and phones.
  new PM.Setting(content).setName(t('sync.howTitle')).setHeading();
  const ol = content.createEl('ol', { cls: 'setting-steps' });
  for (const k of ['sync.step1', 'sync.step2', 'sync.step3']) ol.createEl('li', { text: t(k) });
  new PM.Setting(content).setName(t('sync.phoneTitle')).setDesc(t('sync.phoneDesc'));

  // Conflict copies.
  new PM.Setting(content).setName(t('sync.conflictsTitle')).setHeading();
  content.createEl('p', { cls: 'setting-note', text: t('sync.conflictsDesc') });
  const list = H.conflictFiles();
  if (!list.length) content.createEl('p', { cls: 'empty-hint', text: t('sync.noConflicts') });
  for (const p of list) {
    const name = p.split('/').pop().replace(/\.md$/i, '');
    new PM.Setting(content).setName(name).setDesc(p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '/')
      .addButton(b => b.setButtonText(t('menu.open')).onClick(() => { closeSettings(); H.openNote(p); }))
      .addExtraButton(b => b.setIcon('trash-2').setTooltip(t('menu.delete')).onClick(async () => { await H.deletePath(p); show('sync'); }));
  }
  content.createEl('p', { cls: 'setting-note', text: t('sync.tip') });
}

/* ---------- Claude Code: the skills and hooks that let a Claude Code window answer Graphie, file ✦ captures,
   import course files and keep the Claude Brain. They ship with Graphite; this page fills in your paths
   (~/.claude/graphite.json) and installs them. ---------- */
async function renderClaude(token) {
  heading(t('claude.title'));
  content.createEl('p', { cls: 'setting-note', text: t('claude.intro') });
  let st;
  try { st = await H.api('GET', 'claude-kit'); } catch (e) { content.createEl('p', { cls: 'mod-error', text: e.message }); return; }
  if (token !== renderToken) return;
  const installed = st.skills.length && st.skills.every(x => x.upToDate) && st.hooks.every(h => h.registered) && st.hasConfig;
  const box = content.createDiv('settings-callout');
  box.createEl('h3', { text: installed ? t('claude.ready') : st.hasConfig ? t('claude.outdated') : t('claude.notYet') });
  box.createEl('p', { cls: 'muted', text: t('claude.where', { dir: st.claudeDir }) });
  if (!st.claudeFound) box.createEl('p', { text: t('claude.noClaude') });

  new PM.Setting(content).setName(t('claude.vault')).setDesc(st.vault);
  // Folders, courses, languages and the rest come from Study settings (the same ones every AI uses); installing
  // writes them into Claude Code's own copy, which its skills read.
  new PM.Setting(content).setName(t('study.title')).setDesc(t('study.claudeUses'))
    .addButton(b => b.setButtonText(t('study.open')).onClick(() => show('study')));
  const c = {};

  const out = content.createDiv('setting-note');
  new PM.Setting(content).setName(t('claude.install')).setDesc(t('claude.installDesc')).addButton(b => b.setButtonText(t('claude.installBtn')).setCta().onClick(async () => {
    b.buttonEl.disabled = true; b.setButtonText(t('claude.installing'));
    try {
      const r = await H.api('POST', 'claude-kit', {}, c);
      out.setText(t('claude.done', { skills: r.skills.length, hooks: r.hooks.length }) + (r.hooksError ? ' ' + r.hooksError : ''));
      H.toast(t('claude.doneShort'));
      setTimeout(() => { if (current === 'claude') show('claude'); }, 1500);
    } catch (e) { out.setText(e.message); b.buttonEl.disabled = false; b.setButtonText(t('claude.installBtn')); }
  }));
  const det = content.createEl('details', { cls: 'setting-note' });
  det.createEl('summary', { text: t('claude.whatTitle') });
  for (const k of ['claude.what1', 'claude.what2', 'claude.what3', 'claude.what4']) det.createEl('p', { text: t(k) });
  det.createEl('p', { cls: 'muted', text: st.skills.map(x => `${x.name}: ${x.upToDate ? '✓' : x.installed ? t('claude.old') : '—'}`).join(' · ') + ' · ' + st.hooks.map(h => `${h.file}: ${h.registered ? '✓' : '—'}`).join(' · ') });
}

async function renderPlugins(token) {
  heading(t('settings.plugins'));
  let all = [];
  try { all = await PM.refreshInstalled(); } catch { /* listed below */ }
  if (token !== renderToken) return;
  const builtin = all.filter(p => p.builtin && p.manifest);
  if (builtin.length) {
    new PM.Setting(content).setName(t('plugins.builtin')).setDesc(t('plugins.builtinDesc')).setHeading();
    for (const p of builtin) {
      const m = p.manifest, id = m.id;
      const s = new PM.Setting(content).setName(PM.pluginName(m)).setDesc(PM.pluginDesc(m));
      s.nameEl.createSpan({ cls: 'plugin-version', text: ` v${m.version || '?'}` });
      const err = PM.getError(id);
      if (err) s.descEl.createDiv({ cls: 'mod-error', text: t('plugins.loadFailed', { name: PM.pluginName(m), msg: err }) });
      if (PM.isLoaded(id) && PM.getSettingTabs().some(r => r.plugin.manifest.id === id))
        s.addExtraButton(b => b.setIcon('settings').setTooltip(t('settings.title')).onClick(() => show('plugin:' + id)));
      s.addToggle(tg => tg.setValue(PM.isEnabled(id)).onChange(async v => { if (v) await PM.enablePlugin(id); else await PM.disablePlugin(id); show('plugins'); }));
    }
    new PM.Setting(content).setName(t('plugins.community')).setHeading();
  }
  if (!PM.pluginsOn()) {
    const box = content.createDiv('settings-callout');
    box.createEl('h3', { text: t('plugins.restrictedTitle') });
    box.createEl('p', { text: t('plugins.restrictedDesc') });
    box.createEl('p', { cls: 'muted', text: t('plugins.compat') });
    new PM.Setting(content).addButton(b => b.setButtonText(t('plugins.turnOn')).setCta().onClick(async () => { await PM.setPluginsOn(true); show('plugins'); }));
    return;
  }
  new PM.Setting(content).setName(t('plugins.restrictedOffTitle')).setDesc(t('plugins.restrictedDesc'))
    .addButton(b => b.setButtonText(t('plugins.turnOff')).onClick(async () => { await PM.setPluginsOn(false); show('plugins'); }));
  content.createEl('p', { cls: 'setting-note', text: t('plugins.compat') });
  new PM.Setting(content).setName(t('plugins.community')).setDesc(t('plugins.communityDesc'))
    .addButton(b => b.setButtonText(t('plugins.browse')).setCta().onClick(() => show('browse')));

  let list = [];
  try { list = await PM.refreshInstalled(); } catch (e) { content.createEl('p', { cls: 'mod-error', text: e.message }); return; }
  if (token !== renderToken) return;

  new PM.Setting(content).setName(t('plugins.installed')).setHeading()
    .addExtraButton(b => b.setIcon('folder-open').setTooltip(t('plugins.openFolder')).onClick(() => H.api('POST', 'reveal', { path: '.obsidian/plugins' })))
    .addExtraButton(b => b.setIcon('refresh-cw').setTooltip(t('plugins.reload')).onClick(async () => { await PM.reloadAll(); show('plugins'); }));

  if (!list.some(p => !p.builtin)) { content.createEl('p', { cls: 'empty-hint', text: t('plugins.none', { path: PM.getPluginDir() }) }); return; }

  for (const p of list) {
    if (p.builtin) continue;
    if (!p.manifest) { new PM.Setting(content).setName(p.dir).setDesc(p.error || ''); continue; }
    const m = p.manifest, id = m.id;
    const s = new PM.Setting(content).setName(m.name);
    s.nameEl.createSpan({ cls: 'plugin-version', text: ` v${m.version || '?'}` });
    s.descEl.empty();
    if (m.author) s.descEl.createDiv({ cls: 'plugin-author', text: t('plugins.by', { author: m.author }) });
    if (m.description) s.descEl.createDiv({ text: m.description });
    const err = PM.getError(id);
    if (err) s.descEl.createDiv({ cls: 'mod-error', text: t('plugins.loadFailed', { name: m.name, msg: err }) });
    if (PM.isLoaded(id) && PM.getSettingTabs().some(r => r.plugin.manifest.id === id))
      s.addExtraButton(b => b.setIcon('settings').setTooltip(t('settings.title')).onClick(() => show('plugin:' + id)));
    s.addExtraButton(b => b.setIcon('trash-2').setTooltip(t('plugins.uninstall')).onClick(async () => {
      if (!confirm(t('plugins.uninstallConfirm', { name: m.name }))) return;
      await PM.uninstallPlugin(id); show('plugins');
    }));
    s.addToggle(tg => tg.setValue(PM.isEnabled(id)).onChange(async v => {
      if (v) await PM.enablePlugin(id); else await PM.disablePlugin(id);
      show('plugins');
    }));
  }
}

async function renderBrowse(token) {
  const top = content.createDiv('browse-top');
  const back = top.createEl('button', { cls: 'mod-button', text: '← ' + t('plugins.back') });
  back.onclick = () => show('plugins');
  top.createEl('h2', { cls: 'settings-h', text: t('plugins.community') });
  const input = content.createEl('input', { cls: 'setting-input browse-search', type: 'search', placeholder: t('plugins.searchPh') });
  const info = content.createDiv({ cls: 'muted browse-info', text: t('plugins.loadingList') });
  const listEl = content.createDiv('browse-list');
  try { community = community || await PM.fetchCommunity(); }
  catch (e) { info.setText(t('plugins.listFailed', { msg: e.message })); return; }
  if (token !== renderToken) return;
  const installedIds = () => new Set(PM.getInstalled().map(p => p.manifest?.id).filter(Boolean));

  const draw = () => {
    const q = input.value.trim().toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    let rows = community.filter(p => terms.every(w => `${p.name} ${p.author} ${p.description} ${p.id}`.toLowerCase().includes(w)));
    if (q) rows.sort((a, b) => (b.name.toLowerCase().includes(q) - a.name.toLowerCase().includes(q)));
    info.setText(t('plugins.count', { shown: Math.min(rows.length, 100), n: rows.length }));
    listEl.empty();
    const have = installedIds();
    for (const p of rows.slice(0, 100)) {
      const row = listEl.createDiv('browse-item');
      const head = row.createDiv('browse-head');
      head.createEl('b', { text: p.name });
      head.createSpan({ cls: 'muted', text: ' · ' + t('plugins.by', { author: p.author }) });
      row.createDiv({ cls: 'browse-desc', text: p.description });
      const foot = row.createDiv('browse-foot');
      const link = foot.createEl('a', { text: p.repo, href: `https://github.com/${p.repo}` });
      link.target = '_blank'; link.rel = 'noopener';
      const btn = foot.createEl('button', { cls: 'mod-button' + (have.has(p.id) ? '' : ' mod-cta'), text: have.has(p.id) ? t('plugins.installedLabel') : t('plugins.install') });
      btn.disabled = have.has(p.id);
      btn.onclick = async () => {
        btn.disabled = true; btn.setText(t('plugins.installing'));
        try {
          await PM.installPlugin(p.repo);
          btn.setText(t('plugins.installedLabel')); btn.removeClass('mod-cta');
          new PM.Notice(t('plugins.installedToast', { name: p.name }));
        } catch (e) {
          btn.disabled = false; btn.setText(t('plugins.install'));
          new PM.Notice(t('plugins.installFailed', { msg: e.message }), 8000);
        }
      };
    }
  };
  input.addEventListener('input', draw);
  draw();
  input.focus();
}
