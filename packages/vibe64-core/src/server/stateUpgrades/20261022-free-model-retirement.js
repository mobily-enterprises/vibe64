import path from "node:path";

// Vibe64 no longer offers OpenCode Zen's free Big Pickle model. Accounts
// unsets the routing roles that name it; Colleague keeps a chat bound to it as
// a previous conversation. Each owner has its own backup root.
export default {
  id: "20261022-free-model-retirement",
  async run({ retireFreeModelRouting, retireColleagueFreeModel, backupRoot, ...context }) {
    if (typeof retireFreeModelRouting !== "function" || typeof retireColleagueFreeModel !== "function") {
      throw new Error("Use the candidate upgrade-state command; the Accounts routing and Colleague owners are required.");
    }
    await retireFreeModelRouting({ ...context, backupRoot: path.join(backupRoot, "routing") });
    await retireColleagueFreeModel({ ...context, backupRoot: path.join(backupRoot, "colleague") });
  }
};
