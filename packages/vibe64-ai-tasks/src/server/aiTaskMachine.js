import {
  AI_TASK_ACTIVE_PHASES,
  AI_TASK_CHECKERS,
  AI_TASK_PHASES as PHASES,
  AI_TASK_REASONS as REASONS,
  aiTaskEnded
} from "../shared/aiTaskPhases.js";

/** @typedef {import("./types.js").AiTask} AiTask */
/** @typedef {import("./types.js").AiTaskEvent} AiTaskEvent */
/** @typedef {import("./types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("./types.js").AiTaskPending} AiTaskPending */

const LOG_LIMIT = 50;
const CONTINUE_MESSAGE = "Continue working on this task from where you stopped.";
const CONTINUE_DISPLAY = "Continue.";
const LATE_FINISH_MESSAGE = "This finished before the cancel took effect.";
const PERSON_FINISHED_MESSAGE = "You finished this task.";
const ARCHIVED_MESSAGE = "The session was archived before this finished.";

/**
 * A new task, still `starting`, with its opening message owed to the AI. A kind with no opening message, such as
 * a Colleague review that waits for its first request, starts at `needs_you(your_turn)` instead.
 * @param {object} input
 * @param {AiTaskKind} input.kind
 * @param {import("./types.js").AiTaskProblem} input.problem
 * @param {object} input.taskInput what the starter passed; untrusted text
 * @param {object | null} input.startedBy
 * @param {string} input.at
 * @param {string} input.sendId the stable id of the opening message
 * @returns {AiTask}
 */
function createAiTask({ kind, problem, taskInput, startedBy, at, sendId }) {
  const { check } = kind;
  const brief = kind.brief(problem);
  return {
    kind: kind.id,
    title: problem.title || kind.title,
    noun: problem.noun || kind.noun,
    tray: kind.tray,
    steps: [...kind.steps],
    check: {
      by: check.by,
      label: check.by === AI_TASK_CHECKERS.VIBE64 ? check.label : "",
      retryLimit: check.by === AI_TASK_CHECKERS.VIBE64 ? check.retry.limit : 0,
      output: check.output || "",
      unstoppable: check.unstoppable || "",
      whileAiWorks: check.whileAiWorks || null
    },
    turn: {
      context: kind.context(problem),
      routing: kind.routing,
      structured: check.by !== AI_TASK_CHECKERS.PERSON,
      updateRepair: kind.updateRepair === true
    },
    doneMessage: kind.done,
    repository: kind.repository === true,
    revision: 0,
    phase: brief ? PHASES.STARTING : PHASES.NEEDS_YOU,
    active: Boolean(brief),
    reason: brief ? "" : REASONS.YOUR_TURN,
    message: "",
    waiting: false,
    mainChatSince: "",
    progress: null,
    problem,
    input: taskInput,
    startedBy,
    attempt: 1,
    diagnostic: "",
    retryKeys: [],
    report: "",
    pending: brief ? { effect: "send", id: sendId, message: brief, display: problem.opening || kind.opening } : null,
    turnMessageId: brief ? sendId : "",
    log: [{ at, text: "Vibe64 started this task." }],
    endedBy: null,
    endedAt: ""
  };
}

/**
 * @param {AiTask} task
 * @param {Partial<AiTask>} patch
 * @param {AiTaskEvent} event
 * @param {string} logText
 * @returns {AiTask}
 */
function moved(task, patch, event, logText) {
  const next = { ...task, ...patch, revision: task.revision + 1 };
  next.active = AI_TASK_ACTIVE_PHASES.includes(next.phase);
  // A step describes the check running now: a wait, a new run of the check or any other phase ends it.
  if (next.progress && (next.phase !== PHASES.CHECKING || next.waiting || next.pending !== task.pending)) next.progress = null;
  next.log = logText ? [...task.log, { at: event.at, text: logText }].slice(-LOG_LIMIT) : task.log;
  return next;
}

/** @type {(task: AiTask, reason: string, event: AiTaskEvent, message: string, logText: string) => AiTask} */
function needsYou(task, reason, event, message, logText) {
  return moved(task, {
    phase: PHASES.NEEDS_YOU,
    reason,
    message,
    waiting: false,
    pending: null
  }, event, logText);
}

/** @type {(task: AiTask, event: AiTaskEvent, message: string, logText: string) => AiTask} */
function done(task, event, message, logText) {
  return moved(task, {
    phase: PHASES.DONE,
    reason: "",
    message,
    waiting: false,
    pending: null,
    endedBy: event.by || null,
    endedAt: event.at
  }, event, logText);
}

/** @type {(task: AiTask, reason: string, event: AiTaskEvent, message: string, logText: string) => AiTask} */
function notDone(task, reason, event, message, logText) {
  return moved(task, {
    phase: PHASES.NOT_DONE,
    reason,
    message,
    waiting: false,
    pending: null,
    endedBy: event.by || task.cancelledBy || null,
    endedAt: event.at
  }, event, logText);
}

