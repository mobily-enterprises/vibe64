/** @typedef {import("./types.js").AccountsService} AccountsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * The assistant runtime's Claude and Codex sign-in status hooks: whether each account is connected, as Accounts reads
 * it. The OpenCode connection hooks are configureAiConnectionRuntime's.
 * @param {object} dependencies
 * @param {AccountsService} dependencies.accounts
 * @param {TerminalsService} dependencies.terminals
 */
function configureSignInStatusRuntime({ accounts, terminals }) {
  /**
   * Whether Claude Code is signed in.
   */
  async function claudeConnectionStatus() {
    return (await accounts.getClaudeStatus()).account?.connected === true;
  }

  /**
   * Whether Codex is signed in.
   */
  async function codexConnectionStatus() {
    const status = await accounts.getStatus({ accountIds: ["codex"] });
    return status.ok === true &&
      status.accounts.some((account) => account.id === "codex" && account.connected === true);
  }

  terminals.configureAssistantRuntime({
    claudeConnectionStatus,
    codexConnectionStatus
  });
}

export { configureSignInStatusRuntime };
