import path from "node:path";

export default {
  id: "20261006-routing-format-compatibility",
  async run({ upgradeAssistantRouting, upgradeAssistantRoles, upgradeAssistantHelpers, ...context }) {
    if ([upgradeAssistantRouting, upgradeAssistantRoles, upgradeAssistantHelpers].some(owner => typeof owner !== "function")) {
      throw new Error("Use the candidate release's upgrade-state command; its routing upgrade owners are required.");
    }
    // This correction validates supported formats. Earlier numbered entries own
    // actual conversion and its separately committed publication/ledger recovery.
    await upgradeAssistantRouting({ ...context, apply: false, backupRoot: path.join(context.backupRoot, "routing-v2") });
    await upgradeAssistantRoles({ ...context, apply: false, backupRoot: path.join(context.backupRoot, "role-names") });
    await upgradeAssistantHelpers({ ...context, apply: false, backupRoot: path.join(context.backupRoot, "helper") });
  }
};
