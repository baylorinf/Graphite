// The searchable manual on the help page (F1, and "Manual and guide" on the start page). Search by what you want
// to do (a study task), by a word, or by a shortcut: it finds the features (live commands, with where to find
// them, what they need, their shortcut and a Run button) and the guide sections that explain them. With an
// empty search and no task chosen, the whole guide shows as before.
import { t, getLang } from '/i18n.js';
import { GROUPS, COMMAND_HELP, handbookWords } from '/handbook-data.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Compare without case, width or spaces around "+", so "ctrl + s", "Ctrl+S" and "ｃｔｒｌ＋ｓ" all match.
export const norm = s => String(s || '').normalize('NFKC').toLowerCase().replace(/\s*\+\s*/g, '+');
export function matches(hay, query) {
  const terms = norm(query).trim().split(/\s+/).filter(Boolean);
  const h = norm(hay);
  return terms.every(w => h.includes(w));
}

/* host: { commands(): [{ id, label, kbd, available }], run(id), guide(): Element (the rendered guide) } */
export function mountHandbook(root, host) {
  const W = () => handbookWords(getLang());
  const state = { q: '', group: '' };
  root.innerHTML = `<div class="hb-bar"><input type="search" class="hb-search" autocomplete="off" spellcheck="false"><div class="hb-groups" role="group"></div></div>`;
  const input = root.querySelector('.hb-search'), chips = root.querySelector('.hb-groups');
  const drawChips = () => {
    const w = W();
    input.placeholder = w.placeholder; input.setAttribute('aria-label', w.search);
    chips.setAttribute('aria-label', w.topics);
    chips.innerHTML = [`<button type="button" data-hb-group="" class="${state.group ? '' : 'active'}">${esc(w.all)}</button>`,
      ...GROUPS.map(g => `<button type="button" data-hb-group="${g}" class="${state.group === g ? 'active' : ''}">${esc(w.group[g])}</button>`)].join('');
  };
  chips.addEventListener('click', e => { const b = e.target.closest('[data-hb-group]'); if (!b) return; state.group = b.dataset.hbGroup; drawChips(); host.update(); });
  input.addEventListener('input', () => { state.q = input.value; host.update(); });
  input.addEventListener('keydown', e => { if (e.key === 'Escape' && input.value) { e.stopPropagation(); input.value = ''; state.q = ''; host.update(); } });
  drawChips();
  return {
    active: () => !!(state.q.trim() || state.group),
    focus: () => { input.focus(); input.select(); },
    reset: () => { state.q = ''; state.group = ''; input.value = ''; drawChips(); },
    redraw: drawChips,
    // Fill `body` with the results (features, then guide sections). Returns how many were found.
    render(body) {
      const w = W(), zh = /^zh/.test(getLang());
      const feats = [];
      for (const c of host.commands()) {
        const info = COMMAND_HELP[c.id];
        const group = info?.[0] || 'plugins';
        if (state.group && group !== state.group) continue;
        const desc = info ? (zh ? info[4] : info[3]) : '';
        const hay = [c.label, c.name, c.id, c.kbd, desc, info?.[3], info?.[4], info?.[5], w.group[group], info?.[1] && w.place[info[1]]].filter(Boolean).join(' ');
        if (state.q.trim() && !matches(hay, state.q)) continue;
        feats.push({ c, info, group, desc });
      }
      const secs = [];
      if (!state.group || state.q.trim()) {
        const guide = host.guide();
        let cur = null;
        for (const el of guide ? [...guide.children] : []) {
          if (el.tagName === 'H2') { cur = { title: el.textContent, nodes: [] }; secs.push(cur); continue; }
          cur?.nodes.push(el);
        }
      }
      const hitSecs = state.q.trim() ? secs.filter(s => matches(s.title + ' ' + s.nodes.map(n => n.textContent).join(' '), state.q)) : [];
      const n = feats.length + hitSecs.length;
      if (!n) {
        body.innerHTML = `<div class="hb-none" role="status"><p>${esc(w.none)}</p><button type="button" class="mod-button" data-hb-reset>${esc(w.reset)}</button></div>`;
        return 0;
      }
      const out = [`<p class="hb-count muted" role="status">${esc(w.results)}: ${n}</p>`];
      if (feats.length) {
        out.push('<div class="hb-list">');
        for (const { c, info, group, desc } of feats) {
          const req = info?.[2] ? w.req[info[2]] : '';
          out.push(`<div class="hb-item" data-hb-cmd="${esc(c.id)}">
            <div class="hb-head"><b>${esc(c.label)}</b>${c.kbd ? `<kbd>${esc(c.kbd)}</kbd>` : ''}<span class="hb-tag">${esc(w.group[group] || group)}</span></div>
            ${desc ? `<p>${esc(desc)}</p>` : ''}
            <p class="hb-meta muted">${info?.[1] ? esc(w.place[info[1]] || '') : ''}${req ? ' · ' + esc(req) : ''}</p>
            ${c.available ? `<button type="button" class="mod-button hb-run" data-hb-run="${esc(c.id)}">${esc(t('hb.run'))}</button>` : `<span class="muted hb-unavail">${esc(t('hb.notNow'))}</span>`}
          </div>`);
        }
        out.push('</div>');
      }
      if (hitSecs.length) {
        out.push(`<h2 class="hb-sec-title">${esc(t('hb.guideSections'))}</h2>`);
        body.innerHTML = out.join('');
        for (const s of hitSecs) {
          const box = document.createElement('section');
          box.className = 'hb-section';
          const h = document.createElement('h3'); h.textContent = s.title; box.append(h);
          for (const nd of s.nodes) box.append(nd.cloneNode(true));
          body.append(box);
        }
      } else body.innerHTML = out.join('');
      return n;
    },
  };
}
