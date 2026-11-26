import { readFile } from "node:fs/promises";
import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { publishStateUpgradeFiles, stateUpgradeRunBackupRoots } from "@local/vibe64-core/server/stateUpgradeFiles";
import { projectSessionRoots } from "./projectSessionRoots.js";
import { createVibe64SessionStore } from "./sessionStore.js";

/**
 * 20261124-chat-transcript-log: every chat's transcript.json, in every
 * project's active, closing and archived sessions and prepared renewal
 * archives, becomes the transcript.jsonl that later messages are appended to,
 * and the old file the note the previous release refuses. Core's publisher
 * backs up each original and each replacement before the first change and
 * publishes the new file before the note.
 * @param {{ systemRoot: string, apply: boolean, backupRoot: string, report: (level: string, message: string) => void }} context
 */
async function upgradeChatTranscriptLogs(context) {
  // A rollout's rollback can start the previous release on a workspace whose apply stopped part way: that release
  // refuses the chats already converted (their transcript.json is the moved note) but may write to the others and
  // start new ones, which the stopped run's manifest would refuse ("differs from both upgrade copies") or leave
  // unconverted after recording the upgrade. So each run prepares again from what the chats hold.
  const { current: backupRoot, earlier } = await stateUpgradeRunBackupRoots(context.backupRoot);
  if (earlier.length) {
    context.report("info", `An earlier run stopped part way: converting what the chats hold now, backed up in ${path.basename(backupRoot)}; the earlier backup is kept.`);
  }
  // Whether a file holds exactly what an earlier run of this upgrade published there.
  async function publishedEarlier(filePath, contents) {
    const relative = path.relative(context.systemRoot, filePath);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return false;
    for (const root of earlier) {
      const copy = await readFile(path.join(root, "after", relative), "utf8").catch((error) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (copy === contents) return true;
    }
    return false;
  }
  return publishStateUpgradeFiles({
    ...context,
    backupRoot,
    inputs: () => projectSessionRoots(context.systemRoot),
    async prepareUpdates(temporaryRoot, { stage }) {
      const updates = [];
      let perTurnLayouts = 0;
      for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
        const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
        const prepared = await store.prepareChatTranscriptLogUpgrade({ temporaryRoot, apply: context.apply, stage, publishedEarlier });
        context.report("info", `${path.basename(projectRuntimeRoot)}: ${prepared.chats} chat(s) to convert to appended transcripts${
          prepared.perTurnLayouts ? `; ${prepared.perTurnLayouts} more in the per-turn layout, which 20261002-session-conversations converts first` : ""}.`);
        updates.push(...prepared.updates);
        perTurnLayouts += prepared.perTurnLayouts;
      }
      // A check accepts a chat in the per-turn layout, which an apply refuses: such a check's preparation is not the apply's.
      return { updates, reusable: perTurnLayouts === 0 };
    }
  });
}

export { upgradeChatTranscriptLogs };
