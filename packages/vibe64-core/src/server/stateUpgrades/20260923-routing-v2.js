const id = "20260923-routing-v2";

async function run({ upgradeAssistantRouting, ...context }) {
  if (typeof upgradeAssistantRouting !== "function") {
    throw new Error("Use the candidate release's upgrade-state command; its routing upgrade owner is required.");
  }
  await upgradeAssistantRouting(context);
}

export default { id, run };
