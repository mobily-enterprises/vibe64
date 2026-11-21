import { randomUUID } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import path from "node:path";

/**
 * Publishes text at filePath in one step: an exclusively created, uniquely
 * named temporary file beside it is renamed into place, so readers see the
 * old file or the new one and never a partial write. The temporary file never
 * outlives the call. fileMode is applied exactly (not narrowed by umask).
 *
 * The write is durable once the call returns: the temporary file's data
 * reaches the disk before the rename, and the folder's entry after it, so a
 * power cut leaves the old file or the new one, never an empty one. Resolves
 * to the published file's stats (bigints), taken before the rename, which
 * keeps the file's inode and modification time.
 *
 * durable: false publishes the file the same way without either sync, for a
 * record no one needs after a power cut, such as a session lock's owner, so
 * its writer never waits for the disk (on a busy one each sync can take a
 * tenth of a second or more).
 */
async function writeFileAtomic(filePath, text, options = {}) {
  const { directoryMode, durable = true, fileMode } = options;
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: directoryMode });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  let stats;
  try {
    const handle = await open(temporaryPath, "wx", fileMode);
    try {
      await handle.writeFile(text, "utf8");
      if (fileMode !== undefined) await handle.chmod(fileMode);
      if (durable) await handle.sync();
      stats = await handle.stat({ bigint: true });
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  if (durable) await syncDirectory(directory);
  return stats;
}

async function writeJsonFileAtomic(filePath, value, options = {}) {
  return writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

/**
 * Makes the folder's entries durable: a file renamed into it, made or removed
 * there stays so after a power cut.
 */
async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

/**
 * Runs operation after every earlier operation queued under the same key in
 * pending (a Map the caller owns), whether or not they failed.
 */
async function serializeByKey(pending, key, operation) {
  // The earlier operation's failure reached its own caller; this one only waits for it.
  const current = (pending.get(key) || Promise.resolve()).catch(() => {}).then(operation);
  pending.set(key, current);
  try {
    return await current;
  } finally {
    if (pending.get(key) === current) pending.delete(key);
  }
}

export {
  serializeByKey,
  syncDirectory,
  writeFileAtomic,
  writeJsonFileAtomic
};
