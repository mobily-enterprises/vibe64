// A chat or AI task whose Close had not finished when its session was archived or
// renewed stays in that archive as a closing record that no Close reaches, and so
// do the Codex and OpenCode conversations of the repair chats 20261104 removed
// from prepared renewal archives. In every archive each closing record is deleted
// as Close deletes one, with Claude's history of it; each such Codex or OpenCode
// conversation is recorded as a retired native binding of its archived session,
// for the archive's native-history retirement to delete through its engine.
// Terminals owns the cleanup; the candidate CLI supplies the operation.
export default {
  id: "20261110-archived-closing-chats",
  async run({ retireArchivedClosingChats, ...context }) {
    if (typeof retireArchivedClosingChats !== "function") {
      throw new Error("Use the candidate upgrade-state command; the archived chat owner is required.");
    }
    await retireArchivedClosingChats(context);
  }
};
