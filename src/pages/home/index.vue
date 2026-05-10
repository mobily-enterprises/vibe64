<template>
  <section class="generated-ui-screen generated-ui-screen--app studio-screen d-flex flex-column ga-3">
    <header class="studio-screen__header d-flex flex-column flex-md-row ga-3 align-md-end justify-space-between">
      <div>
        <h1 class="studio-screen__title">{{ bootstrapReady ? "Current App" : "Bootstrap Doctor" }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-0 studio-screen__lede">
          <template v-if="bootstrapReady">
            Current project:
            <span class="font-weight-medium text-high-emphasis">{{ appNameLabel }}</span>
          </template>
          <template v-else>
            Bootstrap must be complete before Studio can operate on this project.
          </template>
        </p>
      </div>

      <div class="d-flex ga-2 align-center flex-wrap">
        <v-chip
          v-if="bootstrap"
          :color="bootstrapReady ? 'success' : 'warning'"
          variant="tonal"
        >
          {{ bootstrapReady ? "Bootstrap ready" : "Bootstrap blocked" }}
        </v-chip>
        <v-chip
          v-if="bootstrapReady && currentApp"
          :color="currentApp.isJskitApp ? 'success' : 'warning'"
          variant="tonal"
        >
          {{ currentApp.isJskitApp ? "JSKIT app" : "Incomplete scaffold" }}
        </v-chip>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="bootstrapLoading || currentAppLoading"
          size="large"
          :prepend-icon="mdiRefresh"
          class="studio-screen__refresh-button"
          @click="refreshAll"
        >
          Refresh
        </v-btn>
      </div>
    </header>

    <v-alert
      v-if="bootstrapError"
      type="error"
      variant="tonal"
      border="start"
      class="studio-screen__alert"
    >
      {{ bootstrapError }}
    </v-alert>

    <v-progress-linear
      v-if="bootstrapLoading && !bootstrap"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <section v-if="bootstrap && !bootstrapReady" class="bootstrap-doctor d-flex flex-column ga-2">
      <v-sheet rounded="lg" border class="bootstrap-doctor__summary">
        <div class="bootstrap-doctor__summary-main">
          <div class="bootstrap-doctor__summary-icon">
            <v-icon :icon="mdiCloseCircle" color="error" size="32" />
          </div>
          <div>
            <h2 class="text-subtitle-1 mb-1">Bootstrap blocked</h2>
            <p class="text-body-2 text-medium-emphasis mb-2">
              {{ passedCheckCount }} of {{ requiredCheckCount }} required checks are ready.
            </p>
            <v-progress-linear
              :model-value="bootstrapProgressValue"
              color="primary"
              height="8"
              rounded
            />
          </div>
        </div>
      </v-sheet>

      <div class="bootstrap-doctor__checks">
        <v-sheet
          v-for="check in bootstrap.checks"
          :key="check.id"
          rounded="lg"
          border
          :class="[
            'studio-screen__panel',
            'bootstrap-doctor__check',
            `bootstrap-doctor__check--${check.status}`
          ]"
        >
          <div :class="['bootstrap-doctor__status-badge', statusToneClass(check.status)]">
            <v-icon
              class="bootstrap-doctor__status-icon"
              :icon="statusIcon(check.status)"
              :color="statusColor(check.status)"
              :aria-label="statusLabel(check.status)"
              size="30"
            />
          </div>

          <div class="bootstrap-doctor__check-body">
            <div class="bootstrap-doctor__check-header">
              <div>
                <h3 class="text-subtitle-2 mb-1">{{ check.label }}</h3>
                <p class="text-body-2 text-medium-emphasis mb-0">{{ check.explanation }}</p>
              </div>
            </div>

            <div class="bootstrap-doctor__facts">
              <p class="text-caption text-medium-emphasis mb-0 bootstrap-doctor__fact-line">
                <span class="bootstrap-doctor__fact">
                  <strong class="text-high-emphasis">Expected:</strong>
                  {{ check.expected }}
                </span>
                <span class="bootstrap-doctor__fact bootstrap-doctor__observed">
                  <strong class="text-high-emphasis">Observed:</strong>
                  {{ check.observed }}
                </span>
              </p>
            </div>

            <pre v-if="visibleCheckRepairs(check).length" class="bootstrap-doctor__command">{{ repairCommandPreview(check) }}</pre>
          </div>

          <div v-if="visibleCheckRepairs(check).length" class="bootstrap-doctor__actions">
            <template v-for="repair in visibleCheckRepairs(check)" :key="repair.actionId">
              <v-btn
                v-if="repair.kind === 'command'"
                color="primary"
                class="bootstrap-doctor__repair-button"
                variant="flat"
                :prepend-icon="mdiPlayCircleOutline"
                :disabled="Boolean(actionInFlight)"
                @click="confirmRepairAction(check, repair)"
              >
                {{ repair.label || "Repair" }}
              </v-btn>
              <v-btn
                v-else-if="repair.kind === 'terminal'"
                color="primary"
                class="bootstrap-doctor__repair-button"
                variant="flat"
                :prepend-icon="mdiConsoleLine"
                :disabled="Boolean(actionInFlight)"
                @click="openTerminal({ repair })"
              >
                {{ repair.label || "Open terminal" }}
              </v-btn>
              <v-btn
                v-else
                class="bootstrap-doctor__repair-button"
                variant="tonal"
                color="warning"
                disabled
              >
                {{ repair.label || "Manual repair required" }}
              </v-btn>
            </template>
          </div>
        </v-sheet>
      </div>
    </section>

    <template v-if="bootstrapReady">
      <v-sheet
        v-if="reauthActions.length"
        rounded="lg"
        border
        class="studio-screen__panel bootstrap-doctor__runtime-bar"
      >
        <div>
          <p class="text-caption text-medium-emphasis mb-1">Managed runtime</p>
          <p class="text-body-2 mb-0">GitHub and Codex credentials are stored in the managed toolchain volume.</p>
        </div>
        <div class="d-flex ga-2 flex-wrap">
          <v-btn
            v-for="action in reauthActions"
            :key="action.actionId"
            variant="tonal"
            color="primary"
            class="bootstrap-doctor__repair-button"
            @click="openTerminal({ repair: action })"
          >
            {{ action.label }}
          </v-btn>
        </div>
      </v-sheet>

      <v-alert
        v-if="currentAppError"
        type="error"
        variant="tonal"
        border="start"
        class="studio-screen__alert"
      >
        {{ currentAppError }}
      </v-alert>

      <v-progress-linear
        v-if="currentAppLoading && !currentApp"
        color="primary"
        height="6"
        indeterminate
        rounded
      />

      <div v-if="currentApp" class="studio-screen__summary-grid">
        <v-sheet rounded="lg" border class="studio-screen__panel">
          <p class="text-caption text-medium-emphasis mb-1">Root path</p>
          <p class="text-body-2 font-weight-medium mb-0 studio-screen__path">{{ currentApp.rootPath }}</p>
        </v-sheet>

        <v-sheet rounded="lg" border class="studio-screen__panel">
          <p class="text-caption text-medium-emphasis mb-1">Tenancy</p>
          <p class="text-body-2 font-weight-medium mb-0">{{ configValue(currentApp.config.tenancyMode) }}</p>
        </v-sheet>

        <v-sheet rounded="lg" border class="studio-screen__panel">
          <p class="text-caption text-medium-emphasis mb-1">Surface</p>
          <p class="text-body-2 font-weight-medium mb-0">{{ configValue(currentApp.config.surfaceDefaultId) }}</p>
        </v-sheet>

        <v-sheet rounded="lg" border class="studio-screen__panel">
          <p class="text-caption text-medium-emphasis mb-1">Git</p>
          <p class="text-body-2 font-weight-medium mb-0">{{ gitSummary }}</p>
        </v-sheet>
      </div>

      <div v-if="currentApp" class="studio-screen__content-grid">
        <v-sheet rounded="lg" border class="studio-screen__panel">
          <div class="d-flex align-center justify-space-between ga-3 mb-3">
            <h2 class="text-subtitle-1 mb-0">Project Markers</h2>
            <v-chip :color="currentApp.isJskitApp ? 'success' : 'warning'" size="small" variant="tonal">
              {{ markerCountLabel }}
            </v-chip>
          </div>
          <v-list density="compact" class="studio-screen__list">
            <v-list-item
              v-for="marker in currentApp.markers"
              :key="marker.id"
              :title="marker.label"
              :subtitle="marker.exists ? 'Present' : 'Missing'"
            >
              <template #prepend>
                <v-icon :icon="marker.exists ? '$success' : '$warning'" />
              </template>
            </v-list-item>
          </v-list>
        </v-sheet>

        <v-sheet rounded="lg" border class="studio-screen__panel">
          <h2 class="text-subtitle-1 mb-3">Runtime Needs</h2>
          <div class="studio-screen__chips">
            <v-chip
              v-for="need in runtimeNeedItems"
              :key="need.key"
              :color="need.enabled ? 'warning' : 'default'"
              variant="tonal"
            >
              {{ need.label }}: {{ need.enabled ? "present" : "absent" }}
            </v-chip>
          </div>
        </v-sheet>

        <v-sheet rounded="lg" border class="studio-screen__panel">
          <h2 class="text-subtitle-1 mb-3">Surfaces</h2>
          <v-list v-if="currentApp.config.surfaces.length" density="compact" class="studio-screen__list">
            <v-list-item
              v-for="surface in currentApp.config.surfaces"
              :key="surface.id"
              :title="surface.label || surface.id"
              :subtitle="surfaceSubtitle(surface)"
            />
          </v-list>
          <p v-else class="text-body-2 text-medium-emphasis mb-0">No surfaces found.</p>
        </v-sheet>

        <v-sheet rounded="lg" border class="studio-screen__panel">
          <h2 class="text-subtitle-1 mb-3">JSKIT Packages</h2>
          <v-list
            v-if="currentApp.jskitLock.installedPackages.length"
            density="compact"
            class="studio-screen__list"
          >
            <v-list-item
              v-for="installedPackage in currentApp.jskitLock.installedPackages"
              :key="installedPackage.packageId"
              :title="installedPackage.packageId"
              :subtitle="packageSubtitle(installedPackage)"
            />
          </v-list>
          <p v-else class="text-body-2 text-medium-emphasis mb-0">No JSKIT lock packages found.</p>
        </v-sheet>

        <v-sheet rounded="lg" border class="studio-screen__panel studio-screen__panel--wide">
          <h2 class="text-subtitle-1 mb-3">NPM Scripts</h2>
          <div v-if="currentApp.packageJson.scripts.length" class="studio-screen__script-grid">
            <div
              v-for="script in currentApp.packageJson.scripts"
              :key="script.name"
              class="studio-screen__script"
            >
              <span class="font-weight-medium">{{ script.name }}</span>
              <code>{{ script.command }}</code>
            </div>
          </div>
          <p v-else class="text-body-2 text-medium-emphasis mb-0">No scripts found.</p>
        </v-sheet>

        <v-sheet rounded="lg" border class="studio-screen__panel studio-screen__panel--wide">
          <h2 class="text-subtitle-1 mb-3">Git Status</h2>
          <div v-if="currentApp.git.isRepo">
            <p class="text-body-2 mb-3">
              Branch:
              <span class="font-weight-medium">{{ configValue(currentApp.git.branch) }}</span>
            </p>
            <v-list v-if="currentApp.git.changedFiles.length" density="compact" class="studio-screen__list">
              <v-list-item
                v-for="file in currentApp.git.changedFiles"
                :key="`${file.code}:${file.path}`"
                :title="file.path"
                :subtitle="file.code"
              />
            </v-list>
            <p v-else class="text-body-2 text-medium-emphasis mb-0">Working tree clean.</p>
          </div>
          <p v-else class="text-body-2 text-medium-emphasis mb-0">No git repository detected.</p>
        </v-sheet>
      </div>

      <v-sheet
        v-if="!currentAppLoading && !currentApp && !currentAppError"
        rounded="lg"
        border
        class="studio-screen__panel"
      >
        <h2 class="text-subtitle-1 mb-2">Current app unavailable</h2>
        <p class="text-body-2 text-medium-emphasis mb-0">
          The inspection endpoint did not return project metadata.
        </p>
      </v-sheet>
    </template>

    <v-dialog v-model="repairDialogOpen" max-width="760">
      <v-sheet rounded="lg" class="studio-screen__dialog">
        <h2 class="text-subtitle-1 mb-2">Confirm repair</h2>
        <p class="text-body-2 text-medium-emphasis mb-3">
          Studio will run this command locally after confirmation.
        </p>
        <pre class="bootstrap-doctor__command mb-3">{{ confirmRepair?.repair?.commandPreview }}</pre>
        <v-alert v-if="repairResult" :type="repairResult.ok ? 'success' : 'error'" variant="tonal" class="mb-3">
          {{ repairResult.status || (repairResult.ok ? "completed" : "failed") }}
        </v-alert>
        <pre v-if="repairResult?.output || repairResult?.error" class="bootstrap-doctor__output mb-3">{{ repairResult.output || repairResult.error }}</pre>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" :disabled="repairRunning" @click="closeRepairDialog">Close</v-btn>
          <v-btn color="primary" :loading="repairRunning" @click="executeConfirmedRepair">Run repair</v-btn>
        </div>
      </v-sheet>
    </v-dialog>

    <v-dialog v-model="terminalDialogOpen" max-width="980" persistent>
      <v-sheet rounded="lg" class="studio-screen__dialog terminal-dialog">
        <div class="d-flex align-center justify-space-between ga-3 mb-3">
          <div>
            <h2 class="text-subtitle-1 mb-1">{{ terminalTitle }}</h2>
            <p class="text-caption text-medium-emphasis mb-0 terminal-dialog__command">
              {{ terminalCommandPreview }}
            </p>
          </div>
          <v-chip :color="terminalStatus === 'running' ? 'primary' : 'default'" size="small" variant="tonal">
            {{ terminalStatus || "starting" }}
          </v-chip>
        </div>
        <v-alert v-if="terminalError" type="error" variant="tonal" class="mb-3">
          {{ terminalError }}
        </v-alert>
        <div class="terminal-dialog__copy-bar mb-2">
          <v-btn
            variant="tonal"
            :disabled="!terminalSelectedText"
            @click="copyTerminalSelection"
          >
            Copy selection
          </v-btn>
          <p v-if="terminalCopyStatus" class="text-caption text-medium-emphasis mb-0">
            {{ terminalCopyStatus }}
          </p>
        </div>
        <div ref="terminalHost" class="terminal-dialog__host" />
        <div class="d-flex justify-end ga-2 mt-3">
          <v-btn variant="tonal" :disabled="!terminalSessionId" @click="sendCtrlC">Send Ctrl-C</v-btn>
          <v-btn color="primary" variant="flat" @click="closeTerminal">Close</v-btn>
        </div>
      </v-sheet>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { createTransientRetryHttpClient } from "@jskit-ai/http-runtime/client";
