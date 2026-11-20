'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const SETUP = /^(?:Graphite|MyObsidian)-Setup-(\d+\.\d+\.\d+)\.exe$/;
const CACHE_MS = 15 * 60 * 1000;
const USER_AGENT = 'Graphite-updater';

function compareVersions(left, right) {
  const a = left.split('.').map(Number);
  const b = right.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (a[i] || 0) - (b[i] || 0);
    if (diff) return diff;
  }
  return 0;
}

function findLocal(folder, current) {
  if (!folder) return null;
  let names;
  try { names = fs.readdirSync(folder); } catch { return null; }
  let best = null;
  for (const name of names) {
    const version = name.match(SETUP)?.[1];
    if (!version || compareVersions(version, best?.version || current) <= 0) continue;
    const file = path.join(folder, name);
    // electron-builder writes the companion blockmap after the installer.
    if (fs.existsSync(file + '.blockmap')) best = { version, name, file };
  }
  return best;
}

function releaseAsset(release, repo, current) {
  const version = String(release.tag_name || '').match(/^v?(\d+\.\d+\.\d+)$/)?.[1];
  if (!version || !Array.isArray(release.assets) || release.draft || release.prerelease) {
    throw new Error('Invalid release metadata');
  }
  if (compareVersions(version, current) <= 0) return null;
  const asset = release.assets.find(a => a.name?.match(SETUP)?.[1] === version);
  if (!asset || !Number.isSafeInteger(asset.size) || asset.size <= 0 ||
      (asset.digest != null && !/^sha256:[a-f\d]{64}$/i.test(asset.digest))) {
    throw new Error('Release installer is unavailable');
  }
  // Accept only an installer from the configured repository and this exact release.
  const url = new URL(asset.browser_download_url);
  const [owner, project] = repo.split('/');
  const [empty, assetOwner, assetProject, releases, download, tag, name] = url.pathname.split('/');
  if (url.origin !== 'https://github.com' || url.username || url.password || url.search || url.hash ||
      empty !== '' || assetOwner?.toLowerCase() !== owner.toLowerCase() || assetProject?.toLowerCase() !== project.toLowerCase() ||
      releases !== 'releases' || download !== 'download' || tag !== release.tag_name || name !== asset.name ||
      url.pathname.split('/').length !== 7) throw new Error('Invalid release installer URL');
  return { version, name, size: asset.size, url: url.href, digest: asset.digest?.toLowerCase() || null, notes: release.body || '' };
}

function issue(errorCode, message) {
  return { ok: false, errorCode, error: message };
}

function invalidFile(message) {
  return Object.assign(new Error(message), { errorCode: 'integrity' });
}

