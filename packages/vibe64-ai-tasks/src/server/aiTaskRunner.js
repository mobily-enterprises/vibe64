import { randomUUID } from "node:crypto";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { outsideSessionLocks } from "@local/vibe64-runtime/server/sessionStoreLocks";
import { AI_TASK_PHASES } from "../shared/aiTaskPhases.js";
import { advanceAiTask } from "./aiTaskMachine.js";

/** @typedef {import("./types.js").AiTask} AiTask */
/** @typedef {import("./types.js").AiTaskEvent} AiTaskEvent */
/** @typedef {import("./types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

const RUNNING_TURN_STATUSES = Object.freeze(["starting", "inProgress"]);
const STOPPED_TURN_STATUSES = Object.freeze(["interrupted", "cancelled"]);
const WRITE_BUSY_CODE = "vibe64_agent_write_mode_busy";
// Failures a person can fix in AI setup, not in this chat.
const UNAVAILABLE_FAILURE = /\b(401|403|unauthori[sz]ed|authentication|credentials?|api key|log(?:ged|ging)? ?in|sign(?:ed|ing)? ?in|quota|model)\b/iu;

/**
 * The event for a turn or send that failed.
 * @param {string} message
 */
function failedTurn(message) {
  const text = message || "The AI turn failed.";
  return { type: UNAVAILABLE_FAILURE.test(text) ? "turn_unavailable" : "turn_failed", message: text };
}

/**
 * What a read of the task's turn means. Null while it runs, or before the
 * task's own message reached the AI.
 * @param {AiTask} task
 * @param {{ status: string, messageId: string, outcome: object | null, error: string, readError: boolean, routingPending: boolean }} turn
 * @param {boolean} restarted whether a previous server left this task
 */
function turnEvent(task, turn, restarted) {
  const lost = restarted ? { type: "turn_lost" } : null;
  if (turn.readError) return lost;
  if (RUNNING_TURN_STATUSES.includes(turn.status) || turn.routingPending) return null;
  if (turn.messageId !== task.turnMessageId || turn.status === "ready") return lost;
  if (STOPPED_TURN_STATUSES.includes(turn.status)) return restarted ? lost : { type: "turn_stopped" };
  if (turn.status === "failed") return failedTurn(turn.error);
  if (!turn.outcome) return { type: "turn_ended" };
  const { kind, message, report } = turn.outcome;
  return {
    type: "turn_result",
    id: randomUUID(),
    // Main's "continue" from an older prompt asks the person, as a question does.
    kind: kind === "continue" ? "question" : kind,
    message,
    report
  };
}

/**
 * What a check's answer means. A check that could not answer is unknown, never a failure.
 * @param {AiTaskKind} kind
 * @param {string} id
 * @param {import("./types.js").AiTaskCheckResult | { unknown: true, message: string }} result
 * @param {object} record the conversation as saved now
 */
function checkEvent(kind, id, result, record) {
  if (result.unknown) return { type: "check_unknown", id, message: "Vibe64 couldn't confirm the result" };
  if (result.waiting) return { type: "check_waiting", id, message: result.message };
  if (result.passed) return { type: "check_passed", id, message: result.message };
  const { retry } = kind.check;
  return {
    type: "check_failed",
    id,
    message: result.message,
    diagnostic: result.diagnostic,
    retryKey: result.retryKey,
    retryMessage: retry.message(result.diagnostic),
    retryDisplay: retry.display,
    sendId: randomUUID(),
    hasDraft: Boolean(String(record.draft || "").trim() || record.attachments?.length),
    facts: result.facts
  };
}

/**
 * The only code with side effects. Every effect a task owes is saved in `pending` by the
 * transition that owes it, so this performs what the record says, and a restart performs it
 * again: sends reuse their message id, checks their request id. Effects run one at a time per
 * session, outside every session lock, so Cancel's short record write never waits for a check.
 * @param {object} dependencies
 * @param {Record<string, AiTaskKind>} dependencies.kinds
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {TerminalsService} dependencies.terminals
 * @param {(record: object) => object} dependencies.present
 * @param {number} [dependencies.writeBusyRetryMs]
 * @param {number} [dependencies.waitingRecheckMs]
 */
