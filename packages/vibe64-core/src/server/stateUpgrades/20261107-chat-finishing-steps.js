// Every chat saves its own finishing steps (review, deslop, uiPass, autoSave):
// an Auto, Senior or Junior chat keeps Auto's mandatory review and its Deslop,
// UI pass and save choices, Custom chats start with the defaults, and
// temporary chats and Fix it with AI run none. Terminals owns the conversion;
// the candidate CLI supplies the operation.
export default {
  id: "20261107-chat-finishing-steps",
  async run({ upgradeChatFinishingSteps, ...context }) {
    if (typeof upgradeChatFinishingSteps !== "function") {
      throw new Error("Use the candidate upgrade-state command; the chat finishing steps owner is required.");
    }
    await upgradeChatFinishingSteps(context);
  }
};
