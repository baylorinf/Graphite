// Every plain <select> in Graphite is drawn as the same styled dropdown as the AI picker (aipicker.js): a button
// showing the choice, and a rounded list with a check on the current option. The <select> stays in the page,
// out of sight, as the value everyone reads and sets (value, selectedIndex, change events, selectOption in tests).
// Long lists (fonts, folders, courses) get a filter box. Keyboard: ↑/↓, Home/End, Enter, Esc, and typing filters.
// Skipped: <select multiple>, list boxes (size > 1), [data-native], and the AI pickers (aipicker.js draws those).
import { t } from '/i18n.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK = '<svg viewBox="0 0 24 24" class="aip-check" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" class="aip-chev" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
const SEARCH_FROM = 9; // options before a filter box appears
const proto = Object.getOwnPropertyDescriptors(HTMLSelectElement.prototype);
let seq = 0, openDD = null;

const skip = s => s.multiple || s.size > 1 || s.dataset.native != null || s.dataset.aip || s.dataset.aipJob != null || s.classList.contains('aip-native') || s.closest('[data-native-selects]');
export function enhanceSelect(select) {
  if (!select || select._gdd || skip(select)) return null;
  const id = 'gdd-' + (++seq);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'gdd-btn';
  btn.setAttribute('aria-haspopup', 'listbox');
  btn.setAttribute('aria-expanded', 'false');
  btn.dataset.gddFor = select.id || select.dataset.f || select.name || '';
  // Keep the size it had: a fixed width, or the room it took.
  const w = select.offsetWidth;
  if (select.style.width) btn.style.width = select.style.width; else if (w) btn.style.minWidth = Math.min(w, 420) + 'px';
  select.after(btn);
  select.classList.add('gdd-native');
  select.tabIndex = -1;
  select.setAttribute('aria-hidden', 'true');

  const label = () => select.getAttribute('aria-label') || select.labels?.[0]?.querySelector('span')?.textContent || select.labels?.[0]?.textContent?.trim() || select.title || '';
  const draw = () => {
    const o = select.options[select.selectedIndex];
    btn.innerHTML = `<span class="gdd-value"${o?.style.fontFamily ? ` style="font-family:${esc(o.style.fontFamily)}"` : ''}>${esc(o ? o.textContent : '')}</span>${CHEV}`;
    btn.disabled = select.disabled;
    btn.hidden = select.hidden || select.style.display === 'none';
    btn.title = select.title || '';
    const l = label(); if (l) btn.setAttribute('aria-label', l + (o ? ': ' + o.textContent : ''));
    if (openDD?.select === select) openDD.render();
  };
  // A value set by code (select.value = …) shows at once, without a change event.
  for (const prop of ['value', 'selectedIndex']) {
    Object.defineProperty(select, prop, { configurable: true, get() { return proto[prop].get.call(this); }, set(v) { proto[prop].set.call(this, v); draw(); } });
  }
  const mo = new MutationObserver(draw);
  mo.observe(select, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'style', 'title', 'selected', 'label'] });
  select.addEventListener('change', draw);
  select.addEventListener('focus', () => btn.focus());
  btn.addEventListener('click', () => (openDD?.select === select ? closeDD(true) : openList(select, btn, id)));
  btn.addEventListener('keydown', e => {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key) && !openDD) { e.preventDefault(); openList(select, btn, id); }
    else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) { e.preventDefault(); openList(select, btn, id, e.key); }
  });
  select._gdd = {
    btn, draw,
    destroy() { mo.disconnect(); for (const p of ['value', 'selectedIndex']) delete select[p]; btn.remove(); select.classList.remove('gdd-native'); select.removeAttribute('aria-hidden'); select.tabIndex = 0; delete select._gdd; },
  };
  draw();
  return select._gdd;
}

