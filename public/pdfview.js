// PDF viewer built on PDF.js, so PDFs show inside the app with text you can select (for the selection bar:
// Add to note, Ask Graphie, …), fit the pane width as it changes size, zoom, and reopen where you left off.
// PDF.js is loaded the first time a PDF is opened.

let lib = null;
async function loadLib() {
  if (lib) return lib;
  const pdfjs = await import('/lib/pdfjs/build/pdf.min.mjs');
  globalThis.pdfjsLib = pdfjs; // the viewer module reads PDF.js from here
  pdfjs.GlobalWorkerOptions.workerSrc = '/lib/pdfjs/build/pdf.worker.min.mjs';
  const viewer = await import('/lib/pdfjs/web/pdf_viewer.mjs');
  if (!document.getElementById('pdfjs-css')) {
    const link = Object.assign(document.createElement('link'), { id: 'pdfjs-css', rel: 'stylesheet', href: '/lib/pdfjs/web/pdf_viewer.css' });
    document.head.append(link);
  }
  lib = { pdfjs, viewer };
  return lib;
}

// The text of a PDF, page by page ("" for scanned pages without a text layer). Used to send exam papers to an AI.
// The text of a PDF, page by page. All pages unless `only` (a list of page numbers) is given.
// Returns { pages: [{ n, text }], numPages, empty: [page numbers with no text, e.g. scanned pages] }.
// `pages` is also usable as a plain list of strings through .map(p => p.text).
export async function pdfText(src, { only = null, onProgress = null } = {}) {
  const { pdfjs } = await loadLib();
  const doc = await pdfjs.getDocument({ url: src, cMapUrl: '/lib/pdfjs/cmaps/', cMapPacked: true }).promise;
  // A given list is used exactly: an empty or out-of-range list never turns into "the whole document".
  const want = only ? only.filter(n => n >= 1 && n <= doc.numPages) : Array.from({ length: doc.numPages }, (_, i) => i + 1);
  if (only && want.length !== only.length) throw Object.assign(new Error(`page ${only.find(n => n < 1 || n > doc.numPages)} is outside 1–${doc.numPages}`), { code: 'range' });
  const pages = [], empty = [];
  for (const n of want) {
    const tc = await (await doc.getPage(n)).getTextContent();
    let line = '', out = '';
    for (const it of tc.items) { line += it.str; if (it.hasEOL) { out += line + '\n'; line = ''; } }
    const text = (out + line).trim();
    pages.push({ n, text });
    if (!text) empty.push(n);
    onProgress?.(pages.length, want.length);
  }
  return { pages, numPages: doc.numPages, empty };
}
export async function pdfPageCount(src) { const { pdfjs } = await loadLib(); return (await pdfjs.getDocument({ url: src }).promise).numPages; }
// "1-5, 8, 10-12" → [1,2,3,4,5,8,10,11,12]. Only an empty field means "all pages" (null).
// Anything else must name real pages: page 0, a page past `max` (the document's page count) or a range that
// runs past it is an error, never silently "all pages" or a quietly shortened range. The thrown Error has
// .code 'syntax' | 'zero' | 'range' and .part (the piece of input at fault), .max (the page count).
export function parsePages(str, max) {
  const out = new Set();
  const fail = (code, part) => { throw Object.assign(new Error(part), { code, part, max }); };
  const s = String(str || '').trim().replace(/\s*([-–—~～])\s*/g, '$1');
  if (!s) return null;
  for (const part of s.split(/[,，;；\s]+/).filter(Boolean)) {
    const m = part.match(/^(\d+)(?:[-–—~～](\d+))?$/);
    if (!m) fail('syntax', part);
    const a = +m[1], b = m[2] ? +m[2] : a;
    if (a < 1 || b < 1) fail('zero', part);
    if (max && Math.max(a, b) > max) fail('range', part);
    for (let i = Math.min(a, b); i <= Math.max(a, b); i++) out.add(i);
  }
  return [...out].sort((x, y) => x - y);
}
// [1,2,3,5,7,8] → "1–3, 5, 7–8"
export function pageRanges(list) {
  const out = []; let a = null, b = null;
  for (const n of [...list].sort((x, y) => x - y)) { if (a != null && n === b + 1) b = n; else { if (a != null) out.push(a === b ? `${a}` : `${a}–${b}`); a = b = n; } }
  if (a != null) out.push(a === b ? `${a}` : `${a}–${b}`);
  return out.join(', ');
}

