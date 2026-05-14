<template>
  <v-sheet rounded="lg" class="app-test-terminal">
    <div class="app-test-terminal__bar">
      <div class="app-test-terminal__heading">
        <div class="app-test-terminal__title">{{ title }}</div>
        <div class="app-test-terminal__subtitle">
          {{ appUrl || "Builds the app, starts the local server, and keeps logs open." }}
        </div>
      </div>
      <div class="app-test-terminal__actions">
        <v-btn
          v-if="appUrl"
          :href="appUrl"
          target="_blank"
          rel="noreferrer"
          color="primary"
          size="small"
          variant="tonal"
          :prepend-icon="mdiOpenInNew"
        >
          Open app
        </v-btn>
        <v-btn
          v-if="!terminalSessionId || canRetry"
          color="primary"
          :loading="terminalStarting"
          size="small"
          variant="flat"
          :prepend-icon="mdiPlay"
          @click="start()"
        >
          {{ canRetry ? "Retry" : "Start" }}
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
          size="small"
          variant="text"
          @click="closeTerminal()"
        >
          Close
        </v-btn>
      </div>
    </div>

    <v-alert v-if="terminalError" type="error" variant="tonal" density="compact" class="mb-2">
      {{ terminalError }}
    </v-alert>

    <div ref="terminalHost" class="app-test-terminal__host" />

    <div class="app-test-terminal__footer">
      <span>{{ terminalCommandPreview || "Ready to run the app test." }}</span>
      <v-chip v-if="terminalStatus" size="x-small" variant="tonal">
        {{ terminalStatus }}
      </v-chip>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  mdiOpenInNew,
  mdiPlay
} from "@mdi/js";
import {
  closeCurrentAppTestTerminal,
  closeIssueSessionAppTestTerminal,
  currentAppTestTerminalWebSocketUrl,
  issueSessionAppTestTerminalWebSocketUrl,
  startCurrentAppTestTerminal,
  startIssueSessionAppTestTerminal
} from "@/lib/studioApi.js";
import "@xterm/xterm/css/xterm.css";

const props = defineProps({
  session: {
    type: Object,
    default: null
  },
  scope: {
    type: String,
    default: "target",
    validator: (value) => ["target", "session"].includes(value)
  },
  title: {
    type: String,
    default: "Test app"
  },
  visible: {
    type: Boolean,
    default: true
  }
});

const emit = defineEmits(["closed", "started"]);

const terminalHost = ref(null);
const terminalSessionId = ref("");
const terminalStatus = ref("");
const terminalCommandPreview = ref("");
const terminalError = ref("");
const terminalExitCode = ref(null);
const terminalStarting = ref(false);
const appUrl = ref("");
const startedSessionId = ref("");

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

const isSessionScope = computed(() => props.scope === "session");
const sessionId = computed(() => props.session?.sessionId || "");
const canStart = computed(() => props.visible && (!isSessionScope.value || Boolean(sessionId.value)));
const terminalExited = computed(() => terminalStatus.value === "exited");
const canRetry = computed(() => terminalExited.value && terminalExitCode.value !== 0);

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function trimTerminalOutput(output) {
  const text = String(output || "");
  const maxLength = 160000;
  return text.length <= maxLength ? text : text.slice(text.length - maxLength);
}

