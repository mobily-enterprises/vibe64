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
            :icon="mdiChevronLeft"
            size="small"
            title="Move controls left"
            variant="text"
            @click="movePreviewToolbar(-1)"
          />

          <button
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
            <v-icon :icon="mdiDotsHorizontal" size="18" />
          </button>

          <v-btn
            class="vibe64-launch-controls__position-button"
            :disabled="previewToolbarPosition === 'right'"
            :icon="mdiChevronRight"
            size="small"
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
            :icon="mdiChevronLeft"
            size="small"
            title="Move controls left"
            variant="text"
            @click="movePreviewToolbar(-1)"
          />

          <v-btn
            v-if="embeddedPreview"
            class="vibe64-launch-controls__mobile-collapse-button"
            :icon="mdiChevronUp"
            size="small"
            title="Collapse preview controls"
            variant="text"
            @click="collapsePreviewToolbar"
          />

          <form
            v-if="embeddedPreview && previewBaseUrl"
            class="vibe64-launch-controls__preview-nav"
            :class="{ 'vibe64-launch-controls__preview-nav--invalid': previewAddressError }"
            :title="previewAddressError || 'Preview URL'"
            @submit.prevent="submitPreviewAddress"
          >
            <v-btn
              aria-label="Go back in preview"
              :disabled="!previewBackAvailable"
              :icon="mdiArrowLeft"
              size="small"
              title="Go back in preview"
              type="button"
              variant="text"
              @click="goPreviewBack"
            />
            <v-menu
              v-if="previewRoutesAvailable"
              location="bottom start"
            >
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  aria-label="Preview pages"
                  :icon="mdiRoutes"
                  size="small"
                  title="Preview pages"
                  type="button"
                  variant="text"
                />
              </template>

              <v-list
                class="vibe64-launch-controls__route-menu"
                density="compact"
              >
                <v-list-item
                  v-for="route in previewRoutes"
                  :key="route.id"
                  :subtitle="route.pathTemplate"
                  :title="route.label"
                  @click="openPreviewRoute(route)"
                />
              </v-list>
            </v-menu>
            <input
              v-model="previewAddressDraft"
              aria-label="Preview URL"
              :aria-invalid="previewAddressError ? 'true' : 'false'"
              autocapitalize="off"
              autocomplete="off"
              class="vibe64-launch-controls__preview-address"
              spellcheck="false"
              type="text"
              @blur="previewAddressBlur"
              @focus="previewAddressFocus"
              @keydown.esc.prevent="resetPreviewAddressDraft"
            >
            <v-btn
              :icon="mdiRefresh"
              size="small"
              title="Reload preview"
              type="button"
              variant="text"
              @click="reloadPreview"
            />
            <v-btn
              :disabled="!previewDisplayedAddress"
              :icon="mdiContentCopy"
              size="small"
              title="Copy preview URL"
              type="button"
              variant="text"
              @click.prevent="copyPreviewUrl"
            />
          </form>

          <div class="vibe64-launch-controls__secondary-actions">
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
                v-if="previewToolbarRecoveryVisible"
                :disabled="operationBusy"
                :icon="mdiRefresh"
                size="small"
                title="Restart preview"
                variant="text"
                @click="recoverEmbeddedPreview"
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
                v-if="embeddedTerminalFrameVisible"
                aria-label="Show preview and hide launch terminal"
                class="vibe64-launch-controls__terminal-toggle--hide"
                color="primary"
                :prepend-icon="mdiEyeOutline"
                size="small"
                title="Show preview and hide launch terminal"
                variant="flat"
                @click="toggleTerminal"
              >
                Preview
              </v-btn>

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
              v-else-if="embeddedManualStartButtonVisible"
              class="vibe64-launch-controls__auto-start-actions"
            >
              <v-btn
                aria-label="Start preview"
                class="vibe64-launch-controls__auto-start-button"
                :disabled="embeddedManualStartButtonDisabled"
                :icon="mdiPlayCircleOutline"
                :loading="operationBusy"
                size="small"
                title="Start preview"
                variant="text"
                @click="forceStartEmbeddedPreview"
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
              :icon="mdiRefresh"
              size="small"
              title="Retry preview status"
              variant="text"
              @click="retryLaunchStatus"
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

            <v-menu
              v-if="previewIssueVisible"
              :close-on-content-click="false"
              location="bottom end"
            >
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  class="vibe64-launch-controls__attention-button"
                  color="warning"
                  :icon="mdiAlertCircleOutline"
                  size="small"
                  :title="previewIssue.title"
                  variant="text"
                />
              </template>

              <v-card class="vibe64-launch-controls__attention-menu">
                <v-card-text class="vibe64-launch-controls__attention-body">
                  <v-icon
                    class="vibe64-launch-controls__attention-icon"
                    :icon="mdiAlertCircleOutline"
                    size="28"
                  />
                  <div>
                    <strong>{{ previewIssue.title }}</strong>
                    <p>{{ previewIssue.message }}</p>
                  </div>
                </v-card-text>

                <v-card-actions class="vibe64-launch-controls__attention-actions">
                  <v-btn
                    v-if="previewCanShowLog"
                    :prepend-icon="mdiConsoleLine"
                    size="small"
                    variant="tonal"
                    @click="showLaunchLog"
                  >
                    Show log
                  </v-btn>
                  <v-btn
                    v-if="previewCanRestart && embeddedStartTarget"
                    :disabled="operationBusy"
                    :prepend-icon="mdiRefresh"
                    size="small"
                    variant="tonal"
                    @click="recoverEmbeddedPreview"
                  >
                    Restart preview
                  </v-btn>
                  <v-btn
                    v-if="terminalCanRetry && !(previewCanRestart && embeddedStartTarget)"
                    :disabled="operationBusy"
                    :icon="mdiRefresh"
                    size="small"
                    title="Retry preview"
                    variant="text"
                    @click="retryTerminal"
                  />
                </v-card-actions>
              </v-card>
            </v-menu>

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
        </div>
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
        <span>{{ previewInFlightText || "Opening preview." }}</span>
      </div>
      <div
        v-if="previewNoticeVisible"
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
          <v-btn
            v-if="previewTryVisible"
            color="primary"
            :prepend-icon="mdiRefresh"
            size="small"
            variant="flat"
            @click="tryEmbeddedPreview"
          >
            Try
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
        <span>{{ previewEmptyText }}</span>
        <code
          v-if="launchStatusDetailText"
          class="vibe64-launch-controls__preview-status-detail"
        >
          {{ launchStatusDetailText }}
        </code>
      </div>
      <Vibe64TerminalFrame
        v-if="embeddedTerminalFrameVisible"
        class="vibe64-launch-controls__terminal vibe64-launch-controls__terminal--embedded"
        :command-preview="terminalCommandPreview"
        :error="terminalError"
        :status="terminalStatus"
        :subtitle="terminalSubtitle"
        :terminal-host-ref="setTerminalHost"
        :title="terminalTitle"
      >
        <template #actions>
          <v-btn
            v-if="previewTerminalRecoveryVisible"
            :disabled="operationBusy"
            :prepend-icon="mdiRefresh"
            size="small"
            title="Restart preview"
            variant="tonal"
            @click="recoverEmbeddedPreview"
          >
            Restart preview
          </v-btn>
        </template>
      </Vibe64TerminalFrame>
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

    <v-dialog
      v-model="previewRouteDialogVisible"
      max-width="520"
    >
      <v-card class="vibe64-launch-controls__route-card">
        <v-card-title>{{ previewRouteSelection?.label || "Preview page" }}</v-card-title>

        <v-card-text>
          <v-text-field
            density="compact"
            label="URL"
            :model-value="previewRouteDialogPath"
            readonly
            variant="outlined"
          />

          <v-text-field
            v-for="param in previewRouteDialogParams"
            :key="param.name"
            v-model="previewRouteFormValues[param.name]"
            density="comfortable"
            :hint="param.description"
            :label="param.label"
            :placeholder="param.placeholder"
            :persistent-hint="Boolean(param.description)"
            variant="outlined"
            @keydown.enter.prevent="submitPreviewRouteDialog"
          />

          <v-alert
            v-if="previewRouteDialogError"
            density="compact"
            type="warning"
            variant="tonal"
          >
            {{ previewRouteDialogError }}
          </v-alert>
        </v-card-text>

        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="previewRouteDialogVisible = false"
          >
            Cancel
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            @click="submitPreviewRouteDialog"
          >
            Open
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import {
  mdiAlertCircleOutline,
  mdiArrowLeft,
  mdiChevronLeft,
  mdiChevronRight,
  mdiChevronUp,
  mdiCogOutline,
  mdiConsoleLine,
  mdiContentCopy,
  mdiDotsHorizontal,
  mdiEyeOutline,
  mdiOpenInNew,
  mdiPlayCircleOutline,
  mdiPowerCycle,
  mdiRefresh,
  mdiRoutes,
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
  embeddedManualStartButtonDisabled,
  embeddedManualStartButtonVisible,
  embeddedStartTarget,
  embeddedTerminalFrameVisible,
  collapsePreviewToolbar,
  copyPreviewUrl,
  expandPreviewToolbar,
  forceStartEmbeddedPreview,
  goPreviewBack,
  handlePreviewFrameLoad,
  launchActions,
  launchButtonsDisabled,
  launchStatusChipText,
  launchStatusChipTitle,
  launchStatusChipVisible,
  launchStatusDetailText,
  launchStatusRetryVisible,
  launchTargets,
  launchToolbarDockVisible,
  loading,
  manualLaunchMenuVisible,
  movePreviewToolbar,
  openAction,
  operationBusy,
  openPreviewRoute,
  openPreviewOptions,
  previewBaseUrl,
  previewAddressBlur,
  previewAddressDraft,
  previewAddressError,
  previewAddressFocus,
  previewActivityVisible,
  previewBackAvailable,
  previewCanRestart,
  previewCanShowLog,
  previewDisplayedAddress,
  previewEmptyText,
  previewFrame,
  previewIssue,
  previewIssueVisible,
  previewInFlightText,
  previewLoadingOverlayVisible,
  previewOptions,
  previewOptionsAvailable,
  previewOptionsDialogVisible,
  previewOptionsFormValues,
  previewOptionsPrimaryLabel,
  previewOptionsRemember,
  previewRouteDialogError,
  previewRouteDialogParams,
  previewRouteDialogPath,
  previewRouteDialogVisible,
  previewRouteFormValues,
  previewRouteSelection,
  previewRoutes,
  previewRoutesAvailable,
  previewNotice,
  previewNoticeVisible,
  previewTerminalRecoveryVisible,
  previewToolbarRecoveryVisible,
  previewToolbarExpanded,
  previewToolbarPosition,
  previewTryVisible,
  previewUrl,
  recoverEmbeddedPreview,
  reloadPreview,
  retryLaunchStatus,
  resetPreviewAddressDraft,
  savePreviewOptions,
  submitPreviewAddress,
  submitPreviewRouteDialog,
  tryEmbeddedPreview,
  restartTerminal,
  retryTerminal,
  run,
  runMenuDisabled,
  setTerminalHost,
  showLaunchLog,
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
  toolbarTeleportTarget,
  toggleTerminal,
  visible
} = useVibe64LaunchControlsSurface(props);
</script>

