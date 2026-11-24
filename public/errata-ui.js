// Graphite — lecture corrections (errata) frontend.
// Plain ES module. All user/PDF/report text is rendered via textContent (never innerHTML).
//
//   import { createErrata } from './errata-ui.js';
//   const errata = createErrata({ api, S, sync, openNote, getLang, toast, openSource, mountPdf });
//   errata.mountToolbar(fvBar, () => ({ pdf, page, source, fp }));  // PDF toolbar (next to .pdf-summary)
//   errata.commands(getCurrentPdf);                                  // [{ id, name, label, run }]
//   errata.onFileChange(path, type);                                 // vault file event (debounced, accumulated)
//   errata.reset();                                                  // vault switch / state reset
//
// Host contract:
//   api(method, route, params = {}, body) -> Promise<json>; rejects with an error carrying numeric `status`
//   S                                     -> S.files.keys() lists vault-relative paths
//   sync()                                -> Promise, refreshes the vault tree (called before showing drafts)
//   openNote(path)                        -> open a Markdown note
//   getLang()                             -> 'zh' | 'en' | ...
//   toast(message)
//   openSource(path, id, fp)              -> open the live PDF at a vault path on a paragraph
//   mountPdf(element, url, { page, scale: 'page-width', onReady })
//                                         -> Promise<{ goToSource({ page, source, fp }), destroy() }>
// Optional: listFiles(), pdfUrl(version), classes, onTracked(body), onApplied(out), onChanges(docs).
// Archived evidence is only ever shown inside the dialog via mountPdf (never a browser tab).

const STR = {
  en: {
    toolbar: 'Track correction', toolbarCite: 'Track this paragraph', tracked: 'Tracked lecture sources',
    paletteTrack: 'Errata: track a lecture paragraph', paletteTracked: 'Errata: tracked lecture sources',
    close: 'Close', cancel: 'Cancel', loading: 'Loading…', retry: 'Retry',
    trackTitle: 'Track lecture paragraph', paragraph: 'Paragraph', filter: 'Filter paragraphs',
    citedPage: p => `Cited page ${p}: choose the exact paragraph.`, citedPara: 'Preselected from the citation.',
    noParagraphs: 'No paragraphs match.', report: 'Report (Markdown note)', reportHint: 'Vault path of the report that uses this value',
    kind: 'Binding type', kindNote: 'Text note', kindCalc: 'Calculation',
    parameter: 'Parameter name', number: 'Number in paragraph', noNumbers: 'This paragraph contains no numbers.',
    unit: 'Unit', inputs: 'Inputs', addInput: 'Add input', steps: 'Steps', addStep: 'Add step', remove: 'Remove',
    name: 'Name', value: 'Value', inputValue: 'Number', inputCsv: 'CSV cell', csv: 'CSV file', column: 'Column header',
    row: 'Data row (1-based)', formula: 'Formula', save: 'Track', saving: 'Saving…',
    needParagraph: 'Choose a paragraph.', needReport: 'Choose an existing Markdown report.', needParam: 'Enter a parameter name.',
    needNumber: 'Choose the number to bind.', needInput: 'Each input needs a name and a number (decimal dot) or CSV cell.',
    needStep: 'Each step needs a name and formula.', tracked409: 'The cited paragraph text has changed. Choose the paragraph again.',
    trackedOk: 'Paragraph is now tracked.',
    trackedEmpty: 'No tracked sources yet. Open a PDF and use “Track correction”.',
    trackNew: 'Track a paragraph…', pickPdf: 'PDF', openPdf: 'Open PDF', openReport: 'Open report', openSource: 'Open source',
    currentFile: 'Current file', version: 'Version', calc: 'Calculation', note: 'Text note',
    removeTrack: 'Remove', confirmRemove: 'Confirm remove', removed: 'Tracking removed.',
    stale: 'The tracked list changed elsewhere. It has been reloaded.',
    docUpdated: 'Updated at the same path', docMissing: 'File missing',
    compare: 'Compare', compareWith: 'Compare with another PDF…', chooseReplacement: 'Choose replacement PDF…',
    replacementLabel: 'Replacement PDF', go: 'Compare', checking: 'Checking for changes…',
    changedToast: p => `Tracked lecture changed: ${p}. Open “Tracked lecture sources” to compare.`,
    previewTitle: 'Compare lecture versions', from: 'Original', to: 'New file',
    st: { unchanged: 'Unchanged', moved: 'Moved', changed: 'Changed', ambiguous: 'Ambiguous', missing: 'Not found' },
    oldPara: 'Old paragraph', newPara: 'New paragraph',
    openOld: 'View archived original', openNew: 'View archived new', openLive: 'Open current file',
    snapOld: 'Archived original', snapNew: 'Archived new version',
    backToCompare: 'Back to comparison', backToList: 'Back to list',
    pdfLoading: 'Loading PDF…', pdfUnavailable: 'The in-app PDF viewer is unavailable.', noVersion: 'No archived version is available.',
    results: 'Recalculated results', candidates: 'Possible replacement paragraphs', chooseOther: 'Choose another paragraph…',
    allParagraphs: 'All paragraphs in the new file', useThis: 'Use this paragraph', chosen: 'Chosen manually',
    willDraft: r => `The bound value is affected: a correction draft will be created for ${r}.`,
    affectedSame: 'The bound input changed but the result is numerically identical; a draft is still created for review.',
    notAffected: 'The paragraph changed, but the bound value is not affected; no draft.',
    willMove: 'Location will be updated; no draft.', noChange: 'No change; no draft.', mustChoose: 'Choose a paragraph to continue.',
    reviewUnavailable: 'Review unavailable',
    reportMissing: 'The report file is missing, so this binding cannot be reviewed and no draft will be created.',
    howCalc: 'How this result was calculated', constant: 'constant', rowN: r => `row ${r}`,
    numberN: n => `number #${n} in the paragraph`,
    summary: c => `${c.changed} changed · ${c.moved} moved · ${c.unchanged} unchanged · ${c.open} need a choice · ${c.drafts} report(s) to draft`,
    applyBtn: 'Save…', cannotApply: 'Resolve every ambiguous or missing paragraph before saving.',
    confirmTitle: 'Confirm', confirmText: n => n ? `Create correction drafts for ${n} report(s) and update tracked locations? Original reports and PDFs are not modified.`
      : 'Update tracked locations? No correction drafts will be created.',
    confirm: 'Confirm', back: 'Back', applying: 'Saving…',
    conflict: 'The files or tracked list changed since this comparison. Please preview again.', previewAgain: 'Preview again',
    applied: n => n ? `${n} correction draft(s) created.` : 'Tracked locations updated.', drafts: 'Correction drafts', openDraft: 'Open',
    error: 'Error', archivedOpen: 'View archived PDF',
  },
  zh: {
    toolbar: '跟踪勘误', toolbarCite: '跟踪此段落', tracked: '已跟踪的讲义来源',
    paletteTrack: '勘误：跟踪讲义段落', paletteTracked: '勘误：已跟踪的讲义来源',
    close: '关闭', cancel: '取消', loading: '加载中…', retry: '重试',
    trackTitle: '跟踪讲义段落', paragraph: '段落', filter: '筛选段落',
    citedPage: p => `引用位于第 ${p} 页：请选择具体段落。`, citedPara: '已根据引用预选。',
    noParagraphs: '没有匹配的段落。', report: '报告（Markdown 笔记）', reportHint: '使用该数值的报告在库中的路径',
    kind: '绑定类型', kindNote: '文字备注', kindCalc: '计算',
    parameter: '参数名', number: '段落中的数字', noNumbers: '该段落不含数字。',
    unit: '单位', inputs: '输入', addInput: '添加输入', steps: '计算步骤', addStep: '添加步骤', remove: '删除',
    name: '名称', value: '数值', inputValue: '数值', inputCsv: 'CSV 单元格', csv: 'CSV 文件', column: '列标题',
    row: '数据行（从 1 开始）', formula: '公式', save: '跟踪', saving: '保存中…',
    needParagraph: '请选择段落。', needReport: '请选择已存在的 Markdown 报告。', needParam: '请输入参数名。',
    needNumber: '请选择要绑定的数字。', needInput: '每个输入都需要名称以及数值（小数点用“.”）或 CSV 单元格。',
    needStep: '每个步骤都需要名称和公式。', tracked409: '引用段落的文字已改变，请重新选择段落。',
    trackedOk: '已开始跟踪该段落。',
    trackedEmpty: '尚无跟踪来源。打开 PDF 并使用“跟踪勘误”。',
    trackNew: '跟踪段落…', pickPdf: 'PDF', openPdf: '打开 PDF', openReport: '打开报告', openSource: '打开来源',
    currentFile: '当前文件', version: '版本', calc: '计算', note: '文字备注',
    removeTrack: '移除', confirmRemove: '确认移除', removed: '已移除跟踪。',
    stale: '跟踪列表已在别处更改，已重新加载。',
    docUpdated: '同一路径的文件已更新', docMissing: '文件缺失',
    compare: '比较', compareWith: '与其他 PDF 比较…', chooseReplacement: '选择替换 PDF…',
    replacementLabel: '替换 PDF', go: '比较', checking: '正在检查更改…',
    changedToast: p => `已跟踪的讲义有更改：${p}。打开“已跟踪的讲义来源”进行比较。`,
    previewTitle: '比较讲义版本', from: '原文件', to: '新文件',
    st: { unchanged: '未变化', moved: '已移动', changed: '已更改', ambiguous: '有歧义', missing: '未找到' },
    oldPara: '旧段落', newPara: '新段落',
    openOld: '查看存档原版', openNew: '查看存档新版', openLive: '打开当前文件',
    snapOld: '存档原版', snapNew: '存档新版',
    backToCompare: '返回比较', backToList: '返回列表',
    pdfLoading: 'PDF 加载中…', pdfUnavailable: '应用内 PDF 查看器不可用。', noVersion: '没有可用的存档版本。',
    results: '重新计算结果', candidates: '可能的替换段落', chooseOther: '选择其他段落…',
    allParagraphs: '新文件中的全部段落', useThis: '使用此段落', chosen: '已手动选择',
    willDraft: r => `绑定的数值受影响：将为 ${r} 创建勘误草稿。`,
    affectedSame: '绑定的输入已更改，但结果数值相同；仍会创建草稿供审阅。',
    notAffected: '段落有更改，但绑定的数值未受影响，不创建草稿。',
    willMove: '将更新位置，不创建草稿。', noChange: '无变化，不创建草稿。', mustChoose: '请选择段落后继续。',
    reviewUnavailable: '无法审阅',
    reportMissing: '报告文件缺失，无法审阅该绑定，不会创建草稿。',
    howCalc: '结果的计算来源', constant: '常量', rowN: r => `第 ${r} 行`,
    numberN: n => `段落中的第 ${n} 个数字`,
    summary: c => `${c.changed} 处更改 · ${c.moved} 处移动 · ${c.unchanged} 处未变 · ${c.open} 处待选择 · ${c.drafts} 份报告将生成草稿`,
    applyBtn: '保存…', cannotApply: '保存前请处理所有有歧义或未找到的段落。',
    confirmTitle: '确认', confirmText: n => n ? `为 ${n} 份报告创建勘误草稿并更新跟踪位置？原报告和 PDF 不会被修改。`
      : '更新跟踪位置？不会创建勘误草稿。',
    confirm: '确认', back: '返回', applying: '保存中…',
    conflict: '自本次比较以来文件或跟踪列表已更改，请重新预览。', previewAgain: '重新预览',
    applied: n => n ? `已创建 ${n} 份勘误草稿。` : '已更新跟踪位置。', drafts: '勘误草稿', openDraft: '打开',
    error: '错误', archivedOpen: '查看存档 PDF',
  },
};

