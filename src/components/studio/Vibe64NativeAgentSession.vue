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
          :icon="mdiPaperclip"
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
          :icon="terminalExited ? mdiRestart : mdiPlayCircleOutline"
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { mdiPaperclip, mdiPlayCircleOutline, mdiRestart } from "@mdi/js";
import Vibe64AttachmentQueue from "@/components/studio/vibe64-session/Vibe64AttachmentQueue.vue";
import Vibe64AgentTerminalDropOverlay from "@/components/studio/Vibe64AgentTerminalDropOverlay.vue";
import Vibe64AgentTerminalStartPanel from "@/components/studio/Vibe64AgentTerminalStartPanel.vue";
import { useVibe64AgentTerminalDisplay, vibe64ServerAgentTerminal } from "@/composables/useVibe64AgentTerminalDisplay.js";
import { useAgentTerminalAttachments } from "@/composables/useAgentTerminalAttachments.js";
import { useVibe64AttachmentCommands } from "@/composables/useVibe64AttachmentCommands.js";
import { assistantAttachmentFilesFromPasteEvent } from "@jskit-ai/assistant-core/client/conversation-attachments";
import Vibe64InteractiveTerminal from "@/components/studio/Vibe64InteractiveTerminal.vue";
import { useVibe64Terminal } from "@/composables/useVibe64Terminal.js";
import { useVibe64TerminalCommands } from "@/composables/useVibe64TerminalCommands.js";
import { createWebSocketTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import { vibe64AgentTerminalWebSocketUrl } from "@/lib/vibe64SessionApi.js";
import { vibe64TerminalErrorMessage } from "@/lib/vibe64TerminalErrors.js";
import { findVibe64AgentProvider } from "@local/vibe64-runtime/shared";

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
const terminalCommands = useVibe64TerminalCommands();
const attachmentCommands = useVibe64AttachmentCommands();
const attachmentFileInput = ref(null);
const assistantProvider = computed(() => findVibe64AgentProvider(props.session?.assistantSelection?.engineId));
const assistantLabel = computed(() => assistantProvider.value?.label || "");
const assistantAcceptsAttachments = computed(() => assistantProvider.value?.terminalAttachments === true);
const sessionId = computed(() => String(props.session?.sessionId || ""));
const sessionSource = computed(() => String(props.session?.sourcePath || ""));
const serverTerminal = computed(() => vibe64ServerAgentTerminal(props.session));
const serverTerminalId = computed(() => String(
  serverTerminal.value.id || serverTerminal.value.terminalSessionId || ""
));
const {
  displayActive,
  presentation: terminalPresentation,
  streamActive: terminalStreamActive
} = useVibe64AgentTerminalDisplay(props, serverTerminalId);

const terminalController = useVibe64Terminal({
  driver: createWebSocketTerminalDriver({
    closeSession: closeDriverSession,
    webSocketUrl(terminalId) {
      return vibe64AgentTerminalWebSocketUrl(sessionId.value, terminalId);
    }
  }),
  fitOnResize: true,
  initiallyVisible: false,
  liveResize: true,
  onStatusUpdate: emitTerminalState,
  readOnly: computed(() => props.readOnly),
  resizeReportDelayMs: 120
});

const {
  applyTerminalSession,
  closeTerminalSocket,
  connectTerminalSocket,
  disposeTerminalUi,
  focusTerminal,
  resetTerminalDisplay,
  resetTerminalSessionState,
  terminalCommandPreview,
  terminalError,
  terminalExited,
  terminalSessionId,
  terminalStarting,
  terminalStatus
} = terminalController;

const showAttachmentAction = computed(() => Boolean(
  assistantAcceptsAttachments.value && !props.readOnly && displayActive.value
));
const attachmentsEnabled = computed(() => Boolean(
  showAttachmentAction.value && sessionId.value && terminalSessionId.value && terminalStatus.value === "running"
));
const {
  abandonAttachments,
  attachmentCanAddFiles,
  attachmentDragActive,
  attachmentQueueItems,
  attachmentStatus,
  cancelAttachment,
  clearAttachmentStatus,
  handleAttachmentDragEnter,
  handleAttachmentDragLeave,
  handleAttachmentDragOver,
  handleAttachmentDrop,
  removeAttachment,
  retryAttachment,
  uploadAttachmentFiles
} = useAgentTerminalAttachments({
  assistantLabel,
  canUpload: attachmentsEnabled,
  deleteAttachment: attachmentCommands.deleteAttachment,
  ensureTerminalReady: () => attachmentsEnabled.value,
  focusTerminal,
  async sendAttachmentPath(text, attachmentIds, target) {
    const result = await terminalCommands.sendAgentTerminalText(
      target.sessionId, target.terminalSessionId, text, { attachmentIds }
    );
    if (result?.ok === false) {
      throw new Error(vibe64TerminalErrorMessage(result, `The attachment could not be sent to ${assistantLabel.value}.`));
    }
    return true;
  },
  sessionId,
  terminalSessionId,
  uploadAttachment: attachmentCommands.uploadAttachment
});

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

watch(attachmentsEnabled, (enabled) => {
  if (enabled) return;
  void abandonAttachments();
  clearAttachmentStatus();
}, { flush: "sync" });

const sourcePending = computed(() => Boolean(
  displayActive.value && sessionId.value && !sessionSource.value && !terminalSessionId.value
));
const canStart = computed(() => Boolean(
  props.allowStart && displayActive.value && sessionId.value && sessionSource.value
));
const showStartPanel = computed(() => Boolean(
  displayActive.value &&
  !terminalStarting.value &&
  (!terminalSessionId.value || terminalExited.value)
));
const terminalSubtitle = computed(() => {
  if (terminalStarting.value) {
    return `Starting ${assistantLabel.value}`;
  }
  return terminalExited.value ? "Exited" : terminalStatus.value === "running" ? "" : `${assistantLabel.value} agent session`;
});

function emitTerminalState() {
  const id = String(terminalSessionId.value || serverTerminalId.value || "");
  if (!sessionId.value || !id) {
    return;
  }
  emit("session-update", {
    agentTerminalCommandPreview: terminalCommandPreview.value,
    agentTerminalSessionId: id,
    agentTerminalStatus: terminalStatus.value,
    sessionId: sessionId.value
  });
}

async function closeDriverSession(terminalId) {
  const result = await terminalCommands.closeAgentTerminal(sessionId.value, terminalId);
  if (result?.ok === false) {
    throw new Error(vibe64TerminalErrorMessage(result, "OpenCode terminal process could not be stopped."));
  }
  return result;
}

async function attachTerminal(session = {}) {
  const id = String(session.id || session.terminalSessionId || "").trim();
  if (!id || id === terminalSessionId.value) {
    return Boolean(id);
  }
  closeTerminalSocket();
  resetTerminalDisplay();
  await applyTerminalSession({ ...session, id }, {
    fallbackStatus: session.status || "running",
    ownership: "attached"
  });
  if (terminalStreamActive.value) {
    void connectTerminalSocket();
  }
  return true;
}

async function startTerminal() {
  if (!canStart.value) {
    return false;
  }
  if (terminalExited.value) {
    closeTerminalSocket();
    resetTerminalSessionState();
    resetTerminalDisplay();
  }
  terminalStarting.value = true;
  terminalError.value = "";
  try {
    const session = await terminalCommands.startAgentTerminal(sessionId.value);
    if (session?.ok === false || !session?.id) {
      throw new Error(vibe64TerminalErrorMessage(session, `${assistantLabel.value} terminal failed to start.`));
    }
    await applyTerminalSession(session, {
      fallbackStatus: "running",
      ownership: "owned"
    });
    emitTerminalState();
    return await connectTerminalSocket();
  } catch (error) {
    terminalError.value = vibe64TerminalErrorMessage(error, `${assistantLabel.value} terminal failed to start.`);
    return false;
  } finally {
    terminalStarting.value = false;
  }
}

async function closeTerminal() {
  await abandonAttachments();
  if (!terminalSessionId.value) {
    detachTerminal();
    return true;
  }
  if (!(await terminalController.closeTerminal({ deleteSession: true }))) {
    return false;
  }
  resetTerminalDisplay();
  emitTerminalState();
  return true;
}

async function restartTerminal() {
  terminalError.value = "";
  if (terminalSessionId.value && !(await closeTerminal())) {
    return false;
  }
  return startTerminal();
}

function detachTerminal() {
  closeTerminalSocket();
  resetTerminalSessionState();
  resetTerminalDisplay();
}

watch(serverTerminal, (terminal) => {
  void attachTerminal(terminal);
}, {
  flush: "post",
  immediate: true
});

watch(terminalStreamActive, (active) => {
  if (active && terminalSessionId.value) {
    void connectTerminalSocket();
  }
});

watch(sessionId, (_next, previous) => {
  if (previous) {
    detachTerminal();
  }
});

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
