import { computed, ref } from "vue";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function codexAttachmentSessionId(sessionId) {
  return String(readRefOrGetterValue(sessionId) || "").trim();
}

function codexAttachmentUploadAllowed(canUpload) {
  return readRefOrGetterValue(canUpload) !== false;
}

function codexAttachmentFiles(fileList = []) {
  return Array.from(fileList || []).filter((file) => file && file.size >= 0);
}

function codexAttachmentFilesFromDropEvent(event) {
  return codexAttachmentFiles(event?.dataTransfer?.files);
}

function codexAttachmentEventHasFiles(event) {
  return codexAttachmentFilesFromDropEvent(event).length > 0 ||
    Array.from(event?.dataTransfer?.types || []).includes("Files");
}

function attachmentUploadError(attachment = {}) {
  return attachment?.error || attachment?.errors?.[0]?.message || "";
}

function attachmentIdentity(attachment = {}) {
  return String(
    attachment?.attachmentId ||
    attachment?.containerPath ||
    attachment?.fileName ||
    ""
  );
}

async function deliverUploadedAttachments(onUploaded, uploaded = []) {
  if (uploaded.length > 0) {
    await onUploaded(uploaded);
  }
}

function useCodexAttachments({
  canUpload = () => true,
  onUploaded = async () => null,
  sessionId,
  uploadAttachment
} = {}) {
  const attachments = ref([]);
  const dragDepth = ref(0);
  const status = ref("");
  const uploading = ref(false);
  const dragActive = computed(() => dragDepth.value > 0);

  function resetDragState() {
    dragDepth.value = 0;
  }

  function clearStatus() {
    status.value = "";
  }

  function clearAttachments() {
    const cleared = [...attachments.value];
    attachments.value = [];
    return cleared;
  }

  function handleDragEnter(event) {
    if (!codexAttachmentEventHasFiles(event)) {
      return;
    }
    dragDepth.value += 1;
    if (event?.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragOver(event) {
    if (event?.dataTransfer) {
      event.dataTransfer.dropEffect = "copy";
    }
  }

  function handleDragLeave() {
    dragDepth.value = Math.max(0, dragDepth.value - 1);
  }

  async function uploadFiles(files = []) {
    const uploadableFiles = codexAttachmentFiles(files);
    const currentSessionId = codexAttachmentSessionId(sessionId);
    if (
      uploadableFiles.length < 1 ||
      !currentSessionId ||
      uploading.value ||
      !codexAttachmentUploadAllowed(canUpload) ||
      typeof uploadAttachment !== "function"
    ) {
      return [];
    }

    uploading.value = true;
    status.value = "";
    const uploaded = [];
    let uploadFailure = "";
    try {
      for (const file of uploadableFiles) {
        const attachment = await uploadAttachment(currentSessionId, file);
        if (attachment?.ok === false) {
          throw new Error(attachmentUploadError(attachment) || "Attachment upload failed.");
        }
        uploaded.push(attachment);
        attachments.value.push(attachment);
      }
    } catch (error) {
      uploadFailure = String(error?.message || error || "Attachment upload failed.");
    }
    try {
      await deliverUploadedAttachments(onUploaded, uploaded);
    } catch (error) {
      status.value = String(error?.message || error || "Attachment upload failed.");
    } finally {
      if (uploadFailure) {
        status.value = uploadFailure;
      }
      uploading.value = false;
    }
    return uploaded;
  }

  async function handleDrop(event) {
    resetDragState();
    return uploadFiles(codexAttachmentFilesFromDropEvent(event));
  }

  function removeAttachment(attachment = {}) {
    const id = attachmentIdentity(attachment);
    if (!id) {
      return [];
    }
    const removed = attachments.value.filter((candidate) => attachmentIdentity(candidate) === id);
    attachments.value = attachments.value.filter((candidate) => attachmentIdentity(candidate) !== id);
    return removed;
  }

  return {
    attachments,
    clearAttachments,
    clearStatus,
    dragActive,
    handleDragEnter,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    removeAttachment,
    resetDragState,
    status,
    uploading,
    uploadFiles
  };
}

export {
  codexAttachmentEventHasFiles,
  codexAttachmentFiles,
  codexAttachmentFilesFromDropEvent,
  useCodexAttachments
};
