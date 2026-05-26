import path from "node:path";
import process from "node:process";

const AI_STUDIO_APP_ROOT_ENV = "AI_STUDIO_APP_ROOT";
const AI_STUDIO_TARGET_ROOT_ENV = "AI_STUDIO_TARGET_ROOT";

function normalizeRoot(value, fallbackRoot) {
  const root = String(value || "").trim();
  return path.resolve(root || fallbackRoot || process.cwd());
}

function resolveStudioAppRoot({
  env = process.env,
  explicitRoot = "",
  fallbackRoot = process.cwd()
} = {}) {
  return normalizeRoot(explicitRoot || env[AI_STUDIO_APP_ROOT_ENV], fallbackRoot);
}

function resolveStudioTargetRoot({
  env = process.env,
  explicitRoot = "",
  cwd = process.cwd(),
  studioAppRoot = ""
} = {}) {
  if (String(explicitRoot || "").trim() || String(env[AI_STUDIO_TARGET_ROOT_ENV] || "").trim()) {
    return normalizeRoot(explicitRoot || env[AI_STUDIO_TARGET_ROOT_ENV], cwd);
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

export {
  AI_STUDIO_APP_ROOT_ENV,
  AI_STUDIO_TARGET_ROOT_ENV,
  resolveStudioAppRoot,
  resolveStudioTargetRoot
};
