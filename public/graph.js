// Graph view, modelled loosely on how a brain stores and recalls memories:
// - Regions: notes that are linked or alike gather into coloured areas, like brain regions.
// - Associations: dashed lines join notes about similar ideas even when you never linked them.
// - Memory: notes you remember well glow, notes you are forgetting fade, notes due for review pulse.
// - Spreading activation: clicking a note sends a pulse along its connections, lighting up what it
//   brings to mind (strongest first), like one thought triggering others.
// - Mind wandering: drifts from thought to thought along the strongest connections, leaving a trail.
import { t, getLang } from '/i18n.js';
import * as RV from '/review.js';

let H = null, canvas = null;
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const G = {
  nodes: [], links: [], byId: new Map(), adj: new Map(), regions: [],
  scale: 1, ox: 0, oy: 0, alpha: 0, raf: 0, hover: null, drag: null, pan: null, moved: false, colors: {},
  act: null, selected: null, wander: null, autoFit: false, lastDraw: 0,
};
const HOP_MS = 380;                       // time for a pulse to travel one connection
const REGION_COLORS = ['#8a5cf5', '#2fb5a3', '#e0a030', '#e2566b', '#4c97ea', '#74bf58', '#cf6acb', '#e47a3a', '#4fc3df', '#b8a640', '#8d7ff0', '#e88aa8'];
const DUE = '#f0a020';

/* ---------- options (remembered on this computer) ---------- */
const OPTS = { regions: true, assoc: true, memory: true };
const opts = () => ({ ...OPTS, ...(H.store.get('graph', {}) || {}) });
const setOpt = (k, v) => H.store.set('graph', { ...opts(), [k]: v });

export function initGraph(host) {
  H = host;
  canvas = $('#graph');
  const o = opts();
  for (const [id, k] of [['g-regions', 'regions'], ['g-assoc', 'assoc'], ['g-memory', 'memory']]) {
    const el = $('#' + id);
    el.checked = o[k];
    el.addEventListener('change', () => { setOpt(k, el.checked); G.autoFit = true; buildGraph(); });
  }
  for (const id of ['g-local', 'g-unresolved', 'g-attach', 'g-orphans']) $('#' + id).addEventListener('change', () => { G.autoFit = true; buildGraph(); });
  // Folders whose notes stay off the graph (comma-separated). Single notes: "graph: hide" in their frontmatter.
  $('#g-hidden')?.addEventListener('click', async () => {
    const cur = (opts().hideFolders || []).join(', ');
    const v = await H.askText(t('graph.hiddenPrompt'), cur, t('graph.hiddenHint'));
    if (v == null) return;
    setOpt('hideFolders', v.split(',').map(s => s.trim()).filter(Boolean));
    G.autoFit = true; buildGraph();
  });
  $('#g-wander').addEventListener('click', () => (G.wander ? stopWander() : startWander()));
  bindMouse();
  addEventListener('resize', () => { if (H.S.view === 'graph') drawGraph(); });
}