/**
 * A check owed now. `whileAiWorks` runs it although the main chat's AI is working, as the person chose.
 * @type {(task: AiTask, event: AiTaskEvent, reviewedConflictId: string, retryAi: boolean, whileAiWorks?: boolean) => AiTask}
 */
function checking(task, event, reviewedConflictId, retryAi, whileAiWorks = false) {
  return moved(task, {
    phase: PHASES.CHECKING,
    reason: "",
    message: "",
    waiting: false,
    pending: { effect: "check", id: event.id, reviewedConflictId, retryAi, ...(whileAiWorks ? { whileAiWorks } : {}) }
  }, event, task.check.label);
}

/** What ends a task the person gave up on says why, in the words the outcome shows. */
function cancelledMessage(task) {
  if (task.reason === REASONS.AI_STUCK) return `The AI could not fix this: ${task.message}`;
  if (task.reason === REASONS.CHECK_STUCK) return `${task.message} You ended the ${task.noun}.`;
  return "";
}

/**
 * Cancel always ends what can end now; a turn or a check still running makes it
 * wait in `cancelling`. The runner stops a running check that can stop; either way the
 * check's answer settles the task: a run that stopped ends it Not done, one that finished first Done.
 * @param {AiTask} task
 * @param {AiTaskEvent} event
 */
function cancel(task, event) {
  if (task.phase === PHASES.CANCELLING) return task;
  const checkRunning = task.phase === PHASES.CHECKING && !task.waiting;
  if (task.phase === PHASES.NEEDS_YOU || task.phase === PHASES.CHECKING && task.waiting) {
    return notDone(task, REASONS.CANCELLED, event, cancelledMessage(task), "The task was cancelled.");
  }
  return moved(task, {
    phase: PHASES.CANCELLING,
    cancelledBy: event.by || null,
    pending: checkRunning ? task.pending : { effect: "interrupt", id: event.id }
  }, event, "Cancelling.");
}

/** A turn's end in `working`, by what it reported. */
function turnResult(task, event) {
  const { kind, message, report } = event;
  if (kind === "question") return needsYou(task, REASONS.QUESTION, event, message, "The AI asked a question.");
  if (kind === "cannot") return needsYou(task, REASONS.AI_STUCK, event, message, "The AI said it could not finish this.");
  const reported = { ...task, report: report || task.report };
  if (task.check.by === AI_TASK_CHECKERS.VIBE64) return checking(reported, event, "", true);
  if (task.check.by === AI_TASK_CHECKERS.AGENT) return done(reported, event, task.doneMessage, "The AI finished this task.");
  return needsYou(reported, REASONS.YOUR_TURN, event, "", "The AI finished its turn.");
}

/**
 * The running check names the step it is on, since when and what that step last printed. A step reported without a
 * start started now, or when the same step was first reported. A check that reports is running, so a wait it
 * reported before is over. Viewers hear of it; the Activity log does not.
 */
function checkProgress(task, event) {
  const same = task.progress?.step === event.step;
  const progress = {
    step: event.step,
    since: event.since || (same ? task.progress.since : event.at),
    output: event.output || ""
  };
  if (!task.waiting && same && progress.since === task.progress.since && progress.output === task.progress.output) return task;
  return moved(task, { waiting: false, message: "", mainChatSince: "", progress }, event, "");
}

/** The task's own check failed: back to the AI when it can repair this, otherwise to the person. */
function checkFailed(task, event) {
  const { message, diagnostic, retryKey, retryMessage, retryDisplay, hasDraft, sendId, facts } = event;
  const tried = !task.pending.retryAi || !retryKey || task.retryKeys.includes(retryKey) ||
    task.attempt >= task.check.retryLimit;
  const seen = { ...task, diagnostic, problem: { ...task.problem, facts: { ...task.problem.facts, ...facts } } };
  if (tried) return needsYou(seen, REASONS.CHECK_STUCK, event, message, message);
  if (hasDraft) return needsYou(seen, REASONS.DRAFT_WAITING, event, message, message);
  return moved(seen, {
    phase: PHASES.WORKING,
    reason: "",
    message,
    waiting: false,
    attempt: task.attempt + 1,
    retryKeys: [...task.retryKeys, retryKey],
    turnMessageId: sendId,
    pending: { effect: "send", id: sendId, message: retryMessage, display: retryDisplay }
  }, event, `${message} Sent back to the AI.`);
}

/** A turn or send's end in `starting` or `working`. */
function fromTurn(task, event) {
  switch (event.type) {
    case "turn_admitted":
      return moved(task, { phase: PHASES.WORKING, pending: null }, event, task.phase === PHASES.STARTING ? "The AI started." : "");
    case "turn_unavailable":
      return needsYou(task, REASONS.AI_UNAVAILABLE, event, event.message, "The AI account could not run this.");
    case "turn_failed":
      return needsYou(task, REASONS.TURN_FAILED, event, event.message, "The AI ran into an error.");
    case "turn_lost":
      return needsYou(task, REASONS.INTERRUPTED, event, "", "Vibe64 restarted while the AI was working.");
    default:
      return task;
  }
}

