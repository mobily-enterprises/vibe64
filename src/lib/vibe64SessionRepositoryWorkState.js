import {
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiCloudDownloadOutline,
  mdiContentSaveAlertOutline,
  mdiDotsHorizontalCircleOutline
} from "@mdi/js";

// One owner for a session's repository work state: the derivation from the
// session work snapshot, and the label and icon each state is shown with.
const REPOSITORY_WORK_STATE_PRESENTATION = Object.freeze({
  checking: Object.freeze({ icon: mdiDotsHorizontalCircleOutline, label: "Checking whether work is saved" }),
  needs_help: Object.freeze({ icon: mdiAlertCircleOutline, label: "Repository needs help" }),
  saved: Object.freeze({ icon: mdiCheckCircleOutline, label: "All work is saved" }),
  saving: Object.freeze({ icon: mdiDotsHorizontalCircleOutline, label: "Saving work" }),
  unavailable: Object.freeze({ icon: mdiAlertCircleOutline, label: "Save status is unavailable" }),
  unsaved: Object.freeze({ icon: mdiContentSaveAlertOutline, label: "" }),
  update_available: Object.freeze({ icon: mdiCloudDownloadOutline, label: "Update available" }),
  updating: Object.freeze({ icon: mdiDotsHorizontalCircleOutline, label: "Updating session" })
});

function sessionRepositoryWorkState(workState = null) {
  const source = workState && typeof workState === "object" ? workState : {};
  const freshness = {
    checkedAt: String(source.checkedAt || ""),
    ...(source.updateStatusPending === true ? { updateStatusPending: true } : {})
  };
  const operationStatus = String(source.operation?.status || "").trim();
  const operationCode = String(source.operation?.code || "").trim();
  const updateStatus = String(source.updateOperation?.status || "").trim();
  if (operationStatus === "running") {
    return {
      ...freshness,
      state: "saving"
    };
  }
  if (updateStatus === "running") {
    return {
      ...freshness,
      state: "updating"
    };
  }
  if (
    (operationStatus === "failed" && operationCode !== "vibe64_session_save_update_required") ||
    updateStatus === "failed"
  ) {
    return {
      ...freshness,
      state: "needs_help",
      updateAvailable: source.updateAvailable === true
    };
  }
  if ((source.loading || source.unsaved === null || source.unsaved === undefined) && source.updateAvailable !== true) {
    return {
      ...freshness,
      state: source.error ? "unavailable" : "checking"
    };
  }
  const changedCount = Array.isArray(source.changedPaths) ? source.changedPaths.length : 0;
  if (source.unsaved === true || source.connectedSaveRequired === true) {
    return {
      changedCount,
      ...freshness,
      state: "unsaved",
      updateAvailable: source.updateAvailable === true
    };
  }
  return {
    ...freshness,
    state: source.error
      ? "unavailable"
      : (source.updateAvailable === true ? "update_available" : "saved")
  };
}

function repositoryWorkState(sessionItem = {}) {
  const state = String(sessionItem?.repositoryWorkState?.state || "checking");
  return Object.hasOwn(REPOSITORY_WORK_STATE_PRESENTATION, state) ? state : "checking";
}

function repositoryWorkStateLabel(sessionItem = {}) {
  const state = repositoryWorkState(sessionItem);
  if (state === "unsaved") {
    const changedCount = Number(sessionItem?.repositoryWorkState?.changedCount || 0);
    const changeLabel = changedCount === 1 ? "1 change" : `${changedCount || "Unsaved"} changes`;
    return sessionItem?.repositoryWorkState?.updateAvailable
      ? `${changeLabel}; update available`
      : changeLabel;
  }
  return REPOSITORY_WORK_STATE_PRESENTATION[state].label;
}

function repositoryWorkStateIcon(sessionItem = {}) {
  return REPOSITORY_WORK_STATE_PRESENTATION[repositoryWorkState(sessionItem)].icon;
}

export {
  repositoryWorkState,
  repositoryWorkStateIcon,
  repositoryWorkStateLabel,
  sessionRepositoryWorkState
};
