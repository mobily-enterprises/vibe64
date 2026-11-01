import crypto from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { isMissingPathError } from "@local/vibe64-core/server/core";
import { currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";

import {
  sourceEditorAgentOperationOptions,
  sourceEditorExecutionProfileRequest,
  sourceEditorExecutionProfileSnapshot
} from "./explanationProfile.js";
import { positiveInteger, SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION, sourceEditorExplanationMessageId } from "./explanationText.js";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeSourceEditorRelativePath, sourceEditorError, sourceEditorLanguageForPath } from "./sourceFiles.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {Map<string, object>} SourceEditorExplanationChats - each explanation in memory, by project, session and explanation id */

// Saved source explanations and their cleanup ledger: the record each
// explanation keeps, normalization, and the helper threads still to delete.
const SOURCE_EDITOR_EXPLANATION_CLEANUP_FILE = "source-editor-explanation-cleanup.json";

const SOURCE_EDITOR_EXPLANATION_CLEANUP_MAX_AGE_MS = 30 * 60 * 1000;

const sourceEditorExplanationCleanupQueues = new Map();

function normalizeSourceEditorExplanationId(value = "") {
  const id = toText(value);
  if (!/^[a-z0-9_-]+$/u.test(id)) {
    throw sourceEditorError("Invalid source explanation id.", "vibe64_source_explanation_id_invalid");
  }
  return id;
}

function sourceEditorExplanationMemoryKey(context = {}, explanationId = "") {
  return `${currentProjectScopeKey()}\0${toText(context.sessionId)}:${normalizeSourceEditorExplanationId(explanationId)}`;
}

function sourceEditorExplanationCleanupPath(context = {}) {
  return path.join(context.sourceEditorTempRoot, SOURCE_EDITOR_EXPLANATION_CLEANUP_FILE);
}

function normalizeSourceEditorCleanupRecord(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  let id = "";
  try {
    id = normalizeSourceEditorExplanationId(source.id);
  } catch {
    return null;
  }
  const agentThreadId = toText(source.agentThreadId);
  if (!agentThreadId && !source.helper) {
    return null;
  }
  return {
    ...(source.helper ? { helper: structuredClone(source.helper) } : {}),
    agentThreadId,
    agentTurnId: toText(source.agentTurnId),
    createdAt: toText(source.createdAt),
    id,
    originId: toText(source.originId),
    sessionId: toText(source.sessionId),
    sourcePath: toText(source.sourcePath),
    status: toText(source.status || "ready"),
    updatedAt: toText(source.updatedAt)
  };
}

function sourceEditorCleanupRecordFromExplanation(context = {}, explanation = {}) {
  const record = explanation;
  return normalizeSourceEditorCleanupRecord({
    ...(context.assistantHelper && context.explanationId === record.id ? { helper: context.assistantHelper } : {}),
    agentThreadId: record.agentThreadId,
    agentTurnId: record.agentTurnId,
    createdAt: record.createdAt,
    id: record.id,
    originId: record.ownerOriginId,
    sessionId: context.sessionId,
    sourcePath: record.sourceRange?.path,
    status: record.status,
    updatedAt: record.updatedAt
  });
}

function sourceEditorCleanupLedgerPayload(records = []) {
  const byId = new Map();
  for (const record of records) {
    const normalized = normalizeSourceEditorCleanupRecord(record);
    if (normalized) {
      byId.set(normalized.id, normalized);
    }
  }
  return {
    records: [...byId.values()].sort((left, right) => left.id.localeCompare(right.id)),
    version: 1
  };
}

async function readSourceEditorExplanationCleanupRecords(context = {}) {
  const ledgerPath = sourceEditorExplanationCleanupPath(context);
  if (!ledgerPath) {
    return [];
  }
  try {
    const text = await readFile(ledgerPath, "utf8");
    let parsed;
    try { parsed = JSON.parse(text); }
    catch {
      throw sourceEditorError(`This session's source explanation helper ledger (${SOURCE_EDITOR_EXPLANATION_CLEANUP_FILE}) is unreadable; it was left unchanged.`,
        "vibe64_source_explanation_ledger_invalid", {}, 409);
    }
    const rawRecords = Array.isArray(parsed)
      ? parsed
      : (Array.isArray(parsed?.records) ? parsed.records : []);
    return sourceEditorCleanupLedgerPayload(rawRecords).records;
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
}

async function writeSourceEditorExplanationCleanupRecords(context = {}, records = []) {
  const ledgerPath = sourceEditorExplanationCleanupPath(context);
  if (!ledgerPath) {
    return [];
  }
  const payload = sourceEditorCleanupLedgerPayload(records);
  if (!payload.records.length) {
    await rm(ledgerPath, {
      force: true
    });
    return payload.records;
  }
  await mkdir(path.dirname(ledgerPath), {
    recursive: true
  });
  const temporaryPath = `${ledgerPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(payload, null, 2)}\n`);
  await rename(temporaryPath, ledgerPath);
  return payload.records;
}

