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
    <template v-if="displayMode !== 'headless'">
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
            <div ref="terminalHost" class="codex-terminal__host" @click="focusTerminal" />
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
    </template>
  </v-sheet>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiPaperclip,
  mdiRestart
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  vibe64CodexTerminalWebSocketUrl,
  closeVibe64CodexTerminal,
  startVibe64CodexTerminal
} from "@/lib/vibe64SessionApi.js";
import { useVibe64CodexCommands } from "@/composables/useVibe64CodexCommands.js";
import { useCodexTerminalAttachments } from "@/composables/useCodexTerminalAttachments.js";
import { useCodexTerminalOutput } from "@/composables/useCodexTerminalOutput.js";
import { useCodexTerminalSessionLifecycle } from "@/composables/useCodexTerminalSessionLifecycle.js";
import { useCodexTerminalViewport } from "@/composables/useCodexTerminalViewport.js";
import { writeClipboardText } from "@/lib/clipboard.js";
import {
  vibe64SessionWorktreePath
} from "@/lib/vibe64SessionPaths.js";
import { terminalInputHasUserText } from "@/lib/terminalInput.js";

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
  }
});
const emit = defineEmits([
  "input",
  "session-update"
]);
const codexCommands = useVibe64CodexCommands();

const terminalSessionId = ref("");
const terminalStatus = ref("");
const terminalCommandPreview = ref("");
const terminalError = ref("");
const terminalStarting = ref(false);
const copyStatus = ref("");
const expanded = ref(true);
const componentMounted = ref(false);
let terminalLifecycle = null;

const sessionId = computed(() => props.session?.sessionId || "");
const sessionWorktree = computed(() => vibe64SessionWorktreePath(props.session || {}));
const terminalDisplayActive = computed(() => props.visible && props.displayMode !== "headless");
const serverCodexTerminal = computed(() => {
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

function runtimeCodexPromptHandoff(session = {}) {
  const actionResultHandoff = session?.actionResult?.codexPromptHandoff;
  if (actionResultHandoff && typeof actionResultHandoff === "object") {
    return actionResultHandoff;
  }
  const sessionHandoff = session?.codexPromptHandoff;
  return sessionHandoff && typeof sessionHandoff === "object" ? sessionHandoff : null;
}

const canUseTerminal = computed(() => {
  return Boolean(
    terminalDisplayActive.value &&
    sessionId.value &&
    sessionWorktree.value &&
    (props.allowStart || serverTerminalSession.value.id)
  );
});
const canStartTerminal = computed(() => {
  return Boolean(props.allowStart && terminalDisplayActive.value && sessionId.value && sessionWorktree.value);
});
const {
  appendTerminalDisplay,
  clearTerminalDisplay,
  disposeTerminalUi: disposeTerminalViewport,
  fitTerminal,
  focusTerminal,
  resetTerminal,
  setupTerminalUi,
  terminalFocused,
  terminalHost,
  terminalSelectedText,
  writeTerminalDisplay
} = useCodexTerminalViewport({
  expanded,
  onData(data) {
    if (props.readOnly) {
      return;
    }
    void sendTerminalData(data, {
      source: "user"
    });
  },
  onResize(size) {
    if (!terminalLifecycle) {
      return false;
    }
    return terminalLifecycle.resizeTerminal(size);
  },
  visible: computed(() => props.visible)
});
const {
  addPromptEchoFilter,
  appendTerminalOutput,
  clearCodexBusy,
  clearCodexWorking,
  clearPromptEchoFilters,
  flushTerminalOutput,
  getTerminalOutput,
  markCodexBusy,
  resetTerminalOutput,
  writeTerminalOutput
} = useCodexTerminalOutput({
  appendDisplay: appendTerminalDisplay,
  displayActive: terminalDisplayActive,
  sessionId,
  writeDisplay: writeTerminalDisplay
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
  sessionId,
  uploadAttachment: (currentSessionId, file) => codexCommands.uploadAttachment(currentSessionId, file)
});
terminalLifecycle = useCodexTerminalSessionLifecycle({
  appendTerminalOutput,
  canStartTerminal,
  canUseTerminal,
  clearCodexBusy,
  clearCodexWorking,
  clearPromptEchoFilters,
  clearTerminalDisplay,
  clearTerminalOutput() {
    resetTerminalOutput();
  },
  closeTerminalSession: closeVibe64CodexTerminal,
  componentMounted,
  defaultExpanded,
  disposeTerminalViewport,
  emitSessionState(payload) {
    emit("session-update", payload);
  },
  expanded,
  fitTerminal,
  onBeforeDispose() {
    flushTerminalOutput();
  },
  onSessionChanged() {
    resetAttachmentDragState();
    clearAttachmentStatus();
  },
  onTerminalRecovered() {
    copyStatus.value = "Studio server restarted; reconnecting Codex.";
    resetTerminalOutput({
      emit: true
    });
  },
  onTerminalSnapshot(session) {
    applyServerPromptEchoFilter(session);
  },
  refreshTerminalOutput() {
    writeTerminalOutput(getTerminalOutput());
  },
  resetTerminal,
  sessionId,
  setupTerminalUi,
  startTerminalSession: startVibe64CodexTerminal,
  terminalCommandPreview,
  terminalError,
  terminalHost,
  terminalSessionId,
  terminalStarting,
  terminalStatus,
  visible: computed(() => props.visible),
  webSocketUrl: vibe64CodexTerminalWebSocketUrl,
  writeTerminalOutput
});
const {
  closeTerminal,
  restartTerminal,
  showTerminalStartPanel,
  terminalExited
} = terminalLifecycle;

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
  return terminalLifecycle?.ensureTerminalReady() || Promise.resolve(false);
}

function serverPromptEchoText(session = {}) {
  const handoff = runtimeCodexPromptHandoff(session);
  return String(handoff?.terminalInput || handoff?.prompt || "");
}

function applyServerPromptEchoFilter(session = {}) {
  const outputStart = Number(session?.codexPromptHandoffOutputStart);
  const prompt = serverPromptEchoText(session);
  if (!Number.isSafeInteger(outputStart) || outputStart < 0 || !prompt) {
    return;
  }
  addPromptEchoFilter({
    outputStart,
    prompt
  });
}

async function sendTerminalData(data, {
  source = "program"
} = {}) {
  const input = String(data || "");
  try {
    if (!(await terminalLifecycle?.sendTerminalInput(input))) {
      return false;
    }
    if (source === "user" && input.includes("\u0003")) {
      clearCodexBusy();
      clearCodexWorking();
    } else if (source === "user" && input.includes("\r")) {
      markCodexBusy();
    }
    if (source === "user" && terminalInputHasUserText(input)) {
      emit("input", input);
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

function toggleExpanded() {
  expanded.value = !expanded.value;
  if (expanded.value) {
    void ensureTerminalReady();
  }
}

watch(() => props.session, (session) => {
  applyServerPromptEchoFilter(session || {});
}, {
  immediate: true
});

watch(serverTerminalSession, (terminal) => {
  void terminalLifecycle?.attachTerminalSession(terminal);
}, {
  flush: "post",
  immediate: true
});

watch(() => props.displayMode, async (displayMode) => {
  if (displayMode === "headless") {
    return;
  }
  await nextTick();
  fitTerminal();
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
