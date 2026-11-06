import { computed } from "vue";
import {
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";

/**
 * What the Codex terminal shows about its own state: the error and its action,
 * the stage subtitle, and the start panel that offers to start, restart or
 * reconnect it.
 */
function useCodexTerminalPresentation({
  terminalController,
  serverCodexTerminal,
  sessionSourcePending,
  terminalReconnectRequired,
  terminalServerStale,
  terminalDisplayActive,
  canUseTerminal,
  terminalCanStart,
  componentMounted
}) {
  const {
    terminalConnectionStatus,
    terminalError,
    terminalExited,
    terminalSessionId,
    terminalStarting
  } = terminalController;
  const terminalErrorTitle = computed(() => {
    if (terminalError.value === CODEX_RECONNECT_REQUIRED_MESSAGE) {
      return "Reconnect Codex";
    }
    return String(terminalError.value || "").includes("app-server")
      ? "Codex app-server is not available"
      : "Codex terminal needs attention";
  });
  const terminalErrorActionText = computed(() => {
    if (terminalStarting.value) {
      return "Starting Codex…";
    }
    return terminalError.value === CODEX_RECONNECT_REQUIRED_MESSAGE
      ? "Reconnect Codex"
      : "Restart Codex";
  });
  const terminalSubtitle = computed(() => {
    if (terminalStarting.value) {
      return "Starting Codex";
    }
    if (terminalExited.value) {
      return "";
    }
    if (terminalConnectionStatus.value === "reconnecting") {
      return "Reconnecting Codex";
    }
    if (terminalConnectionStatus.value === "connecting") {
      return "Connecting Codex";
    }
    return "";
  });
  const terminalStartActionVisible = computed(() => !sessionSourcePending.value);
  const terminalStartIcon = computed(() => (
    terminalReconnectRequired.value || terminalExited.value || terminalServerStale.value ? "$restartAlt" : "$playCircle"
  ));
  const terminalStartPanelTitle = computed(() => {
    if (sessionSourcePending.value) {
      return "Session source is being prepared";
    }
    if (terminalStarting.value) {
      return "Starting Codex";
    }
    if (terminalReconnectRequired.value) {
      return "Reconnect Codex";
    }
    if (terminalServerStale.value) {
      return "Codex terminal needs restart";
    }
    return terminalExited.value ? "Codex terminal exited" : "Codex terminal is off";
  });
  const terminalStartPanelMessage = computed(() => {
    if (sessionSourcePending.value) {
      return "Codex will start from the session source after the clone has been created.";
    }
    if (terminalStarting.value) {
      return "Preparing this session terminal.";
    }
    if (terminalReconnectRequired.value) {
      return "Reconnect the Codex account before starting this session terminal.";
    }
    if (terminalServerStale.value) {
      return serverCodexTerminal.value.message || "The previous Codex terminal is still running, but Vibe64 cannot attach to it. Restart it for this session.";
    }
    return terminalExited.value ? "Restart it for this session." : "Start it for this session.";
  });
  const terminalStartButtonText = computed(() => {
    if (terminalStarting.value) {
      return "Starting Codex…";
    }
    if (terminalReconnectRequired.value) {
      return "Reconnect Codex";
    }
    return (terminalExited.value || terminalServerStale.value) ? "Restart Codex" : "Start Codex";
  });
  const showTerminalStartPanel = computed(() => (
    componentMounted.value &&
    (
      sessionSourcePending.value ||
      (terminalStarting.value && terminalDisplayActive.value) ||
      (
        canUseTerminal.value &&
        terminalCanStart.value &&
        (!terminalSessionId.value || terminalExited.value || terminalServerStale.value)
      )
    )
  ));

  return {
    showTerminalStartPanel,
    terminalErrorActionText,
    terminalErrorTitle,
    terminalStartActionVisible,
    terminalStartButtonText,
    terminalStartIcon,
    terminalStartPanelMessage,
    terminalStartPanelTitle,
    terminalSubtitle
  };
}

export { useCodexTerminalPresentation };
