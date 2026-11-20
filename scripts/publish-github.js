// npm run publish -- --notes-file release-notes.md (after building and pushing this commit).
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true }).trim();

async function describeAsset(file, includeManifestDigest = false) {
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || !stat.size) throw new Error('Empty release asset: ' + file);
  const hash = createHash('sha256');
  const sha512 = includeManifestDigest ? createHash('sha512') : null;
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk); sha512?.update(chunk); }
  return { file, name: path.basename(file), size: stat.size, digest: 'sha256:' + hash.digest('hex'),
    ...(sha512 ? {sha512:sha512.digest('base64')} : {}) };
}

async function releaseFiles(dist,version) {
  const name = 'Graphite-Setup-'+version+'.exe', file = path.join(dist,name);
  const manifestFile = path.join(dist,'latest.yml');
  const [setup,blockmap,manifest] = await Promise.all([describeAsset(file,true),describeAsset(file+'.blockmap'),describeAsset(manifestFile)]);
  const bytes = await fs.promises.readFile(manifestFile);
  const expected = require('../electron/updater').parseUpdateManifest(bytes.toString('utf8'),version,name);
  if (expected.size !== setup.size || expected.sha512 !== setup.sha512 || 'sha256:'+createHash('sha256').update(bytes).digest('hex') !== manifest.digest) {
    throw new Error('The update manifest does not match the installer. Build the installer and update manifest together.');
  }
  return [setup,blockmap,manifest];
}

function remoteRefs(repo, tag) {
  const ref = 'refs/tags/' + tag;
  const result = git(['ls-remote', 'https://github.com/' + repo + '.git', 'HEAD', ref, ref + '^{}']);
  const refs = Object.fromEntries(result.split(/\r?\n/).filter(Boolean).map(line => {
    const [sha, name] = line.split('\t');
    return [name, sha];
  }));
  return { head: refs.HEAD, tag: refs[ref + '^{}'] || refs[ref] };
}

function findGh() {
  const candidates = ['gh'];
  if (process.platform === 'win32' && process.env.ProgramFiles) {
    candidates.push(path.join(process.env.ProgramFiles, 'GitHub CLI', 'gh.exe'));
  }
  for (const candidate of candidates) {
    try { execFileSync(candidate, ['--version'], { stdio: 'ignore', windowsHide: true }); return candidate; }
    catch { /* try the standard installation if gh is outside PATH */ }
  }
  throw new Error('Log in with the GitHub CLI or provide a release-capable GITHUB_TOKEN.');
}

