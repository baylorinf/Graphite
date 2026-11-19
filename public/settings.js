// Settings window: General options, Community plugins (install / enable / browse) and plugin setting tabs.
import { t, LANGS, getLang } from '/i18n.js';
import * as PM from '/plugins.js';
import { DEFAULTS, loadAppearance, saveAppearance, listFonts, isInstalled } from '/appearance.js';
import { reviewSettings, setReviewSettings } from '/review.js';
import * as AI from '/ai.js';
import { enhanceAISelect } from '/aipicker.js';

let H = null;
let root = null, nav = null, content = null;
let current = 'general';
let activeTab = null;      // plugin setting tab currently shown
let renderToken = 0;
let community = null;      // cached community plugin list

export function initSettings(host) { H = host; }

const onKey = e => { if (e.key === 'Escape' && !document.querySelector('.plugin-modal')) { e.preventDefault(); e.stopPropagation(); closeSettings(); } };

export function openSettings(tab) {
  if (!root) build();
  root.classList.remove('hidden');
  document.addEventListener('keydown', onKey, true);
  show(tab ? (tab.startsWith('plugin:') || ['general', 'appearance', 'review', 'ai', 'sync', 'plugins'].includes(tab) ? tab : 'plugin:' + tab) : current);
}
export function closeSettings() {
  if (!root || root.classList.contains('hidden')) return;
  hideActiveTab();
  root.classList.add('hidden');
  document.removeEventListener('keydown', onKey, true);
}
export const settingsOpen = () => root && !root.classList.contains('hidden');
// Re-render (e.g. after a language change).
export function refreshSettings() { if (settingsOpen()) show(current); }

function build() {
  root = document.body.appendChild(createDiv('settings-modal hidden'));
  root.createDiv('settings-bg').addEventListener('mousedown', closeSettings);
  const box = root.createDiv('settings-box');
  nav = box.createDiv('settings-nav scroll');
  content = box.createDiv('settings-content scroll');
  const close = box.createEl('button', { cls: 'settings-close', text: '×' });
  close.addEventListener('click', closeSettings);
}

function hideActiveTab() { if (activeTab) { try { activeTab.hide(); } catch (e) { console.error(e); } activeTab = null; } }

function drawNav() {
  nav.empty();
  const item = (id, label) => { const el = nav.createDiv({ cls: 'settings-nav-item' + (id === current ? ' active' : ''), text: label }); el.onclick = () => show(id); };
  nav.createDiv({ cls: 'settings-nav-heading', text: t('settings.options') });
  item('general', t('settings.general'));
  item('appearance', t('settings.appearance'));
  item('review', t('settings.review'));
  item('ai', t('settings.ai'));
  item('sync', t('settings.sync'));
  item('plugins', t('settings.plugins'));
  const tabs = PM.getSettingTabs();
  if (tabs.length) {
    nav.createDiv({ cls: 'settings-nav-heading', text: t('settings.pluginOptions') });
    for (const r of tabs) item('plugin:' + r.plugin.manifest.id, r.plugin.manifest.name);
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
  if (id === 'ai') return renderAI();
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
    new PM.Setting(content).setName(t('settings.updates'))
      .setDesc(u?.available ? t('update.tooltip', { version: u.available }) : t('update.upToDate', { version: H.S.version || '' }))
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
      .addText(tx => { tx.inputEl.spellcheck = false; tx.setPlaceholder('https://example.com/v1').setValue(AI.baseUrl()).onChange(v => { AI.setBaseUrl(v); mark(); }); });
  }
  const status = createEl('p', { cls: 'setting-note' });
  let modelInput = null;
  const dl = createEl('datalist', { attr: { id: 'ai-models-' + p } });
  const fillList = () => { dl.empty(); for (const m of [...new Set([...AI.listOf(p), ...P.suggest])]) dl.createEl('option', { attr: { value: m } }); };
  fillList();
  const test = async () => {
    if (!has()) return;
    status.textContent = '…'; status.classList.remove('mod-error');
    try {
      const r = await AI.testProvider(p);
      status.textContent = t('ai.testOk') + (r.models?.length ? ' ' + t('ai.modelsFound', { n: r.models.length }) : '') + (r.balance ? ' ' + t('ai.balance', { balance: r.balance }) : '');
      if (r.available === false) { status.textContent += ' ' + t('ai.noBalance'); status.classList.add('mod-error'); }
      if (modelInput) modelInput.value = AI.modelOf(p);
      fillList(); mark();
    } catch (e) { status.textContent = t('ai.failed', { msg: e.message }); status.classList.add('mod-error'); }
  };
  const keyRow = new PM.Setting(box).setName(t('ai.key')).setDesc(P.site ? t('ai.keyDesc', { site: P.site }) : '')
    .addText(tx => {
      Object.assign(tx.inputEl, { type: 'password', autocomplete: 'off', spellcheck: false });
      tx.setPlaceholder(P.keyPh || t('ai.keyOptional')).setValue(AI.keyOf(p)).onChange(v => { AI.setKey(p, v); mark(); });
      tx.inputEl.addEventListener('change', () => { if (tx.inputEl.value.trim()) test(); }); // check a newly pasted key right away
    })
    .addButton(b => b.setButtonText(t('ai.test')).onClick(test));
  keyRow.addButton(b => b.setButtonText(t('ai.remove')).onClick(() => { AI.setKey(p, ''); if (p === 'custom') AI.setBaseUrl(''); show('ai'); }));
  new PM.Setting(box).setName(t('ai.model')).setDesc(t('ai.modelDesc2'))
    .addText(tx => {
      modelInput = tx.inputEl;
      tx.inputEl.spellcheck = false;
      tx.inputEl.setAttribute('list', dl.id);
      tx.setPlaceholder(t('ai.modelPh')).setValue(AI.modelOf(p)).onChange(v => { AI.setModel(p, v); mark(); });
    });
  box.appendChild(dl);
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

async function renderPlugins(token) {
  heading(t('settings.plugins'));
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

  if (!list.length) { content.createEl('p', { cls: 'empty-hint', text: t('plugins.none', { path: PM.getPluginDir() }) }); return; }

  for (const p of list) {
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
