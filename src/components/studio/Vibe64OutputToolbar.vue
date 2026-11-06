<template>
  <div
    class="vibe64-launch-controls__toolbar"
    :class="[
      {
        'vibe64-launch-controls__toolbar--mobile-collapsed': embeddedPreview && !previewToolbarExpanded,
        'vibe64-launch-controls__toolbar--mobile-expanded': embeddedPreview && previewToolbarExpanded,
        'vibe64-launch-controls__toolbar--teleported': toolbarTeleportTarget
      },
      embeddedPreview ? `vibe64-launch-controls__toolbar--${previewToolbarPosition}` : ''
    ]"
  >
    <div
      v-if="embeddedPreview"
      class="vibe64-launch-controls__mobile-collapsed"
    >
      <v-btn
        class="vibe64-launch-controls__position-button"
        :disabled="previewToolbarPosition === 'left'"
        icon="$chevronLeft"
        size="small"
        density="comfortable"
        title="Move controls left"
        variant="text"
        @click="movePreviewToolbar(-1)"
      />

      <button
        aria-label="Show preview controls"
        class="vibe64-launch-controls__mobile-expand"
        type="button"
        title="Show preview controls"
        @click="expandPreviewToolbar"
      >
        <span
          class="vibe64-launch-controls__status-dot"
          :class="`vibe64-launch-controls__status-dot--${terminalIndicatorState}`"
          :aria-label="terminalIndicatorLabel"
          :title="terminalIndicatorLabel"
        />
        <v-icon icon="$moreHoriz" size="18" />
      </button>

      <v-btn
        class="vibe64-launch-controls__position-button"
        :disabled="previewToolbarPosition === 'right'"
        icon="$chevronRight"
        size="small"
        density="comfortable"
        title="Move controls right"
        variant="text"
        @click="movePreviewToolbar(1)"
      />
    </div>

    <div class="vibe64-launch-controls__toolbar-main">
      <v-btn
        v-if="embeddedPreview"
        class="vibe64-launch-controls__position-button"
        :disabled="previewToolbarPosition === 'left'"
        icon="$chevronLeft"
        size="small"
        density="comfortable"
        title="Move controls left"
        variant="text"
        @click="movePreviewToolbar(-1)"
      />

      <v-btn
        v-if="embeddedPreview"
        class="vibe64-launch-controls__mobile-collapse-button"
        icon="$collapse"
        size="small"
        density="comfortable"
        title="Collapse preview controls"
        variant="text"
        @click="collapsePreviewToolbar"
      />

      <!-- Client group: the page shown in this browser. -->
      <Vibe64PreviewAddressBar v-if="previewNavVisible" :surface="surface" />
      <v-btn
        v-else-if="embeddedPreview"
        :disabled="loading"
        icon="$refresh"
        aria-label="Refresh output status"
        title="Refresh output status"
        variant="text"
        @click="retryLaunchStatus"
      />

      <div class="vibe64-launch-controls__secondary-actions">
        <Vibe64PreviewIdentityMenu
          :preview-identity-fix-allowed="previewIdentityFixAllowed"
          :surface="surface"
        />

        <!-- Server group: the app server behind every Preview page. -->
        <div
          v-if="launchToolbarDockVisible"
          aria-label="Preview server"
          class="vibe64-launch-controls__dock"
          role="group"
          :title="terminalTitle"
        >
          <span
            class="vibe64-launch-controls__status-dot"
            :class="`vibe64-launch-controls__status-dot--${terminalIndicatorState}`"
            :aria-label="terminalIndicatorLabel"
            role="img"
            :title="terminalIndicatorLabel"
          />

          <v-btn
            v-for="action in previewNavVisible ? [] : launchActions"
            :key="action.id || action.href"
            icon="$openInNew"
            size="small"
            density="comfortable"
            :title="action.label || action.href"
            variant="text"
            @click="openAction(action)"
          />

          <v-btn
            v-if="terminalVisible"
            aria-label="Show run output"
            icon="$terminal"
            size="small"
            density="comfortable"
            title="Show run output"
            variant="text"
            @click="showLaunchLog"
          />

          <v-btn
            v-if="terminalCanStop"
            aria-label="Stop preview"
            :disabled="operationBusy"
            icon="$stopCircle"
            size="small"
            density="comfortable"
            title="Stop preview"
            variant="text"
            @click="stopTerminal"
          />

          <v-btn
            v-if="previewToolbarRecoveryVisible"
            aria-label="Restart preview"
            :disabled="operationBusy"
            icon="$restartAlt"
            size="small"
            density="comfortable"
            title="Restart preview"
            variant="text"
            @click="recoverEmbeddedPreview"
          />

          <v-btn
            v-if="terminalCanRetry && !previewToolbarRecoveryVisible"
            aria-label="Retry preview"
            :disabled="operationBusy"
            icon="$restartAlt"
            size="small"
            density="comfortable"
            title="Retry"
            variant="text"
            @click="retryTerminal"
          />

          <v-btn
            v-if="terminalCanRestart && !previewToolbarRecoveryVisible"
            aria-label="Restart preview server"
            :disabled="operationBusy"
            icon="$restartAlt"
            size="small"
            density="comfortable"
            title="Restart"
            variant="text"
            @click="restartTerminal"
          />
        </div>

        <div
          v-else-if="embeddedManualStartButtonVisible"
          class="vibe64-launch-controls__auto-start-actions"
        >
          <v-btn
            aria-label="Start preview"
            class="vibe64-launch-controls__auto-start-button"
            :disabled="embeddedManualStartButtonDisabled"
            icon="$playCircle"
            size="small"
            density="comfortable"
            title="Start preview"
            variant="text"
            @click="forceStartEmbeddedPreview"
          />
        </div>

        <v-btn
          v-if="outputOptionsAvailable"
          aria-label="Preview options"
          :disabled="operationBusy"
          icon="$settings"
          size="small"
          density="comfortable"
          title="Preview options"
          variant="text"
          @click="openOutputOptions()"
        />

        <Vibe64OutputResultsMenu :surface="surface" />

        <v-menu v-if="manualLaunchMenuVisible" location="bottom end">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              class="vibe64-launch-controls__run-button"
              color="primary"
              :disabled="runMenuDisabled"
              prepend-icon="$playCircle"
              :size="buttonSize"
              title="Run target"
              :variant="buttonVariant"
            >
              {{ buttonLabel }}
            </v-btn>
          </template>

          <v-list class="vibe64-launch-controls__menu" density="compact">
            <v-list-item
              v-for="outputTarget in outputTargets"
              :key="outputTarget.id"
              :disabled="launchButtonsDisabled || outputTarget.available === false"
              prepend-icon="$playCircle"
              :subtitle="outputTarget.disabledReason || ''"
              :title="outputTarget.label"
              @click="runWithOptions(outputTarget)"
            />
          </v-list>
        </v-menu>

        <v-chip
          v-if="launchStatusChipVisible"
          color="warning"
          size="small"
          variant="tonal"
          :title="launchStatusChipTitle"
        >
          {{ launchStatusChipText }}
        </v-chip>

        <v-btn
          v-if="launchStatusRetryVisible"
          :disabled="loading"
          icon="$refresh"
          size="small"
          density="comfortable"
          title="Retry preview status"
          variant="text"
          @click="retryLaunchStatus"
        />

        <v-btn
          v-if="embeddedPreview"
          class="vibe64-launch-controls__position-button"
          :disabled="previewToolbarPosition === 'right'"
          icon="$chevronRight"
          size="small"
          density="comfortable"
          title="Move controls right"
          variant="text"
          @click="movePreviewToolbar(1)"
        />

        <Vibe64PreviewIssueMenu :surface="surface" />
      </div>
    </div>
  </div>
