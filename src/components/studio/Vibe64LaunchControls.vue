<template>
  <div
    v-if="embeddedPreview || visible"
    class="vibe64-launch-controls"
    :class="{
      'vibe64-launch-controls--embedded': embeddedPreview,
      'vibe64-launch-controls--toolbar-teleported': toolbarTeleportTarget,
      'vibe64-launch-controls--prominent': prominent
    }"
  >
    <Teleport
      defer
      :disabled="!toolbarTeleportTarget"
      :to="toolbarTeleportTarget || 'body'"
    >
      <div
        class="vibe64-launch-controls__toolbar"
        :class="[
          { 'vibe64-launch-controls__toolbar--teleported': toolbarTeleportTarget },
          embeddedPreview ? `vibe64-launch-controls__toolbar--${previewToolbarPosition}` : ''
        ]"
      >
        <v-btn
          v-if="embeddedPreview"
          class="vibe64-launch-controls__position-button"
          :disabled="previewToolbarPosition === 'left'"
          :icon="mdiChevronLeft"
          size="small"
          title="Move controls left"
          variant="text"
          @click="movePreviewToolbar(-1)"
        />

        <div
          v-if="launchToolbarDockVisible"
          class="vibe64-launch-controls__dock"
          :title="terminalTitle"
        >
          <span
            class="vibe64-launch-controls__status-dot"
            :class="`vibe64-launch-controls__status-dot--${terminalIndicatorState}`"
            :aria-label="terminalIndicatorLabel"
            :title="terminalIndicatorLabel"
          />

          <v-btn
            v-for="action in launchActions"
            :key="action.id || action.href"
            :icon="mdiOpenInNew"
            size="small"
            :title="action.label || action.href"
            variant="text"
            @click="openAction(action)"
          />

          <v-btn
            v-if="terminalCanRetry"
            :disabled="operationBusy"
            :icon="mdiRefresh"
            size="small"
            title="Retry"
            variant="text"
            @click="retryTerminal"
          />

          <v-btn
            v-if="terminalCanRestart"
            :disabled="operationBusy"
            :icon="mdiPowerCycle"
            size="small"
            title="Restart"
            variant="text"
            @click="restartTerminal"
          />

          <v-btn
            v-if="embeddedTerminalVisible"
            aria-label="Hide launch terminal"
            class="vibe64-launch-controls__terminal-toggle--hide"
            :icon="mdiClose"
            size="small"
            title="Hide launch terminal"
            variant="text"
            @click="toggleTerminal"
          />

          <v-btn
            v-else
            aria-label="Show launch terminal"
            :icon="mdiConsoleLine"
            size="small"
            title="Show launch terminal"
            variant="text"
            @click="toggleTerminal"
          />
        </div>

        <v-btn
          v-else-if="embeddedAutoStartButtonVisible"
          aria-label="Start preview"
          class="vibe64-launch-controls__auto-start-button"
          :disabled="launchButtonsDisabled || !embeddedAutoStartTarget"
          :icon="mdiPlayCircleOutline"
          :loading="loading || operationBusy"
          size="small"
          title="Start preview"
          variant="text"
          @click="run(embeddedAutoStartTarget)"
        />

        <v-menu v-else-if="manualLaunchMenuVisible" location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              class="vibe64-launch-controls__run-button"
              color="primary"
              :disabled="runMenuDisabled"
              :loading="loading"
              :prepend-icon="mdiPlayCircleOutline"
              :size="buttonSize"
              title="Run target"
              :variant="buttonVariant"
            >
              {{ buttonLabel }}
            </v-btn>
          </template>

          <v-list class="vibe64-launch-controls__menu" density="compact">
            <v-list-item
              v-for="launchTarget in launchTargets"
              :key="launchTarget.id"
              :disabled="launchButtonsDisabled || launchTarget.available === false"
              :prepend-icon="mdiPlayCircleOutline"
              :subtitle="launchTarget.disabledReason || ''"
              :title="launchTarget.label"
              @click="run(launchTarget)"
            />
          </v-list>
        </v-menu>

        <v-chip
          v-if="loadError"
          color="warning"
          size="small"
          variant="tonal"
          :title="loadError"
        >
          Launch unavailable
        </v-chip>

        <v-btn
          v-if="embeddedPreview && previewBaseUrl"
          :icon="mdiRefresh"
          size="small"
          title="Reload preview"
          variant="text"
          @click="reloadPreview"
        />

        <v-btn
          v-if="embeddedPreview"
          class="vibe64-launch-controls__position-button"
          :disabled="previewToolbarPosition === 'right'"
          :icon="mdiChevronRight"
          size="small"
          title="Move controls right"
          variant="text"
          @click="movePreviewToolbar(1)"
        />
      </div>
    </Teleport>

    <div
      v-if="embeddedPreview"
      class="vibe64-launch-controls__preview"
    >
      <iframe
        v-if="previewUrl"
        ref="previewFrame"
        :key="previewUrl"
        class="vibe64-launch-controls__preview-frame"
        :src="previewUrl"
        title="App preview"
        @load="handlePreviewFrameLoad"
      />
      <div
        v-if="previewLoadingOverlayVisible"
        class="vibe64-launch-controls__preview-empty vibe64-launch-controls__preview-overlay"
      >
        <div class="vibe64-launch-controls__preview-pulse">
          <v-icon :icon="mdiWebClock" size="46" />
        </div>
        <span>Opening preview.</span>
        <v-btn
          v-if="embeddedRecoveryButtonVisible"
          :disabled="operationBusy"
          :icon="mdiPlayCircleOutline"
          size="small"
          title="Start preview"
          variant="tonal"
          @click="recoverEmbeddedPreview"
        />
      </div>
      <div
        v-else-if="!previewUrl"
        class="vibe64-launch-controls__preview-empty"
      >
        <div
          v-if="previewStarting"
          class="vibe64-launch-controls__preview-pulse"
        >
          <v-icon :icon="mdiWebClock" size="46" />
        </div>
        <span>{{ previewEmptyText }}</span>
      </div>
      <Vibe64TerminalFrame
        v-if="embeddedTerminalVisible"
        class="vibe64-launch-controls__terminal vibe64-launch-controls__terminal--embedded"
        :command-preview="terminalCommandPreview"
        :error="terminalError"
        :status="terminalStatus"
        :subtitle="terminalSubtitle"
        :terminal-host-ref="setTerminalHost"
        :title="terminalTitle"
      />
      <div
        v-if="previewDisplayedUrl"
        class="vibe64-launch-controls__preview-url"
        :title="previewDisplayedUrl"
      >
        <span>{{ previewDisplayedUrl }}</span>
        <v-btn
          :icon="mdiContentCopy"
          size="x-small"
          title="Copy preview URL"
          variant="text"
          @click="copyPreviewUrl"
        />
      </div>
    </div>

    <Vibe64FloatingTerminalWindow
      v-if="!embeddedPreview"
      :displayed="terminalDisplayed"
      :minimized="false"
      :storage-key="terminalWindowStorageKey"
      :visible="terminalWindowVisible"
    >
      <template #default="{ startDrag }">
        <Vibe64TerminalFrame
          class="vibe64-launch-controls__terminal"
          :command-preview="terminalCommandPreview"
          draggable
          :error="terminalError"
          :status="terminalStatus"
          :subtitle="terminalSubtitle"
          :terminal-host-ref="setTerminalHost"
          :title="terminalTitle"
          @drag-start="startDrag"
        />
      </template>
    </Vibe64FloatingTerminalWindow>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import {
  mdiChevronLeft,
  mdiChevronRight,
  mdiClose,
  mdiConsoleLine,
  mdiContentCopy,
  mdiOpenInNew,
  mdiPlayCircleOutline,
  mdiPowerCycle,
  mdiRefresh,
  mdiWebClock
} from "@mdi/js";
import Vibe64FloatingTerminalWindow from "@/components/studio/Vibe64FloatingTerminalWindow.vue";
import Vibe64TerminalFrame from "@/components/studio/Vibe64TerminalFrame.vue";
import {
  launchPreviewToolbarStorageKey,
  launchPreviewBaseUrl,
  launchPreviewDisplayUrl,
  launchPreviewUrl,
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreviewToolbarPosition,
  useVibe64LaunchControls
} from "@/composables/useVibe64LaunchControls.js";
import {
  readLocalStorageJson,
  writeLocalStorageJson
} from "@/lib/browserLocalStorage.js";
import {
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";

const props = defineProps({
  buttonLabel: {
    default: "Run",
    type: String
  },
  buttonSize: {
    default: "small",
    type: String
  },
  buttonVariant: {
    default: "tonal",
    type: String
  },
  autoStartTargetId: {
    default: "",
    type: String
  },
  embeddedPreview: {
    default: false,
    type: Boolean
  },
  prominent: {
    default: false,
    type: Boolean
  },
  busy: {
    type: Boolean,
    default: false
  },
  session: {
    type: Object,
    default: null
  },
  toolbarTeleportTarget: {
    default: "",
    type: String
  },
  windowDisplayed: {
    type: Boolean,
    default: true
  },
  previewDisplayed: {
    type: Boolean,
    default: true
  }
});

const {
  expandTerminal,
  launchActions,
  launchButtonsDisabled,
  launchTargets,
  loading,
  loadError,
  minimizeTerminal,
  openAction,
  operationBusy,
  refresh: refreshLaunchTargets,
  restartTerminal,
  retryTerminal,
  run,
  setTerminalHost,
  terminalCanRestart,
  terminalCanRetry,
  terminalCommandPreview,
  terminalDisplayed,
  terminalDockVisible,
  terminalError,
  terminalExpanded,
  terminalIndicatorLabel,
  terminalIndicatorState,
  terminalIsRunning,
  terminalLaunchReady,
  terminalStatus,
  terminalSubtitle,
  terminalTitle,
  terminalVisible,
  terminalWindowVisible,
  terminalWindowStorageKey,
  visible
} = useVibe64LaunchControls({
  autoStartTargetId: () => props.autoStartTargetId,
  windowDisplayed: () => props.windowDisplayed,
  busy: () => props.busy,
  session: () => props.session
});

const runMenuDisabled = computed(() => Boolean(
  launchButtonsDisabled.value ||
  loading.value ||
  launchTargets.value.length < 1
));
const PREVIEW_LOCATION_MESSAGE_TYPE = "vibe64:preview-location";
const PREVIEW_QUERY_MESSAGE_TYPE = "vibe64:preview-query";
const PREVIEW_READY_MESSAGE_TYPE = "vibe64:preview-ready";
const PREVIEW_RELOAD_QUERY_PARAM = "vibe64_reload";
const PREVIEW_READY_RETRY_INTERVAL_MS = 5000;
const PREVIEW_READY_RETRY_LIMIT = 30;
const previewFrame = ref(null);
const previewReloadKey = ref(0);
const previewReadyUrl = ref("");
const previewVisitedUrl = ref("");
const previewToolbarPosition = ref("center");
const projectSlug = useVibe64ProjectSlug();
let previewReadyRetryCount = 0;
let previewReadyRetryTimer = 0;
const toolbarTeleportTarget = computed(() => String(props.toolbarTeleportTarget || "").trim());
const embeddedTerminalVisible = computed(() => Boolean(
  props.embeddedPreview &&
  terminalDisplayed.value &&
  terminalExpanded.value
));
const launchToolbarDockVisible = computed(() => props.embeddedPreview
  ? Boolean(terminalVisible.value || embeddedTerminalVisible.value)
  : terminalDockVisible.value);
const requestedAutoStartTargetId = computed(() => String(props.autoStartTargetId || "").trim());
const embeddedAutoStartTarget = computed(() => {
  if (!props.embeddedPreview || !requestedAutoStartTargetId.value) {
    return null;
  }
  return launchTargets.value.find((target) => target.id === requestedAutoStartTargetId.value) || null;
});
const embeddedAutoStartButtonVisible = computed(() => Boolean(
  props.embeddedPreview &&
  requestedAutoStartTargetId.value &&
  !terminalVisible.value
));
const embeddedRecoveryButtonVisible = computed(() => Boolean(
  props.embeddedPreview &&
  embeddedAutoStartTarget.value &&
  terminalVisible.value &&
  !terminalIsRunning.value
));
const manualLaunchMenuVisible = computed(() => Boolean(
  !terminalVisible.value &&
  launchTargets.value.length > 0 &&
  !(props.embeddedPreview && requestedAutoStartTargetId.value)
));
const previewToolbarStorageKey = computed(() => props.embeddedPreview && props.session
  ? launchPreviewToolbarStorageKey(props.session, projectSlug.value)
  : "");
const previewBaseUrl = computed(() => launchPreviewBaseUrl(launchActions.value));
const previewDisplayBaseUrl = computed(() => launchPreviewDisplayUrl(launchActions.value));
const previewDisplayedUrl = computed(() => (
  previewVisitedUrl.value ||
  previewDisplayBaseUrl.value ||
  previewBaseUrl.value
));
const previewPaneDisplayed = computed(() => props.previewDisplayed !== false);
const previewUrl = computed(() => launchPreviewUrl({
  baseUrl: previewBaseUrl.value,
  ready: terminalLaunchReady.value,
  reloadKey: previewReloadKey.value
}));
const previewStarting = computed(() => Boolean(
  previewBaseUrl.value &&
  !terminalLaunchReady.value
));
const previewLoadingOverlayVisible = computed(() => Boolean(
  previewUrl.value &&
  previewReadyUrl.value !== previewUrl.value
));
const previewEmptyText = computed(() => {
  if (loading.value) {
    return "Loading preview targets.";
  }
  if (previewStarting.value || terminalIsRunning.value) {
    return "Starting preview.";
  }
  return "Run the app to show the preview.";
});

function previewClientDebugEnabled() {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage?.getItem("vibe64:preview-debug") === "1" ||
      new URL(window.location.href).searchParams.has("vibe64_preview_debug");
  } catch {
    return false;
  }
}

