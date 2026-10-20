import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { validateColleagueConversationRecord } from "./conversationRecord.js";

const LEARNING_WATCH_SOURCE = "learning-task";
const object = value => value && typeof value === "object" && !Array.isArray(value);

function parse(source) {
  try { const value = JSON.parse(source); if (object(value)) return value; } catch { /* Never report private contents. */ }
  throw new Error("Colleague conversation state is invalid. Inspect it before upgrading.");
}

/**
 * Learning v2 (20261021): Colleague no longer watches learning tasks. Retire
 * every learning-task watch and its queued observations, keeping written
 * conversation history. Offline, with all writers stopped; backed-up publish.
 */
export async function retireColleagueLearningWatches({ systemRoot, apply, backupRoot, report }) {
  const root = path.join(systemRoot, "colleague");
  await verifyUpgradeParents(systemRoot, path.join(root, "placeholder"));
  let entries;
  try {
    if (!(await lstat(root)).isDirectory()) throw new Error("Colleague state must be a regular directory.");
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) { if (error.code === "ENOENT") entries = []; else throw error; }
  await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, prepareUpdates: async () => {
    const updates = [];
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || !/^[\w-]+$/u.test(entry.name)) throw new Error("Unexpected Colleague state entry. Inspect it before upgrading.");
      const filePath = path.join(root, entry.name, "conversation.json");
      await verifyUpgradeParents(systemRoot, filePath);
      const original = await readUpgradeFile(filePath);
      if (original === null) continue;
      const saved = parse(original);
      validateColleagueConversationRecord(saved, entry.name);
      const retired = new Set((saved.watches || []).filter(watch => watch?.source === LEARNING_WATCH_SOURCE).map(watch => watch.watchId));
      if (!retired.size) continue;
      const next = { ...saved, watches: saved.watches.filter(watch => !retired.has(watch.watchId)),
        ...(Array.isArray(saved.observations) ? { observations: saved.observations.filter(item => !retired.has(item.watchId)) } : {}) };
      validateColleagueConversationRecord(next, entry.name);
      report("info", `${entry.name}: retire ${retired.size} learning-task watch(es); conversation history is kept.`);
      updates.push({ filePath, original, contents: JSON.stringify(next) });
    }
    return updates;
  } });
}
