<template>
  <v-sheet
    rounded="lg"
    class="codex-terminal"
    :class="{
      'codex-terminal--compact': displayMode === 'compact',
      'codex-terminal--desktop-actionless': true,
      'codex-terminal--focused': terminalFocused,
      'codex-terminal--headless': displayMode === 'headless'
    }"
    :aria-hidden="displayMode === 'headless' ? 'true' : undefined"
  >
    <div v-show="displayMode !== 'headless'" class="codex-terminal__content">
      <div class="codex-terminal__bar">
        <div class="codex-terminal__actions">
          <v-btn
            :icon="expanded ? mdiChevronDown : mdiChevronUp"
            class="codex-terminal__collapse"
            size="small"
            variant="text"
            @click="toggleExpanded"
          />
        </div>
      </div>

      <v-expand-transition>
        <div v-show="expanded" class="codex-terminal__body">
          <div
            class="codex-terminal__stage"
            :class="{ 'codex-terminal__stage--dragging': attachmentDragActive }"
            @dragenter.prevent="handleAttachmentDragEnter"
            @dragover.prevent="handleAttachmentDragOver"
            @dragleave.prevent="handleAttachmentDragLeave"
            @drop.prevent="handleAttachmentDrop"
          >
            <StudioErrorNotice
              v-if="terminalError"
              :title="terminalErrorTitle"
              :error="terminalError"
              compact
              overlay
            >
              <template #actions>
                <v-btn
                  v-if="terminalCanStart"
                  color="primary"
                  :loading="terminalStarting"
                  :prepend-icon="mdiRestart"
                  size="small"
                  variant="flat"
                  @click="restartTerminal"
                >
                  {{ terminalErrorActionText }}
                </v-btn>
                <v-btn
                  :prepend-icon="mdiClose"
                  size="small"
                  variant="tonal"
                  @click="closeTerminal"
                >
                  Close terminal
                </v-btn>
              </template>
            </StudioErrorNotice>
            <div
              class="codex-terminal__host"
              @click="focusTerminal"
              @pointerdown.capture="focusTerminal"
            >
              <div ref="terminalHost" class="codex-terminal__mount" />
            </div>
            <div v-if="attachmentDragActive || attachmentUploading" class="codex-terminal__drop-overlay">
              <v-sheet class="codex-terminal__drop-card" rounded="lg" elevation="10">
                <v-icon :icon="mdiPaperclip" size="28" />
                <span>{{ attachmentUploading ? "Uploading temporary file..." : "Drop temporary files for Codex" }}</span>
              </v-sheet>
            </div>
            <div v-if="showTerminalStartPanel" class="codex-terminal__restart-panel">
              <v-sheet class="codex-terminal__restart-card" rounded="lg" elevation="8" role="status">
                <div class="codex-terminal__restart-icon">
                  <v-icon :icon="terminalStartIcon" size="30" />
                </div>
                <div class="codex-terminal__restart-copy">
                  <strong>{{ terminalStartPanelTitle }}</strong>
                  <span>{{ terminalStartPanelMessage }}</span>
                </div>
                <v-btn
                  class="codex-terminal__restart-action"
                  color="primary"
                  :loading="terminalStarting"
                  :prepend-icon="terminalStartButtonIcon"
                  size="default"
                  variant="flat"
                  @click="restartTerminal"
                >
                  {{ terminalStartButtonText }}
                </v-btn>
              </v-sheet>
            </div>
          </div>

          <div class="codex-terminal__footer">
            <span class="codex-terminal__command">{{ terminalCommandPreview }}</span>
            <div class="codex-terminal__footer-actions">
              <v-btn
                :disabled="!terminalSelectedText"
                size="small"
                variant="text"
                @click="copyTerminalSelection"
              >
                Copy
              </v-btn>
              <v-btn
                :disabled="!terminalSessionId || terminalExited"
                size="small"
                variant="text"
                @click="sendCtrlC"
              >
                Ctrl-C
              </v-btn>
              <v-btn
                :disabled="!terminalSessionId"
                size="small"
                variant="text"
                @click="closeTerminal"
              >
                Close
              </v-btn>
            </div>
          </div>

          <p v-if="copyStatus || attachmentStatus" class="text-caption text-medium-emphasis mb-0">
            {{ attachmentStatus || copyStatus }}
          </p>
        </div>
      </v-expand-transition>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiClose,
  mdiPaperclip,
  mdiPlayCircleOutline,
  mdiRestart
} from "@mdi/js";
import {
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useCodexTerminalElement } from "@/composables/useCodexTerminalElement.js";
import {
  vibe64CodexTerminalWebSocketUrl,
  vibe64GlobalCodexTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";
import { useVibe64CodexCommands } from "@/composables/useVibe64CodexCommands.js";
import { useCodexTerminalAttachments } from "@/composables/useCodexTerminalAttachments.js";
import { useCodexTerminalOutput } from "@/composables/useCodexTerminalOutput.js";
import { writeClipboardText } from "@/lib/clipboard.js";
import {
  requestVibe64AccountConnectionsDialog
} from "@/lib/vibe64AccountConnectionsDialog.js";
import {
  codexReconnectRequiredResult,
  codexReconnectRequiredSignature
} from "@/lib/vibe64CodexTerminalAttention.js";
import {
  terminalOwnerAccessDenied,
  vibe64TerminalErrorMessage
} from "@/lib/vibe64TerminalErrors.js";
import {
  vibe64SessionSourcePath
} from "@/lib/vibe64SessionPaths.js";

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
  },
  autoFocus: {
    type: Boolean,
    default: false
  },
  scope: {
    type: String,
    default: "session",
    validator: (value) => ["session", "global"].includes(value)
  },
  terminal: {
    type: Object,
    default: null
  }
});
const emit = defineEmits([
  "activity-change",
  "session-update"
]);
const codexCommands = useVibe64CodexCommands();

