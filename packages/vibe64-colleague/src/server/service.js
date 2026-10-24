import { learningPlaceOpenTo, learningVocabulary, trainingGuideCommand, trainingGuideRequest } from "@local/vibe64-training/shared/learning-vocabulary";
import { createColleagueNavigationCoordination } from "./navigationCoordination.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { createConversationRuntime, createConversationTranscript, createConversationStorage } from "@jskit-ai/assistant-core/server/conversation";
import { codexAppServerTurnStateFromAgentRun } from "@jskit-ai/assistant-core/server/codex-turn";
import { createServiceToolCatalog, runBoundedAssistantToolLoop, readAssistantResponseEnvelope, readPartialAssistantReply } from "@jskit-ai/assistant-core/server";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { readLearningModeFor } from "@local/vibe64-core/server/learningMode";
import { learnThreadFile, learnThreadLearnerKey, registerLearnThreadReleaser } from "@local/vibe64-core/server/learnThreads";
import { COLLEAGUE_TOOL_PAYLOAD_LIMIT, instructions, learnInstructions, nativeInstructions, nativeLearnInstructions } from "./protocol.js";
import { conversationObservation, readWatchedConversation, watchUpdate } from "./attention.js";
import { createWatchSources, stateObservation, stateWatchInput, stateWatchUpdate } from "./watchSources.js";
import { createConversationSummary } from "./conversationSummary.js";
import { assignmentCommands, assignmentSummary, createAssignmentOperations } from "./assignments.js";
import { validateColleagueConversationRecord } from "./conversationRecord.js";

const COLLEAGUE_MODEL_UNAVAILABLE = "Connect an AI and choose an available Colleague model in AI setup before using Colleague.";
// Learn threads teach; only Develop delegates work. Develop can still read and
// switch the mode for the person. Learn threads watch only their lesson's
// practice project (the service decides).
const LEARN_ONLY_ACTION = /^vibe64\.training\.(?!learning-mode\.(?:read|set)$)|^vibe64\.colleague\.navigation\.open-learning$/u;
const DEVELOP_ONLY_ACTIONS = new Set(["vibe64.colleague.assignment.create"]);
const LEARN_WATCH_REFUSAL = "In Learn mode Colleague watches only this lesson's practice project.";

