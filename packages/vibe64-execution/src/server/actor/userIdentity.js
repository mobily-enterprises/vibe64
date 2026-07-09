import os from "node:os";
import path from "node:path";

import {
  currentOsUser,
  resolveOsUser
} from "../osUserIdentity.js";

import {
  normalizeAbsolutePath,
  normalizeInteger,
  normalizeText
} from "../normalize.js";

function normalizeActorUser(user = {}) {
  const username = normalizeText(user.username);
  const home = normalizeAbsolutePath(user.home || (username ? `/home/${username}` : os.homedir()));
  return {
    displayName: normalizeText(user.displayName || username),
    gid: normalizeInteger(user.gid),
    home,
    shell: normalizeText(user.shell),
    uid: normalizeInteger(user.uid),
    username
  };
}

function currentActorUser() {
  return normalizeActorUser(currentOsUser());
}

async function resolvedActorUser(username = "", options = {}) {
  return normalizeActorUser(await resolveOsUser(username, options));
}

function homeEnvForUser(user = {}, env = {}) {
  const normalized = normalizeActorUser(user);
  return {
    ...env,
    HOME: normalized.home,
    LOGNAME: normalized.username,
    USER: normalized.username,
    XDG_CACHE_HOME: path.join(normalized.home, ".cache"),
    XDG_CONFIG_HOME: path.join(normalized.home, ".config"),
    XDG_DATA_HOME: path.join(normalized.home, ".local", "share")
  };
}

function actorHomeEnv(user = {}, env = {}) {
  return homeEnvForUser(user, env);
}

function currentProcessIdentity() {
  return {
    gid: typeof process.getgid === "function" ? process.getgid() : null,
    uid: typeof process.getuid === "function" ? process.getuid() : null
  };
}

export {
  actorHomeEnv,
  currentActorUser,
  currentProcessIdentity,
  homeEnvForUser,
  normalizeActorUser,
  resolvedActorUser
};
