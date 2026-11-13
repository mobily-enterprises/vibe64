// What `vibe64-helper session update` answers. The command runs the session's own Update, the one its Update button
// runs; this puts that Update's result as what the session's AI does next: which repositories and files moved and
// whether Preview restarts, or which repository conflicts and how to finish it, or what Update said when it failed.
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { shortCommit } from "./sessionConnectedCopies.js";

const LISTED_FILE_LIMIT = 20;
const OWN_REPOSITORY = "this session";
const UPDATE_COMMAND = "vibe64-helper session update";
// Update's own message says why; the AI needs no list of its codes to act on it.
const FAILED_NEXT = `Read what it says. If something else is running, run ${UPDATE_COMMAND} again in a moment. ` +
  "If the cause is in this session's files, fix it and run it again. Otherwise tell the person what it says.";

const fileCount = count => `${count} ${count === 1 ? "file" : "files"}`;

/**
 * What Update moved: each repository it reached (this session's own first) with its status and saved commit, the
 * files it changed (a copy's as ../connected/<name>/...), the first ones listed, and whether Preview restarts.
 * @param {{ canonicalCommit?: string, connected?: object[], status?: string, updatedPathCount?: number, updatedPaths?: string[] }} moved
 * @param {boolean} previewStartedBefore whether a Preview started before Update still runs
 */
function movedBy(moved, previewStartedBefore) {
  const sources = [moved, ...(moved.connected || [])];
  const changedFileCount = sources.reduce((total, source) => total + (source.updatedPathCount || 0), 0);
  return {
    repositories: [
      ...(moved.status ? [{ name: OWN_REPOSITORY, status: moved.status, commit: shortCommit(moved.canonicalCommit) }] : []),
      ...(moved.connected || []).map(copy => ({ name: copy.name, status: copy.status, commit: shortCommit(copy.canonicalCommit) }))
    ],
    changedFileCount,
    changedFiles: sources.flatMap(source => source.updatedPaths || []).slice(0, LISTED_FILE_LIMIT),
    preview: { restart: previewStartedBefore && changedFileCount > 0 }
  };
}

function movedLines(moved) {
  if (!moved.repositories.length) return "";
  const repositories = moved.repositories.map(({ commit, name, status }) => status === "already_current"
    ? `${name} was already current`
    : `${name} updated to ${commit}`).join("; ");
  const more = moved.changedFileCount - moved.changedFiles.length;
  const files = moved.changedFileCount
    ? `${fileCount(moved.changedFileCount)} changed: ${moved.changedFiles.join(", ")}${more > 0 ? ` and ${more} more` : ""}.`
    : "No file changed.";
  return `${repositories}. ${files}`;
}

/**
 * What to do after Update moved files: read them again, wait for the preparation it started, and restart a Preview
 * still running the code from before it.
 */
function afterUpdateSteps(moved, setupRunning) {
  if (!moved.changedFileCount) return "";
  return [
    "Re-read the changed files before editing them, and re-run any checks that touch them.",
    setupRunning ? "Workspace preparation is running for them: read vibe64-helper session status --json until workspaceSetup.status is no longer running before running checks." : "",
    moved.preview.restart ? "Preview still runs the code from before Update: run vibe64-helper preview restart --wait." : ""
  ].filter(Boolean).join(" ");
}

/**
 * A conflict Update left for repair: the repository it is in (left unchanged, without conflict markers), its files,
 * the commits to compare them with, and the review id that finishes the repair.
 * @param {object} recovery the conflict's recorded recovery
 * @param {string} repository the connected repository, or "" for this session's own
 */
function conflictFor(recovery, repository) {
  const directory = repository ? `../connected/${repository}` : ".";
  const prefix = repository ? `${directory}/` : "";
  return {
    repository: repository || OWN_REPOSITORY,
    directory,
    files: (recovery.conflictPaths || []).map(entry => entry.startsWith(prefix) ? entry.slice(prefix.length) : entry),
    savedCommit: normalizeText(recovery.canonicalCommit),
    baseCommit: normalizeText(recovery.baseCommit),
    reviewId: normalizeText(recovery.reviewId)
  };
}

function conflictLine(conflict) {
  const where = conflict.repository === OWN_REPOSITORY ? OWN_REPOSITORY : `connected repository ${conflict.repository} (${conflict.directory})`;
  const count = conflict.files.length;
  return `Conflict: ${fileCount(count)} in ${where} ${count === 1 ? "conflicts" : "conflict"} with its saved version, so that repository was left unchanged: ${conflict.files.join(", ")}.`;
}

function conflictSteps(conflict) {
  const where = conflict.directory === "." ? "" : `In ${conflict.directory}, `;
  return [
    `${where}each listed file still holds this session's version. Compare it with the saved version`,
    `(git show ${shortCommit(conflict.savedCommit)}:<file>) and their common base (git show ${shortCommit(conflict.baseCommit)}:<file>),`,
    "and edit it to keep both sides' intended changes. Then run",
    `${UPDATE_COMMAND} --resolved ${conflict.reviewId}, which applies Update with the files as you left them.`
  ].join(" ");
}

/**
 * The answer to a refused or failed Update: a conflict, with what repairs it, or Update's own message. A connected
 * repository that failed still lets the others and this session's own repository update, so what moved is
 * reported with it.
 * @param {object} result the Update's `{ ok: false }` result
 * @param {{ previewStartedBefore: boolean, setupRunning: boolean }} after
 */
function failedUpdateAnswer(result, after) {
  const details = result.details || {};
  const moved = movedBy(details.updated || {}, after.previewStartedBefore);
  const recovery = details.conflictRecovery;
  const conflict = recovery?.reviewId
    ? conflictFor(recovery, normalizeText(details.connectedRepository || recovery.connectedRepository))
    : null;
  return {
    ok: false,
    status: conflict ? "conflict" : "failed",
    code: normalizeText(result.code),
    message: [
      conflict ? conflictLine(conflict) : normalizeText(result.error) || "Update did not finish.",
      moved.repositories.length ? `Meanwhile ${movedLines(moved)}` : ""
    ].filter(Boolean).join(" "),
    next: [conflict ? conflictSteps(conflict) : FAILED_NEXT, afterUpdateSteps(moved, after.setupRunning)]
      .filter(Boolean).join(" "),
    ...(conflict ? { conflict } : {}),
    ...(moved.repositories.length ? moved : {})
  };
}

/**
 * The answer to `vibe64-helper session update`, from the Update's own result: what it moved is its `updated`, on
 * success as on a copy's failure.
 * @param {object} result what the session's Update returned
 * @param {object} after what holds once it returned
 * @param {boolean} after.previewStartedBefore whether a Preview started before Update still runs
 * @param {boolean} after.setupRunning whether workspace preparation runs after Update
 */
function agentSessionUpdateAnswer(result, after) {
  if (result?.ok !== true) return failedUpdateAnswer(result || {}, after);
  // Nothing reported is not "already current".
  if (!result.updated) return failedUpdateAnswer({ error: "Update finished without saying what it moved." }, after);
  const moved = movedBy(result.updated, after.previewStartedBefore);
  const current = moved.repositories.every(repository => repository.status === "already_current");
  return {
    ok: true,
    status: current ? "already_current" : "updated",
    message: current
      ? "Already current: this session and its connected repositories have their saved versions. No file changed."
      : `Updated: ${movedLines(moved)}`,
    next: afterUpdateSteps(moved, after.setupRunning),
    ...moved
  };
}

export { agentSessionUpdateAnswer };
