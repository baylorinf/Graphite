'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const {randomUUID} = require('node:crypto');

async function publish(staged, target) {
  try { await fs.link(staged, target); }
  catch (error) {
    if (!['EPERM','ENOSYS','ENOTSUP','EOPNOTSUPP'].includes(error.code)) throw error;
    // Some removable drives do not implement hard links.
    await fs.copyFile(staged, target, fs.constants.COPYFILE_EXCL);
  }
}

// Stage all bytes before exposing a new note, source file or attachment under its final name.
async function createFile(target, bytes, {beforePublish, choosePath} = {}) {
  const staged = path.join(path.dirname(target), '.graphite-create-' + randomUUID() + '.tmp');
  const handle = await fs.open(staged, 'wx');
  try {
    try { await handle.writeFile(bytes); } finally { await handle.close(); }
    if (beforePublish) await beforePublish();
    for (;;) {
      const candidate = choosePath ? await choosePath(target) : target;
      try {
        await publish(staged, candidate);
        return candidate;
      } catch (error) {
        if (!choosePath || error.code !== 'EEXIST') throw error;
      }
    }
  } finally { await fs.unlink(staged).catch(() => {}); }
}
module.exports = {createFile};
