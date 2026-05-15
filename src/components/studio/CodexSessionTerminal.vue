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
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiPaperclip,
  mdiRestart
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  closeIssueSessionCodexTerminal,
  issueSessionCodexTerminalWebSocketUrl,
  saveIssueSessionCodexThread,
  startIssueSessionCodexTerminal,
  uploadIssueSessionCodexAttachment
} from "@/lib/studioApi.js";
import {
  codexTrustPromptLooksActive,
  extractCodexThreadId,
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import { terminalInputHasUserText } from "@/lib/terminalInput.js";
import "@xterm/xterm/css/xterm.css";

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
const emit = defineEmits(["input", "output", "prompt-injected", "prompt-injection-failed", "session-update"]);

const terminalHost = ref(null);
const terminalSessionId = ref("");
const terminalStatus = ref("");
const terminalCommandPreview = ref("");
const terminalError = ref("");
const terminalFocused = ref(false);
const terminalStarting = ref(false);
const terminalSelectedText = ref("");
const copyStatus = ref("");
const expanded = ref(true);
const injectingPrompt = ref(false);
const autoPromptInjected = ref(false);
const componentMounted = ref(false);
const codexThreadId = ref("");
const codexThreadCaptureRequired = ref(false);
const codexThreadCaptureStarted = ref(false);
const attachmentDragDepth = ref(0);
const attachmentUploading = ref(false);
const attachmentStatus = ref("");

let terminalInstance = null;
let terminalFitAddon = null;
let terminalDataDisposable = null;
let terminalSelectionDisposable = null;
let terminalFocusInHandler = null;
let terminalFocusOutHandler = null;
let terminalDocumentFocusInHandler = null;
let terminalOutsidePointerHandler = null;
let terminalWindowBlurHandler = null;
let terminalResizeHandler = null;
let terminalSocket = null;
let terminalSocketOpenPromise = null;
let terminalReconnectTimer = null;
let terminalOutputEmitTimer = null;
let terminalSetupPromise = null;
let terminalOutputOffset = 0;
let terminalStartPromise = null;
let terminalRecoveryPromise = null;
let codexThreadCapturePromise = null;
let codexThreadSavePromise = null;
let handledPromptInjectionRequestKey = "";
let promptInjectionRetryStartedAt = 0;
let promptInjectionRetryTimer = null;
let terminalHasOutput = false;
let terminalLatestOutput = "";
let terminalLastOutputAt = 0;
let terminalStartedAt = 0;
let codexTrustPromptAnsweredAt = 0;

const DEFAULT_CODEX_THREAD_COMMAND = "echo $CODEX_THREAD_ID";
const CODEX_BOOT_MIN_AGE_MS = 1800;
const CODEX_BOOT_QUIET_MS = 900;
const CODEX_BOOT_TIMEOUT_MS = 12000;
const CODEX_KEY_PAUSE_MS = 180;
const PROMPT_INJECTION_RETRY_MS = 350;
const PROMPT_INJECTION_RETRY_TIMEOUT_MS = 15000;
const CODEX_TERMINAL_SCROLLBACK_LINES = 50000;
const MAX_TERMINAL_OUTPUT_LENGTH = 16 * 1024 * 1024;
const TERMINAL_OUTPUT_EMIT_INTERVAL_MS = 120;

const sessionId = computed(() => props.session?.sessionId || "");
const canUseTerminal = computed(() => Boolean(sessionId.value && props.session?.worktreeReady === true));
const codexPrompt = computed(() => {
  if (props.promptOverride) {
    return String(props.promptOverride || "");
  }
  const promptField = String(props.session?.codex?.promptField || "");
  return promptField ? String(props.session?.[promptField] || "") : "";
});
const manualPromptInjectionRequestKey = computed(() => String(props.promptInjectionRequestKey || ""));
const terminalExited = computed(() => terminalStatus.value === "exited");
const attachmentDragActive = computed(() => attachmentDragDepth.value > 0);
const showTerminalStartPanel = computed(() => (
  canUseTerminal.value &&
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

function fallbackCopyText(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function applyCodexThreadState(session = {}) {
  if (session.codexThreadId) {
    codexThreadId.value = String(session.codexThreadId || "");
    codexThreadCaptureRequired.value = false;
    codexThreadCaptureStarted.value = false;
    return;
  }
  if (session.needsThreadCapture === true) {
    codexThreadCaptureRequired.value = true;
  }
}

async function copyText(value, label) {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else if (!fallbackCopyText(text)) {
      throw new Error("Clipboard API is unavailable.");
    }
    copyStatus.value = `${label} copied.`;
    return true;
  } catch (copyError) {
    copyStatus.value = String(copyError?.message || copyError || "Copy failed.");
    return false;
  }
}

function updateTerminalSelection() {
  terminalSelectedText.value = terminalInstance?.hasSelection?.()
    ? terminalInstance.getSelection()
    : "";
  return terminalSelectedText.value;
}

async function copyTerminalSelection() {
  await copyText(updateTerminalSelection(), "Selection");
}

function focusTerminal() {
  terminalInstance?.focus?.();
  terminalFocused.value = true;
  window.setTimeout(syncTerminalFocus, 0);
}

function syncTerminalFocus() {
  const host = terminalHost.value;
  const activeElement = document.activeElement;
  terminalFocused.value = Boolean(host && activeElement && host.contains(activeElement));
}

function blurTerminal() {
  terminalInstance?.blur?.();
  terminalFocused.value = false;
}

function handleDocumentPointerDown(event) {
  const host = terminalHost.value;
  const target = event.target;
  if (!host || !(target instanceof Node) || host.contains(target)) {
    return;
  }
  blurTerminal();
}

function trimTerminalOutput(output) {
  const terminalOutput = String(output || "");
  if (terminalOutput.length <= MAX_TERMINAL_OUTPUT_LENGTH) {
    return terminalOutput;
  }
  return terminalOutput.slice(terminalOutput.length - MAX_TERMINAL_OUTPUT_LENGTH);
}

function clearTerminalOutputEmit() {
  if (!terminalOutputEmitTimer) {
    return;
  }
  window.clearTimeout(terminalOutputEmitTimer);
  terminalOutputEmitTimer = null;
}

function emitTerminalOutputNow(output = terminalLatestOutput) {
  clearTerminalOutputEmit();
  emit("output", output);
}

function flushTerminalOutputEmit() {
  if (!terminalOutputEmitTimer) {
    return;
  }
  clearTerminalOutputEmit();
  emit("output", terminalLatestOutput);
}

function scheduleTerminalOutputEmit() {
  if (terminalOutputEmitTimer) {
    return;
  }
  terminalOutputEmitTimer = window.setTimeout(() => {
    terminalOutputEmitTimer = null;
    emit("output", terminalLatestOutput);
  }, TERMINAL_OUTPUT_EMIT_INTERVAL_MS);
}

function disposeTerminalUi() {
  flushTerminalOutputEmit();
  closeTerminalSocket();
  if (terminalDataDisposable) {
    terminalDataDisposable.dispose();
    terminalDataDisposable = null;
  }
  if (terminalSelectionDisposable) {
    terminalSelectionDisposable.dispose();
    terminalSelectionDisposable = null;
  }
  if (terminalFocusInHandler) {
    terminalHost.value?.removeEventListener("focusin", terminalFocusInHandler);
    terminalFocusInHandler = null;
  }
  if (terminalFocusOutHandler) {
    terminalHost.value?.removeEventListener("focusout", terminalFocusOutHandler);
    terminalFocusOutHandler = null;
  }
  if (terminalDocumentFocusInHandler) {
    document.removeEventListener("focusin", terminalDocumentFocusInHandler, true);
    terminalDocumentFocusInHandler = null;
  }
  if (terminalOutsidePointerHandler) {
    document.removeEventListener("pointerdown", terminalOutsidePointerHandler, true);
    terminalOutsidePointerHandler = null;
  }
  if (terminalWindowBlurHandler) {
    window.removeEventListener("blur", terminalWindowBlurHandler);
    terminalWindowBlurHandler = null;
  }
  if (terminalResizeHandler) {
    window.removeEventListener("resize", terminalResizeHandler);
    terminalResizeHandler = null;
  }
  if (terminalInstance) {
    terminalInstance.dispose();
    terminalInstance = null;
  }
  terminalFitAddon = null;
  terminalOutputOffset = 0;
  terminalHasOutput = false;
  terminalLatestOutput = "";
  terminalLastOutputAt = 0;
  terminalStartedAt = 0;
  codexTrustPromptAnsweredAt = 0;
  terminalFocused.value = false;
  terminalSelectedText.value = "";
}

async function setupTerminalUi() {
  if (terminalInstance) {
    return true;
  }
  if (terminalSetupPromise) {
    return terminalSetupPromise;
  }

  terminalSetupPromise = (async () => {
    await nextTick();
    if (!terminalHost.value) {
      return false;
    }
    terminalInstance = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      scrollback: CODEX_TERMINAL_SCROLLBACK_LINES,
      theme: {
        background: "#101216",
        foreground: "#f5f7fb"
      }
    });
    terminalFitAddon = new FitAddon();
    terminalInstance.loadAddon(terminalFitAddon);
    terminalInstance.open(terminalHost.value);
    if (expanded.value && props.visible) {
      terminalFitAddon.fit();
    }
    terminalOutputOffset = 0;
    writeTerminalOutput(terminalLatestOutput);
    terminalDataDisposable = terminalInstance.onData((data) => {
      void sendTerminalData(data, {
        source: "user"
      });
    });
    terminalFocusInHandler = () => {
      terminalFocused.value = true;
    };
    terminalFocusOutHandler = () => {
      window.setTimeout(syncTerminalFocus, 0);
    };
    terminalDocumentFocusInHandler = () => {
      window.setTimeout(syncTerminalFocus, 0);
    };
    terminalOutsidePointerHandler = handleDocumentPointerDown;
    terminalWindowBlurHandler = () => {
      terminalFocused.value = false;
    };
    terminalHost.value.addEventListener("focusin", terminalFocusInHandler);
    terminalHost.value.addEventListener("focusout", terminalFocusOutHandler);
    document.addEventListener("focusin", terminalDocumentFocusInHandler, true);
    document.addEventListener("pointerdown", terminalOutsidePointerHandler, true);
    window.addEventListener("blur", terminalWindowBlurHandler);
    terminalSelectionDisposable = terminalInstance.onSelectionChange(() => {
      updateTerminalSelection();
    });
    terminalResizeHandler = () => {
      terminalFitAddon?.fit();
    };
    window.addEventListener("resize", terminalResizeHandler);
    return true;
  })();

  try {
    return await terminalSetupPromise;
  } finally {
    terminalSetupPromise = null;
  }
}

function writeTerminalOutput(output) {
  const nextOutput = trimTerminalOutput(output);
  emitTerminalOutputNow(nextOutput);
  if (nextOutput !== terminalLatestOutput) {
    terminalLatestOutput = nextOutput;
    terminalLastOutputAt = Date.now();
    terminalHasOutput = stripTerminalControlSequences(nextOutput).trim().length > 0;
  }
  void captureCodexThreadFromOutput(nextOutput);
  if (!terminalInstance) {
    terminalOutputOffset = nextOutput.length;
    return;
  }
  if (nextOutput.length < terminalOutputOffset) {
    terminalOutputOffset = 0;
    terminalInstance.reset();
  }
  const chunk = nextOutput.slice(terminalOutputOffset);
  if (chunk) {
    terminalInstance.write(chunk);
    terminalOutputOffset = nextOutput.length;
  }
}

function appendTerminalOutput(chunk) {
  const outputChunk = String(chunk || "");
  if (!outputChunk) {
    return;
  }
  const nextOutput = trimTerminalOutput(`${terminalLatestOutput}${outputChunk}`);
  terminalLatestOutput = nextOutput;
  terminalLastOutputAt = Date.now();
  terminalHasOutput = terminalHasOutput || stripTerminalControlSequences(outputChunk).trim().length > 0;
  void captureCodexThreadFromOutput(nextOutput);
  if (terminalInstance) {
    terminalInstance.write(outputChunk);
  }
  terminalOutputOffset = nextOutput.length;
  scheduleTerminalOutputEmit();
}

function closeTerminalSocket() {
  clearTerminalReconnect();
  const socket = terminalSocket;
  terminalSocket = null;
  terminalSocketOpenPromise = null;
  if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
    socket.close();
  }
}

