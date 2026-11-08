<template>
  <div
    v-if="embeddedPreview || visible"
    class="vibe64-launch-controls"
    :class="{
      'vibe64-launch-controls--embedded': embeddedPreview,
      'vibe64-launch-controls--toolbar-teleported': toolbarTarget,
      'vibe64-launch-controls--prominent': prominent
    }"
  >
    <Teleport
      defer
      :disabled="!toolbarTarget"
      :to="toolbarTarget || 'body'"
    >
      <Vibe64OutputToolbar
        :button-label="buttonLabel"
        :button-size="buttonSize"
        :button-variant="buttonVariant"
        :embedded-preview="embeddedPreview"
        :preview-identity-fix-allowed="previewIdentityFixAllowed"
        :surface="surface"
      />
    </Teleport>

    <div
      v-if="embeddedPreview"
      class="vibe64-launch-controls__preview"
      :class="{ 'vibe64-launch-controls__preview--notice': previewTestNotice || previewWorkNotice }"
    >
      <div v-if="previewTestNotice || previewWorkNotice" class="vibe64-launch-controls__notices">
        <div v-if="previewTestNotice" class="vibe64-launch-controls__test-notice" :class="{ 'vibe64-launch-controls__test-notice--error': previewTestNotice.error }" :role="previewTestNotice.error ? 'alert' : 'status'">
          <strong>{{ previewTestNotice.title }}</strong>
          <span>{{ previewTestNotice.message }}</span>
        </div>
        <div v-if="previewWorkNotice" class="vibe64-launch-controls__work-notice" role="status">{{ previewWorkNotice }}</div>
      </div>
      <iframe
        v-if="previewUrl"
        :key="previewFrameRequestId"
        ref="previewFrame"
        allow="clipboard-write; microphone; autoplay"
        class="vibe64-launch-controls__preview-frame"
        :data-preview-frame-request-id="previewFrameRequestId"
        :src="previewUrl"
        title="App preview"
        @load="handlePreviewFrameLoad"
      />
      <Vibe64PreviewStatus :session="session" :surface="surface" />
      <Vibe64LongRunningTerminal
        v-if="embeddedTerminalSurfaceVisible"
        :command-preview="terminalCommandPreview"
        :error="terminalError"
        fill
        :open="terminalExpanded"
        presentation="inline"
        show-copy
        :stage="terminalSubtitle"
        :status="terminalStatus"
        :subtitle="terminalSubtitle"
        surface-class="vibe64-launch-controls__terminal vibe64-launch-controls__terminal--embedded"
        :surface-style="embeddedTerminalStyle"
        :terminal="terminal"
        :title="terminalTitle"
        @update:open="setTerminalExpanded"
      >
        <template #actions-before>
          <v-btn
            v-if="previewTerminalRecoveryVisible"
            :disabled="operationBusy"
            prepend-icon="$refresh"
            size="small"
            title="Restart preview"
            variant="tonal"
            @click="recoverEmbeddedPreview"
          >
            Restart preview
          </v-btn>
        </template>
      </Vibe64LongRunningTerminal>
    </div>

    <Vibe64LongRunningTerminal
      v-if="!embeddedPreview && terminalWindowVisible"
      :command-preview="terminalCommandPreview"
      :error="terminalError"
      :floating-storage-key="terminalWindowStorageKey"
      :open="terminalExpanded"
      presentation="floating"
      show-copy
      :stage="terminalSubtitle"
      :status="terminalStatus"
      :subtitle="terminalSubtitle"
      surface-class="vibe64-launch-controls__terminal"
      :terminal="terminal"
      :title="terminalTitle"
      @update:open="setTerminalExpanded"
    />

    <Vibe64OutputOptionsDialog :surface="surface" />

    <Vibe64PreviewRouteDialog :surface="surface" />

    <v-snackbar
      v-model="previewResourceNoticeVisible"
      color="error"
      location="bottom center"
      :timeout="7000"
    >
      {{ previewResourceNoticeText }}
    </v-snackbar>

    <v-snackbar
      :model-value="previewPicking"
      location="bottom center"
      :timeout="-1"
    >
      Select an element in Preview to see what it uses.
      <template #actions>
        <v-btn variant="text" @click="stopPreviewPick">Cancel</v-btn>
      </template>
    </v-snackbar>

    <v-snackbar
      v-model="previewPickNoticeVisible"
      location="bottom center"
      :timeout="7000"
    >
      {{ previewPickNoticeText }}
      <template v-if="previewPickNoticeOpensUsage" #actions>
        <v-btn variant="text" @click="openUsageFromPickNotice">Open Usage</v-btn>
      </template>
    </v-snackbar>

    <v-snackbar
      v-model="previewAttachmentNoticeVisible"
      :color="previewAttachmentNoticeColor"
      location="bottom center"
      :timeout="previewAttachmentNoticeColor === 'error' ? 7000 : 2600"
    >
      {{ previewAttachmentNoticeText }}
    </v-snackbar>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { SYSTEM_GRAPH_API_SUFFIX } from "@local/vibe64-system-graph/client";
