import { PROBLEM_REPORT_LIMITS } from "@local/vibe64-core/shared/problemReport";

// The errors a page saw, newest last, for Report a problem: what the page's error runtime reported as an error or a
// warning, and what the browser caught unhandled. Kept in the page's memory only, at most
// PROBLEM_REPORT_LIMITS.clientErrors, and sent only inside a report the person collects.

const text = (value, max) => String(value ?? "").slice(0, max);

function createProblemReportErrorRecorder() {
  const errors = [];

  /** @param {{ source?: unknown, code?: unknown, message?: unknown }} entry */
  function remember({ source = "", code = "", message = "" }) {
    errors.push({
      at: new Date().toISOString(),
      source: text(source, 200),
      code: text(code, 200),
      message: text(message, PROBLEM_REPORT_LIMITS.textCharacters)
    });
    if (errors.length > PROBLEM_REPORT_LIMITS.clientErrors) errors.splice(0, errors.length - PROBLEM_REPORT_LIMITS.clientErrors);
  }

  /**
   * Records what `errorRuntime` reports and what `target` (the page's window) catches unhandled, until the returned
   * stop is called.
   * @param {{ errorRuntime: { subscribe: (listener: (notice: any) => void) => () => void },
   *   target: { addEventListener: Function, removeEventListener: Function } }} sources
   */
  function listen({ errorRuntime, target }) {
    const onError = (event) => remember({
      source: "window.error",
      code: event.error?.code || event.error?.name || "",
      message: event.message || event.error?.message || ""
    });
    const onRejection = (event) => remember({
      source: "window.unhandledrejection",
      code: event.reason?.code || event.reason?.name || "",
      message: event.reason?.message || String(event.reason ?? "")
    });
    target.addEventListener("error", onError);
    target.addEventListener("unhandledrejection", onRejection);
    const unsubscribe = errorRuntime.subscribe((notice) => {
      const event = notice?.result?.event;
      if (!String(notice?.type || "").startsWith("reported") || !event) return;
      if (!["error", "warning"].includes(event.severity)) return;
      remember({
        source: event.source,
        code: event.code || event.messageCode || (event.status ? String(event.status) : ""),
        message: event.message
      });
    });
    return () => {
      target.removeEventListener("error", onError);
      target.removeEventListener("unhandledrejection", onRejection);
      unsubscribe();
    };
  }

  /** A copy of the errors seen, oldest first. */
  function seen() {
    return errors.map((entry) => ({ ...entry }));
  }

  return Object.freeze({
    errors: seen,
    listen,
    remember
  });
}

export { createProblemReportErrorRecorder };
