// After a build: also save the installer under the old name (MyObsidian-Setup-<version>.exe), so copies of the
// app installed before it was renamed to Graphite still see the update (they look for that name) and can
// upgrade themselves. Remove this step once every installed copy has updated.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const dist = path.join(root, 'dist');
for (const ext of ['.exe', '.exe.blockmap']) {
  const from = path.join(dist, `Graphite-Setup-${version}${ext}`), to = path.join(dist, `MyObsidian-Setup-${version}${ext}`);
  if (fs.existsSync(from)) fs.copyFileSync(from, to);
}
console.log(`Also saved as MyObsidian-Setup-${version}.exe for older installs.`);
