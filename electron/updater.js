'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { Transform, Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const gunzip = promisify(require('node:zlib').gunzip);
const { blake2b } = require('@noble/hashes/blake2.js');
const yaml = require('js-yaml');

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

const MANIFEST_LIMIT = 128 * 1024;
const BLOCKMAP_LIMIT = 16 * 1024 * 1024;
const isDigest = s => typeof s === 'string' && /^[A-Za-z0-9+/]{86}==$/.test(s) && Buffer.from(s,'base64').toString('base64') === s;
function decodeManifest(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > MANIFEST_LIMIT) throw invalidFile('Invalid update manifest length');
  try {
    const data = yaml.load(text, {schema:yaml.CORE_SCHEMA});
    if (data && typeof data === 'object' && !Array.isArray(data)) return data;
  } catch { /* incomplete update directory or release */ }
  throw invalidFile('Invalid update manifest');
}
function manifestFile(data, version, name, legacySize) {
  if (!version || typeof name !== 'string' || name.match(SETUP)?.[1] !== version || data.version !== version) throw invalidFile('Update manifest version mismatch');
  let entry;
  if (data.files !== undefined) {
    if (!Array.isArray(data.files) || data.files.length !== 1) throw invalidFile('Expected a single Windows installer');
    entry = data.files[0];
  } else {
    entry = {url:data.path, size:data.size ?? legacySize, sha512:data.sha512};
  }
  if (entry?.url !== name || !Number.isSafeInteger(entry.size) || entry.size <= 0 || !isDigest(entry.sha512) ||
      (data.path !== undefined && data.path !== name) || (data.sha512 !== undefined && data.sha512 !== entry.sha512) ||
      (data.size !== undefined && data.size !== entry.size)) throw invalidFile('Invalid Windows installer metadata');
  return {size:entry.size, sha512:entry.sha512};
}
function parseUpdateManifest(text, version, name) {
  return manifestFile(decodeManifest(text),version,name);
}
function retryTime(headers) {
  const after = headers.get('retry-after'), reset = headers.get('x-ratelimit-reset');
  const deadline = Math.max(0, Number(reset)*1000 || 0, !after ? 0 :
    /^\d+$/.test(after) ? Date.now()+Number(after)*1000 : Date.parse(after) || 0);
  const date = new Date(deadline);
  return deadline > Date.now() && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function officialRedirect(res) {
  return [301,302,303,307,308].includes(res.status) && res.headers.get('location');
}
async function releaseWhileLimited(repo, current, fetchImpl) {
  const page = 'https://github.com/'+repo+'/releases/latest';
  const opts = {redirect:'manual',headers:{'User-Agent':USER_AGENT},signal:AbortSignal.timeout(15000)};
  const redirect = await fetchImpl(page,{...opts,method:'HEAD'});
  await redirect.body?.cancel();
  const location = officialRedirect(redirect);
  if (!location) throw Error('No official release redirect');
  const tagUrl = new URL(location,page);
  const [,owner,project,area,kind,tag,...extra] = tagUrl.pathname.split('/');
  const version = tag?.match(/^v?(\d+\.\d+\.\d+)$/)?.[1];
  if (tagUrl.origin !== 'https://github.com' || tagUrl.username || tagUrl.password || tagUrl.search || tagUrl.hash ||
      (owner+'/'+project).toLowerCase() !== repo.toLowerCase() || area !== 'releases' || kind !== 'tag' || extra.length || !version) {
    throw Error('Unknown release redirect');
  }
  if (compareVersions(version,current) <= 0) return null;
  const base = 'https://github.com/'+repo+'/releases/download/'+tag+'/';
  let res = await fetchImpl(base+'latest.yml',opts);
  const assetLocation = officialRedirect(res);
  if (assetLocation) {
    await res.body?.cancel();
    const url = new URL(assetLocation,base);
    if (!['https://release-assets.githubusercontent.com','https://objects.githubusercontent.com'].includes(url.origin) ||
        url.username || url.password || url.hash) throw Error('Unknown release asset host');
    res = await fetchImpl(url.href,{...opts,redirect:'error'});
  }
  if (!res.ok || !res.body || Number(res.headers.get('content-length')) > MANIFEST_LIMIT) {
    await res.body?.cancel();
    throw Error('Official update manifest unavailable');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > MANIFEST_LIMIT) throw invalidFile('Invalid update manifest length');
    chunks.push(chunk);
  }
  const data = decodeManifest(Buffer.concat(chunks,size).toString('utf8'));
  const name = data.files?.[0]?.url || data.path;
  if (typeof name !== 'string' || name.match(SETUP)?.[1] !== version) throw invalidFile('Invalid release installer name');
  return {version,name,url:base+name,...manifestFile(data,version,name)};
}

async function readMetadata(file, limit) {
  const handle = await fs.promises.open(file,'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || !stat.size || stat.size > limit) throw invalidFile('Invalid update metadata length');
    const chunks = [];
    let length = 0;
    for await (const chunk of handle.createReadStream({autoClose:false})) {
      length += chunk.length;
      if (length > limit) throw invalidFile('Invalid update metadata length');
      chunks.push(chunk);
    }
    if (length !== stat.size) throw invalidFile('Update metadata changed while copying');
    return Buffer.concat(chunks,length);
  } finally { await handle.close(); }
}

