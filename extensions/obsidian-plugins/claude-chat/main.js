'use strict';
// Text in the app's language (Graphite translates these; English when it can't).
const T = (s, v = {}) => (window.graphiteT ? window.graphiteT(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)));
// Claude Chat: a chat box in the right sidebar ("Claude" tab). The menu in its header picks who answers:
// - Claude Code (default): the Claude Code window you keep open. No API key and no network: each message is
//   appended to chat/outbox.jsonl; Claude (running the obsidian-chat skill, which watches that file) writes its
//   answer to chat/replies/<id>.md, which this panel shows. chat/status.json is Claude's heartbeat ("listening").
// - An API model (Settings → AI: Anthropic, OpenAI, Gemini, DeepSeek, Qwen, Kimi, GLM or a custom URL): the
//   panel asks it through Graphite (window.myobsidianAI) and writes the answer to the same replies folder.
//   Those messages carry "via", so the Claude Code watcher leaves them alone.
const { Plugin, Notice, Modal, MarkdownView, MarkdownRenderer, moment } = require('obsidian');

const LISTEN_FRESH_MS = 15000;
const CC = 'claude-code';
const AIAPI = () => window.myobsidianAI || null;
const CONNECT_PHRASE = 'connect to Graphite';

const svg = (body, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const ICON = {
  chev: svg('<path d="m6 9 6 6 6-6"/>'),
  check: svg('<path d="M20 6 9 17l-5-5"/>'),
  spark: svg('<path d="M12 2.5l1.8 5.4 5.4 1.8-5.4 1.8L12 16.9l-1.8-5.4-5.4-1.8 5.4-1.8z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>', true),
  send: svg('<path d="M5 12h13M13 6l6 6-6 6"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  save: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  note: svg('<path d="M4 20h16M4 4h10l6 6v6"/><path d="M14 4v6h6"/>'),
  file: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>'),
  quote: svg('<path d="M7 7h4v4H8a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5zM14 7h4v4h-3a3 3 0 0 0 3 3v2a5 5 0 0 1-5-5z"/>'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  findFiles: svg('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3"/><path d="M3 7v10a2 2 0 0 0 2 2h6"/><circle cx="17" cy="17" r="3"/><path d="M21 21l-1.8-1.8"/>'),
  connect: svg('<circle cx="6" cy="6" r="2.5"/><circle cx="18" cy="8" r="2.5"/><circle cx="9" cy="18" r="2.5"/><path d="M8.3 7l7.4.8M7 8.4l1.4 7.2M16.6 10l-5.8 6.3"/>'),
};

// "Link these notes?": each proposed note as "this note → that note" with a tick box, why it was proposed, and
// which ones can't be linked (a read-only folder). Nothing is written until "Link selected"; one request writes
// the links both ways; a failure keeps the window and your ticks with Retry. Closing or Cancel writes nothing.
class ConnectModal extends Modal {
  constructor(plugin, file, picked, sourceLock, via) { super(plugin.app); Object.assign(this, { plugin, file, picked, sourceLock, via }); }
  onOpen() {
    const { contentEl, file } = this;
    this.modalEl.addClass('cc-connect-modal');
    this.setTitle(T('Link “{note}” to these notes?', { note: file.basename }));
    contentEl.createEl('p', { cls: 'cc-connect-intro', text: T('Proposed by {model}. Tick the links you want; each is added both ways. Nothing changes until you confirm.', { model: this.plugin.engineLabel(this.via) }) });
    if (this.sourceLock) contentEl.createEl('p', { cls: 'cc-connect-locked', attr: { role: 'alert' }, text: T('“{note}” is in “{folder}”, a read-only folder in Study settings, so no links can be added to it.', { note: file.basename, folder: this.sourceLock }) });
    const list = contentEl.createDiv({ cls: 'cc-connect-list', attr: { role: 'group' } });
    this.picked.forEach((p, i) => {
      const locked = this.sourceLock || p.lock;
      const row = list.createEl('label', { cls: 'cc-connect-row' + (locked ? ' is-locked' : '') });
      const box = row.createEl('input', { attr: { type: 'checkbox', 'data-i': String(i) } });
      box.checked = !locked; box.disabled = !!locked;
      const main = row.createDiv({ cls: 'cc-connect-main' });
      main.createDiv({ cls: 'cc-connect-pair', text: `${file.basename} → ${p.f.basename}` });
      main.createDiv({ cls: 'cc-connect-path', text: p.f.path });
      if (p.why) main.createDiv({ cls: 'cc-connect-why', text: p.why });
      if (p.lock && !this.sourceLock) main.createDiv({ cls: 'cc-connect-lock', text: T('Read-only folder “{folder}”: not linked.', { folder: p.lock }) });
    });
    this.errEl = contentEl.createDiv({ cls: 'cc-connect-error', attr: { role: 'alert' } });
    this.errEl.hide?.(); this.errEl.style.display = 'none';
    const row = contentEl.createDiv({ cls: 'cc-connect-buttons' });
    this.okBtn = row.createEl('button', { cls: 'mod-cta', attr: { type: 'button', 'data-connect': 'confirm' }, text: T('Link selected') });
    this.cancelBtn = row.createEl('button', { attr: { type: 'button', 'data-connect': 'cancel' }, text: T('Cancel') });
    this.okBtn.onclick = () => this.confirm();
    this.cancelBtn.onclick = () => this.close();
    this.okBtn.disabled = !!this.sourceLock || this.picked.every(p => p.lock);
  }
  targets() { return [...this.contentEl.querySelectorAll('input[data-i]:checked:not(:disabled)')].map(b => this.picked[+b.dataset.i].f.path); }
  async confirm() {
    if (this.busy) return;
    const targets = this.targets();
    if (!targets.length) { new Notice(T('Tick at least one note to link.')); return; }
    this.busy = true;
    this.okBtn.disabled = this.cancelBtn.disabled = true; this.okBtn.setText(T('Linking…'));
    for (const b of this.contentEl.querySelectorAll('input[data-i]')) b.disabled = true;
    let result;
    try {
      const res = await fetch('/api/note-links', { method: 'POST', headers: { 'X-Vault': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ source: this.file.path, targets }) });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw Object.assign(new Error(d.error || res.statusText || T('the notes could not be written')), { paths: d.paths });
      result = d;
    } catch (e) {
      // Your ticks stay; say what went wrong (and which notes) and offer Retry.
      this.busy = false;
      this.errEl.style.display = '';
      this.errEl.setText(T('Not linked: {msg}', { msg: e.message }) + (Array.isArray(e.paths) && e.paths.length ? ' (' + e.paths.join(', ') + ')' : ''));
      this.okBtn.setText(T('Retry')); this.okBtn.disabled = this.cancelBtn.disabled = false;
      this.contentEl.querySelectorAll('input[data-i]').forEach(b => { b.disabled = !!(this.sourceLock || this.picked[+b.dataset.i].lock); });
      return;
    }
    this.busy = false;
    this.close();
    await this.plugin.linked(this.file, result, this.picked, this.via);
  }
  close() { if (this.busy) return; super.close(); }
  onClose() { this.contentEl.empty(); if (this.plugin.connectWin === this) this.plugin.endConnect(); }
}

module.exports = class ClaudeChatPlugin extends Plugin {
  async onload() {
    this.dir = this.manifest.dir + '/chat';
    this.msgs = [];        // [{id, text, note, selection, study, at, reply?}]
    this.listening = false;
    this.seen = new Set();
    this.useNote = true;
    this.useSel = true;

    this.addRibbonIcon('message-circle', T('Chat with Graphie'), () => this.show());
    this.addCommand({ id: 'open', name: T('Open the Graphie chat'), callback: () => this.show() });
    this.addCommand({ id: 'new', name: T('Start a new Graphie chat'), callback: () => this.newChat() });
    this.addCommand({ id: 'find-files', name: T('Find new course files on this computer'), callback: () => this.findFiles() });
    this.addCommand({ id: 'file-inbox', name: T('File my captures into my notes'), callback: () => this.fileInbox() });
    this.addCommand({ id: 'update-brain', name: T('Update my study record from this chat'), callback: () => this.updateBrain() });

    this.app.workspace.onLayoutReady(async () => {
      await this.ensureDirs();
      this.build();
      await this.loadChat();
      this.poll();
    });
    this.registerEvent(this.app.workspace.on('file-open', () => this.renderChips()));
    this.registerDomEvent(document, 'selectionchange', () => setTimeout(() => this.refreshContext(), 50));
    this.registerInterval(window.setInterval(() => this.refreshContext(), 700));
    this.register(() => { window.clearTimeout(this.timer); this.tabBtn?.remove(); this.pane?.remove(); this.findBtn?.remove(); this.connectBtn?.remove(); });
  }

  engine() { return AIAPI()?.choice('chat') || CC; }
  engineLabel(v = this.engine()) { const p = this.engineParts(v); return p.model ? `${p.name} ${p.model}` : p.name; }
  engineParts(v = this.engine()) { return AIAPI()?.parts?.(v) || { name: v === CC ? 'Claude Code' : v, model: '' }; }

  /* ---------- files ---------- */

  async ensureDirs() {
    const a = this.app.vault.adapter;
    for (const d of [this.dir, this.dir + '/replies']) { try { if (!(await a.exists(d))) await a.mkdir(d); } catch { /* exists */ } }
  }

  async readOutbox() {
    let raw = '';
    try { raw = await this.app.vault.adapter.read(this.dir + '/outbox.jsonl'); } catch { return []; }
    let out = [];
    for (const l of raw.split(/\r?\n/)) {
      if (!l.trim()) continue;
      let m; try { m = JSON.parse(l); } catch { continue; }
      if (m.type === 'new') out = [];
      else if (m.type === 'user') out.push(m);
    }
    return out;
  }

  async appendOutbox(obj) {
    const a = this.app.vault.adapter, p = this.dir + '/outbox.jsonl';
    let cur = ''; try { cur = await a.read(p); } catch { /* first message */ }
    await a.write(p, cur + JSON.stringify(obj) + '\n');
  }

  async readReply(id) {
    try { return await this.app.vault.adapter.read(`${this.dir}/replies/${id}.md`); } catch { return null; }
  }

  // The chat history: read completely (messages and their answers) before it is shown, then merged with what
  // happened meanwhile. A request sent, or an answer that arrived, while the history was still loading stays; a
  // past answer that is still being read never makes a finished job look unfinished. Buttons that must not start
  // a job twice wait for this (whenLoaded).
  loadChat() {
    const seq = this.loadSeq = (this.loadSeq || 0) + 1;
    const run = (async () => {
      const list = await this.readOutbox();
      for (const m of list) {
        if (this.running?.has(m.id)) continue;
        m.reply = await this.readReply(m.id);
        // An agent job runs in this window only: one left without an answer was stopped by a reload.
        if (m.reply == null && m.agent) m.reply = '_' + T('Stopped before it finished. Nothing more was copied or written; start it again.') + '_';
      }
      if (seq !== this.loadSeq) return;
      if (this.cleared > (this.loadStarted || 0)) return; // "New chat" while loading: the old history stays cleared
      const live = new Map(this.msgs.map(x => [x.id, x]));
      const merged = list.map(m => {
        const cur = this.running?.get(m.id) || live.get(m.id);
        return cur && (this.running?.has(m.id) || cur.reply != null) ? cur : m;
      });
      const ids = new Set(merged.map(m => m.id));
      for (const x of this.msgs) if (!ids.has(x.id)) merged.push(x); // sent while loading
      this.msgs = merged;
      this.renderAll();
    })();
    this.loadStarted = Date.now();
    this.loading = run.finally(() => { if (this.loadSeq === seq) this.loading = null; });
    return this.loading;
  }
  whenLoaded() { return this.loading ? this.loading.catch(() => {}) : Promise.resolve(); }

  /* ---------- polling ---------- */

  async poll() {
    try {
      let st = null;
      try { st = JSON.parse(await this.app.vault.adapter.read(this.dir + '/status.json')); } catch { /* not started yet */ }
      const on = !!(st && st.listening && Date.now() - st.at < LISTEN_FRESH_MS);
      this.seen = new Set((st && st.seen) || []);
      if (on !== this.listening) { this.listening = on; this.renderStatus(); }
      let changed = false;
      for (const m of this.msgs) {
        if (m.reply != null) continue;
        const r = await this.readReply(m.id);
        if (r != null) { m.reply = r; changed = true; }
      }
      if (changed) { this.renderAll(); if (this.pane.hidden) this.tabBtn.addClass('has-new'); }
      else this.renderPending();
    } catch (e) { console.warn('[claude-chat]', e); }
    const waiting = this.msgs.some(m => m.reply == null);
    this.timer = window.setTimeout(() => this.poll(), waiting || !this.pane?.hidden ? 1200 : 4000);
  }

  /* ---------- UI ---------- */

  build() {
    const right = document.getElementById('right');
    const tabs = right?.querySelector('.side-tabs');
    if (!right || !tabs) return;

    this.tabBtn = tabs.createEl('button', { cls: 'cc-chat-tab', attr: { title: T('Chat with Graphie') } });
    this.tabBtn.innerHTML = ICON.spark;
    this.tabBtn.onclick = () => this.show();
    // The app's own tabs (links, outline) hide the chat.
    for (const b of tabs.querySelectorAll('[data-rtab]')) b.addEventListener('click', () => this.hide());

    const pane = this.pane = right.createDiv({ cls: 'pane cc-chat' });
    pane.hidden = true;

    // "Find new course files" above the file list: asks Claude to look through the course folders (and recent
    // downloads) and add anything missing. Progress and the summary show in this chat.
    const fileBar = document.querySelector('#lpane-files .pane-toolbar');
    if (fileBar) {
      this.findBtn = fileBar.createEl('button', { cls: 'cc-find-files', attr: { type: 'button', title: T('Find new course files on this computer and add them') } });
      this.findBtn.innerHTML = ICON.findFiles;
      this.findBtn.onclick = () => this.findFiles();
    }

    // "Connect this note" in the note's top bar (next to Proofread and Quiz): Claude finds the notes it really
    // relates to, adds 相关 Related links both ways and tidies the note's format. The summary shows in this chat.
    const topbar = document.getElementById('topbar');
    const anchor = document.getElementById('mode-switch');
    if (topbar && anchor) {
      this.connectBtn = createEl('button', { cls: 'cc-connect-note', attr: { type: 'button', title: T('Connect this note: Graphie links it to the related notes that really matter, both ways') } });
      this.connectBtn.innerHTML = ICON.connect;
      this.connectBtn.onclick = () => this.connectNote();
      topbar.insertBefore(this.connectBtn, anchor);
    }

    // Header: a pill saying who answers ("● DeepSeek Flash ⌄"; dot = ready/listening) with a menu to switch,
    // and save / new chat on the right.
    const head = pane.createDiv({ cls: 'cc-head' });
    const brand = head.createDiv({ cls: 'cc-title' });
    brand.createSpan({ cls: 'cc-logo' }).innerHTML = ICON.spark;
    // The feature is Graphite's; the AI doing the work is shown next to it ("Run by"), and changes with the choice.
    brand.createSpan({ cls: 'cc-brand-name', text: T('Graphite study assistant') });
    brand.title = 'Graphie';
    head.createSpan({ cls: 'cc-model-by', text: T('Run by') });
    this.titleEl = head.createEl('button', { cls: 'cc-model', attr: { type: 'button', 'aria-haspopup': 'menu' } });
    this.titleEl.onclick = e => { e.stopPropagation(); this.toggleModelMenu(); };
    this.renderModelPill();
    const off = AIAPI()?.onChange(() => { this.renderModelPill(); this.renderStatus(); });
    if (off) this.register(off);
    this.registerDomEvent(document, 'mousedown', e => { if (this.menuEl && !this.menuEl.contains(e.target) && !this.titleEl.contains(e.target)) this.closeModelMenu(); });
    this.registerDomEvent(document, 'keydown', e => { if (e.key === 'Escape' && this.menuEl) this.closeModelMenu(); });
    head.createDiv({ cls: 'cc-grow' });
    const tools = head.createDiv({ cls: 'cc-tools' });
    const hb = (icon, t, fn) => { const b = tools.createEl('button', { cls: 'cc-hbtn', attr: { title: t, type: 'button' } }); b.innerHTML = icon; b.onclick = fn; };
    hb(ICON.save, T('Save this chat as a note'), () => this.saveChat());
    hb(ICON.plus, T('New chat'), () => this.newChat());

    this.list = pane.createDiv({ cls: 'cc-list' });

    const comp = pane.createDiv({ cls: 'cc-composer' });
    this.chipsEl = comp.createDiv({ cls: 'cc-chips' });
    const box = comp.createDiv({ cls: 'cc-box' });
    this.input = box.createEl('textarea', { cls: 'cc-input', attr: { rows: '1', placeholder: T('Ask Graphie about your notes…'), spellcheck: 'false' } });
    this.sendBtn = box.createEl('button', { cls: 'cc-send', attr: { title: T('Send (Enter)'), type: 'button' } });
    this.sendBtn.innerHTML = ICON.send;
    this.sendBtn.onclick = () => this.send();
    this.input.addEventListener('input', () => this.autosize());
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); this.send(); }
    });
    comp.createDiv({ cls: 'cc-hint', text: T('Enter to send · Shift+Enter for a new line') });

    this.renderStatus();
    this.renderChips();
  }

  // The pill: status dot, provider name, model in grey, chevron.
  renderModelPill() {
    const el = this.titleEl;
    if (!el) return;
    const { name, model } = this.engineParts();
    el.empty();
    this.statusEl = el.createSpan({ cls: 'cc-status' });
    el.createSpan({ cls: 'cc-model-name', text: name });
    if (model) el.createSpan({ cls: 'cc-model-sub', text: model });
    el.createSpan({ cls: 'cc-model-chev' }).innerHTML = ICON.chev;
    el.dataset.executor = this.engine();
    el.setAttribute('aria-label', T('Run by {name}. Click to choose who answers.', { name: this.engineLabel() }));
    this.renderStatus?.();
  }

  // The menu: Claude Code first, then each API provider (greyed out until it has a key), then AI settings.
  toggleModelMenu() { this.menuEl ? this.closeModelMenu() : this.openModelMenu(); }
  closeModelMenu() { this.menuEl?.remove(); this.menuEl = null; this.titleEl?.removeClass('is-open'); }
  openModelMenu() {
    const ai = AIAPI();
    const opts = ai ? ai.options('chat') : [{ value: CC, label: 'Claude Code', ready: true }];
    const cur = this.engine();
    const m = this.menuEl = this.titleEl.parentElement.createDiv({ cls: 'cc-model-menu', attr: { role: 'menu' } });
    m.style.left = this.titleEl.offsetLeft + 'px';
    this.titleEl.addClass('is-open');
    m.createDiv({ cls: 'cc-mm-head', text: T('Who answers') });
    for (const o of opts) {
      const { name, model } = this.engineParts(o.value);
      const b = m.createEl('button', { cls: 'cc-mm-item' + (o.value === cur ? ' is-current' : '') + (o.ready ? '' : ' is-off'), attr: { type: 'button', role: 'menuitem' } });
      const txt = b.createDiv({ cls: 'cc-mm-text' });
      txt.createDiv({ cls: 'cc-mm-name', text: name });
      txt.createDiv({ cls: 'cc-mm-sub', text: o.value === CC ? T('This computer · no key · while connected') : o.ready ? model : T('Add a key in Settings → AI') });
      const mark = b.createSpan({ cls: 'cc-mm-mark' });
      if (o.value === cur) mark.innerHTML = ICON.check;
      b.onclick = () => {
        this.closeModelMenu();
        if (o.ready) ai?.setChoice('chat', o.value); else ai?.openSettings?.();
      };
    }
    const set = m.createEl('button', { cls: 'cc-mm-item cc-mm-settings', attr: { type: 'button' } });
    set.createDiv({ cls: 'cc-mm-name', text: T('AI settings…') });
    set.onclick = () => { this.closeModelMenu(); ai?.openSettings?.(); };
    // Keep the menu inside the panel: under the pill, shifted left if the sidebar is narrow.
    const head = this.titleEl.parentElement;
    m.style.left = Math.max(8, Math.min(this.titleEl.offsetLeft, head.clientWidth - m.offsetWidth - 8)) + 'px';
  }

  show() {
    if (!this.pane) return;
    const app = document.getElementById('app');
    if (app?.classList.contains('right-collapsed')) document.querySelector('[data-cmd="toggle-right"]')?.click();
    const right = document.getElementById('right');
    right.querySelectorAll('[data-rtab]').forEach(b => b.classList.remove('active'));
    right.querySelectorAll(':scope > .pane:not(.cc-chat)').forEach(p => p.classList.add('hidden'));
    this.tabBtn.addClass('active'); this.tabBtn.removeClass('has-new');
    this.pane.hidden = false;
    this.renderChips();
    this.scrollDown();
    setTimeout(() => this.input.focus(), 0);
  }

  hide() {
    if (!this.pane || this.pane.hidden) return;
    this.pane.hidden = true;
    this.tabBtn.removeClass('active');
  }

  autosize() {
    this.input.style.height = 'auto';
    this.input.style.height = Math.min(this.input.scrollHeight, 180) + 'px';
  }

  // What you're reading right now: the 🎓 study tab in front (with the lecture or section you're on),
  // otherwise the open note. A selection only counts if it was made in that reading material, after you
  // switched to it.
  context() {
    const qz = this.app.plugins?.getPlugin?.('claude-quizzes');
    const tab = qz?.active ? qz.tabs.find(t => t.page.id === qz.active) : null;
    const file = tab ? null : this.app.workspace.getActiveFile();
    let study = '';
    if (tab) {
      const pos = qz.data?.pos?.[tab.page.id];
      study = tab.page.short + (pos?.label ? ' › ' + pos.label : '');
    }
    const key = tab ? 'study:' + tab.page.id : 'note:' + (file?.path || '');
    if (key !== this.ctxKey) {
      // Reading something else now: an older selection no longer belongs to it.
      this.ctxAt = this.ctxKey === undefined ? 0 : Date.now();
      this.ctxKey = key;
    }
    let selection = '';
    const ed = document.getElementById('editor');
    const cap = this.app.plugins?.getPlugin?.('claude-capture');
    if (!tab && ed && ed.selectionEnd > ed.selectionStart) selection = ed.value.slice(ed.selectionStart, ed.selectionEnd).trim();
    else if (cap?.lastSel?.text && cap.lastSel.at > this.ctxAt && Date.now() - cap.lastSel.at < 30 * 60000
      && (tab ? !!cap.lastSel.source : !cap.lastSel.source && (!cap.lastSel.path || cap.lastSel.path === file?.path))) selection = cap.lastSel.text;
    // Text picked in a PDF or other file through Graphite's own selection bar ("Ask Graphie"), when Claude Capture
    // isn't installed: Graphite hands it over directly, with the file and page.
    else if (this.extSel?.text && this.extSel.at > this.ctxAt && Date.now() - this.extSel.at < 30 * 60000 && (!this.extSel.path || this.extSel.path === file?.path)) selection = this.extSel.text;
    return { file, selection, study, key };
  }

  // Re-check what you're reading while the chat is visible, so the chips follow you between notes and tabs.
  refreshContext() {
    if (!this.pane || this.pane.hidden) return;
    const c = this.context();
    const sig = [c.key, c.study, c.selection].join('\u0000');
    if (sig !== this.ctxSig) { this.ctxSig = sig; this.renderChips(c); }
  }

  // Context chips: the open note (or study section) and the current selection go along with the message.
  renderChips(ctx) {
    if (!this.chipsEl) return;
    const { file, selection, study } = ctx || this.context();
    if (selection !== this.lastChipSel) { this.useSel = true; this.lastChipSel = selection; }
    this.chipsEl.empty();
    const chip = (icon, text, on, toggle, title) => {
      const c = this.chipsEl.createEl('button', { cls: 'cc-chip' + (on ? '' : ' is-off'), attr: { type: 'button', title } });
      c.innerHTML = icon; c.createSpan({ text });
      const x = c.createSpan({ cls: 'cc-chip-x' }); x.innerHTML = on ? ICON.x : ICON.plus;
      c.onclick = () => { toggle(); this.renderChips(); };
    };
    if (study) chip(ICON.spark, study, this.useNote, () => { this.useNote = !this.useNote; }, T('The study tab in front goes with your message'));
    else if (file) chip(ICON.file, file.basename, this.useNote, () => { this.useNote = !this.useNote; }, T('The open note goes with your message, so Graphie can read it'));
    if (selection) chip(ICON.quote, selection.replace(/\s+/g, ' ').slice(0, 40) + (selection.length > 40 ? '…' : ''), this.useSel, () => { this.useSel = !this.useSel; }, T('Your selection goes with your message'));
  }

  renderStatus() {
    if (!this.statusEl) return;
    const api = this.engine() !== CC;
    this.statusEl.toggleClass('is-on', api || this.listening);
    this.titleEl.title = api ? T('Answers come from {model}. Click to switch.', { model: this.engineLabel() })
      : this.listening ? T('Listening: your Claude Code window is reading this chat.')
      : T('Claude Code isn’t connected: in your Claude Code window say “{phrase}”, or pick an API model in the menu.', { phrase: CONNECT_PHRASE });
    this.renderAll();
  }

  renderAll() {
    if (!this.list) return;
    this.list.empty();
    if (!this.msgs.length) this.renderEmpty();
    for (const m of this.msgs) {
      const u = this.list.createDiv({ cls: 'cc-msg cc-user' });
      if (m.selection) u.createDiv({ cls: 'cc-quote', text: m.selection.length > 220 ? m.selection.slice(0, 220) + '…' : m.selection });
      u.createDiv({ cls: 'cc-bubble', text: m.text });
      const ctx = m.study || (m.note ? m.note.replace(/^.*\//, '').replace(/\.md$/, '') : '');
      if (ctx) u.createDiv({ cls: 'cc-ctx', text: ctx });
      if (m.reply != null) this.renderReply(m);
      else if (m.run) this.renderRun(m);
      else { m.pendEl = this.list.createDiv({ cls: 'cc-msg cc-claude cc-pending' }); }
    }
    if (!this.listening && this.msgs.some(x => x.reply == null && !x.via)) this.renderConnectCard();
    this.renderPending();
    this.scrollDown();
  }

  renderPending() {
    for (const m of this.msgs) {
      if (m.reply != null || !m.pendEl) continue;
      const state = m.via ? T('Graphie is writing') : this.seen.has(m.id) ? T('Graphie is writing') : this.listening ? T('Sent') : T('Waiting for Claude Code');
      if (m.pendEl.dataset.state === state) continue;
      m.pendEl.dataset.state = state;
      m.pendEl.empty();
      const t = m.pendEl.createDiv({ cls: 'cc-typing' });
      if (state === T('Graphie is writing')) { t.createSpan({ cls: 'cc-dots' }).innerHTML = '<i></i><i></i><i></i>'; }
      t.createSpan({ text: state });
    }
  }

  renderReply(m) {
    const c = this.list.createDiv({ cls: 'cc-msg cc-claude' });
    const body = c.createDiv({ cls: 'cc-md' });
    MarkdownRenderer.render(this.app, m.reply, body, m.note || '', this);
    // Internal links open the note.
    body.addEventListener('click', e => {
      const a = e.target.closest('a');
      if (!a) return;
      const href = a.getAttribute('data-href') || a.getAttribute('href') || '';
      if (/^https?:/i.test(href)) return;
      e.preventDefault();
      this.app.workspace.openLinkText(decodeURIComponent(href.replace(/^#/, '')), m.note || '', false);
    });
    const acts = c.createDiv({ cls: 'cc-acts' });
    acts.createSpan({ cls: 'cc-via', text: m.via ? this.engineLabel(m.via) : 'Claude Code' });
    const act = (icon, t, fn) => { const b = acts.createEl('button', { attr: { title: t, type: 'button' } }); b.innerHTML = icon; b.createSpan({ text: t }); b.onclick = fn; };
    act(ICON.copy, T('Copy'), () => { navigator.clipboard?.writeText(m.reply); new Notice(T('Copied.')); });
    act(ICON.note, T('Add to note'), () => this.insertIntoNote(m.reply));
  }

  renderEmpty() {
    const e = this.list.createDiv({ cls: 'cc-empty' });
    e.createDiv({ cls: 'cc-empty-logo' }).innerHTML = ICON.spark;
    e.createDiv({ cls: 'cc-empty-title', text: T('Ask Graphie while you study') });
    e.createDiv({ cls: 'cc-empty-text', text: T('Graphie sees the note you have open and anything you select. Try “explain this”, “quiz me on this note” or “add an example to this note”.') });
    if (!this.listening && this.engine() === CC) this.renderConnectCard(e);
  }

  renderConnectCard(parent) {
    const card = (parent || this.list).createDiv({ cls: 'cc-connect' });
    card.createDiv({ cls: 'cc-connect-title', text: T('Claude Code isn’t listening yet') });
    const p = card.createDiv({ cls: 'cc-connect-text' });
    p.appendText(T('In your Claude Code window, say '));
    p.createSpan({ cls: 'cc-phrase', text: `“${CONNECT_PHRASE}”` });
    p.appendText('. Messages you send now will be answered then. Or pick an API model in the menu above.');
    const b = card.createEl('button', { cls: 'cc-connect-copy', attr: { type: 'button' } });
    b.innerHTML = ICON.copy; b.createSpan({ text: T('Copy') });
    b.onclick = () => { navigator.clipboard?.writeText(CONNECT_PHRASE); new Notice(T('Copied. Paste it into Claude Code.')); };
  }

  scrollDown() { if (this.list) this.list.scrollTop = this.list.scrollHeight; }

  /* ---------- actions ---------- */

  async send() {
    const text = this.input.value.trim();
    if (!text) return;
    const { file, selection, study } = this.context();
    const engine = this.engine();
    // With an API model answering, "update my brain" / "file my captures" run the agent jobs here.
    if (engine !== CC) {
      const job = /^(please\s+)?(update (my |the )?(claude )?brain|save what i learned)\b/i.test(text) ? 'brain'
        : /^(please\s+)?(check my inbox|file my captures|process my (notes|captures))\b/i.test(text) ? 'inbox' : null;
      if (job && this.agentVia('inbox')) { this.input.value = ''; this.autosize(); return job === 'brain' ? this.updateBrain(text) : this.fileInbox(text); }
    }
    const m = {
      type: 'user', id: 'm-' + moment().format('YYYYMMDD-HHmmss-SSS'), text, at: moment().format('YYYY-MM-DD HH:mm'),
      note: this.useNote && file ? file.path : '', study: this.useNote ? study : '', selection: this.useSel ? selection : '',
      ...(engine !== CC ? { via: engine } : {}),
    };
    this.input.value = ''; this.autosize();
    try { await this.appendOutbox(m); }
    catch (e) { new Notice(T('Couldn’t send: {msg}', { msg: e.message })); this.input.value = text; return; }
    const cap = this.app.plugins?.getPlugin?.('claude-capture');
    if (m.selection && cap?.lastSel?.text === m.selection) cap.lastSel = { text: '', heading: '', at: 0 };
    this.lastChipSel = '';
    const history = this.msgs.filter(x => x.reply != null).slice(-10)
      .flatMap(x => [{ role: 'user', content: x.text }, { role: 'assistant', content: x.reply }]);
    this.msgs.push({ ...m, reply: null });
    this.renderAll();
    this.renderChips();
    if (m.via) this.askApi(m, history);
  }

  // Ask an API model (chosen in the header menu) and save its answer like any other reply.
  async askApi(m, history) {
    let reply;
    try {
      let note = null;
      if (m.note) {
        // Only Markdown notes are read as text. A PDF or other file is named (with the page, if known), so it is
        // never read as text by mistake; a local framework can open it itself.
        const title = m.note.replace(/^.*\//, '').replace(/\.md$/i, '');
        if (/\.md$/i.test(m.note)) { try { note = { title, content: await this.app.vault.adapter.read(m.note) }; } catch { /* note gone */ } }
        else note = { title, content: `(The open file is "${m.note}"${m.page ? `, page ${m.page}` : ''}. It is not a text note; the selected text, if any, is above.)` };
      }
      const r = await AIAPI().request('chat', 'chat', { text: m.text, history, note, selection: m.selection, study: m.study, ...(m.note ? { path: m.note } : {}) }, { provider: m.via });
      reply = String(r.text || '').trim() || '_' + T('(empty answer)') + '_';
    } catch (e) {
      reply = '⚠️ ' + T('{model} couldn’t answer: {msg}', { model: this.engineLabel(m.via), msg: e.message });
    }
    try { await this.app.vault.adapter.write(`${this.dir}/replies/${m.id}.md`, reply); }
    catch (e) { new Notice(T('Couldn’t save the answer: {msg}', { msg: e.message })); }
    const mm = this.msgs.find(x => x.id === m.id);
    if (mm) { mm.reply = reply; this.renderAll(); if (this.pane.hidden) this.tabBtn.addClass('has-new'); }
  }

  // The "Find new course files" button: a message with task "import" that the Claude window carries out.
  // One search at a time: a second click while one is being started or is running only says so. The check waits
  // for the chat history, so a finished search whose answer is still loading doesn't block a new one.
  async findFiles() {
    if (!this.pane) return;
    this.show();
    if (this.findBusy) { new Notice(T('Graphie is already looking for new files.')); return; }
    this.findBusy = true;
    try { await this.startFind(); } finally { this.findBusy = false; }
  }
  async startFind() {
    await this.whenLoaded();
    const pending = this.msgs.find(m => m.task === 'import' && m.reply == null);
    if (pending) { new Notice(T('Graphie is already looking for new files.')); return; }
    // With an API model chosen for this job (Settings → AI), Graphite's own agent does it, asking before copying.
    if (this.agentVia('import')) return this.runAgent('import', 'import', T('Find new course files on this computer and add them to Graphite.'));
    const m = {
      type: 'user', id: 'm-' + moment().format('YYYYMMDD-HHmmss-SSS'), at: moment().format('YYYY-MM-DD HH:mm'),
      text: T('Find new course files on this computer and add them to Graphite.'), task: 'import',
      note: '', study: '', selection: '',
    };
    try { await this.appendOutbox(m); }
    catch (e) { new Notice(T('Couldn’t send: {msg}', { msg: e.message })); return; }
    this.msgs.push({ ...m, reply: null });
    this.renderAll();
    if (!this.listening) new Notice(T('Saved. Graphie will look once your Claude Code window is connected.'));
  }

  // The "Connect this note" button. Whatever AI is chosen for it (an API model, a local framework or Claude Code)
  // only proposes which existing notes to link. You see "this note → that note" for each, tick the ones you want
  // and confirm; only then does Graphite add the links, both ways, in one request (POST /api/note-links), which
  // never writes into a read-only folder. Closing or cancelling writes nothing; a failed write keeps your choice
  // for Retry. A second click while this runs does nothing.
  async connectNote() {
    if (!this.pane) return;
    const file = this.app.workspace.getActiveFile();
    if (!file || !/\.md$/i.test(file.path)) { new Notice(T('Open a note first.')); return; }
    if (this.connecting) { new Notice(T('Graphie is already connecting this note.')); return; }
    const via = AIAPI()?.choice?.('connect');
    if (!via || via === 'off') { new Notice(T('Choose an AI for “Connect note” in Settings → AI first.')); return; }
    this.connecting = file.path; this.setConnectBusy(true); // before the first await
    try { await this.proposeLinks(file, via); }
    catch (e) { new Notice(T('{model} couldn’t answer: {msg}', { model: this.engineLabel(via), msg: e.message })); }
    finally { if (!this.connectWin) this.endConnect(); }
  }
  endConnect() { this.connecting = null; this.connectWin = null; this.setConnectBusy(false); }
  setConnectBusy(busy) {
    const b = this.connectBtn;
    if (!b) return;
    b.disabled = busy; b.toggleClass('is-busy', busy); b.setAttr('aria-busy', busy ? 'true' : 'false');
  }
  async proposeLinks(file, via) {
    const SKIP = /^(Claude Brain|My Brain|我的大脑知识库|Claude Chats|Daily Notes|Claude Inbox)(\/|$)|(^|\/)\./;
    const all = this.app.vault.getMarkdownFiles().filter(f => f.path !== file.path && !SKIP.test(f.path));
    const cache = f => this.app.metadataCache.getFileCache(f) || {};
    const notes = all.filter(f => cache(f).frontmatter?.graph !== 'hide');
    // Same course first, then the rest; at most 400 entries.
    const course = file.path.includes('/') ? file.path.split('/')[0] : '';
    notes.sort((a, b) => (b.path.startsWith(course + '/') - a.path.startsWith(course + '/')) || a.path.localeCompare(b.path));
    const heads = f => (cache(f).headings || []).slice(0, 6).map(h => h.heading).join('; ');
    const list = notes.slice(0, 400).map(f => `- ${f.basename} (${f.parent?.path || '/'})${heads(f) ? ' · ' + heads(f) : ''}`).join('\n');
    const text = await this.app.vault.read(file);
    const r = await AIAPI().request('connect', 'connect', { title: file.basename, path: file.path, content: `${text}\n\n<other_notes>\n${list}\n</other_notes>`,
      job: { candidates: notes.slice(0, 400).map(f => f.path) } }, { provider: via });
    // Only notes that exist: by unique name, or by path.
    const byName = new Map();
    for (const f of notes) { const k = f.basename.toLowerCase(); byName.set(k, byName.has(k) ? null : f); } // null: name used twice
    const picked = [];
    for (const x of Array.isArray(r?.related) ? r.related : []) {
      const want = String(x?.path || x?.title || '').trim().replace(/\.md$/i, '').toLowerCase();
      const f = notes.find(n => n.path.replace(/\.md$/i, '').toLowerCase() === want) || byName.get(want);
      if (f && !picked.some(p => p.f === f)) picked.push({ f, why: typeof x.why === 'string' ? x.why : '' });
    }
    if (!picked.length) { new Notice(T('No other note is closely related enough to link.')); return; }
    const ro = AIAPI().readOnlyFolderOf || (async () => null);
    const sourceLock = await ro(file.path);
    for (const p of picked) p.lock = await ro(p.f.path);
    if (this.connecting !== file.path) return;
    this.connectWin = new ConnectModal(this, file, picked, sourceLock, via);
    this.connectWin.open();
  }
  // After Graphite wrote the links: a short record in the chat (nothing for Claude Code to do).
  async linked(file, result, picked, via) {
    const name = p => (picked.find(x => x.f.path === p)?.f.basename) || p.replace(/\.md$/i, '').split('/').pop();
    const linked = Array.isArray(result?.linked) ? result.linked : [], same = Array.isArray(result?.unchanged) ? result.unchanged : [];
    let reply = linked.length ? T('Linked “{note}” with:', { note: file.basename }) + '\n\n' + linked.map(p => `- ${name(p)}`).join('\n') + '\n\n' + T('Each link was added both ways, on a “相关 Related” line in each note.') : '';
    if (same.length) reply += (reply ? '\n\n' : '') + T('Already linked: {list}', { list: same.map(name).join(', ') });
    if (!reply) reply = T('No links were added.');
    reply += ' ' + T('To tidy its format too, use “Tidy format” in the command menu.');
    const m = { type: 'user', id: 'm-' + moment().format('YYYYMMDD-HHmmss-SSS'), at: moment().format('YYYY-MM-DD HH:mm'),
      text: T('Connect “{note}” to related notes.', { note: file.basename }), task: 'connect', via: via === CC ? 'graphite' : via, note: file.path, study: '', selection: '' };
    try { await this.appendOutbox(m); await this.app.vault.adapter.write(`${this.dir}/replies/${m.id}.md`, reply); } catch { /* the chat history is optional here */ }
    this.msgs.push({ ...m, reply });
    this.show(); this.renderAll();
  }

  /* ---------- the agent: jobs on your files with an API model (Graphite's server does them, agent.js) ---------- */

  // The AI chosen for a job (Settings → AI → Jobs on your files): an API model or a local framework (DeepSeek
  // Harness, Codex CLI), or null for Claude Code. Whatever was chosen is used; nothing switches on failure.
  agentVia(feature) {
    const ai = AIAPI(), v = ai?.choice?.(feature);
    return v && (ai.isAgent ? ai.isAgent(v) : ai.isApi?.(v)) && ai.agent ? v : null;
  }
  isLocalVia(v) { return !!AIAPI()?.isLocal?.(v); }

  // "File my captures": the agent with an API model, otherwise a message for the Claude Code window.
  async fileInbox(text) {
    if (!this.pane) return;
    this.show();
    if (this.msgs.some(m => m.task === 'inbox' && m.reply == null)) { new Notice(T('Graphie is already filing your captures.')); return; }
    if (this.agentVia('inbox')) return this.runAgent('inbox', 'inbox', text || T('File my captures into my notes.'));
    this.input.value = text || T('File my captures into my notes.');
    return this.send();
  }

  async updateBrain(text) {
    if (!this.pane) return;
    this.show();
    if (this.msgs.some(m => m.task === 'brain' && m.reply == null)) { new Notice(T('Graphie is already updating your study record.')); return; }
    if (!this.agentVia('inbox')) { this.input.value = text || 'Update my brain.'; return this.send(); }
    const history = this.msgs.filter(x => x.reply != null && !x.agent).slice(-15)
      .flatMap(x => [{ role: 'user', content: x.text }, { role: 'assistant', content: x.reply }]);
    if (!history.length) { new Notice(T('Chat first: the Brain is updated from what this chat shows.')); return; }
    return this.runAgent('inbox', 'brain', text || T('Update my study record from this chat.'), { history });
  }

  // Run a job: plan (read-only, progress shown live) → the user confirms → apply.
  async runAgent(feature, job, text, extra = {}) {
    const via = this.agentVia(feature);
    const m = {
      type: 'user', id: 'm-' + moment().format('YYYYMMDD-HHmmss-SSS'), at: moment().format('YYYY-MM-DD HH:mm'),
      text, task: job, via, agent: true, note: '', study: '', selection: '',
    };
    try { await this.appendOutbox(m); } catch (e) { new Notice(T('Couldn’t send: {msg}', { msg: e.message })); return; }
    const mm = { ...m, reply: null, run: { state: 'working', steps: [], feature } };
    (this.running ||= new Map()).set(mm.id, mm);
    this.msgs.push(mm);
    this.show(); this.renderAll();
    try {
      mm.run.ctl = new AbortController();
      const plan = await AIAPI().agent(feature, job, { phase: 'plan', ...extra }, { onProgress: p => this.agentStep(mm, p), signal: mm.run.ctl.signal });
      if (!plan.planId) return this.finishAgent(mm, this.emptyText(job, plan));
      mm.run = { ...mm.run, state: 'confirm', plan, accept: new Set((plan.items || []).map((_, i) => i)), acceptEdits: new Set((plan.edits || []).map((_, i) => i)) };
      this.renderAll();
      if (this.pane.hidden) this.tabBtn.addClass('has-new');
    } catch (e) {
      this.finishAgent(mm, e.name === 'AbortError' ? '_' + T('Stopped. Nothing was copied or written.') + '_' : '⚠️ ' + T('{model} couldn’t answer: {msg}', { model: this.engineLabel(via), msg: e.message }));
    }
  }

  async confirmAgent(mm) {
    const r = mm.run;
    r.state = 'applying'; r.steps = []; r.ctl = new AbortController();
    this.renderAll();
    try {
      const out = await AIAPI().agent(r.feature, mm.task, { phase: 'apply', planId: r.plan.planId, accept: [...r.accept], acceptEdits: [...r.acceptEdits] },
        { onProgress: p => this.agentStep(mm, p), signal: r.ctl.signal, provider: mm.via });
      this.finishAgent(mm, this.doneText(mm.task, out, r.plan));
    } catch (e) {
      this.finishAgent(mm, '⚠️ ' + T('{model} couldn’t answer: {msg}', { model: this.engineLabel(mm.via), msg: e.message }));
    }
  }

  async finishAgent(mm, reply) {
    mm.reply = reply; mm.run = null;
    this.running?.delete(mm.id);
    try { await this.app.vault.adapter.write(`${this.dir}/replies/${mm.id}.md`, reply); } catch { /* shown anyway */ }
    this.renderAll();
    if (this.pane.hidden) this.tabBtn.addClass('has-new');
  }

  agentStep(mm, p) {
    if (!mm.run) return;
    const label = p.step === 'scan' ? T('Looking through {path}', { path: p.path })
      : p.step === 'list' ? T('Looking in {path}', { path: p.path })
      : p.step === 'read' ? T('Reading {path}', { path: p.path })
      : p.step === 'write' ? T('Writing {path}', { path: p.path })
      : p.step === 'copy' ? T('Copying {i} of {n}: {path}', { i: p.i, n: p.n, path: p.path })
      : p.step === 'inbox' ? T('{n} captures waiting', { n: p.n })
      : p.step === 'think' ? T('Thinking (step {n})', { n: p.turn })
      : p.step === 'framework' ? T('Started {name} {version} (read-only)', { name: p.name, version: p.version || '' })
      : p.step === 'tool' ? T('{name} ran: {path}', { name: this.engineParts(mm.via).name, path: p.path || p.tool }) : '';
    if (!label) return;
    // Consecutive "thinking" steps replace each other instead of piling up.
    if (p.step === 'think' && mm.run.lastThink) mm.run.steps[mm.run.steps.length - 1] = label;
    else mm.run.steps.push(label);
    mm.run.lastThink = p.step === 'think';
    if (mm.runEl?.isConnected) this.drawRun(mm); else this.renderAll();
  }

  renderRun(m) {
    m.runEl = this.list.createDiv({ cls: 'cc-msg cc-claude cc-agent' });
    this.drawRun(m);
  }

  drawRun(m) {
    const el = m.runEl, r = m.run;
    el.empty();
    if (r.state !== 'confirm') {
      const t = el.createDiv({ cls: 'cc-typing' });
      t.createSpan({ cls: 'cc-dots' }).innerHTML = '<i></i><i></i><i></i>';
      t.createSpan({ text: r.state === 'applying' ? T('Carrying out the plan…') : this.isLocalVia(m.via) ? T('{name} is working on it on this computer', { name: this.engineParts(m.via).name }) : T('Graphie is working on it') });
      const ul = el.createEl('ul', { cls: 'cc-agent-steps' });
      for (const s of r.steps.slice(-6)) ul.createEl('li', { text: s });
      const stop = el.createEl('button', { cls: 'cc-agent-stop', attr: { type: 'button' }, text: T('Stop') });
      stop.onclick = () => r.ctl?.abort();
      return;
    }
    const plan = r.plan, job = m.task;
    const box = el.createDiv({ cls: 'cc-agent-plan' });
    if (this.isLocalVia(m.via)) box.createDiv({ cls: 'cc-agent-note cc-agent-by', text: T('Planned by {name}, which read {n} files itself. Nothing is written until you confirm.', { name: this.engineLabel(m.via), n: (plan.reads || []).length }) });
    const check = (set, i, on) => { const c = createEl('input', { attr: { type: 'checkbox' } }); c.checked = on; c.onchange = () => { c.checked ? set.add(i) : set.delete(i); this.drawRun(m); }; return c; };
    if (job === 'import') {
      box.createDiv({ cls: 'cc-agent-head', text: T('Found {n} new files. Graphie suggests adding:', { n: plan.total }) });
      plan.items.forEach((it, i) => {
        const row = box.createEl('label', { cls: 'cc-agent-item' });
        row.append(check(r.accept, i, r.accept.has(i)));
        const tx = row.createDiv({ cls: 'cc-agent-text' });
        tx.createDiv({ cls: 'cc-agent-name', text: it.name });
        tx.createDiv({ cls: 'cc-agent-sub', text: '→ ' + it.dest + (it.kind === 'convert' ? '  ' + T('(PDF copy)') : '') });
      });
      if (plan.ignore?.length) box.createDiv({ cls: 'cc-agent-note', text: T('Will skip from now on: {list}', { list: plan.ignore.map(x => `${x.name} (${x.reason})`).join('; ') }) });
      if (plan.questions?.length) {
        box.createDiv({ cls: 'cc-agent-note', text: T('Not sure about these, so they are left out:') });
        const ul = box.createEl('ul');
        for (const q of plan.questions) ul.createEl('li', { text: `${q.name}: ${q.question}` });
      }
    } else if (job === 'inbox') {
      box.createDiv({ cls: 'cc-agent-head', text: T('Graphie suggests filing {n} captures:', { n: plan.items.length }) });
      plan.items.forEach((it, i) => {
        const row = box.createEl('label', { cls: 'cc-agent-item' });
        row.append(check(r.accept, i, r.accept.has(i)));
        const tx = row.createDiv({ cls: 'cc-agent-text' });
        tx.createDiv({ cls: 'cc-agent-name', text: `${it.kind ? it.kind + ' · ' : ''}${it.quote.replace(/\s+/g, ' ').slice(0, 80)}` });
        tx.createDiv({ cls: 'cc-agent-sub', text: (it.mode === 'new' ? T('New note') : T('Add to')) + ' → ' + it.target });
        if (it.preview) { const d = tx.createEl('details'); d.createEl('summary', { text: T('Preview') }); d.createEl('pre', { cls: 'cc-agent-pre', text: it.preview }); }
      });
    } else box.createDiv({ cls: 'cc-agent-head', text: T('Graphie suggests these changes to your study record:') });
    if (plan.edits?.length) {
      if (job !== 'brain') box.createDiv({ cls: 'cc-agent-note', text: T('Study record:') });
      plan.edits.forEach((e, i) => {
        const row = box.createEl('label', { cls: 'cc-agent-item' });
        row.append(check(r.acceptEdits, i, r.acceptEdits.has(i)));
        const tx = row.createDiv({ cls: 'cc-agent-text' });
        tx.createDiv({ cls: 'cc-agent-name', text: `${e.path}  (+${e.added} −${e.removed})` });
        if (e.why) tx.createDiv({ cls: 'cc-agent-sub', text: e.why });
      });
    }
    if (plan.note || plan.summary) box.createDiv({ cls: 'cc-agent-note', text: plan.note || plan.summary });
    const n = r.accept.size + r.acceptEdits.size;
    const acts = el.createDiv({ cls: 'cc-agent-acts' });
    const go = acts.createEl('button', { cls: 'mod-cta cc-agent-go', attr: { type: 'button' },
      text: job === 'import' ? T('Add {n} files', { n: r.accept.size }) : job === 'inbox' ? T('File {n} captures', { n: r.accept.size }) : T('Update the Brain') });
    go.disabled = !n && !plan.ignore?.length;
    go.onclick = () => this.confirmAgent(m);
    const no = acts.createEl('button', { cls: 'cc-agent-cancel', attr: { type: 'button' }, text: T('Cancel') });
    no.onclick = () => this.finishAgent(m, '_' + T('Cancelled. Nothing was copied or written.') + '_');
    el.createDiv({ cls: 'cc-agent-hint', text: T('Nothing is copied or written until you confirm. Originals are never changed.') });
  }

  emptyText(job, plan) {
    if (job === 'import') return T('Everything is already in Graphite.') + (plan.counts ? ' ' + T('({n} files checked)', { n: plan.counts.scanned }) : '');
    if (job === 'inbox') return plan.empty ? T('No captures are waiting.') : T('Graphie couldn’t find a place for these captures; try again.');
    return T('Nothing new to record in your study record.');
  }

  doneText(job, out, plan) {
    const L = [];
    const link = p => `[[${p}|${p.replace(/^.*\//, '').replace(/\.md$/i, '')}]]`;
    if (job === 'import') {
      if (out.done.length) {
        L.push(T('Added {n} files:', { n: out.done.length }));
        const by = {};
        for (const d of out.done) (by[d.dest.replace(/\/[^/]*$/, '')] ||= []).push(d);
        for (const [folder, list] of Object.entries(by)) L.push(`- **${folder}**: ${list.map(d => link(d.dest)).join(', ')}`);
      } else L.push(T('No files were added.'));
      if (out.edited?.length) L.push('', T('Index notes updated:') + ' ' + out.edited.map(link).join(', '));
      if (out.ignored) L.push('', T('{n} files will be skipped from now on.', { n: out.ignored }));
      if (plan.questions?.length) L.push('', T('Not sure about these, so they are left out:'), ...plan.questions.map(q => `- ${q.name}: ${q.question}`));
      if (out.indexError) L.push('', '⚠️ ' + T('The index notes were not updated: {msg}', { msg: out.indexError }));
    } else if (job === 'inbox') {
      L.push(out.done.length ? T('Filed {n} captures:', { n: out.done.length }) : T('No captures were filed.'));
      for (const d of out.done) L.push(`- [[${d.target.replace(/\.md$/i, '')}|${d.shown || d.target.replace(/^.*\//, '').replace(/\.md$/i, '')}]]`);
      if (out.edited?.length) L.push('', T('Study record:') + ' ' + out.edited.map(p => '`' + p + '`').join(', '));
    } else {
      L.push(out.edited?.length ? T('Updated your study record:') + ' ' + out.edited.map(p => '`' + p + '`').join(', ') : T('Nothing new to record in your study record.'));
    }
    for (const f of out.failed || []) L.push('', '⚠️ ' + T('Couldn’t do {name}: {msg}', { name: f.name || f.target || f.src, msg: f.error }));
    if (out.summary) L.push('', out.summary);
    return L.join('\n');
  }

  async newChat() {
    if (!this.msgs.length) return;
    await this.appendOutbox({ type: 'new', at: moment().format('YYYY-MM-DD HH:mm') });
    this.msgs = []; this.cleared = Date.now();
    this.renderAll();
    new Notice(T('New chat.'));
  }

  async saveChat() {
    if (!this.msgs.length) { new Notice(T('Nothing to save yet.')); return; }
    const now = moment();
    const lines = ['---', 'graph: hide', 'tags: [Claude]', `created: ${now.format('YYYY.MM.DD')}`, '---', ''];
    for (const m of this.msgs) {
      lines.push(`**我 Me** · ${m.at || ''}${m.note ? ` · [[${m.note.replace(/\.md$/, '')}]]` : ''}`, '');
      if (m.selection) lines.push(m.selection.split('\n').map(l => '> ' + l).join('\n'), '');
      lines.push(m.text, '', '**Graphie**', '', m.reply ?? '_(no answer yet)_', '', '---', '');
    }
    const folder = 'Claude Chats';
    try { if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder); } catch { /* exists */ }
    const first = this.msgs[0].text.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40);
    const path = `${folder}/${now.format('YYYY-MM-DD HHmm')} ${first}.md`;
    const f = await this.app.vault.create(path, lines.join('\n'));
    new Notice(T('Chat saved.'));
    await this.app.workspace.getLeaf().openFile(f);
  }

  async insertIntoNote(md) {
    const file = this.app.workspace.getActiveFile();
    if (!file || !/\.md$/i.test(file.path)) { new Notice(T('Open the note you want to add to first.')); return; }
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const ed = view?.editor;
    const block = md.trim() + '\n';
    try {
      if (ed) {
        const last = ed.lastLine(), v = ed.getValue();
        const pre = v.endsWith('\n\n') ? '' : v.endsWith('\n') ? '\n' : '\n\n';
        ed.replaceRange(pre + block, { line: last, ch: ed.getLine(last).length });
      } else {
        const cur = await this.app.vault.read(file);
        await this.app.vault.modify(file, cur.replace(/\s*$/, '') + '\n\n' + block);
      }
      new Notice(T('Added to {note}.', { note: file.basename }));
    } catch (e) { new Notice(T('Couldn’t add to the note: {msg}', { msg: e.message })); }
  }
};