function clearTerminalReconnect() {
  if (!terminalReconnectTimer) {
    return;
  }
  window.clearTimeout(terminalReconnectTimer);
  terminalReconnectTimer = null;
}

function scheduleTerminalReconnect() {
  if (
    terminalReconnectTimer ||
    !componentMounted.value ||
    !canUseTerminal.value ||
    !terminalSessionId.value ||
    terminalStatus.value === "exited"
  ) {
    return;
  }
  terminalReconnectTimer = window.setTimeout(async () => {
    terminalReconnectTimer = null;
    if (!terminalSessionId.value || terminalSocket || terminalStatus.value === "exited") {
      return;
    }
    const connected = await connectTerminalSocket();
    if (!connected && terminalSessionId.value && terminalStatus.value === "disconnected") {
      scheduleTerminalReconnect();
    }
  }, 1200);
}

function applyTerminalSnapshot(session = {}) {
  applyCodexThreadState(session);
  terminalStatus.value = session.status || terminalStatus.value || "";
  terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
  writeTerminalOutput(session.output);
  emitTerminalSessionState();
}

function handleTerminalSocketMessage(rawMessage) {
  let message;
  try {
    message = JSON.parse(String(rawMessage || ""));
  } catch {
    terminalError.value = "Terminal stream returned an invalid message.";
    return;
  }

  if (message?.type === "snapshot") {
    applyTerminalSnapshot(message.session || {});
    return;
  }

  if (message?.type === "output") {
    appendTerminalOutput(message.chunk);
    return;
  }

  if (message?.type === "status") {
    terminalStatus.value = message.status || terminalStatus.value || "";
    return;
  }

  if (message?.type === "error") {
    const error = String(message.error || "Terminal stream failed.");
    if (terminalSessionNotFound(error)) {
      void recoverMissingTerminal();
      return;
    }
    terminalError.value = error;
  }
}

