import { computed, nextTick, onBeforeUnmount, onMounted, unref, watch } from "vue";

import { useCodexTerminalSocket } from "@/composables/useCodexTerminalSocket.js";
import {
  terminalResizeErrorMessage
} from "@/lib/studioTerminalSize.js";

function terminalSessionNotFound(error = "") {
  return String(error || "").toLowerCase().includes("terminal session not found");
}

function useCodexTerminalSessionLifecycle({
  appendTerminalOutput,
  canStartTerminal,
  canUseTerminal,
  clearCodexBusy,
  clearCodexWorking,
  clearTerminalOutput,
  closeTerminalSession,
  componentMounted,
  defaultExpanded,
  disposeTerminalViewport,
  emitSessionState,
  expanded,
  onBeforeDispose,
  onBeforeDetach,
  onMountedReady,
  onSessionChanged,
  onTerminalSnapshot,
  onTerminalStarted,
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
      applyTerminalSnapshot(message.session || {});
      return;
    }

    if (message?.type === "output") {
      appendTerminalOutput?.(message.chunk);
      return;
    }

    if (message?.type === "status") {
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
    clearCodexWorking?.();
    terminalSocket.closeSocket();
    disposeTerminalViewport?.();
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
    void setupTerminalUi?.();
    if (!(await terminalSocket.connect())) {
      throw new Error("Terminal stream failed to connect.");
    }
    return true;
  }

  async function startTerminalOnce() {
    void setupTerminalUi?.();
    if (terminalExited.value && terminalCanStart.value) {
      forgetExitedTerminal();
    }
    if (terminalSessionId.value) {
      return connectAttachedTerminal();
    }
    if (!terminalCanStart.value) {
      return false;
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
      await connectAttachedTerminal();
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

  async function closeTerminal() {
    const existingTerminalId = terminalSessionId.value;
    detachTerminal();
    if (existingTerminalId && sessionId.value) {
      await closeTerminalSession?.(sessionId.value, existingTerminalId).catch(() => null);
    }
  }

  async function attachTerminalSession(session = {}) {
    const nextTerminalSessionId = String(session.id || session.terminalSessionId || "").trim();
    if (!nextTerminalSessionId) {
      return Boolean(terminalSessionId.value);
    }
    const sameTerminal = terminalSessionId.value === nextTerminalSessionId;
    if (!sameTerminal && terminalSessionId.value) {
      detachTerminal();
    }
    terminalSessionId.value = nextTerminalSessionId;
    terminalStatus.value = session.status || terminalStatus.value || "running";
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value || "";
    if (!canUseTerminal.value || !componentMounted.value) {
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
    terminalSocket.closeSocket();
    terminalSessionId.value = "";
    terminalStatus.value = "";
    terminalCommandPreview.value = "";
    terminalError.value = "Terminal session disappeared. Start Codex manually to open a new terminal.";
    return false;
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
      return;
    }
    await nextTick();
    await setupTerminalUi?.();
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
    sendTerminalInput,
    showTerminalStartPanel,
    startTerminalWhenReady,
    terminalExited
  };
}

export {
  useCodexTerminalSessionLifecycle
};
