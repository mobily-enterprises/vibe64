import { unref } from "vue";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";

function resolveCallback(callback, fallback) {
  return typeof callback === "function" ? callback : fallback;
}

function normalizeTerminalSessionId(session = {}) {
  return String(session.id || session.terminalSessionId || "").trim();
}

function useCodexTerminalElement({
  onBeforeTerminalSessionChange = null,
  onOutput = null,
  onSessionUpdate = null,
  onStatusUpdate = null,
  onUserData = null,
  readOnly = false,
  webSocketUrl = null
} = {}) {
  const notifyBeforeTerminalSessionChange = resolveCallback(onBeforeTerminalSessionChange, () => null);
  const {
    applyTerminalSession,
    terminalSessionId,
    ...terminal
  } = useStudioTerminal({
    fitOnResize: true,
    liveResize: true,
    onOutput,
    onSessionUpdate,
    onStatusUpdate,
    onUserData,
    readOnly,
    resizeReportDelayMs: 120,
    webSocketUrl
  });

  function applyCodexTerminalSession(session = {}, {
    fallbackStatus = "running",
    preserveOutput = true
  } = {}) {
    const nextTerminalSessionId = normalizeTerminalSessionId(session);
    if (!nextTerminalSessionId) {
      return {
        applied: false,
        hasTerminalSession: Boolean(unref(terminalSessionId))
      };
    }

    const previousTerminalSessionId = String(unref(terminalSessionId) || "");
    const sameTerminalSession = previousTerminalSessionId === nextTerminalSessionId;
    const terminalSessionChanged = Boolean(
      previousTerminalSessionId &&
      previousTerminalSessionId !== nextTerminalSessionId
    );

    if (terminalSessionChanged) {
      notifyBeforeTerminalSessionChange({
        nextTerminalSessionId,
        previousTerminalSessionId
      });
    }

    applyTerminalSession({
      ...session,
      id: nextTerminalSessionId
    }, {
      fallbackStatus,
      preserveOutput,
      resize: !sameTerminalSession
    });

    return {
      applied: true,
      sameTerminalSession,
      terminalSessionChanged,
      terminalSessionId: nextTerminalSessionId
    };
  }

  return {
    ...terminal,
    terminalSessionId,
    applyCodexTerminalSession
  };
}

export {
  normalizeTerminalSessionId,
  useCodexTerminalElement
};