function terminalSessionNotFound(error = "") {
  return String(error || "").toLowerCase().includes("terminal session not found");
}

async function connectTerminalSocket() {
  if (!terminalSessionId.value || !sessionId.value) {
    return false;
  }
  if (terminalSocket?.readyState === WebSocket.OPEN) {
    return true;
  }
  if (terminalSocketOpenPromise) {
    return terminalSocketOpenPromise;
  }

  terminalStatus.value = terminalStatus.value || "connecting";
  terminalSocketOpenPromise = new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(issueSessionCodexTerminalWebSocketUrl(sessionId.value, terminalSessionId.value));
    terminalSocket = socket;

    const settle = (ready) => {
      if (settled) {
        return;
      }
      settled = true;
      resolve(ready);
    };

    socket.addEventListener("open", () => {
      clearTerminalReconnect();
      terminalError.value = "";
      settle(true);
    });

    socket.addEventListener("message", (event) => {
      handleTerminalSocketMessage(event.data);
    });

    socket.addEventListener("error", () => {
      terminalError.value = "Terminal stream failed.";
      settle(false);
    });

    socket.addEventListener("close", (event) => {
      if (terminalSocket === socket) {
        terminalSocket = null;
      }
      terminalSocketOpenPromise = null;
      settle(false);
      if (terminalSessionNotFound(event.reason)) {
        void recoverMissingTerminal();
        return;
      }
      if (terminalStatus.value !== "exited") {
        terminalStatus.value = terminalSessionId.value ? "disconnected" : "";
        scheduleTerminalReconnect();
      }
    });
  });

  return terminalSocketOpenPromise;
}

