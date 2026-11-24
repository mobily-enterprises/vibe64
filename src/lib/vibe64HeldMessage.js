import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { workAnswerLost } from "@/lib/vibe64SessionWorkOutcome.js";

// A Main chat send answers at once with the message held while its delivery waits (for the workspace preparation, the
// project or the assistant's start), and that delivery runs on at the server: the hosted edge in front of a
// workspace ends a request after about a minute, and on 24 Nov 2026 a message sent while the workspace was being
// prepared after a restart showed "Request failed with status 504." These follow the held message through its
// delivery check until its delivery ends, the way its request used to wait for it.

const WAITING_LABELS = Object.freeze({
  "project-open": "Waiting for the project to open",
  "workspace-preparation": "Waiting for the workspace preparation to finish",
  assistant: "Waiting for the assistant to start",
  received: "Waiting for the assistant to start",
  unconfirmed: "Checking whether the editor received this message"
});
// How long the page waits before each delivery check: soon at first, then every three seconds.
const CHECK_DELAYS_MS = Object.freeze([250, 500, 1_000, 2_000, 3_000]);
// Delivery checks that may fail in a row (the editor restarting) before the page stops following.
const MAX_FAILED_CHECKS = 20;
// An answer lost on the way is followed only while the editor may still be receiving the message.
const MAX_LOST_ANSWER_CHECKS = 3;
const LOST_CONTACT = "Vibe64 lost contact with the editor before this message's delivery was confirmed. " +
  "Retry checks first and sends it only if it did not arrive.";
const NOT_RECEIVED = "The editor did not confirm it received this message. Retry checks first and sends it only if " +
  "it did not arrive.";

/**
 * What a pending held message shows while it waits.
 * @param {unknown} waitingFor
 */
function heldMessageWaitingLabel(waitingFor) {
  return WAITING_LABELS[normalizeText(waitingFor)] || WAITING_LABELS.assistant;
}

/**
 * Whether a send's answer says the server holds the message, whose delivery goes on.
 * @param {unknown} answer
 */
function messageAnswerHeld(answer) {
  const body = normalizeObject(answer);
  return body.ok !== false && body.delivered !== true && body.status === "queued";
}

function abortError() {
  return Object.assign(new Error("The delivery check was stopped."), { name: "AbortError" });
}

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop() {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/**
 * Follows a held message, or one whose answer was lost on the way (`lost`), through its delivery check until its
 * delivery ends, and returns what its request would have answered: `{ ok: true }` once it reached the assistant, its
 * refusal with its code when it was not sent, and an unconfirmed delivery, in plain words, when the editor no longer
 * knows it or cannot be reached. It stops, with nothing more to say, once the message is no longer pending (its
 * transcript receipt arrived, or Cancel took it), and throws when `signal` ends the following.
 * @param {{ messageId: string, waitingFor?: string }} held
 * @param {{
 *   inspect: (signal?: AbortSignal) => Promise<unknown>,
 *   wait: (label: string) => void,
 *   pending: () => boolean,
 *   signal?: AbortSignal,
 *   lost?: boolean,
 *   delays?: readonly number[]
 * }} options
 */
async function followHeldMessage(held, { inspect, wait, pending, signal, lost = false, delays = CHECK_DELAYS_MS }) {
  const messageId = normalizeText(held.messageId);
  wait(heldMessageWaitingLabel(lost ? "unconfirmed" : held.waitingFor));
  let failedChecks = 0;
  for (let check = 0; ; check += 1) {
    await pause(delays[Math.min(check, delays.length - 1)], signal);
    if (!pending()) return { ok: true, messageId };
    let receipt;
    try {
      receipt = normalizeObject(await inspect(signal));
    } catch (error) {
      if (signal?.aborted) throw error;
      failedChecks += 1;
      if (failedChecks >= (lost ? MAX_LOST_ANSWER_CHECKS : MAX_FAILED_CHECKS)) {
        return { ok: false, status: "uncertain", messageId, error: LOST_CONTACT };
      }
      continue;
    }
    failedChecks = 0;
    const status = normalizeText(receipt.status);
    const code = normalizeText(receipt.code);
    if (status === "pending") {
      wait(heldMessageWaitingLabel(receipt.waitingFor));
      continue;
    }
    if (status === "accepted") return { ok: true, messageId };
    if (status === "not-sent" || status === "cancelled") {
      return { ok: false, messageId, error: normalizeText(receipt.error) || "The message was not sent.",
        ...(status === "cancelled" ? { cancelled: true } : {}),
        ...(code ? { code } : status === "cancelled" ? { code: "vibe64_assistant_routing_cancelled" } : {}) };
    }
    // Neither held nor received: the editor restarted, or the lost answer never reached it.
    if (lost && check + 1 < MAX_LOST_ANSWER_CHECKS && !normalizeText(receipt.error)) continue;
    return { ok: false, status: "uncertain", messageId, error: normalizeText(receipt.error) || NOT_RECEIVED,
      ...(code ? { code } : {}) };
  }
}

/**
 * Messages a reload restored unsent are checked before they show as unconfirmed. JSKIT restores every message that
 * was still on its way when the page closed as unconfirmed ("Message delivery is not confirmed."), but the server
 * may still hold it, waiting for the workspace preparation: each one is pending again at once, saying Vibe64 checks
 * it, and is followed through its delivery check like an answer lost on the way. It ends accepted, not sent with the
 * server's refusal, removed when the server cancelled it, or unconfirmed in plain words when the server knows
 * nothing of it. Called as the conversation's runtime is made, right after JSKIT restored them and before anything
 * shows them.
 * @param {{
 *   find: (messageId: string) => any,
 *   accept: (messageId: string) => void,
 *   remove: (messageId: string) => void,
 *   restoreUncertain: (request: { messageId: string, error?: string }) => boolean,
 *   rejectUnsent: (messageId: string, error: string) => boolean,
 *   wait: (messageId: string, reason?: string) => void,
 *   state: { messages: any[] }
 * }} delivery the conversation's delivery
 * @param {{ inspect: (messageId: string, signal?: AbortSignal) => Promise<unknown>, signal?: AbortSignal,
 *   delays?: readonly number[] }} options
 */
function recoverRestoredMessages(delivery, { inspect, signal, delays = CHECK_DELAYS_MS }) {
  const restored = delivery.state.messages.filter(message => message.status === "uncertain" && !message.cancelling);
  return Promise.all(restored.map(async (message) => {
    const messageId = message.id;
    const restoredError = message.error;
    // Pending again before anything renders it: its delivery check decides what it is.
    message.status = "pending";
    message.error = "";
    const pending = () => delivery.find(messageId)?.status === "pending";
    let outcome;
    try {
      outcome = await followHeldMessage({ messageId }, {
        inspect: checkSignal => inspect(messageId, checkSignal),
        wait: label => delivery.wait(messageId, label),
        pending,
        signal,
        lost: true,
        delays
      });
    } catch {
      // The page left this conversation: it keeps the message as JSKIT restored it.
      outcome = { ok: false, status: "uncertain", error: restoredError };
    }
    if (!pending()) return;
    if (outcome.ok) delivery.accept(messageId);
    else if (outcome.cancelled) delivery.remove(messageId);
    else {
      delivery.restoreUncertain({ messageId, error: outcome.error || restoredError });
      if (outcome.status !== "uncertain") delivery.rejectUnsent(messageId, outcome.error);
    }
  }));
}

export {
  followHeldMessage,
  heldMessageWaitingLabel,
  messageAnswerHeld,
  recoverRestoredMessages,
  workAnswerLost as messageAnswerLost
};
