export default {
  id: "20261010-assistant-workflow",
  async run({ upgradeAssistantWorkflow, ...context }) {
    if (typeof upgradeAssistantWorkflow !== "function") throw new Error("Use the candidate upgrade-state command; its workflow owner is required.");
    await upgradeAssistantWorkflow(context);
  }
};
