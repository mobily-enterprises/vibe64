import path from "node:path";
import process from "node:process";
import os from "node:os";

const VIBE64_APP_ROOT_ENV = "VIBE64_APP_ROOT";
const VIBE64_TARGET_ROOT_ENV = "VIBE64_TARGET_ROOT";
const VIBE64_PROJECTS_ROOT_ENV = "VIBE64_PROJECTS_ROOT";
const VIBE64_PROVIDER_HOMES_ROOT_ENV = "VIBE64_PROVIDER_HOMES_ROOT";
const VIBE64_RECURSIVE_HACK_SYSTEM_ROOT_ENV = "VIBE64_RECURSIVE_HACK_SYSTEM_ROOT";
const VIBE64_SYSTEM_ROOT_ENV = "VIBE64_SYSTEM_ROOT";
const VIBE64_SYSTEM_DIR = ".vibe64-demon";
const VIBE64_PROJECT_SHARED_DIR = ".vibe64";
const VIBE64_PROJECT_LOCAL_DIR = ".vibe64-local";

function normalizeRoot(value, fallbackRoot) {
  const root = String(value || "").trim();
  return path.resolve(root || fallbackRoot || process.cwd());
}

function runtimeProfileIsLocal(runtimeProfile = {}) {
  return runtimeProfile?.local === true || String(runtimeProfile?.mode || "").trim() === "local";
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

function resolveVibe64SystemRoot({
  env = process.env,
  explicitRoot = "",
  home = os.homedir(),
  projectsRoot = "",
  runtimeProfile = null
} = {}) {
  const explicitSystemRoot = explicitRoot || env[VIBE64_SYSTEM_ROOT_ENV];
  if (String(explicitSystemRoot || "").trim()) {
    return normalizeRoot(explicitSystemRoot);
  }
  if (runtimeProfileIsLocal(runtimeProfile)) {
    return normalizeRoot(path.join(home || process.cwd(), ".local", "share", "vibe64-local-editor"));
  }
  return normalizeRoot(path.join(projectsRoot || path.join(home || process.cwd(), "vibe64"), VIBE64_SYSTEM_DIR));
}

function resolveVibe64ProviderHomesRoot({
  env = process.env,
  explicitRoot = "",
  home = os.homedir(),
  projectsRoot = "",
  runtimeProfile = null,
  systemRoot = ""
} = {}) {
  const explicitProviderHomesRoot = explicitRoot || env[VIBE64_PROVIDER_HOMES_ROOT_ENV];
  if (String(explicitProviderHomesRoot || "").trim()) {
    return normalizeRoot(explicitProviderHomesRoot);
  }
  return path.join(resolveVibe64SystemRoot({
    env,
    explicitRoot: systemRoot,
    home,
    projectsRoot,
    runtimeProfile
  }), "provider-homes");
}

function resolveVibe64ProjectSharedRoot(targetRoot = process.cwd()) {
  return path.join(normalizeRoot(targetRoot, process.cwd()), VIBE64_PROJECT_SHARED_DIR);
}

function resolveVibe64ProjectLocalRoot(targetRoot = process.cwd()) {
  return path.join(normalizeRoot(targetRoot, process.cwd()), VIBE64_PROJECT_LOCAL_DIR);
}

function resolveVibe64Roots({
  env = process.env,
  explicitSystemRoot = "",
  home = os.homedir(),
  projectsRoot = "",
  runtimeProfile = null,
  targetRoot = ""
} = {}) {
  const resolvedProjectsRoot = projectsRoot
    ? normalizeRoot(projectsRoot)
    : normalizeRoot(path.join(home || process.cwd(), "vibe64"));
  const resolvedTargetRoot = String(targetRoot || "").trim()
    ? normalizeRoot(targetRoot)
    : "";
  return Object.freeze({
    projectLocalRoot: resolvedTargetRoot ? resolveVibe64ProjectLocalRoot(resolvedTargetRoot) : "",
    projectSharedRoot: resolvedTargetRoot ? resolveVibe64ProjectSharedRoot(resolvedTargetRoot) : "",
    projectsRoot: resolvedProjectsRoot,
    systemRoot: resolveVibe64SystemRoot({
      env,
      explicitRoot: explicitSystemRoot,
      home,
      projectsRoot: resolvedProjectsRoot,
      runtimeProfile
    }),
    targetRoot: resolvedTargetRoot
  });
}

export {
  VIBE64_APP_ROOT_ENV,
  VIBE64_PROJECT_LOCAL_DIR,
  VIBE64_PROJECT_SHARED_DIR,
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_RECURSIVE_HACK_SYSTEM_ROOT_ENV,
  VIBE64_SYSTEM_DIR,
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV,
  resolveExplicitStudioTargetRoot,
  resolveVibe64ProviderHomesRoot,
  resolveVibe64ProjectLocalRoot,
  resolveVibe64ProjectSharedRoot,
  resolveVibe64Roots,
  resolveVibe64SystemRoot,
  resolveStudioAppRoot,
  resolveStudioTargetRoot
};
