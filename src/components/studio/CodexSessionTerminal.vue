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
          <StudioErrorNotice
            v-if="terminalError"
            title="Codex terminal needs attention"
            :error="terminalError"
            compact
            class="mb-2"
          />

          <div
            class="codex-terminal__stage"
            :class="{ 'codex-terminal__stage--dragging': attachmentDragActive }"
            @dragenter.prevent="handleAttachmentDragEnter"
            @dragover.prevent="handleAttachmentDragOver"
            @dragleave.prevent="handleAttachmentDragLeave"
            @drop.prevent="handleAttachmentDrop"
          >
            <div
              ref="terminalHost"
              class="codex-terminal__host"
              @click="focusTerminal"
              @pointerdown.capture="focusTerminal"
            />
            <div v-if="attachmentDragActive || attachmentUploading" class="codex-terminal__drop-overlay">
              <v-sheet class="codex-terminal__drop-card" rounded="lg" elevation="10">
                <v-icon :icon="mdiPaperclip" size="28" />
                <span>{{ attachmentUploading ? "Uploading temporary file..." : "Drop temporary files for Codex" }}</span>
              </v-sheet>
            </div>
            <div v-if="showTerminalStartPanel" class="codex-terminal__restart-panel">
              <v-sheet class="codex-terminal__restart-card" rounded="lg" elevation="8">
                <span>{{ terminalExited ? "Codex exited." : "Codex is not running." }}</span>
                <v-btn
                  color="primary"
                  :loading="terminalStarting"
                  :prepend-icon="mdiRestart"
                  size="small"
                  variant="flat"
                  @click="restartTerminal"
                >
                  {{ terminalExited ? "Restart Codex" : "Start Codex" }}
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
  mdiPaperclip,
  mdiRestart
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useCodexTerminalElement } from "@/composables/useCodexTerminalElement.js";
import {
  vibe64CodexTerminalWebSocketUrl,
  vibe64GlobalCodexTerminalWebSocketUrl,
  closeVibe64CodexTerminal,
  closeVibe64GlobalCodexTerminal,
  startVibe64CodexTerminal,
  startVibe64GlobalCodexTerminal
} from "@/lib/vibe64SessionApi.js";
import { useVibe64CodexCommands } from "@/composables/useVibe64CodexCommands.js";
import { useCodexTerminalAttachments } from "@/composables/useCodexTerminalAttachments.js";
import { useCodexTerminalOutput } from "@/composables/useCodexTerminalOutput.js";
import { writeClipboardText } from "@/lib/clipboard.js";
import {
  vibe64SessionWorktreePath
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
let terminalStartPromise = null;

const globalScope = computed(() => props.scope === "global");
const sessionId = computed(() => props.session?.sessionId || "");
const terminalScopeId = computed(() => (globalScope.value ? "global" : sessionId.value));
const sessionWorktree = computed(() => vibe64SessionWorktreePath(props.session || {}));
const terminalDisplayActive = computed(() => props.visible && props.displayMode !== "headless");
const serverCodexTerminal = computed(() => {
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
      (props.allowStart && sessionWorktree.value)
    )
  );
});
const canStartTerminal = computed(() => {
  if (globalScope.value) {
    return Boolean(props.allowStart && terminalDisplayActive.value && terminalScopeId.value);
  }
  return Boolean(props.allowStart && terminalDisplayActive.value && sessionId.value && sessionWorktree.value);
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
const showTerminalStartPanel = computed(() => (
  canUseTerminal.value &&
  terminalCanStart.value &&
  componentMounted.value &&
  !terminalStarting.value &&
  (!terminalSessionId.value || terminalExited.value)
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
      terminalError.value = "Create the session worktree before starting Codex.";
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
  if (!terminalScopeId.value || !terminalSessionId.value) {
    return;
  }
  emit("session-update", {
    codexTerminalCommandPreview: terminalCommandPreview.value,
    codexTerminalSessionId: terminalSessionId.value,
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
    ? startVibe64GlobalCodexTerminal()
    : startVibe64CodexTerminal(currentScopeId);
}

function closeTerminalSessionForScope(currentScopeId, terminalId) {
  return globalScope.value
    ? closeVibe64GlobalCodexTerminal(currentScopeId, terminalId)
    : closeVibe64CodexTerminal(currentScopeId, terminalId);
}

function webSocketUrlForScope(currentScopeId, terminalId) {
  return globalScope.value
    ? vibe64GlobalCodexTerminalWebSocketUrl(currentScopeId, terminalId)
    : vibe64CodexTerminalWebSocketUrl(currentScopeId, terminalId);
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
  if (expanded.value) {
    void ensureTerminalReady();
  }
}

async function focusTerminal() {
  if (!expanded.value) {
    expanded.value = true;
    await nextTick();
  }
  return focusTerminalUi();
}

async function focusWritableTerminalWhenShown(visible) {
  if (!visible || props.readOnly) {
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
  void setupTerminalUi();
  if (!(await connectTerminalSocket())) {
    throw new Error("Terminal stream failed to connect.");
  }
  return true;
}

async function startTerminalOnce() {
  void setupTerminalUi();
  if (terminalExited.value && terminalCanStart.value) {
    closeTerminalSocket();
    resetTerminalSessionState();
    resetTerminalDisplay();
    resetTerminalOutput();
  }
  if (terminalSessionId.value) {
    return connectAttachedTerminal();
  }
  if (!terminalCanStart.value) {
    return false;
  }

  terminalStarting.value = true;
  terminalError.value = "";
  try {
    const session = await startTerminalSessionForScope(terminalScopeId.value);
    if (session?.ok === false) {
      throw new Error(session.error || session.errors?.[0]?.message || "Codex terminal failed to start.");
    }
    if (!session?.id) {
      throw new Error("Codex terminal failed to start.");
    }
    applyCodexTerminalSession(session, {
      fallbackStatus: "running"
    });
    emitTerminalSessionState();
    return connectAttachedTerminal();
  } catch (startError) {
    terminalError.value = String(startError?.message || startError || "Codex terminal failed to start.");
    return false;
  } finally {
    terminalStarting.value = false;
  }
}

function startTerminalWhenReady() {
  if (!canUseTerminal.value) {
    return;
  }
  void ensureTerminalReady();
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
    await connectAttachedTerminal();
    return true;
  } catch (attachError) {
    terminalError.value = String(attachError?.message || attachError || "Terminal stream failed to connect.");
    return false;
  }
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
  resetAttachmentDragState();
  clearAttachmentStatus();
  expanded.value = defaultExpanded();
  startTerminalWhenReady();
});

watch(canUseTerminal, (ready) => {
  if (ready) {
    startTerminalWhenReady();
  }
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
  if (host) {
    void setupTerminalUi();
    startTerminalWhenReady();
  }
}, {
  flush: "post"
});

onMounted(() => {
  componentMounted.value = true;
  expanded.value = defaultExpanded();
  startTerminalWhenReady();
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
  align-items: flex-end;
  display: flex;
  inset: auto 0 0;
  justify-content: center;
  padding: 1rem;
  pointer-events: none;
  position: absolute;
}

.codex-terminal__restart-card {
  align-items: center;
  background: rgba(var(--v-theme-surface), 0.96);
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  max-width: min(28rem, calc(100% - 1rem));
  min-width: min(22rem, calc(100% - 1rem));
  padding: 0.55rem 0.65rem 0.55rem 0.85rem;
  pointer-events: auto;
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
    flex-direction: column;
    min-width: min(18rem, calc(100% - 1rem));
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