import { useVibe64UsageRecording } from "@local/vibe64-usage-recording/client";
import Vibe64LongRunningTerminal from "@/components/studio/Vibe64LongRunningTerminal.vue";
import Vibe64OutputOptionsDialog from "@/components/studio/Vibe64OutputOptionsDialog.vue";
import Vibe64OutputToolbar from "@/components/studio/Vibe64OutputToolbar.vue";
import Vibe64PreviewRouteDialog from "@/components/studio/Vibe64PreviewRouteDialog.vue";
import Vibe64PreviewStatus from "@/components/studio/Vibe64PreviewStatus.vue";
import {
  useVibe64OutputControlsSurface
} from "@/composables/useVibe64OutputControlsSurface.js";
import {
  useVibe64PreviewAttachments
} from "@/composables/useVibe64PreviewAttachments.js";

const emit = defineEmits([
  "open-usage",
  "preview-attachment-state",
  "test-approval"
]);

const props = defineProps({
  // Whether this person may hand a failed preview sign-in to the AI.
  previewIdentityFixAllowed: {
    required: true,
    type: Boolean
  },
  // Hands each Preview file (screenshot, diagnostics) to the current message.
  preparePreviewFile: {
    required: true,
    type: /** @type {import("vue").PropType<import("@/composables/useVibe64PreviewCapture.js").PreviewFilePreparer>} */ (Function)
  },
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
  autoStartManagedPreview: {
    default: false,
    type: Boolean
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
  sourceOperationsSuspended: {
    default: false,
    type: Boolean
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

const paths = usePaths();
const usageSessionId = computed(() => String(props.session?.sessionId || ""));
const usageRecording = useVibe64UsageRecording({ sessionId: usageSessionId });

const surface = useVibe64OutputControlsSurface(props, {
  openUsage: (request) => emit("open-usage", request),
  readUsageEntries: (query) => getHttpWebClient().request(
    `${paths.api(SYSTEM_GRAPH_API_SUFFIX, { surface: "app" })}/sessions/${encodeURIComponent(usageSessionId.value)}/usage/entries`,
    { method: "GET", query }
  ),
  recordInteraction: usageRecording.recordInteraction,
  recording: usageRecording.recording
});

const {
  embeddedTerminalSurfaceVisible,
  handlePreviewFrameLoad,
  openUsageFromPickNotice,
  operationBusy,
  previewDiagnosticsAvailable,
  previewDiagnosticsBusy: previewDiagnosticsRequestBusy,
  previewFrame,
  previewFrameLoaded,
  previewFrameRequestId,
  previewPickNoticeOpensUsage,
  previewPickNoticeText,
  previewPickNoticeVisible,
  previewPicking,
  previewResourceNoticeText,
  previewResourceNoticeVisible,
  previewTerminalRecoveryVisible,
  previewTestNotice,
  previewUrl,
  previewWorkNotice,
  recoverEmbeddedPreview,
  requestPreviewDiagnostics,
  setTerminalExpanded,
  stopPreviewPick,
  terminal,
  terminalCommandPreview,
  terminalError,
  terminalExpanded,
  terminalStatus,
  terminalSubtitle,
  terminalTitle,
  terminalWindowStorageKey,
  terminalWindowVisible,
  testApproval,
  toolbarTeleportTarget: toolbarTarget,
  visible
} = surface;

const embeddedTerminalStyle = computed(() => ({
  alignSelf: terminalExpanded.value ? "start" : "end",
  boxShadow: terminalExpanded.value ? "none" : "0 0.45rem 1.3rem rgba(var(--v-theme-shadow), 0.18)",
  ...(terminalExpanded.value
    ? {
        height: "clamp(24rem, 72vh, 56rem)",
        maxHeight: "calc(100% - 1.3rem)",
        minHeight: "20rem"
      }
    : {}),
  justifySelf: "stretch",
  margin: "0.65rem",
  overflow: "hidden",
  zIndex: 3
}));

const attachments = useVibe64PreviewAttachments({
  prepareFile: props.preparePreviewFile,
  previewDiagnosticsAvailable,
  previewDisplayed: () => props.previewDisplayed,
  previewFrame,
  previewLoaded: previewFrameLoaded,
  requestPreviewDiagnostics,
  scopeKey: () => String(props.session?.sessionId || "")
});
const {
  busy: previewCaptureBusy,
  buttonVisible: previewCaptureButtonVisible,
  capturePreview: captureVisiblePreview,
  noticeColor: previewAttachmentNoticeColor,
  noticeText: previewAttachmentNoticeText,
  noticeVisible: previewAttachmentNoticeVisible
} = attachments.capture;

watch([() => props.session?.sessionId, testApproval], ([sessionId, approval]) => {
  emit("test-approval", { sessionId, approval });
}, { immediate: true });

watch(
  [
    previewCaptureButtonVisible,
    previewCaptureBusy,
    previewDiagnosticsAvailable,
    attachments.diagnosticsBusy,
    previewDiagnosticsRequestBusy
  ],
  ([captureAvailable, captureBusy, diagnosticsAvailable, diagnosticsBusy, diagnosticsRequestBusy]) => {
    emit("preview-attachment-state", {
      attachDiagnostics: attachments.attachDiagnostics,
      capture: captureVisiblePreview,
      captureAvailable: Boolean(captureAvailable),
      captureBusy: Boolean(captureBusy),
      diagnosticsAvailable: Boolean(diagnosticsAvailable),
      diagnosticsBusy: Boolean(diagnosticsBusy || diagnosticsRequestBusy)
    });
  },
  {
    immediate: true
  }
);

onBeforeUnmount(() => {
  emit("preview-attachment-state", {
    attachDiagnostics: null,
    capture: null,
    captureAvailable: false,
    captureBusy: false,
    diagnosticsAvailable: false,
    diagnosticsBusy: false
  });
});
</script>

<style scoped>
.vibe64-launch-controls {
  align-items: center;
  display: flex;
  gap: 0.2rem;
  justify-content: flex-end;
  min-width: 0;
}

.vibe64-launch-controls--embedded {
  align-items: stretch;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-theme-outline-variant));
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

.vibe64-launch-controls__preview {
  background:
    linear-gradient(180deg, rgba(var(--v-theme-primary), 0.035), rgba(var(--v-theme-surface), 0.86)),
    rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
  display: grid;
  height: 100%;
  min-height: 0;
  overflow: hidden;
}

/* Every layer of the Preview, including the status component's own elements. */
.vibe64-launch-controls__preview > :deep(*) {
  grid-area: 1 / 1;
}

.vibe64-launch-controls__preview--notice { grid-template-rows: auto minmax(0, 1fr); }
.vibe64-launch-controls__preview--notice > :deep(*) { grid-area: 2 / 1; }
.vibe64-launch-controls__preview--notice > .vibe64-launch-controls__notices { grid-area: 1 / 1; }
.vibe64-launch-controls__work-notice {
  padding: 6px 14px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px;
}
.vibe64-launch-controls__test-notice {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  padding: 10px 14px;
  background: rgb(var(--v-theme-warning));
  color: rgb(var(--v-theme-on-warning));
  font-size: 13px;
}
.vibe64-launch-controls__test-notice--error {
  background: rgb(var(--v-theme-error));
  color: rgb(var(--v-theme-on-error));
}

.vibe64-launch-controls__preview-frame {
  background: white;
  border: 0;
  height: 100%;
  min-height: 0;
  width: 100%;
}

@media (min-width: 721px) and (max-width: 980px) {
  .vibe64-launch-controls__terminal--embedded {
    margin-top: calc(var(--v-layout-top, 4rem) + 0.65rem) !important;
    max-height: calc(100% - var(--v-layout-top, 4rem) - 1.3rem) !important;
  }
}
</style>
