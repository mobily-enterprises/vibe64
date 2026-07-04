import { access } from "node:fs/promises";

import {
  APP_CREDENTIAL_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_CREDENTIAL_SCOPE,
  composeGithubTerminalHome,
  logGithubCredentialHomeResolution,
  normalizeGithubAccountMode,
  resolveGithubHomeForActor
} from "./credentialHomes.js";

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
    githubCredentialScope: normalizeText(result.credentialScope) || (ownerScope === TERMINAL_OWNER_SCOPE_USER ? USER_CREDENTIAL_SCOPE : APP_CREDENTIAL_SCOPE),
    githubToolHomeSource: normalizeText(result.githubToolHomeSource || result.toolHomeSource),
    ownerScope,
    ownerUserKey: normalizeText(result.ownerUserKey) || (ownerScope === TERMINAL_OWNER_SCOPE_LOCAL ? GITHUB_ACCOUNT_MODE_LOCAL : "")
  };
}

function terminalOwnerForGithubActor({
  accountMode = "",
  env = process.env,
  vibe64User = null
} = {}) {
  const result = resolveGithubHomeForActor({
    accountMode,
    env,
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

async function resolveRequestGithubTerminalToolHome({
  env = process.env,
  input = {},
  logger = null,
  notReadyMessage = "GitHub is not ready for command terminals. Connect GitHub before running workflow commands.",
  operation = "",
  terminalKind = "project-tool",
  terminalUnavailableMessage = "Terminal account storage is not available for command terminals.",
  unavailableMessage = "GitHub account storage is not available for command terminals.",
  vibe64User = null
} = {}) {
  const context = resolveGithubHomeForActor({
    env,
    vibe64User: vibe64User || input?.vibe64User || null
  });
  logGithubCredentialHomeResolution(logger, context, {
    operation,
    terminalKind
  });
  if (context?.ok === false) {
    return {
      ...context,
      error: context.error || unavailableMessage,
      ok: false
    };
  }

  const githubToolHomeSource = normalizeText(context?.toolHomeSource);
  if (!githubToolHomeSource) {
    return {
      code: "vibe64_github_credential_home_missing",
      error: unavailableMessage,
      ok: false
    };
  }

  try {
    await access(githubToolHomeSource);
  } catch {
    return {
      code: "vibe64_github_credential_home_not_ready",
      error: notReadyMessage,
      ok: false
    };
  }
  const terminalHome = composeGithubTerminalHome(context);
  if (terminalHome?.ok === false) {
    return {
      ...terminalHome,
      error: terminalHome.error || terminalUnavailableMessage,
      ok: false
    };
  }
  return {
    ok: true,
    credentialScope: context.credentialScope || "",
    githubToolHomeSource: terminalHome.githubToolHomeSource,
    hostGid: context.hostGid,
    hostUid: context.hostUid,
    owner: terminalOwnerFromGithubToolHome(terminalHome),
    toolHomeSource: terminalHome.toolHomeSource
  };
}

function terminalOwnerMetadata(owner = {}) {
  const ownerScope = normalizeTerminalOwnerScope(owner.ownerScope);
  return {
    terminalOwner: {
      githubCredentialScope: normalizeText(owner.githubCredentialScope) || (ownerScope === TERMINAL_OWNER_SCOPE_USER ? USER_CREDENTIAL_SCOPE : APP_CREDENTIAL_SCOPE),
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

function terminalOwnerFromMetadata(metadata = {}) {
  const owner = metadata?.terminalOwner && typeof metadata.terminalOwner === "object"
    ? metadata.terminalOwner
    : {};
  const ownerScope = normalizeText(owner.ownerScope);
  if (!ownerScope) {
    return null;
  }
  return {
    githubCredentialScope: normalizeText(owner.githubCredentialScope),
    githubToolHomeSource: normalizeText(owner.githubToolHomeSource),
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
    return terminalOwnerError(
      "Terminal owner metadata is required.",
      TERMINAL_OWNER_REQUIRED_CODE
    );
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
  terminalOwnerMetadata,
  resolveRequestGithubTerminalToolHome
};
