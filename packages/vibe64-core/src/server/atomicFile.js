import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

const TEMPORARY_PREFIX = ".vibe64-write-";
const TEMPORARY_SUFFIX = ".tmp";
const STALE_TEMPORARY_MS = 60_000;

/** Every temporary file writeFileAtomic makes, in any folder, as a Git exclude pattern. */
const ATOMIC_WRITE_TEMPORARY_PATTERN = `${TEMPORARY_PREFIX}*${TEMPORARY_SUFFIX}`;

/**
 * Publishes text at filePath in one step: an exclusively created temporary
 * file beside it, named .vibe64-write-<uuid>.tmp, is renamed into place, so
 * readers see the old file or the new one and never a partial write. The
 * temporary file never outlives the call, unless the process is killed
 * during it. Made in the file's own folder by the same writer, it takes that
 * folder's group and inherited permissions before it becomes the file
 * (docs/managed-session-filesystem-contract.md). fileMode is applied exactly
 * (not narrowed by umask).
 *
 * exclusive: true creates the file only when nothing is at filePath: the
 * temporary file is linked into place instead of renamed, and an existing
 * file fails the write with EEXIST, unchanged.
 *
 * removeStale: true first removes the temporary files a killed write left in
 * the folder: plain files with the exact prefix and suffix not modified for a
 * minute, longer than any live write holds its own. It costs a listing of the
 * folder, so it is for writers into a person's source, never for a folder of
 * records that grows with history.
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
  const { directoryMode, durable = true, exclusive = false, fileMode, removeStale = false } = options;
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: directoryMode });
  if (removeStale) await removeStaleTemporaryFiles(directory);
  const temporaryPath = path.join(directory, `${TEMPORARY_PREFIX}${randomUUID()}${TEMPORARY_SUFFIX}`);
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
    await (exclusive ? link : rename)(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
  if (durable) await syncDirectory(directory);
  return stats;
}

async function removeStaleTemporaryFiles(directory) {
  const staleBefore = Date.now() - STALE_TEMPORARY_MS;
  const entries = await readdir(directory, { withFileTypes: true });
  await Promise.all(entries
    .filter((entry) => entry.isFile() && entry.name.startsWith(TEMPORARY_PREFIX) && entry.name.endsWith(TEMPORARY_SUFFIX))
    .map(async (entry) => {
      const file = path.join(directory, entry.name);
      const stats = await lstat(file).catch(() => null);
      if (stats?.isFile() && stats.mtimeMs < staleBefore) await rm(file, { force: true });
    }));
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
  ATOMIC_WRITE_TEMPORARY_PATTERN,
  serializeByKey,
  syncDirectory,
  writeFileAtomic,
  writeJsonFileAtomic
};
