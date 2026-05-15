<template>
  <div class="npm-scripts-panel">
    <div class="npm-scripts-panel__toolbar">
      <v-btn
        :disabled="loading"
        :icon="mdiRefresh"
        aria-label="Refresh npm scripts"
        size="small"
        title="Refresh npm scripts"
        variant="text"
        @click="loadScripts()"
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
      title="NPM scripts need attention"
      :error="loadError"
      compact
      class="mb-2"
    />

    <div v-if="loadError" class="npm-scripts-panel__retry">
      <v-btn
        :disabled="loading"
        :loading="loading"
        color="primary"
        size="small"
        variant="tonal"
        @click="loadScripts()"
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
      No npm scripts found in package.json.
    </v-alert>

    <div v-else-if="scripts.length > 0" class="npm-scripts-panel__body">
      <section
        v-for="section in scriptSections"
        :key="section.id"
        :class="['npm-scripts-panel__section', `npm-scripts-panel__${section.id}`]"
        :aria-label="section.ariaLabel"
      >
        <div
          v-if="section.showLabel"
          class="npm-scripts-panel__section-marker"
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
          class="npm-scripts-panel__grid"
          :class="{ 'npm-scripts-panel__grid--starred': section.id === 'starred' }"
        >
          <v-card
            v-for="script in section.scripts"
            :key="`${section.id}-${script.name}`"
            border
            class="npm-script-tile"
            :class="{ 'npm-script-tile--starred': isStarred(script.name) }"
            elevation="0"
          >
            <div class="npm-script-tile__top">
              <code class="npm-script-tile__name">{{ script.name }}</code>
              <v-btn
                :aria-label="isStarred(script.name) ? `Unstar ${script.name}` : `Star ${script.name}`"
                :disabled="isStarBusy(script.name) || resetBusy"
                :icon="isStarred(script.name) ? mdiStar : mdiStarOutline"
                :loading="isStarBusy(script.name)"
                color="amber"
                size="small"
                :title="isStarred(script.name) ? 'Unstar npm script' : 'Star npm script'"
                variant="text"
                @click="toggleStar(script)"
              />
            </div>
            <code class="npm-script-tile__command">{{ script.command }}</code>
            <v-btn
              :aria-label="`Run ${script.name}`"
              :disabled="Boolean(runBusyName) || isStarBusy(script.name) || resetBusy"
              :loading="runBusyName === script.name"
              :prepend-icon="mdiPlay"
              block
              class="npm-script-tile__run"
              color="primary"
              size="large"
              title="Run npm script"
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
      aria-label="NPM script terminal"
      eager
      fullscreen
      persistent
      transition="dialog-bottom-transition"
    >
      <v-card class="npm-script-terminal">
        <v-toolbar
          border
          class="npm-script-terminal__toolbar"
          color="surface"
          density="comfortable"
        >
          <v-btn
            :icon="mdiClose"
            aria-label="Close npm script terminal"
            title="Close npm script terminal"
            variant="text"
            @click="closeTerminal()"
          />
          <v-toolbar-title class="npm-script-terminal__toolbar-title">
            <span class="npm-script-terminal__title">
              {{ currentTerminalScriptName || "NPM script" }}
            </span>
            <span class="npm-script-terminal__subtitle">
              {{ terminalCommandPreview || "npm run" }}
            </span>
          </v-toolbar-title>
          <v-spacer />
          <div class="npm-script-terminal__actions">
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

        <v-card-text class="npm-script-terminal__body">
          <StudioErrorNotice
            v-if="terminalError"
            title="NPM script terminal needs attention"
            :error="terminalError"
            compact
            class="mb-2"
          />

          <div ref="terminalHost" class="npm-script-terminal__host" />

          <div class="npm-script-terminal__footer">
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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import {
  mdiClose,
  mdiPlay,
  mdiRefresh,
  mdiRestore,
  mdiStar,
  mdiStarOutline
} from "@mdi/js";
import {
  closeNpmScriptTerminal,
  npmScriptTerminalWebSocketUrl,
  readNpmScripts,
  resetStarredNpmScripts,
  saveStarredNpmScripts,
  startNpmScriptTerminal
} from "@/lib/studioApi.js";
import StudioErrorNotice from "@/components/studio/StudioErrorNotice.vue";
import { useStudioTerminal } from "@/composables/useStudioTerminal.js";

const payload = ref(null);
const loading = ref(false);
const loadError = ref("");
const resetBusy = ref(false);
const starBusyName = ref("");
const runBusyName = ref("");