export function readGraphColors() {
  const cs = getComputedStyle(document.documentElement), v = n => cs.getPropertyValue(n).trim();
  G.colors = { node: v('--graph-node'), line: v('--graph-line'), accent: v('--accent'), text: v('--text'), muted: v('--text-muted'), unresolved: v('--graph-unresolved'), attach: v('--graph-attach'), bg: v('--bg'), font: getComputedStyle(document.body).fontFamily };
  const bg = /^#[0-9a-f]{6}$/i.test(G.colors.bg) ? parseInt(G.colors.bg.slice(1), 16) : 0;
  G.colors.light = (((bg >> 16) & 255) + ((bg >> 8) & 255) + (bg & 255)) / 3 > 128;
  if (!/^#[0-9a-f]{3,6}$/i.test(G.colors.accent)) G.colors.accent = '#8a5cf5';
}

/* ---------- building the network ---------- */
export function buildGraph() {
  const { S, resolve, isMd, baseName, fileName } = H;
  const o = opts();
  const showU = $('#g-unresolved').checked, showA = $('#g-attach').checked, showO = $('#g-orphans').checked, local = $('#g-local').checked && S.current;
  const nodes = new Map(), links = [], seen = new Set();
  const add = (id, kind, label) => {
    if (!nodes.has(id)) {
      const old = G.byId.get(id);
      nodes.set(id, { id, kind, label, x: old?.x ?? (Math.random() - 0.5) * 600, y: old?.y ?? (Math.random() - 0.5) * 600, vx: 0, vy: 0, deg: 0, region: -1, mem: null, fresh: !old });
    }
    return nodes.get(id);
  };
  // Notes kept off the graph: "graph: hide" in the frontmatter (index pages, logs, system files…), or inside a
  // folder listed under "Hidden folders". Their links don't count either.
  const hideFolders = (o.hideFolders || []).map(s => String(s).trim().replace(/^\/+|\/+$/g, '')).filter(Boolean);
  const hidden = f => {
    if (!f) return false;
    const g = f.fm?.graph;
    if (g === false || /^(hide|hidden|false|no|off)$/i.test(String(g ?? ''))) return true;
    return hideFolders.some(d => f.path === d || f.path.startsWith(d + '/'));
  };
  for (const f of S.files.values()) if (isMd(f.path) && !hidden(f)) add(f.path, 'note', baseName(f.path));
  for (const f of S.files.values()) {
    if (!nodes.has(f.path)) continue;
    for (const l of f.links || []) {
      let tg = resolve(l.name, f.path), kind = 'note';
      if (tg && isMd(tg) && !nodes.has(tg)) continue; // a hidden note
      if (!tg) { if (!showU) continue; tg = 'unresolved:' + l.name.toLowerCase(); kind = 'unresolved'; add(tg, kind, l.name); }
      else if (!isMd(tg)) { if (!showA) continue; kind = 'attachment'; add(tg, kind, fileName(tg)); }
      if (tg === f.path) continue;
      const key = f.path < tg ? f.path + '\0' + tg : tg + '\0' + f.path;
      if (seen.has(key)) { links.find(x => x.key === key).w = 1.6; continue; } // linked both ways: a stronger bond
      seen.add(key);
      links.push({ key, source: nodes.get(f.path), target: nodes.get(tg), kind: 'link', w: 1 });
    }
  }
  for (const l of links) { l.source.deg++; l.target.deg++; }
  // Associations: similar notes that aren't linked.
  if (o.assoc) {
    for (const e of RV.associations()) {
      const key = e.a < e.b ? e.a + '\0' + e.b : e.b + '\0' + e.a;
      if (seen.has(key) || !nodes.has(e.a) || !nodes.has(e.b)) continue;
      links.push({ key, source: nodes.get(e.a), target: nodes.get(e.b), kind: 'assoc', w: Math.min(1, e.score * 2.2), score: e.score });
    }
  }
  let list = [...nodes.values()];
  if (local) {
    const keep = new Set([S.current]);
    for (const l of links) { if (l.source.id === S.current) keep.add(l.target.id); if (l.target.id === S.current) keep.add(l.source.id); }
    const lvl1 = [...keep];
    for (const l of links) if (l.kind === 'link') { if (lvl1.includes(l.source.id)) keep.add(l.target.id); if (lvl1.includes(l.target.id)) keep.add(l.source.id); }
    list = list.filter(n => keep.has(n.id));
  } else if (!showO) {
    const connected = new Set(links.flatMap(l => [l.source.id, l.target.id]));
    list = list.filter(n => connected.has(n.id));
  }
  const ids = new Set(list.map(n => n.id));
  G.nodes = list;
  G.links = links.filter(l => ids.has(l.source.id) && ids.has(l.target.id));
  G.byId = new Map(list.map(n => [n.id, n]));
  G.adj = new Map(list.map(n => [n, []]));
  for (const l of G.links) { G.adj.get(l.source).push({ n: l.target, w: l.w, l }); G.adj.get(l.target).push({ n: l.source, w: l.w, l }); }
  findRegions(o.regions);
  // New notes start near the rest of their region (regions placed around a circle), so the layout untangles quickly.
  const R = G.regions.length;
  G.regions.forEach((r, i) => {
    const ang = (i / Math.max(1, R)) * Math.PI * 2, cx = R > 1 ? Math.cos(ang) * (180 + 40 * R) : 0, cy = R > 1 ? Math.sin(ang) * (180 + 40 * R) : 0;
    for (const p of r.members) if (p.fresh) { p.x = cx + (Math.random() - 0.5) * 160; p.y = cy + (Math.random() - 0.5) * 160; }
  });
  for (const p of G.nodes) p.fresh = false;
  for (const p of G.nodes) p.mem = o.memory && p.kind === 'note' ? RV.noteMemory(p.id) : null;
  if (G.selected && !G.byId.has(G.selected.id)) closeCard(); else if (G.selected) G.selected = G.byId.get(G.selected.id);
  drawLegend();
  G.alpha = 1;
  startLoop();
}

// Regions by label propagation: each note repeatedly adopts the region most of its connections belong to.
function findRegions(on) {
  G.regions = [];
  for (const p of G.nodes) p.region = -1;
  if (!on) return;
  const notes = G.nodes.filter(p => p.kind === 'note');
  const label = new Map(notes.map((p, i) => [p, i]));
  for (let round = 0; round < 20; round++) {
    let changed = false;
    for (const p of [...notes].sort(() => Math.random() - 0.5)) {
      const score = new Map();
      for (const { n, w } of G.adj.get(p)) if (label.has(n)) score.set(label.get(n), (score.get(label.get(n)) || 0) + w);
      if (!score.size) continue;
      let best = label.get(p), bs = score.get(best) || 0;
      for (const [k, s] of score) if (s > bs + 1e-9) { best = k; bs = s; }
      if (best !== label.get(p)) { label.set(p, best); changed = true; }
    }
    if (!changed) break;
  }
  // Label propagation can cut a chain of notes (A–B–C–D) into pairs that are each too small to be a region.
  // Let a group of fewer than 3 notes join the neighbouring group it is most connected to.
  const sizes = () => { const m = new Map(); for (const k of label.values()) m.set(k, (m.get(k) || 0) + 1); return m; };
  for (let round = 0; round < 10; round++) {
    const sz = sizes();
    let moved = false;
    for (const p of notes) {
      const mine = label.get(p);
      if (sz.get(mine) >= 3) continue;
      const score = new Map();
      for (const { n, w } of G.adj.get(p)) {
        const k = label.get(n);
        if (k !== undefined && k !== mine) score.set(k, (score.get(k) || 0) + w);
      }
      if (!score.size) continue;
      const best = [...score].sort((a, b) => b[1] - a[1])[0][0];
      // Merge the whole small group into that neighbour's group.
      for (const [q, k] of label) if (k === mine) label.set(q, best);
      moved = true;
      break; // sizes changed: recount before the next merge
    }
    if (!moved) break;
  }
  const groups = new Map();
  for (const [p, k] of label) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const big = [...groups.values()].filter(g => g.length >= 3).sort((a, b) => b.length - a.length);
  big.forEach((members, i) => {
    // Name: the tag most of its notes share, otherwise its most connected note.
    const tags = new Map();
    for (const p of members) for (const tg of new Set((H.S.files.get(p.id)?.tags || []).map(x => x.split('/')[0]))) tags.set(tg, (tags.get(tg) || 0) + 1);
    const top = [...tags].sort((a, b) => b[1] - a[1])[0];
    const hub = members.reduce((a, b) => (G.adj.get(b).length > G.adj.get(a).length ? b : a));
    let name = top && top[1] >= Math.max(2, members.length * 0.4) ? '#' + top[0] : shortLabel(hub);
    if (G.regions.some(r => r.name === name)) name = (name.startsWith('#') ? name + ' · ' : '') + shortLabel(hub);
    G.regions.push({ i, name, color: REGION_COLORS[i % REGION_COLORS.length], members, x: 0, y: 0, hub });
    for (const p of members) p.region = i;
  });
  // A note with no links of its own (or in a group too small to be a region) still belongs somewhere: if it
  // carries the tag a region is named after (e.g. #mathematical analysis), it joins that region and sits in it.
  const byTag = new Map(G.regions.filter(r => r.name.startsWith('#')).map(r => [r.name.slice(1).toLowerCase(), r]));
  if (byTag.size) for (const p of notes) {
    if (p.region >= 0) continue;
    const tags = (H.S.files.get(p.id)?.tags || []).map(x => x.split('/')[0].toLowerCase());
    const r = tags.map(tg => byTag.get(tg)).find(Boolean);
    if (r) { r.members.push(p); p.region = r.i; }
  }
}

/* ---------- physics ---------- */
function tick() {
  const n = G.nodes, a = G.alpha;
  for (let i = 0; i < n.length; i++) {
    const p = n[i];
    for (let j = i + 1; j < n.length; j++) {
      const q = n[j];
      let dx = q.x - p.x, dy = q.y - p.y, d2 = dx * dx + dy * dy;
      if (d2 > 360000) continue;
      if (d2 < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 0.25; }
      // Different regions push apart a little more, so regions stay visible.
      const k = p.region !== q.region && p.region >= 0 && q.region >= 0 ? 4200 : 3000;
      const d = Math.sqrt(d2), f = (k * a) / d2, fx = (dx / d) * f, fy = (dy / d) * f;
      p.vx -= fx; p.vy -= fy; q.vx += fx; q.vy += fy;
    }
  }
  for (const l of G.links) {
    const s = l.source, tg = l.target, dx = tg.x - s.x, dy = tg.y - s.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
    const rest = l.kind === 'assoc' ? 140 : 110, k = l.kind === 'assoc' ? 0.012 * l.w : 0.03 * l.w;
    const f = (d - rest) * k * a, fx = (dx / d) * f, fy = (dy / d) * f;
    s.vx += fx; s.vy += fy; tg.vx -= fx; tg.vy -= fy;
  }
  // Each region holds together around its centre.
  for (const r of G.regions) {
    let x = 0, y = 0;
    for (const p of r.members) { x += p.x; y += p.y; }
    r.x = x / r.members.length; r.y = y / r.members.length;
    for (const p of r.members) { p.vx += (r.x - p.x) * 0.007 * a; p.vy += (r.y - p.y) * 0.007 * a; }
  }
  for (let i = 0; i < G.regions.length; i++) for (let j = i + 1; j < G.regions.length; j++) {
    const A = G.regions[i], B = G.regions[j], dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || 1;
    const want = 90 + 48 * (Math.sqrt(A.members.length) + Math.sqrt(B.members.length));
    if (d >= want) continue;
    const f = (want - d) * 0.05 * a, fx = (dx / d) * f, fy = (dy / d) * f;
    for (const p of A.members) { p.vx -= fx; p.vy -= fy; }
    for (const p of B.members) { p.vx += fx; p.vy += fy; }
  }
  for (const p of n) {
    p.vx -= p.x * 0.012 * a; p.vy -= p.y * 0.012 * a;
    if (p === G.drag) { p.vx = p.vy = 0; continue; }
    p.vx *= 0.55; p.vy *= 0.55; p.x += p.vx; p.y += p.vy;
  }
  G.alpha *= 0.985;
}
function regionCentres() {
  for (const r of G.regions) {
    let x = 0, y = 0;
    for (const p of r.members) { x += p.x; y += p.y; }
    r.x = x / r.members.length; r.y = y / r.members.length;
  }
}

/* ---------- spreading activation ---------- */
// Activation starts at one note and spreads along its connections, weaker at each step, like a thought
// triggering related memories. Returns the notes it reached, strongest first.
function activate(src, { hops = 3, hold = 2600 } = {}) {
  const now = performance.now(), map = new Map([[src, { level: 1, at: now, from: null, hop: 0 }]]);
  let frontier = [src];
  for (let hop = 1; hop <= hops; hop++) {
    const next = [];
    for (const p of frontier) {
      const base = map.get(p).level;
      for (const { n, w } of G.adj.get(p) || []) {
        const lvl = base * 0.55 * Math.min(1, 0.45 + w * 0.55);
        if (lvl < 0.07) continue;
        const cur = map.get(n);
        if (!cur) { map.set(n, { level: lvl, at: now + hop * HOP_MS, from: p, hop }); next.push(n); }
        else if (cur.hop === hop && lvl > cur.level) Object.assign(cur, { level: lvl, from: p });
      }
    }
    frontier = next;
  }
  G.act = { map, until: now + hops * HOP_MS + hold };
  startLoop();
  return [...map].filter(([p]) => p !== src).sort((a, b) => b[1].level - a[1].level).map(([p, v]) => ({ p, level: v.level }));
}
function actLevel(p, now) {
  const a = G.act?.map.get(p);
  if (!a || now < a.at) return 0;
  const rise = Math.min(1, (now - a.at) / 160), fade = Math.min(1, Math.max(0, (G.act.until - now) / 1400));
  return a.level * rise * fade;
}

/* ---------- drawing ---------- */
const radius = p => 4 + Math.sqrt(p.deg) * 1.8;
function hexA(hex, a) {
  const h = hex.replace('#', ''), n = parseInt(h.length === 3 ? h.replace(/./g, c => c + c) : h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}
function nodeColor(p) {
  const C = G.colors;
  if (p.kind === 'unresolved') return C.unresolved;
  if (p.kind === 'attachment') return C.attach;
  return p.region >= 0 ? G.regions[p.region].color : C.node;
}

// Short name for the graph. "向量与点积 Vectors and Dot Products" shows the part in the app's language;
// attachments drop the extension ("LA4.pdf" → "LA4"). The full title shows when you hover a note.
const CJK = /[\u3400-\u9fff\uf900-\ufaff]/;
function shortLabel(p) {
  let s = p.label;
  if (p.kind === 'attachment') s = s.replace(/\.[a-z0-9]{2,4}$/i, '');
  if (CJK.test(s) && /[A-Za-z]{3,}/.test(s)) {
    const i = s.search(/\s[A-Za-z(]/); // where the English part starts
    if (i > 0) {
      const zh = s.slice(0, i).trim(), en = s.slice(i).trim();
      if (zh && en && CJK.test(zh) && !CJK.test(en)) s = /^zh/i.test(getLang()) ? zh : en;
    }
  }
  return s.length > 26 ? s.slice(0, 24) + '…' : s;
}
const fullLabel = p => (p.label.length > 60 ? p.label.slice(0, 58) + '…' : p.label);
const widthCache = new Map();
function textWidth(ctx, text) {
  const key = ctx.font + '\u0000' + text;
  let w = widthCache.get(key);
  if (w == null) { if (widthCache.size > 4000) widthCache.clear(); w = ctx.measureText(text).width; widthCache.set(key, w); }
  return w;
}

export function drawGraph() {
  if (!canvas) return;
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext('2d'), C = G.colors, now = performance.now(), S = H.S;
  G.lastDraw = now;
  if (G.act && now > G.act.until) G.act = null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  ctx.translate(w / 2 + G.ox, h / 2 + G.oy);
  ctx.scale(G.scale, G.scale);
  const hov = G.hover, nb = new Set();
  if (hov) { nb.add(hov); for (const { n } of G.adj.get(hov) || []) nb.add(n); }
  const dim = p => (hov && !nb.has(p) && !actLevel(p, now) ? 0.22 : 1);
  regionCentres();

  // Regions: soft clouds of colour behind their notes.
  for (const r of G.regions) {
    for (const p of r.members) {
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 70);
      g.addColorStop(0, hexA(r.color, C.light ? 0.10 : 0.09)); g.addColorStop(1, hexA(r.color, 0));
      ctx.fillStyle = g; ctx.globalAlpha = hov ? 0.6 : 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, 70, 0, Math.PI * 2); ctx.fill();
    }
  }

  // Connections: solid = your links, dashed = associations (similar ideas).
  for (const l of G.links) {
    const hi = hov && (l.source === hov || l.target === hov);
    ctx.globalAlpha = (hov && !hi ? 0.25 : 1) * (l.kind === 'assoc' ? 0.35 + l.w * 0.5 : 1);
    ctx.strokeStyle = hi ? C.accent : l.kind === 'assoc' ? C.muted : C.line;
    ctx.lineWidth = (l.kind === 'link' ? (l.w > 1 ? 1.8 : 1) : 1) / G.scale;
    ctx.setLineDash(l.kind === 'assoc' ? [4 / G.scale, 5 / G.scale] : []);
    ctx.beginPath(); ctx.moveTo(l.source.x, l.source.y); ctx.lineTo(l.target.x, l.target.y); ctx.stroke();
  }
  ctx.setLineDash([]);

  // Pulses travelling along connections while a thought spreads.
  if (G.act) {
    ctx.lineCap = 'round';
    for (const [p, a] of G.act.map) {
      if (!a.from) continue;
      const s = a.from, prog = Math.max(0, Math.min(1, (now - (a.at - HOP_MS)) / HOP_MS)), fade = actLevel(p, now) || (prog < 1 ? a.level : 0);
      if (!prog || !fade) continue;
      const x = s.x + (p.x - s.x) * prog, y = s.y + (p.y - s.y) * prog;
      ctx.globalAlpha = Math.min(1, 0.25 + fade);
      ctx.strokeStyle = C.accent; ctx.lineWidth = (1.5 + 2.5 * a.level) / G.scale;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(x, y); ctx.stroke();
      if (prog < 1) { ctx.fillStyle = C.accent; ctx.beginPath(); ctx.arc(x, y, 3.5 / G.scale + 2, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.lineCap = 'butt';
  }

  // Notes.
  const pulse = 0.5 + 0.5 * Math.sin(now / 420);
  for (const p of G.nodes) {
    const r = radius(p), col = nodeColor(p), m = p.mem, act = actLevel(p, now);
    // Memory strength: well remembered notes are bright, fading ones dim. Unstudied notes stay neutral.
    let alpha = 0.9;
    if (m && m.strength != null) alpha = 0.3 + 0.7 * m.strength;
    ctx.globalAlpha = dim(p);
    if (act > 0.02) { // glow while activated
      const g = ctx.createRadialGradient(p.x, p.y, r * 0.5, p.x, p.y, r * 4.5);
      g.addColorStop(0, hexA(C.accent, 0.55 * act)); g.addColorStop(1, hexA(C.accent, 0));
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, r * 4.5, 0, Math.PI * 2); ctx.fill();
    }
    if (m && m.strength != null && m.strength > 0.85) { // strong memory: a steady halo
      ctx.globalAlpha = dim(p) * 0.35; ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 4, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = dim(p) * Math.max(alpha, act);
    ctx.fillStyle = p === hov || p === G.selected || p.id === S.current ? C.accent : col;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
    if (m && m.due > 0) { // due for review: a pulsing ring
      ctx.globalAlpha = dim(p) * (0.35 + 0.65 * pulse);
      ctx.strokeStyle = DUE; ctx.lineWidth = 2 / G.scale;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + 3 + pulse * 2.5, 0, Math.PI * 2); ctx.stroke();
    }
    if (p === G.selected) { ctx.globalAlpha = 1; ctx.strokeStyle = C.text; ctx.lineWidth = 1.5 / G.scale; ctx.beginPath(); ctx.arc(p.x, p.y, r + 2.5, 0, Math.PI * 2); ctx.stroke(); }
  }

  // Region names, most readable when zoomed out.
  const regionBoxes = [];
  if (G.regions.length) {
    const ra = Math.max(0.25, Math.min(0.85, 1.25 - G.scale * 0.7));
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.font = `600 ${Math.min(40, 17 / G.scale)}px ${C.font}`;
    for (const r of G.regions) {
      const top = Math.min(...r.members.map(p => p.y)) - 26 / G.scale - 10;
      const txt = r.name.length > 30 ? r.name.slice(0, 28) + '…' : r.name;
      const rw = textWidth(ctx, txt), rh = Math.min(40, 17 / G.scale);
      regionBoxes.push([r.x - rw / 2, top - rh * 0.65, r.x + rw / 2, top + rh * 0.65]); // node labels keep clear of it
      ctx.globalAlpha = hov ? ra * 0.4 : ra;
      ctx.lineJoin = 'round'; ctx.lineWidth = 5 / G.scale; ctx.strokeStyle = C.bg; ctx.strokeText(txt, r.x, top);
      ctx.fillStyle = r.color; ctx.fillText(txt, r.x, top);
    }
  }

  // Labels: short names (the full title shows on hover), most important first. A label that would overlap
  // one already drawn is left out until you zoom in or hover, so every name you see can be read.
  const fs = 12.5 / Math.max(G.scale, 0.6);
  ctx.font = `${fs}px ${C.font}`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round';
  const labelAlpha = Math.max(0, Math.min(1, (G.scale - 0.45) * 2.5));
  const forced = p => p === hov || p === G.selected || p.id === S.current || actLevel(p, now) > 0.05;
  const rank = p => (forced(p) ? 1e6 : 0) + (hov && nb.has(p) ? 1e5 : 0) + (p.kind === 'note' ? 1000 : p.kind === 'attachment' ? 0 : -1000) + p.deg * 10 + (p.mem?.due > 0 ? 5 : 0);
  const order = G.nodes.filter(p => (hov ? nb.has(p) : labelAlpha > 0 || forced(p))).sort((a, b) => rank(b) - rank(a));
  const boxes = hov ? [] : [...regionBoxes], pad = 3 / G.scale, lh = fs * 1.25;
  for (const p of order) {
    const text = p === hov || p === G.selected ? fullLabel(p) : shortLabel(p);
    const tw = textWidth(ctx, text), x0 = p.x - tw / 2, y0 = p.y + radius(p) + 3 / G.scale;
    const box = [x0 - pad, y0 - pad, x0 + tw + pad, y0 + lh + pad];
    if (!forced(p) && boxes.some(b => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) continue;
    boxes.push(box);
    const act = actLevel(p, now);
    ctx.globalAlpha = hov ? (p === hov ? 1 : 0.95) : Math.max(labelAlpha, Math.min(1, act * 1.6), forced(p) ? 1 : 0);
    ctx.lineWidth = 4 / G.scale; ctx.strokeStyle = C.bg; ctx.strokeText(text, p.x, y0); // outline: readable over lines and colour
    ctx.fillStyle = forced(p) || act > 0.3 ? C.text : p.kind === 'note' ? hexA(C.text.startsWith('#') ? C.text : '#888888', 0.82) : C.muted;
    ctx.fillText(text, p.x, y0);
  }
  ctx.globalAlpha = 1;
}

/* ---------- animation loop ---------- */
// Runs while the layout settles, a thought spreads, the mind wanders, or due notes pulse (at a calm frame rate).
const pulsing = () => G.nodes.some(p => p.mem?.due > 0);
function startLoop() {
  cancelAnimationFrame(G.raf);
  const frame = () => {
    if (H.S.view !== 'graph') return;
    const busy = G.alpha > 0.01 || G.drag || G.act || G.wander;
    if (G.alpha > 0.01 || G.drag) tick();
    if (G.autoFit && G.alpha < 0.05) { G.autoFit = false; fitGraph(); }
    if (busy || performance.now() - G.lastDraw > 60) drawGraph();
    if (busy || pulsing()) G.raf = requestAnimationFrame(frame);
  };
  G.raf = requestAnimationFrame(frame);
}
export function stopGraph() { cancelAnimationFrame(G.raf); stopWander(); }
function reheat(a = 0.3) { G.alpha = Math.max(G.alpha, a); startLoop(); }

// The part of the canvas not covered by the controls (right) and the note card (left).
function freeArea() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  const top = (document.querySelector('.graph-controls')?.offsetHeight || 0) + 20;
  const card = document.querySelector('#graph-card');
  const left = card && !card.classList.contains('hidden') ? card.offsetWidth + 24 : 16;
  const fw = Math.max(200, w - left - 16), fh = Math.max(200, h - top - 16);
  return { w: fw, h: fh, cx: left + fw / 2 - w / 2, cy: top + fh / 2 - h / 2 };   // cx/cy: shift of the free area's centre
}
export function fitGraph() {
  if (!G.nodes.length) return;
  const xs = G.nodes.map(n => n.x), ys = G.nodes.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const A = freeArea();
  G.scale = Math.max(0.08, Math.min(1.4, Math.min(A.w / (maxX - minX + 140), A.h / (maxY - minY + 120))));
  G.ox = A.cx - ((minX + maxX) / 2) * G.scale; G.oy = A.cy - ((minY + maxY) / 2) * G.scale;
  G.userMoved = false;
  drawGraph();
}

/* ---------- the thought card ---------- */
function memoryText(m) {
  if (!m || !m.total) return t('graph.memNone');
  if (m.strength == null) return t('graph.memNew', { n: m.total });
  const pct = Math.round(m.strength * 100);
  // Not every card reviewed yet: say how far you've got instead of how "well remembered" the note is.
  if (m.seen < m.total) {
    const days = Math.max(1, m.next ?? 1);
    const next = m.due > 0 ? t('graph.memDueNow', { n: m.due }) : days === 1 ? t('graph.memTomorrow') : t('graph.memNextIn', { when: RV.intervalLabel(days) });
    return t('graph.memPartial', { seen: m.seen, total: m.total, next });
  }
  if (m.due > 0) return t('graph.memDue', { pct, n: m.due });
  if (m.strength >= 0.85) return t('graph.memStrong', { pct, when: RV.intervalLabel(Math.max(1, m.next ?? 1)) });
  return t('graph.memFading', { pct });
}
function select(p, { spread = true } = {}) {
  G.selected = p;
  const recalled = spread ? activate(p) : [];
  showCard(p, recalled);
  drawGraph();
}
function showCard(p, recalled) {
  const card = $('#graph-card');
  const region = p.region >= 0 ? G.regions[p.region] : null;
  const m = p.mem ?? (p.kind === 'note' ? RV.noteMemory(p.id) : null);
  const links = (G.adj.get(p) || []).filter(x => x.l.kind === 'link').length, assoc = (G.adj.get(p) || []).filter(x => x.l.kind === 'assoc').length;
  const top = recalled.slice(0, 6);
  card.innerHTML = `<div class="gc-head"><b>${esc(p.label)}</b><button class="gc-x" title="${esc(t('graph.close'))}">×</button></div>
    ${region ? `<div class="gc-region"><span class="gc-dot" style="background:${region.color}"></span>${esc(t('graph.region', { name: region.name }))}</div>` : ''}
    ${p.kind === 'note' ? `<div class="gc-mem${m?.due ? ' due' : ''}">${esc(memoryText(m))}</div>` : ''}
    <div class="gc-stats muted">${esc(t('graph.stats', { links, assoc }))}</div>
    ${top.length ? `<div class="gc-sub">${esc(t('graph.bringsToMind'))}</div><div class="gc-list">${top.map(({ p: q, level }) =>
      `<a href="#" data-id="${esc(q.id)}"><span class="gc-bar" style="width:${Math.round(level * 100)}%"></span><span class="gc-name">${esc(q.label)}</span></a>`).join('')}</div>` : ''}
    <div class="gc-actions">
      <button class="mod-button mod-cta" data-a="open">${esc(t('graph.open'))}</button>
      ${p.kind === 'note' && m?.total ? `<button class="mod-button" data-a="quiz">${esc(t('review.quizMe'))}</button>` : ''}
      <button class="mod-button" data-a="wander">${esc(t('graph.wanderFrom'))}</button>
    </div>`;
  card.style.top = (document.querySelector('.graph-controls').offsetHeight + 22) + 'px';
  const wasHidden = card.classList.contains('hidden');
  card.classList.remove('hidden');
  if (wasHidden && !G.wander) {
    if (!G.userMoved) fitGraph();
    else { const A = freeArea(), w = canvas.clientWidth, sx = w / 2 + G.ox + p.x * G.scale, left = A.cx + w / 2 - A.w / 2; if (sx < left + 30) centreOn(p); }
  }
  card.querySelector('.gc-x').onclick = closeCard;
  card.querySelectorAll('.gc-list a').forEach(a => a.onclick = e => { e.preventDefault(); const q = G.byId.get(a.dataset.id); if (q) select(q); });
  card.querySelector('[data-a=open]').onclick = () => openNode(p);
  card.querySelector('[data-a=quiz]')?.addEventListener('click', () => RV.checkNote(p.id));
  card.querySelector('[data-a=wander]').onclick = () => startWander(p);
}
function closeCard() { G.selected = null; $('#graph-card').classList.add('hidden'); if (!G.userMoved) fitGraph(); else drawGraph(); }
function openNode(n) {
  stopWander();
  if (n.kind === 'note' || n.kind === 'attachment') H.openNote(n.id);
  else H.openLink(n.label);
}

/* ---------- mind wandering ---------- */
// Drift from thought to thought: usually along a strong connection, sometimes a weaker one, and now and
// then a jump to an unrelated idea, the way a wandering mind does.
function startWander(from) {
  stopWander();
  const notes = G.nodes.filter(p => p.kind === 'note');
  if (!notes.length) return;
  let cur = from || G.selected || notes.reduce((a, b) => ((G.adj.get(b)?.length || 0) > (G.adj.get(a)?.length || 0) ? b : a));
  const trail = [cur], recent = [cur];
  G.wander = { trail, timer: 0 };
  $('#g-wander').textContent = t('graph.stopWander');
  $('#g-wander').classList.add('active');
  const step = () => {
    if (!G.wander) return;
    const options = (G.adj.get(cur) || []).filter(x => x.n.kind === 'note' && !recent.includes(x.n));
    let next = null;
    if (options.length && Math.random() > 0.12) {
      const total = options.reduce((s, x) => s + x.w, 0);
      let r = Math.random() * total;
      for (const x of options) { r -= x.w; if (r <= 0) { next = x.n; break; } }
      next = next || options[0].n;
      next.jump = false;
    } else {
      const pool = notes.filter(p => !recent.includes(p));
      if (!pool.length) return stopWander();
      next = pool[Math.floor(Math.random() * pool.length)];
      next.jump = true;
    }
    cur = next; trail.push(cur); recent.push(cur); if (recent.length > 5) recent.shift();
    G.selected = cur;
    activate(cur, { hops: 2, hold: 1200 });
    showCard(cur, []);
    centreOn(cur);
    drawTrail();
    if (trail.length >= 12) return stopWander(true);
    G.wander.timer = setTimeout(step, 1700);
  };
  G.selected = cur; activate(cur, { hops: 2, hold: 1200 }); showCard(cur, []); centreOn(cur); drawTrail();
  G.wander.timer = setTimeout(step, 1700);
}
function stopWander(keepTrail = true) {
  if (!G.wander) return;
  clearTimeout(G.wander.timer);
  const trail = G.wander.trail;
  G.wander = null;
  $('#g-wander').textContent = t('graph.wander');
  $('#g-wander').classList.remove('active');
  if (keepTrail) drawTrail(trail); else $('#graph-trail').classList.add('hidden');
}
function drawTrail(trail = G.wander?.trail) {
  const el = $('#graph-trail');
  if (!trail?.length) return el.classList.add('hidden');
  el.innerHTML = `<span class="gt-title">${esc(t('graph.trail'))}</span>` + trail.map((p, i) =>
    `${i ? `<span class="gt-arrow">${p.jump ? '⤳' : '→'}</span>` : ''}<a href="#" data-id="${esc(p.id)}" title="${esc(p.jump ? t('graph.jump') : '')}">${esc(p.label)}</a>`).join('') +
    `<button class="gt-x" title="${esc(t('graph.close'))}">×</button>`;
  el.classList.remove('hidden');
  el.scrollLeft = el.scrollWidth;
  el.querySelectorAll('a').forEach(a => a.onclick = e => { e.preventDefault(); const q = G.byId.get(a.dataset.id); if (q) { stopWander(); select(q); centreOn(q); } });
  el.querySelector('.gt-x').onclick = () => { stopWander(false); el.classList.add('hidden'); };
}
function centreOn(p) {
  const A = freeArea(), tx = A.cx - p.x * G.scale, ty = A.cy - p.y * G.scale, fx = G.ox, fy = G.oy, t0 = performance.now();
  const anim = () => {
    const k = Math.min(1, (performance.now() - t0) / 500), e = 1 - Math.pow(1 - k, 3);
    G.ox = fx + (tx - fx) * e; G.oy = fy + (ty - fy) * e;
    if (k < 1) requestAnimationFrame(anim);
  };
  requestAnimationFrame(anim);
  startLoop();
}

/* ---------- legend ---------- */
function drawLegend() {
  const o = opts(), el = $('#graph-legend');
  const rows = [];
  rows.push(`<div><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="1.5"/></svg>${esc(t('graph.legendLink'))}</div>`);
  if (o.assoc) rows.push(`<div><svg width="26" height="8"><line x1="1" y1="4" x2="25" y2="4" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 4"/></svg>${esc(t('graph.legendAssoc'))}</div>`);
  if (o.memory) {
    rows.push(`<div><span class="lg-dot strong"></span>${esc(t('graph.legendStrong'))}</div>`);
    rows.push(`<div><span class="lg-dot fading"></span>${esc(t('graph.legendFading'))}</div>`);
    rows.push(`<div><span class="lg-dot due"></span>${esc(t('graph.legendDue'))}</div>`);
  }
  if (o.regions && G.regions.length) rows.push(`<div><span class="lg-dot region"></span>${esc(t('graph.legendRegions', { n: G.regions.length }))}</div>`);
  rows.push(`<div class="lg-hint">${esc(t('graph.hint'))}</div>`);
  el.innerHTML = rows.join('');
}

/* ---------- mouse ---------- */
function toWorld(ev) {
  const r = canvas.getBoundingClientRect();
  const mx = ev.clientX - r.left, my = ev.clientY - r.top;
  return { mx, my, x: (mx - r.width / 2 - G.ox) / G.scale, y: (my - r.height / 2 - G.oy) / G.scale };
}
function nodeAt(x, y) {
  let best = null, bd = Infinity;
  for (const p of G.nodes) { const d = Math.hypot(p.x - x, p.y - y); if (d < radius(p) + 4 / G.scale && d < bd) { bd = d; best = p; } }
  return best;
}
function bindMouse() {
  canvas.addEventListener('mousedown', ev => {
    const w = toWorld(ev), n = nodeAt(w.x, w.y);
    G.moved = false; G.autoFit = false;
    if (n) { G.drag = n; reheat(0.2); }
    else G.pan = { x: ev.clientX, y: ev.clientY, ox: G.ox, oy: G.oy };
    canvas.classList.add('dragging');
  });
  addEventListener('mousemove', ev => {
    if (H.S.view !== 'graph') return;
    if (G.drag) { const w = toWorld(ev); G.drag.x = w.x; G.drag.y = w.y; G.moved = true; reheat(0.2); return; }
    if (G.pan) { G.ox = G.pan.ox + ev.clientX - G.pan.x; G.oy = G.pan.oy + ev.clientY - G.pan.y; G.moved = true; G.userMoved = true; drawGraph(); return; }
    if (ev.target !== canvas) return;
    const w = toWorld(ev), n = nodeAt(w.x, w.y);
    if (n !== G.hover) { G.hover = n; canvas.classList.toggle('on-node', !!n); drawGraph(); }
  });
  addEventListener('mouseup', () => {
    if (H.S.view !== 'graph') return;
    const n = G.drag, clicked = n && !G.moved, panClick = G.pan && !G.moved;
    G.drag = null; G.pan = null; canvas.classList.remove('dragging');
    if (clicked) { stopWander(); select(n); }        // one click: think about it
    else if (panClick && G.selected && !G.wander) closeCard();
  });
  canvas.addEventListener('dblclick', ev => {          // double click: open it
    const w = toWorld(ev), n = nodeAt(w.x, w.y);
    if (n) openNode(n);
  });
  canvas.addEventListener('wheel', ev => {
    ev.preventDefault();
    G.autoFit = false;
    const w = toWorld(ev), r = canvas.getBoundingClientRect();
    const ns = Math.max(0.08, Math.min(6, G.scale * Math.exp(-ev.deltaY * 0.0015)));
    G.scale = ns; G.userMoved = true;
    G.ox = w.mx - r.width / 2 - w.x * ns; G.oy = w.my - r.height / 2 - w.y * ns;
    drawGraph();
  }, { passive: false });
  canvas.addEventListener('mouseleave', () => { canvas.classList.remove('on-node'); if (G.hover) { G.hover = null; drawGraph(); } });
}