async function localIntegrity(candidate) {
  let blocks;
  try {
    const compressed = await readMetadata(candidate.file+'.blockmap', BLOCKMAP_LIMIT);
    const map = JSON.parse(await gunzip(compressed, {maxOutputLength:BLOCKMAP_LIMIT * 4}));
    if (map.version !== '2' || map.files?.length !== 1) throw Error();
    blocks = map.files[0];
    if (blocks.name !== 'file' || blocks.offset !== 0 || !Array.isArray(blocks.sizes) || !blocks.sizes.length ||
        !Array.isArray(blocks.checksums) || blocks.checksums.length !== blocks.sizes.length ||
        blocks.sizes.some(size=>!Number.isSafeInteger(size) || size <= 0) ||
        blocks.checksums.some(s=>typeof s !== 'string' || !/^[A-Za-z0-9+/]{24}$/.test(s))) throw Error();
  } catch { throw invalidFile('The local blockmap is incomplete. Wait for the folder to finish copying, then retry.'); }
  const size = blocks.sizes.reduce((a,b)=>a+b,0);
  if (!Number.isSafeInteger(size)) throw invalidFile('Invalid local block sizes');
  let manifest = null;
  try {
    const bytes = await readMetadata(path.join(path.dirname(candidate.file),'latest.yml'),MANIFEST_LIMIT);
    const data = decodeManifest(bytes.toString('utf8'));
    if (typeof data.version !== 'string' || (!data.path && !data.files?.[0]?.url)) throw invalidFile('The local update manifest is incomplete');
    // A directory may contain several builds and the old MyObsidian alias. The shared
    // latest.yml belongs only to its named installer; all other files have their own blockmap.
    if (data.path === candidate.name || (Array.isArray(data.files) && data.files.some(f=>f?.url === candidate.name))) {
      manifest = manifestFile(data,candidate.available,candidate.name,size);
      if (manifest.size !== size) throw invalidFile('Local manifest and blockmap disagree on the installer size');
    }
  } catch (e) { if (e.code !== 'ENOENT') throw e; }
  return {blocks,size,manifest};
}
async function verifyLocal(file, {blocks,size,manifest}) {
  if ((await fs.promises.stat(file)).size !== size) throw invalidFile('The local installer is incomplete; try again after copying finishes.');
  const whole = manifest && crypto.createHash('sha512');
  let i = 0, used = 0, block = blake2b.create({dkLen:18});
  for await (const chunk of fs.createReadStream(file,{highWaterMark:512*1024})) {
    whole?.update(chunk);
    let at = 0;
    while (at < chunk.length) {
      if (i >= blocks.sizes.length) throw invalidFile('Local installer exceeds the expected length');
      const count = Math.min(blocks.sizes[i] - used, chunk.length - at);
      block.update(chunk.subarray(at,at+count));
      used += count; at += count;
      if (used === blocks.sizes[i]) {
        if (Buffer.from(block.digest()).toString('base64') !== blocks.checksums[i]) throw invalidFile('The local installer differs from its blockmap.');
        i++; used = 0;
        if (i < blocks.sizes.length) block = blake2b.create({dkLen:18});
      }
    }
  }
  if (i !== blocks.sizes.length || used || (whole && whole.digest('base64') !== manifest.sha512)) {
    throw invalidFile('The local installer differs from its published metadata.');
  }
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
    const hash = crypto.createHash(candidate.sha512 ? 'sha512' : 'sha256');
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
    if (candidate.sha512 && hash.digest('base64') !== candidate.sha512) throw invalidFile('Download differs from the published SHA-512 digest');
    if (!candidate.sha512 && candidate.digest && 'sha256:' + hash.digest('hex') !== candidate.digest) {
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
        if (saved?.ok !== true || saved.projectUnsaved || saved.reviewUnsaved) {
          return issue('unsaved', saved?.projectMessage || saved?.reviewMessage || 'The current changes could not be saved');
        }
        await remember();
        return { ok: true };
      })(),
      new Promise(resolve => {
        timer = setTimeout(() => { expired = true; resolve(issue('saveTimeout', 'Saving timed out')); }, timeoutMs);
      }),
    ]);
    return result;
  } catch { return issue('unsaved', 'Could not save the current changes'); }
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
    if (!force && cache.at && Date.now() - cache.at < CACHE_MS && (!cache.retryAt || Date.now()<Date.parse(cache.retryAt))) return cache;
    let res;
    try {
      cache.retryAt = null; cache.releasePage = null;
      res = await fetchImpl('https://api.github.com/repos/' + repo + '/releases/latest', {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(15000),
      });
      if (res.ok) {
        cache.best = releaseAsset(await res.json(), repo, current);
        cache.error = null;
      } else {
        const limited = res.status === 429 || (res.status === 403 && (res.headers.get('x-ratelimit-remaining') === '0' || res.headers.has('retry-after')));
        cache.error = limited ? 'rateLimit' : 'release';
        await res.body?.cancel().catch(() => {});
        if (limited) {
          cache.best = null;
          cache.releasePage = 'https://github.com/'+repo+'/releases/latest';
          cache.retryAt = retryTime(res.headers);
          try {
            cache.best = await releaseWhileLimited(repo,current,fetchImpl);
            cache.error = null;
          } catch { /* retain rateLimit and the official page for a retry */ }
        }
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
        size: best?.size || 0, name: best?.name || null, digest: best?.digest || null, sha512:best?.sha512 || null, notes: best?.notes || '',
        source: best?.url ? 'github' : best ? 'folder' : null, folder, repo, checkError: remote.error,
        retryAt:remote.retryAt || null, releasePage:remote.releasePage || null,
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
        const integrity = await localIntegrity(candidate);
        await fs.promises.copyFile(candidate.file, part, fs.constants.COPYFILE_EXCL);
        await verifyLocal(part,integrity);
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

module.exports = { createUpdater, verifyBeforeInstall, parseUpdateManifest };
