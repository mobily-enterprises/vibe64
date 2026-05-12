<template>
  <v-sheet
    rounded="lg"
    class="codex-terminal"
    :class="{
      'codex-terminal--desktop-actionless': !codexPrompt,
      'codex-terminal--focused': terminalFocused
    }"
  >
    <div class="codex-terminal__bar">
      <div class="codex-terminal__actions">
        <v-btn
          v-if="codexPrompt"
          :disabled="!canUseTerminal || terminalStarting"
          :loading="injectingPrompt"
          :prepend-icon="mdiSend"
          size="small"
          variant="tonal"
          @click="injectPrompt"
        >
          {{ promptActionLabel }}
        </v-btn>
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
        <v-alert v-if="terminalError" type="error" variant="tonal" density="compact" class="mb-2">
          {{ terminalError }}
        </v-alert>

        <div ref="terminalHost" class="codex-terminal__host" @click="focusTerminal" />

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
              v-if="terminalExited"
              color="primary"
              :loading="terminalStarting"
              :prepend-icon="mdiRestart"
              size="small"
              variant="tonal"
              @click="restartTerminal"
            >
              Restart
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

        <p v-if="copyStatus" class="text-caption text-medium-emphasis mb-0">{{ copyStatus }}</p>
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
  mdiRestart,
  mdiSend
} from "@mdi/js";
import {
  closeIssueSessionCodexTerminal,
  issueSessionCodexTerminalWebSocketUrl,
  saveIssueSessionCodexThread,
  startIssueSessionCodexTerminal
} from "@/lib/studioApi.js";
import {
  extractCodexThreadId,
  stripTerminalControlSequences
} from "@/lib/codexOutput.js";
import "@xterm/xterm/css/xterm.css";

const props = defineProps({
  session: {
    type: Object,
    default: null
  },
  visible: {
    type: Boolean,
    default: true
  }
});
const emit = defineEmits(["output"]);

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
const autoInjectedPromptKey = ref("");
const autoPromptInjected = ref(false);
const componentMounted = ref(false);
const codexThreadId = ref("");
const codexThreadCaptureRequired = ref(false);
const codexThreadCaptureStarted = ref(false);

let terminalInstance = null;
let terminalFitAddon = null;
let terminalDataDisposable = null;
let terminalFocusDisposable = null;
let terminalBlurDisposable = null;
let terminalSelectionDisposable = null;
let terminalFocusInHandler = null;
let terminalFocusOutHandler = null;
let terminalOutsidePointerHandler = null;
let terminalResizeHandler = null;
let terminalSocket = null;
let terminalSocketOpenPromise = null;
let terminalSetupPromise = null;
let terminalOutputOffset = 0;
let terminalStartPromise = null;
let codexThreadCapturePromise = null;
let codexThreadSavePromise = null;
let terminalHasOutput = false;
let terminalLatestOutput = "";
let terminalLastOutputAt = 0;
let terminalStartedAt = 0;

const DEFAULT_CODEX_THREAD_COMMAND = "echo $CODEX_THREAD_ID";
const CODEX_BOOT_MIN_AGE_MS = 1800;
const CODEX_BOOT_QUIET_MS = 900;
const CODEX_BOOT_TIMEOUT_MS = 12000;
const CODEX_KEY_PAUSE_MS = 180;

const sessionId = computed(() => props.session?.sessionId || "");
const canUseTerminal = computed(() => Boolean(sessionId.value && props.session?.worktree));
const codexMode = computed(() => String(props.session?.codex?.mode || ""));
const codexPrompt = computed(() => {
  const promptField = String(props.session?.codex?.promptField || "");
  return promptField ? String(props.session?.[promptField] || "") : "";
});
const codexPromptInjectionKey = computed(() => {
  if (codexMode.value !== "inject_prompt" || !codexPrompt.value || !sessionId.value) {
    return "";
  }
  return `${sessionId.value}:${hashText(codexPrompt.value)}`;
});
const promptActionLabel = computed(() => autoPromptInjected.value ? "Re-inject Prompt" : "Inject Prompt");
const terminalExited = computed(() => terminalStatus.value === "exited");
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

