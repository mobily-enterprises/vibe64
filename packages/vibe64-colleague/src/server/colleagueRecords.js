import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createConversationTranscript, createConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { COLLEAGUE_TOOL_LIMITS } from "./protocol.js";
import { createConversationSummary } from "./conversationSummary.js";
import { assignmentCommands, assignmentSummary, createAssignmentOperations } from "./assignments.js";
import { COLLEAGUE_MODEL_UNAVAILABLE, failure } from "./colleagueFailure.js";
import { colleagueHistoryMessages, publicWatch, releaseObserver } from "./colleaguePresentation.js";
import { ACTION_COLLEAGUE_ASSIGNMENT_CREATE, ACTION_COLLEAGUE_CONTEXT_READ } from "./colleagueActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").ColleagueServiceState} ColleagueServiceState */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

// Learn threads teach; only Develop delegates work. Develop can still read and
// switch the mode for the person. Learn threads watch only their lesson's
// practice project (the service decides).
const LEARN_ONLY_ACTION = /^vibe64\.training\.(?!learning-mode\.(?:read|set)$)|^vibe64\.colleague\.navigation\.open-learning$/u;
const DEVELOP_ONLY_ACTIONS = new Set([ACTION_COLLEAGUE_ASSIGNMENT_CREATE]);
// Main's own goal controls act on the Main conversation running them; Colleague never has them.
const MAIN_ONLY_ACTIONS = new Set([
  "vibe64.terminals.main-goal.pause",
  "vibe64.terminals.main-goal.resume",
  "vibe64.terminals.main-goal.block"
]);

function readToolArguments(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}
function receiptText(value, maximum = 256) {
  const text = typeof value === "string" ? value.trim() : "";
  return text ? text.slice(0, maximum) : "";
}
function operationLabel(actionId) {
  const words = String(actionId || "").split(".").filter(Boolean).filter((word, index) => index || word !== "vibe64")
    .slice(-3).join(" ").replaceAll("-", " ").trim();
  return words ? `${words[0].toUpperCase()}${words.slice(1)}` : "Application operation";
}
function directToolName(actionId) {
  return String(actionId || "").trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
}
function publicOperation(call, activeRunId) {
  const receipt = call?.productReceipt;
  const legacyUnfinished = !receipt?.actionId && ["running", "unknown"].includes(call?.status) && receiptText(call?.name, 300);
  if (!call || !receipt?.actionId && !legacyUnfinished) return null;
  const actionId = receipt?.actionId || legacyUnfinished;
  const failed = call.status === "not-executed" || call.status === "complete" && call.result?.ok === false;
  const status = call.status === "running" ? receipt?.runId && receipt.runId === activeRunId ? "executing" : "unknown"
    : call.status === "unknown" ? "unknown" : failed ? "failed"
      : call.status === "complete" ? "completed" : "unknown";
  const error = status === "unknown"
    ? "The outcome could not be verified. Inspect the target before requesting another execution."
    : failed ? receiptText(call.result?.error?.message, 512) || "The operation failed." : "";
  const errorStatus = Number(call.result?.error?.status);
  return {
    id: call.id,
    actionId,
    label: receipt?.label || (legacyUnfinished ? "Unfinished application operation" : operationLabel(actionId)),
    status,
    at: call.at || "",
    ...(receipt?.target ? { target: { ...receipt.target } } : {}),
    ...(error ? { error } : {}),
    canPrepareRetry: call.status === "not-executed" || call.status === "complete" && call.result?.ok === false &&
      Number.isInteger(errorStatus) && errorStatus < 500
  };
}

/**
 * Each thread's conversation record: the storage the conversation runtimes
 * read and write it through, its saves (with the operation receipts and
 * assignment dependencies they settle), the tools its turns may call, and what
 * a save or a reply announces to the person's browsers.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {TerminalsService} dependencies.terminals
 * @param {RuntimeEvents} dependencies.events
 * @param {ColleagueServiceState} dependencies.serviceState
 * @param {RuntimeLogger} dependencies.logger
 */
