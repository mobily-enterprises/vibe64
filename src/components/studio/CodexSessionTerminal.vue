<template>
  <v-sheet
    rounded="lg"
    class="codex-terminal"
    :class="{
      'codex-terminal--desktop-actionless': true,
      'codex-terminal--focused': terminalFocused
    }"
  >
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
  </v-sheet>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiPaperclip,
  mdiRestart
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  aiStudioCodexTerminalWebSocketUrl,
  closeAiStudioCodexTerminal,
  startAiStudioCodexTerminal
} from "@/lib/aiStudioSessionApi.js";
import { useAiStudioCodexCommands } from "@/composables/useAiStudioCodexCommands.js";
import { useCodexTerminalAttachments } from "@/composables/useCodexTerminalAttachments.js";
import { useCodexPromptHandoff } from "@/composables/useCodexPromptHandoff.js";
import { useCodexTerminalOutput } from "@/composables/useCodexTerminalOutput.js";
import { useCodexTerminalSessionLifecycle } from "@/composables/useCodexTerminalSessionLifecycle.js";
import { useCodexTerminalViewport } from "@/composables/useCodexTerminalViewport.js";
import { writeClipboardText } from "@/lib/clipboard.js";
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
  promptInjectionRequestKey: {
    type: [String, Number],
    default: ""
  },
  promptOverride: {
    type: String,
    default: ""
  }
});
const emit = defineEmits([
  "busy-changed",
  "input",
  "output",
  "prompt-injected",
  "prompt-injection-failed",
  "session-update"
]);
const codexCommands = useAiStudioCodexCommands();

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
const sessionWorktree = computed(() => {
  return String(
    props.session?.metadata?.worktree_path ||
    props.session?.worktree ||
    ""
  ).trim();
});

function runtimeCodexPromptHandoff(session = {}) {
  const actionResultHandoff = session?.actionResult?.codexPromptHandoff;
  if (actionResultHandoff && typeof actionResultHandoff === "object") {
    return actionResultHandoff;
  }
  const sessionHandoff = session?.codexPromptHandoff;
  return sessionHandoff && typeof sessionHandoff === "object" ? sessionHandoff : null;
}

