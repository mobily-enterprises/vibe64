import { watch } from "vue";

/**
 * A terminal session's lifecycle: starting, attaching, closing, detaching and
 * restarting it, and settling it. A session settles once, when it exits or
 * fails; `waitForExit` and `waitForSettlement` resolve with its snapshot then.
 * `terminal` is the runtime's own state and operations, `connection` its live
 * stream and `display` its screen.
 * @param {{
 *   driver: import("@/lib/vibe64TerminalDriver.js").Vibe64TerminalDriver,
 *   terminal: import("@/types.js").Vibe64TerminalState,
 *   connection: import("@/types.js").Vibe64TerminalConnection,
 *   display: import("@/types.js").Vibe64TerminalDisplay
 * }} options
 */
function useVibe64TerminalLifecycle({ driver, terminal, connection, display }) {
  const {
    terminalAttention,
    terminalError,
    terminalExitCode,
    terminalOwnership,
    terminalSessionId,
    terminalStarting,
    terminalStatus,
    applyTerminalSession,
    emitTerminalEvent,
    expandTerminal,
    inspectTerminalMatchers,
    resetTerminalSessionState,
    showTerminal,
    terminalSnapshot
  } = terminal;
  // readable-check: allow method-probe - optional operation: a WebSocket driver attaches to sessions its owner starts and has no startSession, so startTerminal refuses
  const driverStartsSessions = typeof driver.startSession === "function";
  // readable-check: allow method-probe - optional operation: run output and provider sign-in drivers have no closeSession; their sessions' owners stop the process, so closing only lets go of it
  const driverClosesSessions = typeof driver.closeSession === "function";
  const terminalExitWaiters = new Map();
  const terminalSettlementWaiters = new Map();
  let terminalExitNotifiedSessionId = "";
  let terminalSettledNotifiedSessionId = "";
  let terminalLastStartInput = {};

  function currentSessionId() {
    return String(terminalSessionId.value || "");
  }

  async function attachTerminal(session = {}, {
    connect = true,
    fallbackStatus = "running",
    ownership = "attached",
    preserveOutput = false,
    resize = true,
    show = false
  } = {}) {
    const sessionId = String(session.id || session.terminalSessionId || "").trim();
    if (!sessionId) {
      throw new Error("Terminal session id is required.");
    }
    terminalOwnership.value = ownership === "owned" ? "owned" : "attached";
    applyTerminalSession({
      ...session,
      id: sessionId
    }, {
      fallbackStatus,
      preserveOutput,
      resize
    });
    if (show) {
      showTerminal();
    }
    emitTerminalEvent("attached", {
      ownership: terminalOwnership.value
    });
    if (connect && terminalStatus.value !== "exited") {
      await connection.connectTerminalSocket();
    }
    return terminalSnapshot();
  }

  async function startTerminal(input = {}, {
    connect = true,
    show = true
  } = {}) {
    if (terminalStarting.value) {
      return false;
    }
    if (!driverStartsSessions) {
      throw new Error("This terminal driver cannot start sessions.");
    }
    terminalStarting.value = true;
    terminalLastStartInput = input && typeof input === "object" ? input : {};
    terminalError.value = "";
    if (show) {
      showTerminal();
      expandTerminal();
    }
    emitTerminalEvent("start-requested", {
      input
    });
    emitTerminalEvent("starting", {
      input
    });
    try {
      const session = await driver.startSession(input);
      if (!session || session.ok === false) {
        throw new Error(session?.error || "Terminal could not start.");
      }
      await attachTerminal(session, {
        connect,
        ownership: "owned",
        show: false
      });
      emitTerminalEvent("started", {
        session: terminalSnapshot()
      });
      return terminalSnapshot();
    } catch (error) {
      terminalError.value = String(error?.message || error || "Terminal could not start.");
      return false;
    } finally {
      terminalStarting.value = false;
    }
  }

  async function closeTerminal({
    deleteSession = terminalOwnership.value === "owned",
    preserveOutput = false
  } = {}) {
    const sessionId = currentSessionId();
    const ownership = terminalOwnership.value;
    connection.closeTerminalSocket();
    if (deleteSession && sessionId && driverClosesSessions) {
      try {
        await driver.closeSession(sessionId);
      } catch (error) {
        terminalError.value = String(error?.message || error || "Terminal could not close.");
        return false;
      }
    }
    emitTerminalEvent("close", {
      deleted: Boolean(deleteSession),
      ownership
    });
    resetTerminalSessionState();
    if (!preserveOutput) {
      display.resetTerminalDisplay();
    }
    return true;
  }

  function detachTerminal({
    preserveOutput = true
  } = {}) {
    const ownership = terminalOwnership.value;
    const sessionId = currentSessionId();
    connection.closeTerminalSocket();
    emitTerminalEvent("detached", {
      ownership,
      sessionId
    });
    resetTerminalSessionState();
    if (!preserveOutput) {
      display.resetTerminalDisplay();
    }
    return true;
  }

  async function restartTerminal(input = terminalLastStartInput, {
    deleteSession = terminalOwnership.value === "owned",
    show = true
  } = {}) {
    const previousSessionId = currentSessionId();
    if (previousSessionId && !(await closeTerminal({
      deleteSession
    }))) {
      return false;
    }
    const session = await startTerminal(input, {
      show
    });
    if (session) {
      emitTerminalEvent("restart", {
        previousSessionId
      });
    }
    return session;
  }

  function waitForExit(sessionId = currentSessionId()) {
    const normalizedSessionId = String(sessionId || "");
    if (!normalizedSessionId) {
      return Promise.reject(new Error("Terminal session id is required."));
    }
    if (
      normalizedSessionId === currentSessionId() &&
      terminalStatus.value === "exited"
    ) {
      return Promise.resolve(terminalSnapshot());
    }
    return new Promise((resolve) => {
      const waiters = terminalExitWaiters.get(normalizedSessionId) || [];
      waiters.push(resolve);
      terminalExitWaiters.set(normalizedSessionId, waiters);
    });
  }

  function waitForSettlement(sessionId = currentSessionId()) {
    const normalizedSessionId = String(sessionId || "");
    if (!normalizedSessionId) {
      return Promise.reject(new Error("Terminal session id is required."));
    }
    if (
      normalizedSessionId === currentSessionId() &&
      (terminalStatus.value === "exited" || terminalError.value)
    ) {
      return Promise.resolve(terminalSnapshot());
    }
    return new Promise((resolve) => {
      const waiters = terminalSettlementWaiters.get(normalizedSessionId) || [];
      waiters.push(resolve);
      terminalSettlementWaiters.set(normalizedSessionId, waiters);
    });
  }

  function resolveExitWaiters(sessionId) {
    const waiters = terminalExitWaiters.get(sessionId) || [];
    terminalExitWaiters.delete(sessionId);
    const snapshot = terminalSnapshot();
    for (const resolve of waiters) {
      resolve(snapshot);
    }
    resolveSettlementWaiters(sessionId);
  }

  function resolveSettlementWaiters(sessionId) {
    const waiters = terminalSettlementWaiters.get(sessionId) || [];
    terminalSettlementWaiters.delete(sessionId);
    const snapshot = terminalSnapshot();
    for (const resolve of waiters) {
      resolve(snapshot);
    }
  }

  /** A new session settles on its own: forget which session was last notified. */
  function forgetSettledSession() {
    terminalExitNotifiedSessionId = "";
    terminalSettledNotifiedSessionId = "";
  }

  watch(terminalStatus, (status, previousStatus) => {
    if (status === previousStatus) {
      return;
    }
    inspectTerminalMatchers("status");
    emitTerminalEvent("status", {
      exitCode: terminalExitCode.value,
      previousStatus: String(previousStatus || ""),
      status: String(status || "")
    });
    if (status === "exited") {
      connection.clearTerminalReconnect();
    }
    if (
      status === "exited" &&
      currentSessionId() &&
      terminalExitNotifiedSessionId !== currentSessionId()
    ) {
      terminalExitNotifiedSessionId = currentSessionId();
      resolveExitWaiters(currentSessionId());
      emitTerminalEvent("exit", {
        exitCode: terminalExitCode.value,
        status
      });
      if (terminalSettledNotifiedSessionId !== currentSessionId()) {
        terminalSettledNotifiedSessionId = currentSessionId();
        emitTerminalEvent("settled", {
          error: "",
          exitCode: terminalExitCode.value,
          status
        });
      }
    }
  }, {
    flush: "sync"
  });

  watch(terminalError, (error, previousError) => {
    if (!error || error === previousError) {
      return;
    }
    terminalAttention.value = {
      error: String(error),
      kind: "error"
    };
    inspectTerminalMatchers("error");
    resolveSettlementWaiters(currentSessionId());
    emitTerminalEvent("error", {
      error: String(error)
    });
    if (currentSessionId() && terminalSettledNotifiedSessionId !== currentSessionId()) {
      terminalSettledNotifiedSessionId = currentSessionId();
      emitTerminalEvent("settled", {
        error: String(error),
        exitCode: terminalExitCode.value,
        status: terminalStatus.value
      });
    }
  }, {
    flush: "sync"
  });

  return {
    attachTerminal,
    closeTerminal,
    detachTerminal,
    forgetSettledSession,
    restartTerminal,
    startTerminal,
    waitForExit,
    waitForSettlement
  };
}

export {
  useVibe64TerminalLifecycle
};