function mutateSourceEditorExplanationCleanupRecords(context = {}, transform = (records) => records) {
  const ledgerPath = sourceEditorExplanationCleanupPath(context);
  if (!ledgerPath) {
    return Promise.resolve([]);
  }
  const previous = sourceEditorExplanationCleanupQueues.get(ledgerPath) || Promise.resolve();
  const queued = previous
    .catch(() => null)
    .then(async () => {
      const records = await readSourceEditorExplanationCleanupRecords(context);
      const nextRecords = await transform(records);
      return writeSourceEditorExplanationCleanupRecords(context, Array.isArray(nextRecords) ? nextRecords : records);
    });
  const stored = queued
    .catch(() => null)
    .finally(() => {
      if (sourceEditorExplanationCleanupQueues.get(ledgerPath) === stored) {
        sourceEditorExplanationCleanupQueues.delete(ledgerPath);
      }
    });
  sourceEditorExplanationCleanupQueues.set(ledgerPath, stored);
  return queued;
}

async function upsertSourceEditorExplanationCleanupRecord(context = {}, explanation = {}) {
  const cleanupRecord = sourceEditorCleanupRecordFromExplanation(context, explanation);
  if (!cleanupRecord) {
    return;
  }
  await mutateSourceEditorExplanationCleanupRecords(context, (records) => [
    ...records.filter((record) => record.id !== cleanupRecord.id),
    { ...records.find((record) => record.id === cleanupRecord.id), ...cleanupRecord }
  ]);
}

async function removeSourceEditorExplanationCleanupRecord(context = {}, explanationId = "") {
  let normalizedId = "";
  try {
    normalizedId = normalizeSourceEditorExplanationId(explanationId);
  } catch {
    return;
  }
  let removed;
  await mutateSourceEditorExplanationCleanupRecords(context, (records) => {
    removed = records.find((record) => record.id === normalizedId);
    return records.filter((record) => record.id !== normalizedId);
  });
  if (removed?.helper) await rm(sourceEditorHelperRoot(context, removed.helper), { recursive: true, force: true });
}

function sourceEditorHelperRoot(context, helper) {
  const root = path.join(context.runtime.stateRoot, "assistant-helpers", helper.scope.id);
  if (!/^source_[a-f0-9-]+$/u.test(helper.scope.id) || helper.scope.workdir !== path.join(root, "workdir") ||
      helper.scope.runtimeRoot !== path.join(root, "runtime")) {
    throw sourceEditorError("The source explanation has invalid cleanup paths.", "vibe64_source_explanation_cleanup_failed");
  }
  return root;
}

async function readSourceEditorExplanationCleanupRecord(context = {}, explanationId = "") {
  const normalizedId = normalizeSourceEditorExplanationId(explanationId);
  return (await readSourceEditorExplanationCleanupRecords(context))
    .find((record) => record.id === normalizedId) || null;
}

/**
 * @param {object} [context]
 * @param {object} [record]
 * @param {object} [options]
 * @param {TerminalsService} options.terminals
 */
