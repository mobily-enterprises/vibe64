import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { isPlainObject } from "./isPlainObject.js";
import { toText } from "../shared/toText.js";

function plainClone(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function normalizeTargetRoot(targetRoot = process.cwd()) {
  return path.resolve(toText(targetRoot) || process.cwd());
}

function vibe64Error(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isMissingPathError(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

/**
 * The path from root to candidate, both resolved, when candidate is root or
 * inside it; null otherwise or for an empty input. A child named `..cache`
 * is inside; `..`, `../x` and another drive are not.
 */
function relativePathInside(rootPath = "", candidatePath = "") {
  const root = toText(rootPath);
  const candidate = toText(candidatePath);
  if (!root || !candidate) return null;
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative) ? null : relative;
}

function pathInsideOrEqual(rootPath = "", candidatePath = "") {
  return relativePathInside(rootPath, candidatePath) !== null;
}

/**
 * Strictly inside: root itself is not.
 */
function pathInside(rootPath = "", candidatePath = "") {
  return Boolean(relativePathInside(rootPath, candidatePath));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch (error) {
    if (!isMissingPathError(error)) {
      throw error;
    }
    return false;
  }
}

export {
  vibe64Error,
  isPlainObject,
  isMissingPathError,
  normalizeTargetRoot,
  plainClone,
  pathExists,
  pathInside,
  pathInsideOrEqual,
  relativePathInside
};
