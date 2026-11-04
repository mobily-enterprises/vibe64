import { computed, ref, watch } from "vue";
import {
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";
import { useVibe64AgentTerminalDisplay, vibe64ServerAgentTerminal } from "@/composables/useVibe64AgentTerminalDisplay.js";
import { useVibe64Terminal } from "@/composables/useVibe64Terminal.js";
import {
  vibe64AgentTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";
import { useVibe64CodexCommands } from "@/composables/useVibe64CodexCommands.js";
import { useCodexTerminalLifecycle } from "@/composables/useCodexTerminalLifecycle.js";
import { useCodexTerminalOutput } from "@/composables/useCodexTerminalOutput.js";
import { useCodexTerminalPresentation } from "@/composables/useCodexTerminalPresentation.js";
import { createWebSocketTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import {
  codexReconnectRequiredSignature
} from "@/lib/vibe64CodexTerminalAttention.js";
import {
  vibe64TerminalErrorMessage
} from "@/lib/vibe64TerminalErrors.js";

/**
 * One session's Codex terminal: the server's terminal record projected for the element, the terminal runtime on the
 * session's agent-terminal socket, its presentation, lifecycle and attachments, and the watchers that attach, detach,
 * reconnect and focus it as the session, its visibility and its Codex sign-in change.
 * @param {{
 *   props: {
 *     allowStart: boolean,
 *     displayMode: string,
 *     listenWhenHidden: boolean,
 *     readOnly: boolean,
 *     session: object | null,
 *     visible: boolean
 *   },
 *   emit: (event: "session-update", payload: object) => void,
 *   componentMounted: import("vue").Ref<boolean>
 * }} options
 */
function useCodexTerminalSession({ props, emit, componentMounted }) {
  const codexCommands = useVibe64CodexCommands();

  const staleTerminalSessionIds = ref(new Set());

  const sessionId = computed(() => props.session?.sessionId || "");
  const terminalAttachmentsEnabled = computed(() => Boolean(
    !props.readOnly &&
    sessionId.value
  ));
  const sessionSource = computed(() => String(props.session?.sourcePath || ""));
  const rawServerCodexTerminal = computed(() => vibe64ServerAgentTerminal(props.session));
  const serverCodexTerminal = computed(() => {
    const terminal = rawServerCodexTerminal.value;
    if (terminal.stale || terminal.restartRequired) {
      return {
        ...terminal,
        id: "",
        terminalSessionId: "",
        status: "stale"
      };
    }
    const terminalId = String(terminal.id || terminal.terminalSessionId || "").trim();
    if (!terminalId || !staleTerminalSessionIds.value.has(terminalId)) {
      return terminal;
    }
    return {
      ...terminal,
      id: "",
      terminalSessionId: "",
      status: ""
    };
  });
  const serverTerminalSession = computed(() => ({
    commandPreview: String(serverCodexTerminal.value.commandPreview || ""),
    id: String(serverCodexTerminal.value.id || serverCodexTerminal.value.terminalSessionId || ""),
    status: String(serverCodexTerminal.value.status || "")
  }));
  const {
    displayActive: terminalDisplayActive,
    presentation: terminalPresentation,
    streamActive: terminalStreamActive
  } = useVibe64AgentTerminalDisplay(props, computed(() => serverTerminalSession.value.id));
  const hasTerminalSession = computed(() => Boolean(
    terminalSessionId.value ||
    serverTerminalSession.value.id
  ));

  const canUseTerminal = computed(() => Boolean(
    terminalStreamActive.value &&
    sessionId.value &&
    (
      serverTerminalSession.value.id ||
      (props.allowStart && sessionSource.value)
    )
  ));
  const canStartTerminal = computed(() => Boolean(
    props.allowStart &&
    terminalDisplayActive.value &&
    sessionId.value &&
    sessionSource.value
  ));

  const {
    appendTerminalOutput: noteTerminalOutputChunk,
    clearCodexBusy,
    clearCodexWorking,
    markCodexBusy,
    resetTerminalOutput,
    writeTerminalOutput: noteTerminalOutputSnapshot
  } = useCodexTerminalOutput();
  const terminalController = useVibe64Terminal({
    driver: createWebSocketTerminalDriver({
      closeSession: closeCodexTerminalDriverSession,
      webSocketUrl(terminalId) {
        return vibe64AgentTerminalWebSocketUrl(sessionId.value, terminalId);
      }
    }),
    fitOnResize: true,
    initiallyVisible: false,
    liveResize: true,
    onOutput: handleTerminalOutput,
    onStatusUpdate: handleTerminalStatusUpdate,
    onUserData: handleTerminalUserData,
    readOnly: computed(() => props.readOnly),
    resizeReportDelayMs: 120
  });
  const {
    disposeTerminalUi,
    terminalFocused,
    terminalCommandPreview,
    terminalError,
    terminalSessionId,
    terminalStarting,
    terminalStatus
  } = terminalController;

  const terminalCanStart = computed(() => Boolean(canStartTerminal.value));
  const sessionSourcePending = computed(() => Boolean(
    terminalDisplayActive.value &&
    sessionId.value &&
    !sessionSource.value &&
    !hasTerminalSession.value
  ));
  const terminalServerStale = computed(() => Boolean(serverCodexTerminal.value.stale || serverCodexTerminal.value.restartRequired));
  const terminalReconnectRequired = computed(() => terminalError.value === CODEX_RECONNECT_REQUIRED_MESSAGE);
  const sessionCodexReconnectSignature = computed(() => codexReconnectRequiredSignature(props.session || {}));
  const {
    showTerminalStartPanel,
    terminalErrorActionText,
    terminalErrorTitle,
    terminalStartActionVisible,
    terminalStartButtonText,
    terminalStartIcon,
    terminalStartPanelMessage,
    terminalStartPanelTitle,
    terminalSubtitle
  } = useCodexTerminalPresentation({
    terminalController,
    serverCodexTerminal,
    sessionSourcePending,
    terminalReconnectRequired,
    terminalServerStale,
    terminalDisplayActive,
    canUseTerminal,
    terminalCanStart,
    componentMounted
  });
  const {
    attachments,
    attachTerminalSession,
    closeTerminal,
    connectTerminalWhenReady,
    detachTerminal,
    emitTerminalSessionState,
    focusWritableTerminalWhenShown,
    restartTerminal,
    sendEscape
  } = useCodexTerminalLifecycle({
    props,
    emit,
    codexCommands,
    terminalController,
    resetTerminalOutput,
    sessionId,
    serverTerminalSession,
    staleTerminalSessionIds,
    canUseTerminal,
    terminalCanStart,
    hasTerminalSession,
    terminalReconnectRequired,
    terminalAttachmentsEnabled,
    componentMounted
  });
  const {
    attachmentCanAddFiles,
    attachmentDragActive,
    attachmentQueueItems,
    attachmentStatus,
    cancelAttachment,
    clearAttachmentStatus,
    handleAttachmentDragEnter,
    handleAttachmentDragLeave,
    handleAttachmentDragOver,
    handleAttachmentDrop,
    removeAttachment,
    retryAttachment,
    resetAttachmentDragState,
    uploadAttachmentFiles
  } = attachments;
  const terminalAttachmentActionLabel = computed(() => (
    attachmentCanAddFiles.value
      ? "Attach files to Codex terminal"
      : "Codex terminal attachment limit reached"
  ));

  function handleTerminalInterrupt() {
    clearCodexBusy();
    clearCodexWorking();
  }

  function handleTerminalOutput({
    chunk = "",
    output = "",
    source = ""
  } = {}) {
    if (source === "append") {
      noteTerminalOutputChunk(chunk);
      return;
    }
    noteTerminalOutputSnapshot(output);
  }

  function handleTerminalStatusUpdate({
    closeError = "",
    status = ""
  } = {}) {
    if (closeError) {
      terminalError.value = String(closeError);
    }
    emitTerminalSessionState();
    if (status === "exited") {
      clearCodexBusy();
      clearCodexWorking();
    }
  }

  function handleTerminalUserData(data) {
    const input = String(data || "");
    if (input.includes("\u0003")) {
      clearCodexBusy();
      clearCodexWorking();
      return;
    }
    if (input.includes("\r")) {
      markCodexBusy();
    }
  }

  async function closeCodexTerminalDriverSession(terminalId) {
    const result = await codexCommands.closeAgentTerminal(sessionId.value, terminalId);
    if (result?.ok === false) {
      throw new Error(vibe64TerminalErrorMessage(result, "Codex terminal process could not be stopped."));
    }
    return result;
  }

  watch(serverTerminalSession, (terminal) => {
    void attachTerminalSession(terminal);
  }, {
    flush: "post",
    immediate: true
  });

  watch(sessionId, (nextSessionId, previousSessionId) => {
    if (previousSessionId && previousSessionId !== nextSessionId) {
      detachTerminal();
    }
    staleTerminalSessionIds.value = new Set();
    resetAttachmentDragState();
    clearAttachmentStatus();
  });

  watch(canUseTerminal, (ready) => {
    if (ready && terminalSessionId.value) {
      connectTerminalWhenReady();
    }
  });

  watch([
    sessionCodexReconnectSignature,
    componentMounted,
    () => props.displayMode
  ], ([signature, mounted, displayMode]) => {
    if (!signature || !mounted || displayMode === "headless") {
      return;
    }
    terminalError.value = CODEX_RECONNECT_REQUIRED_MESSAGE;
  }, {
    flush: "post",
    immediate: true
  });

  watch(terminalDisplayActive, (visible, previousVisible) => {
    if (visible && previousVisible === false) {
      void focusWritableTerminalWhenShown(visible);
    }
  }, {
    flush: "post",
    immediate: true
  });

  return {
    attachmentCanAddFiles,
    attachmentDragActive,
    attachmentQueueItems,
    attachmentStatus,
    cancelAttachment,
    closeTerminal,
    connectTerminalWhenReady,
    detachTerminal,
    disposeTerminalUi,
    focusWritableTerminalWhenShown,
    handleAttachmentDragEnter,
    handleAttachmentDragLeave,
    handleAttachmentDragOver,
    handleAttachmentDrop,
    handleTerminalInterrupt,
    removeAttachment,
    restartTerminal,
    retryAttachment,
    sendEscape,
    showTerminalStartPanel,
    terminalAttachmentActionLabel,
    terminalAttachmentsEnabled,
    terminalCanStart,
    terminalCommandPreview,
    terminalController,
    terminalDisplayActive,
    terminalError,
    terminalErrorActionText,
    terminalErrorTitle,
    terminalFocused,
    terminalPresentation,
    terminalStartActionVisible,
    terminalStartButtonText,
    terminalStartIcon,
    terminalStartPanelMessage,
    terminalStartPanelTitle,
    terminalStarting,
    terminalStatus,
    terminalStreamActive,
    terminalSubtitle,
    uploadAttachmentFiles
  };
}

export {
  useCodexTerminalSession
};
