// The PDF preview's scrollbar: in the light theme, with the pointer over the page and the mouse wheel scrolling a
require('./isolate.cjs'); // never touch the real ~/.graphite or ~/.claude
// multi-page PDF, the scrollbar thumb must be clearly visible, move with the pages, and be draggable.
//   node test/pdf-scrollbar.cjs [repo] [shot.png]
const path = require('node:path'); const fs = require('node:fs/promises'); const os = require('node:os');
const assert = require('node:assert/strict');
const repo = path.resolve(process.argv[2] || path.join(__dirname, '..'));
const shot = process.argv[3];
const { chromium } = require(process.env.GRAPHITE_PLAYWRIGHT || path.join(process.env.USERPROFILE || '', '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright'));
function pdf(n) {
  const o = []; const add = s => { o.push(s); return o.length; };
  add('<< /Type /Catalog /Pages 2 0 R >>');
  add('<< /Type /Pages /Count ' + n + ' /Kids [' + Array.from({ length: n }, (_, i) => (4 + i * 2) + ' 0 R').join(' ') + '] >>');
  add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  for (let i = 1; i <= n; i++) {
    const d = 'BT /F1 24 Tf 72 700 Td (Page ' + i + ') Tj ET\n';
    add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + (3 + i * 2) + ' 0 R >>');
    add('<< /Length ' + d.length + ' >>\nstream\n' + d + 'endstream');
  }
  let out = '%PDF-1.4\n'; const offs = o.map((s, i) => { const j = out.length; out += (i + 1) + ' 0 obj\n' + s + '\nendobj\n'; return j; });
  const x = out.length;
  out += 'xref\n0 ' + (o.length + 1) + '\n0000000000 65535 f \n' + offs.map(j => String(j).padStart(10, '0') + ' 00000 n \n').join('');
  return Buffer.from(out + 'trailer\n<< /Size ' + (o.length + 1) + ' /Root 1 0 R >>\nstartxref\n' + x + '\n%%EOF\n', 'ascii');
}
// Contrast of two CSS colours (WCAG relative luminance).
function lum(c) { const m = c.match(/[\d.]+/g).map(Number); const [r, g, b] = m.slice(0, 3).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; }
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
(async () => {
  const vault = await fs.mkdtemp(path.join(os.tmpdir(), 'graphite-pdfscroll-'));
  await fs.writeFile(path.join(vault, 'Long.pdf'), pdf(12));
  await fs.writeFile(path.join(vault, 'Welcome.md'), 'hi');
  const port = await require(path.join(repo, 'server.js')).start({ vault });
  const b = await chromium.launch({ executablePath: process.env.GRAPHITE_CHROME || 'C:/Program Files/Google/Chrome/Application/chrome.exe', ignoreDefaultArgs: ['--hide-scrollbars'] }); // real scrollbars, as in the app
  const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
  await ctx.addInitScript(() => { localStorage.setItem('mo:theme', '"light"'); });
  const p = await ctx.newPage();
  await p.goto('http://127.0.0.1:' + port);
  await p.locator('#tree [data-path="Long.pdf"]').click();
  const sc = p.locator('.pdf-scroll');
  await p.locator('.page[data-page-number="2"]').waitFor({ timeout: 15000 });
  await p.waitForTimeout(500);
  const theme = await p.evaluate(() => document.documentElement.dataset.theme);
  const box = await sc.boundingBox();
  // Pointer on the page text, then real wheel scrolling.
  await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  const top0 = await sc.evaluate(e => e.scrollTop);
  for (let i = 0; i < 6; i++) { await p.mouse.wheel(0, 400); await p.waitForTimeout(60); }
  await p.waitForTimeout(300);
  const info = await sc.evaluate(e => {
    const cs = getComputedStyle(e, '::-webkit-scrollbar-thumb'), tr = getComputedStyle(e, '::-webkit-scrollbar');
    return { top: e.scrollTop, max: e.scrollHeight - e.clientHeight, barW: e.offsetWidth - e.clientWidth, thumb: cs.backgroundColor, track: getComputedStyle(e, '::-webkit-scrollbar-track').backgroundColor, bg: getComputedStyle(e).backgroundColor, sbw: tr.width };
  });
  if (shot) await p.screenshot({ path: shot, clip: { x: box.x + box.width - 160, y: box.y, width: 160, height: box.height } });
  console.log({ theme, top0, ...info });
  assert.equal(theme, 'light');
  assert.ok(info.top > top0 + 1000, 'wheel did not scroll the PDF');
  assert.ok(info.barW >= 8, 'no room for a scrollbar: ' + info.barW);
  // Measure what is on screen: the scrollbar column, where the thumb should be versus the empty track below it.
  const col = { x: Math.floor(box.x + box.width - info.barW), y: Math.floor(box.y), width: info.barW, height: Math.floor(box.height) };
  const png = await p.screenshot({ clip: col });
  const thumbAt = (info.top / (info.max + box.height)) * box.height, thumbH = (box.height / (info.max + box.height)) * box.height;
  const px = await p.evaluate(async ({ b64, a, h }) => {
    const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
    const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d'); g.drawImage(img, 0, 0);
    const at = y => { const d = g.getImageData(Math.floor(img.width / 2), Math.max(0, Math.min(img.height - 1, Math.round(y))), 1, 1).data; return `rgb(${d[0]}, ${d[1]}, ${d[2]})`; };
    return { thumb: at(a + h / 2), track: at(img.height - 6) };
  }, { b64: png.toString('base64'), a: thumbAt, h: thumbH });
  const c = contrast(px.thumb, px.track);
  console.log({ onScreen: px });
  // Drag the thumb back to the top: the pages follow.
  const x = box.x + box.width - info.barW / 2;
  const thumbY = box.y + (info.top / (info.max + box.height)) * box.height + 20;
  await p.mouse.move(x, thumbY); await p.mouse.down(); await p.mouse.move(x, box.y + 2, { steps: 8 }); await p.mouse.up();
  await p.waitForTimeout(200);
  const afterDrag = await sc.evaluate(e => e.scrollTop);
  console.log({ thumbContrast: c.toFixed(2), afterDrag });
  assert.ok(c >= 1.8, 'scrollbar thumb is hard to see (contrast ' + c.toFixed(2) + ': ' + px.thumb + ' on ' + px.track + ')');
  assert.ok(afterDrag < info.top - 500, 'dragging the scrollbar did not move the pages');
  console.log('PASS pdf scrollbar visible, moves with the pages and drags');
  await b.close(); process.exit(0);
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
