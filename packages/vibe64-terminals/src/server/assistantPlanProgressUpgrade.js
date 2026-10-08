import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { planProgressUpgradeChanges } from "./assistantWorkPlan.js";

async function upgradePlanProgress(context) {
  return publishStateUpgradeFiles({ ...context, prepareUpdates: async temporaryRoot => {
    const updates = [];
    for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
      const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
      const staged = await store.prepareAssistantRoutingStateUpgrade({ temporaryRoot,
        transform: () => ({}), transformPlanProgress: planProgressUpgradeChanges });
      context.report("info", `${path.basename(projectRuntimeRoot)}: ${staged.length} paired plan/progress file change(s); existing text and archive IDs are preserved.`);
      updates.push(...staged);
    }
    return updates;
  } });
}
export { upgradePlanProgress };
