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
          :loading="isLoading || automaticRepairRunning"
          :prepend-icon="mdiRefresh"
          class="studio-screen__action-button"
          @click="refreshDoctorStatusForUser"
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

    <v-alert
      v-if="automaticRepairMessage || automaticRepairError"
      :type="automaticRepairError ? 'error' : 'info'"
      variant="tonal"
      border="start"
      class="studio-screen__alert"
    >
      <div class="d-flex flex-column ga-2">
        <span>{{ automaticRepairError || automaticRepairMessage }}</span>
        <pre v-if="automaticRepairError && automaticRepairLog" class="doctor-status__command mb-0">{{ automaticRepairLog }}</pre>
      </div>
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

      <DoctorCheckList
        :action-in-flight="actionInFlight"
        :checks="displayChecks"
        :repair-command-preview="repairCommandPreview"
        :repair-requires-input="repairRequiresInput"
        :visible-check-repairs="visibleCheckRepairs"
        @confirm-repair="confirmRepairAction($event.check, $event.repair)"
        @run-repair="runRepair"
      />
    </section>

    <DoctorRepairDialog
      v-model="repairDialogOpen"
      v-model:values="repairFieldValues"
      :can-run="canRunConfirmedRepair"
      :command-preview="confirmRepairCommandPreview"
      :fields="confirmRepairFields"
      :running="repairRunning"
      @run="executeConfirmedRepair"
    />

    <DoctorTerminalDialog
      v-model="terminalDialogOpen"
      :command-preview="terminalCommandPreview"
      :copy-status="terminalCopyStatus"
      :error="terminalError"
      :selected-text="terminalSelectedText"
      :session-id="terminalSessionId"
      :set-host="setTerminalHost"
      :status="terminalStatus"
      :title="terminalTitle"
      @close="closeTerminal"
      @copy-selection="copyTerminalSelection"
      @send-ctrl-c="sendCtrlC"
    />
  </section>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiRefresh
} from "@mdi/js";
import DoctorCheckList from "@/components/studio/doctor/DoctorCheckList.vue";
import DoctorRepairDialog from "@/components/studio/doctor/DoctorRepairDialog.vue";
import DoctorTerminalDialog from "@/components/studio/doctor/DoctorTerminalDialog.vue";
import { useDoctorStream } from "@/composables/useDoctorStream.js";
import { useDoctorRepairs } from "@/composables/useDoctorRepairs.js";
import { useDoctorTerminal } from "@/composables/useDoctorTerminal.js";
import {
  doctorSummaryIcon
} from "@/lib/doctorStatusDisplay.js";
import { resolveDoctorSummaryState } from "@/lib/doctorSummaryState.js";

const props = defineProps({
  alwaysRepairCheckIds: {
    type: Array,
    default: () => []
  },
  autoRepairEnabled: {
    type: Boolean,
    default: false
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
  terminalCloseError,
  terminalCommandPreview,
  terminalCopyStatus,
  terminalDialogOpen,
  terminalError,
  terminalExitCode,
  terminalHost,
  terminalOutput,
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

function refreshDoctorStatusForUser() {
  clearRepairMessages();
  refreshDoctorStatus();
}

const checks = computed(() => {
  const preferredItems = displayStatus.value?.[props.statusItemsKey];
  if (Array.isArray(preferredItems)) {
    return preferredItems;
  }
  return Array.isArray(displayStatus.value?.checks) ? displayStatus.value.checks : [];
});

const {
  actionInFlight,
  automaticRepair,
  automaticRepairError,
  automaticRepairLog,
  automaticRepairMessage,
  automaticRepairRunning,
  canRunConfirmedRepair,
  clearRepairMessages,
  confirmRepairAction,
  confirmRepairCommandPreview,
  confirmRepairFields,
  displayChecks,
  executeConfirmedRepair,
  repairCommandPreview,
  repairDialogOpen,
  repairFieldValues,
  repairRequiresInput,
  repairRunning,
  runRepair,
  visibleCheckRepairs
} = useDoctorRepairs({
  alwaysRepairCheckIds: () => props.alwaysRepairCheckIds,
  autoRepairEnabled: () => props.autoRepairEnabled,
  checks: () => checks.value,
  isLoading: () => isLoading.value,
  openTerminal,
  ready: () => ready.value,
  streamRunning: () => streamRunning.value,
  terminalCloseError: () => terminalCloseError.value,
  terminalDialogOpen: () => terminalDialogOpen.value,
  terminalError: () => terminalError.value,
  terminalExitCode: () => terminalExitCode.value,
  terminalOutput: () => terminalOutput.value
});

const displayError = computed(() => {
  if (automaticRepairRunning.value && !automaticRepairError.value) {
    return "";
  }
  return props.error || streamError.value;
});

const requiredChecks = computed(() => {
  return displayChecks.value.filter((check) => check.required !== false);
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
  if (automaticRepairRunning.value && automaticRepair.value) {
    return {
      color: "primary",
      label: "Repairing setup",
      progressIndeterminate: true,
      progressText: `Studio is running ${automaticRepair.value.label}. This can take a few minutes.`,
      state: "checking",
      title: automaticRepair.value.label
    };
  }

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
  return doctorSummaryIcon(summary.value.state);
});

function setTerminalHost(element) {
  terminalHost.value = element;
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
.doctor-status__command {
  overflow-wrap: anywhere;
}

.studio-screen__action-button {
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

.doctor-status__summary-icon {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  justify-content: center;
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

.doctor-status__command {
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
}
</style>
