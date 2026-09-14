<template>
  <div
    class="studio-autopilot-prompt-textarea"
    :class="{
      'studio-autopilot-prompt-textarea--compact': density === 'compact',
      'studio-autopilot-prompt-textarea--dragging': dragActive,
      'studio-autopilot-prompt-textarea--has-attachments': queueItems.length,
      'studio-autopilot-prompt-textarea--has-footer': $slots.footer,
      'studio-autopilot-prompt-textarea--has-input-start': $slots['input-start']
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

    <Vibe64AttachmentQueue
      :session-id="sessionId"
      :items="queueItems"
      @cancel="attachments.cancelAttachment"
      @remove="removeUploadedAttachment"
      @retry="attachments.retryAttachment"
    />

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

      <div
        v-if="$slots['input-start']"
        class="studio-autopilot-prompt-textarea__input-start"
      >
        <slot name="input-start" />
      </div>

      <textarea
        :id="textareaId"
        ref="textareaRef"
        :aria-describedby="describedBy || undefined"
        :aria-label="textareaAriaLabel"
        class="studio-autopilot-prompt-textarea__input"
        :disabled="disabled"
        :placeholder="placeholder"
        :rows="rows"
        :value="modelValue"
        @blur="handleTextareaBlur"
        @focus="handleTextareaFocus"
        @input="handleTextareaInput"
        @keydown="handleTextareaKeydown"
        @paste="handlePaste"
      />

      <div
        v-if="$slots.footer"
        class="studio-autopilot-prompt-textarea__footer"
      >
        <slot name="footer" :attachment-state="attachmentState" />
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
import { computed, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import {
  useVibe64AttachmentCommands
} from "@/composables/useVibe64AttachmentCommands.js";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import {
  useAgentAttachments
} from "@/composables/useAgentAttachments.js";
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
const textareaRef = ref(null);
const textareaId = `studio-autopilot-prompt-${useId()}`;
let resizeFrame = 0;
let preserveHeightForNextModelValueChange = false;
const canUseFilePicker = computed(() => Boolean(
  attachments.canAddFiles.value
));
const combinedErrorMessages = computed(() => {
  return Array.isArray(props.errorMessages)
    ? props.errorMessages
    : [props.errorMessages].filter(Boolean);
});
const hintVisible = computed(() => Boolean(
  props.hint &&
  (props.persistentHint || combinedErrorMessages.value.length < 1)
));
const detailsVisible = computed(() => Boolean(
  combinedErrorMessages.value.length ||
  hintVisible.value
));
const textareaAriaLabel = computed(() => (
  props.ariaLabel
    ? props.ariaLabel
    : undefined
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
  if (!props.placeholderAffectsHeight && !textarea.value) {
    return;
  }
  const style = window.getComputedStyle(textarea);
  const minHeight = Number.parseFloat(style.minHeight) || 0;
  const maxHeight = Number.parseFloat(style.maxHeight) || Number.POSITIVE_INFINITY;
  textarea.style.height = "auto";
  const contentHeight = Math.max(textarea.scrollHeight, minHeight);
  const targetHeight = Math.min(contentHeight, maxHeight);
  textarea.style.height = `${targetHeight}px`;
  textarea.style.overflowY = contentHeight > targetHeight + 1 ? "auto" : "hidden";
}

function queueResizeTextarea() {
  if (!props.autoGrow || typeof window === "undefined") {
    return;
  }
  if (resizeFrame) {
    window.cancelAnimationFrame(resizeFrame);
  }
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = 0;
    resizeTextarea();
  });
}

function preserveHeightForNextModelValue() {
  const textarea = textareaRef.value;
  if (!props.autoGrow || !textarea) {
    return false;
  }
  if (resizeFrame) {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
  }
  preserveHeightForNextModelValueChange = true;
  textarea.style.height = `${textarea.getBoundingClientRect().height}px`;
  textarea.style.overflowY = "auto";
  return true;
}

function handleTextareaInput(event = {}) {
  preserveHeightForNextModelValueChange = false;
  emit("input-activity");
  emit("update:modelValue", String(event?.target?.value || ""));
  queueResizeTextarea();
}

function handleTextareaFocus(event = {}) {
  emit("focus", event);
}

function handleTextareaBlur(event = {}) {
  emit("blur", event);
}

