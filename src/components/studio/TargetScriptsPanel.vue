<template>
  <div class="target-scripts-panel">
    <div class="target-scripts-panel__toolbar">
      <v-btn
        :disabled="loading"
        :icon="mdiRefresh"
        aria-label="Refresh target scripts"
        size="small"
        title="Refresh target scripts"
        variant="text"
        @click="refreshScripts()"
      />
      <v-btn
        :disabled="loading || resetBusy"
        :loading="resetBusy"
        :prepend-icon="mdiRestore"
        size="small"
        variant="tonal"
        @click="resetStarred()"
      >
        Reset starred
      </v-btn>
    </div>

    <v-progress-linear
      v-if="loading"
      color="primary"
      height="4"
      indeterminate
      rounded
      class="mb-3"
    />

    <StudioErrorNotice
      v-if="loadError"
      title="Target scripts need attention"
      :error="loadError"
      compact
      class="mb-2"
    />

    <div v-if="loadError" class="target-scripts-panel__retry">
      <v-btn
        :disabled="loading"
        :loading="loading"
        color="primary"
        size="small"
        variant="tonal"
        @click="refreshScripts()"
      >
        Retry
      </v-btn>
    </div>

    <v-alert
      v-else-if="!loading && scripts.length === 0"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-0"
    >
      No target scripts are available.
    </v-alert>

    <div v-else-if="scripts.length > 0" class="target-scripts-panel__body">
      <section
        v-for="section in scriptSections"
        :key="section.id"
        :class="['target-scripts-panel__section', `target-scripts-panel__${section.id}`]"
        :aria-label="section.ariaLabel"
      >
        <div
          v-if="section.showLabel"
          class="target-scripts-panel__section-marker"
        >
          <span>{{ section.label }}</span>
          <v-chip
            size="x-small"
            variant="tonal"
          >
            {{ section.scripts.length }}
          </v-chip>
        </div>

        <div
          class="target-scripts-panel__grid"
          :class="{ 'target-scripts-panel__grid--starred': section.id === 'starred' }"
        >
          <v-card
            v-for="script in section.scripts"
            :key="`${section.id}-${script.name}`"
            border
            class="target-script-tile"
            :class="{ 'target-script-tile--starred': isStarred(script.name) }"
            elevation="0"
          >
            <div class="target-script-tile__top">
              <code class="target-script-tile__name">{{ script.name }}</code>
              <v-btn
                :aria-label="isStarred(script.name) ? `Unstar ${script.name}` : `Star ${script.name}`"
                :disabled="isStarBusy(script.name) || resetBusy"
                :icon="isStarred(script.name) ? mdiStar : mdiStarOutline"
                :loading="isStarBusy(script.name)"
                color="amber"
                size="small"
                :title="isStarred(script.name) ? 'Unstar target script' : 'Star target script'"
                variant="text"
                @click="toggleStar(script)"
              />
            </div>
            <code class="target-script-tile__command">{{ script.command }}</code>
            <v-btn
              :aria-label="`Run ${script.name}`"
              :disabled="Boolean(runBusyName) || isStarBusy(script.name) || resetBusy"
              :loading="runBusyName === script.name"
              :prepend-icon="mdiPlay"
              block
              class="target-script-tile__run"
              color="primary"
              size="large"
              title="Run target script"
              variant="flat"
              @click="runScript(script)"
            >
              Run
            </v-btn>
          </v-card>
        </div>
      </section>
    </div>

    <v-dialog
      v-if="terminalVisible"
      v-model="terminalVisible"
      aria-label="Target script terminal"
      eager
      fullscreen
      persistent
      transition="dialog-bottom-transition"
    >
      <v-card class="target-script-terminal">
        <v-toolbar
          border
          class="target-script-terminal__toolbar"
          color="surface"
          density="comfortable"
        >
          <v-btn
            :icon="mdiClose"
            aria-label="Close target script terminal"
            title="Close target script terminal"
            variant="text"
            @click="closeTerminal()"
          />
          <v-toolbar-title class="target-script-terminal__toolbar-title">
            <span class="target-script-terminal__title">
              {{ currentTerminalScriptName || "Target script" }}
            </span>
            <span class="target-script-terminal__subtitle">
              {{ terminalCommandPreview || "Ready." }}
            </span>
          </v-toolbar-title>
          <v-spacer />
          <div class="target-script-terminal__actions">
            <v-btn
              v-if="canRetry"
              :loading="terminalStarting"
              color="primary"
              size="small"
              variant="flat"
              @click="retryTerminal()"
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
          </div>
        </v-toolbar>

        <v-card-text class="target-script-terminal__body">
          <StudioErrorNotice
            v-if="terminalError"
            title="Target script terminal needs attention"
            :error="terminalError"
            compact
            class="mb-2"
          />

          <div ref="terminalHost" class="target-script-terminal__host" />

          <div class="target-script-terminal__footer">
            <span>{{ terminalCommandPreview || "Ready." }}</span>
            <v-chip
              v-if="terminalStatus"
              size="x-small"
              variant="tonal"
            >
              {{ terminalStatus }}
            </v-chip>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script setup>
