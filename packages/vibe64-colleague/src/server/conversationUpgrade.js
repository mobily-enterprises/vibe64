import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateColleagueConversationRecord } from "./conversationRecord.js";
import { upgradeConversationRuntimeState } from "@jskit-ai/assistant-core/server/conversation";

export { upgradeColleagueNativeContinuity, upgradeColleagueCodexCompletedPolicy, upgradeColleagueNativeInstructions } from "./nativeConversationUpgrade.js";

/** Offline conversion only. Native histories remain untouched and no work resumes. */
export async function upgradeColleagueConversations({ systemRoot, apply, backupRoot, report }) {
  const root = path.join(systemRoot, "colleague");
  let entries;
  try {
    if (!(await lstat(root)).isDirectory()) throw new Error("Colleague state must be a regular directory.");
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) { if (error.code === "ENOENT") return; throw error; }
  const updates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\w-]+$/u.test(entry.name)) throw new Error("Unexpected entry in Colleague state. Inspect it before upgrading.");
    const file = path.join(root, entry.name, "conversation.json");
    let original;
    try {
      if (!(await lstat(file)).isFile()) throw new Error("Colleague history must be a regular file.");
      original = await readFile(file, "utf8");
    } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    let saved;
    try { saved = JSON.parse(original); } catch { throw new Error("Colleague history is invalid JSON. Restore it before upgrading."); }
    if (saved?.schemaVersion === 3) {
      validateColleagueConversationRecord(saved, entry.name);
      validateCurrentRuntimeHistories(saved);
      continue;
    }
    if (![1, 2].includes(saved?.schemaVersion) || typeof saved.scopeId !== "string" ||
        !/^colleague_[\w-]+$/u.test(saved.scopeId) || !Array.isArray(saved.conversationLog) ||
        saved.conversationLog.some(turn => typeof turn.turnId !== "string" || !Array.isArray(turn.messages) ||
          turn.messages.some(message => typeof message.text !== "string" || typeof message.role !== "string"))) {
      throw new Error("Colleague history has an unsupported shape. Inspect it before upgrading.");
    }
    if (saved.schemaVersion === 2) continue;
    if (saved.conversationMetadata?.runtime || saved.retiredConversation) throw new Error("Colleague history contains conflicting runtime state. Inspect it before upgrading.");
    const { conversationId, runId, currentTurnId, operation, ...retained } = saved;
    const interrupted = saved.status === "working" || operation?.status === "executing";
    const next = { ...retained, schemaVersion: 2,
      retiredConversation: { conversationId: conversationId || "", runId: runId || "", currentTurnId: currentTurnId || "",
        assistantSelection: saved.assistantSelection,
        ...(operation ? { operation: { ...operation, ...(operation.status === "executing" ? { status: "unknown" } : {}) } } : {}) },
      ...(interrupted ? { status: "interrupted", error: "Colleague was interrupted before this upgrade. Inspect unfinished operations before continuing; nothing was repeated." } : {}) };
    report(interrupted ? "warning" : "info", `${entry.name}: retain written history and retire the old native binding. Stop all services and native writers before applying; no model request will be sent.`);
    updates.push({ file, original, next, backup: path.join(backupRoot, entry.name, "conversation.json") });
  }
  if (!apply || !updates.length) return;
  // Secure every original before changing any conversation.
  for (const update of updates) {
    await mkdir(path.dirname(update.backup), { recursive: true, mode: 0o700 });
    try { await writeFile(update.backup, update.original, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await lstat(update.backup)).isFile() || await readFile(update.backup, "utf8") !== update.original) {
        throw new Error("Colleague history differs from its upgrade backup. Inspect both before retrying.");
      }
    }
  }
  for (const update of updates) {
    if (!(await lstat(update.file)).isFile() || await readFile(update.file, "utf8") !== update.original) {
      throw new Error("Colleague history changed during upgrade. Stop all writers before retrying.");
    }
    const temporary = `${update.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(update.next), { flag: "wx", mode: 0o600 });
      await rename(temporary, update.file);
    } finally { await rm(temporary, { force: true }); }
  }
}

/** A separate numbered upgrade; the original schema 1-to-2 conversion stays unchanged. */
export async function upgradeColleagueConversationRuntime({ systemRoot, apply, backupRoot, report }) {
  const root = path.join(systemRoot, "colleague");
  let entries;
  try {
    if (!(await lstat(root)).isDirectory()) throw new Error("Colleague state must be a regular directory.");
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) { if (error.code === "ENOENT") return; throw error; }
  const updates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\w-]+$/u.test(entry.name)) throw new Error("Unexpected entry in Colleague state. Inspect it before upgrading.");
    const file = path.join(root, entry.name, "conversation.json");
    let original;
    try {
      if (!(await lstat(file)).isFile()) throw new Error("Colleague history must be a regular file.");
      original = await readFile(file, "utf8");
    } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    let saved;
    try { saved = JSON.parse(original); } catch { throw new Error("Colleague history is invalid JSON. Restore it before upgrading."); }
    if (saved?.schemaVersion === 3) {
      validateColleagueConversationRecord(saved, entry.name);
      validateCurrentRuntimeHistories(saved);
      continue;
    }
    if (![1, 2].includes(saved?.schemaVersion) || typeof saved.scopeId !== "string" ||
        !/^colleague_[\w-]+$/u.test(saved.scopeId) || !Array.isArray(saved.conversationLog) ||
        saved.conversationLog.some(turn => typeof turn?.turnId !== "string" || !Array.isArray(turn.messages) ||
          turn.messages.some(message => typeof message?.text !== "string" || typeof message.role !== "string"))) {
      throw new Error("Colleague history has an unsupported shape. Inspect it before upgrading.");
    }
    if (saved.schemaVersion === 1) {
      if (saved.conversationMetadata?.runtime || apply) {
        throw new Error("Complete the earlier Colleague conversation upgrade before upgrading its runtime metadata.");
      }
      // The runner checks every pending step before applying the earlier one.
      report("info", `${entry.name}: the earlier Colleague upgrade will retain this pre-runtime transcript; no native journal needs conversion.`);
      continue;
    }
    let result;
    try { result = upgradeConversationRuntimeState({ metadata: saved.conversationMetadata || {}, conversationLog: saved.conversationLog }); }
    catch (error) { throw new Error(`${entry.name}: ${error.message}`, { cause: error }); }
    if (!result.changed) continue;
    for (const warning of result.warnings) report("warning", `${entry.name}: ${warning}`);
    report("info", `${entry.name}: upgrade native delivery metadata while retaining conversation identity and history. Stop all services and native writers before applying; no native request or database conversion will run.`);
    updates.push({ file, original, next: { ...saved, conversationMetadata: result.metadata },
      backup: path.join(backupRoot, entry.name, "conversation.json") });
  }
  if (!apply || !updates.length) return;
  // Back up every original before replacing the first record.
  for (const update of updates) {
    await mkdir(path.dirname(update.backup), { recursive: true, mode: 0o700 });
    try { await writeFile(update.backup, update.original, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await lstat(update.backup)).isFile() || await readFile(update.backup, "utf8") !== update.original) {
        throw new Error("Colleague history differs from its runtime upgrade backup. Inspect both before retrying.");
      }
    }
  }
  for (const update of updates) {
    if (!(await lstat(update.file)).isFile() || await readFile(update.file, "utf8") !== update.original) {
      throw new Error("Colleague history changed during runtime upgrade. Stop all writers before retrying.");
    }
    const temporary = `${update.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(update.next), { flag: "wx", mode: 0o600 });
      await rename(temporary, update.file);
    } finally { await rm(temporary, { force: true }); }
  }
}