function previewDebugLog(event = "", details = {}) {
  if (!previewClientDebugEnabled()) {
    return;
  }
  vibe64SessionDebugLog(`client.launchPreview.${event}`, {
    frameSrc: String(previewFrame.value?.src || ""),
    overlayVisible: previewLoadingOverlayVisible.value,
    previewBaseUrl: previewBaseUrl.value,
    previewDisplayBaseUrl: previewDisplayBaseUrl.value,
    previewReadyUrl: previewUrlWithoutReload(previewReadyUrl.value),
    previewUrl: previewUrlWithoutReload(previewUrl.value),
    projectSlug: projectSlug.value,
    reloadKey: previewReloadKey.value,
    retryCount: previewReadyRetryCount,
    sessionId: String(props.session?.sessionId || ""),
    terminalLaunchReady: terminalLaunchReady.value,
    ...(details && typeof details === "object" && !Array.isArray(details) ? details : {})
  });
}

async function reloadPreview() {
  await refreshLaunchTargets();
  previewReadyRetryCount = 0;
  previewReloadKey.value += 1;
  previewDebugLog("manualReload", {
    nextReloadKey: previewReloadKey.value
  });
}

function movePreviewToolbar(direction = 0) {
  previewToolbarPosition.value = nextLaunchPreviewToolbarPosition(
    previewToolbarPosition.value,
    direction
  );
  if (previewToolbarStorageKey.value) {
    writeLocalStorageJson(previewToolbarStorageKey.value, previewToolbarPosition.value);
  }
}

