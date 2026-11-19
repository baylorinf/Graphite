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
export function merge3(base, mine, theirs) {
  if (mine === theirs) return { ok: true, text: mine };
  if (base === mine) return { ok: true, text: theirs };
  if (base === theirs) return { ok: true, text: mine };
  const O = base.split('\n'), A = mine.split('\n'), B = theirs.split('\n');
  const ma = lcsMap(O, A), mb = lcsMap(O, B);
  if (!ma || !mb) return { ok: false };
  const out = [];
  let o = 0, a = 0, b = 0;
  const region = (o2, a2, b2) => {
    const oR = O.slice(o, o2), aR = A.slice(a, a2), bR = B.slice(b, b2);
    if (same(aR, oR)) out.push(...bR);
    else if (same(bR, oR)) out.push(...aR);
    else if (same(aR, bR)) out.push(...aR);
    else if (!oR.length) out.push(...aR, ...bR); // both only added lines here: keep both
    else return false;
    return true;
  };
  for (let i = 0; i < O.length; i++) {
    // A base line kept unchanged by both sides is a stable anchor.
    if (ma[i] < 0 || mb[i] < 0 || ma[i] < a || mb[i] < b) continue;
    if (!region(i, ma[i], mb[i])) return { ok: false };
    out.push(O[i]);
    o = i + 1; a = ma[i] + 1; b = mb[i] + 1;
  }
  if (!region(O.length, A.length, B.length)) return { ok: false };
  return { ok: true, text: out.join('\n') };
}

// Conflict copies made by Graphite, Dropbox, Syncthing, Google Drive and OneDrive.
const CONFLICT_RE = /\((conflict|conflicted copy)\b[^)]*\)|\.sync-conflict-\d{8}-\d{6}|-(DESKTOP|LAPTOP|PC)-[A-Z0-9]{4,}(\.\w+)?$/i;
export const isConflictCopy = name => CONFLICT_RE.test(name);