import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiCloseCircle,
  mdiConsoleLine,
  mdiPlayCircleOutline,
  mdiRefresh
} from "@mdi/js";
import "@xterm/xterm/css/xterm.css";

const BOOTSTRAP_ENDPOINT = resolveScopedApiBasePath({
  routeBase: "/",
  relativePath: "studio/bootstrap",
  strictParams: false
});
const CURRENT_APP_ENDPOINT = resolveScopedApiBasePath({
  routeBase: "/",
  relativePath: "studio/current-app",
  strictParams: false
});
const BOOTSTRAP_TERMINAL_ENDPOINT = `${BOOTSTRAP_ENDPOINT}/terminal`;

const httpClient = createTransientRetryHttpClient({
  credentials: "include",
  csrf: {
    enabled: false
  }
});

const bootstrap = ref(null);
const bootstrapLoading = ref(false);
const bootstrapError = ref("");
const currentApp = ref(null);
const currentAppLoading = ref(false);
const currentAppError = ref("");
const actionInFlight = ref("");
const confirmRepair = ref(null);
const repairResult = ref(null);
const repairRunning = ref(false);
const terminalDialogOpen = ref(false);
const terminalError = ref("");
const terminalHost = ref(null);
const terminalSessionId = ref("");
const terminalStatus = ref("");
const terminalTitle = ref("Terminal");
const terminalCommandPreview = ref("");
const terminalSelectedText = ref("");
const terminalCopyStatus = ref("");

