import {
  APP_CREDENTIAL_SCOPE,
  OPERATOR_CLIS,
  operatorCliProblem,
  resolveOperatorCli,
  USER_CREDENTIAL_SCOPE
} from "@local/vibe64-execution/server";
import { claudeStatusStartFailed, readClaudeCodeAuthStatus } from "@local/studio-terminal-core/server/claudeRuntime";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

import { authError } from "./accountsRuntime.js";
import {
  ACCOUNT_DEFINITIONS,
  accountReadFailed,
  accountsResult,
  blockedReason,
  operatorCliAccount,
  refreshRequested,
  requestedAccountIds
} from "./accountRecords.js";
import { accountDebugSummary, accountsDebugSummary, authDebug } from "./accountsDebug.js";
import { readCodexLocalStatus } from "./codexAccountStatus.js";
import { readGithubAccountStatus, readGithubStatus } from "./githubAccountStatus.js";

/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-core/server/types").PersonalAiProfileStore} PersonalAiProfileStore */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").AccountAccess} AccountAccess */
/** @typedef {ReturnType<typeof import("./codexAccountStatus.js").createCodexAccountStatus>} CodexAccountStatus */
/** @typedef {import("./types.js").TerminalsReadClaudeAccountStatus} TerminalsReadClaudeAccountStatus */

/**
 * What Accounts shows: each account's status row, every row of a status
 * request, and the personal profile it carries.
 * @param {object} dependencies
 * @param {AccountAccess} dependencies.access
 * @param {AccountsRuntime} dependencies.accountRuntime
 * @param {CodexAccountStatus} dependencies.codexStatus
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeLogger} dependencies.logger
 * @param {PersonalAiProfileStore | null} dependencies.personalProfileStore
 * @param {TerminalsReadClaudeAccountStatus | null} dependencies.readClaudeAccountStatus
 */