async function ensureTerminalReady() {
  if (!canUseTerminal.value) {
    terminalError.value = "Create the session worktree before starting Codex.";
    return false;
  }
  if (terminalStartPromise) {
    return terminalStartPromise;
  }
  terminalStartPromise = startTerminalOnce();
  try {
    return await terminalStartPromise;
  } finally {
    terminalStartPromise = null;
  }
}

async function startTerminalOnce() {
  void setupTerminalUi();
  if (terminalSessionId.value) {
    terminalFitAddon?.fit();
    return true;
  }

  terminalStarting.value = true;
  terminalError.value = "";
  try {
    const session = await startIssueSessionCodexTerminal(sessionId.value);
    if (session?.ok === false) {
      throw new Error(session.error || session.errors?.[0]?.message || "Codex terminal failed to start.");
    }
    applyCodexThreadState(session);
    terminalSessionId.value = session.id || "";
    terminalStartedAt = Date.now();
    terminalStatus.value = session.status || "running";
    terminalCommandPreview.value = session.commandPreview || "";
    emitTerminalSessionState();
    void setupTerminalUi().then((ready) => {
      if (ready) {
        terminalFitAddon?.fit();
        writeTerminalOutput(terminalLatestOutput);
      }
    });
    if (!(await connectTerminalSocket())) {
      throw new Error("Terminal stream failed to connect.");
    }
    void ensureCodexThreadReady({ forceRetry: true });
    return true;
  } catch (startError) {
    terminalError.value = String(startError?.message || startError || "Codex terminal failed to start.");
    return false;
  } finally {
    terminalStarting.value = false;
  }
}

