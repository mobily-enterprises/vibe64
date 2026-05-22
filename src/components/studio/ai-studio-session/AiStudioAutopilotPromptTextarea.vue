<template>
  <div
    class="studio-autopilot-prompt-textarea"
    :class="{ 'studio-autopilot-prompt-textarea--dragging': dragActive }"
    @dragenter.prevent="handleDragEnter"
    @dragover.prevent="handleDragOver"
    @dragleave.prevent="handleDragLeave"
    @drop.prevent="handleDrop"
  >
    <v-textarea
      :model-value="modelValue"
      :auto-grow="autoGrow"
      class="studio-autopilot-prompt-textarea__input"
      :disabled="disabled"
      :error-messages="combinedErrorMessages"
      :hint="hint"
      :label="label"
      :persistent-hint="persistentHint"
      :rows="rows"
      :variant="variant"
      @update:model-value="$emit('update:modelValue', String($event || ''))"
    />

    <div class="studio-autopilot-prompt-textarea__footer">
      <v-btn
        class="studio-autopilot-prompt-textarea__attach"
        :disabled="disabled || uploading || !sessionId"
        :loading="uploading"
        :prepend-icon="mdiPaperclip"
        size="small"
        type="button"
        variant="tonal"
        @click="openFilePicker"
      >
        Attach file
      </v-btn>

      <span class="studio-autopilot-prompt-textarea__hint">
        Files are uploaded for Codex and added to this prompt.
      </span>
    </div>

    <div
      v-if="uploadedAttachments.length"
      class="studio-autopilot-prompt-textarea__attachments"
    >
      <v-chip
        v-for="attachment in uploadedAttachments"
        :key="attachment.attachmentId"
        :prepend-icon="mdiPaperclip"
        size="small"
        variant="tonal"
      >
        {{ attachment.fileName }}
      </v-chip>
    </div>

    <input
      ref="fileInput"
      class="studio-autopilot-prompt-textarea__file-input"
      multiple
      type="file"
      @change="handleFileInputChange"
    >
  </div>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiPaperclip
} from "@mdi/js";
import {
  useAiStudioCodexCommands
} from "@/composables/useAiStudioCodexCommands.js";
import {
  useCodexAttachments
} from "@/composables/useCodexAttachments.js";
import {
  appendPromptAttachmentReferences
} from "@/lib/aiStudioPromptAttachments.js";

const emit = defineEmits(["update:modelValue"]);

const props = defineProps({
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

const fileInput = ref(null);
const { uploadAttachment } = useAiStudioCodexCommands();
const attachments = useCodexAttachments({
  canUpload: () => !props.disabled,
  onUploaded: async (uploaded = []) => {
    updatePromptWithAttachments(uploaded);
  },
  sessionId: computed(() => props.sessionId),
  uploadAttachment
});
const dragActive = attachments.dragActive;
const uploading = attachments.uploading;
const uploadedAttachments = attachments.attachments;
const combinedErrorMessages = computed(() => {
  const parentMessages = Array.isArray(props.errorMessages)
    ? props.errorMessages
    : [props.errorMessages].filter(Boolean);
  return attachments.status.value
    ? [...parentMessages, attachments.status.value]
    : parentMessages;
});

function openFilePicker() {
  fileInput.value?.click?.();
}

function updatePromptWithAttachments(uploadedAttachments = []) {
  emit(
    "update:modelValue",
    appendPromptAttachmentReferences(props.modelValue, uploadedAttachments)
  );
}

function handleDrop(event) {
  void attachments.handleDrop(event);
}

function handleFileInputChange(event) {
  void attachments.uploadFiles(event?.target?.files);
  if (event?.target) {
    event.target.value = "";
  }
}

const handleDragEnter = attachments.handleDragEnter;
const handleDragOver = attachments.handleDragOver;
const handleDragLeave = attachments.handleDragLeave;
</script>

<style scoped>
.studio-autopilot-prompt-textarea {
  display: grid;
  gap: 0.45rem;
  position: relative;
  text-align: left;
}

.studio-autopilot-prompt-textarea--dragging {
  outline: 2px dashed rgb(var(--v-theme-primary));
  outline-offset: 4px;
}

.studio-autopilot-prompt-textarea__footer,
.studio-autopilot-prompt-textarea__attachments {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.studio-autopilot-prompt-textarea__hint {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  line-height: 1.3;
}

.studio-autopilot-prompt-textarea__file-input {
  display: none;
}
</style>