function handleTextareaKeydown(event = {}) {
  if (event.key === "Escape") {
    emit("escape", event);
    return;
  }
  if (
    props.tabToSubmit &&
    props.submitEnabled &&
    String(props.modelValue || "").trim() &&
    attachments.canSubmit.value &&
    event.key === "Tab" &&
    !event.shiftKey &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey
  ) {
    event.preventDefault();
    emit("tab-to-submit");
    return;
  }
  if (event.key === "Enter" && !props.submitOnEnter) {
    event.stopPropagation();
    return;
  }
  if (
    !props.submitOnEnter ||
    event.key !== "Enter" ||
    event.shiftKey ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.isComposing ||
    !props.submitEnabled ||
    !attachments.canSubmit.value
  ) {
    return;
  }
  event.preventDefault();
  emit("submit");
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

onMounted(queueResizeTextarea);

onBeforeUnmount(() => {
  if (resizeFrame && typeof window !== "undefined") {
    window.cancelAnimationFrame(resizeFrame);
    resizeFrame = 0;
  }
});

watch(() => [
  props.autoGrow,
  props.modelValue,
  props.placeholder,
  props.placeholderAffectsHeight,
  props.rows
], (values, previousValues = []) => {
  const modelValueChanged = values[1] !== previousValues[1];
  if (preserveHeightForNextModelValueChange && modelValueChanged) {
    preserveHeightForNextModelValueChange = false;
    return;
  }
  queueResizeTextarea();
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
  queueItems
});
</script>

<style scoped>
.studio-autopilot-prompt-textarea {
  box-sizing: border-box;
  display: grid;
  gap: 0;
  max-width: 100%;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  position: relative;
  text-align: left;
  width: 100%;
}

.studio-autopilot-prompt-textarea__field {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.34);
  border-radius: 18px;
  box-sizing: border-box;
  box-shadow: inset 0 0 0 1px rgba(var(--v-theme-on-surface), 0.08);
  display: grid;
  max-width: 100%;
  min-width: 0;
  padding-top: 0.01rem;
  transition: border-color 120ms ease, box-shadow 120ms ease;
}

.studio-autopilot-prompt-textarea__field:not(.studio-autopilot-prompt-textarea__field--disabled):focus-within {
  border-color: rgb(var(--v-theme-primary));
  box-shadow:
    0 0 0 2px rgba(var(--v-theme-primary), 0.28),
    inset 0 0 0 1px rgba(var(--v-theme-primary), 0.2);
}

.studio-autopilot-prompt-textarea__field--disabled {
  background: rgba(var(--v-theme-on-surface), 0.04);
  border-color: rgba(var(--v-theme-on-surface), 0.16);
  box-shadow: none;
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
  box-sizing: border-box;
  color: rgb(var(--v-theme-on-surface));
  display: block;
  font: inherit;
  line-height: 1.4;
  max-height: min(16rem, 32dvh);
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

.studio-autopilot-prompt-textarea__input-start {
  min-width: 0;
  padding: 0.5rem 1rem 0.08rem;
}

.studio-autopilot-prompt-textarea--has-input-start .studio-autopilot-prompt-textarea__input {
  padding-top: 0.24rem;
}

.studio-autopilot-prompt-textarea__input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.58);
  opacity: 1;
}

.studio-autopilot-prompt-textarea__input:disabled {
  color: rgba(var(--v-theme-on-surface), 0.38);
  cursor: not-allowed;
  opacity: 1;
  -webkit-text-fill-color: currentColor;
}

.studio-autopilot-prompt-textarea__input:disabled::placeholder {
  color: inherit;
  opacity: 1;
}

.studio-autopilot-prompt-textarea__footer {
  min-width: 0;
  padding: 0 0.55rem 0.55rem;
}

.studio-autopilot-prompt-textarea--compact .studio-autopilot-prompt-textarea__input {
  max-height: min(8rem, 20dvh);
  min-height: 2.5rem;
  padding: 0.4rem 0.65rem 0.15rem;
}

.studio-autopilot-prompt-textarea--compact .studio-autopilot-prompt-textarea__footer {
  padding: 0 0.3rem 0.25rem;
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

.studio-autopilot-prompt-textarea--has-attachments .studio-autopilot-prompt-textarea__field {
  border-top-left-radius: 0;
  border-top-right-radius: 0;
  margin-top: -1px;
}

</style>