</template>

<script setup>
// The Preview toolbar: the client group (address bar), the server group
// (status dot, run output, stop and restart) and the run, results, identity
// and issue controls, with its own collapsed form on narrow screens.
import { computed } from "vue";
import Vibe64OutputResultsMenu from "@/components/studio/Vibe64OutputResultsMenu.vue";
import Vibe64PreviewAddressBar from "@/components/studio/Vibe64PreviewAddressBar.vue";
import Vibe64PreviewIdentityMenu from "@/components/studio/Vibe64PreviewIdentityMenu.vue";
import Vibe64PreviewIssueMenu from "@/components/studio/Vibe64PreviewIssueMenu.vue";

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
  embeddedPreview: {
    default: false,
    type: Boolean
  },
  // Whether this person may hand a failed preview sign-in to the AI.
  previewIdentityFixAllowed: {
    required: true,
    type: Boolean
  },
  surface: {
    required: true,
    type: /** @type {import("vue").PropType<import("@/composables/useVibe64OutputControlsSurface.js").Vibe64OutputControlsSurface>} */ (Object)
  }
});

/** @type {import("@/composables/useVibe64OutputControlsSurface.js").Vibe64OutputControlsSurface} */
const {
  collapsePreviewToolbar,
  embeddedManualStartButtonDisabled,
  embeddedManualStartButtonVisible,
  expandPreviewToolbar,
  forceStartEmbeddedPreview,
  launchActions,
  launchButtonsDisabled,
  launchStatusChipText,
  launchStatusChipTitle,
  launchStatusChipVisible,
  launchStatusRetryVisible,
  launchToolbarDockVisible,
  loading,
  manualLaunchMenuVisible,
  movePreviewToolbar,
  openAction,
  openOutputOptions,
  operationBusy,
  outputOptionsAvailable,
  outputTargets,
  previewBrowserControlsVisible,
  previewToolbarExpanded,
  previewToolbarPosition,
  previewToolbarRecoveryVisible,
  recoverEmbeddedPreview,
  restartTerminal,
  retryLaunchStatus,
  retryTerminal,
  runMenuDisabled,
  runWithOptions,
  showLaunchLog,
  stopTerminal,
  terminalCanRestart,
  terminalCanRetry,
  terminalCanStop,
  terminalIndicatorLabel,
  terminalIndicatorState,
  terminalTitle,
  terminalVisible,
  toolbarTeleportTarget
} = props.surface;

