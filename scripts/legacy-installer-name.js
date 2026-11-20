// After a build: also save the installer under the old name (MyObsidian-Setup-<version>.exe), so copies of the
// app installed before it was renamed to Graphite still see the update (they look for that name) and can
// upgrade themselves. Remove this step once every installed copy has updated.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const { version } = require(path.join(root, 'package.json'));
const dist = path.join(root, 'dist');
async function finish() {
  const [installer,blockmap] = await require('./publish-github').releaseFiles(dist,version);
  // Older clients discover this alias by filename, so it must appear only after its contents are complete.
  for (const asset of [blockmap,installer]) {
    const dest = path.join(dist,asset.name.replace(/^Graphite-/,'MyObsidian-'));
    const temp = dest+'.'+process.pid+'.tmp';
    try { await fs.promises.copyFile(asset.file,temp); await fs.promises.rename(temp,dest); }
    finally { await fs.promises.unlink(temp).catch(()=>{}); }
  }
  const current = version.split('.').map(Number);
  for (const file of await fs.promises.readdir(dist)) {
    const match = /^(?:Graphite|MyObsidian)-Setup-(\d+\.\d+\.\d+)\.exe(?:\.blockmap)?$/i.exec(file);
    if (!match) continue;
    const parts = match[1].split('.').map(Number);
    const firstDifference = parts.findIndex((n,i)=>n!==current[i]);
    if (firstDifference>=0 && parts[firstDifference]<current[firstDifference]) await fs.promises.unlink(path.join(dist,file));
  }
  console.log(`Also saved as MyObsidian-Setup-${version}.exe for older installs.`);
}
finish().catch(error=>{console.error(error.message);process.exitCode=1;});
