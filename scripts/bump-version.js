// Runs before every installer build (npm run dist):
//  - raises the version by one patch step (1.1.0 → 1.1.1), or sets it: node scripts/bump-version.js 2.0.0
//  - removes installers from older builds, so dist/ only holds the newest one.
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

const wanted = process.argv[2];
let next;
if (wanted) {
  if (!/^\d+\.\d+\.\d+$/.test(wanted)) { console.error(`Not a version: ${wanted} (expected e.g. 1.2.0)`); process.exit(1); }
  next = wanted;
} else {
  const [maj, min, pat] = pkg.version.split('.').map(Number);
  next = `${maj}.${min}.${pat + 1}`;
}
const before = pkg.version;
pkg.version = next;
// The installed app watches this folder for newer installers and offers to update itself.
pkg.myobsidian = { ...(pkg.myobsidian || {}), updateFolder: path.join(root, 'dist') };
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');

const dist = path.join(root, 'dist');
let removed = 0;
if (fs.existsSync(dist)) {
  for (const f of fs.readdirSync(dist)) {
    if (/^(Graphite|MyObsidian)-Setup-.*\.exe(\.blockmap)?$/.test(f) || f === 'latest.yml') { fs.rmSync(path.join(dist, f)); removed++; }
  }
}
console.log(`Version ${before} → ${next}${removed ? ` (removed ${removed} old installer file${removed > 1 ? 's' : ''})` : ''}`);
