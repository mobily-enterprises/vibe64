import crypto from "node:crypto";
import { trimmedText } from "./trimmedText.js";

/** @typedef {import("./types.js").CodexAppServerRunOwner} CodexAppServerRunOwner */
/** @typedef {import("./types.js").CodexSessionRuntimeHost} CodexSessionRuntimeHost */
/** @typedef {import("./types.js").CodexStartupHealth} CodexStartupHealth */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

export const CODEX_APP_SERVER_TASK_ID = "codex_app_server";

export function errorMessage(value, fallback = "Codex could not be prepared.") {
  return trimmedText(value?.error || value?.message || value) || fallback;
}

function createCodexAppServerHealthAttempt() {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString()
  };
}

/**
 * Original application health-task projection; native readiness stays in JSKIT.
 */
export function createCodexStartupHealth(publishSessionChanged) {
  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sessionId
   * @param {object} [options]
   * @param {string} [options.error]
   * @param {object | null} [options.healthAttempt]
   * @param {string} [options.kind]
   * @param {string} [options.message]
   * @param {string} [options.publishReason]
   * @param {boolean} [options.retryable]
   * @param {string} [options.status]
   * @param {string} [options.terminalSessionId]
   */
  async function writeCodexAppServerTaskEvent(runtime, sessionId, {
    error = "",
    healthAttempt = null,
    kind = "",
    message = "",
    publishReason = "",
    retryable = true,
    status = "running",
    terminalSessionId = ""
  } = {}) {
    const normalizedStatus = trimmedText(status) || "running";
    const healthAttemptId = trimmedText(healthAttempt?.id);
    const healthAttemptStartedAt = trimmedText(healthAttempt?.startedAt);
    const patch = {
      error: trimmedText(error),
      kind: "codex_app_server",
      label: "Codex app-server",
      message: trimmedText(message),
      retryable: normalizedStatus === "failed" && retryable !== false,
      status: normalizedStatus,
      terminalSessionId: trimmedText(terminalSessionId)
    };
    if (healthAttemptId) {
      patch.healthAttemptId = healthAttemptId;
    }
    if (healthAttemptStartedAt && normalizedStatus === "running") {
      patch.healthAttemptStartedAt = healthAttemptStartedAt;
    }
    const task = await runtime.store.writeBackgroundTaskEvent(sessionId, CODEX_APP_SERVER_TASK_ID, {
      event: {
        error: trimmedText(error),
        healthAttemptId,
        kind: trimmedText(kind || normalizedStatus),
        message: trimmedText(message),
        status: normalizedStatus
      },
      patch,
      shouldWrite: ({ previous = {} } = {}) => {
        if (normalizedStatus === "running" || !healthAttemptId) {
          return true;
        }
        return trimmedText(previous.healthAttemptId) === healthAttemptId &&
          trimmedText(previous.status) === "running";
      }
    });
    const publishedStatus = trimmedText(task?.status) || normalizedStatus;
    await publishSessionChanged(sessionId, {
      reason: trimmedText(publishReason) || `codex-app-server-${publishedStatus}`
    });
    return task;
  }

  async function writeCodexAppServerRunning(runtime, sessionId, {
    healthAttempt = createCodexAppServerHealthAttempt(),
    kind = "running",
    message,
    terminalSessionId = ""
  } = {}) {
    const task = await writeCodexAppServerTaskEvent(runtime, sessionId, {
      healthAttempt,
      kind,
      message,
      status: "running",
      terminalSessionId
    });
    return {
      healthAttempt,
      task
    };
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sessionId
   * @param {string} terminalSessionId
   * @param {object} [options]
   * @param {object | null} [options.healthAttempt]
   */
  async function writeCodexAppServerReady(runtime, sessionId, terminalSessionId, {
    healthAttempt = null
  } = {}) {
    if (!healthAttempt && runtime) {
      const currentSession = await runtime.getSession(sessionId).catch(() => null);
      const currentTask = (Array.isArray(currentSession?.backgroundTasks)
        ? currentSession.backgroundTasks
        : [])
        .find((task) => String(task?.id || "").trim() === CODEX_APP_SERVER_TASK_ID) || null;
      if (
        currentTask?.status === "ready" &&
        trimmedText(currentTask?.message) === "Codex is ready." &&
        !trimmedText(currentTask?.error) &&
        trimmedText(currentTask?.terminalSessionId) === trimmedText(terminalSessionId)
      ) {
        return currentTask;
      }
    }
    const task = await writeCodexAppServerTaskEvent(runtime, sessionId, {
      healthAttempt,
      kind: "ready",
      message: "Codex is ready.",
      status: "ready",
      terminalSessionId
    });
    return task;
  }

  async function writeCodexAppServerFailure(runtime, sessionId, result, {
    healthAttempt = null,
    terminalSessionId = ""
  } = {}) {
    await writeCodexAppServerTaskEvent(runtime, sessionId, {
      error: errorMessage(result),
      healthAttempt,
      kind: "failed",
      message: "Codex app-server preparation failed.",
      retryable: result?.retryable !== false,
      status: "failed",
      terminalSessionId
    });
    return result;
  }

  async function writeCodexAppServerBlocked(runtime, sessionId, result, {
    terminalSessionId = ""
  } = {}) {
    await writeCodexAppServerTaskEvent(runtime, sessionId, {
      error: errorMessage(result),
      kind: "blocked",
      message: errorMessage(result) || "Codex cannot start for this session clone.",
      publishReason: "codex-app-server-blocked",
      retryable: false,
      status: "ready",
      terminalSessionId
    });
    return result;
  }

  return Object.freeze({
    running: writeCodexAppServerRunning,
    ready: writeCodexAppServerReady,
    failure: writeCodexAppServerFailure,
    blocked: writeCodexAppServerBlocked
  });
}

/**
 * Application workspace policy uses the existing native retirement API before
 * publishing its original blocked-health result. The writer keeps its original contract.
 * @param {object} dependencies
 * @param {CodexAppServerRunOwner} dependencies.runOwner
 * @param {CodexSessionRuntimeHost} dependencies.sessionRuntimeHost
 * @param {CodexStartupHealth} dependencies.health
 */
export function createCodexUnavailableWorktreeHandler({
  runOwner,
  sessionRuntimeHost,
  health
}) {
  const { codexAppServerRuntimeOptionsForSession } = sessionRuntimeHost;
  const { blocked: writeCodexAppServerBlocked } = health;

  function retireAndCloseCodexAppServerProviderForSession(sessionId = "", options = null) {
    return runOwner.retireProviderForSession(sessionId, options);
  }

  /**
   * @param {Vibe64SessionRuntime} runtime
   * @param {string} sessionId
   * @param {object} result
   */
  async function blockCodexAppServerForUnavailableWorktree(runtime, sessionId, result) {
    // Detach the unavailable session's client from its shared app-server runtime.
    const session = await runtime.getSession(sessionId).catch(() => null);
    if (session) {
      await retireAndCloseCodexAppServerProviderForSession(
        sessionId,
        await codexAppServerRuntimeOptionsForSession(session, {
          runtime
        })
      );
    }
    return writeCodexAppServerBlocked(runtime, sessionId, result);
  }

  return blockCodexAppServerForUnavailableWorktree;
}

function dateValueMs(value = "") {
  const parsed = Date.parse(trimmedText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function codexAppServerBackgroundTasks(session = {}) {
  return Array.isArray(session.backgroundTasks) ? session.backgroundTasks : [];
}

export function codexAppServerTaskFinishedAfterRun(session = {}, run) {
  const runUpdatedMs = dateValueMs(run?.updatedAt || run?.startedAt || run?.at);
  if (!runUpdatedMs) {
    return false;
  }
  return codexAppServerBackgroundTasks(session).some((task) => (
    trimmedText(task?.id) === CODEX_APP_SERVER_TASK_ID &&
    ["failed", "ready"].includes(trimmedText(task?.status)) &&
    dateValueMs(task?.updatedAt || task?.finishedAt || task?.at) > runUpdatedMs
  ));
}
