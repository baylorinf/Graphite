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

function describe(v) {
  if (v === AI.CC) return { name: 'Claude Code', sub: t('aip.ccSub'), group: 'local' };
  if (v === 'off') return { name: t('ai.off'), sub: '', group: 'off' };
  const p = AI.parts(v);
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
    const v = select.value, d = describe(v);
    const opt = [...select.options].find(o => o.value === v);
    const offLabel = v === 'off' ? opt?.textContent || d.name : d.name;
    btn.innerHTML = `<span class="aip-dot ${v === AI.CC ? (cc ? 'on' : cc === false ? 'off' : '') : v === 'off' ? 'none' : 'api'}"></span>
      <span class="aip-name">${esc(offLabel)}</span>${d.sub && v !== AI.CC ? `<span class="aip-model">${esc(d.sub)}</span>` : ''}${CHEV}`;
    btn.title = v === AI.CC ? (cc ? t('ai.ccOn') : t('ai.ccOffNote')) : '';
  };
  AI.ccListening().then(on => { cc = on; draw(); });
  select.addEventListener('change', draw);
  btn.addEventListener('click', () => {
    if (openPop?.dataset.for === feature + '|' + (select.id || '')) { closePop(); return; }
    closePop();
    const opts = [...select.options].map(o => ({ value: o.value, label: o.textContent, ready: !o.disabled }));
    const pop = document.createElement('div');
    pop.className = 'aip-pop';
    pop.dataset.for = feature + '|' + (select.id || '');
    const row = o => {
      const d = describe(o.value);
      const name = o.value === 'off' ? o.label : d.name;
      const sub = o.value === AI.CC ? (cc ? t('aip.ccOn') : t('aip.ccOff')) : o.ready ? d.sub : t('aip.noKey');
      return `<button type="button" class="aip-opt${o.value === select.value ? ' is-on' : ''}${o.ready ? '' : ' is-locked'}" data-v="${esc(o.value)}">
        <span class="aip-dot ${o.value === AI.CC ? (cc ? 'on' : 'off') : o.value === 'off' ? 'none' : o.ready ? 'api' : 'none'}"></span>
        <span class="aip-text"><span class="aip-name">${esc(name)}</span>${sub ? `<span class="aip-sub">${esc(sub)}</span>` : ''}</span>
        ${o.ready ? (o.value === select.value ? CHECK : '') : `<span class="aip-addkey">${esc(t('aip.addKey'))}</span>`}</button>`;
    };
    const groups = [['local', t('aip.local')], ['api', t('aip.api')], ['off', '']];
    pop.innerHTML = groups.map(([g, title]) => {
      const list = opts.filter(o => describe(o.value).group === g);
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
