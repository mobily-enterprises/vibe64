import {
  homeEnvForUser
} from "../actor/userIdentity.js";
import {
  normalizeAbsolutePath,
  normalizeText,
  pathInsideOrEqual
} from "../normalize.js";

function pathIsHomeDirectory(value = "") {
  const normalized = normalizeAbsolutePath(value);
  return normalized === "/home" || normalized.startsWith("/home/");
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
  if (!actor.requiresRealUser && pathIsHomeDirectory(home) && actorHome && !pathInsideOrEqual(actorHome, home)) {
    const error = new Error("A /home credential directory requires a matching real-user actor.");
    error.code = "vibe64_command_credential_home_real_user_required";
    throw error;
  }
  const username = normalizeText(credentialHome.username || actor.user?.username);
  const env = homeEnvForUser({
    home,
    username
  }, {
    VIBE64_CREDENTIAL_HOME: home,
  });
  return {
    ...env,
    ...(normalizeAbsolutePath(credentialHome.cacheRoot)
      ? { XDG_CACHE_HOME: normalizeAbsolutePath(credentialHome.cacheRoot) }
      : {}),
    ...(normalizeAbsolutePath(credentialHome.configRoot)
      ? { XDG_CONFIG_HOME: normalizeAbsolutePath(credentialHome.configRoot) }
      : {}),
    ...(normalizeAbsolutePath(credentialHome.dataRoot)
      ? { XDG_DATA_HOME: normalizeAbsolutePath(credentialHome.dataRoot) }
      : {}),
    ...(normalizeAbsolutePath(credentialHome.stateRoot)
      ? { XDG_STATE_HOME: normalizeAbsolutePath(credentialHome.stateRoot) }
      : {})
  };
}

export {
  credentialEnv,
  pathIsHomeDirectory
};
