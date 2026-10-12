import { readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { validateColleagueConversationRecord } from "./conversationRecord.js";

const object = value => value && typeof value === "object" && !Array.isArray(value);
const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
function parse(source) {
  try { const value = JSON.parse(source); if (object(value)) return value; } catch { /* Never report private contents. */ }
  throw new Error("Colleague operation-receipt state is invalid. Inspect it before repairing.");
}
function completedAction(operation) {
  if (typeof operation.arguments !== "string") return false;
  let args;
  try { args = JSON.parse(operation.arguments); } catch { return false; }
  const receipt = operation.result;
  return object(args) && typeof args.actionId === "string" && /^vibe64\.[\w.-]{1,128}$/u.test(args.actionId) &&
    args.version === 1 && object(args.input) && object(receipt) && receipt.ok === true &&
    object(receipt.result) && receipt.result.actionId === args.actionId && receipt.result.version === args.version &&
    object(receipt.result.result) && receipt.result.result.ok === true;
}

/** Retain a completed legacy marker; the unchanged continuity owner proves native history. */
export async function repairColleagueRetiredOperation({ systemRoot, apply, backupRoot, report }) {
  const root = path.join(systemRoot, "colleague");
  await verifyUpgradeParents(systemRoot, path.join(root, "placeholder"));
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\w-]+$/u.test(entry.name)) throw new Error("Unexpected Colleague state entry. Inspect it before repairing.");
    const filePath = path.join(root, entry.name, "conversation.json");
    await verifyUpgradeParents(systemRoot, filePath);
    const original = await readUpgradeFile(filePath);
    if (original === null) continue;
    const saved = parse(original);
    validateColleagueConversationRecord(saved, entry.name);
    records.push({ ownerKey: entry.name, filePath, original, saved });
  }
  const inspect = ({ ownerKey, filePath, original, saved }) => {
    const retired = saved.retiredConversation;
    if (!retired?.operation || retired.assistantSelection?.engineId !== "codex" ||
        saved.conversationMetadata?.runtime || saved.previousConversations?.length || saved.freshOperation) return null;
    const refuse = () => { throw new Error(`${ownerKey}: the retired operation is not an unchanged completed legacy receipt. Inspect original completion and native receipts; no work was replayed.`); };
    const operation = retired.operation;
    if (saved.schemaVersion !== 3 || saved.status !== "ready" || saved.operation ||
        !isDeepStrictEqual(saved.assistantSelection, retired.assistantSelection) ||
        Object.hasOwn(retired, "completedOperationReceipt") ||
        operation.status !== "completed" || !uuid.test(operation.id || "") || operation.toolName !== "assistant_action_execute" ||
        !completedAction(operation) ||
        ["request", "replacement", "rewind", "continuity"].some(key => Object.hasOwn(saved.conversationMetadata || {}, key)) ||
        saved.conversationLog.some(turn => ["running", "working", "inProgress"].includes(turn.metadata?.runtime?.status) ||
          turn.metadata?.applicationTools?.some(call => call.status !== "complete" || !call.result)) ||
        (saved.assignments || []).some(assignment => assignment.turns?.some(turn => ["reserved", "unknown"].includes(turn.status)))) refuse();
    const { operation: completedOperationReceipt, ...retained } = retired;
    const next = { ...saved, retiredConversation: { ...retained, completedOperationReceipt } };
    validateColleagueConversationRecord(next, ownerKey);
    return { filePath, original, contents: JSON.stringify(next) };
  };
  const manifestPath = path.join(backupRoot, "manifest.json");
  await verifyUpgradeParents(systemRoot, manifestPath);
  const manifestSource = await readUpgradeFile(manifestPath);
  if (manifestSource !== null) {
    await publishStateUpgradeFiles({ systemRoot, apply: false, backupRoot, report, prepareUpdates: async () => [] });
    const manifest = parse(manifestSource);
    for (const record of records) {
      if (!manifest.files.some(entry => entry.path === path.relative(systemRoot, record.filePath)) && inspect(record)) {
        throw new Error("A new eligible Colleague owner appeared after preparation. Keep writers stopped and inspect the original backup.");
      }
    }
    for (const entry of manifest.files) {
      const record = records.find(item => path.relative(systemRoot, item.filePath) === entry.path);
      if (!record) throw new Error("A backed-up Colleague owner is missing. Restore its original state before retrying.");
      const original = await readUpgradeFile(path.join(backupRoot, "before", entry.path));
      const saved = parse(original);
      validateColleagueConversationRecord(saved, record.ownerKey);
      const after = parse(await readUpgradeFile(path.join(backupRoot, "after", entry.path)));
      const update = inspect({ ...record, original, saved });
      if (!update || !isDeepStrictEqual(parse(update.contents), after)) {
        throw new Error("The prepared Colleague receipt differs from its original marker. Inspect the verified backup before retrying.");
      }
    }
  }
  await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, prepareUpdates: async () => {
    const updates = [];
    for (const record of records) {
      const update = inspect(record);
      if (!update) continue;
      report("warning", `${record.ownerKey}: retain the completed operation as a receipt with all writers stopped. Native continuity must still pass its original proof; no request or native file changes.`);
      updates.push(update);
    }
    return updates;
  } });
}
