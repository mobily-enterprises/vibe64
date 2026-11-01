import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { sessionHasActiveAgentRun, sessionRecordId } from "./serviceSessionRecords.js";

const PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS = 30 * 60 * 1000;
const PROJECT_RUNTIME_DORMANCY_SWEEP_INTERVAL_MS = 5 * 60 * 1000;
const PROJECT_RUNTIME_IDLE_TIMEOUT_REASON = "idle-timeout";

function normalizePositiveDurationMs(value, fallback) {
  const normalized = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : fallback;
}

function timestampMs(value = "") {
  const parsed = Date.parse(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampIso(ms = 0) {
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString() : "";
}

function sessionActivityTimestamps(session = {}) {
  const manifest = session.manifest && typeof session.manifest === "object" && !Array.isArray(session.manifest)
    ? session.manifest
    : {};
  return [
    timestampMs(session.updatedAt),
    timestampMs(manifest.updatedAt),
    ...(Array.isArray(session.agentRuns) ? session.agentRuns.map((run) => timestampMs(run?.updatedAt)) : []),
    ...(Array.isArray(session.backgroundTasks) ? session.backgroundTasks.map((task) => timestampMs(task?.updatedAt)) : [])
  ].filter((value) => value > 0);
}

function projectRuntimeDormancyState({
  idleAfterMs = PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS,
  nowMs = Date.now(),
  runtime = {},
  sessions = []
} = {}) {
  const normalizedIdleAfterMs = normalizePositiveDurationMs(idleAfterMs, PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS);
  const normalizedNowMs = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const sessionRecords = Array.isArray(sessions) ? sessions : [];
  const activeAgentSessionIds = sessionRecords
    .filter(sessionHasActiveAgentRun)
    .map((session) => sessionRecordId(session))
    .filter(Boolean)
    .sort();
  const activityMs = [
    timestampMs(runtime.updatedAt),
    timestampMs(runtime.openedAt),
    ...sessionRecords.flatMap(sessionActivityTimestamps)
  ].filter((value) => value > 0);
  const lastActivityMs = activityMs.length ? Math.max(...activityMs) : 0;
  const idleMs = lastActivityMs > 0 ? Math.max(0, normalizedNowMs - lastActivityMs) : 0;
  const open = runtime.open === true;
  return {
    activeAgentSessionIds,
    dormant: open && activeAgentSessionIds.length === 0 && lastActivityMs > 0 && idleMs >= normalizedIdleAfterMs,
    idleAfterMs: normalizedIdleAfterMs,
    idleMs,
    lastActivityAt: timestampIso(lastActivityMs),
    now: timestampIso(normalizedNowMs),
    open,
    sessionCount: sessionRecords.length
  };
}

function startProjectRuntimeDormancyCleanupSchedule({
  clearIntervalImpl = clearInterval,
  idleAfterMs = PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS,
  intervalMs = PROJECT_RUNTIME_DORMANCY_SWEEP_INTERVAL_MS,
  logger,
  serviceFactory,
  setIntervalImpl = setInterval
}) {
  const normalizedIdleAfterMs = normalizePositiveDurationMs(idleAfterMs, PROJECT_RUNTIME_DORMANT_CLOSE_AFTER_MS);
  const normalizedIntervalMs = normalizePositiveDurationMs(intervalMs, PROJECT_RUNTIME_DORMANCY_SWEEP_INTERVAL_MS);
  let running = false;
  let stopped = false;

  async function runNow() {
    if (running || stopped) {
      return null;
    }
    running = true;
    try {
      const service = serviceFactory();
      if (!service) {
        return null;
      }
      const result = await service.closeDormantProjectRuntimes({
        idleAfterMs: normalizedIdleAfterMs
      });
      for (const failure of Array.isArray(result?.failed) ? result.failed : []) {
        const failed = Array.isArray(failure?.failed) ? failure.failed
          : Array.isArray(failure?.closeResult?.failed) ? failure.closeResult.failed : [];
        logger.warn({
          component: "vibe64-project-runtime-cleanup",
          error: String(failure?.error || failed[0]?.error || "Dormant project runtime cleanup failed."),
          event: "vibe64.project_runtime.dormant_close_failed",
          projectSlug: String(failure?.projectSlug || ""),
          sessionIds: [...new Set(failed.map((entry) => String(entry?.sessionId || "")).filter(Boolean))]
        }, "An idle Vibe64 project could not be closed.");
      }
      vibe64SessionDebugLog("server.terminals.projectRuntime.dormantCleanup.done", {
        closedCount: Number(result?.closedCount || 0),
        failedCount: Array.isArray(result?.failed) ? result.failed.length : 0,
        idleAfterMs: normalizedIdleAfterMs,
        ok: result?.ok !== false,
        projectCount: Number(result?.projectCount || 0)
      });
      return result;
    } catch (error) {
      logger.warn({
        component: "vibe64-project-runtime-cleanup",
        error: error instanceof Error ? error.message : String(error || "Dormant project runtime cleanup failed."),
        event: "vibe64.project_runtime.dormant_cleanup_failed"
      }, "Scheduled dormant Vibe64 project runtime cleanup failed.");
      vibe64SessionDebugLog("server.terminals.projectRuntime.dormantCleanup.error", {
        error: vibe64SessionDebugError(error),
        idleAfterMs: normalizedIdleAfterMs
      });
      return {
        error: error instanceof Error ? error.message : String(error || "Dormant project runtime cleanup failed."),
        ok: false
      };
    } finally {
      running = false;
    }
  }

  const interval = setIntervalImpl(() => {
    void runNow();
  }, normalizedIntervalMs);
  interval?.unref();

  return {
    idleAfterMs: normalizedIdleAfterMs,
    intervalMs: normalizedIntervalMs,
    runNow,
    stop() {
      if (stopped) {
        return;
      }
      stopped = true;
      clearIntervalImpl(interval);
    }
  };
}

export {
  PROJECT_RUNTIME_IDLE_TIMEOUT_REASON,
  projectRuntimeDormancyState,
  startProjectRuntimeDormancyCleanupSchedule
};
