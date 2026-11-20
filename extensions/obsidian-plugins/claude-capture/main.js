'use strict';
// Text in the app's language (Graphite translates these; English when it can't).
const T = (s, v = {}) => (window.graphiteT ? window.graphiteT(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)));
// Claude Capture: one button to mark something interesting or unfamiliar.
// Captures are appended to "Claude Inbox.md" as unticked tasks. Claude (opened separately,
// e.g. Claude Code with the obsidian-inbox skill) files them into notes and ticks them off.
// Nothing is sent anywhere and no API key is used.
const { Plugin, Notice, Modal, MarkdownView, moment } = require('obsidian');

const INBOX = 'Claude Inbox.md';
const INBOX_HEADER = `---
graph: hide
tags: [Claude]
---
# Claude Inbox

Captures from the ✦ button (or Ctrl+Shift+L, or right-click → Send to Claude) wait here.
When you open Claude, it files each unticked item into your notes, ticks it, and writes where it went.
You can also add or edit items here by hand.

`;

const KINDS = {
  unfamiliar: { label: T('Not familiar'), icon: 'help-circle', hint: T('I don’t understand this yet') },
  interesting: { label: T('Interesting'), icon: 'lightbulb', hint: T('Worth keeping or exploring') },
};

// Icons for the selection bar.
const svg = (body, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const ICON = {
  spark: svg('<path d="M12 2.5l1.8 5.4 5.4 1.8-5.4 1.8L12 16.9l-1.8-5.4-5.4-1.8 5.4-1.8z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>', true),
  help: svg('<circle cx="12" cy="12" r="9"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.5M12 17h.01"/>'),
  bulb: svg('<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1.1 1.2 1.1 2V16h5v-.2c0-.8.5-1.5 1.1-2A6 6 0 0 0 12 3z"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
};

// Text of a reading-view selection with formulas turned back into $…$ / $$…$$ (KaTeX keeps the TeX
// in an <annotation>). A formula that is only partly selected is taken whole.
function selectionMarkdown(sel) {
  if (!sel || !sel.rangeCount) return '';
  const range = sel.getRangeAt(0).cloneRange();
  const mathOf = n => (n && (n.nodeType === 1 ? n : n.parentElement))?.closest?.('.math, .katex-display, .katex');
  const s = mathOf(range.startContainer), e = mathOf(range.endContainer);
  if (s) range.setStartBefore(s.closest('.math') || s);
  if (e) range.setEndAfter(e.closest('.math') || e);
  const frag = range.cloneContents();
  for (const m of frag.querySelectorAll('.math, .katex')) {
    if (!m.isConnected && !frag.contains(m)) continue; // already replaced with its parent
    const tex = m.querySelector('annotation[encoding="application/x-tex"]')?.textContent;
    if (tex == null) continue;
    const display = m.classList.contains('math-display') || !!m.querySelector('.katex-display');
    m.replaceWith(document.createTextNode(display ? `\n$$${tex.trim()}$$\n` : `$${tex.trim()}$`));
  }
  const div = document.createElement('div');
  div.appendChild(frag);
  div.querySelectorAll('br').forEach(b => b.replaceWith('\n'));
  div.querySelectorAll('p, li, div, h1, h2, h3, h4, h5, h6, tr').forEach(b => b.append('\n'));
  return div.textContent.replace(/\n{3,}/g, '\n\n').trim();
}

const pendingCount = text => (text.match(/^- \[ \] /gm) || []).length;

// A capture's id: "cap-" + local time to the second (as before, so old ids still read the same) + a random part,
// so captures made in the same second or millisecond, in two windows or after reopening never share an id.
function newCaptureId(now = moment()) {
  let rand = '';
  try { const a = new Uint32Array(2); crypto.getRandomValues(a); rand = a[0].toString(36) + a[1].toString(36); }
  catch { rand = Math.random().toString(36).slice(2) + Date.now().toString(36); }
  return 'cap-' + now.format('YYYYMMDD-HHmmss') + '-' + rand.replace(/[^a-z0-9]/g, '').slice(0, 10).padStart(10, '0');
}

// Nearest heading above a line in Markdown source.
function headingAbove(src, line) {
  const ls = src.split('\n');
  let inCode = false;
  let found = '';
  for (let i = 0; i <= Math.min(line, ls.length - 1); i++) {
    if (/^\s*```/.test(ls[i])) inCode = !inCode;
    const m = !inCode && ls[i].match(/^#{1,6}\s+(.+?)\s*#*\s*$/);
    if (m) found = m[1];
  }
  return found;
}

// Nearest heading before a DOM node in reading view.
function headingBeforeNode(node) {
  let el = node && (node.nodeType === 1 ? node : node.parentElement);
  while (el && el !== document.body) {
    let sib = el;
    while (sib) {
      if (/^H[1-6]$/.test(sib.tagName || '')) return sib.textContent.trim();
      sib = sib.previousElementSibling;
    }
    el = el.parentElement;
  }
  return '';
}

class CaptureModal extends Modal {
  constructor(plugin, ctx) { super(plugin.app); this.plugin = plugin; this.ctx = ctx; }

  onOpen() {
    const { contentEl, ctx } = this;
    this.modalEl.addClass('claude-capture-modal');
    this.setTitle(T('Send to Graphie'));

    const src = contentEl.createDiv({ cls: 'cc-source' });
    src.setText(ctx.source ? T('From {source}', { source: ctx.source })
      : ctx.file ? T('From {source}', { source: ctx.file.basename + (ctx.heading ? ' › ' + ctx.heading : '') }) : T('No note open; the capture is saved on its own.'));

    contentEl.createEl('label', { cls: 'cc-label', text: T('What caught your eye') });
    this.textEl = contentEl.createEl('textarea', { cls: 'cc-text', attr: { rows: '5', placeholder: T('Select text before clicking ✦, or type or paste it here') } });
    this.textEl.value = ctx.selection || '';

    contentEl.createEl('label', { cls: 'cc-label', text: T('Your thought or question (optional)') });
    this.noteEl = contentEl.createEl('textarea', { cls: 'cc-note', attr: { rows: '2', placeholder: T('e.g. why does the order of the bases matter here?') } });

    const row = contentEl.createDiv({ cls: 'cc-buttons' });
    for (const [kind, k] of Object.entries(KINDS)) {
      const b = row.createEl('button', { cls: `cc-btn cc-${kind}`, attr: { type: 'button', title: k.hint } });
      b.createSpan({ cls: 'cc-btn-label', text: k.label });
      b.createSpan({ cls: 'cc-btn-hint', text: k.hint });
      b.onclick = () => this.save(kind);
      if (ctx.kind === kind) b.addClass('cc-suggested');
    }
    contentEl.createDiv({ cls: 'cc-foot', text: T('Ctrl+Enter saves as Not familiar · Alt+Enter as Interesting · Esc cancels') });

    this.keyHandler = e => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); this.save('unfamiliar'); }
      else if (e.key === 'Enter' && e.altKey) { e.preventDefault(); this.save('interesting'); }
    };
    this.modalEl.addEventListener('keydown', this.keyHandler);
    setTimeout(() => (this.textEl.value ? this.noteEl : this.textEl).focus(), 30);
  }

  // The window closes only once the capture is in the inbox. If saving fails, everything stays (text, thought,
  // kind, source) with the reason and a Retry. A second click while saving does nothing; a retry reuses the same
  // id, so the capture is written once even if an earlier attempt did reach the disk.
  async save(kind) {
    if (this.saving) return;
    const text = this.textEl.value.trim();
    const thought = this.noteEl.value.trim();
    if (!text && !thought) { new Notice(T('Type or select something first.')); return; }
    if (!this.capId || this.capFor !== kind + '\n' + text + '\n' + thought) { this.capId = newCaptureId(); this.capFor = kind + '\n' + text + '\n' + thought; }
    this.saving = true; this.setBusy(true, kind);
    try {
      await this.plugin.saveCapture({ ...this.ctx, kind, text, thought, id: this.capId });
      this.saving = false;
      this.close();
    } catch (e) {
      this.saving = false; this.setBusy(false);
      this.showError(e, kind);
    }
  }
  // Not while saving (Esc, ×, or a click outside): if that save fails, the text must still be here.
  close() { if (this.saving) return; super.close(); }
  setBusy(busy) {
    for (const b of this.contentEl.querySelectorAll('.cc-btn, .cc-retry')) b.disabled = busy;
    this.modalEl.toggleClass('cc-saving', busy);
  }
  showError(e, kind) {
    this.errEl?.remove();
    this.errEl = this.contentEl.createDiv({ cls: 'cc-error', attr: { role: 'alert' } });
    this.errEl.createSpan({ text: T('Not saved: {msg}. Your text is kept here; try again.', { msg: (e && e.message) || T('the inbox could not be written') }) });
    const retry = this.errEl.createEl('button', { cls: 'cc-retry mod-cta', attr: { type: 'button' }, text: T('Retry') });
    retry.onclick = () => this.save(kind);
    this.contentEl.querySelector(`.cc-${kind}`)?.addClass('cc-suggested');
  }

  onClose() {
    this.modalEl.removeEventListener('keydown', this.keyHandler);
    this.contentEl.empty();
    if (this.plugin.modal === this) this.plugin.modal = null;
  }
}

module.exports = class ClaudeCapturePlugin extends Plugin {
  async onload() {
    this.lastSel = { text: '', heading: '', at: 0 };

    // Remember the latest selection so clicking the ribbon button (which can clear it) still works.
    this.registerDomEvent(document, 'selectionchange', () => this.rememberSelection());

    this.addRibbonIcon('sparkles', T('Send to Graphie (Ctrl+Shift+L)'), () => this.openCapture());
    this.addCommand({
      id: 'capture', name: T('Send selection to Graphie'),
      hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'L' }],
      callback: () => this.openCapture(),
    });
    this.addCommand({ id: 'open-inbox', name: T('Open the capture inbox'), callback: () => this.openInbox() });

    this.registerEvent(this.app.workspace.on('editor-menu', menu => {
      menu.addItem(item => item.setTitle(T('Send to Graphie')).setIcon('sparkles').onClick(() => this.openCapture()));
    }));

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('claude-capture-status');
    this.statusEl.title = T('Captures waiting for Graphie. Click to open the inbox.');
    this.statusEl.onclick = () => this.openInbox();
    this.app.workspace.onLayoutReady(() => this.updateStatus());
    const timer = window.setInterval(() => this.updateStatus(), 20000);
    this.register(() => window.clearInterval(timer));

    // Floating bar over selected text in your notes (edit mode and reading view).
    this.settings = Object.assign({ selectionBar: true }, (await this.loadData()) || {});

    // The user asked (2026-11-17) for Fira Code as the code font. Set it once through the app's own
    // Appearance setting (so Settings → Appearance → Code font shows it and can change it back).
    if (!this.settings.firaCodeSet) {
      try {
        const k = 'mo:appearance';
        const a = JSON.parse(localStorage.getItem(k) || '{}');
        if (!a.codeFont) {
          a.codeFont = 'Fira Code';
          localStorage.setItem(k, JSON.stringify(a));
          document.documentElement.style.setProperty('--font-code', '"Fira Code", "Cascadia Code", Consolas, Menlo, monospace');
        }
      } catch { /* storage blocked */ }
      this.settings.firaCodeSet = true;
      await this.saveData(this.settings);
    }

    // The user asked (2026-11-18) to keep non-knowledge notes off the graph. The ChatGPT profile mirror can't
    // carry "graph: hide" (another tool rewrites it), so add its folders once to the graph's Hidden folders
    // (graph controls → Hidden folders…, where the user can change it).
    if (!this.settings.graphHiddenSet) {
      try {
        const k = 'mo:graph';
        const g = JSON.parse(localStorage.getItem(k) || '{}');
        const set = new Set(g.hideFolders || []);
        for (const d of ['My Brain', '我的大脑知识库']) set.add(d);
        g.hideFolders = [...set];
        localStorage.setItem(k, JSON.stringify(g));
      } catch { /* storage blocked */ }
      this.settings.graphHiddenSet = true;
      await this.saveData(this.settings);
    }
    this.addCommand({
      id: 'toggle-selection-bar', name: T('Turn the selection bar on notes on or off'),
      callback: async () => {
        this.settings.selectionBar = !this.settings.selectionBar;
        await this.saveData(this.settings);
        if (!this.settings.selectionBar) this.hideBar();
        new Notice(T(this.settings.selectionBar ? 'Selection bar on.' : 'Selection bar off.'));
      },
    });
    this.buildBar();
  }

  /* ---------- selection bar on notes ---------- */

  buildBar() {
    const bar = this.bar = document.body.createDiv({ cls: 'cq-selbar cc-selbar', attr: { role: 'toolbar', 'aria-label': 'Selection' } });
    bar.hidden = true;
    const mk = (icon, text, title, fn, cls) => {
      const b = bar.createEl('button', { cls: cls || '', attr: { type: 'button', title } });
      b.innerHTML = icon; b.createSpan({ text });
      b.addEventListener('mousedown', e => e.preventDefault()); // keep the selection and the cursor
      b.addEventListener('click', () => { this.hideBar(); fn(); });
    };
    const sep = () => bar.createSpan({ cls: 'cq-sep' });
    mk(ICON.spark, T('Send to Graphie'), T('Write a thought and choose the kind (Ctrl+Shift+L)'), () => this.openCapture(), 'cq-primary');
    sep();
    mk(ICON.help, T('Not familiar'), T('Save it straight away as “Not familiar”'), () => this.quickSave('unfamiliar'), 'cc-q-unf');
    mk(ICON.bulb, T('Interesting'), T('Save it straight away as “Interesting”'), () => this.quickSave('interesting'), 'cc-q-int');
    sep();
    mk(ICON.copy, T('Copy'), T('Copy to the clipboard'), () => { navigator.clipboard?.writeText(this.barText || ''); new Notice(T('Copied.')); });
    this.register(() => bar.remove());

    this.registerDomEvent(document, 'mouseup', e => { if (!bar.contains(e.target)) setTimeout(() => this.maybeShowBar(e), 0); });
    this.registerDomEvent(document, 'keyup', e => { if (e.shiftKey || e.key.startsWith('Arrow')) setTimeout(() => this.maybeShowBar(null), 0); });
    this.registerDomEvent(document, 'mousedown', e => { if (!bar.contains(e.target)) this.hideBar(); }, true);
    this.registerDomEvent(document, 'keydown', e => { if (!e.shiftKey && !e.key.startsWith('Arrow') && e.key !== 'Shift') this.hideBar(); }, true);
    this.registerDomEvent(document, 'scroll', () => this.hideBar(), true);
    this.registerDomEvent(window, 'resize', () => this.hideBar());
  }

  hideBar() { if (this.bar) this.bar.hidden = true; }

  // Show the bar if text is selected in the note editor or the reading view.
  maybeShowBar(e) {
    if (!this.settings?.selectionBar || !this.bar) return;
    const ed = document.getElementById('editor'), pv = document.getElementById('preview');
    let text = '', rect = null;
    const ae = document.activeElement;
    if (ed && ae === ed && ed.selectionEnd > ed.selectionStart) {
      text = ed.value.slice(ed.selectionStart, ed.selectionEnd);
      // A textarea has no box for its selection; use the mouse position (or the textarea's top for keyboard selections).
      const er = ed.getBoundingClientRect();
      rect = e && e.clientX ? { left: e.clientX, right: e.clientX, top: e.clientY - 10, bottom: e.clientY + 10 }
        : { left: er.left + er.width / 2, right: er.left + er.width / 2, top: Math.max(er.top, 60) + 30, bottom: Math.max(er.top, 60) + 30 };
    } else {
      const sel = window.getSelection();
      if (pv && sel && !sel.isCollapsed && sel.rangeCount && pv.contains(sel.anchorNode)) {
        text = selectionMarkdown(sel) || sel.toString();
        const r = sel.getRangeAt(0).getBoundingClientRect();
        rect = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      }
    }
    if (!text.trim() || !rect) return this.hideBar();
    this.barText = text.trim();
    const bar = this.bar;
    bar.hidden = false;
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const mid = (rect.left + rect.right) / 2;
    const x = Math.max(8, Math.min(mid - bw / 2, window.innerWidth - bw - 8));
    const above = rect.top > bh + 60;
    bar.toggleClass('below', !above);
    bar.style.setProperty('--ax', Math.max(14, Math.min(mid - x, bw - 14)) + 'px');
    bar.style.left = x + 'px';
    bar.style.top = (above ? rect.top - bh - 10 : rect.bottom + 10) + 'px';
  }

  // The bar's one-click save: if it fails, the capture window opens with the text, kind and source kept, the
  // reason, and Retry (with the same id), so nothing selected is lost.
  async quickSave(kind) {
    const ctx = this.currentContext();
    if (!ctx.selection) { new Notice(T('Select some text first.')); return; }
    if (this.quickBusy) return;
    this.quickBusy = true;
    const id = newCaptureId();
    try { await this.saveCapture({ ...ctx, kind, text: ctx.selection, thought: '', id }); }
    catch (e) {
      if (this.modal) this.modal.close();
      const m = this.modal = new CaptureModal(this, { ...ctx, kind });
      m.open();
      m.capId = id; m.capFor = kind + '\n' + ctx.selection.trim() + '\n';
      m.showError(e, kind);
    } finally { this.quickBusy = false; }
  }

  rememberSelection() {
    const ta = document.activeElement;
    let text = '';
    let heading = '';
    // Only selections in the note itself count (the editor or the reading view), not text picked up in
    // the sidebars, the chat panel, dialogs or menus.
    if (ta && ta.id === 'editor') {
      text = ta.value.slice(ta.selectionStart, ta.selectionEnd);
      if (text.trim()) heading = headingAbove(ta.value, (ta.value.slice(0, ta.selectionStart).match(/\n/g) || []).length);
    } else {
      const sel = window.getSelection();
      const host = sel?.anchorNode && (sel.anchorNode.nodeType === 1 ? sel.anchorNode : sel.anchorNode.parentElement);
      if (sel && !sel.isCollapsed && host?.closest('#note-view') && !host.closest('.claude-capture-modal')) {
        text = selectionMarkdown(sel) || sel.toString();
        heading = headingBeforeNode(sel.anchorNode);
      }
    }
    if (text.trim()) this.lastSel = { text: text.trim(), heading, at: Date.now(), path: this.app.workspace.getActiveFile()?.path || '' };
  }

  currentContext() {
    const file = this.app.workspace.getActiveFile();
    let selection = '';
    let heading = '';
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    try {
      const ed = view?.editor;
      if (ed && ed.somethingSelected()) {
        selection = ed.getSelection().trim();
        heading = headingAbove(ed.getValue(), ed.getCursor('from').line);
      }
    } catch { /* editor not available */ }
    let source = '';
    if (!selection && Date.now() - this.lastSel.at < 120000) ({ text: selection, heading, source = '' } = this.lastSel);
    if (source) return { file: null, selection, heading: '', source: '🎓 ' + source };
    if (file && heading === file.basename) heading = ''; // the inline title, not a real heading
    return { file, selection, heading };
  }

  // Used by the Claude Quizzes panel: open the dialog for text that came from a study page.
  // ctx: { selection, source (label shown and saved), course, kind (button to suggest) }
  openCaptureWith(ctx) {
    if (this.modal) this.modal.close();
    this.modal = new CaptureModal(this, { file: null, heading: '', ...ctx });
    this.modal.open();
  }

  openCapture() {
    if (this.modal) { this.modal.textEl?.focus(); return; } // already open
    this.modal = new CaptureModal(this, this.currentContext());
    this.modal.open();
  }

  // Adds one capture to the inbox; throws if it couldn't be written (the caller keeps the text). Saves from this
  // window run one after another, so two quick saves never overwrite each other; an id already in the inbox (an
  // earlier attempt that did arrive) is not written again.
  saveCapture(capture) {
    const run = () => this.writeCapture(capture);
    const next = (this.saveChain || Promise.resolve()).then(run, run);
    this.saveChain = next.catch(() => {});
    return next;
  }
  async writeCapture({ kind, text, thought, file, heading, source, course, id }) {
    const k = KINDS[kind];
    const now = moment();
    let where = '';
    if (source) where = ` · ${source.replace(/[[\]|]/g, ' ')}${course ? ` (${course})` : ''}`;
    else if (file) {
      const target = file.path.replace(/\.md$/i, '') + (heading ? '#' + heading.replace(/[[\]|#^]/g, ' ').trim() : '');
      const shown = file.basename + (heading ? ' › ' + heading : '');
      where = ` · [[${target}|${shown.replace(/[[\]|]/g, ' ')}]]`;
    }
    id = id || newCaptureId(now);
    const lines = [`- [ ] **${k.label}** · ${now.format('YYYY-MM-DD HH:mm')}${where} %%${id}%%`];
    if (text) for (const l of text.split('\n')) lines.push('    > ' + l);
    if (thought) lines.push('    - Thought: ' + thought.replace(/\n+/g, ' '));
    const entry = lines.join('\n') + '\n';

    const vault = this.app.vault;
    let inbox = vault.getAbstractFileByPath(INBOX);
    if (!inbox) await vault.create(INBOX, INBOX_HEADER + entry);
    else {
      const cur = await vault.read(inbox);
      if (!cur.includes(`%%${id}%%`)) await vault.modify(inbox, cur + (cur.endsWith('\n') ? '' : '\n') + entry);
    }
    this.lastSel = { text: '', heading: '', at: 0 };
    const n = await this.updateStatus();
    new Notice(T('Saved for Graphie as “{kind}”. {n} waiting.', { kind: k.label, n }));
  }

  async updateStatus() {
    let n = 0;
    try {
      const inbox = this.app.vault.getAbstractFileByPath(INBOX);
      if (inbox) n = pendingCount(await this.app.vault.read(inbox));
    } catch { /* inbox unreadable */ }
    // Only shown when captures are waiting; otherwise the status bar stays clean.
    this.statusEl.setText(n ? T('✦ {n} waiting for Graphie', { n }) : '');
    this.statusEl.toggleClass('has-pending', n > 0);
    this.statusEl.style.display = n ? '' : 'none';
    return n;
  }

  async openInbox() {
    let inbox = this.app.vault.getAbstractFileByPath(INBOX);
    if (!inbox) inbox = await this.app.vault.create(INBOX, INBOX_HEADER);
    await this.app.workspace.getLeaf().openFile(inbox);
  }
};
