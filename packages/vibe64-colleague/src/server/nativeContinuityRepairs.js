// Stopped-service repairs of what native continuity wrote: the Codex completed-turn policy and the native
// instructions configuration.
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { codexAppServerTurnStateFromAgentRun } from "@jskit-ai/assistant-core/server/codex-turn";
import { upgradeConversationRuntimeState } from "@jskit-ai/assistant-core/server/conversation";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { conversationConfiguration } from "@local/vibe64-terminals/server/conversationConfiguration";
import { validateColleagueConversationRecord } from "./conversationRecord.js";
import { instructions } from "./protocol.js";
import { emptyCodexToolSchema, oldCodexToolSchema, parseUpgradeJson, restoredNative } from "./nativeConversationUpgrade.js";

/** Stopped application metadata only; no native writer, file or goal is changed. */
export async function upgradeColleagueCodexCompletedPolicy({
  systemRoot,
  apply,
  backupRoot,
  report
}) {
  const root = path.join(systemRoot, "colleague");
  await verifyUpgradeParents(systemRoot, path.join(root, "placeholder"));
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\w-]+$/u.test(entry.name)) {
      throw new Error("Unexpected Colleague state entry. Inspect it before upgrading.");
    }
    const filePath = path.join(root, entry.name, "conversation.json");
    await verifyUpgradeParents(systemRoot, filePath);
    const original = await readUpgradeFile(filePath);
    if (original === null) continue;
    const saved = parseUpgradeJson(original, "Colleague history");
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
        !["completed", "complete", "failed", "cancelled", "not-executed"].includes(
          saved.operation.status
        ) || saved.retiredConversation?.operation &&
        !["completed", "complete", "failed", "cancelled", "not-executed"].includes(saved.retiredConversation.operation.status) ||
        runtime.request !== undefined || runtime.replacement !== undefined ||
        binding.observationLoss && binding.observationLoss.stopped !== true ||
        runtime.nativeTurn?.active === true || binding.codexAppServerRun &&
        (codexAppServerTurnStateFromAgentRun(binding.codexAppServerRun).active ||
          binding.codexAppServerRun.pendingUserMessageClientIds?.length) ||
        saved.conversationLog.some(turn => ["running", "working", "inProgress"].includes(turn.metadata?.runtime?.status) ||
          turn.metadata?.applicationTools?.some(call => !call.result || call.status !== "complete")) ||
        (saved.assignments || []).some(assignment => assignment.turns?.some(turn => ["reserved", "unknown"].includes(turn.status)))) {
      refuse(
        "The application has active, pending or unconfirmed work. Resolve its original receipts with the compatible candidate before retrying; nothing will be replayed."
      );
    }
    if (apply && (saved.schemaVersion !== 3 || checked.changed)) {
      refuse("Complete earlier numbered Colleague upgrades before retiring this tool policy.");
    }
    if (checked.changed) {
      report("warning", `${ownerKey}: earlier native delivery upgrades must complete before this tool-policy transition.`);
      return null;
    }
    const result = upgradeConversationRuntimeState({
      metadata: saved.conversationMetadata,
      conversationLog: saved.conversationLog,
      retirement: {
        operationId,
        successorSegmentId,
        expectedSegmentId: runtime.segmentId,
        expectedThreadId: binding.threadId,
        expectedToolSchemaIdentity: oldCodexToolSchema,
        workdir: binding.workdir,
        configRoot: binding.configRoot
      }
    });
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
    const manifest = parseUpgradeJson(manifestSource, "Codex tool-policy backup manifest");
    for (const record of records) {
      if (!manifest.files.some(entry => entry.path === path.relative(systemRoot, record.filePath)) && inspect(record)) {
        throw new Error(
          "A new eligible Colleague owner appeared after preparation. Keep product writers stopped and inspect the original backup before retrying."
        );
      }
    }
    for (const entry of manifest.files) {
      const record = records.find(item => path.relative(systemRoot, item.filePath) === entry.path);
      if (!record) throw new Error("A backed-up Colleague owner is missing. Restore its original state before retrying.");
      const original = await readUpgradeFile(path.join(backupRoot, "before", entry.path));
      const saved = parseUpgradeJson(original, "Backed-up Colleague history");
      const after = parseUpgradeJson(await readUpgradeFile(path.join(backupRoot, "after", entry.path)), "Prepared Colleague history");
      validateColleagueConversationRecord(saved, record.ownerKey);
      validateColleagueConversationRecord(after, record.ownerKey);
      const runtime = after.conversationMetadata?.runtime;
      const retired = runtime?.predecessors?.at(-1);
      const update = inspect({
        ...record,
        saved,
        original,
        operationId: retired?.replacement?.operationId,
        successorSegmentId: runtime?.segmentId
      });
      if (!update || !isDeepStrictEqual(parseUpgradeJson(update.contents, "Reinspected Colleague history"), after)) {
        throw new Error(
          "The prepared Codex transition differs from its original binding or history. Inspect the verified backup before retrying."
        );
      }
    }
  }
  await publishStateUpgradeFiles({
    systemRoot,
    apply,
    backupRoot,
    report,
    prepareUpdates: async () => {
      const updates = [];
      for (const record of records) {
        const update = inspect(record);
        if (!update) continue;
        report(
          "warning",
          `${record.ownerKey}: retire only the known old Codex tool binding and retain its full history. Keep application, watch and independent product writers stopped through publication; native files and goals are untouched. The next explicit request validates the current account and uses a new native binding without replaying old work.`
        );
        updates.push(update);
      }
      return updates;
    }
  });
}


