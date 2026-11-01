import { runLoggedAccountChange } from "./accountChangeLog.js";
import { accountsResult } from "./accountRecords.js";

/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./service.js").AccountNotifications} AccountNotifications */

/**
 * What every account operation asks of the account runtime: its system folder,
 * credential contexts, the AI management policy, host commands and the log of
 * each settled account change.
 * @param {object} dependencies
 * @param {AccountsRuntime} dependencies.accountRuntime
 * @param {RuntimeLogger} dependencies.logger
 * @param {AccountNotifications} dependencies.notifications
 * @param {typeof import("./accountHostCommands.js").runDefaultHostCommand} dependencies.runHostToolCommand
 */
function createAccountAccess({ accountRuntime, logger, notifications, runHostToolCommand }) {
  const resolvedSystemRoot = accountRuntime.systemRoot;

  // readable-check: allow method-probe - cross-repository slot vibe64.accounts.runtime: a host's account runtime may run host tool commands itself; the service's runner applies otherwise
  const accountRunHostCommand = typeof accountRuntime.runHostToolCommand === "function"
    ? (commandArgs, options = {}) => accountRuntime.runHostToolCommand(commandArgs, options, {
        fallback: runHostToolCommand
      })
    : runHostToolCommand;

  const aiManagementError = (input = {}) => accountRuntime.requireAiManagement(input);

  /**
   * A sign-in, logout or provider key change is logged once it settles.
   */
  function accountChange(operation, input = {}, fields = {}, work) {
    return runLoggedAccountChange(logger, operation, { ...fields, actor: String(input.vibe64User?.username || "") },
      () => accountsResult(work));
  }

  async function prepareClaudeAuthChange(input) {
    const failure = aiManagementError(input);
    if (failure) return failure;
    // Running Claude turns keep going: Claude Code reads its credentials for
    // every request. This drops only the account's cached reads, at once.
    const invalidated = await notifications.invalidateAgentRuntimes({ provider: "claude", reason: "claude-auth-change" });
    if (invalidated?.ok !== false) return null;
    return { ...invalidated,
      error: invalidated.error || invalidated.failed?.[0]?.error || "Claude Code could not apply the account change." };
  }

  function authCredentialContext(accountId, githubContext) {
    if (accountId === "github") return githubContext;
    if (accountId === "claude") return accountRuntime.claudeContext();
    return codexContextForInput();
  }

  function currentTargetRoot() {
    return accountRuntime.currentTargetRoot();
  }

  function githubContextForInput(input = {}) {
    return accountRuntime.githubContext(input);
  }

  function codexContextForInput() {
    return accountRuntime.codexContext();
  }

  function previousGithubForInput(input = {}) {
    return accountRuntime.previousGithub(input);
  }

  function debugInputForLog(input = {}) {
    return accountRuntime.debugInput(input);
  }

  return Object.freeze({
    systemRoot: resolvedSystemRoot,
    accountRunHostCommand,
    aiManagementError,
    accountChange,
    prepareClaudeAuthChange,
    authCredentialContext,
    currentTargetRoot,
    githubContextForInput,
    codexContextForInput,
    previousGithubForInput,
    debugInputForLog
  });
}

export {
  createAccountAccess
};
