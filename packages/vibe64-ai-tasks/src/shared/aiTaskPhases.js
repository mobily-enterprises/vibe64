// The states an AI task can be in. The server's machine moves a task between
// them, and the client presents them; neither invents one of its own.

const AI_TASK_PHASES = Object.freeze({
  STARTING: "starting",
  WORKING: "working",
  CHECKING: "checking",
  NEEDS_YOU: "needs_you",
  CANCELLING: "cancelling",
  DONE: "done",
  NOT_DONE: "not_done"
});

const AI_TASK_REASONS = Object.freeze({
  AI_STUCK: "ai_stuck",
  AI_UNAVAILABLE: "ai_unavailable",
  ARCHIVED: "archived",
  CANCELLED: "cancelled",
  CHECK_STUCK: "check_stuck",
  DRAFT_WAITING: "draft_waiting",
  INTERRUPTED: "interrupted",
  NO_RESULT: "no_result",
  QUESTION: "question",
  STOPPED: "stopped",
  TURN_FAILED: "turn_failed",
  UNCONFIRMED: "unconfirmed",
  YOUR_TURN: "your_turn"
});

const AI_TASK_CHECKERS = Object.freeze({
  AGENT: "agent",
  PERSON: "person",
  VIBE64: "vibe64"
});

// Something is running: renewal, replacement and dormancy wait for these.
const AI_TASK_ACTIVE_PHASES = Object.freeze([
  AI_TASK_PHASES.STARTING,
  AI_TASK_PHASES.WORKING,
  AI_TASK_PHASES.CHECKING,
  AI_TASK_PHASES.CANCELLING
]);

const AI_TASK_ENDED_PHASES = Object.freeze([AI_TASK_PHASES.DONE, AI_TASK_PHASES.NOT_DONE]);

/**
 * Whether a task has reached Done or Not done and only waits for Close.
 * @param {{ phase: string }} task
 */
function aiTaskEnded(task) {
  return AI_TASK_ENDED_PHASES.includes(task.phase);
}

export {
  AI_TASK_ACTIVE_PHASES,
  AI_TASK_CHECKERS,
  AI_TASK_ENDED_PHASES,
  AI_TASK_PHASES,
  AI_TASK_REASONS,
  aiTaskEnded
};