/** The events of `working` beyond those a starting turn shares. */
function fromWorking(task, event) {
  switch (event.type) {
    case "turn_result":
      return turnResult(task, event);
    case "turn_ended":
      return task.check.by === AI_TASK_CHECKERS.PERSON
        ? needsYou(task, REASONS.YOUR_TURN, event, "", "The AI finished its turn.")
        : needsYou(task, REASONS.NO_RESULT, event, "", "The AI stopped without saying it finished.");
    case "turn_stopped":
      return needsYou(task, REASONS.STOPPED, event, "", "The turn was stopped.");
    default:
      return fromTurn(task, event);
  }
}

function fromChecking(task, event) {
  // A check waiting for the main chat's AI runs now when the person chooses it.
  if (event.type === "check_now") {
    return task.waiting && event.whileAiWorks === true && task.check.whileAiWorks
      ? checking(task, event, task.pending.reviewedConflictId, task.pending.retryAi, true) : task;
  }
  if (event.id !== task.pending?.id) return task;
  switch (event.type) {
    case "check_passed":
      return done(task, event, event.message || task.doneMessage, "Vibe64 confirmed the result.");
    case "check_waiting":
      return moved(task, {
        waiting: true,
        message: event.message,
        mainChatSince: event.mainChatSince || ""
      }, event, task.waiting ? "" : event.message);
    case "check_progress":
      return checkProgress(task, event);
    case "check_failed":
      return checkFailed(task, event);
    case "check_unknown":
      return needsYou(task, REASONS.UNCONFIRMED, event, event.message, "Vibe64 could not confirm the result.");
    default:
      return task;
  }
}

function fromNeedsYou(task, event) {
  switch (event.type) {
    case "continue":
      return moved(task, {
        phase: PHASES.WORKING,
        reason: "",
        message: "",
        turnMessageId: event.id,
        pending: { effect: "send", id: event.id, message: CONTINUE_MESSAGE, display: CONTINUE_DISPLAY }
      }, event, "The AI is continuing.");
    case "check_now":
      return task.check.by === AI_TASK_CHECKERS.VIBE64
        ? checking(task, event, event.reviewedConflictId || "", !event.reviewedConflictId) : task;
    case "finish":
      return task.reason === REASONS.YOUR_TURN
        ? done(task, event, PERSON_FINISHED_MESSAGE, "You finished this task.") : task;
    default:
      return task;
  }
}

function fromCancelling(task, event) {
  switch (event.type) {
    case "check_passed":
      return event.id === task.pending?.id ? done(task, event, LATE_FINISH_MESSAGE, "The check passed before the cancel took effect.") : task;
    case "check_failed":
    case "check_unknown":
      return event.id === task.pending?.id ? notDone(task, REASONS.CANCELLED, event, cancelledMessage(task), "The task was cancelled.") : task;
    case "turn_stopped":
    case "turn_result":
    case "turn_ended":
    case "turn_failed":
    case "turn_unavailable":
    case "turn_lost":
    case "cancel_settled":
      return notDone(task, REASONS.CANCELLED, event, cancelledMessage(task), "The task was cancelled.");
    default:
      return task;
  }
}

/** A person's message is a new instruction: the AI's own tries start again. */
function personMessage(task, event) {
  const reset = { attempt: 1, retryKeys: [], turnMessageId: event.messageId };
  if (task.phase === PHASES.NEEDS_YOU) {
    return moved(task, { ...reset, phase: PHASES.WORKING, reason: "", message: "" }, event, "You answered the AI.");
  }
  return [PHASES.STARTING, PHASES.WORKING].includes(task.phase) ? moved(task, reset, event, "") : task;
}

/**
 * The only way a task changes: a pure step from one saved state to the next.
 * An event that does not apply leaves the task as it is, so repeating one is harmless.
 * A transition that owes work carries it in `pending`, saved in the same write.
 * @param {AiTask} task
 * @param {AiTaskEvent} event
 * @returns {{ task: AiTask, pending: AiTaskPending | null }}
 */
function advanceAiTask(task, event) {
  const next = step(task, event);
  return { task: next, pending: next.pending };
}

/**
 * @param {AiTask} task
 * @param {AiTaskEvent} event
 * @returns {AiTask}
 */
function step(task, event) {
  if (aiTaskEnded(task)) return task;
  if (event.type === "archived") return notDone(task, REASONS.ARCHIVED, event, ARCHIVED_MESSAGE, ARCHIVED_MESSAGE);
  if (event.type === "cancel") return cancel(task, event);
  if (event.type === "person_message") return personMessage(task, event);
  switch (task.phase) {
    case PHASES.STARTING:
      return fromTurn(task, event);
    case PHASES.WORKING:
      return fromWorking(task, event);
    case PHASES.CHECKING:
      return fromChecking(task, event);
    case PHASES.NEEDS_YOU:
      return fromNeedsYou(task, event);
    case PHASES.CANCELLING:
      return fromCancelling(task, event);
    default:
      return task;
  }
}

export {
  advanceAiTask,
  createAiTask
};
