import { computed, ref, watch } from "vue";

const SAVE_WORK_STAGE_LABELS = Object.freeze({ published: "pushed", publishing: "pushing" });

function text(value = "") {
  return String(value || "").trim();
}

const EVENT_TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
const EVENT_DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit"
});

// An event's stored ISO time in the person's own clock: the time alone today,
// with the date otherwise. Anything unparseable is shown as stored.
function eventTimeLabel(at = "", now = new Date()) {
  const date = new Date(text(at));
  if (!text(at) || Number.isNaN(date.getTime())) return text(at);
  return (date.toDateString() === now.toDateString() ? EVENT_TIME_FORMAT : EVENT_DATE_TIME_FORMAT).format(date);
}

function repositoryFailureFromError(error) {
  return error && typeof error === "object"
    ? {
        code: String(error.code || error.response?.code || ""),
        details: error.details || error.response?.details || null,
        message: error instanceof Error ? error.message : String(error || "")
      }
    : null;
}

/** The selected session's Save and Update: header state, attempts, failures and the Save dialog. */
function useVibe64SessionSaveWork(props, {
  actorKey,
  agentActive,
  composerSending,
  dismissals,
  projectSlug,
  reportActivity,
  repositoryOperationActive,
  sessionId,
  sessionInteractionDisabled
}) {
  const saveWorkConfirmOpen = ref(false);
  const saveWorkReview = ref(null);
  const saveWorkConnectedReview = ref(null);
  const saveWorkConnectedResults = ref([]);
  // The last Save was recorded with the stand-in Git name and email.
  const saveWorkStandInIdentity = ref(false);
  const saveWorkError = ref("");
  const saveWorkFailure = ref(null);
  const saveWorkAttempt = ref(null);
  const saveWorkSending = ref(false);
  let repositoryRequestSequence = 0;

  const toolbarRepositoryWorkState = computed(() => {
    const selectedId = String(props.session?.sessionId || "").trim();
    const sessions = Array.isArray(props.sessionToolbar?.sessions)
      ? props.sessionToolbar.sessions
      : [];
    return sessions.find((session) => String(session?.sessionId || "").trim() === selectedId)
      ?.repositoryWorkState || null;
  });
  const saveWorkRepositoryState = computed(() => {
    const inspected = props.workState && typeof props.workState === "object"
      ? props.workState
      : {};
    const monitored = toolbarRepositoryWorkState.value;
    const inspectedAt = Date.parse(String(inspected.checkedAt || "")) || 0;
    const monitoredAt = Date.parse(String(monitored?.checkedAt || "")) || 0;
    const monitoredState = String(monitored?.state || "");
    if (!monitored || (monitored.updateStatusPending !== true && monitoredAt < inspectedAt)) {
      return inspected;
    }
    const monitoredUnsaved = monitoredState === "unsaved"
      ? true
      : ["saved", "update_available"].includes(monitoredState)
        ? false
        : inspected.unsaved;
    return {
      ...inspected,
      checkedAt: monitored.checkedAt || inspected.checkedAt,
      error: monitoredState === "unavailable"
        ? inspected.error || "Repository status is unavailable."
        : "",
      loading: monitoredState === "checking",
      unsaved: monitoredUnsaved,
      updateAvailable: monitored.updateAvailable === true ||
        ["update_available", "updating"].includes(monitoredState),
      updateStatusPending: monitored.updateStatusPending === true || monitoredState === "updating"
    };
  });
  const saveConnectedFirst = computed(() => saveWorkRepositoryState.value?.connectedSaveRequired === true);
  const saveWorkUnsaved = computed(() => saveWorkRepositoryState.value?.unsaved === true || saveConnectedFirst.value);
  const saveWorkRequiresUpdate = computed(() => Boolean(
    !saveConnectedFirst.value && (saveWorkRepositoryState.value?.updateAvailable === true ||
    saveWorkRepositoryState.value?.updateStatusPending === true)
  ));
  const saveWorkRepositoryBusy = computed(() => ["saving", "updating"].includes(
    String(toolbarRepositoryWorkState.value?.state || "")
  ));
  const repositoryAssistantStateSettled = computed(() => ["connected", "restricted", "unavailable", "failed"].includes(
    props.agentConnectionStatus
  ));
  const updateWorkDisabled = computed(() => Boolean(
    sessionInteractionDisabled.value ||
    !repositoryAssistantStateSettled.value ||
    agentActive.value ||
    composerSending.value ||
    saveWorkSending.value ||
    saveWorkRepositoryBusy.value ||
    saveWorkRepositoryState.value?.loading ||
    saveWorkRepositoryState.value?.error
  ));
  const saveWorkDisabled = computed(() => Boolean(
    updateWorkDisabled.value ||
    (!saveWorkRequiresUpdate.value && !saveWorkUnsaved.value && !saveWorkRepositoryState.value?.connectedRequirementsPresent &&
      !saveWorkRepositoryState.value?.connectedInspectionError)
  ));
  const sessionUpdateLabel = computed(() => {
    const branch = saveWorkRepositoryState.value?.destination?.branch;
    return branch ? `Update session from ${branch}` : "Update session";
  });
  const saveWorkHeaderAriaLabel = computed(() => (
    saveConnectedFirst.value ? "Save connected first" : saveWorkRequiresUpdate.value
      ? sessionUpdateLabel.value
      : "Review selected session changes"
  ));
  const saveWorkHeaderVisible = computed(() => Boolean(
    props.active && sessionId.value
  ));
  const saveWorkTitle = computed(() => {
    if (!repositoryAssistantStateSettled.value) {
      if (props.agentConnectionStatus === "initializing") {
        return "Checking assistant activity before saving or updating";
      }
      return props.agentConnectionStatus === "reconciling"
        ? "Checking the assistant connection before saving or updating"
        : "Waiting for the assistant to reconnect before saving or updating";
    }
    if (repositoryOperationActive.value || saveWorkRepositoryBusy.value) {
      return "Wait for the current repository operation to finish";
    }
    if (agentActive.value || composerSending.value) {
      return "Wait for the assistant turn to finish before saving or updating";
    }
    if (saveWorkRepositoryState.value?.loading) {
      return "Checking whether this session has work to save";
    }
    if (saveWorkRepositoryState.value?.error) {
      return "Repository status is unavailable; check for updates before saving";
    }
    if (saveConnectedFirst.value) return "Review and push connected contributions before saving this project";
    if (saveWorkRequiresUpdate.value) {
      return saveWorkUnsaved.value
        ? `${sessionUpdateLabel.value}, preserving its unsaved work. Save will be available when the update finishes.`
        : `${sessionUpdateLabel.value} to load its latest saved changes.`;
    }
    if (!saveWorkUnsaved.value && !saveWorkRepositoryState.value?.connectedRequirementsPresent &&
        !saveWorkRepositoryState.value?.connectedInspectionError) {
      return "No work to save";
    }
    return "Review changes and choose where to commit them";
  });
  watch(() => {
    const attempt = saveWorkAttempt.value;
    const activeOperation = props.workState?.activeOperation;
    return {
      attempt,
      kind: String(activeOperation?.kind || "").trim(),
      operationId: String(activeOperation?.operationId || "").trim()
    };
  }, ({ attempt, kind, operationId }) => {
    if (
      !attempt ||
      attempt.operationId ||
      !operationId ||
      kind !== attempt.kind
    ) {
      return;
    }
    saveWorkAttempt.value = {
      ...attempt,
      operationId
    };
  });
  const saveWorkOperation = computed(() => {
    const saveOperation = props.workState?.operation || null;
    const updateOperation = props.workState?.updateOperation || null;
    const attempt = saveWorkAttempt.value;
    if (attempt) {
      const operation = attempt.kind === "update" ? updateOperation : saveOperation;
      const operationId = String(operation?.operationId || "").trim();
      return attempt.operationId && operationId === attempt.operationId
        ? operation
        : null;
    }
    const activeOperation = props.workState?.activeOperation;
    const activeOperationId = String(activeOperation?.operationId || "").trim();
    if (activeOperationId) {
      const operation = activeOperation?.kind === "update" ? updateOperation : saveOperation;
      return String(operation?.operationId || "").trim() === activeOperationId
        ? operation
        : null;
    }
    const saveStatus = String(saveOperation?.status || "").trim().toLowerCase();
    const updateStatus = String(updateOperation?.status || "").trim().toLowerCase();
    const saveFailed = saveStatus === "failed";
    const updateFailed = updateStatus === "failed";
    if (saveFailed !== updateFailed) {
      return updateFailed ? updateOperation : saveOperation;
    }
    if (saveFailed && updateFailed) {
      return String(updateOperation?.updatedAt || "") > String(saveOperation?.updatedAt || "")
        ? updateOperation
        : saveOperation;
    }
    return null;
  });
  const saveWorkActivityIsUpdate = computed(() => {
    if (saveWorkAttempt.value) {
      return saveWorkAttempt.value.kind === "update";
    }
    return Boolean(
      (props.workState?.updateOperation && saveWorkOperation.value === props.workState.updateOperation) ||
      (!saveWorkOperation.value && saveWorkRequiresUpdate.value)
    );
  });
  const saveWorkActivityKey = computed(() => {
    const operationId = text(saveWorkOperation.value?.operationId);
    if (!operationId) {
      return "";
    }
    return `${saveWorkActivityIsUpdate.value ? "update-session" : "save-work"}:${operationId}`;
  });
  const saveWorkActivityDismissed = computed(() => Boolean(
    saveWorkActivityKey.value &&
    (dismissals.state.value.saveWork === saveWorkActivityKey.value ||
      dismissals.state.value[saveWorkActivityKey.value] === true)
  ));
  const saveWorkActivityLabel = computed(() => (
    saveWorkActivityIsUpdate.value ? sessionUpdateLabel.value : "Save work"
  ));
  const saveWorkOperationActive = computed(() => ["queued", "running", "starting"].includes(
    String(saveWorkOperation.value?.status || "").trim().toLowerCase()
  ));
  const saveWorkOutput = computed(() => (Array.isArray(saveWorkOperation.value?.events)
    ? saveWorkOperation.value.events
      .filter((event) => text(event.message))
      .map((event) => [eventTimeLabel(event.at), text(event.message)].filter(Boolean).join("  "))
      .join("\n")
    : ""));
  const saveWorkStatus = computed(() => String(
    saveWorkOperation.value?.status || (saveWorkSending.value ? "starting" : "")
  ));
  // Stage values are persisted machine identifiers; show Save wording, never "publishing".
  const saveWorkStage = computed(() => String(
    SAVE_WORK_STAGE_LABELS[saveWorkOperation.value?.stage] ||
    saveWorkOperation.value?.stage ||
    (saveWorkSending.value && !saveWorkOperation.value ? "Waiting for the session to be ready" : "")
  ));
  // The failure last copied from a stored operation, as opposed to a request's own error.
  let storedFailure = null;
  watch(() => ({
    code: String(saveWorkOperation.value?.code || ""),
    details: saveWorkOperation.value?.details || (saveWorkOperation.value?.conflictRecovery ? {
      conflictPaths: saveWorkOperation.value.conflictPaths,
      conflictRecovery: saveWorkOperation.value.conflictRecovery
    } : null),
    error: String(saveWorkOperation.value?.error || ""),
    operationId: String(saveWorkOperation.value?.operationId || ""),
    status: String(saveWorkOperation.value?.status || "").trim().toLowerCase()
  }), (operation) => {
    if (operation.code === "vibe64_session_save_update_required") {
      if (saveWorkFailure.value?.code === operation.code) {
        saveWorkError.value = "";
        saveWorkFailure.value = null;
      }
      return;
    }
    if (operation.status !== "failed" || !operation.error) {
      // A stored failure that is no longer recorded as failed stops showing.
      if (storedFailure && saveWorkFailure.value === storedFailure) {
        saveWorkError.value = "";
        saveWorkFailure.value = null;
      }
      storedFailure = null;
      return;
    }
    saveWorkError.value = operation.error;
    saveWorkFailure.value = {
      code: operation.code,
      details: operation.details,
      message: operation.error
    };
    storedFailure = saveWorkFailure.value;
  }, { immediate: true });
  // Conflicts cannot succeed by retrying; they keep their dedicated recovery.
  const saveWorkConflictFailure = computed(() => [
    "vibe64_session_save_history_diverged",
    "vibe64_session_update_conflict",
    "vibe64_session_update_history_diverged"
  ].includes(String(saveWorkFailure.value?.code || "")));
  // Any reported Save or Update problem can be handed to temporary AI.
  const saveWorkCanResolveWithTemporaryAi = computed(() => Boolean(saveWorkError.value));
  const updateConflictRecovery = computed(() => {
    const recovery = saveWorkFailure.value?.details?.conflictRecovery;
    return saveWorkFailure.value?.code === "vibe64_session_update_conflict" &&
      recovery?.reviewId && recovery.conflictPaths?.length ? recovery : null;
  });
  const resolvedUpdateReview = ref(null);
  watch(() => updateConflictRecovery.value?.reviewId, () => {
    resolvedUpdateReview.value = null;
  }, { flush: "sync" });

  function reviewResolvedUpdate() {
    if (updateWorkDisabled.value || repositoryOperationActive.value ||
        props.sessionRenewal?.sourceOperationsSuspended || !updateConflictRecovery.value) return false;
    const { reviewId, conflictPaths } = updateConflictRecovery.value;
    resolvedUpdateReview.value = { reviewId, conflictPaths: [...conflictPaths] };
    return true;
  }

  const saveWorkRetryable = computed(() => Boolean(
    saveWorkError.value &&
    !saveWorkDisabled.value &&
    !saveWorkConflictFailure.value
  ));

  // One Save or Update request; a newer request or another session discards its result.
  async function runRepositoryRequest(kind, fallbackMessage, run, {
    onFailure = () => {},
    onSuccess = () => {}
  } = {}) {
    const requestSequence = ++repositoryRequestSequence;
    const requestSessionId = sessionId.value;
    const requestProjectSlug = projectSlug.value;
    const requestIsCurrent = () => (
      requestSequence === repositoryRequestSequence &&
      sessionId.value === requestSessionId && projectSlug.value === requestProjectSlug
    );
    saveWorkAttempt.value = {
      kind,
      operationId: ""
    };
    saveWorkSending.value = true;
    saveWorkError.value = "";
    saveWorkFailure.value = null;
    try {
      const result = await run();
      if (!requestIsCurrent()) {
        return false;
      }
      saveWorkAttempt.value = null;
      onSuccess(result);
      return result;
    } catch (error) {
      if (!requestIsCurrent()) {
        return false;
      }
      saveWorkFailure.value = repositoryFailureFromError(error);
      saveWorkError.value = error instanceof Error
        ? error.message
        : String(error || fallbackMessage);
      onFailure();
      return false;
    } finally {
      if (requestIsCurrent()) {
        saveWorkSending.value = false;
      }
    }
  }

  function updateBeforeSave(input = {}) {
    return runRepositoryRequest("update", "This session could not be updated.",
      () => props.updateSessionWork(input));
  }

  function requestSaveWork() {
    if (saveWorkDisabled.value) {
      return false;
    }
    if (saveWorkRequiresUpdate.value) {
      return updateBeforeSave();
    }
    saveWorkReview.value = saveWorkRepositoryState.value?.destination
      ? { ...saveWorkRepositoryState.value.destination }
      : null;
    saveWorkConnectedReview.value = saveConnectedFirst.value
      ? (saveWorkRepositoryState.value?.connectedReview || []).map(item => ({
          projectSlug: item.projectSlug, destination: { ...item.destination }
        }))
      : null;
    saveWorkConfirmOpen.value = true;
    return true;
  }

  function retrySaveWork() {
    return saveWorkRetryable.value ? requestSaveWork() : false;
  }

  function dismissSaveWorkActivity() {
    if (saveWorkSending.value || saveWorkOperationActive.value) {
      return false;
    }
    if (!saveWorkActivityKey.value && saveWorkError.value) {
      saveWorkError.value = "";
      saveWorkFailure.value = null;
      return true;
    }
    return dismissals.dismiss("saveWork", saveWorkActivityKey.value);
  }

  // The tab's "Show … notice" brings a dismissed Save or Update notice back.
  function showSaveWorkActivity() {
    return saveWorkActivityDismissed.value && dismissals.restore("saveWork", saveWorkActivityKey.value);
  }

  function cancelSaveWork() {
    saveWorkConfirmOpen.value = false;
  }

  async function confirmSaveWork() {
    if (saveWorkDisabled.value) {
      return false;
    }
    saveWorkConnectedResults.value = [];
    saveWorkStandInIdentity.value = false;
    saveWorkConfirmOpen.value = false;
    return runRepositoryRequest("save", "Session work could not be saved.", () => props.saveSessionWork({
      destinationReview: saveWorkReview.value,
      ...(saveWorkConnectedReview.value !== null ? { connectedReview: saveWorkConnectedReview.value } : {})
    }), {
      onFailure() {
        saveWorkConnectedResults.value = saveWorkFailure.value?.details?.connected || [];
      },
      onSuccess(result) {
        saveWorkConnectedResults.value = result?.connected || [];
        saveWorkStandInIdentity.value = result?.standInIdentity === true;
        if (result) reportActivity("saved", { projectSlug: projectSlug.value, sessionId: sessionId.value });
      }
    });
  }

  watch([sessionId, projectSlug, actorKey], () => {
    repositoryRequestSequence += 1;
    saveWorkConfirmOpen.value = false;
    saveWorkConnectedReview.value = null;
    saveWorkConnectedResults.value = [];
    saveWorkStandInIdentity.value = false;
    resolvedUpdateReview.value = null;
    saveWorkSending.value = false;
    saveWorkAttempt.value = null;
    saveWorkError.value = "";
    saveWorkFailure.value = null;
  });

  return {
    cancelSaveWork,
    confirmSaveWork,
    dismissSaveWorkActivity,
    requestSaveWork,
    resolvedUpdateReview,
    retrySaveWork,
    reviewResolvedUpdate,
    saveConnectedFirst,
    saveWorkActivityDismissed,
    saveWorkActivityIsUpdate,
    saveWorkActivityKey,
    saveWorkActivityLabel,
    saveWorkCanResolveWithTemporaryAi,
    saveWorkConfirmOpen,
    saveWorkConflictFailure,
    saveWorkConnectedResults,
    saveWorkConnectedReview,
    saveWorkDisabled,
    saveWorkError,
    saveWorkFailure,
    saveWorkHeaderAriaLabel,
    saveWorkHeaderVisible,
    saveWorkOperation,
    saveWorkOperationActive,
    saveWorkOutput,
    saveWorkRequiresUpdate,
    saveWorkRetryable,
    saveWorkReview,
    saveWorkSending,
    saveWorkStage,
    saveWorkStandInIdentity,
    saveWorkStatus,
    saveWorkTitle,
    saveWorkUnsaved,
    showSaveWorkActivity,
    updateBeforeSave,
    updateConflictRecovery,
    updateWorkDisabled
  };
}

export { useVibe64SessionSaveWork };
