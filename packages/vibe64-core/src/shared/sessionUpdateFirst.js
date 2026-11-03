// Whether Update owns a session's repairs. While its Update failed, is running
// or is pending (its saved version moved on), Update is the one repair: a
// setup or verification repair would redo work the saved version already has,
// or collide with it on Update. The editor, session status, the onboarding
// state and the repair prompts read it here, so each says the same thing.

import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { normalizeRepositoryUpdateCheck, REPOSITORY_UPDATE_CHECK_METADATA } from "./repositoryUpdateStatus.js";

// Background task ids of the session's Save and Update operations.
const SESSION_SAVE_TASK_ID = "save-work";
const SESSION_UPDATE_TASK_ID = "update-session";
const UPDATE_RUNNING_STATUSES = ["queued", "running", "starting"];

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

/**
 * `updateCheck` is the session's saved `repository_update_check` (object or
 * its JSON text); `updateOperation` is its stored Update task record.
 * @param {{ updateCheck?: object | string | null, updateOperation?: object | null }} input
 */
function sessionUpdateFirst({ updateCheck = null, updateOperation = null } = {}) {
  let check = updateCheck;
  if (typeof check === "string") {
    try {
      check = JSON.parse(check);
    } catch {
      check = null;
    }
  }
  check = record(check) ? normalizeRepositoryUpdateCheck(check, check.checkedAt) : null;
  const operation = record(updateOperation);
  const status = normalizeText(operation?.status).toLowerCase();
  const reason = status === "failed" ? "failed"
    : UPDATE_RUNNING_STATUSES.includes(status) ? "running"
      : check?.updateAvailable ? "behind" : "";
  if (!reason) return null;
  const conflictPaths = reason === "failed" && Array.isArray(operation.conflictPaths)
    ? operation.conflictPaths.map(normalizeText).filter(Boolean).slice(0, 20) : [];
  return {
    reason,
    behind: check?.behind || 0,
    canonicalCommit: check?.canonicalCommit || normalizeText(operation?.conflictRecovery?.canonicalCommit),
    incomingVersions: (check?.incomingVersions || []).map(({ shortCommit, message }) => ({ shortCommit, message })),
    incomingVersionsTruncated: check?.incomingVersionsTruncated === true,
    conflictPaths,
    error: reason === "failed" ? normalizeText(operation.error || operation.message).slice(0, 1000) : "",
    message: reason === "failed"
      ? "This session's Update needs repair first. Use Fix it with AI on the Update notice; setup is checked again once Update succeeds."
      : reason === "running"
        ? "This session is updating. Setup is checked again once Update finishes."
        : "This session is behind its saved version. Update it first; setup is checked again against the updated session."
  };
}

/**
 * The same decision read from a session store's saved check and Update record.
 * @param {{ readMetadataValue: Function, readBackgroundTask: Function }} store
 * @param {string} sessionId
 */
async function readSessionUpdateFirst(store, sessionId) {
  const [updateCheck, updateOperation] = await Promise.all([
    store.readMetadataValue(sessionId, REPOSITORY_UPDATE_CHECK_METADATA),
    store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID)
  ]);
  return sessionUpdateFirst({ updateCheck, updateOperation });
}

/**
 * The saved-version facts a Fix it with AI repair turn carries, or "" when
 * Update does not own the session. An Update repair gets the same facts; a
 * setup, preparation or verification repair is told that Update comes first
 * and setup is rechecked after it.
 * @param {ReturnType<typeof sessionUpdateFirst>} state
 * @param {{ updateRepair?: boolean }} [options]
 */
function sessionUpdateFirstRepairBrief(state, { updateRepair = false } = {}) {
  if (!state) return "";
  const versions = state.incomingVersions.map(({ shortCommit, message }) => `- ${shortCommit} ${message.split("\n")[0]}`);
  const more = state.incomingVersionsTruncated && state.behind > versions.length
    ? [`- …and ${state.behind - versions.length} more`] : [];
  const where = state.canonicalCommit ? ` (${state.canonicalCommit.slice(0, 8)})` : "";
  return [
    "[Vibe64 saved version]",
    state.reason === "failed"
      ? `This session's Update failed${state.conflictPaths.length ? ` on: ${state.conflictPaths.join(", ")}` : ""}.${state.error ? ` ${state.error}` : ""}`
      : state.reason === "running" ? "This session's Update is running."
        : `This session is ${state.behind || "some"} version${state.behind === 1 ? "" : "s"} behind its saved version${where}.`,
    ...(versions.length ? [`Incoming saved versions${where}:`, ...versions, ...more] : []),
    "Before changing dependencies or porting code, check read-only whether the saved version already contains that change " +
      `(\`git log HEAD..${state.canonicalCommit ? state.canonicalCommit.slice(0, 12) : "<saved commit>"}\`, \`git show <saved commit>:<path>\`). ` +
      "Never redo upstream work here: the saved version arrives with Update.",
    "Local work the saved version supersedes, such as a stale or partial dependency bump it completes, is resolved by taking the saved version. " +
      "Say so plainly in one sentence and do not ask the person to choose: Vibe64's checkpoint keeps the original. Ask only about genuine product decisions.",
    updateRepair
      ? "Update is this repair. Prepare it so Update succeeds; Vibe64 runs Update itself afterwards."
      : "Update owns this session until it succeeds. When this repair concerns project setup, workspace preparation, verification, " +
        "dependencies or code the saved version may already port, do not repair it in this chat now: tell the person in one sentence " +
        "that the session must be brought up to date first, then end your turn; setup is checked again against the updated session. " +
        "Any other repair continues without redoing saved work.",
    "[End Vibe64 saved version]"
  ].join("\n");
}

export {
  SESSION_SAVE_TASK_ID,
  SESSION_UPDATE_TASK_ID,
  readSessionUpdateFirst,
  sessionUpdateFirst,
  sessionUpdateFirstRepairBrief
};
