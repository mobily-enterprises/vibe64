import { unref } from "vue";
import {
  useCodexAttachments
} from "@/composables/useCodexAttachments.js";

function attachmentPathForTerminal(attachmentPath = "") {
  const normalizedPath = String(attachmentPath || "").trim();
  return normalizedPath ? `[${normalizedPath}] ` : "";
}

function useCodexTerminalAttachments({
  ensureTerminalReady,
  focusTerminal,
  sendTerminalData,
  sessionId,
  uploadAttachment
} = {}) {
  async function injectAttachmentPath(attachmentPath = "") {
    const terminalText = attachmentPathForTerminal(attachmentPath);
    return terminalText ? sendTerminalData(terminalText) : false;
  }

  async function injectUploadedAttachments(uploaded = []) {
    for (const attachment of uploaded) {
      const fileName = String(attachment.fileName || "attachment");
      const attachmentPath = String(attachment.path || "").trim();
      if (!attachmentPath) {
        throw new Error(`${fileName} uploaded, but no Codex path was returned.`);
      }
      if (!(await injectAttachmentPath(attachmentPath))) {
        throw new Error(`${fileName} uploaded, but its path could not be sent to Codex.`);
      }
    }
  }

  const attachments = useCodexAttachments({
    canUpload: () => Boolean(unref(sessionId)),
    onUploaded: async (uploaded = []) => {
      await injectUploadedAttachments(uploaded);
      const label = uploaded.length === 1
        ? uploaded[0].fileName
        : `${uploaded.length} files`;
      attachments.status.value = `${label} attached. Press Enter in Codex when ready.`;
      focusTerminal();
    },
    sessionId,
    uploadAttachment: async (currentSessionId, file) => {
      if (!(await ensureTerminalReady())) {
        throw new Error("Codex terminal is not ready for attachments.");
      }
      return uploadAttachment(currentSessionId, file);
    }
  });

  return {
    attachmentDragActive: attachments.dragActive,
    attachmentStatus: attachments.status,
    attachmentUploading: attachments.uploading,
    clearAttachmentStatus: attachments.clearStatus,
    handleAttachmentDragEnter: attachments.handleDragEnter,
    handleAttachmentDragLeave: attachments.handleDragLeave,
    handleAttachmentDragOver: attachments.handleDragOver,
    handleAttachmentDrop: attachments.handleDrop,
    resetAttachmentDragState: attachments.resetDragState
  };
}

export {
  attachmentPathForTerminal,
  useCodexTerminalAttachments
};
