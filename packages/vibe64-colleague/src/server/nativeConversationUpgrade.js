import { randomUUID } from "node:crypto";
import { glob, lstat, open, readdir, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { readCodexHistoryRows, readCodexNativeGoal } from "@jskit-ai/assistant-core/server/codex-provider";
import { codexRuntimeContext } from "@local/studio-terminal-core/server/codexRuntimeContext";
import { codexAppServerTurnStateFromAgentRun } from "@jskit-ai/assistant-core/server/codex-turn";
import { readAssistantResponseEnvelope } from "@jskit-ai/assistant-core/server";
import { readOpenCodeConversationDatabase } from "@jskit-ai/assistant-core/server/opencode-client";
import { openCodeDetachedPrompt, openCodeRowsForInput, openCodeLastAssistantResult, openCodeStructuredOutput } from "@jskit-ai/assistant-core/server/opencode-turn";
import { readStoppedNativeDatabase } from "@jskit-ai/assistant-core/server/native-history";
import { resolveVibe64ServiceDataRoot } from "@local/vibe64-core/server/studioRoots";
import { conversationHistoryVersions, upgradeConversationRuntimeState } from "@jskit-ai/assistant-core/server/conversation";
import { claudeHistoryPath, listClaudeConversationStorage, readClaudeHistory } from "@jskit-ai/assistant-core/server/claude-history";
import { publishStateUpgradeFiles, readUpgradeFile, verifyUpgradeParents } from "@local/vibe64-core/server/stateUpgradeFiles";
import { claudeConnectionIdentity } from "@jskit-ai/assistant-core/server/claude-process";
import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { curatedCodexProvider } from "@local/vibe64-core/shared/curatedCodexProviders";
import { claudeProviderAccountIdentity } from "@local/vibe64-terminals/server/claudeConversationAccounts";
import { conversationConfiguration } from "@local/vibe64-terminals/server/conversationConfiguration";
import { validateColleagueConversationRecord } from "./conversationRecord.js";

const uuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/iu;
const nativeClaude = selection => selection?.engineId === "claude" && selection.modelProviderId === "anthropic";
const restoredNative = selection => selection?.engineId === "claude" &&
  (nativeClaude(selection) || Boolean(curatedCodexProvider(selection.modelProviderId))) || selection?.engineId === "opencode" ||
  selection?.engineId === "codex" && (selection.modelProviderId === "openai" || Boolean(curatedCodexProvider(selection.modelProviderId)));
const nativeClaim = (engine, id) => `${engine}:${id}`;
// Frozen869ebb protocol.outputSchema: historical prompt bytes, not today's
// bounded output schema. Use its original native formatter to identify only
// this known suffix; never strip arbitrary instructions or alter native files.
const originalOpenCodeOutputSchema = {
  type: "object", additionalProperties: false,
  required: ["kind", "text", "toolName", "arguments"],
  properties: {
    kind: { type: "string", enum: ["reply", "tool"] },
    text: { type: "string", description: "The final reply, or a brief progress sentence for the first tool request; empty for subsequent tool requests." }, toolName: { type: "string" }, arguments: { type: "string" }
  }
};
const originalOpenCodePromptSuffix = openCodeDetachedPrompt({ outputSchema: originalOpenCodeOutputSchema });
function originalOpenCodeInput(message) {
  const text = message.content.filter(part => part.type === "text").map(part => part.text).join("\n");
  if (!text.endsWith(originalOpenCodePromptSuffix)) return null;
  try { return JSON.parse(text.slice(0, -originalOpenCodePromptSuffix.length)); }
  catch { return null; }
}
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
      if (retired?.conversationId && !restoredNative(retired.assistantSelection)) {
        report("warning", `${entry.name}: this older provider binding is outside the supported native continuity correction; its retired identity and written history remain unchanged.`);
      }
      if (restoredNative(retired?.assistantSelection)) claim(nativeClaim(retired.assistantSelection.engineId, retired.conversationId), owner);
      const runtime = chat.conversationMetadata?.runtime;
      if (runtime) {
        const checked = upgradeConversationRuntimeState({ metadata: chat.conversationMetadata, conversationLog: chat.conversationLog });
        if (apply && checked.changed) throw new Error("Complete the earlier native delivery upgrade before restoring Colleague continuity.");
      }
      for (const segment of [runtime, ...(runtime?.predecessors || []), runtime?.replacement]) {
        if (["claude", "opencode", "codex"].includes(segment?.engine)) {
          const id = segment.engine === "claude" ? segment.binding?.conversationId : segment.engine === "codex" ? segment.binding?.threadId : segment.binding?.sessionId;
          if (id) claim(nativeClaim(segment.engine, id), owner);
        }
      }
    }
  }

  const inspect = async ({ ownerKey, filePath, original, saved, segmentId = randomUUID() }) => {
    const retired = saved.schemaVersion === 1 ? saved : saved.retiredConversation;
    if (!retired || !restoredNative(retired.assistantSelection)) return null;
    const engine = retired.assistantSelection.engineId;
    const label = engine === "claude" ? "Claude" : engine === "codex" ? "Codex" : "OpenCode";
    // Current common owners and explicit fresh-chat transitions are not legacy imports.
    if (saved.conversationMetadata?.runtime || saved.previousConversations?.length || saved.freshOperation) return null;
    const refuse = message => { throw new Error(`${ownerKey}: ${message} No native work or history was changed.`); };
    if (!(engine !== "opencode" ? uuid : /^ses_[a-zA-Z0-9_]{1,256}$/u).test(retired.conversationId || "") || !retired.runId ||
        !isDeepStrictEqual(saved.assistantSelection, retired.assistantSelection) ||
        saved.status === "working" || saved.operation || retired.operation ||
        ["request", "replacement", "rewind", "continuity"].some(key => Object.hasOwn(saved.conversationMetadata || {}, key))) {
      refuse(`The retired ${label} binding has changed selection or unfinished/unsupported state. Inspect its original receipts before retrying.`);
    }
    if (claims.get(nativeClaim(engine, retired.conversationId))?.size !== 1) refuse(`The native ${label} identity is claimed by another Colleague scope. Resolve ownership before retrying.`);
    const scopeWorkdir = path.join(root, ownerKey, saved.scopeId);
    await verifyUpgradeParents(systemRoot, path.join(scopeWorkdir, "placeholder"));
    if (await realpath(scopeWorkdir) !== scopeWorkdir) refuse("The original private scope is not canonical.");
    const lastTurn = saved.conversationLog.at(-1);
    const answer = lastTurn?.messages.find(message => message.role === "assistant")?.text;
    const autonomous = !lastTurn?.messages.some(message => message.role === "user") &&
      lastTurn?.messages.some(message => message.role === "system" &&
      message.text === "An update from your watched conversations.");
    if (!answer?.trim() || !autonomous && lastTurn?.turnId !== retired.currentTurnId) {
      refuse("The last written product turn does not identify the original completed reply or watched-conversation update.");
    }
    const update = (binding, verify) => {
      const configuration = conversationConfiguration(saved.assistantSelection, "").configuration;
      const next = { ...saved, conversationMetadata: { ...saved.conversationMetadata, runtime: {
        version: 3, segmentId, engine, configuration, predecessors: [],
        seen: conversationHistoryVersions(saved.conversationLog), lastEngine: engine, binding
      } } };
      upgradeConversationRuntimeState({ metadata: next.conversationMetadata, conversationLog: next.conversationLog });
      return { filePath, original, contents: JSON.stringify(next), verify };
    };
    if (engine === "codex") {
      const authored = lastTurn?.messages.find(message => message.role === "user");
      if (!autonomous && !authored || !uuid.test(retired.runId)) {
        refuse("The last written product turn does not identify a completed original Codex request.");
      }
      const providerId = retired.assistantSelection.modelProviderId;
      const appContext = codexRuntimeContext({ env, home: env.HOME || homedir(), systemRoot });
      const providerOptions = providerId === "openai" ? {} :
        await createCodexProviderConnectionStore({ systemRoot }).runtimeOptions(providerId);
      const context = providerId === "openai" ? appContext :
        codexRuntimeContext({ env, home: env.HOME || homedir(), systemRoot, providerOptions });
      if (appContext.ok !== true || context.ok !== true) refuse("The original Codex credential home could not be resolved. Restore the original daemon configuration.");
      // The existing host's binding fence uses app HOME, while its selected
      // native runtime uses the provider HOME. Preserve both actual owners.
      const configRoot = path.join(appContext.toolHomeSource, ".codex");
      const nativeRoot = path.join(context.toolHomeSource, ".codex");
      const sqliteHome = context.env.CODEX_SQLITE_HOME || nativeRoot;
      if (!path.isAbsolute(sqliteHome)) refuse("The original native SQLite home is not an absolute trusted path.");
      const goalPath = path.join(sqliteHome, "goals_1.sqlite");
      await verifyUpgradeParents(sqliteHome, goalPath);
      const goal = await readCodexNativeGoal(goalPath, { threadId: retired.conversationId });
      if (goal !== null && !["paused", "complete"].includes(goal.status)) {
        refuse("The original native Codex goal is not paused or complete. Resolve it through its original owner before retrying.");
      }
      const paths = [];
      for await (const relative of glob([
        `sessions/*/*/*/rollout-*-${retired.conversationId}.jsonl*`,
        `archived_sessions/rollout-*-${retired.conversationId}.jsonl*`
      ], { cwd: nativeRoot })) paths.push(path.join(nativeRoot, relative));
      if (paths.length !== 1 || !paths[0].endsWith(".jsonl")) {
        refuse("The original native Codex rollout is missing, ambiguous or compressed. Keep its original files unchanged until supported inspection is possible.");
      }
      const nativePath = paths[0];
      await verifyUpgradeParents(nativeRoot, nativePath);
      const before = await lstat(nativePath);
      if (!before.isFile() || before.isSymbolicLink() || await realpath(nativePath) !== nativePath) refuse("The original Codex rollout is not a canonical regular file.");
      const file = await open(nativePath, "r");
      let metadataCount = 0, activeRun = "", lastRun = "", lastInput = null, lastAuthoredInput = null,
        finalText = "", lastCompletedRun = "", completionError = null, contextCount = 0;
      try {
        for await (const { row } of readCodexHistoryRows(file, 0, before.size, new AbortController().signal, { strictComplete: true })) {
          const value = row.payload;
          if (row.type === "session_meta") {
            metadataCount++;
            if (value?.id !== retired.conversationId || value.cwd !== scopeWorkdir || value.model_provider !== providerId || value.forked_from_id || value.parent_thread_id ||
                value.history_base != null || value.forked_from_ordinal_exclusive != null || value.subagent_history_start_ordinal != null ||
                value.source?.subagent != null || value.thread_source === "subagent" ||
                value.session_id !== undefined && !uuid.test(value.session_id) ||
                value.history_mode !== undefined && !["legacy", "paginated"].includes(value.history_mode) ||
                value.dynamic_tools !== undefined && (!Array.isArray(value.dynamic_tools) || value.dynamic_tools.length)) refuse("The original Codex rollout does not prove this exact private native scope and provider.");
          }
          // Qualified original0.151/0.156 and current0.159 formats retain the
          // raw rollout across compaction. Inspect actual rows, not replacement
          // projections or creation-version guesses; Undo changes causality.
          if (row.type === "event_msg" && value?.type === "thread_rolled_back") {
            refuse("This original Codex rollout has an unsupported rewound history. Preserve it for its original owner.");
          }
          if (row.type === "event_msg" && value?.type === "task_started") {
            if (activeRun || !uuid.test(value.turn_id || "")) refuse("The original Codex rollout has overlapping or unconfirmed native work.");
            activeRun = lastRun = value.turn_id;
            finalText = "";
            completionError = null;
            contextCount = 0;
            lastInput = null;
          }
          if (row.type === "response_item" && value?.type === "message" && value.role === "user") {
            if (!activeRun) refuse("The original Codex rollout has a newer or unattributed native input.");
            const text = (value.content || []).filter(part => ["input_text", "text"].includes(part.type)).map(part => part.text).join("\n");
            try { lastInput = JSON.parse(text); } catch { lastInput = null; }
            if (lastInput?.userMessages?.length) lastAuthoredInput = lastInput;
          }
          if (row.type === "response_item" && value?.type === "message" && value.role === "assistant" &&
              activeRun && (!value.phase || value.phase === "final_answer")) {
            finalText = (value.content || []).filter(part => ["output_text", "text"].includes(part.type)).map(part => part.text).join("\n");
          }
          if (row.type === "event_msg" && value?.type === "task_complete") {
            if (!activeRun || value.turn_id !== activeRun) refuse("The original Codex completion does not match its active native turn.");
            if (typeof value.last_agent_message === "string") finalText = value.last_agent_message;
            completionError = value.error;
            lastCompletedRun = activeRun;
            activeRun = "";
          }
          if (row.type === "event_msg" && value?.type === "turn_aborted") {
            activeRun = "";
            lastCompletedRun = "";
          }
          if (row.type === "turn_context" && value?.turn_id === lastRun) {
            contextCount++;
            if (value.cwd !== scopeWorkdir || value.model !== retired.assistantSelection.modelId) {
              refuse("The original Codex turn context differs from the retained private scope or selected model.");
            }
          }
        }
      } catch (error) {
        if (error instanceof SyntaxError) refuse("The original Codex rollout contains an unreadable native record. Inspect it privately before retrying.");
        throw error;
      } finally { await file.close(); }
      if (metadataCount !== 1 || activeRun || lastRun !== retired.runId || lastCompletedRun !== retired.runId || completionError || contextCount < 1 ||
          (autonomous ? lastInput?.autonomous !== true || typeof lastInput.readOnly !== "boolean" ||
            !Array.isArray(lastInput.userMessages) || lastInput.userMessages.length ||
            !Array.isArray(lastInput.observations) || !lastInput.observations.length :
            lastInput?.autonomous !== false || typeof lastInput.readOnly !== "boolean" || !Array.isArray(lastInput.userMessages) ||
            lastAuthoredInput?.userMessages?.at(-1)?.messageId !== authored.messageId ||
            lastAuthoredInput?.userMessages?.at(-1)?.text !== authored.text)) {
        refuse("The original Codex history does not prove the exact final admitted product request with no newer native work.");
      }
      let envelope;
      try { envelope = readAssistantResponseEnvelope(finalText); }
      catch { refuse("The original native Codex final answer is not a complete Colleague response."); }
      if (envelope.kind !== "reply" || envelope.text !== answer) refuse("The original native Codex answer differs from its written product reply.");
      // Original schema1 had no account digest. Trusted native home and exact
      // scoped history retain custody; fresh native admission still checks the
      // present account before starting any new turn through the shared server.
      return update({ threadId: retired.conversationId, workdir: scopeWorkdir, configRoot,
        executionId: "", processInstanceId: "", toolSchemaIdentity: emptyCodexToolSchema }, async () => {
        const after = await lstat(nativePath);
        if (["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key => before[key] !== after[key]) ||
            !isDeepStrictEqual(await readCodexNativeGoal(goalPath, { threadId: retired.conversationId }), goal)) {
          refuse("The original Codex history or goal changed during inspection. Keep its writers stopped before retrying.");
        }
      });
    }
    if (engine === "opencode") {
      if (!/^msg_[a-zA-Z0-9_]{1,256}$/u.test(retired.runId)) {
        refuse("The last written product turn does not identify a completed original OpenCode request.");
      }
      const serviceRoot = resolveVibe64ServiceDataRoot({ systemRoot, env });
      const databasePath = path.join(serviceRoot, "opencode", "opencode.db");
      await verifyUpgradeParents(serviceRoot, databasePath);
      const before = await lstat(databasePath);
      const rows = [];
      let admitted = false, lastAuthoredInput = null;
      const native = await readOpenCodeConversationDatabase({ databasePath, conversationId: retired.conversationId,
        onMessage(message) {
          if (message.type === "user") {
            const input = originalOpenCodeInput(message);
            if (Array.isArray(input?.userMessages) && input.userMessages.length) lastAuthoredInput = input;
          }
          if (message.id === retired.runId && message.type === "user") admitted = true;
          if (admitted) rows.push(message);
        } });
      if (native.session.directory !== scopeWorkdir || native.session.parent_id || native.session.revert || !admitted) {
        refuse("The native OpenCode session does not prove the original private scope and exact unrewound request.");
      }
      const latestInput = originalOpenCodeInput(rows[0]);
      if (!autonomous) {
        const authored = lastTurn.messages.find(message => message.role === "user");
        const native = lastAuthoredInput?.userMessages?.at(-1);
        if (latestInput?.autonomous !== false || typeof latestInput.readOnly !== "boolean" || !Array.isArray(latestInput.userMessages) ||
            !authored || native?.messageId !== authored.messageId || native?.text !== authored.text) {
          refuse("The original OpenCode input does not match the last authored product request.");
        }
      }
      if (autonomous) {
        if (latestInput?.autonomous !== true || typeof latestInput.readOnly !== "boolean" ||
            !Array.isArray(latestInput.userMessages) || latestInput.userMessages.length ||
            !Array.isArray(latestInput.observations) || !latestInput.observations.length) {
          refuse("The original OpenCode update does not match its watched-conversation input.");
        }
      }
      const current = openCodeRowsForInput(rows, retired.runId);
      const final = openCodeLastAssistantResult(current);
      if (rows.at(-1)?.type !== "assistant" || current.at(-1) !== rows.at(-1) || final.error || final.message?.summary ||
          !(final.message?.time?.completed || final.message?.finish) || final.message?.finish === "tool-calls") {
        refuse("Native OpenCode history has newer or unconfirmed work, or no final answer for the original request.");
      }
      let envelope;
      try { envelope = readAssistantResponseEnvelope(openCodeStructuredOutput(final.text)); }
      catch { refuse("The original native OpenCode answer is not a complete Colleague response."); }
      if (envelope.kind !== "reply" || envelope.text !== answer) refuse("The original native OpenCode answer differs from its written product reply.");
      // The original store had no historical per-thread credential digest. Do not
      // invent one: the existing fresh admission validates and pins the current
      // selected connection before any new work, through the original shared host.
      return update({ sessionId: retired.conversationId, workdir: scopeWorkdir,
        directory: path.join(scopeWorkdir, "native", segmentId), databasePath,
        executionId: "", processDirectory: "" }, async () => {
        await readStoppedNativeDatabase(databasePath, () => {});
        const after = await lstat(databasePath);
        if (["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key => before[key] !== after[key])) {
          refuse("Native OpenCode history changed during inspection. Stop all writers before retrying.");
        }
      });
    }
    const receiptPath = path.join(scopeWorkdir, "claude-conversations", saved.scopeId, `${retired.conversationId}.json`);
    await verifyUpgradeParents(systemRoot, receiptPath);
    const receiptBytes = await readUpgradeFile(receiptPath);
    if (receiptBytes === null) refuse("The original scoped Claude receipt is missing. Restore it before retrying.");
    const receipt = parse(receiptBytes, "Scoped Claude receipt");
    if (receipt.schemaVersion !== 1 || receipt.persistent !== true || receipt.main !== false ||
        receipt.sent !== true || receipt.state !== "completed" || receipt.executionId !== "" ||
        receipt.turnId !== retired.runId || receipt.lastMessageId !== retired.runId ||
        !/^sha256:[a-f0-9]{64}$/u.test(receipt.accountIdentity || "") ||
        !receipt.accountIdentities || typeof receipt.accountIdentities !== "object" || Array.isArray(receipt.accountIdentities) ||
        receipt.accountIdentities[retired.assistantSelection.modelProviderId] !== receipt.accountIdentity) {
      refuse("The original scoped receipt does not prove a stopped completed turn and exact account pin. Inspect it before retrying.");
    }
    const workdir = await realpath(env.HOME || homedir());
    const configRoot = path.resolve(scopeWorkdir, env.CLAUDE_CONFIG_DIR || path.join(env.HOME || homedir(), ".claude"));
    if (receipt.nativeWorkdir !== workdir) refuse("The receipt belongs to another credential home. Restore the original daemon configuration.");
    const binding = { conversationId: retired.conversationId, workdir, scopeWorkdir, configRoot,
      executionId: "", sent: true };
    const connections = createCodexProviderConnectionStore({ systemRoot });
    const verifyAccounts = async () => {
      const identities = {};
      for (const [providerId, identity] of Object.entries(receipt.accountIdentities)) {
        if (!/^sha256:[a-f0-9]{64}$/u.test(identity)) refuse("A retained Claude account pin is invalid.");
        if (providerId === "anthropic") {
          identities.anthropic = identity.slice("sha256:".length);
          continue;
        }
        if (!curatedCodexProvider(providerId)) refuse("A retained Claude provider is unsupported. Keep its original state until it can be verified.");
        let settings;
        try { settings = await connections.claudeProviderSettings(providerId); }
        catch { refuse("Reconnect the exact original Claude provider key in AI Accounts before converting this history."); }
        if (!settings || claudeProviderAccountIdentity(configRoot, settings.providerId, settings.apiKey) !== identity) {
          refuse("A retained Claude provider key has changed. Restore the original connection before converting this history.");
        }
        identities[providerId] = claudeConnectionIdentity(configRoot, providerId, settings.baseUrl, settings.apiKey);
      }
      return identities;
    };
    const accountIdentities = await verifyAccounts();
    if (accountIdentities.anthropic) binding.accountIdentity = accountIdentities.anthropic;
    const externalIdentities = Object.fromEntries(Object.entries(accountIdentities).filter(([id]) => id !== "anthropic"));
    if (Object.keys(externalIdentities).length) binding.connectionIdentities = externalIdentities;
    const inventory = await listClaudeConversationStorage({ configRoot, binding });
    if (!inventory.some(item => item.conversationId === binding.conversationId)) refuse("The original native history is missing or not a regular file.");
    const nativeFile = await claudeHistoryPath(binding);
    if (!nativeFile) refuse("The original active native transcript is missing.");
    await verifyUpgradeParents(configRoot, nativeFile.path);
    const before = await lstat(nativeFile.path);
    if (!before.isFile()) refuse("The original active native transcript must be a regular file.");
    const history = await readClaudeHistory({ ...binding, allowIncompleteTail: false,
      includeUserMessages: true, includeFinalCarriers: true });
    if (!history.exists || history.userIds.at(-1) !== receipt.lastMessageId || history.goal?.status === "active" ||
        history.failedResults.some(result => result.userId === receipt.lastMessageId)) {
      refuse("Native history has a newer/unconfirmed request, active goal or no final answer for the exact stopped turn. Inspect it before retrying.");
    }
    let latestInput = null, lastAuthoredInput = null;
    for (const message of history.userMessages) {
      let input;
      try { input = JSON.parse(message.text); } catch { /* Native meta input is not authored work. */ }
      if (Array.isArray(input?.userMessages) && input.userMessages.length) lastAuthoredInput = input;
      if (message.id === receipt.lastMessageId) latestInput = input;
    }
    if (!autonomous) {
      const authored = lastTurn.messages.find(message => message.role === "user");
      const native = lastAuthoredInput?.userMessages?.at(-1);
      if (latestInput?.autonomous !== false || typeof latestInput.readOnly !== "boolean" || !Array.isArray(latestInput.userMessages) ||
          !authored || native?.messageId !== authored.messageId || native?.text !== authored.text) {
        refuse("The original Claude input does not match the last authored product request.");
      }
    } else if (latestInput?.autonomous !== true || typeof latestInput.readOnly !== "boolean" ||
            !Array.isArray(latestInput.userMessages) || latestInput.userMessages.length ||
            !Array.isArray(latestInput.observations) || !latestInput.observations.length) {
      refuse("The original Claude update does not match its watched-conversation input.");
    }
    const completed = history.completedResults.filter(result => result.userId === receipt.lastMessageId);
    const structured = history.structuredOutputs.filter(result => result.userId === receipt.lastMessageId);
    const plain = history.messages.filter(message => message.role === "assistant" && message.userId === receipt.lastMessageId && message.text.trim());
    // A native successful result has the original live owner's authority. A
    // recorded StructuredOutput is only a candidate: the completed scoped
    // receipt and exact last input must also qualify, with no competing value.
    const finals = completed.length ? [completed.at(-1)] : structured.length ? structured : plain.slice(-1);
    if (!finals.length) refuse("The original native Claude history has no final carrier for its stopped completed receipt.");
    for (const final of finals) {
      let envelope;
      try { envelope = readAssistantResponseEnvelope(final.text); }
      catch { refuse("The original native Claude answer is not a complete Colleague response."); }
      if (envelope.kind !== "reply" || envelope.text !== answer) refuse("The original native Claude answer differs from its written product reply.");
    }
    return update(binding, async () => {
      if (!isDeepStrictEqual(await verifyAccounts(), accountIdentities)) refuse("A retained Claude provider key changed during inspection. Stop its writers before retrying.");
      const after = await lstat(nativeFile.path);
      if (!after.isFile() || ["dev", "ino", "size", "mtimeMs", "ctimeMs"].some(key => before[key] !== after[key]) ||
          await readUpgradeFile(receiptPath) !== receiptBytes) refuse("Native history or its receipt changed during inspection. Stop all writers before retrying.");
    });
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
      report("warning", `${record.ownerKey}: retain the exact original native identity and verified scope; no old request will be replayed. Stop all services and native writers before applying. Fresh account validation still runs before subsequent native work.`);
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