import {
  mdiClose,
  mdiPlay,
  mdiRefresh,
  mdiRestore,
  mdiStar,
  mdiStarOutline
} from "@mdi/js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import {
  useTargetScripts
} from "@/composables/useTargetScripts.js";

const {
  canRetry,
  closeTerminal,
  currentTerminalScriptName,
  isStarBusy,
  isStarred,
  loadError,
  loading,
  refreshScripts,
  resetBusy,
  resetStarred,
  retryTerminal,
  runBusyName,
  runScript,
  scriptSections,
  scripts,
  sendCtrlC,
  terminalCommandPreview,
  terminalError,
  terminalExited,
  terminalHost,
  terminalSessionId,
  terminalStarting,
  terminalStatus,
  terminalVisible,
  toggleStar
} = useTargetScripts();
</script>

<style scoped>
.target-scripts-panel {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.target-scripts-panel__toolbar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  justify-content: flex-end;
  min-width: 0;
}

.target-scripts-panel :deep(.v-btn) {
  --v-btn-height: 2.5rem;
}

.target-scripts-panel__toolbar :deep(.v-btn--icon) {
  min-width: 2.5rem;
}

.target-scripts-panel__retry {
  display: flex;
  justify-content: flex-end;
}

.target-scripts-panel__body {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.target-scripts-panel__section {
  display: grid;
  gap: 0.55rem;
  min-width: 0;
}

.target-scripts-panel__section-marker {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: flex-start;
  min-width: 0;
}

.target-scripts-panel__section-marker span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.2;
  text-transform: uppercase;
}

.target-scripts-panel__grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
  min-width: 0;
}

.target-scripts-panel__grid--starred {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
}

.target-script-tile {
  border-color: rgba(var(--v-theme-outline), 0.28);
  border-radius: 8px;
  display: grid;
  gap: 0.65rem;
  min-width: 0;
  padding: 0.8rem;
}

.target-script-tile--starred {
  background: rgba(var(--v-theme-primary), 0.045);
  border-color: rgba(var(--v-theme-primary), 0.3);
}

.target-script-tile__top {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  min-width: 0;
}

.target-script-tile__name,
.target-script-tile__command {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  min-width: 0;
}

.target-script-tile__name {
  font-size: 0.94rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-script-tile__command {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  line-height: 1.35;
  min-height: 2.1rem;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.target-script-tile__run {
  min-height: 3rem;
}

.target-script-tile__run :deep(.v-btn__content) {
  font-weight: 700;
}

.target-script-terminal {
  display: flex;
  height: 100vh;
  min-height: 0;
  min-width: 0;
}

.target-script-terminal__toolbar {
  flex: 0 0 auto;
  min-width: 0;
}

.target-script-terminal__toolbar-title {
  display: grid;
  gap: 0.05rem;
  min-width: 0;
}

.target-script-terminal__title {
  font-size: 0.85rem;
  font-weight: 700;
  line-height: 1.2;
  min-width: 0;
}

.target-script-terminal__subtitle,
.target-script-terminal__footer {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.75rem;
}

.target-script-terminal__subtitle,
.target-script-terminal__footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.target-script-terminal__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
  min-width: 0;
}

.target-script-terminal__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 0.75rem;
}

.target-script-terminal__host {
  background: #101216;
  border: 2px solid rgba(var(--v-theme-outline), 0.38);
  border-radius: 6px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  padding: 0.35rem;
}

.target-script-terminal__footer {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.75rem;
  justify-content: space-between;
  margin-top: 0.5rem;
  min-width: 0;
}

@media (max-width: 760px) {
  .target-script-terminal__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .target-scripts-panel__toolbar,
  .target-script-terminal__actions {
    justify-content: flex-start;
  }

  .target-script-terminal__body {
    padding: 0.5rem;
  }
}

@media (max-width: 620px) {
  .target-scripts-panel__grid,
  .target-scripts-panel__grid--starred {
    grid-template-columns: 1fr;
  }

  .target-script-tile {
    padding: 0.7rem;
  }
}
</style>
