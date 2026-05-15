<template>
  <v-sheet rounded="lg" class="session-step-terminal">
    <div class="session-step-terminal__bar">
      <div>
        <div class="session-step-terminal__title">Installing dependencies</div>
        <div class="session-step-terminal__subtitle">Codex starts after this command succeeds.</div>
      </div>
      <div class="session-step-terminal__actions">
        <v-btn
          v-if="canRetry"
          color="primary"
          :loading="terminalStarting"
          size="small"
          variant="flat"
          @click="restartTerminal"
        >
          Retry
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

    <v-alert v-if="terminalError" type="error" variant="tonal" density="compact" class="mb-2">
      {{ terminalError }}
    </v-alert>

    <div ref="terminalHost" class="session-step-terminal__host" />

    <div class="session-step-terminal__footer">
      <span>{{ terminalCommandPreview || "Preparing terminal..." }}</span>
      <v-chip v-if="terminalStatus" size="x-small" variant="tonal">
        {{ terminalStatus }}
      </v-chip>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  closeIssueSessionStepTerminal,
  issueSessionStepTerminalWebSocketUrl,
  startIssueSessionStepTerminal
} from "@/lib/studioApi.js";
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

const emit = defineEmits(["finished"]);

const terminalHost = ref(null);
const terminalSessionId = ref("");
const terminalStatus = ref("");
const terminalCommandPreview = ref("");
const terminalError = ref("");
const terminalExitCode = ref(null);
const terminalStarting = ref(false);
const terminalClosedByUser = ref(false);

let terminalInstance = null;
let terminalFitAddon = null;
let terminalSocket = null;
let terminalSocketOpenPromise = null;
let terminalDataDisposable = null;
let terminalResizeHandler = null;
let terminalLatestOutput = "";
let terminalOutputOffset = 0;
let terminalSetupPromise = null;
let terminalStartPromise = null;
let finishedEmittedForTerminalId = "";

const FINISHED_TERMINAL_HOLD_MS = 2500;

const sessionId = computed(() => props.session?.sessionId || "");
const canRunSetupTerminal = computed(() => (
  props.visible &&
  sessionId.value &&
  props.session?.currentStep === "dependencies_installed"
));
const terminalExited = computed(() => terminalStatus.value === "exited");
const canRetry = computed(() => canRunSetupTerminal.value && (
  Boolean(terminalError.value) ||
  terminalClosedByUser.value ||
  (terminalExited.value && terminalExitCode.value !== 0)
));

function trimTerminalOutput(output) {
  const text = String(output || "");
  const maxLength = 160000;
  return text.length <= maxLength ? text : text.slice(text.length - maxLength);
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
    if (terminalInstance) {
      return true;
    }
    if (!terminalHost.value) {
      return false;
    }
    terminalHost.value.replaceChildren();
    terminalInstance = new Terminal({
      convertEol: true,
      cursorBlink: false,
      disableStdin: false,
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
    terminalFitAddon.fit();
    terminalDataDisposable = terminalInstance.onData((data) => {
      void sendTerminalData(data);
    });
    terminalResizeHandler = () => {
      terminalFitAddon?.fit();
    };
    window.addEventListener("resize", terminalResizeHandler);
    writeTerminalOutput(terminalLatestOutput);
    return true;
  })();

  try {
    return await terminalSetupPromise;
  } finally {
    terminalSetupPromise = null;
  }
}

function disposeTerminalUi() {
  closeTerminalSocket();
  terminalDataDisposable?.dispose?.();
  terminalDataDisposable = null;
  if (terminalResizeHandler) {
    window.removeEventListener("resize", terminalResizeHandler);
    terminalResizeHandler = null;
  }
  terminalInstance?.dispose?.();
  terminalInstance = null;
  terminalFitAddon = null;
  terminalSetupPromise = null;
  terminalOutputOffset = 0;
}

function writeTerminalOutput(output) {
  terminalLatestOutput = trimTerminalOutput(output);
  if (!terminalInstance) {
    return;
  }
  if (terminalLatestOutput.length < terminalOutputOffset) {
    terminalOutputOffset = 0;
    terminalInstance.reset();
  }
  const chunk = terminalLatestOutput.slice(terminalOutputOffset);
  if (chunk) {
    terminalInstance.write(chunk);
    terminalOutputOffset = terminalLatestOutput.length;
  }
}

function appendTerminalOutput(chunk) {
  const outputChunk = String(chunk || "");
  if (!outputChunk) {
    return;
  }
  terminalLatestOutput = trimTerminalOutput(`${terminalLatestOutput}${outputChunk}`);
  if (terminalInstance) {
    terminalInstance.write(outputChunk);
    terminalOutputOffset = terminalLatestOutput.length;
  }
}

function closeTerminalSocket() {
  const socket = terminalSocket;
  terminalSocket = null;
  terminalSocketOpenPromise = null;
  if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
    socket.close();
  }
}

