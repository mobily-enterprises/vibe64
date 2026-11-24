import { setTimeout as delay } from "node:timers/promises";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";

// A person's send answers with its delivery's own result when that comes within this long, and otherwise with the
// message held while its delivery goes on. A proxy in front of a hosted editor ends a request after about a minute:
// on 24 Nov 2026 a message sent while the workspace was being prepared after a restart waited inside its request for
// that preparation and showed "Request failed with status 504.", although it was delivered once preparation ended.
const SEND_ANSWER_MS = 2_000;
// How long a held message's outcome stays readable after its delivery ends, for the page following it.
const HELD_OUTCOME_MS = 15 * 60_000;
// A send that took this long, from its arrival to its delivery's end, is logged as a warning.
const SLOW_SEND_MS = 1_000;

/**
 * A held message's delivery check: still on its way (with what it waits for), or the outcome its request would have
 * answered with. A delivery that threw names its refusal; one the server proved never reached the assistant is
 * not-sent, any other is unknown.
 * @param {string} messageId
 * @param {{ settled: boolean, stage: string, outcome: { result?: any, error?: any } | null }} entry
 */
function heldReceipt(messageId, entry) {
  if (!entry.settled) return { status: "pending", messageId, waitingFor: entry.stage };
  const { result, error } = entry.outcome;
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
 * A person's Main chat sends that answer before their delivery ends. Each message delivers once: a send of the same
 * message while its delivery runs (a Retry, a reload's Retry) joins that delivery and never starts a second. A send
 * whose delivery settles within `answerMs` answers with its result, as before; a later one answers that the message
 * is held, with what it waits for, and its delivery check reports the outcome once it ends. Each send's timing, from
 * its arrival, is logged once it ends.
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} [dependencies.logger]
 * @param {number} [dependencies.answerMs]
 * @param {number} [dependencies.outcomeMs]
 */
function createHeldMessages({ logger = silentLogger, answerMs = SEND_ANSWER_MS, outcomeMs = HELD_OUTCOME_MS } = {}) {
  const entries = new Map();
  const closing = new AbortController();
  const key = (sessionId, messageId) => `${sessionId}\0${messageId}`;

  function logTiming(sessionId, messageId, entry) {
    const elapsedMs = Date.now() - entry.receivedAt;
    const held = entry.heldAnswer;
    logOperationalEvent(logger, elapsedMs >= SLOW_SEND_MS || held ? "warn" : "info", {
      component: "vibe64.agent_message",
      event: "vibe64.agent_message.send_timing",
      sessionId,
      messageId,
      receivedAt: new Date(entry.receivedAt).toISOString(),
      elapsedMs,
      held,
      stages: entry.stages,
      outcome: heldReceipt(messageId, entry).status
    }, "Assistant message send timing, from its arrival.");
  }

  function start(sessionId, messageId, deliver) {
    const id = key(sessionId, messageId);
    const entry = { receivedAt: Date.now(), stage: "received", stages: { received: 0 }, settled: false, outcome: null, heldAnswer: false };
    const stage = (name) => {
      entry.stage = name;
      entry.stages[name] = Date.now() - entry.receivedAt;
    };
    entry.done = Promise.resolve()
      .then(() => deliver({ stage, signal: closing.signal }))
      .then(result => ({ result }), error => ({ error }))
      .then((outcome) => {
        entry.settled = true;
        entry.outcome = outcome;
        entry.stages.finished = Date.now() - entry.receivedAt;
        try {
          logTiming(sessionId, messageId, entry);
        } catch {
          // Timing is diagnostic only.
        }
        const forget = setTimeout(() => {
          if (entries.get(id) === entry) entries.delete(id);
        }, outcomeMs);
        forget.unref();
        return outcome;
      });
    entries.set(id, entry);
    return entry;
  }

  /**
   * Delivers one message, or joins its delivery already running. A delivery that has ended is started again, as a
   * Retry after a refusal asks; one that succeeded is the coordinator's duplicate to answer.
   * @param {string} sessionId
   * @param {string} messageId
   * @param {(controls: { stage: (name: string) => void, signal: AbortSignal }) => Promise<object>} deliver
   */
  async function send(sessionId, messageId, deliver) {
    const existing = entries.get(key(sessionId, messageId));
    const entry = existing && !existing.settled ? existing : start(sessionId, messageId, deliver);
    const answered = new AbortController();
    const outcome = await Promise.race([
      entry.done,
      delay(answerMs, null, { ref: false, signal: answered.signal }).catch(() => null)
    ]).finally(() => answered.abort());
    if (outcome) {
      if (outcome.error) throw outcome.error;
      return outcome.result;
    }
    if (!entry.heldAnswer) {
      entry.heldAnswer = true;
      entry.stages.answered = Date.now() - entry.receivedAt;
      try {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.agent_message",
          event: "vibe64.agent_message.held",
          sessionId,
          messageId,
          waitingFor: entry.stage,
          elapsedMs: entry.stages.answered
        }, "Assistant message answered as held; its delivery goes on.");
      } catch {
        // Timing is diagnostic only.
      }
    }
    return { ok: true, delivered: false, status: "queued", messageId, sessionId, waitingFor: entry.stage };
  }

  /**
   * The held message's delivery check, or null when no send of it is held or remembered here.
   * @param {string} sessionId
   * @param {string} messageId
   */
  function inspect(sessionId, messageId) {
    const entry = entries.get(key(sessionId, messageId));
    return entry ? heldReceipt(messageId, entry) : null;
  }

  /**
   * At shutdown: a held message that has not reached its assistant stops waiting (its delivery refuses it, unsent),
   * and this resolves once every held delivery has ended.
   */
  async function close() {
    closing.abort();
    await Promise.allSettled([...entries.values()].map(entry => entry.done));
  }

  return Object.freeze({
    close,
    inspect,
    send
  });
}

export { createHeldMessages, SEND_ANSWER_MS };
