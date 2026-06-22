import {
  APP_PROVIDER_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_PROVIDER_SCOPE,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  githubProviderUserKey,
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

function accountModeForOwnerCheck({
  accountMode = "",
  env = process.env
} = {}) {
  return normalizeGithubAccountMode(
    accountMode || env?.[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
    GITHUB_ACCOUNT_MODE_LOCAL
  );
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

function ownerFingerprint(owner = {}) {
  return {
    ownerScope: normalizeTerminalOwnerScope(owner.ownerScope),
    ownerUserKey: normalizeText(owner.ownerUserKey)
  };
}

function sameOwner(left = {}, right = {}) {
  const leftOwner = ownerFingerprint(left);
  const rightOwner = ownerFingerprint(right);
  return leftOwner.ownerScope === rightOwner.ownerScope &&
    leftOwner.ownerUserKey === rightOwner.ownerUserKey;
}

function terminalOwnerMatchesRequest(metadata = {}, {
  accountMode = "",
  env = process.env,
  providerHomesRoot = "",
  vibe64User = null
} = {}) {
  const expected = terminalOwnerFromMetadata(metadata);
  const resolvedAccountMode = accountModeForOwnerCheck({
    accountMode,
    env
  });
  if (!expected) {
    return resolvedAccountMode === GITHUB_ACCOUNT_MODE_USER
      ? terminalOwnerError(
        "This terminal was started before Vibe64 recorded terminal ownership. Restart the terminal before using it online.",
        TERMINAL_OWNER_REQUIRED_CODE
      )
      : {
        ok: true,
        legacyOwnerless: true
      };
  }
  if (expected.ownerScope === TERMINAL_OWNER_SCOPE_APP) {
    if (vibe64User) {
      const observedUserKey = githubProviderUserKey(vibe64User);
      return terminalOwnerError("This terminal is app-owned and is not owned by the current Vibe64 user.", TERMINAL_OWNER_MISMATCH_CODE, {
        observedOwnerScope: TERMINAL_OWNER_SCOPE_USER,
        observedOwnerUserKey: observedUserKey,
        ownerScope: expected.ownerScope,
        ownerUserKey: expected.ownerUserKey
      });
    }
    return {
      ok: true
    };
  }

  const observed = terminalOwnerForGithubActor({
    accountMode: resolvedAccountMode,
    env,
    providerHomesRoot,
    vibe64User
  });
  if (observed?.ok === false) {
    return terminalOwnerError(
      observed.error || "GitHub account storage is not available for this terminal.",
      TERMINAL_OWNER_REQUIRED_CODE,
      {
        ownerScope: expected.ownerScope,
        ownerUserKey: expected.ownerUserKey
      }
    );
  }
  if (!sameOwner(expected, observed)) {
    return terminalOwnerError("This terminal belongs to a different Vibe64 user.", TERMINAL_OWNER_MISMATCH_CODE, {
      observedOwnerScope: observed.ownerScope,
      observedOwnerUserKey: observed.ownerUserKey,
      ownerScope: expected.ownerScope,
      ownerUserKey: expected.ownerUserKey
    });
  }
  return {
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
