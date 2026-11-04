import { toValue, unref, watch } from "vue";
import {
  useAgentAttachments
} from "@/composables/useAgentAttachments.js";

function attachmentPathForTerminal(attachmentPath = "") {
  const normalizedPath = String(attachmentPath || "").trim();
  return normalizedPath ? `[${normalizedPath}] ` : "";
}

/**
 * Attachments an agent terminal accepts: files are uploaded for the session, then each one's path is typed into the
 * terminal that was current when its upload began, so a file never reaches a different terminal.
 * @param {{
 *   assistantLabel?: string | import("vue").Ref<string>,
 *   canUpload: import("vue").MaybeRefOrGetter<boolean>,
 *   deleteAttachment?: (sessionId: string, attachmentId: string) => Promise<unknown>,
 *   ensureTerminalReady: () => Promise<boolean> | boolean,
 *   focusTerminal: () => unknown,
 *   sendAttachmentPath: (text: string, attachmentIds: string[], target: { sessionId: string, terminalSessionId: string }) => Promise<boolean>,
 *   sessionId: import("vue").Ref<string>,
 *   terminalSessionId: import("vue").Ref<string>,
 *   uploadAttachment: (sessionId: string, file: File, options?: object) => Promise<object>
 * }} options
 */
function useAgentTerminalAttachments({
  assistantLabel = "Codex",
  canUpload,
  deleteAttachment,
  ensureTerminalReady,
  focusTerminal,
  sendAttachmentPath,
  sessionId,
  terminalSessionId,
  uploadAttachment
}) {
  const label = () => String(unref(assistantLabel) || "AI");
  const uploadAllowed = () => Boolean(unref(sessionId)) && toValue(canUpload) !== false;

  function currentTarget(attachment) {
    return uploadAllowed() && attachment.sessionId === unref(sessionId) &&
      attachment.terminalSessionId === unref(terminalSessionId);
  }

  async function injectUploadedAttachments(uploaded = []) {
    for (const attachment of uploaded) {
      if (!currentTarget(attachment)) {
        throw new Error("The terminal changed before the attachment was delivered. Attach the file again.");
      }
      const fileName = String(attachment.fileName || "attachment");
      const terminalText = attachmentPathForTerminal(attachment.path);
      if (!terminalText) {
        throw new Error(`${fileName} uploaded, but no attachment path was returned.`);
      }
      if (!(await sendAttachmentPath(terminalText, [attachment.attachmentId], {
        sessionId: attachment.sessionId,
        terminalSessionId: attachment.terminalSessionId
      }))) {
        throw new Error(`${fileName} uploaded, but its path could not be sent to ${label()}.`);
      }
    }
  }

  const attachments = useAgentAttachments({
    canUpload: uploadAllowed,
    deleteAttachment,
    onUploaded: async (uploaded = []) => {
      await injectUploadedAttachments(uploaded);
      const fileLabel = uploaded.length === 1
        ? uploaded[0].fileName
        : `${uploaded.length} files`;
      if (uploaded.every(currentTarget)) {
        attachments.status.value = `${fileLabel} attached. Press Enter in ${label()} when ready.`;
        focusTerminal();
      }
      return { accepted: true };
    },
    sessionId,
    uploadAttachment: async (currentSessionId, file, options = {}) => {
      if (!(await ensureTerminalReady()) || !uploadAllowed() ||
          currentSessionId !== unref(sessionId) || options.signal?.aborted) {
        throw new Error(`${label()} terminal is not ready for attachments.`);
      }
      const targetTerminalId = unref(terminalSessionId);
      const uploaded = await uploadAttachment(currentSessionId, file, options);
      return { ...uploaded, terminalSessionId: targetTerminalId };
    }
  });

  watch(() => unref(terminalSessionId), (_next, previous) => {
    if (!previous) return;
    void attachments.abandonAttachments();
    attachments.clearStatus();
  }, { flush: "sync" });

  return {
    attachmentDragActive: attachments.dragActive,
    attachmentCanAddFiles: attachments.canAddFiles,
    attachmentQueueItems: attachments.queueItems,
    attachmentStatus: attachments.status,
    attachmentUploading: attachments.uploading,
    abandonAttachments: attachments.abandonAttachments,
    cancelAttachment: attachments.cancelAttachment,
    clearAttachmentStatus: attachments.clearStatus,
    handleAttachmentDragEnter: attachments.handleDragEnter,
    handleAttachmentDragLeave: attachments.handleDragLeave,
    handleAttachmentDragOver: attachments.handleDragOver,
    handleAttachmentDrop: attachments.handleDrop,
    removeAttachment: attachments.removeAttachment,
    resetAttachmentDragState: attachments.resetDragState,
    retryAttachment: attachments.retryAttachment,
    uploadAttachmentFiles: attachments.uploadFiles
  };
}

export {
  attachmentPathForTerminal,
  useAgentTerminalAttachments
};
