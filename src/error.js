import { createDefaultErrorPolicy } from "@jskit-ai/shell-web/client/error";

const ERROR_RUNTIME_LOG_UNSUBSCRIBE_KEY = "__vibe64JskitErrorRuntimeLogUnsubscribe";

/**
 * A reported error's cause, as the console shows it.
 * @param {any} error the cause JSKIT reported, present whenever this runs
 */
function errorSummary(error) {
  return {
    code: String(error.code || ""),
    message: String(error.message || error || ""),
    name: String(error.name || ""),
    stack: typeof error.stack === "string" ? error.stack : "",
    status: Number.isInteger(error.status) ? error.status : null
  };
}

function errorConsoleMessage(payload = {}) {
  return [
    payload.message,
    payload.code ? `code=${payload.code}` : "",
    payload.source ? `source=${payload.source}` : "",
    payload.traceId ? `trace=${payload.traceId}` : ""
  ].filter(Boolean).join(" | ") || "JSKIT reported an error.";
}

/**
 * Writes every event the error runtime reports to the console.
 * @param {import("@jskit-ai/shell-web/client/types").ShellErrorRuntime} runtime
 */
function installJskitErrorConsoleTrail(runtime) {
  const previousUnsubscribe = globalThis[ERROR_RUNTIME_LOG_UNSUBSCRIBE_KEY];
  if (typeof previousUnsubscribe === "function") {
    previousUnsubscribe();
  }

  globalThis[ERROR_RUNTIME_LOG_UNSUBSCRIBE_KEY] = runtime.subscribe((event = {}) => {
    const result = event.result || {};
    const reportedError = result.event || {};
    const decision = result.decision || {};
    const payload = {
      channel: String(decision.channel || ""),
      code: String(reportedError.code || ""),
      dedupeKey: String(decision.dedupeKey || reportedError.dedupeKey || ""),
      details: reportedError.details || null,
      intent: String(reportedError.intent || ""),
      message: String(reportedError.message || decision.message || ""),
      presenterId: String(decision.presenterId || ""),
      reason: String(result.reason || ""),
      severity: String(reportedError.severity || decision.severity || ""),
      skipped: result.skipped === true,
      source: String(reportedError.source || ""),
      traceId: String(reportedError.traceId || ""),
      type: String(event.type || "")
    };

    try {
      const severity = String(payload.severity || "").toLowerCase();
      const informational = severity === "success" || severity === "info";
      const consoleMethod = informational ? "info" : severity === "warning" ? "warn" : "error";
      const label = informational ? "JSKIT_FEEDBACK" : severity === "warning" ? "JSKIT_WARNING" : "JSKIT_ERROR";
      console[consoleMethod](`[${label}] ${errorConsoleMessage(payload)}`, payload);
      if (reportedError.cause) {
        const cause = errorSummary(reportedError.cause);
        console.error(`[JSKIT_ERROR_CAUSE] ${cause.message || cause.name || "Unknown cause"}`, cause);
      }
    } catch {
      // Console diagnostics must never interfere with JSKIT error presentation.
    }
  });
}

/**
 * The app's error presentation, which shell-web reads with its error toolkit.
 * @param {{ runtime: import("@jskit-ai/shell-web/client/types").ShellErrorRuntime }} toolkit
 */
export default function configureVibe64ErrorRuntime({ runtime }) {
  installJskitErrorConsoleTrail(runtime);

  return Object.freeze({
    defaultPresenterId: "material.snackbar",
    policy: createDefaultErrorPolicy({
      resourceLoadChannel: "silent",
      actionFeedbackChannel: "snackbar",
      appRecoverableChannel: "banner",
      blockingChannel: "dialog"
    }),
    presenters: []
  });
}