const copyStatus = ref("");
const expanded = ref(true);
const componentMounted = ref(false);
const staleTerminalSessionIds = ref(new Set());
let terminalStartPromise = null;

const globalScope = computed(() => props.scope === "global");
const sessionId = computed(() => props.session?.sessionId || "");
const terminalScopeId = computed(() => (globalScope.value ? "global" : sessionId.value));
const sessionSource = computed(() => vibe64SessionSourcePath(props.session || {}));
const terminalDisplayActive = computed(() => props.visible && props.displayMode !== "headless");
const rawServerCodexTerminal = computed(() => {
  if (props.terminal && typeof props.terminal === "object" && !Array.isArray(props.terminal)) {
    return props.terminal;
  }
  const terminal = props.session?.codexTerminal;
  if (terminal && typeof terminal === "object" && !Array.isArray(terminal)) {
    return terminal;
  }
  const presentationTerminal = props.session?.presentation?.terminal?.codex;
  return presentationTerminal && typeof presentationTerminal === "object" && !Array.isArray(presentationTerminal)
    ? presentationTerminal
    : {};
});
const serverCodexTerminal = computed(() => {
  const terminal = rawServerCodexTerminal.value;
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
const hiddenTerminalListenActive = computed(() => Boolean(
  props.listenWhenHidden &&
  serverTerminalSession.value.id &&
  !terminalDisplayActive.value
));
const terminalStreamActive = computed(() => Boolean(
  terminalDisplayActive.value ||
  hiddenTerminalListenActive.value
));
const hasTerminalSession = computed(() => Boolean(
  terminalSessionId.value ||
  serverTerminalSession.value.id
));

const canUseTerminal = computed(() => {
  if (globalScope.value) {
    return Boolean(
      terminalStreamActive.value &&
      terminalScopeId.value &&
      (props.allowStart || serverTerminalSession.value.id)
    );
  }
  return Boolean(
    terminalStreamActive.value &&
    sessionId.value &&
    (
      serverTerminalSession.value.id ||
      (props.allowStart && sessionSource.value)
    )
  );
});
const canStartTerminal = computed(() => {
  if (globalScope.value) {
    return Boolean(props.allowStart && terminalDisplayActive.value && terminalScopeId.value);
  }
  return Boolean(props.allowStart && terminalDisplayActive.value && sessionId.value && sessionSource.value);
});

const {
  appendTerminalOutput: noteTerminalOutputChunk,
  clearCodexBusy,
  clearCodexWorking,
  codexBusy,
  codexWorking,
  markCodexBusy,
  resetTerminalOutput,
  terminalStreaming,
  writeTerminalOutput: noteTerminalOutputSnapshot
} = useCodexTerminalOutput({
  emitBusyChanged: emitCodexActivityChanged,
  sessionId: terminalScopeId
});
const terminalController = useCodexTerminalElement({
  onBeforeTerminalSessionChange: resetTerminalOutput,
  onOutput: handleTerminalOutput,
  onStatusUpdate: handleTerminalStatusUpdate,
  onUserData: handleTerminalUserData,
  readOnly: computed(() => props.readOnly),
  webSocketUrl(terminalId) {
    return webSocketUrlForScope(terminalScopeId.value, terminalId);
  }
});
const {
  applyCodexTerminalSession,
  closeTerminalSocket,
  connectTerminalSocket,
  disposeTerminalUi,
  focusTerminal: focusTerminalUi,
  resetTerminalDisplay,
  resetTerminalSessionState,
  sendTerminalData: sendTerminalBytes,
  setupTerminalUi,
  terminalFocused,
  terminalHost,
  terminalSelectedText,
  terminalCommandPreview,
  terminalError,
  terminalExited,
  terminalSessionId,
  terminalStarting,
  terminalStatus
} = terminalController;
const terminalErrorTitle = computed(() => {
  if (terminalError.value === CODEX_RECONNECT_REQUIRED_MESSAGE) {
    return "Reconnect Codex";
  }
  return String(terminalError.value || "").includes("app-server")
    ? "Codex app-server is not available"
    : "Codex terminal needs attention";
});
const terminalErrorActionText = computed(() => (
  terminalError.value === CODEX_RECONNECT_REQUIRED_MESSAGE ? "Reconnect Codex" : "Restart Codex"
));
const {
  attachmentDragActive,
  attachmentStatus,
  attachmentUploading,
  clearAttachmentStatus,
  handleAttachmentDragEnter,
  handleAttachmentDragLeave,
  handleAttachmentDragOver,
  handleAttachmentDrop,
  resetAttachmentDragState
} = useCodexTerminalAttachments({
  ensureTerminalReady,
  focusTerminal,
  sendTerminalData,
  sessionId: terminalScopeId,
  uploadAttachment: uploadAttachmentForScope
});
const terminalCanStart = computed(() => Boolean(canStartTerminal.value));
const terminalStartIcon = computed(() => terminalExited.value ? mdiRestart : mdiPlayCircleOutline);
const terminalReconnectRequired = computed(() => terminalError.value === CODEX_RECONNECT_REQUIRED_MESSAGE);
const sessionCodexReconnectSignature = computed(() => codexReconnectRequiredSignature(props.session || {}));
const terminalStartButtonIcon = computed(() => {
  if (terminalReconnectRequired.value || terminalExited.value) {
    return mdiRestart;
  }
  return mdiPlayCircleOutline;
});
const terminalStartPanelTitle = computed(() => {
  if (terminalStarting.value) {
    return "Starting Codex";
  }
  if (terminalReconnectRequired.value) {
    return "Reconnect Codex";
  }
  return terminalExited.value ? "Codex terminal exited" : "Codex terminal is off";
});
const terminalStartPanelMessage = computed(() => {
  if (terminalStarting.value) {
    return "Preparing this session terminal.";
  }
  if (terminalReconnectRequired.value) {
    return "Reconnect the Codex account before starting this session terminal.";
  }
  return terminalExited.value ? "Restart it for this session." : "Start it for this session.";
});
const terminalStartButtonText = computed(() => {
  if (terminalStarting.value) {
    return "Starting";
  }
  if (terminalReconnectRequired.value) {
    return "Reconnect Codex";
  }
  return terminalExited.value ? "Restart Codex" : "Start Codex";
});
const showTerminalStartPanel = computed(() => (
  componentMounted.value &&
  (
    (terminalStarting.value && terminalDisplayActive.value) ||
    (
      canUseTerminal.value &&
      terminalCanStart.value &&
      (!terminalSessionId.value || terminalExited.value)
    )
  )
));

function defaultExpanded() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return true;
  }
  return !window.matchMedia("(max-width: 700px)").matches;
}

