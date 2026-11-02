import { drainProcessGroup } from "./detached.js";
import { byteLength, terminalSessionResponse, trimBuffer } from "./terminalSessionViews.js";

/**
 * A terminal session's input and output records, write failures, lifecycle
 * hooks and the steps that stop and close it.
 */
function applySessionMetadata(session, metadata = {}) {
  if (!session || !metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return terminalSessionResponse(session);
  }
  session.metadata = {
    ...(session.metadata || {}),
    ...metadata
  };
  sendToSubscribers(session, {
    metadata: session.metadata,
    type: "metadata"
  });
  return terminalSessionResponse(session);
}

function recordTerminalInput(session, data = "") {
  const bytes = byteLength(data);
  if (bytes < 1) {
    return;
  }
  session.inputVersion = Number(session.inputVersion || 0) + 1;
  session.lastInputAt = new Date().toISOString();
  session.lastInputBytes = bytes;
}

function recordTerminalOutput(session, data = "") {
  const bytes = byteLength(data);
  if (bytes < 1) {
    return;
  }
  session.outputVersion = Number(session.outputVersion || 0) + 1;
  session.lastOutputAt = new Date().toISOString();
  session.lastOutputBytes = bytes;
}

function sendToSubscribers(session, message) {
  if (!session?.subscribers?.size) {
    return;
  }
  for (const subscriber of [...session.subscribers]) {
    try {
      subscriber(message);
    } catch {
      session.subscribers.delete(subscriber);
    }
  }
}

function terminalErrorDetails(error) {
  const code = String(error?.code || "");
  const message = String(error?.message || error || "Terminal PTY error.");
  return {
    code,
    message
  };
}

function reportTerminalWriteError(session, error) {
  if (!session) {
    return;
  }
  const details = terminalErrorDetails(error);
  session.lastWriteErrorAt = new Date().toISOString();
  session.lastWriteErrorCode = details.code;
  session.lastWriteError = details.message;
  console.warn("Vibe64 terminal PTY write error.", {
    code: details.code,
    id: session.id,
    metadata: session.metadata || {},
    message: details.message,
    namespace: session.namespace || ""
  });
  sendToSubscribers(session, {
    code: details.code,
    error: details.message,
    type: "error"
  });
}

function attachTerminalWriteErrorHandler(session) {
  const writeStream = session?.terminal?._writeStream;
  // readable-check: allow method-probe - platform object: node-pty exposes its write stream only on some platforms
  if (!writeStream || typeof writeStream.on !== "function") {
    return;
  }
  writeStream.on("error", (error) => {
    reportTerminalWriteError(session, error);
  });
}

function appendTerminalFailure(session, message, chunkMessage = message) {
  const chunk = `\r\n[studio] ${chunkMessage}\r\n`;
  session.closeError = message;
  session.output = trimBuffer(`${session.output}${chunk}`);
  sendToSubscribers(session, {
    chunk,
    type: "output"
  });
  sendToSubscribers(session, {
    error: message,
    type: "error"
  });
}

/**
 * Runs a stop or close hook once; resolves to null, or the hook's failure.
 */
async function runLifecycleHook(session, {
  code,
  flag,
  hook,
  label,
  payload
}) {
  if (session[flag]) {
    return null;
  }
  session[flag] = true;
  try {
    await session[hook](payload);
    return null;
  } catch (error) {
    const message = String(error?.message || error || `${label}.`);
    const failure = error instanceof Error ? error : new Error(message);
    failure.code ||= code;
    appendTerminalFailure(session, message, `${label}: ${message}`);
    return failure;
  }
}

function reportTerminalLifecycleFailure(session, error) {
  const key = `${String(error?.code || "terminal_cleanup_failed")}:${String(error?.message || "")}`;
  session.reportedLifecycleFailures ||= new Set();
  if (session.reportedLifecycleFailures.has(key)) {
    return error;
  }
  session.reportedLifecycleFailures.add(key);
  appendTerminalFailure(session, String(error?.message || error || "Terminal cleanup failed."));
  return error;
}

function terminalCloseAggregateFailure(session, failures = []) {
  const error = new AggregateError(
    failures,
    `Terminal session could not close cleanly: ${session.id}`
  );
  error.code = failures.some((failure) => String(failure?.code || "").startsWith("terminal_exit_"))
    ? "terminal_exit_unverified"
    : "terminal_cleanup_failed";
  error.terminalSessionId = session.id;
  return error;
}

