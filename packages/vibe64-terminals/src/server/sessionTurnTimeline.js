import { currentProjectActionRequestMeta, currentProjectRuntimeRoot } from "@local/vibe64-core/server/projectRequestContext";
import { recordSessionTimelineEvent, timelineActor, timelineRequestTrigger } from "@local/vibe64-core/server/sessionTimeline";

// What a session's timeline (vibe64-core's sessionTimeline.js) says about its
// turns and conversations: what was asked of the AI engine, by whom and why,
// and how each turn ended. Ids, states, reasons and codes only; never a
// message's words.

// The provider operations a person or Vibe64 asks of a session's engine, as timeline events.
const PROVIDER_CALL_EVENTS = Object.freeze({
  createConversation: ["conversation", "created"],
  deleteConversation: ["conversation", "deleted"],
  interruptDetachedChatTurn: ["turn", "cancel-requested"],
  interruptTurn: ["turn", "cancel-requested"],
  sendMessage: ["turn", "started"],
  startConversationTurn: ["turn", "started"],
  stopConversation: ["turn", "stop-requested"]
});

// How a turn ended, by its run state.
const ENDED_RUN_EVENTS = Object.freeze({
  cancelled: "cancelled",
  completed: "finished",
  failed: "failed",
  interrupted: "interrupted",
  timed_out: "timed-out"
});

// The turns seen running, so each is recorded once however often it reports progress.
const RUNNING_TURNS_KEPT = 1024;
const runningTurns = new Set();

function turnIdOf(result) {
  return result?.turnId || result?.turn?.id || result?.codexAgentTurn?.turnId || "";
}

/** The request that asked, as "METHOD route", or "background" when Vibe64 asked by itself. */
function timelineTrigger() {
  return timelineRequestTrigger(currentProjectActionRequestMeta()?.request) || "background";
}

/**
 * Runs one provider operation of a session and records what it asked for: a
 * message that starts or joins a turn (or was refused), a cancel or stop with
 * its reason, a conversation created or deleted. Helpers outside the session
 * (an assistant scope) are not the session's.
 * @template T
 * @param {string} method
 * @param {{ assistantScope?: object | null, providerId?: string, routingConversationId?: string, runtime?: { stateRoot?: string } | null, sessionId?: string, vibe64User?: object | null }} context
 * @param {Record<string, any>} input
 * @param {() => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function withSessionTurnTimeline(method, context, input, operation) {
  const recorded = PROVIDER_CALL_EVENTS[method];
  if (!recorded || context.assistantScope) return operation();
  const [kind, requested] = recorded;
  const record = (event, fields) => recordSessionTimelineEvent(context.sessionId, {
    kind,
    event,
    engine: context.providerId,
    chat: context.routingConversationId ? "temporary" : "main",
    conversation: context.routingConversationId || input?.conversationId,
    message: input?.messageId,
    by: timelineActor(context.vibe64User),
    reason: input?.reason,
    trigger: timelineTrigger(),
    ...fields
  }, { projectRuntimeRoot: context.runtime?.stateRoot || undefined });
  const refused = kind === "turn" && requested === "started" ? "refused" : requested;
  let result;
  try {
    result = await operation();
  } catch (error) {
    record(refused, { ok: false, code: error?.code });
    throw error;
  }
  if (result?.ok === false || method === "sendMessage" && result?.delivered === false) {
    record(refused, { ok: false, code: result.code });
  } else {
    const steered = method === "sendMessage" && input?.submissionKind === "steer";
    record(steered ? "steered" : requested, { turn: turnIdOf(result), conversation: context.routingConversationId || result?.conversationId || input?.conversationId });
  }
  return result;
}

/**
 * Records what a session change says about its turns: a Main chat turn that
 * runs (once) and how it ended, how a temporary chat's turn ended, and a
 * temporary chat opened or closed.
 * @param {string} sessionId
 * @param {{ reason?: string, payload?: Record<string, any> }} change
 */