const canUseTerminal = computed(() => {
  return Boolean(sessionId.value && sessionWorktree.value);
});
const codexPrompt = computed(() => {
  if (props.promptOverride) {
    return String(props.promptOverride || "");
  }
  const handoff = runtimeCodexPromptHandoff(props.session);
  if (handoff?.prompt) {
    return String(handoff.prompt || "");
  }
  const promptField = String(props.session?.codex?.promptField || "");
  return promptField ? String(props.session?.[promptField] || "") : "";
});
const manualPromptInjectionRequestKey = computed(() => String(props.promptInjectionRequestKey || ""));
const {
  clearTerminalDisplay,
  disposeTerminalUi: disposeTerminalViewport,
  fitTerminal,
  focusTerminal,
  resetTerminal,
  setupTerminalUi,
  terminalFocused,
  terminalHost,
  terminalSelectedText,
  visibleTerminalText,
  writeTerminalDisplay
} = useCodexTerminalViewport({
  expanded,
  onData(data) {
    void sendTerminalData(data, {
      source: "user"
    });
  },
  visible: computed(() => props.visible)
});
let promptHandoff = null;
const {
  addPromptEchoFilter,
  appendTerminalOutput,
  clearCodexBusy,
  clearPromptEchoFilters,
  flushTerminalOutputEmit,
  getTerminalOutput,
  hasTerminalOutput,
  lastTerminalOutputAt,
  markCodexBusy,
  removePromptEchoFilter,
  resetTerminalOutput,
  writeTerminalOutput
} = useCodexTerminalOutput({
  emitBusyChanged(payload) {
    emit("busy-changed", payload);
  },
  emitOutput(output) {
    emit("output", output);
  },
  onOutputChanged(output) {
    void promptHandoff?.captureCodexThreadFromOutput(output);
  },
  sessionId,
  writeDisplay: writeTerminalDisplay
});
promptHandoff = useCodexPromptHandoff({
  addPromptEchoFilter,
  clearCodexBusy,
  clearPromptEchoFilters,
  codexPrompt,
  componentMounted,
  copyStatus,
  emitPromptInjected(payload) {
    emit("prompt-injected", payload);
  },
  emitPromptInjectionFailed(payload) {
    emit("prompt-injection-failed", payload);
  },
  emitSessionUpdate(payload) {
    emit("session-update", payload);
  },
  ensureTerminalReady,
  expanded,
  getTerminalOutput,
  hasTerminalOutput,
  lastTerminalOutputAt,
  manualPromptInjectionRequestKey,
  markCodexBusy,
  removePromptEchoFilter,
  saveThread: (currentSessionId, threadId) => codexCommands.saveThread(currentSessionId, threadId),
  sendTerminalData,
  sessionId,
  terminalError,
  terminalSessionId,
  terminalStatus,
  visibleTerminalText
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
  canUseTerminal,
  clearCodexBusy,
  clearPromptEchoFilters,
  clearTerminalDisplay,
  clearTerminalOutput() {
    resetTerminalOutput();
  },
  closeTerminalSession: closeAiStudioCodexTerminal,
  componentMounted,
  defaultExpanded,
  disposeTerminalViewport,
  emitSessionState(payload) {
    emit("session-update", payload);
  },
  expanded,
  fitTerminal,
  onBeforeDispose() {
    flushTerminalOutputEmit();
  },
  onBeforeDetach() {
    promptHandoff?.detach();
  },
  onMountedReady() {
    void promptHandoff?.injectPromptForRequest();
  },
  onSessionChanged() {
    promptHandoff?.resetPromptRequestState();
    resetAttachmentDragState();
    clearAttachmentStatus();
  },
  onTerminalRecovered() {
    copyStatus.value = "Studio server restarted; reconnecting Codex.";
    promptHandoff?.resetTerminalRecoveryState();
    resetTerminalOutput({
      emit: true
    });
  },
  onTerminalSnapshot(session) {
    promptHandoff?.applyTerminalSnapshot(session);
  },
  onTerminalStarted(session) {
    promptHandoff?.applyCodexThreadState(session);
    promptHandoff?.noteTerminalStarted();
    void promptHandoff?.ensureCodexThreadReady({ forceRetry: true });
  },
  refreshTerminalOutput() {
    writeTerminalOutput(getTerminalOutput());
  },
  resetTerminal,
  sessionId,
  setupTerminalUi,
  startTerminalSession: startAiStudioCodexTerminal,
  terminalCommandPreview,
  terminalError,
  terminalHost,
  terminalSessionId,
  terminalStarting,
  terminalStatus,
  visible: computed(() => props.visible),
  webSocketUrl: aiStudioCodexTerminalWebSocketUrl,
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
    } else if (source === "user" && input.includes("\r")) {
      markCodexBusy();
    }
    if (source === "user" && terminalInputHasUserText(input)) {
      emit("input", input);
    }
    promptHandoff?.noteTerminalInput(input);
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

watch(manualPromptInjectionRequestKey, (nextRequestKey) => {
  promptHandoff?.requestPromptInjection(nextRequestKey);
});

watch(codexPrompt, (nextPrompt, previousPrompt) => {
  if (nextPrompt === previousPrompt) {
    return;
  }
  promptHandoff?.resetPromptRequestState();
});

watch(() => [
  props.session?.codexThreadId || "",
  props.session?.needsThreadCapture === true
], () => {
  promptHandoff?.applyCodexThreadState(props.session || {});
}, {
  immediate: true
});

</script>

<style scoped>
.codex-terminal {
  min-width: 0;
  padding: 0.25rem 0 0;
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