let terminalInstance = null;
let terminalFitAddon = null;
let terminalDataDisposable = null;
let terminalSelectionDisposable = null;
let terminalResizeHandler = null;
let terminalPollTimer = null;
let terminalAutoCopyTimer = null;
let terminalOutputOffset = 0;
let terminalAutoCopiedText = "";

const bootstrapReady = computed(() => {
  return bootstrap.value?.ready === true;
});

const requiredChecks = computed(() => {
  return (bootstrap.value?.checks || []).filter((check) => check.required !== false);
});

const requiredCheckCount = computed(() => {
  return requiredChecks.value.length;
});

const passedCheckCount = computed(() => {
  return requiredChecks.value.filter((check) => check.status === "pass").length;
});

const bootstrapProgressValue = computed(() => {
  if (!requiredCheckCount.value) {
    return 0;
  }
  return Math.round((passedCheckCount.value / requiredCheckCount.value) * 100);
});

const repairDialogOpen = computed({
  get() {
    return Boolean(confirmRepair.value);
  },
  set(value) {
    if (!value) {
      closeRepairDialog();
    }
  }
});

const appNameLabel = computed(() => {
  return currentApp.value?.packageJson?.name || "loading";
});

const gitSummary = computed(() => {
  const git = currentApp.value?.git;
  if (!git?.checked) {
    return "Not checked";
  }
  if (!git.isRepo) {
    return "No repository";
  }
  return git.dirty ? `${git.changedFiles.length} changed` : "Clean";
});

