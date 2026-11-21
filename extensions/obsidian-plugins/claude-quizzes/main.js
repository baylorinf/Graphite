'use strict';
// Text in the app's language (Graphite translates these; English when it can't).
const T = (s, v = {}) => (window.graphiteT ? window.graphiteT(s, v) : String(s).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? v[k] : m)));
// Claude Quizzes: the review pages Claude made (plans, topic quizzes, level tests, notes) open as tabs in
// the note area, like browser tabs: [📄 your note] [🎓 LA review ×] [🎓 MA review ×] [+]
// The pages are HTML files in the vault (e.g. a "Study Pages" folder in each course), so they show in the
// file list; clicking one opens it here. Any other .html file in the vault opens as a study tab too.
// Inside a page you can:
//   - select any text → a small bar offers "✦ Send to Claude", T("+ Add to note") and T("Copy")
//   - press ✦ under an answered question or an open flashcard to keep it
//   - press Ctrl+Shift+L to send the selection to Claude
// Ctrl+Tab / Ctrl+Shift+Tab switch tabs; middle-click closes a tab. Opening a note returns to the note tab.
// Answers stay in the page's own storage, are mirrored to data.json, and scores are written to
// "Claude Brain/quiz-results.md" so Claude can see them. Everything is local; no API key.
const { Plugin, Notice, MarkdownView, Menu, moment } = require('obsidian');

const RESULTS = 'Claude Brain/quiz-results.md';

