import path from "node:path";
import { retireClaudeConversationHistory } from "@jskit-ai/assistant-core/server/claude-history";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { listProjectRuntimeRoots } from "@local/vibe64-core/server/projectState";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { publishStateUpgradeFiles, readUpgradeFile } from "@local/vibe64-core/server/stateUpgradeFiles";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { claudeConfigRoot } from "./claudeCodeProcess.js";
import { conversationRecordBindings, nativeConversationBindings } from "./nativeConversationRetirement.js";
import {
  CLAUDE_CONVERSATION_ID,
  ENGINE_NAMES,
  fileDigest,
  isRepairChat,
  nativeConversations,
  preserveClaudeHistory,
  savedClaudeState
} from "./temporaryRepairChatsUpgrade.js";

const REPAIR_UPGRADE_ID = "20261104-temporary-repair-chats-removed";

/**
 * The Codex and OpenCode conversations of the repair chats that 20261104 removed from prepared renewal
 * archives, where no Close reaches them, by project and session. They are read from that upgrade's
 * before copies of those archives, each verified against its manifest.
 */
async function repairChatLeftovers({ systemRoot, backupRoot, stores, temporaryRoot }) {
  const root = path.join(path.dirname(backupRoot), REPAIR_UPGRADE_ID, "sessions");
  const leftovers = new Map();
  const source = await readUpgradeFile(path.join(root, "manifest.json"));
  if (source === null) return leftovers;
  let manifest = null;
  try {
    manifest = JSON.parse(source);
  } catch { /* Refused below without echoing saved content. */ }
  if (!isRecord(manifest) || !Array.isArray(manifest.files)) {
    throw new Error(`The ${REPAIR_UPGRADE_ID} backup manifest is unreadable. Inspect it before upgrading.`);
  }
  for (const entry of manifest.files) {
    if (!isRecord(entry) || typeof entry.path !== "string" || !entry.path.endsWith(".tar.gz") || !entry.before) continue;
    const archivePath = path.join(systemRoot, entry.path);
    const owner = stores.find(({ projectRuntimeRoot }) => !path.relative(projectRuntimeRoot, archivePath).startsWith(".."));
    const copy = path.join(root, "before", entry.path);
    if (!owner) throw new Error(`The ${REPAIR_UPGRADE_ID} backup names an archive outside every project: ${entry.path}.`);
    if (await fileDigest(copy) !== entry.before) {
      throw new Error(`The ${REPAIR_UPGRADE_ID} before copy of ${entry.path} is missing or changed. Inspect it before upgrading.`);
    }
    const { sessionId, metadata, conversations } = await owner.store.readArchivedConversations({ archivePath: copy, temporaryRoot });
    const label = `${owner.project}/${sessionId}`;
    const main = nativeConversationBindings({ metadata });
    const bindings = [];
    for (const record of conversations) {
      if (Object.hasOwn(record, "task") || !isRepairChat(record)) continue;
      nativeConversations(record, `${label}/${record.conversationId} (${REPAIR_UPGRADE_ID} backup)`);
      bindings.push(...conversationRecordBindings(metadata, record, main).filter(binding => binding.engineId !== "claude"));
    }
    if (bindings.length) leftovers.set(`${owner.project}\0${sessionId}`, { label, bindings });
  }
  return leftovers;
}

/** Every native conversation an archive keeps: its main chat's (current and retired) and those of its other chats and AI tasks. */
function keptConversationIds(metadata, conversations, label) {
  let bindings;
  try {
    bindings = nativeConversationBindings({ metadata });
  } catch {
    throw new Error(`${label}: its main chat's native bindings are unreadable. Inspect them before upgrading.`);
  }
  const kept = new Set(bindings.map(binding => binding.conversationId));
  for (const { conversation } of conversations) {
    if (conversation.state === "closing") continue;
    for (const { conversationId } of nativeConversations(conversation, `${label}/${conversation.conversationId}`)) kept.add(conversationId);
  }
  return kept;
}