async function copyPreviewUrl() {
  if (!previewDisplayedUrl.value || typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
    return false;
  }
  await navigator.clipboard.writeText(previewDisplayedUrl.value);
  return true;
}

function requestPreviewState() {
  if (!previewPaneDisplayed.value || !previewFrame.value?.contentWindow || !previewUrl.value) {
    if (previewUrl.value) {
      previewDebugLog("query.skipped", {
        hasContentWindow: Boolean(previewFrame.value?.contentWindow),
        previewPaneDisplayed: previewPaneDisplayed.value
      });
    }
    return;
  }
  previewDebugLog("query.post");
  previewFrame.value.contentWindow.postMessage({
    type: PREVIEW_QUERY_MESSAGE_TYPE
  }, "*");
}

function handlePreviewFrameLoad() {
  previewDebugLog("iframe.load");
  requestPreviewState();
}

async function recoverEmbeddedPreview() {
  if (!embeddedAutoStartTarget.value || operationBusy.value) {
    return false;
  }
  if (terminalCanRetry.value) {
    return retryTerminal();
  }
  return run(embeddedAutoStartTarget.value, {
    applyDefaultDisplay: false
  });
}

function stopPreviewReadyRetries() {
  if (!previewReadyRetryTimer) {
    return;
  }
  window.clearTimeout(previewReadyRetryTimer);
  previewReadyRetryTimer = 0;
  previewDebugLog("retry.stop");
}