async function downloadInstaller(candidate, part, fetchImpl, progress) {
  // The idle timer resets on every block so slow connections can finish a large installer.
  const ctl = new AbortController();
  let timer;
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(), 90000);
  };
  resetTimer();
  try {
    const res = await fetchImpl(candidate.url, { headers: { 'User-Agent': USER_AGENT }, redirect: 'follow', signal: ctl.signal });
    if (!res.ok || !res.body) throw new Error('Download failed (HTTP ' + res.status + ')');
    const headerSize = res.headers.get('content-length');
    if (headerSize !== null && !res.headers.get('content-encoding') && Number(headerSize) !== candidate.size) {
      await res.body.cancel().catch(() => {});
      throw invalidFile('Download length differs from the published asset');
    }
    let bytes = 0, last = 0;
    const hash = crypto.createHash('sha256');
    const monitor = new Transform({
      transform(chunk, _encoding, cb) {
        resetTimer();
        bytes += chunk.length;
        if (bytes > candidate.size) return cb(invalidFile('Download exceeds the published size'));
        hash.update(chunk);
        if (Date.now() - last > 250) {
          last = Date.now();
          progress(bytes / candidate.size);
        }
        cb(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(res.body), monitor, fs.createWriteStream(part, { flags: 'wx' }), { signal: ctl.signal });
    if (bytes !== candidate.size) throw invalidFile('Download incomplete');
    if (candidate.digest && 'sha256:' + hash.digest('hex') !== candidate.digest) {
      throw invalidFile('Download differs from the GitHub SHA-256 digest');
    }
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
}

async function verifyBeforeInstall(flush, remember, timeoutMs = 8000) {
  let timer, expired = false;
  try {
    const result = await Promise.race([
      (async () => {
        const saved = await flush();
        if (expired) return issue('saveTimeout', 'Saving timed out');
        if (saved?.ok !== true) return issue('unsaved', 'Save your changes before installing the update');
        await remember();
        return { ok: true };
      })(),
      new Promise(resolve => {
        timer = setTimeout(() => { expired = true; resolve(issue('saveTimeout', 'Saving timed out')); }, timeoutMs);
      }),
    ]);
    return result;
  } catch { return issue('unsaved', 'Could not save changes before installing the update'); }
  finally { clearTimeout(timer); }
}

function launchInstaller(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, ['--updated', '/S', '--force-run'], { detached: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('spawn', () => { child.unref(); resolve(); });
  });
}

function createUpdater({ current, getRepo, getFolder, getTemp, fetchImpl = fetch, beforeInstall,
    launch = launchInstaller, onReadyToQuit, onState = () => {} }) {
  let cache = null, checking = null, installing = false, handedOff = false;
  let state = { current, available: null, file: null, folder: null, checkError: null };

  async function checkRemote(repo, force) {
    if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return { best: null, error: null };
    if (cache?.repo !== repo) cache = { repo, best: null, at: 0, error: null };
    if (!force && cache.at && Date.now() - cache.at < CACHE_MS) return cache;
    let res;
    try {
      res = await fetchImpl('https://api.github.com/repos/' + repo + '/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        cache.best = releaseAsset(await res.json(), repo, current);
        cache.error = null;
      } else {
        cache.error = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after'))) ? 'rateLimit' : 'release';
        await res.body?.cancel().catch(() => {});
      }
    } catch { cache.error = res?.ok ? 'release' : 'offline'; }
    cache.at = Date.now();
    return cache;
  }

  async function check({ force = false } = {}) {
    if (checking) return checking;
    checking = (async () => {
      const repo = getRepo(), folder = getFolder();
      const local = findLocal(folder, current);
      const remote = await checkRemote(repo, force);
      const best = remote.best && (!local || compareVersions(remote.best.version, local.version) >= 0) ? remote.best : local;
      state = {
        current, available: best?.version || null, file: best?.file || null, url: best?.url || null,
        size: best?.size || 0, name: best?.name || null, digest: best?.digest || null, notes: best?.notes || '',
        source: best?.url ? 'github' : best ? 'folder' : null, folder, repo, checkError: remote.error,
      };
      if (!installing) onState(state);
      return state;
    })();
    try { return await checking; } finally { checking = null; }
  }

  async function install() {
    if (installing || handedOff) return issue('busy', 'An update is already being installed');
    const candidate = state;
    if (!candidate.available || (!candidate.url && !candidate.file)) return issue('noInstaller', 'Installer not found');
    installing = true;
    let staging;
    try {
      staging = await fs.promises.mkdtemp(path.join(getTemp(), 'Graphite-update-'));
      const file = path.join(staging, candidate.name);
      const part = path.join(staging, '.download');
      if (candidate.url) {
        await downloadInstaller(candidate, part, fetchImpl, fraction => onState({ ...candidate, progress: fraction }));
      } else {
        await fs.promises.copyFile(candidate.file, part, fs.constants.COPYFILE_EXCL);
      }
      await fs.promises.rename(part, file);
      let saved;
      try { saved = await beforeInstall(); }
      catch { return issue('unsaved', 'Saving changes failed'); }
      if (!saved?.ok) return saved || issue('unsaved', 'Saving changes failed');
      try { await launch(file); }
      catch (e) { return issue('launch', e.message); }
      handedOff = true;
      onReadyToQuit();
      return { ok: true };
    } catch (e) { return issue(e.errorCode || 'download', e.message); }
    finally {
      if (!handedOff) {
        if (staging) await fs.promises.rm(staging, { recursive: true, force: true }).catch(() => {});
        onState(state);
      }
      installing = false;
    }
  }
  return { check, install };
}

module.exports = { createUpdater, verifyBeforeInstall };