/**
 * The archived session's conversation changeover with these conversations added to its retired
 * bindings, as an accepted replacement records its predecessor (null when each is there already),
 * and the bindings it added.
 */
function retiredJournal(metadata, bindings, label) {
  let state = null;
  try {
    state = JSON.parse(metadata.assistant_changeover || "{}");
  } catch { /* Refused below without echoing saved content. */ }
  if (!isRecord(state) || (state.retiredConversations !== undefined && !Array.isArray(state.retiredConversations))) {
    throw new Error(`${label}: its saved conversation changeover is unreadable. Inspect it before upgrading.`);
  }
  const retired = [...state.retiredConversations || []];
  const added = [];
  for (const binding of bindings) {
    const { engineId, conversationId, assistantSelection, workdir, modelProviderId } = binding;
    if (retired.some(entry => entry?.conversationId === conversationId && entry?.assistantSelection?.engineId === engineId)) continue;
    retired.push({ conversationId, assistantSelection, workdir, modelProviderId });
    added.push(binding);
  }
  return { added, value: added.length ? JSON.stringify({ ...state, retiredConversations: retired }) : null };
}

/**
 * 20261110: no Close reaches a chat in an archive. A chat or AI task whose Close had not finished
 * when its session was archived or renewed, before Archive and renewal finished every Close first,
 * stays in that archive as a closing record, with its native conversations in the engine's storage.
 * So do the Codex threads and OpenCode sessions of the repair chats `20261104` removed from prepared
 * renewal archives. In every published and prepared archive this deletes each closing record as
 * Close does (its record and transcript, its attachments, its Claude metadata) and Claude's history
 * of it, offline. Codex and OpenCode conversations can be deleted only by their running engine, so
 * each one of those chats, and each one `20261104` left, is recorded as a retired native binding of
 * its archived session, which the host's retirement of archived native history then deletes
 * through its engine, as it deletes the main chat's.
 * @param {object} context the runner's upgrade context, with the command's `env`
 */