const FIT = new Set(['page-width', 'page-fit', 'auto']);

// Show the PDF at `src` inside `host` (an empty element). Returns a controller.
// opts: { page, scale, onState({ page, pages, scale, scaleValue }) }
export async function mountPdf(host, src, opts = {}) {
  const { pdfjs, viewer: V } = await loadLib();
  host.innerHTML = '<div class="pdf-scroll"><div class="pdfViewer"></div></div>';
  const container = host.firstElementChild;
  const eventBus = new V.EventBus();
  const linkService = new V.PDFLinkService({ eventBus, externalLinkTarget: V.LinkTarget.BLANK });
  const findController = new V.PDFFindController({ eventBus, linkService });
  // The annotation editor is off: it isn't used here, and it listens for drag-and-drop on the whole page.
  const viewer = new V.PDFViewer({ container, eventBus, linkService, findController, removePageBorders: false, annotationEditorMode: pdfjs.AnnotationEditorType.DISABLE });
  linkService.setViewer(viewer);

  const task = pdfjs.getDocument({
    url: src,
    cMapUrl: '/lib/pdfjs/cmaps/', cMapPacked: true, // Chinese / Japanese / Korean text
    standardFontDataUrl: '/lib/pdfjs/standard_fonts/',
    wasmUrl: '/lib/pdfjs/wasm/', iccUrl: '/lib/pdfjs/iccs/',
  });
  const doc = await task.promise;
  let destroyed = false;
  const state = () => ({ page: viewer.currentPageNumber, pages: doc.numPages, scale: viewer.currentScale, scaleValue: viewer.currentScaleValue });
  const emit = () => { if (!destroyed) opts.onState?.(state()); };

  eventBus.on('pagesinit', () => {
    viewer.currentScaleValue = opts.scale && (FIT.has(opts.scale) || +opts.scale > 0) ? String(opts.scale) : 'page-width';
    if (opts.page > 1) viewer.currentPageNumber = Math.min(opts.page, doc.numPages);
    emit();
    if (!destroyed) opts.onReady?.(state());
  });
  eventBus.on('pagechanging', emit);
  eventBus.on('scalechanging', emit);
  viewer.setDocument(doc);
  linkService.setDocument(doc);
  findController.setDocument(doc); // the viewer only does this in PDF.js's full app

  // Follow the pane's size: a "fit" zoom is recalculated when the window or sidebars change width.
  let timer = 0;
  const ro = new ResizeObserver(() => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (!destroyed && FIT.has(viewer.currentScaleValue)) viewer.currentScaleValue = viewer.currentScaleValue; }, 60);
  });
  ro.observe(container);

  // Ctrl + mouse wheel zooms around the PDF (instead of zooming the whole app).
  container.addEventListener('wheel', e => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1);
  }, { passive: false });

  function zoomBy(f) {
    viewer.currentScale = Math.max(0.25, Math.min(5, Math.round(viewer.currentScale * f * 100) / 100));
  }

  return {
    get page() { return viewer.currentPageNumber; },
    get pages() { return doc.numPages; },
    goTo(n) { n = Math.max(1, Math.min(doc.numPages, n | 0)); viewer.currentPageNumber = n; },
    zoomIn: () => zoomBy(1.15),
    zoomOut: () => zoomBy(1 / 1.15),
    setScale(v) { viewer.currentScaleValue = String(v); },
    find(query, { again = false, previous = false } = {}) {
      eventBus.dispatch('find', { source: null, type: again ? 'again' : '', query, caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false });
    },
    onFind(cb) { eventBus.on('updatefindmatchescount', e => cb(e.matchesCount)); eventBus.on('updatefindcontrolstate', e => cb(e.matchesCount, e.state)); },
    // Page number that contains a DOM node (for links to the page a selection came from).
    pageOf(node) {
      const el = node && (node.nodeType === 1 ? node : node.parentElement);
      const p = el?.closest?.('.page[data-page-number]');
      return p ? Number(p.dataset.pageNumber) : viewer.currentPageNumber;
    },
    destroy() {
      destroyed = true;
      ro.disconnect();
      try { viewer.cleanup(); viewer.setDocument(null); linkService.setDocument(null); findController.setDocument(null); } catch { /* ignore */ }
      task.destroy();
      host.innerHTML = '';
    },
  };
}
