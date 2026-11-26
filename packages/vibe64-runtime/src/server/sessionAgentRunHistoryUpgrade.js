// 20261125-agent-run-history's preparation: each agent run of an open session that holds more than its last two
// turns has the earlier turns' events moved to its history (agentRunHistory.js), as the next new turn would move
// them, staged through the stopped session store for Core's publisher.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPlainObject } from "@local/vibe64-core/server/core";
import { stagedUpgradeFile } from "@local/vibe64-core/server/stateUpgradeFiles";
import { AGENT_RUN_HISTORY_SUFFIX, splitAgentRunHistory } from "./agentRunHistory.js";
import { isSafeAgentRunId } from "./sessionRecordRules.js";

/** @typedef {import("./sessionTemporaryConversationRemoval.js").PrepareSessionStateUpgrade} PrepareSessionStateUpgrade */

/**
 * @param {{ prepareSessionStateUpgrade: PrepareSessionStateUpgrade }} dependencies
 */
function createSessionAgentRunHistoryUpgrade({ prepareSessionStateUpgrade }) {
  /**
   * 20261125: the runs of active and closing sessions, whatever their state, a run that was working when the editor
   * stopped included: its working turn is the last of the two it keeps, and nothing but `events` and
   * `eventHistoryBytes` changes. Archives and prepared renewal archives are left unopened: one is read only by
   * extracting it whole, and its runs are never written again. For each run that holds more than two turns, the
   * history (with the events it already had) is published before the run without them, so a stop between the two
   * leaves every event in the run, and the history's extra lines are what the run's `eventHistoryBytes` says to cut
   * off before the next append. A run already split, by this upgrade or by a write, holds two turns at most and is
   * left alone, so a second run changes nothing. Each new history and run goes to `temporaryRoot` as it is made
   * (`stage: false`, a check that publishes nothing, stages none), and the updates keep only the digests of what was
   * read, so what a preparation holds follows the one run it splits.
   * @param {{ temporaryRoot: string, stage?: boolean }} options
   * @returns {Promise<{ updates: object[], runs: number, events: number }>}
   */
  async function prepareAgentRunHistoryUpgrade({ temporaryRoot, stage = true }) {
    let runs = 0;
    let events = 0;
    const updates = await prepareSessionStateUpgrade({
      temporaryRoot,
      archives: false,
      async inspectSession(sessionPaths, { checkedPath, inventory, readRegularText }) {
        const changes = [];
        for (const entry of await inventory(sessionPaths.agentRunsRoot)) {
          const runId = entry.name.endsWith(".json") ? entry.name.slice(0, -".json".length) : "";
          if (!isSafeAgentRunId(runId)) continue;
          const runPath = path.join(sessionPaths.agentRunsRoot, entry.name);
          if (!await checkedPath(runPath)) continue;
          const original = await readRegularText(runPath);
          let record;
          try {
            record = JSON.parse(original);
          } catch {
            throw new Error(`Agent run ${runPath} is not valid JSON. Inspect it, or restore it from a backup, before upgrading.`);
          }
          if (!isPlainObject(record) || !Array.isArray(record.events)) continue;
          const historyPath = path.join(sessionPaths.agentRunsRoot, `${runId}${AGENT_RUN_HISTORY_SUFFIX}`);
          // Bytes, so the publisher's before-copy check sees exactly what the file holds.
          const history = await checkedPath(historyPath) ? await readFile(historyPath) : null;
          const split = splitAgentRunHistory(record, history);
          if (!split) continue;
          runs += 1;
          events += record.events.length - split.record.events.length;
          changes.push(
            await stagedUpgradeFile({ temporaryRoot, stage, filePath: historyPath, original: history, contents: split.history }),
            await stagedUpgradeFile({
              temporaryRoot, stage, filePath: runPath, original, contents: `${JSON.stringify(split.record, null, 2)}\n`
            })
          );
        }
        return changes;
      }
    });
    return { updates, runs, events };
  }

  return Object.freeze({ prepareAgentRunHistoryUpgrade });
}

export { createSessionAgentRunHistoryUpgrade };
