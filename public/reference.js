import { t } from '/i18n.js';
import { mountPdf } from '/pdfview.js';

// A reference has its own viewer. Editing, saving, and undo remain in the ordinary note editor.
export function createReferencePane({ store, vault, files, url, choose, cite, layout }) {
  const pane = document.getElementById('reference-pane');
  const el = id => document.getElementById('reference-' + id);
  const panelName = el('name'), viewer = el('viewer'), pageInput = el('page');
  const previous = el('prev'), next = el('next'), insert = el('cite');
  let library = null, pin = null, session = null;
  const key = () => 'reference:' + library;
  const valid = path => typeof path === 'string' && /\.pdf$/i.test(path) && files().has(path);
  const pageNumber = n => Number.isInteger(n) && n > 0 ? n : 1;

  function unload() {
    const old = session;
    session = null;
    old?.ctl?.destroy();
    viewer.replaceChildren();
  }
  function controls() {
    const state = session?.ready && session.ctl ? session.state : null;
    previous.disabled = !state || state.page <= 1;
    next.disabled = !state || state.page >= state.pages;
    pageInput.disabled = insert.disabled = !state;
    if (document.activeElement !== pageInput) pageInput.value = state ? String(state.page) : '';
    pageInput.setAttribute('aria-label', t('pdf.page'));
    el('pages').textContent = state ? '/ ' + state.pages : '';
  }
  function message(target, text) {
    const msg = document.createElement('p');
    msg.className = 'reference-message'; msg.textContent = text;
    target.replaceChildren(msg);
  }
  async function load() {
    const host = document.createElement('div');
    host.className = 'pdf-host';
    viewer.replaceChildren(host);
    const active = session = { path: pin.path, ctl: null, ready: false, state: null };
    controls();
    message(host, t('pdf.loading'));
    try {
      const ctl = await mountPdf(host, url(pin.path), {
        page: pin.page, scale: 'page-width',
        onState(state) {
          if (active !== session) return;
          active.state = state;
          if (active.ready && pin.page !== state.page) {
            pin.page = state.page;
            store.set(key(), pin);
          }
          controls();
        },
        onReady(state) {
          if (active !== session) return;
          active.state = state; active.ready = true;
          if (pin.page !== state.page) { pin.page = state.page; store.set(key(), pin); }
          controls();
        },
      });
      if (active !== session) { ctl.destroy(); return; }
      active.ctl = ctl;
      controls();
    } catch (err) {
      if (active === session) message(host, t('pdf.failed', { msg: err.message || String(err) }));
    }
  }
  function select(path, page) {
    if (!valid(path) || !library) return;
    if (page == null && pin?.path === path) return;
    unload();
    pin = { path, page: pageNumber(page) };
    store.set(key(), pin);
    layout();
  }
  function clear() {
    unload();
    pin = null;
    if (library) store.set(key(), null);
  }
  function refresh(editing) {
    if (vault() !== library) {
      unload(); library = vault();
      const saved = library && store.get(key(), null);
      pin = saved && valid(saved.path) ? { path: saved.path, page: pageNumber(saved.page) } : null;
    }
    if (pin && !valid(pin.path)) clear();
    const show = !!(pin && editing);
    pane.hidden = !show;
    document.getElementById('doc').classList.toggle('has-reference', show);
    document.getElementById('main').classList.toggle('has-reference', show);
    if (show) {
      panelName.textContent = pin.path.split('/').pop(); panelName.title = pin.path;
      if (!session) load();
      else controls();
    } else if (session) unload();
    return show;
  }
  el('change').onclick = choose;
  el('close').onclick = () => { clear(); layout(); };
  previous.onclick = () => session?.ctl?.goTo(session.ctl.page - 1);
  next.onclick = () => session?.ctl?.goTo(session.ctl.page + 1);
  pageInput.onfocus = () => pageInput.select();
  pageInput.onblur = () => { if (session?.ctl) pageInput.value = String(session.ctl.page); };
  pageInput.onkeydown = e => {
    if (e.key === 'Enter') { const page = Number(pageInput.value); if (Number.isInteger(page) && page > 0) session?.ctl?.goTo(page); pageInput.blur(); }
    if (e.key === 'Escape') pageInput.blur();
  };
  insert.onclick = () => { if (session?.ready && session.ctl) cite(pin.path, session.ctl.page); };
  return {
    select, refresh,
    rename(map) {
      if (!pin || map(pin.path) === pin.path) return;
      select(map(pin.path), pin.page);
    },
  };
}
