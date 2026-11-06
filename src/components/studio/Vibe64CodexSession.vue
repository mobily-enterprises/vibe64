<template>
  <div
    class="vibe64-codex-session"
    :class="{
      'vibe64-codex-session--compact': displayMode === 'compact',
      'vibe64-codex-session--focused': terminalFocused,
      'vibe64-codex-session--headless': displayMode === 'headless'
    }"
    :aria-hidden="displayMode === 'headless' ? 'true' : undefined"
    @dragenter.prevent="terminalAttachmentsEnabled && handleAttachmentDragEnter($event)"
    @dragover.prevent="terminalAttachmentsEnabled && handleAttachmentDragOver($event)"
    @dragleave.prevent="terminalAttachmentsEnabled && handleAttachmentDragLeave($event)"
    @drop.prevent="terminalAttachmentsEnabled && handleAttachmentDrop($event)"
  >
    <input
      v-if="terminalAttachmentsEnabled"
      ref="terminalAttachmentFileInput"
      :disabled="!attachmentCanAddFiles"
      hidden
      multiple
      type="file"
      @change="handleTerminalAttachmentFileSelection"
    >
    <Vibe64InteractiveTerminal
      :command-preview="terminalCommandPreview"
      :error="terminalError"
      :error-title="terminalErrorTitle"
      fill
      height="100%"
      mobile-takeover
      :presentation="terminalPresentation"
      show-copy
      :show-interrupt="!readOnly"
      :stage="terminalSubtitle"
      :status="terminalStatus"
      :subtitle="terminalSubtitle"
      :terminal="terminalController"
      title="Codex terminal"
      :visible="terminalStreamActive"
      @clean-exit="closeTerminal"
      @close="closeTerminal"
      @copy="handleTerminalCopy"
      @interrupt="handleTerminalInterrupt"
    >
      <template #error-actions>
        <v-btn
          v-if="terminalCanStart"
          :aria-busy="terminalStarting ? 'true' : undefined"
          class="vibe64-codex-session__start-action"
          color="primary"
          :disabled="terminalStarting"
          prepend-icon="$restartAlt"
          size="small"
          variant="flat"
          @click="restartTerminal"
        >
          {{ terminalErrorActionText }}
        </v-btn>
        <v-btn
          size="small"
          variant="tonal"
          @click="closeTerminal"
        >
          Close terminal
        </v-btn>
      </template>

      <template #actions-before>
        <v-btn
          v-if="terminalAttachmentsEnabled"
          :aria-label="terminalAttachmentActionLabel"
          class="vibe64-codex-session__attachment-action"
          :disabled="!attachmentCanAddFiles"
          icon="$attachFile"
          size="small"
          :title="terminalAttachmentActionLabel"
          type="button"
          variant="text"
          @click="openTerminalAttachmentPicker"
        />
      </template>

      <template #overlay>
        <Vibe64AgentTerminalDropOverlay v-if="attachmentDragActive" label="Drop temporary files for Codex" />
        <Vibe64AgentTerminalStartPanel
          v-if="showTerminalStartPanel"
          :action-text="terminalStartButtonText"
          :action-visible="terminalStartActionVisible"
          :icon="terminalStartIcon"
          :message="terminalStartPanelMessage"
          :starting="terminalStarting"
          :title="terminalStartPanelTitle"
          @start="restartTerminal"
        />
      </template>

      <template #before-terminal>
        <Vibe64AttachmentQueue
          :items="attachmentQueueItems"
          :joined="false"
          @cancel="cancelAttachment"
          @remove="removeAttachment"
          @retry="retryAttachment"
        />
      </template>

      <template #footer="{ commandPreview, status }">
        <span class="vibe64-codex-session__command">
          {{ commandPreview || "Codex is not running." }}
        </span>
        <span
          v-if="copyStatus || attachmentStatus"
          class="text-body-small on-surface-variant"
        >
          {{ attachmentStatus || copyStatus }}
        </span>
        <v-chip v-if="status" size="x-small" variant="tonal">
          {{ status }}
        </v-chip>
      </template>
    </Vibe64InteractiveTerminal>
  </div>
</template>

