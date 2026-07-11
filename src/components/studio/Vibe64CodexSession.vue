<template>
  <div
    class="vibe64-codex-session"
    :class="{
      'vibe64-codex-session--compact': displayMode === 'compact',
      'vibe64-codex-session--focused': terminalFocused,
      'vibe64-codex-session--headless': displayMode === 'headless'
    }"
    :aria-hidden="displayMode === 'headless' ? 'true' : undefined"
    @dragenter.prevent="handleAttachmentDragEnter"
    @dragover.prevent="handleAttachmentDragOver"
    @dragleave.prevent="handleAttachmentDragLeave"
    @drop.prevent="handleAttachmentDrop"
  >
    <Vibe64Terminal
      :collapsible="displayMode !== 'headless'"
      :command-preview="terminalCommandPreview"
      :error="terminalError"
      :error-title="terminalErrorTitle"
      :expanded="expanded"
      fill
      height="100%"
      :presentation="terminalPresentation"
      show-copy
      :show-interrupt="!readOnly"
      :status="terminalStatus"
      :subtitle="terminalSubtitle"
      :terminal="terminalController"
      title="Codex terminal"
      :visible="terminalStreamActive"
      @close="closeTerminal"
      @copy="handleTerminalCopy"
      @interrupt="handleTerminalInterrupt"
      @update:expanded="updateTerminalExpanded"
    >
      <template #error-actions>
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
          size="small"
          variant="tonal"
          @click="closeTerminal"
        >
          Close terminal
        </v-btn>
      </template>

      <template #overlay>
        <div
          v-if="attachmentDragActive || attachmentUploading"
          class="vibe64-codex-session__drop-overlay"
        >
          <v-sheet class="vibe64-codex-session__drop-card" rounded="lg" elevation="10">
            <v-icon :icon="mdiPaperclip" size="28" />
            <span>{{ attachmentUploading ? "Uploading temporary file..." : "Drop temporary files for Codex" }}</span>
          </v-sheet>
        </div>

        <div v-if="showTerminalStartPanel" class="vibe64-codex-session__start-panel">
          <v-sheet class="vibe64-codex-session__start-card" rounded="lg" elevation="8" role="status">
            <div class="vibe64-codex-session__start-icon">
              <v-icon :icon="terminalStartIcon" size="30" />
            </div>
            <div class="vibe64-codex-session__start-copy">
              <strong>{{ terminalStartPanelTitle }}</strong>
              <span>{{ terminalStartPanelMessage }}</span>
            </div>
            <v-btn
              v-if="terminalStartActionVisible"
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
    </Vibe64Terminal>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import {
  mdiPaperclip,
  mdiPlayCircleOutline,
  mdiRestart
} from "@mdi/js";
import {
  CODEX_RECONNECT_REQUIRED_MESSAGE
} from "@local/vibe64-core/shared";
import {
  VIBE64_ACCOUNTS_CHANGED_EVENT
} from "@local/vibe64-accounts/client";
import Vibe64Terminal from "@/components/studio/Vibe64Terminal.vue";
import { useVibe64Terminal } from "@/composables/useVibe64Terminal.js";
import {
  vibe64AgentTerminalWebSocketUrl,
  vibe64GlobalCodexTerminalWebSocketUrl
} from "@/lib/vibe64SessionApi.js";
import { useVibe64CodexCommands } from "@/composables/useVibe64CodexCommands.js";
import { useCodexTerminalAttachments } from "@/composables/useCodexTerminalAttachments.js";
import { useCodexTerminalOutput } from "@/composables/useCodexTerminalOutput.js";
import { createWebSocketTerminalDriver } from "@/lib/vibe64TerminalDriver.js";
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
  const terminal = props.session?.agentSession?.terminal;
  if (terminal && typeof terminal === "object" && !Array.isArray(terminal)) {
    return terminal;
  }
  const presentationTerminal = props.session?.presentation?.terminal?.agent;
  return presentationTerminal && typeof presentationTerminal === "object" && !Array.isArray(presentationTerminal)
    ? presentationTerminal
    : {};
});
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
const hiddenTerminalListenActive = computed(() => Boolean(
  props.listenWhenHidden &&
  serverTerminalSession.value.id &&
  !terminalDisplayActive.value
));
const terminalStreamActive = computed(() => Boolean(
  terminalDisplayActive.value ||
  hiddenTerminalListenActive.value
));
const terminalPresentation = computed(() => (
  terminalDisplayActive.value ? "inline" : "headless"
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
const terminalController = useVibe64Terminal({
  driver: createWebSocketTerminalDriver({
    closeSession: closeCodexTerminalDriverSession,
    webSocketUrl(terminalId) {
      return webSocketUrlForScope(terminalScopeId.value, terminalId);
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
  closeTerminalSocket,
  connectTerminalSocket,
  disposeTerminalUi,
  focusTerminal: focusTerminalUi,
  resetTerminalDisplay,
  resetTerminalSessionState,
    sendTerminalData: sendTerminalBytes,
  terminalFocused,
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
const terminalSubtitle = computed(() => {
  if (terminalStarting.value) {
    return "Starting Codex";
  }
  if (terminalExited.value) {
    return "Codex exited";
  }
  return terminalStatus.value === "running" ? "Codex is running" : "Codex agent session";
});
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
const sessionSourcePending = computed(() => Boolean(
  !globalScope.value &&
  terminalDisplayActive.value &&
  sessionId.value &&
  !sessionSource.value &&
  !hasTerminalSession.value
));
const terminalStartActionVisible = computed(() => !sessionSourcePending.value);
const terminalServerStale = computed(() => Boolean(serverCodexTerminal.value.stale || serverCodexTerminal.value.restartRequired));
const terminalStartIcon = computed(() => (terminalExited.value || terminalServerStale.value) ? mdiRestart : mdiPlayCircleOutline);
const terminalReconnectRequired = computed(() => terminalError.value === CODEX_RECONNECT_REQUIRED_MESSAGE);
const sessionCodexReconnectSignature = computed(() => codexReconnectRequiredSignature(props.session || {}));
const terminalStartButtonIcon = computed(() => {
  if (terminalReconnectRequired.value || terminalExited.value || terminalServerStale.value) {
    return mdiRestart;
  }
  return mdiPlayCircleOutline;
});
const terminalStartPanelTitle = computed(() => {
  if (sessionSourcePending.value) {
    return "Session source is being prepared";
  }
  if (terminalStarting.value) {
    return "Starting Codex";
  }
  if (terminalReconnectRequired.value) {
    return "Reconnect Codex";
  }
  if (terminalServerStale.value) {
    return "Codex terminal needs restart";
  }
  return terminalExited.value ? "Codex terminal exited" : "Codex terminal is off";
});
const terminalStartPanelMessage = computed(() => {
  if (sessionSourcePending.value) {
    return "Codex will start from the session source after the clone has been created.";
  }
  if (terminalStarting.value) {
    return "Preparing this session terminal.";
  }
  if (terminalReconnectRequired.value) {
    return "Reconnect the Codex account before starting this session terminal.";
  }
  if (terminalServerStale.value) {
    return serverCodexTerminal.value.message || "The previous Codex terminal is still running, but Vibe64 cannot attach to it. Restart it for this session.";
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
  return (terminalExited.value || terminalServerStale.value) ? "Restart Codex" : "Start Codex";
});
const showTerminalStartPanel = computed(() => (
  componentMounted.value &&
  (
    sessionSourcePending.value ||
    (terminalStarting.value && terminalDisplayActive.value) ||
    (
      canUseTerminal.value &&
      terminalCanStart.value &&
      (!terminalSessionId.value || terminalExited.value || terminalServerStale.value)
    )
  )
));

function defaultExpanded() {
  if (typeof window === "undefined" || !window.matchMedia) {
    return true;
  }
  return !window.matchMedia("(max-width: 700px)").matches;
}

function handleTerminalCopy() {
  copyStatus.value = "Terminal text copied.";
}

function handleTerminalInterrupt() {
  clearCodexBusy();
  clearCodexWorking();
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
  const currentTerminalId = String(extra.agentTerminalSessionId || terminalSessionId.value || "");
  if (!terminalScopeId.value || !currentTerminalId) {
    return;
  }
  emit("session-update", {
    agentTerminalCommandPreview: terminalCommandPreview.value,
    agentTerminalSessionId: currentTerminalId,
    agentTerminalStatus: terminalStatus.value,
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
    : codexCommands.startAgentTerminal(currentScopeId);
}

function closeTerminalSessionForScope(currentScopeId, terminalId) {
  return globalScope.value
    ? codexCommands.closeGlobalCodexTerminal(currentScopeId, terminalId)
    : codexCommands.closeAgentTerminal(currentScopeId, terminalId);
}

async function closeCodexTerminalDriverSession(terminalId) {
  const result = await closeTerminalSessionForScope(terminalScopeId.value, terminalId);
  if (result?.ok === false) {
    throw new Error(vibe64TerminalErrorMessage(result, "Codex terminal process could not be stopped."));
  }
  return result;
}

async function applyCodexTerminalSession(session = {}, {
  fallbackStatus = "running",
  ownership = "attached",
  preserveOutput = true
} = {}) {
  const nextTerminalSessionId = String(session.id || session.terminalSessionId || "").trim();
  if (!nextTerminalSessionId) {
    return {
      applied: false,
      hasTerminalSession: Boolean(terminalSessionId.value)
    };
  }

  const previousTerminalSessionId = String(terminalSessionId.value || "");
  const sameTerminalSession = previousTerminalSessionId === nextTerminalSessionId;
  const terminalSessionChanged = Boolean(
    previousTerminalSessionId &&
    previousTerminalSessionId !== nextTerminalSessionId
  );
  if (terminalSessionChanged) {
    resetTerminalOutput();
  }

  await terminalController.attachTerminal({
    ...session,
    id: nextTerminalSessionId
  }, {
    connect: false,
    fallbackStatus,
    ownership,
    preserveOutput,
    resize: !sameTerminalSession
  });
  return {
    applied: true,
    sameTerminalSession,
    terminalSessionChanged,
    terminalSessionId: nextTerminalSessionId
  };
}

function webSocketUrlForScope(currentScopeId, terminalId) {
  return globalScope.value
    ? vibe64GlobalCodexTerminalWebSocketUrl(currentScopeId, terminalId)
    : vibe64AgentTerminalWebSocketUrl(currentScopeId, terminalId);
}

function openCodexReconnectDialog() {
  requestVibe64AccountConnectionsDialog({
    codexReconnectRequired: true,
    providerId: "codex",
    refresh: false
  });
}

function codexAccountConnectedPayload(payload = {}) {
  const accountId = String(payload?.accountId || payload?.connectionId || "").trim().toLowerCase();
  const status = String(payload?.status || "").trim().toLowerCase();
  return accountId === "codex" && payload?.connected === true && (!status || status === "connected");
}

async function recoverCodexTerminalAfterAccountReconnect() {
  if (!terminalReconnectRequired.value) {
    return;
  }
  terminalError.value = "";
  closeTerminalSocket();
  resetTerminalSessionState();
  resetTerminalDisplay();
  resetTerminalOutput();
  expanded.value = true;
  await ensureTerminalReady();
}

useRealtimeEvent({
  enabled: computed(() => Boolean(componentMounted.value && terminalReconnectRequired.value)),
  event: VIBE64_ACCOUNTS_CHANGED_EVENT,
  matches({ payload = {} } = {}) {
    return codexAccountConnectedPayload(payload);
  },
  onEvent() {
    void recoverCodexTerminalAfterAccountReconnect();
  }
});

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

async function sendEscape() {
  return sendTerminalData("\u001b", {
    source: "user"
  });
}

function updateTerminalExpanded(value) {
  expanded.value = Boolean(value);
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
  focusTerminal();
  for (const delayMs of [50, 150, 300]) {
    globalThis.setTimeout(() => {
      if (terminalDisplayActive.value && props.autoFocus && !props.readOnly && !terminalFocused.value) {
        focusTerminal();
      }
    }, delayMs);
  }
}

async function connectAttachedTerminal() {
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
    await applyCodexTerminalSession(session, {
      fallbackStatus: "running",
      ownership: "owned"
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
  const attached = await applyCodexTerminalSession(session, {
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
    agentTerminalSessionId: normalizedTerminalId,
    agentTerminalStatus: "stale"
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
  if (!terminalSessionId.value) {
    detachTerminal();
    return true;
  }
  if (!(await terminalController.closeTerminal({
    deleteSession: true
  }))) {
    return false;
  }
  terminalStartPromise = null;
  resetTerminalOutput();
  clearAttachmentStatus();
  resetAttachmentDragState();
  return true;
}

async function restartTerminal() {
  if (terminalReconnectRequired.value) {
    openCodexReconnectDialog();
    return;
  }
  terminalError.value = "";
  expanded.value = true;
  if (!(await closeTerminal())) {
    return;
  }
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

onMounted(() => {
  componentMounted.value = true;
  expanded.value = defaultExpanded();
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

.vibe64-codex-session__drop-overlay,
.vibe64-codex-session__start-panel {
  align-items: center;
  display: flex;
  inset: 0;
  justify-content: center;
  padding: 1rem;
  position: absolute;
}

.vibe64-codex-session__drop-overlay {
  background: rgba(12, 18, 28, 0.72);
  pointer-events: none;
  z-index: 5;
}

.vibe64-codex-session__drop-card {
  align-items: center;
  display: flex;
  gap: 0.7rem;
  padding: 1rem 1.15rem;
}

.vibe64-codex-session__start-panel {
  background: rgba(14, 18, 25, 0.8);
  z-index: 3;
}

.vibe64-codex-session__start-card {
  align-items: center;
  display: grid;
  gap: 0.85rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  max-width: min(42rem, 100%);
  padding: 1rem;
  width: 100%;
}

.vibe64-codex-session__start-icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.14);
  border-radius: 999px;
  color: rgb(var(--v-theme-primary));
  display: flex;
  height: 3rem;
  justify-content: center;
  width: 3rem;
}

.vibe64-codex-session__start-copy {
  display: grid;
  gap: 0.15rem;
  min-width: 0;
}

.vibe64-codex-session__start-copy strong {
  font-size: 0.95rem;
}

.vibe64-codex-session__start-copy span {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.8rem;
  line-height: 1.35;
}

.vibe64-codex-session__command {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .vibe64-codex-session__start-card {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .vibe64-codex-session__start-card :deep(.v-btn) {
    grid-column: 1 / -1;
    width: 100%;
  }
}
</style>
