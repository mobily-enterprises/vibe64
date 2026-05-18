import { computed, ref, watch } from "vue";

const REPAIRABLE_STATUSES = Object.freeze(["blocked", "fail", "hard-stop"]);

function readValue(value) {
  return typeof value === "function" ? value() : value;
}

function quotePreviewValue(value) {
  return String(value).replace(/["\\]/gu, "\\$&");
}

function repairsForCheck(check) {
  if (Array.isArray(check?.repairs) && check.repairs.length) {
    return check.repairs.filter(Boolean);
  }
  return [check?.repair].filter(Boolean);
}

function repairRequiresInput(repair) {
  return Array.isArray(repair?.fields) && repair.fields.length > 0;
}

function automaticRepairInputs(repair) {
  const inputs = repair?.input && typeof repair.input === "object" && !Array.isArray(repair.input)
    ? { ...repair.input }
    : {};
  for (const field of Array.isArray(repair?.fields) ? repair.fields : []) {
    const value = String(field.defaultValue || "").trim();
    if (field.required && !value) {
      return null;
    }
    inputs[field.id] = value;
  }
  return inputs;
}

function automaticRepairKey(check, repair, inputs) {
  return [
    check?.id || "",
    repair?.actionId || "",
    JSON.stringify(inputs || {})
  ].join(":");
}

function useDoctorRepairs({
  alwaysRepairCheckIds = () => [],
  autoRepairEnabled = () => false,
  checks = () => [],
  isLoading = () => false,
  openTerminal = null,
  ready = () => false,
  streamRunning = () => false,
  terminalCloseError = () => "",
  terminalDialogOpen = () => false,
  terminalError = () => "",
  terminalExitCode = () => null,
  terminalOutput = () => ""
} = {}) {
  const actionInFlight = ref("");
  const automaticRepair = ref(null);
  const automaticRepairError = ref("");
  const automaticRepairMessage = ref("");
  const automaticRepairRunning = ref(false);
  const confirmRepair = ref(null);
  const repairFieldValues = ref({});
  const repairRunning = ref(false);
  const attemptedAutomaticRepairs = new Set();

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

  const displayChecks = computed(() => {
    if (!automaticRepairRunning.value || !automaticRepair.value?.checkId) {
      return readValue(checks);
    }

    return readValue(checks).map((check) => {
      if (check.id !== automaticRepair.value.checkId) {
        return check;
      }
      return {
        ...check,
        explanation: `Studio is running ${automaticRepair.value.label}. This can take a few minutes.`,
        expected: "The automatic repair completes successfully.",
        observed: "Running in the setup terminal.",
        repair: null,
        repairs: [],
        status: "running"
      };
    });
  });

  const automaticRepairLog = computed(() => {
    const output = String(readValue(terminalOutput) || "").trim();
    if (!output) {
      return "";
    }
    return output.length > 4000 ? output.slice(output.length - 4000) : output;
  });

  function clearRepairMessages() {
    automaticRepairError.value = "";
    automaticRepairMessage.value = "";
  }

  function visibleCheckRepairs(check) {
    const repairs = repairsForCheck(check);
    if (REPAIRABLE_STATUSES.includes(check?.status)) {
      return repairs;
    }
    return readValue(alwaysRepairCheckIds).includes(check?.id) ? repairs : [];
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

  function automaticRepairCandidate(check, repair) {
    if (repair?.autoRun !== true || repair?.kind !== "terminal" || !repair?.actionId) {
      return null;
    }
    const inputs = automaticRepairInputs(repair);
    if (inputs === null) {
      return null;
    }
    const key = automaticRepairKey(check, repair, inputs);
    if (attemptedAutomaticRepairs.has(key)) {
      return null;
    }
    return {
      check,
      inputs,
      key,
      repair
    };
  }

  function firstAutomaticRepair() {
    for (const check of readValue(checks)) {
      if (!REPAIRABLE_STATUSES.includes(check?.status)) {
        continue;
      }
      for (const repair of repairsForCheck(check)) {
        const candidate = automaticRepairCandidate(check, repair);
        if (candidate) {
          return candidate;
        }
      }
    }
    return null;
  }

  function collectRepairInputs() {
    const inputs = {};
    for (const field of confirmRepairFields.value) {
      inputs[field.id] = String(repairFieldValues.value[field.id] || "").trim();
    }
    return inputs;
  }

  async function runRepair(repair, {
    inputs = {},
    visible = true,
    waitForExit = false
  } = {}) {
    if (!repair?.actionId || typeof openTerminal !== "function") {
      return null;
    }
    actionInFlight.value = repair.actionId;
    try {
      return await openTerminal({
        inputs,
        repair,
        visible,
        waitForExit
      });
    } finally {
      actionInFlight.value = "";
    }
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
    confirmRepair.value = null;
    repairFieldValues.value = {};
    automaticRepairError.value = "";
    automaticRepairMessage.value = "";
    repairRunning.value = true;
    try {
      await runRepair(repair, {
        inputs
      });
    } finally {
      repairRunning.value = false;
    }
  }

  async function runAutomaticRepair() {
    if (readValue(ready)) {
      clearRepairMessages();
      return;
    }

    if (!readValue(autoRepairEnabled) ||
      readValue(isLoading) ||
      readValue(streamRunning) ||
      automaticRepairError.value ||
      automaticRepairRunning.value ||
      repairDialogOpen.value ||
      readValue(terminalDialogOpen) ||
      actionInFlight.value) {
      return;
    }

    const candidate = firstAutomaticRepair();
    if (!candidate) {
      automaticRepairMessage.value = "";
      return;
    }

    attemptedAutomaticRepairs.add(candidate.key);
    automaticRepair.value = {
      actionId: candidate.repair.actionId,
      checkId: candidate.check.id,
      label: candidate.repair.label || candidate.repair.actionId
    };
    automaticRepairRunning.value = true;
    automaticRepairError.value = "";
    automaticRepairMessage.value = `Running automatic repair: ${candidate.repair.label || candidate.repair.actionId}`;

    try {
      const session = await runRepair(candidate.repair, {
        inputs: candidate.inputs,
        visible: false,
        waitForExit: true
      });
      const exitCode = Number.isInteger(session?.exitCode) ? session.exitCode : readValue(terminalExitCode);
      const closeError = session?.closeError || readValue(terminalCloseError) || "";
      if (session?.ok === false || exitCode !== 0 || closeError) {
        automaticRepairError.value = [
          `Automatic repair failed: ${candidate.repair.label || candidate.repair.actionId}`,
          closeError || readValue(terminalError) || (Number.isInteger(exitCode) ? `Exit code ${exitCode}.` : "")
        ].filter(Boolean).join(" ");
      }
    } finally {
      automaticRepair.value = null;
      automaticRepairRunning.value = false;
    }
  }

  watch(
    () => [
      readValue(autoRepairEnabled),
      readValue(ready),
      readValue(isLoading),
      readValue(streamRunning),
      automaticRepairRunning.value,
      readValue(terminalDialogOpen),
      actionInFlight.value,
      readValue(checks).map((check) => `${check.id}:${check.status}`).join("|")
    ],
    () => {
      void runAutomaticRepair();
    },
    {
      immediate: true
    }
  );

  return {
    actionInFlight,
    automaticRepair,
    automaticRepairError,
    automaticRepairLog,
    automaticRepairMessage,
    automaticRepairRunning,
    canRunConfirmedRepair,
    clearRepairMessages,
    closeRepairDialog,
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
  };
}

export {
  useDoctorRepairs
};