function previewReadyRetryAllowed() {
  return Boolean(
    previewPaneDisplayed.value &&
    previewLoadingOverlayVisible.value &&
    previewUrl.value &&
    typeof window !== "undefined"
  );
}

function schedulePreviewReadyRetry() {
  if (!previewReadyRetryAllowed()) {
    stopPreviewReadyRetries();
    return;
  }
  if (previewReadyRetryTimer) {
    return;
  }
  previewDebugLog("retry.schedule", {
    intervalMs: PREVIEW_READY_RETRY_INTERVAL_MS
  });
  previewReadyRetryTimer = window.setTimeout(() => {
    previewReadyRetryTimer = 0;
    if (
      !previewReadyRetryAllowed() ||
      previewReadyRetryCount >= PREVIEW_READY_RETRY_LIMIT
    ) {
      previewDebugLog("retry.skip", {
        limit: PREVIEW_READY_RETRY_LIMIT,
        retryAllowed: previewReadyRetryAllowed()
      });
      return;
    }
    previewReadyRetryCount += 1;
    previewReloadKey.value += 1;
    previewDebugLog("retry.reload", {
      nextReloadKey: previewReloadKey.value
    });
    schedulePreviewReadyRetry();
  }, PREVIEW_READY_RETRY_INTERVAL_MS);
}

