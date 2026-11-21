import path from "node:path";
import process from "node:process";
import { isMainThread } from "node:worker_threads";

// What the machine running Vibe64 provides. The defaults describe a person's
// own computer: their tools on PATH, no shared group, no privileged helper.
// A host that provisions its own machines passes its values once at startup.
const HOST_PROFILE_KEY = Symbol.for("vibe64.hostProfile");
const HOST_UMASK_KEY = Symbol.for("vibe64.hostProfile.previousUmask");
const PATH_FIELDS = ["runtimePackRoot", "sharedCacheRoot", "execHelperPath"];
const LOCAL_HOST_PROFILE = Object.freeze({
  // Pinned tool packs; "" means the person's own installed tools.
  runtimePackRoot: "",
  // Cache shared by every account on the machine.
  sharedCacheRoot: "",
  // The tool homes the host gives each login's commands, when their homes
  // cannot start programs (a noexec mount): { env: { NAME: value }, path: [folder] },
  // "%u" in a value standing for the login. null means the login's own
  // ~/.local for npm and each tool's own default.
  loginEnvironment: null,
  // Privileged helper that runs commands as other OS users.
  execHelperPath: "",
  // Several OS users share project files through one group.
  sharedGroupAccess: false
});

/**
 * Group sharing needs a group-writable umask for every file this process
 * writes; resetting the profile puts the process umask back.
 */
function setHostUmask(shared) {
  if (!isMainThread) return;
  if (shared && !(HOST_UMASK_KEY in globalThis)) {
    globalThis[HOST_UMASK_KEY] = process.umask(0o007);
  } else if (!shared && HOST_UMASK_KEY in globalThis) {
    process.umask(globalThis[HOST_UMASK_KEY]);
    delete globalThis[HOST_UMASK_KEY];
  }
}

const LOGIN_TOOL_PATH = /^(?:\/(?:%u|[A-Za-z0-9._-])+)+$/u;

function loginToolPath(value, what) {
  if (typeof value !== "string" || !LOGIN_TOOL_PATH.test(value) || value.split("/").includes("..") ||
    value.replaceAll("%u", "").includes("%")) {
    throw new TypeError(`Host profile loginEnvironment ${what} must be an absolute path, "%u" standing for the login.`);
  }
  return value;
}

/** A copy of the host's login tool homes, checked and frozen, or null. */
function loginEnvironmentSetting(value) {
  if (value === null) return null;
  const { env, path: folders } = value || {};
  if (typeof value !== "object" || Object.keys(value).some((key) => key !== "env" && key !== "path") ||
    !env || typeof env !== "object" || Array.isArray(env) || !Array.isArray(folders)) {
    throw new TypeError("Host profile loginEnvironment must be null or { env, path }.");
  }
  const names = Object.keys(env);
  // The login's identity, its PATH and temporary folder, and its runtime folder, which belongs to its OS identity, each
  // have one owner already: the command's resolver and the exec helper.
  const bad = names.find((name) => !/^[A-Z][A-Z0-9_]*$/u.test(name) ||
    ["HOME", "LOGNAME", "PATH", "TMPDIR", "USER", "XDG_RUNTIME_DIR"].includes(name));
  if (bad !== undefined) throw new TypeError(`Host profile loginEnvironment cannot set ${bad}.`);
  return Object.freeze({
    env: Object.freeze(Object.fromEntries(names.map((name) => [name, loginToolPath(env[name], name)]))),
    path: Object.freeze(folders.map((folder) => loginToolPath(folder, "path")))
  });
}

function configureVibe64Host(profile = null) {
  if (profile === null) {
    delete globalThis[HOST_PROFILE_KEY];
    setHostUmask(false);
    return LOCAL_HOST_PROFILE;
  }
  const unknown = Object.keys(profile).filter((key) => !(key in LOCAL_HOST_PROFILE));
  if (unknown.length) {
    throw new TypeError(`Unknown host profile setting: ${unknown.join(", ")}.`);
  }
  const configured = { ...LOCAL_HOST_PROFILE, ...profile };
  for (const field of PATH_FIELDS) {
    if (typeof configured[field] !== "string" || (configured[field] && !path.isAbsolute(configured[field]))) {
      throw new TypeError(`Host profile ${field} must be an absolute path or empty.`);
    }
  }
  if (typeof configured.sharedGroupAccess !== "boolean") {
    throw new TypeError("Host profile sharedGroupAccess must be true or false.");
  }
  configured.loginEnvironment = loginEnvironmentSetting(configured.loginEnvironment);
  const frozen = Object.freeze(configured);
  globalThis[HOST_PROFILE_KEY] = frozen;
  setHostUmask(frozen.sharedGroupAccess);
  return frozen;
}

function vibe64Host() {
  return globalThis[HOST_PROFILE_KEY] || LOCAL_HOST_PROFILE;
}

function vibe64SharedModes() {
  return vibe64Host().sharedGroupAccess
    ? { inheritingDirectory: 0o2770, directory: 0o770, file: 0o660 }
    : { inheritingDirectory: 0o700, directory: 0o700, file: 0o600 };
}

function vibe64ProcessUmask() {
  return vibe64Host().sharedGroupAccess ? "0007" : "";
}

export {
  configureVibe64Host,
  vibe64Host,
  vibe64ProcessUmask,
  vibe64SharedModes
};