async function copyText(value, label) {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  try {
    await writeClipboardText(text);
    copyStatus.value = `${label} copied.`;
    return true;
  } catch (copyError) {
    copyStatus.value = String(copyError?.message || copyError || "Copy failed.");
    return false;
  }
}

async function copyTerminalSelection() {
  await copyText(terminalSelectedText.value, "Selection");
}

function ensureTerminalReady() {
  if (!canUseTerminal.value) {
    if (terminalCanStart.value) {
      terminalError.value = "Create the session clone before starting Codex.";
    }
    return Promise.resolve(false);
  }
  if (terminalStartPromise) {
    return terminalStartPromise;
  }
  terminalStartPromise = startTerminalOnce();
  return terminalStartPromise.finally(() => {
    terminalStartPromise = null;
  });
}

function emitCodexActivityChanged(payload = {}) {
  const busy = Object.hasOwn(payload, "busy") ? Boolean(payload.busy) : Boolean(codexBusy.value);
  const working = Object.hasOwn(payload, "working") ? Boolean(payload.working) : Boolean(codexWorking.value);
  const streaming = Object.hasOwn(payload, "streaming") ? Boolean(payload.streaming) : Boolean(terminalStreaming.value);
  emit("activity-change", {
    active: Boolean(streaming),
    busy,
    scope: props.scope,
    sessionId: String(payload.sessionId || terminalScopeId.value || ""),
    streaming,
    terminalSessionId: terminalSessionId.value || serverTerminalSession.value.id || "",
    working
  });
}

