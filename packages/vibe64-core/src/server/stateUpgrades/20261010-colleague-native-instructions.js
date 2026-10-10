export default {
  id: "20261010-colleague-native-instructions",
  async run({ upgradeColleagueNativeInstructions, ...context }) {
    if (typeof upgradeColleagueNativeInstructions !== "function") {
      throw new Error("Use the candidate upgrade-state command; the Colleague native-instructions owner is required.");
    }
    await upgradeColleagueNativeInstructions(context);
  }
};