function toggleTerminal() {
  if (embeddedTerminalVisible.value) {
    minimizeTerminal();
    return;
  }
  void expandTerminal();
}

function previewUrlWithoutReload(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  try {
    const url = new URL(text);
    url.searchParams.delete(PREVIEW_RELOAD_QUERY_PARAM);
    return url.toString();
  } catch {
    return text
      .replace(/([?&])vibe64_reload=[^&]*&?/u, (match, prefix) => {
        return prefix === "?" && match.endsWith("&") ? "?" : "";
      })
      .replace(/[?&]$/u, "");
  }
}

function previewMessageUrl(data = {}) {
  const messageType = String(data?.type || "");
  if (
    !data ||
    typeof data !== "object" ||
    ![PREVIEW_LOCATION_MESSAGE_TYPE, PREVIEW_READY_MESSAGE_TYPE].includes(messageType)
  ) {
    return "";
  }
  const href = String(data.href || data.url || "").trim();
  const baseUrl = String(previewDisplayBaseUrl.value || previewBaseUrl.value || "").trim();
  if (!href || !baseUrl) {
    return "";
  }
  try {
    const url = new URL(href, baseUrl);
    const baseOrigin = new URL(baseUrl).origin;
    if (url.origin === baseOrigin) {
      return previewUrlWithoutReload(url.toString());
    }
    const mappedUrl = previewMessageTargetUrlToPreviewUrl(url);
    return mappedUrl ? previewUrlWithoutReload(mappedUrl) : "";
  } catch {
    return "";
  }
}

