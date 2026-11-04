import { computed, nextTick } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import {
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";
import {
  VIBE64_ACCOUNTS_CHANGED_EVENT
} from "@local/vibe64-accounts/client";
import { useAgentTerminalAttachments } from "@/composables/useAgentTerminalAttachments.js";
import {
  requestVibe64AccountConnectionsDialog
} from "@/lib/vibe64AccountConnectionsDialog.js";
import {
  codexReconnectRequiredResult
} from "@/lib/vibe64CodexTerminalAttention.js";
import {
  terminalOwnerAccessDenied,
  terminalSessionMissingError,
  vibe64TerminalErrorMessage
} from "@/lib/vibe64TerminalErrors.js";

function openCodexReconnectDialog() {
  requestVibe64AccountConnectionsDialog({
    codexReconnectRequired: true,
    providerId: "codex",
    refresh: false
  });
}

function codexAccountConnectedPayload(payload) {
  const account = normalizeObject(payload);
  const accountId = String(account.accountId || account.connectionId || "").trim().toLowerCase();
  const status = String(account.status || "").trim().toLowerCase();
  return accountId === "codex" && account.connected === true && (!status || status === "connected");
}

/**
 * Starts, attaches, reconnects and closes one session's Codex terminal, and
 * delivers its attachments into it.
 * @param {{
 *   props: { readOnly?: boolean },
 *   emit: (event: "session-update", payload: object) => void,
 *   codexCommands: import("@/types.js").Vibe64CodexCommands,
 *   terminalController: import("@/types.js").Vibe64Terminal,
 *   resetTerminalOutput: import("@/types.js").CodexTerminalOutput["resetTerminalOutput"],
 *   sessionId: import("vue").ComputedRef<string>,
 *   serverTerminalSession: import("vue").ComputedRef<{ commandPreview: string, id: string, status: string }>,
 *   staleTerminalSessionIds: import("vue").Ref<Set<string>>,
 *   canUseTerminal: import("vue").ComputedRef<boolean>,
 *   terminalCanStart: import("vue").ComputedRef<boolean>,
 *   hasTerminalSession: import("vue").ComputedRef<boolean>,
 *   terminalReconnectRequired: import("vue").ComputedRef<boolean>,
 *   terminalAttachmentsEnabled: import("vue").ComputedRef<boolean>,
 *   componentMounted: import("vue").Ref<boolean>
 * }} options
 */
function useCodexTerminalLifecycle({
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
}) {
  const {
    closeTerminalSocket,
    connectTerminalSocket,
    focusTerminal: focusTerminalUi,
    resetTerminalDisplay,
    resetTerminalSessionState,
    sendTerminalData: sendTerminalBytes,
    terminalCommandPreview,
    terminalError,
    terminalExited,
    terminalSessionId,
    terminalStarting,
    terminalStatus
  } = terminalController;
  let terminalStartPromise = null;

  const attachments = useAgentTerminalAttachments({
    canUpload: terminalAttachmentsEnabled,
    deleteAttachment: codexCommands.deleteAttachment,
    ensureTerminalReady,
    focusTerminal,
    sendAttachmentPath,
    sessionId,
    terminalSessionId,
    uploadAttachment: codexCommands.uploadAttachment
  });
  const {
    abandonAttachments: abandonTerminalAttachments,
    clearAttachmentStatus,
    resetAttachmentDragState
  } = attachments;

  function ensureTerminalReady() {
    if (!canUseTerminal.value) {
      if (terminalCanStart.value) {
        terminalError.value = "Create the session clone before starting Codex.";
      }
      return Promise.resolve(false);
    }
    if (terminalStartPromise) {
      return terminalStartPromise;
    }
    terminalStartPromise = startTerminalOnce();
    return terminalStartPromise.finally(() => {
      terminalStartPromise = null;
    });
  }

  function emitTerminalSessionState(extra = {}) {
    const currentTerminalId = String(extra.agentTerminalSessionId || terminalSessionId.value || "");
    if (!sessionId.value || !currentTerminalId) {
      return;
    }
    emit("session-update", {
      agentTerminalCommandPreview: terminalCommandPreview.value,
      agentTerminalSessionId: currentTerminalId,
      agentTerminalStatus: terminalStatus.value,
      sessionId: sessionId.value,
      ...extra
    });
  }

  async function applyCodexTerminalSession(session = {}, {
    fallbackStatus = "running",
    ownership = "attached",
    preserveOutput = true
  } = {}) {
    const nextTerminalSessionId = String(session.id || session.terminalSessionId || "").trim();
    if (!nextTerminalSessionId) {
      return {
        applied: false,
        hasTerminalSession: Boolean(terminalSessionId.value)
      };
    }

    const previousTerminalSessionId = String(terminalSessionId.value || "");
    const sameTerminalSession = previousTerminalSessionId === nextTerminalSessionId;
    const terminalSessionChanged = Boolean(
      previousTerminalSessionId &&
      previousTerminalSessionId !== nextTerminalSessionId
    );
    if (terminalSessionChanged) {
      resetTerminalOutput();
    }

    await terminalController.attachTerminal({
      ...session,
      id: nextTerminalSessionId
    }, {
      connect: false,
      fallbackStatus,
      ownership,
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

  async function recoverCodexTerminalAfterAccountReconnect() {
    if (!terminalReconnectRequired.value) {
      return;
    }
    terminalError.value = "";
    closeTerminalSocket();
    resetTerminalSessionState();
    resetTerminalDisplay();
    resetTerminalOutput();
    await ensureTerminalReady();
  }

  useRealtimeEvent({
    enabled: computed(() => Boolean(componentMounted.value && terminalReconnectRequired.value)),
    event: VIBE64_ACCOUNTS_CHANGED_EVENT,
    matches({ payload = {} } = {}) {
      return codexAccountConnectedPayload(payload);
    },
    onEvent() {
      void recoverCodexTerminalAfterAccountReconnect();
    }
  });

  async function sendAttachmentPath(text, attachmentIds = [], target = {}) {
    if (!sessionId.value || !terminalSessionId.value) {
      throw new Error("Codex terminal is not ready for attachments.");
    }
    const response = await codexCommands.sendAgentTerminalText(
      target.sessionId,
      target.terminalSessionId,
      text,
      { attachmentIds }
    );
    if (response?.ok === false) {
      throw new Error(response.error || "Attachment path could not be sent to Codex.");
    }
    return true;
  }

  async function sendEscape() {
    try {
      return await ensureTerminalReady() && await sendTerminalBytes("\u001b");
    } catch (sendError) {
      terminalError.value = String(sendError?.message || sendError || "Terminal input failed.");
      return false;
    }
  }

  async function focusTerminal() {
    if (!hasTerminalSession.value) {
      return false;
    }
    return focusTerminalUi();
  }

  async function focusWritableTerminalWhenShown(visible) {
    if (!visible || props.readOnly || !hasTerminalSession.value) {
      return;
    }
    await nextTick();
    focusTerminal();
  }

  async function connectAttachedTerminal() {
    if (!(await connectTerminalSocket())) {
      const message = String(terminalError.value || "Terminal stream failed to connect.");
      if (terminalSessionMissingError(message) || terminalOwnerAccessDenied(message)) {
        markTerminalSessionStale(terminalSessionId.value || serverTerminalSession.value.id, message);
        return false;
      }
      throw new Error(message);
    }
    return true;
  }

  async function startTerminalOnce() {
    if (terminalReconnectRequired.value) {
      openCodexReconnectDialog();
      return false;
    }
    if (terminalExited.value && terminalCanStart.value) {
      closeTerminalSocket();
      resetTerminalSessionState();
      resetTerminalDisplay();
      resetTerminalOutput();
    }
    if (terminalSessionId.value) {
      return await connectAttachedTerminal();
    }
    if (!terminalCanStart.value) {
      return false;
    }

    terminalStarting.value = true;
    terminalError.value = "";
    try {
      const session = await codexCommands.startAgentTerminal(sessionId.value);
      if (session?.ok === false) {
        if (codexReconnectRequiredResult(session)) {
          terminalError.value = CODEX_RECONNECT_REQUIRED_MESSAGE;
          openCodexReconnectDialog();
          return false;
        }
        if (terminalOwnerAccessDenied(session)) {
          const message = vibe64TerminalErrorMessage(session, "Codex terminal failed to start.");
          markTerminalSessionStale(serverTerminalSession.value.id, message);
          terminalError.value = message;
          return false;
        }
        throw new Error(vibe64TerminalErrorMessage(session, "Codex terminal failed to start."));
      }
      if (!session?.id) {
        throw new Error("Codex terminal failed to start.");
      }
      await applyCodexTerminalSession(session, {
        fallbackStatus: "running",
        ownership: "owned"
      });
      emitTerminalSessionState();
      return await connectAttachedTerminal();
    } catch (startError) {
      terminalError.value = terminalError.value || vibe64TerminalErrorMessage(startError, "Codex terminal failed to start.");
      return false;
    } finally {
      terminalStarting.value = false;
    }
  }

  function connectTerminalWhenReady() {
    if (!canUseTerminal.value || !terminalSessionId.value) {
      return;
    }
    void connectAttachedTerminal().catch((error) => {
      terminalError.value = terminalError.value || String(error?.message || error || "Terminal stream failed to connect.");
    });
  }

  async function attachTerminalSession(session = {}) {
    const attached = await applyCodexTerminalSession(session, {
      fallbackStatus: "running"
    });
    if (!attached.applied) {
      return Boolean(terminalSessionId.value);
    }
    if (attached.sameTerminalSession) {
      return true;
    }
    if (!canUseTerminal.value || !componentMounted.value) {
      return true;
    }
    try {
      return await connectAttachedTerminal();
    } catch (attachError) {
      const message = String(attachError?.message || attachError || "Terminal stream failed to connect.");
      if (terminalOwnerAccessDenied(message)) {
        markTerminalSessionStale(session.id || terminalSessionId.value || serverTerminalSession.value.id, message);
        terminalError.value = message;
        return false;
      }
      terminalError.value = terminalError.value || message;
      return false;
    }
  }

  function markTerminalSessionStale(terminalId = "", message = "") {
    const normalizedTerminalId = String(terminalId || "").trim();
    if (normalizedTerminalId) {
      staleTerminalSessionIds.value = new Set([
        ...staleTerminalSessionIds.value,
        normalizedTerminalId
      ]);
    }
    closeTerminalSocket();
    resetTerminalSessionState();
    resetTerminalDisplay();
    resetTerminalOutput();
    void abandonTerminalAttachments();
    terminalError.value = String(message || "");
    emitTerminalSessionState({
      agentTerminalSessionId: normalizedTerminalId,
      agentTerminalStatus: "stale"
    });
  }

  function detachTerminal() {
    terminalStartPromise = null;
    void abandonTerminalAttachments();
    closeTerminalSocket();
    resetTerminalSessionState();
    resetTerminalDisplay();
    resetTerminalOutput();
    clearAttachmentStatus();
    resetAttachmentDragState();
  }

  async function closeTerminal() {
    await abandonTerminalAttachments();
    if (!terminalSessionId.value) {
      detachTerminal();
      return true;
    }
    if (!(await terminalController.closeTerminal({
      deleteSession: true
    }))) {
      return false;
    }
    terminalStartPromise = null;
    resetTerminalOutput();
    clearAttachmentStatus();
    resetAttachmentDragState();
    return true;
  }

  async function restartTerminal() {
    if (terminalReconnectRequired.value) {
      openCodexReconnectDialog();
      return;
    }
    terminalError.value = "";
    if (!(await closeTerminal())) {
      return;
    }
    await ensureTerminalReady();
  }

  return {
    attachments,
    attachTerminalSession,
    closeTerminal,
    connectTerminalWhenReady,
    detachTerminal,
    emitTerminalSessionState,
    focusWritableTerminalWhenShown,
    restartTerminal,
    sendEscape
  };
}

export { useCodexTerminalLifecycle };
