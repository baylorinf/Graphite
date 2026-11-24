/* ---------- paragraphs and source IDs ----------
   A page's text is split into paragraphs from its text items alone (text and geometry in PDF units, so the
   zoom level never changes the result): lines are items on one baseline; a new paragraph starts at a gap wider
   than ~1.7 line heights or 1.35 × the page's usual line spacing, a jump up the page (a new column or box) or
   far to the right, a clear change of type size, or after MAX_LINES lines (so a page of one endless block still
   has places to point at). Paragraph i (1-based) of page n is "P{n}S{i}". Each also has `fp`, a fingerprint of
   its words: a link carries it, so after the PDF changed a link finds its paragraph again (or falls back to the
   page) instead of highlighting whatever is now paragraph i. */
const MAX_LINES = 40;
export function textFingerprint(s) {
  const t = String(s || '').replace(/\s+/g, '').toLowerCase();
  let h = 0x811c9dc5;
  for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36).padStart(7, '0');
}
// tc: PDF.js getTextContent() of page n.
// Returns [{ id, n, i, text, fp, box: [x0, y0, x1, y1], lines: [[x0, y0, x1, y1]…] }] in PDF units.
export function paragraphs(tc, n) {
  const lines = [];
  let cur = null, brk = true;
  for (const it of tc.items || []) {
    if (typeof it.str !== 'string') continue; // marked-content markers
    const tr = it.transform || [1, 0, 0, 1, 0, 0];
    const h = Math.abs(it.height) || Math.hypot(tr[2], tr[3]) || 1;
    if (it.str.trim()) {
      const x = tr[4], y = tr[5], w = Math.abs(it.width) || 0;
      if (brk || !cur || Math.abs(y - cur.y) > Math.max(0.5, h * 0.5)) {
        cur = { str: '', y, h, x0: x, x1: x + w, y0: y - h * 0.25, y1: y + h };
        lines.push(cur);
      }
      cur.str += it.str;
      cur.h = Math.max(cur.h, h);
      cur.x0 = Math.min(cur.x0, x); cur.x1 = Math.max(cur.x1, x + w);
      cur.y0 = Math.min(cur.y0, y - h * 0.25); cur.y1 = Math.max(cur.y1, y + h);
      brk = false;
    } else if (cur && !brk) cur.str += it.str; // a space between words
    if (it.hasEOL) brk = true;
  }
  const pitches = [];
  for (let k = 1; k < lines.length; k++) { const d = lines[k - 1].y - lines[k].y; if (d > 0) pitches.push(d); }
  pitches.sort((a, b) => a - b);
  const usual = pitches.length ? pitches[Math.floor(pitches.length / 2)] : 0;
  const out = [];
  let para = null;
  lines.forEach((l, k) => {
    const prev = lines[k - 1];
    let fresh = !para || para.lines.length >= MAX_LINES;
    if (!fresh) {
      const d = prev.y - l.y, hh = Math.max(prev.h, l.h);
      fresh = d <= 0 // up the page: a new column or box
        || d > hh * 1.7 || (usual > 0 && d > usual * 1.35)
        || hh / Math.min(prev.h, l.h) > 1.25 // a heading's type size
        || l.x0 > prev.x1 + hh * 2; // far to the right: a side box
    }
    if (fresh) { para = { lines: [] }; out.push(para); }
    para.lines.push(l);
  });
  return out.map((p, i) => {
    const text = p.lines.map(l => l.str.trim()).join('\n');
    const box = [Math.min(...p.lines.map(l => l.x0)), Math.min(...p.lines.map(l => l.y0)), Math.max(...p.lines.map(l => l.x1)), Math.max(...p.lines.map(l => l.y1))];
    return { id: `P${n}S${i + 1}`, n, i: i + 1, text, fp: textFingerprint(text), box, lines: p.lines.map(l => [l.x0, l.y0, l.x1, l.y1]) };
  });
}
