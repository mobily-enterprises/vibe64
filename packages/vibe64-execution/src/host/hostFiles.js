// Files and folders the helper opens as root: never through a link, and only where their owner and mode are
// as expected.

import {
  closeSync,
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync
} from "node:fs";
import path from "node:path";

const DIRECTORY_NO_FOLLOW = fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW;
const NEW_FILE_NO_FOLLOW = fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_NOFOLLOW;
// Never through a link, and never waiting on a FIFO.
const FILE_NO_FOLLOW = fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK;

// Opens a directory without following a link, only when it is `uid`'s own and
// writable by no one else.
function openRootOwnedDirectory(directoryPath = "", uid = 0) {
  const descriptor = openSync(directoryPath, DIRECTORY_NO_FOLLOW);
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isDirectory() || stats.uid !== uid || (stats.mode & 0o022) !== 0) {
      throw new Error("A Vibe64 registry is not a directory only root can change.");
    }
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
  return descriptor;
}

// A path through a directory root already holds open: whatever later replaces
// that directory's path, the name is looked up in the directory root opened.
function openedPath(directory, name = "") {
  return path.join(`/proc/self/fd/${directory}`, name);
}

// Makes a directory unless its name is already taken; true when it made one.
function makeDirectory(directoryPath = "", mode = 0o777) {
  try {
    mkdirSync(directoryPath, { mode });
    return true;
  } catch (error) {
    if (error?.code !== "EEXIST") throw error;
    return false;
  }
}

function directoryEntryName(name = "") {
  const entry = String(name);
  if (!entry || entry === "." || entry === ".." || /[/\0]/u.test(entry)) {
    throw new Error("Vibe64 exec helper rejected an unsafe file name.");
  }
  return entry;
}

// Opens `directory`, whose path only root can rearrange, and then each of
// `parts` below it without following a link. The directory returned is the one
// reached through real directories, whatever replaces their paths afterwards.
function openDirectoryBelow(directory = "", parts = []) {
  let descriptor = openSync(directory, fsConstants.O_RDONLY | fsConstants.O_DIRECTORY);
  try {
    for (const part of parts) {
      const next = openSync(openedPath(descriptor, directoryEntryName(part)), DIRECTORY_NO_FOLLOW);
      closeSync(descriptor);
      descriptor = next;
    }
  } catch (error) {
    closeSync(descriptor);
    throw error;
  }
  return descriptor;
}

// Reads one regular file of `uid` from a directory root holds open: never
// through a link, never waiting on a FIFO, never more than maxBytes, and never
// repeating what it read in an error.
function readOwnedFile(directory, name = "", { maxBytes = 0, othersMayWrite = true, uid = -1 } = {}) {
  const descriptor = openSync(openedPath(directory, directoryEntryName(name)), FILE_NO_FOLLOW);
  try {
    const stats = fstatSync(descriptor);
    if (!stats.isFile() || stats.uid !== uid || (!othersMayWrite && (stats.mode & 0o022) !== 0)) {
      throw Object.assign(new Error("Vibe64 exec helper refused a file that is not its owner's regular file."), {
        code: "EVIBE64UNSAFEFILE"
      });
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(descriptor, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > maxBytes) {
      throw Object.assign(new Error("Vibe64 exec helper refused a file that is too large."), { code: "EVIBE64UNSAFEFILE" });
    }
    return buffer.toString("utf8", 0, length);
  } finally {
    closeSync(descriptor);
  }
}

function relativePathParts(parentPath = "", childPath = "") {
  const parent = String(parentPath || "").trim();
  const child = String(childPath || "").trim();
  if (!parent || !child) {
    return [];
  }
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    return [];
  }
  return relative.split(path.sep).filter(Boolean);
}

function canonicalPath(candidatePath, { allowMissingLeaf = false } = {}) {
  const resolved = path.resolve(candidatePath);
  if (allowMissingLeaf) {
    try {
      lstatSync(resolved);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      return path.join(realpathSync(path.dirname(resolved)), path.basename(resolved));
    }
  }
  return realpathSync(resolved);
}

export {
  canonicalPath,
  DIRECTORY_NO_FOLLOW,
  directoryEntryName,
  makeDirectory,
  NEW_FILE_NO_FOLLOW,
  openDirectoryBelow,
  openedPath,
  openRootOwnedDirectory,
  readOwnedFile,
  relativePathParts
};
