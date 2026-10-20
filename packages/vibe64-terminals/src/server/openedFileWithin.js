import { realpath, stat } from "node:fs/promises";
import process from "node:process";

// Whether the file behind an open handle lies where `within(path)` allows.
// Linux names the open file through /proc. Elsewhere the opened file must be
// the same file that `filePath` resolves to now, and that resolved path is checked.
async function openedFileWithin(handle, filePath, within, {
  platform = process.platform
} = {}) {
  if (platform === "linux") {
    return within(await realpath(`/proc/self/fd/${handle.fd}`));
  }
  try {
    const resolvedPath = await realpath(filePath);
    const [opened, current] = await Promise.all([
      handle.stat({ bigint: true }),
      stat(resolvedPath, { bigint: true })
    ]);
    return opened.dev === current.dev && opened.ino === current.ino && within(resolvedPath);
  } catch {
    return false;
  }
}

export { openedFileWithin };
