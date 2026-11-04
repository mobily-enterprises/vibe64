import { computed } from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import { useVibe64AttachmentCommands } from "@/composables/useVibe64AttachmentCommands.js";
import { useAgentAttachments } from "@/composables/useAgentAttachments.js";
import { labelComposerAttachments, updateComposerAttachmentReferences } from "@/lib/vibe64PromptAttachments.js";

/**
 * A prompt's attachments: the saved draft's files and new uploads in one
 * numbered queue, with each file's `[File #n]` reference kept in the prompt text.
 * @param {{
 *   attachmentsEnabled: boolean,
 *   attachmentsOwnedByConversation: boolean,
 *   disabled: boolean,
 *   modelValue: string,
 *   savedAttachments: Array<{ attachmentId: string, reference?: string }> | null,
 *   sessionId: string
 * }} props The prompt's props.
 * @param {(event: "attachments-change" | "update:modelValue", value: any) => void} emit The prompt's emit.
 * @param {object} options
 * @param {() => void} options.queueResizeTextarea Fits the prompt to its new text.
 * @param {import("vue").ComputedRef<HTMLTextAreaElement | undefined>} options.textareaRef The prompt's textarea once mounted.
 */
function useVibe64PromptAttachments(props, emit, { queueResizeTextarea, textareaRef }) {
  const attachmentCommands = useVibe64AttachmentCommands();
  const uploadAttachment = attachmentCommands.uploadAttachment;
  const attachmentFeedback = useUiFeedback({
    source: "vibe64.agent-attachment.upload.feedback"
  });
  const attachments = useAgentAttachments({
    canUpload: () => props.attachmentsEnabled && !props.disabled,
    deleteAttachment: deleteUploadedFile,
    onError: attachmentFeedback.error,
    onUploaded: async (uploaded) => {
      const textarea = textareaRef.value;
      const text = textarea?.value ?? props.modelValue;
      const position = textarea?.selectionEnd ?? text.length;
      const references = uploaded.map((attachment) =>
        uploadedAttachments.value.find((item) => item.attachmentId === attachment.attachmentId).reference
      ).join(" ");
      const before = text.slice(0, position);
      const after = text.slice(position);
      const inserted = `${before && !/\s$/u.test(before) ? " " : ""}${references} `;
      const value = before + inserted + after;
      if (textarea) {
        textarea.value = value;
        textarea.setSelectionRange(position + inserted.length, position + inserted.length);
      }
      emit("update:modelValue", value);
      queueResizeTextarea();
      emit("attachments-change", [...uploadedAttachments.value]);
    },
    sessionId: computed(() => props.sessionId),
    uploadAttachment
  });
  const dragActive = attachments.dragActive;
  const restoredAttachments = computed(() => (props.savedAttachments || [])
    .filter((saved) => !attachments.attachments.value.some((file) => file.attachmentId === saved.attachmentId)));
  const uploadedAttachments = computed(() => labelComposerAttachments([...restoredAttachments.value, ...attachments.attachments.value]));
  const attachmentUploading = attachments.uploading;
  const queueItems = computed(() => [
    ...restoredAttachments.value.map((file) => ({ ...file, phase: "ready", receipt: file })),
    ...attachments.queueItems.value
  ].map((row) => ({ ...row, receipt: uploadedAttachments.value.find((file) => file.attachmentId === row.attachmentId) || row.receipt })));
  const availableSlots = computed(() => Math.max(0, attachments.maxItems - queueItems.value.filter((row) => row.phase !== "cancelled").length));
  const attachmentState = computed(() => Object.freeze({
    atCapacity: availableSlots.value === 0,
    canAddFiles: attachments.canAddFiles.value && availableSlots.value > 0,
    canSubmit: attachments.canSubmit.value,
    count: queueItems.value.length,
    hasUnresolved: attachments.hasUnresolved.value,
    uploading: attachmentUploading.value
  }));

  function deleteUploadedFile(sessionId, attachmentId) {
    // Saved temporary files are released by conversation Close, including prior messages.
    if (props.attachmentsOwnedByConversation && props.savedAttachments?.some((file) => file.attachmentId === attachmentId)) {
      return Promise.resolve({ ok: true });
    }
    return attachmentCommands.deleteAttachment(sessionId, attachmentId);
  }
  function removeUploadedAttachment(attachment = {}) {
    const previous = uploadedAttachments.value;
    const removed = attachments.removeAttachment(attachment);
    const saved = restoredAttachments.value.find((file) => file.attachmentId === attachment.attachmentId);
    if (!removed.length && !saved) return;
    if (!removed.length) void deleteUploadedFile(props.sessionId, saved.attachmentId)
      .catch((error) => attachmentFeedback.error(error));
    const next = labelComposerAttachments(previous.filter((file) => file.attachmentId !== attachment.attachmentId));
    const value = updateComposerAttachmentReferences(textareaRef.value?.value ?? props.modelValue, previous, next);
    if (textareaRef.value) textareaRef.value.value = value;
    emit("update:modelValue", value);
    emit("attachments-change", next);
  }

  function clearAttachments({ attachmentIds = null } = {}) {
    if (!queueItems.value.length) return false;
    const previous = uploadedAttachments.value;
    const accepted = new Set(attachmentIds || previous.map((file) => file.attachmentId));
    attachments.clearAttachments({ accepted: true, attachmentIds });
    const remaining = previous.filter((file) => !accepted.has(file.attachmentId));
    const next = labelComposerAttachments(remaining);
    const text = textareaRef.value?.value ?? props.modelValue;
    const value = updateComposerAttachmentReferences(text, remaining, next);
    if (value !== text) {
      if (textareaRef.value) textareaRef.value.value = value;
      emit("update:modelValue", value);
    }
    emit("attachments-change", next);
    return true;
  }

  function attachmentsCanSubmit() {
    return attachments.canSubmit.value;
  }

  async function attachFiles(files = []) {
    const accepted = Array.from(files).slice(0, availableSlots.value);
    if (accepted.length < files.length) attachmentFeedback.error(`A message can keep at most ${attachments.maxItems} attachments.`);
    return attachments.uploadFiles(accepted);
  }

  async function attachFileProducer(options = {}) {
    if (!attachmentState.value.canAddFiles) return [];
    const uploaded = await attachments.uploadFileProducer(options);
    return uploaded ? [uploaded] : [];
  }

  return {
    attachFileProducer,
    attachFiles,
    attachmentState,
    attachments,
    attachmentsCanSubmit,
    clearAttachments,
    dragActive,
    queueItems,
    removeUploadedAttachment
  };
}

export {
  useVibe64PromptAttachments
};
