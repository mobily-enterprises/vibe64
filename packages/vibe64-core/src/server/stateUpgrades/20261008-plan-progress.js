export default {
  id: "20261008-plan-progress",
  async run({ upgradePlanProgress, ...context }) {
    if (typeof upgradePlanProgress !== "function") throw new Error("Use the candidate upgrade-state command; the paired plan owner is required.");
    await upgradePlanProgress(context);
  }
};