<style scoped>
.vibe64-launch-controls {
  align-items: center;
  display: flex;
  gap: 0.2rem;
  justify-content: flex-end;
  min-width: 0;
}

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

.vibe64-launch-controls--embedded .vibe64-launch-controls__toolbar:not(.vibe64-launch-controls__toolbar--teleported) {
  background: rgba(var(--v-theme-surface), 0.94);
  border: 1px solid rgba(var(--v-theme-outline), 0.1);
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
  border-color: rgba(var(--v-theme-outline), 0.18);
  opacity: 1;
}

.vibe64-launch-controls__toolbar--teleported {
  background: var(--studio-control-rest-bg, rgba(var(--v-theme-surface), 0.94));
  border: 1px solid var(--studio-control-border, rgba(var(--v-theme-outline), 0.12));
  border-radius: var(--studio-control-radius, 7px);
  box-shadow: none;
  flex: 0 0 auto;
  max-width: 100%;
  opacity: 1;
  padding: 0.1rem;
  position: static;
  transform: none;
  z-index: auto;
}

.vibe64-launch-controls__toolbar--teleported .vibe64-launch-controls__position-button {
  display: none;
}

.vibe64-launch-controls__toolbar :deep(.v-btn--icon.v-btn--size-small) {
  height: 1.9rem;
  min-width: 1.9rem;
  width: 1.9rem;
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

.vibe64-launch-controls__preview-nav {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.16);
  border-radius: 999px;
  display: flex;
  flex: 1 1 19rem;
  gap: 0.02rem;
  max-width: min(23rem, 42vw);
  min-height: 2.05rem;
  min-width: min(13rem, 34vw);
  padding: 0 0.12rem;
}

