import { ref } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import {
  normalizeSourceEditorPath
} from "@/lib/vibe64SourceEditorLinks.js";
import {
  vibe64SourceEditorExplanationFollowupsStreamPath,
  vibe64SourceEditorExplanationPath,
  vibe64SourceEditorExplanationStopPath,
  vibe64SourceEditorExplanationsCleanupPath,
  vibe64SourceEditorExplanationsStreamPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64ApiResponseError
} from "@/lib/vibe64ApiResponses.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  sourceEditorRequest
} from "@/lib/vibe64SourceEditorRequest.js";
import {
  appendSourceEditorExplanationMessages,
  localSourceExplanation,
  normalizeExplanation,
  nowIso,
  sourceEditorClientId,
  sourceEditorExplanationWithMessage
} from "@/lib/vibe64SourceEditorExplanations.js";

/** A deletion nobody waits on reports its failure only to the debug log. */
function ignoreDisposeError() {}

/**
 * The open source explanation: asking for one, its streamed answer and
 * follow-ups, stopping and retrying it, and closing it, which deletes its
 * conversation on the server.
 * @param {object} options
 * @param {import("vue").Ref<boolean>} options.canLoad
 * @param {import("vue").Ref<string>} options.currentSessionId
 * @param {import("vue").Ref<string>} options.currentSessionsApiPath
 * @param {import("@/types.js").Vibe64SourceEditorFile} options.file
 * @param {string} options.originId
 * @param {import("vue").Ref<string>} options.selectedPath
 */