const markerCountLabel = computed(() => {
  const markers = currentApp.value?.markers || [];
  const presentCount = markers.filter((marker) => marker.exists).length;
  return `${presentCount}/${markers.length}`;
});

const runtimeNeedItems = computed(() => {
  const needs = currentApp.value?.runtimeNeeds || {};
  return [
    { key: "auth", label: "Auth", enabled: needs.auth === true },
    { key: "users", label: "Users", enabled: needs.users === true },
    { key: "workspaces", label: "Workspaces", enabled: needs.workspaces === true },
    { key: "database", label: "Database", enabled: needs.database === true }
  ];
});

const reauthActions = computed(() => {
  return (bootstrap.value?.checks || [])
    .filter((check) => check.status === "pass" && ["gh-auth", "codex-auth"].includes(check.id))
    .flatMap((check) => checkRepairs(check));
});

function checkRepairs(check) {
  if (Array.isArray(check?.repairs) && check.repairs.length) {
    return check.repairs.filter(Boolean);
  }
  return [check?.repair].filter(Boolean);
}

function visibleCheckRepairs(check) {
  return check?.status === "fail" ? checkRepairs(check) : [];
}

function repairCommandPreview(check) {
  const repairs = visibleCheckRepairs(check);
  if (repairs.length <= 1) {
    return repairs[0]?.commandPreview || "";
  }
  return repairs
    .map((repair) => `${repair.label || repair.actionId}:\n${repair.commandPreview}`)
    .join("\n\n");
}

