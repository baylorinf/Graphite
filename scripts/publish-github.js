// Publish the current installer as a GitHub release, so installed copies of Graphite update themselves.
//   node scripts/publish-github.js            (after npm run dist)
// Needs: package.json → graphite.updateRepo ("owner/name", a public repo), and a GitHub token with permission
// to create releases, in the GITHUB_TOKEN environment variable (or, if the GitHub CLI "gh" is installed and
// logged in, it is used instead). The token is only sent to api.github.com.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));
const repo = pkg.graphite?.updateRepo;
if (!repo) { console.error('Set "graphite": { "updateRepo": "owner/name" } in package.json first.'); process.exit(1); }
const tag = 'v' + pkg.version;
const files = [`Graphite-Setup-${pkg.version}.exe`, `Graphite-Setup-${pkg.version}.exe.blockmap`].map(f => path.join(root, 'dist', f));
for (const f of files) if (!fs.existsSync(f)) { console.error('Missing ' + f + ' (run npm run dist first)'); process.exit(1); }
const notes = process.argv[2] || `Graphite ${pkg.version}`;

function hasGh() { try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } }

(async () => {
  if (!process.env.GITHUB_TOKEN && hasGh()) {
    execFileSync('gh', ['release', 'create', tag, ...files, '--repo', repo, '--title', `Graphite ${pkg.version}`, '--notes', notes], { stdio: 'inherit' });
    return;
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) { console.error('No GITHUB_TOKEN and no logged-in GitHub CLI.'); process.exit(1); }
  const h = { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'Graphite-publisher' };
  let r = await fetch(`https://api.github.com/repos/${repo}/releases`, { method: 'POST', headers: h, body: JSON.stringify({ tag_name: tag, name: `Graphite ${pkg.version}`, body: notes }) });
  if (!r.ok) { console.error('Creating the release failed:', r.status, await r.text()); process.exit(1); }
  const rel = await r.json();
  for (const f of files) {
    const url = rel.upload_url.replace(/\{.*\}$/, '') + '?name=' + encodeURIComponent(path.basename(f));
    r = await fetch(url, { method: 'POST', headers: { ...h, 'Content-Type': 'application/octet-stream' }, body: fs.readFileSync(f) });
    if (!r.ok) { console.error('Upload failed for', path.basename(f), r.status, await r.text()); process.exit(1); }
    console.log('Uploaded', path.basename(f));
  }
  console.log('Published', rel.html_url);
})();
