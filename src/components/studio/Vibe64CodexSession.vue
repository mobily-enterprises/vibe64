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
          :prepend-icon="mdiRestart"
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
          :icon="mdiPaperclip"
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
          class="text-caption text-medium-emphasis"
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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { mdiPaperclip, mdiRestart } from "@mdi/js";
import {
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";
import Vibe64InteractiveTerminal from "@/components/studio/Vibe64InteractiveTerminal.vue";
import Vibe64AttachmentQueue from "@/components/studio/vibe64-session/Vibe64AttachmentQueue.vue";
import Vibe64AgentTerminalDropOverlay from "@/components/studio/Vibe64AgentTerminalDropOverlay.vue";
import Vibe64AgentTerminalStartPanel from "@/components/studio/Vibe64AgentTerminalStartPanel.vue";
import { useVibe64AgentTerminalDisplay, vibe64ServerAgentTerminal } from "@/composables/useVibe64AgentTerminalDisplay.js";
import { useVibe64Terminal } from "@/composables/useVibe64Terminal.js";
import {
  vibe64AgentTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";
import { useVibe64CodexCommands } from "@/composables/useVibe64CodexCommands.js";
import { useCodexTerminalLifecycle } from "@/composables/useCodexTerminalLifecycle.js";
import { useCodexTerminalOutput } from "@/composables/useCodexTerminalOutput.js";
import { useCodexTerminalPresentation } from "@/composables/useCodexTerminalPresentation.js";
import { createWebSocketTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
import {
  codexReconnectRequiredSignature
} from "@/lib/vibe64CodexTerminalAttention.js";
import {
  vibe64TerminalErrorMessage
} from "@/lib/vibe64TerminalErrors.js";

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
const codexCommands = useVibe64CodexCommands();

const copyStatus = ref("");
const componentMounted = ref(false);
const terminalAttachmentFileInput = ref(null);
const staleTerminalSessionIds = ref(new Set());

const sessionId = computed(() => props.session?.sessionId || "");
const terminalAttachmentsEnabled = computed(() => Boolean(
  !props.readOnly &&
  sessionId.value
));
const sessionSource = computed(() => String(props.session?.sourcePath || ""));
const rawServerCodexTerminal = computed(() => vibe64ServerAgentTerminal(props.session));
const serverCodexTerminal = computed(() => {
  const terminal = rawServerCodexTerminal.value;
  if (terminal.stale || terminal.restartRequired) {
    return {
      ...terminal,
      id: "",
      terminalSessionId: "",
      status: "stale"
    };
  }
  const terminalId = String(terminal.id || terminal.terminalSessionId || "").trim();
  if (!terminalId || !staleTerminalSessionIds.value.has(terminalId)) {
    return terminal;
  }
  return {
    ...terminal,
    id: "",
    terminalSessionId: "",
    status: ""
  };
});
const serverTerminalSession = computed(() => ({
  commandPreview: String(serverCodexTerminal.value.commandPreview || ""),
  id: String(serverCodexTerminal.value.id || serverCodexTerminal.value.terminalSessionId || ""),
  status: String(serverCodexTerminal.value.status || "")
}));
const {
  displayActive: terminalDisplayActive,
  presentation: terminalPresentation,
  streamActive: terminalStreamActive
} = useVibe64AgentTerminalDisplay(props, computed(() => serverTerminalSession.value.id));
const hasTerminalSession = computed(() => Boolean(
  terminalSessionId.value ||
  serverTerminalSession.value.id
));

const canUseTerminal = computed(() => Boolean(
  terminalStreamActive.value &&
  sessionId.value &&
  (
    serverTerminalSession.value.id ||
    (props.allowStart && sessionSource.value)
  )
));
const canStartTerminal = computed(() => Boolean(
  props.allowStart &&
  terminalDisplayActive.value &&
  sessionId.value &&
  sessionSource.value
));

const {
  appendTerminalOutput: noteTerminalOutputChunk,
  clearCodexBusy,
  clearCodexWorking,
  markCodexBusy,
  resetTerminalOutput,
  writeTerminalOutput: noteTerminalOutputSnapshot
} = useCodexTerminalOutput();
const terminalController = useVibe64Terminal({
  driver: createWebSocketTerminalDriver({
    closeSession: closeCodexTerminalDriverSession,
    webSocketUrl(terminalId) {
      return vibe64AgentTerminalWebSocketUrl(sessionId.value, terminalId);
    }
  }),
  fitOnResize: true,
  initiallyVisible: false,
  liveResize: true,
  onOutput: handleTerminalOutput,
  onStatusUpdate: handleTerminalStatusUpdate,
  onUserData: handleTerminalUserData,
  readOnly: computed(() => props.readOnly),
  resizeReportDelayMs: 120
});
const {
  disposeTerminalUi,
  terminalFocused,
  terminalCommandPreview,
  terminalError,
  terminalSessionId,
  terminalStarting,
  terminalStatus
} = terminalController;

const terminalCanStart = computed(() => Boolean(canStartTerminal.value));
const sessionSourcePending = computed(() => Boolean(
  terminalDisplayActive.value &&
  sessionId.value &&
  !sessionSource.value &&
  !hasTerminalSession.value
));
const terminalServerStale = computed(() => Boolean(serverCodexTerminal.value.stale || serverCodexTerminal.value.restartRequired));
const terminalReconnectRequired = computed(() => terminalError.value === CODEX_RECONNECT_REQUIRED_MESSAGE);
const sessionCodexReconnectSignature = computed(() => codexReconnectRequiredSignature(props.session || {}));
const {
  showTerminalStartPanel,
  terminalErrorActionText,
  terminalErrorTitle,
  terminalStartActionVisible,
  terminalStartButtonText,
  terminalStartIcon,
  terminalStartPanelMessage,
  terminalStartPanelTitle,
  terminalSubtitle
} = useCodexTerminalPresentation({
  terminalController,
  serverCodexTerminal,
  sessionSourcePending,
  terminalReconnectRequired,
  terminalServerStale,
  terminalDisplayActive,
  canUseTerminal,
  terminalCanStart,
  componentMounted
});
const {
  attachments,
  attachTerminalSession,
  closeTerminal,
  connectTerminalWhenReady,
  detachTerminal,
  emitTerminalSessionState,
  focusWritableTerminalWhenShown,
  restartTerminal,
  sendEscape
} = useCodexTerminalLifecycle({
  props,
  emit,
  codexCommands,
  terminalController,
  resetTerminalOutput,
  sessionId,
  serverTerminalSession,
  staleTerminalSessionIds,
  canUseTerminal,
  terminalCanStart,
  hasTerminalSession,
  terminalReconnectRequired,
  terminalAttachmentsEnabled,
  componentMounted
});
const {
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
  resetAttachmentDragState,
  uploadAttachmentFiles
} = attachments;
const terminalAttachmentActionLabel = computed(() => (
  attachmentCanAddFiles.value
    ? "Attach files to Codex terminal"
    : "Codex terminal attachment limit reached"
));

function openTerminalAttachmentPicker() {
  if (!terminalAttachmentsEnabled.value || !attachmentCanAddFiles.value) {
    return false;
  }
  terminalAttachmentFileInput.value?.click?.();
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

function handleTerminalInterrupt() {
  clearCodexBusy();
  clearCodexWorking();
}

function handleTerminalOutput({
  chunk = "",
  output = "",
  source = ""
} = {}) {
  if (source === "append") {
    noteTerminalOutputChunk(chunk);
    return;
  }
  noteTerminalOutputSnapshot(output);
}

function handleTerminalStatusUpdate({
  closeError = "",
  status = ""
} = {}) {
  if (closeError) {
    terminalError.value = String(closeError);
  }
  emitTerminalSessionState();
  if (status === "exited") {
    clearCodexBusy();
    clearCodexWorking();
  }
}

function handleTerminalUserData(data) {
  const input = String(data || "");
  if (input.includes("\u0003")) {
    clearCodexBusy();
    clearCodexWorking();
    return;
  }
  if (input.includes("\r")) {
    markCodexBusy();
  }
}

async function closeCodexTerminalDriverSession(terminalId) {
  const result = await codexCommands.closeAgentTerminal(sessionId.value, terminalId);
  if (result?.ok === false) {
    throw new Error(vibe64TerminalErrorMessage(result, "Codex terminal process could not be stopped."));
  }
  return result;
}

watch(serverTerminalSession, (terminal) => {
  void attachTerminalSession(terminal);
}, {
  flush: "post",
  immediate: true
});

watch(sessionId, (nextSessionId, previousSessionId) => {
  if (previousSessionId && previousSessionId !== nextSessionId) {
    detachTerminal();
  }
  staleTerminalSessionIds.value = new Set();
  resetAttachmentDragState();
  clearAttachmentStatus();
});

watch(canUseTerminal, (ready) => {
  if (ready && terminalSessionId.value) {
    connectTerminalWhenReady();
  }
});

watch([
  sessionCodexReconnectSignature,
  componentMounted,
  () => props.displayMode
], ([signature, mounted, displayMode]) => {
  if (!signature || !mounted || displayMode === "headless") {
    return;
  }
  terminalError.value = CODEX_RECONNECT_REQUIRED_MESSAGE;
}, {
  flush: "post",
  immediate: true
});

watch(terminalDisplayActive, (visible, previousVisible) => {
  if (visible && previousVisible === false) {
    void focusWritableTerminalWhenShown(visible);
  }
}, {
  flush: "post",
  immediate: true
});

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

@media (pointer: coarse) {
  .vibe64-codex-session__attachment-action {
    min-height: 3rem;
    min-width: 3rem;
  }
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
