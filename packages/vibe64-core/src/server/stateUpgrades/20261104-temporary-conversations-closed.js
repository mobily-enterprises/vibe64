// Every temporary conversation from before AI tasks (repair chats and free
// "Temporary AI" chats) is deleted as Close deletes one, in live sessions and
// prepared renewal archives; AI tasks and other archived sessions stay. Codex
// and OpenCode native conversations stay in their engine's storage. Terminals
// owns the deletion; the candidate CLI supplies the operation.
export default {
  id: "20261104-temporary-conversations-closed",
  async run({ closeOldTemporaryConversations, ...context }) {
    if (typeof closeOldTemporaryConversations !== "function") {
      throw new Error("Use the candidate upgrade-state command; the temporary conversation owner is required.");
    }
    await closeOldTemporaryConversations(context);
  }
};
