import path from "node:path";

import {
  homeEnvForUser
} from "../actor/userIdentity.js";
import {
  normalizeAbsolutePath,
  normalizeText
} from "../normalize.js";

function pathIsHomeDirectory(value = "") {
  const normalized = normalizeAbsolutePath(value);
  return normalized === "/home" || normalized.startsWith("/home/");
}

function pathIsInsideOrEqual(child = "", parent = "") {
  const normalizedChild = normalizeAbsolutePath(child);
  const normalizedParent = normalizeAbsolutePath(parent);
  if (!normalizedChild || !normalizedParent) {
    return false;
  }
  const relative = path.relative(normalizedParent, normalizedChild);
  return !relative || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function credentialEnv({ actor = {}, request = {} } = {}) {
  const credentialHome = request.credentialHome || {};
  const home = normalizeAbsolutePath(credentialHome.home);
  if (!home) {
    return {};
  }
  const actorHome = normalizeAbsolutePath(actor.user?.home);
  if (actor.requiresRealUser && actorHome && home !== actorHome) {
    const error = new Error("Command credential home must match the resolved real-user actor home.");
    error.code = "vibe64_command_credential_home_actor_mismatch";
    throw error;
  }
  if (!actor.requiresRealUser && pathIsHomeDirectory(home) && actorHome && !pathIsInsideOrEqual(home, actorHome)) {
    const error = new Error("A /home credential directory requires a matching real-user actor.");
    error.code = "vibe64_command_credential_home_real_user_required";
    throw error;
  }
  const username = normalizeText(credentialHome.username || actor.user?.username);
  return homeEnvForUser({
    home,
    username
  }, {
    VIBE64_CREDENTIAL_HOME: home,
  });
}

export {
  credentialEnv,
  pathIsHomeDirectory,
  pathIsInsideOrEqual
};
