<template>
  <div
    v-if="previewLoadingOverlayVisible"
    class="vibe64-launch-controls__preview-empty vibe64-launch-controls__preview-overlay"
  >
    <div class="vibe64-launch-controls__preview-pulse">
      <v-icon :icon="mdiWebClock" size="46" />
    </div>
    <span>{{ previewInFlightText || "Opening preview." }}</span>
  </div>
  <div
    v-if="previewSuspended"
    class="vibe64-launch-controls__preview-empty"
    role="status"
  >
    <strong>Preview suspended</strong>
    <span>This page is unloaded. App servers and agents are unaffected. Unsaved page changes may be lost.</span>
    <v-btn :prepend-icon="mdiPlayCircleOutline" variant="tonal" @click="resumePreview">Resume preview</v-btn>
  </div>
  <div
    v-else-if="previewNoticeVisible"
    class="vibe64-launch-controls__preview-empty vibe64-launch-controls__preview-diagnostic"
  >
    <v-icon
      class="vibe64-launch-controls__preview-diagnostic-icon"
      :icon="mdiAlertCircleOutline"
      size="38"
    />
    <strong>{{ previewNotice.title }}</strong>
    <span>{{ previewNotice.message }}</span>
    <div class="vibe64-launch-controls__preview-diagnostic-actions">
      <component
        :is="resourceRecoveryControl"
        v-if="resourceRecoveryControl && resourceAdmissionId"
        :key="`${session?.sessionId}:${resourceAdmissionId}`"
        :admission-id="resourceAdmissionId"
        :session-id="session?.sessionId || ''"
        :disabled="operationBusy && !resourceRetryBusy"
        @busy="setResourceRetryBusy"
        @retry-result="acceptResourceRetry"
        @recheck="recheckResourceAdmission"
      />
      <v-btn
        v-if="previewRecoveryVisible"
        :disabled="resourceRetryBusy"
        color="primary"
        :prepend-icon="mdiRefresh"
        size="small"
        variant="flat"
        @click="recoverEmbeddedPreview"
      >
        {{ previewRecoveryLabel }}
      </v-btn>
      <v-btn
        v-if="previewCanShowLog"
        :prepend-icon="mdiConsoleLine"
        size="small"
        variant="tonal"
        @click="showLaunchLog"
      >
        Show log
      </v-btn>
    </div>
  </div>
  <div
    v-else-if="!previewUrl"
    class="vibe64-launch-controls__preview-empty"
  >
    <div
      class="vibe64-launch-controls__preview-pulse"
      :class="{ 'vibe64-launch-controls__preview-pulse--active': previewActivityVisible }"
    >
      <v-icon :icon="mdiWebClock" size="46" />
    </div>
    <span class="vibe64-launch-controls__preview-empty-text" :title="previewEmptyText">{{ previewEmptyText }}</span>
    <v-btn
      v-if="embeddedManualStartButtonVisible && !previewActivityVisible"
      :disabled="embeddedManualStartButtonDisabled"
      color="primary"
      :prepend-icon="mdiPlayCircleOutline"
      size="small"
      variant="flat"
      @click="forceStartEmbeddedPreview"
    >
      Start preview
    </v-btn>
    <v-btn
      v-if="previewSetupRetryVisible"
      :disabled="operationBusy || loading"
      color="primary"
      data-vibe64-preview-setup-retry
      :prepend-icon="mdiRefresh"
      size="small"
      title="Run the session's declared setup steps again"
      variant="flat"
      @click="retryPreviewWorkspaceSetup"
    >
      Retry setup
    </v-btn>
    <v-btn
      v-else-if="previewCheckAgainVisible"
      :disabled="operationBusy || loading"
      :prepend-icon="mdiRefresh"
      size="small"
      title="Check preview availability again"
      variant="tonal"
      @click="retryLaunchStatus"
    >
      Check again
    </v-btn>
    <code
      v-if="launchStatusDetailText && launchStatusDetailText !== String(previewEmptyText || '').trim()"
      class="vibe64-launch-controls__preview-status-detail"
    >
      {{ launchStatusDetailText }}
    </code>
  </div>
</template>

<script setup>
// What the Preview shows instead of, or over, its page: opening, suspended,
// a diagnostic with its recovery, or why there is no page yet.
import { inject, ref } from "vue";
import {
  mdiAlertCircleOutline,
  mdiConsoleLine,
  mdiPlayCircleOutline,
  mdiRefresh,
  mdiWebClock
} from "@mdi/js";
import { VIBE64_RESOURCE_RECOVERY_KEY } from "@/lib/vibe64ResourceRecovery.js";