const terminalVisible = ref(false);
const currentTerminalScriptName = ref("");

const scripts = computed(() => Array.isArray(payload.value?.scripts) ? payload.value.scripts : []);
const scriptByName = computed(() => new Map(scripts.value.map((script) => [script.name, script])));
const starredScriptNames = computed(() => {
  return Array.isArray(payload.value?.starredScriptNames) ? payload.value.starredScriptNames : [];
});
const starredSet = computed(() => new Set(starredScriptNames.value));
const starredScripts = computed(() => {
  return starredScriptNames.value
    .map((scriptName) => scriptByName.value.get(scriptName))
    .filter(Boolean);
});
const otherScripts = computed(() => {
  return scripts.value.filter((script) => !starredSet.value.has(script.name));
});
const scriptSections = computed(() => [
  {
    ariaLabel: "Starred npm scripts",
    id: "starred",
    label: "Starred",
    showLabel: otherScripts.value.length > 0,
    scripts: starredScripts.value
  },
  {
    ariaLabel: "Other npm scripts",
    id: "other-scripts",
    label: "Other scripts",
    showLabel: true,
    scripts: otherScripts.value
  }
].filter((section) => section.scripts.length > 0));
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
  webSocketUrl() {
    return npmScriptTerminalWebSocketUrl(terminalSessionId.value);
  }
});
const canRetry = computed(() => {
  return terminalExited.value && terminalExitCode.value !== 0 && Boolean(currentTerminalScriptName.value);
});

function responseErrorMessage(response, fallback) {
  return String(
    response?.errors?.[0]?.message ||
    response?.error ||
    response?.message ||
    fallback ||
    "Request failed."
  );
}

function assertOkResponse(response, fallback) {
  if (response?.ok === false) {
    throw new Error(responseErrorMessage(response, fallback));
  }
  return response;
}

function isStarred(scriptName) {
  return starredSet.value.has(scriptName);
}

function isStarBusy(scriptName) {
  return starBusyName.value === scriptName;
}

function applyPayload(nextPayload) {
  payload.value = assertOkResponse(nextPayload, "NPM scripts request failed.");
}

async function loadScripts() {
  loading.value = true;
  loadError.value = "";
  try {
    applyPayload(await readNpmScripts());
  } catch (error) {
    loadError.value = String(error?.message || error || "NPM scripts request failed.");
  } finally {
    loading.value = false;
  }
}

async function toggleStar(script) {
  const scriptName = String(script?.name || "");
  if (!scriptName || starBusyName.value) {
    return;
  }
  starBusyName.value = scriptName;
  loadError.value = "";
  try {
    const nextScriptNames = isStarred(scriptName)
      ? starredScriptNames.value.filter((name) => name !== scriptName)
      : [...starredScriptNames.value, scriptName];
    applyPayload(await saveStarredNpmScripts(nextScriptNames));
  } catch (error) {
    loadError.value = String(error?.message || error || "Could not update starred npm scripts.");
  } finally {
    starBusyName.value = "";
  }
}

async function resetStarred() {
  if (resetBusy.value) {
    return;
  }
  resetBusy.value = true;
  loadError.value = "";
  try {
    applyPayload(await resetStarredNpmScripts());
  } catch (error) {
    loadError.value = String(error?.message || error || "Could not reset starred npm scripts.");
  } finally {
    resetBusy.value = false;
  }
}

async function closeRunningTerminalOnly() {
  const existingTerminalId = terminalSessionId.value;
  closeTerminalSocket();
  if (existingTerminalId) {
    await closeNpmScriptTerminal(existingTerminalId).catch(() => null);
  }
}

async function runScript(script) {
  const scriptName = String(script?.name || "");
  if (!scriptName || runBusyName.value) {
    return false;
  }
  runBusyName.value = scriptName;
  terminalStarting.value = true;
  terminalVisible.value = true;
  currentTerminalScriptName.value = scriptName;
  try {
    await closeRunningTerminalOnly();
    resetTerminalSessionState();
    resetTerminalDisplay();
    if (!(await setupTerminalUi())) {
      throw new Error("Terminal view is not ready yet.");
    }
    const session = assertOkResponse(
      await startNpmScriptTerminal(scriptName),
      "NPM script terminal failed to start."
    );
    applyTerminalSession(session, {
      fallbackStatus: "running"
    });
    await connectTerminalSocket();
    return true;
  } catch (error) {
    terminalError.value = String(error?.message || error || "NPM script terminal failed to start.");
    return false;
  } finally {
    terminalStarting.value = false;
    runBusyName.value = "";
  }
}

