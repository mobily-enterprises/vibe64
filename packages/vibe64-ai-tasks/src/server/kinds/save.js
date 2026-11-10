import { AppError } from "@jskit-ai/kernel/server/runtime";
import { SESSION_SAVE_TASK_ID } from "@local/vibe64-core/shared";
import { REPOSITORY_GIT_BOUNDARY } from "./repository.js";

/** @typedef {import("../types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("../types.js").AiTaskCheckResult} AiTaskCheckResult */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

const SAVE_HANDOFF = [
  "Repair only what stops Save, preserving the session's intended changes. Return kind=complete with a factual report as soon as the edits and focused checks are ready. Vibe64 then runs Save itself, which pushes this session's work, and returns any new Save problem to this same conversation.",
  "Return kind=question only when you need an actual user decision, and ask that specific question. Return kind=cannot only when this cannot be repaired, and say why. Do not tell the user to retry Save."
].join("\n");

const SAVE_SUCCEEDED_MESSAGE = "Session saved. Your work was pushed.";
const SAVE_WAITING_MESSAGE = "Save waits for another change to this session to finish";
const MAIN_CHAT_WAITING_MESSAGE = "Save waits for the main chat's AI to finish";
const WAITING_CODES = Object.freeze(["vibe64_agent_write_mode_busy"]);
// Save refused for a reason only a person can settle. The AI is not asked again.
const PERSON_MESSAGES = Object.freeze({
  vibe64_session_repository_review_changed: "Save needs your review of where it goes. Choose Save, review it, then Check now.",
  vibe64_session_save_update_required: "Save needs Update first. Cancel this fix, then update the session.",
  vibe64_session_save_no_changes: "Save found nothing to save. Check the session's changes."
});

function saveRetryMessage(diagnostic) {
  return [
    "Vibe64 ran Save after your repair, but it did not succeed. Your edits remain. Inspect the current state and repair only what still stops Save; do not start over or repeat completed work.",
    `Latest Save diagnostic:\n${diagnostic}`,
    SAVE_HANDOFF
  ].join("\n\n");
}

/**
 * Save's saved failure is the problem.
 * @param {{ runtime: object, sessionId: string }} context
 */
async function readSaveProblem({ runtime, sessionId }) {
  const failure = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
  if (failure?.status !== "failed") {
    throw new AppError(409, "Save has no problem to fix right now.", { code: "vibe64_ai_task_no_problem" });
  }
  const error = String(failure.error || "Save did not finish.");
  return {
    key: JSON.stringify(["save", failure.code || "", failure.operationId || error]),
    summary: error.split("\n")[0],
    details: error,
    facts: { code: failure.code || "", error }
  };
}

/**
 * What Save's answer means for its task.
 * @param {{ ok?: boolean, code?: string, error?: string }} result
 * @returns {AiTaskCheckResult}
 */
function saveCheckResult(result) {
  if (result?.ok !== false) return { passed: true, message: SAVE_SUCCEEDED_MESSAGE };
  const code = String(result.code || "");
  if (WAITING_CODES.includes(code)) return { waiting: true, message: SAVE_WAITING_MESSAGE };
  const error = String(result.error || "Save failed.");
  const person = PERSON_MESSAGES[code];
  return {
    passed: false,
    message: person || `Save still needs attention: ${error}`,
    retryKey: person ? "" : JSON.stringify([code, error]),
    diagnostic: error
  };
}

/**
 * Save as a task's check runs it, after the AI's repair: while the main chat's AI is working it waits, since Save
 * would include its unfinished changes, unless the person chose to run the check now. A host's kind that saves the
 * session's work before its own step runs this same Save.
 * @param {{ sessions: SessionsService, terminals: TerminalsService }} dependencies
 */
function createAiTaskSave({ sessions, terminals }) {
  /**
   * @param {{ runtime: object, sessionId: string, taskId: string }} context
   * @param {import("../types.js").AiTask} task
   * @param {{ destination?: object }} work what `sessions.inspectSessionWork` answered
   * @returns {Promise<AiTaskCheckResult>}
   */
  return async function saveForAiTask({ runtime, sessionId, taskId }, task, work) {
    if (!task.pending?.whileAiWorks) {
      // The chat's own working indicator reads this same turn; between the turns of a workflow such as Auto's
      // review the AI is still at work, and the wait then names when it began.
      const session = await runtime.getSessionWithoutSource(sessionId);
      const { turn } = await terminals.agentSessionState(sessionId, { runtime, session }) || {};
      if (turn?.active === true || terminals.sessionAssistantWorking(session)) {
        const since = turn?.active === true && turn.startedAt || task.mainChatSince || new Date().toISOString();
        return { waiting: true, message: MAIN_CHAT_WAITING_MESSAGE, mainChatSince: String(since) };
      }
    }
    return saveCheckResult(await sessions.saveSessionWork(sessionId, {
      aiTaskId: taskId,
      destinationReview: work.destination,
      vibe64User: task.startedBy
    }));
  };
}

function saveBrief(problem) {
  return [
    "Help resolve this Vibe64 Save problem. Inspect the current session and canonical repository state and preserve all work:",
    REPOSITORY_GIT_BOUNDARY,
    SAVE_HANDOFF,
    problem.facts.error
  ].join("\n\n");
}

function saveContext() {
  return [REPOSITORY_GIT_BOUNDARY, SAVE_HANDOFF].join("\n\n");
}

/**
 * Fix Save: the AI repairs what stopped Save, then Vibe64 runs Save itself to the destination the session
 * has now. Work a person saved meanwhile counts: nothing left to save means Save succeeded. While the main chat's
 * AI is working, Save waits for it to finish, since Save would include its unfinished changes; the person can
 * choose Save now instead.
 * @param {{ sessions: SessionsService, terminals: TerminalsService }} dependencies
 * @returns {AiTaskKind}
 */
function createSaveKind({ sessions, terminals }) {
  const saveForAiTask = createAiTaskSave({ sessions, terminals });
  return Object.freeze({
    id: "save",
    title: "Fix Save",
    noun: "fix",
    tray: "Fixing Save…",
    routing: "fix",
    repository: true,
    busy: "Save is being fixed. Finish that first.",
    opening: "Fix this Save problem without losing work.",
    problem: readSaveProblem,
    brief: saveBrief,
    context: saveContext,
    steps: ["The AI repairs what stopped Save", "Vibe64 runs Save"],
    check: {
      by: "vibe64",
      label: "Running Save…",
      output: "Save output",
      unstoppable: "Save can't be interrupted. The fix ends as soon as this run finishes.",
      whileAiWorks: {
        action: "Save now",
        note: "Vibe64 saves as soon as it finishes. Save now includes its unfinished changes."
      },
      async run(context, task) {
        const { runtime, sessionId } = context;
        const [work, saved] = await Promise.all([
          sessions.inspectSessionWork(sessionId, {}),
          runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID)
        ]);
        if (work?.ok === false) return saveCheckResult(work);
        if (!work.unsaved && saved?.status === "ready") return saveCheckResult({ ok: true });
        return saveForAiTask(context, task, work);
      },
      retry: {
        limit: 3,
        display: "Continue repairing what stops Save.",
        message: saveRetryMessage
      }
    },
    done: SAVE_SUCCEEDED_MESSAGE
  });
}

export {
  createAiTaskSave,
  createSaveKind,
  saveCheckResult
};