function emitTerminalSessionState(extra = {}) {
  const currentTerminalId = String(extra.codexTerminalSessionId || terminalSessionId.value || "");
  if (!terminalScopeId.value || !currentTerminalId) {
    return;
  }
  emit("session-update", {
    codexTerminalCommandPreview: terminalCommandPreview.value,
    codexTerminalSessionId: currentTerminalId,
    codexTerminalStatus: terminalStatus.value,
    sessionId: terminalScopeId.value,
    ...extra
  });
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

function startTerminalSessionForScope(currentScopeId) {
  return globalScope.value
    ? codexCommands.startGlobalCodexTerminal()
    : codexCommands.startCodexTerminal(currentScopeId);
}

function closeTerminalSessionForScope(currentScopeId, terminalId) {
  return globalScope.value
    ? codexCommands.closeGlobalCodexTerminal(currentScopeId, terminalId)
    : codexCommands.closeCodexTerminal(currentScopeId, terminalId);
}

function webSocketUrlForScope(currentScopeId, terminalId) {
  return globalScope.value
    ? vibe64GlobalCodexTerminalWebSocketUrl(currentScopeId, terminalId)
    : vibe64CodexTerminalWebSocketUrl(currentScopeId, terminalId);
}

function openCodexReconnectDialog() {
  requestVibe64AccountConnectionsDialog({
    codexReconnectRequired: true,
    providerId: "codex",
    refresh: false
  });
}

async function uploadAttachmentForScope(currentScopeId, file) {
  if (globalScope.value) {
    throw new Error("Temporary attachments are available in session Codex terminals.");
  }
  return codexCommands.uploadAttachment(currentScopeId, file);
}

async function sendTerminalData(data, {
  source = "program"
} = {}) {
  const input = String(data || "");
  try {
    if (!(await ensureTerminalReady())) {
      return false;
    }
    if (!(await sendTerminalBytes(input))) {
      return false;
    }
    if (source === "user" && input.includes("\u0003")) {
      clearCodexBusy();
      clearCodexWorking();
    } else if (source === "user" && input.includes("\r")) {
      markCodexBusy();
    }
    return true;
  } catch (sendError) {
    terminalError.value = String(sendError?.message || sendError || "Terminal input failed.");
    return false;
  }
}

async function sendCtrlC() {
  await sendTerminalData("\u0003", {
    source: "user"
  });
}

async function sendEscape() {
  return sendTerminalData("\u001b", {
    source: "user"
  });
}

function toggleExpanded() {
  expanded.value = !expanded.value;
  if (expanded.value && hasTerminalSession.value) {
    void connectAttachedTerminal().catch((error) => {
      terminalError.value = terminalError.value || String(error?.message || error || "Terminal stream failed to connect.");
    });
  }
}

async function focusTerminal() {
  if (!hasTerminalSession.value) {
    return false;
  }
  if (!expanded.value) {
    expanded.value = true;
    await nextTick();
  }
  return focusTerminalUi();
}

async function focusWritableTerminalWhenShown(visible) {
  if (!visible || props.readOnly || !hasTerminalSession.value) {
    return;
  }
  await nextTick();
  if (await setupTerminalUi()) {
    focusTerminal();
    for (const delayMs of [50, 150, 300]) {
      globalThis.setTimeout(() => {
        if (terminalDisplayActive.value && props.autoFocus && !props.readOnly && !terminalFocused.value) {
          focusTerminal();
        }
      }, delayMs);
    }
  }
}

async function connectAttachedTerminal() {
  await setupTerminalUi();
  if (!(await connectTerminalSocket())) {
    const message = String(terminalError.value || "Terminal stream failed to connect.");
    if (terminalSessionMissingError(message) || terminalOwnerAccessDenied(message)) {
      markTerminalSessionStale(terminalSessionId.value || serverTerminalSession.value.id, message);
      return false;
    }
    throw new Error(message);
  }
  return true;
}

async function startTerminalOnce() {
  if (terminalReconnectRequired.value) {
    openCodexReconnectDialog();
    return false;
  }
  if (terminalExited.value && terminalCanStart.value) {
    closeTerminalSocket();
    resetTerminalSessionState();
    resetTerminalDisplay();
    resetTerminalOutput();
  }
  if (terminalSessionId.value) {
    return await connectAttachedTerminal();
  }
  if (!terminalCanStart.value) {
    return false;
  }

  terminalStarting.value = true;
  terminalError.value = "";
  try {
    if (!(await setupTerminalUi())) {
      throw new Error(terminalError.value || "Terminal UI failed to initialize.");
    }
    const session = await startTerminalSessionForScope(terminalScopeId.value);
    if (session?.ok === false) {
      if (codexReconnectRequiredResult(session)) {
        terminalError.value = CODEX_RECONNECT_REQUIRED_MESSAGE;
        openCodexReconnectDialog();
        return false;
      }
      if (terminalOwnerAccessDenied(session)) {
        const message = vibe64TerminalErrorMessage(session, "Codex terminal failed to start.");
        markTerminalSessionStale(serverTerminalSession.value.id, message);
        terminalError.value = message;
        return false;
      }
      throw new Error(vibe64TerminalErrorMessage(session, "Codex terminal failed to start."));
    }
    if (!session?.id) {
      throw new Error("Codex terminal failed to start.");
    }
    applyCodexTerminalSession(session, {
      fallbackStatus: "running"
    });
    emitTerminalSessionState();
    return await connectAttachedTerminal();
  } catch (startError) {
    terminalError.value = terminalError.value || vibe64TerminalErrorMessage(startError, "Codex terminal failed to start.");
    return false;
  } finally {
    terminalStarting.value = false;
  }
}

function connectTerminalWhenReady() {
  if (!canUseTerminal.value || !terminalSessionId.value) {
    return;
  }
  void connectAttachedTerminal().catch((error) => {
    terminalError.value = terminalError.value || String(error?.message || error || "Terminal stream failed to connect.");
  });
}

async function attachTerminalSession(session = {}) {
  const attached = applyCodexTerminalSession(session, {
    fallbackStatus: "running"
  });
  if (!attached.applied) {
    return Boolean(terminalSessionId.value);
  }
  if (attached.sameTerminalSession) {
    return true;
  }
  if (!canUseTerminal.value || !componentMounted.value) {
    return true;
  }
  try {
    return await connectAttachedTerminal();
  } catch (attachError) {
    const message = String(attachError?.message || attachError || "Terminal stream failed to connect.");
    if (terminalOwnerAccessDenied(message)) {
      markTerminalSessionStale(session.id || terminalSessionId.value || serverTerminalSession.value.id, message);
      terminalError.value = message;
      return false;
    }
    terminalError.value = terminalError.value || message;
    return false;
  }
}

function terminalSessionMissingError(message = "") {
  return /terminal session not found/iu.test(String(message || ""));
}

function markTerminalSessionStale(terminalId = "", message = "") {
  const normalizedTerminalId = String(terminalId || "").trim();
  if (normalizedTerminalId) {
    staleTerminalSessionIds.value = new Set([
      ...staleTerminalSessionIds.value,
      normalizedTerminalId
    ]);
  }
  closeTerminalSocket();
  resetTerminalSessionState();
  resetTerminalDisplay();
  resetTerminalOutput();
  terminalError.value = String(message || "");
  emitTerminalSessionState({
    codexTerminalSessionId: normalizedTerminalId,
    codexTerminalStatus: "stale"
  });
}

function detachTerminal() {
  terminalStartPromise = null;
  closeTerminalSocket();
  resetTerminalSessionState();
  resetTerminalDisplay();
  resetTerminalOutput();
  clearAttachmentStatus();
  resetAttachmentDragState();
}

async function closeTerminal() {
  const existingTerminalId = terminalSessionId.value;
  detachTerminal();
  if (existingTerminalId && terminalScopeId.value) {
    await closeTerminalSessionForScope(terminalScopeId.value, existingTerminalId).catch(() => null);
  }
}

async function restartTerminal() {
  if (terminalReconnectRequired.value) {
    openCodexReconnectDialog();
    return;
  }
  terminalError.value = "";
  expanded.value = true;
  await closeTerminal();
  await ensureTerminalReady();
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
  expanded.value = defaultExpanded();
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
  openCodexReconnectDialog();
}, {
  flush: "post",
  immediate: true
});

