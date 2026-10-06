export default {
  id: "20261002-session-conversations",
  async run({ upgradeSessionConversations, ...context }) {
    if (typeof upgradeSessionConversations !== "function") {
      throw new Error("Use the candidate release's upgrade-state command; its session conversation upgrade owner is required.");
    }
    await upgradeSessionConversations(context);
  }
};