function previewMessageTargetUrlToPreviewUrl(targetUrl) {
  const previewBase = String(previewBaseUrl.value || "").trim();
  if (!previewBase || !targetUrl) {
    return "";
  }
  const matchingAction = launchActions.value.find((action) => {
    try {
      return new URL(String(action?.href || "")).origin === targetUrl.origin &&
        String(action?.previewHref || "").trim();
    } catch {
      return false;
    }
  });
  if (!matchingAction) {
    return "";
  }
  try {
    const previewUrl = new URL(previewBase);
    previewUrl.pathname = targetUrl.pathname;
    previewUrl.search = targetUrl.search;
    previewUrl.hash = targetUrl.hash;
    return previewUrl.toString();
  } catch {
    return "";
  }
}

function previewMessageOriginAllowed(event) {
  const origins = [
    previewBaseUrl.value,
    previewDisplayBaseUrl.value
  ].map((value) => {
    try {
      return value ? new URL(value).origin : "";
    } catch {
      return "";
    }
  }).filter(Boolean);
  return origins.length < 1 || origins.includes(String(event?.origin || ""));
}

function previewMessageType(value = {}) {
  return String(value?.type || "");
}

function isPreviewBridgeMessage(value = {}) {
  return [
    PREVIEW_LOCATION_MESSAGE_TYPE,
    PREVIEW_READY_MESSAGE_TYPE
  ].includes(previewMessageType(value));
}

function handlePreviewLocationMessage(event) {
  if (!isPreviewBridgeMessage(event?.data)) {
    return;
  }
  if (event?.source !== previewFrame.value?.contentWindow) {
    previewDebugLog("message.ignored", {
      messageType: previewMessageType(event?.data),
      origin: String(event?.origin || ""),
      reason: "source_mismatch"
    });
    return;
  }
  if (!previewMessageOriginAllowed(event)) {
    previewDebugLog("message.ignored", {
      messageType: previewMessageType(event?.data),
      origin: String(event?.origin || ""),
      reason: "origin_not_allowed"
    });
    return;
  }
  const frameUrl = previewMessageUrl(event.data);
  previewDebugLog("message.received", {
    frameUrl,
    href: String(event?.data?.href || event?.data?.url || ""),
    messageType: previewMessageType(event?.data),
    origin: String(event?.origin || ""),
    reason: String(event?.data?.reason || "")
  });
  if (frameUrl && event.data?.type === PREVIEW_READY_MESSAGE_TYPE) {
    previewReadyUrl.value = previewUrl.value;
    previewDebugLog("ready.accepted", {
      frameUrl,
      reason: String(event?.data?.reason || "")
    });
  }
  if (frameUrl) {
    previewVisitedUrl.value = frameUrl;
  }
}

watch(previewUrl, (nextUrl, previousUrl) => {
  previewDebugLog("url.changed", {
    nextUrl: previewUrlWithoutReload(nextUrl),
    previousUrl: previewUrlWithoutReload(previousUrl)
  });
  if (previewUrlWithoutReload(nextUrl) !== previewUrlWithoutReload(previousUrl)) {
    previewReadyRetryCount = 0;
  }
  previewReadyUrl.value = "";
  requestPreviewState();
});

watch(previewLoadingOverlayVisible, (visible) => {
  if (visible && previewPaneDisplayed.value) {
    schedulePreviewReadyRetry();
    return;
  }
  stopPreviewReadyRetries();
}, {
  immediate: true
});

watch(previewPaneDisplayed, (displayed) => {
  if (!displayed) {
    stopPreviewReadyRetries();
    return;
  }
  requestPreviewState();
  if (previewLoadingOverlayVisible.value) {
    schedulePreviewReadyRetry();
  }
}, {
  flush: "sync"
});

watch(previewDisplayBaseUrl, (baseUrl) => {
  previewVisitedUrl.value = previewUrlWithoutReload(baseUrl);
}, {
  immediate: true
});

watch(previewToolbarStorageKey, (storageKey) => {
  previewToolbarPosition.value = normalizeLaunchPreviewToolbarPosition(
    readLocalStorageJson(storageKey, "center")
  );
}, {
  immediate: true
});

onMounted(() => {
  window.addEventListener("message", handlePreviewLocationMessage);
});