function useVibe64SourceEditorExplanations({
  canLoad,
  currentSessionId,
  currentSessionsApiPath,
  file,
  originId,
  selectedPath
}) {
  const explanationFeedback = useUiFeedback({ source: "vibe64.source-editor.explanation.feedback" });
  const activeExplanation = ref(null);
  const explanationError = ref("");
  const explanationBusy = ref(false);
  const explanationClosing = ref(false);
  const explanationFollowup = ref("");
  let explanationRequestId = 0;
  let explanationAbortController = null;

  function cleanupAbandonedExplanations() {
    if (!canLoad.value) {
      return;
    }
    const activeExplanationIds = activeExplanation.value?.id
      ? [activeExplanation.value.id]
      : [];
    void sourceEditorRequest(vibe64SourceEditorExplanationsCleanupPath(
      currentSessionsApiPath.value,
      currentSessionId.value
    ), {
      body: {
        activeExplanationIds,
        originId
      },
      method: "POST"
    }).catch((error) => {
      vibe64SessionDebugLog("client.sourceEditor.explanations.cleanup.error", {
        error: vibe64SessionDebugError(error),
        sessionId: currentSessionId.value
      });
    });
  }

  function clearExplanationStream() {
    explanationRequestId += 1;
    explanationAbortController?.abort();
    explanationAbortController = null;
    explanationBusy.value = false;
  }

  function markActiveExplanationMessage(status = "", text = "") {
    const explanation = activeExplanation.value;
    const lastAssistant = [...(explanation?.messages || [])].reverse()
      .find((message) => message.role === "assistant");
    if (!lastAssistant?.id) {
      return;
    }
    const nextExplanation = sourceEditorExplanationWithMessage(explanation, lastAssistant.id, {
      status,
      text: text || lastAssistant.text
    });
    activeExplanation.value = status === "failed"
      ? {
          ...nextExplanation,
          error: text || nextExplanation?.error || "Source explanation failed.",
          status: "failed"
        }
      : nextExplanation;
  }

  function applyExplanationStreamEvent(event = {}, requestId = explanationRequestId) {
    if (requestId !== explanationRequestId) {
      return;
    }
    if (event.type === "source-explanation.error" || event.ok === false) {
      const message = vibe64ApiResponseError(event, "Source explanation failed.");
      explanationError.value = message;
      markActiveExplanationMessage("failed", message);
      throw new Error(message);
    }
    const eventExplanation = normalizeExplanation(event.explanation);
    if (event.type === "source-explanation.failed") {
      const message = vibe64ApiResponseError(event, "Source explanation failed.");
      explanationError.value = message;
      if (eventExplanation) {
        activeExplanation.value = eventExplanation;
      } else {
        markActiveExplanationMessage("failed", message);
      }
      return;
    }
    if (event.type === "source-explanation.started" || event.type === "source-explanation.followup.started") {
      if (eventExplanation) {
        activeExplanation.value = eventExplanation;
      }
      return;
    }
    if (event.type === "source-explanation.thread" || event.type === "source-explanation.turn") {
      if (!activeExplanation.value) {
        return;
      }
      activeExplanation.value = {
        ...activeExplanation.value,
        agentThreadId: String(event.threadId || activeExplanation.value.agentThreadId || ""),
        agentTurnId: String(event.turnId || activeExplanation.value.agentTurnId || "")
      };
      return;
    }
    if (event.type === "source-explanation.execution-profile" && eventExplanation) {
      activeExplanation.value = eventExplanation;
      return;
    }
    if (event.type === "source-explanation.message" && event.messageId) {
      activeExplanation.value = sourceEditorExplanationWithMessage(activeExplanation.value, String(event.messageId), {
        status: String(event.status || "thinking"),
        text: String(event.text || "")
      });
      return;
    }
    if (event.type === "source-explanation.finished" && eventExplanation) {
      activeExplanation.value = eventExplanation;
      const range = eventExplanation.sourceRange;
      // Follow-up chat does not replace the cached initial interpretation.
      if (eventExplanation.status === 'ready' && range.presentation && (range.scope === 'file' || range.symbolId)
        && !eventExplanation.followups.length && range.path === selectedPath.value) {
        const record = { path: range.path, scope: range.scope, symbolId: range.symbolId || '', presentation: range.presentation,
          fileHash: range.fileHash, body: eventExplanation.body, summary: eventExplanation.summary, createdAt: eventExplanation.createdAt,
          status: range.fileHash === file.savedHash.value ? 'current' : 'stale' };
        file.interpretations.value = [...file.interpretations.value.filter(previous => !(previous.scope === record.scope && previous.symbolId === record.symbolId && previous.presentation === record.presentation)), record];
      }
      if (eventExplanation.status !== "failed") {
        explanationError.value = "";
      }
    }
  }

  async function streamSourceEditorRequest(url = "", body = {}, requestId = explanationRequestId) {
    const controller = new AbortController();
    explanationAbortController = controller;
    await getHttpWebClient().requestStream(url, {
      body,
      method: "POST",
      signal: controller.signal
    }, {
      onEvent(event) {
        applyExplanationStreamEvent(event, requestId);
      }
    });
  }

  async function explainSelection(range = {}) {
    if (!selectedPath.value || !canLoad.value || explanationBusy.value || explanationClosing.value) {
      return;
    }
    const requestId = explanationRequestId + 1;
    explanationRequestId = requestId;
    explanationAbortController?.abort();
    explanationAbortController = null;
    const explanationId = sourceEditorClientId("exp");
    const userMessageId = sourceEditorClientId("msg");
    const assistantMessageId = sourceEditorClientId("msg");
    const previousExplanation = activeExplanation.value;
    activeExplanation.value = localSourceExplanation({
      assistantMessageId,
      explanationId,
      filePath: selectedPath.value,
      range,
      userMessageId
    });
    explanationBusy.value = true;
    explanationError.value = "";
    explanationFollowup.value = "";
    if (previousExplanation?.id) {
      void disposeExplanation(previousExplanation).catch(() => null);
    }
    try {
      await streamSourceEditorRequest(vibe64SourceEditorExplanationsStreamPath(
        currentSessionsApiPath.value,
        currentSessionId.value
      ), {
        assistantMessageId,
        endColumn: range.endColumn,
        endLine: range.endLine,
        explanationId,
        force: range.force === true,
        presentation: range.presentation,
        symbolId: range.symbolId,
        expectedHash: range.expectedHash,
        originId,
        path: selectedPath.value,
        scope: range.scope,
        startColumn: range.startColumn,
        startLine: range.startLine,
        userMessageId
      }, requestId);
    } catch (error) {
      if (String(error?.name || "") === "AbortError") {
        return;
      }
      if (requestId === explanationRequestId) {
        const message = String(error?.message || error || "Source explanation could not be created.");
        explanationError.value = message;
        markActiveExplanationMessage("failed", message);
      }
    } finally {
      if (requestId === explanationRequestId) {
        explanationBusy.value = false;
        explanationAbortController = null;
      }
    }
  }

  async function retryExplanation() {
    const explanation = activeExplanation.value;
    const range = explanation?.sourceRange || {};
    const explanationPath = normalizeSourceEditorPath(range.path);
    if (!explanationPath || explanationBusy.value || explanationClosing.value) {
      return;
    }
    if (selectedPath.value !== explanationPath) {
      await file.openFile(explanationPath);
      if (selectedPath.value !== explanationPath) {
        return;
      }
    }
    await explainSelection({
      ...range,
      ...(range.presentation && range.fileHash ? { expectedHash: range.fileHash } : {}),
      force: true
    });
  }

  async function stopExplanation() {
    const explanation = activeExplanation.value;
    if (!explanation?.id || explanationClosing.value) {
      return;
    }
    const requestId = explanationRequestId + 1;
    explanationRequestId = requestId;
    const controller = explanationAbortController;
    explanationAbortController = null;
    explanationBusy.value = false;
    explanationError.value = "";
    markActiveExplanationMessage("stopped", "Stopped.");
    controller?.abort();
    if (!canLoad.value) {
      return;
    }
    try {
      const response = await sourceEditorRequest(vibe64SourceEditorExplanationStopPath(
        currentSessionsApiPath.value,
        currentSessionId.value,
        explanation.id
      ), {
        method: "POST"
      });
      if (requestId !== explanationRequestId || activeExplanation.value?.id !== explanation.id) {
        return;
      }
      const stoppedExplanation = normalizeExplanation(response.explanation);
      if (stoppedExplanation) {
        activeExplanation.value = stoppedExplanation;
      }
    } catch (error) {
      if (requestId === explanationRequestId && activeExplanation.value?.id === explanation.id) {
        explanationFeedback.error(error, "Source explanation could not be stopped.");
      }
    }
  }

  async function disposeExplanation(explanation = null, {
    onError = ignoreDisposeError,
    sessionsApiPath: apiPath = currentSessionsApiPath.value,
    sessionId: targetSessionId = currentSessionId.value
  } = {}) {
    const id = String(explanation?.id || "").trim();
    if (!id || !apiPath || !targetSessionId) {
      return true;
    }
    try {
      await sourceEditorRequest(vibe64SourceEditorExplanationPath(
        apiPath,
        targetSessionId,
        id
      ), {
        method: "DELETE"
      });
      return true;
    } catch (error) {
      vibe64SessionDebugLog("client.sourceEditor.explanations.cleanup.error", {
        error: vibe64SessionDebugError(error),
        sessionId: targetSessionId
      });
      onError(error);
      return false;
    }
  }

  async function disposeActiveExplanation(options = {}) {
    const explanation = activeExplanation.value;
    if (!explanation) {
      return true;
    }
    const requestId = explanationRequestId;
    const disposed = await disposeExplanation(explanation, options);
    if (disposed && requestId === explanationRequestId && activeExplanation.value?.id === explanation.id) {
      activeExplanation.value = null;
      explanationFollowup.value = "";
    }
    return disposed;
  }

  async function closeExplanation() {
    const explanation = activeExplanation.value;
    if (!explanation?.id || explanationClosing.value) {
      return false;
    }
    clearExplanationStream();
    const requestId = explanationRequestId;
    explanationClosing.value = true;
    explanationError.value = "";
    try {
      const disposed = await disposeActiveExplanation({
        onError(error) {
          if (requestId === explanationRequestId && activeExplanation.value?.id === explanation.id) {
            explanationFeedback.error(error, "Source explanation cleanup failed. Close it again to retry.");
          }
        }
      });
      return disposed && requestId === explanationRequestId;
    } finally {
      if (requestId === explanationRequestId) {
        explanationClosing.value = false;
      }
    }
  }

  function updateExplanationFollowup(value = "") {
    explanationFollowup.value = String(value || "");
  }

  async function sendExplanationFollowup() {
    const message = explanationFollowup.value.trim();
    const explanation = activeExplanation.value;
    const explanationId = explanation?.id || "";
    if (
      !message ||
      !explanationId ||
      !canLoad.value ||
      explanationBusy.value ||
      explanationClosing.value
    ) {
      return;
    }
    const requestId = explanationRequestId + 1;
    explanationRequestId = requestId;
    explanationAbortController?.abort();
    explanationAbortController = null;
    const createdAt = nowIso();
    const userMessageId = sourceEditorClientId("msg");
    const assistantMessageId = sourceEditorClientId("msg");
    activeExplanation.value = appendSourceEditorExplanationMessages(activeExplanation.value, [
      {
        createdAt,
        id: userMessageId,
        role: "user",
        status: "complete",
        text: message
      },
      {
        createdAt,
        id: assistantMessageId,
        role: "assistant",
        status: "thinking",
        text: ""
      }
    ]);
    explanationBusy.value = true;
    explanationError.value = "";
    explanationFollowup.value = "";
    try {
      await streamSourceEditorRequest(vibe64SourceEditorExplanationFollowupsStreamPath(
        currentSessionsApiPath.value,
        currentSessionId.value,
        explanationId
      ), {
        assistantMessageId,
        message,
        userMessageId
      }, requestId);
    } catch (error) {
      if (String(error?.name || "") === "AbortError") {
        return;
      }
      if (requestId === explanationRequestId) {
        const errorMessage = String(error?.message || error || "Source explanation follow-up could not be sent.");
        explanationError.value = errorMessage;
        markActiveExplanationMessage("failed", errorMessage);
      }
    } finally {
      if (requestId === explanationRequestId) {
        explanationBusy.value = false;
        explanationAbortController = null;
      }
    }
  }

  /**
   * Ends the explanation of the session being left, deleting it there unless a
   * Close is already doing so.
   * @param {{ sessionsApiPath: string, sessionId: string }} previousSession
   */
  function leaveSession(previousSession) {
    const closePending = explanationClosing.value;
    clearExplanationStream();
    explanationClosing.value = false;
    if (activeExplanation.value && !closePending) {
      void disposeActiveExplanation(previousSession);
    }
    activeExplanation.value = null;
    explanationFollowup.value = "";
  }

  /** Stops the answer in flight and deletes the open explanation unless a Close is already doing so. */
  function dispose() {
    const closePending = explanationClosing.value;
    clearExplanationStream();
    explanationClosing.value = false;
    if (!closePending) {
      void disposeActiveExplanation();
    }
  }

  return {
    activeExplanation,
    cleanupAbandonedExplanations,
    closeExplanation,
    dispose,
    explainSelection,
    explanationBusy,
    explanationClosing,
    explanationError,
    explanationFollowup,
    leaveSession,
    retryExplanation,
    sendExplanationFollowup,
    stopExplanation,
    updateExplanationFollowup
  };
}

export { useVibe64SourceEditorExplanations };
