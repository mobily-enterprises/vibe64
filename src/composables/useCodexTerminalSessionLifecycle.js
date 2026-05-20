import { computed, nextTick, onBeforeUnmount, onMounted, watch } from "vue";

import { useCodexTerminalSocket } from "@/composables/useCodexTerminalSocket.js";

function terminalSessionNotFound(error = "") {
  return String(error || "").toLowerCase().includes("terminal session not found");
}

function useCodexTerminalSessionLifecycle({
  appendTerminalOutput,
  canUseTerminal,
  clearCodexBusy,
  clearPromptEchoFilters,
  clearTerminalDisplay,
  clearTerminalOutput,
  closeTerminalSession,
  componentMounted,
  defaultExpanded,
  disposeTerminalViewport,
  emitSessionState,
  expanded,
  fitTerminal,
  onBeforeDispose,
  onBeforeDetach,
  onMountedReady,
  onSessionChanged,
  onTerminalRecovered,
  onTerminalSnapshot,
  onTerminalStarted,
  refreshTerminalOutput,
  resetTerminal,
  sessionId,
  setupTerminalUi,
  startTerminalSession,
  terminalCommandPreview,
  terminalError,
  terminalHost,
  terminalSessionId,
  terminalStarting,
  terminalStatus,
  visible,
  webSocketUrl,
  writeTerminalOutput
} = {}) {
  let terminalStartPromise = null;
  let terminalRecoveryPromise = null;

  const terminalExited = computed(() => terminalStatus.value === "exited");
  const showTerminalStartPanel = computed(() => (
    canUseTerminal.value &&
    componentMounted.value &&
    !terminalStarting.value &&
    (!terminalSessionId.value || terminalExited.value)
  ));

  function emitTerminalSessionState(extra = {}) {
    if (!sessionId.value || !terminalSessionId.value) {
      return;
    }
    emitSessionState?.({
      codexTerminalCommandPreview: terminalCommandPreview.value,
      codexTerminalSessionId: terminalSessionId.value,
      codexTerminalStatus: terminalStatus.value,
      sessionId: sessionId.value,
      ...extra
    });
  }

  function applyTerminalSnapshot(session = {}) {
    onTerminalSnapshot?.(session);
    terminalStatus.value = session.status || terminalStatus.value || "";
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
    writeTerminalOutput?.(session.output);
    emitTerminalSessionState();
  }

  function handleTerminalSocketMessage(rawMessage) {
    let message;
    try {
      message = JSON.parse(String(rawMessage || ""));
    } catch {
      terminalError.value = "Terminal stream returned an invalid message.";
      return;
    }

    if (message?.type === "snapshot") {
      applyTerminalSnapshot(message.session || {});
      return;
    }

    if (message?.type === "output") {
      appendTerminalOutput?.(message.chunk);
      return;
    }

    if (message?.type === "status") {
      terminalStatus.value = message.status || terminalStatus.value || "";
      if (terminalStatus.value === "exited") {
        clearCodexBusy?.();
      }
      return;
    }

    if (message?.type === "error") {
      const error = String(message.error || "Terminal stream failed.");
      if (terminalSessionNotFound(error)) {
        void recoverMissingTerminal();
        return;
      }
      terminalError.value = error;
    }
  }

  const terminalSocket = useCodexTerminalSocket({
    canUseTerminal,
    componentMounted,
    isTerminalSessionNotFound: terminalSessionNotFound,
    onConnected() {
      terminalError.value = "";
    },
    onError(error) {
      terminalError.value = error;
    },
    onMessage: handleTerminalSocketMessage,
    onMissingTerminal() {
      void recoverMissingTerminal();
    },
    sessionId,
    terminalSessionId,
    terminalStatus,
    webSocketUrl
  });

  function disposeTerminalUi() {
    onBeforeDispose?.();
    clearCodexBusy?.();
    terminalSocket.closeSocket();
    disposeTerminalViewport?.();
    clearPromptEchoFilters?.();
    clearTerminalOutput?.();
  }

  function forgetExitedTerminal() {
    terminalSocket.closeSocket();
    terminalSessionId.value = "";
    terminalStatus.value = "";
    terminalCommandPreview.value = "";
    terminalError.value = "";
  }

  async function startTerminalOnce() {
    void setupTerminalUi?.();
    if (terminalExited.value) {
      forgetExitedTerminal();
    }
    if (terminalSessionId.value) {
      fitTerminal?.();
      return true;
    }

    terminalStarting.value = true;
    terminalError.value = "";
    try {
      const session = await startTerminalSession?.(sessionId.value);
      if (session?.ok === false) {
        throw new Error(session.error || session.errors?.[0]?.message || "Codex terminal failed to start.");
      }
      terminalSessionId.value = session.id || "";
      terminalStatus.value = session.status || "running";
      terminalCommandPreview.value = session.commandPreview || "";
      emitTerminalSessionState();
      void setupTerminalUi?.().then((ready) => {
        if (ready) {
          fitTerminal?.();
          refreshTerminalOutput?.();
        }
      });
      if (!(await terminalSocket.connect())) {
        throw new Error("Terminal stream failed to connect.");
      }
      onTerminalStarted?.(session);
      return true;
    } catch (startError) {
      terminalError.value = String(startError?.message || startError || "Codex terminal failed to start.");
      return false;
    } finally {
      terminalStarting.value = false;
    }
  }

  async function ensureTerminalReady() {
    if (!canUseTerminal.value) {
      terminalError.value = "Create the session worktree before starting Codex.";
      return false;
    }
    if (terminalStartPromise) {
      return terminalStartPromise;
    }
    terminalStartPromise = startTerminalOnce();
    try {
      return await terminalStartPromise;
    } finally {
      terminalStartPromise = null;
    }
  }

  async function sendTerminalInput(data) {
    if (!terminalSessionId.value || terminalStatus.value === "exited") {
      return false;
    }
    try {
      await terminalSocket.send(String(data || ""));
      return true;
    } catch (sendError) {
      terminalError.value = String(sendError?.message || sendError || "Terminal input failed.");
      return false;
    }
  }

  async function closeTerminal() {
    const existingTerminalId = terminalSessionId.value;
    detachTerminal();
    if (existingTerminalId && sessionId.value) {
      await closeTerminalSession?.(sessionId.value, existingTerminalId).catch(() => null);
    }
  }

  async function recoverMissingTerminal() {
    if (!canUseTerminal.value) {
      terminalError.value = "Terminal session not found.";
      return false;
    }
    if (terminalRecoveryPromise) {
      return terminalRecoveryPromise;
    }

    terminalRecoveryPromise = (async () => {
      const recoveredSessionId = sessionId.value;
      terminalSocket.closeSocket();
      terminalSessionId.value = "";
      terminalStatus.value = "";
      terminalCommandPreview.value = "";
      terminalError.value = "";
      resetTerminal?.();
      clearTerminalDisplay?.();
      onTerminalRecovered?.();

      if (recoveredSessionId !== sessionId.value) {
        return false;
      }
      return ensureTerminalReady();
    })();

    try {
      return await terminalRecoveryPromise;
    } finally {
      terminalRecoveryPromise = null;
    }
  }

  function detachTerminal() {
    terminalSessionId.value = "";
    terminalStatus.value = "";
    terminalCommandPreview.value = "";
    onBeforeDetach?.();
    disposeTerminalUi();
  }

  async function restartTerminal() {
    terminalError.value = "";
    expanded.value = true;
    await closeTerminal();
    await ensureTerminalReady();
  }

  function startTerminalWhenReady() {
    if (!canUseTerminal.value) {
      return;
    }
    void ensureTerminalReady();
  }

  async function handleMountedTerminalReady() {
    await nextTick();
    startTerminalWhenReady();
    onMountedReady?.();
  }

  watch(sessionId, async (nextSessionId, previousSessionId) => {
    if (previousSessionId && previousSessionId !== nextSessionId) {
      detachTerminal();
    }
    onSessionChanged?.();
    expanded.value = defaultExpanded?.() ?? true;
    startTerminalWhenReady();
  });

  watch(canUseTerminal, (ready) => {
    if (ready) {
      startTerminalWhenReady();
    }
  });

  watch(terminalHost, (host) => {
    if (host) {
      void setupTerminalUi?.();
      startTerminalWhenReady();
    }
  }, {
    flush: "post"
  });

  watch(visible, async (isVisible) => {
    if (!isVisible) {
      disposeTerminalViewport?.({
        preserveDisplay: true
      });
      return;
    }
    await nextTick();
    const ready = await setupTerminalUi?.();
    if (ready) {
      fitTerminal?.();
      refreshTerminalOutput?.();
    }
    startTerminalWhenReady();
  });

  onMounted(() => {
    componentMounted.value = true;
    expanded.value = defaultExpanded?.() ?? true;
    void handleMountedTerminalReady();
  });

  onBeforeUnmount(() => {
    detachTerminal();
  });

  return {
    closeTerminal,
    detachTerminal,
    ensureTerminalReady,
    restartTerminal,
    sendTerminalInput,
    showTerminalStartPanel,
    startTerminalWhenReady,
    terminalExited
  };
}

export {
  useCodexTerminalSessionLifecycle
};
