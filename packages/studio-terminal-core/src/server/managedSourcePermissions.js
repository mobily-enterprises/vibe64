import path from "node:path";

import {
  hostUserExecHelperPath
} from "./hostUserExecution.js";
import {
  runHostCommand
} from "./shellCommands.js";

const REPAIR_OPERATION = "repair-managed-project-permissions";
const DEFAULT_REPAIR_TIMEOUT_MS = 120_000;

function normalizeText(value = "") {
  return String(value || "").trim();
}

function absoluteUniquePaths(paths = []) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(paths) ? paths : []) {
    const normalized = normalizeText(value);
    if (!normalized || !path.isAbsolute(normalized)) {
      continue;
    }
    const resolved = path.resolve(normalized);
    if (seen.has(resolved)) {
      continue;
    }
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}

function hostedManagedSourcePermissionsRequired(env = process.env) {
  return Boolean(normalizeText(env?.VIBE64_WORKSPACE) || normalizeText(env?.VIBE64_WORKSPACE_DAEMON_USER));
}

function managedSourcePermissionPaths({
  metadata = {},
  sourcePath = "",
  successMetadata = {},
  workdir = ""
} = {}) {
  return absoluteUniquePaths([
    workdir,
    sourcePath,
    successMetadata?.source_path,
    successMetadata?.source_cache_path,
    metadata?.source_path,
    metadata?.source_cache_path
  ]);
}

async function repairManagedSourcePermissions(paths = [], {
  env = process.env,
  helperPath = "",
  runCommand = runHostCommand,
  timeout = DEFAULT_REPAIR_TIMEOUT_MS
} = {}) {
  const permissionPaths = absoluteUniquePaths(paths);
  if (!permissionPaths.length) {
    return {
      ok: true,
      repaired: [],
      skipped: true
    };
  }
  if (!hostedManagedSourcePermissionsRequired(env)) {
    return {
      ok: true,
      repaired: [],
      skipped: true
    };
  }
  const resolvedHelperPath = hostUserExecHelperPath({
    env,
    helperPath
  });
  const repaired = [];
  for (const sourcePath of permissionPaths) {
    const payload = {
      operation: REPAIR_OPERATION,
      path: sourcePath
    };
    const result = await runCommand("sudo", ["-n", resolvedHelperPath, "execute"], {
      env,
      input: `${JSON.stringify(payload)}\n`,
      timeout
    });
    if (result?.ok === false) {
      return {
        code: "vibe64_managed_source_permission_repair_failed",
        error: result.output || `Managed source permission repair failed: ${sourcePath}`,
        ok: false,
        path: sourcePath,
        repaired
      };
    }
    repaired.push(sourcePath);
  }
  return {
    ok: true,
    repaired,
    skipped: false
  };
}

export {
  REPAIR_OPERATION,
  absoluteUniquePaths,
  hostedManagedSourcePermissionsRequired,
  managedSourcePermissionPaths,
  repairManagedSourcePermissions
};
