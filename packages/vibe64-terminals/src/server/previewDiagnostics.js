import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { previewDiagnosticUrl } from "../shared/launchPreviewProtocol.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

const PREVIEW_DIAGNOSTIC_EVENTS = new Set([
  "resource.failed", "resource.retry", "resource.retry.skipped", "resource.retry.unavailable",
  "frame.requested", "iframe.loaded", "iframe.ready", "frame.left-preview"
]);
const NAVIGATION_TYPES = new Set(["navigate", "reload", "back_forward", "prerender"]);

/**
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {() => number} [dependencies.now]
 */
function createPreviewDiagnosticRecorder({ logger, now = Date.now }) {
  let windowStartedAt = 0;
  let recorded = 0;
  return function recordPreviewDiagnostic(input, { projectSlug, sessionId }) {
    if (input?.enabled !== true || !PREVIEW_DIAGNOSTIC_EVENTS.has(input.event)) return { ok: true, recorded: false };
    const current = now();
    if (current - windowStartedAt >= 60_000) {
      windowStartedAt = current;
      recorded = 0;
    }
    // One bounded budget per daemon avoids unbounded per-user/session bookkeeping.
    if (recorded >= 120) return { ok: true, recorded: false, limited: true };
    const timestamp = Date.parse(input.timestamp);
    const fields = {
      component: "vibe64.preview",
      event: "vibe64.preview.browser_diagnostic",
      stage: input.event,
      projectSlug,
      sessionId,
      observedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      resourceUrl: previewDiagnosticUrl(input.resourceUrl),
      frameUrl: previewDiagnosticUrl(input.frameUrl),
      // For a frame that left the app for the editor's site: the page that sent it there, and how.
      referrer: previewDiagnosticUrl(input.referrer),
      navigationType: NAVIGATION_TYPES.has(input.navigationType) ? input.navigationType : "",
      resourceKind: ["script", "link", "fetch", "resource"].includes(input.resourceKind) ? input.resourceKind : "resource",
      frameRequestId: Math.max(0, Math.min(1_000_000_000, Number(input.frameRequestId) || 0)),
      retryCount: Math.max(0, Math.min(100, Number(input.retryCount) || 0)),
      willRetry: input.willRetry === true
    };
    try {
      // An explicitly enabled diagnostic must survive the normal warning log level.
      logOperationalEvent(logger, "warn", fields, "Preview browser diagnostic.");
      recorded += 1;
      return { ok: true, recorded: true };
    } catch {
      return { ok: true, recorded: false };
    }
  };
}

export { createPreviewDiagnosticRecorder };
