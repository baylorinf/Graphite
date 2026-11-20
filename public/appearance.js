// Appearance: text font, code font, font size and the monospace editor (Settings → Appearance).
// Saved in this app's local storage, so it survives updates and doesn't travel with a synced vault.

const KEY = 'mo:appearance';
export const DEFAULTS = { textFont: '', codeFont: '', fontSize: 16, codeSize: 14, editorMono: false };
const TEXT_FALLBACK = '-apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, "Microsoft YaHei", "Microsoft JhengHei", "Yu Gothic UI", Meiryo, "Malgun Gothic", sans-serif';
const CODE_FALLBACK = '"Cascadia Code", Consolas, Menlo, "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", "Yu Gothic UI", "Malgun Gothic", monospace';

export function loadAppearance() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; }
}
export function saveAppearance(p) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* ignore */ }
  applyAppearance(p);
}

const quote = f => `"${String(f).replace(/["\\]/g, '')}"`;
export function applyAppearance(p = loadAppearance()) {
  const root = document.documentElement;
  if (p.textFont) { root.style.setProperty('--font-text', `${quote(p.textFont)}, ${TEXT_FALLBACK}`); root.dataset.textFont = ''; }
  else { root.style.removeProperty('--font-text'); delete root.dataset.textFont; }
  root.style.setProperty('--font-code', p.codeFont ? `${quote(p.codeFont)}, ${CODE_FALLBACK}` : CODE_FALLBACK);
  root.style.setProperty('--font-size', `${Math.min(28, Math.max(10, Number(p.fontSize) || 16))}px`);
  // Code only (the project editor and source files opened from notes); note text keeps its own size.
  root.style.setProperty('--font-code-size', `${codeSize(p)}px`);
  if (p.editorMono) root.dataset.editorMono = ''; else delete root.dataset.editorMono;
  // Code editors measure their lines again (CodeMirror needs to, after a font change).
  try { window.dispatchEvent(new CustomEvent('graphite-appearance')); } catch { /* old browser */ }
}
export const codeSize = p => Math.min(28, Math.max(10, Number(p?.codeSize) || 14));

/* ---------- finding installed fonts ---------- */
const ctx = document.createElement('canvas').getContext('2d');
const width = (font, text) => { ctx.font = `40px ${font}`; return ctx.measureText(text).width; };

// Is this font installed? Text in it must differ from the generic fallbacks.
export function isInstalled(family) {
  const s = 'mmmmmmmmmmlli1WQ@#';
  return ['monospace', 'serif', 'sans-serif'].some(g => width(`${quote(family)}, ${g}`, s) !== width(g, s));
}
// Monospace: narrow and wide letters take the same space.
export function isMonospace(family) {
  const f = `${quote(family)}, serif`;
  return Math.abs(width(f, 'iiiiiiiiii') - width(f, 'WWWWWWWWWW')) < 1;
}

const COMMON = [
  'Segoe UI', 'Segoe UI Variable Text', 'Arial', 'Bahnschrift', 'Calibri', 'Cambria', 'Candara', 'Century Gothic', 'Constantia', 'Corbel',
  'Franklin Gothic Medium', 'Garamond', 'Georgia', 'Inter', 'Lato', 'Lucida Sans Unicode', 'Noto Sans', 'Noto Serif', 'Open Sans',
  'Palatino Linotype', 'Roboto', 'Source Sans Pro', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana',
  'Microsoft YaHei', 'Microsoft JhengHei', 'SimSun', 'DengXian', 'Yu Gothic', 'Yu Mincho', 'Meiryo', 'Malgun Gothic',
  'Cascadia Code', 'Cascadia Mono', 'Consolas', 'Courier New', 'Lucida Console', 'JetBrains Mono', 'Fira Code', 'Fira Mono',
  'Source Code Pro', 'Hack', 'Iosevka', 'IBM Plex Mono', 'Roboto Mono', 'Ubuntu Mono', 'Victor Mono', 'Monaspace Neon', 'SF Mono', 'Menlo', 'Monaco',
];

let cache = null;
// Returns { all: [...families], mono: [...monospace families] }, sorted.
export async function listFonts() {
  if (cache) return cache;
  let families = [];
  try {
    // In a browser this may ask for permission; don't wait for an answer longer than 1.5 s.
    if (window.queryLocalFonts) {
      const fonts = await Promise.race([window.queryLocalFonts(), new Promise(r => setTimeout(() => r([]), 1500))]);
      families = [...new Set(fonts.map(f => f.family))];
    }
  } catch { /* not allowed: use the common list */ }
  if (!families.length) families = COMMON.filter(isInstalled);
  families = families.filter(f => f && !f.startsWith('@')).sort((a, b) => a.localeCompare(b));
  cache = { all: families, mono: families.filter(isMonospace) };
  return cache;
}
