import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { chmod, copyFile, lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { retireClaudeConversationHistory } from "@jskit-ai/assistant-core/server/claude-history";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { publishStateUpgradeFiles, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { claudeConfigRoot } from "./claudeCodeProcess.js";
import { nativeConversationBindings } from "./nativeConversationRetirement.js";

const ENGINE_NAMES = new Map([["claude", "Claude"], ["codex", "Codex"], ["opencode", "OpenCode"]]);
// What the repair flows stored on their chats (since 16 September 2026, beside the title and draft).
// A person's own chat saved them empty or not at all, so one filled field marks a repair chat.
const REPAIR_FIELDS = Object.freeze([
  "completionMessage", "dedupeKey", "failureMessage", "nextStepMessage", "recoveryNotice", "recoveryOperation",
  "recoveryConflictId", "recoveryContext", "recoveryOutcome", "recoveryOutcomeMessage", "recoveryRequestId",
  "runConflictId", "recoveryAutoPaused", "recoveryRetryKeys"
]);
const CLAUDE_CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

async function fileDigest(filePath) {
  try {
    if (!(await lstat(filePath)).isFile()) throw new Error(`Upgrade backup requires a regular file: ${filePath}`);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

/**
 * Before Claude's history of a deleted chat goes, every file of it is copied, privately and
 * verified, below the upgrade's own `claude/` backup, at its path inside Claude's storage.
 */
async function preserveClaudeHistory(inventory, configRoot, backupRoot) {
  for (const conversation of inventory.conversations) {
    for (const file of conversation.files) {
      if (file.directory) continue;
      const relative = path.relative(configRoot, file.path);
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        throw new Error("Claude history lies outside Claude's storage.");
      }
      const destination = path.join(backupRoot, relative);
      await verifyUpgradeParents(backupRoot, destination);
      const original = await fileDigest(file.path);
      const saved = await fileDigest(destination);
      if (saved && saved !== original) throw new Error(`Claude history backup differs from the original: ${relative}.`);
      if (!saved) {
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
        const temporary = `${destination}.${randomUUID()}.tmp`;
        try {
          await copyFile(file.path, temporary);
          await chmod(temporary, 0o600);
          await rename(temporary, destination);
        } finally {
          await rm(temporary, { force: true });
        }
      }
      if (await fileDigest(destination) !== original) throw new Error(`Claude history backup could not be verified: ${relative}.`);
    }
    // Retirement requires each conversation's complete export before it deletes anything.
    await inventory.exportConversation(conversation.conversationId, async () => {});
  }
  return { preserved: true, exclusive: true };
}

/**
 * The native conversations a chat's record names, as Close releases them: its retained
 * bindings and its current one.
 */
function nativeConversations(record, label) {
  if (record.nativeBindings !== undefined && !isRecord(record.nativeBindings)) {
    throw new Error(`${label}: its native bindings are unreadable. Inspect it before upgrading.`);
  }
  const found = new Map();
  const bindings = [
    ...Object.values(record.nativeBindings || {}),
    { conversationId: record.providerConversationId, assistantSelection: record.assistantSelection }
  ];
  for (const binding of bindings) {
    if (!isRecord(binding)) throw new Error(`${label}: its native bindings are unreadable. Inspect it before upgrading.`);
    const { conversationId } = binding;
    if (conversationId === undefined || conversationId === "") continue;
    const engineId = binding.assistantSelection?.engineId;
    if (typeof conversationId !== "string" || !ENGINE_NAMES.has(engineId)) {
      throw new Error(`${label}: it names a native conversation Vibe64 does not know. Inspect it before upgrading.`);
    }
    found.set(`${engineId}:${conversationId}`, { engineId, conversationId });
  }
  return [...found.values()];
}

function savedClaudeState(metadata, conversationId, label) {
  const saved = metadata[`claude_conversation_${conversationId}`];
  if (!saved) return null;
  let state = null;
  try {
    state = JSON.parse(saved);
  } catch { /* Refused below without echoing saved content. */ }
  if (!isRecord(state)) throw new Error(`${label}: its saved Claude state is unreadable. Inspect it before upgrading.`);
  return state;
}

/** Whether a chat without a task was opened by a repair flow, rather than by the person or Colleague. */
function isRepairChat(record) {
  return REPAIR_FIELDS.some(field => {
    const value = record[field];
    return value === true || ((typeof value === "string" || Array.isArray(value)) && value.length > 0);
  });
}

/** The native conversations a session keeps: its main chat's, its retired ones, its AI tasks' and its kept chats'. */
function keptNativeConversations(metadata, conversations, label) {
  let bindings;
  try {
    bindings = nativeConversationBindings({ metadata });
  } catch {
    throw new Error(`${label}: its main chat's native bindings are unreadable. Inspect them before upgrading.`);
  }
  const kept = new Set(bindings.map(binding => binding.conversationId));
  for (const { conversation } of conversations) {
    if (!Object.hasOwn(conversation, "task") && isRepairChat(conversation)) continue;
    const bindings = Object.values(isRecord(conversation.nativeBindings) ? conversation.nativeBindings : {});
    for (const id of [conversation.providerConversationId, ...bindings.map(binding => binding?.conversationId)]) {
      if (typeof id === "string" && id) kept.add(id);
    }
  }
  return kept;
}

/**
 * A live repair chat with Codex or OpenCode conversations, as an interrupted Close of them: the record
 * Close itself keeps while it cannot reach an engine. Close deletes those conversations through their
 * engine, then the chat's attachments, transcript and record, when that engine next works in the
 * session or when the person closes the chat. Its Claude bindings leave with the Claude history this
 * upgrade deletes itself; the current conversation joins the retained ones Close releases.
 * @param {object} record a repair chat whose native bindings `nativeConversations` has read
 * @param {string[]} engineIds the engines of its Codex and OpenCode conversations
 */
function closingRecord(record, engineIds) {
  const nativeBindings = {};
  for (const [key, binding] of Object.entries(record.nativeBindings || {})) {
    if (binding.conversationId && binding.assistantSelection.engineId !== "claude") nativeBindings[key] = binding;
  }
  const engineId = record.assistantSelection?.engineId;
  const current = Boolean(record.providerConversationId) && engineId !== "claude";
  if (current && !Object.values(nativeBindings).some(binding => binding.conversationId === record.providerConversationId)) {
    nativeBindings[Object.hasOwn(nativeBindings, engineId) ? `${engineId}-current` : engineId] = {
      conversationId: record.providerConversationId,
      assistantSelection: record.assistantSelection,
      agentSettings: record.agentSettings || {},
      runId: record.runId || "",
      messageId: record.messageId || ""
    };
  }
  const names = engineIds.map(id => ENGINE_NAMES.get(id));
  return {
    ...record,
    state: "closing",
    error: names.length > 1
      ? `This old repair chat holds ${names.join(" and ")} conversations. Close deletes it with them.`
      : `Vibe64 deletes this old repair chat and its ${names[0]} conversation after ${names[0]} next works in this ` +
        "session. Close deletes them now.",
    nativeBindings,
    providerConversationId: current ? record.providerConversationId : ""
  };
}

/**
 * 20261104: every repair chat from before AI tasks (the temporary chats that Fix it with AI, Update,
 * Save, workspace setup and the other repair flows opened) is deleted as Close deletes one, in live
 * sessions and prepared renewal archives: its record and stored transcript, its session attachments
 * and Claude's native history. A repair chat is a record without `task` that has a filled repair
 * field. The person's own temporary chats and Colleague's stay untouched, with their attachments and
 * native history, and so do AI tasks (records with `task`); other archived sessions are not visited.
 * Codex threads and OpenCode sessions can only be deleted by their running engine, so a live repair
 * chat that has them is handed to Close instead, as an interrupted Close (`closingRecord`); Close
 * finishes it after that engine's next turn in the session. In a prepared renewal archive, which no
 * Close reaches, they stay in the engine's own storage; the report counts them. Upload copies of the
 * attachments are temporary host files the server's startup sweep expires; offline their folder
 * cannot be named (that needs the server's project context), so they are left to it.
 * @param {object} context the runner's upgrade context, with the command's `env`
 */
async function removeTemporaryRepairChats(context) {
  const { systemRoot, apply, backupRoot, report, env } = context;
  if (!isRecord(env)) throw new Error("Repair chat cleanup requires the command's environment.");
  const configRoot = path.resolve(claudeConfigRoot({ env }));
  const stores = (await listProjectRuntimeRoots(systemRoot)).map(projectRuntimeRoot => ({
    project: path.basename(projectRuntimeRoot),
    store: createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot })
  }));
  await publishStateUpgradeFiles({
    ...context,
    backupRoot: path.join(backupRoot, "sessions"),
    async prepareUpdates(temporaryRoot) {
      const updates = [];
      const handed = new Map();
      const left = new Map();
      const claude = new Map();
      for (const { project, store } of stores) {
        const counts = { live: 0, prepared: 0, attachments: 0, handed: 0, chats: 0, tasks: 0 };
        updates.push(...await store.prepareTemporaryConversationRemoval({
          temporaryRoot,
          select({ sessionId, metadata, archived, conversations }) {
            const session = `${project}/${sessionId}${archived ? " (prepared renewal archive)" : ""}`;
            const executionRoot = sessionSourcePath({ sessionId, metadata });
            let kept = null;
            const chosen = [];
            for (const { conversation, attachmentIds } of conversations) {
              const label = `${session}/${conversation.conversationId}`;
              if (Object.hasOwn(conversation, "task")) {
                if (!isRecord(conversation.task)) throw new Error(`${label}: its AI task is unreadable. Inspect it before upgrading.`);
                counts.tasks += 1;
                continue;
              }
              if (!isRepairChat(conversation)) {
                counts.chats += 1;
                continue;
              }
              const metadataNames = [];
              const closeEngines = new Set();
              for (const binding of nativeConversations(conversation, label)) {
                const isClaude = binding.engineId === "claude";
                if (isClaude && !CLAUDE_CONVERSATION_ID.test(binding.conversationId)) {
                  throw new Error(`${label}: it names a Claude conversation id Claude does not use. Inspect it before upgrading.`);
                }
                kept ||= keptNativeConversations(metadata, conversations, session);
                const state = isClaude ? savedClaudeState(metadata, binding.conversationId, label) : null;
                if (kept.has(binding.conversationId) || state?.main === true) {
                  throw new Error(`${label}: its ${ENGINE_NAMES.get(binding.engineId)} conversation is also the main chat's, ` +
                    "an AI task's or a kept chat's. Inspect it before upgrading.");
                }
                if (!isClaude) {
                  (archived ? left : handed).set(`${binding.engineId}:${binding.conversationId}`, binding.engineId);
                  if (!archived) closeEngines.add(binding.engineId);
                  continue;
                }
                if (state) metadataNames.push(`claude_conversation_${binding.conversationId}`);
                const workdir = typeof state?.nativeWorkdir === "string" && state.nativeWorkdir ? state.nativeWorkdir : executionRoot;
                claude.set(`${workdir}\0${binding.conversationId}`, { label, workdir, conversationId: binding.conversationId });
              }
              if (closeEngines.size) {
                if (closeEngines.size > 1) {
                  report("warning", `${label}: it holds Codex and OpenCode conversations, so it is deleted when the person closes it.`);
                }
                counts.handed += 1;
                const record = closingRecord(conversation, [...closeEngines]);
                chosen.push({ conversationId: conversation.conversationId, metadataNames, record });
                continue;
              }
              counts[archived ? "prepared" : "live"] += 1;
              counts.attachments += attachmentIds.length;
              chosen.push({ conversationId: conversation.conversationId, metadataNames });
            }
            return chosen;
          }
        }));
        report("info", `${project}: ${counts.live + counts.prepared} old repair chat(s) to delete ` +
          `(${counts.live} in live sessions, ${counts.prepared} in prepared renewal archives) with ` +
          `${counts.attachments} attachment(s), and ${counts.handed} to hand to Close, which deletes each with its ` +
          `Codex or OpenCode conversation; ${counts.chats} temporary chat(s) and ${counts.tasks} AI task ` +
          "conversation(s) kept.");
      }
      const count = (found, engineId) => [...found.values()].filter(value => value === engineId).length;
      const located = [...claude.values()].filter(({ label, workdir }) => {
        if (path.isAbsolute(workdir || "")) return true;
        report("warning", `${label}: its Claude history has no saved folder, so it is left in Claude's own storage.`);
        return false;
      });
      report("info", `Native conversations of these repair chats: ${located.length} Claude to delete from Claude's own storage; ` +
        `${count(handed, "codex")} Codex and ${count(handed, "opencode")} OpenCode handed to Close, which deletes each through ` +
        `its engine after that engine's next turn in its session; left in their engine's own storage: ` +
        `${claude.size - located.length} Claude without a saved folder, and ${count(left, "codex")} Codex and ` +
        `${count(left, "opencode")} OpenCode of prepared renewal archives, which no Close reaches.`);
      if (!apply) return updates;
      // Native history goes first, as Close does; the records that name it go last.
      let retired = 0;
      for (const { label, workdir, conversationId } of located) {
        try {
          const result = await retireClaudeConversationHistory({
            configRoot,
            binding: { conversationId, workdir },
            requireIdle: async () => {},
            beforeDelete: inventory => preserveClaudeHistory(inventory, configRoot, path.join(backupRoot, "claude"))
          });
          if (!result.alreadyAbsent) retired += 1;
        } catch (error) {
          report("warning", `${label}: its Claude history could not be deleted (${error.message}); it is left in Claude's own storage.`);
        }
      }
      if (located.length) report("info", `Deleted ${retired} Claude native conversation(s); their files are kept in this upgrade's claude/ backup.`);
      return updates;
    }
  });
  if (!apply) return;
  let folders = 0;
  for (const { store } of stores) folders += await store.removeEmptyConversationFolders();
  if (folders) report("info", `Removed ${folders} emptied conversation and attachment folder(s).`);
}

export {
  CLAUDE_CONVERSATION_ID,
  ENGINE_NAMES,
  fileDigest,
  isRepairChat,
  nativeConversations,
  preserveClaudeHistory,
  removeTemporaryRepairChats,
  savedClaudeState
};