async function deleteSourceEditorExplanationAgentThread(context = {}, record = {}, {
  terminals
} = {}) {
  if (record.helper) {
    const helper = record.helper;
    sourceEditorHelperRoot(context, helper);
    const deleted = await terminals.deleteEphemeralAgentConversation(helper.scope, {
      conversationId: helper.conversationId,
      cleanupExecutionId: helper.executionId,
      ...(helper.executionProfile ? { executionProfile: helper.executionProfile } : {})
    }, { assistantSelection: helper.selection, vibe64User: context.vibe64User });
    if (deleted?.ok !== true) {
      const reason = String(deleted?.error || "").trim().slice(0, 512).replace(/[.\s]+$/u, "");
      throw sourceEditorError(`The source explanation helper could not be closed${reason ? `: ${reason}` : ""}.`,
        deleted?.code || "vibe64_source_explanation_agent_cleanup_unconfirmed");
    }
    return deleted;
  }
  const threadId = toText(record.agentThreadId);
  if (!threadId) {
    return {
      ok: true,
      status: "notFound",
      threadId
    };
  }
  const agentCleanup = await terminals.deleteDetachedAgentChatThread(context.sessionId, {
    executionProfile: sourceEditorExecutionProfileSnapshot(record.executionProfile) ||
      sourceEditorExecutionProfileRequest(),
    threadId
  }, sourceEditorAgentOperationOptions(context, {}, {
    providerId: record.executionProfile?.providerId
  }));
  if (agentCleanup?.ok !== true) {
    throw sourceEditorError(
      agentCleanup?.error || "The agent service did not confirm that the temporary source explanation chat was deleted.",
      agentCleanup?.code || "vibe64_source_explanation_agent_cleanup_unconfirmed",
      isRecord(agentCleanup) ? agentCleanup : { cleanupResult: agentCleanup ?? null },
      agentCleanup?.statusCode || 502
    );
  }
  return agentCleanup;
}

/**
 * @param {object} [context]
 * @param {string} [explanationId]
 * @param {object} [options]
 * @param {SourceEditorExplanationChats} options.explanationChats
 */
async function readSourceEditorExplanationRecord(context = {}, explanationId = "", {
  explanationChats
} = {}) {
  const record = explanationChats.get(sourceEditorExplanationMemoryKey(context, explanationId));
  if (!record) {
    throw sourceEditorError("Source explanation was not found.", "vibe64_source_explanation_not_found", {
      explanationId
    }, 404);
  }
  return normalizeSourceEditorExplanation(record);
}

/**
 * @param {object} [context]
 * @param {object} [explanation]
 * @param {object} [options]
 * @param {SourceEditorExplanationChats} options.explanationChats
 */
async function writeSourceEditorExplanation(context = {}, explanation = {}, {
  explanationChats
} = {}) {
  const record = normalizeSourceEditorExplanation({
    ...explanation,
    updatedAt: new Date().toISOString()
  });
  if (context.assistantHelper && context.explanationId === record.id) {
    context.assistantHelper.conversationId = record.agentThreadId || context.assistantHelper.conversationId;
    context.assistantHelper.runId = record.agentTurnId || context.assistantHelper.runId;
  }
  explanationChats.set(sourceEditorExplanationMemoryKey(context, record.id), record);
  await upsertSourceEditorExplanationCleanupRecord(context, record);
  return record;
}

/**
 * @param {object} [context]
 * @param {string} [explanationId]
 * @param {object} [options]
 * @param {SourceEditorExplanationChats} options.explanationChats
 */
async function readStoppedSourceEditorExplanation(context = {}, explanationId = "", options = {}) {
  const {
    explanationChats
  } = options;
  try {
    const record = await readSourceEditorExplanationRecord(context, explanationId, {
      explanationChats
    });
    return ["stopping", "stopped"].includes(record.status) ? record : null;
  } catch {
    return null;
  }
}

function normalizeSourceEditorExplanation(value = {}) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const sourceRange = source.sourceRange && typeof source.sourceRange === "object" && !Array.isArray(source.sourceRange)
    ? source.sourceRange
    : {};
  return {
    agentThreadId: toText(source.agentThreadId),
    agentSettings: null,
    agentTurnId: toText(source.agentTurnId),
    body: String(source.body || ""),
    createdAt: toText(source.createdAt),
    engine: toText(source.engine || (source.agentThreadId ? "agent-chat" : "")),
    error: String(source.error || ""),
    executionProfile: sourceEditorExecutionProfileSnapshot(source.executionProfile),
    followups: normalizeSourceEditorFollowups(source.followups),
    id: normalizeSourceEditorExplanationId(source.id),
    messages: normalizeSourceEditorMessages(source.messages),
    model: toText(source.model || "agent-chat"),
    ownerOriginId: toText(source.ownerOriginId || source.originId),
    promptVersion: toText(source.promptVersion || SOURCE_EDITOR_EXPLANATION_PROMPT_VERSION),
    sourceRange: {
      endColumn: positiveInteger(sourceRange.endColumn, 1),
      endLine: positiveInteger(sourceRange.endLine, 1),
      fileHash: toText(sourceRange.fileHash),
      language: toText(sourceRange.language || sourceEditorLanguageForPath(sourceRange.path)),
      path: normalizeSourceEditorRelativePath(sourceRange.path),
      scope: toText(sourceRange.scope || "selection"),
      ...(["description", "steps"].includes(sourceRange.presentation) ? { presentation: sourceRange.presentation } : {}),
      ...(sourceRange.symbolId ? { symbolId: toText(sourceRange.symbolId) } : {}),
      selectedTextHash: toText(sourceRange.selectedTextHash),
      startColumn: positiveInteger(sourceRange.startColumn, 1),
      startLine: positiveInteger(sourceRange.startLine, 1)
    },
    stale: source.stale === true,
    staleReason: toText(source.staleReason),
    status: toText(source.status || "ready"),
    summary: String(source.summary || ""),
    title: toText(source.title || "Code explanation"),
    updatedAt: toText(source.updatedAt)
  };
}

