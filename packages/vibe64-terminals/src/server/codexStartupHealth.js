import crypto from "node:crypto";

export const CODEX_APP_SERVER_TASK_ID = "codex_app_server";

function normalizeText(value) {
  return String(value || "").trim();
}

export function errorMessage(value, fallback = "Codex could not be prepared.") {
  return normalizeText(value?.error || value?.message || value) || fallback;
}

function createCodexAppServerHealthAttempt() {
  return {
    id: crypto.randomUUID(),
    startedAt: new Date().toISOString()
  };
}

// Original application health-task projection; native readiness stays in JSKIT.
export function createCodexStartupHealth(publishSessionChanged) {
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
    const normalizedStatus = normalizeText(status) || "running";
    const healthAttemptId = normalizeText(healthAttempt?.id);
    const healthAttemptStartedAt = normalizeText(healthAttempt?.startedAt);
    const patch = {
      error: normalizeText(error),
      kind: "codex_app_server",
      label: "Codex app-server",
      message: normalizeText(message),
      retryable: normalizedStatus === "failed" && retryable !== false,
      status: normalizedStatus,
      terminalSessionId: normalizeText(terminalSessionId)
    };
    if (healthAttemptId) {
      patch.healthAttemptId = healthAttemptId;
    }
    if (healthAttemptStartedAt && normalizedStatus === "running") {
      patch.healthAttemptStartedAt = healthAttemptStartedAt;
    }
    const task = await runtime.store.writeBackgroundTaskEvent(sessionId, CODEX_APP_SERVER_TASK_ID, {
      event: {
        error: normalizeText(error),
        healthAttemptId,
        kind: normalizeText(kind || normalizedStatus),
        message: normalizeText(message),
        status: normalizedStatus
      },
      patch,
      shouldWrite: ({ previous = {} } = {}) => {
        if (normalizedStatus === "running" || !healthAttemptId) {
          return true;
        }
        return normalizeText(previous.healthAttemptId) === healthAttemptId &&
          normalizeText(previous.status) === "running";
      }
    });
    const publishedStatus = normalizeText(task?.status) || normalizedStatus;
    await publishSessionChanged(sessionId, {
      reason: normalizeText(publishReason) || `codex-app-server-${publishedStatus}`
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

  async function writeCodexAppServerReady(runtime, sessionId, terminalSessionId, {
    healthAttempt = null
  } = {}) {
    if (!healthAttempt && typeof runtime?.getSession === "function") {
      const currentSession = await runtime.getSession(sessionId).catch(() => null);
      const currentTask = (Array.isArray(currentSession?.backgroundTasks)
        ? currentSession.backgroundTasks
        : [])
        .find((task) => String(task?.id || "").trim() === CODEX_APP_SERVER_TASK_ID) || null;
      if (
        currentTask?.status === "ready" &&
        normalizeText(currentTask?.message) === "Codex is ready." &&
        !normalizeText(currentTask?.error) &&
        normalizeText(currentTask?.terminalSessionId) === normalizeText(terminalSessionId)
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

  return { running: writeCodexAppServerRunning, ready: writeCodexAppServerReady,
    failure: writeCodexAppServerFailure, blocked: writeCodexAppServerBlocked };
}

// Application workspace policy uses the existing native retirement API before
// publishing its original blocked-health result. The writer keeps its original contract.
export function createCodexUnavailableWorktreeHandler({ runOwner, sessionRuntimeHost, health }) {
  const { codexAppServerRuntimeOptionsForSession } = sessionRuntimeHost;
  const { blocked: writeCodexAppServerBlocked } = health;

  function retireAndCloseCodexAppServerProviderForSession(sessionId = "", options = null) {
    return runOwner.retireProviderForSession(sessionId, options);
  }

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
  const parsed = Date.parse(normalizeText(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function codexAppServerBackgroundTasks(session = {}) {
  return Array.isArray(session.backgroundTasks) ? session.backgroundTasks : [];
}

export function codexAppServerTaskFinishedAfterRun(session = {}, run = {}) {
  const runUpdatedMs = dateValueMs(run?.updatedAt || run?.startedAt || run?.at);
  if (!runUpdatedMs) {
    return false;
  }
  return codexAppServerBackgroundTasks(session).some((task) => (
    normalizeText(task?.id) === CODEX_APP_SERVER_TASK_ID &&
    ["failed", "ready"].includes(normalizeText(task?.status)) &&
    dateValueMs(task?.updatedAt || task?.finishedAt || task?.at) > runUpdatedMs
  ));
}