function repairInputs() {
  return {};
}

function configValue(value) {
  return String(value || "").trim() || "none";
}

function statusColor(status) {
  if (status === "pass") {
    return "success";
  }
  if (status === "fail") {
    return "error";
  }
  return "warning";
}

function statusIcon(status) {
  if (status === "pass") {
    return mdiCheckCircle;
  }
  if (status === "fail") {
    return mdiCloseCircle;
  }
  return mdiAlertCircleOutline;
}

function statusLabel(status) {
  if (status === "pass") {
    return "Ready";
  }
  if (status === "fail") {
    return "Needs attention";
  }
  return "Unknown";
}

function statusToneClass(status) {
  if (status === "pass") {
    return "bootstrap-doctor__status-badge--pass";
  }
  if (status === "fail") {
    return "bootstrap-doctor__status-badge--fail";
  }
  return "bootstrap-doctor__status-badge--unknown";
}

function surfaceSubtitle(surface) {
  const flags = [];
  flags.push(surface.enabled ? "enabled" : "disabled");
  if (surface.requiresAuth) {
    flags.push("auth");
  }
  if (surface.requiresWorkspace) {
    flags.push("workspace");
  }
  if (surface.pagesRoot) {
    flags.push(`root: ${surface.pagesRoot}`);
  }
  return flags.join(" / ");
}

function packageSubtitle(installedPackage) {
  const parts = [];
  if (installedPackage.version) {
    parts.push(installedPackage.version);
  }
  if (installedPackage.sourceType) {
    parts.push(installedPackage.sourceType);
  }
  if (installedPackage.packagePath) {
    parts.push(installedPackage.packagePath);
  }
  return parts.join(" / ");
}

async function loadBootstrap() {
  bootstrapLoading.value = true;
  bootstrapError.value = "";
  try {
    bootstrap.value = await httpClient.get(BOOTSTRAP_ENDPOINT);
    if (bootstrap.value?.ready) {
      await loadCurrentApp();
    } else {
      currentApp.value = null;
    }
  } catch (loadError) {
    bootstrapError.value = String(loadError?.message || loadError || "Bootstrap check failed.");
  } finally {
    bootstrapLoading.value = false;
  }
}

