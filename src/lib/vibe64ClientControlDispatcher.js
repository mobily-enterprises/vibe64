import {
  VIBE64_CLIENT_CONTROL_ACTIONS,
  controlClientAction
} from "@/lib/vibe64PresentationControls.js";

function openDiffControl({
  diff = {},
  openDiffPane = null
} = {}) {
  if (typeof openDiffPane === "function") {
    return openDiffPane();
  }
  if (typeof diff.openDialog !== "function") {
    return false;
  }
  diff.openDialog();
  return true;
}

async function prepareCodexThreadControl({
  ensureCodexThread = null,
  openCodexTerminal = null,
  refreshSessionData = async () => null,
  session = {},
  sessionId = ""
} = {}) {
  const normalizedSessionId = String(sessionId || session?.sessionId || "").trim();
  if (!normalizedSessionId) {
    return false;
  }
  if (typeof ensureCodexThread !== "function") {
    throw new Error("Codex thread preparation is unavailable.");
  }
  const result = await ensureCodexThread(normalizedSessionId);
  if (result?.ok === false) {
    if (typeof openCodexTerminal === "function") {
      await openCodexTerminal({
        result,
        source: "client_control"
      });
    }
    return result;
  }
  await refreshSessionData();
  return true;
}

async function reconnectCodexThreadsControl({
  openCodexTerminal = null,
  reconnectCodexThreads = null,
  refreshSessionData = async () => null
} = {}) {
  if (typeof reconnectCodexThreads !== "function") {
    throw new Error("Codex reconnection is unavailable.");
  }
  const result = await reconnectCodexThreads();
  if (result?.ok === false) {
    if (typeof openCodexTerminal === "function") {
      await openCodexTerminal({
        result,
        source: "client_control"
      });
    }
    return result;
  }
  await refreshSessionData();
  return true;
}

const VIBE64_CLIENT_CONTROL_DISPATCHERS = Object.freeze({
  [VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF]: openDiffControl,
  [VIBE64_CLIENT_CONTROL_ACTIONS.RECONNECT_CODEX_THREADS]: reconnectCodexThreadsControl,
  [VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL]: prepareCodexThreadControl
});

function clientControlDispatcher(control = {}) {
  return VIBE64_CLIENT_CONTROL_DISPATCHERS[controlClientAction(control)] || null;
}

function clientControlHasDispatcher(control = {}) {
  return Boolean(clientControlDispatcher(control));
}

async function runVibe64ClientControl(control = {}, context = {}) {
  const dispatcher = clientControlDispatcher(control);
  if (!dispatcher) {
    return false;
  }
  return dispatcher(context);
}

export {
  VIBE64_CLIENT_CONTROL_DISPATCHERS,
  clientControlDispatcher,
  clientControlHasDispatcher,
  runVibe64ClientControl
};