const DEFAULT_CLASSES = {
  dialog: 'modal', button: 'btn', primary: 'btn primary', danger: 'btn danger', field: 'field', input: 'input',
};

// Server numeric tokens: optional sign (ASCII '-', typographic '−' U+2212, or '+'), digits with an optional
// decimal dot, optional exponent whose sign may use either minus glyph. Commas are separators, never part
// of a number, so "1,2" yields two tokens.
const NUM_RE = /[-+−]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+−]?\d+)?/g;
const toNumber = s => Number(String(s).trim().replace(/−/g, '-'));
let uid = 0;
const nextId = p => `errata-${p}-${++uid}`;

/** Element builder: strings become text nodes; never parses HTML. */
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

const isConflict = e => e?.status === 409;
const errText = e => (e && (e.error || e.message)) ? String(e.error || e.message) : String(e);
const fmt = v => (typeof v === 'number' && Number.isFinite(v))
  ? v.toLocaleString(undefined, { maximumSignificantDigits: 3 }) : String(v ?? '—');
const exact = v => (v == null ? '—' : String(v));
const basename = p => String(p || '').split('/').pop();

export function createErrata(host) {
  const { api } = host;
  if (typeof api !== 'function') throw new Error('errata-ui: host.api is required');
  const C = { ...DEFAULT_CLASSES, ...(host.classes || {}) };
  const lang = () => (String(host.getLang?.() || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en');
  const t = () => STR[lang()];
  const toast = msg => { try { host.toast ? host.toast(msg) : console.info(msg); } catch { /* ignore */ } };
  const listFiles = () => [...(host.listFiles ? host.listFiles() : host.S?.files?.keys?.() || [])].map(String);
  const filesBy = ext => listFiles().filter(p => p.toLowerCase().endsWith(ext)).sort((a, b) => a.localeCompare(b));
  const pdfUrl = v => host.pdfUrl ? host.pdfUrl(v) : `/api/errata/pdf?version=${encodeURIComponent(v)}`;

  // Opening a report, draft or live source closes every errata dialog so nothing obscures it.
  const openLive = (path, id, fp) => {
    closeAll();
    if (host.openSource) host.openSource(path, id, fp);
    else host.openLink?.(path, id, null);
  };
  const openReport = path => { closeAll(); host.openNote?.(path); };

  const R = 'errata/';
  const call = {
    state: () => api('GET', R + 'state'),
    changes: () => api('GET', R + 'changes'),
    document: path => api('POST', R + 'document', {}, { path }),
    track: body => api('POST', R + 'track', {}, body),
    remove: (id, revision) => api('POST', R + 'remove', {}, { id, revision }),
    preview: (pdf, path, choices) => api('POST', R + 'preview', {}, cleanChoices({ pdf, path, choices })),
    apply: (pdf, path, choices, token) => api('POST', R + 'apply', {}, cleanChoices({ pdf, path, choices, token })),
  };
  function cleanChoices(body) {
    if (!body.choices || !Object.keys(body.choices).length) delete body.choices;
    return body;
  }

  // Document cache keyed by path; invalidated on file events, apply and reset.
  const docCache = new Map();
  async function loadDocument(path, fresh = false) {
    if (!fresh && docCache.has(path)) return docCache.get(path);
    const p = call.document(path);
    docCache.set(path, p);
    try { return await p; } catch (e) { docCache.delete(path); throw e; }
  }

  // ---------- generic dialog ----------
  const open = new Set();
  function closeAll() { for (const m of [...open]) m.close(); }
  function modal(title, { wide = false } = {}) {
    const prevFocus = document.activeElement;
    const titleId = nextId('title');
    const status = h('p', { class: 'errata-status', role: 'status', 'aria-live': 'polite' });
    const alert = h('p', { class: 'errata-alert', role: 'alert', hidden: true });
    const body = h('div', { class: 'errata-body' });
    const foot = h('div', { class: 'errata-foot' });
    const closeBtn = h('button', { type: 'button', class: `${C.button} errata-x`, 'aria-label': t().close, text: '×' });
    const dlg = h('dialog', { class: `${C.dialog} errata-dlg${wide ? ' errata-wide' : ''}`, 'data-native-selects': '', 'aria-labelledby': titleId },
      h('div', { class: 'errata-head' }, h('h2', { id: titleId, text: title }), closeBtn),
      alert, body, status, foot);
    const m = {
      dlg, body, foot,
      setStatus: msg => { status.textContent = msg || ''; },
      setError: msg => { alert.hidden = !msg; alert.textContent = msg || ''; },
      close: () => { if (dlg.open) dlg.close(); else finish(); },
      closed: false,
      closeOverlay: null,   // set while an archived PDF overlay is shown
    };
    function finish() {
      if (m.closed) return;
      m.closed = true; open.delete(m);
      m.closeOverlay?.({ restoreFocus: false });
      dlg.remove();
      if (prevFocus && prevFocus.isConnected) prevFocus.focus?.();
    }
    closeBtn.addEventListener('click', m.close);
    // Esc while an archived PDF is shown returns to the dialog content instead of closing it.
    dlg.addEventListener('cancel', ev => { if (m.closeOverlay) { ev.preventDefault(); m.closeOverlay(); } });
    dlg.addEventListener('close', finish);
    document.body.append(dlg);
    open.add(m);
    dlg.showModal();
    return m;
  }
  const btn = (label, onclick, cls = C.button, extra = {}) =>
    h('button', { type: 'button', class: cls, onclick, ...extra }, label);

  /** Labelled form control wrapper. */
  function field(label, control, hint) {
    const id = control.id || (control.id = nextId('f'));
    const hintEl = hint ? h('small', { id: id + '-hint', class: 'errata-hint', text: hint }) : null;
    if (hintEl) control.setAttribute('aria-describedby', hintEl.id);
    return h('div', { class: `${C.field} errata-field` }, h('label', { for: id, text: label }), control, hintEl);
  }
  const input = (attrs = {}) => h('input', { class: C.input, type: 'text', ...attrs });
  function datalistInput(options, attrs = {}) {
    const listId = nextId('dl');
    const dl = h('datalist', { id: listId }, options.map(o => h('option', { value: o })));
    const el = input({ list: listId, autocomplete: 'off', spellcheck: 'false', ...attrs });
    return { el, wrap: [el, dl] };
  }
  function badge(kind, text) { return h('span', { class: `errata-badge errata-${kind}`, text }); }

  /** Paragraph picker: filterable radio list (fieldset/legend), keyboard-native. */
  function paragraphPicker({ paragraphs, selectedId, onChange, legend, name }) {
    const L = t();
    const filter = input({ type: 'search', placeholder: L.filter, 'aria-label': L.filter });
    const list = h('div', { class: 'errata-paras' });
    const empty = h('p', { class: 'errata-hint', text: L.noParagraphs, hidden: true });
    const groupName = name || nextId('para');
    let current = selectedId;
    const rows = paragraphs.map(p => {
      const radio = h('input', { type: 'radio', name: groupName, value: p.id, checked: p.id === current });
      radio.addEventListener('change', () => { if (radio.checked) { current = p.id; onChange?.(p); } });
      const row = h('label', { class: 'errata-para' }, radio,
        h('span', { class: 'errata-para-id', text: p.id }), h('span', { class: 'errata-para-text', text: p.text }));
      row._search = `${p.id} ${p.text}`.toLowerCase();
      return row;
    });
    list.append(...rows);
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      let n = 0;
      for (const r of rows) { const show = !q || r._search.includes(q); r.hidden = !show; n += show; }
      empty.hidden = n > 0;
    });
    const fs = h('fieldset', { class: 'errata-fieldset' }, h('legend', { text: legend || L.paragraph }), filter, list, empty);
    queueMicrotask(() => list.querySelector('input:checked')?.closest('label')?.scrollIntoView?.({ block: 'nearest' }));
    return { el: fs, get value() { return current; } };
  }

  // =====================================================================
  // Archived PDF overlay (inside the current dialog, via host.mountPdf)
  // =====================================================================
  /**
   * Shows an archived snapshot in a bounded, scrolling PDF host inside dialog `m`, hiding the dialog body
   * (whose scroll position is kept). "Back" or Esc destroys the viewer and returns to the same place.
   * The paragraph is highlighted only once BOTH onReady has fired and the mount promise has resolved.
   */
  function showSnapshot(m, { version, page, source, fp, title, backLabel, returnFocus }) {
    const L = t();
    m.setError('');
    if (!version) { m.setError(L.noVersion); return; }
    if (typeof host.mountPdf !== 'function') { m.setError(L.pdfUnavailable); return; }
    m.closeOverlay?.({ restoreFocus: false });

    const pdfHost = h('div', { class: 'errata-pdf-host', tabindex: '0', 'aria-label': title });
    const back = btn(backLabel || L.back, () => closeOverlay(), C.primary);
    const ov = h('section', { class: 'errata-overlay', 'aria-label': title },
      h('div', { class: 'errata-overlay-bar' }, back, h('strong', { text: title }),
        h('span', { class: 'errata-hint' }, `${L.version} `, h('code', { text: String(version).slice(0, 12) }),
          source ? ` · ${L.paragraph} ${source}` : '')),
      pdfHost);
    const scroll = m.body.scrollTop;
    m.body.hidden = true; m.foot.hidden = true;
    m.body.after(ov);
    m.setStatus(L.pdfLoading);

    let ctl = null, ready = false, highlighted = false, disposed = false;
    const highlight = () => {
      if (disposed || highlighted || !ready || !ctl) return;
      highlighted = true;
      m.setStatus('');
      const fail = e => { if (!disposed) m.setError(`${L.error}: ${errText(e)}`); };
      try { Promise.resolve(ctl.goToSource?.({ page, source, fp })).catch(fail); } catch (e) { fail(e); }
    };
    function closeOverlay({ restoreFocus = true } = {}) {
      if (disposed) return;
      disposed = true;
      try { ctl?.destroy?.(); } catch { /* ignore */ }
      ctl = null;
      pdfHost.replaceChildren();
      ov.remove();
      m.body.hidden = false; m.foot.hidden = false;
      m.body.scrollTop = scroll;
      m.setStatus('');
      if (m.closeOverlay === closeOverlay) m.closeOverlay = null;
      if (restoreFocus && returnFocus?.isConnected) returnFocus.focus();
    }
    m.closeOverlay = closeOverlay;

    let mounted;
    try {
      mounted = host.mountPdf(pdfHost, pdfUrl(version), {
        page, scale: 'page-width', onReady: () => { ready = true; highlight(); },
      });
    } catch (e) { mounted = Promise.reject(e); }
    Promise.resolve(mounted).then(c => {
      if (disposed) { try { c?.destroy?.(); } catch { /* ignore */ } return; }
      ctl = c; highlight();
    }, e => { if (!disposed) { m.setStatus(''); m.setError(`${L.error}: ${errText(e)}`); } });
    back.focus();
  }

  // =====================================================================
  // Track a paragraph
  // =====================================================================
  async function openTrack(opts = {}) {
    const L = t();
    let pdf = opts.pdf || '';
    const m = modal(L.trackTitle, { wide: true });
    const form = h('form', { class: 'errata-form', novalidate: true });
    m.body.append(form);

    if (!pdf) {
      const pdfs = filesBy('.pdf');
      const sel = h('select', { class: C.input }, h('option', { value: '', text: '—' }), pdfs.map(p => h('option', { value: p, text: p })));
      form.append(field(L.pickPdf, sel));
      m.foot.append(btn(L.cancel, m.close), btn(L.go, () => { if (sel.value) { m.close(); openTrack({ ...opts, pdf: sel.value }); } }, C.primary));
      sel.focus();
      return;
    }

    m.setStatus(L.loading);
    let doc;
    try { doc = await loadDocument(pdf, true); } catch (e) { m.setStatus(''); m.setError(`${L.error}: ${errText(e)}`); m.foot.append(btn(L.close, m.close)); return; }
    if (m.closed) return;
    m.setStatus('');
    if (opts.notice) m.setError(opts.notice);

    const st = { paragraph: null, kind: 'note', numberIndex: null, fp: null };
    const paras = doc.paragraphs || [];
    // Citation from the host: loc.source (paragraph id) and loc.fp (fingerprint at citation time).
    const citedSource = opts.source ?? opts.paragraph ?? null;
    const citedFp = opts.fp || null;
    let pre = citedSource ? paras.find(p => p.id === citedSource) : null;
    if (!pre && citedFp) pre = paras.find(p => p.fp === citedFp);
    // Keep the OLD citation fingerprint (not the current paragraph's) so the server can detect edited text.
    const preFp = pre ? (citedFp || pre.fp || null) : null;
    if (pre) { st.paragraph = pre; st.fp = preFp; }

    form.append(h('p', { class: 'errata-meta' }, h('span', { text: `${L.pickPdf}: ` }), h('code', { text: pdf }),
      h('span', { text: ` · ${L.version}: ` }), h('code', { text: String(doc.version || '').slice(0, 12) })));
    if (pre) form.append(h('p', { class: 'errata-hint', text: L.citedPara }));
    else if (opts.page) form.append(h('p', { class: 'errata-hint', text: L.citedPage(opts.page) }));

    const numbersBox = h('div', { class: 'errata-numbers', role: 'radiogroup', 'aria-label': L.number });
    const picker = paragraphPicker({
      paragraphs: paras, selectedId: st.paragraph?.id,
      onChange: p => { st.paragraph = p; st.fp = pre && p.id === pre.id ? preFp : null; st.numberIndex = null; renderNumbers(); },
    });
    form.append(picker.el);

    const reports = filesBy('.md');
    const rep = datalistInput(reports, { required: true, value: opts.report || '' });
    form.append(field(L.report, rep.el, L.reportHint), rep.wrap[1]);

    const kindName = nextId('kind');
    const kindFs = h('fieldset', { class: 'errata-fieldset errata-inline' }, h('legend', { text: L.kind }),
      ['note', 'calc'].map(k => h('label', {}, h('input', {
        type: 'radio', name: kindName, value: k, checked: st.kind === k,
        onchange: e => { st.kind = e.target.value; calcBox.hidden = st.kind !== 'calc'; },
      }), k === 'note' ? L.kindNote : L.kindCalc)));
    form.append(kindFs);

    // ---- calculation editor ----
    const calcBox = h('div', { class: 'errata-calc', hidden: true });
    const param = input({ placeholder: 'L', autocomplete: 'off' });
    const unit = input({ placeholder: 'm', autocomplete: 'off' });
    const numbersFs = h('fieldset', { class: 'errata-fieldset' }, h('legend', { text: L.number }), numbersBox);
    function renderNumbers() {
      numbersBox.replaceChildren();
      const text = st.paragraph?.text || '';
      const nums = text.match(NUM_RE) || [];
      if (!st.paragraph || !nums.length) { numbersBox.append(h('p', { class: 'errata-hint', text: st.paragraph ? L.noNumbers : L.needParagraph })); return; }
      const nm = nextId('num');
      if (st.numberIndex == null && nums.length === 1) st.numberIndex = 0;
      // numberIndex sent to the server stays zero-based; the visible label counts from 1.
      nums.forEach((n, i) => numbersBox.append(h('label', { class: 'errata-chip' },
        h('input', { type: 'radio', name: nm, value: String(i), checked: st.numberIndex === i, onchange: () => { st.numberIndex = i; } }),
        h('span', { text: n }), h('small', { text: ` #${i + 1}` }))));
    }
    renderNumbers();

    const csvFiles = filesBy('.csv');
    const inputsList = h('div', { class: 'errata-rows' });
    const stepsList = h('div', { class: 'errata-rows' });
    function addInput(init = {}) {
      const kindN = nextId('ik');
      const row = h('fieldset', { class: 'errata-fieldset errata-row' });
      const name = input({ value: init.name || '', autocomplete: 'off' });
      const val = input({ inputmode: 'decimal', value: init.value ?? '' });
      const csv = datalistInput(csvFiles, { value: init.csv || '' });
      const col = input({ value: init.column || '' });
      const r = h('input', { class: C.input, type: 'number', min: '1', step: '1', value: String(init.row || 1) });
      const valBox = h('div', { class: 'errata-grid' }, field(L.value, val));
      const csvBox = h('div', { class: 'errata-grid', hidden: true }, field(L.csv, csv.el), csv.wrap[1], field(L.column, col), field(L.row, r));
      let mode = init.csv ? 'csv' : 'value';
      const setMode = md => { mode = md; valBox.hidden = md !== 'value'; csvBox.hidden = md !== 'csv'; };
      row.append(h('legend', { text: `${L.inputs} ${inputsList.children.length + 1}` }),
        h('div', { class: 'errata-grid' }, field(L.name, name),
          h('div', { class: 'errata-inline', role: 'radiogroup', 'aria-label': L.inputs },
            ['value', 'csv'].map(md => h('label', {}, h('input', { type: 'radio', name: kindN, value: md, checked: mode === md, onchange: () => setMode(md) }),
              md === 'value' ? L.inputValue : L.inputCsv)))),
        valBox, csvBox,
        btn(L.remove, () => { row.remove(); }, `${C.button} errata-small`));
      setMode(mode);
      row._read = () => {
        const n = name.value.trim();
        if (!n) return null;
        if (mode === 'value') {
          // Same token rules as the server: decimal dot, ASCII or typographic minus; commas are rejected.
          const raw = val.value.trim();
          const ok = raw.match(NUM_RE)?.[0] === raw;
          const v = ok ? toNumber(raw) : NaN;
          return Number.isFinite(v) ? { name: n, value: v } : null;
        }
        const rowN = Number(r.value);
        return csv.el.value.trim() && col.value.trim() && Number.isInteger(rowN) && rowN >= 1
          ? { name: n, csv: csv.el.value.trim(), column: col.value.trim(), row: rowN } : null;
      };
      inputsList.append(row);
      return name;
    }
    function addStep(init = {}) {
      const row = h('fieldset', { class: 'errata-fieldset errata-row' });
      const name = input({ value: init.name || '', autocomplete: 'off' });
      const formula = input({ value: init.formula || '', spellcheck: 'false', autocomplete: 'off', placeholder: '4*pi^2*L/T^2' });
      const u = input({ value: init.unit || '' });
      row.append(h('legend', { text: `${L.steps} ${stepsList.children.length + 1}` }),
        h('div', { class: 'errata-grid' }, field(L.name, name), field(L.formula, formula), field(L.unit, u)),
        btn(L.remove, () => row.remove(), `${C.button} errata-small`));
      row._read = () => name.value.trim() && formula.value.trim()
        ? { name: name.value.trim(), formula: formula.value.trim(), unit: u.value.trim() } : null;
      stepsList.append(row);
      return name;
    }
    addStep();
    calcBox.append(
      h('div', { class: 'errata-grid' }, field(L.parameter, param), field(L.unit, unit)),
      numbersFs,
      h('h3', { text: L.inputs }), inputsList, btn(L.addInput, () => addInput().focus()),
      h('h3', { text: L.steps }), stepsList, btn(L.addStep, () => addStep().focus()));
    form.append(calcBox);

    const saveBtn = h('button', { type: 'submit', class: C.primary, text: L.save });
    saveBtn.setAttribute('form', form.id = nextId('form'));
    m.foot.append(btn(L.cancel, m.close), saveBtn);

    form.addEventListener('submit', async ev => {
      ev.preventDefault();
      m.setError('');
      const report = rep.el.value.trim();
      const fail = (msg, focusEl) => { m.setError(msg); focusEl?.focus?.(); };
      if (!st.paragraph) return fail(L.needParagraph, picker.el.querySelector('input[type=radio]') || picker.el.querySelector('input'));
      if (!report || !reports.includes(report)) return fail(L.needReport, rep.el);
      const body = { pdf, version: doc.version, source: st.paragraph.id, report };
      if (st.fp) body.fp = st.fp;
      if (st.kind === 'calc') {
        if (!param.value.trim()) return fail(L.needParam, param);
        if (st.numberIndex == null) return fail(L.needNumber, numbersBox.querySelector('input'));
        const inputs = [...inputsList.children].map(r => r._read());
        if (inputs.some(x => !x)) return fail(L.needInput, inputsList.querySelector('input'));
        const steps = [...stepsList.children].map(r => r._read());
        if (!steps.length || steps.some(x => !x)) return fail(L.needStep, stepsList.querySelector('input'));
        body.calculation = { parameter: param.value.trim(), numberIndex: st.numberIndex, unit: unit.value.trim(), inputs, steps };
      }
      saveBtn.disabled = true; saveBtn.textContent = L.saving; m.setStatus(L.saving);
      try {
        await call.track(body);
        toast(L.trackedOk);
        m.close();
        host.onTracked?.(body);
      } catch (e) {
        m.setStatus('');
        if (isConflict(e)) {
          // Citation text changed: drop the preselection, reload paragraphs, let the student choose again.
          m.close();
          openTrack({ pdf, page: opts.page, report, notice: L.tracked409 });
          return;
        }
        m.setError(`${L.error}: ${errText(e)}`);
      } finally { if (!m.closed) { saveBtn.disabled = false; saveBtn.textContent = L.save; } }
    });

    (st.paragraph ? rep.el : picker.el.querySelector('input[type=search]'))?.focus();
  }

  // =====================================================================
  // Tracked sources list
  // =====================================================================
  let trackedDlg = null;
  async function openTracked() {
    const L = t();
    if (trackedDlg && !trackedDlg.closed) { trackedDlg.dlg.focus(); return reloadTracked(); }
    const m = trackedDlg = modal(L.tracked, { wide: true });
    m.foot.append(btn(L.trackNew, () => { m.close(); openTrack({}); }), btn(L.close, m.close, C.primary));
    await reloadTracked();
  }
  async function reloadTracked(notice) {
    const m = trackedDlg; if (!m || m.closed) return;
    const L = t();
    const myGen = gen;
    m.closeOverlay?.({ restoreFocus: false });
    m.setError(''); m.setStatus(notice || L.checking);
    let state, changes;
    try { [state, changes] = await Promise.all([call.state(), call.changes()]); } catch (e) {
      if (m.closed || myGen !== gen) return;
      m.setStatus(''); m.setError(`${L.error}: ${errText(e)}`);
      m.body.replaceChildren(btn(L.retry, () => reloadTracked())); return;
    }
    if (m.closed || myGen !== gen) return;
    m.setStatus(notice || '');
    const docs = changes?.documents || [];
    lastChanges = docs;
    // tr.pdf is the series key (used for preview); tr.currentPath || tr.pdf is the live file after a replacement.
    const groups = new Map();
    for (const tr of state?.tracks || []) { if (!groups.has(tr.pdf)) groups.set(tr.pdf, []); groups.get(tr.pdf).push(tr); }
    if (!groups.size) { m.body.replaceChildren(h('p', { class: 'errata-hint', text: L.trackedEmpty })); return; }

    const sections = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([pdf, tracks]) => {
      const headId = nextId('g');
      const live = tracks.find(tr => tr.currentPath)?.currentPath || pdf;
      const docChanges = docs.filter(d => d.pdf === pdf);
      const sec = h('section', { class: 'errata-group', 'aria-labelledby': headId },
        h('div', { class: 'errata-group-head' },
          h('h3', { id: headId }, h('button', { type: 'button', class: 'errata-link', onclick: () => openLive(live), text: live })),
          live !== pdf ? h('span', { class: 'errata-hint' }, `${L.from}: `, h('code', { text: pdf })) : null,
          docChanges.map(d => badge(d.status, d.status === 'missing' ? L.docMissing : L.docUpdated))));
      const actions = h('div', { class: 'errata-actions' });
      for (const d of docChanges) {
        if (d.status === 'updated') actions.append(btn(`${L.compare}: ${basename(d.path)}`, () => openPreview(pdf, d.path), C.primary));
      }
      const replRow = h('div', { class: 'errata-inline', hidden: true });
      const showRepl = () => {
        replRow.hidden = false;
        if (!replRow.firstChild) {
          const sel = h('select', { class: C.input }, h('option', { value: '', text: '—' }),
            filesBy('.pdf').map(p => h('option', { value: p, text: p })));
          replRow.append(field(L.replacementLabel, sel), btn(L.go, () => sel.value && openPreview(pdf, sel.value), C.primary));
        }
        replRow.querySelector('select').focus();
      };
      const missing = docChanges.some(d => d.status === 'missing');
      actions.append(btn(missing ? L.chooseReplacement : L.compareWith, showRepl, missing ? C.primary : C.button));
      sec.append(actions, replRow);

      const ul = h('ul', { class: 'errata-tracks' });
      for (const tr of tracks) {
        let armed = false, timer;
        const rm = btn(L.removeTrack, async () => {
          if (!armed) { armed = true; rm.textContent = L.confirmRemove; timer = setTimeout(() => { armed = false; rm.textContent = L.removeTrack; }, 4000); return; }
          clearTimeout(timer); rm.disabled = true;
          try { await call.remove(tr.id, state.revision); toast(L.removed); reloadTracked(L.removed); }
          catch (e) { if (isConflict(e)) reloadTracked(L.stale); else { rm.disabled = false; m.setError(`${L.error}: ${errText(e)}`); } }
        }, C.danger, { 'aria-label': `${L.removeTrack}: ${tr.report} · ${tr.source}` });
        const c = tr.calculation;
        const trLive = tr.currentPath || tr.pdf;
        const arch = tr.version ? btn(L.archivedOpen, () => showSnapshot(m, {
          version: tr.version, page: tr.page, source: tr.source, fp: tr.fp,
          title: `${L.archivedOpen} · ${tr.pdf}`, backLabel: L.backToList, returnFocus: arch,
        })) : null;
        ul.append(h('li', { class: 'errata-track' },
          h('div', { class: 'errata-track-head' },
            h('button', { type: 'button', class: 'errata-link', onclick: () => openReport(tr.report), text: tr.report, 'aria-label': `${L.openReport}: ${tr.report}` }),
            badge('kind', c ? `${L.calc}: ${c.parameter}${c.unit ? ` [${c.unit}]` : ''}` : L.note)),
          h('blockquote', { class: 'errata-quote', text: tr.text || '' }),
          h('div', { class: 'errata-actions' },
            // The live file may differ from the cited text: navigate with the saved fingerprint.
            btn(`${L.openSource} (${tr.source})`, () => openLive(trLive, tr.source, tr.fp)),
            arch, rm)));
      }
      sec.append(ul);
      return sec;
    });
    m.body.replaceChildren(...sections);
  }

  // =====================================================================
  // Change detection (file events: create / modify / delete)
  // =====================================================================
  let lastChanges = [];
  let gen = 0;                       // bumped by reset(); stale async results are discarded
  const notified = new Set();
  const pending = new Set();         // PDF paths accumulated during the debounce window
  let checkTimer = null;
  function onFileChange(path, _type) {
    const p = String(path || '');
    if (!p.toLowerCase().endsWith('.pdf')) return;
    pending.add(p);
    clearTimeout(checkTimer);
    checkTimer = setTimeout(flushChanges, 400);
  }
  /** Bulk form: accepts the host's [type, path] pairs (or { type, path } objects). */
  function onFileEvents(events) {
    for (const ev of events || []) {
      const [type, p] = Array.isArray(ev) ? ev : [ev?.type, ev?.path];
      onFileChange(p, type);
    }
  }
  function flushChanges() {
    checkTimer = null;
    const paths = [...pending];
    pending.clear();
    if (!paths.length) return;
    for (const p of paths) docCache.delete(p);
    checkChanges().catch(() => {});
  }
  /** One GET changes for all documents; toasts each new (pdf, path, version, status) once. */
  async function checkChanges() {
    const myGen = gen;
    const res = await call.changes();
    if (myGen !== gen) return [];
    const docs = lastChanges = res?.documents || [];
    docCache.clear();
    const fresh = [];
    for (const d of docs) {
      const key = `${d.pdf}|${d.path}|${d.version}|${d.status}`;
      if (notified.has(key)) continue;
      notified.add(key);
      fresh.push(d.path || d.pdf);
    }
    if (fresh.length) toast(t().changedToast(fresh.join(', ')));
    host.onChanges?.(docs);
    if (trackedDlg && !trackedDlg.closed) reloadTracked();
    return docs;
  }
  /** Vault switch / state reset: drop timers, caches, notifications and open dialogs. */
  function reset() {
    gen++;
    clearTimeout(checkTimer); checkTimer = null;
    pending.clear(); notified.clear(); docCache.clear();
    lastChanges = [];
    closeAll();
    trackedDlg = null;
  }

  // =====================================================================
  // Preview / compare / apply
  // =====================================================================
  // item.affected (from the server) is the only decision for drafts; a missing report never drafts.
  const willDraft = it => it.affected === true && !it.reportMissing;
  const draftReports = items => [...new Set((items || []).filter(willDraft).map(i => i.report))];

  function numCell(v, other) {
    const shown = fmt(v);
    const full = exact(v);
    // If rounding hides a real difference, show the exact value; the title always carries it.
    const hidden = typeof v === 'number' && typeof other === 'number' && v !== other && fmt(v) === fmt(other);
    return h('td', { title: full !== shown ? full : null, text: hidden ? full : shown });
  }

  function valuesSuffix(o) {
    if (!o || !('from' in o || 'to' in o)) return null;
    return h('span', { class: 'errata-hint' }, ` (${exact(o.from)} → ${exact(o.to)})`);
  }

  /** Provenance of a result: CSV file / header / row or constant, parameter and formulas. */
  function renderCalculation(calc, openByDefault) {
    if (!calc) return null;
    const L = t();
    const inputs = (calc.inputs || []).map(inp => h('li', {},
      h('code', { text: inp.name || '?' }), ' ← ',
      inp.csv != null
        ? [h('code', { text: inp.csv }), ` · ${L.column}: `, h('q', { text: inp.column ?? '' }), ` · ${L.rowN(inp.row)}`,
          'value' in inp && !('from' in inp) ? ` = ${exact(inp.value)}` : '']
        : `${L.constant} ${exact(inp.value)}`,
      valuesSuffix(inp)));
    const steps = (calc.steps || []).map(s => h('li', {},
      h('code', { text: s.name || '?' }), ' = ', h('code', { text: s.formula || '' }),
      s.unit ? ` [${s.unit}]` : '', valuesSuffix(s)));
    return h('details', { class: 'errata-details', open: !!openByDefault },
      h('summary', { text: L.howCalc }),
      h('p', {}, `${L.parameter}: `, h('code', { text: calc.parameter || '' }), calc.unit ? ` [${calc.unit}]` : '',
        Number.isInteger(calc.numberIndex) ? ` · ${L.numberN(calc.numberIndex + 1)}` : ''),
      inputs.length ? [h('h4', { text: L.inputs }), h('ul', {}, inputs)] : null,
      steps.length ? [h('h4', { text: L.steps }), h('ol', {}, steps)] : null);
  }

  /** @param pdf series key (tr.pdf) @param path candidate/live file to compare against */
  async function openPreview(pdf, path, initialChoices = {}) {
    const L = t();
    const m = modal(L.previewTitle, { wide: true });
    const choices = { ...initialChoices };
    let res = null, busy = false;
    const cancelBtn = btn(L.cancel, m.close);
    const applyBtn = btn(L.applyBtn, () => showConfirm(), C.primary, { disabled: true });
    m.foot.append(cancelBtn, applyBtn);

    async function run() {
      busy = true; applyBtn.disabled = true; m.setError(''); m.setStatus(L.loading);
      m.body.setAttribute('aria-busy', 'true');
      try {
        const r = await call.preview(pdf, path, choices);
        if (m.closed) return;
        res = r;
        render();
      } catch (e) {
        if (m.closed) return;
        m.setError(`${L.error}: ${errText(e)}`);
        m.body.replaceChildren(btn(L.retry, run));
      } finally { busy = false; m.body.removeAttribute('aria-busy'); }
    }

    function render() {
      const items = res.items || [];
      const count = { changed: 0, moved: 0, unchanged: 0, open: 0, drafts: draftReports(items).length };
      for (const it of items) {
        if (it.status === 'ambiguous' || it.status === 'missing') count.open++;
        else count[it.status] = (count[it.status] || 0) + 1;
      }
      const head = h('div', { class: 'errata-compare-head' },
        h('p', {}, h('strong', { text: `${L.from}: ` }), h('code', { text: res.pdf || pdf })),
        h('p', {}, h('strong', { text: `${L.to}: ` }), h('code', { text: res.path || path }),
          res.version ? h('span', { class: 'errata-hint', text: ` · ${L.version} ${String(res.version).slice(0, 12)}` }) : null),
        h('p', { class: 'errata-summary', text: L.summary(count) }));
      m.body.replaceChildren(head, ...items.map(renderItem));
      applyBtn.disabled = !res.canApply;
      applyBtn.title = res.canApply ? '' : L.cannotApply;
      m.setStatus(res.canApply ? L.summary(count) : L.cannotApply);
    }

    function renderItem(it) {
      const headId = nextId('it');
      const sec = h('section', { class: `errata-item errata-item-${it.status}`, 'aria-labelledby': headId });
      sec.append(h('div', { class: 'errata-item-head' },
        h('h3', { id: headId }, it.reportMissing
          ? h('code', { text: it.report || it.id })
          : h('button', { type: 'button', class: 'errata-link', onclick: () => openReport(it.report), text: it.report || it.id })),
        badge(it.status, L.st[it.status] || it.status),
        it.reportMissing ? badge('unavailable', L.reviewUnavailable) : null,
        choices[it.id] ? badge('chosen', L.chosen) : null));

      // Evidence: both snapshots open locally in the dialog; old = item.oldVersion, new = preview.version.
      const evidence = h('div', { class: 'errata-evidence' });
      if (it.old) {
        const b = it.oldVersion ? btn(L.openOld, () => showSnapshot(m, {
          version: it.oldVersion, page: it.old.page, source: it.old.id, fp: it.old.fp,
          title: `${L.snapOld} · ${it.old.id}`, backLabel: L.backToCompare, returnFocus: b,
        }), `${C.button} errata-small`) : null;
        evidence.append(h('div', { class: 'errata-old' },
          h('h4', { text: `${L.oldPara} · ${it.old.id}` }), h('blockquote', { class: 'errata-quote', text: it.old.text || '' }),
          h('div', { class: 'errata-actions' }, b)));
      }
      if (it.new) {
        const b = res.version ? btn(L.openNew, () => showSnapshot(m, {
          version: res.version, page: it.new.page, source: it.new.id, fp: it.new.fp,
          title: `${L.snapNew} · ${it.new.id}`, backLabel: L.backToCompare, returnFocus: b,
        }), `${C.button} errata-small`) : null;
        evidence.append(h('div', { class: 'errata-new' },
          h('h4', { text: `${L.newPara} · ${it.new.id}` }), h('blockquote', { class: 'errata-quote', text: it.new.text || '' }),
          h('div', { class: 'errata-actions' }, b,
            btn(L.openLive, () => openLive(res.path || path, it.new.id, it.new.fp), `${C.button} errata-small`))));
      }
      if (evidence.childNodes.length) sec.append(evidence);

      if (it.results?.length) {
        const capId = nextId('cap');
        sec.append(h('table', { class: 'errata-results', 'aria-describedby': capId },
          h('caption', { id: capId, text: L.results }),
          h('tbody', {}, it.results.map(r => h('tr', {},
            h('th', { scope: 'row', text: r.name }),
            numCell(r.from, r.to), h('td', { 'aria-hidden': 'true', text: '→' }),
            Object.assign(numCell(r.to, r.from), { className: r.from !== r.to ? 'errata-diff' : '' }),
            h('td', { text: r.unit || '' }))))));
      }
      if (it.reason) sec.append(h('p', { class: 'errata-reason', text: it.reason }));
      const calcDetails = renderCalculation(it.calculation, willDraft(it));
      if (calcDetails) sec.append(calcDetails);

      let outcome;
      if (it.reportMissing) outcome = L.reportMissing;
      else if (it.status === 'ambiguous' || it.status === 'missing') outcome = L.mustChoose;
      else if (willDraft(it)) {
        const same = it.results?.length && it.results.every(r => r.from === r.to);
        outcome = same ? `${L.willDraft(it.report)} ${L.affectedSame}` : L.willDraft(it.report);
      }
      else if (it.status === 'moved') outcome = L.willMove;
      else if (it.status === 'unchanged') outcome = L.noChange;
      else outcome = L.notAffected;
      sec.append(h('p', { class: `errata-outcome${it.reportMissing ? ' errata-unavailable' : ''}`, text: outcome }));

      // Manual choice
      const current = choices[it.id] || it.new?.id;
      if (it.candidates?.length) {
        const nm = nextId('cand');
        sec.append(h('fieldset', { class: 'errata-fieldset' }, h('legend', { text: L.candidates }),
          it.candidates.map(c => h('label', { class: 'errata-para' },
            h('input', { type: 'radio', name: nm, value: c.id, checked: c.id === current, onchange: () => choose(it.id, c.id) }),
            h('span', { class: 'errata-para-id', text: c.id }), h('span', { class: 'errata-para-text', text: c.text || '' })))));
      }
      if (it.status !== 'unchanged' || it.candidates?.length) {
        const slot = h('div', { class: 'errata-choose' });
        const b = btn(L.chooseOther, async () => {
          b.disabled = true; m.setStatus(L.loading);
          try {
            const d = await loadDocument(res.path || path);
            if (m.closed) return;
            let picked = current;
            const pk = paragraphPicker({ paragraphs: d.paragraphs || [], selectedId: current, legend: L.allParagraphs, onChange: p => { picked = p.id; } });
            slot.replaceChildren(pk.el, h('div', { class: 'errata-actions' },
              btn(L.cancel, () => { slot.replaceChildren(b); b.disabled = false; b.focus(); }),
              btn(L.useThis, () => picked && choose(it.id, picked), C.primary)));
            m.setStatus('');
            pk.el.querySelector('input[type=search]')?.focus();
          } catch (e) { b.disabled = false; m.setStatus(''); m.setError(`${L.error}: ${errText(e)}`); }
        }, `${C.button} errata-small`);
        slot.append(b);
        sec.append(slot);
      }
      return sec;
    }

    function choose(trackId, paragraphId) {
      if (busy) return;
      choices[trackId] = paragraphId;
      run();
    }

    function showConfirm() {
      if (!res?.canApply || busy) return;
      const reports = draftReports(res.items);   // distinct report paths with affected bindings
      const box = h('div', { class: 'errata-confirm', role: 'group', 'aria-label': L.confirmTitle },
        h('p', { text: L.confirmText(reports.length) }),
        reports.length ? h('ul', {}, reports.map(r => h('li', {}, h('code', { text: r })))) : null);
      const back = btn(L.back, () => { box.remove(); m.foot.replaceChildren(cancelBtn, applyBtn); applyBtn.focus(); });
      const ok = btn(L.confirm, () => doApply(ok), C.primary);
      m.body.append(box);
      m.foot.replaceChildren(back, ok);
      box.scrollIntoView?.({ block: 'nearest' });
      ok.focus();
    }

    async function doApply(okBtn) {
      okBtn.disabled = true; busy = true; m.setError(''); m.setStatus(L.applying);
      try {
        const out = await call.apply(pdf, res.path || path, choices, res.token);
        const drafts = out?.drafts || [];
        try { await host.sync?.(); } catch { /* tree refresh best-effort */ }
        docCache.clear();
        if (m.closed) return;
        toast(L.applied(drafts.length));
        m.setStatus(L.applied(drafts.length));
        const done = btn(L.close, m.close, C.primary);
        m.body.replaceChildren(h('p', { class: 'errata-summary', text: L.applied(drafts.length) }),
          drafts.length ? h('section', {}, h('h3', { text: L.drafts }), h('ul', { class: 'errata-tracks' },
            drafts.map(d => h('li', {}, h('code', { text: d }), ' ', btn(L.openDraft, () => openReport(d), `${C.button} errata-small`, { 'aria-label': `${L.openDraft}: ${d}` }))))) : null);
        m.foot.replaceChildren(done);
        done.focus();
        host.onApplied?.(out);
        if (trackedDlg && !trackedDlg.closed) reloadTracked();
      } catch (e) {
        busy = false; m.setStatus('');
        if (isConflict(e)) {
          m.setError(L.conflict);
          const again = btn(L.previewAgain, () => { m.foot.replaceChildren(cancelBtn, applyBtn); run(); }, C.primary);
          m.foot.replaceChildren(cancelBtn, again);
          again.focus();
        } else {
          okBtn.disabled = false;
          m.setError(`${L.error}: ${errText(e)}`);
        }
      }
    }

    await run();
    if (!m.closed) m.body.querySelector('input[type=radio]:not(:checked), button')?.focus();
  }

  // ---------- host helpers ----------
  /**
   * Toolbar button. getCtx() returns the entry's retained citation { pdf, page, source, fp }
   * (host keeps loc.source / loc.fp separately because S.pdf.loc is consumed after scrolling).
   * The label is refreshed on hover/focus/click so it reflects the current citation and language.
   */
  function toolbarButton(getCtx, { className = 'fv-btn' } = {}) {
    const b = h('button', { type: 'button', class: className, 'data-fv': 'errata' });
    const refresh = () => {
      const L = t();
      const c = getCtx?.() || {};
      const label = c.source || c.paragraph || c.fp ? L.toolbarCite : L.toolbar;
      b.textContent = label; b.title = label; b.setAttribute('aria-label', label);
    };
    b.addEventListener('pointerenter', refresh);
    b.addEventListener('focus', refresh);
    b.addEventListener('click', () => { refresh(); const c = getCtx?.(); if (c?.pdf) openTrack(c); else openTrack({}); });
    b.refresh = refresh;
    refresh();
    return b;
  }
  /** Inserts the toolbar button right after `.pdf-summary` inside `.fv-bar` (idempotent). */
  function mountToolbar(bar, getCtx) {
    if (!bar) return null;
    bar.querySelector('[data-fv="errata"]')?.remove();
    const summary = bar.querySelector('.pdf-summary');
    const cls = summary
      ? `${summary.className.replace(/\bpdf-summary\b/g, '').trim()} errata-toolbar`.trim()
      : 'fv-btn errata-toolbar';
    const b = toolbarButton(getCtx, { className: cls });
    if (summary) summary.after(b); else bar.append(b);
    return b;
  }
  /** Command palette entries: { id, name, label (localized), run }. */
  function commands(getCurrentPdf) {
    const L = t();
    return [
      { id: 'errata.tracked', name: STR.en.paletteTracked, label: L.paletteTracked, run: () => openTracked() },
      { id: 'errata.track', name: STR.en.paletteTrack, label: L.paletteTrack, run: () => openTrack({ pdf: getCurrentPdf?.() || '' }) },
    ];
  }
  function labels() { return t(); }
  function destroy() { reset(); }

  return { openTrack, openTracked, openPreview, onFileChange, onFileEvents, checkChanges, reset,
    toolbarButton, mountToolbar, commands, labels, destroy,
    get changes() { return lastChanges; } };
}

export default createErrata;