<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import Vibe64InteractiveTerminal from "@/components/studio/Vibe64InteractiveTerminal.vue";
import Vibe64AttachmentQueue from "@/components/studio/vibe64-session/Vibe64AttachmentQueue.vue";
import Vibe64AgentTerminalDropOverlay from "@/components/studio/Vibe64AgentTerminalDropOverlay.vue";
import Vibe64AgentTerminalStartPanel from "@/components/studio/Vibe64AgentTerminalStartPanel.vue";
import { useCodexTerminalSession } from "@/composables/useCodexTerminalSession.js";

const props = defineProps({
  session: {
    type: Object,
    default: null
  },
  visible: {
    type: Boolean,
    default: true
  },
  allowStart: {
    type: Boolean,
    default: true
  },
  displayMode: {
    type: String,
    default: "full"
  },
  readOnly: {
    type: Boolean,
    default: false
  },
  listenWhenHidden: {
    type: Boolean,
    default: false
  }
});
const emit = defineEmits([
  "session-update"
]);

const copyStatus = ref("");
const componentMounted = ref(false);
const terminalAttachmentFileInput = ref(null);

const {
  attachmentCanAddFiles,
  attachmentDragActive,
  attachmentQueueItems,
  attachmentStatus,
  cancelAttachment,
  closeTerminal,
  connectTerminalWhenReady,
  detachTerminal,
  disposeTerminalUi,
  focusWritableTerminalWhenShown,
  handleAttachmentDragEnter,
  handleAttachmentDragLeave,
  handleAttachmentDragOver,
  handleAttachmentDrop,
  handleTerminalInterrupt,
  removeAttachment,
  restartTerminal,
  retryAttachment,
  sendEscape,
  showTerminalStartPanel,
  terminalAttachmentActionLabel,
  terminalAttachmentsEnabled,
  terminalCanStart,
  terminalCommandPreview,
  terminalController,
  terminalDisplayActive,
  terminalError,
  terminalErrorActionText,
  terminalErrorTitle,
  terminalFocused,
  terminalPresentation,
  terminalStartActionVisible,
  terminalStartButtonText,
  terminalStartIcon,
  terminalStartPanelMessage,
  terminalStartPanelTitle,
  terminalStarting,
  terminalStatus,
  terminalStreamActive,
  terminalSubtitle,
  uploadAttachmentFiles
} = useCodexTerminalSession({ props, emit, componentMounted });

function openTerminalAttachmentPicker() {
  if (!terminalAttachmentsEnabled.value || !attachmentCanAddFiles.value) {
    return false;
  }
  terminalAttachmentFileInput.value?.click();
  return true;
}

function handleTerminalAttachmentFileSelection(event) {
  const input = event?.currentTarget || event?.target || null;
  const files = Array.from(input?.files || []);
  if (input) {
    input.value = "";
  }
  if (
    files.length < 1 ||
    !terminalAttachmentsEnabled.value ||
    !attachmentCanAddFiles.value
  ) {
    return;
  }
  void uploadAttachmentFiles(files);
}

function handleTerminalCopy() {
  copyStatus.value = "Terminal text copied.";
}

onMounted(() => {
  componentMounted.value = true;
  connectTerminalWhenReady();
});

onBeforeUnmount(() => {
  componentMounted.value = false;
  detachTerminal();
  disposeTerminalUi();
});

defineExpose({
  focusTerminal: () => focusWritableTerminalWhenShown(terminalDisplayActive.value),
  sendEscape
});

</script>

<style scoped>
.vibe64-codex-session {
  height: 100%;
  min-height: 0;
  min-width: 0;
  position: relative;
}

.vibe64-codex-session--headless {
  height: 0;
  overflow: hidden;
  pointer-events: none;
  position: absolute;
  width: 0;
}

.vibe64-codex-session--focused :deep(.vibe64-terminal-surface) {
  border-color: rgba(var(--v-theme-primary), 0.72);
}

.vibe64-codex-session__command {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-codex-session__attachment-action {
  min-height: 2.5rem;
  min-width: 2.5rem;
}


.vibe64-codex-session__start-action {
  min-inline-size: 10rem;
}

@media (max-width: 700px) {
  .vibe64-codex-session__start-action {
    width: 100%;
  }
}
</style>