async function setupTerminalUi() {
  if (terminalInstance) {
    await nextTick();
    terminalFitAddon?.fit();
    return true;
  }
  if (terminalSetupPromise) {
    return terminalSetupPromise;
  }

  terminalSetupPromise = (async () => {
    await nextTick();
    if (terminalInstance) {
      terminalFitAddon?.fit();
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

async function waitForReachableUrl(url, {
  intervalMs = 1000,
  timeoutMs = 120000
} = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      await fetch(url, {
        cache: "no-store",
        mode: "no-cors"
      });
      return true;
    } catch {
      await delay(intervalMs);
    }
  }
  return false;
}

async function openAppWhenReachable(popupWindow, url) {
  if (!popupWindow || !url) {
    return;
  }
  await waitForReachableUrl(url);
  if (!popupWindow.closed) {
    popupWindow.location.href = url;
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
    const metadata = session.metadata || {};
    terminalStatus.value = session.status || terminalStatus.value || "";
    terminalExitCode.value = session.status === "exited" ? session.exitCode ?? null : null;
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
    appUrl.value = metadata.appUrl || appUrl.value;
    writeTerminalOutput(session.output || "");
    return;
  }

  if (message?.type === "output") {
    appendTerminalOutput(message.chunk);
    return;
  }

  if (message?.type === "status") {
    terminalStatus.value = message.status || terminalStatus.value || "";
    terminalExitCode.value = message.status === "exited" ? message.exitCode ?? null : null;
    return;
  }

  if (message?.type === "error") {
    terminalError.value = String(message.error || "Terminal stream failed.");
  }
}

function terminalWebSocketUrl() {
  if (isSessionScope.value) {
    return issueSessionAppTestTerminalWebSocketUrl(sessionId.value, terminalSessionId.value);
  }
  return currentAppTestTerminalWebSocketUrl(terminalSessionId.value);
}

async function connectTerminalSocket() {
  if (!terminalSessionId.value || (isSessionScope.value && !sessionId.value)) {
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
    const socket = new WebSocket(terminalWebSocketUrl());
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

function applyStartedTerminal(session = {}, popupWindow = null) {
  const metadata = session.metadata || {};
  terminalSessionId.value = session.id || "";
  startedSessionId.value = isSessionScope.value ? sessionId.value : "";
  terminalStatus.value = session.status || "running";
  terminalExitCode.value = session.status === "exited" ? session.exitCode ?? null : null;
  terminalCommandPreview.value = session.commandPreview || "";
  appUrl.value = session.appUrl || metadata.appUrl || "";
  writeTerminalOutput(session.output || "");
  if (popupWindow && appUrl.value) {
    void openAppWhenReachable(popupWindow, appUrl.value);
  }
  emit("started", {
    appUrl: appUrl.value,
    terminalSessionId: terminalSessionId.value
  });
}

async function start({ popupWindow = null } = {}) {
  if (!canStart.value) {
    terminalError.value = "App test terminal is not ready yet.";
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
      const session = isSessionScope.value
        ? await startIssueSessionAppTestTerminal(sessionId.value)
        : await startCurrentAppTestTerminal();
      if (session?.ok === false) {
        throw new Error(session.error || session.errors?.[0]?.message || "App test terminal failed to start.");
      }
      applyStartedTerminal(session, popupWindow);
      return connectTerminalSocket();
    } catch (error) {
      terminalError.value = String(error?.message || error || "App test terminal failed to start.");
      popupWindow?.close?.();
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

async function closeTerminal({
  sessionIdOverride = ""
} = {}) {
  const existingTerminalId = terminalSessionId.value;
  const closeSessionId = sessionIdOverride || startedSessionId.value || sessionId.value;
  terminalSessionId.value = "";
  startedSessionId.value = "";
  terminalStatus.value = "";
  terminalExitCode.value = null;
  terminalCommandPreview.value = "";
  appUrl.value = "";
  closeTerminalSocket();
  if (existingTerminalId) {
    if (isSessionScope.value && closeSessionId) {
      await closeIssueSessionAppTestTerminal(closeSessionId, existingTerminalId).catch(() => null);
    } else {
      await closeCurrentAppTestTerminal(existingTerminalId).catch(() => null);
    }
  }
  emit("closed");
}

watch(() => props.visible, (visible) => {
  if (visible) {
    void setupTerminalUi();
  }
});

watch(sessionId, (nextSessionId, previousSessionId) => {
  if (
    isSessionScope.value &&
    previousSessionId &&
    nextSessionId !== previousSessionId &&
    terminalSessionId.value
  ) {
    void closeTerminal({
      sessionIdOverride: previousSessionId
    });
    return;
  }
  terminalSessionId.value = "";
  startedSessionId.value = "";
  terminalStatus.value = "";
  terminalExitCode.value = null;
  terminalCommandPreview.value = "";
  terminalError.value = "";
  appUrl.value = "";
  terminalLatestOutput = "";
  terminalOutputOffset = 0;
  terminalInstance?.reset?.();
  closeTerminalSocket();
});

onMounted(() => {
  void setupTerminalUi();
});

onBeforeUnmount(() => {
  disposeTerminalUi();
});

defineExpose({
  closeTerminal,
  start
});
</script>

<style scoped>
.app-test-terminal {
  min-width: 0;
  padding: 0.75rem;
}

.app-test-terminal__bar,
.app-test-terminal__footer {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.app-test-terminal__bar {
  margin-bottom: 0.5rem;
}

.app-test-terminal__heading {
  min-width: 0;
}

.app-test-terminal__title {
  font-size: 0.85rem;
  font-weight: 700;
}

.app-test-terminal__subtitle,
.app-test-terminal__footer {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.75rem;
}

.app-test-terminal__subtitle {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-test-terminal__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
}

.app-test-terminal__host {
  background: #101216;
  border: 2px solid rgba(var(--v-theme-outline), 0.38);
  border-radius: 6px;
  height: clamp(24rem, 52vh, 42rem);
  overflow: hidden;
  padding: 0.35rem;
}

.app-test-terminal__footer {
  margin-top: 0.5rem;
}

.app-test-terminal__footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (max-width: 700px) {
  .app-test-terminal__bar,
  .app-test-terminal__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .app-test-terminal__host {
    height: min(62vh, 34rem);
  }
}
</style>