function github({ repo, tag, title, commit, notes, notesFile }) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  const gh = token ? null : findGh();
  const prefix = 'repos/' + repo + '/releases';
  const headers = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'Graphite-publisher' };
  const cli = (args, input) => execFileSync(gh, args, { input, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  async function checkResponse(res) {
    if (!res.ok) throw new Error('GitHub returned HTTP ' + res.status + ': ' + (await res.text()).slice(0, 1000));
    return res.status === 204 ? null : res.json();
  }
  async function api(method, suffix, body) {
    const endpoint = prefix + suffix;
    if (gh) {
      const args = ['api', '--hostname', 'github.com', '--method', method, endpoint];
      if (body !== undefined) args.push('--input', '-');
      const output = cli(args, body === undefined ? undefined : JSON.stringify(body));
      return output.trim() ? JSON.parse(output) : null;
    }
    const res = await fetch('https://api.github.com/' + endpoint, {
      method, headers: { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), redirect: 'error',
    });
    return checkResponse(res);
  }
  return {
    async find() {
      for (let page = 1; ; page++) {
        const releases = await api('GET', '?per_page=100&page=' + page);
        const release = releases.find(r => r.tag_name === tag);
        if (release || releases.length < 100) return release;
      }
    },
    async create() {
      if (gh) {
        cli(['release', 'create', tag, '--repo', 'github.com/' + repo, '--draft', '--target', commit,
          '--title', title, '--notes-file', notesFile || '-'], notesFile ? undefined : notes);
        return;
      }
      await api('POST', '', { tag_name: tag, target_commitish: commit, name: title, body: notes, draft: true });
    },
    get: id => api('GET', '/' + id),
    removeEmpty: id => api('DELETE', '/assets/' + id),
    async upload(id, asset) {
      if (gh) {
        cli(['release', 'upload', tag, asset.file, '--repo', 'github.com/' + repo]);
        return;
      }
      const url = new URL('https://uploads.github.com/' + prefix + '/' + id + '/assets');
      url.searchParams.set('name', asset.name);
      const res = await fetch(url, { method: 'POST', redirect: 'error', duplex: 'half',
        headers: { ...headers, 'Content-Type': 'application/octet-stream', 'Content-Length': String(asset.size) },
        body: fs.createReadStream(asset.file) });
      await checkResponse(res);
    },
    publish: id => api('PATCH', '/' + id, { draft: false, prerelease: false, make_latest: 'true' }),
  };
}

function verifyAsset(release, file) {
  const a = release.assets.find(asset => asset.name === file.name);
  if (!a || a.state !== 'uploaded' || a.size !== file.size || a.digest !== file.digest) {
    throw new Error('Remote asset has not matched the local size and SHA-256: ' + file.name);
  }
}

// All GitHub mutations before the final PATCH affect only the matching draft.
async function publishRelease({ remote, refs, tag, commit, files }) {
  const verifyTarget = release => {
    const actual = refs();
    if (actual.tag && actual.tag !== commit) throw new Error(tag + ' already points at a different commit.');
    if (release?.draft === false) {
      if (actual.tag !== commit || release.prerelease) throw new Error('Published tag/commit does not match this stable build.');
      return;
    }
    if (actual.head !== commit) throw new Error('Push the intended commit to the GitHub default branch before publishing.');
    if (release && release.target_commitish !== commit && actual.tag !== commit) {
      throw new Error('The existing draft is not pinned to the intended commit.');
    }
  };
  let release = await remote.find();
  verifyTarget(release);
  if (!release) {
    await remote.create();
    release = await remote.find();
    if (!release) throw new Error('The new GitHub draft is not visible yet. Retry the same release.');
    verifyTarget(release);
  }
  if (release.draft) {
    for (const file of files) {
      const asset = release.assets.find(a => a.name === file.name);
      if (asset && asset.state === 'starter' && asset.size === 0) {
        await remote.removeEmpty(asset.id); // abandoned empty upload from an interrupted draft
      } else if (asset) {
        verifyAsset(release, file);
        continue;
      }
      await remote.upload(release.id, file);
    }
    release = await remote.get(release.id);
    for (const file of files) verifyAsset(release, file);
    verifyTarget(release);
    if (release.draft) release = await remote.publish(release.id);
  }
  if (release.draft || release.prerelease) throw new Error('GitHub has not published the stable release.');
  verifyTarget(release);
  for (const file of files) verifyAsset(release, file);
  return release.html_url;
}

async function main() {
  const pkg = require(path.join(root, 'package.json')), repo = pkg.graphite?.updateRepo;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '') || !/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error('Set a GitHub owner/name and a stable X.Y.Z version in package.json.');
  }
  const tag = 'v' + pkg.version, title = 'Graphite ' + pkg.version;
  const commit = git(['rev-parse', 'HEAD']);
  const args = process.argv.slice(2);
  let notesFile, notes = title;
  if (args[0] === '--notes-file' && args.length === 2) {
    notesFile = path.resolve(args[1]);
    notes = await fs.promises.readFile(notesFile, 'utf8');
  } else if (args.length === 1 && !args[0].startsWith('--')) notes = args[0];
  else if (args.length) throw new Error('Use --notes-file <path> or supply one release-note string.');
  const files = await releaseFiles(path.join(root,'dist'),pkg.version);
  const remote = github({ repo, tag, title, commit, notes, notesFile });
  const url = await publishRelease({ remote, refs: () => remoteRefs(repo, tag), tag, commit, files });
  console.log('Published', url);
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exitCode = 1; });
module.exports = { publishRelease, releaseFiles };