function emitTerminalSessionState(extra = {}) {
  if (!sessionId.value || !terminalSessionId.value) {
    return;
  }
  emit("session-update", {
    codexTerminalCommandPreview: terminalCommandPreview.value,
    codexTerminalSessionId: terminalSessionId.value,
    codexTerminalStatus: terminalStatus.value,
    sessionId: sessionId.value,
    ...extra
  });
}

async function sendTerminalData(data, {
  source = "program"
} = {}) {
  if (!terminalSessionId.value || terminalStatus.value === "exited") {
    return false;
  }
  const input = String(data || "");
  try {
    if (!(await connectTerminalSocket()) || terminalSocket?.readyState !== WebSocket.OPEN) {
      throw new Error("Terminal stream is not connected.");
    }
    terminalSocket.send(JSON.stringify({
      data: input,
      type: "input"
    }));
    if (source === "user" && terminalInputHasUserText(input)) {
      emit("input", input);
    }
    if (input.includes("\r") && codexTrustPromptLooksActive(terminalLatestOutput)) {
      codexTrustPromptAnsweredAt = Date.now();
      copyStatus.value = "";
    }
    return true;
  } catch (sendError) {
    terminalError.value = String(sendError?.message || sendError || "Terminal input failed.");
    return false;
  }
}

function filesFromDropEvent(event) {
  return Array.from(event?.dataTransfer?.files || []).filter((file) => file && file.size >= 0);
}