.vibe64-launch-controls__toolbar--teleported .vibe64-launch-controls__preview-nav {
  flex: 1 1 clamp(12rem, 24vw, 20rem);
  max-width: clamp(12rem, 24vw, 20rem);
  min-width: min(12rem, 24vw);
}

.vibe64-launch-controls__preview-nav--invalid {
  border-color: rgba(var(--v-theme-error), 0.48);
}

.vibe64-launch-controls__preview-address {
  background: transparent;
  border: 0;
  color: rgba(var(--v-theme-on-surface), 0.82);
  flex: 1 1 auto;
  font: inherit;
  font-size: 0.78rem;
  min-width: 5rem;
  outline: none;
  overflow: hidden;
  padding: 0 0.12rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-launch-controls__preview-address:focus {
  color: rgba(var(--v-theme-on-surface), 0.95);
}

.vibe64-launch-controls__dock {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.08);
  border: 1px solid rgba(var(--v-theme-primary), 0.18);
  border-radius: 999px;
  display: flex;
  gap: 0.04rem;
  min-height: 2.05rem;
  padding: 0 0.16rem;
}

.vibe64-launch-controls__terminal-toggle--hide {
  font-weight: 720;
  height: 1.9rem;
  letter-spacing: 0;
  min-height: 1.9rem;
  padding-inline: 0.62rem 0.78rem;
  text-transform: none;
}

