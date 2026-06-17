<template>
  <section class="generated-ui-screen generated-ui-screen--studio studio-screen d-flex flex-column ga-3">
    <header class="studio-screen__header d-flex flex-column flex-md-row ga-3 align-md-end justify-space-between">
      <div>
        <h1 class="studio-screen__title">{{ pageTitle }}</h1>
        <p v-if="pageLede" class="text-body-2 text-medium-emphasis mb-0 studio-screen__lede">{{ pageLede }}</p>
      </div>

      <div class="studio-screen__actions d-flex ga-2 align-center">
        <v-chip
          v-if="displayStatus && detailsAreVisible"
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
          v-if="canToggleDetails"
          color="primary"
          variant="tonal"
          :prepend-icon="detailsOpen ? mdiEyeOffOutline : mdiEyeOutline"
          class="studio-screen__action-button"
          @click="toggleDetails"
        >
          {{ detailsOpen ? "Hide details" : "Show details" }}
        </v-btn>
        <v-btn
          variant="tonal"
          color="primary"
          :disabled="!statusRefreshEnabled"
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
      v-if="actionsDisabledNotice"
      type="info"
      variant="tonal"
      border="start"
      class="studio-screen__alert"
    >
      {{ actionsDisabledNotice }}
    </v-alert>

    <v-alert
      v-if="showAutomaticRepairNotice"
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

    <v-sheet
      v-if="showQuietStatus"
      rounded="lg"
      border
      class="doctor-status__quiet"
    >
      <div
        :class="[
          'doctor-status__quiet-icon',
          `doctor-status__quiet-icon--${quietSummary.state}`
        ]"
      >
        <v-icon :icon="quietSummaryIcon" :color="quietSummary.color" size="40" />
      </div>
      <div class="doctor-status__quiet-copy">
        <h2 class="doctor-status__quiet-title">{{ quietStatusTitle }}</h2>
        <p class="doctor-status__quiet-message">{{ quietStatusMessage }}</p>
      </div>
      <v-progress-linear
        :model-value="progressValue"
        :color="quietSummary.color"
        height="8"
        :indeterminate="quietProgressIndeterminate"
        rounded
      />
    </v-sheet>

    <v-progress-linear
      v-if="detailsAreVisible && isLoading && !displayStatus"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <section
      v-if="displayStatus && detailsAreVisible"
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
      :command-details="terminalCommandDetails"
      :copy-status="terminalCopyStatus"
      :error="terminalError"
      :selected-text="terminalSelectedText"
      :session-id="terminalSessionId"
      :set-host="setTerminalHost"
      :status="terminalStatus"
      :terminal-url="terminalUrl"
      :title="terminalTitle"
      @close="closeTerminal"
      @copy-selection="copyTerminalSelection"
      @copy-url="copyTerminalUrl"
      @send-ctrl-c="sendCtrlC"
    />
  </section>
</template>

<script setup>
import DoctorCheckList from "@/components/studio/doctor/DoctorCheckList.vue";
import DoctorRepairDialog from "@/components/studio/doctor/DoctorRepairDialog.vue";
import DoctorTerminalDialog from "@/components/studio/doctor/DoctorTerminalDialog.vue";
import {
  doctorStatusPageEmits,
  useDoctorStatusPage,
  doctorStatusPageProps
} from "@/composables/useDoctorStatusPage.js";

const props = defineProps(doctorStatusPageProps);
const emit = defineEmits(doctorStatusPageEmits);

const {
  actionInFlight,
  actionsDisabledNotice,
  automaticRepairError,
  automaticRepairLog,
  automaticRepairMessage,
  automaticRepairRunning,
  canRunConfirmedRepair,
  canToggleDetails,
  checking,
  closeTerminal,
  confirmRepairAction,
  confirmRepairCommandPreview,
  confirmRepairFields,
  copyTerminalSelection,
  copyTerminalUrl,
  detailsAreVisible,
  detailsOpen,
  displayChecks,
  displayError,
  displayStatus,
  executeConfirmedRepair,
  handleContinue,
  isLoading,
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiRefresh,
  pageLede,
  pageTitle,
  progressValue,
  quietProgressIndeterminate,
  quietStatusMessage,
  quietStatusTitle,
  quietSummary,
  quietSummaryIcon,
  ready,
  refreshDoctorStatusForUser,
  repairCommandPreview,
  repairDialogOpen,
  repairFieldValues,
  repairRequiresInput,
  repairRunning,
  runRepair,
  sendCtrlC,
  setTerminalHost,
  showAutomaticRepairNotice,
  showContinue,
  showQuietStatus,
  statusRefreshEnabled,
  summary,
  summaryIcon,
  terminalCommandDetails,
  terminalCommandPreview,
  terminalCopyStatus,
  terminalDialogOpen,
  terminalError,
  terminalSelectedText,
  terminalSessionId,
  terminalStatus,
  terminalTitle,
  terminalUrl,
  toggleDetails,
  visibleCheckRepairs
} = useDoctorStatusPage(props, emit);
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

.studio-screen__header > :first-child {
  min-width: 0;
}

.studio-screen__actions {
  flex: 0 0 auto;
  flex-wrap: nowrap;
  white-space: nowrap;
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

.doctor-status__quiet {
  align-items: center;
  display: grid;
  gap: 1rem;
  justify-items: center;
  padding: clamp(1.5rem, 4vw, 2.5rem);
  text-align: center;
}

.doctor-status__quiet-copy {
  display: grid;
  gap: 0.35rem;
  max-width: 36rem;
}

.doctor-status__quiet-title {
  font-size: clamp(1.15rem, 2vw, 1.45rem);
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0;
}

.doctor-status__quiet-message {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.94rem;
  line-height: 1.4;
  margin: 0;
}

.doctor-status__quiet-icon {
  align-items: center;
  border-radius: 999px;
  display: inline-flex;
  height: 4rem;
  justify-content: center;
  width: 4rem;
}

.doctor-status__quiet-icon--pass {
  background: rgba(var(--v-theme-success), 0.12);
}

.doctor-status__quiet-icon--checking {
  background: rgba(var(--v-theme-primary), 0.12);
}

.doctor-status__quiet-icon--fail {
  background: rgba(var(--v-theme-error), 0.12);
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
