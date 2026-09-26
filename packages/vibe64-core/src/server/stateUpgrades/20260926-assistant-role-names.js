export default {
  id: "20260926-assistant-role-names",
  async run({ upgradeAssistantRoles, ...context }) {
    if (typeof upgradeAssistantRoles !== "function") {
      throw new Error("Use the candidate release's upgrade-state command; its assistant-role upgrade owner is required.");
    }
    await upgradeAssistantRoles(context);
  }
};
