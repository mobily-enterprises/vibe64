import { realpathSync } from "node:fs";
import path from "node:path";

import {
  normalizeAbsolutePath
} from "../normalize.js";

function resolveCommandCwd(cwd = "") {
  return normalizeAbsolutePath(cwd || process.cwd());
}

function pathIsInsideOrEqual(root = "", candidate = "") {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertCwdAllowed(cwd = "", {
  allowedRoots = []
} = {}) {
  const resolvedCwd = resolveCommandCwd(cwd);
  const roots = (Array.isArray(allowedRoots) ? allowedRoots : [allowedRoots])
    .map(normalizeAbsolutePath)
    .filter(Boolean);
  if (roots.length === 0) {
    return resolvedCwd;
  }
  const matchingRoots = roots.filter((root) => pathIsInsideOrEqual(root, resolvedCwd));
  if (matchingRoots.length > 0) {
    const canonicalCwd = realpathSync(resolvedCwd);
    if (matchingRoots.some((root) => pathIsInsideOrEqual(realpathSync(root), canonicalCwd))) {
      return canonicalCwd;
    }
  }
  const error = new Error("Vibe64 command cwd is outside the allowed roots.");
  error.code = "vibe64_command_cwd_outside_allowed_roots";
  throw error;
}

export {
  assertCwdAllowed,
  pathIsInsideOrEqual,
  resolveCommandCwd
};
