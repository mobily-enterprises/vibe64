<template>
  <section class="generated-ui-screen generated-ui-screen--app studio-screen d-flex flex-column ga-3">
    <header class="studio-screen__header d-flex flex-column flex-md-row ga-3 align-md-end justify-space-between">
      <div>
        <h1 class="studio-screen__title">{{ title }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-0 studio-screen__lede">{{ lede }}</p>
      </div>

      <div class="d-flex ga-2 align-center flex-wrap">
        <v-chip
          v-if="status"
          :color="ready ? 'success' : 'error'"
          :prepend-icon="ready ? mdiCheckCircle : mdiCloseCircle"
          variant="tonal"
        >
          {{ ready ? readyLabel : blockedLabel }}
        </v-chip>
        <v-btn
          v-if="ready && continueTo"
          color="primary"
          variant="flat"
          :to="continueTo"
          class="studio-screen__action-button"
        >
          {{ continueLabel }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="loading"
          :prepend-icon="mdiRefresh"
          class="studio-screen__action-button"
          @click="emit('refresh')"
        >
          Refresh
        </v-btn>
      </div>
    </header>

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      border="start"
      class="studio-screen__alert"
    >
      {{ error }}
    </v-alert>

    <v-progress-linear
      v-if="loading && !status"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <section
      v-if="status"
      :class="['bootstrap-doctor', doctorClass, 'd-flex', 'flex-column', 'ga-2']"
    >
      <v-sheet
        rounded="lg"
        border
        :class="[
          'bootstrap-doctor__summary',
          ready ? 'bootstrap-doctor__summary--pass' : 'bootstrap-doctor__summary--fail'
        ]"
      >
        <div class="bootstrap-doctor__summary-main">
          <div
            :class="[
              'bootstrap-doctor__summary-icon',
              ready ? 'bootstrap-doctor__summary-icon--pass' : 'bootstrap-doctor__summary-icon--fail'
            ]"
          >
            <v-icon :icon="ready ? mdiCheckCircle : mdiCloseCircle" :color="ready ? 'success' : 'error'" size="32" />
          </div>
          <div>
            <h2 class="text-subtitle-1 mb-1">{{ ready ? readyTitle : blockedTitle }}</h2>
            <p class="text-body-2 text-medium-emphasis mb-2">
              {{ passedCheckCount }} of {{ requiredCheckCount }} required checks are ready.
            </p>
            <v-progress-linear
              :model-value="progressValue"
              :color="ready ? 'success' : 'primary'"
              height="8"
              rounded
            />
          </div>
        </div>
      </v-sheet>

      <div class="bootstrap-doctor__checks">
        <v-sheet
          v-for="check in checks"
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
                @click="repairRequiresInput(repair) ? confirmRepairAction(check, repair) : openTerminal({ repair })"
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

    <v-dialog v-model="repairDialogOpen" max-width="760">
      <v-sheet rounded="lg" class="studio-screen__dialog">
        <h2 class="text-subtitle-1 mb-2">Confirm repair</h2>
        <p class="text-body-2 text-medium-emphasis mb-3">
          Studio will run this command locally after confirmation.
        </p>
        <div v-if="confirmRepairFields.length" class="studio-screen__field-grid mb-3">
          <v-text-field
            v-for="field in confirmRepairFields"
            :key="field.id"
            v-model="repairFieldValues[field.id]"
            :autocomplete="field.autocomplete || undefined"
            density="compact"
            hide-details="auto"
            :label="field.label"
            :placeholder="field.placeholder || ''"
            :type="field.type || 'text'"
            variant="outlined"
          />
        </div>
        <pre class="bootstrap-doctor__command mb-3">{{ confirmRepairCommandPreview }}</pre>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" :disabled="repairRunning" @click="closeRepairDialog">Close</v-btn>
          <v-btn
            color="primary"
            :disabled="!canRunConfirmedRepair"
            :loading="repairRunning"
            @click="executeConfirmedRepair"
          >
            Run repair
          </v-btn>
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
import { computed, nextTick, onBeforeUnmount, ref } from "vue";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiCloseCircle,
  mdiConsoleLine,
  mdiPlayCircleOutline,
  mdiRefresh
} from "@mdi/js";
import { studioHttpClient } from "@/lib/studioApi.js";
import "@xterm/xterm/css/xterm.css";

const props = defineProps({
  alwaysRepairCheckIds: {
    type: Array,
    default: () => []
  },
  blockedLabel: {
    type: String,
    default: "Blocked"
  },
  blockedTitle: {
    type: String,
    default: "Blocked"
  },
  continueLabel: {
    type: String,
    default: "Continue"
  },
  continueTo: {
    type: String,
    default: ""
  },
  doctorClass: {
    type: String,
    default: ""
  },
  error: {
    type: String,
    default: ""
  },
  lede: {
    type: String,
    default: ""
  },
  loading: {
    type: Boolean,
    default: false
  },
  readyLabel: {
    type: String,
    default: "Ready"
  },
  readyTitle: {
    type: String,
    default: "Ready"
  },
  status: {
    type: Object,
    default: null
  },
  terminalEndpoint: {
    type: String,
    required: true
  },
  title: {
    type: String,
    required: true
  }
});

const emit = defineEmits(["refresh"]);

const actionInFlight = ref("");
const confirmRepair = ref(null);
const repairFieldValues = ref({});
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

const ready = computed(() => {
  return props.status?.ready === true;
});

const checks = computed(() => {
  return Array.isArray(props.status?.checks) ? props.status.checks : [];
});

const requiredChecks = computed(() => {
  return checks.value.filter((check) => check.required !== false);
});

