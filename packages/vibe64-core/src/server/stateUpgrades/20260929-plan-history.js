export default {
  id: "20260929-plan-history",
  async run({ upgradeAssistantPlans, ...context }) {
    if (typeof upgradeAssistantPlans !== "function") throw new Error("Use the candidate upgrade-state command; the plan upgrade owner is required.");
    await upgradeAssistantPlans(context);
  }
};
