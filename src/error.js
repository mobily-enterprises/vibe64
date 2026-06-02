import { createDefaultErrorPolicy } from "@jskit-ai/shell-web/client/error";

const ERROR_RUNTIME_LOG_UNSUBSCRIBE_KEY = "__vibe64JskitErrorRuntimeLogUnsubscribe";

function errorSummary(error = {}) {
  return {
    code: String(error?.code || ""),
    message: String(error?.message || error || ""),
    name: String(error?.name || ""),
    stack: typeof error?.stack === "string" ? error.stack : "",
    status: Number.isInteger(error?.status) ? error.status : null
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

function installJskitErrorConsoleTrail(runtime = null) {
  if (!runtime || typeof runtime.subscribe !== "function") {
    return;
  }

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
      const consoleMethod = severity === "success" ? "info" : severity === "warning" ? "warn" : "error";
      const label = severity === "success" ? "JSKIT_FEEDBACK" : severity === "warning" ? "JSKIT_WARNING" : "JSKIT_ERROR";
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

export default function configureVibe64ErrorRuntime({ runtime } = {}) {
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
