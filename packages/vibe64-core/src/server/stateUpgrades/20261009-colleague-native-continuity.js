export default {
  id: "20261009-colleague-native-continuity",
  async run({ upgradeColleagueNativeContinuity, ...context }) {
    if (typeof upgradeColleagueNativeContinuity !== "function") {
      throw new Error("Use the candidate upgrade-state command; the Colleague native-continuity owner is required.");
    }
    await upgradeColleagueNativeContinuity(context);
  }
};