async function loadCurrentApp() {
  currentAppLoading.value = true;
  currentAppError.value = "";
  try {
    currentApp.value = await httpClient.get(CURRENT_APP_ENDPOINT);
  } catch (loadError) {
    currentAppError.value = String(loadError?.message || loadError || "Current app inspection failed.");
  } finally {
    currentAppLoading.value = false;
  }
}

async function refreshAll() {
  await loadBootstrap();
}

function confirmRepairAction(check, repair = check?.repair) {
  repairResult.value = null;
  confirmRepair.value = {
    check,
    repair
  };
}

function closeRepairDialog() {
  if (repairRunning.value) {
    return;
  }
  confirmRepair.value = null;
  repairResult.value = null;
}

async function executeConfirmedRepair() {
  if (!confirmRepair.value?.repair?.actionId) {
    return;
  }

  const repair = confirmRepair.value.repair;
  const actionId = repair.actionId;
  confirmRepair.value = null;
  actionInFlight.value = actionId;
  repairRunning.value = true;
  repairResult.value = null;
  try {
    await openTerminal({ repair });
  } finally {
    actionInFlight.value = "";
    repairRunning.value = false;
  }
}

function terminalUrl(path = "") {
  return `${BOOTSTRAP_TERMINAL_ENDPOINT}${path}`;
}

function fallbackCopyText(value) {
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

async function copyTerminalText(value, label) {
  const text = String(value || "");
  if (!text) {
    return false;
  }

  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else if (!fallbackCopyText(text)) {
      throw new Error("Clipboard API is unavailable.");
    }
    terminalCopyStatus.value = `${label} copied.`;
    return true;
  } catch (copyError) {
    terminalCopyStatus.value = String(copyError?.message || copyError || "Copy failed.");
    return false;
  }
}

function updateTerminalSelection() {
  terminalSelectedText.value = terminalInstance?.hasSelection?.()
    ? terminalInstance.getSelection()
    : "";
  return terminalSelectedText.value;
}

function scheduleAutoCopyTerminalSelection() {
  const selectedText = updateTerminalSelection();
  if (terminalAutoCopyTimer) {
    window.clearTimeout(terminalAutoCopyTimer);
    terminalAutoCopyTimer = null;
  }
  if (!selectedText || selectedText === terminalAutoCopiedText) {
    return;
  }

  terminalAutoCopyTimer = window.setTimeout(async () => {
    const nextSelectedText = updateTerminalSelection();
    if (!nextSelectedText || nextSelectedText === terminalAutoCopiedText) {
      return;
    }
    if (await copyTerminalText(nextSelectedText, "Selection")) {
      terminalAutoCopiedText = nextSelectedText;
    }
  }, 250);
}

async function copyTerminalSelection() {
  const selectedText = updateTerminalSelection();
  if (await copyTerminalText(selectedText, "Selection")) {
    terminalAutoCopiedText = selectedText;
  }
}

function disposeTerminalUi() {
  if (terminalPollTimer) {
    window.clearInterval(terminalPollTimer);
    terminalPollTimer = null;
  }
  if (terminalAutoCopyTimer) {
    window.clearTimeout(terminalAutoCopyTimer);
    terminalAutoCopyTimer = null;
  }
  if (terminalDataDisposable) {
    terminalDataDisposable.dispose();
    terminalDataDisposable = null;
  }
  if (terminalSelectionDisposable) {
    terminalSelectionDisposable.dispose();
    terminalSelectionDisposable = null;
  }
  if (terminalResizeHandler) {
    window.removeEventListener("resize", terminalResizeHandler);
    terminalResizeHandler = null;
  }
  if (terminalInstance) {
    terminalInstance.dispose();
    terminalInstance = null;
  }
  terminalFitAddon = null;
  terminalSelectedText.value = "";
  terminalOutputOffset = 0;
  terminalAutoCopiedText = "";
}

async function setupTerminalUi() {
  await nextTick();
  disposeTerminalUi();
  terminalInstance = new Terminal({
    convertEol: true,
    cursorBlink: true,
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: 13,
    theme: {
      background: "#111318",
      foreground: "#f4f6fb"
    }
  });
  terminalFitAddon = new FitAddon();
  terminalInstance.loadAddon(terminalFitAddon);
  terminalInstance.open(terminalHost.value);
  terminalFitAddon.fit();
  terminalDataDisposable = terminalInstance.onData((data) => {
    void sendTerminalData(data);
  });
  terminalSelectionDisposable = terminalInstance.onSelectionChange(() => {
    scheduleAutoCopyTerminalSelection();
  });
  terminalResizeHandler = () => {
    terminalFitAddon?.fit();
  };
  window.addEventListener("resize", terminalResizeHandler);
}