onBeforeUnmount(() => {
  stopPreviewReadyRetries();
  window.removeEventListener("message", handlePreviewLocationMessage);
});
</script>

<style scoped>
.vibe64-launch-controls {
  align-items: center;
  display: flex;
  gap: 0.45rem;
  justify-content: flex-end;
  min-width: 0;
}

.vibe64-launch-controls__toolbar {
  align-items: center;
  display: flex;
  gap: 0.45rem;
  justify-content: flex-end;
  min-width: 0;
}

.vibe64-launch-controls--embedded {
  align-items: stretch;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.16);
  border-radius: 14px;
  display: block;
  height: 100%;
  justify-content: stretch;
  padding: 0.6rem;
  position: relative;
}

.vibe64-launch-controls--toolbar-teleported {
  grid-template-rows: minmax(0, 1fr);
}

.vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar {
  background: rgba(var(--v-theme-surface), 0.42);
  border: 1px solid rgba(var(--v-theme-outline), 0.1);
  border-radius: 999px;
  box-shadow: 0 0.4rem 1.2rem rgba(15, 23, 42, 0.14);
  left: 50%;
  justify-content: flex-end;
  opacity: 0.58;
  padding: 0.18rem;
  position: absolute;
  top: 1rem;
  transform: translateX(-50%);
  transition: opacity 140ms ease, background-color 140ms ease, border-color 140ms ease;
  z-index: 3;
}

.vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar:hover,
.vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar:focus-within {
  background: rgba(var(--v-theme-surface), 0.94);
  border-color: rgba(var(--v-theme-outline), 0.18);
  opacity: 1;
}

.vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--left {
  left: 1rem;
  transform: none;
}

.vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--center {
  left: 50%;
  transform: translateX(-50%);
}

.vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--right {
  left: auto;
  right: 1rem;
  transform: none;
}

.vibe64-launch-controls__toolbar--teleported {
  flex: 0 0 auto;
}

.vibe64-launch-controls--prominent .vibe64-launch-controls__run-button {
  font-size: 1rem;
  font-weight: 720;
  min-height: 2.75rem;
  min-width: clamp(8.5rem, 10vw, 12rem);
  padding-inline: 1.1rem 1.25rem;
}

.vibe64-launch-controls--prominent .vibe64-launch-controls__run-button :deep(.v-btn__prepend) {
  margin-inline-end: 0.5rem;
}

.vibe64-launch-controls--prominent .vibe64-launch-controls__run-button :deep(.v-icon) {
  font-size: 1.55rem;
}

.vibe64-launch-controls__dock {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 999px;
  display: flex;
  gap: 0.12rem;
  min-height: 2.25rem;
  padding: 0 0.25rem;
}

.vibe64-launch-controls__status-dot {
  border-radius: 999px;
  display: inline-block;
  flex: 0 0 auto;
  height: 0.55rem;
  margin: 0 0.35rem;
  width: 0.55rem;
}

.vibe64-launch-controls__status-dot--stopped {
  background: rgba(var(--v-theme-on-surface), 0.38);
  box-shadow: 0 0 0 0.2rem rgba(var(--v-theme-on-surface), 0.08);
}

.vibe64-launch-controls__status-dot--starting {
  animation: vibe64-launch-status-pulse 0.9s ease-in-out infinite;
  background: rgb(var(--v-theme-error));
  box-shadow: 0 0 0 0.2rem rgba(var(--v-theme-error), 0.14);
}

.vibe64-launch-controls__status-dot--running {
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 0.2rem rgba(var(--v-theme-success), 0.16);
}

.vibe64-launch-controls__status-dot--failed {
  background: rgb(var(--v-theme-error));
  box-shadow: 0 0 0 0.2rem rgba(var(--v-theme-error), 0.14);
}

.vibe64-launch-controls__menu {
  max-width: min(20rem, 92vw);
  min-width: min(14rem, 92vw);
}

.vibe64-launch-controls__preview {
  background:
    linear-gradient(180deg, rgba(var(--v-theme-primary), 0.035), rgba(var(--v-theme-surface), 0.86)),
    rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.12);
  border-radius: 12px;
  display: grid;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

