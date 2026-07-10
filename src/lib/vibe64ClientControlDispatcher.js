import {
  VIBE64_CLIENT_CONTROL_ACTIONS,
  controlClientAction
} from "@/lib/vibe64PresentationControls.js";
import {
  requestVibe64AccountConnectionsDialog
} from "@/lib/vibe64AccountConnectionsDialog.js";
import {
  codexReconnectRequiredResult
} from "@/lib/vibe64CodexTerminalAttention.js";

function openCodexReconnectDialog() {
  return requestVibe64AccountConnectionsDialog({
    codexReconnectRequired: true,
    providerId: "codex",
    refresh: false
  });
}

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

async function prepareAgentSessionControl({
  ensureAgentSession = null,
  openCodexTerminal = null,
  refreshSessionData = async () => null,
  session = {},
  sessionId = ""
} = {}) {
  const normalizedSessionId = String(sessionId || session?.sessionId || "").trim();
  if (!normalizedSessionId) {
    return false;
  }
  if (typeof ensureAgentSession !== "function") {
    throw new Error("Assistant session preparation is unavailable.");
  }
  const result = await ensureAgentSession(normalizedSessionId);
  if (result?.ok === false) {
    if (codexReconnectRequiredResult(result) && openCodexReconnectDialog()) {
      return result;
    }
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

async function reconnectAgentSessionsControl({
  openCodexTerminal = null,
  reconnectAgentSessions = null,
  refreshSessionData = async () => null
} = {}) {
  if (typeof reconnectAgentSessions !== "function") {
    throw new Error("Assistant session reconnection is unavailable.");
  }
  const result = await reconnectAgentSessions();
  if (result?.ok === false) {
    if (codexReconnectRequiredResult(result) && openCodexReconnectDialog()) {
      return result;
    }
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
  [VIBE64_CLIENT_CONTROL_ACTIONS.RECONNECT_AGENT_SESSIONS]: reconnectAgentSessionsControl,
  [VIBE64_CLIENT_CONTROL_ACTIONS.START_AGENT_TERMINAL]: prepareAgentSessionControl
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
