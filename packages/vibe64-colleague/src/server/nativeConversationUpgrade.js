import { randomUUID } from "node:crypto";
import { lstat, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { codexAppServerTurnStateFromAgentRun } from "@jskit-ai/assistant-core/server/codex-turn";
import { conversationHistoryVersions, upgradeConversationRuntimeState } from "@jskit-ai/assistant-core/server/conversation";
import { claudeHistoryPath, listClaudeConversationStorage, readClaudeHistory } from "@jskit-ai/assistant-core/server/claude-history";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { conversationConfiguration } from "@local/vibe64-terminals/server/conversationConfiguration";
import { validateColleagueConversationRecord } from "./conversationRecord.js";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const nativeClaude = selection => selection?.engineId === "claude" && selection.modelProviderId === "anthropic";
function parse(source, label) {
  try {
    const value = JSON.parse(source);
    if (value && typeof value === "object" && !Array.isArray(value)) return value;
  } catch { /* Never report private contents. */ }
  throw new Error(`${label} is invalid. Inspect it before upgrading.`);
}

/** Stopped-service conversion of confirmed original native bindings, never requests. */
export async function upgradeColleagueNativeContinuity({ systemRoot, apply, backupRoot, report, env = process.env }) {
  const root = path.join(systemRoot, "colleague");
  await verifyUpgradeParents(systemRoot, path.join(root, "placeholder"));
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const records = [];
  const claims = new Map();
  const claim = (id, owner) => {
    if (!id) return;
    const owners = claims.get(id) || new Set();
    owners.add(owner);
    claims.set(id, owners);
  };
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\w-]+$/u.test(entry.name)) throw new Error("Unexpected Colleague state entry. Inspect it before upgrading.");
    const filePath = path.join(root, entry.name, "conversation.json");
    await verifyUpgradeParents(systemRoot, filePath);
    const original = await readUpgradeFile(filePath);
    if (original === null) continue;
    const saved = parse(original, "Colleague history");
    validateColleagueConversationRecord(saved, entry.name);
    records.push({ ownerKey: entry.name, filePath, original, saved });
    for (const chat of [saved, ...(saved.previousConversations || [])]) {
      const owner = `${entry.name}:${chat.scopeId}`;
      const retired = chat.schemaVersion === 1 ? chat : chat.retiredConversation;
      if (retired?.conversationId && !nativeClaude(retired.assistantSelection)) {
        report("warning", `${entry.name}: this older provider binding is outside the native Claude correction; its retired identity and written history remain unchanged.`);
      }
      if (nativeClaude(retired?.assistantSelection)) claim(retired.conversationId, owner);
      const runtime = chat.conversationMetadata?.runtime;
      if (runtime) {
        const checked = upgradeConversationRuntimeState({ metadata: chat.conversationMetadata, conversationLog: chat.conversationLog });
        if (apply && checked.changed) throw new Error("Complete the earlier native delivery upgrade before restoring Colleague continuity.");
      }
      for (const segment of [runtime, ...(runtime?.predecessors || []), runtime?.replacement]) {
        if (segment?.engine === "claude") claim(segment.binding?.conversationId, owner);
      }
    }
  }

  const inspect = async ({ ownerKey, filePath, original, saved, segmentId = randomUUID() }) => {
    const retired = saved.schemaVersion === 1 ? saved : saved.retiredConversation;
    if (!retired || !nativeClaude(retired.assistantSelection)) return null;
    // Current common owners and explicit fresh-chat transitions are not legacy imports.
    if (saved.conversationMetadata?.runtime || saved.previousConversations?.length || saved.freshOperation) return null;
    const refuse = message => { throw new Error(`${ownerKey}: ${message} No native work or history was changed.`); };
    if (!uuid.test(retired.conversationId || "") || !retired.runId ||
        !isDeepStrictEqual(saved.assistantSelection, retired.assistantSelection) ||
        saved.status === "working" || saved.operation || retired.operation ||
        ["request", "replacement", "rewind", "continuity"].some(key => Object.hasOwn(saved.conversationMetadata || {}, key))) {
      refuse("The retired Claude binding has changed selection or unfinished/unsupported state. Inspect its original receipts before retrying.");
    }
    if (claims.get(retired.conversationId)?.size !== 1) refuse("The native Claude UUID is claimed by another Colleague scope. Resolve ownership before retrying.");
    const scopeWorkdir = path.join(root, ownerKey, saved.scopeId);
    await verifyUpgradeParents(systemRoot, path.join(scopeWorkdir, "placeholder"));
    if (await realpath(scopeWorkdir) !== scopeWorkdir) refuse("The original private scope is not canonical.");
    const receiptPath = path.join(scopeWorkdir, "claude-conversations", saved.scopeId, `${retired.conversationId}.json`);
    await verifyUpgradeParents(systemRoot, receiptPath);
    const receiptBytes = await readUpgradeFile(receiptPath);
    if (receiptBytes === null) refuse("The original scoped Claude receipt is missing. Restore it before retrying.");
    const receipt = parse(receiptBytes, "Scoped Claude receipt");
    if (receipt.schemaVersion !== 1 || receipt.persistent !== true || receipt.main !== false ||
        receipt.sent !== true || receipt.state !== "completed" || receipt.executionId !== "" ||
        receipt.turnId !== retired.runId || receipt.lastMessageId !== retired.runId ||
        !/^sha256:[a-f0-9]{64}$/u.test(receipt.accountIdentity || "") ||
        Object.keys(receipt.accountIdentities || {}).length !== 1 ||
        receipt.accountIdentities?.anthropic !== receipt.accountIdentity) {
      refuse("The original scoped receipt does not prove a stopped completed native-only turn and exact account pin. Inspect it before retrying.");
    }
    const lastTurn = saved.conversationLog.at(-1);
    if (lastTurn?.turnId !== retired.currentTurnId || !lastTurn.messages.some(message => message.role === "assistant" && message.text.trim())) {
      refuse("The last written product turn does not match the completed native receipt.");
    }
    const workdir = await realpath(env.HOME || homedir());
    const configRoot = path.resolve(scopeWorkdir, env.CLAUDE_CONFIG_DIR || path.join(env.HOME || homedir(), ".claude"));
    if (receipt.nativeWorkdir !== workdir) refuse("The receipt belongs to another credential home. Restore the original daemon configuration.");
    const binding = { conversationId: retired.conversationId, workdir, scopeWorkdir, configRoot,
      executionId: "", sent: true, accountIdentity: receipt.accountIdentity.slice("sha256:".length) };
    const inventory = await listClaudeConversationStorage({ configRoot, binding });
    if (!inventory.some(item => item.conversationId === binding.conversationId)) refuse("The original native history is missing or not a regular file.");
    const nativeFile = await claudeHistoryPath(binding);
    if (!nativeFile) refuse("The original active native transcript is missing.");
    await verifyUpgradeParents(configRoot, nativeFile.path);
    const before = await lstat(nativeFile.path);
    if (!before.isFile()) refuse("The original active native transcript must be a regular file.");
    const history = await readClaudeHistory({ ...binding, allowIncompleteTail: false });
    if (!history.exists || history.userIds.at(-1) !== receipt.lastMessageId || history.goal?.status === "active" ||
        !history.messages.some(message => message.role === "assistant" && message.userId === receipt.lastMessageId && message.text.trim())) {
      refuse("Native history has a newer/unconfirmed request, active goal or no final answer for the exact stopped turn. Inspect it before retrying.");
    }
    const configuration = conversationConfiguration(saved.assistantSelection, "").configuration;
    const next = { ...saved, conversationMetadata: { ...saved.conversationMetadata, runtime: {
      version: 3, segmentId, engine: "claude", configuration, predecessors: [],
      seen: conversationHistoryVersions(saved.conversationLog), lastEngine: "claude", binding
    } } };
    upgradeConversationRuntimeState({ metadata: next.conversationMetadata, conversationLog: next.conversationLog });
    return { filePath, original, contents: JSON.stringify(next),
      async verify() {
        const after = await lstat(nativeFile.path);
        if (!after.isFile() || ["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key => before[key] !== after[key]) ||
            await readUpgradeFile(receiptPath) !== receiptBytes) refuse("Native history or its receipt changed during inspection. Stop all writers before retrying.");
      } };
  };

  // Existing publisher verifies immutable before/after backups and retries them.
  // Reinspect those originals on retry rather than treating the new common binding
  // as a reason to skip its native evidence.
  await verifyUpgradeParents(systemRoot, path.join(backupRoot, "manifest.json"));
  const manifestSource = await readUpgradeFile(path.join(backupRoot, "manifest.json"));
  let prepared = null;
  if (manifestSource !== null) {
    await publishStateUpgradeFiles({ systemRoot, backupRoot, apply: false, report, prepareUpdates: async () => [] });
    const manifest = parse(manifestSource, "Native-continuity backup manifest");
    prepared = [];
    for (const entry of manifest.files) {
      const filePath = path.join(systemRoot, entry.path);
      const record = records.find(item => item.filePath === filePath);
      if (!record) throw new Error("A backed-up Colleague owner is missing. Restore its original state before retrying.");
      const original = await readUpgradeFile(path.join(backupRoot, "before", entry.path));
      const saved = parse(original, "Backed-up Colleague history");
      validateColleagueConversationRecord(saved, record.ownerKey);
      const after = parse(await readUpgradeFile(path.join(backupRoot, "after", entry.path)), "Prepared Colleague history");
      validateColleagueConversationRecord(after, record.ownerKey);
      upgradeConversationRuntimeState({ metadata: after.conversationMetadata, conversationLog: after.conversationLog });
      const update = await inspect({ ...record, saved, original, segmentId: after.conversationMetadata.runtime.segmentId });
      if (!update) throw new Error("The native-continuity backup is not an eligible original conversation. Inspect it before retrying.");
      if (!isDeepStrictEqual(parse(update.contents, "Reinspected Colleague history"), after)) {
        throw new Error("The prepared native binding differs from its current original evidence. Restore the original daemon configuration and receipts before retrying.");
      }
      prepared.push(update);
    }
  }
  if (manifestSource !== null) for (const update of prepared) await update.verify();
  await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, prepareUpdates: async () => {
    prepared = [];
    for (const record of records) {
      const update = await inspect(record);
      if (!update) continue;
      if (apply && record.saved.schemaVersion !== 3) throw new Error("Complete earlier numbered Colleague upgrades before restoring native continuity.");
      report("warning", `${record.ownerKey}: retain the exact original Claude UUID and account pin; no old request will be replayed. Stop all services and native writers before applying. Fresh account validation still runs before subsequent native work.`);
      prepared.push(update);
    }
    for (const update of prepared) await update.verify();
    return prepared;
  } });
}