async function retireArchivedClosingChats(context) {
  const { systemRoot, apply, backupRoot, report, env } = context;
  if (!isRecord(env)) throw new Error("Archived chat cleanup requires the command's environment.");
  const configRoot = path.resolve(claudeConfigRoot({ env }));
  const stores = (await listProjectRuntimeRoots(systemRoot)).map(projectRuntimeRoot => ({
    project: path.basename(projectRuntimeRoot),
    projectRuntimeRoot,
    store: createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot })
  }));
  await publishStateUpgradeFiles({
    ...context,
    backupRoot: path.join(backupRoot, "sessions"),
    async prepareUpdates(temporaryRoot) {
      const leftovers = await repairChatLeftovers({ systemRoot, backupRoot, stores, temporaryRoot });
      const updates = [];
      const claude = new Map();
      const recorded = { closing: [], leftover: [] };
      let unlocated = 0;
      for (const { project, store } of stores) {
        const counts = { published: 0, prepared: 0, attachments: 0 };
        updates.push(...await store.prepareTemporaryConversationRemoval({
          temporaryRoot,
          allArchives: true,
          select({ sessionId, metadata, archived, prepared, conversations }) {
            if (!archived) return [];
            const session = `${project}/${sessionId}${prepared ? " (prepared renewal archive)" : " (archive)"}`;
            const leftover = leftovers.get(`${project}\0${sessionId}`);
            leftovers.delete(`${project}\0${sessionId}`);
            const closing = conversations.filter(({ conversation }) => conversation.state === "closing");
            if (!closing.length && !leftover) return [];
            const kept = keptConversationIds(metadata, conversations, session);
            const main = nativeConversationBindings({ metadata });
            const shared = (label, engineId) => new Error(`${label}: its ${ENGINE_NAMES.get(engineId)} conversation is also the ` +
              "main chat's, an AI task's or a kept chat's. Inspect it before upgrading.");
            const hasFolder = binding => {
              if (path.isAbsolute(binding.workdir || "")) return true;
              unlocated += 1;
              report("warning", `${session}: its ${ENGINE_NAMES.get(binding.engineId)} conversation has no saved folder, so it is ` +
                "left in the engine's own storage.");
              return false;
            };
            const remove = [];
            const retiring = [];
            for (const { conversation, attachmentIds } of closing) {
              const label = `${session}/${conversation.conversationId}`;
              const metadataNames = [];
              for (const binding of nativeConversations(conversation, label)) {
                if (kept.has(binding.conversationId)) throw shared(label, binding.engineId);
                if (binding.engineId !== "claude") continue;
                if (!CLAUDE_CONVERSATION_ID.test(binding.conversationId)) {
                  throw new Error(`${label}: it names a Claude conversation id Claude does not use. Inspect it before upgrading.`);
                }
                const state = savedClaudeState(metadata, binding.conversationId, label);
                if (state?.main === true) throw shared(label, "claude");
                if (state) metadataNames.push(`claude_conversation_${binding.conversationId}`);
                const workdir = typeof state?.nativeWorkdir === "string" && state.nativeWorkdir
                  ? state.nativeWorkdir : sessionSourcePath({ sessionId, metadata });
                claude.set(`${workdir}\0${binding.conversationId}`, { label, workdir, conversationId: binding.conversationId });
              }
              const native = conversationRecordBindings(metadata, conversation, main).filter(binding => binding.engineId !== "claude");
              retiring.push(...native.filter(hasFolder).map(binding => ({ ...binding, from: "closing" })));
              remove.push({ conversationId: conversation.conversationId, metadataNames });
              counts[prepared ? "prepared" : "published"] += 1;
              counts.attachments += attachmentIds.length;
            }
            // One the archive already retires is no conflict; the journal keeps it once.
            const journaled = new Set(nativeConversationBindings({ metadata }, { retiredOnly: true })
              .map(binding => binding.conversationId));
            for (const binding of leftover?.bindings || []) {
              if (kept.has(binding.conversationId) && !journaled.has(binding.conversationId)) {
                throw shared(`${leftover.label} (${REPAIR_UPGRADE_ID})`, binding.engineId);
              }
              if (hasFolder(binding)) retiring.push({ ...binding, from: "leftover" });
            }
            const journal = retiredJournal(metadata, retiring, session);
            for (const binding of journal.added) recorded[binding.from].push(binding.engineId);
            return { remove, metadata: journal.value ? { assistant_changeover: journal.value } : {} };
          }
        }));
        report("info", `${project}: ${counts.published + counts.prepared} closing chat(s) or AI task(s) to delete from archives ` +
          `(${counts.published} in published archives, ${counts.prepared} in prepared renewal archives) with ` +
          `${counts.attachments} attachment(s).`);
      }
      for (const { label } of leftovers.values()) {
        report("warning", `${label}: ${REPAIR_UPGRADE_ID} left Codex or OpenCode conversations of its repair chats, but the ` +
          "session has no archive any more, so they stay in the engine's own storage.");
      }
      const count = (list, engineId) => list.filter(value => value === engineId).length;
      const located = [...claude.values()].filter(({ label, workdir }) => {
        if (path.isAbsolute(workdir || "")) return true;
        report("warning", `${label}: its Claude history has no saved folder, so it is left in Claude's own storage.`);
        return false;
      });
      report("info", `Native conversations: ${located.length} Claude to delete from Claude's own storage; recorded as retired ` +
        `on their archived session, for its native-history retirement to delete through the engine: ` +
        `${count(recorded.closing, "codex")} Codex and ${count(recorded.closing, "opencode")} OpenCode of these chats, and ` +
        `${count(recorded.leftover, "codex")} Codex and ${count(recorded.leftover, "opencode")} OpenCode that ${REPAIR_UPGRADE_ID} ` +
        `left; left in the engine's own storage: ${claude.size - located.length + unlocated} without a saved folder.`);
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
}

export { retireArchivedClosingChats };
