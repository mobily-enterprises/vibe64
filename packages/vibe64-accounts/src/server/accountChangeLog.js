import { logOperationalEvent } from "@local/vibe64-core/server/logging";

// Each account or AI connection change leaves one operational line with its
// duration: completion at info, refusal or failure at warn with its cause.
function logAccountChange(logger, operation = "", fields = {}, result = {}, startedAt = Date.now()) {
  const failed = result?.ok === false;
  const failures = Array.isArray(result?.failed)
    ? result.failed.map(({ code, error, providerId, sessionId }) => ({ code, error, providerId, sessionId }))
    : [];
  logOperationalEvent(logger, failed ? "warn" : "info", {
    component: "vibe64-accounts",
    event: failed ? "vibe64.accounts.change_failed" : "vibe64.accounts.change_completed",
    operation,
    ...fields,
    durationMs: Date.now() - startedAt,
    ...(failed ? {
      code: String(result.code || failures[0]?.code || ""),
      error: String(result.error || failures[0]?.error || ""),
      ...(failures.length ? { failed: failures } : {})
    } : {})
  }, failed ? "Vibe64 account change failed" : "Vibe64 account change completed");
}

export { logAccountChange };
