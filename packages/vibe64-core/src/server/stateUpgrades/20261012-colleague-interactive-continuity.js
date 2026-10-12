export default {
  id: "20261012-colleague-interactive-continuity",
  async run({ upgradeColleagueHistoricalInteractiveContinuity, ...context }) {
    if (typeof upgradeColleagueHistoricalInteractiveContinuity !== "function") {
      throw new Error("Use the candidate upgrade-state command; the original interactive Colleague continuity owner is required.");
    }
    await upgradeColleagueHistoricalInteractiveContinuity(context);
  }
};
