import { AppError } from "@jskit-ai/kernel/server/runtime";
import { REPOSITORY_GIT_BOUNDARY, conflictCount } from "./repository.js";

/** @typedef {import("../types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("../types.js").AiTaskCheckResult} AiTaskCheckResult */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */

const MERGE_HANDOFF = [
  "Repair only the listed conflicting files in this receiving session's worktree. Inspect both exact reviewed commits, preserve both sides' intended behavior and all unrelated or staged work. Do not commit, merge, rebase or push.",
  "Return kind=complete with a factual report as soon as the files are repaired. Vibe64 then builds the repaired merge for the person's review and returns any problem to this same conversation; only the person's reviewed Merge integrates this contribution. Return kind=question only when you need an actual user decision. Return kind=cannot only when this cannot be repaired, and say why."
].join("\n");
const REVIEW_KEYS = Object.freeze(["repository", "targetBranch", "targetHead", "id", "activeHead", "discardedHead"]);
// The contribution moved on: only a person's fresh look settles it. The AI is not asked again.
const PERSON_MESSAGES = Object.freeze({
  vibe64_incoming_heads_changed: "The contribution or its target changed. Refresh Incoming changes and merge again.",
  vibe64_incoming_not_pending: "This contribution is no longer waiting to merge. Refresh Incoming changes.",
  vibe64_incoming_review_changed: "The contribution or its target changed. Refresh Incoming changes and merge again."
});
// Codes saying the merge no longer conflicts: the problem is gone.
const RESOLVED_CODES = Object.freeze(["vibe64_incoming_repair_not_needed", "vibe64_incoming_repair_no_longer_needed"]);
const CONFLICT_MARKER = /^\+(?:<{7} |>{7} |={7}$)/mu;

const text = value => String(value || "").trim();

function mergeRetryMessage(diagnostic) {
  return [
    "Vibe64 built the repaired merge after your repair, and it is not ready yet. Your edits remain. Repair only what still fails.",
    `Latest diagnostic:\n${diagnostic}`,
    MERGE_HANDOFF
  ].join("\n\n");
}

/**
 * The conflict the person's Merge met. Only the page saw it, so it arrives as input: untrusted text, which
 * the check hands back to the server's own review of the current heads.
 * @param {{ runtime: object, sessionId: string }} _context
 * @param {{ review?: object, conflictPaths?: string[], checkpointCommit?: string }} input
 */
async function readMergeProblem(_context, input) {
  const source = input.review && typeof input.review === "object" ? input.review : {};
  const review = Object.fromEntries(REVIEW_KEYS.map(key => [key, text(source[key]).slice(0, 200)]));
  const paths = (Array.isArray(input.conflictPaths) ? input.conflictPaths : []).map(text).filter(Boolean).slice(0, 200);
  if (!review.id || !review.activeHead || !paths.length) {
    throw new AppError(400, "Merge this contribution first, so Vibe64 knows its conflicts.", { code: "vibe64_ai_task_no_problem" });
  }
  const checkpoint = text(input.checkpointCommit).slice(0, 64);
  const details = [
    `Receiving repository: ${review.repository}; target ${review.targetBranch} at ${review.targetHead}.`,
    `Contribution vibe64-incoming/${review.id} at ${review.activeHead}.`,
    checkpoint ? `Original receiving work is preserved by checkpoint ${checkpoint}.` : "",
    `Conflicting files: ${JSON.stringify(paths)}.`
  ].filter(Boolean).join("\n");
  return {
    key: JSON.stringify(["incoming-merge", review.id, review.activeHead, review.targetHead]),
    summary: `This contribution conflicts with ${review.targetBranch || "its target"} in ${conflictCount(paths.length)}.`,
    details,
    facts: { review, conflictPaths: paths, details }
  };
}

/**
 * What the repaired merge's review says about the task.
 * @param {string} target
 * @param {{ ok?: boolean, status?: string, code?: string, error?: string, diff?: { content?: string } }} result
 * @returns {AiTaskCheckResult}
 */
function mergeCheckResult(target, result) {
  const code = text(result?.code);
  if (result?.ok !== false) {
    if (result?.status === "merged") return { passed: true, message: "This contribution is already merged." };
    if (CONFLICT_MARKER.test(String(result?.diff?.content || ""))) {
      const diagnostic = "The repaired files still contain conflict markers.";
      return { passed: false, message: diagnostic, retryKey: JSON.stringify(["markers"]), diagnostic };
    }
    return { passed: true, message: `The repaired merge is ready for your review. Check it, then choose Merge into ${target}.` };
  }
  if (RESOLVED_CODES.includes(code)) return { passed: true, message: `This contribution merges cleanly now. Choose Merge into ${target}.` };
  const error = text(result.error) || "The repaired merge could not be built.";
  const person = PERSON_MESSAGES[code];
  return {
    passed: false,
    message: person || `The repaired merge still needs attention: ${error}`,
    retryKey: person ? "" : JSON.stringify([code, error]),
    diagnostic: error
  };
}

function mergeBrief(problem) {
  return [
    "Help resolve this Vibe64 Incoming merge conflict. Inspect the current session and the reviewed commits, preserve all work, and do not push:",
    REPOSITORY_GIT_BOUNDARY,
    MERGE_HANDOFF,
    problem.facts.details
  ].join("\n\n");
}

function mergeContext() {
  return [REPOSITORY_GIT_BOUNDARY, MERGE_HANDOFF].join("\n\n");
}

/**
 * Fix an Incoming merge: the AI repairs the conflicting files, then Vibe64 builds the repaired merge for review.
 * Merge itself stays the person's reviewed action.
 * @param {{ sessions: SessionsService }} dependencies
 * @returns {AiTaskKind}
 */
function createIncomingMergeKind({ sessions }) {
  return Object.freeze({
    id: "incoming-merge",
    title: "Fix the incoming merge",
    noun: "fix",
    tray: "Fixing the merge…",
    routing: "fix",
    repository: true,
    busy: "An incoming merge is being fixed. Finish that first.",
    opening: "Fix this incoming merge without losing work.",
    problem: readMergeProblem,
    brief: mergeBrief,
    context: mergeContext,
    steps: ["The AI repairs the conflicting files", "Vibe64 builds the repaired merge"],
    check: {
      by: "vibe64",
      label: "Building the repaired merge…",
      output: "",
      unstoppable: "Building the merge can't be interrupted. The fix ends as soon as it finishes.",
      async run({ sessionId, taskId }, task) {
        const { review } = task.problem.facts;
        return mergeCheckResult(review.targetBranch, await sessions.changeIncomingContribution(sessionId, {
          action: "review-repair",
          aiTaskId: taskId,
          id: review.id,
          review,
          vibe64User: task.startedBy
        }));
      },
      retry: {
        limit: 3,
        display: "Continue repairing the conflicting files.",
        message: mergeRetryMessage
      }
    },
    done: "The repaired merge is ready for your review."
  });
}

export {
  createIncomingMergeKind,
  mergeCheckResult
};