// Study pages with quizzes are listed in this plugin's data.json under "pages" (Graphite never ships anyone's
// courses). Each entry: { id, path (vault path of the .html), short, title, blurb, course,
//   key (the page's localStorage key), prefix (quiz id prefix, for scores), labelPrefix ("LA" → "LA9") }.
// Any other .html file in the vault still opens as a study tab, without score tracking.
let PAGES = [];
const toPage = p => ({ file: String(p.path || '').replace(/^.*\//, ''), blurb: '', ...p, short: p.short || p.title || p.id, title: p.title || p.short || p.id,
  label: id => (p.labelPrefix != null ? p.labelPrefix : (p.prefix || '')) + id });
// Other .html files in the vault get a page on the fly (id "file:<vault path>").
const extraPages = new Map();
function pageById(id) {
  const known = PAGES.find(p => p.id === id);
  if (known || typeof id !== 'string' || !id.startsWith('file:')) return known;
  const path = id.slice(5);
  if (!extraPages.has(id)) {
    const name = path.replace(/^.*\//, '').replace(/\.html?$/i, '');
    extraPages.set(id, { id, path, file: path.replace(/^.*\//, ''), key: 'page:' + path, short: name, title: name, blurb: path });
  }
  return extraPages.get(id);
}
const pageForPath = path => PAGES.find(p => p.path === path) || pageById('file:' + path);
const isHtml = path => /\.html?$/i.test(path || '');

const today = () => moment().format('YYYY-MM-DD');
const textOf = el => { if (!el) return ''; const c = el.cloneNode(true); c.querySelectorAll('.cq-qtools').forEach(x => x.remove()); return c.innerText ?? c.textContent; };
const clean = s => String(s || '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

// Icons for the selection bar (stroke icons follow the text colour).
const svg = (body, fill) => `<svg viewBox="0 0 24 24" aria-hidden="true" ${fill ? 'fill="currentColor"' : 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"'}>${body}</svg>`;
const ICON = {
  spark: svg('<path d="M12 2.5l1.8 5.4 5.4 1.8-5.4 1.8L12 16.9l-1.8-5.4-5.4-1.8 5.4-1.8z"/><path d="M18.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>', true),
  note: svg('<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6M12 12v6M9 15h6"/>'),
  copy: svg('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
};

// The floating selection bar (same look as the one on note pages, see claude-capture/styles.css).
const SELBAR_CSS = `
.cq-selbar{position:absolute;z-index:2147483000;display:flex;align-items:center;gap:2px;padding:4px;border-radius:12px;
  background:rgba(255,255,255,.95);-webkit-backdrop-filter:blur(12px) saturate(1.5);backdrop-filter:blur(12px) saturate(1.5);
  border:1px solid rgba(15,23,42,.10);box-shadow:0 12px 30px rgba(15,23,42,.18),0 2px 6px rgba(15,23,42,.08);
  font:600 13px/1 "Segoe UI",system-ui,-apple-system,sans-serif;color:#1f2328;animation:cq-sel-in .13s ease-out}
.cq-selbar[hidden]{display:none}
@keyframes cq-sel-in{from{opacity:0;transform:translateY(4px) scale(.98)}to{opacity:1;transform:none}}
.cq-selbar button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;gap:6px;cursor:pointer;height:30px;
  padding:0 11px;border-radius:8px;white-space:nowrap;transition:background .12s,filter .12s}
.cq-selbar button:hover{background:rgba(15,23,42,.07)}
.cq-selbar button svg{width:15px;height:15px;flex:none}
.cq-selbar button.cq-primary{background:linear-gradient(135deg,#7b5cff,#4f86ff);color:#fff;box-shadow:0 1px 3px rgba(79,70,229,.35)}
.cq-selbar button.cq-primary:hover{filter:brightness(1.08)}
.cq-selbar .cq-sep{width:1px;height:18px;background:rgba(15,23,42,.12);margin:0 3px;flex:none}
.cq-selbar::after{content:"";position:absolute;left:var(--ax,50%);bottom:-6px;width:10px;height:10px;margin-left:-6px;
  transform:rotate(45deg);background:inherit;border:1px solid rgba(15,23,42,.10);border-top:0;border-left:0}
.cq-selbar.below::after{bottom:auto;top:-6px;border:1px solid rgba(15,23,42,.10);border-bottom:0;border-right:0}
:root[data-theme="dark"] .cq-selbar{background:rgba(32,35,42,.96);border-color:rgba(255,255,255,.09);color:#e8eaed;
  box-shadow:0 12px 30px rgba(0,0,0,.45),0 2px 6px rgba(0,0,0,.3)}
:root[data-theme="dark"] .cq-selbar button:hover{background:rgba(255,255,255,.09)}
:root[data-theme="dark"] .cq-selbar .cq-sep{background:rgba(255,255,255,.13)}
:root[data-theme="dark"] .cq-selbar::after,:root[data-theme="dark"] .cq-selbar.below::after{border-color:rgba(255,255,255,.09)}
`;

// Styles injected into each page for the selection bar and the ✦ buttons.
const FRAME_CSS = SELBAR_CSS + `
:root{--mono:"Fira Code","JetBrains Mono",Consolas,"Courier New",monospace !important}
.cq-qtools{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0 0 36px}
details.card .cq-qtools{margin:10px 0 0}
.cq-qtools button{font:600 12px system-ui,sans-serif;cursor:pointer;border-radius:999px;padding:4px 10px;
  border:1px solid var(--line,#ccd);background:var(--panel,#fff);color:var(--ink,#123)}
.cq-qtools button:hover{border-color:var(--accent,#46c)}
.cq-qtools .cq-ask{border-color:#e7b0aa;color:#8c1d18;background:#fdecea}
:root[data-theme="dark"] .cq-qtools .cq-ask{background:#3b1a18;color:#ffb4ab;border-color:#6b2a25}
@media (max-width:760px){.cq-qtools{margin-left:0}}
`;

module.exports = class ClaudeQuizzesPlugin extends Plugin {
  async onload() {
    this.data = Object.assign({ snapshots: {}, keys: {}, changed: {}, tabs: [], active: null, pages: [] }, (await this.loadData()) || {});
    PAGES = (Array.isArray(this.data.pages) ? this.data.pages : []).filter(p => p && p.id && p.path).map(toPage);
    this.tabs = []; // { page, frame } — the tabs themselves are in the app's tab bar
    this.active = null; // page id of the study tab in front, or null when the note is in front

    this.addRibbonIcon('graduation-cap', T('Study pages (switch between note and study tab)'), () => this.ribbon());
    this.addCommand({ id: 'toggle', name: T('Switch between the note and the study tab'), callback: () => this.ribbon() });
    for (const page of PAGES) this.addCommand({ id: 'open-' + page.id, name: T('Open {page}', { page: page.title }), callback: () => this.openTab(page.id) });

    // Remember where the cursor was in the note, so T("Add to note") can insert there.
    this.registerDomEvent(document, 'focusout', e => {
      const t = e.target;
      if (t && t.tagName === 'TEXTAREA' && !t.closest('.modal')) {
        const f = this.app.workspace.getActiveFile();
        this.noteCursor = f ? { path: f.path, at: t.selectionEnd } : null;
      }
    });

    window.moStudy = { handles: path => isHtml(path), open: path => this.openTab(pageForPath(path).id) };
    this.register(() => { if (window.moStudy?.handles) delete window.moStudy; });

    this.app.workspace.onLayoutReady(() => {
      this.buildView();
      // The study pages are tabs in Graphite's own tab bar (window.moTabs), next to your notes and PDFs.
      window.moTabs?.registerProvider({
        id: 'study', icon: '🎓',
        title: id => pageById(id)?.short || id,
        open: id => this.ensureTab(id),
        show: id => this.activate(id),
        hide: () => this.activate(null),
        close: id => this.dropTab(id),
        launchers: () => [
          ...PAGES.map(pg => ({ key: pg.id, title: pg.short, subtitle: pg.title + ' · ' + pg.blurb, icon: '🎓', badge: pg.prefix ? this.progressText(pg).split(' · ')[0] : '' })),
          ...this.app.vault.getFiles().filter(f => isHtml(f.path) && !PAGES.some(pg => pg.path === f.path))
            .map(f => { const pg = pageForPath(f.path); return { key: pg.id, title: pg.short, subtitle: f.path, icon: '🎓' }; }),
        ],
        restore: [...(this.data.tabs || [])].filter(pageById), // tabs that were open before the app had tabs
      });
    });
    this.timer = window.setInterval(() => {
      for (const t of this.tabs) { this.sync(t.page); if (t.page.id === this.active) t.savePos?.(); }
    }, 3000);
    this.register(() => this.teardown());
  }

  /* ---------- study tabs (shown in the app's tab bar) ---------- */

  buildView() {
    const main = document.getElementById('main');
    if (!main) return;
    this.view = createDiv({ cls: 'cq-view' });
    this.registerDomEvent(window, 'resize', () => this.layoutView());
    const status = document.getElementById('status');
    status ? main.insertBefore(this.view, status) : main.appendChild(this.view);
    this.themeObs = new MutationObserver(() => this.tabs.forEach(t => this.applyTheme(t)));
    this.themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

  // The 🎓 ribbon button: open the study page you used last (or switch back from it).
  ribbon() {
    if (this.active) return window.moTabs?.cycle(-1);
    const first = (this.data?.lastPage && pageById(this.data.lastPage) ? this.data.lastPage : PAGES[0]?.id) // (also before its settings have loaded)
      || (this.app.vault.getFiles().find(f => /\.html?$/i.test(f.path)) ? 'file:' + this.app.vault.getFiles().find(f => /\.html?$/i.test(f.path)).path : null);
    if (!first) { new Notice(T('No study pages yet. To open your first one, add an .html study page to your vault (drag it into the file list, or put it in a course folder such as “Study Pages”), then click 🎓 again or click the file in the list.')); return; }
    this.openTab(first);
  }

  openTab(id) {
    if (!pageById(id)) return;
    if (window.moTabs) window.moTabs.open('study', id);
    else { this.ensureTab(id); this.activate(id); }
  }

  closeTab(id) { window.moTabs ? window.moTabs.close('study', id) : this.dropTab(id); }

  // Make the page's frame (once); the tab itself belongs to the app.
  ensureTab(id) {
    const page = pageById(id);
    if (!page || !this.view || this.tabs.some(t => t.page.id === id)) return;
    const frame = this.view.createEl('iframe', { cls: 'cq-frame', attr: { title: page.title } });
    const tab = { page, frame };
    frame.addEventListener('load', () => this.wireFrame(tab));
    this.tabs.push(tab);
    this.loadFrame(tab);
    this.saveTabs();
  }

  dropTab(id) {
    const i = this.tabs.findIndex(t => t.page.id === id);
    if (i < 0) return;
    const tab = this.tabs[i];
    tab.savePos?.();
    this.sync(tab.page, true);
    tab.frame.remove();
    this.tabs.splice(i, 1);
    if (this.active === id) this.activate(null);
    this.saveTabs();
  }

  // The study view covers the main area under the app's tab bar.
  layoutView() {
    const main = document.getElementById('main'), bar = document.getElementById('tabbar');
    if (!main) return;
    main.style.setProperty('--cq-top', (bar ? bar.offsetTop + bar.offsetHeight : 0) + 'px');
    main.style.setProperty('--cq-bottom', '0px');
  }

  activate(id) {
    const main = document.getElementById('main');
    if (!main) return;
    this.tabs.find(t => t.page.id === this.active)?.savePos?.(); // remember where you were before switching
    this.active = id;
    this.layoutView();
    main.classList.toggle('cq-study', !!id);
    for (const t of this.tabs) t.frame.classList.toggle('is-active', t.page.id === id);
    if (id) {
      this.data.lastPage = id;
      const t = this.tabs.find(x => x.page.id === id);
      setTimeout(() => t?.frame.focus(), 0);
      if (t?.restore) setTimeout(() => t.restore?.(), 30); // first time in front: go back to where you were
    }
    this.saveTabs();
  }

  // Ctrl+Tab / Ctrl+Shift+Tab inside a study page switch the app's tabs.
  tabKeys(e) {
    if (!e.ctrlKey || e.key !== 'Tab') return;
    e.preventDefault(); e.stopPropagation();
    window.moTabs?.cycle(e.shiftKey ? -1 : 1);
  }

  saveTabs() {
    this.data.tabs = this.tabs.map(t => t.page.id);
    this.data.active = this.active;
    this.saveData(this.data);
  }

  teardown() {
    window.clearInterval(this.timer);
    for (const t of this.tabs) this.sync(t.page, true);
    this.themeObs?.disconnect(); this.closePop?.();
    this.view?.remove();
    document.getElementById('main')?.classList.remove('cq-study');
  }

  async loadFrame(tab) {
    this.restore(tab.page);
    this.updateProgress(tab);
    let html = '';
    const tries = [tab.page.path, this.manifest.dir + '/pages/' + tab.page.file,
      ...this.app.vault.getFiles().filter(f => f.path.endsWith('/' + (tab.page.path || '').replace(/^.*\//, ''))).map(f => f.path)].filter(Boolean);
    for (const t of tries) { try { html = await this.app.vault.adapter.read(t); if (html) break; } catch { /* try the next place */ } }
    tab.frame.srcdoc = html || `<p style="font:14px system-ui;padding:20px">Couldn't find ${tab.page.path || tab.page.file}. It may have been moved or renamed; open it from the file list.</p>`;
  }

  applyTheme(tab) {
    try {
      const theme = document.documentElement.getAttribute('data-theme');
      const root = tab.frame.contentDocument.documentElement;
      if (theme) root.setAttribute('data-theme', theme); else root.removeAttribute('data-theme');
    } catch { /* not loaded */ }
  }

  /* ---------- tools inside the page ---------- */

  wireFrame(tab) {
    const win = tab.frame.contentWindow, doc = tab.frame.contentDocument, page = tab.page;
    if (!doc) return;
    this.applyTheme(tab);
    this.learnKey(page, win);
    doc.head.appendChild(Object.assign(doc.createElement('style'), { textContent: FRAME_CSS }));
    doc.addEventListener('keydown', e => this.tabKeys(e), true);
    this.trackReading(tab, win, doc);

    // Selection bar.
    const bar = doc.createElement('div');
    bar.className = 'cq-selbar'; bar.hidden = true;
    const mk = (icon, text, title, fn, cls) => {
      const b = doc.createElement('button'); b.innerHTML = icon + '<span></span>'; b.lastChild.textContent = text; b.title = title;
      if (cls) b.className = cls;
      b.addEventListener('mousedown', e => e.preventDefault()); // keep the selection
      b.addEventListener('click', () => { const s = this.selectionInfo(doc, page); bar.hidden = true; if (s) fn(s); });
      bar.appendChild(b);
    };
    const sep = () => bar.appendChild(Object.assign(doc.createElement('span'), { className: 'cq-sep' }));
    mk(ICON.spark, T('Send to Graphie'), T('Save for Graphie to explain or file (Ctrl+Shift+L)'), s => this.sendToClaude(s.text, s.where, null, page), 'cq-primary');
    sep();
    mk(ICON.note, T('Add to note'), T('Add as a quote to your note (the 📄 tab)'), s => this.addToNote(s.text, s.where));
    mk(ICON.copy, T('Copy'), T('Copy to the clipboard'), s => { navigator.clipboard?.writeText(s.text); new Notice(T('Copied.')); });
    doc.body.appendChild(bar);

    const place = () => {
      const s = this.selectionInfo(doc, page);
      if (!s) { bar.hidden = true; return; }
      bar.hidden = false;
      const r = s.rect, bw = bar.offsetWidth || 300, bh = bar.offsetHeight || 40;
      const mid = r.left + r.width / 2;
      const x = Math.max(8, Math.min(mid - bw / 2, doc.documentElement.clientWidth - bw - 8));
      const above = r.top > bh + 16;
      bar.classList.toggle('below', !above);
      bar.style.setProperty('--ax', Math.max(14, Math.min(mid - x, bw - 14)) + 'px');
      bar.style.left = (x + win.scrollX) + 'px';
      bar.style.top = ((above ? r.top - bh - 10 : r.bottom + 10) + win.scrollY) + 'px';
      // Hand the selection to Claude Capture too, so its own ✦ button and shortcut see it.
      const cap = this.capture();
      if (cap) cap.lastSel = { text: s.text, heading: '', at: Date.now(), source: s.where };
    };
    doc.addEventListener('mouseup', e => { if (!bar.contains(e.target)) setTimeout(place, 0); });
    doc.addEventListener('keyup', e => { if (e.shiftKey || e.key === 'Escape') setTimeout(place, 0); });
    doc.addEventListener('mousedown', e => { if (!bar.contains(e.target)) bar.hidden = true; });
    win.addEventListener('scroll', () => { bar.hidden = true; }, { passive: true });
    doc.addEventListener('keydown', e => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'l') {
        e.preventDefault();
        const s = this.selectionInfo(doc, page);
        this.sendToClaude(s ? s.text : '', s ? s.where : this.whereFor(doc, doc.body, page), null, page);
      }
    });

    // ✦ buttons under answered questions and open flashcards. The pages redraw often, so watch for changes.
    const decorate = () => {
      for (const q of doc.querySelectorAll('.q')) {
        const why = q.querySelector('.why');
        if (!why || q.querySelector('.cq-qtools')) continue;
        this.tools(doc, q, why.classList.contains('no'), () => this.questionText(q), () => this.whereFor(doc, q, page), page);
      }
      for (const c of doc.querySelectorAll('details.card[open]')) {
        if (c.querySelector('.cq-qtools')) continue;
        this.tools(doc, c.querySelector('.inner') || c, true, () => clean(c.querySelector('summary')?.innerText) + '\n' + clean(textOf(c.querySelector('.inner'))), () => this.whereFor(doc, c, page), page);
      }
    };
    new win.MutationObserver(decorate).observe(doc.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] });
    decorate();
  }

  tools(doc, host, ask, getText, getWhere, page) {
    const box = doc.createElement('div');
    box.className = 'cq-qtools';
    const b1 = doc.createElement('button');
    b1.textContent = ask ? T('✦ Ask Graphie to explain') : T('✦ Send to Graphie');
    if (ask) b1.className = 'cq-ask';
    b1.onclick = e => { e.preventDefault(); e.stopPropagation(); this.sendToClaude(getText(), getWhere(), ask ? 'unfamiliar' : null, page); };
    const b2 = doc.createElement('button');
    b2.textContent = T('+ Add to note');
    b2.onclick = e => { e.preventDefault(); e.stopPropagation(); this.addToNote(getText(), getWhere()); };
    box.append(b1, b2);
    host.appendChild(box);
  }

  selectionInfo(doc, page) {
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
    const node = sel.anchorNode;
    if (node && (node.parentElement || node).closest?.('.cq-selbar, .cq-qtools')) return null;
    const text = clean(sel.toString());
    if (!text) return null;
    return { text, rect: sel.getRangeAt(0).getBoundingClientRect(), where: this.whereFor(doc, node, page) };
  }

  // "LA review › LA9 · Null space, rank–nullity › Q3" from the nearest heading above the node.
  whereFor(doc, node, page) {
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    let h2 = null;
    for (const h of doc.querySelectorAll('h2')) {
      if (!el || h === el || h.contains(el) || (h.compareDocumentPosition(el) & 4)) h2 = h; else break;
    }
    const parts = [page.short];
    if (h2) {
      const eb = h2.parentElement?.querySelector('.eyebrow');
      const tag = eb ? clean(eb.textContent).split('·')[0].trim() : '';
      parts.push((tag && !/plan/i.test(tag) ? tag + ' · ' : '') + clean(h2.innerText));
    }
    const q = el?.closest?.('.q');
    const k = q?.querySelector('.qt .k')?.innerText;
    if (k) parts.push(clean(k));
    return parts.join(' › ');
  }

  questionText(q) {
    const qt = clean(q.querySelector('.qt span:last-child')?.innerText);
    const opt = sel => clean(q.querySelector(sel + ' span:last-child')?.innerText);
    const right = opt('.opt.right'), mine = opt('.opt.wrong');
    const why = clean(textOf(q.querySelector('.why')).replace(/^\s*(Correct\.|Not quite\.)\s*/, ''));
    return [qt, mine ? `My answer: ${mine}` : '', `Correct answer: ${right}`, why ? `Why: ${why}` : ''].filter(Boolean).join('\n');
  }

  capture() { return this.app.plugins?.getPlugin?.('claude-capture') || this.app.plugins?.plugins?.['claude-capture'] || null; }

  sendToClaude(text, where, kind, page) {
    const cap = this.capture();
    if (!cap?.openCaptureWith) { new Notice(T('Turn on Graphite Capture (Settings → Plugins) to send things to Graphie.')); return; }
    cap.openCaptureWith({ selection: text, source: '🎓 ' + where, course: page?.course, kind });
  }

  // Add a quote to the note that is open: at the cursor's line if you were just typing in it, otherwise at the end.
  async addToNote(text, where) {
    const file = this.app.workspace.getActiveFile();
    if (!file || !/\.md$/i.test(file.path)) { new Notice(T('Open the note you want to add to first.')); return; }
    const quote = text.split('\n').map(l => '> ' + l).join('\n');
    const block = `${quote}\n> \n> 来源 Source: 🎓 ${where}`;
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const ed = view?.editor;
    try {
      if (ed) {
        const value = ed.getValue();
        let at = value.length;
        const fmEnd = value.startsWith('---') ? value.indexOf('\n---', 3) + 4 : 0;
        if (this.noteCursor?.path === file.path && this.noteCursor.at > fmEnd) {
          const nl = value.indexOf('\n', this.noteCursor.at);
          at = nl === -1 ? value.length : nl;
        }
        const before = value.slice(0, at);
        const pre = before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
        const ins = pre + block + '\n';
        const lines = before.split('\n');
        ed.replaceRange(ins, { line: lines.length - 1, ch: lines[lines.length - 1].length });
        if (this.noteCursor?.path === file.path) this.noteCursor.at = at + ins.length;
      } else {
        const cur = await this.app.vault.read(file);
        await this.app.vault.modify(file, cur.replace(/\s*$/, '') + '\n\n' + block + '\n');
      }
      new Notice(T('Added to {note}.', { note: file.basename }));
    } catch (e) { new Notice(T('Couldn’t add to the note: {msg}', { msg: e.message })); }
  }

  /* ---------- progress and results ---------- */

  restore(page) {
    const saved = this.data.snapshots[page.key];
    try { if (saved && !localStorage.getItem(page.key)) localStorage.setItem(page.key, saved); } catch { /* storage blocked */ }
  }

  learnKey(page, win) {
    if (!page.prefix) return;
    try {
      const json = win.eval('JSON.stringify({units: UNITS, lec: LEC.map(l => ({id: l.id, u: l.u, t: l.t, ans: l.q.map(q => q[2])}))})');
      if (JSON.stringify(this.data.keys[page.key]) !== json) { this.data.keys[page.key] = JSON.parse(json); this.saveData(this.data); }
    } catch (e) { console.warn('[claude-quizzes] no answer key', e); }
  }

  state(page) {
    try { return JSON.parse(localStorage.getItem(page.key) || this.data.snapshots[page.key] || 'null'); } catch { return null; }
  }

  topicScores(page, st) {
    const key = this.data.keys[page.key];
    if (!key || !st || !st.quiz) return [];
    return key.lec.map(l => {
      const a = st.quiz[page.prefix + l.id] || {};
      return { ...l, answered: Object.keys(a).length, right: l.ans.filter((c, i) => a[i] === c).length, total: l.ans.length };
    });
  }

  progressText(page) {
    if (!page.prefix) return '';
    const st = this.state(page), scores = this.topicScores(page, st);
    const parts = [];
    if (scores.length) parts.push(`${scores.filter(s => s.answered === s.total).length}/${scores.length} quizzes`);
    if (st && st.test) parts.push(`test ${st.test.right}/${st.test.total}`);
    return parts.join(' · ');
  }

  // The tab shows how far through the page you are; quiz progress goes in the tooltip (and the + menu).
  updateProgress(tab) {
    for (const t of tab ? [tab] : this.tabs) {
      const pos = this.data.pos?.[t.page.id];
      const pct = pos ? Math.round(pos.pct * 100) : 0;
      const quiz = this.progressText(t.page);
      window.moTabs?.setBadge('study', t.page.id, {
        text: pct ? pct + '%' : '', progress: pct / 100,
        title: `${t.page.title}${pos ? ` · ${T('{pct}% read', { pct })}${pos.label ? ' (' + pos.label + ')' : ''}` : ''}${quiz ? ' · ' + quiz : ''}`,
      });
    }
  }

  /* ---------- reading position ---------- */

  // Remember which part of the page you were on (plan, a lecture, the test…) and how far you'd scrolled;
  // put you back there when the page opens again.
  trackReading(tab, win, doc) {
    const page = tab.page;
    this.data.pos = this.data.pos || {};
    const where = () => {
      try { return JSON.parse(win.eval('typeof view !== "undefined" ? JSON.stringify({ view, lec: typeof current !== "undefined" ? current : null }) : "null"')); }
      catch { return null; }
    };
    const label = w => {
      if (!w) return '';
      if (w.view === 'plan') return 'plan';
      if (w.view === 'test') return 'level test';
      return page.label && w.lec ? page.label(w.lec) : '';
    };
    const measure = () => {
      const max = Math.max(1, doc.documentElement.scrollHeight - win.innerHeight);
      return { y: Math.round(win.scrollY), pct: Math.min(1, Math.max(0, win.scrollY / max)) };
    };

    // Restore. A hidden tab can't scroll, so a background tab does this when it is first brought to the front.
    const saved = this.data.pos[page.id];
    tab.restore = !saved ? null : () => {
      tab.restore = null;
      try {
        if (saved.view && win.eval('typeof setView') === 'function')
          win.eval(`setView(${JSON.stringify(saved.view)}${saved.lec != null ? ', ' + Number(saved.lec) : ''})`);
      } catch (e) { console.warn('[claude-quizzes] restore view', e); }
      const go = () => {
        const max = Math.max(0, doc.documentElement.scrollHeight - win.innerHeight);
        win.scrollTo(0, Math.min(saved.y ?? saved.pct * max, max));
      };
      // Twice: once now, once after fonts and maths have settled the layout.
      win.setTimeout(go, 30);
      win.setTimeout(go, 400);
      this.restoring = page.id;
      win.setTimeout(() => { if (this.restoring === page.id) this.restoring = null; }, 700);
    };
    if (tab.restore) tab.restore(); // hidden tabs stay laid out, so they can scroll now too

    // Save (throttled) on scroll and whenever the page redraws, e.g. moving to another lecture.
    // Record the position now. Also called every few seconds and when you switch or close the tab,
    // so it never depends on scroll events alone.
    tab.savePos = () => {
      if (this.restoring === page.id || tab.restore || !tab.frame.classList.contains('is-active')) return;
      if (!tab.frame.isConnected || tab.frame.offsetParent === null) return; // hidden tab: nothing changed
      const w = where(), m = measure();
      const prev = this.data.pos[page.id];
      const next = { view: w?.view ?? null, lec: w?.lec ?? null, y: m.y, pct: m.pct, label: label(w) };
      if (prev && prev.view === next.view && prev.lec === next.lec && Math.abs(prev.y - next.y) < 4) return;
      this.data.pos[page.id] = next;
      this.updateProgress(tab);
      window.clearTimeout(this.posSaveT);
      this.posSaveT = window.setTimeout(() => this.saveData(this.data), 1500);
    };
    let t = 0;
    const save = () => { window.clearTimeout(t); t = window.setTimeout(() => tab.savePos?.(), 250); };
    win.addEventListener('scroll', save, { passive: true });
    new win.MutationObserver(save).observe(doc.getElementById('app') || doc.body, { childList: true });
    this.updateProgress(tab);
  }

  async sync(page, force) {
    let raw = null;
    try { raw = localStorage.getItem(page.key); } catch { /* storage blocked */ }
    const before = this.data.snapshots[page.key];
    if (!raw || raw === before) { if (force) this.updateProgress(); return; }
    this.data.snapshots[page.key] = raw;
    if (page.prefix) {
      let oldS = {}, newS = {};
      try { oldS = JSON.parse(before || '{}') || {}; } catch { /* first time */ }
      try { newS = JSON.parse(raw) || {}; } catch { /* unreadable */ }
      const ch = this.data.changed[page.key] = this.data.changed[page.key] || {};
      const oq = oldS.quiz || {}, nq = newS.quiz || {};
      for (const t of new Set([...Object.keys(oq), ...Object.keys(nq)])) if (JSON.stringify(oq[t]) !== JSON.stringify(nq[t])) ch[t] = today();
      if (JSON.stringify(oldS.test) !== JSON.stringify(newS.test)) ch.__test = today();
    }
    await this.saveData(this.data);
    this.updateProgress();
    if (page.prefix) await this.writeResults();
  }

  async writeResults() {
    const out = ['---', 'graph: hide', 'tags: [Claude]', '---', '# Quiz results', '',
      'Written by the 🎓 study tabs whenever you answer a question. Claude reads it to update the brain. It is rewritten each time, so don’t edit it by hand.', ''];
    for (const page of PAGES.filter(p => p.prefix)) {
      const st = this.state(page), key = this.data.keys[page.key], ch = this.data.changed[page.key] || {};
      out.push(`## ${page.course}`, '');
      if (!st) { out.push('Not started yet.', ''); continue; }
      if (st.test) {
        const units = Object.entries(st.test.units || {}).map(([u, r]) => `${key?.units?.[u] || u} ${r.right}/${r.total}`).join(' · ');
        out.push(`**Level test:** ${st.test.right}/${st.test.total} (${ch.__test || st.test.date || ''})`);
        if (units) out.push('', units);
        out.push('');
      } else out.push('**Level test:** not taken yet.', '');
      const rows = this.topicScores(page, st).filter(s => s.answered);
      if (rows.length) {
        out.push('| Topic | Correct | Answered | Last changed |', '|---|---|---|---|');
        for (const s of rows) out.push(`| ${page.label(s.id)} ${s.t} | ${s.right}/${s.total} | ${s.answered}/${s.total} | ${ch[page.prefix + s.id] || ''} |`);
        out.push('');
      } else out.push('No topic quizzes answered yet.', '');
    }
    const text = out.join('\n'), vault = this.app.vault, f = vault.getAbstractFileByPath(RESULTS);
    try {
      if (f) { if ((await vault.read(f)) !== text) await vault.modify(f, text); }
      else await vault.create(RESULTS, text);
    } catch (e) { new Notice('Couldn’t save quiz results: ' + e.message); }
  }
};
