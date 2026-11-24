import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createHeldWork, HELD_ANSWER_MS, HELD_OUTCOME_MS } from "@local/vibe64-core/server/heldWork";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

/**
 * A held message's delivery check: still on its way (with what it waits for), or the outcome its request would have
 * answered with. A delivery that threw names its refusal; one the server proved never reached the assistant is
 * not-sent, any other is unknown.
 * @param {string} messageId
 * @param {{ settled: boolean, waitingFor: string, result?: any, error?: any }} operation the held work's operation
 */
function heldReceipt(messageId, operation) {
  if (!operation.settled) return { status: "pending", messageId, waitingFor: operation.waitingFor };
  const { result, error } = operation;
  if (!error) {
    if (result?.ok === false) {
      return {
        status: "not-sent",
        messageId,
        error: String(result.error || "The message was not sent."),
        ...(result.code ? { code: String(result.code) } : {})
      };
    }
    return { status: "accepted", messageId };
  }
  const notSent = error.delivery === "not-sent" || error.details?.delivery?.status === "not-sent";
  return {
    status: notSent ? "not-sent" : "unknown",
    messageId,
    error: String(error.message || "The message could not be sent."),
    ...(error.code ? { code: String(error.code) } : {})
  };
}

/**
 * A person's Main chat sends that answer before their delivery ends (within two seconds, before a hosted edge's minute
 * shows as "Request failed with status 504."), as held work (@local/vibe64-core/server/heldWork)
 * keyed by session and message. Each message delivers once: a send of the same message while its delivery runs (a
 * Retry, a reload's Retry) joins that delivery and never starts a second. A send whose delivery settles within
 * `answerMs` answers with its result, as before; a later one answers that the message is held, with what it waits
 * for, and its delivery check reports the outcome once it ends. Each send's timing, from its arrival, is logged once
 * it ends.
 * A message held past its answer is also in the session's records (`records`, heldMessageRecords.js) until its
 * delivery ends, and stays there when it ended unsent, so a restarted editor still answers its delivery check.
 * @param {object} dependencies
 * @param {ReturnType<typeof import("./heldMessageRecords.js").createHeldMessageRecords>} dependencies.records
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [dependencies.logger]
 * @param {number} [dependencies.answerMs]
 * @param {number} [dependencies.outcomeMs]
 */
function createHeldMessages({ records, logger = silentLogger, answerMs = HELD_ANSWER_MS, outcomeMs = HELD_OUTCOME_MS }) {
  const key = (sessionId, messageId) => `${sessionId}\0${messageId}`;
  const identity = (operation) => {
    const [sessionId, messageId] = operation.key.split("\0");
    return { sessionId, messageId };
  };
  // Each operation's record writes, in order.
  const recordings = new WeakMap();

  /** One operation's record writes, in order; a failed write is logged, never the send's failure. */
  function record(operation, write) {
    const { sessionId, messageId } = identity(operation);
    const state = recordings.get(operation) || { recording: Promise.resolve(), settleRecorded: false };
    recordings.set(operation, state);
    state.recording = state.recording.then(() => write(sessionId, messageId)).catch((error) => {
      try {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.agent_message",
          event: "vibe64.agent_message.held_record_failed",
          sessionId,
          messageId,
          error
        }, "A held message's record could not be written.");
      } catch {
        // Diagnostic only.
      }
    });
    return state.recording;
  }

  function recordSettled(operation) {
    const state = recordings.get(operation);
    if (!state || state.settleRecorded) return state?.recording;
    state.settleRecorded = true;
    return record(operation, (sessionId, messageId) => records.settle(sessionId, messageId, heldReceipt(messageId, operation)));
  }

  const work = createHeldWork({
    component: "vibe64.agent_message",
    events: {
      timing: "vibe64.agent_message.send_timing",
      held: "vibe64.agent_message.held"
    },
    logger,
    answerMs,
    outcomeMs,
    fields(operation) {
      const { sessionId, messageId } = identity(operation);
      return {
        sessionId,
        messageId,
        ...(operation.settled ? { outcome: heldReceipt(messageId, operation).status } : {})
      };
    },
    // Recorded before the held answer goes out, so a restart after it still knows the message waited.
    async held(operation) {
      await record(operation, (sessionId, messageId) => records.hold(sessionId, messageId));
      if (operation.settled) await recordSettled(operation);
    },
    async settled(operation) {
      if (operation.heldAnswer) await recordSettled(operation);
    }
  });

  /**
   * Delivers one message, or joins its delivery already running. A delivery that has ended is started again, as a
   * Retry after a refusal asks; one that succeeded is the coordinator's duplicate to answer.
   * @param {string} sessionId
   * @param {string} messageId
   * @param {(controls: { stage: (name: string) => void, signal: AbortSignal }) => Promise<object>} deliver
   */
  async function send(sessionId, messageId, deliver) {
    const answer = await work.run(key(sessionId, messageId), deliver);
    if (answer.settled) return answer.result;
    return { ok: true, delivered: false, status: "queued", messageId, sessionId, waitingFor: answer.waitingFor };
  }

  /**
   * The held message's delivery check, or null when no send of it is held or remembered here.
   * @param {string} sessionId
   * @param {string} messageId
   */
  function inspect(sessionId, messageId) {
    const operation = work.inspect(key(sessionId, messageId));
    return operation ? heldReceipt(messageId, operation) : null;
  }

  /**
   * The held message's delivery check here, or, once this editor no longer holds it (a restart), what the session's
   * records say of it, marked `recorded`: null when neither knows it.
   * @param {string} sessionId
   * @param {string} messageId
   */
  async function inspectRecorded(sessionId, messageId) {
    const held = inspect(sessionId, messageId);
    if (held) return held;
    try {
      return await records.read(sessionId, messageId);
    } catch {
      return null;
    }
  }

  /**
   * At shutdown: a held message that has not reached its assistant stops waiting (its delivery refuses it, unsent),
   * and this resolves once every held delivery has ended.
   */
  function close() {
    return work.close();
  }

  return Object.freeze({
    close,
    inspect,
    inspectRecorded,
    send
  });
}

export { createHeldMessages };