function hashText(value) {
  let hash = 2166136261;
  for (const character of String(value || "")) {
    hash ^= character.codePointAt(0) || 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
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

function disposeTerminalUi() {
  closeTerminalSocket();
  if (terminalDataDisposable) {
    terminalDataDisposable.dispose();
    terminalDataDisposable = null;
  }
  if (terminalFocusDisposable) {
    terminalFocusDisposable.dispose();
    terminalFocusDisposable = null;
  }
  if (terminalBlurDisposable) {
    terminalBlurDisposable.dispose();
    terminalBlurDisposable = null;
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
  if (terminalOutsidePointerHandler) {
    document.removeEventListener("pointerdown", terminalOutsidePointerHandler, true);
    terminalOutsidePointerHandler = null;
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
      void sendTerminalData(data);
    });
    terminalFocusDisposable = terminalInstance.onFocus(() => {
      terminalFocused.value = true;
    });
    terminalBlurDisposable = terminalInstance.onBlur(() => {
      window.setTimeout(syncTerminalFocus, 0);
    });
    terminalFocusInHandler = () => {
      terminalFocused.value = true;
    };
    terminalFocusOutHandler = () => {
      window.setTimeout(syncTerminalFocus, 0);
    };
    terminalOutsidePointerHandler = handleDocumentPointerDown;
    terminalHost.value.addEventListener("focusin", terminalFocusInHandler);
    terminalHost.value.addEventListener("focusout", terminalFocusOutHandler);
    document.addEventListener("pointerdown", terminalOutsidePointerHandler, true);
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
  const nextOutput = String(output || "");
  emit("output", nextOutput);
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
  const nextOutput = `${terminalLatestOutput}${outputChunk}`;
  emit("output", nextOutput);
  terminalLatestOutput = nextOutput;
  terminalLastOutputAt = Date.now();
  terminalHasOutput = stripTerminalControlSequences(nextOutput).trim().length > 0;
  void captureCodexThreadFromOutput(nextOutput);
  if (terminalInstance) {
    terminalInstance.write(outputChunk);
  }
  terminalOutputOffset = nextOutput.length;
}

function closeTerminalSocket() {
  const socket = terminalSocket;
  terminalSocket = null;
  terminalSocketOpenPromise = null;
  if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
    socket.close();
  }
}

function applyTerminalSnapshot(session = {}) {
  applyCodexThreadState(session);
  terminalStatus.value = session.status || terminalStatus.value || "";
  terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
  writeTerminalOutput(session.output);
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
    terminalError.value = String(message.error || "Terminal stream failed.");
  }
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

    socket.addEventListener("close", () => {
      if (terminalSocket === socket) {
        terminalSocket = null;
      }
      terminalSocketOpenPromise = null;
      settle(false);
      if (terminalStatus.value !== "exited") {
        terminalStatus.value = terminalSessionId.value ? "disconnected" : "";
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

async function sendTerminalData(data) {
  if (!terminalSessionId.value || terminalStatus.value === "exited") {
    return false;
  }
  try {
    if (!(await connectTerminalSocket()) || terminalSocket?.readyState !== WebSocket.OPEN) {
      throw new Error("Terminal stream is not connected.");
    }
    terminalSocket.send(JSON.stringify({
      data: String(data || ""),
      type: "input"
    }));
    return true;
  } catch (sendError) {
    terminalError.value = String(sendError?.message || sendError || "Terminal input failed.");
    return false;
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
    "!",
    normalizedCommand,
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

function codexBootLooksReady() {
  if (!terminalStartedAt || !terminalHasOutput) {
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
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      if (codexBootLooksReady()) {
        window.clearInterval(timer);
        resolve(true);
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
      const sent = await sendTerminalData(`\u001b[200~${codexPrompt.value}\u001b[201~\r`);
      if (sent) {
        autoPromptInjected.value = true;
        copyStatus.value = "Prompt injected into Codex.";
      }
      return sent;
    }
    return false;
  } finally {
    injectingPrompt.value = false;
  }
}

async function injectPromptAutomatically() {
  const injectionKey = codexPromptInjectionKey.value;
  if (!componentMounted.value || !injectionKey || autoInjectedPromptKey.value === injectionKey) {
    return;
  }
  autoInjectedPromptKey.value = injectionKey;
  autoPromptInjected.value = false;
  if (!(await injectPrompt()) && autoInjectedPromptKey.value === injectionKey) {
    autoInjectedPromptKey.value = "";
  }
}

async function sendCtrlC() {
  await sendTerminalData("\u0003");
}

async function closeTerminal() {
  const existingTerminalId = terminalSessionId.value;
  terminalSessionId.value = "";
  terminalStatus.value = "";
  terminalCommandPreview.value = "";
  codexThreadCaptureRequired.value = false;
  codexThreadCaptureStarted.value = false;
  disposeTerminalUi();
  if (existingTerminalId && sessionId.value) {
    await closeIssueSessionCodexTerminal(sessionId.value, existingTerminalId).catch(() => null);
  }
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
    await closeTerminal();
  }
  autoInjectedPromptKey.value = "";
  autoPromptInjected.value = false;
  expanded.value = defaultExpanded();
  startTerminalWhenReady();
  void injectPromptAutomatically();
});

watch(canUseTerminal, (ready) => {
  if (ready) {
    startTerminalWhenReady();
  }
  if (ready) {
    void injectPromptAutomatically();
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

watch(codexPromptInjectionKey, (nextPromptKey) => {
  if (nextPromptKey) {
    expanded.value = true;
    void injectPromptAutomatically();
  }
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
    void injectPromptAutomatically();
  });
  void injectPromptAutomatically();
});

onBeforeUnmount(() => {
  void closeTerminal();
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
  height: clamp(34rem, 68vh, 52rem);
  overflow: hidden;
  padding: 0.35rem;
  transition: border-color 140ms ease, box-shadow 140ms ease;
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
    height: min(70vh, 42rem);
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