function validateCurrentRuntimeHistories(record) {
  for (const chat of [record, ...record.previousConversations]) {
    const result = upgradeConversationRuntimeState({ metadata: chat.conversationMetadata || {}, conversationLog: chat.conversationLog });
    if (result.changed) throw new Error("Colleague history contains an older runtime format. Complete its numbered runtime upgrade before starting fresh.");
  }
}

/** Retain the original backend identity; only explicit new chats get a new one. */
export async function upgradeColleagueConversationHistory({ systemRoot, apply, backupRoot, report }) {
  const root = path.join(systemRoot, "colleague");
  let entries;
  try {
    if (!(await lstat(root)).isDirectory()) throw new Error("Colleague state must be a regular directory.");
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) { if (error.code === "ENOENT") return; throw error; }
  const updates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^[\w-]+$/u.test(entry.name)) throw new Error("Unexpected entry in Colleague state. Inspect it before upgrading.");
    const file = path.join(root, entry.name, "conversation.json");
    let original;
    try {
      if (!(await lstat(file)).isFile()) throw new Error("Colleague history must be a regular file.");
      original = await readFile(file, "utf8");
    } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    let saved;
    try { saved = JSON.parse(original); } catch { throw new Error("Colleague history is invalid JSON. Restore it before upgrading."); }
    validateColleagueConversationRecord(saved, entry.name);
    if (saved.schemaVersion === 3) { validateCurrentRuntimeHistories(saved); continue; }
    if (saved.schemaVersion === 1) {
      if (apply) throw new Error("Complete the earlier Colleague conversation upgrade before retaining conversation history.");
      report("info", `${entry.name}: earlier numbered upgrades will retain this conversation before adding fresh-chat identity support.`);
      continue;
    }
    if (Object.hasOwn(saved, "runtimeId") || Object.hasOwn(saved, "previousConversations")) {
      throw new Error("Colleague history contains conflicting fresh-chat identity fields. Inspect it before upgrading.");
    }
    const runtime = upgradeConversationRuntimeState({ metadata: saved.conversationMetadata || {}, conversationLog: saved.conversationLog });
    if (apply && runtime.changed) throw new Error("Complete the earlier native delivery upgrade before retaining conversation history.");
    const next = { ...saved, schemaVersion: 3, runtimeId: entry.name, previousConversations: [] };
    validateColleagueConversationRecord(next, entry.name);
    report("info", `${entry.name}: retain the exact active native identity, history and user policy while enabling explicit fresh conversations. Stop all writers before applying; nothing will be sent or resumed.`);
    updates.push({ file, original, next, backup: path.join(backupRoot, entry.name, "conversation.json") });
  }
  if (!apply || !updates.length) return;
  // Same original backup and atomic-publication contract as the older owners.
  for (const update of updates) {
    await mkdir(path.dirname(update.backup), { recursive: true, mode: 0o700 });
    try { await writeFile(update.backup, update.original, { flag: "wx", mode: 0o600 }); }
    catch (error) {
      if (error.code !== "EEXIST") throw error;
      if (!(await lstat(update.backup)).isFile() || await readFile(update.backup, "utf8") !== update.original) {
        throw new Error("Colleague history differs from its fresh-conversation upgrade backup. Inspect both before retrying.");
      }
    }
  }
  for (const update of updates) {
    if (!(await lstat(update.file)).isFile() || await readFile(update.file, "utf8") !== update.original) {
      throw new Error("Colleague history changed during upgrade. Stop all writers before retrying.");
    }
    const temporary = `${update.file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(update.next), { flag: "wx", mode: 0o600 });
      await rename(temporary, update.file);
    } finally { await rm(temporary, { force: true }); }
  }
}
