<template>
  <div
    class="vibe64-native-agent-session"
    :class="{ 'vibe64-native-agent-session--headless': displayMode === 'headless' }"
    :aria-hidden="displayMode === 'headless' ? 'true' : undefined"
    @dragenter.prevent="handleAttachmentDragEnter"
    @dragover.prevent="handleAttachmentDragOver"
    @dragleave.prevent="handleAttachmentDragLeave"
    @drop.prevent="handleAttachmentDrop"
    @paste.capture="handleTerminalPaste"
  >
    <input
      v-if="showAttachmentAction"
      ref="attachmentFileInput"
      :disabled="!attachmentCanAddFiles"
      hidden
      multiple
      type="file"
      @change="handleAttachmentSelection"
    >
    <Vibe64InteractiveTerminal
      :command-preview="terminalCommandPreview"
      :error="terminalError"
      :error-title="`${assistantLabel} terminal needs attention`"
      fill
      height="100%"
      :presentation="terminalPresentation"
      :show-interrupt="!readOnly"
      :stage="terminalSubtitle"
      :status="terminalStatus"
      :subtitle="terminalSubtitle"
      :terminal="terminalController"
      :title="`${assistantLabel} terminal`"
      :visible="terminalStreamActive"
      @clean-exit="closeTerminal"
      @close="closeTerminal"
    >
      <template #actions-before>
        <v-btn
          v-if="showAttachmentAction"
          :aria-label="`Attach files to ${assistantLabel} terminal`"
          :disabled="!attachmentCanAddFiles"
          icon="$attachFile"
          size="small"
          :title="`Attach files to ${assistantLabel} terminal`"
          type="button"
          variant="text"
          @click="attachmentFileInput?.click()"
        />
      </template>
      <template #before-terminal>
        <p v-if="session?.assistantSelection?.engineId === 'claude'" class="text-caption px-3 py-2 ma-0">
          Claude resumes this conversation in a new interactive process. Finish or stop any active chat turn first.
          Chat is unavailable while this terminal is open. Claude may ask you to complete its first-use setup or sign in.
        </p>
        <Vibe64AttachmentQueue
          :items="attachmentQueueItems"
          :joined="false"
          :session-id="sessionId"
          @cancel="cancelAttachment"
          @remove="removeAttachment"
          @retry="retryAttachment"
        />
      </template>
      <template #overlay>
        <Vibe64AgentTerminalDropOverlay v-if="attachmentDragActive" :label="`Drop files for ${assistantLabel}`" />
        <Vibe64AgentTerminalStartPanel
          v-if="showStartPanel"
          :action-text="terminalStarting ? `Starting ${assistantLabel}…` : terminalExited ? `Restart ${assistantLabel}` : `Start ${assistantLabel}`"
          :action-visible="!sourcePending"
          :icon="terminalExited ? '$restartAlt' : '$playCircle'"
          :message="sourcePending ? 'The terminal can start after the session source is ready.' : `Start an interactive ${assistantLabel} terminal for this session.`"
          :starting="terminalStarting"
          :title="terminalExited ? `${assistantLabel} terminal exited` : `${assistantLabel} terminal is off`"
          @start="restartTerminal"
        />
      </template>

      <template #footer="{ commandPreview, status }">
        <span class="vibe64-native-agent-session__command">
          {{ commandPreview || `${assistantLabel} is not running.` }}
        </span>
        <span v-if="attachmentStatus" class="text-caption text-medium-emphasis" role="status">
          {{ attachmentStatus }}
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
import Vibe64AttachmentQueue from "@/components/studio/vibe64-session/Vibe64AttachmentQueue.vue";
import Vibe64AgentTerminalDropOverlay from "@/components/studio/Vibe64AgentTerminalDropOverlay.vue";
import Vibe64AgentTerminalStartPanel from "@/components/studio/Vibe64AgentTerminalStartPanel.vue";
import { assistantAttachmentFilesFromPasteEvent } from "@jskit-ai/assistant-core/client/conversation-attachments";
import Vibe64InteractiveTerminal from "@/components/studio/Vibe64InteractiveTerminal.vue";
import { useNativeAgentTerminalSession } from "@/composables/useNativeAgentTerminalSession.js";

const props = defineProps({
  allowStart: {
    default: true,
    type: Boolean
  },
  displayMode: {
    default: "full",
    type: String
  },
  listenWhenHidden: {
    default: false,
    type: Boolean
  },
  readOnly: {
    default: false,
    type: Boolean
  },
  session: {
    default: null,
    type: Object
  },
  visible: {
    default: true,
    type: Boolean
  }
});

const emit = defineEmits(["session-update"]);
const attachmentFileInput = ref(null);
const {
  assistantAcceptsAttachments,
  assistantLabel,
  attachmentCanAddFiles,
  attachmentDragActive,
  attachmentQueueItems,
  attachmentStatus,
  cancelAttachment,
  closeTerminal,
  connectTerminalSocket,
  detachTerminal,
  disposeTerminalUi,
  handleAttachmentDragEnter,
  handleAttachmentDragLeave,
  handleAttachmentDragOver,
  handleAttachmentDrop,
  removeAttachment,
  restartTerminal,
  retryAttachment,
  sessionId,
  showAttachmentAction,
  showStartPanel,
  sourcePending,
  terminalCommandPreview,
  terminalController,
  terminalError,
  terminalExited,
  terminalPresentation,
  terminalSessionId,
  terminalStarting,
  terminalStatus,
  terminalStreamActive,
  terminalSubtitle,
  uploadAttachmentFiles
} = useNativeAgentTerminalSession({ props, emit });

function handleAttachmentSelection(event) {
  const input = event.currentTarget;
  const files = Array.from(input.files || []);
  input.value = "";
  void uploadAttachmentFiles(files);
}

function handleTerminalPaste(event) {
  if (!assistantAcceptsAttachments.value) return;
  const files = assistantAttachmentFilesFromPasteEvent(event);
  if (!files.length) return;
  // Keep file pastes out of xterm, including accompanying clipboard text that
  // could otherwise submit a prompt before its files finish uploading.
  event.preventDefault();
  event.stopPropagation();
  void uploadAttachmentFiles(files);
}

onMounted(() => {
  if (terminalStreamActive.value && terminalSessionId.value) {
    void connectTerminalSocket();
  }
});

onBeforeUnmount(() => {
  detachTerminal();
  disposeTerminalUi();
});
</script>

<style scoped>
.vibe64-native-agent-session {
  block-size: 100%;
  min-block-size: 0;
  min-inline-size: 0;
  position: relative;
}

.vibe64-native-agent-session--headless {
  block-size: 0;
  inline-size: 0;
  overflow: hidden;
  position: absolute;
}

.vibe64-native-agent-session__command {
  color: rgba(var(--v-theme-on-surface), var(--v-medium-emphasis-opacity));
  font-size: 0.82rem;
}
</style>