watch(terminalDisplayActive, (visible, previousVisible) => {
  if (visible && (previousVisible === false || props.autoFocus)) {
    void focusWritableTerminalWhenShown(visible);
  }
}, {
  flush: "post",
  immediate: true
});

watch(terminalHost, (host) => {
  if (host && terminalDisplayActive.value && props.autoFocus && !props.readOnly) {
    void focusWritableTerminalWhenShown(true);
  }
  if (host && hasTerminalSession.value) {
    void setupTerminalUi();
    connectTerminalWhenReady();
  }
}, {
  flush: "post"
});

onMounted(() => {
  componentMounted.value = true;
  expanded.value = defaultExpanded();
});

onBeforeUnmount(() => {
  componentMounted.value = false;
  terminalStartPromise = null;
  closeTerminalSocket();
  disposeTerminalUi();
  resetTerminalOutput();
});

defineExpose({
  focusTerminal: () => focusWritableTerminalWhenShown(terminalDisplayActive.value),
  sendEscape
});

</script>

<style scoped>
.codex-terminal {
  min-width: 0;
  padding: 0.25rem 0 0;
}

.codex-terminal--headless {
  height: 0;
  min-height: 0;
  opacity: 0;
  overflow: hidden;
  padding: 0;
  pointer-events: none;
  position: absolute;
  width: 0;
}

