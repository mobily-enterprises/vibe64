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
  // Privileged helper that runs commands as other OS users.
  execHelperPath: "",
  // Several OS users share project files through one group.
  sharedGroupAccess: false
});

// Group sharing needs a group-writable umask for every file this process
// writes; resetting the profile puts the process umask back.
function setHostUmask(shared) {
  if (!isMainThread) return;
  if (shared && !(HOST_UMASK_KEY in globalThis)) {
    globalThis[HOST_UMASK_KEY] = process.umask(0o007);
  } else if (!shared && HOST_UMASK_KEY in globalThis) {
    process.umask(globalThis[HOST_UMASK_KEY]);
    delete globalThis[HOST_UMASK_KEY];
  }
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