function createAiTaskRunner({
  kinds,
  logger,
  project,
  publishSessionChanged,
  terminals,
  present,
  writeBusyRetryMs = 2_000,
  waitingRecheckMs = 30_000
}) {
  const drives = new Map();
  const timers = new Map();
  // Tasks this server has seen: an unseen one in `working` was left by a previous server.
  const seenTasks = new Set();
  let closed = false;

  /**
   * Moves a task by one event in one short record write, and tells its viewers.
   * @param {string} sessionId
   * @param {string} taskId
   * @param {Omit<AiTaskEvent, "at">} event
   * @returns {Promise<object | null>} the conversation as saved; null once closed
   */
  async function apply(sessionId, taskId, event) {
    const { store } = await project.createRuntimeWithoutSource();
    let changed = false;
    const record = await store.mutateSession(sessionId, async () => {
      const current = await store.readSessionConversation(sessionId, taskId);
      if (!current?.task) return null;
      const { task } = advanceAiTask(current.task, { at: new Date().toISOString(), ...event });
      if (task === current.task) return current;
      changed = true;
      return store.writeSessionConversation(sessionId, taskId, { task });
    });
    if (changed) await publishSessionChanged(sessionId, { reason: "ai-task-changed", payload: { aiTask: present(record) } });
    return record;
  }

  function warn(sessionId, event, error, message) {
    logOperationalEvent(logger, "warn", {
      component: "vibe64.ai_tasks",
      event: `vibe64.ai_tasks.${event}`,
      sessionId,
      code: error?.code,
      error: error?.message
    }, message);
  }

  function wakeLater(sessionId, delayMs) {
    if (closed || timers.has(sessionId)) return;
    const timer = setTimeout(() => {
      timers.delete(sessionId);
      void wake(sessionId);
    }, delayMs);
    timer.unref();
    timers.set(sessionId, timer);
  }

  async function send(sessionId, record, drive) {
    const { conversationId, task } = record;
    const { pending } = task;
    let event = { type: "turn_admitted" };
    try {
      const sent = await terminals.startTemporaryConversationTurn(sessionId, {
        conversationId,
        messageId: pending.id,
        message: pending.message,
        displayMessage: pending.display,
        promptLabel: task.title,
        vibe64User: task.startedBy
      });
      if (sent?.ok === false) event = failedTurn(sent.error);
    } catch (error) {
      event = failedTurn(error?.message);
    }
    await apply(sessionId, conversationId, event);
    drive.again = true;
  }

  async function interrupt(sessionId, record, drive) {
    const { conversationId } = record;
    await terminals.stopTemporaryConversation(sessionId, { conversationId }).catch((error) => {
      warn(sessionId, "interrupt_failed", error, "An AI task's turn could not be stopped; the task ends anyway.");
    });
    await apply(sessionId, conversationId, { type: "turn_stopped" });
    drive.again = true;
  }

  async function check(sessionId, record, drive) {
    const { conversationId, task } = record;
    const kind = kinds[task.kind];
    const { id } = task.pending;
    const runtime = await project.createRuntimeWithoutSource();
    let result;
    try {
      result = await kind.check.run({ runtime, sessionId, taskId: conversationId }, task);
    } catch (error) {
      warn(sessionId, "check_failed", error, "An AI task's check gave no answer.");
      result = { unknown: true, message: error?.message };
    }
    const current = await runtime.store.readSessionConversation(sessionId, conversationId);
    if (!current?.task) return;
    await apply(sessionId, conversationId, checkEvent(kind, id, result, current));
    if (result.waiting) wakeLater(sessionId, waitingRecheckMs);
    else drive.again = true;
  }

  /** Reads how the task's turn ended, when it has. */
  async function settleTurn(sessionId, record, drive) {
    const { conversationId, task } = record;
    const restarted = !seenTasks.has(conversationId);
    seenTasks.add(conversationId);
    const turn = await terminals.readConversationTurn(sessionId, conversationId);
    if (turn?.code === WRITE_BUSY_CODE) {
      wakeLater(sessionId, writeBusyRetryMs);
      return;
    }
    if (!turn) return;
    const event = turnEvent(task, turn, restarted);
    if (!event) return;
    await apply(sessionId, conversationId, event);
    drive.again = true;
  }

  async function advance(sessionId, record, drive) {
    const { phase, pending } = record.task;
    if (pending?.effect === "send") return send(sessionId, record, drive);
    if (pending?.effect === "interrupt") return interrupt(sessionId, record, drive);
    if (phase === AI_TASK_PHASES.CANCELLING) {
      // Effects run one at a time, so a check owed here is not running: nothing is left to wait for.
      await apply(sessionId, record.conversationId, { type: "cancel_settled" });
      return undefined;
    }
    if (pending?.effect === "check") return check(sessionId, record, drive);
    return settleTurn(sessionId, record, drive);
  }

  async function run(sessionId, drive) {
    try {
      while (drive.again && !closed) {
        drive.again = false;
        const { store } = await project.createRuntimeWithoutSource();
        const records = await store.listSessionConversations(sessionId);
        for (const record of records.filter(item => item.task?.active && item.state !== "closing")) {
          await advance(sessionId, record, drive);
        }
      }
    } finally {
      drives.delete(sessionId);
    }
  }

  /**
   * Performs what a session's running tasks owe. Called at startup, after every settled turn and after
   * every action; a call while one runs asks it to look again, so nothing is performed twice at once.
   * @param {string} sessionId
   * @returns {Promise<void>}
   */
  function wake(sessionId) {
    if (closed) return Promise.resolve();
    const running = drives.get(sessionId);
    if (running) {
      running.again = true;
      return running.finished;
    }
    const drive = { again: true, finished: Promise.resolve() };
    drives.set(sessionId, drive);
    drive.finished = outsideSessionLocks(() => run(sessionId, drive)).catch((error) => {
      warn(sessionId, "resume_failed", error, "An AI task could not continue; the next turn or read tries again.");
    });
    return drive.finished;
  }

  /** Remembers a task this server started, so its turn is never read as left by a restart. */
  function remember(taskId) {
    seenTasks.add(taskId);
  }

  function forget(taskId) {
    seenTasks.delete(taskId);
  }

  /** A closed runner starts nothing more; what it owes is performed after the restart. */
  function close() {
    closed = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return Object.freeze({
    apply,
    close,
    forget,
    remember,
    wake
  });
}

export {
  createAiTaskRunner
};