.vibe64-launch-controls__terminal-toggle--hide :deep(.v-btn__prepend) {
  margin-inline-end: 0.28rem;
}

.vibe64-launch-controls__status-dot {
  border-radius: 999px;
  contain: paint;
  display: inline-block;
  flex: 0 0 auto;
  height: 0.55rem;
  margin: 0 0.35rem;
  transform: translateZ(0);
  will-change: opacity, transform;
  width: 0.55rem;
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

.vibe64-launch-controls__route-menu {
  max-width: min(24rem, 92vw);
  min-width: min(14rem, 92vw);
}

.vibe64-launch-controls__attention-button {
  color: rgb(var(--v-theme-warning));
}

.vibe64-launch-controls__attention-menu {
  max-width: min(25rem, calc(100vw - 2rem));
}

.vibe64-launch-controls__attention-body {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  padding-bottom: 0.35rem;
}

.vibe64-launch-controls__attention-body strong {
  color: rgba(var(--v-theme-on-surface), 0.9);
  display: block;
  font-size: 0.95rem;
  line-height: 1.35;
}

.vibe64-launch-controls__attention-body p {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.86rem;
  line-height: 1.45;
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
}

.vibe64-launch-controls__attention-icon {
  color: rgb(var(--v-theme-warning));
  flex: 0 0 auto;
  margin-top: 0.08rem;
}

.vibe64-launch-controls__attention-actions {
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0 1rem 0.9rem;
}

.vibe64-launch-controls__options-card :deep(.v-card-text) {
  display: grid;
  gap: 1rem;
}

.vibe64-launch-controls__route-card :deep(.v-card-text) {
  display: grid;
  gap: 0.75rem;
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

  .vibe64-launch-controls__toolbar--teleported.vibe64-launch-controls__toolbar--mobile-expanded .vibe64-launch-controls__preview-nav {
    grid-column: 2;
    grid-row: 1;
    max-width: none;
    min-width: 0;
    width: 100%;
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

  .vibe64-launch-controls__preview-nav {
    flex: 0 0 min(18rem, 62vw);
    max-width: none;
    min-width: min(16rem, 58vw);
  }

  .vibe64-launch-controls__toolbar--teleported .vibe64-launch-controls__preview-nav {
    flex: 0 0 min(16rem, 66vw);
    max-width: none;
    min-width: min(13rem, 58vw);
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
    transform: scale(0.84) translateZ(0);
  }

  50% {
    opacity: 1;
    transform: scale(1) translateZ(0);
  }
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

</style>
