// Every repair chat from before AI tasks (a temporary chat a repair flow opened,
// marked by a filled repair field) is deleted as Close deletes one, in live
// sessions and prepared renewal archives. The person's own temporary chats,
// Colleague's, AI tasks and other archived sessions stay. A live repair chat with
// Codex or OpenCode conversations is handed to Close, which deletes it through
// that engine after the engine's next turn in its session; a prepared archive's
// stay in the engine's storage. Terminals owns the deletion; the candidate CLI
// supplies the operation.
export default {
  id: "20261104-temporary-repair-chats-removed",
  async run({ removeTemporaryRepairChats, ...context }) {
    if (typeof removeTemporaryRepairChats !== "function") {
      throw new Error("Use the candidate upgrade-state command; the repair chat owner is required.");
    }
    await removeTemporaryRepairChats(context);
  }
};
