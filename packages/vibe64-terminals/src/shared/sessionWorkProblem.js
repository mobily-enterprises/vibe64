// The stored Save or Update failure that makes a session's repository need
// help: which operation failed, its own recorded message and the existing
// controls that lead out of it. The editor, the session's assistant and
// Colleague read it here, so each explains the same reason.

const SAVE_UPDATE_REQUIRED_CODE = "vibe64_session_save_update_required";
const SESSION_WORK_PROBLEM_LABEL = "Repository needs help";

function text(value = "") {
  return String(value || "").trim();
}

function failed(record) {
  return Boolean(record && typeof record === "object" && text(record.status).toLowerCase() === "failed");
}

function nextStep(operation, record) {
  const notice = operation === "update" ? "Update notice" : "Save notice";
  const code = text(record.code);
  if (code === "vibe64_session_update_conflict" && text(record.conflictRecovery?.reviewId)) {
    return `Resolve the listed files yourself, in Main chat or with Fix it with AI, then choose Review resolved conflicts on the ${notice}.`;
  }
  if (code === "vibe64_session_save_history_diverged" || code === "vibe64_session_update_history_diverged") {
    return `Choose Fix it with AI on the ${notice}; retrying alone cannot succeed.`;
  }
  if (code === "vibe64_pull_request_required") {
    return `Choose Create draft PR or Fix it with AI on the ${notice}.`;
  }
  return `Choose Fix it with AI on the ${notice}, or fix the cause and ${operation === "update" ? "update" : "save"} again.`;
}

// `operation` and `updateOperation` are the session's stored Save and Update
// records, as session work inspection returns them. When both failed, the
// later failure is the one shown.
function sessionWorkProblem({ operation = null, updateOperation = null } = {}) {
  const save = failed(operation) && text(operation.code) !== SAVE_UPDATE_REQUIRED_CODE ? operation : null;
  const update = failed(updateOperation) ? updateOperation : null;
  const record = save && update
    ? (text(update.updatedAt) > text(save.updatedAt) ? update : save)
    : save || update;
  if (!record) {
    return null;
  }
  const kind = record === update ? "update" : "save";
  return {
    code: text(record.code),
    failedAt: text(record.finishedAt || record.updatedAt),
    label: SESSION_WORK_PROBLEM_LABEL,
    message: text(record.error || record.message) ||
      `${kind === "update" ? "Update" : "Save"} failed without a recorded reason.`,
    nextStep: nextStep(kind, record),
    operation: kind,
    status: "failed"
  };
}

export { SESSION_WORK_PROBLEM_LABEL, sessionWorkProblem };
