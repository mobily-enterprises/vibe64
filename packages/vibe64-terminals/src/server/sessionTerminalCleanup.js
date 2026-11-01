import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * The cleanup context for a renewal's predecessor, refused unless the session is that renewal's exact active or
 * quiesced predecessor and a runtime is given.
 * @param {object} session
 * @param {object} options
 * @param {string} options.renewalId
 * @param {object} options.runtime
 */
function renewalPredecessorTerminalCleanupContext(session, options) {
  const { renewalId, runtime } = options;
  const sessionRecord = normalizeObject(session);
  const normalizedRenewalId = String(renewalId || "").trim();
  const sessionId = String(sessionRecord.sessionId || "").trim();
  const metadata = normalizeObject(sessionRecord.metadata);
  const status = String(sessionRecord.status || "").trim();
  const quiescedId = String(metadata.renewal_quiesced_id || "").trim();
  const isActive = status === VIBE64_SESSION_STATUS.ACTIVE;
  const isExactQuiesced = status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED &&
    quiescedId === normalizedRenewalId;
  // renewal_restored_id is historical proof of a completed rollback. An
  // active session is unowned once current quiescence and renewal links clear.
  if (
    !runtime ||
    !sessionId ||
    !normalizedRenewalId ||
    (!isActive && !isExactQuiesced) ||
    (isActive && (
      quiescedId ||
      String(metadata.renewed_to || "").trim()
    ))
  ) {
    throw new TypeError("Renewal predecessor terminal cleanup requires its exact active or quiesced session and runtime.");
  }
  return {
    renewalCleanup: Object.freeze({
      kind: "predecessor",
      renewalId: normalizedRenewalId,
      sourceSessionId: sessionId
    }),
    runtime,
    session: sessionRecord,
    sessionId
  };
}

/**
 * The cleanup context for a renewal's hidden successor, refused unless the session is that renewal's exact pending
 * successor and a runtime is given.
 * @param {object} session
 * @param {object} options
 * @param {string} options.renewalId
 * @param {object} options.runtime
 */
function renewalSuccessorTerminalCleanupContext(session, options) {
  const { renewalId, runtime } = options;
  const sessionRecord = normalizeObject(session);
  const normalizedRenewalId = String(renewalId || "").trim();
  const sessionId = String(sessionRecord.sessionId || "").trim();
  const metadata = normalizeObject(sessionRecord.metadata);
  if (
    !runtime ||
    !sessionId ||
    !normalizedRenewalId ||
    sessionRecord.status !== VIBE64_SESSION_STATUS.RENEWAL_PENDING ||
    String(metadata.renewal_id || "").trim() !== normalizedRenewalId ||
    !String(metadata.renewed_from || "").trim()
  ) {
    throw new TypeError("Renewal terminal cleanup requires the exact hidden successor and runtime.");
  }
  return {
    renewalCleanup: Object.freeze({
      kind: "successor",
      renewalId: normalizedRenewalId,
      sourceSessionId: String(metadata.renewed_from).trim()
    }),
    runtime,
    session: sessionRecord,
    sessionId
  };
}

/**
 * Closes one controller's terminals for the session, with debug timing around it.
 * @param {object} step
 * @param {{ closeAllForSession: (sessionId: string, options: object) => Promise<object> }} step.controller
 * @param {object} step.controllerOptions
 * @param {string} step.eventPrefix
 * @param {string} step.label
 * @param {string} step.sessionId
 */
async function closeTerminalControllerForSession({
  controller,
  controllerOptions,
  eventPrefix,
  label,
  sessionId
}) {
  const startedAtMs = Date.now();
  vibe64SessionDebugLog(`${eventPrefix}.controller.start`, {
    controller: label,
    sessionId
  });
  try {
    const result = await controller.closeAllForSession(sessionId, controllerOptions);
    vibe64SessionDebugLog(`${eventPrefix}.controller.done`, {
      closed: Number(result?.closed || 0),
      controller: label,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      ok: result?.ok !== false,
      sessionId
    });
    return result;
  } catch (error) {
    vibe64SessionDebugLog(`${eventPrefix}.controller.error`, {
      controller: label,
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: vibe64SessionDebugError(error),
      sessionId
    });
    throw error;
  }
}

/**
 * Every step runs even after an earlier one fails, so one helper whose cleanup
 * cannot finish never leaves the session's services, AI or commands running.
 * The failure then names each step that failed, keeping a single step's fields.
 * @param {string} sessionId
 * @param {Array<object>} controllers
 * @param {object} options
 * @param {object} [options.controllerOptions]
 * @param {string} [options.eventPrefix]
 * @param {RuntimeLogger} options.logger
 */
async function closeTerminalControllersForSession(sessionId, controllers, {
  controllerOptions = {},
  eventPrefix = "server.terminals.closeSessionTerminals",
  logger
}) {
  let closed = 0;
  const failures = [];
  for (const entry of controllers) {
    try {
      const result = await closeTerminalControllerForSession({
        ...entry,
        controllerOptions,
        eventPrefix,
        sessionId
      });
      if (result?.ok === false) {
        throw Object.assign(new Error(result.error || `Session ${entry.label} could not be stopped.`), {
          code: result.code || "vibe64_session_stop_failed"
        });
      }
      closed += Number(result?.closed || 0);
    } catch (error) {
      failures.push({ controller: entry.label, error });
      logOperationalEvent(logger, "warn", {
        component: "vibe64.session_close",
        event: "vibe64.session_close.step_failed",
        sessionId,
        controller: entry.label,
        code: error?.code || "",
        error: error?.message || String(error)
      }, "A session cleanup step failed; the remaining steps still ran.");
    }
  }
  if (failures.length) {
    const message = failures.map(({ controller, error }) =>
      `${controller}: ${error?.message || String(error) || "Cleanup failed."}`).join(" ");
    const [only] = failures;
    const labelled = { controllers: failures.map(({ controller }) => controller), sessionId };
    // A single failure keeps its own fields (code, statusCode, retryable...);
    // several keep any step's refusal of a retry.
    if (failures.length === 1) {
      const { cause: _cause, ...fields } = typeof only.error === "object" && only.error ? only.error : {};
      throw Object.assign(new Error(message, { cause: only.error }), fields,
        { code: only.error?.code || "vibe64_session_stop_failed" }, labelled);
    }
    throw Object.assign(new AggregateError(failures.map(({ error }) => error), message), {
      code: "vibe64_session_stop_failed",
      ...(failures.some(({ error }) => error?.retryable === false) ? { retryable: false } : {})
    }, labelled);
  }
  return {
    closed,
    ok: true
  };
}

export {
  closeTerminalControllersForSession,
  renewalPredecessorTerminalCleanupContext,
  renewalSuccessorTerminalCleanupContext
};
