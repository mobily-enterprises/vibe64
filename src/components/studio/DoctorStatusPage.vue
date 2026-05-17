<template>
  <section class="generated-ui-screen generated-ui-screen--studio studio-screen d-flex flex-column ga-3">
    <header class="studio-screen__header d-flex flex-column flex-md-row ga-3 align-md-end justify-space-between">
      <div>
        <h1 class="studio-screen__title">{{ title }}</h1>
        <p class="text-body-2 text-medium-emphasis mb-0 studio-screen__lede">{{ lede }}</p>
      </div>

      <div class="d-flex ga-2 align-center flex-wrap">
        <v-chip
          v-if="displayStatus"
          :color="summary.color"
          :prepend-icon="summaryIcon"
          variant="tonal"
        >
          {{ summary.label }}
        </v-chip>
        <v-btn
          v-if="ready && !checking && showContinue"
          color="primary"
          variant="flat"
          :to="continueTo || undefined"
          class="studio-screen__action-button"
          @click="handleContinue"
        >
          {{ continueLabel }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :loading="isLoading"
          :prepend-icon="mdiRefresh"
          class="studio-screen__action-button"
          @click="refreshDoctorStatus"
        >
          Refresh
        </v-btn>
      </div>
    </header>

    <v-alert
      v-if="displayError"
      type="error"
      variant="tonal"
      border="start"
      class="studio-screen__alert"
    >
      {{ displayError }}
    </v-alert>

    <v-progress-linear
      v-if="isLoading && !displayStatus"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <section
      v-if="displayStatus"
      :class="['doctor-status', doctorClass, 'd-flex', 'flex-column', 'ga-2']"
    >
      <v-sheet
        rounded="lg"
        border
        :class="[
          'doctor-status__summary',
          `doctor-status__summary--${summary.state}`
        ]"
      >
        <div class="doctor-status__summary-main">
          <div
            :class="[
              'doctor-status__summary-icon',
              `doctor-status__summary-icon--${summary.state}`
            ]"
          >
            <v-icon :icon="summaryIcon" :color="summary.color" size="32" />
          </div>
          <div>
            <h2 class="text-subtitle-1 mb-1">{{ summary.title }}</h2>
            <p class="text-body-2 text-medium-emphasis mb-2">
              {{ summary.progressText }}
            </p>
            <v-progress-linear
              :model-value="progressValue"
              :color="summary.color"
              height="8"
              :indeterminate="summary.progressIndeterminate"
              rounded
            />
          </div>
        </div>
      </v-sheet>

      <div class="doctor-status__checks">
        <v-sheet
          v-for="check in checks"
          :key="check.id"
          rounded="lg"
          border
          :class="[
            'studio-screen__panel',
            'doctor-status__check',
            `doctor-status__check--${check.status}`
          ]"
        >
          <div :class="['doctor-status__status-badge', statusToneClass(check.status)]">
            <v-icon
              class="doctor-status__status-icon"
              :icon="statusIcon(check.status)"
              :color="statusColor(check.status)"
              :aria-label="statusLabel(check.status)"
              size="30"
            />
          </div>

          <div class="doctor-status__check-body">
            <div class="doctor-status__check-header">
              <div>
                <h3 class="text-subtitle-2 mb-1">{{ check.label }}</h3>
                <p class="text-body-2 text-medium-emphasis mb-0">{{ check.explanation }}</p>
              </div>
            </div>

            <div class="doctor-status__facts">
              <p class="text-caption text-medium-emphasis mb-0 doctor-status__fact-line">
                <span class="doctor-status__fact">
                  <strong class="text-high-emphasis">Expected:</strong>
                  {{ check.expected }}
                </span>
                <span class="doctor-status__fact doctor-status__observed">
                  <strong class="text-high-emphasis">Observed:</strong>
                  {{ check.observed }}
                </span>
              </p>
            </div>

            <pre v-if="visibleCheckRepairs(check).length" class="doctor-status__command">{{ repairCommandPreview(check) }}</pre>
          </div>

          <div v-if="visibleCheckRepairs(check).length" class="doctor-status__actions">
            <template v-for="repair in visibleCheckRepairs(check)" :key="repair.actionId">
              <v-btn
                v-if="repair.kind === 'terminal'"
                color="primary"
                class="doctor-status__repair-button"
                variant="flat"
                :prepend-icon="mdiConsoleLine"
                :disabled="Boolean(actionInFlight)"
                @click="repairRequiresInput(repair) ? confirmRepairAction(check, repair) : openTerminal({ repair })"
              >
                {{ repair.label || "Open terminal" }}
              </v-btn>
              <v-btn
                v-else
                class="doctor-status__repair-button"
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
        <pre class="doctor-status__command mb-3">{{ confirmRepairCommandPreview }}</pre>
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
import { computed, ref } from "vue";
import {
  mdiAlertCircleOutline,
  mdiCheckCircle,
  mdiCloseCircle,
  mdiConsoleLine,
  mdiProgressClock,
  mdiRefresh
} from "@mdi/js";
import { useDoctorStream } from "@/composables/useDoctorStream.js";
import { useDoctorTerminal } from "@/composables/useDoctorTerminal.js";
import { resolveDoctorSummaryState } from "@/lib/doctorSummaryState.js";

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
  continueEmits: {
    type: Boolean,
    default: false
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
  statusItemsKey: {
    type: String,
    default: "checks"
  },
  streamEnabled: {
    type: Boolean,
    default: false
  },
  streamEndpoint: {
    type: String,
    default: ""
  },
  streamAutoStart: {
    type: Boolean,
    default: true
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

const emit = defineEmits(["continue", "refresh", "status-updated"]);

const actionInFlight = ref("");
const confirmRepair = ref(null);
const repairFieldValues = ref({});
const repairRunning = ref(false);

const {
  liveStatus,
  refreshDoctorStatus,
  streamError,
  streamRunning
} = useDoctorStream({
  onRefresh() {
    emit("refresh");
  },
  onStatusUpdated(status) {
    emit("status-updated", status);
  },
  status: () => props.status,
  statusItemsKey: () => props.statusItemsKey,
  streamAutoStart: () => props.streamAutoStart,
  streamEnabled: () => props.streamEnabled,
  streamEndpoint: () => props.streamEndpoint
});

const {
  closeTerminal,
  copyTerminalSelection,
  openTerminal,
  sendCtrlC,
  terminalCommandPreview,
  terminalCopyStatus,
  terminalDialogOpen,
  terminalError,
  terminalHost,
  terminalSelectedText,
  terminalSessionId,
  terminalStatus,
  terminalTitle
} = useDoctorTerminal({
  onTerminalSettled() {
    refreshDoctorStatus();
  },
  terminalEndpoint: () => props.terminalEndpoint
});

const displayStatus = computed(() => {
  return liveStatus.value || props.status;
});

const displayError = computed(() => {
  return props.error || streamError.value;
});

const isLoading = computed(() => {
  return props.loading || streamRunning.value;
});

const ready = computed(() => {
  return displayStatus.value?.ready === true;
});

const showContinue = computed(() => {
  return Boolean(props.continueTo) || props.continueEmits;
});

function handleContinue() {
  if (props.continueEmits) {
    emit("continue");
  }
}

const checks = computed(() => {
  const preferredItems = displayStatus.value?.[props.statusItemsKey];
  if (Array.isArray(preferredItems)) {
    return preferredItems;
  }
  return Array.isArray(displayStatus.value?.checks) ? displayStatus.value.checks : [];
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

const summary = computed(() => {
  return resolveDoctorSummaryState({
    blockedLabel: props.blockedLabel,
    blockedTitle: props.blockedTitle,
    isLoading: isLoading.value,
    passedCheckCount: passedCheckCount.value,
    ready: ready.value,
    readyLabel: props.readyLabel,
    readyTitle: props.readyTitle,
    requiredCheckCount: requiredCheckCount.value
  });
});

const checking = computed(() => {
  return summary.value.state === "checking";
});

const summaryIcon = computed(() => {
  if (summary.value.state === "pass") {
    return mdiCheckCircle;
  }
  if (summary.value.state === "checking") {
    return mdiProgressClock;
  }
  return mdiCloseCircle;
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
  if (["blocked", "fail"].includes(check?.status)) {
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
  if (status === "running") {
    return "primary";
  }
  if (["blocked", "fail", "hard-stop"].includes(status)) {
    return "error";
  }
  return "warning";
}

function statusIcon(status) {
  if (status === "pass") {
    return mdiCheckCircle;
  }
  if (status === "running") {
    return mdiAlertCircleOutline;
  }
  if (["blocked", "fail", "hard-stop"].includes(status)) {
    return mdiCloseCircle;
  }
  return mdiAlertCircleOutline;
}

function statusLabel(status) {
  if (status === "pass") {
    return "Ready";
  }
  if (status === "running") {
    return "Running";
  }
  if (status === "hard-stop") {
    return "Hard stop";
  }
  if (["blocked", "fail"].includes(status)) {
    return "Needs attention";
  }
  return "Pending";
}

function statusToneClass(status) {
  if (status === "pass") {
    return "doctor-status__status-badge--pass";
  }
  if (status === "running") {
    return "doctor-status__status-badge--running";
  }
  if (["blocked", "fail", "hard-stop"].includes(status)) {
    return "doctor-status__status-badge--fail";
  }
  return "doctor-status__status-badge--unknown";
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
.doctor-status__fact,
.doctor-status__observed,
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

.doctor-status__summary {
  padding: 0.85rem 1rem;
}

.doctor-status__summary--pass {
  border-left: 4px solid rgb(var(--v-theme-success));
}

.doctor-status__summary--checking {
  border-left: 4px solid rgb(var(--v-theme-primary));
}

.doctor-status__summary--fail {
  border-left: 4px solid rgb(var(--v-theme-error));
}

.doctor-status__summary-main {
  align-items: center;
  display: grid;
  gap: 0.85rem;
  grid-template-columns: auto minmax(0, 1fr);
}

.doctor-status__summary-icon,
.doctor-status__status-badge {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  justify-content: center;
}

.doctor-status__summary-icon {
  height: 3rem;
  width: 3rem;
}

.doctor-status__summary-icon--pass {
  background: rgba(var(--v-theme-success), 0.12);
}

.doctor-status__summary-icon--checking {
  background: rgba(var(--v-theme-primary), 0.12);
}

.doctor-status__summary-icon--fail {
  background: rgba(var(--v-theme-error), 0.12);
}

.doctor-status__checks {
  display: grid;
  gap: 0.625rem;
}

.doctor-status__check {
  align-items: start;
  border-left: 4px solid transparent;
  display: grid;
  gap: 0.75rem;
  grid-template-columns: auto minmax(0, 1fr) auto;
  min-width: 0;
  padding-block: 0.7rem;
}

.doctor-status__check--pass {
  background: rgba(var(--v-theme-success), 0.04);
  border-left-color: rgb(var(--v-theme-success));
}

.doctor-status__check--fail {
  background: rgba(var(--v-theme-error), 0.04);
  border-left-color: rgb(var(--v-theme-error));
}

.doctor-status__check--blocked,
.doctor-status__check--hard-stop {
  background: rgba(var(--v-theme-error), 0.04);
  border-left-color: rgb(var(--v-theme-error));
}

.doctor-status__check--running {
  background: rgba(var(--v-theme-primary), 0.045);
  border-left-color: rgb(var(--v-theme-primary));
}

.doctor-status__check--pending {
  background: rgba(var(--v-theme-warning), 0.045);
  border-left-color: rgb(var(--v-theme-warning));
}

.doctor-status__status-badge {
  height: 2.5rem;
  width: 2.5rem;
}

.doctor-status__status-badge--pass {
  background: rgba(var(--v-theme-success), 0.13);
}

.doctor-status__status-badge--fail {
  background: rgba(var(--v-theme-error), 0.13);
}

.doctor-status__status-badge--running {
  background: rgba(var(--v-theme-primary), 0.13);
}

.doctor-status__status-badge--unknown {
  background: rgba(var(--v-theme-warning), 0.14);
}

.doctor-status__check-body {
  min-width: 0;
}

.doctor-status__check-header {
  align-items: start;
  display: flex;
  gap: 0.5rem;
  justify-content: space-between;
}

.doctor-status__check-header h3 {
  line-height: 1.15;
}

.doctor-status__check-header p {
  font-size: 0.8125rem;
  line-height: 1.25;
}

.doctor-status__facts {
  margin-top: 0.25rem;
}

.doctor-status__fact-line {
  line-height: 1.25;
}

.doctor-status__fact {
  margin-inline-end: 0.75rem;
}

.doctor-status__command,
.doctor-status__output {
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

.doctor-status__actions {
  align-items: center;
  align-self: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  justify-content: flex-end;
  min-width: min(16rem, 100%);
}

.doctor-status__repair-button {
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
  .doctor-status__check {
    grid-template-columns: auto minmax(0, 1fr);
  }

  .doctor-status__actions {
    grid-column: 2;
    justify-content: flex-start;
  }
}

@media (max-width: 520px) {
  .studio-screen {
    max-width: 100%;
  }

  .doctor-status__summary {
    padding: 0.75rem;
  }

  .doctor-status__summary-main {
    align-items: start;
    gap: 0.65rem;
  }

  .doctor-status__check {
    gap: 0.6rem;
    padding: 0.65rem;
  }

  .doctor-status__actions {
    grid-column: 1 / -1;
  }

  .doctor-status__actions .v-btn {
    flex: 1 1 100%;
  }
}
</style>
