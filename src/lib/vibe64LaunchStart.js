import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// A Preview start answers within two seconds, as starting, while it waits (for the workspace preparation, which after
// a restart runs for minutes, or for another Preview change), and goes on at the server: the hosted edge in front of
// a workspace ends a request after about a minute, and the page showed "Request failed with status 504." These
// follow the start through the outputs read's `launchStarts` until it ends, the way its request used to wait for it.

const WAITING_LABELS = Object.freeze({
  "launch-queue": "Waiting for another Preview change to finish",
  "workspace-preparation": "Waiting for the workspace preparation to finish",
  received: "Starting Preview",
  starting: "Starting Preview",
  unconfirmed: "Checking whether Preview is starting"
});
// How long the page waits before each outputs read: soon at first, then every three seconds.
const READ_DELAYS_MS = Object.freeze([250, 500, 1_000, 2_000, 3_000]);
// Outputs reads that may fail in a row (the editor restarting) before the page stops following.
const MAX_FAILED_READS = 20;
// Reads that may not know the start before the page says the editor no longer has it: the editor keeps a start's
// outcome for 15 minutes, so one it reported and then forgot was lost to a restart.
const MAX_MISSING_READS = 3;
const RESTARTED = "Vibe64 restarted while Preview was starting. Start it again.";
const NOT_RECEIVED = "Vibe64 did not receive this Preview start. Start it again.";
const LOST_CONTACT = "Vibe64 could not be reached to follow this Preview start. Check Preview, and start it again " +
  "if it is not running.";

/** A new start's id, which its repeat after a lost answer reuses. */
function newLaunchStartId() {
  return `start_${globalThis.crypto.randomUUID().replaceAll("-", "")}`;
}

/**
 * What a held start shows while it waits.
 * @param {unknown} waitingFor
 */
function launchStartWaitingLabel(waitingFor) {
  return WAITING_LABELS[normalizeText(waitingFor)] || WAITING_LABELS.starting;
}

/**
 * Whether a start's answer says it goes on at the server.
 * @param {unknown} answer
 */
function launchStartAnswerHeld(answer) {
  const body = normalizeObject(answer);
  return body.ok !== false && body.starting === true && Boolean(normalizeText(body.startId));
}

function pause(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(false);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve(true);
    }, ms);
    function stop() {
      clearTimeout(timer);
      resolve(false);
    }
    signal?.addEventListener("abort", stop, { once: true });
  });
}

/**
 * Follows a held start, or one whose answer was lost on the way (`waitingFor: "unconfirmed"`), through the outputs
 * read until it ends, and returns what its request would have answered: `{ ok: true, terminalSessionId }` once it
 * runs, its refusal (`error`, and `code` and `admissionId` when it has them) when it did not start, and plain words
 * when the editor no longer knows it, never received it or cannot be reached. It returns null, with nothing to say,
 * once `signal` ends the following (the page moved to another session or project).
 * @param {{ startId: string, waitingFor?: string }} held
 * @param {{
 *   read: () => Promise<unknown>,
 *   waiting: (label: string) => void,
 *   signal?: AbortSignal | null,
 *   delays?: readonly number[]
 * }} options `read` refreshes the outputs and returns their `launchStarts`
 */
async function followLaunchStart(held, { read, waiting, signal = null, delays = READ_DELAYS_MS }) {
  const startId = normalizeText(held.startId);
  let seen = normalizeText(held.waitingFor) !== "unconfirmed";
  let failedReads = 0;
  let missingReads = 0;
  waiting(launchStartWaitingLabel(held.waitingFor));
  for (let attempt = 0; ; attempt += 1) {
    if (!await pause(delays[Math.min(attempt, delays.length - 1)], signal)) return null;
    let starts;
    try {
      starts = await read();
    } catch {
      if (signal?.aborted) return null;
      failedReads += 1;
      if (failedReads >= MAX_FAILED_READS) return { ok: false, error: LOST_CONTACT };
      continue;
    }
    if (signal?.aborted) return null;
    failedReads = 0;
    const start = (Array.isArray(starts) ? starts : []).find(candidate => normalizeText(candidate?.startId) === startId);
    if (!start) {
      missingReads += 1;
      if (missingReads >= MAX_MISSING_READS) return { ok: false, error: seen ? RESTARTED : NOT_RECEIVED };
      continue;
    }
    seen = true;
    missingReads = 0;
    if (start.status === "starting") {
      waiting(launchStartWaitingLabel(start.waitingFor));
      continue;
    }
    if (start.status === "started") return { ok: true, terminalSessionId: normalizeText(start.terminalSessionId) };
    return {
      ok: false,
      ...(normalizeText(start.code) ? { code: normalizeText(start.code) } : {}),
      error: normalizeText(start.error) || "Preview could not start.",
      ...(normalizeText(start.admissionId) ? { admissionId: normalizeText(start.admissionId) } : {})
    };
  }
}

export {
  followLaunchStart,
  launchStartAnswerHeld,
  launchStartWaitingLabel,
  newLaunchStartId
};
