// What an OpenCode Zen connection's model check shows: whether it runs, how far
// it got, and the title and summary of its model access.

const RUNNING_STATUSES = ["starting", "running", "cancelling"];

/** The connection's latest model check, or an empty one. */
function zenCheck(account = {}) {
  return account.modelAccess?.check || {};
}

/** Whether the connection's model check is still going. */
function zenCheckIsRunning(account = {}) {
  return RUNNING_STATUSES.includes(zenCheck(account).status);
}

/** How far the model check got, as a percentage. */
function zenCheckProgress(account = {}) {
  const check = zenCheck(account);
  return check.total > 0 ? Math.min(100, (check.checked / check.total) * 100) : 0;
}

/** The connection's model access, in a few words. */
function zenAccessTitle(account = {}) {
  const mode = account.modelAccess?.mode;
  const check = zenCheck(account);
  if (zenCheckIsRunning(account)) return check.status === "cancelling" ? "Stopping model check…" : "Checking Zen models…";
  if (mode === "all") return "All current Zen models enabled";
  if (mode === "verified") return `${Number(check.enabled || 0)} additional Zen models enabled`;
  return "Recommended Zen model only";
}

/** The model check's progress while it runs, and its counts once it ends. */
function zenCheckSummary(account = {}) {
  const check = zenCheck(account);
  if (!check.status) return "";
  if (zenCheckIsRunning(account)) {
    const progress = check.total > 0 ? `${check.checked} of ${check.total} checked` : "Reading the current Zen catalogue";
    const current = check.currentModelId ? ` · Now checking ${check.currentModelId}` : "";
    return `${progress}${current}`;
  }
  const unchecked = Math.max(0, Number(check.total || 0) - Number(check.checked || 0));
  const result = `${Number(check.enabled || 0)} enabled · ${Number(check.rejected || 0)} rejected · ${Number(check.retryable || 0)} could not be confirmed · ${unchecked} unchecked`;
  return check.message ? `${result}. ${check.message}` : result;
}

export { zenAccessTitle, zenCheck, zenCheckIsRunning, zenCheckProgress, zenCheckSummary };
