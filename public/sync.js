// Sync helpers: content hashing, three-way merge, and recognising conflict copies made by cloud apps.

// 53-bit string hash (same function as server.js). Used to tell the server which version we last saw.
export function hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// For each line of `a`, the index of the matching line in `b` (longest common subsequence), or -1.
function lcsMap(a, b) {
  const map = new Array(a.length).fill(-1);
  // Strip the common start and end first; the middle is usually small.
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) { map[s] = s; s++; }
  let ea = a.length, eb = b.length;
  while (ea > s && eb > s && a[ea - 1] === b[eb - 1]) { ea--; eb--; map[ea] = eb; }
  const n = ea - s, m = eb - s;
  if (!n || !m) return map;
  if (n * m > 4e6) return null; // too big to compare line by line: treat as a conflict
  const w = m + 1, dp = new Uint32Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i * w + j] = a[s + i] === b[s + j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  for (let i = 0, j = 0; i < n && j < m;) {
    if (a[s + i] === b[s + j]) { map[s + i] = s + j; i++; j++; }
    else if (dp[(i + 1) * w + j] >= dp[i * w + j + 1]) i++;
    else j++;
  }
  return map;
}

const same = (x, y) => x.length === y.length && x.every((v, i) => v === y[i]);

// Three-way merge of two edited versions of `base`.
// Returns { ok: true, text } when the edits don't overlap, or { ok: false } when they clash.
// Each version's edits are worked out as "hunks": which lines of the base they replace (start..end) and with
// what. Hunks from the two sides merge when they touch different base lines, even next to each other (one side
// changed line 2, the other line 3). They clash only when they change the same base lines differently.
export function merge3(base, mine, theirs) {
  if (mine === theirs) return { ok: true, text: mine };
  if (base === mine) return { ok: true, text: theirs };
  if (base === theirs) return { ok: true, text: mine };
  const O = base.split('\n'), A = mine.split('\n'), B = theirs.split('\n');
  const ma = lcsMap(O, A), mb = lcsMap(O, B);
  if (!ma || !mb) return { ok: false };
  const ha = hunks(O, A, ma).map(h => ({ ...h, side: 'a' })), hb = hunks(O, B, mb).map(h => ({ ...h, side: 'b' }));
  const all = [...ha, ...hb].sort((x, y) => x.s - y.s || x.e - y.e || (x.side < y.side ? -1 : 1));
  // Two hunks clash if they replace overlapping base lines, or both insert at the same place, or one inserts
  // strictly inside the lines the other replaces.
  const touch = (x, y) => {
    const xi = x.s === x.e, yi = y.s === y.e;
    if (xi && yi) return x.s === y.s;
    if (xi) return x.s > y.s && x.s < y.e;
    if (yi) return y.s > x.s && y.s < x.e;
    return x.s < y.e && y.s < x.e;
  };
  const out = [];
  let pos = 0;
  for (let i = 0; i < all.length;) {
    const group = [all[i++]];
    while (i < all.length && group.some(g => touch(g, all[i]))) group.push(all[i++]);
    const s0 = Math.min(...group.map(h => h.s)), e0 = Math.max(...group.map(h => h.e));
    let lines;
    if (group.length === 1) lines = group[0].lines;
    else if (group.length === 2 && group[0].side !== group[1].side) {
      const [x, y] = group;
      if (x.s === y.s && x.e === y.e && same(x.lines, y.lines)) lines = x.lines;          // the same edit on both sides
      else if (x.s === x.e && y.s === y.e) lines = [...x.lines, ...y.lines];              // both only added lines here: keep both
      else return { ok: false };
    } else return { ok: false };
    out.push(...O.slice(pos, s0), ...lines);
    pos = e0;
  }
  out.push(...O.slice(pos));
  return { ok: true, text: out.join('\n') };
}

// The edits that turn base lines O into X, given the LCS map O→X: [{ s, e, lines }], where base lines s..e-1 are
// replaced by `lines` (s === e means lines inserted before base line s).
function hunks(O, X, map) {
  const out = [];
  let po = 0, px = 0;
  for (let i = 0; i < O.length; i++) {
    const j = map[i];
    if (j < 0 || j < px) continue; // not a kept line (or out of order): part of an edit
    if (i > po || j > px) out.push({ s: po, e: i, lines: X.slice(px, j) });
    po = i + 1; px = j + 1;
  }
  if (po < O.length || px < X.length) out.push({ s: po, e: O.length, lines: X.slice(px) });
  return out;
}

// Conflict copies made by Graphite, Dropbox, Syncthing, Google Drive and OneDrive.
const CONFLICT_RE = /\((conflict|conflicted copy)\b[^)]*\)|\.sync-conflict-\d{8}-\d{6}|-(DESKTOP|LAPTOP|PC)-[A-Z0-9]{4,}(\.\w+)?$/i;
export const isConflictCopy = name => CONFLICT_RE.test(name);
