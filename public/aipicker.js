// A nicer picker for "which AI does this job", used instead of a plain <select> (Settings → AI, and the
// AI tool windows). The <select> stays in the page, hidden, as the value everyone reads; this draws a button
// showing the choice and a grouped list: Claude Code on this computer (with whether it is connected), API
// models with their model name (those without a key are shown with "Add key"), and Off where a job allows it.
import { t } from '/i18n.js';
import * as AI from '/ai.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CHECK = '<svg viewBox="0 0 24 24" class="aip-check" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const CHEV = '<svg viewBox="0 0 24 24" class="aip-chev" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
let openPop = null;
function closePop() { openPop?.remove(); openPop = null; }
addEventListener('pointerdown', e => { if (openPop && !openPop.contains(e.target) && !e.target.closest('.aip-btn')) closePop(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape' && openPop) { e.stopPropagation(); closePop(); } }, true);
addEventListener('resize', closePop);

function describe(v, f) {
  if (v === AI.CC) return { name: 'Claude Code', sub: t('aip.ccSub'), group: 'local' };
  if (AI.isLocal(v)) { const st = AI.fwStatus(v); return { name: AI.LOCAL[v].label, sub: st.text, group: 'local', ok: st.ok }; }
  if (v === 'off') return { name: t('ai.off'), sub: '', group: 'off' };
  const p = AI.parts(v, f);
  return { name: p.name, sub: p.model || '', group: 'api' };
}

// Any <select data-aip-job="…"> that appears in the page is upgraded automatically (the AI tool windows).
new MutationObserver(() => { for (const s of document.querySelectorAll('select[data-aip-job]:not([data-aip])')) enhanceAISelect(s, s.dataset.aipJob); })
  .observe(document.documentElement, { childList: true, subtree: true });
export function enhanceAISelect(select, feature) {
  if (!select || select.dataset.aip) return;
  select.dataset.aip = '1';
  select.classList.add('aip-native');
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'aip-btn';
  select.after(btn);
  let cc = null;
  const draw = () => {
    const v = select.value, d = describe(v, feature);
    const opt = [...select.options].find(o => o.value === v);
    const offLabel = v === 'off' ? opt?.textContent || d.name : d.name;
    const local = AI.isLocal(v);
    btn.innerHTML = `<span class="aip-dot ${v === AI.CC ? (cc ? 'on' : cc === false ? 'off' : '') : local ? (d.ok ? 'on' : d.ok === false ? 'bad' : '') : v === 'off' ? 'none' : 'api'}"></span>
      <span class="aip-name">${esc(offLabel)}</span>${d.sub && v !== AI.CC ? `<span class="aip-model${local && d.ok === false ? ' is-bad' : ''}">${esc(d.sub)}</span>` : ''}${CHEV}`;
    btn.title = v === AI.CC ? (cc ? t('ai.ccOn') : t('ai.ccOffNote')) : local ? `${AI.LOCAL[v].label}: ${d.sub}` : '';
  };
  AI.ccListening().then(on => { cc = on; draw(); });
  AI.refreshFrameworks().then(draw).catch(() => {});
  select.addEventListener('change', draw);
  select.addEventListener('aip-refresh', draw); // the job's own model changed
  btn.addEventListener('click', () => {
    if (openPop?.dataset.for === feature + '|' + (select.id || '')) { closePop(); return; }
    closePop();
    const opts = [...select.options].map(o => ({ value: o.value, label: o.textContent, ready: AI.isLocal(o.value) ? AI.fwStatus(o.value).ok !== false : !o.disabled }));
    const pop = document.createElement('div');
    pop.className = 'aip-pop';
    pop.dataset.for = feature + '|' + (select.id || '');
    const row = o => {
      const d = describe(o.value, feature);
      const name = o.value === 'off' ? o.label : d.name;
      const sub = o.value === AI.CC ? (cc ? t('aip.ccOn') : t('aip.ccOff')) : AI.isLocal(o.value) ? d.sub : o.ready ? d.sub : t('aip.noKey');
      return `<button type="button" class="aip-opt${o.value === select.value ? ' is-on' : ''}${o.ready ? '' : ' is-locked'}" data-v="${esc(o.value)}">
        <span class="aip-dot ${o.value === AI.CC ? (cc ? 'on' : 'off') : AI.isLocal(o.value) ? (d.ok ? 'on' : d.ok === false ? 'bad' : '') : o.value === 'off' ? 'none' : o.ready ? 'api' : 'none'}"></span>
        <span class="aip-text"><span class="aip-name">${esc(name)}</span>${sub ? `<span class="aip-sub">${esc(sub)}</span>` : ''}</span>
        ${o.ready ? (o.value === select.value ? CHECK : '') : `<span class="aip-addkey">${esc(t(AI.isLocal(o.value) ? 'aip.setUp' : 'aip.addKey'))}</span>`}</button>`;
    };
    const groups = [['local', t('aip.localFw')], ['api', t('aip.api')], ['off', '']];
    pop.innerHTML = groups.map(([g, title]) => {
      const list = opts.filter(o => describe(o.value, feature).group === g);
      if (!list.length) return '';
      // Ready API models first, then the ones still needing a key.
      if (g === 'api') list.sort((a, b) => b.ready - a.ready);
      return `<div class="aip-group">${title ? `<div class="aip-head">${esc(title)}</div>` : ''}${list.map(row).join('')}</div>`;
    }).join('');
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    const w = Math.max(r.width, 300);
    pop.style.width = w + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    const below = innerHeight - r.bottom - 12, h = pop.offsetHeight;
    if (h > below && r.top > below) { pop.style.bottom = (innerHeight - r.top + 6) + 'px'; pop.style.maxHeight = (r.top - 16) + 'px'; }
    else { pop.style.top = (r.bottom + 6) + 'px'; pop.style.maxHeight = below + 'px'; }
    pop.addEventListener('click', e => {
      const b = e.target.closest('.aip-opt');
      if (!b) return;
      if (b.classList.contains('is-locked')) { closePop(); AI.openSettings?.(); return; }
      select.value = b.dataset.v;
      select.dispatchEvent(new Event('change', { bubbles: true }));
      closePop();
    });
    openPop = pop;
  });
  draw();
}

// A provider's model: a button that opens the whole list right away (it scrolls), with its own search box,
// ↑/↓ and Enter to choose, Esc to close (the focus goes back to the button), and "Custom model…" to type a name
// that isn't listed. The list is placed inside the provider's own box, under its button, so it stays with that
// provider when the settings scroll, the window is narrow or zoomed. Models come from the last check with the
// current key and address (AI.listState); before any check, the provider's suggestions.
// get/set: where the choice is kept (the provider's own model by default). inherit: for a job's own model, a
// function giving the provider's model; the list then starts with "Same as the API key box" (no model of its own).
let pickerIds = 0;
export function modelPicker(host, p, P, { onPick, get = () => AI.modelOf(p), set = v => AI.setModel(p, v), inherit = null } = {}) {
  const id = 'mp-' + (++pickerIds);
  const wrap = host.createDiv({ cls: 'model-picker' });
  const btn = wrap.createEl('button', { cls: 'model-picker-btn', attr: { type: 'button', 'aria-haspopup': 'listbox', 'aria-expanded': 'false', 'data-model-picker': p } });
  const pop = wrap.createDiv({ cls: 'model-pop', attr: { hidden: '' } });
  const search = pop.createEl('input', { cls: 'model-search', attr: { type: 'search', role: 'combobox', 'aria-expanded': 'true', 'aria-autocomplete': 'list', 'aria-controls': id + '-list', spellcheck: 'false' } });
  const list = pop.createEl('ul', { cls: 'model-list', attr: { role: 'listbox', id: id + '-list' } });
  const custom = wrap.createEl('input', { cls: 'model-custom', attr: { type: 'text', hidden: '', spellcheck: 'false' } });
  let items = [], active = 0;
  const label = () => {
    btn.innerHTML = `<span class="model-picker-value">${esc(get() || (inherit ? t('ai.jobModelSame', { model: inherit() || '?' }) : t('ai.modelPick')))}</span>${CHEV}`;
    search.placeholder = t('ai.modelSearch'); search.setAttribute('aria-label', t('ai.modelSearch'));
    list.setAttribute('aria-label', t('ai.model')); custom.placeholder = t('ai.modelPh'); custom.setAttribute('aria-label', t('ai.customModel'));
  };
  const models = () => { const st = AI.listState(p); return st.fetched ? st.models : P.suggest || []; };
  const render = () => {
    const q = search.value.trim().toLowerCase(), cur = get();
    items = [...(inherit && !q ? [{ inherit: true }] : []), ...models().filter(m => !q || m.toLowerCase().includes(q)), { custom: true }];
    active = Math.max(0, Math.min(active, items.length - 1));
    list.innerHTML = items.map((m, i) => m.custom
      ? `<li role="option" id="${id}-o${i}" class="model-opt model-opt-custom${i === active ? ' is-active' : ''}" data-i="${i}" aria-selected="false">${esc(t('ai.customModel'))}</li>`
      : m.inherit ? `<li role="option" id="${id}-o${i}" class="model-opt model-opt-inherit${i === active ? ' is-active' : ''}${!cur ? ' is-current' : ''}" data-i="${i}" aria-selected="${!cur}">${esc(t('ai.jobModelSame', { model: inherit() || '?' }))}${!cur ? CHECK : ''}</li>`
      : `<li role="option" id="${id}-o${i}" class="model-opt${i === active ? ' is-active' : ''}${m === cur ? ' is-current' : ''}" data-i="${i}" aria-selected="${m === cur}">${esc(m)}${m === cur ? CHECK : ''}</li>`).join('');
    const empty = !items.some(m => typeof m === 'string');
    list.toggleClass('is-empty', empty);
    if (empty) list.insertAdjacentHTML('afterbegin', `<li class="model-none" role="presentation">${esc(t(q ? 'ai.modelsNoMatch' : 'ai.modelsNone'))}</li>`);
    search.setAttribute('aria-activedescendant', id + '-o' + active);
    list.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  };
  const isOpen = () => !pop.hasAttribute('hidden');
  const open = () => {
    if (isOpen()) return;
    search.value = ''; custom.hidden = true;
    const cur = get(); const at = models().indexOf(cur); active = cur && at >= 0 ? at + (inherit ? 1 : 0) : 0;
    pop.removeAttribute('hidden'); btn.setAttribute('aria-expanded', 'true'); wrap.addClass('is-open');
    render(); search.focus();
  };
  const close = (back = true) => {
    if (!isOpen()) return;
    pop.setAttribute('hidden', ''); btn.setAttribute('aria-expanded', 'false'); wrap.removeClass('is-open');
    if (back) btn.focus();
  };
  const choose = i => {
    const m = items[i];
    if (!m) return;
    if (m.custom) {
      close(false);
      custom.hidden = false; custom.value = get(); custom.focus(); custom.select();
      return;
    }
    const v = m.inherit ? '' : m;
    set(v); label(); close(); onPick?.(v);
  };
  btn.addEventListener('click', () => (isOpen() ? close() : open()));
  btn.addEventListener('keydown', e => { if (['ArrowDown', 'ArrowUp'].includes(e.key)) { e.preventDefault(); open(); } });
  search.addEventListener('input', () => { active = 0; render(); });
  search.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); active = (active + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; render(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); active = e.key === 'Home' ? 0 : items.length - 1; render(); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Tab') close(false);
  });
  list.addEventListener('mousedown', e => e.preventDefault()); // keep the focus in the search box
  list.addEventListener('click', e => { const li = e.target.closest('[data-i]'); if (li) choose(+li.dataset.i); });
  // A typed name is used only on Enter or "Use this name"; Esc drops it and keeps the model chosen before
  // (leaving the box saves nothing either).
  const useBtn = wrap.createEl('button', { cls: 'model-custom-use', attr: { type: 'button', hidden: '' } });
  const endCustom = () => { custom.hidden = true; custom.value = ''; btn.focus(); };
  const saveCustom = () => { const v = custom.value.trim(); if (v) { set(v); label(); onPick?.(v); } endCustom(); };
  useBtn.addEventListener('click', saveCustom);
  custom.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); saveCustom(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); endCustom(); } });
  new MutationObserver(() => { useBtn.hidden = custom.hidden; useBtn.textContent = t('ai.useCustom'); }).observe(custom, { attributes: true, attributeFilter: ['hidden'] });
  document.addEventListener('pointerdown', e => { if (isOpen() && !wrap.contains(e.target)) close(false); }, true);
  label();
  return { refresh() { label(); if (isOpen()) render(); }, close, el: wrap };
}