function writeTerminalOutput(output) {
  if (!terminalInstance) {
    return;
  }
  const nextOutput = String(output || "");
  if (nextOutput.length < terminalOutputOffset) {
    terminalOutputOffset = 0;
    terminalInstance.reset();
  }
  const chunk = nextOutput.slice(terminalOutputOffset);
  if (chunk) {
    terminalInstance.write(chunk);
    terminalOutputOffset = nextOutput.length;
  }
}

async function pollTerminal() {
  if (!terminalSessionId.value) {
    return;
  }

  try {
    const session = await httpClient.get(terminalUrl(`/${encodeURIComponent(terminalSessionId.value)}`));
    terminalStatus.value = session.status || "";
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
    writeTerminalOutput(session.output);
    if (session.status === "exited" && terminalPollTimer) {
      window.clearInterval(terminalPollTimer);
      terminalPollTimer = null;
      await loadBootstrap();
    }
  } catch (pollError) {
    terminalError.value = String(pollError?.message || pollError || "Terminal polling failed.");
  }
}

async function sendTerminalData(data) {
  if (!terminalSessionId.value || terminalStatus.value === "exited") {
    return;
  }

  try {
    await httpClient.post(terminalUrl(`/${encodeURIComponent(terminalSessionId.value)}/input`), {
      data
    });
  } catch (sendError) {
    terminalError.value = String(sendError?.message || sendError || "Terminal input failed.");
  }
}

async function sendCtrlC() {
  await sendTerminalData("\u0003");
}

async function openTerminal(check) {
  terminalDialogOpen.value = true;
  terminalError.value = "";
  terminalCopyStatus.value = "";
  terminalSelectedText.value = "";
  terminalAutoCopiedText = "";
  terminalTitle.value = check.repair?.label || "Terminal";
  terminalCommandPreview.value = check.repair?.commandPreview || "";
  terminalSessionId.value = "";
  terminalStatus.value = "starting";
  await setupTerminalUi();

  try {
    const session = await httpClient.post(BOOTSTRAP_TERMINAL_ENDPOINT, {
      actionId: check.repair.actionId,
      inputs: repairInputs()
    });
    terminalSessionId.value = session.id || "";
    terminalStatus.value = session.status || "running";
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
    writeTerminalOutput(session.output);
    terminalPollTimer = window.setInterval(() => {
      void pollTerminal();
    }, 750);
    await pollTerminal();
  } catch (openError) {
    terminalError.value = String(openError?.message || openError || "Terminal start failed.");
  }
}

async function closeTerminal() {
  const sessionId = terminalSessionId.value;
  terminalDialogOpen.value = false;
  terminalSessionId.value = "";
  terminalStatus.value = "";
  if (sessionId) {
    await httpClient.delete(terminalUrl(`/${encodeURIComponent(sessionId)}`)).catch(() => null);
  }
  disposeTerminalUi();
  await loadBootstrap();
}

onMounted(() => {
  void loadBootstrap();
});

onBeforeUnmount(() => {
  disposeTerminalUi();
});
</script>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.2rem, 1.7vw, 1.55rem);
  --generated-ui-screen-panel-padding: 0.5rem 0.625rem;
}

.studio-screen {
  margin-inline: auto;
  max-width: 68rem;
}

.studio-screen__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.05;
  margin: 0 0 0.15rem;
}

.studio-screen__lede,
.studio-screen__path,
.studio-screen__script code,
.studio-screen__list :deep(.v-list-item-title),
.studio-screen__list :deep(.v-list-item-subtitle),
.bootstrap-doctor__fact,
.bootstrap-doctor__observed,
.terminal-dialog__command {
  overflow-wrap: anywhere;
}

.studio-screen__panel,
.studio-screen__dialog {
  padding: var(--generated-ui-screen-panel-padding);
}

.studio-screen__refresh-button {
  min-height: 48px;
}

.studio-screen__summary-grid,
.studio-screen__content-grid,
.studio-screen__script-grid {
  display: grid;
  gap: 0.375rem;
}

.studio-screen__summary-grid {
  grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr));
}

.studio-screen__content-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr));
}