function createAccountStatusReads({ access, accountRuntime, codexStatus, env, logger, personalProfileStore, readClaudeAccountStatus }) {
  async function readClaudeStatus() {
    if (!resolveOperatorCli("claude", { env }).installed) return operatorCliAccount("claude");
    const credentialHome = accountRuntime.claudeContext();
    const status = credentialHome?.ok === false || !readClaudeAccountStatus
      ? await readClaudeCodeAuthStatus({ env, credentialHome })
      : await readClaudeAccountStatus();
    if (claudeStatusStartFailed(status)) {
      return operatorCliAccount("claude", { installed: true, observed: status.error });
    }
    return { ...ACCOUNT_DEFINITIONS.claude, connected: status.loggedIn,
      username: status.email || "", authMethod: status.authMethod || "", subscriptionType: status.subscriptionType || "",
      status: status.loggedIn ? "connected" : "not_connected",
      message: status.loggedIn ? "Connected through Claude Code." : status.error || "Sign in to Claude Code with your Claude plan." };
  }

  async function accountStatus(accountId, {
    codexMarkerReason = "",
    githubContext = null,
    previousGithub = null,
    rotateCodexMarker = false
  } = {}) {
    authDebug("server.auth.account_status.start", {
      accountId,
      codexMarkerReason,
      githubContextOk: githubContext ? githubContext.ok === true : null,
      previousGithubPresent: Boolean(previousGithub),
      rotateCodexMarker
    });
    let account;
    if (accountId === "github") {
      if (!githubContext?.ok) {
        account = githubContext || authError("vibe64_user_required", "A logged-in Vibe64 user is required for GitHub account operations.");
        authDebug("server.auth.account_status.done", {
          account: accountDebugSummary(account),
          accountId
        });
        return account;
      }
      account = await readGithubStatus({
        githubContext,
        previousGithub,
        runHostToolCommand: access.accountRunHostCommand,
        systemRoot: access.systemRoot
      });
      authDebug("server.auth.account_status.done", {
        account: accountDebugSummary(account),
        accountId
      });
      return account;
    }
    if (accountId === "claude") return readClaudeStatus();
    if (accountId === "codex") {
      account = await codexStatus.readLiveCodexStatus({
        reason: codexMarkerReason || "codex-status-refresh",
        rotateMarker: rotateCodexMarker
      });
      authDebug("server.auth.account_status.done", {
        account: accountDebugSummary(account),
        accountId
      });
      return account;
    }
    throw new Error(`Unknown account: ${accountId}`);
  }

  async function accountsStatus(input = {}) {
    const refresh = refreshRequested(input);
    const accountIds = requestedAccountIds(input);
    const includesGithub = accountIds.includes("github");
    authDebug("server.auth.accounts_status.start", {
      accountIds,
      refresh,
      ...access.debugInputForLog(input)
    });
    const githubContext = includesGithub ? access.githubContextForInput(input) : null;
    if (includesGithub && !githubContext.ok) {
      authDebug("server.auth.accounts_status.github_context_error", {
        code: githubContext.code || "",
        error: githubContext.error || ""
      });
      return githubContext;
    }
    const previousGithub = includesGithub ? access.previousGithubForInput(input) : null;
    async function readAccountRow(accountId) {
      if (accountId === "claude") return readClaudeStatus();
      if (accountId === "codex") {
        if (!resolveOperatorCli("codex", { env }).installed) return operatorCliAccount("codex");
        const localAccount = refresh ? null : await readCodexLocalStatus({
          codexContext: access.codexContextForInput(),
          systemRoot: access.systemRoot
        });
        return refresh || localAccount?.status === "reconnecting"
          ? codexStatus.readLiveCodexStatus({
              reason: refresh ? "accounts-status-refresh" : "accounts-status-recovery"
            })
          : localAccount;
      }
      if (accountId === "github") {
        return refresh
          ? readGithubStatus({
              githubContext,
              previousGithub,
              runHostToolCommand: access.accountRunHostCommand,
              systemRoot: access.systemRoot
            })
          : readGithubAccountStatus({
              githubContext,
              previousGithub,
              readGitIdentity: input.readGitIdentity !== false,
              runHostToolCommand: access.accountRunHostCommand,
              systemRoot: access.systemRoot
            });
      }
      throw new Error(`Unknown account: ${accountId}`);
    }
    /**
     * Each account is read on its own: one that cannot be read becomes its own
     * error row instead of hiding every other account.
     * A Codex sign-in change that could not finish stays "reconnecting", with
     * the reason it is still unfinished.
     */
    async function failedAccountRow(accountId, error) {
      logOperationalEvent(logger, "warn", { component: "vibe64-accounts", event: "vibe64.accounts.status_failed",
        accountId, code: String(error?.code || ""), error: String(error?.message || error || "") },
      "Vibe64 account status could not be read");
      const local = accountId === "codex"
        ? await readCodexLocalStatus({ codexContext: access.codexContextForInput(), systemRoot: access.systemRoot }).catch(() => null)
        : null;
      return local?.status === "reconnecting"
        ? { ...local, code: String(error?.code || local.code || ""), message: String(error?.message || local.message || "") }
        : accountReadFailed(accountId, error);
    }
    const accounts = await Promise.all(accountIds.map((accountId) => readAccountRow(accountId)
      .catch((error) => failedAccountRow(accountId, error))));
    const ready = accounts.every((account) => account.required !== true || account.connected === true);
    authDebug("server.auth.accounts_status.done", {
      accounts: accountsDebugSummary(accounts),
      blockedReason: ready ? "" : blockedReason(accounts),
      ready,
      refresh,
      targetRoot: access.currentTargetRoot()
    });

    return {
      accounts,
      blockedReason: ready ? "" : blockedReason(accounts),
      // Every AI tool this computer lacks, including opencode, which has no account row.
      missingTools: Object.keys(OPERATOR_CLIS).filter((tool) => !resolveOperatorCli(tool, { env }).installed)
        .map((tool) => ({ id: tool, label: OPERATOR_CLIS[tool].name, ...operatorCliProblem(tool) })),
      ok: true,
      credentialScopes: {
        claude: APP_CREDENTIAL_SCOPE,
        codex: APP_CREDENTIAL_SCOPE,
        github: USER_CREDENTIAL_SCOPE
      },
      ready,
      ...(personalProfileStore ? {
        personalProfile: {
          ...(await personalProfileStore.read()),
          available: true,
          scope: "installation"
        }
      } : {}),
      targetRoot: access.currentTargetRoot(),
      updatedAt: new Date().toISOString()
    };
  }

  async function getStatus(input = {}) {
    return accountsResult(async () => {
      return accountsStatus(input);
    });
  }

  async function getClaudeStatus() {
    return accountsResult(async () => ({ account: await readClaudeStatus(), ok: true }));
  }

  async function getCodexStatus() {
    return accountsResult(async () => {
      return {
        account: await accountStatus("codex"),
        ok: true
      };
    });
  }

  async function savePersonalAiProfile(input) {
    return accountsResult(async () => {
      if (!personalProfileStore) {
        return authError(
          "personal_profile_unavailable",
          "Personal profile settings are not available in this Vibe64 runtime."
        );
      }
      return {
        ok: true,
        personalProfile: {
          ...(await personalProfileStore.write({
            preferredName: input.preferredName
          })),
          available: true,
          scope: "installation"
        }
      };
    });
  }

  return Object.freeze({
    accountStatus,
    getStatus,
    getClaudeStatus,
    getCodexStatus,
    savePersonalAiProfile
  });
}

export {
  createAccountStatusReads
};
