import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { publishStateUpgradeFiles, stateUpgradeRunBackupRoots } from "@local/vibe64-core/server/stateUpgradeFiles";
import { projectSessionRoots } from "./projectSessionRoots.js";
import { createVibe64SessionStore } from "./sessionStore.js";

/**
 * 20261125-agent-run-history: every agent run of every project's active and
 * closing sessions that holds more than its last two turns keeps those two, and
 * the events of the turns before them move to its history
 * (agentRunHistory.js). Core's publisher backs up each original and each
 * replacement before the first change and publishes each history before its
 * run. Each run of this upgrade prepares again from what the runs hold, in a
 * backup folder of its own after one that stopped part way: the previous
 * release, started again meanwhile, reads and writes split runs as it does any
 * other, and a run whose history was published without it is split again from
 * the run, its history cut back to what the run records.
 * @param {{ systemRoot: string, apply: boolean, backupRoot: string, report: (level: string, message: string) => void }} context
 */
async function upgradeAgentRunHistory(context) {
  const { current: backupRoot, earlier } = await stateUpgradeRunBackupRoots(context.backupRoot);
  if (earlier.length) {
    context.report("info", `An earlier run stopped part way: splitting what the runs hold now, backed up in ${path.basename(backupRoot)}; the earlier backup is kept.`);
  }
  return publishStateUpgradeFiles({
    ...context,
    backupRoot,
    inputs: () => projectSessionRoots(context.systemRoot),
    async prepareUpdates(temporaryRoot) {
      const updates = [];
      for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
        const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
        const prepared = await store.prepareAgentRunHistoryUpgrade({ temporaryRoot });
        context.report("info", `${path.basename(projectRuntimeRoot)}: ${prepared.runs} agent run(s) to split, moving ${prepared.events} event(s) of earlier turns to their histories.`);
        updates.push(...prepared.updates);
      }
      return updates;
    }
  });
}

export { upgradeAgentRunHistory };
