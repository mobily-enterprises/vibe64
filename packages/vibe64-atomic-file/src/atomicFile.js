// Vibe64's one way to write a file in place: the whole new content goes into a temporary file beside it, named
// .vibe64-write-<uuid>.tmp, which is renamed over the file (or linked into place, to create it only when it is
// missing), so a reader sees the old file or the new one and never a partial write, and the temporary file never
// outlives the write unless the process is killed during it. tests/server/handWrittenAtomicWrites.unit.test.js
// refuses a temporary file written and renamed into place anywhere else.
//
// It is plain Node with no dependency, so every package uses it: the privileged helper, Genesis and the deploy engine
// as much as the editor (whose own name for it is @local/vibe64-core/server/atomicFile). writeFileAtomic and
// writeFileAtomicSync use nothing but their arguments and the platform (process.getBuiltinModule gives them Node's
// modules), because the preview browser's worker, a program Vibe64 writes, embeds writeFileAtomic's text
// (packages/vibe64-execution/src/shared/embeddedFunctions.js), which has no other name of this module.
import { open } from "node:fs/promises";

/** Every temporary file the writer makes, in any folder, as a Git exclude pattern. */
const ATOMIC_WRITE_TEMPORARY_PATTERN = ".vibe64-write-*.tmp";

/**
 * Publishes content at filePath in one step: an exclusively created temporary file beside it, named
 * .vibe64-write-<uuid>.tmp, is renamed into place. Made in the file's own folder by the same writer, it takes that
 * folder's group and inherited permissions before it becomes the file (docs/managed-session-filesystem-contract.md).
 * fileMode is applied exactly (not narrowed by umask); without it the file gets the usual 0666 less the umask.
 *
 * content is text (written as UTF-8), a Buffer, or anything else a FileHandle's writeFile takes (a stream, an
 * iterable), or a function that fills the temporary file itself, given its path: it writes into the file there (a
 * copyFile, a stream opened on it, a command such as tar writing it), never replaces it.
 *
 * exclusive: true creates the file only when nothing is at filePath: the temporary file is linked into place instead
 * of renamed, and an existing file fails the write with EEXIST, unchanged.
 *
 * beforePublish(temporaryPath), when given, runs once the content is complete (and synced, for a durable write), just
 * before it is published: a throw fails the write and false publishes nothing and resolves null, leaving the file as
 * it was. It checks the content (a checksum, visudo) or whether the write is still wanted.
 *
 * createDirectory: false writes only into a folder that already exists (ENOENT otherwise), where the writer would
 * otherwise make it, with directoryMode.
 *
 * removeStale: true first removes the temporary files a killed write left in the folder: plain files with the exact
 * prefix and suffix not modified for a minute, longer than any live write holds its own. It costs a listing of the
 * folder, so it is for writers into a person's source, never for a folder of records that grows with history.
 *
 * The write is durable once the call returns: the temporary file's data reaches the disk before the rename, and the
 * folder's entry after it, so a power cut leaves the old file or the new one, never an empty one. durable: false
 * publishes the file the same way without either sync, for a record no one needs after a power cut, such as a session
 * lock's owner, so its writer never waits for the disk (on a busy one each sync can take a tenth of a second or more).
 *
 * Resolves to the published file's stats (bigints), taken before the rename, which keeps the file's inode and
 * modification time, or null when beforePublish declined.
 * @param {string} filePath
 * @param {string | Buffer | Iterable<any> | AsyncIterable<any> | ((temporaryPath: string) => Promise<void>)} content
 * @param {{ beforePublish?: (temporaryPath: string) => Promise<boolean | void> | boolean | void,
 *   createDirectory?: boolean, directoryMode?: number, durable?: boolean, exclusive?: boolean, fileMode?: number,
 *   removeStale?: boolean }} [options]
 */
