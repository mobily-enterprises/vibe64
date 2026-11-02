import { computed, getCurrentScope, onScopeDispose, ref, unref, watch } from "vue";
import {
  stripTerminalControlSequences,
  terminalLastMeaningfulLine
} from "@/lib/codexOutput.js";
import { validateTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import { createTerminalMatcherEngine } from "@/lib/vibe64TerminalMatchers.js";
import { createTerminalPolicyEngine } from "@/lib/vibe64TerminalPolicies.js";
import { useVibe64TerminalConnection } from "@/composables/useVibe64TerminalConnection.js";
import { useVibe64TerminalDisplay } from "@/composables/useVibe64TerminalDisplay.js";
import { useVibe64TerminalLifecycle } from "@/composables/useVibe64TerminalLifecycle.js";

const TERMINAL_RECONNECT_DELAY_MS = 250;
const TERMINAL_RECONNECT_MAX_DELAY_MS = 5_000;

function resolveCallback(callback, fallback) {
  return typeof callback === "function" ? callback : fallback;
}

/**
 * The one terminal runtime: a session's state, presentation, policies and
 * matchers, composed with its live stream (useVibe64TerminalConnection), its
 * screen (useVibe64TerminalDisplay) and its lifecycle (useVibe64TerminalLifecycle).
 */
function useVibe64Terminal({
  driver,
  fitOnResize = null,
  initiallyExpanded = false,
  initiallyVisible = true,
  liveResize = true,
  matchers = [],
  onEvent = null,
  onMatch = null,
  onOutput = null,
  onSessionUpdate = null,
  onStatusUpdate = null,
  onUserData = null,
  policies = [],
  presentation = "inline",
  readOnly = false,
  reconnectDelayMs = TERMINAL_RECONNECT_DELAY_MS,
  reconnectMaxDelayMs = TERMINAL_RECONNECT_MAX_DELAY_MS,
  resizeReportDelayMs = 0
} = {}) {
  const terminalDriver = validateTerminalDriver(driver);
  const terminalHost = ref(null);
  const terminalSessionId = ref("");
  const terminalStatus = ref("");
  const terminalCommandPreview = ref("");
  const terminalCloseError = ref("");
  const terminalError = ref("");
  const terminalExitCode = ref(null);
  const terminalMetadata = ref({});
  const terminalStarting = ref(false);
  const terminalAttention = ref(null);
  const terminalExpanded = ref(Boolean(initiallyExpanded));
  const terminalOwnership = ref("none");
  const terminalPresentation = ref(String(presentation || "inline"));
  const terminalVisible = ref(Boolean(initiallyVisible));

  const notifyOutput = resolveCallback(onOutput, () => null);
  const notifyEvent = resolveCallback(onEvent, () => null);
  const notifyMatch = resolveCallback(onMatch, () => null);
  const notifySessionUpdate = resolveCallback(onSessionUpdate, () => null);
  const notifyStatusUpdate = resolveCallback(onStatusUpdate, () => null);
  const notifyUserData = resolveCallback(onUserData, () => null);
  const terminalExited = computed(() => terminalStatus.value === "exited");
  const terminalReconnectDelay = Math.max(0, Number(reconnectDelayMs) || 0);
  const terminalReconnectMaxDelay = Math.max(
    terminalReconnectDelay,
    Number(reconnectMaxDelayMs) || 0
  );

  const connection = useVibe64TerminalConnection({
    driver: terminalDriver,
    terminalSessionId,
    terminalStatus,
    terminalError,
    emitTerminalEvent,
    applySessionMessage: applyTerminalStreamMessage,
    notifyUserData,
    // The display is built on this connection; its size is read once both exist.
    readTerminalSize: () => display.terminalCurrentSize(),
    liveResize: terminalLiveResize,
    resizeReportDelay: terminalResizeReportDelay,
    reconnectDelay: terminalReconnectDelay,
    reconnectMaxDelay: terminalReconnectMaxDelay
  });
  const display = useVibe64TerminalDisplay({
    connection,
    terminalHost,
    terminalError,
    readOnly: terminalReadOnly,
    fitOnResize: terminalFitOnResize,
    reportOutput: reportTerminalOutput
  });
  const { terminalOutput } = display;
  const terminalPlainOutput = computed(() => stripTerminalControlSequences(terminalOutput.value));
  const terminalSummaryLine = computed(() => terminalLastMeaningfulLine(terminalOutput.value));
  const lifecycle = useVibe64TerminalLifecycle({
    driver: terminalDriver,
    terminal: {
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
    },
    connection,
    display
  });

  function currentSessionId() {
    return String(terminalSessionId.value || "");
  }

  function emitTerminalEvent(type, payload = {}) {
    const event = {
      ...payload,
      sessionId: String(payload.sessionId || currentSessionId()),
      type: String(type || payload.type || "")
    };
    notifyEvent(event);
    terminalPolicyEngine.handle(event);
    return event;
  }

  function showTerminal({ manual = false } = {}) {
    if (terminalVisible.value) {
      return false;
    }
    terminalVisible.value = true;
    emitTerminalEvent("visibility-change", {
      manual,
      visible: true
    });
    return true;
  }

  function hideTerminal({ manual = false } = {}) {
    if (!terminalVisible.value) {
      return false;
    }
    terminalVisible.value = false;
    emitTerminalEvent("visibility-change", {
      manual,
      visible: false
    });
    return true;
  }

  function expandTerminal({ manual = false } = {}) {
    showTerminal({ manual });
    if (terminalExpanded.value) {
      return false;
    }
    terminalExpanded.value = true;
    emitTerminalEvent("expanded-change", {
      expanded: true,
      manual
    });
    return true;
  }

  function collapseTerminal({ manual = false } = {}) {
    if (!terminalExpanded.value) {
      return false;
    }
    terminalExpanded.value = false;
    emitTerminalEvent("expanded-change", {
      expanded: false,
      manual
    });
    return true;
  }

  function minimizeTerminal({ manual = false } = {}) {
    terminalPresentation.value = "minimized";
    collapseTerminal({ manual });
    showTerminal({ manual });
    return true;
  }

  const terminalPolicyEngine = createTerminalPolicyEngine({
    actions: {
      collapse: collapseTerminal,
      close: lifecycle.closeTerminal,
      detach: lifecycle.detachTerminal,
      emit(action) {
        return emitTerminalEvent(action.eventType || action.name || "policy-event", {
          policyEvent: action.event
        });
      },
      expand: expandTerminal,
      focus: display.focusTerminal,
      hide: hideTerminal,
      interrupt: interruptTerminal,
      minimize: minimizeTerminal,
      send(action) {
        return connection.sendTerminalData(action.data, {
          source: "policy"
        });
      },
      show: showTerminal
    },
    currentSessionId,
    policies
  });

  const terminalMatcherEngine = createTerminalMatcherEngine({
    matchers,
    onMatch(payload) {
      terminalAttention.value = {
        kind: "match",
        matcher: payload.matcher
      };
      notifyMatch(payload);
      emitTerminalEvent("match", payload);
      emitTerminalEvent(`match:${payload.matcher}`, payload);
    }
  });

  function inspectTerminalMatchers(source) {
    return terminalMatcherEngine.inspect({
      error: terminalError.value,
      exitCode: terminalExitCode.value,
      metadata: terminalMetadata.value,
      output: terminalOutput.value,
      outputVersion: display.currentOutputVersion(),
      sessionId: currentSessionId(),
      source,
      status: terminalStatus.value
    });
  }

  function reportTerminalOutput(outputEvent) {
    notifyOutput(outputEvent);
    emitTerminalEvent("output", outputEvent);
    inspectTerminalMatchers(outputEvent.source);
  }

  function setTerminalHost(element) {
    terminalHost.value = element || null;
  }

  function terminalReadOnly() {
    return Boolean(typeof readOnly === "function" ? readOnly() : unref(readOnly));
  }

  function terminalLiveResize() {
    return Boolean(typeof liveResize === "function" ? liveResize() : unref(liveResize));
  }

  function terminalFitOnResize() {
    if (fitOnResize === null || typeof fitOnResize === "undefined") {
      return terminalLiveResize();
    }
    return Boolean(typeof fitOnResize === "function" ? fitOnResize() : unref(fitOnResize));
  }

  function terminalResizeReportDelay() {
    const delay = Number(typeof resizeReportDelayMs === "function"
      ? resizeReportDelayMs()
      : unref(resizeReportDelayMs));
    return Number.isFinite(delay) && delay > 0 ? delay : 0;
  }

  function disposeTerminalUi() {
    connection.closeTerminalSocket();
    display.disposeTerminalDisplay();
  }

  function resetTerminalSessionState() {
    connection.clearTerminalReconnect();
    connection.allowTerminalReconnect();
    terminalSessionId.value = "";
    terminalStatus.value = "";
    terminalCommandPreview.value = "";
    terminalCloseError.value = "";
    terminalExitCode.value = null;
    terminalError.value = "";
    terminalMetadata.value = {};
    terminalOwnership.value = "none";
  }

  function terminalSnapshot() {
    return {
      commandPreview: terminalCommandPreview.value,
      closeError: terminalCloseError.value,
      error: terminalError.value,
      exitCode: terminalExitCode.value,
      id: terminalSessionId.value,
      metadata: terminalMetadata.value,
      output: terminalOutput.value,
      status: terminalStatus.value
    };
  }

  function setTerminalOutput(output, options = {}) {
    return display.writeTerminalOutput(output, options);
  }

  function applyTerminalSession(session = {}, {
    fallbackStatus = "",
    preserveOutput = false,
    replaceOutput = false,
    resize = true
  } = {}) {
    const terminalSession = session && typeof session === "object" && !Array.isArray(session) ? session : {};
    const nextTerminalSessionId = String(terminalSession.id || "");
    const terminalSessionChanged = Boolean(
      nextTerminalSessionId &&
      terminalSessionId.value &&
      nextTerminalSessionId !== terminalSessionId.value
    );
    if (terminalSessionChanged) {
      connection.closeTerminalSocket();
      display.resetTerminalDisplay();
    }
    if (!terminalSessionId.value || terminalSessionChanged) {
      connection.allowTerminalReconnect();
    }
    terminalSessionId.value = nextTerminalSessionId;
    const nextStatus = String(terminalSession.status || fallbackStatus || "");
    terminalExitCode.value = nextStatus === "exited" ? terminalSession.exitCode ?? null : null;
    terminalStatus.value = nextStatus;
    terminalCommandPreview.value = String(terminalSession.commandPreview || "");
    terminalCloseError.value = String(terminalSession.closeError || "");
    terminalMetadata.value = terminalSession.metadata &&
      typeof terminalSession.metadata === "object" &&
      !Array.isArray(terminalSession.metadata)
      ? terminalSession.metadata
      : {};
    if (!preserveOutput || Object.hasOwn(terminalSession, "output")) {
      display.writeTerminalOutput(terminalSession.output || "", {
        outputVersion: terminalSession.outputVersion,
        replace: replaceOutput
      });
    }
    if (resize) {
      void connection.sendTerminalResize();
    }
    notifySessionUpdate(terminalSession);
    notifyStatusUpdate({
      closeError: String(terminalSession.closeError || ""),
      exitCode: terminalExitCode.value,
      id: terminalSessionId.value,
      status: terminalStatus.value
    });
  }

  /** The stream's snapshot, output, metadata and status messages about the session. */
  function applyTerminalStreamMessage(message) {
    if (message.type === "snapshot") {
      applyTerminalSession(message.session || {}, {
        replaceOutput: message.replaceOutput === true
      });
      emitTerminalEvent("snapshot", {
        status: terminalStatus.value
      });
      return;
    }

    if (message.type === "output") {
      display.appendTerminalOutput(message.chunk, {
        outputVersion: message.outputVersion
      });
      return;
    }

    if (message.type === "metadata") {
      terminalMetadata.value = message.metadata &&
        typeof message.metadata === "object" &&
        !Array.isArray(message.metadata)
        ? message.metadata
        : {};
      notifySessionUpdate({
        id: terminalSessionId.value,
        metadata: terminalMetadata.value,
        status: terminalStatus.value
      });
      emitTerminalEvent("metadata", {
        metadata: terminalMetadata.value
      });
      return;
    }

    if (message.type === "status") {
      const nextStatus = String(message.status || terminalStatus.value || "");
      terminalExitCode.value = nextStatus === "exited" ? message.exitCode ?? null : null;
      terminalCloseError.value = String(message.closeError || "");
      terminalStatus.value = nextStatus;
      notifyStatusUpdate({
        closeError: String(message.closeError || ""),
        exitCode: terminalExitCode.value,
        id: terminalSessionId.value,
        status: terminalStatus.value
      });
    }
  }

  function terminalKeyData(key) {
    const normalizedKey = String(key || "").trim().toLowerCase();
    const keys = {
      "ctrl-c": "\u0003",
      enter: "\r",
      escape: "\u001b",
      tab: "\t"
    };
    if (!Object.hasOwn(keys, normalizedKey)) {
      throw new TypeError(`Unsupported terminal key: ${String(key || "")}`);
    }
    return keys[normalizedKey];
  }

  function sendTerminalKey(key, options = {}) {
    return connection.sendTerminalData(terminalKeyData(key), {
      source: "control",
      ...options
    });
  }

  async function interruptTerminal() {
    const interrupted = await sendTerminalKey("ctrl-c");
    if (interrupted) {
      emitTerminalEvent("interrupt");
    }
    return interrupted;
  }

  function sendCtrlC() {
    return interruptTerminal();
  }

  watch(terminalSessionId, (nextSessionId, previousSessionId) => {
    if (nextSessionId === previousSessionId) {
      return;
    }
    lifecycle.forgetSettledSession();
    terminalAttention.value = null;
    terminalMatcherEngine.reset(nextSessionId);
    terminalPolicyEngine.reset();
    emitTerminalEvent("session-change", {
      previousSessionId: String(previousSessionId || "")
    });
  }, {
    flush: "sync"
  });

  if (getCurrentScope()) {
    onScopeDispose(connection.closeTerminalSocket);
  }

  return {
    attachTerminal: lifecycle.attachTerminal,
    applyTerminalSession,
    closeTerminalSocket: connection.closeTerminalSocket,
    closeTerminal: lifecycle.closeTerminal,
    connectTerminalSocket: connection.connectTerminalSocket,
    detachTerminal: lifecycle.detachTerminal,
    disposeTerminalDisplay: display.disposeTerminalDisplay,
    disposeTerminalUi,
    collapseTerminal,
    expandTerminal,
    focusTerminal: display.focusTerminal,
    hideTerminal,
    interruptTerminal,
    minimizeTerminal,
    resetTerminalDisplay: display.resetTerminalDisplay,
    resetTerminalSessionState,
    restartTerminal: lifecycle.restartTerminal,
    sendCtrlC,
    sendTerminalData: connection.sendTerminalData,
    sendTerminalKey,
    setTerminalHost,
    setTerminalOutput,
    showTerminal,
    setupTerminalUi: display.setupTerminalUi,
    startTerminal: lifecycle.startTerminal,
    terminalCommandPreview,
    terminalCloseError,
    terminalConnectionStatus: connection.terminalConnectionStatus,
    terminalAttention,
    terminalError,
    terminalExpanded,
    terminalExited,
    terminalExitCode,
    terminalFocused: display.terminalFocused,
    terminalHost,
    terminalMetadata,
    terminalOwnership,
    terminalOutput,
    terminalPlainOutput,
    terminalPresentation,
    terminalSelectedText: display.terminalSelectedText,
    terminalSessionId,
    terminalStarting,
    terminalStatus,
    terminalSummaryLine,
    terminalVisible,
    terminalSnapshot,
    waitForExit: lifecycle.waitForExit,
    waitForSettlement: lifecycle.waitForSettlement
  };
}

export {
  useVibe64Terminal
};