// The address bar's client group also opens the page in a new tab.
const previewNavVisible = computed(() => Boolean(props.embeddedPreview && previewBrowserControlsVisible.value));
</script>

<style scoped>
.vibe64-launch-controls__toolbar {
  align-items: center;
  display: flex;
  gap: 0.18rem;
  justify-content: flex-end;
  min-width: 0;
}

.vibe64-launch-controls__toolbar-main {
  align-items: center;
  display: flex;
  gap: 0.18rem;
  min-width: 0;
}

.vibe64-launch-controls__secondary-actions {
  align-items: center;
  display: flex;
  gap: 0.18rem;
  min-width: 0;
}

.vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar:not(.vibe64-launch-controls__toolbar--teleported) {
  background: rgba(var(--v-theme-surface), 0.94);
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 999px;
  box-shadow: 0 0.4rem 1.2rem rgba(15, 23, 42, 0.14);
  left: 50%;
  justify-content: flex-end;
  max-width: min(43rem, calc(100% - 1.5rem));
  opacity: 0.94;
  padding: 0.14rem;
  position: absolute;
  top: 0.75rem;
  transform: translateX(-50%);
  transition: opacity 140ms ease, background-color 140ms ease, border-color 140ms ease;
  z-index: 3;
}

.vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar:not(.vibe64-launch-controls__toolbar--teleported):hover,
.vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar:not(.vibe64-launch-controls__toolbar--teleported):focus-within {
  background: rgba(var(--v-theme-surface), 0.94);
  border-color: rgb(var(--v-theme-outline));
  opacity: 1;
}

