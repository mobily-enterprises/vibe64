import { lstat } from "node:fs/promises";
import path from "node:path";

import { isMissingPathError } from "@local/vibe64-core/server/core";

import { sourceEditorError } from "./sourceEditorPaths.js";

/**
 * Files' items: the errors an item operation reports, whether two stats are
 * the same item or the same unchanged file, folder and name joins, and the
 * first free name for an item.
 */
function existsError(name) {
  return sourceEditorError(`“${name}” already exists in this folder.`, "vibe64_files_exists", { name }, 409);
}

function protectedError(item) {
  return sourceEditorError(`“${item}” is protected in this area.`, "vibe64_files_protected_entry", { path: item }, 403);
}

function changedError() {
  return sourceEditorError("An item changed while it was being moved or copied. Try again.", "vibe64_files_item_changed", {}, 409);
}

function sameEntry(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

/**
 * The same file, unchanged: identity, size and modification time.
 */
function sameFile(left, right) {
  return sameEntry(left, right) && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

async function pathExists(absolutePath) {
  return lstat(absolutePath).then(() => true, (error) => {
    if (isMissingPathError(error)) return false;
    throw error;
  });
}

function folderOf(relativePath) {
  const parent = path.posix.dirname(relativePath);
  return parent === "." ? "" : parent;
}

function joinRelative(folder, name) {
  return folder ? `${folder}/${name}` : name;
}

/**
 * "report (1).pdf", "report (2).pdf", …: the first free name beside the original.
 */
async function availableName(destination, name) {
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let number = 1; number < 1000; number += 1) {
    const candidate = `${stem} (${number})${extension}`;
    if (!(await pathExists(destination.at(candidate)))) return candidate;
  }
  throw sourceEditorError("Too many items with this name already exist here.", "vibe64_files_names_exhausted", { name }, 409);
}

export {
  availableName,
  changedError,
  existsError,
  folderOf,
  joinRelative,
  pathExists,
  protectedError,
  sameEntry,
  sameFile
};
