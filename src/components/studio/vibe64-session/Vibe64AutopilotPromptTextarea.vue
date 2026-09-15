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
import { computed, ref, watch } from "vue";
import {
  useVibe64AttachmentCommands
} from "@/composables/useVibe64AttachmentCommands.js";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import {
  useAgentAttachments
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
  deleteAttachment: attachmentCommands.deleteAttachment,
  onError: attachmentFeedback.error,
  onUploaded: async (uploaded) => {
    const labeled = labelComposerAttachments(uploadedAttachments.value);
    for (const attachment of uploadedAttachments.value) {
      attachment.reference = labeled.find((item) => item.attachmentId === attachment.attachmentId).reference;
    }
    const textarea = textareaRef.value;
    const text = textarea?.value ?? props.modelValue;
    const position = textarea?.selectionEnd ?? text.length;
    const references = uploaded.map((attachment) => attachment.reference).join(" ");
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
const uploadedAttachments = attachments.attachments;
const attachmentUploading = attachments.uploading;
const queueItems = attachments.queueItems;
const attachmentState = computed(() => Object.freeze({
  atCapacity: attachments.atCapacity.value,
  canAddFiles: attachments.canAddFiles.value,
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
  attachments.canAddFiles.value
));
function emitAttachmentsChanged() {
  emit("attachments-change", [...uploadedAttachments.value]);
}

function removeUploadedAttachment(attachment = {}) {
  const previous = uploadedAttachments.value.map((item) => ({ ...item }));
  const removed = attachments.removeAttachment(attachment);
  if (!removed.length) {
    return;
  }
  const next = labelComposerAttachments(uploadedAttachments.value);
  for (const item of uploadedAttachments.value) {
    item.reference = next.find((candidate) => candidate.attachmentId === item.attachmentId).reference;
  }
  const textarea = textareaRef.value;
  const value = updateComposerAttachmentReferences(textarea?.value ?? props.modelValue, previous, next);
  if (textarea) textarea.value = value;
  emit("update:modelValue", value);
  emitAttachmentsChanged();
}

function clearAttachments({ attachmentIds = null } = {}) {
  if (!queueItems.value.length) {
    return false;
  }
  const previous = uploadedAttachments.value.map((item) => ({ ...item }));
  attachments.clearAttachments({ accepted: true, attachmentIds });
  const labeled = labelComposerAttachments(uploadedAttachments.value);
  for (const attachment of uploadedAttachments.value) {
    attachment.reference = labeled.find((item) => item.attachmentId === attachment.attachmentId).reference;
  }
  const remainingIds = new Set(labeled.map((attachment) => attachment.attachmentId));
  const text = textareaRef.value?.value ?? props.modelValue;
  const value = updateComposerAttachmentReferences(
    text,
    previous.filter((attachment) => remainingIds.has(attachment.attachmentId)), labeled
  );
  if (value !== text) {
    if (textareaRef.value) textareaRef.value.value = value;
    emit("update:modelValue", value);
  }
  emitAttachmentsChanged();
  return true;
}

function attachmentsCanSubmit() {
  return attachments.canSubmit.value;
}

async function attachFiles(files = []) {
  return attachments.uploadFiles(files);
}

async function attachFileProducer(options = {}) {
  const uploaded = await attachments.uploadFileProducer(options);
  return uploaded ? [uploaded] : [];
}

async function handleFileInputChange(event = {}) {
  const files = Array.from(event?.target?.files || []);
  if (event?.target) {
    event.target.value = "";
  }
  await attachments.uploadFiles(files);
}

function handleDrop(event) {
  void attachments.handleDrop(event);
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
const handlePaste = attachments.handlePaste;

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
