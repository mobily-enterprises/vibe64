import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { readLearningModeFor } from "@local/vibe64-core/server/learningMode";
import { learnThreadFile, learnThreadLearnerKey, registerLearnThreadReleaser } from "@local/vibe64-core/server/learnThreads";
import { createColleagueNavigationCoordination } from "./navigationCoordination.js";
import { validateColleagueConversationRecord } from "./conversationRecord.js";
import { failure, requireResult } from "./colleagueFailure.js";
import { projectNoReply, releaseObserver } from "./colleaguePresentation.js";

/** @typedef {import("./types.js").ColleagueServiceState} ColleagueServiceState */
/** @typedef {import("./types.js").ColleagueRecords} ColleagueRecords */

/**
 * A person's Colleague threads: which thread a request belongs to, loading its
 * saved record, showing it and hiding the one it replaces, releasing a closed
 * lesson attempt's thread, and the context its own operations run with.
 * @param {object} dependencies
 * @param {string} dependencies.systemRoot
 * @param {ColleagueServiceState} dependencies.serviceState
 * @param {ColleagueRecords} dependencies.records
 */
function createColleagueThreads({
  systemRoot,
  serviceState,
  records
}) {
  function userKey(context) {
    const user = authenticatedVibe64User(context);
    return Buffer.from(String(user?.uid ?? user?.username ?? "local")).toString("base64url");
  }
  const learnThreadKey = ({ learnerKey, attemptId }) => `${learnerKey}:learn${attemptId ? `:${attemptId}` : ""}`;
  /**
   * The thread is decided on the server only: Develop's one conversation, or
   * in Learn mode the current attempt's teacher thread (the lobby without one,
   * or while Training is closing the attempt after releasing its thread).
   */
  async function threadFor(context) {
    const user = authenticatedVibe64User(context);
    const mode = await readLearningModeFor(user);
    if (!mode?.on) return { kind: "develop" };
    const learnerKey = learnThreadLearnerKey(user);
    const attemptId = serviceState.releasedThreads.has(learnThreadKey({ learnerKey, attemptId: mode.currentAttemptId }))
      ? "" : mode.currentAttemptId;
    return { kind: "learn", learnerKey, ...(attemptId ? { attemptId } : {}) };
  }

  async function stateFor(context) {
    const owner = userKey(context);
    // A turn's own operations stay with its thread, whatever the mode is now.
    const pinned = context.colleague?.threadKey;
    if (pinned) {
      const state = await serviceState.users.get(pinned);
      if (!state || state.userKey !== owner || state.released) {
        throw failure("This Colleague conversation has ended.", "conversation_forbidden", 403);
      }
      return state;
    }
    const thread = await threadFor(context);
    const key = thread.kind === "develop" ? owner : learnThreadKey(thread);
    if (!serviceState.users.has(key)) serviceState.users.set(key, loadState(key, owner, thread));
    const loading = serviceState.users.get(key);
    let state;
    try { state = await loading; }
    catch (error) {
      if (serviceState.users.get(key) === loading) serviceState.users.delete(key);
      throw error;
    }
    showThread(state);
    return state;
  }

  /**
   * The thread a person's request resolves to becomes the visible one. The
   * thread it replaces keeps its running turn; its live handle is released
   * only after that turn settles, and its watch observations wait.
   */
  function showThread(state) {
    const previous = serviceState.visible.get(state.userKey);
    if (previous === state) return;
    serviceState.visible.set(state.userKey, state);
    if (previous) void hideThread(previous).catch(() => {});
  }
  async function hideThread(state) {
    await state.admission;
    while (state.running || state.transfer) await (state.running || state.transfer);
    if (serviceState.lifecycle.closed || state.released || state.opening || serviceState.visible.get(state.userKey) === state) return;
    for (const observer of state.browserObservers) releaseObserver(observer);
    state.browserObservers.clear();
    const conversation = state.conversation;
    if (!conversation) return;
    requireResult(await conversation.dispose());
    if (state.conversation !== conversation) return;
    state.conversation = null;
    state.runtimeOwner = null;
    state.host = null;
  }

  /**
   * Training closes a lesson attempt: stop using its thread (a running turn
   * is stopped, not awaited, since it may be the very call closing the
   * attempt), then Training moves or removes the thread file.
   */
  async function releaseLearnThread({ learnerKey, attemptId }) {
    const file = learnThreadFile({ systemRoot, learnerKey, attemptId });
    const key = learnThreadKey({ learnerKey, attemptId });
    serviceState.releasedThreads.add(key);
    const state = await serviceState.users.get(key)?.catch(() => null);
    serviceState.users.delete(key);
    if (!state) return rm(file.slice(0, -".json".length), { recursive: true, force: true });
    state.released = true;
    state.generation += 1;
    state.workerAbort?.abort();
    void Promise.resolve(state.conversation?.cancel()).catch(() => {});
    state.pendingMessages = [];
    clearTimeout(state.watchTimer);
    clearTimeout(state.replyTimer);
    if (serviceState.visible.get(state.userKey) === state) serviceState.visible.delete(state.userKey);
    for (const observer of state.browserObservers) releaseObserver(observer);
    state.browserObservers.clear();
    await state.saving;
    void (async () => {
      await state.running;
      try { if (state.conversation) await state.conversation.dispose(); }
      finally {
        state.conversation = null;
        for (const chat of [state.record, ...state.record.previousConversations]) serviceState.conversationOwners.delete(chat.runtimeId);
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
      else if (error instanceof SyntaxError) throw failure(
        "Colleague's saved history is invalid. The file was left unchanged; restore or repair it, then retry.",
        "colleague_history_invalid",
        503
      );
      else throw error;
    }
    if (saved && saved.schemaVersion !== 3) {
      throw failure(
        "Run the candidate Vibe64 state upgrade with services stopped before opening this Colleague history; no state was changed."
      );
    }
    const record = saved || {
      schemaVersion: 3,
      runtimeId: key,
      previousConversations: [],
      scopeId: `colleague_${randomUUID().replaceAll("-", "")}`,
      assistantSelection: null,
      status: "ready",
      error: "",
      conversationLog: []
    };
    try { validateColleagueConversationRecord(record, key); }
    catch {
      throw failure(
        "Colleague's saved history is invalid. The file was left unchanged; restore or repair it, then retry.",
        "colleague_history_invalid",
        503
      );
    }
    record.watches ||= [];
    record.observations ||= [];
    if (!serviceState.browsers.has(owner)) serviceState.browsers.set(owner, new Map());
    const state = {
      key,
      userKey: owner,
      thread: develop ? { kind: "develop" } : {
        kind: "learn",
        ...(thread.attemptId ? { attemptId: thread.attemptId } : {})
      },
      file,
      root,
      record,
      connections: serviceState.browsers.get(owner),
      saving: Promise.resolve(),
      admission: Promise.resolve(),
      running: null,
      streamEpoch: randomUUID(),
      streamRevision: 0,
      generation: 0,
      requestContext: null,
      streamingReply: null,
      operationContext: null,
      operationRunId: "",
      interimReply: null,
      projectReply: projectNoReply,
      stopping: false,
      rotating: false,
      opening: 0,
      conversation: null,
      host: null,
      selecting: null,
      observationIds: [],
      runtimeOwner: null,
      transfer: null,
      pendingMessages: [],
      nextConnection: null,
      workerAbort: null,
      watchTimer: null,
      polling: null,
      watchDirty: false,
      watchAdmission: Promise.resolve(),
      browserObservers: new Set()
    };
    state.navigation = createColleagueNavigationCoordination({ changed: () => records.publishBrowserChange(state) });
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
    for (const chat of [record, ...record.previousConversations]) serviceState.conversationOwners.set(chat.runtimeId, state);
    return state;
  }

  function assertCurrentConversation(state, conversationId) {
    if (conversationId && conversationId !== state.record.scopeId) {
      throw failure(
        "This Colleague conversation has been retained as read-only history. Open the current conversation before sending.",
        "ACTION_VALIDATION_FAILED",
        400
      );
    }
  }

  function actionContext(state, connection) {
    // Do not copy the reserved authorization result from a previous action.
    // The host rechecks this real request for every tool and model exchange.
    return {
      surface: "app",
      channel: "automation",
      requestMeta: state.requestContext.requestMeta,
      projectSlug: connection.focus?.projectSlug || "",
      colleague: {
        userKey: state.userKey,
        threadKey: state.key,
        thread: state.thread.kind,
        conversationId: state.record.scopeId,
        clientId: connection.clientId,
        focus: connection.focus
      }
    };
  }

  return Object.freeze({
    userKey,
    stateFor,
    assertCurrentConversation,
    actionContext,
    unregisterReleaser
  });
}

export { createColleagueThreads };
