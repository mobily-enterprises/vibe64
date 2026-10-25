import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

// Publishes text at filePath in one step: an exclusively created, uniquely
// named temporary file beside it is renamed into place, so readers see the
// old file or the new one and never a partial write. The temporary file never
// outlives the call. fileMode is applied exactly (not narrowed by umask).
async function writeFileAtomic(filePath, text, { directoryMode, fileMode } = {}) {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true, mode: directoryMode });
  const temporaryPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, text, { encoding: "utf8", flag: "wx", mode: fileMode });
    if (fileMode !== undefined) await chmod(temporaryPath, fileMode);
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

async function writeJsonFileAtomic(filePath, value, options = {}) {
  await writeFileAtomic(filePath, `${JSON.stringify(value, null, 2)}\n`, options);
}

// Runs operation after every earlier operation queued under the same key in
// pending (a Map the caller owns), whether or not they failed.
async function serializeByKey(pending, key, operation) {
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
  writeFileAtomic,
  writeJsonFileAtomic
};
