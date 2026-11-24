import { normalizeObject, normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

const SAVE_UPDATE_REQUIRED_CODE = "vibe64_session_save_update_required";

// Save and Update answer their request once they start, and run on at the server: the hosted edge in front of a
// workspace ends a request after about a minute, while either can run for minutes. These read that answer and the
// session's Save or Update task, which carries the work's progress and, once it leaves running, its outcome.

/**
 * The operation a Save or Update answer says runs on, or "" when the answer is the outcome itself: a refusal, or the
 * result of work that finished within its request.
 * @param {unknown} answer
 */
function runningWorkOperationId(answer) {
  const body = normalizeObject(answer);
  return body.ok !== false && body.running === true ? normalizeText(body.operationId) : "";
}

/**
 * Whether `task` records the followed operation, or a later operation of its kind, which starts only once the
 * followed one ended and whose outcome is then the one to show. `startedAt` is the followed operation's start, when
 * known.
 * @param {unknown} task
 * @param {{ operationId: string, startedAt?: string }} followed
 */
function workTaskFollowed(task, { operationId, startedAt = "" }) {
  const record = normalizeObject(task);
  const id = normalizeText(record.operationId);
  if (!id) return false;
  return id === operationId || Boolean(startedAt && normalizeText(record.startedAt) > startedAt);
}

/**
 * The conflict a failed task records, as the failed request's details carried it; null when it records none.
 * @param {Record<string, any>} record
 */
function conflictDetails(record) {
  if (!record.conflictRecovery) return null;
  const connectedRepository = normalizeText(record.connectedRepository);
  return {
    conflictPaths: Array.isArray(record.conflictPaths) ? record.conflictPaths : [],
    conflictRecovery: record.conflictRecovery,
    ...(connectedRepository ? { connectedRepository } : {})
  };
}

/**
 * What a finished Save or Update task says, in the shape its request answered with when it waited for the work: the
 * task's own fields when it succeeded; when it failed, or Save found the session needs an Update first, the refusal
 * with its code, message and the conflict recovery the Update notice offers.
 * @param {unknown} task
 */
function workTaskOutcome(task) {
  const record = normalizeObject(task);
  const code = normalizeText(record.code);
  if (normalizeText(record.status).toLowerCase() !== "failed" && code !== SAVE_UPDATE_REQUIRED_CODE) {
    return { ...record, ok: true, operation: record };
  }
  const details = normalizeObject(record.details);
  const events = Array.isArray(record.events) ? record.events : [];
  return {
    code,
    details: Object.keys(details).length ? details : conflictDetails(record),
    // Save's "update first" records its message only in its last event.
    error: normalizeText(record.error) || normalizeText(events.at(-1)?.message),
    ok: false
  };
}

/**
 * An HTTP failure that is not the server's answer (a dropped connection, or an edge's 502/504): the work may have
 * started all the same, so its task decides.
 * @param {unknown} error
 */
function workAnswerLost(error) {
  const failure = normalizeObject(error);
  const status = Number(failure.status);
  return !normalizeText(failure.code) && (status === 0 || status >= 500);
}

export {
  runningWorkOperationId,
  workAnswerLost,
  workTaskOutcome,
  workTaskFollowed
};
