export default {
  id: "20261006-colleague-conversation-history",
  async run({ upgradeColleagueConversationHistory, ...context }) {
    if (typeof upgradeColleagueConversationHistory !== "function") {
      throw new Error("Use the candidate release's upgrade-state command; its Colleague history upgrade owner is required.");
    }
    await upgradeColleagueConversationHistory(context);
  }
};
