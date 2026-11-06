import { AppError } from "@jskit-ai/kernel/server/runtime";
import { AI_TASK_PHASES, AI_TASK_REASONS, aiTaskEnded } from "../shared/aiTaskPhases.js";

/** @typedef {import("./types.js").AiTasksService} AiTasksService */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-pages/server/types").PageRefreshTasks} PageRefreshTasks */

/**
 * How a refresh's task stands, in the words the pages scheduler follows.
 * @param {object} task as presented
 */
function refreshTaskState(task) {
  return {
    id: task.id,
    ended: aiTaskEnded(task),
    done: task.phase === AI_TASK_PHASES.DONE,
    needsYou: task.phase === AI_TASK_PHASES.NEEDS_YOU,
    unavailable: task.reason === AI_TASK_REASONS.AI_UNAVAILABLE,
    cancelled: task.reason === AI_TASK_REASONS.CANCELLED,
    message: String(task.message || ""),
    log: task.log || []
  };
}

/**
 * A prompt refresh as an AI task of the session it was set from, for the pages scheduler. It
 * starts only in an open session and, like every task, waits for none that is open there. It
 * starts with no person, as a task the local person starts from the browser does: the stored
 * scheduler is a name and id without a role, and routing a role-less person treats them as a
 * team member. A host that signs people in starts it as the scheduler instead.
 * @param {{ aiTasks: AiTasksService, project: ProjectService }} dependencies
 * @returns {PageRefreshTasks}
 */
function createPageRefreshTasks({ aiTasks, project }) {
  async function start(sessionId, input) {
    const runtime = await project.createRuntimeWithoutSource();
    const open = await runtime.listSessionSummaries({ statusGroup: "open" });
    if (!open.some((session) => session.sessionId === sessionId)) {
      throw new AppError(409, "The session that runs this refresh is no longer open.", { code: "vibe64_ai_task_session_closed" });
    }
    const { task } = await aiTasks.start(sessionId, { kind: "page-refresh", input });
    return refreshTaskState(task);
  }

  /** The task as it stands, or null once it has been closed. */
  async function read(sessionId, taskId) {
    try {
      return refreshTaskState((await aiTasks.read(sessionId, { taskId })).task);
    } catch (error) {
      if (error?.code === "vibe64_ai_task_closed") return null;
      throw error;
    }
  }

  async function cancel(sessionId, taskId) {
    await aiTasks.cancel(sessionId, { taskId });
  }

  async function close(sessionId, taskId) {
    await aiTasks.close(sessionId, { taskId });
  }

  return Object.freeze({
    cancel,
    close,
    read,
    start
  });
}

export { createPageRefreshTasks };
