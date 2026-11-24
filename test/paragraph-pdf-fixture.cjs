// A PDF from pages of paragraphs: page = [{ lines: [..], size }] ([] = a blank, scanned-like page). Lines are
// placed one by one: 1.25 × the type size apart inside a paragraph, a clear gap between paragraphs.
function pdf(pages) {
  const objects = [];
  const add = s => { objects.push(s); return objects.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Count ' + pages.length + ' /Kids [' + pages.map((_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  pages.forEach((pg, i) => {
    // A page is a list of paragraphs, or { h, paras } for another page height (paragraphs may give their own
    // baseline y, as in the desktop report: page height 1040, baselines 980 / 566 / 148).
    const paras = Array.isArray(pg) ? pg : pg.paras, h = Array.isArray(pg) ? 800 : pg.h;
    let y = h - 40, ops = '';
    for (const p of paras) {
      const size = p.size || 11;
      if (p.y) y = p.y;
      for (const l of p.lines) { ops += `BT /F1 ${size} Tf 1 0 0 1 50 ${y.toFixed(2)} Tm (${l}) Tj ET\n`; y -= size * 1.25; }
      y -= size * 1.6;
    }
    const data = ops || 'q Q\n';
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 ' + h + '] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (3 + (i + 1) * 2) + ' 0 R >>');
    add('<< /Length ' + data.length + ' >>\nstream\n' + data + 'endstream');
  });
  let out = '%PDF-1.4\n';
  const offsets = objects.map((s, i) => { const j = out.length; out += (i + 1) + ' 0 obj\n' + s + '\nendobj\n'; return j; });
  const xref = out.length;
  out += 'xref\n0 ' + (objects.length + 1) + '\n0000000000 65535 f \n' + offsets.map(j => String(j).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(out + 'trailer\n<< /Size ' + (objects.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n', 'ascii');
}
module.exports = {pdf};
