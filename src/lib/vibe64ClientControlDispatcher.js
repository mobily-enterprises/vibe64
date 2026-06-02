import {
  VIBE64_CLIENT_CONTROL_ACTIONS,
  controlClientAction
} from "@/lib/vibe64PresentationControls.js";
import {
  startVibe64CodexTerminal
} from "@/lib/vibe64SessionApi.js";

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

async function startCodexTerminalControl({
  refreshSessionData = async () => null,
  session = {},
  sessionId = ""
} = {}) {
  const normalizedSessionId = String(sessionId || session?.sessionId || "").trim();
  if (!normalizedSessionId) {
    return false;
  }
  const result = await startVibe64CodexTerminal(normalizedSessionId);
  if (result?.ok === false) {
    return result;
  }
  await refreshSessionData();
  return true;
}

const VIBE64_CLIENT_CONTROL_DISPATCHERS = Object.freeze({
  [VIBE64_CLIENT_CONTROL_ACTIONS.OPEN_DIFF]: openDiffControl,
  [VIBE64_CLIENT_CONTROL_ACTIONS.START_CODEX_TERMINAL]: startCodexTerminalControl
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
