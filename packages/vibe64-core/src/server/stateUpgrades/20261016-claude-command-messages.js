export default {
  id: "20261016-claude-command-messages",
  async run({ upgradeClaudeCommandMessages, ...context }) {
    if (typeof upgradeClaudeCommandMessages !== "function") {
      throw new Error("Use the candidate upgrade-state command; its Claude message repair owner is required.");
    }
    await upgradeClaudeCommandMessages(context);
  }
};
