<template>
  <AssistantPromptInput
    ref="promptInput"
    v-bind="{ ...presentationProps, ...$attrs }"
    :attachment-state="attachmentState"
    :dragging="dragActive"
    @update:model-value="emit('update:modelValue', $event)"
    @blur="emit('blur', $event)"
    @focus="emit('focus', $event)"
    @escape="emit('escape', $event)"
    @input-activity="emit('input-activity')"
    @submit="emit('submit')"
    @tab-to-submit="emit('tab-to-submit')"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
    @paste="handlePaste"
  >
    <template #attachments>
      <input ref="fileInput" :disabled="!canUseFilePicker" hidden multiple type="file" @change="handleFileInputChange">
      <Vibe64AttachmentQueue
        :session-id="sessionId"
        :items="queueItems"
        @cancel="attachments.cancelAttachment"
        @remove="removeUploadedAttachment"
        @retry="attachments.retryAttachment"
      />
    </template>
    <template v-if="$slots['input-start']" #input-start>
      <slot name="input-start" />
    </template>
    <template v-if="$slots.footer" #footer>
      <slot name="footer" :attachment-state="attachmentState" />
    </template>
  </AssistantPromptInput>
</template>
<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import {
  useVibe64AttachmentCommands
} from "@/composables/useVibe64AttachmentCommands.js";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import {
  useAgentAttachments, codexAttachmentFilesFromDropEvent, codexAttachmentFilesFromPasteEvent
} from "@/composables/useAgentAttachments.js";
import { AssistantPromptInput } from "@jskit-ai/assistant-core/client/conversation";
import Vibe64AttachmentQueue from "@/components/studio/vibe64-session/Vibe64AttachmentQueue.vue";
import { labelComposerAttachments, updateComposerAttachmentReferences } from "@/lib/vibe64PromptAttachments.js";

const emit = defineEmits([
  "attachment-state-change",
  "attachments-change",
  "blur",
  "escape",
  "focus",
  "input-activity",
  "submit",
  "tab-to-submit",
  "update:modelValue"
]);
defineOptions({
  inheritAttrs: false
});

const props = defineProps({
  ariaLabel: {
    default: "",
    type: String
  },
  savedAttachments: { type: Array, default: null },
  attachmentsOwnedByConversation: Boolean,
  attachmentsEnabled: {
    default: true,
    type: Boolean
  },
  autoGrow: {
    default: true,
    type: Boolean
  },
  disabled: {
    default: false,
    type: Boolean
  },
  describedBy: {
    default: "",
    type: String
  },
  errorMessages: {
    default: () => [],
    type: [Array, String]
  },
  hint: {
    default: "",
    type: String
  },
  label: {
    default: "",
    type: String
  },
  modelValue: {
    default: "",
    type: String
  },
  persistentHint: {
    default: false,
    type: Boolean
  },
  placeholderAffectsHeight: {
    default: true,
    type: Boolean
  },
  placeholder: {
    default: "",
    type: String
  },
  rows: {
    default: 4,
    type: [Number, String]
  },
  density: {
    default: "default",
    type: String
  },
  submitOnEnter: {
    default: false,
    type: Boolean
  },
  submitEnabled: {
    default: true,
    type: Boolean
  },
  tabToSubmit: {
    default: false,
    type: Boolean
  },
  sessionId: {
    default: "",
    type: String
  },
  variant: {
    default: "outlined",
    type: String
  }
});

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
const fileInput = ref(null);
const presentationProps = computed(() => {
  const input = { ...props };
  delete input.sessionId;
  delete input.attachmentsEnabled;
  delete input.savedAttachments;
  delete input.attachmentsOwnedByConversation;
  return input;
});
const promptInput = ref(null);
const textareaRef = computed(() => promptInput.value?.inputElement);
function queueResizeTextarea() {
  promptInput.value?.queueResizeTextarea();
}

function preserveHeightForNextModelValue() {
  return promptInput.value?.preserveHeightForNextModelValue();
}
const canUseFilePicker = computed(() => Boolean(
  attachmentState.value.canAddFiles
));
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

async function handleFileInputChange(event = {}) {
  const files = Array.from(event?.target?.files || []);
  if (event?.target) {
    event.target.value = "";
  }
  await attachFiles(files);
}

function handleDrop(event) {
  attachments.resetDragState();
  void attachFiles(codexAttachmentFilesFromDropEvent(event));
}

function openFilePicker() {
  if (!canUseFilePicker.value) {
    return false;
  }
  fileInput.value?.click();
  return true;
}

function focusTextarea(options = { preventScroll: true }) {
  textareaRef.value?.focus?.(options);
}

const handleDragEnter = attachments.handleDragEnter;
const handleDragOver = attachments.handleDragOver;
const handleDragLeave = attachments.handleDragLeave;
function handlePaste(event) {
  const files = codexAttachmentFilesFromPasteEvent(event);
  if (!files.length) return attachments.handlePaste(event);
  if (!event.clipboardData?.getData("text/plain")) event.preventDefault?.();
  return attachFiles(files);
}
watch(() => props.savedAttachments, (files) => {
  if (!files) return;
  const removed = attachments.attachments.value.filter((file) => !files.some((saved) => saved.attachmentId === file.attachmentId));
  if (removed.length) attachments.clearAttachments({ attachmentIds: removed.map((file) => file.attachmentId) });
});
onBeforeUnmount(() => {
  // Ready receipts belong to the saved draft; dispose still cancels unfinished uploads.
  if (props.savedAttachments) attachments.clearAttachments({ attachmentIds: attachments.attachments.value.map((file) => file.attachmentId) });
});

watch(attachmentState, (state) => {
  emit("attachment-state-change", state);
}, {
  immediate: true
});

defineExpose({
  attachmentState,
  attachmentsCanSubmit,
  attachFileProducer,
  attachFiles,
  canSubmit: attachments.canSubmit,
  clearAttachments,
  focus: focusTextarea,
  openFilePicker,
  preserveHeightForNextModelValue,
  queueItems,
  inputElement: textareaRef
});
</script>
