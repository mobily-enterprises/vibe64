import { randomUUID } from "node:crypto";
import { lstat, readdir } from "node:fs/promises";
import path from "node:path";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { validateColleagueConversationRecord } from "./conversationRecord.js";

const object = value => value && typeof value === "object" && !Array.isArray(value);
const retiredModel = selection => selection?.engineId === "opencode" &&
  selection.modelProviderId === "opencode" && selection.modelId === "big-pickle";

function parse(source) {
  try { const value = JSON.parse(source); if (object(value)) return value; } catch { /* Never report private contents. */ }
  throw new Error("Colleague conversation state is invalid. Inspect it before upgrading.");
}

/**
 * 20261022: Vibe64 no longer offers OpenCode Zen's free Big Pickle model.
 * A Colleague chat bound to it cannot change model offline, so it is kept as
 * a previous conversation, exactly as Start fresh keeps it, and the new chat
 * has no model: the next send chooses one from the person's connected AI or
 * asks them to set one up. Offline, with all writers stopped; backed-up publish.
 */
export async function retireColleagueFreeModel({ systemRoot, apply, backupRoot, report }) {
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
      if (!retiredModel(saved.assistantSelection)) continue;
      if (saved.schemaVersion !== 3) {
        if (apply) throw new Error(`${entry.name}: upgrade this Colleague history to the current format first.`);
        report("info", `${entry.name}: earlier upgrades will prepare this Colleague history first; apply checks it again.`);
        continue;
      }
      const scopeId = `colleague_${randomUUID().replaceAll("-", "")}`;
      const archivedAt = new Date().toISOString();
      const old = { scopeId: saved.scopeId, runtimeId: saved.runtimeId, assistantSelection: saved.assistantSelection,
        status: saved.status === "working" ? "interrupted" : saved.status, error: saved.error,
        conversationLog: saved.conversationLog,
        ...(saved.conversationMetadata ? { conversationMetadata: saved.conversationMetadata } : {}),
        ...(saved.retiredConversation ? { retiredConversation: saved.retiredConversation } : {}),
        archivedAt, unconfirmedMessages: [],
        freshOperation: { operationId: `free-model-retirement-${randomUUID()}`, conversationId: scopeId } };
      const { retiredConversation: _retired, ...current } = saved;
      const next = { ...current, runtimeId: `${entry.name}:${scopeId}`, scopeId, assistantSelection: null,
        status: "ready", error: "", conversationLog: [], conversationMetadata: {},
        previousConversations: [...saved.previousConversations, old] };
      validateColleagueConversationRecord(next, entry.name);
      report("info", `${entry.name}: the chat on the retired free model is kept as a previous conversation; the next message chooses a connected AI.`);
      updates.push({ filePath, original, contents: JSON.stringify(next) });
    }
    return updates;
  } });
}
