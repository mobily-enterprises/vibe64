<template>
  <div
    class="studio-autopilot-prompt-textarea"
    :class="{
      'studio-autopilot-prompt-textarea--dragging': dragActive,
      'studio-autopilot-prompt-textarea--has-attachments': uploadedAttachments.length,
      'studio-autopilot-prompt-textarea--has-footer': $slots.footer
    }"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <input
      ref="fileInput"
      class="studio-autopilot-prompt-textarea__file-input"
      :disabled="!canUseFilePicker"
      multiple
      type="file"
      @change="handleFileInputChange"
    >

    <div
      v-if="uploadedAttachments.length"
      class="studio-autopilot-prompt-textarea__attachments"
      aria-label="Attached files"
    >
      <v-chip
        v-for="attachment in uploadedAttachments"
        :key="attachment.attachmentId"
        class="studio-autopilot-prompt-textarea__attachment"
        closable
        :close-icon="mdiClose"
        :disabled="attachmentUploading"
        density="comfortable"
        :prepend-icon="mdiFileOutline"
        size="small"
        variant="outlined"
        @click:close="removeUploadedAttachment(attachment)"
      >
        <span class="studio-autopilot-prompt-textarea__attachment-name">
          {{ attachment.fileName }}
        </span>
      </v-chip>
    </div>

    <div
      class="studio-autopilot-prompt-textarea__field"
      :class="{ 'studio-autopilot-prompt-textarea__field--disabled': disabled }"
    >
      <label
        v-if="label"
        class="studio-autopilot-prompt-textarea__label"
        :for="textareaId"
      >
        {{ label }}
      </label>

      <textarea
        :id="textareaId"
        ref="textareaRef"
        class="studio-autopilot-prompt-textarea__input"
        :disabled="disabled"
        :placeholder="placeholder"
        :rows="rows"
        :value="modelValue"
        @input="handleTextareaInput"
      />

      <div
        v-if="$slots.footer"
        class="studio-autopilot-prompt-textarea__footer"
      >
        <slot name="footer" />
      </div>
    </div>

    <div
      v-if="detailsVisible"
      class="studio-autopilot-prompt-textarea__details"
    >
      <div
        v-for="message in combinedErrorMessages"
        :key="message"
        class="studio-autopilot-prompt-textarea__error"
      >
        {{ message }}
      </div>
      <div
        v-if="hintVisible"
        class="studio-autopilot-prompt-textarea__hint"
      >
        {{ hint }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, nextTick, onMounted, ref, useId, watch } from "vue";
import {
  mdiClose,
  mdiFileOutline
} from "@mdi/js";
import {
  useVibe64CodexCommands
} from "@/composables/useVibe64CodexCommands.js";
import {
  useCodexAttachments
} from "@/composables/useCodexAttachments.js";

const emit = defineEmits([
  "attachments-change",
  "update:modelValue"
]);