.studio-screen__panel--wide {
  grid-column: 1 / -1;
}

.studio-screen__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.bootstrap-doctor__summary {
  border-left: 4px solid rgb(var(--v-theme-error));
  padding: 0.85rem 1rem;
}

.bootstrap-doctor__summary-main {
  align-items: center;
  display: grid;
  gap: 0.85rem;
  grid-template-columns: auto minmax(0, 1fr);
}

.bootstrap-doctor__summary-icon,
.bootstrap-doctor__status-badge {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  justify-content: center;
}

.bootstrap-doctor__summary-icon {
  background: rgba(var(--v-theme-error), 0.12);
  height: 3rem;
  width: 3rem;
}

.bootstrap-doctor__checks {
  display: grid;
  gap: 0.625rem;
}

.bootstrap-doctor__check {
  align-items: start;
  border-left: 4px solid transparent;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
  padding-block: 0.7rem;
}

.bootstrap-doctor__check--pass {
  background: rgba(var(--v-theme-success), 0.04);
  border-left-color: rgb(var(--v-theme-success));
}

.bootstrap-doctor__check--fail {
  background: rgba(var(--v-theme-error), 0.04);
  border-left-color: rgb(var(--v-theme-error));
}

.bootstrap-doctor__status-badge {
  height: 2.5rem;
  width: 2.5rem;
}

.bootstrap-doctor__status-badge--pass {
  background: rgba(var(--v-theme-success), 0.13);
}

.bootstrap-doctor__status-badge--fail {
  background: rgba(var(--v-theme-error), 0.13);
}

.bootstrap-doctor__status-badge--unknown {
  background: rgba(var(--v-theme-warning), 0.14);
}

.bootstrap-doctor__check-body {
  min-width: 0;
}

.bootstrap-doctor__actions {
  align-items: center;
  align-self: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  min-width: min(16rem, 100%);
}

.bootstrap-doctor__repair-button {
  min-height: 48px;
}

.terminal-dialog__copy-bar {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.terminal-dialog__copy-bar .v-btn {
  min-height: 48px;
}

.bootstrap-doctor__runtime-bar {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
}

.studio-screen__list {
  background: transparent;
  padding-block: 0;
}

.studio-screen__script-grid {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
}

.studio-screen__script {
  align-items: start;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  display: grid;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.75rem;
}

.studio-screen__script code {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.8125rem;
  line-height: 1.4;
  white-space: normal;
}

.bootstrap-doctor__check-header {
  align-items: start;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.bootstrap-doctor__check-header h3 {
  line-height: 1.15;
}

.bootstrap-doctor__check-header p {
  font-size: 0.8125rem;
  line-height: 1.25;
}

.bootstrap-doctor__facts {
  margin-top: 0.25rem;
}

.bootstrap-doctor__fact-line {
  line-height: 1.25;
}

.bootstrap-doctor__fact {
  margin-inline-end: 0.75rem;
}

.bootstrap-doctor__command,
.bootstrap-doctor__output {
  background: rgb(var(--v-theme-surface-variant));
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 0.8125rem;
  line-height: 1.25;
  margin: 0;
  margin-top: 0.45rem;
  max-height: 3.75rem;
  max-width: 100%;
  overflow: auto;
  padding: 0.35rem 0.45rem;
  white-space: pre-wrap;
  width: 100%;
}

.terminal-dialog__host {
  background: #111318;
  border-radius: 8px;
  height: min(44vh, 20rem);
  min-height: 13rem;
  overflow: hidden;
  padding: 0.5rem;
}

.terminal-dialog__host :deep(.xterm) {
  height: 100%;
}

@media (max-width: 720px) {
  .bootstrap-doctor__check {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .bootstrap-doctor__actions {
    grid-column: 2;
    justify-content: flex-start;
  }

  .bootstrap-doctor__runtime-bar {
    display: grid;
  }
}

@media (max-width: 520px) {
  .studio-screen {
    max-width: 100%;
  }

  .bootstrap-doctor__summary {
    padding: 0.75rem;
  }

  .bootstrap-doctor__summary-main {
    align-items: start;
    gap: 0.65rem;
  }

  .bootstrap-doctor__check {
    gap: 0.6rem;
    padding: 0.65rem;
  }

  .bootstrap-doctor__actions {
    grid-column: 1 / -1;
  }

  .bootstrap-doctor__actions .v-btn {
    flex: 1 1 100%;
  }
}
</style>
