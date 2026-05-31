import path from "node:path";
import process from "node:process";

const VIBE64_APP_ROOT_ENV = "VIBE64_APP_ROOT";
const VIBE64_TARGET_ROOT_ENV = "VIBE64_TARGET_ROOT";
const VIBE64_PROJECTS_ROOT_ENV = "VIBE64_PROJECTS_ROOT";

function normalizeRoot(value, fallbackRoot) {
  const root = String(value || "").trim();
  return path.resolve(root || fallbackRoot || process.cwd());
}

function resolveStudioAppRoot({
  env = process.env,
  explicitRoot = "",
  fallbackRoot = process.cwd()
} = {}) {
  return normalizeRoot(explicitRoot || env[VIBE64_APP_ROOT_ENV], fallbackRoot);
}

function resolveStudioTargetRoot({
  env = process.env,
  explicitRoot = "",
  cwd = process.cwd(),
  studioAppRoot = "",
  allowCwdFallback = true
} = {}) {
  if (String(explicitRoot || "").trim() || String(env[VIBE64_TARGET_ROOT_ENV] || "").trim()) {
    return normalizeRoot(explicitRoot || env[VIBE64_TARGET_ROOT_ENV], cwd);
  }

  if (!allowCwdFallback) {
    return "";
  }

  const normalizedCwd = normalizeRoot(cwd, process.cwd());
  const normalizedStudioRoot = String(studioAppRoot || "").trim()
    ? normalizeRoot(studioAppRoot, normalizedCwd)
    : "";
  const initCwd = String(env.INIT_CWD || "").trim();

  if (initCwd && normalizedStudioRoot && normalizedCwd === normalizedStudioRoot) {
    const normalizedInitCwd = normalizeRoot(initCwd, normalizedCwd);
    if (normalizedInitCwd !== normalizedCwd) {
      return normalizedInitCwd;
    }
  }

  return normalizedCwd;
}

function resolveExplicitStudioTargetRoot({
  env = process.env,
  explicitRoot = "",
  cwd = process.cwd()
} = {}) {
  return resolveStudioTargetRoot({
    allowCwdFallback: false,
    cwd,
    env,
    explicitRoot
  });
}

export {
  VIBE64_APP_ROOT_ENV,
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV,
  resolveExplicitStudioTargetRoot,
  resolveStudioAppRoot,
  resolveStudioTargetRoot
};
