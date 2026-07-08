import path from "node:path";
import process from "node:process";
import os from "node:os";
import { createHash } from "node:crypto";

const VIBE64_APP_ROOT_ENV = "VIBE64_APP_ROOT";
const VIBE64_TARGET_ROOT_ENV = "VIBE64_TARGET_ROOT";
const VIBE64_PROJECTS_ROOT_ENV = "VIBE64_PROJECTS_ROOT";
const VIBE64_SERVICE_DATA_ROOT_ENV = "VIBE64_SERVICE_DATA_ROOT";
const VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV = "VIBE64_SELF_TARGET_SYSTEM_ROOT";
const VIBE64_SYSTEM_ROOT_ENV = "VIBE64_SYSTEM_ROOT";
const VIBE64_SYSTEM_DIR = ".vibe64-demon";
const VIBE64_RUNTIME_PROJECTS_DIR = "projects";
const VIBE64_MANAGED_SOURCE_BASE_ROOT = "/var/lib/vibe64";

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

function resolveDefaultLocalEditorSystemRoot(home = os.homedir()) {
  const stateHome = String(process.env.XDG_STATE_HOME || "").trim();
  return normalizeRoot(path.join(stateHome || path.join(home || process.cwd(), ".local", "state"), "vibe64"));
}

function resolveDefaultLocalEditorProjectsRoot() {
  return "";
}

function managedSourceOwnerName({
  home = os.homedir(),
  username = ""
} = {}) {
  const explicitUsername = String(username || "").trim();
  if (explicitUsername) {
    return path.basename(explicitUsername);
  }
  try {
    const osUsername = String(os.userInfo().username || "").trim();
    if (osUsername) {
      return path.basename(osUsername);
    }
  } catch {
    // Fall through to the home-directory basename.
  }
  return path.basename(normalizeRoot(home || process.cwd())) || "vibe64";
}

function resolveDefaultManagedSourceRoot({
  home = os.homedir(),
  username = ""
} = {}) {
  return path.join(VIBE64_MANAGED_SOURCE_BASE_ROOT, managedSourceOwnerName({
    home,
    username
  }), VIBE64_RUNTIME_PROJECTS_DIR);
}

function resolveVibe64ManagedSourceRoot({
  explicitRoot = "",
  home = os.homedir(),
  username = ""
} = {}) {
  return normalizeRoot(explicitRoot, resolveDefaultManagedSourceRoot({
    home,
    username
  }));
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

function resolveVibe64ServiceDataRoot({
  env = process.env,
  explicitRoot = "",
  home = os.homedir(),
  runtimeProfile = null,
  systemRoot = ""
} = {}) {
  const explicitServiceRoot = explicitRoot || env[VIBE64_SERVICE_DATA_ROOT_ENV];
  if (String(explicitServiceRoot || "").trim()) {
    return normalizeRoot(explicitServiceRoot);
  }
  const resolvedSystemRoot = String(systemRoot || "").trim()
    ? normalizeRoot(systemRoot)
    : resolveVibe64SystemRoot({
        env,
        home,
        runtimeProfile
      });
  return path.join(resolvedSystemRoot, "services");
}

function resolveVibe64SourceContractRoot(targetRoot = process.cwd()) {
  return normalizeRoot(targetRoot, process.cwd());
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
  explicitManagedSourceRoot = "",
  explicitSystemRoot = "",
  home = os.homedir(),
  projectsRoot = "",
  runtimeProfile = null,
  targetRoot = "",
  username = ""
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
  const serviceDataRoot = resolveVibe64ServiceDataRoot({
    env,
    home,
    runtimeProfile,
    systemRoot
  });
  const managedSourceRoot = resolveVibe64ManagedSourceRoot({
    explicitRoot: explicitManagedSourceRoot,
    home,
    username
  });
  return Object.freeze({
    managedSourceRoot,
    projectLocalRoot: resolvedTargetRoot
      ? resolveVibe64ProjectLocalRoot(resolvedTargetRoot, {
          home,
          systemRoot
        })
      : "",
    sourceContractRoot: resolvedTargetRoot ? resolveVibe64SourceContractRoot(resolvedTargetRoot) : "",
    projectsRoot: resolvedProjectsRoot,
    serviceDataRoot,
    systemRoot,
    targetRoot: resolvedTargetRoot
  });
}

export {
  VIBE64_APP_ROOT_ENV,
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_MANAGED_SOURCE_BASE_ROOT,
  VIBE64_SERVICE_DATA_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV,
  VIBE64_SYSTEM_DIR,
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV,
  resolveDefaultLocalEditorProjectsRoot,
  resolveDefaultLocalEditorSystemRoot,
  resolveDefaultManagedSourceRoot,
  resolveExplicitStudioTargetRoot,
  resolveVibe64ManagedSourceRoot,
  resolveVibe64ProjectLocalRoot,
  resolveVibe64SourceContractRoot,
  resolveVibe64Roots,
  resolveVibe64ServiceDataRoot,
  resolveVibe64SystemRoot,
  resolveStudioAppRoot,
  resolveStudioTargetRoot
};
