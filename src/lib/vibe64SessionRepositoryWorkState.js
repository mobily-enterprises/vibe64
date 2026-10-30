import {
  mdiAlertCircleOutline,
  mdiCheckCircleOutline,
  mdiCloudDownloadOutline,
  mdiContentSaveAlertOutline,
  mdiDotsHorizontalCircleOutline
} from "@mdi/js";
import { SESSION_WORK_PROBLEM_LABEL, sessionWorkProblem } from "@local/vibe64-terminals/shared/sessionWorkProblem";

// One owner for a session's repository work state: the derivation from the
// session work snapshot, and the label and icon each state is shown with.
const REPOSITORY_WORK_STATE_PRESENTATION = Object.freeze({
  checking: Object.freeze({ icon: mdiDotsHorizontalCircleOutline, label: "Checking whether work is saved" }),
  needs_help: Object.freeze({ icon: mdiAlertCircleOutline, label: SESSION_WORK_PROBLEM_LABEL }),
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
  const problem = sessionWorkProblem(source);
  if (problem) {
    return {
      ...freshness,
      problem: { message: problem.message, nextStep: problem.nextStep, operation: problem.operation },
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

// The assistant can change source until its turn ends, so "saved" is only the
// last check's result while the session reports assistant work.
function repositoryWorkStateProvisional(sessionItem = {}) {
  return sessionItem?.agentThinking === true && repositoryWorkState(sessionItem) === "saved";
}

function repositoryWorkStateLabel(sessionItem = {}) {
  if (repositoryWorkStateProvisional(sessionItem)) {
    return "All work was saved at the last check; the assistant is still working";
  }
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

// The stored reason a session's repository needs help and what to do next.
function repositoryWorkStateProblem(sessionItem = {}) {
  const problem = sessionItem?.repositoryWorkState?.problem;
  return repositoryWorkState(sessionItem) === "needs_help" && problem?.message ? problem : null;
}

// The label with its reason, for the tab's icon tooltip and accessible name.
function repositoryWorkStateDescription(sessionItem = {}) {
  const label = repositoryWorkStateLabel(sessionItem);
  const problem = repositoryWorkStateProblem(sessionItem);
  return problem ? `${label}: ${problem.message} ${problem.nextStep}` : label;
}

function repositoryWorkStateIcon(sessionItem = {}) {
  return REPOSITORY_WORK_STATE_PRESENTATION[repositoryWorkState(sessionItem)].icon;
}

// Archiving keeps unsaved work only in the archive, which cannot restore source,
// so the confirmation says when the project does not have this session's work yet.
function sessionArchiveWorkNotice(workState = null) {
  const state = repositoryWorkState({ repositoryWorkState: workState });
  if (state === "saved" || state === "update_available") return null;
  const archiveOnly = "Archiving keeps them only in the session archive, which cannot restore them to the project.";
  if (state === "unsaved") {
    const changedCount = Number(workState?.changedCount || 0);
    const changes = changedCount === 1 ? "1 unsaved change" : `${changedCount || "some"} unsaved changes`;
    return {
      confirmLabel: "Archive without saving",
      kind: "unsaved",
      message: `This session has ${changes} that the project does not have yet, such as an added starter. ${archiveOnly} To keep them, choose Cancel and use Save first.`
    };
  }
  return {
    confirmLabel: "Archive session",
    kind: "unconfirmed",
    message: `Vibe64 has not confirmed that this session's work is saved. Any unsaved changes are not in the project. ${archiveOnly}`
  };
}

export {
  repositoryWorkState,
  repositoryWorkStateDescription,
  repositoryWorkStateIcon,
  repositoryWorkStateLabel,
  repositoryWorkStateProblem,
  repositoryWorkStateProvisional,
  sessionArchiveWorkNotice,
  sessionRepositoryWorkState
};