function scheduleFinished(exitCode) {
  if (!terminalSessionId.value || finishedEmittedForTerminalId === terminalSessionId.value) {
    return;
  }
  finishedEmittedForTerminalId = terminalSessionId.value;
  window.setTimeout(() => {
    emit("finished", {
      exitCode,
      sessionId: sessionId.value
    });
  }, FINISHED_TERMINAL_HOLD_MS);
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
    const session = message.session || {};
    terminalStatus.value = session.status || terminalStatus.value || "";
    terminalExitCode.value = session.status === "exited" ? session.exitCode ?? null : null;
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
    terminalError.value = String(session.closeError || terminalError.value || "");
    writeTerminalOutput(session.output || "");
    if (session.status === "exited") {
      scheduleFinished(session.exitCode);
    }
    return;
  }

  if (message?.type === "output") {
    appendTerminalOutput(message.chunk);
    return;
  }

  if (message?.type === "status") {
    terminalStatus.value = message.status || terminalStatus.value || "";
    terminalExitCode.value = message.status === "exited" ? message.exitCode ?? null : null;
    terminalError.value = String(message.closeError || terminalError.value || "");
    if (message.status === "exited") {
      scheduleFinished(message.exitCode);
    }
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

  terminalSocketOpenPromise = new Promise((resolve) => {
    let settled = false;
    const socket = new WebSocket(issueSessionStepTerminalWebSocketUrl(sessionId.value, terminalSessionId.value));
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
    });
  });

  return terminalSocketOpenPromise;
}

async function startTerminal() {
  if (!canRunSetupTerminal.value) {
    return false;
  }
  if (terminalStartPromise) {
    return terminalStartPromise;
  }
  terminalStartPromise = (async () => {
    terminalStarting.value = true;
    terminalError.value = "";
    if (!(await setupTerminalUi())) {
      terminalError.value = "Terminal view is not ready yet.";
      return false;
    }
    try {
      terminalClosedByUser.value = false;
      const session = await startIssueSessionStepTerminal(sessionId.value);
      if (session?.ok === false) {
        throw new Error(session.error || session.errors?.[0]?.message || "Setup terminal failed to start.");
      }
      terminalSessionId.value = session.id || "";
      terminalStatus.value = session.status || "running";
      terminalExitCode.value = session.status === "exited" ? session.exitCode ?? null : null;
      terminalCommandPreview.value = session.commandPreview || "";
      writeTerminalOutput(session.output || "");
      return connectTerminalSocket();
    } catch (error) {
      terminalError.value = String(error?.message || error || "Setup terminal failed to start.");
      return false;
    } finally {
      terminalStarting.value = false;
    }
  })();

  try {
    return await terminalStartPromise;
  } finally {
    terminalStartPromise = null;
  }
}

async function sendTerminalData(data) {
  if (!terminalSessionId.value || terminalStatus.value === "exited") {
    return false;
  }
  if (!(await connectTerminalSocket()) || terminalSocket?.readyState !== WebSocket.OPEN) {
    terminalError.value = "Terminal stream is not connected.";
    return false;
  }
  terminalSocket.send(JSON.stringify({
    data: String(data || ""),
    type: "input"
  }));
  return true;
}

async function sendCtrlC() {
  await sendTerminalData("\u0003");
}

async function closeTerminal() {
  const existingTerminalId = terminalSessionId.value;
  terminalSessionId.value = "";
  terminalStatus.value = "";
  terminalExitCode.value = null;
  terminalClosedByUser.value = true;
  terminalError.value = terminalError.value || "Setup terminal is closed. Retry when you are ready to install dependencies again.";
  closeTerminalSocket();
  if (existingTerminalId && sessionId.value) {
    await closeIssueSessionStepTerminal(sessionId.value, existingTerminalId).catch(() => null);
  }
}

async function restartTerminal() {
  await closeTerminal();
  terminalLatestOutput = "";
  terminalOutputOffset = 0;
  finishedEmittedForTerminalId = "";
  terminalClosedByUser.value = false;
  terminalInstance?.reset?.();
  await startTerminal();
}

watch(sessionId, () => {
  terminalSessionId.value = "";
  terminalStatus.value = "";
  terminalExitCode.value = null;
  terminalCommandPreview.value = "";
  terminalError.value = "";
  terminalLatestOutput = "";
  terminalOutputOffset = 0;
  finishedEmittedForTerminalId = "";
  terminalClosedByUser.value = false;
  terminalInstance?.reset?.();
  closeTerminalSocket();
});

defineExpose({
  start: startTerminal
});

onBeforeUnmount(() => {
  disposeTerminalUi();
});
</script>

<style scoped>
.session-step-terminal {
  min-width: 0;
  padding: 0.75rem;
}

.session-step-terminal__bar,
.session-step-terminal__footer {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.session-step-terminal__bar {
  margin-bottom: 0.5rem;
}

.session-step-terminal__title {
  font-size: 0.85rem;
  font-weight: 700;
}

.session-step-terminal__subtitle,
.session-step-terminal__footer {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.75rem;
}

.session-step-terminal__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
}

.session-step-terminal__host {
  background: #101216;
  border: 2px solid rgba(var(--v-theme-outline), 0.38);
  border-radius: 6px;
  height: clamp(37rem, 72vh, 56rem);
  overflow: hidden;
  padding: 0.35rem;
}

.session-step-terminal__footer {
  margin-top: 0.5rem;
}

.session-step-terminal__footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .session-step-terminal__bar,
  .session-step-terminal__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .session-step-terminal__host {
    height: min(74vh, 44rem);
  }
}
</style>