.codex-terminal--compact {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  padding: 0;
}

.codex-terminal--compact .codex-terminal__content {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
}

.codex-terminal--compact .codex-terminal__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
  padding-top: 0;
}

.codex-terminal--compact .codex-terminal__bar,
.codex-terminal--compact .codex-terminal__footer,
.codex-terminal--compact .text-caption {
  display: none;
}

.codex-terminal--compact .codex-terminal__stage {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.codex-terminal--compact .codex-terminal__host {
  height: 100%;
  min-height: 0;
}

.codex-terminal--compact .codex-terminal__mount {
  height: 100%;
  min-height: 0;
}

.codex-terminal--focused .codex-terminal__host {
  border-color: #4ea1ff;
  box-shadow:
    0 0 0 3px rgba(78, 161, 255, 0.95),
    0 0 0 9px rgba(78, 161, 255, 0.22),
    0 0 36px rgba(78, 161, 255, 0.58),
    inset 0 0 0 1px rgba(255, 255, 255, 0.16);
}

.codex-terminal__bar,
.codex-terminal__footer {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  min-width: 0;
}

.codex-terminal__bar {
  justify-content: flex-end;
}

.codex-terminal__footer {
  justify-content: space-between;
}

.codex-terminal__actions,
.codex-terminal__footer-actions {
  align-items: center;
  display: flex;
  gap: 0.4rem;
  min-width: 0;
}

.codex-terminal__body {
  padding-top: 0.5rem;
}

.codex-terminal__host {
  background: #101216;
  border: 2px solid rgba(var(--v-theme-outline), 0.38);
  border-radius: 6px;
  height: clamp(37rem, 72vh, 56rem);
  overflow: hidden;
  padding: 0.35rem;
  transition: border-color 140ms ease, box-shadow 140ms ease;
}

.codex-terminal__mount {
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.codex-terminal__mount :deep(.xterm) {
  text-align: left;
}

.codex-terminal__stage {
  position: relative;
}

.codex-terminal__stage--dragging .codex-terminal__host {
  border-color: rgb(var(--v-theme-primary));
  box-shadow:
    0 0 0 3px rgba(var(--v-theme-primary), 0.3),
    0 0 28px rgba(var(--v-theme-primary), 0.38);
}

.codex-terminal__drop-overlay {
  align-items: center;
  background: rgba(10, 12, 16, 0.48);
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 1rem;
  pointer-events: none;
  position: absolute;
}

.codex-terminal__drop-card {
  align-items: center;
  background: rgba(var(--v-theme-surface), 0.96);
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  font-weight: 650;
  gap: 0.75rem;
  padding: 0.85rem 1rem;
}

.codex-terminal__restart-panel {
  align-items: center;
  background:
    linear-gradient(180deg, rgba(16, 18, 22, 0.18), rgba(16, 18, 22, 0.62));
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 1.25rem;
  pointer-events: none;
  position: absolute;
}

.codex-terminal__restart-card {
  align-items: center;
  background: rgba(var(--v-theme-surface), 0.96);
  border: 1px solid rgba(var(--v-theme-primary), 0.32);
  display: grid;
  gap: 0.9rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  max-width: min(42rem, calc(100% - 1rem));
  min-width: min(30rem, calc(100% - 1rem));
  padding: 1rem;
  pointer-events: auto;
}

.codex-terminal__restart-icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.12);
  border: 1px solid rgba(var(--v-theme-primary), 0.22);
  border-radius: 8px;
  color: rgb(var(--v-theme-primary));
  display: flex;
  height: 3rem;
  justify-content: center;
  width: 3rem;
}

