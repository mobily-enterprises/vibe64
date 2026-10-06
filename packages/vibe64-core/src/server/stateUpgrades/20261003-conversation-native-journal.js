export default {
  id: "20261003-conversation-native-journal",
  async run({ upgradeColleagueConversationRuntime, ...context }) {
    if (typeof upgradeColleagueConversationRuntime !== "function") {
      throw new Error("Use the candidate release's upgrade-state command; its conversation runtime upgrade owner is required.");
    }
    await upgradeColleagueConversationRuntime(context);
  }
};