.vibe64-launch-controls__toolbar--teleported {
  background: var(--studio-control-rest-bg, rgba(var(--v-theme-surface), 0.94));
  border: 1px solid var(--studio-control-border, rgb(var(--v-theme-outline-variant)));
  border-radius: var(--studio-control-radius, 7px);
  box-shadow: none;
  /* A crowded app bar shortens the address first. */
  flex: 0 1 auto;
  max-width: 100%;
  opacity: 1;
  padding: 0.1rem;
  position: static;
  transform: none;
  z-index: auto;
}

.vibe64-launch-controls__toolbar--teleported .vibe64-launch-controls__secondary-actions {
  flex: 0 0 auto;
}

.vibe64-launch-controls__toolbar--teleported .vibe64-launch-controls__position-button {
  display: none;
}

/* Address-bar buttons: compact (small and comfortable, 28px), thin icons, a subtle hover tint only. */
.vibe64-launch-controls__toolbar :deep(.v-btn--icon.v-btn--size-small) {
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.66);
}

.vibe64-launch-controls__toolbar :deep(.v-btn--icon.v-btn--size-small .v-icon) {
  font-size: 1.05rem;
}

.vibe64-launch-controls__toolbar :deep(.v-btn--icon.v-btn--size-small:hover) {
  color: rgba(var(--v-theme-on-surface), 0.92);
}

