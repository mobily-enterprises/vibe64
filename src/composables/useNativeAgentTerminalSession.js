import { computed, watch } from "vue";
import { useVibe64AgentTerminalDisplay, vibe64ServerAgentTerminal } from "@/composables/useVibe64AgentTerminalDisplay.js";
import { useAgentTerminalAttachments } from "@/composables/useAgentTerminalAttachments.js";
import { useVibe64AttachmentCommands } from "@/composables/useVibe64AttachmentCommands.js";
import { useVibe64Terminal } from "@/composables/useVibe64Terminal.js";
import { useVibe64TerminalCommands } from "@/composables/useVibe64TerminalCommands.js";
import { createWebSocketTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import { vibe64AgentTerminalWebSocketUrl } from "@/lib/vibe64SessionApi.js";
import { vibe64TerminalErrorMessage } from "@/lib/vibe64TerminalErrors.js";
import { findVibe64AgentProvider } from "@local/vibe64-runtime/shared";

/**
 * One session's native agent terminal (OpenCode, Claude and the other providers Vibe64 runs in a PTY): the server's
 * terminal record, the terminal runtime on the session's agent-terminal socket, starting, attaching, closing and
 * restarting it, its attachments when the provider accepts them, and the watchers that follow the session.
 * @param {{
 *   props: {
 *     allowStart: boolean,
 *     displayMode: string,
 *     listenWhenHidden: boolean,
 *     readOnly: boolean,
 *     session: object | null,
 *     visible: boolean
 *   },
 *   emit: (event: "session-update", payload: object) => void
 * }} options
 */
function useNativeAgentTerminalSession({ props, emit }) {
  const terminalCommands = useVibe64TerminalCommands();
  const attachmentCommands = useVibe64AttachmentCommands();
  const assistantProvider = computed(() => findVibe64AgentProvider(props.session?.assistantSelection?.engineId));
  const assistantLabel = computed(() => assistantProvider.value?.label || "");
  const assistantAcceptsAttachments = computed(() => assistantProvider.value?.terminalAttachments === true);
  const sessionId = computed(() => String(props.session?.sessionId || ""));
  const sessionSource = computed(() => String(props.session?.sourcePath || ""));
  const serverTerminal = computed(() => vibe64ServerAgentTerminal(props.session));
  const serverTerminalId = computed(() => String(
    serverTerminal.value.id || serverTerminal.value.terminalSessionId || ""
  ));
  const {
    displayActive,
    presentation: terminalPresentation,
    streamActive: terminalStreamActive
  } = useVibe64AgentTerminalDisplay(props, serverTerminalId);

  const terminalController = useVibe64Terminal({
    driver: createWebSocketTerminalDriver({
      closeSession: closeDriverSession,
      webSocketUrl(terminalId) {
        return vibe64AgentTerminalWebSocketUrl(sessionId.value, terminalId);
      }
    }),
    fitOnResize: true,
    initiallyVisible: false,
    liveResize: true,
    onStatusUpdate: emitTerminalState,
    readOnly: computed(() => props.readOnly),
    resizeReportDelayMs: 120
  });

  const {
    applyTerminalSession,
    closeTerminalSocket,
    connectTerminalSocket,
    disposeTerminalUi,
    focusTerminal,
    resetTerminalDisplay,
    resetTerminalSessionState,
    terminalCommandPreview,
    terminalError,
    terminalExited,
    terminalSessionId,
    terminalStarting,
    terminalStatus
  } = terminalController;

  const showAttachmentAction = computed(() => Boolean(
    assistantAcceptsAttachments.value && !props.readOnly && displayActive.value
  ));
  const attachmentsEnabled = computed(() => Boolean(
    showAttachmentAction.value && sessionId.value && terminalSessionId.value && terminalStatus.value === "running"
  ));
  const {
    abandonAttachments,
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
    uploadAttachmentFiles
  } = useAgentTerminalAttachments({
    assistantLabel,
    canUpload: attachmentsEnabled,
    deleteAttachment: attachmentCommands.deleteAttachment,
    ensureTerminalReady: () => attachmentsEnabled.value,
    focusTerminal,
    async sendAttachmentPath(text, attachmentIds, target) {
      const result = await terminalCommands.sendAgentTerminalText(
        target.sessionId, target.terminalSessionId, text, { attachmentIds }
      );
      if (result?.ok === false) {
        throw new Error(vibe64TerminalErrorMessage(result, `The attachment could not be sent to ${assistantLabel.value}.`));
      }
      return true;
    },
    sessionId,
    terminalSessionId,
    uploadAttachment: attachmentCommands.uploadAttachment
  });

  watch(attachmentsEnabled, (enabled) => {
    if (enabled) return;
    void abandonAttachments();
    clearAttachmentStatus();
  }, { flush: "sync" });

  const sourcePending = computed(() => Boolean(
    displayActive.value && sessionId.value && !sessionSource.value && !terminalSessionId.value
  ));
  const canStart = computed(() => Boolean(
    props.allowStart && displayActive.value && sessionId.value && sessionSource.value
  ));
  const showStartPanel = computed(() => Boolean(
    displayActive.value &&
    !terminalStarting.value &&
    (!terminalSessionId.value || terminalExited.value)
  ));
  const terminalSubtitle = computed(() => {
    if (terminalStarting.value) {
      return `Starting ${assistantLabel.value}`;
    }
    return terminalExited.value ? "Exited" : terminalStatus.value === "running" ? "" : `${assistantLabel.value} agent session`;
  });

  function emitTerminalState() {
    const id = String(terminalSessionId.value || serverTerminalId.value || "");
    if (!sessionId.value || !id) {
      return;
    }
    emit("session-update", {
      agentTerminalCommandPreview: terminalCommandPreview.value,
      agentTerminalSessionId: id,
      agentTerminalStatus: terminalStatus.value,
      sessionId: sessionId.value
    });
  }

  async function closeDriverSession(terminalId) {
    const result = await terminalCommands.closeAgentTerminal(sessionId.value, terminalId);
    if (result?.ok === false) {
      throw new Error(vibe64TerminalErrorMessage(result, "OpenCode terminal process could not be stopped."));
    }
    return result;
  }

  async function attachTerminal(session = {}) {
    const id = String(session.id || session.terminalSessionId || "").trim();
    if (!id || id === terminalSessionId.value) {
      return Boolean(id);
    }
    closeTerminalSocket();
    resetTerminalDisplay();
    await applyTerminalSession({ ...session, id }, {
      fallbackStatus: session.status || "running",
      ownership: "attached"
    });
    if (terminalStreamActive.value) {
      void connectTerminalSocket();
    }
    return true;
  }

  async function startTerminal() {
    if (!canStart.value) {
      return false;
    }
    if (terminalExited.value) {
      closeTerminalSocket();
      resetTerminalSessionState();
      resetTerminalDisplay();
    }
    terminalStarting.value = true;
    terminalError.value = "";
    try {
      const session = await terminalCommands.startAgentTerminal(sessionId.value);
      if (session?.ok === false || !session?.id) {
        throw new Error(vibe64TerminalErrorMessage(session, `${assistantLabel.value} terminal failed to start.`));
      }
      await applyTerminalSession(session, {
        fallbackStatus: "running",
        ownership: "owned"
      });
      emitTerminalState();
      return await connectTerminalSocket();
    } catch (error) {
      terminalError.value = vibe64TerminalErrorMessage(error, `${assistantLabel.value} terminal failed to start.`);
      return false;
    } finally {
      terminalStarting.value = false;
    }
  }

  async function closeTerminal() {
    await abandonAttachments();
    if (!terminalSessionId.value) {
      detachTerminal();
      return true;
    }
    if (!(await terminalController.closeTerminal({ deleteSession: true }))) {
      return false;
    }
    resetTerminalDisplay();
    emitTerminalState();
    return true;
  }

  async function restartTerminal() {
    terminalError.value = "";
    if (terminalSessionId.value && !(await closeTerminal())) {
      return false;
    }
    return startTerminal();
  }

  function detachTerminal() {
    closeTerminalSocket();
    resetTerminalSessionState();
    resetTerminalDisplay();
  }

  watch(serverTerminal, (terminal) => {
    void attachTerminal(terminal);
  }, {
    flush: "post",
    immediate: true
  });

  watch(terminalStreamActive, (active) => {
    if (active && terminalSessionId.value) {
      void connectTerminalSocket();
    }
  });

  watch(sessionId, (_next, previous) => {
    if (previous) {
      detachTerminal();
    }
  });

  return {
    assistantAcceptsAttachments,
    assistantLabel,
    attachmentCanAddFiles,
    attachmentDragActive,
    attachmentQueueItems,
    attachmentStatus,
    cancelAttachment,
    closeTerminal,
    connectTerminalSocket,
    detachTerminal,
    disposeTerminalUi,
    handleAttachmentDragEnter,
    handleAttachmentDragLeave,
    handleAttachmentDragOver,
    handleAttachmentDrop,
    removeAttachment,
    restartTerminal,
    retryAttachment,
    sessionId,
    showAttachmentAction,
    showStartPanel,
    sourcePending,
    terminalCommandPreview,
    terminalController,
    terminalError,
    terminalExited,
    terminalPresentation,
    terminalSessionId,
    terminalStarting,
    terminalStatus,
    terminalStreamActive,
    terminalSubtitle,
    uploadAttachmentFiles
  };
}

export {
  useNativeAgentTerminalSession
};
