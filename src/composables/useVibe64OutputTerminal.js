import { computed, onBeforeUnmount, ref, watch } from "vue";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { useVibe64Terminal } from "@/composables/useVibe64Terminal.js";
import { vibe64OutputTerminalWebSocketUrl } from "@/lib/vibe64SessionApi.js";
import { createWebSocketTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import { launchTerminalStorageKey } from "@/lib/vibe64LaunchBrowserWindow.js";
import { launchTerminalIsReady } from "@/lib/vibe64LaunchPreview.js";

/**
 * The terminal of the session's running output: which run it shows, how it is
 * presented (docked or expanded) and its log. It follows the status's active
 * terminal, attaching to a new run and clearing one that is gone.
 * @param {{
 *   outputs: import("@/types.js").Vibe64OutputStatus,
 *   projectSlug: import("vue").Ref<string>
 * }} options
 */
function useVibe64OutputTerminal({ outputs, projectSlug }) {
  const {
    outputExecution,
    outputTargets,
    selectedSession,
    sessionId,
    status,
    terminalDisplayed
  } = outputs;
  const terminalExpanded = ref(false);
  let attachedTerminalId = "";

  const terminalWindowStorageKey = computed(() => launchTerminalStorageKey(
    selectedSession.value || {},
    projectSlug.value
  ));
  const terminal = useVibe64Terminal({
    driver: createWebSocketTerminalDriver({
      webSocketUrl(terminalId) {
        return vibe64OutputTerminalWebSocketUrl(sessionId.value, terminalId);
      }
    })
  });
  const {
    applyTerminalSession,
    closeTerminalSocket,
    connectTerminalSocket,
    disposeTerminalDisplay,
    disposeTerminalUi,
    resetTerminalDisplay,
    resetTerminalSessionState,
    terminalExitCode,
    terminalExited,
    terminalMetadata,
    terminalOutput,
    terminalSessionId,
    terminalStarting,
    terminalStatus
  } = terminal;

  const activeTerminal = computed(() => {
    const terminalStatusValue = status.value.activeTerminal;
    return isRecord(terminalStatusValue) ? terminalStatusValue : null;
  });
  const activeOutputTargetId = computed(() => String(
    terminalMetadata.value.outputTargetId ||
    activeTerminal.value?.metadata?.outputTargetId ||
    status.value.lastOutputTarget?.id ||
    ""
  ));
  const activeOutputTarget = computed(() => {
    return outputTargets.value.find((target) => target.id === activeOutputTargetId.value) || null;
  });
  const terminalLaunchReady = computed(() => launchTerminalIsReady({
    ...(activeTerminal.value?.metadata || {}),
    ...(terminalMetadata.value || {})
  }));
  const terminalIsRunning = computed(() => {
    const statusValue = terminalStatus.value || activeTerminal.value?.status || "";
    return statusValue === "running" || statusValue === "closing" || terminalStarting.value;
  });
  const terminalIndicatorState = computed(() => {
    if (terminalStatus.value === "exited" || activeTerminal.value?.status === "exited") {
      const exitCode = terminalExitCode.value ?? activeTerminal.value?.exitCode;
      return exitCode && exitCode !== 0 ? "failed" : "stopped";
    }
    if (terminalIsRunning.value) {
      return terminalLaunchReady.value ? "running" : "starting";
    }
    return "stopped";
  });
  const terminalIndicatorLabel = computed(() => {
    const presentationKind = activeOutputTarget.value?.presentation?.kind ||
      outputExecution.value.presentationKind;
    const finite = activeOutputTarget.value?.mode === "finite" || outputExecution.value.mode === "finite";
    if (terminalIndicatorState.value === "running") {
      return presentationKind === "web" ? "Server is running" : "Program is running";
    }
    if (terminalIndicatorState.value === "starting") {
      return finite ? "Build is running" : "Preparing output";
    }
    if (terminalIndicatorState.value === "failed") {
      return finite ? "Build failed" : "Program stopped with an error";
    }
    if (finite && outputExecution.value.state === "succeeded") {
      return "Build completed";
    }
    return presentationKind === "web" ? "Server is stopped" : "Program is stopped";
  });
  const terminalCanStop = computed(() => {
    return Boolean(terminalSessionId.value && (terminalStatus.value || activeTerminal.value?.status) === "running");
  });
  const terminalCanClose = computed(() => Boolean(
    terminalSessionId.value &&
    !terminalIsRunning.value &&
    (terminalExited.value || activeTerminal.value?.status === "exited")
  ));
  const terminalCanCopyLog = computed(() => Boolean(terminalOutput.value));
  const terminalVisible = computed(() => Boolean(terminalSessionId.value || activeTerminal.value));
  const terminalDockVisible = computed(() => Boolean(
    terminalDisplayed.value &&
    terminalVisible.value &&
    !terminalExpanded.value
  ));
  const terminalWindowVisible = computed(() => Boolean(
    terminalDisplayed.value &&
    terminalVisible.value &&
    terminalExpanded.value
  ));
  const terminalTitle = computed(() => activeOutputTarget.value?.label || "Run target");
  const terminalSubtitle = computed(() => {
    if (terminalIsRunning.value) {
      return "";
    }
    if (terminalStatus.value === "exited" || activeTerminal.value?.status === "exited") {
      const exitCode = terminalExitCode.value ?? activeTerminal.value?.exitCode;
      return exitCode === 0 ? "Exited" : `Exited with code ${exitCode}`;
    }
    return activeOutputTargetId.value ? "Ready" : "No output target running.";
  });

  function applyLaunchTerminalSession(terminalSession = {}) {
    if (!terminalSession || terminalSession.ok === false || !terminalSession.id) {
      return false;
    }
    attachedTerminalId = terminalSession.id;
    applyTerminalSession(terminalSession, {
      fallbackStatus: "running"
    });
    return true;
  }

  async function connectLaunchTerminal() {
    if (!terminalSessionId.value || !terminalDisplayed.value) {
      return false;
    }
    return connectTerminalSocket();
  }

  async function expandTerminal() {
    terminalExpanded.value = true;
    await connectLaunchTerminal();
  }

  function minimizeTerminal() {
    terminalExpanded.value = false;
    void connectLaunchTerminal();
  }

  function clearStaleLaunchTerminal() {
    attachedTerminalId = "";
    closeTerminalSocket();
    resetTerminalSessionState();
    resetTerminalDisplay();
  }

  /** The output is no longer displayed: drop its stream and screen. */
  function hideLaunchTerminal() {
    closeTerminalSocket();
    disposeTerminalDisplay();
  }

  /** The project or session changed: forget the previous run's terminal. */
  function resetLaunchTerminal() {
    attachedTerminalId = "";
    closeTerminalSocket();
    disposeTerminalDisplay();
    resetTerminalSessionState();
    resetTerminalDisplay();
    terminalExpanded.value = false;
  }

  async function copyLog() {
    if (!terminalOutput.value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
      return false;
    }
    await navigator.clipboard.writeText(terminalOutput.value);
    return true;
  }

  watch(activeTerminal, (nextTerminal) => {
    if (!nextTerminal?.id) {
      clearStaleLaunchTerminal();
      return;
    }
    if (nextTerminal.id !== attachedTerminalId) {
      closeTerminalSocket();
      resetTerminalDisplay();
      attachedTerminalId = nextTerminal.id;
    }
    applyTerminalSession(nextTerminal, {
      fallbackStatus: nextTerminal.status || "running"
    });
    void connectLaunchTerminal();
  }, {
    immediate: true
  });

  onBeforeUnmount(disposeTerminalUi);

  return {
    activeOutputTarget,
    activeOutputTargetId,
    activeTerminal,
    applyLaunchTerminalSession,
    clearStaleLaunchTerminal,
    connectLaunchTerminal,
    copyLog,
    expandTerminal,
    hideLaunchTerminal,
    minimizeTerminal,
    resetLaunchTerminal,
    terminal,
    terminalCanClose,
    terminalCanCopyLog,
    terminalCanStop,
    terminalDockVisible,
    terminalExpanded,
    terminalIndicatorLabel,
    terminalIndicatorState,
    terminalIsRunning,
    terminalLaunchReady,
    terminalSubtitle,
    terminalTitle,
    terminalVisible,
    terminalWindowStorageKey,
    terminalWindowVisible
  };
}

export {
  useVibe64OutputTerminal
};
