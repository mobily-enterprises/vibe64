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

        <div
          v-else-if="embeddedAutoStartButtonVisible"
          class="vibe64-launch-controls__auto-start-actions"
        >
          <v-btn
            aria-label="Start preview"
            class="vibe64-launch-controls__auto-start-button"
            :disabled="launchButtonsDisabled || !embeddedStartTarget"
            :icon="mdiPlayCircleOutline"
            :loading="loading || operationBusy"
            size="small"
            title="Start preview"
            variant="text"
            @click="run(embeddedStartTarget)"
          />
        </div>

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

        <v-btn
          v-if="previewOptionsAvailable"
          :disabled="operationBusy"
          :icon="mdiCogOutline"
          size="small"
          title="Preview options"
          variant="text"
          @click="openPreviewOptions"
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
        allow="clipboard-write"
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
        <v-btn
          v-if="embeddedManualStartButtonVisible"
          :disabled="operationBusy || loading || launchButtonsDisabled"
          :prepend-icon="mdiPlayCircleOutline"
          size="small"
          title="Start preview"
          variant="tonal"
          @click="recoverEmbeddedPreview"
        >
          Start preview
        </v-btn>
        <v-btn
          v-if="previewRetryButtonVisible"
          :disabled="operationBusy || loading"
          :icon="mdiRefresh"
          size="small"
          title="Retry preview"
          variant="tonal"
          @click="recoverEmbeddedPreview"
        />
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

    <v-dialog
      v-model="previewOptionsDialogVisible"
      max-width="520"
    >
      <v-card class="vibe64-launch-controls__options-card">
        <v-card-title>Preview options</v-card-title>

        <v-card-text>
          <v-textarea
            v-for="option in previewOptions"
            :key="option.id"
            v-model="previewOptionsFormValues[option.id]"
            auto-grow
            density="comfortable"
            :hint="option.description || (option.type === 'string-list' ? 'One value per line.' : '')"
            :label="option.label"
            :placeholder="option.placeholder"
            persistent-hint
            rows="3"
            variant="outlined"
          />

          <v-checkbox
            v-model="previewOptionsRemember"
            density="compact"
            hide-details
            label="Remember for this project"
          />
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="previewOptionsDialogVisible = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            @click="savePreviewOptions({ restart: true })"
          >
            {{ previewOptionsPrimaryLabel }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import {
  mdiChevronLeft,
  mdiChevronRight,
  mdiClose,
  mdiCogOutline,
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
  useVibe64LaunchControlsSurface
} from "@/composables/useVibe64LaunchControlsSurface.js";

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
  embeddedAutoStartButtonVisible,
  embeddedRecoveryButtonVisible,
  embeddedManualStartButtonVisible,
  embeddedStartTarget,
  embeddedTerminalVisible,
  copyPreviewUrl,
  handlePreviewFrameLoad,
  launchActions,
  launchButtonsDisabled,
  launchTargets,
  launchToolbarDockVisible,
  loading,
  loadError,
  manualLaunchMenuVisible,
  movePreviewToolbar,
  openAction,
  operationBusy,
  openPreviewOptions,
  previewBaseUrl,
  previewDisplayedUrl,
  previewEmptyText,
  previewFrame,
  previewLoadingOverlayVisible,
  previewOptions,
  previewOptionsAvailable,
  previewOptionsDialogVisible,
  previewOptionsFormValues,
  previewOptionsPrimaryLabel,
  previewOptionsRemember,
  previewRetryButtonVisible,
  previewStarting,
  previewToolbarPosition,
  previewUrl,
  recoverEmbeddedPreview,
  reloadPreview,
  savePreviewOptions,
  restartTerminal,
  retryTerminal,
  run,
  runMenuDisabled,
  setTerminalHost,
  terminalCanRestart,
  terminalCanRetry,
  terminalCommandPreview,
  terminalDisplayed,
  terminalError,
  terminalIndicatorLabel,
  terminalIndicatorState,
  terminalStatus,
  terminalSubtitle,
  terminalTitle,
  terminalWindowStorageKey,
  terminalWindowVisible,
  toggleTerminal,
  visible
} = useVibe64LaunchControlsSurface(props);
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

.vibe64-launch-controls__auto-start-actions {
  align-items: center;
  display: flex;
  gap: 0.12rem;
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

.vibe64-launch-controls__options-card :deep(.v-card-text) {
  display: grid;
  gap: 1rem;
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