function normalizeSourceEditorFollowups(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      const role = toText(entry?.role);
      const text = String(entry?.text || "");
      if (!["assistant", "user"].includes(role) || !text.trim()) {
        return null;
      }
      return {
        createdAt: toText(entry.createdAt),
        id: toText(entry.id) || sourceEditorExplanationMessageId(),
        role,
        text
      };
    })
    .filter(Boolean);
}

function normalizeSourceEditorMessages(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => {
      const role = toText(entry?.role);
      const text = String(entry?.text || "");
      const status = toText(entry.status || "complete");
      if (!["assistant", "user"].includes(role) || (!text.trim() && status === "complete")) {
        return null;
      }
      return {
        createdAt: toText(entry.createdAt),
        id: toText(entry.id) || sourceEditorExplanationMessageId(),
        role,
        status,
        text
      };
    })
    .filter(Boolean);
}

function sourceEditorCleanupActiveIds(value = []) {
  return new Set((Array.isArray(value) ? value : [])
    .map((id) => {
      try {
        return normalizeSourceEditorExplanationId(id);
      } catch {
        return "";
      }
    })
    .filter(Boolean));
}

function sourceEditorCleanupRecordAgeMs(record = {}, nowMs = Date.now()) {
  const timestampMs = Date.parse(record.updatedAt || record.createdAt || "");
  return Number.isFinite(timestampMs) ? Math.max(0, nowMs - timestampMs) : Number.POSITIVE_INFINITY;
}

function shouldCleanupSourceEditorExplanationRecord(record = {}, options = {}) {
  const {
    activeIds = new Set(),
    nowMs = Date.now(),
    originId = ""
  } = options;
  if (activeIds.has(record.id)) {
    return false;
  }
  const recordOriginId = toText(record.originId);
  const requestedOriginId = toText(originId);
  if (requestedOriginId && recordOriginId && requestedOriginId === recordOriginId) {
    return true;
  }
  return sourceEditorCleanupRecordAgeMs(record, nowMs) >= SOURCE_EDITOR_EXPLANATION_CLEANUP_MAX_AGE_MS;
}

export {
  deleteSourceEditorExplanationAgentThread,
  mutateSourceEditorExplanationCleanupRecords,
  normalizeSourceEditorCleanupRecord,
  normalizeSourceEditorExplanation,
  normalizeSourceEditorExplanationId,
  normalizeSourceEditorFollowups,
  normalizeSourceEditorMessages,
  readSourceEditorExplanationCleanupRecord,
  readSourceEditorExplanationCleanupRecords,
  readSourceEditorExplanationRecord,
  readStoppedSourceEditorExplanation,
  removeSourceEditorExplanationCleanupRecord,
  shouldCleanupSourceEditorExplanationRecord,
  SOURCE_EDITOR_EXPLANATION_CLEANUP_FILE,
  SOURCE_EDITOR_EXPLANATION_CLEANUP_MAX_AGE_MS,
  sourceEditorCleanupActiveIds,
  sourceEditorCleanupLedgerPayload,
  sourceEditorCleanupRecordAgeMs,
  sourceEditorCleanupRecordFromExplanation,
  sourceEditorExplanationCleanupPath,
  sourceEditorExplanationCleanupQueues,
  sourceEditorExplanationMemoryKey,
  sourceEditorHelperRoot,
  upsertSourceEditorExplanationCleanupRecord,
  writeSourceEditorExplanation,
  writeSourceEditorExplanationCleanupRecords
};
