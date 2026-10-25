import path from "node:path";

import {
  currentProcessIdentity
} from "../actor/userIdentity.js";
import {
  vibe64Host
} from "../hostProfile.js";
import {
  normalizeAbsolutePath,
  pathInsideOrEqual
} from "../normalize.js";

function processMatchesActor(actor = {}) {
  const current = currentProcessIdentity();
  return current.uid === null ||
    current.gid === null ||
    (current.uid === actor.user?.uid && current.gid === actor.user?.gid);
}

// A host that provisions its own machines declares a privileged helper in its
// host profile. Such a host is managed: it never borrows the launching shell's
// PATH, and every real-user command goes through the helper.
function hostIsManaged() {
  return Boolean(vibe64Host().execHelperPath);
}

function realUserActorRequiresInstalledHelper(actor = {}) {
  if (!actor.requiresRealUser) {
    return false;
  }
  // The helper is used even when this process already is the target user, so
  // the permission policy is the same on every managed host.
  return hostIsManaged() || !processMatchesActor(actor);
}

function assertManagedSourceFilesystemActor(actor = {}, request = {}, cwd = "") {
  if (!actor.requiresRealUser) {
    return;
  }
  const sourceRoot = normalizeAbsolutePath(
    request.session?.sourceRoot || request.session?.sourcePath
  );
  const commandCwd = normalizeAbsolutePath(cwd);
  if (!sourceRoot || !commandCwd) {
    return;
  }
  if (!pathInsideOrEqual(sourceRoot, commandCwd)) {
    return;
  }
  const error = new Error(
    "Commands in a session's source must run as the editor's own user, not as a person's account."
  );
  error.code = "vibe64_command_managed_source_real_user_forbidden";
  throw error;
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
  assertManagedSourceFilesystemActor,
  hostIsManaged,
  realUserActorRequiresInstalledHelper,
  processMatchesActor
};