function handleAttachmentDragEnter(event) {
  const hasFiles = filesFromDropEvent(event).length > 0 ||
    Array.from(event?.dataTransfer?.types || []).includes("Files");
  if (!hasFiles) {
    return;
  }
  attachmentDragDepth.value += 1;
  if (event?.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function handleAttachmentDragOver(event) {
  if (event?.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
}

function handleAttachmentDragLeave() {
  attachmentDragDepth.value = Math.max(0, attachmentDragDepth.value - 1);
}

async function injectAttachmentPath(containerPath) {
  const normalizedPath = String(containerPath || "").trim();
  if (!normalizedPath) {
    return false;
  }
  return sendTerminalData(`\u001b[200~[${normalizedPath}] \u001b[201~`);
}

async function uploadDroppedAttachment(file) {
  const attachment = await uploadIssueSessionCodexAttachment(sessionId.value, file);
  if (attachment?.ok === false) {
    throw new Error(attachment.error || attachment.errors?.[0]?.message || "Attachment upload failed.");
  }
  if (!(await injectAttachmentPath(attachment.containerPath))) {
    throw new Error("Attachment path could not be sent to Codex.");
  }
  return attachment;
}

async function handleAttachmentDrop(event) {
  attachmentDragDepth.value = 0;
  const files = filesFromDropEvent(event);
  if (!files.length) {
    return;
  }
  attachmentUploading.value = true;
  attachmentStatus.value = "";
  try {
    if (!(await ensureTerminalReady())) {
      return;
    }
    const uploaded = [];
    for (const file of files) {
      uploaded.push(await uploadDroppedAttachment(file));
    }
    const label = uploaded.length === 1
      ? uploaded[0].fileName
      : `${uploaded.length} files`;
    attachmentStatus.value = `${label} attached. Press Enter in Codex when ready.`;
    focusTerminal();
  } catch (error) {
    attachmentStatus.value = String(error?.message || error || "Attachment upload failed.");
  } finally {
    attachmentUploading.value = false;
  }
}

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

async function sendCodexShellCommand(command) {
  const normalizedCommand = String(command || "").trim();
  if (!normalizedCommand) {
    return false;
  }

  const keySequence = [
    "\u001b",
    "\u0015",
    "! ",
    normalizedCommand,
    " ",
    "\u001b",
    "\r"
  ];
  for (const keyInput of keySequence) {
    if (!(await sendTerminalData(keyInput))) {
      return false;
    }
    await delay(CODEX_KEY_PAUSE_MS);
  }
  return true;
}

async function captureCodexThreadFromOutput(output) {
  if (!codexThreadCaptureRequired.value || codexThreadId.value || !sessionId.value) {
    return false;
  }
  if (codexThreadSavePromise) {
    return codexThreadSavePromise;
  }
  const threadId = extractCodexThreadId(output);
  if (!threadId) {
    return false;
  }

  codexThreadSavePromise = (async () => {
    const response = await saveIssueSessionCodexThread(sessionId.value, threadId);
    if (response?.ok === false) {
      throw new Error(response.error || response.errors?.[0]?.message || "Codex thread id could not be saved.");
    }
    codexThreadId.value = response.codexThreadId || threadId;
    codexThreadCaptureRequired.value = false;
    emit("session-update", {
      codexThreadId: codexThreadId.value,
      needsThreadCapture: false,
      sessionId: sessionId.value
    });
    copyStatus.value = "Codex session captured.";
    return true;
  })();

  try {
    return await codexThreadSavePromise;
  } catch (saveError) {
    terminalError.value = String(saveError?.message || saveError || "Codex thread id could not be saved.");
    return false;
  } finally {
    codexThreadSavePromise = null;
  }
}

function waitForCodexThreadId() {
  if (codexThreadId.value || !codexThreadCaptureRequired.value) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (codexThreadId.value || !codexThreadCaptureRequired.value) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - startedAt > 12000) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 250);
  });
}

function canCaptureCodexThread() {
  return Boolean(
    terminalSessionId.value &&
    sessionId.value &&
    codexThreadCaptureRequired.value &&
    !codexThreadId.value &&
    terminalStatus.value !== "exited"
  );
}

function visibleTerminalText() {
  const buffer = terminalInstance?.buffer?.active;
  if (!buffer || !terminalInstance) {
    return "";
  }
  const startLine = Math.max(0, buffer.baseY + buffer.viewportY);
  const endLine = Math.min(buffer.length, startLine + terminalInstance.rows);
  const lines = [];
  for (let lineIndex = startLine; lineIndex < endLine; lineIndex += 1) {
    lines.push(buffer.getLine(lineIndex)?.translateToString(true) || "");
  }
  return lines.join("\n").trim();
}

function codexTrustPromptIsBlocking() {
  const visibleText = visibleTerminalText();
  const trustPromptVisible = visibleText
    ? codexTrustPromptLooksActive(visibleText)
    : codexTrustPromptLooksActive(terminalLatestOutput);
  return trustPromptVisible &&
    (!codexTrustPromptAnsweredAt || terminalLastOutputAt <= codexTrustPromptAnsweredAt);
}

function codexBootLooksReady() {
  if (!terminalStartedAt || !terminalHasOutput) {
    return false;
  }
  if (codexTrustPromptIsBlocking()) {
    copyStatus.value = "Answer the Codex trust prompt in the terminal to continue.";
    return false;
  }
  const now = Date.now();
  return now - terminalStartedAt >= CODEX_BOOT_MIN_AGE_MS &&
    now - terminalLastOutputAt >= CODEX_BOOT_QUIET_MS;
}

