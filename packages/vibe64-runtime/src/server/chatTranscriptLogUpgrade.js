import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { publishStateUpgradeFiles } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createVibe64SessionStore } from "./sessionStore.js";

/**
 * This run's backup folder and the earlier runs' ones: backupRoot the first
 * time, and after a run that stopped part way a new retry-N folder inside it,
 * so each run prepares from what the chats hold when it starts. A rollout's
 * rollback can start the previous release on a workspace whose apply stopped
 * part way: that release refuses the chats already converted (their
 * transcript.json is the moved note) but may write to the others and start new
 * ones, which the stopped run's manifest would refuse ("differs from both
 * upgrade copies") or leave unconverted after recording the upgrade. Earlier
 * backups are kept.
 * @param {string} backupRoot
 * @returns {Promise<{ current: string, earlier: string[] }>}
 */
async function backupRoots(backupRoot) {
  const earlier = [];
  for (let attempt = 1; ; attempt += 1) {
    const candidate = attempt === 1 ? backupRoot : path.join(backupRoot, `retry-${attempt}`);
    try {
      await lstat(candidate);
    } catch (error) {
      if (error.code === "ENOENT") return { current: candidate, earlier };
      throw error;
    }
    earlier.push(candidate);
  }
}

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
  const { current: backupRoot, earlier } = await backupRoots(context.backupRoot);
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
    async prepareUpdates(temporaryRoot) {
      const updates = [];
      for (const projectRuntimeRoot of await listProjectRuntimeRoots(context.systemRoot)) {
        const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
        const prepared = await store.prepareChatTranscriptLogUpgrade({ temporaryRoot, apply: context.apply, publishedEarlier });
        context.report("info", `${path.basename(projectRuntimeRoot)}: ${prepared.chats} chat(s) to convert to appended transcripts${
          prepared.perTurnLayouts ? `; ${prepared.perTurnLayouts} more in the per-turn layout, which 20261002-session-conversations converts first` : ""}.`);
        updates.push(...prepared.updates);
      }
      return updates;
    }
  });
}

export { upgradeChatTranscriptLogs };