function recordSessionTurnChange(sessionId, change = {}) {
  const reason = String(change.reason || "");
  const payload = change.payload || {};
  if (reason === "temporary-agent-turn-idle") {
    const state = String(payload.temporaryRun?.state || "");
    recordSessionTimelineEvent(sessionId, {
      kind: "turn",
      event: ENDED_RUN_EVENTS[state] || "ended",
      chat: "temporary",
      conversation: payload.conversationId,
      turn: payload.temporaryRun?.providerTurnId,
      ...(ENDED_RUN_EVENTS[state] ? {} : { state })
    });
    return;
  }
  if (reason === "temporary-conversation-created" || reason === "temporary-conversation-closed") {
    recordSessionTimelineEvent(sessionId, {
      kind: "conversation",
      event: reason === "temporary-conversation-created" ? "created" : "closed",
      chat: "temporary",
      conversation: payload.conversationId
    });
    return;
  }
  const run = payload.agentRun;
  if (!run || !(reason.endsWith("-turn-active") || reason.endsWith("-turn-idle"))) return;
  const turn = String(run.providerTurnId || run.turnId || "");
  const key = `${sessionId}\n${turn}`;
  const fields = {
    kind: "turn",
    engine: run.engineId || run.provider,
    chat: "main",
    turn,
    thread: run.providerThreadId || run.threadId
  };
  if (run.active) {
    if (runningTurns.has(key)) return;
    runningTurns.add(key);
    if (runningTurns.size > RUNNING_TURNS_KEPT) runningTurns.delete(runningTurns.values().next().value);
    recordSessionTimelineEvent(sessionId, { ...fields, event: "running" });
    return;
  }
  runningTurns.delete(key);
  const state = String(run.state || "");
  recordSessionTimelineEvent(sessionId, {
    ...fields,
    event: ENDED_RUN_EVENTS[state] || (run.observationError ? "observation-lost" : "ended"),
    ...(ENDED_RUN_EVENTS[state] ? {} : { state }),
    error: run.error || run.observationError,
    code: run.code || run.errorCode
  });
}

/**
 * The timeline of one session's AI engine processes: each start (or failed
 * start) with its execution id and pid, each stop Vibe64 asks for with its
 * reason, and each exit with its code, signal, or task limit. The project is
 * the one that started it, read once here, since an exit is observed later.
 * @param {{ engine: string, sessionId?: string }} options
 */
function engineProcessTimeline({ engine, sessionId = "" }) {
  const projectRuntimeRoot = currentProjectRuntimeRoot() || undefined;
  const record = (event, fields) => recordSessionTimelineEvent(sessionId, {
    kind: "process",
    event,
    engine,
    ...fields
  }, { projectRuntimeRoot });
  return Object.freeze({
    /** @param {{ id: string, pid?: number, exited: Promise<{ code?: number | null, signal?: string | null, taskLimit?: unknown }> }} started */
    started({ id, pid, exited }) {
      record("started", { execution: id, pid, trigger: timelineTrigger() });
      exited.then(
        ({ code, signal, taskLimit } = {}) => record("exited", { execution: id, exitCode: code, signal, ...(taskLimit ? { taskLimit: true } : {}) }),
        (error) => record("exited", { execution: id, code: error?.code || "vibe64_process_observation_failed" })
      );
    },
    /** @param {{ code?: string, executionId?: string }} error */
    startFailed(error) {
      record("start-failed", { execution: error?.executionId, code: error?.code, trigger: timelineTrigger() });
    },
    /** @param {string} id @param {{ reason?: string }} [options] */
    stopped(id, options) {
      record("stopped", { execution: id, reason: options?.reason, trigger: timelineTrigger() });
    }
  });
}

/**
 * A session's engine session closed (its Main chat's native session, which
 * stops the engine's work there): why, as far as the caller says, and whether
 * it closed.
 * @param {string} sessionId
 * @param {{ changeover?: boolean, renewalCleanup?: unknown, runtime?: { stateRoot?: string } | null }} options
 * @param {{ engineId?: string, ok?: boolean, code?: string }} result
 */
function recordEngineSessionClosed(sessionId, options, result) {
  recordSessionTimelineEvent(sessionId, {
    kind: "conversation",
    event: "engine-session-closed",
    engine: result.engineId,
    chat: "main",
    reason: options.changeover === true ? "engine changeover" : options.renewalCleanup ? "session renewal" : "",
    ok: result.ok !== false,
    code: result.code,
    trigger: timelineTrigger()
  }, { projectRuntimeRoot: options.runtime?.stateRoot || undefined });
}

export {
  engineProcessTimeline,
  recordEngineSessionClosed,
  recordSessionTurnChange,
  timelineTrigger,
  withSessionTurnTimeline
};