async function waitForCodexBootReady() {
  if (codexBootLooksReady()) {
    return true;
  }

  return new Promise((resolve) => {
    let startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (codexBootLooksReady()) {
        window.clearInterval(timer);
        resolve(true);
        return;
      }
      if (codexTrustPromptIsBlocking()) {
        startedAt = Date.now();
        return;
      }
      if (Date.now() - startedAt > CODEX_BOOT_TIMEOUT_MS) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 250);
  });
}

async function ensureCodexThreadReady({ forceRetry = false } = {}) {
  if (codexThreadId.value || !codexThreadCaptureRequired.value) {
    return true;
  }
  if (codexThreadCapturePromise) {
    return codexThreadCapturePromise;
  }

  codexThreadCapturePromise = (async () => {
    if (!canCaptureCodexThread()) {
      return false;
    }
    if (!codexThreadCaptureStarted.value || forceRetry) {
      await waitForCodexBootReady();
      codexThreadCaptureStarted.value = true;
      const sent = await sendCodexShellCommand(DEFAULT_CODEX_THREAD_COMMAND);
      if (!sent) {
        codexThreadCaptureStarted.value = false;
        return false;
      }
    }
    const ready = await waitForCodexThreadId();
    if (!ready) {
      terminalError.value = "Waiting for Codex thread id before injecting prompt.";
    }
    return ready;
  })();

  try {
    return await codexThreadCapturePromise;
  } finally {
    codexThreadCapturePromise = null;
  }
}

async function injectPrompt() {
  if (!codexPrompt.value) {
    return false;
  }
  expanded.value = true;
  injectingPrompt.value = true;
  try {
    if (await ensureTerminalReady() && await ensureCodexThreadReady({ forceRetry: true })) {
      const promptOutputSnapshot = terminalLatestOutput;
      const sent = await sendTerminalData(`\u001b[200~${codexPrompt.value}\u001b[201~\r`);
      if (sent) {
        autoPromptInjected.value = true;
        copyStatus.value = "Prompt injected into Codex.";
        emit("prompt-injected", {
          outputSnapshot: promptOutputSnapshot,
          outputStart: promptOutputSnapshot.length,
          prompt: codexPrompt.value,
          sessionId: sessionId.value
        });
      }
      return sent;
    }
    return false;
  } finally {
    injectingPrompt.value = false;
  }
}

async function injectPromptForRequest() {
  const requestKey = manualPromptInjectionRequestKey.value;
  if (!componentMounted.value || !requestKey || handledPromptInjectionRequestKey === requestKey) {
    return;
  }
  handledPromptInjectionRequestKey = requestKey;
  if (await injectPrompt()) {
    clearPromptInjectionRetry();
    return;
  }
  if (handledPromptInjectionRequestKey === requestKey) {
    handledPromptInjectionRequestKey = "";
    schedulePromptInjectionRetry(requestKey);
  }
}

function clearPromptInjectionRetry() {
  promptInjectionRetryStartedAt = 0;
  if (promptInjectionRetryTimer) {
    window.clearTimeout(promptInjectionRetryTimer);
    promptInjectionRetryTimer = null;
  }
}

function schedulePromptInjectionRetry(requestKey) {
  if (
    !componentMounted.value ||
    !requestKey ||
    manualPromptInjectionRequestKey.value !== requestKey
  ) {
    clearPromptInjectionRetry();
    return;
  }
  if (!promptInjectionRetryStartedAt) {
    promptInjectionRetryStartedAt = Date.now();
  }
  if (Date.now() - promptInjectionRetryStartedAt > PROMPT_INJECTION_RETRY_TIMEOUT_MS) {
    emit("prompt-injection-failed", {
      error: "Prompt injection timed out before the Codex terminal accepted the request.",
      requestKey,
      sessionId: sessionId.value
    });
    clearPromptInjectionRetry();
    return;
  }
  if (promptInjectionRetryTimer) {
    return;
  }
  promptInjectionRetryTimer = window.setTimeout(() => {
    promptInjectionRetryTimer = null;
    void injectPromptForRequest();
  }, PROMPT_INJECTION_RETRY_MS);
}