// Original shipped search/contract/execute descriptors; native thread tool shape
// is immutable. Only that exact historical policy has this bounded correction.
const oldCodexToolSchema = "565d936fcb00d90ddef65fa80b1db8ed6d3bb4faec815cf15dc8723e4d259a16";
const emptyCodexToolSchema = "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

/** Stopped application metadata only; no native writer, file or goal is changed. */
export async function upgradeColleagueCodexCompletedPolicy({ systemRoot, apply, backupRoot, report }) {
  const root = path.join(systemRoot, "colleague");
  await verifyUpgradeParents(systemRoot, path.join(root, "placeholder"));
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\w-]+$/u.test(entry.name)) throw new Error("Unexpected Colleague state entry. Inspect it before upgrading.");
    const filePath = path.join(root, entry.name, "conversation.json");
    await verifyUpgradeParents(systemRoot, filePath);
    const original = await readUpgradeFile(filePath);
    if (original === null) continue;
    const saved = parse(original, "Colleague history");
    validateColleagueConversationRecord(saved, entry.name);
    records.push({ ownerKey: entry.name, filePath, original, saved });
  }
  const inspect = ({ ownerKey, filePath, original, saved, operationId = randomUUID(), successorSegmentId = randomUUID() }) => {
    const checked = upgradeConversationRuntimeState({ metadata: saved.conversationMetadata || {}, conversationLog: saved.conversationLog });
    const runtime = checked.metadata.runtime;
    if (runtime?.engine !== "codex" || !runtime.binding.threadId) return null;
    const refuse = message => { throw new Error(`${ownerKey}: ${message} No native work or history was changed.`); };
    const binding = runtime.binding;
    if (binding.toolSchemaIdentity === emptyCodexToolSchema) return null;
    if (binding.toolSchemaIdentity !== oldCodexToolSchema) {
      refuse("This retained Codex tool policy is missing or unknown. Inspect its original binding before retrying.");
    }
    const scopeWorkdir = path.join(root, ownerKey, saved.scopeId);
    if (binding.workdir !== scopeWorkdir || typeof binding.configRoot !== "string" || !path.isAbsolute(binding.configRoot)) {
      refuse("The saved Codex binding does not match its original private application scope or configuration path.");
    }
    // These are saved application receipts, not a claim about offline native
    // process/goal state. The caller must keep all product writers stopped.
    if (saved.status === "working" || saved.operation &&
        !["completed", "complete", "failed", "cancelled", "not-executed"].includes(saved.operation.status) || saved.retiredConversation?.operation &&
        !["completed", "complete", "failed", "cancelled", "not-executed"].includes(saved.retiredConversation.operation.status) ||
        runtime.request !== undefined || runtime.replacement !== undefined ||
        binding.observationLoss && binding.observationLoss.stopped !== true ||
        runtime.nativeTurn?.active === true || binding.codexAppServerRun &&
        (codexAppServerTurnStateFromAgentRun(binding.codexAppServerRun).active || binding.codexAppServerRun.pendingUserMessageClientIds?.length) ||
        saved.conversationLog.some(turn => ["running", "working", "inProgress"].includes(turn.metadata?.runtime?.status) ||
          turn.metadata?.applicationTools?.some(call => !call.result || call.status !== "complete")) ||
        (saved.assignments || []).some(assignment => assignment.turns?.some(turn => ["reserved", "unknown"].includes(turn.status)))) {
      refuse("The application has active, pending or unconfirmed work. Resolve its original receipts with the compatible candidate before retrying; nothing will be replayed.");
    }
    if (apply && (saved.schemaVersion !== 3 || checked.changed)) {
      refuse("Complete earlier numbered Colleague upgrades before retiring this tool policy.");
    }
    if (checked.changed) {
      report("warning", `${ownerKey}: earlier native delivery upgrades must complete before this tool-policy transition.`);
      return null;
    }
    const result = upgradeConversationRuntimeState({ metadata: saved.conversationMetadata, conversationLog: saved.conversationLog,
      retirement: { operationId, successorSegmentId, expectedSegmentId: runtime.segmentId, expectedThreadId: binding.threadId,
        expectedToolSchemaIdentity: oldCodexToolSchema, workdir: binding.workdir, configRoot: binding.configRoot } });
    const next = { ...saved, conversationMetadata: result.metadata };
    validateColleagueConversationRecord(next, ownerKey);
    return { filePath, original, contents: JSON.stringify(next) };
  };

  // The existing publisher validates both saved sides before retry. Recompute
  // the exact metadata transition from BEFORE with the immutable prepared IDs;
  // an already inert AFTER never bypasses eligibility or backup validation.
  const manifestPath = path.join(backupRoot, "manifest.json");
  await verifyUpgradeParents(systemRoot, manifestPath);
  const manifestSource = await readUpgradeFile(manifestPath);
  if (manifestSource !== null) {
    await publishStateUpgradeFiles({ systemRoot, backupRoot, apply: false, report, prepareUpdates: async () => [] });
    const manifest = parse(manifestSource, "Codex tool-policy backup manifest");
    for (const record of records) {
      if (!manifest.files.some(entry => entry.path === path.relative(systemRoot, record.filePath)) && inspect(record)) {
        throw new Error("A new eligible Colleague owner appeared after preparation. Keep product writers stopped and inspect the original backup before retrying.");
      }
    }
    for (const entry of manifest.files) {
      const record = records.find(item => path.relative(systemRoot, item.filePath) === entry.path);
      if (!record) throw new Error("A backed-up Colleague owner is missing. Restore its original state before retrying.");
      const original = await readUpgradeFile(path.join(backupRoot, "before", entry.path));
      const saved = parse(original, "Backed-up Colleague history");
      const after = parse(await readUpgradeFile(path.join(backupRoot, "after", entry.path)), "Prepared Colleague history");
      validateColleagueConversationRecord(saved, record.ownerKey);
      validateColleagueConversationRecord(after, record.ownerKey);
      const runtime = after.conversationMetadata?.runtime;
      const retired = runtime?.predecessors?.at(-1);
      const update = inspect({ ...record, saved, original, operationId: retired?.replacement?.operationId,
        successorSegmentId: runtime?.segmentId });
      if (!update || !isDeepStrictEqual(parse(update.contents, "Reinspected Colleague history"), after)) {
        throw new Error("The prepared Codex transition differs from its original binding or history. Inspect the verified backup before retrying.");
      }
    }
  }
  await publishStateUpgradeFiles({ systemRoot, apply, backupRoot, report, prepareUpdates: async () => {
    const updates = [];
    for (const record of records) {
      const update = inspect(record);
      if (!update) continue;
      report("warning", `${record.ownerKey}: retire only the known old Codex tool binding and retain its full history. Keep application, watch and independent product writers stopped through publication; native files and goals are untouched. The next explicit request validates the current account and uses a new native binding without replaying old work.`);
      updates.push(update);
    }
    return updates;
  } });
}