const props = defineProps({
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
  placeholder: {
    default: "",
    type: String
  },
  rows: {
    default: 4,
    type: [Number, String]
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

const codexCommands = props.attachmentsEnabled
  ? useVibe64CodexCommands()
  : null;
const uploadAttachment = codexCommands?.uploadAttachment || (async () => ({
  error: "Attachments are disabled for this prompt.",
  ok: false
}));
const attachments = useCodexAttachments({
  canUpload: () => props.attachmentsEnabled && !props.disabled,
  onUploaded: async () => {
    emitAttachmentsChanged();
  },
  sessionId: computed(() => props.sessionId),
  uploadAttachment
});
const dragActive = attachments.dragActive;
const uploadedAttachments = attachments.attachments;
const attachmentUploading = attachments.uploading;
const fileInput = ref(null);
const textareaRef = ref(null);
const textareaId = `studio-autopilot-prompt-${useId()}`;
const canUseFilePicker = computed(() => Boolean(
  props.attachmentsEnabled &&
  !props.disabled &&
  !attachmentUploading.value
));
const combinedErrorMessages = computed(() => {
  const parentMessages = Array.isArray(props.errorMessages)
    ? props.errorMessages
    : [props.errorMessages].filter(Boolean);
  return attachments.status.value
    ? [...parentMessages, attachments.status.value]
    : parentMessages;
});
const hintVisible = computed(() => Boolean(
  props.hint &&
  (props.persistentHint || combinedErrorMessages.value.length < 1)
));
const detailsVisible = computed(() => Boolean(
  combinedErrorMessages.value.length ||
  hintVisible.value
));

function emitAttachmentsChanged() {
  emit("attachments-change", [...uploadedAttachments.value]);
}

function resizeTextarea() {
  if (!props.autoGrow) {
    return;
  }
  const textarea = textareaRef.value;
  if (!textarea) {
    return;
  }
  const style = window.getComputedStyle(textarea);
  const minHeight = Number.parseFloat(style.minHeight) || 0;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.max(textarea.scrollHeight, minHeight)}px`;
}

function queueResizeTextarea() {
  void nextTick(resizeTextarea);
}

function handleTextareaInput(event = {}) {
  emit("update:modelValue", String(event?.target?.value || ""));
  resizeTextarea();
}

function removeUploadedAttachment(attachment = {}) {
  const removed = attachments.removeAttachment(attachment);
  if (!removed.length) {
    return;
  }
  emitAttachmentsChanged();
}

function clearAttachments() {
  if (!uploadedAttachments.value.length) {
    return false;
  }
  attachments.clearAttachments();
  emitAttachmentsChanged();
  return true;
}

async function handleFileInputChange(event = {}) {
  await attachments.uploadFiles(event?.target?.files);
  if (event?.target) {
    event.target.value = "";
  }
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

const handleDragEnter = attachments.handleDragEnter;
const handleDragOver = attachments.handleDragOver;
const handleDragLeave = attachments.handleDragLeave;

onMounted(queueResizeTextarea);

watch(() => [
  props.autoGrow,
  props.modelValue,
  props.rows
], queueResizeTextarea);

defineExpose({
  clearAttachments,
  openFilePicker
});
</script>

<style scoped>
.studio-autopilot-prompt-textarea {
  display: grid;
  gap: 0;
  min-width: 0;
  position: relative;
  text-align: left;
}

.studio-autopilot-prompt-textarea__field {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.42);
  border-radius: 18px;
  display: grid;
  min-width: 0;
  padding-top: 0.01rem;
}

.studio-autopilot-prompt-textarea__field:focus-within {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-primary));
}

.studio-autopilot-prompt-textarea__field--disabled {
  opacity: 0.64;
}

.studio-autopilot-prompt-textarea__label {
  align-self: start;
  background: rgb(var(--v-theme-surface));
  color: rgba(var(--v-theme-on-surface), 0.82);
  font-size: 0.78rem;
  line-height: 1.1;
  margin: -0.5rem 0 0 0.9rem;
  max-width: calc(100% - 1.8rem);
  overflow: hidden;
  padding-inline: 0.24rem;
  text-overflow: ellipsis;
  white-space: nowrap;
  width: fit-content;
  z-index: 1;
}

.studio-autopilot-prompt-textarea__input {
  background: transparent;
  border: 0;
  color: rgb(var(--v-theme-on-surface));
  display: block;
  font: inherit;
  line-height: 1.4;
  max-height: calc(100dvh - 9.5rem);
  min-height: 3.55rem;
  min-width: 0;
  outline: 0;
  overflow-x: hidden;
  overflow-y: hidden;
  padding: 0.5rem 1rem 0.2rem;
  resize: none;
  width: 100%;
  word-break: break-word;
}

.studio-autopilot-prompt-textarea__input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.58);
  opacity: 1;
}

.studio-autopilot-prompt-textarea__input:disabled {
  cursor: default;
}

.studio-autopilot-prompt-textarea__footer {
  min-width: 0;
  padding: 0 0.55rem 0.55rem;
}

.studio-autopilot-prompt-textarea__details {
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: grid;
  font-size: 0.76rem;
  gap: 0.12rem;
  line-height: 1.3;
  min-width: 0;
  padding: 0.32rem 0.75rem 0;
}

.studio-autopilot-prompt-textarea__error {
  color: rgb(var(--v-theme-error));
}

.studio-autopilot-prompt-textarea--dragging {
  outline: 2px dashed rgb(var(--v-theme-primary));
  outline-offset: 4px;
}

.studio-autopilot-prompt-textarea__file-input {
  display: none;
}

.studio-autopilot-prompt-textarea__attachments {
  align-items: center;
  background: rgba(var(--v-theme-surface), 0.96);
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-bottom: 0;
  border-radius: 10px 10px 0 0;
  box-shadow: inset 0 -1px 0 rgba(var(--v-theme-outline), 0.06);
  display: flex;
  flex-wrap: wrap;
  gap: 0.38rem;
  padding: 0.58rem 0.62rem 0.34rem;
  position: relative;
  z-index: 1;
}

.studio-autopilot-prompt-textarea--has-attachments .studio-autopilot-prompt-textarea__field {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  margin-top: -1px;
}

.studio-autopilot-prompt-textarea__attachment {
  background: rgba(var(--v-theme-primary), 0.05) !important;
  border-color: rgba(var(--v-theme-primary), 0.24) !important;
  border-radius: 999px !important;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  color: rgb(var(--v-theme-on-surface)) !important;
  max-width: min(19rem, 100%);
  min-width: 0;
}

.studio-autopilot-prompt-textarea__attachment :deep(.v-chip__prepend) {
  color: rgb(var(--v-theme-primary));
  opacity: 0.88;
}

.studio-autopilot-prompt-textarea__attachment :deep(.v-chip__close) {
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.studio-autopilot-prompt-textarea__attachment:hover {
  background: rgba(var(--v-theme-primary), 0.08) !important;
  border-color: rgba(var(--v-theme-primary), 0.34) !important;
}

.studio-autopilot-prompt-textarea__attachment-name {
  display: inline-block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