async function writeFileAtomic(filePath, content, options = {}) {
  const {
    beforePublish = null, createDirectory = true, directoryMode, durable = true, exclusive = false, fileMode,
    removeStale = false
  } = options;
  const fs = process.getBuiltinModule("node:fs/promises");
  const path = process.getBuiltinModule("node:path");
  const [prefix, suffix] = [".vibe64-write-", ".tmp"];
  const directory = path.dirname(filePath);
  if (createDirectory) await fs.mkdir(directory, { recursive: true, mode: directoryMode });
  if (removeStale) {
    const staleBefore = Date.now() - 60_000;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    await Promise.all(entries.filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(suffix))
      .map(async (entry) => {
        const stale = path.join(directory, entry.name);
        const stats = await fs.lstat(stale).catch(() => null);
        if (stats?.isFile() && stats.mtimeMs < staleBefore) await fs.rm(stale, { force: true });
      }));
  }
  const temporaryPath = path.join(directory, `${prefix}${process.getBuiltinModule("node:crypto").randomUUID()}${suffix}`);
  let stats;
  try {
    const handle = await fs.open(temporaryPath, "wx", fileMode);
    try {
      if (typeof content === "function") await content(temporaryPath);
      else await handle.writeFile(content, "utf8");
      if (fileMode !== undefined) await handle.chmod(fileMode);
      if (durable) await handle.sync();
      stats = await handle.stat({ bigint: true });
    } finally {
      await handle.close();
    }
    if (beforePublish && await beforePublish(temporaryPath) === false) return null;
    await (exclusive ? fs.link : fs.rename)(temporaryPath, filePath);
  } finally {
    await fs.rm(temporaryPath, { force: true });
  }
  if (durable) {
    const folder = await fs.open(directory, "r");
    try {
      await folder.sync();
    } finally {
      await folder.close();
    }
  }
  return stats;
}

/**
 * writeFileAtomic for a writer that cannot wait: the privileged helper, a dying process's crash record, a check and
 * its write with nothing between them. The same temporary file, rename, link and syncs, with the same options except
 * removeStale; content is text or a Buffer, and beforePublish runs synchronously.
 * @param {string} filePath
 * @param {string | Buffer} content
 * @param {{ beforePublish?: (temporaryPath: string) => boolean | void, createDirectory?: boolean,
 *   directoryMode?: number, durable?: boolean, exclusive?: boolean, fileMode?: number }} [options]
 */
function writeFileAtomicSync(filePath, content, options = {}) {
  const { beforePublish = null, createDirectory = true, directoryMode, durable = true, exclusive = false, fileMode } = options;
  const fs = process.getBuiltinModule("node:fs");
  const path = process.getBuiltinModule("node:path");
  const directory = path.dirname(filePath);
  if (createDirectory) fs.mkdirSync(directory, { recursive: true, mode: directoryMode });
  const temporaryPath = path.join(directory, `.vibe64-write-${process.getBuiltinModule("node:crypto").randomUUID()}.tmp`);
  let stats;
  try {
    const descriptor = fs.openSync(temporaryPath, "wx", fileMode);
    try {
      fs.writeFileSync(descriptor, content);
      if (fileMode !== undefined) fs.fchmodSync(descriptor, fileMode);
      if (durable) fs.fsyncSync(descriptor);
      stats = fs.fstatSync(descriptor, { bigint: true });
    } finally {
      fs.closeSync(descriptor);
    }
    if (beforePublish && beforePublish(temporaryPath) === false) return null;
    (exclusive ? fs.linkSync : fs.renameSync)(temporaryPath, filePath);
  } finally {
    fs.rmSync(temporaryPath, { force: true });
  }
  if (durable) {
    const folder = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(folder);
    } finally {
      fs.closeSync(folder);
    }
  }
  return stats;
}

async function writeJsonFileAtomic(filePath, value, options = {}) {
  return writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

/**
 * Makes the folder's entries durable: a file renamed into it, made or removed there stays so after a power cut.
 */
async function syncDirectory(directory) {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export {
  ATOMIC_WRITE_TEMPORARY_PATTERN,
  syncDirectory,
  writeFileAtomic,
  writeFileAtomicSync,
  writeJsonFileAtomic
};
