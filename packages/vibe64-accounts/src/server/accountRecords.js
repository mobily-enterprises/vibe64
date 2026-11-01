import { vibe64Result } from "@local/vibe64-core/server/serverResponses";
import { APP_CREDENTIAL_SCOPE, operatorCliProblem, USER_CREDENTIAL_SCOPE } from "@local/vibe64-execution/server";

import { API_KEY_AUTH_MODE, BROWSER_AUTH_MODE, DEVICE_AUTH_MODE } from "./accountsRuntime.js";

// The accounts Accounts shows, which ones a request asks for, and the status
// rows each read returns.

const ACCOUNT_DEFINITIONS = Object.freeze({
  claude: Object.freeze({
    id: "claude",
    label: "Claude Code",
    required: false,
    scope: APP_CREDENTIAL_SCOPE
  }),
  codex: Object.freeze({
    id: "codex",
    label: "Codex",
    required: true,
    scope: APP_CREDENTIAL_SCOPE
  }),
  github: Object.freeze({
    id: "github",
    label: "GitHub",
    required: true,
    scope: USER_CREDENTIAL_SCOPE
  })
});

const DEFAULT_ACCOUNT_STATUS_PROVIDER_IDS = Object.freeze(["codex", "claude", "github"]);

function accountsResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_accounts_request_failed",
    fallbackMessage: "Vibe64 accounts request failed."
  });
}

function refreshRequested(input) {
  return input?.refresh === true || input?.refresh === "true" || input?.refresh === "1";
}

function normalizedAccountId(value = "") {
  const accountId = String(value || "").trim().toLowerCase();
  return ACCOUNT_DEFINITIONS[accountId] ? accountId : "";
}

function normalizedAccountIdList(value = DEFAULT_ACCOUNT_STATUS_PROVIDER_IDS) {
  const source = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  const accountIds = [];
  const seen = new Set();
  for (const item of source) {
    const accountId = normalizedAccountId(item);
    if (!accountId || seen.has(accountId)) {
      continue;
    }
    seen.add(accountId);
    accountIds.push(accountId);
  }
  return accountIds;
}

function hasAccountSelection(input = {}) {
  return Object.hasOwn(input, "providerIds") ||
    Object.hasOwn(input, "providers") ||
    Object.hasOwn(input, "accountIds");
}

function requestedAccountIds(input = {}) {
  if (!hasAccountSelection(input)) {
    return [...DEFAULT_ACCOUNT_STATUS_PROVIDER_IDS];
  }
  return normalizedAccountIdList(input.providerIds || input.providers || input.accountIds);
}

function normalizedAuthMode(accountId, mode = "") {
  const requestedMode = String(mode || "").trim().toLowerCase();
  if (accountId === "codex" && requestedMode === DEVICE_AUTH_MODE) {
    return DEVICE_AUTH_MODE;
  }
  if (accountId === "codex" && requestedMode === API_KEY_AUTH_MODE) {
    return API_KEY_AUTH_MODE;
  }
  return BROWSER_AUTH_MODE;
}

function accountDisconnected({
  code = "",
  id,
  gitIdentity = null,
  label,
  message,
  observed = "",
  previousGithub = null,
  previousUsername = "",
  scope = "",
  status = "not_connected"
}) {
  return {
    ...(code ? { code } : {}),
    connected: false,
    id,
    label,
    gitIdentity,
    message,
    observed,
    previousGithub,
    previousUsername,
    previouslyLinked: Boolean(previousUsername),
    required: true,
    scope,
    status
  };
}

function accountConnected({
  id,
  gitIdentity = null,
  label,
  message,
  observed = "",
  ownerOnly,
  scope = "",
  username = ""
}) {
  return {
    connected: true,
    id,
    label,
    gitIdentity,
    message,
    observed,
    ...(typeof ownerOnly === "boolean" ? { ownerOnly } : {}),
    required: true,
    scope,
    status: "connected",
    username
  };
}

/**
 * A CLI that is missing or did not start is not a signed-out account.
 */
function accountReadFailed(id, error) {
  const definition = ACCOUNT_DEFINITIONS[id] || { id, label: id };
  return {
    ...accountDisconnected({
      ...definition,
      code: String(error?.code || "") || "vibe64_account_status_failed",
      message: String(error?.message || error || "") || `${definition.label} status could not be read.`,
      status: "error"
    }),
    required: definition.required !== false
  };
}

function operatorCliAccount(id, { installed = false, observed = "" } = {}) {
  const { install, title, detail, ...problem } = operatorCliProblem(id, { installed });
  return {
    ...accountDisconnected({ ...ACCOUNT_DEFINITIONS[id], ...problem, observed }),
    required: ACCOUNT_DEFINITIONS[id].required,
    title,
    detail,
    install
  };
}

function blockedReason(accounts = []) {
  const firstMissingAccount = accounts.find((account) => account.required && account.connected !== true);
  return firstMissingAccount ? String(firstMissingAccount.message || "") : "";
}

function authenticatingAccount(accountId = "") {
  const definition = ACCOUNT_DEFINITIONS[accountId] || {};
  return {
    connected: false,
    id: accountId,
    label: definition.label || accountId,
    required: true,
    scope: definition.scope || "",
    status: "authenticating"
  };
}

export {
  ACCOUNT_DEFINITIONS,
  accountConnected,
  accountDisconnected,
  accountReadFailed,
  accountsResult,
  authenticatingAccount,
  blockedReason,
  hasAccountSelection,
  normalizedAccountId,
  normalizedAuthMode,
  operatorCliAccount,
  refreshRequested,
  requestedAccountIds
};
