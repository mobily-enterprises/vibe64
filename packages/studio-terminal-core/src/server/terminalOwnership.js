import { access, mkdir } from "node:fs/promises";

import {
  APP_PROVIDER_SCOPE,
  GITHUB_ACCOUNT_MODE_LOCAL,
  GITHUB_ACCOUNT_MODE_USER,
  USER_PROVIDER_SCOPE,
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  composeGithubTerminalHome,
  logGithubProviderHomeResolution,
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

async function resolveRequestGithubTerminalToolHome({
  env = process.env,
  input = {},
  logger = null,
  notReadyMessage = "GitHub is not ready for command terminals. Connect GitHub before running workflow commands.",
  operation = "",
  providerHomesRoot = "",
  terminalKind = "project-tool",
  terminalUnavailableMessage = "Terminal account storage is not available for command terminals.",
  unavailableMessage = "GitHub account storage is not available for command terminals.",
  vibe64User = null
} = {}) {
  const resolvedProviderHomesRoot = normalizeText(providerHomesRoot || env?.[VIBE64_PROVIDER_HOMES_ROOT_ENV]);
  const context = resolveGithubToolHomeForActor({
    env,
    providerHomesRoot: resolvedProviderHomesRoot,
    vibe64User: vibe64User || input?.vibe64User || null
  });
  logGithubProviderHomeResolution(logger, context, {
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
      code: "vibe64_github_provider_home_missing",
      error: unavailableMessage,
      ok: false
    };
  }

  try {
    await access(githubToolHomeSource);
  } catch {
    return {
      code: "vibe64_github_provider_home_not_ready",
      error: notReadyMessage,
      ok: false
    };
  }
  const terminalHome = composeGithubTerminalHome(context, {
    providerHomesRoot: resolvedProviderHomesRoot
  });
  if (terminalHome?.ok === false) {
    return {
      ...terminalHome,
      error: terminalHome.error || terminalUnavailableMessage,
      ok: false
    };
  }
  await mkdir(terminalHome.toolHomeSource, {
    mode: 0o700,
    recursive: true
  });

  return {
    ok: true,
    githubToolHomeSource: terminalHome.githubToolHomeSource,
    owner: terminalOwnerFromGithubToolHome(terminalHome),
    providerScope: context.providerScope || "",
    toolHomeSource: terminalHome.toolHomeSource
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
  terminalOwnerMetadata,
  resolveRequestGithubTerminalToolHome
};
