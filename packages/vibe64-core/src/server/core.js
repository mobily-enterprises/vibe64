import { access } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { isPlainObject } from "./isPlainObject.js";
import { vibe64StatusCode } from "./serverResponses.js";

function normalizeTargetRoot(targetRoot = process.cwd()) {
  return path.resolve(toText(targetRoot) || process.cwd());
}

/**
 * A refusal the caller sees: an AppError with its own code, at the status
 * Vibe64's response envelope gives that code unless `status` names another.
 * `params` carries the values the sentence interpolates.
 * @param {string} message
 * @param {string} code
 * @param {{ status?: number, params?: Record<string, unknown>, messageCode?: string, messageParams?: Record<string, unknown>, details?: Record<string, unknown> }} [options]
 */
function vibe64Error(message, code, options = {}) {
  const { status = vibe64StatusCode({ ok: false, code }), ...appErrorOptions } = options;
  return new AppError(status, message, { ...appErrorOptions, code });
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
  pathExists,
  pathInside,
  pathInsideOrEqual,
  relativePathInside
};
