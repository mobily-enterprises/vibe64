import { randomUUID } from "node:crypto";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { AI_TASK_PHASES, aiTaskEnded } from "../shared/aiTaskPhases.js";
import { createAiTaskKinds } from "./aiTaskKinds.js";
import { createAiTask } from "./aiTaskMachine.js";
import { createAiTaskRunner } from "./aiTaskRunner.js";

/** @typedef {import("./types.js").AiTask} AiTask */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

const taskClosed = () => new AppError(404, "This AI task has been closed.", { code: "vibe64_ai_task_closed" });

/**
 * A person as a task shows them; the rest of their identity stays on the server.
 * @param {{ id?: string | number, preferredName?: string, displayName?: string, username?: string } | null} user
 */
function taskPerson(user) {
  if (!user) return null;
  return { id: String(user.username || user.id || user.email || ""), name: user.preferredName || user.displayName || user.name || user.username || "" };
}

/**
 * What a browser sees of a task: never the prompts it was given.
 * @param {{ conversationId: string, task: AiTask }} record
 */
function presentAiTask({ conversationId, task }) {
  const {
    input: _input, pending, problem, startedBy, cancelledBy: _cancelledBy, endedBy, turn: _turn, doneMessage: _doneMessage, ...shown
  } = task;
  return {
    ...shown,
    id: conversationId,
    problem: { key: problem.key, summary: problem.summary, details: problem.details },
    checkRunning: pending?.effect === "check",
    conflictReview: problem.facts.reviewId || "",
    conflictPaths: problem.facts.paths || [],
    startedBy: taskPerson(startedBy),
    endedBy: taskPerson(endedBy)
  };
}

/**
 * Every AI task of a session: the one Vibe64 is doing, and any that ended and waits for Close.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {SessionsService} dependencies.sessions
 * @param {TerminalsService} dependencies.terminals
 */
