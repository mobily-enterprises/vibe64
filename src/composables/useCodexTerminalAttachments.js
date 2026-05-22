import { unref } from "vue";
import {
  useCodexAttachments
} from "@/composables/useCodexAttachments.js";

function attachmentPathForTerminal(containerPath = "") {
  const normalizedPath = String(containerPath || "").trim();
  return normalizedPath ? `\u001b[200~[${normalizedPath}] \u001b[201~` : "";
}

function useCodexTerminalAttachments({
  ensureTerminalReady,
  focusTerminal,
  sendTerminalData,
  sessionId,
  uploadAttachment
} = {}) {
  async function injectAttachmentPath(containerPath = "") {
    const terminalText = attachmentPathForTerminal(containerPath);
    return terminalText ? sendTerminalData(terminalText) : false;
  }

  async function injectUploadedAttachments(uploaded = []) {
    for (const attachment of uploaded) {
      const fileName = String(attachment.fileName || "attachment");
      const containerPath = String(attachment.containerPath || "").trim();
      if (!containerPath) {
        throw new Error(`${fileName} uploaded, but no Codex path was returned.`);
      }
      if (!(await injectAttachmentPath(containerPath))) {
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
