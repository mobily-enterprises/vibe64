import { computed, ref } from "vue";
import {
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiRefresh
} from "@mdi/js";
import { useDoctorStream } from "@/composables/useDoctorStream.js";
import { useDoctorRepairs } from "@/composables/useDoctorRepairs.js";
import { useDoctorTerminal } from "@/composables/useDoctorTerminal.js";
import {
  doctorSummaryIcon
} from "@/lib/doctorStatusDisplay.js";
import { resolveDoctorSummaryState } from "@/lib/doctorSummaryState.js";

const doctorStatusPageEmits = ["continue", "refresh", "status-updated"];
const doctorStatusPageProps = {
  alwaysRepairCheckIds: {
    type: Array,
    default: () => []
  },
  actionsDisabledMessage: {
    type: String,
    default: ""
  },
  actionsEnabled: {
    type: Boolean,
    default: true
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
  showContinue: {
    type: Boolean,
    default: true
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
  quiet: {
    type: Boolean,
    default: true
  },
  quietLede: {
    type: String,
    default: "Vibe64 is checking the project and preparing anything it can handle automatically."
  },
  quietTitle: {
    type: String,
    default: "Getting things ready"
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
};

function useDoctorStatusPage(props, emit) {
  const detailsOpen = ref(false);

  const {
    liveStatus,
    refreshDoctorStatus,
    streamError,
    streamOperation,
    streamRunning
  } = useDoctorStream({
    onRefresh(options = {}) {
      emit("refresh", options);
    },
    onStatusUpdated(status) {
      emit("status-updated", status);
    },
    status: () => props.status,
    statusItemsKey: () => props.statusItemsKey,
    streamAutoStart: () => props.streamAutoStart,
    streamEnabled: () => props.streamEnabled && props.actionsEnabled,
    streamEndpoint: () => props.streamEndpoint
  });

  const {
    closeTerminal,
    copyTerminalUrl,
    openTerminal,
    terminal,
    terminalCloseError,
    terminalCommandDetails,
    terminalCommandPreview,
    terminalCopyStatus,
    terminalDialogOpen,
    terminalError,
    terminalExitCode,
    terminalOutput,
    terminalStatus,
    terminalTextCopied,
    terminalTitle,
    terminalUrl
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
    return props.showContinue && (Boolean(props.continueTo) || props.continueEmits);
  });

  function handleContinue() {
    if (props.continueEmits) {
      emit("continue");
    }
  }

  function refreshDoctorStatusForUser() {
    if (!statusRefreshEnabled.value) {
      return;
    }
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
    automaticRepairAvailable,
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
    autoRepairEnabled: () => props.autoRepairEnabled && props.actionsEnabled,
    checks: () => checks.value,
    isLoading: () => isLoading.value,
    openTerminal,
    ready: () => ready.value,
    repairsEnabled: () => props.actionsEnabled,
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

  const statusRefreshEnabled = computed(() => {
    return props.actionsEnabled;
  });

  const actionsDisabledNotice = computed(() => {
    if (props.actionsEnabled) {
      return "";
    }
    return props.actionsDisabledMessage || "You can review this setup status, but only the Vibe64 owner can run setup actions.";
  });

  const currentOperation = computed(() => {
    if (automaticRepairRunning.value && automaticRepair.value?.label) {
      return `Running automatic repair: ${automaticRepair.value.label}.`;
    }
    return streamOperation.value || "";
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
        progressText: currentOperation.value || `Studio is running ${automaticRepair.value.label}. This can take a few minutes.`,
        state: "checking",
        title: automaticRepair.value.label
      };
    }

    if (isLoading.value && currentOperation.value) {
      return {
        color: "primary",
        label: "Preparing setup",
        progressIndeterminate: true,
        progressText: currentOperation.value,
        state: "checking",
        title: "Preparing setup"
      };
    }

    return resolveDoctorSummaryState({
      blockedLabel: props.blockedLabel,
      blockedTitle: props.blockedTitle,
      isLoading: isLoading.value,
      passedCheckCount: passedCheckCount.value,
      readiness: displayStatus.value?.readiness || null,
      ready: ready.value,
      readyLabel: props.readyLabel,
      readyTitle: props.readyTitle,
      requiredCheckCount: requiredCheckCount.value
    });
  });

  const blockedWithoutAutomaticRepair = computed(() => {
    return Boolean(
      displayStatus.value &&
      ready.value !== true &&
      summary.value.state === "fail" &&
      !isLoading.value &&
      !automaticRepairRunning.value &&
      !automaticRepairAvailable.value
    );
  });

  const detailsMustStayVisible = computed(() => {
    return Boolean(displayError.value || automaticRepairError.value || blockedWithoutAutomaticRepair.value);
  });

  const detailsAreVisible = computed(() => {
    return props.quiet !== true || detailsOpen.value || detailsMustStayVisible.value;
  });

  const showQuietStatus = computed(() => {
    return props.quiet === true && !detailsAreVisible.value;
  });

  const canToggleDetails = computed(() => {
    return props.quiet === true && !detailsMustStayVisible.value;
  });

  const showAutomaticRepairNotice = computed(() => {
    return Boolean(automaticRepairError.value || (detailsAreVisible.value && automaticRepairMessage.value));
  });

  const pageTitle = computed(() => {
    return showQuietStatus.value ? props.quietTitle : props.title;
  });

  const pageLede = computed(() => {
    return showQuietStatus.value ? props.quietLede : props.lede;
  });

  const quietSummary = computed(() => {
    if (!displayStatus.value && !detailsMustStayVisible.value) {
      return {
        color: "primary",
        progressIndeterminate: true,
        state: "checking"
      };
    }
    return summary.value;
  });

  const quietProgressIndeterminate = computed(() => {
    return Boolean(
      isLoading.value ||
      automaticRepairRunning.value ||
      automaticRepairAvailable.value ||
      quietSummary.value.progressIndeterminate
    );
  });

  const quietStatusTitle = computed(() => {
    if (ready.value) {
      return "Ready";
    }
    if (automaticRepairRunning.value) {
      return "Preparing automatically";
    }
    if (currentOperation.value) {
      return "Preparing setup";
    }
    if (isLoading.value) {
      return "Checking setup";
    }
    if (automaticRepairAvailable.value) {
      return "Preparing automatically";
    }
    if (summary.value.state === "waiting") {
      return summary.value.title || "Waiting";
    }
    return "Getting things ready";
  });

  const quietStatusMessage = computed(() => {
    if (ready.value) {
      return "Everything needed for this step is ready.";
    }
    if (automaticRepairRunning.value && automaticRepair.value?.label) {
      return `Vibe64 is running ${automaticRepair.value.label}.`;
    }
    if (currentOperation.value) {
      return currentOperation.value;
    }
    if (automaticRepairRunning.value || automaticRepairAvailable.value) {
      return "Vibe64 is handling this setup step automatically.";
    }
    if (isLoading.value) {
      return "Vibe64 is checking what this project needs.";
    }
    if (summary.value.state === "waiting") {
      return summary.value.progressText || "Vibe64 is waiting for the project bootstrap step.";
    }
    return "Vibe64 is getting the project ready.";
  });

  const checking = computed(() => {
    return summary.value.state === "checking";
  });

  const summaryIcon = computed(() => {
    return doctorSummaryIcon(summary.value.state);
  });

  const quietSummaryIcon = computed(() => {
    return doctorSummaryIcon(quietSummary.value.state);
  });

  function toggleDetails() {
    detailsOpen.value = !detailsOpen.value;
  }

  return {
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
    showAutomaticRepairNotice,
    showContinue,
    showQuietStatus,
    statusRefreshEnabled,
    summary,
    summaryIcon,
    terminal,
    terminalCommandDetails,
    terminalCommandPreview,
    terminalCopyStatus,
    terminalDialogOpen,
    terminalError,
    terminalCloseError,
    terminalStatus,
    terminalTextCopied,
    terminalTitle,
    terminalUrl,
    toggleDetails,
    visibleCheckRepairs
  };
}

export {
  doctorStatusPageEmits,
  useDoctorStatusPage,
  doctorStatusPageProps
};