.codex-terminal__restart-copy {
  display: flex;
  flex-direction: column;
  gap: 0.18rem;
  min-width: 0;
}

.codex-terminal__restart-copy strong {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.2;
}

.codex-terminal__restart-copy span {
  color: rgba(var(--v-theme-on-surface), 0.7);
  font-size: 0.88rem;
  line-height: 1.3;
}

.codex-terminal__restart-action {
  justify-self: end;
  white-space: nowrap;
}

.codex-terminal__footer {
  padding-top: 0.35rem;
}

.codex-terminal__command {
  color: rgb(var(--v-theme-on-surface-variant));
  flex: 1 1 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.72rem;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .codex-terminal__bar,
  .codex-terminal__footer {
    align-items: stretch;
    flex-direction: column;
  }

  .codex-terminal__actions,
  .codex-terminal__footer-actions {
    justify-content: flex-start;
    overflow-x: auto;
  }

  .codex-terminal__host {
    height: min(74vh, 44rem);
  }

  .codex-terminal__restart-card {
    align-items: stretch;
    grid-template-columns: auto minmax(0, 1fr);
    min-width: min(18rem, calc(100% - 1rem));
  }

  .codex-terminal__restart-action {
    grid-column: 1 / -1;
    justify-self: stretch;
  }
}

@media (min-width: 981px) {
  .codex-terminal {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow: hidden;
  }

  .codex-terminal__content {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .codex-terminal__body {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
    overflow: hidden;
  }

  .codex-terminal__stage {
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .codex-terminal__host {
    height: 100%;
    min-height: 0;
  }

  .codex-terminal__mount {
    height: 100%;
    min-height: 0;
  }
}

@media (min-width: 701px) {
  .codex-terminal__collapse {
    display: none;
  }

  .codex-terminal--desktop-actionless .codex-terminal__bar {
    display: none;
  }

  .codex-terminal--desktop-actionless .codex-terminal__body {
    padding-top: 0;
  }
}
</style>
