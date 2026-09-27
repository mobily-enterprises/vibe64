export default {
  id: "20260927-assistant-helper",
  async run({ upgradeAssistantHelpers, ...context }) {
    if (typeof upgradeAssistantHelpers !== "function") throw new Error("Use the candidate release's upgrade-state command; its Helper upgrade owner is required.");
    await upgradeAssistantHelpers(context);
  }
};