.vibe64-launch-controls__toolbar :deep(.v-btn--icon.v-btn--size-small:focus-visible) {
  outline: 2px solid rgba(var(--v-theme-primary), 0.6);
  outline-offset: -2px;
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

/* The server group is its own outlined segment, apart from the page's address field. */
.vibe64-launch-controls__dock {
  align-items: center;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 8px;
  display: flex;
  flex: 0 0 auto;
  gap: 0.02rem;
  margin-inline-start: 0.3rem;
  min-height: 2.05rem;
  padding: 0 0.1rem 0 0.15rem;
}

.vibe64-launch-controls__status-dot {
  border-radius: 999px;
  contain: paint;
  display: inline-block;
  flex: 0 0 auto;
  height: 0.45rem;
  margin: 0 0.3rem;
  transform: translateZ(0);
  will-change: opacity, transform;
  width: 0.45rem;
}

.vibe64-launch-controls__mobile-collapsed {
  align-items: center;
  display: none;
  gap: 0.04rem;
  min-width: 0;
}

.vibe64-launch-controls__mobile-expand {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 999px;
  color: rgba(var(--v-theme-on-surface), 0.78);
  cursor: pointer;
  display: inline-flex;
  gap: 0.38rem;
  height: 1.9rem;
  justify-content: center;
  min-width: 3.4rem;
  padding: 0 0.55rem;
}

.vibe64-launch-controls__mobile-expand:hover,
.vibe64-launch-controls__mobile-expand:focus-visible {
  background: rgba(var(--v-theme-primary), 0.14);
  outline: none;
}

.vibe64-launch-controls__mobile-expand .vibe64-launch-controls__status-dot {
  margin: 0;
}

.vibe64-launch-controls__position-button,
.vibe64-launch-controls__mobile-collapse-button {
  display: none;
}

.vibe64-launch-controls__status-dot--stopped {
  background: rgba(var(--v-theme-on-surface), 0.38);
  box-shadow: 0 0 0 0.16rem rgba(var(--v-theme-on-surface), 0.08);
}

.vibe64-launch-controls__status-dot--starting {
  animation: vibe64-launch-status-pulse 0.9s ease-in-out infinite;
  background: rgb(var(--v-theme-error));
  box-shadow: 0 0 0 0.16rem rgba(var(--v-theme-error), 0.14);
}

.vibe64-launch-controls__status-dot--running {
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 0.16rem rgba(var(--v-theme-success), 0.16);
}

.vibe64-launch-controls__status-dot--failed {
  background: rgb(var(--v-theme-error));
  box-shadow: 0 0 0 0.16rem rgba(var(--v-theme-error), 0.14);
}

.vibe64-launch-controls__menu {
  max-width: min(20rem, 92vw);
  min-width: min(14rem, 92vw);
}

@media (max-width: 980px) {
  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar:not(.vibe64-launch-controls__toolbar--teleported),
  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--left:not(.vibe64-launch-controls__toolbar--teleported),
  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--center:not(.vibe64-launch-controls__toolbar--teleported),
  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--right:not(.vibe64-launch-controls__toolbar--teleported) {
    bottom: 0.85rem;
    opacity: 0.72;
    top: auto;
    max-width: calc(100vw - 0.9rem);
    overflow: hidden;
  }

  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--left:not(.vibe64-launch-controls__toolbar--teleported) {
    left: 0.55rem;
    right: auto;
    transform: none;
  }

  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--center:not(.vibe64-launch-controls__toolbar--teleported) {
    left: 50%;
    right: auto;
    transform: translateX(-50%);
  }

  .vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar--right:not(.vibe64-launch-controls__toolbar--teleported) {
    left: auto;
    right: 0.55rem;
    transform: none;
  }

  .vibe64-launch-controls__toolbar--mobile-collapsed .vibe64-launch-controls__mobile-collapsed {
    display: flex;
  }

  .vibe64-launch-controls__toolbar--mobile-collapsed .vibe64-launch-controls__toolbar-main {
    display: none;
  }

  .vibe64-launch-controls__toolbar--mobile-expanded .vibe64-launch-controls__toolbar-main {
    display: flex;
    max-width: calc(100vw - 1.2rem);
    overflow-x: auto;
    scrollbar-width: none;
  }

  .vibe64-launch-controls__toolbar--mobile-expanded .vibe64-launch-controls__toolbar-main::-webkit-scrollbar {
    display: none;
  }

  .vibe64-launch-controls__toolbar--teleported.vibe64-launch-controls__toolbar--mobile-expanded {
    align-items: stretch;
    box-shadow: 0 0.55rem 1.4rem rgba(15, 23, 42, 0.16);
    max-width: calc(100vw - 1rem);
    position: fixed;
    right: 0.5rem;
    top: calc(var(--v-layout-top, 4rem) + 0.35rem);
    width: min(22rem, calc(100vw - 1rem));
    z-index: 2400;
  }

  .vibe64-launch-controls__toolbar--teleported.vibe64-launch-controls__toolbar--mobile-expanded .vibe64-launch-controls__toolbar-main {
    display: grid;
    gap: 0.14rem;
    grid-template-columns: auto minmax(0, 1fr);
    grid-template-rows: auto auto;
    max-width: none;
    overflow: visible;
    width: 100%;
  }

  .vibe64-launch-controls__toolbar--teleported.vibe64-launch-controls__toolbar--mobile-expanded .vibe64-launch-controls__mobile-collapse-button {
    grid-column: 1;
    grid-row: 1;
  }

  .vibe64-launch-controls__toolbar--teleported.vibe64-launch-controls__toolbar--mobile-expanded .vibe64-launch-controls__secondary-actions {
    grid-column: 1 / -1;
    grid-row: 2;
    justify-content: flex-end;
    overflow-x: auto;
    scrollbar-width: none;
    width: 100%;
  }

  .vibe64-launch-controls__toolbar--teleported.vibe64-launch-controls__toolbar--mobile-expanded .vibe64-launch-controls__secondary-actions::-webkit-scrollbar {
    display: none;
  }

  .vibe64-launch-controls__position-button,
  .vibe64-launch-controls__mobile-collapse-button {
    display: inline-flex;
  }
}

@keyframes vibe64-launch-status-pulse {
  0%,
  100% {
    opacity: 0.32;
    transform: scale(0.84) translateZ(0);
  }

  50% {
    opacity: 1;
    transform: scale(1) translateZ(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .vibe64-launch-controls__status-dot--checking,
  .vibe64-launch-controls__status-dot--starting {
    animation: none;
  }
}
</style>