.vibe64-launch-controls__preview > * {
  grid-area: 1 / 1;
}

.vibe64-launch-controls__preview-frame {
  background: white;
  border: 0;
  height: 100%;
  min-height: 0;
  width: 100%;
}

.vibe64-launch-controls__preview-empty {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  justify-content: center;
  min-height: 12rem;
  padding: 1rem;
}

.vibe64-launch-controls__preview-overlay {
  background:
    linear-gradient(180deg, rgba(var(--v-theme-primary), 0.035), rgba(var(--v-theme-surface), 0.9)),
    rgb(var(--v-theme-surface));
  z-index: 1;
}

.vibe64-launch-controls__preview-pulse {
  align-items: center;
  animation: vibe64-launch-preview-pulse 1.7s ease-in-out infinite;
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 999px;
  color: rgba(var(--v-theme-primary), 0.72);
  display: inline-flex;
  height: 5.25rem;
  justify-content: center;
  width: 5.25rem;
}

.vibe64-launch-controls__terminal {
  box-shadow: 0 1rem 3rem rgba(13, 24, 42, 0.24);
  height: 100%;
}

.vibe64-launch-controls__terminal--embedded {
  align-self: start;
  border-radius: 12px;
  box-shadow: none;
  display: flex;
  flex-direction: column;
  height: clamp(37rem, 72vh, 56rem);
  justify-self: stretch;
  margin: 0.65rem;
  max-height: calc(100% - 1.3rem);
  min-height: 24rem;
  overflow: hidden;
  z-index: 2;
}

.vibe64-launch-controls__preview-url {
  align-items: center;
  align-self: end;
  background: rgba(var(--v-theme-surface), 0.38);
  border: 1px solid rgba(var(--v-theme-outline), 0.08);
  border-radius: 999px;
  color: rgba(var(--v-theme-on-surface), 0.52);
  display: flex;
  font-size: 0.72rem;
  gap: 0.2rem;
  justify-self: start;
  margin: 0 0 0.7rem 0.7rem;
  max-width: min(28rem, calc(100% - 1.4rem));
  min-width: 0;
  padding: 0.08rem 0.16rem 0.08rem 0.55rem;
  user-select: none;
  z-index: 3;
}

.vibe64-launch-controls__preview-url:hover,
.vibe64-launch-controls__preview-url:focus-within {
  background: rgba(var(--v-theme-surface), 0.88);
  color: rgba(var(--v-theme-on-surface), 0.82);
}

.vibe64-launch-controls__preview-url span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-launch-controls__terminal:not(.vibe64-launch-controls__terminal--embedded) :deep(.vibe64-terminal-frame__host) {
  height: calc(100% - 5rem);
}

.vibe64-launch-controls__terminal--embedded :deep(.vibe64-terminal-frame__host) {
  flex: 1 1 auto;
  height: auto;
  min-height: 0;
}

.vibe64-launch-controls__terminal--embedded :deep(.vibe64-terminal-frame__stage) {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
}

@media (max-width: 760px) {
  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar,
  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--left,
  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--center,
  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--right {
    bottom: 0.85rem;
    left: 50%;
    opacity: 0.72;
    right: auto;
    top: auto;
    transform: translateX(-50%);
  }

  .vibe64-launch-controls__position-button {
    display: none;
  }

  .vibe64-launch-controls__terminal--embedded {
    height: clamp(24rem, 68vh, 40rem);
    min-height: 20rem;
  }

  .vibe64-launch-controls__terminal--embedded :deep(.vibe64-terminal-frame__host) {
    height: auto;
    min-height: 0;
  }
}

@keyframes vibe64-launch-status-pulse {
  0%,
  100% {
    opacity: 0.32;
    transform: scale(0.84);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes vibe64-launch-preview-pulse {
  0%,
  100% {
    opacity: 0.46;
    transform: scale(0.94);
  }

  50% {
    opacity: 1;
    transform: scale(1);
  }
}

</style>
