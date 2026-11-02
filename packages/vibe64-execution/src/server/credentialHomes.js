import os from "node:os";
import path from "node:path";

import {
  currentOsUser,
  resolveOsUser
} from "./osUserIdentity.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

const APP_CREDENTIAL_SCOPE = "app";
const USER_CREDENTIAL_SCOPE = "user";
const GITHUB_ACCOUNT_MODE_LOCAL = "local";
const GITHUB_ACCOUNT_MODE_USER = "user";
const VIBE64_GITHUB_ACCOUNT_MODE_ENV = "VIBE64_GITHUB_ACCOUNT_MODE";

function normalizeGithubAccountMode(value = "", fallback = GITHUB_ACCOUNT_MODE_USER) {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === GITHUB_ACCOUNT_MODE_LOCAL || normalized === APP_CREDENTIAL_SCOPE) {
    return GITHUB_ACCOUNT_MODE_LOCAL;
  }
  if (normalized === GITHUB_ACCOUNT_MODE_USER || normalized === USER_CREDENTIAL_SCOPE) {
    return GITHUB_ACCOUNT_MODE_USER;
  }
  return fallback === GITHUB_ACCOUNT_MODE_LOCAL ? GITHUB_ACCOUNT_MODE_LOCAL : GITHUB_ACCOUNT_MODE_USER;
}

function normalizeHome(value = "") {
  const normalized = normalizeText(value);
  return normalized && path.isAbsolute(normalized) ? path.resolve(normalized) : "";
}