function closeDD(focus = false) {
  if (!openDD) return;
  const { pop, btn } = openDD;
  pop.remove(); btn.setAttribute('aria-expanded', 'false'); btn.classList.remove('is-open');
  openDD = null;
  if (focus) btn.focus();
}
function openList(select, btn, id, typed = '') {
  closeDD();
  const all = [...select.options];
  const pop = document.createElement('div');
  pop.className = 'aip-pop gdd-pop';
  const searchable = all.length >= SEARCH_FROM;
  pop.innerHTML = `${searchable ? `<input type="search" class="gdd-search" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="${id}-list" aria-autocomplete="list" placeholder="${esc(t('dd.search'))}" aria-label="${esc(t('dd.search'))}">` : ''}<div class="gdd-list" role="listbox" id="${id}-list" tabindex="-1"></div>`;
  document.body.append(pop);
  const list = pop.querySelector('.gdd-list'), search = pop.querySelector('.gdd-search');
  let shown = [], active = 0;
  const render = () => {
    const q = (search?.value || '').trim().toLowerCase();
    shown = all.filter(o => !o.hidden && (!q || o.textContent.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)));
    active = Math.max(0, Math.min(active, shown.length - 1));
    let group = null;
    list.innerHTML = shown.map((o, i) => {
      const g = o.parentElement.tagName === 'OPTGROUP' ? o.parentElement.label : null;
      const head = g !== group ? (group = g, g ? `<div class="aip-head">${esc(g)}</div>` : '') : '';
      const on = o.index === select.selectedIndex;
      return `${head}<div role="option" id="${id}-o${i}" class="aip-opt gdd-opt${on ? ' is-on' : ''}${i === active ? ' is-active' : ''}${o.disabled ? ' is-disabled' : ''}" data-i="${i}" aria-selected="${on}"${o.disabled ? ' aria-disabled="true"' : ''}><span class="aip-name"${o.style.fontFamily ? ` style="font-family:${esc(o.style.fontFamily)}"` : ''}>${esc(o.textContent)}</span>${on ? CHECK : ''}</div>`;
    }).join('') || `<div class="gdd-none">${esc(t('dd.none'))}</div>`;
    (search || list).setAttribute('aria-activedescendant', shown.length ? `${id}-o${active}` : '');
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };
  const choose = i => {
    const o = shown[i];
    if (!o || o.disabled) return;
    const changed = o.index !== select.selectedIndex;
    select.selectedIndex = o.index;
    closeDD(true);
    if (changed) { select.dispatchEvent(new Event('input', { bubbles: true })); select.dispatchEvent(new Event('change', { bubbles: true })); }
  };
  const step = d => { if (!shown.length) return; let i = active; do { i = (i + d + shown.length) % shown.length; } while (shown[i].disabled && i !== active); active = i; render(); };
  const onKey = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); step(e.key === 'ArrowDown' ? 1 : -1); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); active = e.key === 'Home' ? 0 : shown.length - 1; render(); }
    else if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); active = Math.max(0, Math.min(shown.length - 1, active + (e.key === 'PageDown' ? 8 : -8))); render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeDD(true); }
    else if (e.key === 'Tab') closeDD();
    else if (!search && e.key.length === 1 && /\S/.test(e.key)) {
      // Without a filter box, a letter jumps to the next option starting with it.
      const k = e.key.toLowerCase(), from = active + 1;
      const n = [...shown.slice(from), ...shown.slice(0, from)].find(o => o.textContent.trim().toLowerCase().startsWith(k));
      if (n) { active = shown.indexOf(n); render(); }
    }
  };
  pop.addEventListener('keydown', onKey);
  search?.addEventListener('input', () => { active = 0; render(); });
  list.addEventListener('mousedown', e => e.preventDefault());
  list.addEventListener('click', e => { const el = e.target.closest('[data-i]'); if (el) choose(+el.dataset.i); });
  list.addEventListener('mousemove', e => { const el = e.target.closest('[data-i]'); if (el && +el.dataset.i !== active) { active = +el.dataset.i; for (const x of list.querySelectorAll('.is-active')) x.classList.remove('is-active'); el.classList.add('is-active'); } });

  active = Math.max(0, all.filter(o => !o.hidden).indexOf(select.options[select.selectedIndex]));
  openDD = { select, btn, pop, render };
  btn.setAttribute('aria-expanded', 'true'); btn.classList.add('is-open');
  render();
  // Placed under the button (or above it when there is more room there), at least as wide as the button.
  const r = btn.getBoundingClientRect();
  const width = Math.min(Math.max(r.width, 200), innerWidth - 16);
  pop.style.minWidth = width + 'px'; pop.style.maxWidth = Math.max(width, Math.min(460, innerWidth - 16)) + 'px';
  const pw = pop.offsetWidth;
  pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + 'px';
  const below = innerHeight - r.bottom - 12, above = r.top - 12, h = Math.min(pop.offsetHeight, 420);
  if (h > below && above > below) { pop.style.bottom = (innerHeight - r.top + 6) + 'px'; pop.style.maxHeight = Math.min(420, above) + 'px'; }
  else { pop.style.top = (r.bottom + 6) + 'px'; pop.style.maxHeight = Math.min(420, below) + 'px'; }
  list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  if (search) { search.value = typed; if (typed) { active = 0; render(); } search.focus(); } else list.focus();
}

addEventListener('pointerdown', e => { if (openDD && !openDD.pop.contains(e.target) && !openDD.btn.contains(e.target)) closeDD(); }, true);
addEventListener('resize', () => closeDD());
// Esc closes the list before a dialog around it (Settings) sees the key and closes itself.
addEventListener('keydown', e => { if (e.key === 'Escape' && openDD) { e.preventDefault(); e.stopPropagation(); closeDD(true); } }, true);
addEventListener('scroll', e => { if (openDD && !openDD.pop.contains(e.target)) closeDD(); }, true);

// Upgrade every <select> that is in the page now or appears later. Done a moment later, so a picker that
// draws its own control (the AI picker) can claim the <select> first.
let queued = false;
function sweep() { queued = false; for (const s of document.querySelectorAll('select:not(.gdd-native)')) enhanceSelect(s); }
function queue() { if (!queued) { queued = true; setTimeout(sweep, 0); } }
new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1 && (n.tagName === 'SELECT' || n.querySelector?.('select'))) { queue(); return; } })
  .observe(document.documentElement, { childList: true, subtree: true });
queue();
