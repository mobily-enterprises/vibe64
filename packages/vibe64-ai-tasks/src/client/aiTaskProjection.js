import { AI_TASK_PHASES as PHASES, AI_TASK_REASONS as REASONS, aiTaskEnded } from "../shared/aiTaskPhases.js";
import { AI_TASK_MESSAGES as WORDS } from "./aiTaskMessages.js";

/** @typedef {import("./types.js").AiTask} AiTask */
/** @typedef {import("./types.js").AiTaskAction} AiTaskAction */
/** @typedef {import("./types.js").AiTaskProjection} AiTaskProjection */
/** @typedef {import("./types.js").AiTaskStep} AiTaskStep */

const AI_TASK_ACTIONS = Object.freeze({
  AI_SETUP: "ai-setup",
  ANSWER: "answer",
  CHECK: "check",
  CONTINUE: "continue",
  END: "end",
  FINISH: "finish",
  OPEN_CHAT: "open-chat",
  REVIEW: "review",
  RUN_NOW: "run-now",
  WAIT_FOR_AI: "wait-for-ai"
});

const action = (id, label, primary = false) => Object.freeze({ id, label, primary });
const OPEN_CHAT = action(AI_TASK_ACTIONS.OPEN_CHAT, WORDS.actions.openChat);
const CHECK_NOW = action(AI_TASK_ACTIONS.CHECK, WORDS.actions.checkNow, true);
const CONTINUE = action(AI_TASK_ACTIONS.CONTINUE, WORDS.actions.continue, true);

// What each reason for needing the person says and offers. `chat` opens the conversation first
// and `check` marks the step that stopped. The status lines are the words of the design's table.
const NEEDS_YOU = Object.freeze({
  [REASONS.QUESTION]: {
    status: WORDS.status.question,
    chat: true,
    dot: true,
    actions: [action(AI_TASK_ACTIONS.ANSWER, WORDS.actions.answer, true)]
  },
  [REASONS.YOUR_TURN]: {
    glyph: "turn",
    status: WORDS.status.yourTurn,
    tray: WORDS.tray.yourTurn,
    chat: true,
    dot: true,
    actions: [action(AI_TASK_ACTIONS.FINISH, WORDS.actions.finish, true)]
  },
  [REASONS.AI_STUCK]: {
    status: WORDS.status.aiStuck,
    chat: true,
    actions: [action(AI_TASK_ACTIONS.END, WORDS.actions.endNotDone), action(AI_TASK_ACTIONS.OPEN_CHAT, WORDS.actions.openChat, true)]
  },
  [REASONS.CHECK_STUCK]: { check: true, diagnostic: true, actions: [OPEN_CHAT, CHECK_NOW] },
  [REASONS.NO_RESULT]: { status: WORDS.status.noResult, actions: [OPEN_CHAT, CHECK_NOW] },
  [REASONS.STOPPED]: { status: WORDS.status.stopped, actions: [OPEN_CHAT, CONTINUE] },
  [REASONS.AI_UNAVAILABLE]: {
    status: WORDS.status.aiUnavailable,
    note: WORDS.progress.unavailable,
    actions: [action(AI_TASK_ACTIONS.AI_SETUP, WORDS.actions.aiSetup), CONTINUE]
  },
  [REASONS.TURN_FAILED]: { status: WORDS.status.turnFailed, actions: [OPEN_CHAT, CONTINUE] },
  [REASONS.INTERRUPTED]: { status: WORDS.status.interrupted, actions: [CONTINUE] },
  [REASONS.UNCONFIRMED]: { status: WORDS.status.unconfirmed, check: true, actions: [CHECK_NOW] },
  [REASONS.DRAFT_WAITING]: {
    status: WORDS.status.draftWaiting,
    chat: true,
    check: true,
    diagnostic: true,
    actions: [action(AI_TASK_ACTIONS.OPEN_CHAT, WORDS.actions.openChat, true)]
  }
});

/**
 * The steps as the task stands. A step left unfinished by a stop stays where it stopped.
 * @param {AiTask} task
 * @param {{ check?: boolean } | null} needs
 * @returns {AiTaskStep[]}
 */
function stepsOf(task, needs) {
  const [work, check] = task.steps;
  const counted = task.check.retryLimit > 0 ? WORDS.attempt(task.attempt, task.check.retryLimit) : "";
  const ended = aiTaskEnded(task);
  const atCheck = task.phase === PHASES.CHECKING || task.checkRunning || needs?.check === true;
  const passed = task.phase === PHASES.DONE;
  const workState = passed || atCheck ? "done" : ended ? "failed" : "active";
  const checkState = passed ? "done" : needs?.check || ended && atCheck ? "failed" : atCheck ? "active" : "pending";
  const steps = [{ label: work, state: workState, attempt: workState === "active" ? counted : "" }];
  if (check) steps.push({ label: check, state: checkState, attempt: atCheck && !ended ? counted : "" });
  return steps;
}

/**
 * @param {AiTask} task
 * @param {string} viewerId
 */
