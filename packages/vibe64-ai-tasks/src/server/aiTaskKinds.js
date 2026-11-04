import { AppError } from "@jskit-ai/kernel/server/runtime";
import { SESSION_UPDATE_TASK_ID } from "@local/vibe64-core/shared";

/** @typedef {import("./types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("./types.js").AiTaskCheckResult} AiTaskCheckResult */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */

const REPOSITORY_GIT_BOUNDARY = [
  "Vibe64 owns every repository operation. The failed operation has already been rolled back.",
  "You may inspect Git read-only and edit ordinary working-tree files in this session. Do not change HEAD, branches, refs, the index, stashes, remotes, commits, checkpoints, or repository configuration.",
  "Do not run git add, commit, checkout, switch, restore, reset, clean, stash, merge, rebase, cherry-pick, revert, pull, push, fetch, or update-ref. Do not create a recovery ref or stash; Vibe64 already owns durable recovery.",
  "Record the initial HEAD and index with read-only commands, leave both byte-for-byte unchanged, and do not push. Resolve only by editing the conflicting working-tree files; Vibe64 owns applying and verifying the repository operation.",
  "Preserve the intended behavior of both the latest saved work and this session. Do not hand-edit generated Genesis maps; Vibe64 regenerates its derived artifacts. A clean index after rollback is not proof that the conflict is resolved."
].join("\n");

const UPDATE_HANDOFF = [
  "Review every listed conflict against both the saved and session versions, preserving their intended changes. Leave an already-correct file unchanged. Confirm the content is resolved before reporting completion; valid syntax alone is insufficient.",
  "Your task is to prepare the file repair, not to run or complete the rebase yourself. Return kind=complete with a factual report as soon as the edits and focused checks are ready for Vibe64 to try Update. Vibe64 then runs Update automatically and returns remaining conflicts to this same conversation.",
  "Return kind=question only when you need an actual user decision, and ask that specific question. Return kind=cannot only when this cannot be repaired, and say why. Do not wait for the user to click Rebase or tell them to open another repair chat.",
  "Describe progress in terms of the user's features and remaining work. Keep HEAD/index/ref bookkeeping in the technical checks, not routine progress or the final reply. Passing application tests is not proof that Update succeeded."
].join("\n");

const UPDATE_SUCCEEDED_MESSAGE = "Session updated. Your changes were preserved. Nothing was pushed.";
const UPDATE_WAITING_MESSAGE = "Update waits for the session's assistant to finish";
// Update refused only because the session's assistant is still working waits for that turn.
const WAITING_CODES = Object.freeze(["vibe64_session_update_agent_active", "vibe64_agent_write_mode_busy"]);
const REPAIRABLE_CODES = Object.freeze([
  "vibe64_session_update_conflict",
  "vibe64_session_update_history_diverged",
  "vibe64_session_save_history_diverged"
]);

const conflictCount = count => `${count} ${count === 1 ? "file" : "files"}`;

function updateRetryMessage(diagnostic) {
  return [
    "Vibe64 ran Update after the prepared repair, but it did not succeed. The working-tree edits remain. Inspect the current state and repair only the remaining conflicts; do not start over or repeat completed work.",
    `Latest Update diagnostic:\n${diagnostic}`,
    UPDATE_HANDOFF
  ].join("\n\n");
}

/**
 * Update's saved failure is the problem: a browser only names it.
 * @param {{ runtime: object, sessionId: string }} context
 */
async function readUpdateProblem({ runtime, sessionId }) {
  const failure = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
  if (failure?.status !== "failed") {
    throw new AppError(409, "Update has no problem to fix right now.", { code: "vibe64_ai_task_no_problem" });
  }
  const recovery = failure.conflictRecovery || null;
  const paths = recovery?.conflictPaths || failure.conflictPaths || [];
  const error = String(failure.error || "Update did not finish.");
  return {
    key: JSON.stringify(["update", failure.code || "", recovery?.reviewId || recovery?.canonicalCommit || error]),
    summary: paths.length ? `Update found conflicts in ${conflictCount(paths.length)}.` : error,
    details: [error, ...paths].join("\n"),
    facts: { code: failure.code || "", error, paths, reviewId: recovery?.reviewId || "" }
  };
}

/**
 * What Update's answer means for its task.
 * @param {{ ok?: boolean, code?: string, error?: string, details?: object }} result
 * @returns {AiTaskCheckResult}
 */
function updateCheckResult(result) {
  if (result?.ok !== false) return { passed: true, message: UPDATE_SUCCEEDED_MESSAGE };
  const code = String(result.code || "");
  if (WAITING_CODES.includes(code)) return { waiting: true, message: UPDATE_WAITING_MESSAGE };
  const error = String(result.error || "The operation failed.");
  const recovery = result.details?.conflictRecovery || null;
  const paths = result.details?.conflictPaths || recovery?.conflictPaths || [];
  return {
    passed: false,
    message: paths.length ? `Update still has conflicts in ${conflictCount(paths.length)}.` : `Update still needs attention: ${error}`,
    retryKey: recovery || REPAIRABLE_CODES.includes(code)
      ? JSON.stringify([code, recovery?.reviewId || recovery?.canonicalCommit || "", paths.length ? paths : error])
      : "",
    diagnostic: error,
    facts: { reviewId: recovery?.reviewId || "" }
  };
}

/**
 * Every kind of AI task. A check calls its owner directly: this package sits above them all.
 * @param {object} dependencies
 * @param {SessionsService} dependencies.sessions
 * @returns {Record<string, AiTaskKind>}
 */
function createAiTaskKinds({ sessions }) {
  return Object.freeze({
    update: Object.freeze({
      id: "update",
      title: "Fix Update",
      noun: "fix",
      tray: "Fixing Update…",
      routing: "fix",
      repository: true,
      updateRepair: true,
      busy: "Update is being fixed. Finish that first.",
      opening: "Fix this Update problem without losing work.",
      problem: readUpdateProblem,
      brief: problem => [
        "Help resolve this Vibe64 Update problem. Inspect the current session and canonical repository state, preserve all work, and do not push until the conflict is understood:",
        REPOSITORY_GIT_BOUNDARY,
        UPDATE_HANDOFF,
        problem.facts.error
      ].join("\n\n"),
      context: () => [REPOSITORY_GIT_BOUNDARY, UPDATE_HANDOFF].join("\n\n"),
      steps: ["The AI repairs the conflicts", "Vibe64 runs Update"],
      check: {
        by: "vibe64",
        label: "Running Update…",
        output: "Update output",
        unstoppable: "Update can't be interrupted. The fix ends as soon as this run finishes.",
        async run({ sessionId, taskId }, task) {
          return updateCheckResult(await sessions.updateSessionWork(sessionId, {
            aiTaskId: taskId,
            requestId: task.pending.id,
            reviewedConflictId: task.pending.reviewedConflictId || task.problem.facts.reviewId,
            vibe64User: task.startedBy
          }));
        },
        retry: {
          limit: 3,
          display: "Continue repairing the remaining conflicts.",
          message: updateRetryMessage
        }
      },
      done: UPDATE_SUCCEEDED_MESSAGE
    })
  });
}

export {
  createAiTaskKinds,
  updateCheckResult
};