function failure(message, code = "vibe64_colleague_failed", statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}
function requireResult(result) {
  if (result?.ok === false) throw failure(result.error || "The assistant operation failed.", result.code);
  return result;
}
function publicWatch({ cursor, ...watch }) {
  return structuredClone(watch);
}
// The system notice before an autonomous reply to a watch (a conversation or a
// deployment). Turns saved before it was worded for every watch keep theirs.
const WATCH_UPDATE_NOTICE = "An update from what you asked Colleague to watch.";
const WATCH_UPDATE_NOTICES = new Set([WATCH_UPDATE_NOTICE, "An update from your watched conversations."]);
function colleagueHistoryMessages(turn) {
  const runtime = turn.metadata?.runtime;
  if (runtime?.origin === "application" && runtime.completedEnvelope === true) return [];
  return turn.messages.flatMap(message => {
    if (message.role === "system") {
      if (!WATCH_UPDATE_NOTICES.has(message.text) || (runtime
        ? runtime.origin !== "application" || runtime.status !== "complete"
        : !turn.messages.some(item => item.role === "assistant" && item.text?.trim()))) return [];
      // The original notice is presentation, never the wake's private data.
      return [{ messageId: message.messageId, role: message.role, text: message.text, at: message.at }];
    }
    return message.role === "user" || !runtime || runtime.status === "complete" ? [message] : [];
  });
}
function hasUserReceipt(chat, messageId) {
  return chat.conversationLog.some(turn => turn.messages.some(message =>
    message.role === "user" && message.messageId === messageId && message.receipt !== false));
}
function readToolArguments(value) {
  try {
    const parsed = JSON.parse(value || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
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
    id: call.id, actionId, label: receipt?.label || (legacyUnfinished ? "Unfinished application operation" : operationLabel(actionId)), status,
    at: call.at || "", ...(receipt?.target ? { target: { ...receipt.target } } : {}),
    ...(error ? { error } : {}),
    canPrepareRetry: call.status === "not-executed" || call.status === "complete" && call.result?.ok === false &&
      Number.isInteger(errorStatus) && errorStatus < 500
  };
}
function colleagueBrowserState(current) {
  // Preserve Colleague's existing history visibility. Internal prompts and tool
  // receipts stay in the canonical store; the browser receives presentation.
  const conversationLog = current.conversationLog.flatMap(turn => {
    const messages = colleagueHistoryMessages(turn);
    if (!messages.length) return [];
    const runtime = turn.metadata?.runtime;
    const system = messages.find(message => message.role === "system");
    return [{ turnId: turn.turnId, messages,
      ...(system ? { system } : {}),
      user: messages.find(message => message.role === "user") || null,
      assistant: messages.find(message => message.role === "assistant") || null,
      thinking: messages.filter(message => message.role === "thinking"),
      commentary: messages.filter(message => message.role === "commentary"),
      ...(runtime ? { metadata: { runtime: { status: runtime.status, origin: runtime.origin } } } : {}) }];
  });
  const { configuration, ...state } = current;
  return { ...state, conversationLog,
    pendingRequest: current.pendingRequest?.origin === "application" ? null : current.pendingRequest,
    streaming: colleagueBrowserStream(current.streaming) };
}
function colleagueBrowserStream(streaming) {
  return streaming ? { ...streaming, messages: streaming.messages.filter(message =>
    message.completedEnvelope !== true && (message.origin !== "application" || message.role !== "commentary")).map(message =>
    message.status === "inProgress" ? { ...message, text: message.text.replace(/[\uD800-\uDBFF]$/, "") } : message) } : streaming;
}

function createColleagueService({ actions, accounts, terminals, systemRoot, events, watchPollMs = 30000, watchDebounceMs = 250 }) {
  if (!path.isAbsolute(systemRoot || "")) throw new TypeError("Colleague needs the private application system root.");
  const toolLimits = { maxToolArgumentBytes: COLLEAGUE_TOOL_PAYLOAD_LIMIT, maxToolResultBytes: COLLEAGUE_TOOL_PAYLOAD_LIMIT };
  const conversationOwners = new Map();
  const storage = createConversationStorage({
    async readRecord(key) {
      const state = conversationOwners.get(key);
      if (!state) throw failure("This Colleague history is unavailable.", "conversation_forbidden", 403);
      const record = state.record.runtimeId === key ? state.record :
        state.record.previousConversations.find(old => old.runtimeId === key);
      return { metadata: record.conversationMetadata || {},
        turns: new Map(record.conversationLog.map(turn => [turn.turnId, turn])) };
    },
    async writeRecord(key, { turns, metadata }, transaction) {
      const state = conversationOwners.get(key);
      if (!state || state.record.runtimeId !== key) throw failure("Previous Colleague conversations are read-only.", "conversation_forbidden", 403);
      const conversationLog = await Promise.all([...turns.keys()].map(id => transaction.readTurn(id)));
      decorateOperationReceipts(state, conversationLog);
      const selected = state.selecting;
      const selectedConfiguration = selected?.configuration;
      const committedSelection = selected && !metadata.runtime?.replacement && metadata.runtime?.engine === selected.engine &&
        JSON.stringify(metadata.runtime.configuration) === JSON.stringify(selectedConfiguration);
      await persist(state, { conversationLog,
        ...(committedSelection ? { assistantSelection: selected.assistantSelection } : {}),
        ...(Object.keys(metadata).length || state.record.conversationMetadata ? { conversationMetadata: metadata } : {}) }, key);
    }
  });
  const transcript = createConversationTranscript({ storage });
  const assignments = createAssignmentOperations({ actions, persist, transcript });
  const summaries = createConversationSummary({ actions, terminals, persist });
  // One state per conversation thread (Develop, or a Learn thread), keyed by
  // its owner key. A person's browsers are shared by their threads, and only
  // the visible thread has a live runtime.
  const users = new Map();
  const browsers = new Map();
  const visible = new Map();
  // Released attempt threads never reopen: their file belongs to Training.
  const releasedThreads = new Set();
  const toolPolicy = ({ actionId, kind, context }) => actionId !== "vibe64.terminals.main-goal.pause" &&
    (context.colleague.thread === "learn" ? !DEVELOP_ONLY_ACTIONS.has(actionId) : !LEARN_ONLY_ACTION.test(actionId)) &&
    (!context.colleague.autonomous || kind === "query" ||
      !context.colleague.readOnly && assignmentCommands.has(actionId));
  const catalog = createServiceToolCatalog(actions, { ...toolLimits, isActionAvailable: toolPolicy });

  function decorateOperationReceipts(state, conversationLog) {
    const previous = new Map(state.record.conversationLog.flatMap(turn =>
      (turn.metadata?.applicationTools || []).flatMap(call => call.productReceipt
        ? [[`${turn.turnId}\u0000${call.id}`, call.productReceipt]] : [])));
    for (const turn of conversationLog) {
      for (const call of turn.metadata?.applicationTools || []) {
        const retained = call.productReceipt || previous.get(`${turn.turnId}\u0000${call.id}`);
        if (retained) { call.productReceipt = retained; continue; }
        const context = state.operationContext;
        if (!context) continue;
        const payload = readToolArguments(call.arguments);
        const discovered = call.name === "assistant_action_execute";
        const descriptor = discovered ? null : catalog.resolveToolSet(context).byName.get(call.name);
        const fallbackAction = discovered || descriptor ? null : actions.listDefinitions().find(action => directToolName(action.id) === call.name);
        const actionId = receiptText(discovered ? payload.actionId : descriptor?.actionId || fallbackAction?.id, 300);
        if (!actionId) continue;
        const input = discovered && payload.input && typeof payload.input === "object" && !Array.isArray(payload.input)
          ? payload.input : payload;
        const focus = context.colleague?.focus || {};
        const target = Object.fromEntries([
          ["projectSlug", receiptText(input.projectSlug || context.projectSlug || focus.projectSlug, 200)],
          ["sessionId", receiptText(input.sessionId || focus.sessionId, 200)],
          ["conversationId", receiptText(input.conversationId || focus.conversationId, 200)]
        ].filter(([, value]) => value));
        call.productReceipt = { version: 1, runId: state.operationRunId, actionId, label: operationLabel(actionId),
          ...(target.projectSlug ? { target } : {}) };
      }
    }
  }
  const runtimeOptions = { storage, toolCatalog: catalog, persistCommentary: false,
    limits: { ...toolLimits, maxToolCalls: 24, maxInputCharacters: COLLEAGUE_TOOL_PAYLOAD_LIMIT,
      maxFinalReplyCharacters: 16_000, maxApiToolProgressCharacters: 280,
      maxInitialNativeHistoryMessages: 24, maxInitialNativeHistoryMessageCharacters: 2_000,
      codexFinalizingGraceMs: 500, codexFinalizingGraceAfterHistoryRead: true, codexFailureDetailGraceMs: 500 },
    async authorize({ context, conversationId, operation }) {
      const state = await stateFor(context);
      if (conversationId !== state.record.runtimeId) return false;
      await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context });
      if (["send", "wake", "tool"].includes(operation)) {
        if (context.colleague.generation !== state.generation || state.stopping) return false;
        if (context.colleague.autonomous && !context.colleague.observationIds.some(id =>
          state.record.observations.some(observation => observation.id === id))) return false;
        await terminals.requireAssistantSelectionAccess(context.assistantSelection, { vibe64User: authenticatedVibe64User(context) });
      }
      return true;
    },
    connections: { resolve: ({ integrationId, context }) => terminals.resolveConversationConnection({
      integrationId, assistantSelection: context.assistantSelection
    }, { vibe64User: authenticatedVibe64User(context) }) }
  };
  const runtime = createConversationRuntime(runtimeOptions);
  // The same backend/catalogue has two server-owned policies, but each product
  // runtimeId owns only one live handle. Direct API keeps its original policy.
  const nativeRuntime = createConversationRuntime({ ...runtimeOptions, completedEnvelope: true,
    // Native wake admission measures the serialized frame in UTF-16 units:
    // existing L context/framing + 2L raw arguments + L result object + 2L
    // result copied into feedback. Argument/result byte gates remain 256 KiB.
    limits: { ...runtimeOptions.limits, maxInputCharacters: 6 * COLLEAGUE_TOOL_PAYLOAD_LIMIT,
      maxOutputCharacters: 1_670_455 } });
  const watchSources = createWatchSources();
  let closed = false;
  let resolveName = async () => "Colleague";

  function userKey(context) {
    const user = authenticatedVibe64User(context);
    return Buffer.from(String(user?.uid ?? user?.username ?? "local")).toString("base64url");
  }
  // The thread is decided on the server only: Develop's one conversation, or
  // in Learn mode the current attempt's teacher thread (the lobby without one,
  // or while Training is closing the attempt after releasing its thread).
  async function threadFor(context) {
    const user = authenticatedVibe64User(context);
    const mode = await readLearningModeFor(user);
    if (!mode?.on) return { kind: "develop" };
    const learnerKey = learnThreadLearnerKey(user);
    const attemptId = releasedThreads.has(learnThreadKey({ learnerKey, attemptId: mode.currentAttemptId }))
      ? "" : mode.currentAttemptId;
    return { kind: "learn", learnerKey, ...(attemptId ? { attemptId } : {}) };
  }
  const learnThreadKey = ({ learnerKey, attemptId }) => `${learnerKey}:learn${attemptId ? `:${attemptId}` : ""}`;

  async function stateFor(context) {
    const owner = userKey(context);
    // A turn's own operations stay with its thread, whatever the mode is now.
    const pinned = context.colleague?.threadKey;
    if (pinned) {
      const state = await users.get(pinned);
      if (!state || state.userKey !== owner || state.released) {
        throw failure("This Colleague conversation has ended.", "conversation_forbidden", 403);
      }
      return state;
    }
    const thread = await threadFor(context);
    const key = thread.kind === "develop" ? owner : learnThreadKey(thread);
    if (!users.has(key)) users.set(key, loadState(key, owner, thread));
    const loading = users.get(key);
    let state;
    try { state = await loading; }
    catch (error) {
      if (users.get(key) === loading) users.delete(key);
      throw error;
    }
    showThread(state);
    return state;
  }

  // The thread a person's request resolves to becomes the visible one. The
  // thread it replaces keeps its running turn; its live handle is released
  // only after that turn settles, and its watch observations wait.
  function showThread(state) {
    const previous = visible.get(state.userKey);
    if (previous === state) return;
    visible.set(state.userKey, state);
    if (previous) void hideThread(previous).catch(() => {});
  }
  async function hideThread(state) {
    await state.admission;
    while (state.running || state.transfer) await (state.running || state.transfer);
    if (closed || state.released || state.opening || visible.get(state.userKey) === state) return;
    for (const observer of state.browserObservers) observer.release?.();
    state.browserObservers.clear();
    const conversation = state.conversation;
    if (!conversation) return;
    requireResult(await conversation.dispose());
    if (state.conversation !== conversation) return;
    state.conversation = null;
    state.runtimeOwner = null;
    state.host = null;
  }

  // Training closes a lesson attempt: stop using its thread (a running turn
  // is stopped, not awaited, since it may be the very call closing the
  // attempt), then Training moves or removes the thread file.
  async function releaseLearnThread({ learnerKey, attemptId }) {
    const file = learnThreadFile({ systemRoot, learnerKey, attemptId });
    const key = learnThreadKey({ learnerKey, attemptId });
    releasedThreads.add(key);
    const state = await users.get(key)?.catch(() => null);
    users.delete(key);
    if (!state) return rm(file.slice(0, -".json".length), { recursive: true, force: true });
    state.released = true;
    state.generation += 1;
    state.workerAbort?.abort();
    void Promise.resolve(state.conversation?.cancel()).catch(() => {});
    state.pendingMessages = [];
    clearTimeout(state.watchTimer);
    clearTimeout(state.replyTimer);
    if (visible.get(state.userKey) === state) visible.delete(state.userKey);
    for (const observer of state.browserObservers) observer.release?.();
    state.browserObservers.clear();
    await state.saving;
    void (async () => {
      await state.running;
      try { if (state.conversation) await state.conversation.dispose(); }
      finally {
        state.conversation = null;
        for (const chat of [state.record, ...state.record.previousConversations]) conversationOwners.delete(chat.runtimeId);
        await rm(state.root, { recursive: true, force: true });
      }
    })().catch(() => {});
  }
  const unregisterReleaser = registerLearnThreadReleaser(releaseLearnThread);

  async function loadState(key, owner, thread) {
    const develop = thread.kind === "develop";
    const file = develop ? path.join(systemRoot, "colleague", owner, "conversation.json")
      : learnThreadFile({ systemRoot, learnerKey: thread.learnerKey, attemptId: thread.attemptId });
    // A Learn thread keeps its runtime work beside its file, released with it.
    const root = develop ? path.dirname(file) : file.slice(0, -".json".length);
    let saved;
    try { saved = JSON.parse(await readFile(file, "utf8")); }
    catch (error) {
      if (error.code === "ENOENT") saved = undefined;
      else if (error instanceof SyntaxError) throw failure("Colleague's saved history is invalid. The file was left unchanged; restore or repair it, then retry.", "colleague_history_invalid", 503);
      else throw error;
    }
    if (saved && saved.schemaVersion !== 3) throw failure("Run the candidate Vibe64 state upgrade with services stopped before opening this Colleague history; no state was changed.");
    const record = saved || {
      schemaVersion: 3, runtimeId: key, previousConversations: [], scopeId: `colleague_${randomUUID().replaceAll("-", "")}`,
      assistantSelection: null, status: "ready", error: "", conversationLog: []
    };
    try { validateColleagueConversationRecord(record, key); }
    catch {
      throw failure("Colleague's saved history is invalid. The file was left unchanged; restore or repair it, then retry.", "colleague_history_invalid", 503);
    }
    record.watches ||= [];
    record.observations ||= [];
    if (!browsers.has(owner)) browsers.set(owner, new Map());
    const state = {
      key, userKey: owner, thread: develop ? { kind: "develop" } : { kind: "learn", ...(thread.attemptId ? { attemptId: thread.attemptId } : {}) },
      file, root, record, connections: browsers.get(owner),
      saving: Promise.resolve(), admission: Promise.resolve(), running: null,
      streamEpoch: randomUUID(), streamRevision: 0,
      generation: 0, requestContext: null, streamingReply: null,
      operationContext: null, operationRunId: "",
      interimReply: null, projectReply: null,
      stopping: false, rotating: false, opening: 0, conversation: null, host: null, selecting: null, observationIds: [],
      runtimeOwner: null, transfer: null, pendingMessages: [], nextConnection: null, workerAbort: null,
      watchTimer: null, polling: null, watchDirty: false, watchAdmission: Promise.resolve(),
      browserObservers: new Set()
    };
    state.navigation = createColleagueNavigationCoordination({ changed: () => publishBrowserChange(state) });
    if (record.status === "working") {
      record.status = "interrupted";
      record.error ||= "The server restarted. Your history is kept. Inspect unfinished operations before continuing; nothing was repeated.";
    }
    for (const assignment of record.assignments || []) {
      if (assignment.turns.some((turn) => ["reserved", "unknown"].includes(turn.status)) ||
          (assignment.reviewerConversationId && !assignment.reviewCreated)) {
        assignment.status = "needs-user";
        assignment.summary = "An assignment operation was interrupted. Inspect its target before continuing; no request has been repeated.";
        for (const watch of record.watches) if (watch.assignmentId === assignment.assignmentId) watch.status = "paused";
      }
    }
    for (const chat of [record, ...record.previousConversations]) conversationOwners.set(chat.runtimeId, state);
    return state;
  }

  function assertCurrentConversation(state, conversationId) {
    if (conversationId && conversationId !== state.record.scopeId) {
      throw failure("This Colleague conversation has been retained as read-only history. Open the current conversation before sending.", "ACTION_VALIDATION_FAILED", 400);
    }
  }

  async function persist(state, conversation = null, expectedRuntimeId = null) {
    const operation = state.saving.then(async () => {
      // A released Learn thread's file belongs to Training now.
      if (state.released) return;
      if (expectedRuntimeId && state.record.runtimeId !== expectedRuntimeId) throw failure("Previous Colleague conversations are read-only.", "conversation_forbidden", 403);
      assignments.suspendDependencies(state);
      const directory = path.dirname(state.file);
      await mkdir(directory, { recursive: true, mode: 0o700 });
      const temporary = path.join(directory, `${path.basename(state.file, ".json")}.${randomUUID()}.tmp`);
      try {
        await writeFile(temporary, JSON.stringify({ ...state.record, ...conversation }), { mode: 0o600 });
        await rename(temporary, state.file);
        if (conversation) {
          Object.assign(state.record, conversation);
          if (conversation.runtimeId) conversationOwners.set(conversation.runtimeId, state);
        }
      } finally { await rm(temporary, { force: true }); }
    });
    state.saving = operation.catch(() => {});
    void operation.then(() => publishBrowserChange(state)).catch(() => {});
    return operation;
  }

  // Product changes are invalidations, not another conversation transcript.
  // Navigation data is read through the original initiating-browser operation.
  function publishBrowserChange(state) {
    for (const observer of state.browserObservers) {
      // Product invalidation may announce a changed active identity. It grants
      // no access to the old runtime or the new conversation transcript.
      const context = { ...observer.context, colleague: { ...observer.context.colleague, conversationId: undefined } };
      void actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context })
        .then(() => {
          if (!state.browserObservers.has(observer)) return;
          try { Promise.resolve(observer.listener({ type: "application", interimReply: state.interimReply })).catch(() => {}); }
          catch { /* A presentation failure does not own the conversation. */ }
          if (observer.context.colleague?.conversationId !== state.record.scopeId) {
            state.browserObservers.delete(observer);
            observer.release?.();
          }
        }, () => {
          state.browserObservers.delete(observer);
          observer.release?.();
        });
    }
  }

  async function attachBrowserObserver(state, observer, transferring = false) {
    if (state.transfer && !transferring) await state.transfer;
    assertCurrentConversation(state, observer.context.colleague?.conversationId);
    if (!state.conversation || observer.release || !state.browserObservers.has(observer)) return;
    if (observer.attaching) return observer.attaching;
    observer.attaching = (async () => {
      state.opening += 1;
      let conversation;
      try { conversation = await state.runtimeOwner.open({ id: state.record.runtimeId, context: observer.context, host: state.host }); }
      finally { state.opening -= 1; }
      const release = await conversation.subscribe(event => {
        // Both readers apply the same synchronous product projection. Runtime
        // subscriptions reauthorize independently, so their callback order is
        // deliberately not an application presentation guarantee.
        if (observer.context.colleague?.conversationId !== state.record.scopeId) return;
        const projected = state.projectReply?.(event);
        const interimReply = state.interimReply;
        if (event.completedEnvelope === true) {
          observer.listener(projected ? { ...projected, interimReply } : { type: "presentation", interimReply });
          return;
        }
        // Product activity is read through the existing authorized snapshot;
        // model tool inputs and effect receipts are not browser notifications.
        if (event.type === "tool") {
          observer.listener({ type: "presentation", interimReply });
          return;
        }
        // Keep the original autonomous-commentary policy. The shared binding
        // owns streaming and transcript rendering.
        if (event.origin === "application" && event.role === "commentary") {
          // API text can precede its tool classification. Retire that earlier
          // partial when the completed message is identified as commentary.
          if (event.streaming) observer.listener({ type: "message-complete", turnId: event.turnId,
            messageId: event.messageId, streaming: colleagueBrowserStream(event.streaming), interimReply });
          return;
        }
        observer.listener({ ...event, interimReply,
          ...(event.type === "message" && event.status === "inProgress"
            ? { text: event.text.replace(/[\uD800-\uDBFF]$/, "") } : {}),
          ...(event.streaming ? { streaming: colleagueBrowserStream(event.streaming) } : {}) });
      });
      if (!state.browserObservers.has(observer)) release();
      else observer.release = release;
    })();
    try { await observer.attaching; }
    finally { observer.attaching = null; }
  }

  function publishReply(state, completedMessage = null) {
    state.streamRevision += 1;
    const user = authenticatedVibe64User(state.requestContext || {});
    const actorId = String(user?.uid || "");
    // Hosted conversations are private to their authenticated actor. Local mode
    // retains HTTP reconciliation when it has no authenticated realtime audience.
    if (!actorId || !events?.publish) return;
    const publish = () => {
      clearTimeout(state.replyTimer);
      state.replyTimer = null;
      void events.publish({
        type: "entity.changed", source: "vibe64", entity: "colleague", operation: "updated",
        entityId: state.record.scopeId, actorId, scope: { kind: "user", id: actorId },
        realtime: { audience: "actor_user", event: "vibe64.colleague.reply.changed", payload: {
          actorId, conversationId: state.record.scopeId,
          streamEpoch: state.streamEpoch, streamRevision: state.streamRevision,
          streamingReply: state.streamingReply?.text ? { ...state.streamingReply } : null,
          completedMessage
        } }
      }).catch(() => {}); // A notification failure cannot fail or repeat a model turn.
    };
    if (state.streamingReply?.text && !completedMessage) {
      if (!state.replyTimer) state.replyTimer = setTimeout(publish, 25);
    } else publish();
  }

  function actionContext(state, connection) {
    // Do not copy the reserved authorization result from a previous action.
    // The host rechecks this real request for every tool and model exchange.
    return {
      surface: "app", channel: "automation", requestMeta: state.requestContext.requestMeta,
      projectSlug: connection.focus?.projectSlug || "",
      colleague: { userKey: state.userKey, threadKey: state.key, thread: state.thread.kind,
        conversationId: state.record.scopeId, clientId: connection.clientId, focus: connection.focus }
    };
  }

  async function snapshot(state, clientId = "") {
    const page = await transcript.readConversationLogPage(state.record.runtimeId, { limit: 50, presentation: true });
    const record = state.record;
    const operations = record.conversationLog.flatMap(turn => turn.metadata?.applicationTools || [])
      .map(call => publicOperation(call, state.running ? state.operationRunId : "")).filter(Boolean).slice(-8).reverse();
    return {
      ok: true, conversationId: record.scopeId, thread: { ...state.thread }, status: record.status, error: record.error,
      ...(!record.assistantSelection && record.error === COLLEAGUE_MODEL_UNAVAILABLE ? { modelSetupRequired: true } : {}),
      assistantSelection: record.assistantSelection, operation: operations[0] || null, operations,
      messages: page.conversationLog.flatMap((turn) => colleagueHistoryMessages(turn).map((message) => ({
        id: message.outputId || message.messageId || `${turn.turnId}:${message.role}`, role: message.role, text: message.text, at: message.at
      }))),
      streamingReply: state.streamingReply?.text ? { ...state.streamingReply } : null,
      streamEpoch: state.streamEpoch, streamRevision: state.streamRevision,
      pagination: page.pagination,
      watches: record.watches.map(publicWatch),
      assignments: (record.assignments || []).map((item) => assignmentSummary(item)),
      navigation: state.connections.get(clientId)?.navigation || null
    };
  }

  // The person's routed Colleague: the owner's or the team setup's Colleague
  // role. For the owner, recommendations are saved first as session creation
  // does, so an AI connected outside the in-app sign-in is usable without a
  // manual Save; a team member's send never writes a setup.
  async function routedColleague(user) {
    await accounts.initializeModelRouting?.({ vibe64User: user });
    return terminals.resolveAssistantPurpose({ purpose: "colleague" }, { vibe64User: user });
  }

  // An exact selection, or the routed Colleague.
  async function chooseSelection(context, selection) {
    const user = authenticatedVibe64User(context);
    if (selection) {
      const resolved = await terminals.resolveAssistantSelection(selection, { vibe64User: user });
      await terminals.requireAssistantSelectionAccess(resolved, { vibe64User: user });
      return resolved;
    }
    const decision = await routedColleague(user);
    if (!decision.available) throw failure(COLLEAGUE_MODEL_UNAVAILABLE, "vibe64_colleague_model_unavailable");
    return decision.effectiveSelection;
  }

  // Read-only: says whether a send could choose a model now. An unset
  // Colleague role counts when an AI is connected, because a send saves the
  // recommended setup first. Only a definite answer counts; a failed read
  // is left to the send.
  async function selectionAvailable(context) {
    try {
      const user = authenticatedVibe64User(context);
      const decision = await terminals.resolveAssistantPurpose({ purpose: "colleague" }, { vibe64User: user });
      if (decision.available || decision.reasonCode !== "vibe64_assistant_role_unconfigured") return decision.available;
      const catalog = requireResult(await terminals.listAssistantCapabilities({ configuredOnly: "true" }, { vibe64User: user }));
      return (catalog.engines || []).some((engine) => (engine.modelProviders || []).some((provider) => provider.connected === true));
    } catch {
      return true;
    }
  }

  async function openConversation(state, context, settings = {}, transferring = false) {
    if (state.transfer && !transferring) await state.transfer;
    const scopeId = state.record.scopeId, runtimeId = state.record.runtimeId;
    assertCurrentConversation(state, context.colleague?.conversationId);
    let host = state.host;
    if (!host) {
      const workdir = path.join(state.root, scopeId);
      await mkdir(workdir, { recursive: true, mode: 0o700 });
      assertCurrentConversation(state, scopeId);
      host = state.host || terminals.createConversationHost({ id: scopeId, runtimeRoot: workdir, workdir, allowAccountChange: true });
      state.host = host;
    }
    state.opening += 1;
    let conversation;
    try {
      const saved = state.record.conversationMetadata?.runtime;
      const engine = saved?.replacement?.request?.engine === "api" ? "api" : saved?.engine || settings.engine;
      state.runtimeOwner ||= engine === "api" ? runtime : nativeRuntime;
      conversation = await state.runtimeOwner.open({ id: runtimeId, context, host, ...settings });
      assertCurrentConversation(state, scopeId);
      state.conversation = conversation;
    } finally { state.opening -= 1; }
    await Promise.all([...state.browserObservers].map(observer => attachBrowserObserver(state, observer, transferring)));
    assertCurrentConversation(state, scopeId);
    return conversation;
  }

  async function transferConversation(state, context, owner) {
    if (state.runtimeOwner === owner) return state.conversation;
    if (state.opening || [...state.browserObservers].some(observer => observer.attaching)) {
      throw failure("Wait for Colleague's current conversation observer to open before changing its model.");
    }
    const gate = Promise.withResolvers();
    state.transfer = gate.promise;
    try {
      for (const observer of state.browserObservers) {
        observer.release?.();
        observer.release = null;
      }
      // Never open the destination unless the exact previous owner confirmed
      // its disposal. A failed release keeps that owner's handle and binding.
      if (state.conversation) requireResult(await state.conversation.dispose());
      state.conversation = null;
      state.runtimeOwner = owner;
      return await openConversation(state, context, {}, true);
    } finally {
      try { await Promise.all([...state.browserObservers].map(observer => attachBrowserObserver(state, observer, true))); }
      finally { state.transfer = null; gate.resolve(); }
    }
  }

  const promptFor = state => state.thread.kind === "learn" ? learnInstructions : instructions;

  async function prepare(state, context, selection, systemPrompt = promptFor(state)) {
    if (!state.record.assistantSelection) state.record.assistantSelection = await chooseSelection(context, selection);
    context.assistantSelection = state.record.assistantSelection;
    const settings = await terminals.resolveConversationConfiguration(context.assistantSelection, systemPrompt,
      { vibe64User: authenticatedVibe64User(context) });
    const conversation = await openConversation(state, context, !state.record.conversationMetadata?.runtime ? settings : {});
    await conversation.retrySave();
    const current = await conversation.read();
    if (current.replacement) throw failure("A model change is unfinished. Select that model again to finish it before sending another message.");
    if (current.configuration.systemPrompt !== systemPrompt) await conversation.configure({ systemPrompt });
    state.conversation = conversation;
    return conversation;
  }

  async function workerContext(state, connection, generation, autonomous, userMessageIds, isCurrent) {
    let context = actionContext(state, connection);
    const observations = [];
    for (const observation of state.record.observations.slice()) {
      // Persisted notifications may outlive their original project access.
      try {
        const watch = state.record.watches.find(item => item.watchId === observation.watchId);
        if (watch?.source) await readWatch(watch, context);
        else requireResult(await actions.execute({ actionId: "vibe64.sessions.inspect", input: { sessionId: observation.focus.sessionId },
          context: { ...context, projectSlug: observation.focus.projectSlug } }));
        observations.push(observation);
      } catch (error) {
        const watch = state.record.watches.find(item => item.watchId === observation.watchId);
        if (watch?.status === "pending") { watch.status = "paused"; watch.error = `Watching paused: ${error.message}`.slice(0, 512); }
        const assignment = state.record.assignments?.find(item => item.assignmentId === observation.assignmentId);
        if (assignment && ["active", "waiting"].includes(assignment.status)) {
          assignment.status = "needs-user";
          assignment.summary = "Assignment access could not be verified. Resolve access before resuming.";
        }
        state.record.observations = state.record.observations.filter(item => item.id !== observation.id);
        await persist(state);
      }
    }
    if (!isCurrent()) return null;
    if (autonomous && !observations.length) { state.record.status = "ready"; await persist(state); return null; }
    const assignmentIds = observations.filter(observation => state.record.assignments?.some(assignment =>
      assignment.assignmentId === observation.assignmentId && ["active", "waiting"].includes(assignment.status))).map(observation => observation.assignmentId);
    const observedAssignmentIds = observations.flatMap(observation => observation.assignmentId ? [observation.assignmentId] : []);
    const canRelay = (state.record.assignments || []).some(assignment => observedAssignmentIds.includes(assignment.assignmentId) &&
      assignment.status !== "cancelled" && assignment.links?.some(link => state.record.assignments.some(target =>
        target.assignmentId === link.assignmentId && ["active", "waiting"].includes(target.status))));
    const readOnly = autonomous && !assignmentIds.length && !canRelay;
    context = { ...context, colleague: { ...context.colleague, generation, autonomous, readOnly,
      userMessageIds, assignmentIds, observedAssignmentIds,
      observationIds: observations.map(observation => observation.id) } };
    state.operationRunId = randomUUID();
    state.operationContext = context;
    state.observationIds = autonomous ? context.colleague.observationIds : [];
    return { context, observations, readOnly, observedAssignmentIds };
  }

  async function workerData(state, connection, currentContext, autonomous) {
    return { assistantName: await resolveName(), focus: connection.focus,
      userMessageIds: currentContext.context.colleague.userMessageIds, observations: currentContext.observations, readOnly: currentContext.readOnly, autonomous,
      assignments: (state.record.assignments || []).filter(item => ["active", "waiting", "needs-user"].includes(item.status) || currentContext.observedAssignmentIds.includes(item.assignmentId))
        .map(item => {
          const { assignmentId, projectSlug, sessionId, conversationId, status, summary, turnLimit, turnsUsed, waitingForAssignmentId, links } = assignmentSummary(item);
          return { assignmentId, projectSlug, sessionId, conversationId, status, summary, turnLimit, turnsUsed, waitingForAssignmentId, links };
        }),
      ...(state.record.retiredConversation?.operation ? { previousOperation: state.record.retiredConversation.operation } : {}) };
  }

  async function runApi(state, connection, generation, message, admission, controller) {
    const isCurrent = () => !closed && !state.stopping && !controller.signal.aborted && generation === state.generation;
    const autonomous = !message;
    const currentContext = await workerContext(state, connection, generation, autonomous, message ? [message.messageId] : [], isCurrent);
    if (!currentContext) return;
    const { context, observations } = currentContext;
    const hadRuntime = Boolean(state.record.conversationMetadata?.runtime);
    let conversation;
    try { conversation = await prepare(state, context, connection.assistantSelection); }
    catch (error) {
      // Before the first runtime exists, setup cannot have reserved or sent this
      // message. Existing runtimes may retain an earlier unknown native receipt.
      if (!hadRuntime && !state.record.conversationMetadata?.runtime) admission.resolve({ ok: false, error: error.message });
      throw error;
    }
    if (!isCurrent()) return;
    if (state.runtimeOwner === nativeRuntime) {
      // First setup stays in the tracked preparation lifetime. Only the actual
      // prepared owner decides whether this request needs native app admission.
      if (message) {
        const turn = await transcript.writeConversationUserMessage(state.record.runtimeId, {
          messageId: message.messageId, text: message.text });
        if (!turn) throw failure("The authored Colleague message could not be admitted.");
        state.pendingMessages.push({ ...message, turnId: turn.turnId });
        state.nextConnection = connection;
        admission.resolve({ status: "accepted", messageId: message.messageId, turnId: turn.turnId, origin: "user" });
      }
      return runNative(state, connection, generation, controller);
    }
    const data = await workerData(state, connection, currentContext, autonomous);
    const streamId = randomUUID();
    const messageId = message?.messageId || `observation-${randomUUID()}`;
    let replyTurnId = "";
    let progress = null;
    let revision = -1;
    const seenMessages = new Set();
    const projectReply = event => {
      if (!isCurrent()) return;
      if (event.type === "accepted" && event.messageId === messageId) {
        replyTurnId = event.turnId;
      }
      if (!replyTurnId || event.turnId !== replyTurnId) return;
      if (event.type === "tool" && event.call?.status === "running" && !autonomous) {
        // Ported first-interactive acknowledgement: the tool owner has already
        // validated and reserved this call, but has not executed it yet.
        if (!progress) {
          const source = state.streamingReply?.turnId === replyTurnId &&
            state.streamingReply.status === "completed" ? state.streamingReply : null;
          progress = { id: source?.outputId || source?.id || `${replyTurnId}:progress`, turnId: replyTurnId,
            ...(source?.outputId ? { outputId: source.outputId } : {}),
            role: "assistant", text: source?.text.trim() || "Let me check that.",
            at: new Date().toISOString(), status: "completed", streamId, autonomous: false };
        }
        if (state.interimReply === progress && state.streamingReply === progress) return;
        state.interimReply = progress;
        state.streamingReply = progress;
        publishReply(state);
        return;
      }
      if (event.type === "settled") {
        state.interimReply = null;
        return;
      }
      if (event.type === "message" && ["assistant", "commentary"].includes(event.role)) {
        const nextRevision = event.streaming?.revision;
        if (Number.isSafeInteger(nextRevision)) {
          if (nextRevision < revision) return;
          if (nextRevision > revision) { revision = nextRevision; seenMessages.clear(); }
          const key = JSON.stringify([event.messageId, event.role, event.status, event.text]);
          if (seenMessages.has(key)) return;
          seenMessages.add(key);
        }
        if (autonomous && event.role === "commentary") {
          if (state.streamingReply?.id === (event.outputId || event.messageId)) {
            state.streamingReply = null;
            state.interimReply = null;
            publishReply(state);
          }
          return;
        }
        if (progress && (event.role === "commentary" || (event.outputId || event.messageId) === progress.id)) return;
        state.interimReply = null;
        state.streamingReply = { id: event.outputId || event.messageId, turnId: event.turnId,
          ...(event.outputId ? { outputId: event.outputId } : {}), role: "assistant",
          text: event.status === "complete" ? event.text : event.text.replace(/[\uD800-\uDBFF]$/, ""),
          at: new Date().toISOString(), status: event.status === "complete" ? "completed" : "inProgress", streamId, autonomous };
        publishReply(state);
      }
    };
    state.projectReply = projectReply;
    const unsubscribe = await conversation.subscribe(projectReply);
    try {
      const receipt = await conversation[autonomous ? "wake" : "send"]({
        ...(message ? { messageId: message.messageId, text: message.text }
          : { messageId, text: WATCH_UPDATE_NOTICE }), data
      });
      admission.resolve(receipt);
      const result = await conversation.wait();
      if (!isCurrent()) return;
      const turn = result.conversationLog.find(turn => turn.turnId === receipt.turnId);
      if (turn?.metadata?.runtime?.status !== "complete") throw failure(result.error || "Colleague's response did not complete. Your message is kept.");
      const delivered = new Set(observations.map(observation => observation.id));
      state.record.observations = state.record.observations.filter(observation => !delivered.has(observation.id));
      for (const watch of state.record.watches) {
        if (watch.status === "pending" && observations.some(observation => observation.watchId === watch.watchId)) watch.status = watch.once ? "delivered" : "active";
      }
      state.record.status = "ready";
      state.record.error = "";
      state.streamingReply = null;
      state.interimReply = null;
      await persist(state);
      publishReply(state, { id: turn.assistant.outputId || turn.assistant.messageId, role: "assistant", text: turn.assistant.text,
        at: turn.assistant.at, streamId, autonomous });
      scheduleWatches(state);
    } finally {
      if (state.projectReply === projectReply) state.projectReply = null;
      unsubscribe();
    }
  }

  async function runNative(state, connection, generation, controller) {
    const isCurrent = () => !closed && !state.stopping && generation === state.generation && !controller.signal.aborted;
    let autonomous = !state.pendingMessages.length;
    const userMessageIds = [];
    let feedback = "", progressAlreadySaid = "", progress = null;
    let currentContext, prepared, receipt, release, replyTurnId = "", internalMessageId = "";
    let toolSet, toolProject, toolAutonomous, toolReadOnly;
    let streamId = randomUUID();
    const projectReply = event => {
      if (!isCurrent() || state.pendingMessages.length) return;
      if (event.type === "accepted" && event.messageId === internalMessageId) receipt = event;
      if (!receipt || event.turnId !== receipt.turnId) return;
      if (event.type === "tool" && event.call?.id === prepared?.toolCallId && event.call.status === "running") {
        if (!autonomous && !progressAlreadySaid) {
          // This exact completed envelope has already passed the shared parser
          // and durable reservation; it alone supplies the first intent sentence.
          progressAlreadySaid = readAssistantResponseEnvelope(prepared.text).text?.trim() || "Let me check that.";
          progress = { id: `${replyTurnId}:progress`, turnId: replyTurnId, role: "assistant", text: progressAlreadySaid,
            at: new Date().toISOString(), status: "completed", streamId: randomUUID(), autonomous: false };
        }
        state.streamingReply = progress;
        state.interimReply = progress;
        publishReply(state);
        return;
      }
      if (event.completedEnvelope !== true || event.type !== "message" || event.role !== "assistant") return;
      const saved = state.record.conversationLog.find(turn => turn.turnId === receipt.turnId);
      if (saved?.metadata?.runtime?.nativeToolAttempt === true) {
        state.streamingReply = progress;
        publishReply(state);
        return;
      }
      const text = readPartialAssistantReply(event.text);
      if (!text) return;
      state.streamingReply = { id: `${replyTurnId}:assistant`, turnId: replyTurnId, role: "assistant", text,
        at: new Date().toISOString(), status: "inProgress", streamId, autonomous };
      state.interimReply = null;
      publishReply(state);
      // Only decoded product text crosses the browser boundary. A completed
      // native frame is still unvalidated until the shared loop settles it.
      return { type: "message", role: "assistant", turnId: replyTurnId, messageId: `${replyTurnId}:assistant`,
        text, status: "inProgress", origin: autonomous ? "application" : "user" };
    };
    state.projectReply = projectReply;
    try {
      await runBoundedAssistantToolLoop({ prompt: "", signal: controller.signal,
        policy: { maximumResponses: 24 }, completedEnvelope: true,
        limitError: failure("Colleague reached this turn's operation limit. The completed results are kept; send a follow-up to continue."),
        invalidResponseError: ({ nativeToolAttempt }) => failure(nativeToolAttempt
          ? "The model could not send its tool request through Colleague. No application action ran in that response. Your message is kept; retry or choose another model."
          : "The model did not return a valid Colleague response. Your message is kept; try another model or retry.", "vibe64_colleague_response_invalid"),
        async complete(_prompt, { outputSchema, previousResponse }) {
          release?.();
          release = null;
          controller.signal.throwIfAborted();
          if (state.pendingMessages.length) {
            autonomous = false;
            progress = null;
            progressAlreadySaid = "";
            connection = state.nextConnection;
          }
          await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context: actionContext(state, connection) });
          controller.signal.throwIfAborted();
          const messages = state.pendingMessages.splice(0);
          userMessageIds.push(...messages.map(message => message.messageId));
          if (messages.length) replyTurnId = messages.at(-1).turnId;
          currentContext = await workerContext(state, connection, generation, autonomous, [...userMessageIds], isCurrent);
          if (!currentContext) return {};
          if (!feedback && previousResponse?.kind === "invalid") {
            state.streamingReply = progress;
            publishReply(state);
            feedback = previousResponse.nativeToolAttempt
              ? "You called a Vibe64 application tool as a native runtime tool. No application action ran in that response. Do not report that the application tools are unavailable. Return the intended kind=tool envelope through StructuredOutput or completed JSON, following toolUsage; Vibe64 will execute it and provide the result."
              : "Your completed response did not match the required envelope. No tool was executed. Return exactly one valid JSON reply or tool envelope.";
          } else if (!feedback && previousResponse?.kind === "tool") {
            feedback = JSON.stringify({ toolName: previousResponse.toolName, result: previousResponse.result });
          }
          if (!toolSet || toolProject !== currentContext.context.projectSlug || toolAutonomous !== autonomous ||
              toolReadOnly !== currentContext.readOnly) {
            toolSet = catalog.resolveToolSet(currentContext.context);
            toolProject = currentContext.context.projectSlug;
            toolAutonomous = autonomous;
            toolReadOnly = currentContext.readOnly;
          }
          const tools = toolSet.tools.map(catalog.toOpenAiToolSchema);
          const native = state.thread.kind === "learn" ? nativeLearnInstructions : nativeInstructions;
          const systemPrompt = `${native}\n\nAvailable application tools:\n${JSON.stringify(tools)}`;
          const conversation = await prepare(state, currentContext.context, connection.assistantSelection, systemPrompt);
          await conversation.configure({ outputSchema });
          controller.signal.throwIfAborted();
          const data = await workerData(state, connection, currentContext, autonomous);
          const operation = state.record.conversationLog.findLast(turn => turn.metadata?.applicationTools?.length)?.metadata.applicationTools.at(-1);
          const text = JSON.stringify({ ...data, userMessages: messages.map(message => ({ messageId: message.messageId, text: message.text })),
            progressAlreadySaid,
            previousOperation: operation ? { ...operation, toolName: operation.name,
              status: operation.status === "running" ? "executing" : operation.status === "complete" ? "completed" : operation.status }
              : data.previousOperation, feedback });
          feedback = "";
          internalMessageId = randomUUID();
          receipt = null;
          prepared = null;
          streamId = randomUUID();
          state.streamingReply = progress;
          state.interimReply = progress;
          release = await conversation.subscribe(projectReply);
          try { receipt = await conversation.wake({ messageId: internalMessageId, text }, { excludedMessageIds: [...userMessageIds] }); }
          catch (error) {
            if (!isCurrent()) throw error;
            const observed = await conversation.inspectDelivery({ messageId: internalMessageId }).catch(() => null);
            if (observed?.status !== "accepted" || observed.recoveryLimitation) throw error;
            receipt = observed;
          }
          let result;
          try { result = await conversation.wait(); }
          catch (error) {
            if (!isCurrent()) throw error;
            const observed = await conversation.inspectDelivery({ messageId: internalMessageId }).catch(() => null);
            if (observed?.status !== "accepted" || observed.turnId !== receipt.turnId || observed.recoveryLimitation) throw error;
          }
          controller.signal.throwIfAborted();
          let turn = await storage.read(state.record.runtimeId, transaction => transaction.readTurn(receipt.turnId));
          if (turn?.metadata?.runtime?.status !== "complete") {
            // Delivery confirmation cannot turn a settled native failure into
            // a successful response or reopen its stopped execution.
            if (!["failed", "interrupted", "cancelled"].includes(turn?.metadata?.runtime?.status)) {
              const observed = await conversation.inspectDelivery({ messageId: internalMessageId });
              if (observed.status !== "accepted" || observed.turnId !== receipt.turnId || observed.recoveryLimitation) {
                throw failure("Colleague's response did not complete. Your message is kept.");
              }
              turn = await storage.read(state.record.runtimeId, transaction => transaction.readTurn(receipt.turnId));
            }
            if (turn?.metadata?.runtime?.status !== "complete") throw failure(turn?.metadata?.runtime?.error || result?.error ||
              "Colleague's response did not complete. Your message is kept.");
          }
          prepared = await conversation.prepareCompletedResponse({ messageId: internalMessageId, turnId: receipt.turnId },
            { signal: controller.signal, toolSet });
          return prepared;
        },
        async settle({ phase, response }) {
          controller.signal.throwIfAborted();
          if (!isCurrent() || !currentContext) return "end";
          if (phase === "before-parse") {
            await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context: currentContext.context });
            if (state.pendingMessages.length) {
              feedback = "The user supplied new steering while you were responding. No operation from that response was executed. Follow their latest message.";
              return "continue";
            }
            if (autonomous && !currentContext.observations.some(item => state.record.observations.some(pending => pending.id === item.id))) {
              state.record.status = "ready";
              await persist(state);
              return "end";
            }
            return "use";
          }
          if (autonomous) {
            const turn = await transcript.writeConversationSystemMessage(state.record.runtimeId, { text: WATCH_UPDATE_NOTICE });
            replyTurnId = turn.turnId;
          }
          const turn = await prepared.publishReply({ turnId: replyTurnId });
          const delivered = new Set(currentContext.observations.map(observation => observation.id));
          state.record.observations = state.record.observations.filter(observation => !delivered.has(observation.id));
          for (const watch of state.record.watches) {
            if (watch.status === "pending" && currentContext.observations.some(observation => observation.watchId === watch.watchId)) watch.status = watch.once ? "delivered" : "active";
          }
          scheduleWatches(state);
          // Original late-admission boundary: a final written while a new
          // request is entering does not end the shared response allowance.
          await state.admission;
          controller.signal.throwIfAborted();
          if (state.pendingMessages.length) { feedback = "Continue with the user's new message."; return "continue"; }
          state.record.status = "ready";
          state.record.error = "";
          state.streamingReply = null;
          state.interimReply = null;
          await persist(state);
          publishReply(state, { id: turn.assistant.messageId, role: "assistant", text: response.text,
            at: turn.assistant.at, streamId, autonomous });
          return "end";
        }
      });
    } finally {
      release?.();
      if (state.projectReply === projectReply) state.projectReply = null;
    }
  }

  function startWorker(state, connection, message, native = false) {
    const generation = ++state.generation;
    const controller = new AbortController();
    state.workerAbort = controller;
    const admission = Promise.withResolvers();
    admission.promise.catch(() => {});
    state.record.status = "working";
    state.interimReply = null;
    state.running = persist(state).then(async () => {
      if (native === null) {
        const context = actionContext(state, connection);
        const selected = state.record.assistantSelection || await chooseSelection(context, connection.assistantSelection);
        const settings = await terminals.resolveConversationConfiguration(selected, promptFor(state),
          { vibe64User: authenticatedVibe64User(context) });
        native = settings.engine !== "api";
      }
      return native ? runNative(state, connection, generation, controller)
        : runApi(state, connection, generation, message, admission, controller);
    })
      .catch(async error => {
        admission.reject(error);
        if (state.generation !== generation) return;
        state.record.status = "failed";
        state.record.error = error.message;
        await persist(state);
      }).finally(() => {
        // A superseded preparation can finish without calling conversation.send.
        // Only that operation's receipt may acknowledge the authored message.
        admission.resolve({ ok: false, error: "Colleague stopped before this message was sent." });
        if (state.generation === generation) {
          state.streamingReply = null;
          state.interimReply = null;
          publishReply(state);
          publishBrowserChange(state);
        }
        state.running = null;
        if (state.workerAbort === controller) state.workerAbort = null;
        state.observationIds = [];
        if (state.generation === generation) {
          state.operationContext = null;
          state.operationRunId = "";
        }
        if (!closed && !state.stopping && state.record.status === "ready") {
          if ((native || state.runtimeOwner === nativeRuntime) && state.pendingMessages.length) void startWorker(state, state.nextConnection, null, true).catch(() => {});
          else wakeForObservations(state);
        }
      });
    void state.running.catch(() => {});
    return admission.promise;
  }

  function wakeForObservations(state) {
    if (closed || state.stopping || state.rotating || state.running || !state.requestContext || !state.record.observations.length ||
        state.record.status !== "ready" || visible.get(state.userKey) !== state) return;
    const observation = state.record.observations[0];
    // Reserve the worker synchronously; its preparation resolves the actual
    // backend before the first wake, without an untracked parallel preparation.
    void startWorker(state, { clientId: "", focus: observation.focus }, null,
      state.runtimeOwner ? state.runtimeOwner === nativeRuntime : null).catch(() => {});
  }

  function changeWatches(state, operation) {
    const admitted = state.watchAdmission.then(operation);
    state.watchAdmission = admitted.catch(() => {});
    return admitted;
  }

  function scheduleWatches(state, delay = watchPollMs) {
    // A released Learn thread's watches ended with its lesson attempt.
    if (closed || state.released || state.rotating || !state.requestContext ||
        !state.record.watches.some((watch) => watch.status === "active")) return;
    if (state.watchTimer && delay === watchPollMs) return;
    clearTimeout(state.watchTimer);
    state.watchTimer = setTimeout(() => {
      state.watchTimer = null;
      void pollWatches(state).catch(() => {});
    }, delay);
    state.watchTimer.unref?.();
  }

  // A watch without a source is a project's own coding conversation.
  function watchSource(watch) {
    if (!watch.source) return null;
    const source = watchSources.get(watch.source);
    if (!source) throw failure("This watch's source is unavailable in this runtime.");
    return source;
  }

  async function readWatch(watch, context) {
    const source = watchSource(watch);
    if (!source) return readWatchedConversation(actions, watch, context);
    if (source.kind === "state") return stateObservation(source, await source.read({ ...watch.input }, context));
    return conversationObservation({ ...requireResult(await source.read(watch, context)),
      replyDuringWork: watch.condition === "reply" && !watch.assignmentId });
  }

  async function observeWatch(state, watch) {
    const observation = await readWatch(watch, actionContext(state, { clientId: "", focus: watch }));
    if (closed || state.released || watch.status !== "active") return;
    if (watch.assignmentId && !watch.expectedRunId && observation.latestUserMessageId === watch.messageId && observation.runId !== watch.cursor?.runId) {
      watch.expectedRunId = observation.runId;
    }
    const { cursor, reason } = (watchSource(watch)?.kind === "state" ? stateWatchUpdate : watchUpdate)(watch, observation);
    watch.cursor = cursor;
    watch.error = "";
    if (reason) {
      if (watch.assignmentId) {
        const assignment = state.record.assignments?.find((item) => item.assignmentId === watch.assignmentId);
        if (!assignment || !["active", "waiting"].includes(assignment.status)) { watch.status = "paused"; return; }
        const turn = assignment.turns.find((item) => item.messageId === watch.messageId);
        const correlated = observation.latestUserMessageId ? observation.latestUserMessageId === watch.messageId
          : Boolean(watch.expectedRunId && observation.runId === watch.expectedRunId);
        if (turn && observation.answered && correlated) turn.answerId = observation.answerId;
        assignment.status = correlated ? "active" : "needs-user";
        assignment.summary = !correlated ? "The conversation changed outside this assignment. Inspect it before continuing."
          : observation.attention ? "The agent needs attention; inspect its latest result." : "An agent answered; evaluating the next step.";
      }
      watch.status = "pending";
      state.record.observations.push({ id: randomUUID(), watchId: watch.watchId, question: watch.question, reason,
        ...(watch.assignmentId ? { assignmentId: watch.assignmentId } : {}),
        ...(watch.source ? { source: watch.source } : {}),
        focus: { projectSlug: watch.projectSlug, sessionId: watch.sessionId, conversationId: watch.conversationId },
        ...observation });
    }
  }

  // A teacher watches only the practice project of its own lesson attempt;
  // the watch ends with the attempt (its thread is released).
  async function assertLearnWatchTarget(state, context, projectSlug) {
    const mode = await readLearningModeFor(authenticatedVibe64User(context), { thread: "learn" });
    if (!state.thread.attemptId || mode?.currentAttemptId !== state.thread.attemptId || !mode.practiceSlug ||
        projectSlug !== mode.practiceSlug) throw failure(LEARN_WATCH_REFUSAL, "vibe64_colleague_learn_watch", 403);
  }

  async function suppressWatchObservation(state, watchId) {
    state.record.observations = state.record.observations.filter(item => item.watchId !== watchId);
    await persist(state);
    if (!state.observationIds.length || state.record.observations.some(item => state.observationIds.includes(item.id))) return;
    // Only the notification belongs to this watch. The watched coding
    // conversation keeps running, and the accepted wake remains in history.
    state.generation += 1;
    state.workerAbort?.abort();
    await state.conversation?.cancel();
    await state.running;
    state.streamingReply = null;
    state.interimReply = null;
    state.record.status = "ready";
    state.record.error = "";
    await persist(state);
    publishReply(state);
    if (state.pendingMessages.length) void startWorker(state, state.nextConnection, null, true).catch(() => {});
    else wakeForObservations(state);
  }

  async function pollWatches(state) {
    if (state.released) return;
    if (state.rotating) { state.watchDirty = true; return; }
    if (state.polling) { state.watchDirty = true; return state.polling; }
    state.polling = (async () => {
      for (const watch of state.record.watches) {
        if (closed || !state.requestContext) break;
        if (watch.status !== "active") continue;
        try {
          await observeWatch(state, watch);
        }
        catch (error) {
          if (watch.status !== "active") continue;
          watch.status = "paused";
          watch.error = `Watching paused: ${error.message}`.slice(0, 512);
          const assignment = state.record.assignments?.find((item) => item.assignmentId === watch.assignmentId);
          if (assignment && ["active", "waiting"].includes(assignment.status)) {
            assignment.status = "needs-user";
            assignment.summary = "The assignment's conversation could not be read. Resolve the watch error before resuming.";
          }
        }
      }
      await persist(state);
      wakeForObservations(state);
    })().finally(() => {
      state.polling = null;
      const delay = state.watchDirty ? watchDebounceMs : watchPollMs;
      state.watchDirty = false;
      scheduleWatches(state, delay);
    });
    return state.polling;
  }

  events?.register({
    id: "vibe64.colleague.attention",
    matches: (event) => !closed && event.type === "entity.changed" &&
      (event.source === "vibe64" && event.entity === "session" || watchSources.readsEntity(event.entity)),
    handle(event) {
      // Publishers may still hold a session write lock. Never await a read here.
      const session = event.source === "vibe64" && event.entity === "session";
      for (const pending of users.values()) void pending.then((state) => {
        const payload = event.realtime?.payload || {};
        const relevant = watch => watch.status === "active" && (session
          ? !watch.input && watch.sessionId === event.entityId && (!payload.projectSlug || watch.projectSlug === payload.projectSlug)
          : watchSources.get(watch.source)?.entity === event.entity && watch.projectSlug === event.entityId);
        if (state.record.watches.some(relevant)) scheduleWatches(state, watchDebounceMs);
      });
    }
  });

  const service = {
    browserConversations: {
      async open({ id, context } = {}) {
        // Action contributors own authority; never retain their cached result
        // when a subscription or subsequent model operation checks the request.
        if (closed) throw failure("Colleague is shutting down.");
        const request = context?.requestMeta?.request;
        const requestContext = { surface: "app", channel: "internal", requestMeta: request ? {
          ...context.requestMeta, request: { ...request, headers: request.headers, vibe64User: authenticatedVibe64User(context) }
        } : context?.requestMeta,
          colleague: { userKey: userKey(context), clientId: "", focus: null } };
        await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context: requestContext });
        const state = await stateFor(context);
        if (state.record.previousConversations.some(old => old.scopeId === id)) assertCurrentConversation(state, id);
        if (id !== state.record.scopeId) throw failure("This Colleague conversation is unavailable.", "conversation_forbidden", 403);
        requestContext.colleague.conversationId = id;
        requestContext.assistantSelection = state.record.assistantSelection;
        async function preparedConversation() {
          assertCurrentConversation(state, id);
          if (!state.record.conversationMetadata?.runtime) return null;
          return openConversation(state, requestContext);
        }
        return {
          async read(options = {}) {
            assertCurrentConversation(state, id);
            await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context: requestContext });
            const pageOptions = {};
            for (const key of ["beforeTurnId", "limit"]) {
              if (Object.hasOwn(options, key)) pageOptions[key] = options[key];
            }
            const paged = Object.keys(pageOptions).length > 0;
            const conversation = await preparedConversation();
            // Reading an empty Colleague must not require AI Accounts setup or
            // choose a native engine. Its original transcript remains readable.
            if (!conversation) return colleagueBrowserState({ id, status: "ready", phase: "", error: state.record.error || "", interimReply: state.interimReply,
              capabilities: { steering: false, goals: false, attachments: false }, pendingRequest: null,
              ...(paged ? await transcript.readConversationLogPage(state.record.runtimeId, { ...pageOptions, presentation: true })
                : { conversationLog: await transcript.readConversationLog(state.record.runtimeId, { presentation: true }) }),
              streaming: { revision: 0, messages: [] } });
            const owner = state.runtimeOwner;
            let current = paged ? await conversation.read(pageOptions) : await conversation.read();
            if (paged && owner === runtime) {
              // Ordinary API work may follow private native envelopes. Project
              // before counting/cursor selection through the existing store.
              const page = await transcript.readConversationLogPage(state.record.runtimeId, { ...pageOptions, presentation: true });
              assertCurrentConversation(state, id);
              current = { ...current, ...page };
            }
            return colleagueBrowserState({ ...current, id,
              ...(state.runtimeOwner === nativeRuntime && state.running ? { status: "working" } : {}),
              interimReply: state.interimReply,
              capabilities: { ...current.capabilities, steering: false, goals: false, attachments: false } });
          },
          async send(input) {
            if (input.attachmentIds?.length) throw failure("Colleague does not accept attachments.", "conversation_unsupported");
            return actions.execute({ actionId: "vibe64.colleague.message.send", context: requestContext,
              input: { ...input.data, expectedConversationId: id, messageId: input.messageId, message: input.text }, deps: { receiptOnly: true } });
          },
          async cancel() {
            return actions.execute({ actionId: "vibe64.colleague.turn.stop", input: { expectedConversationId: id }, context: requestContext });
          },
          async select(input) {
            return actions.execute({ actionId: "vibe64.colleague.model.select", input: { ...input, expectedConversationId: id }, context: requestContext });
          },
          async inspectDelivery(input) {
            assertCurrentConversation(state, id);
            await actions.execute({ actionId: "vibe64.colleague.context.read", input: {}, context: requestContext });
            const turn = state.record.conversationLog.find(item => !item.metadata?.runtime?.engine &&
              item.user?.messageId === input.messageId);
            if (turn) return { status: "accepted", messageId: input.messageId, turnId: turn.turnId, origin: "user", duplicate: true };
            const conversation = await preparedConversation();
            return conversation ? conversation.inspectDelivery(input) : { status: "unknown", messageId: input.messageId };
          },
          async readGoal() { return null; },
          async updateGoal() {
            throw failure("Colleague does not support native goals.", "conversation_unsupported", 400);
          },
          async subscribe(listener) {
            if (typeof listener !== "function") throw new TypeError("A conversation listener is required.");
            const observer = { context: requestContext, listener, release: null };
            state.browserObservers.add(observer);
            try { await preparedConversation(); await attachBrowserObserver(state, observer); }
            catch (error) { state.browserObservers.delete(observer); observer.release?.(); throw error; }
            return () => { state.browserObservers.delete(observer); observer.release?.(); };
          }
        };
      }
    },
    // Owners extend what Colleague can watch (watchSources.js).
    registerConversationSource(name, read) { watchSources.registerConversation(name, read); },
    registerWatchSource(source) { watchSources.register(source); },
    listWatchSources() { return { ok: true, sources: watchSources.list() }; },
    // The assistant's watch.source.create: registered state sources only.
    async watchState(input, context) {
      if (watchSources.get(input.source)?.kind !== "state") {
        throw failure("Colleague cannot watch that. watch.sources.read lists what it can watch here.", "vibe64_colleague_failed", 422);
      }
      return service.watch(input, context);
    },
    setNameResolver(resolver) {
      if (typeof resolver !== "function") throw new TypeError("Colleague name resolver must be a function.");
      resolveName = resolver;
    },
    async read(input = {}, context = {}) {
      const state = await stateFor(context);
      state.requestContext = context;
      scheduleWatches(state);
      wakeForObservations(state);
      // Until a send commits a model, every read re-checks current
      // availability, so Teach me and the composer say "no usable model"
      // without sending, and an earlier failure stops blocking them as soon
      // as an AI becomes usable.
      if (!state.record.assistantSelection) {
        const available = await selectionAvailable(context);
        if (available && state.record.error === COLLEAGUE_MODEL_UNAVAILABLE) {
          state.record.error = "";
          if (state.record.status === "failed") state.record.status = "ready";
        }
        const result = await snapshot(state, input.clientId);
        return available ? result : { ...result, modelSetupRequired: true };
      }
      return snapshot(state, input.clientId);
    },
    async startFresh(input, context) {
      const state = await stateFor(context);
      const reported = (input.unconfirmedMessages || []).map(message => ({ ...message,
        source: "client-reported", status: "unconfirmed" }));
      const rotating = state.admission.then(() => changeWatches(state, async () => {
        const previous = state.record.previousConversations.find(old => old.freshOperation.operationId === input.operationId);
        if (previous) {
          if (previous.scopeId !== input.expectedConversationId || !isDeepStrictEqual(previous.unconfirmedMessages, reported)) {
            throw failure("This recovery ID belongs to another request. Use the original request or a new recovery ID.");
          }
          return { operationId: input.operationId, previousConversationId: previous.scopeId,
            conversationId: previous.freshOperation.conversationId, duplicate: true };
        }
        assertCurrentConversation(state, input.expectedConversationId);
        for (const message of reported) {
          const saved = state.record.conversationLog.flatMap(turn => turn.messages).find(saved => saved.messageId === message.messageId);
          if (saved && saved.text !== message.text) throw failure("An unconfirmed message ID belongs to different saved words. Keep the original request before starting fresh.", "ACTION_VALIDATION_FAILED", 400);
        }
        const scopeId = `colleague_${randomUUID().replaceAll("-", "")}`;
        const old = { scopeId: state.record.scopeId, runtimeId: state.record.runtimeId,
          assistantSelection: structuredClone(state.record.assistantSelection),
          status: state.record.status === "working" ? "interrupted" : state.record.status,
          error: state.record.error, conversationLog: structuredClone(state.record.conversationLog),
          ...(state.record.conversationMetadata ? { conversationMetadata: structuredClone(state.record.conversationMetadata) } : {}),
          ...(state.record.retiredConversation ? { retiredConversation: structuredClone(state.record.retiredConversation) } : {}),
          archivedAt: new Date().toISOString(), unconfirmedMessages: structuredClone(reported),
          freshOperation: { operationId: input.operationId, conversationId: scopeId } };
        const patch = { runtimeId: `${state.key}:${scopeId}`, scopeId, status: "ready", error: "",
          conversationLog: [], conversationMetadata: {}, retiredConversation: undefined,
          previousConversations: [...state.record.previousConversations, old] };
        try { validateColleagueConversationRecord({ ...state.record, ...patch }, state.key); }
        catch (error) { throw failure(`Cannot start fresh: ${error.message}`, "ACTION_VALIDATION_FAILED", 400); }
        if (closed || state.stopping || state.running || state.opening || state.transfer || state.summaryRunning || state.record.summaryHelper) {
          throw failure("Finish or stop Colleague's current turn or summary before starting fresh.");
        }
        state.rotating = true;
        try {
          // Suppress autonomous wake while the original chat owner drains. Its
          // watched coding conversations and assignments are never stopped.
          state.generation += 1;
          await state.polling;
          await state.saving;
          if (state.conversation) requireResult(await state.conversation.dispose());
          state.conversation = null;
          state.runtimeOwner = null;
          state.pendingMessages = [];
          state.host = null;
          old.conversationLog = structuredClone(state.record.conversationLog);
          if (state.record.conversationMetadata) old.conversationMetadata = structuredClone(state.record.conversationMetadata);
          old.archivedAt = new Date().toISOString();
          await persist(state, patch, old.runtimeId);
          state.streamingReply = null;
          state.interimReply = null;
          state.projectReply = null;
          clearTimeout(state.replyTimer);
          state.replyTimer = null;
          state.streamEpoch = randomUUID();
          state.streamRevision = 0;
          state.requestContext = context;
          for (const connection of state.connections.values()) {
            connection.acknowledge?.({ ok: false,
              error: "The previous Colleague conversation was retained as history before navigation completed." });
          }
          publishReply(state);
          return { operationId: input.operationId, previousConversationId: old.scopeId,
            conversationId: scopeId, duplicate: false };
        } finally {
          state.rotating = false;
          scheduleWatches(state);
          wakeForObservations(state);
        }
      }));
      state.admission = rotating.catch(() => {});
      const fresh = await rotating;
      return { ...await snapshot(state), fresh };
    },
    async readHistory(input, context) {
      const state = await stateFor(context);
      const offset = input.offset || 0, limit = input.limit || 20;
      const previous = state.record.previousConversations.slice().reverse();
      return { ok: true, conversations: previous.slice(offset, offset + limit).map(old => ({
        conversationId: old.scopeId, archivedAt: old.archivedAt, assistantSelection: old.assistantSelection,
        unconfirmedCount: old.unconfirmedMessages.filter(message => !hasUserReceipt(old, message.messageId)).length
      })), hasMore: offset + limit < previous.length,
      nextOffset: offset + limit < previous.length ? offset + limit : null };
    },
    async readHistoryPage(input, context) {
      const state = await stateFor(context);
      const old = state.record.previousConversations.find(chat => chat.scopeId === input.conversationId);
      if (!old) throw failure("This previous Colleague conversation is unavailable.", "conversation_forbidden", 403);
      const options = { ...(input.beforeTurnId ? { beforeTurnId: input.beforeTurnId } : {}), limit: input.limit || 50 };
      const page = await transcript.readConversationLogPage(old.runtimeId, { ...options, presentation: true });
      const runtimeState = old.conversationMetadata?.runtime;
      const request = runtimeState?.request;
      const unconfirmed = request?.messageId && request.origin !== "application" && (runtimeState.engine === "api" || request.attempted || request.inspectionOnly) &&
        !hasUserReceipt(old, request.messageId);
      return { ok: true, ...colleagueBrowserState({ id: old.scopeId, readOnly: true, ...page }),
        unconfirmedMessages: old.unconfirmedMessages.filter(message => !hasUserReceipt(old, message.messageId)),
        ...(unconfirmed ? { unconfirmedDelivery: { messageId: request.messageId, status: "unconfirmed" } } : {}) };
    },
    async listWatches(_input, context) { return { ok: true, watches: (await snapshot(await stateFor(context))).watches }; },
    async assignment(operation, input, context) {
      const state = await stateFor(context);
      if (operation === "read") return assignments.read(state, input, context);
      return changeWatches(state, async () => {
        if (closed || state.stopping) throw failure("Colleague is stopping.");
        const result = await assignments[operation](state, input, context);
        scheduleWatches(state, watchDebounceMs);
        return result;
      });
    },
    async summarize(input, context) {
      const state = await stateFor(context);
      if (closed || state.stopping || state.summaryRunning) throw failure("Finish or stop the current Colleague summary first.");
      state.requestContext = context;
      const scoped = actionContext(state, { clientId: context.colleague?.clientId || "", focus: { projectSlug: input.projectSlug } });
      state.summaryAbort = new AbortController();
      state.summaryRunning = summaries.read(state, input, scoped).finally(() => { state.summaryRunning = null; state.summaryAbort = null; });
      return state.summaryRunning;
    },
    // A conversation watch names its project, session and conversation (and
    // an owner's conversation source); a state watch names its registered
    // source and that source's input.
    async watch(input, context) {
      const state = await stateFor(context);
      return changeWatches(state, async () => {
        if (closed) throw failure("Colleague is shutting down.");
        const source = input.source ? watchSources.get(input.source) : null;
        const watchedInput = source?.kind === "state" ? stateWatchInput(source, input.input) : null;
        if (watchedInput && !Object.hasOwn(source.conditions, input.condition)) {
          throw failure(`A ${source.label} watch reports ${Object.keys(source.conditions).join(", ")}.`, "vibe64_colleague_failed", 422);
        }
        const target = watchedInput ? { source: input.source, input: watchedInput, projectSlug: watchedInput.projectSlug || "" }
          : { ...(input.source ? { source: input.source } : {}), projectSlug: input.projectSlug, sessionId: input.sessionId,
            conversationId: input.conversationId || "" };
        const existing = state.record.watches.find((watch) => watch.watchId === input.watchId);
        if (existing) {
          if (["source", "projectSlug", "sessionId", "conversationId"].some(key => (existing[key] || "") !== (target[key] || "")) ||
              !isDeepStrictEqual(existing.input || null, target.input || null) ||
              ["condition", "question"].some(key => (existing[key] || "") !== (input[key] || "")) ||
              (existing.once !== false) !== (input.once !== false)) throw failure("This watch ID belongs to a different request. Use a new watch ID.");
          return { ok: true, watch: publicWatch(existing) };
        }
        if (input.source && !source) throw failure("Colleague cannot watch that here.", "vibe64_colleague_failed", 422);
        if (state.thread.kind === "learn") await assertLearnWatchTarget(state, context, target.projectSlug);
        if (state.record.watches.filter((watch) => ["active", "pending", "paused"].includes(watch.status)).length >= 16) throw failure("Cancel an existing watch before adding another; up to 16 can be retained.");
        state.requestContext = context;
        const watch = { watchId: input.watchId, ...target, condition: input.condition, question: input.question,
          once: input.once !== false, status: "active", error: "" };
        // Verify access before retaining the target or admitting a notification.
        await observeWatch(state, watch);
        state.record.watches = state.record.watches.filter((item) => !["delivered", "cancelled"].includes(item.status)).concat(watch);
        await persist(state);
        scheduleWatches(state);
        wakeForObservations(state);
        return { ok: true, watch: publicWatch(watch) };
      });
    },
    async cancelWatch(input, context) {
      const state = await stateFor(context);
      return changeWatches(state, async () => {
        const watch = state.record.watches.find((item) => item.watchId === input.watchId);
        if (watch) {
          watch.status = "cancelled";
          const assignment = state.record.assignments?.find((item) => item.assignmentId === watch.assignmentId);
          if (assignment && ["active", "waiting"].includes(assignment.status)) {
            assignment.status = "needs-user";
            assignment.summary = "Assignment watching was cancelled. Ask Colleague to resume or cancel the assignment.";
          }
        }
        await suppressWatchObservation(state, input.watchId);
        return { ok: true };
      });
    },
    async pauseWatch(input, context) {
      const state = await stateFor(context);
      return changeWatches(state, async () => {
        const watch = state.record.watches.find(item => item.watchId === input.watchId);
        if (!watch || !["active", "pending"].includes(watch.status)) throw failure("Only an active watch can be paused.");
        if (watch.assignmentId) throw failure("Pause the assignment through its retained assignment controls.");
        watch.status = "paused";
        watch.error = "Watching paused by the learner.";
        await suppressWatchObservation(state, input.watchId);
        return { ok: true, watch: publicWatch(watch) };
      });
    },
    async resumeWatch(input, context) {
      const state = await stateFor(context);
      return changeWatches(state, async () => {
        const watch = state.record.watches.find((item) => item.watchId === input.watchId);
        if (!watch || watch.status !== "paused") throw failure("Only a paused watch can be resumed.");
        if (watch.assignmentId) throw failure("Resume the assignment through assignment.update after a new user instruction.");
        state.requestContext = context;
        watch.status = "active";
        try { await observeWatch(state, watch); }
        catch (error) {
          watch.status = "paused";
          watch.error = error.message;
          throw error;
        }
        await persist(state);
        scheduleWatches(state);
        wakeForObservations(state);
        return { ok: true };
      });
    },
    async selectModel(input, context) {
      const state = await stateFor(context);
      const expected = input.expectedConversationId || context.colleague?.conversationId || state.record.scopeId;
      const selecting = state.admission.then(async () => {
        assertCurrentConversation(state, expected);
        if (closed || state.stopping || state.running) throw failure("Finish or stop Colleague's current turn before changing its model.");
        if (!input.assistantSelection) throw failure("Choose a model for Colleague.");
        const selected = await chooseSelection(context, input.assistantSelection);
        const settings = await terminals.resolveConversationConfiguration(selected, promptFor(state), { vibe64User: authenticatedVibe64User(context) });
        const changed = ["engineId", "modelProviderId", "modelId", "agentId", "variantId"]
          .some(key => (state.record.assistantSelection?.[key] || "") !== (selected[key] || ""));
        const pendingRequest = state.record.conversationMetadata?.runtime?.replacement?.request;
        state.requestContext = context;
        const scoped = { ...actionContext(state, { clientId: "", focus: null }), assistantSelection: selected };
        let conversation = state.record.conversationMetadata?.runtime ? await openConversation(state, scoped) : null;
        let current = await conversation?.read();
        const savedRuntime = state.record.conversationMetadata?.runtime;
        if (current?.status === "working" || savedRuntime?.engine === "codex" &&
            codexAppServerTurnStateFromAgentRun(savedRuntime.binding?.codexAppServerRun || {}).active) {
          throw failure("Stop Colleague's previous native turn before changing its model.");
        }
        if (conversation && state.runtimeOwner === nativeRuntime && settings.engine === "api") {
          // The completed native envelope is not the ordinary API's response
          // contract. Remove it through the same idle/authorized config owner
          // before the destination validates the saved configuration.
          if (current.configuration.outputSchema !== undefined) await conversation.configure({ outputSchema: undefined });
          conversation = await transferConversation(state, scoped, runtime);
          current = await conversation.read();
        }
        if (!state.record.conversationMetadata?.runtime || !changed && !pendingRequest) {
          // Preserve the native binding while retaining the common owner's
          // failed-cleanup and storage guards for an unchanged selection.
          if (conversation) await conversation.configure(settings.configuration);
          const previous = state.record.assistantSelection;
          state.record.assistantSelection = selected;
          try { await persist(state); } catch (error) { state.record.assistantSelection = previous; throw error; }
          return;
        }
        // The common runtime owns the native change and continuity. Publish the
        // product selection in the same record commit as its final configuration.
        state.selecting = { ...settings, assistantSelection: selected };
        try {
          // A pending request keeps its original policy, including historical
          // absence, so a retry cannot become a different replacement operation.
          const request = { ...settings,
            operationId: current.replacement?.operationId || randomUUID(), expectedSegmentId: current.segmentId };
          if (pendingRequest) {
            if (Object.hasOwn(pendingRequest, "retireNative")) request.retireNative = pendingRequest.retireNative;
          } else request.retireNative = true;
          await conversation.select(request);
        } finally { state.selecting = null; }
        state.conversation = conversation;
        if (settings.engine !== "api" && state.runtimeOwner === runtime) {
          await transferConversation(state, scoped, nativeRuntime);
        }
        state.record.status = "ready";
        state.record.error = "";
        await persist(state);
      });
      state.admission = selecting.catch(() => {});
      await selecting;
      return snapshot(state);
    },
    async context(_input, context = {}) {
      const state = await stateFor(context);
      assertCurrentConversation(state, context.colleague?.conversationId);
      if (context.colleague?.userKey && context.colleague.userKey !== state.userKey) {
        throw failure("This Colleague conversation is unavailable.", "conversation_forbidden", 403);
      }
      if (context.requestMeta?.request) state.requestContext = context;
      const connection = state.connections.get(context.colleague?.clientId);
      const focused = context.colleague?.focus || connection?.focus || null;
      return { ok: true, focus: focused || {} };
    },
    async focus(input, context, { browserBinding } = {}) {
      const state = await stateFor(context);
      if (browserBinding && !browserBinding.current()) throw failure("This browser focus update is no longer current.");
      const connection = state.connections.get(input.clientId) || { clientId: input.clientId };
      connection.focus = input.focus;
      state.connections.set(input.clientId, connection);
      if (browserBinding) {
        if (connection.browserBinding?.owner !== browserBinding.owner) {
          const owner = browserBinding.owner;
          connection.browserBinding = { owner, async release() {
            const current = state.connections.get(input.clientId);
            if (current?.browserBinding?.owner !== owner) return;
            state.connections.delete(input.clientId);
            current.acknowledge?.({ ok: false, error: "The initiating browser disconnected." });
            current.focus = null;
          } };
        }
        browserBinding.onRelease(connection.browserBinding.release);
      }
      state.requestContext = context;
      return { ok: true, focus: connection.focus };
    },
    async navigate(input, context) {
      const state = await stateFor(context);
      if (input.learning && typeof input.learning.open === "boolean" && (input.learning.attemptId || input.learning.stepId)) {
        return { ok: false, error: "open opens or closes the Courses catalogue only. To show a lesson step in the Lesson pane, send learning={attemptId, stepId} without open." };
      }
      if (input.learning?.stepId && !input.learning.attemptId) {
        return { ok: false, error: "Choose the exact lesson attempt before its step." };
      }
      if (input.learning && typeof input.learning.open !== "boolean" && !input.learning.attemptId) {
        return { ok: false, error: "Send learning={open:true|false} for Courses, or learning={attemptId, stepId} for a lesson step." };
      }
      if (input.planView && (!input.sessionId || input.pane || input.conversationId)) {
        return { ok: false, error: "Choose the exact session's Main chat, without another pane or conversation, to open its plan viewer." };
      }
      if (input.databaseTable && (input.databaseView !== "data" || input.pane !== "database" || !input.sessionId)) {
        return { ok: false, error: "Choose the exact session and Database Data view before selecting a table." };
      }
      if (input.databaseView && (input.pane !== "database" || !input.sessionId)) {
        return { ok: false, error: "Choose the exact session and Database pane before selecting a database view." };
      }
      if ((input.integrationId || input.integrationEnvironment) && (input.pane !== "integrations" ||
          (input.integrationEnvironment !== "production" && !input.sessionId))) {
        return { ok: false, error: "Choose Integrations and either a development session or the production environment." };
      }
      if (!input.sessionId && (input.conversationId || ["session", "changes", "repository", "files", "database", "system", "ai-terminal"].includes(input.pane))) {
        return { ok: false, error: "Choose the exact session before opening this conversation or session view." };
      }
      const connection = state.connections.get(context.colleague?.clientId);
      if (!connection) return { ok: false, error: "The initiating browser is no longer connected." };
      if (connection.navigation?.status === "pending") return { ok: false, error: "The browser is still opening the previous view." };
      const command = { id: randomUUID(), projectSlug: input.projectSlug,
        ...(input.pane ? { pane: input.pane } : {}),
        ...(input.integrationId ? { integrationId: input.integrationId } : {}),
        ...(input.integrationEnvironment ? { integrationEnvironment: input.integrationEnvironment } : {}),
        ...(input.databaseView ? { databaseView: input.databaseView } : {}),
        ...(input.databaseTable ? { databaseTable: input.databaseTable } : {}),
        ...(input.planView ? { planView: input.planView } : {}),
        ...(input.learning ? { learning: typeof input.learning.open === "boolean" ? { open: input.learning.open }
          : { attemptId: input.learning.attemptId, ...(input.learning.stepId ? { stepId: input.learning.stepId } : {}) } } : {}),
        sessionId: input.sessionId || "", conversationId: input.conversationId || "", status: "pending" };
      return state.navigation.begin(connection, command);
    },
    // Point at one place of this installation's vocabulary, or open it first:
    // a studio page by its route, Courses, or a project view in the project
    // and session the person has open (the browser's own focus).
    async guide(input, context) {
      const state = await stateFor(context);
      let guided;
      try { guided = trainingGuideRequest(input); }
      catch (error) { return { ok: false, error: error.message }; }
      const place = learningVocabulary.place(guided.target);
      const user = authenticatedVibe64User(context);
      if (!learningPlaceOpenTo(place, { owner: !user || user.role === "owner" })) {
        return { ok: false, error: `${place.label} is only for the workspace owner, so it cannot be shown to this person.` };
      }
      const connection = state.connections.get(context.colleague?.clientId);
      if (!connection) return { ok: false, error: "The initiating browser is no longer connected." };
      if (connection.navigation?.status === "pending") return { ok: false, error: "The browser is still opening the previous view." };
      const focus = connection.focus || {};
      if (guided.navigate && place.open.pane) {
        if (!focus.projectSlug) return { ok: false, error: `${place.label} is in a project. Open the project with navigation.open first, then guide again.` };
        if (place.open.pane !== "preview" && !focus.sessionId) {
          return { ok: false, error: `${place.label} belongs to a session. Open one of the project's sessions first, then guide again.` };
        }
      }
      const project = guided.navigate && place.open.pane ? { projectSlug: focus.projectSlug, sessionId: focus.sessionId || "" } : {};
      return state.navigation.begin(connection, trainingGuideCommand(guided, { id: randomUUID(), ...project }));
    },
    async acknowledgeNavigation(input, context) {
      const state = await stateFor(context);
      const connection = state.connections.get(input.clientId);
      return state.navigation.acknowledge(connection, input);
    },
    async send(input, context, { receiptOnly = false } = {}) {
      const state = await stateFor(context);
      const expected = input.expectedConversationId || context.colleague?.conversationId || state.record.scopeId;
      const admitted = state.admission.then(async () => {
        assertCurrentConversation(state, expected);
        if (closed) throw failure("Colleague is shutting down.");
        if (state.stopping) throw failure("Colleague is stopping its previous turn. Send again once it has stopped.");
        if (state.record.previousConversations.some(old => old.unconfirmedMessages.some(message => message.messageId === input.messageId) ||
            old.conversationLog.some(turn => turn.messages.some(message => message.messageId === input.messageId)) ||
            [old.conversationMetadata?.runtime, ...(old.conversationMetadata?.runtime?.predecessors || [])].some(segment => segment?.request?.messageId === input.messageId))) {
          throw failure("This message belongs to retained Colleague history. Nothing was resent; write a new message in the current conversation.", "ACTION_VALIDATION_FAILED", 400);
        }
        const previousTurn = state.record.conversationLog.find(turn => turn.messages.some(message => message.messageId === input.messageId));
        const previousMessage = previousTurn?.messages.find(message => message.messageId === input.messageId);
        if (previousMessage) {
          if (previousMessage.text !== input.message) throw failure("This message ID belongs to a different request. Use a new message ID.");
          return { status: "accepted", messageId: input.messageId, turnId: previousTurn.turnId, duplicate: true };
        }
        assertCurrentConversation(state, expected);
        if (closed || state.stopping) throw failure("Colleague is stopping. Send again once it has stopped.");
        const engine = state.record.conversationMetadata?.runtime?.engine;
        const native = Boolean(engine && engine !== "api");
        if (!native && state.running) {
          state.generation += 1;
          await state.conversation?.cancel();
          await state.running;
        }
        state.requestContext = context;
        state.streamingReply = null;
        state.interimReply = null;
        state.record.error = "";
        publishReply(state);
        const previous = state.connections.get(input.clientId) || {};
        const connection = { ...previous, clientId: input.clientId, focus: input.focus || previous.focus || null, assistantSelection: input.assistantSelection };
        state.connections.set(input.clientId, connection);
        if (native) {
          // App admission is independent of native admission: these are the
          // actual authored rows, not fabricated native acknowledgements.
          const turn = await transcript.writeConversationUserMessage(state.record.runtimeId, {
            messageId: input.messageId, text: input.message });
          if (!turn) throw failure("The authored Colleague message could not be admitted.");
          state.pendingMessages.push({ messageId: input.messageId, text: input.message, turnId: turn.turnId });
          state.nextConnection = { ...connection, focus: structuredClone(connection.focus) };
          if (!state.running) void startWorker(state, state.nextConnection, null, true).catch(() => {});
          return { status: "accepted", messageId: input.messageId, turnId: turn.turnId, origin: "user" };
        }
        return startWorker(state, { ...connection, focus: structuredClone(connection.focus) }, { messageId: input.messageId, text: input.message });
      });
      state.admission = admitted.catch(() => {});
      const receipt = await admitted;
      if (receipt?.ok === false) return receipt;
      return receiptOnly ? receipt : snapshot(state, input.clientId);
    },
    async stop(input, context) {
      const state = await stateFor(context);
      const expected = input.expectedConversationId || context.colleague?.conversationId || state.record.scopeId;
      assertCurrentConversation(state, expected);
      state.stopping = true;
      state.workerAbort?.abort();
      await state.admission;
      try { assertCurrentConversation(state, expected); } catch (error) { state.stopping = false; throw error; }
      state.generation += 1;
      state.pendingMessages = [];
      state.streamingReply = null;
      state.interimReply = null;
      publishReply(state);
      state.summaryAbort?.abort();
      for (const connection of state.connections.values()) connection.acknowledge?.({ ok: false, error: "Navigation was cancelled when Colleague stopped." });
      state.record.status = "interrupted";
      for (const assignment of state.record.assignments || []) {
        if (!["active", "waiting"].includes(assignment.status)) continue;
        assignment.status = "needs-user";
        assignment.summary = "Colleague was stopped. Ask to resume this assignment when ready.";
        for (const watch of state.record.watches) if (watch.assignmentId === assignment.assignmentId) watch.status = "paused";
      }
      state.requestContext = context;
      try {
        if (!state.conversation && state.record.conversationMetadata?.runtime) await openConversation(state, actionContext(state, { clientId: "", focus: null }));
        await state.conversation?.cancel();
        await state.running;
        await state.summaryRunning;
        await summaries.cleanup(state, context);
        await persist(state);
      } finally { state.stopping = false; }
      return snapshot(state);
    },
    async wait(context) {
      const state = await stateFor(context);
      await state.admission;
      while (state.running) await state.running;
      return snapshot(state);
    },
    async close() {
      closed = true;
      unregisterReleaser();
      for (const pending of users.values()) {
        const state = await pending;
        clearTimeout(state.watchTimer);
        clearTimeout(state.replyTimer);
        for (const observer of state.browserObservers) observer.release?.();
        state.browserObservers.clear();
        await state.watchAdmission;
        await state.polling;
        // Stop this thread, not whichever one the person's mode shows now.
        if (state.running || state.summaryRunning || state.record.summaryHelper) await this.stop({}, { ...state.requestContext,
          colleague: { ...state.requestContext?.colleague, threadKey: state.key } });
        await state.running;
        await state.saving;
      }
      await Promise.all([runtime.close(), nativeRuntime.close()]);
    }
  };
  return service;
}

export { createColleagueService };
