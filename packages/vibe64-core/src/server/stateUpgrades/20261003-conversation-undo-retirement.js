export default {
  id: "20261003-conversation-undo-retirement",
  async run({ inspectConversationUndoRetirement, ...context }) {
    if (typeof inspectConversationUndoRetirement !== "function") {
      throw new Error("Use the candidate release's upgrade-state command; its conversation Undo preflight is required.");
    }
    await inspectConversationUndoRetirement(context);
  }
};