const props = defineProps({
  session: {
    default: null,
    type: Object
  },
  surface: {
    required: true,
    type: /** @type {import("vue").PropType<ReturnType<typeof import("@/composables/useVibe64OutputControlsSurface.js").useVibe64OutputControlsSurface>>} */ (Object)
  }
});

const {
  acceptResourceRetry,
  embeddedManualStartButtonDisabled,
  embeddedManualStartButtonVisible,
  forceStartEmbeddedPreview,
  launchStatusDetailText,
  loading,
  operationBusy,
  previewActivityVisible,
  previewCanShowLog,
  previewCheckAgainVisible,
  previewEmptyText,
  previewInFlightText,
  previewLoadingOverlayVisible,
  previewNotice,
  previewNoticeVisible,
  previewRecoveryLabel,
  previewRecoveryVisible,
  previewSetupRetryVisible,
  previewSuspended,
  previewUrl,
  recheckResourceAdmission,
  recoverEmbeddedPreview,
  resourceAdmissionId,
  resumePreview,
  retryLaunchStatus,
  retryPreviewWorkspaceSetup,
  showLaunchLog
} = props.surface;

const resourceRecoveryControl = inject(VIBE64_RESOURCE_RECOVERY_KEY, null);
const resourceRetryBusy = ref(false);
function setResourceRetryBusy(value) {
  if (!value && !resourceRetryBusy.value) return;
  resourceRetryBusy.value = value;
  operationBusy.value = value;
}
</script>

<style scoped>
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

.vibe64-launch-controls__preview-status-detail {
  background: rgba(var(--v-theme-on-surface), 0.045);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.7);
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.78rem;
  line-height: 1.35;
  max-width: min(44rem, calc(100% - 2rem));
  overflow-wrap: anywhere;
  padding: 0.45rem 0.6rem;
  text-align: left;
  white-space: normal;
}

.vibe64-launch-controls__preview-overlay {
  background:
    linear-gradient(180deg, rgba(var(--v-theme-primary), 0.035), rgba(var(--v-theme-surface), 0.9)),
    rgb(var(--v-theme-surface));
  z-index: 1;
}

.vibe64-launch-controls__preview-diagnostic {
  align-self: center;
  background: rgba(var(--v-theme-surface), 0.96);
  border: 1px solid rgba(var(--v-theme-error), 0.22);
  border-radius: 12px;
  box-shadow: 0 1.2rem 3rem rgba(15, 23, 42, 0.18);
  justify-self: center;
  max-width: min(34rem, calc(100% - 2rem));
  padding: 1.25rem;
  text-align: center;
  z-index: 2;
}

.vibe64-launch-controls__preview-diagnostic strong {
  color: rgba(var(--v-theme-on-surface), 0.9);
  font-size: 1rem;
}

.vibe64-launch-controls__preview-diagnostic span {
  color: rgba(var(--v-theme-on-surface), 0.72);
  max-width: 100%;
  overflow-wrap: anywhere;
}

.vibe64-launch-controls__preview-diagnostic-icon {
  color: rgb(var(--v-theme-error));
}

.vibe64-launch-controls__preview-diagnostic-actions {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: center;
}

.vibe64-launch-controls__preview-pulse {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.1);
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 999px;
  contain: paint;
  color: rgba(var(--v-theme-primary), 0.56);
  display: inline-flex;
  height: 5.25rem;
  justify-content: center;
  opacity: 0.72;
  transform: translateZ(0);
  width: 5.25rem;
}

.vibe64-launch-controls__preview-pulse--active {
  animation: vibe64-launch-preview-pulse 1.7s ease-in-out infinite;
  color: rgba(var(--v-theme-primary), 0.72);
  opacity: 1;
  will-change: opacity, transform;
}

@keyframes vibe64-launch-preview-pulse {
  0%,
  100% {
    opacity: 0.46;
    transform: scale(0.94) translateZ(0);
  }

  50% {
    opacity: 1;
    transform: scale(1) translateZ(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-launch-controls__preview-pulse--active {
    animation: none;
  }
}

/* A failure that is a whole stack trace reads as a few lines; the activity card keeps all of it. */
.vibe64-launch-controls__preview-empty-text {
  -webkit-box-orient: vertical;
  display: -webkit-box;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  max-width: 48rem;
  overflow: hidden;
  overflow-wrap: anywhere;
}
</style>
