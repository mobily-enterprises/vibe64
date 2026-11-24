import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createVibe64SessionStore } from "./sessionStore.js";

/**
 * 20261124-chat-transcript-log: every chat's transcript.json, in every
 * project's active, closing and archived sessions and prepared renewal
 * archives, becomes the transcript.jsonl that later messages are appended to.
 * Core's publisher backs up each original and each replacement before the
 * first change, publishes the new file before removing the old one, and
 * resumes the same prepared bytes after an interruption.
 * @param {{ systemRoot: string, apply: boolean, backupRoot: string, report: (level: string, message: string) => void }} context
 */
async function upgradeChatTranscriptLogs(context) {
  return publishStateUpgradeFiles({
    ...context,
    async prepareUpdates(temporaryRoot) {
      const updates = [];
      for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
        const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
        const prepared = await store.prepareChatTranscriptLogUpgrade({ temporaryRoot, apply: context.apply });
        context.report("info", `${path.basename(projectRuntimeRoot)}: ${prepared.chats} chat(s) to convert to appended transcripts${
          prepared.perTurnLayouts ? `; ${prepared.perTurnLayouts} more in the per-turn layout, which 20261002-session-conversations converts first` : ""}.`);
        updates.push(...prepared.updates);
      }
      return updates;
    }
  });
}

export { upgradeChatTranscriptLogs };
