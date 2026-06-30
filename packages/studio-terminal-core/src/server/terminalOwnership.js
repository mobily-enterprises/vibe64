import {
  APP_PROVIDER_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_PROVIDER_SCOPE,
  normalizeGithubAccountMode,
  resolveGithubToolHomeForActor
} from "./providerHomes.js";

const TERMINAL_OWNER_SCOPE_APP = "app";
const TERMINAL_OWNER_SCOPE_LOCAL = "local";
const TERMINAL_OWNER_SCOPE_USER = "user";
const TERMINAL_OWNER_MISMATCH_CODE = "vibe64_terminal_owner_mismatch";
const TERMINAL_OWNER_REQUIRED_CODE = "vibe64_terminal_owner_required";
const TERMINAL_GITHUB_ACTOR_SCOPE_NONE = "none";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeTerminalOwnerScope(value = "") {
  const normalized = normalizeText(value).toLowerCase();
  if (normalized === TERMINAL_OWNER_SCOPE_APP) {
    return TERMINAL_OWNER_SCOPE_APP;
  }
  if (normalized === TERMINAL_OWNER_SCOPE_USER) {
    return TERMINAL_OWNER_SCOPE_USER;
  }
  return TERMINAL_OWNER_SCOPE_LOCAL;
}

function terminalOwnerFromGithubToolHome(result = {}) {
  const accountMode = normalizeGithubAccountMode(result.accountMode, GITHUB_ACCOUNT_MODE_LOCAL);
  const ownerScope = accountMode === GITHUB_ACCOUNT_MODE_USER
    ? TERMINAL_OWNER_SCOPE_USER
    : TERMINAL_OWNER_SCOPE_LOCAL;
  return {
    githubProviderScope: normalizeText(result.providerScope) || (ownerScope === TERMINAL_OWNER_SCOPE_USER ? USER_PROVIDER_SCOPE : APP_PROVIDER_SCOPE),
    githubToolHomeSource: normalizeText(result.githubToolHomeSource || result.toolHomeSource),
    ownerEmail: normalizeText(result.ownerEmail),
    ownerScope,
    ownerUserKey: normalizeText(result.ownerUserKey) || (ownerScope === TERMINAL_OWNER_SCOPE_LOCAL ? GITHUB_ACCOUNT_MODE_LOCAL : "")
  };
}

function terminalOwnerForGithubActor({
  accountMode = "",
  env = process.env,
  providerHomesRoot = "",
  vibe64User = null
} = {}) {
  const result = resolveGithubToolHomeForActor({
    accountMode,
    env,
    providerHomesRoot,
    vibe64User
  });
  if (result?.ok === false) {
    return result;
  }
  return {
    ...terminalOwnerFromGithubToolHome(result),
    ok: true
  };
}

function terminalOwnerMetadata(owner = {}) {
  const ownerScope = normalizeTerminalOwnerScope(owner.ownerScope);
  return {
    terminalOwner: {
      githubProviderScope: normalizeText(owner.githubProviderScope) || (ownerScope === TERMINAL_OWNER_SCOPE_USER ? USER_PROVIDER_SCOPE : APP_PROVIDER_SCOPE),
      githubToolHomeSource: normalizeText(owner.githubToolHomeSource),
      ownerEmail: normalizeText(owner.ownerEmail),
      ownerScope,
      ownerUserKey: normalizeText(owner.ownerUserKey) || (ownerScope === TERMINAL_OWNER_SCOPE_LOCAL ? GITHUB_ACCOUNT_MODE_LOCAL : "")
    }
  };
}

function terminalAppOwnerMetadata({
  githubToolHomeSource = "",
  ownerUserKey = "app"
} = {}) {
  return terminalOwnerMetadata({
    githubProviderScope: APP_PROVIDER_SCOPE,
    githubToolHomeSource,
    ownerScope: TERMINAL_OWNER_SCOPE_APP,
    ownerUserKey
  });
}

function terminalNoGithubActorMetadata({
  ownerUserKey = "runtime",
  reason = ""
} = {}) {
  return {
    ...terminalAppOwnerMetadata({
      ownerUserKey
    }),
    terminalGithubActor: {
      reason: normalizeText(reason),
      scope: TERMINAL_GITHUB_ACTOR_SCOPE_NONE
    }
  };
}

function terminalOwnerFromMetadata(metadata = {}) {
  const owner = metadata?.terminalOwner && typeof metadata.terminalOwner === "object"
    ? metadata.terminalOwner
    : {};
  const ownerScope = normalizeText(owner.ownerScope);
  if (!ownerScope) {
    return null;
  }
  return {
    githubProviderScope: normalizeText(owner.githubProviderScope),
    githubToolHomeSource: normalizeText(owner.githubToolHomeSource),
    ownerEmail: normalizeText(owner.ownerEmail),
    ownerScope: normalizeTerminalOwnerScope(ownerScope),
    ownerUserKey: normalizeText(owner.ownerUserKey)
  };
}

function terminalOwnerError(message, code = TERMINAL_OWNER_MISMATCH_CODE, extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    ok: false,
    statusCode: code === TERMINAL_OWNER_REQUIRED_CODE ? 401 : 403
  };
}

function terminalOwnerMatchesRequest(metadata = {}) {
  const expected = terminalOwnerFromMetadata(metadata);
  if (!expected) {
    return {
      legacyOwnerless: true,
      ok: true
    };
  }
  return {
    ownerScope: expected.ownerScope,
    ownerUserKey: expected.ownerUserKey,
    ok: true
  };
}

export {
  TERMINAL_GITHUB_ACTOR_SCOPE_NONE,
  TERMINAL_OWNER_MISMATCH_CODE,
  TERMINAL_OWNER_REQUIRED_CODE,
  TERMINAL_OWNER_SCOPE_APP,
  TERMINAL_OWNER_SCOPE_LOCAL,
  TERMINAL_OWNER_SCOPE_USER,
  terminalAppOwnerMetadata,
  terminalNoGithubActorMetadata,
  terminalOwnerError,
  terminalOwnerForGithubActor,
  terminalOwnerFromGithubToolHome,
  terminalOwnerFromMetadata,
  terminalOwnerMatchesRequest,
  terminalOwnerMetadata
};
