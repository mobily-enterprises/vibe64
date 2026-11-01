import { lstat } from "node:fs/promises";
import path from "node:path";

import { pathInsideOrEqual, vibe64Error } from "@local/vibe64-core/server/core";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/**
 * A session source path the editor may use: relative, inside the source and
 * never through a symbolic link, with the editor's coded errors.
 */
function sourceEditorError(message, code, details = {}, statusCode = 400) {
  const error = vibe64Error(message, code);
  error.details = details;
  error.statusCode = statusCode;
  return error;
}

function normalizeSourceEditorRelativePath(value = "") {
  const raw = toText(value).replaceAll("\\", "/");
  if (!raw || raw === "." || raw === "/") {
    return "";
  }
  if (raw.startsWith("/") || /^[A-Za-z]:\//u.test(raw)) {
    throw sourceEditorError("Source editor paths must be relative to the session source.", "vibe64_invalid_source_editor_path");
  }
  const normalized = path.posix.normalize(raw).replace(/^\.\/+/u, "");
  if (!normalized || normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw sourceEditorError("Source editor path escapes the session source.", "vibe64_invalid_source_editor_path");
  }
  return normalized;
}

function absoluteSourceEditorPath(sourceRoot = "", relativePath = "") {
  const absolutePath = path.resolve(sourceRoot, relativePath);
  if (!pathInsideOrEqual(sourceRoot, absolutePath)) {
    throw sourceEditorError("Source editor path escapes the session source.", "vibe64_invalid_source_editor_path");
  }
  return absolutePath;
}

async function sourceEditorPathStats(sourceRoot = "", relativePath = "") {
  const absolutePath = absoluteSourceEditorPath(sourceRoot, relativePath);
  let currentPath = path.resolve(sourceRoot);
  let stats;
  for (const segment of ["", ...path.relative(currentPath, absolutePath).split(path.sep).filter(Boolean)]) {
    currentPath = path.join(currentPath, segment);
    stats = await lstat(currentPath);
    if (stats.isSymbolicLink()) {
      throw sourceEditorError("Source editor does not access paths containing symbolic links.", "vibe64_source_editor_symlink", {
        path: relativePath
      }, 403);
    }
  }
  return stats;
}

export {
  absoluteSourceEditorPath,
  normalizeSourceEditorRelativePath,
  sourceEditorError,
  sourceEditorPathStats
};