function createAiTasksService({ logger, project, publishSessionChanged, sessions, terminals }) {
  const kinds = createAiTaskKinds({ project, sessions, terminals });
  const runner = createAiTaskRunner({ kinds, logger, project, publishSessionChanged, terminals, present: presentAiTask });

  async function taskRecords(sessionId) {
    const { store } = await project.createRuntimeWithoutSource();
    return (await store.listSessionConversations(sessionId)).filter(record => record.task && record.state !== "closing");
  }

  async function taskRecord(sessionId, taskId) {
    const { store } = await project.createRuntimeWithoutSource();
    const record = await store.readSessionConversation(sessionId, taskId);
    if (!record?.task) throw taskClosed();
    return record;
  }

  /**
   * One open task per session, whatever its kind and whoever started it.
   * @param {object} record
   */
  function openTaskRefusal(record) {
    return new AppError(409, kinds[record.task.kind].busy, {
      code: "vibe64_ai_task_open",
      details: { taskId: record.conversationId }
    });
  }

  async function list(sessionId, { vibe64User = null } = {}) {
    const records = await taskRecords(sessionId);
    if (records.some(record => record.task.active)) void runner.wake(sessionId);
    return { ok: true, tasks: records.map(presentAiTask), viewerId: taskPerson(vibe64User)?.id || "" };
  }

  async function read(sessionId, { taskId }) {
    const record = await taskRecord(sessionId, taskId);
    if (record.task.active) void runner.wake(sessionId);
    return { ok: true, task: presentAiTask(record) };
  }

  async function closeEnded(sessionId, record, vibe64User) {
    await terminals.deleteTemporaryConversation(sessionId, { conversationId: record.conversationId });
    runner.forget(record.conversationId);
    await publishSessionChanged(sessionId, {
      reason: "ai-task-changed",
      payload: { aiTaskClosed: { ...presentAiTask(record), closedBy: taskPerson(vibe64User) } }
    });
  }

  /**
   * Opens this problem's task. The same problem reopens the open task; another open task refuses
   * it; one that has ended and only waits for Close is closed first.
   * @param {string} sessionId
   * @param {{ kind: string, input?: object, vibe64User?: object | null }} request
   */
  async function start(sessionId, { kind: kindId, input = {}, vibe64User = null }) {
    const kind = kinds[kindId];
    if (!kind) throw new AppError(400, "Vibe64 has no such AI task.", { code: "vibe64_ai_task_kind_unknown" });
    const records = await taskRecords(sessionId);
    const open = records.find(record => !aiTaskEnded(record.task));
    const runtime = await project.createRuntimeWithoutSource();
    const problem = await kind.problem({ runtime, sessionId }, input).catch((error) => {
      if (open?.task.kind === kind.id) return null;
      throw error;
    });
    if (open) {
      if (!problem || open.task.problem.key === problem.key) return { ok: true, task: presentAiTask(open) };
      throw openTaskRefusal(open);
    }
    for (const ended of records) await closeEnded(sessionId, ended, vibe64User);
    const taskId = randomUUID();
    const task = createAiTask({
      kind,
      problem,
      taskInput: input,
      startedBy: vibe64User,
      at: new Date().toISOString(),
      sendId: `message_${randomUUID()}`
    });
    await terminals.createTemporaryConversation(sessionId, {
      conversationId: taskId,
      presentation: { title: task.title },
      vibe64User
    }, {
      vibe64User,
      aiTask(conversations) {
        const other = conversations.find(record => record.task && !aiTaskEnded(record.task));
        if (other) throw openTaskRefusal(other);
        return task;
      }
    });
    runner.remember(taskId);
    const shown = presentAiTask({ conversationId: taskId, task });
    await publishSessionChanged(sessionId, { reason: "ai-task-changed", payload: { aiTask: shown } });
    void runner.wake(sessionId);
    return { ok: true, task: shown };
  }

  /** Records what the person did at once; what it owes runs after the answer. */
  async function act(sessionId, taskId, event) {
    const record = await runner.apply(sessionId, taskId, event);
    if (!record) throw taskClosed();
    void runner.wake(sessionId);
    return { ok: true, task: presentAiTask(record) };
  }

  function cancel(sessionId, { taskId, vibe64User = null }) {
    return act(sessionId, taskId, { type: "cancel", id: randomUUID(), by: vibe64User });
  }

  function check(sessionId, { taskId, reviewedConflictId = "" }) {
    return act(sessionId, taskId, { type: "check_now", id: randomUUID(), reviewedConflictId });
  }

  function continueTask(sessionId, { taskId }) {
    return act(sessionId, taskId, { type: "continue", id: `message_${randomUUID()}` });
  }

  function finish(sessionId, { taskId, vibe64User = null }) {
    return act(sessionId, taskId, { type: "finish", by: vibe64User });
  }

  /** Closing removes the conversation with the task; repeating it finds nothing to do. */
  async function close(sessionId, { taskId, vibe64User = null }) {
    const { store } = await project.createRuntimeWithoutSource();
    const record = await store.readSessionConversation(sessionId, taskId);
    if (!record?.task) return { ok: true, closed: true };
    if (!aiTaskEnded(record.task)) {
      throw new AppError(409, "This AI task hasn't ended yet. Cancel it first.", { code: "vibe64_ai_task_running" });
    }
    await closeEnded(sessionId, record, vibe64User);
    return { ok: true, closed: true };
  }

  /**
   * A message the person sends in a task's chat: the task follows it, or refuses it while
   * Vibe64 is checking or the task has ended. The runner's own messages pass through.
   * @param {{ sessionId: string, conversationId: string, messageId: string }} turn
   */
  async function onTurnStarting({ sessionId, conversationId, messageId }) {
    const { store } = await project.createRuntimeWithoutSource();
    const record = await store.readSessionConversation(sessionId, conversationId);
    if (!record?.task || record.task.pending?.id === messageId) return;
    const { phase } = record.task;
    if (aiTaskEnded(record.task) || [AI_TASK_PHASES.CHECKING, AI_TASK_PHASES.CANCELLING].includes(phase)) {
      throw new AppError(409, "Wait for Vibe64 to finish checking before you send a message.", { code: "vibe64_ai_task_not_listening" });
    }
    await runner.apply(sessionId, conversationId, { type: "person_message", messageId });
  }

  /**
   * A turn ended, or never started. A message that failed to send has no turn to read.
   * @param {{ sessionId: string, conversationId: string, failure: { messageId: string, error?: string } | null }} settled
   */
  async function onTurnSettled({ sessionId, conversationId, failure }) {
    if (failure) {
      const { store } = await project.createRuntimeWithoutSource();
      const record = await store.readSessionConversation(sessionId, conversationId);
      // The runner reports its own sends; a person's failed message settles here.
      if (record?.task?.turnMessageId === failure.messageId && record.task.pending?.id !== failure.messageId) {
        await runner.apply(sessionId, conversationId, { type: "turn_failed", message: failure.error || "The message was not sent." });
      }
    }
    void runner.wake(sessionId);
  }

  /** The session is being archived: its open tasks end here, before its work stops. */
  async function onSessionArchiving(sessionId) {
    for (const record of await taskRecords(sessionId)) {
      await runner.apply(sessionId, record.conversationId, { type: "archived" });
      runner.forget(record.conversationId);
    }
  }

  /**
   * Picks up what a previous server left, in every open session of the project this server holds.
   */
  async function resumeInterruptedTasks() {
    const runtime = await project.createRuntimeWithoutSource();
    for (const session of await runtime.listSessionSummaries({ statusGroup: "open" })) {
      await runner.wake(session.sessionId);
    }
  }

  return Object.freeze({
    cancel,
    check,
    close,
    closeRunner: runner.close,
    continueTask,
    finish,
    list,
    onSessionArchiving,
    onTurnSettled,
    onTurnStarting,
    read,
    resumeInterruptedTasks,
    start
  });
}

export {
  createAiTasksService,
  presentAiTask
};