function beginTerminalStopHook(session, reason) {
  if (!session.stopHookCompletion) {
    session.stopHookCompletion = Promise.resolve().then(() => runLifecycleHook(session, {
      code: "terminal_stop_hook_failed",
      flag: "stopHookStarted",
      hook: "onStop",
      label: "Terminal stop failed",
      payload: {
        id: session.id,
        output: session.output,
        reason,
        status: session.status
      }
    }));
  }
  return session.stopHookCompletion;
}

function beginTerminalCloseHook(session, reason) {
  if (!session.closeHookCompletion) {
    session.closeHookCompletion = Promise.resolve().then(() => runLifecycleHook(session, {
      code: "terminal_close_hook_failed",
      flag: "closeHookStarted",
      hook: "onClose",
      label: "Terminal finalization failed",
      payload: {
        exitCode: session.exitCode,
        id: session.id,
        output: session.output,
        reason,
        status: session.status
      }
    }));
  }
  return session.closeHookCompletion;
}

function markTerminalExited(session) {
  if (session.status === "exited") {
    return;
  }
  session.status = "exited";
  sendToSubscribers(session, {
    closeError: session.closeError || "",
    exitCode: session.exitCode,
    status: session.status,
    type: "status"
  });
}

function beginTerminalScopeDrain(session) {
  if (!session.scopeDrainCompletion) {
    session.scopeDrainCompletion = (async () => {
      if (process.platform !== "win32" && !await drainProcessGroup(session.terminal.pid)) {
        const error = new Error(`Terminal execution scope did not become empty: ${session.id}`);
        error.code = "terminal_execution_drain_failed";
        throw error;
      }
    })();
    session.scopeDrainCompletion.catch(() => null);
  }
  return session.scopeDrainCompletion;
}

async function settleTerminalExitStatus(session) {
  try {
    await session.scopeDrainCompletion;
  } catch (error) {
    reportTerminalLifecycleFailure(session, error);
  }
  try {
    await Promise.all([
      beginTerminalCloseHook(session, session.stopReason || "exit"),
      session.stopHookCompletion
    ]);
  } catch (error) {
    reportTerminalLifecycleFailure(session, error);
  }
  markTerminalExited(session);
}

async function beginTerminalStop(session, reason = "stop") {
  if (!session || session.processExited) {
    return {
      failures: []
    };
  }
  session.stopReason ||= String(reason || "stop");
  if (session.status === "running") {
    session.status = "closing";
    sendToSubscribers(session, {
      exitCode: session.exitCode,
      status: session.status,
      type: "status"
    });
  }
  const failures = [];
  // Cleanup and process termination have independent completion signals.
  // A queued hook must neither keep the child alive nor be declared failed.
  beginTerminalStopHook(session, session.stopReason);
  if (!session.processExited && !session.killStarted) {
    session.killStarted = true;
    try {
      session.terminal.kill();
    } catch (error) {
      session.killStarted = false;
      const failure = error instanceof Error
        ? error
        : new Error(String(error || "Terminal process could not be killed."));
      failure.code ||= "terminal_kill_failed";
      failures.push(reportTerminalLifecycleFailure(session, failure));
    }
  }
  try {
    await beginTerminalScopeDrain(session);
  } catch (error) {
    failures.push(reportTerminalLifecycleFailure(session, error));
  }
  return {
    failures
  };
}

function terminalSessionCloseFailure(reason, { id, namespace }) {
  const cause = reason instanceof Error
    ? reason
    : new Error(String(reason || "Terminal close failed."));
  const error = new Error(
    `Failed to close terminal session "${id}" in namespace "${namespace}": ${cause.message}`,
    { cause }
  );
  error.code = String(cause.code || "terminal_close_failed");
  error.namespace = namespace;
  error.terminalSessionId = id;
  return error;
}

export {
  applySessionMetadata,
  attachTerminalWriteErrorHandler,
  beginTerminalCloseHook,
  beginTerminalScopeDrain,
  beginTerminalStop,
  markTerminalExited,
  recordTerminalInput,
  recordTerminalOutput,
  reportTerminalLifecycleFailure,
  reportTerminalWriteError,
  sendToSubscribers,
  settleTerminalExitStatus,
  terminalCloseAggregateFailure,
  terminalSessionCloseFailure
};
