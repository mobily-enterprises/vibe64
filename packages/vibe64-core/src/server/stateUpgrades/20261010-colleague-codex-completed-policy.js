export default {
  id: "20261010-colleague-codex-completed-policy",
  async run({ upgradeColleagueCodexCompletedPolicy, ...context }) {
    if (typeof upgradeColleagueCodexCompletedPolicy !== "function") {
      throw new Error("Use the candidate upgrade-state command; the Colleague Codex tool-policy owner is required.");
    }
    await upgradeColleagueCodexCompletedPolicy(context);
  }
};
