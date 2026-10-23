import path from "node:path";

// Model routing becomes the owner's AI setup and the team AI setup. Sessions
// drop their workflow tool first, then Accounts converts the routing file.
// Each owner has its own backup root.
export default {
  id: "20261023-owner-team-ai-setups",
  async run({ upgradeTeamSetupSessions, upgradeTeamSetupRouting, backupRoot, ...context }) {
    if (typeof upgradeTeamSetupSessions !== "function" || typeof upgradeTeamSetupRouting !== "function") {
      throw new Error("Use the candidate upgrade-state command; the Accounts routing and session owners are required.");
    }
    await upgradeTeamSetupSessions({ ...context, backupRoot: path.join(backupRoot, "sessions") });
    await upgradeTeamSetupRouting({ ...context, backupRoot: path.join(backupRoot, "routing") });
  }
};
