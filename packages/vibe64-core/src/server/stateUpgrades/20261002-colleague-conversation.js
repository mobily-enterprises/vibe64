export default {
  id: "20261002-colleague-conversation",
  async run({ upgradeColleagueConversations, ...context }) {
    if (typeof upgradeColleagueConversations !== "function") {
      throw new Error("Use the candidate release's upgrade-state command; its Colleague upgrade owner is required.");
    }
    await upgradeColleagueConversations(context);
  }
};
