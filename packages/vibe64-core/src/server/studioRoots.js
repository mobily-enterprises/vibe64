import path from "node:path";
import process from "node:process";
import os from "node:os";
import { createHash } from "node:crypto";

const VIBE64_APP_ROOT_ENV = "VIBE64_APP_ROOT";
const VIBE64_TARGET_ROOT_ENV = "VIBE64_TARGET_ROOT";
const VIBE64_PROJECTS_ROOT_ENV = "VIBE64_PROJECTS_ROOT";
const VIBE64_PROVIDER_HOMES_ROOT_ENV = "VIBE64_PROVIDER_HOMES_ROOT";
const VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV = "VIBE64_SELF_TARGET_SYSTEM_ROOT";
const VIBE64_SYSTEM_ROOT_ENV = "VIBE64_SYSTEM_ROOT";
const VIBE64_SYSTEM_DIR = ".vibe64-demon";
const VIBE64_PROJECT_SHARED_DIR = ".vibe64";
const VIBE64_LOCAL_EDITOR_BASE_DIR = "vibe64-local-editor";
const VIBE64_LOCAL_EDITOR_STATE_DIR = "state";
const VIBE64_LOCAL_EDITOR_PROVIDER_HOMES_DIR = "provider-homes";
const VIBE64_RUNTIME_PROJECTS_DIR = "projects";

function normalizeRoot(value, fallbackRoot) {
  const root = String(value || "").trim();
  return path.resolve(root || fallbackRoot || process.cwd());
}

function runtimeProfileIsLocal(runtimeProfile = {}) {
  const mode = String(runtimeProfile?.mode || "").trim().toLowerCase();
  return runtimeProfile?.local === true || mode === "local" || mode === "local-editor";
}

function projectSlugFromTargetRoot(targetRoot = "") {
  return String(path.basename(normalizeRoot(targetRoot, process.cwd())) || "local-project")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "local-project";
}

function projectRuntimeKeyFromTargetRoot(targetRoot = "") {
  const normalizedTargetRoot = normalizeRoot(targetRoot, process.cwd());
  const hash = createHash("sha256")
    .update(normalizedTargetRoot)
    .digest("hex")
    .slice(0, 12);
  return `${projectSlugFromTargetRoot(normalizedTargetRoot)}-${hash}`;
}

function resolveDefaultLocalEditorBaseRoot(home = os.homedir()) {
  return normalizeRoot(path.join(home || process.cwd(), ".local", "share", VIBE64_LOCAL_EDITOR_BASE_DIR));
}

function resolveDefaultLocalEditorSystemRoot(home = os.homedir()) {
  return path.join(resolveDefaultLocalEditorBaseRoot(home), VIBE64_LOCAL_EDITOR_STATE_DIR);
}

function resolveDefaultLocalEditorProviderHomesRoot(home = os.homedir()) {
  return path.join(resolveDefaultLocalEditorBaseRoot(home), VIBE64_LOCAL_EDITOR_PROVIDER_HOMES_DIR);
}

function resolveDefaultLocalEditorProjectsRoot() {
  return "";
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
    return resolveDefaultLocalEditorSystemRoot(home);
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
  if (runtimeProfileIsLocal(runtimeProfile)) {
    return resolveDefaultLocalEditorProviderHomesRoot(home);
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

function resolveVibe64ProjectLocalRoot(targetRoot = process.cwd(), {
  systemRoot = "",
  home = os.homedir()
} = {}) {
  const resolvedSystemRoot = String(systemRoot || "").trim()
    ? normalizeRoot(systemRoot)
    : resolveDefaultLocalEditorSystemRoot(home);
  return path.join(resolvedSystemRoot, VIBE64_RUNTIME_PROJECTS_DIR, projectRuntimeKeyFromTargetRoot(targetRoot));
}

function resolveVibe64Roots({
  env = process.env,
  explicitSystemRoot = "",
  home = os.homedir(),
  projectsRoot = "",
  runtimeProfile = null,
  targetRoot = ""
} = {}) {
  const resolvedTargetRoot = String(targetRoot || "").trim()
    ? normalizeRoot(targetRoot)
    : "";
  const localProfile = runtimeProfileIsLocal(runtimeProfile);
  const resolvedProjectsRoot = projectsRoot
    ? normalizeRoot(projectsRoot)
    : localProfile
      ? ""
      : normalizeRoot(path.join(home || process.cwd(), "vibe64"));
  const systemRoot = resolveVibe64SystemRoot({
    env,
    explicitRoot: explicitSystemRoot,
    home,
    projectsRoot: resolvedProjectsRoot,
    runtimeProfile
  });
  return Object.freeze({
    projectLocalRoot: resolvedTargetRoot
      ? resolveVibe64ProjectLocalRoot(resolvedTargetRoot, {
          home,
          systemRoot
        })
      : "",
    projectSharedRoot: resolvedTargetRoot ? resolveVibe64ProjectSharedRoot(resolvedTargetRoot) : "",
    projectsRoot: resolvedProjectsRoot,
    systemRoot,
    targetRoot: resolvedTargetRoot
  });
}

export {
  VIBE64_APP_ROOT_ENV,
  VIBE64_PROJECT_SHARED_DIR,
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV,
  VIBE64_SYSTEM_DIR,
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV,
  resolveDefaultLocalEditorBaseRoot,
  resolveDefaultLocalEditorProviderHomesRoot,
  resolveDefaultLocalEditorProjectsRoot,
  resolveDefaultLocalEditorSystemRoot,
  resolveExplicitStudioTargetRoot,
  resolveVibe64ProviderHomesRoot,
  resolveVibe64ProjectLocalRoot,
  resolveVibe64ProjectSharedRoot,
  resolveVibe64Roots,
  resolveVibe64SystemRoot,
  resolveStudioAppRoot,
  resolveStudioTargetRoot
};
