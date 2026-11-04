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
import { useVibe64PromptAttachments } from "@/composables/useVibe64PromptAttachments.js";
import {
  assistantAttachmentFilesFromDropEvent,
  assistantAttachmentFilesFromPasteEvent
} from "@jskit-ai/assistant-core/client/conversation-attachments";
import { AssistantPromptInput } from "@jskit-ai/assistant-core/client/conversation";
import Vibe64AttachmentQueue from "@/components/studio/vibe64-session/Vibe64AttachmentQueue.vue";

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
const {
  attachFileProducer, attachFiles, attachmentState, attachments, attachmentsCanSubmit, clearAttachments, dragActive,
  queueItems, removeUploadedAttachment
} = useVibe64PromptAttachments(props, emit, { queueResizeTextarea, textareaRef });
const canUseFilePicker = computed(() => Boolean(
  attachmentState.value.canAddFiles
));
async function handleFileInputChange(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = "";
  await attachFiles(files);
}

function handleDrop(event) {
  attachments.resetDragState();
  void attachFiles(assistantAttachmentFilesFromDropEvent(event));
}

function openFilePicker() {
  if (!canUseFilePicker.value) {
    return false;
  }
  fileInput.value?.click();
  return true;
}

function focusTextarea(options = { preventScroll: true }) {
  textareaRef.value?.focus(options);
}

const handleDragEnter = attachments.handleDragEnter;
const handleDragOver = attachments.handleDragOver;
const handleDragLeave = attachments.handleDragLeave;
function handlePaste(event) {
  const files = assistantAttachmentFilesFromPasteEvent(event);
  if (!files.length) return attachments.handlePaste(event);
  if (!event.clipboardData?.getData("text/plain")) event.preventDefault();
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
