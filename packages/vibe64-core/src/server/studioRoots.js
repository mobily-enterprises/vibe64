import path from "node:path";
import process from "node:process";
import os from "node:os";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const VIBE64_APP_ROOT_ENV = "VIBE64_APP_ROOT";
const VIBE64_TARGET_ROOT_ENV = "VIBE64_TARGET_ROOT";
const VIBE64_PROJECTS_ROOT_ENV = "VIBE64_PROJECTS_ROOT";
const VIBE64_SERVICE_DATA_ROOT_ENV = "VIBE64_SERVICE_DATA_ROOT";
const VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV = "VIBE64_SELF_TARGET_SYSTEM_ROOT";
const VIBE64_SYSTEM_ROOT_ENV = "VIBE64_SYSTEM_ROOT";
const VIBE64_SYSTEM_DIR = ".vibe64-demon";
const VIBE64_MANAGED_SOURCE_DIR = "Vibe64";
const VIBE64_DEFAULT_PROJECTS_DIR = "vibe64";

function normalizeRoot(value, fallbackRoot) {
  const root = String(value || "").trim();
  return path.resolve(root || fallbackRoot || process.cwd());
}

/**
 * A local editor or local runtime profile: the person runs Vibe64 on their own machine.
 */
function runtimeProfileIsLocal(runtimeProfile) {
  const mode = String(runtimeProfile?.mode || "").trim().toLowerCase();
  return runtimeProfile?.local === true || mode === "local" || mode === "local-editor";
}

/**
 * The person's own state folder: XDG on Linux, Application Support on macOS.
 */
function resolveDefaultLocalEditorSystemRoot(home = os.homedir(), platform = process.platform) {
  const homeRoot = home || process.cwd();
  if (platform === "darwin") {
    return normalizeRoot(path.join(homeRoot, "Library", "Application Support", "Vibe64"));
  }
  const stateHome = String(process.env.XDG_STATE_HOME || "").trim();
  return normalizeRoot(path.join(stateHome || path.join(homeRoot, ".local", "state"), "vibe64"));
}

/**
 * The project catalogue lives in a folder in the service account's home.
 */
function resolveDefaultProjectsRoot(home = os.homedir()) {
  return normalizeRoot(path.join(home || process.cwd(), VIBE64_DEFAULT_PROJECTS_DIR));
}

/**
 * Project sources Vibe64 creates live in a visible folder in the person's home.
 */
function resolveDefaultManagedSourceRoot({ home = os.homedir() } = {}) {
  return normalizeRoot(path.join(home || process.cwd(), VIBE64_MANAGED_SOURCE_DIR));
}

function resolveVibe64ManagedSourceRoot({
  explicitRoot = "",
  home = os.homedir()
} = {}) {
  return normalizeRoot(explicitRoot, resolveDefaultManagedSourceRoot({ home }));
}

/**
 * The folder Vibe64's own application files live in.
 * @param {object} options
 * @param {RuntimeEnv} options.env
 * @param {string} [options.explicitRoot]
 * @param {string} [options.fallbackRoot]
 */
function resolveStudioAppRoot({
  env,
  explicitRoot = "",
  fallbackRoot = process.cwd()
}) {
  return normalizeRoot(explicitRoot || env[VIBE64_APP_ROOT_ENV], fallbackRoot);
}

/**
 * The project folder this process works on.
 * @param {object} options
 * @param {RuntimeEnv} options.env
 * @param {string} [options.explicitRoot]
 * @param {string} [options.cwd]
 * @param {string} [options.studioAppRoot]
 * @param {boolean} [options.allowCwdFallback]
 */
function resolveStudioTargetRoot({
  env,
  explicitRoot = "",
  cwd = process.cwd(),
  studioAppRoot = "",
  allowCwdFallback = true
}) {
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

/**
 * The project folder named explicitly or by the environment; empty when neither names one.
 * @param {object} options
 * @param {RuntimeEnv} options.env
 * @param {string} [options.explicitRoot]
 * @param {string} [options.cwd]
 */
function resolveExplicitStudioTargetRoot({
  env,
  explicitRoot = "",
  cwd = process.cwd()
}) {
  return resolveStudioTargetRoot({
    allowCwdFallback: false,
    cwd,
    env,
    explicitRoot
  });
}

/**
 * The folder Vibe64 keeps its own state in.
 * @param {object} options
 * @param {RuntimeEnv} options.env
 * @param {string} [options.explicitRoot]
 * @param {string} [options.home]
 * @param {string} [options.projectsRoot]
 * @param {object | null} [options.runtimeProfile]
 */
function resolveVibe64SystemRoot({
  env,
  explicitRoot = "",
  home = os.homedir(),
  projectsRoot = "",
  runtimeProfile = null
}) {
  const explicitSystemRoot = explicitRoot || env[VIBE64_SYSTEM_ROOT_ENV];
  if (String(explicitSystemRoot || "").trim()) {
    return normalizeRoot(explicitSystemRoot);
  }
  if (runtimeProfileIsLocal(runtimeProfile)) {
    return resolveDefaultLocalEditorSystemRoot(home);
  }
  return normalizeRoot(path.join(projectsRoot || resolveDefaultProjectsRoot(home), VIBE64_SYSTEM_DIR));
}

/**
 * The folder managed services keep their data in.
 * @param {object} options
 * @param {RuntimeEnv} options.env
 * @param {string} [options.explicitRoot]
 * @param {string} [options.home]
 * @param {object | null} [options.runtimeProfile]
 * @param {string} [options.systemRoot]
 */
function resolveVibe64ServiceDataRoot({
  env,
  explicitRoot = "",
  home = os.homedir(),
  runtimeProfile = null,
  systemRoot = ""
}) {
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

/**
 * The managed source, projects, service data and system roots, resolved together.
 * @param {object} options
 * @param {RuntimeEnv} options.env
 * @param {string} [options.explicitManagedSourceRoot]
 * @param {string} [options.explicitSystemRoot]
 * @param {string} [options.home]
 * @param {string} [options.projectsRoot]
 * @param {object | null} [options.runtimeProfile]
 */
function resolveVibe64Roots({
  env,
  explicitManagedSourceRoot = "",
  explicitSystemRoot = "",
  home = os.homedir(),
  projectsRoot = "",
  runtimeProfile = null
}) {
  const localProfile = runtimeProfileIsLocal(runtimeProfile);
  const resolvedProjectsRoot = projectsRoot
    ? normalizeRoot(projectsRoot)
    : localProfile
      ? ""
      : resolveDefaultProjectsRoot(home);
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
    home
  });
  return Object.freeze({
    managedSourceRoot,
    projectsRoot: resolvedProjectsRoot,
    serviceDataRoot,
    systemRoot
  });
}

export {
  VIBE64_APP_ROOT_ENV,
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_SERVICE_DATA_ROOT_ENV,
  VIBE64_SELF_TARGET_SYSTEM_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV,
  resolveDefaultLocalEditorSystemRoot,
  resolveDefaultProjectsRoot,
  resolveExplicitStudioTargetRoot,
  resolveVibe64ManagedSourceRoot,
  resolveVibe64Roots,
  resolveVibe64ServiceDataRoot,
  resolveVibe64SystemRoot,
  resolveStudioAppRoot,
  resolveStudioTargetRoot,
  runtimeProfileIsLocal
};
