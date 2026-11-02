import {
  APP_CREDENTIAL_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  USER_CREDENTIAL_SCOPE,
  normalizeText
} from "@local/vibe64-execution/server";

const TERMINAL_OWNER_SCOPE_APP = "app";
const TERMINAL_OWNER_SCOPE_LOCAL = "local";
const TERMINAL_OWNER_SCOPE_USER = "user";
const TERMINAL_GITHUB_ACTOR_SCOPE_NONE = "none";

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

function terminalOwnerMetadata(owner = {}) {
  const ownerScope = normalizeTerminalOwnerScope(owner.ownerScope);
  return {
    terminalOwner: {
      githubCredentialScope: normalizeText(owner.githubCredentialScope) ||
        (ownerScope === TERMINAL_OWNER_SCOPE_USER ? USER_CREDENTIAL_SCOPE : APP_CREDENTIAL_SCOPE),
      githubToolHomeSource: normalizeText(owner.githubToolHomeSource),
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
    githubCredentialScope: APP_CREDENTIAL_SCOPE,
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

const __testables = Object.freeze({ terminalOwnerMetadata });

export {
  terminalAppOwnerMetadata,
  terminalNoGithubActorMetadata,
  __testables
};