async function sendCtrlC() {
  await sendTerminalData("\u0003", {
    source: "user"
  });
}

async function closeTerminal() {
  const existingTerminalId = terminalSessionId.value;
  detachTerminal();
  if (existingTerminalId && sessionId.value) {
    await closeIssueSessionCodexTerminal(sessionId.value, existingTerminalId).catch(() => null);
  }
}

async function recoverMissingTerminal() {
  if (!canUseTerminal.value) {
    terminalError.value = "Terminal session not found.";
    return false;
  }
  if (terminalRecoveryPromise) {
    return terminalRecoveryPromise;
  }

  terminalRecoveryPromise = (async () => {
    const recoveredSessionId = sessionId.value;
    closeTerminalSocket();
    terminalSessionId.value = "";
    terminalStatus.value = "";
    terminalCommandPreview.value = "";
    codexThreadCaptureStarted.value = false;
    terminalError.value = "";
    copyStatus.value = "Studio server restarted; reconnecting Codex.";
    if (terminalInstance) {
      terminalInstance.reset();
    }
    terminalOutputOffset = 0;
    terminalLatestOutput = "";
    emitTerminalOutputNow("");
    terminalHasOutput = false;
    terminalStartedAt = 0;

    if (recoveredSessionId !== sessionId.value) {
      return false;
    }
    const ready = await ensureTerminalReady();
    return ready;
  })();

  try {
    return await terminalRecoveryPromise;
  } finally {
    terminalRecoveryPromise = null;
  }
}

function detachTerminal() {
  terminalSessionId.value = "";
  terminalStatus.value = "";
  terminalCommandPreview.value = "";
  codexThreadId.value = "";
  codexThreadCaptureRequired.value = false;
  codexThreadCaptureStarted.value = false;
  disposeTerminalUi();
}

async function restartTerminal() {
  terminalError.value = "";
  expanded.value = true;
  await closeTerminal();
  await ensureTerminalReady();
}

function toggleExpanded() {
  expanded.value = !expanded.value;
  if (expanded.value) {
    void ensureTerminalReady();
  }
}

function startTerminalWhenReady() {
  if (!canUseTerminal.value) {
    return;
  }
  void ensureTerminalReady();
}

watch(sessionId, async (nextSessionId, previousSessionId) => {
  if (previousSessionId && previousSessionId !== nextSessionId) {
    detachTerminal();
  }
  autoPromptInjected.value = false;
  handledPromptInjectionRequestKey = "";
  attachmentDragDepth.value = 0;
  attachmentStatus.value = "";
  expanded.value = defaultExpanded();
  startTerminalWhenReady();
});

watch(canUseTerminal, (ready) => {
  if (ready) {
    startTerminalWhenReady();
  }
});

watch(terminalHost, (host) => {
  if (host) {
    void setupTerminalUi();
    startTerminalWhenReady();
  }
}, {
  flush: "post"
});

watch(manualPromptInjectionRequestKey, (nextRequestKey) => {
  clearPromptInjectionRetry();
  if (nextRequestKey) {
    expanded.value = true;
    void injectPromptForRequest();
  }
});

watch(codexPrompt, (nextPrompt, previousPrompt) => {
  if (nextPrompt === previousPrompt) {
    return;
  }
  autoPromptInjected.value = false;
  handledPromptInjectionRequestKey = "";
});

watch(() => [
  props.session?.codexThreadId || "",
  props.session?.needsThreadCapture === true
], () => {
  applyCodexThreadState(props.session || {});
}, {
  immediate: true
});

watch(() => props.visible, async (visible) => {
  if (!visible) {
    return;
  }
  await nextTick();
  terminalFitAddon?.fit();
  startTerminalWhenReady();
});

onMounted(() => {
  componentMounted.value = true;
  expanded.value = defaultExpanded();
  void nextTick().then(() => {
    startTerminalWhenReady();
    void injectPromptForRequest();
  });
  void injectPromptForRequest();
});

onBeforeUnmount(() => {
  clearPromptInjectionRetry();
  detachTerminal();
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