/** Repair only the known empty configuration written by native continuity. */
export async function upgradeColleagueNativeInstructions({
  systemRoot,
  apply,
  backupRoot,
  report
}) {
  const root = path.join(systemRoot, "colleague");
  await verifyUpgradeParents(systemRoot, path.join(root, "placeholder"));
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  const records = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\w-]+$/u.test(entry.name)) {
      throw new Error("Unexpected Colleague state entry. Inspect it before upgrading.");
    }
    const filePath = path.join(root, entry.name, "conversation.json");
    await verifyUpgradeParents(systemRoot, filePath);
    const original = await readUpgradeFile(filePath);
    if (original === null) continue;
    const saved = parseUpgradeJson(original, "Colleague history");
    validateColleagueConversationRecord(saved, entry.name);
    records.push({ ownerKey: entry.name, filePath, original, saved });
  }
  const inspect = ({ ownerKey, filePath, original, saved }) => {
    const runtime = saved.conversationMetadata?.runtime;
    if (runtime?.configuration?.systemPrompt !== "") return null;
    const refuse = message => { throw new Error(`${ownerKey}: ${message} No request, binding or history was changed.`); };
    const retired = saved.retiredConversation;
    const binding = runtime.binding;
    const nativeId = runtime.engine === "codex" ? binding?.threadId
      : runtime.engine === "claude" ? binding?.conversationId : binding?.sessionId;
    if (saved.schemaVersion !== 3 || !restoredNative(retired?.assistantSelection) || !retired.runId ||
        !isDeepStrictEqual(saved.assistantSelection, retired.assistantSelection) || runtime.version !== 3 ||
        runtime.engine !== saved.assistantSelection.engineId || runtime.lastEngine !== runtime.engine ||
        nativeId !== retired.conversationId || !nativeId || runtime.predecessors?.length !== 0 ||
        saved.previousConversations?.length || saved.freshOperation || binding.executionId !== "" ||
        !isDeepStrictEqual(runtime.configuration, conversationConfiguration(saved.assistantSelection, "").configuration)) {
      refuse(
        "The empty configuration is not the known unchanged imported native binding. Inspect its original conversion before retrying."
      );
    }
    if (saved.status === "working" || saved.operation &&
        !["completed", "complete", "failed", "cancelled", "not-executed"].includes(saved.operation.status) || retired.operation ||
        ["request", "replacement", "rewind", "continuity"].some(key => Object.hasOwn(runtime, key)) ||
        runtime.nativeTurn?.active === true || binding.observationLoss && binding.observationLoss.stopped !== true ||
        binding.codexAppServerRun && (codexAppServerTurnStateFromAgentRun(binding.codexAppServerRun).active ||
          binding.codexAppServerRun.pendingUserMessageClientIds?.length) ||
        saved.conversationLog.some(turn => ["running", "working", "inProgress"].includes(turn.metadata?.runtime?.status) ||
          turn.metadata?.applicationTools?.some(call => !call.result || call.status !== "complete")) ||
        (saved.assignments || []).some(assignment => assignment.turns?.some(turn => ["reserved", "unknown"].includes(turn.status)))) {
      refuse(
        "The application has active, pending or unconfirmed work. Resolve its original receipts and stop all writers before retrying; nothing will be replayed."
      );
    }
    const checked = upgradeConversationRuntimeState({ metadata: saved.conversationMetadata, conversationLog: saved.conversationLog });
    if (checked.changed) refuse("Complete earlier numbered runtime upgrades before repairing instructions.");
    const next = {
      ...saved,
      conversationMetadata: {
        ...saved.conversationMetadata,
        runtime: { ...runtime, configuration: { ...runtime.configuration, systemPrompt: instructions } }
      }
    };
    return { filePath, original, contents: JSON.stringify(next) };
  };
  await verifyUpgradeParents(systemRoot, path.join(backupRoot, "manifest.json"));
  const manifestSource = await readUpgradeFile(path.join(backupRoot, "manifest.json"));
  if (manifestSource !== null) {
    await publishStateUpgradeFiles({ systemRoot, backupRoot, apply: false, report, prepareUpdates: async () => [] });
    const manifest = parseUpgradeJson(manifestSource, "Colleague instructions backup manifest");
    for (const record of records) {
      if (!manifest.files.some(entry => entry.path === path.relative(systemRoot, record.filePath)) && inspect(record)) {
        throw new Error(
          "A new eligible Colleague owner appeared after preparation. Keep writers stopped and inspect the original backup before retrying."
        );
      }
    }
    for (const entry of manifest.files) {
      const record = records.find(item => path.relative(systemRoot, item.filePath) === entry.path);
      if (!record) throw new Error("A backed-up Colleague owner is missing. Restore its original state before retrying.");
      const original = await readUpgradeFile(path.join(backupRoot, "before", entry.path));
      const saved = parseUpgradeJson(original, "Backed-up Colleague history");
      const after = parseUpgradeJson(await readUpgradeFile(path.join(backupRoot, "after", entry.path)), "Prepared Colleague history");
      validateColleagueConversationRecord(saved, record.ownerKey);
      validateColleagueConversationRecord(after, record.ownerKey);
      const update = inspect({ ...record, original, saved });
      if (!update || !isDeepStrictEqual(parseUpgradeJson(update.contents, "Reinspected Colleague history"), after)) {
        throw new Error(
          "The prepared Colleague instructions differ from the original binding or history. Inspect the verified backup before retrying."
        );
      }
    }
  }
  await publishStateUpgradeFiles({
    systemRoot,
    apply,
    backupRoot,
    report,
    prepareUpdates: async () => {
      const updates = [];
      for (const record of records) {
        const update = inspect(record);
        if (!update) continue;
        report(
          "warning",
          `${record.ownerKey}: restore only the missing Colleague instructions with all product writers stopped. The failed request, native binding, account and full history remain unchanged; no request is sent or retried.`
        );
        updates.push(update);
      }
      return updates;
    }
  });
}
