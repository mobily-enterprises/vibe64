export default {
  id: "20261016-claude-rejected-input",
  async run({ upgradeClaudeRejectedInput, ...context }) {
    if (typeof upgradeClaudeRejectedInput !== "function") throw new Error("Use the candidate upgrade-state command; its Claude delivery repair owner is required.");
    await upgradeClaudeRejectedInput(context);
  }
};
