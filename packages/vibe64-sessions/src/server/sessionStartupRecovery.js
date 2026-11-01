import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").SessionArchive} SessionArchive */
/** @typedef {import("./types.js").SessionRenewalController} SessionRenewalController */

/**
 * Resumes interrupted archives, then interrupted renewals. Each step runs even
 * when the other fails; the archive loop stops between sessions once the
 * signal aborts.
 * @param {object} steps
 * @param {SessionArchive["resumeSessionArchives"]} steps.resumeSessionArchives
 * @param {SessionRenewalController["resumeSessionRenewals"]} steps.resumeSessionRenewals
 * @param {AbortSignal} signal
 */
async function resumeInterruptedSessionWork({ resumeSessionArchives, resumeSessionRenewals }, signal) {
  const failures = [];
  for (const [step, resume] of [
    ["archive", () => resumeSessionArchives({ signal })],
    ["renewal", () => resumeSessionRenewals()]
  ]) {
    if (signal.aborted) break;
    try {
      failures.push(...((await resume())?.failures || []));
    } catch (error) {
      failures.push({
        code: String(error?.code || `vibe64_session_${step}_recovery_failed`),
        error: String(error?.message || `Session ${step} recovery failed.`)
      });
    }
  }
  return { failures };
}

/**
 * The recovery a server that holds one project runs once at startup: its
 * interrupted archives, then its interrupted renewals, in that project. It
 * never blocks startup, and every failure is logged with its session. Once
 * stopped it never starts again; stopping aborts the archive loop and waits
 * for the step in progress.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {SessionArchive["resumeSessionArchives"]} dependencies.resumeSessionArchives
 * @param {SessionRenewalController["resumeSessionRenewals"]} dependencies.resumeSessionRenewals
 */
function createSessionStartupRecovery({
  logger,
  project,
  resumeSessionArchives,
  resumeSessionRenewals
}) {
  let activeRecovery = null;
  let started = false;
  let stopped = false;
  const stopping = new AbortController();

  function reportFailure(failure) {
    logOperationalEvent(logger, "warn", {
      code: String(failure.code || "vibe64_session_recovery_failed"),
      component: "vibe64.sessions",
      error: String(failure.error || "Session recovery failed."),
      event: "vibe64.sessions.recovery.session_failed",
      ...(failure.sessionId ? { sessionId: String(failure.sessionId) } : {})
    }, "An interrupted session archive or renewal could not resume.");
  }

  /**
   * Startup has no request: recovery runs in the project this server holds,
   * so its reads and session changes belong to that project.
   */
  function recover() {
    return project.runInProjectContext(
      project.currentProjectSlug(),
      () => resumeInterruptedSessionWork({ resumeSessionArchives, resumeSessionRenewals }, stopping.signal)
    );
  }

  function start() {
    if (stopped || started) {
      return activeRecovery;
    }
    started = true;
    let result;
    try {
      result = recover();
    } catch (error) {
      result = Promise.reject(error);
    }
    const recovery = Promise.resolve(result)
      .then((report) => {
        for (const failure of Array.isArray(report?.failures) ? report.failures : []) reportFailure(failure);
      })
      .catch((error) => {
        reportFailure({ code: error?.code, error: error?.message });
        vibe64SessionDebugLog("server.sessions.renewal.resume.error", {
          error: vibe64SessionDebugError(error)
        });
      })
      .finally(() => {
        if (activeRecovery === recovery) {
          activeRecovery = null;
        }
      });
    activeRecovery = recovery;
    return recovery;
  }

  async function stop() {
    stopped = true;
    stopping.abort();
    await activeRecovery;
  }

  return Object.freeze({
    start,
    stop
  });
}

export { createSessionStartupRecovery };
