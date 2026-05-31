import { computed, nextTick, onBeforeUnmount, onMounted, unref, watch } from "vue";

import { useCodexTerminalSocket } from "@/composables/useCodexTerminalSocket.js";
import {
  terminalResizeErrorMessage
} from "@/lib/studioTerminalSize.js";
import {
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

function terminalSessionNotFound(error = "") {
  return String(error || "").toLowerCase().includes("terminal session not found");
}

function useCodexTerminalSessionLifecycle({
  appendTerminalOutput,
  canStartTerminal,
  canUseTerminal,
  clearCodexBusy,
  clearCodexWorking,
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
  const terminalCanStart = computed(() => {
    if (canStartTerminal === undefined || canStartTerminal === null) {
      return Boolean(unref(canUseTerminal));
    }
    return Boolean(unref(canStartTerminal));
  });
  const showTerminalStartPanel = computed(() => (
    canUseTerminal.value &&
    terminalCanStart.value &&
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
    vibe64SessionDebugLog("client.codexTerminal.snapshot", {
      outputLength: String(session.output || "").length,
      outputVersion: Number(session.outputVersion || 0),
      sessionId: sessionId.value,
      status: String(session.status || ""),
      terminalSessionId: String(session.id || terminalSessionId.value || "")
    });
    onTerminalSnapshot?.(session);
    terminalStatus.value = session.status || terminalStatus.value || "";
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
    writeTerminalOutput?.(session.output);
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
      vibe64SessionDebugLog("client.codexTerminal.socket.snapshot", {
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      applyTerminalSnapshot(message.session || {});
      return;
    }

    if (message?.type === "output") {
      vibe64SessionDebugLog("client.codexTerminal.socket.output", {
        bytes: String(message.chunk || "").length,
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      appendTerminalOutput?.(message.chunk);
      return;
    }

    if (message?.type === "status") {
      vibe64SessionDebugLog("client.codexTerminal.socket.status", {
        previousStatus: terminalStatus.value,
        sessionId: sessionId.value,
        status: String(message.status || ""),
        terminalSessionId: terminalSessionId.value
      });
      terminalStatus.value = message.status || terminalStatus.value || "";
      emitTerminalSessionState();
      if (terminalStatus.value === "exited") {
        clearCodexBusy?.();
        clearCodexWorking?.();
      }
      return;
    }

    if (message?.type === "resize.error") {
      return;
    }

    if (message?.type === "error") {
      const error = String(message.error || "Terminal stream failed.");
      vibe64SessionDebugLog("client.codexTerminal.socket.error", {
        error,
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      if (terminalResizeErrorMessage(error)) {
        return;
      }
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
      vibe64SessionDebugLog("client.codexTerminal.socket.connected", {
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      terminalError.value = "";
    },
    onError(error) {
      vibe64SessionDebugLog("client.codexTerminal.socket.connectError", {
        error,
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
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
    vibe64SessionDebugLog("client.codexTerminal.dispose", {
      sessionId: sessionId.value,
      terminalSessionId: terminalSessionId.value,
      visible: Boolean(unref(visible))
    });
    onBeforeDispose?.();
    clearCodexBusy?.();
    clearCodexWorking?.();
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

  async function connectAttachedTerminal() {
    vibe64SessionDebugLog("client.codexTerminal.connect.start", {
      canUseTerminal: Boolean(canUseTerminal.value),
      sessionId: sessionId.value,
      terminalSessionId: terminalSessionId.value,
      visible: Boolean(unref(visible))
    });
    void setupTerminalUi?.();
    fitTerminal?.({
      forceResize: true
    });
    void setupTerminalUi?.().then((ready) => {
      if (ready) {
        fitTerminal?.({
          forceResize: true
        });
        refreshTerminalOutput?.();
      }
    });
    if (!(await terminalSocket.connect())) {
      vibe64SessionDebugLog("client.codexTerminal.connect.failed", {
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      throw new Error("Terminal stream failed to connect.");
    }
    vibe64SessionDebugLog("client.codexTerminal.connect.done", {
      sessionId: sessionId.value,
      terminalSessionId: terminalSessionId.value
    });
    return true;
  }

  async function startTerminalOnce() {
    void setupTerminalUi?.();
    if (terminalExited.value && terminalCanStart.value) {
      forgetExitedTerminal();
    }
    if (terminalSessionId.value) {
      vibe64SessionDebugLog("client.codexTerminal.start.reuse", {
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      return connectAttachedTerminal();
    }
    if (!terminalCanStart.value) {
      vibe64SessionDebugLog("client.codexTerminal.start.skipped", {
        canStart: Boolean(terminalCanStart.value),
        canUseTerminal: Boolean(canUseTerminal.value),
        sessionId: sessionId.value
      });
      return false;
    }

    terminalStarting.value = true;
    terminalError.value = "";
    vibe64SessionDebugLog("client.codexTerminal.start.request", {
      sessionId: sessionId.value
    });
    try {
      const session = await startTerminalSession?.(sessionId.value);
      if (session?.ok === false) {
        throw new Error(session.error || session.errors?.[0]?.message || "Codex terminal failed to start.");
      }
      terminalSessionId.value = session.id || "";
      terminalStatus.value = session.status || "running";
      terminalCommandPreview.value = session.commandPreview || "";
      emitTerminalSessionState();
      vibe64SessionDebugLog("client.codexTerminal.start.response", {
        sessionId: sessionId.value,
        status: terminalStatus.value,
        terminalSessionId: terminalSessionId.value
      });
      await connectAttachedTerminal();
      onTerminalStarted?.(session);
      return true;
    } catch (startError) {
      terminalError.value = String(startError?.message || startError || "Codex terminal failed to start.");
      vibe64SessionDebugLog("client.codexTerminal.start.error", {
        error: terminalError.value,
        sessionId: sessionId.value
      });
      return false;
    } finally {
      terminalStarting.value = false;
    }
  }

  async function ensureTerminalReady() {
    if (!canUseTerminal.value) {
      if (terminalCanStart.value) {
        terminalError.value = "Create the session worktree before starting Codex.";
      }
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

  async function resizeTerminal(size = {}) {
    if (!terminalSessionId.value || terminalStatus.value === "exited") {
      return false;
    }
    try {
      await terminalSocket.resize(size);
      return true;
    } catch (resizeError) {
      terminalError.value = String(resizeError?.message || resizeError || "Terminal resize failed.");
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

  async function attachTerminalSession(session = {}) {
    const nextTerminalSessionId = String(session.id || session.terminalSessionId || "").trim();
    vibe64SessionDebugLog("client.codexTerminal.attach.request", {
      canUseTerminal: Boolean(canUseTerminal.value),
      currentTerminalSessionId: terminalSessionId.value,
      nextTerminalSessionId,
      sessionId: sessionId.value,
      status: String(session.status || ""),
      visible: Boolean(unref(visible))
    });
    if (!nextTerminalSessionId) {
      if (terminalSessionId.value) {
        detachTerminal();
      }
      return false;
    }
    const sameTerminal = terminalSessionId.value === nextTerminalSessionId;
    if (!sameTerminal && terminalSessionId.value) {
      detachTerminal();
    }
    terminalSessionId.value = nextTerminalSessionId;
    terminalStatus.value = session.status || terminalStatus.value || "running";
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value || "";
    if (!canUseTerminal.value || !componentMounted.value) {
      vibe64SessionDebugLog("client.codexTerminal.attach.deferred", {
        canUseTerminal: Boolean(canUseTerminal.value),
        componentMounted: Boolean(componentMounted.value),
        sessionId: sessionId.value,
        terminalSessionId: terminalSessionId.value
      });
      return true;
    }
    try {
      await connectAttachedTerminal();
      return true;
    } catch (attachError) {
      terminalError.value = String(attachError?.message || attachError || "Terminal stream failed to connect.");
      return false;
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
    vibe64SessionDebugLog("client.codexTerminal.detach", {
      sessionId: sessionId.value,
      terminalSessionId: terminalSessionId.value
    });
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
    attachTerminalSession,
    closeTerminal,
    detachTerminal,
    ensureTerminalReady,
    restartTerminal,
    resizeTerminal,
    sendTerminalInput,
    showTerminalStartPanel,
    startTerminalWhenReady,
    terminalExited
  };
}

export {
  useCodexTerminalSessionLifecycle
};