const requiredCheckCount = computed(() => {
  return requiredChecks.value.length;
});

const passedCheckCount = computed(() => {
  return requiredChecks.value.filter((check) => check.status === "pass").length;
});

const progressValue = computed(() => {
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

const confirmRepairFields = computed(() => {
  return Array.isArray(confirmRepair.value?.repair?.fields)
    ? confirmRepair.value.repair.fields
    : [];
});

const confirmRepairCommandPreview = computed(() => {
  let preview = confirmRepair.value?.repair?.commandPreview || "";
  for (const field of confirmRepairFields.value) {
    const value = String(repairFieldValues.value[field.id] || "").trim();
    if (value) {
      preview = preview.replaceAll(`<${field.id}>`, quotePreviewValue(value));
    }
  }
  return preview;
});

const canRunConfirmedRepair = computed(() => {
  for (const field of confirmRepairFields.value) {
    const value = String(repairFieldValues.value[field.id] || "").trim();
    if (field.required && !value) {
      return false;
    }
    if (field.type === "email" && value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) {
      return false;
    }
  }
  return true;
});

function checkRepairs(check) {
  if (Array.isArray(check?.repairs) && check.repairs.length) {
    return check.repairs.filter(Boolean);
  }
  return [check?.repair].filter(Boolean);
}

function visibleCheckRepairs(check) {
  const repairs = checkRepairs(check);
  if (check?.status === "fail") {
    return repairs;
  }
  return props.alwaysRepairCheckIds.includes(check?.id) ? repairs : [];
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

function repairRequiresInput(repair) {
  return Array.isArray(repair?.fields) && repair.fields.length > 0;
}

function quotePreviewValue(value) {
  return String(value).replace(/["\\]/gu, "\\$&");
}

function collectRepairInputs() {
  const inputs = {};
  for (const field of confirmRepairFields.value) {
    inputs[field.id] = String(repairFieldValues.value[field.id] || "").trim();
  }
  return inputs;
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

function confirmRepairAction(check, repair = check?.repair) {
  const values = {};
  for (const field of Array.isArray(repair?.fields) ? repair.fields : []) {
    values[field.id] = field.defaultValue || "";
  }
  repairFieldValues.value = values;
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
  repairFieldValues.value = {};
}

async function executeConfirmedRepair() {
  if (!confirmRepair.value?.repair?.actionId) {
    return;
  }

  const repair = confirmRepair.value.repair;
  const inputs = collectRepairInputs();
  const actionId = repair.actionId;
  confirmRepair.value = null;
  repairFieldValues.value = {};
  actionInFlight.value = actionId;
  repairRunning.value = true;
  try {
    await openTerminal({
      inputs,
      repair
    });
  } finally {
    actionInFlight.value = "";
    repairRunning.value = false;
  }
}

function terminalUrl(path = "") {
  return `${props.terminalEndpoint}${path}`;
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
    const session = await studioHttpClient.get(terminalUrl(`/${encodeURIComponent(terminalSessionId.value)}`));
    terminalStatus.value = session.status || "";
    terminalCommandPreview.value = session.commandPreview || terminalCommandPreview.value;
    writeTerminalOutput(session.output);
    if (session.status === "exited" && terminalPollTimer) {
      window.clearInterval(terminalPollTimer);
      terminalPollTimer = null;
      emit("refresh");
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
    await studioHttpClient.post(terminalUrl(`/${encodeURIComponent(terminalSessionId.value)}/input`), {
      data
    });
  } catch (sendError) {
    terminalError.value = String(sendError?.message || sendError || "Terminal input failed.");
  }
}

async function sendCtrlC() {
  await sendTerminalData("\u0003");
}

async function openTerminal({
  inputs = {},
  repair
}) {
  terminalDialogOpen.value = true;
  terminalError.value = "";
  terminalCopyStatus.value = "";
  terminalSelectedText.value = "";
  terminalAutoCopiedText = "";
  terminalTitle.value = repair?.label || "Terminal";
  terminalCommandPreview.value = repair?.commandPreview || "";
  terminalSessionId.value = "";
  terminalStatus.value = "starting";
  await setupTerminalUi();

  try {
    const session = await studioHttpClient.post(props.terminalEndpoint, {
      actionId: repair.actionId,
      inputs
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
    await studioHttpClient.delete(terminalUrl(`/${encodeURIComponent(sessionId)}`)).catch(() => null);
  }
  disposeTerminalUi();
  emit("refresh");
}

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
.bootstrap-doctor__fact,
.bootstrap-doctor__observed,
.terminal-dialog__command {
  overflow-wrap: anywhere;
}

.studio-screen__panel,
.studio-screen__dialog {
  padding: var(--generated-ui-screen-panel-padding);
}

.studio-screen__action-button {
  min-height: 48px;
}

.studio-screen__field-grid {
  display: grid;
  gap: 0.375rem;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr));
}

.studio-screen__field-grid :deep(.v-field),
.studio-screen__field-grid :deep(.v-field__input) {
  min-height: 48px;
}

.studio-screen__dialog :deep(.v-btn) {
  min-height: 48px;
}

.bootstrap-doctor__summary {
  padding: 0.85rem 1rem;
}

.bootstrap-doctor__summary--pass {
  border-left: 4px solid rgb(var(--v-theme-success));
}

.bootstrap-doctor__summary--fail {
  border-left: 4px solid rgb(var(--v-theme-error));
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
  height: 3rem;
  width: 3rem;
}

.bootstrap-doctor__summary-icon--pass {
  background: rgba(var(--v-theme-success), 0.12);
}

.bootstrap-doctor__summary-icon--fail {
  background: rgba(var(--v-theme-error), 0.12);
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