function normalizeId(value = null) {
  const normalized = Number(value);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

function credentialHomeRequiredError(label = "credential") {
  return {
    code: "vibe64_credential_home_required",
    error: `A real OS home directory is required for ${label} operations.`,
    errors: [
      {
        code: "vibe64_credential_home_required",
        message: `A real OS home directory is required for ${label} operations.`
      }
    ],
    ok: false
  };
}

function actingUsernameFromUser(user) {
  return normalizeText(user?.username || user?.osUsername || user?.name);
}

function actingHomeFromUser(user) {
  return normalizeHome(user?.home || user?.osHome);
}

function actingUidFromUser(user) {
  return normalizeId(user?.uid ?? user?.osUid);
}

function actingGidFromUser(user) {
  return normalizeId(user?.gid ?? user?.osGid);
}

function currentUserCredentialContext() {
  const user = currentOsUser();
  if (!user.username || !user.home) {
    return credentialHomeRequiredError("local user");
  }
  return {
    gid: normalizeId(user.gid),
    home: user.home,
    ok: true,
    scope: APP_CREDENTIAL_SCOPE,
    uid: normalizeId(user.uid),
    username: user.username
  };
}

function appCredentialContext({
  home = os.homedir(),
  // readable-check: allow method-probe - platform object: process.getuid() and process.getgid() exist only on POSIX
  gid = typeof process.getgid === "function" ? process.getgid() : null,
  // readable-check: allow method-probe - platform object: process.getuid() and process.getgid() exist only on POSIX
  uid = typeof process.getuid === "function" ? process.getuid() : null,
  username = ""
} = {}) {
  const resolvedHome = normalizeHome(home);
  const resolvedUsername = normalizeText(username || currentOsUser().username);
  if (!resolvedHome) {
    return credentialHomeRequiredError("application");
  }
  return {
    home: resolvedHome,
    gid: normalizeId(gid),
    ok: true,
    scope: APP_CREDENTIAL_SCOPE,
    toolHomeSource: resolvedHome,
    uid: normalizeId(uid),
    username: resolvedUsername,
    userKey: resolvedUsername || APP_CREDENTIAL_SCOPE
  };
}

function codexCredentialContext(options = {}) {
  return appCredentialContext(options);
}

function githubCredentialContext(input, options = {}) {
  const {
    accountMode = GITHUB_ACCOUNT_MODE_USER
  } = options;
  const resolvedAccountMode = normalizeGithubAccountMode(accountMode);
  if (resolvedAccountMode === GITHUB_ACCOUNT_MODE_LOCAL) {
    const local = currentUserCredentialContext();
    return local.ok === false
      ? {
          ...local,
          accountMode: resolvedAccountMode
        }
      : {
          accountMode: resolvedAccountMode,
          gid: local.gid,
          home: local.home,
          ok: true,
          scope: APP_CREDENTIAL_SCOPE,
          toolHomeSource: local.home,
          uid: local.uid,
          username: local.username,
          userKey: local.username || GITHUB_ACCOUNT_MODE_LOCAL
        };
  }

  const user = input?.vibe64User || {};
  const username = actingUsernameFromUser(user);
  const home = actingHomeFromUser(user);
  const uid = actingUidFromUser(user);
  const gid = actingGidFromUser(user);
  if (!username || !home) {
    return {
      accountMode: resolvedAccountMode,
      code: "vibe64_os_user_required",
      error: "A Vibe64 OS username and real home are required for GitHub operations.",
      errors: [
        {
          code: "vibe64_os_user_required",
          message: "A Vibe64 OS username and real home are required for GitHub operations."
        }
      ],
      ok: false
    };
  }
  if (uid === null || gid === null) {
    return {
      accountMode: resolvedAccountMode,
      code: "vibe64_os_user_identity_required",
      error: "A Vibe64 OS user uid and gid are required for GitHub operations.",
      errors: [
        {
          code: "vibe64_os_user_identity_required",
          message: "A Vibe64 OS user uid and gid are required for GitHub operations."
        }
      ],
      ok: false
    };
  }
  return {
    accountMode: resolvedAccountMode,
    home,
    gid,
    ok: true,
    scope: USER_CREDENTIAL_SCOPE,
    toolHomeSource: home,
    uid,
    username,
    userKey: username
  };
}

/**
 * @param {object} input
 * @param {string} [input.accountMode]
 * @param {RuntimeEnv} input.env names the account mode when the caller does not
 * @param {object | null} [input.vibe64User]
 */
function resolveGithubHomeForActor({
  accountMode = "",
  env,
  vibe64User = null
}) {
  const resolvedAccountMode = normalizeGithubAccountMode(
    accountMode || env[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
  const context = githubCredentialContext({
    vibe64User
  }, {
    accountMode: resolvedAccountMode
  });
  if (context?.ok === false) {
    return {
      ...context,
      accountMode: resolvedAccountMode,
      ownerUserKey: "",
      credentialScope: "",
      toolHomeSource: ""
    };
  }
  return {
    accountMode: resolvedAccountMode,
    credentialScope: context.scope || "",
    ok: true,
    ownerUserKey: context.username || "",
    hostGid: context.gid,
    hostUid: context.uid,
    toolHomeSource: context.home || ""
  };
}

/**
 * @param {object} input
 * @param {string} [input.accountMode]
 * @param {RuntimeEnv} input.env names the account mode when the caller does not
 * @param {string} [input.ownerUserKey]
 * @param {typeof resolveOsUser} [input.osUserResolver]
 */
async function resolveGithubHomeForStoredActor({
  accountMode = "",
  env,
  ownerUserKey = "",
  osUserResolver = resolveOsUser
}) {
  const resolvedAccountMode = normalizeGithubAccountMode(
    accountMode || env[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
  if (resolvedAccountMode === GITHUB_ACCOUNT_MODE_LOCAL) {
    return resolveGithubHomeForActor({
      accountMode: resolvedAccountMode,
      env
    });
  }

  const username = normalizeText(ownerUserKey);
  if (!username) {
    return {
      accountMode: resolvedAccountMode,
      code: "vibe64_os_user_required",
      error: "A Vibe64 OS username is required for GitHub operations.",
      ok: false
    };
  }
  const osUser = await osUserResolver(username);
  const home = normalizeHome(osUser?.home);
  if (!home) {
    return credentialHomeRequiredError("GitHub");
  }
  return {
    accountMode: resolvedAccountMode,
    credentialScope: USER_CREDENTIAL_SCOPE,
    hostGid: normalizeId(osUser?.gid),
    hostUid: normalizeId(osUser?.uid),
    ok: true,
    ownerUserKey: username,
    toolHomeSource: home
  };
}

function composeGithubTerminalHome(result = {}) {
  if (result.ok === false) {
    return result;
  }
  const githubToolHomeSource = normalizeText(result.githubToolHomeSource || result.toolHomeSource);
  if (!githubToolHomeSource) {
    return credentialHomeRequiredError("terminal");
  }
  return {
    ...result,
    githubToolHomeSource,
    toolHomeSource: githubToolHomeSource
  };
}

/** @param {RuntimeLogger} logger */
function logGithubCredentialHomeResolution(logger, result, options = {}) {
  const {
    operation = "",
    terminalKind = ""
  } = options;
  const ok = result?.ok !== false;
  return logger[ok ? "info" : "warn"]({
    accountMode: normalizeText(result?.accountMode),
    code: result?.code || "",
    component: "vibe64.github_credential_home",
    event: ok
      ? "vibe64.github_credential_home.resolved"
      : "vibe64.github_credential_home.failed",
    ok,
    operation: normalizeText(operation),
    ownerUserKey: result?.ownerUserKey || result?.userKey || "",
    credentialScope: result?.credentialScope || result?.scope || "",
    terminalKind
  }, ok ? "Vibe64 GitHub credential home resolved." : "Vibe64 GitHub credential home resolution failed.");
}

export {
  appCredentialContext,
  APP_CREDENTIAL_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_CREDENTIAL_SCOPE,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  codexCredentialContext,
  composeGithubTerminalHome,
  githubCredentialContext,
  logGithubCredentialHomeResolution,
  normalizeGithubAccountMode,
  resolveGithubHomeForActor,
  resolveGithubHomeForStoredActor
};