function createColleagueRecords({
  actions,
  terminals,
  events,
  serviceState,
  logger
}) {
  const storage = createConversationStorage({
    async readRecord(key) {
      const state = serviceState.conversationOwners.get(key);
      if (!state) {
        throw failure("This Colleague history is unavailable.", "conversation_forbidden", 403, {
          messageCode: "vibe64_colleague_history_unavailable"
        });
      }
      const record = state.record.runtimeId === key ? state.record :
        state.record.previousConversations.find(old => old.runtimeId === key);
      // A record keeps the compaction summary its conversation runtime writes, when it has one.
      return {
        metadata: record.conversationMetadata || {},
        turns: new Map(record.conversationLog.map(turn => [turn.turnId, turn])),
        ...(record.conversationSummary ? { summary: record.conversationSummary } : {})
      };
    },
    async writeRecord(key, { turns, metadata, summary }, transaction) {
      const state = serviceState.conversationOwners.get(key);
      if (!state || state.record.runtimeId !== key) {
        throw failure("Previous Colleague conversations are read-only.", "conversation_forbidden", 403, {
          messageCode: "vibe64_colleague_previous_conversation_read_only"
        });
      }
      const conversationLog = await Promise.all([...turns.keys()].map(id => transaction.readTurn(id)));
      decorateOperationReceipts(state, conversationLog);
      const selected = state.selecting;
      const selectedConfiguration = selected?.configuration;
      const committedSelection = selected && !metadata.runtime?.replacement && metadata.runtime?.engine === selected.engine &&
        JSON.stringify(metadata.runtime.configuration) === JSON.stringify(selectedConfiguration);
      await persist(state, {
        conversationLog,
        ...(committedSelection ? { assistantSelection: selected.assistantSelection } : {}),
        ...(Object.keys(metadata).length || state.record.conversationMetadata ? { conversationMetadata: metadata } : {}),
        ...(summary ? { conversationSummary: summary } : {})
      }, key);
    }
  });
  const transcript = createConversationTranscript({ storage });
  const assignments = createAssignmentOperations({
    actions,
    persist,
    transcript
  });
  const summaries = createConversationSummary({
    actions,
    terminals,
    persist
  });
  const toolPolicy = ({ actionId, kind, context }) => !MAIN_ONLY_ACTIONS.has(actionId) &&
    (context.colleague.thread === "learn" ? !DEVELOP_ONLY_ACTIONS.has(actionId) : !LEARN_ONLY_ACTION.test(actionId)) &&
    (!context.colleague.autonomous || kind === "query" ||
      !context.colleague.readOnly && assignmentCommands.has(actionId));
  const catalog = createServiceToolCatalog(actions, { ...COLLEAGUE_TOOL_LIMITS, isActionAvailable: toolPolicy });

  function decorateOperationReceipts(state, conversationLog) {
    const previous = new Map(state.record.conversationLog.flatMap(turn =>
      (turn.metadata?.applicationTools || []).flatMap(call => call.productReceipt
        ? [[`${turn.turnId}\u0000${call.id}`, call.productReceipt]] : [])));
    for (const turn of conversationLog) {
      for (const call of turn.metadata?.applicationTools || []) {
        const retained = call.productReceipt || previous.get(`${turn.turnId}\u0000${call.id}`);
        if (retained) {
          call.productReceipt = retained;
          continue;
        }
        const context = state.operationContext;
        if (!context) continue;
        const payload = readToolArguments(call.arguments);
        const discovered = call.name === "assistant_action_execute";
        const descriptor = discovered ? null : catalog.resolveToolSet(context).byName.get(call.name);
        const fallbackAction = discovered || descriptor
          ? null
          : actions.listDefinitions().find(action => directToolName(action.id) === call.name);
        const actionId = receiptText(discovered ? payload.actionId : descriptor?.actionId || fallbackAction?.id, 300);
        if (!actionId) continue;
        const input = discovered && payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
          ? payload.input : payload;
        const focus = context.colleague?.focus || {};
        // The action's project: the one its input names, else the operation context's (the focused project).
        const target = Object.fromEntries([
          ["projectSlug", receiptText(input.projectSlug || context.projectSlug, 200)],
          ["sessionId", receiptText(input.sessionId || focus.sessionId, 200)],
          ["conversationId", receiptText(input.conversationId || focus.conversationId, 200)]
        ].filter(([, value]) => value));
        call.productReceipt = {
          version: 1,
          runId: state.operationRunId,
          actionId,
          label: operationLabel(actionId),
          ...(target.projectSlug ? { target } : {})
        };
      }
    }
  }

  async function persist(state, conversation = null, expectedRuntimeId = null) {
    const operation = state.saving.then(async () => {
      // A released Learn thread's file belongs to Training now.
      if (state.released) return;
      if (expectedRuntimeId && state.record.runtimeId !== expectedRuntimeId) {
        throw failure("Previous Colleague conversations are read-only.", "conversation_forbidden", 403, {
          messageCode: "vibe64_colleague_previous_conversation_read_only"
        });
      }
      assignments.suspendDependencies(state);
      const directory = path.dirname(state.file);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(directory, `${path.basename(state.file, ".json")}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify({ ...state.record, ...conversation }), { mode: 0o600 });
        await rename(temporary, state.file);
        if (conversation) {
          Object.assign(state.record, conversation);
          if (conversation.runtimeId) serviceState.conversationOwners.set(conversation.runtimeId, state);
        }
      } finally {
        await rm(temporary, { force: true });
      }
    });
    state.saving = operation.catch(() => {}); // Waiters only wait; the save's failure reaches its caller.
    // The save's own failure reaches its caller; a failed announcement is logged.
    void operation.then(() => publishBrowserChange(state), () => {})
      .catch(error => logger.warn({ error }, "Colleague's browsers were not told about a saved change."));
    return operation;
  }

  /**
   * Product changes are invalidations, not another conversation transcript.
   * Navigation data is read through the original initiating-browser operation.
   */
  function publishBrowserChange(state) {
    for (const observer of state.browserObservers) {
      // Product invalidation may announce a changed active identity. It grants
      // no access to the old runtime or the new conversation transcript.
      const context = { ...observer.context, colleague: { ...observer.context.colleague, conversationId: undefined } };
      void actions.execute({ actionId: ACTION_COLLEAGUE_CONTEXT_READ, input: {}, context })
        .then(() => {
          if (!state.browserObservers.has(observer)) return;
          try {
            Promise.resolve(observer.listener({ type: "application", interimReply: state.interimReply }))
              .catch(error => logger.warn({ error }, "A Colleague browser observer failed to show a change."));
          } catch { /* A presentation failure does not own the conversation. */ }
          if (observer.context.colleague?.conversationId !== state.record.scopeId) {
            state.browserObservers.delete(observer);
            releaseObserver(observer);
          }
        }, () => {
          state.browserObservers.delete(observer);
          releaseObserver(observer);
        });
    }
  }

  function publishReply(state, completedMessage = null) {
    state.streamRevision += 1;
    const actorId = state.ownerActorId;
    // Realtime replies go only to their authenticated actor; without one, the
    // browser reconciles over HTTP.
    if (!actorId || !events?.publish) return;
    const publish = () => {
      clearTimeout(state.replyTimer);
      state.replyTimer = null;
      void events.publish({
        type: "entity.changed",
        source: "vibe64",
        entity: "colleague",
        operation: "updated",
        entityId: state.record.scopeId,
        actorId,
        scope: { kind: "user", id: actorId },
        realtime: {
          audience: "actor_user",
          event: "vibe64.colleague.reply.changed",
          payload: {
            actorId,
            conversationId: state.record.scopeId,
            streamEpoch: state.streamEpoch,
            streamRevision: state.streamRevision,
            streamingReply: state.streamingReply?.text ? { ...state.streamingReply } : null,
            completedMessage
          }
        }
      }).catch(error => logger.warn({ error }, "Colleague's reply notification was not published; the model turn goes on."));
    };
    if (state.streamingReply?.text && !completedMessage) {
      if (!state.replyTimer) state.replyTimer = setTimeout(publish, 25);
    } else {
      publish();
    }
  }

  async function snapshot(state, clientId = "") {
    const page = await transcript.readConversationLogPage(state.record.runtimeId, { limit: 50, presentation: true });
    const record = state.record;
    const operations = record.conversationLog.flatMap(turn => turn.metadata?.applicationTools || [])
      .map(call => publicOperation(call, state.running ? state.operationRunId : "")).filter(Boolean).slice(-8).reverse();
    return {
      ok: true,
      conversationId: record.scopeId,
      thread: { ...state.thread },
      status: record.status,
      error: record.error,
      ...(!record.assistantSelection && record.error === COLLEAGUE_MODEL_UNAVAILABLE ? { modelSetupRequired: true } : {}),
      assistantSelection: record.assistantSelection,
      operation: operations[0] || null,
      operations,
      messages: page.conversationLog.flatMap((turn) => colleagueHistoryMessages(turn).map((message) => ({
        id: message.outputId || message.messageId || `${turn.turnId}:${message.role}`,
        role: message.role,
        text: message.text,
        at: message.at
      }))),
      streamingReply: state.streamingReply?.text ? { ...state.streamingReply } : null,
      streamEpoch: state.streamEpoch,
      streamRevision: state.streamRevision,
      pagination: page.pagination,
      watches: record.watches.map(publicWatch),
      assignments: (record.assignments || []).map((item) => assignmentSummary(item)),
      navigation: state.connections.get(clientId)?.navigation || null
    };
  }

  return Object.freeze({
    storage,
    transcript,
    assignments,
    summaries,
    catalog,
    persist,
    publishBrowserChange,
    publishReply,
    snapshot
  });
}

export { createColleagueRecords };
