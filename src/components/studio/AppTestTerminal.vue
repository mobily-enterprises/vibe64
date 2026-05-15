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

    <StudioErrorNotice
      v-if="terminalError"
      title="App test terminal needs attention"
      :error="terminalError"
      compact
      class="mb-2"
    />

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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";

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

const appUrl = ref("");
const startedSessionId = ref("");
let terminalStartPromise = null;

const isSessionScope = computed(() => props.scope === "session");
const sessionId = computed(() => props.session?.sessionId || "");
const {
  applyTerminalSession,
  closeTerminalSocket,
  connectTerminalSocket,
  disposeTerminalUi,
  resetTerminalDisplay,
  resetTerminalSessionState,
  sendCtrlC,
  setupTerminalUi,
  terminalCommandPreview,
  terminalError,
  terminalExited,
  terminalExitCode,
  terminalHost,
  terminalSessionId,
  terminalStarting,
  terminalStatus
} = useStudioTerminal({
  onSessionUpdate(session = {}) {
    const metadata = session.metadata || {};
    const nextAppUrl = session.appUrl || metadata.appUrl || "";
    if (nextAppUrl) {
      appUrl.value = nextAppUrl;
    }
  },
  webSocketUrl() {
    if (isSessionScope.value) {
      return sessionId.value
        ? issueSessionAppTestTerminalWebSocketUrl(sessionId.value, terminalSessionId.value)
        : "";
    }
    return currentAppTestTerminalWebSocketUrl(terminalSessionId.value);
  }
});

const canStart = computed(() => props.visible && (!isSessionScope.value || Boolean(sessionId.value)));
const canRetry = computed(() => terminalExited.value && terminalExitCode.value !== 0);

function delay(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
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

function applyStartedTerminal(session = {}, popupWindow = null) {
  const metadata = session.metadata || {};
  startedSessionId.value = isSessionScope.value ? sessionId.value : "";
  appUrl.value = session.appUrl || metadata.appUrl || "";
  applyTerminalSession(session, {
    fallbackStatus: "running"
  });
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

async function closeTerminal({
  sessionIdOverride = ""
} = {}) {
  const existingTerminalId = terminalSessionId.value;
  const closeSessionId = sessionIdOverride || startedSessionId.value || sessionId.value;
  resetTerminalSessionState();
  startedSessionId.value = "";
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
  resetTerminalSessionState();
  startedSessionId.value = "";
  appUrl.value = "";
  resetTerminalDisplay();
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