async function retryTerminal() {
  const script = scriptByName.value.get(currentTerminalScriptName.value);
  if (script) {
    await runScript(script);
  }
}

async function closeTerminal() {
  await closeRunningTerminalOnly();
  resetTerminalSessionState();
  resetTerminalDisplay();
  disposeTerminalUi();
  currentTerminalScriptName.value = "";
  terminalVisible.value = false;
}

onMounted(() => {
  void loadScripts();
});

onBeforeUnmount(() => {
  void closeRunningTerminalOnly();
  disposeTerminalUi();
});
</script>

<style scoped>
.npm-scripts-panel {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.npm-scripts-panel__toolbar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  justify-content: flex-end;
  min-width: 0;
}

.npm-scripts-panel :deep(.v-btn) {
  --v-btn-height: 2.5rem;
}

.npm-scripts-panel__toolbar :deep(.v-btn--icon) {
  min-width: 2.5rem;
}

.npm-scripts-panel__retry {
  display: flex;
  justify-content: flex-end;
}

.npm-scripts-panel__body {
  display: grid;
  gap: 1rem;
  min-width: 0;
}

.npm-scripts-panel__section {
  display: grid;
  gap: 0.55rem;
  min-width: 0;
}

.npm-scripts-panel__section-marker {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: flex-start;
  min-width: 0;
}

.npm-scripts-panel__section-marker span {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.2;
  text-transform: uppercase;
}

.npm-scripts-panel__grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 16rem), 1fr));
  min-width: 0;
}

.npm-scripts-panel__grid--starred {
  grid-template-columns: repeat(auto-fill, minmax(min(100%, 17rem), 1fr));
}

.npm-script-tile {
  border-color: rgba(var(--v-theme-outline), 0.28);
  border-radius: 8px;
  display: grid;
  gap: 0.65rem;
  min-width: 0;
  padding: 0.8rem;
}

.npm-script-tile--starred {
  background: rgba(var(--v-theme-primary), 0.045);
  border-color: rgba(var(--v-theme-primary), 0.3);
}

.npm-script-tile__top {
  align-items: center;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
  min-width: 0;
}

.npm-script-tile__name,
.npm-script-tile__command {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  min-width: 0;
}

.npm-script-tile__name {
  font-size: 0.94rem;
  font-weight: 700;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.npm-script-tile__command {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.78rem;
  line-height: 1.35;
  min-height: 2.1rem;
  overflow: hidden;
  overflow-wrap: anywhere;
}

.npm-script-tile__run {
  min-height: 3rem;
}

.npm-script-tile__run :deep(.v-btn__content) {
  font-weight: 700;
}

.npm-script-terminal {
  display: flex;
  height: 100vh;
  min-height: 0;
  min-width: 0;
}

.npm-script-terminal__toolbar {
  flex: 0 0 auto;
  min-width: 0;
}

.npm-script-terminal__toolbar-title {
  display: grid;
  gap: 0.05rem;
  min-width: 0;
}

.npm-script-terminal__title {
  font-size: 0.85rem;
  font-weight: 700;
  line-height: 1.2;
  min-width: 0;
}

.npm-script-terminal__subtitle,
.npm-script-terminal__footer {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.75rem;
}

.npm-script-terminal__subtitle,
.npm-script-terminal__footer span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.npm-script-terminal__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.25rem;
  justify-content: flex-end;
  min-width: 0;
}

.npm-script-terminal__body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
  padding: 0.75rem;
}

.npm-script-terminal__host {
  background: #101216;
  border: 2px solid rgba(var(--v-theme-outline), 0.38);
  border-radius: 6px;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  padding: 0.35rem;
}

.npm-script-terminal__footer {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.75rem;
  justify-content: space-between;
  margin-top: 0.5rem;
  min-width: 0;
}

@media (max-width: 760px) {
  .npm-script-terminal__footer {
    align-items: flex-start;
    flex-direction: column;
  }

  .npm-scripts-panel__toolbar,
  .npm-script-terminal__actions {
    justify-content: flex-start;
  }

  .npm-script-terminal__body {
    padding: 0.5rem;
  }
}

@media (max-width: 620px) {
  .npm-scripts-panel__grid,
  .npm-scripts-panel__grid--starred {
    grid-template-columns: 1fr;
  }

  .npm-script-tile {
    padding: 0.7rem;
  }
}
</style>