function endedMessage(task, viewerId) {
  if (task.message) return task.message;
  const by = task.endedBy;
  return by?.name && by.id !== viewerId ? WORDS.cancelledBy(by.name, task.noun) : WORDS.cancelledByYou(task.noun);
}

/**
 * @param {AiTask} task
 * @param {string} viewerId
 */
function outcomeOf(task, viewerId) {
  if (task.phase === PHASES.DONE) {
    return { heading: WORDS.outcome.done, happened: task.message, report: task.report, next: "" };
  }
  return { heading: WORDS.outcome.notDone, happened: endedMessage(task, viewerId), report: "", next: WORDS.whatsNext() };
}

/**
 * The step a running check last reported, while it runs.
 * @param {AiTask} task
 */
function checkStep(task) {
  return task.phase === PHASES.CHECKING && !task.waiting && task.progress?.step ? task.progress : null;
}

/** @param {AiTask} task */
function runningStatus(task) {
  if (task.phase === PHASES.STARTING) return WORDS.status.starting;
  if (task.phase === PHASES.CANCELLING) return WORDS.status.cancelling;
  if (task.phase === PHASES.CHECKING) return task.waiting ? task.message : checkStep(task)?.step || task.check.label;
  return task.attempt > 1 ? WORDS.retrying(task.attempt, task.check.retryLimit) : WORDS.status.working;
}

/**
 * What the words under the steps say. A stop's own explanation sits there, so the status line
 * stays one short sentence.
 * @param {AiTask} task
 * @param {object | null} needs
 */
function noteOf(task, needs) {
  if (task.phase === PHASES.CANCELLING) return task.checkRunning ? task.check.unstoppable : "";
  if (!needs) return "";
  const said = needs.status && task.message !== needs.status ? task.message : "";
  const diagnostic = needs.diagnostic && !task.message.includes(task.diagnostic) ? task.diagnostic : "";
  return [said, diagnostic, needs.note].filter(Boolean).join(" ");
}

/**
 * Everything the window shows for a task. The server decides what state a task is in; this only
 * puts that state into words.
 * @param {AiTask} task
 * @param {{ viewerId: string }} viewer
 * @returns {AiTaskProjection}
 */
function projectAiTask(task, { viewerId }) {
  const ended = aiTaskEnded(task);
  const needs = task.phase === PHASES.NEEDS_YOU ? NEEDS_YOU[task.reason] : null;
  // A check waiting for the main chat's AI says since when, and offers to run now.
  const whileAiWorks = task.phase === PHASES.CHECKING && task.waiting && task.mainChatSince
    ? task.check.whileAiWorks : null;
  const review = needs?.check && task.reason === REASONS.CHECK_STUCK && task.conflictReview
    ? [action(AI_TASK_ACTIONS.REVIEW, WORDS.actions.review)]
    : [];
  const done = task.phase === PHASES.DONE;
  const running = !ended && !needs;
  const step = checkStep(task);
  return {
    glyph: done ? "done" : ended ? "not-done" : needs ? needs.glyph || "attention" : "working",
    status: done ? WORDS.outcome.done : ended ? WORDS.outcome.notDone : needs ? needs.status || task.message : runningStatus(task),
    tray: done ? WORDS.tray.done : ended ? WORDS.tray.notDone : task.phase === PHASES.CANCELLING
      ? WORDS.tray.cancelling : needs ? needs.tray || WORDS.tray.needsYou : task.tray,
    ended,
    chatDot: needs?.dot === true,
    opensOn: needs?.chat ? "chat" : "progress",
    composerOpen: Boolean(needs) || task.phase === PHASES.WORKING,
    composerHint: task.reason === REASONS.QUESTION ? WORDS.chat.answer : WORDS.chat.message,
    note: whileAiWorks ? `${WORDS.mainChatSince(aiTaskTime(task.mainChatSince))} ${whileAiWorks.note}`
      : running && task.phase !== PHASES.CANCELLING ? "" : noteOf(task, needs),
    steps: stepsOf(task, needs),
    actions: needs ? [...review, ...needs.actions] : whileAiWorks
      ? [action(AI_TASK_ACTIONS.WAIT_FOR_AI, WORDS.actions.waitForAi), action(AI_TASK_ACTIONS.RUN_NOW, whileAiWorks.action, true)]
      : [],
    cancelQuestion: WORDS.cancelQuestion(task.noun),
    outcome: ended ? outcomeOf(task, viewerId) : null,
    progress: step ? { since: step.since, output: step.output } : null
  };
}

/**
 * The footer's actions in a view. Answer and Open chat only lead to Chat, so they go once the person is there.
 * @param {AiTaskProjection["actions"]} actions
 * @param {"progress"|"chat"} view
 */
function aiTaskFooterActions(actions, view) {
  if (view !== "chat") return actions;
  return actions.filter(({ id }) => id !== AI_TASK_ACTIONS.ANSWER && id !== AI_TASK_ACTIONS.OPEN_CHAT);
}

/**
 * The time beside an activity line.
 * @param {string} at
 */
function aiTaskTime(at) {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export {
  AI_TASK_ACTIONS,
  aiTaskFooterActions,
  aiTaskTime,
  projectAiTask
};
