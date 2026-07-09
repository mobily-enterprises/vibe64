import path from "node:path";

import {
  currentProcessIdentity
} from "../actor/userIdentity.js";
import {
  normalizeAbsolutePath
} from "../normalize.js";

function processMatchesActor(actor = {}) {
  const current = currentProcessIdentity();
  return current.uid === null ||
    current.gid === null ||
    (current.uid === actor.user?.uid && current.gid === actor.user?.gid);
}

function isManagedWorkspaceRuntime(env = process.env) {
  return Boolean(
    String(env?.VIBE64_WORKSPACE || "").trim() ||
    String(env?.VIBE64_WORKSPACE_DAEMON_USER || "").trim()
  );
}

function realUserActorRequiresInstalledHelper(actor = {}, {
  env = process.env
} = {}) {
  if (!actor.requiresRealUser) {
    return false;
  }
  // Managed workspace hosts set VIBE64_WORKSPACE* even when the process UID
  // already matches the target user, such as localhost dogfooding. Keep those
  // runtimes on the installed helper path so dev and managed-workspace
  // permission policy cannot drift apart.
  return isManagedWorkspaceRuntime(env) || !processMatchesActor(actor);
}

function assertActorHomeEnv(actor = {}, env = {}) {
  const actorHome = normalizeAbsolutePath(actor.user?.home);
  const envHome = normalizeAbsolutePath(env.HOME);
  const credentialHome = normalizeAbsolutePath(env.VIBE64_CREDENTIAL_HOME);
  if (!actor.requiresRealUser && credentialHome && envHome === credentialHome) {
    return;
  }
  if (actorHome && envHome && path.resolve(actorHome) !== path.resolve(envHome)) {
    const error = new Error("Command HOME does not match the resolved actor home.");
    error.code = "vibe64_command_home_actor_mismatch";
    throw error;
  }
}

export {
  assertActorHomeEnv,
  isManagedWorkspaceRuntime,
  realUserActorRequiresInstalledHelper,
  processMatchesActor
};
