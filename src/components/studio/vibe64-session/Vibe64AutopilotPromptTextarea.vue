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
      hide-details="auto"
      :hint="hint"
      :label="label"
      :persistent-hint="persistentHint"
      :rows="rows"
      :variant="variant"
      @update:model-value="$emit('update:modelValue', String($event || ''))"
    />

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
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiPaperclip
} from "@mdi/js";
import {
  useVibe64CodexCommands
} from "@/composables/useVibe64CodexCommands.js";
import {
  useCodexAttachments
} from "@/composables/useCodexAttachments.js";
import {
  appendPromptAttachmentReferences
} from "@/lib/vibe64PromptAttachments.js";

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

const { uploadAttachment } = useVibe64CodexCommands();
const attachments = useCodexAttachments({
  canUpload: () => !props.disabled,
  onUploaded: async (uploaded = []) => {
    updatePromptWithAttachments(uploaded);
  },
  sessionId: computed(() => props.sessionId),
  uploadAttachment
});
const dragActive = attachments.dragActive;
const uploadedAttachments = attachments.attachments;
const combinedErrorMessages = computed(() => {
  const parentMessages = Array.isArray(props.errorMessages)
    ? props.errorMessages
    : [props.errorMessages].filter(Boolean);
  return attachments.status.value
    ? [...parentMessages, attachments.status.value]
    : parentMessages;
});

function updatePromptWithAttachments(uploadedAttachments = []) {
  emit(
    "update:modelValue",
    appendPromptAttachmentReferences(props.modelValue, uploadedAttachments)
  );
}

function handleDrop(event) {
  void attachments.handleDrop(event);
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

.studio-autopilot-prompt-textarea__attachments {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}
</style>
