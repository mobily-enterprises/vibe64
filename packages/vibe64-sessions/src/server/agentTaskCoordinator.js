import crypto from "node:crypto";

import {
  VIBE64_AGENT_WORKSPACE_WRITE_POLICY,
  VIBE64_AGENT_TASK_RESULT_KINDS,
  VIBE64_AGENT_TASK_STATES,
  normalizeVibe64AgentTaskResult,
  vibe64AgentTaskIsActive
} from "@local/vibe64-runtime/shared";
import {
  VIBE64_AGENT_TASK_ACTIVE_RESULT,
  runVibe64AgentWriteExclusive
} from "@local/vibe64-runtime/server/agentWriteLock";
import {
  isPlainObject,
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

function nowIso() {
  return new Date().toISOString();
}

function taskFailure(code = "", error = "") {
  return {
    code,
    error,
    ok: false
  };
}

function taskOperation(session, task) {
  return {
    ok: true,
    session,
    task
  };
}

function taskLastRunId(task = {}) {
  return normalizeText(task.runId) || normalizeText(task.lastRunId);
}

function providerTurnFailed(status = "") {
  return ["failed", "interrupted"].includes(normalizeText(status));
}

function taskTurn(task = {}, role = "user", text = "", prompt = "") {
  const turns = Array.isArray(task.turns) ? task.turns : [];
  return {
    at: nowIso(),
    id: String(turns.length + 1).padStart(4, "0"),
    ...(prompt ? { prompt } : {}),
    role,
    text: normalizeText(text)
  };
}

function taskMenuItem(session = {}, definitionId = "") {
  const normalizedDefinitionId = normalizeText(definitionId);
  return (Array.isArray(session.adapter?.composerMenuItems)
    ? session.adapter.composerMenuItems
    : []).find((item) => (
    normalizeText(item?.id) === normalizedDefinitionId &&
    normalizeText(item?.kind) === "task" &&
    item?.enabled !== false &&
    item?.visible !== false &&
    normalizeText(item?.text)
  )) || null;
}

function providerInput(task = {}, input = {}) {
  return {
    agentSettings: task.agentSettings,
    conversationId: task.conversationId,
    policy: VIBE64_AGENT_WORKSPACE_WRITE_POLICY,
    runId: task.runId,
    ...input
  };
}

function publicAgentTask(task = null) {
  if (!isPlainObject(task)) {
    return null;
  }
  return {
    createdAt: normalizeText(task.createdAt),
    definitionId: normalizeText(task.definitionId),
    error: normalizeText(task.error),
    finishedAt: normalizeText(task.finishedAt),
    id: normalizeText(task.id),
    label: normalizeText(task.label),
    report: normalizeText(task.report),
    state: normalizeText(task.state),
    turns: vibe64AgentTaskIsActive(task)
      ? (Array.isArray(task.turns) ? task.turns : []).map(({ prompt: _prompt, ...turn }) => turn)
      : [],
    updatedAt: normalizeText(task.updatedAt)
  };
}

function taskReportText(task = {}) {
  const outcome = task.state === VIBE64_AGENT_TASK_STATES.STOPPED ? "stopped" : "complete";
  return [
    `Focused task ${outcome}: ${normalizeText(task.label) || "Task"}`,
    normalizeText(task.report)
  ].filter(Boolean).join("\n\n");
}

function sourceSafetySummary(safety = {}) {
  if (!isPlainObject(safety) || safety.available === false) {
    return "Source state could not be inspected.";
  }
  const branch = normalizeText(safety.branch);
  const head = normalizeText(safety.head);
  const facts = [
    branch ? `branch ${branch}` : "",
    head ? `HEAD ${head.slice(0, 12)}` : "",
    safety.hasUncommittedChanges === true
      ? `${Number(safety.changedFileCount || 0)} changed file(s)`
      : "working tree clean",
    safety.hasUnpushedCommits === true
      ? `${Number(safety.unpushedCommitCount || 0)} unpushed commit(s)`
      : "no unpushed commits"
  ].filter(Boolean);
  return facts.join(", ");
}

function createAgentTaskCoordinator({
  inspectSourceSafety = async () => null,
  mainConversationBusy = () => false,
  prepareWriteTask = async () => null,
  publishSessionChanged = async () => null,
  terminalService = null
} = {}) {
  const waiters = new Map();

  async function writeTask(runtime, sessionId, task = {}) {
    return runtime.store.writeCurrentAgentTask(sessionId, {
      ...task,
      updatedAt: nowIso()
    });
  }

  function providerOptions(runtime, session, task = {}) {
    return {
      agentSettings: task.agentSettings,
      runtime,
      session
    };
  }

  function sameTaskTurn(current = null, expected = {}) {
    return Boolean(
      current &&
      current.id === expected.id &&
      Number(current.generation || 0) === Number(expected.generation || 0) &&
      normalizeText(current.runId) === normalizeText(expected.runId)
    );
  }

  async function waitForUser(runtime, sessionId, task = {}, error = "") {
    return writeTask(runtime, sessionId, {
      ...task,
      error: normalizeText(error) || "The assistant task is ready for another message.",
      runId: "",
      state: VIBE64_AGENT_TASK_STATES.WAITING
    });
  }

  async function waitAfterProviderFailure(runtime, sessionId, task = {}, observed = {}) {
    return waitForUser(runtime, sessionId, {
      ...task,
      lastRunId: taskLastRunId(task)
    }, observed.error || "The assistant task turn failed and is ready to retry.");
  }

  async function publish(runtime, sessionId, reason) {
    try {
      await publishSessionChanged(sessionId, {
        reason,
        session: await runtime.getSession(sessionId)
      });
    } catch (error) {
      vibe64SessionDebugLog("server.agentTask.publish.error", {
        error: vibe64SessionDebugError(error),
        reason,
        sessionId
      });
    }
  }

  async function ensureSystemReport(runtime, sessionId, task = {}) {
    if (normalizeText(task.systemReportedAt) || !normalizeText(task.report)) {
      return task;
    }
    await runtime.store.writeConversationSystemMessage(sessionId, {
      text: taskReportText(task)
    });
    return writeTask(runtime, sessionId, {
      ...task,
      systemReportedAt: nowIso()
    });
  }

  async function finalizeTask(runtime, session, task = {}, {
    report = "",
    state = VIBE64_AGENT_TASK_STATES.COMPLETED
  } = {}) {
    let sourceSafety = null;
    try {
      sourceSafety = await inspectSourceSafety(session);
    } catch (error) {
      sourceSafety = {
        available: false,
        error: normalizeText(error?.message)
      };
    }
    const providerReport = normalizeText(report) || normalizeText(task.report) || "The task ended without a report.";
    const completed = await writeTask(runtime, session.sessionId, {
      ...task,
      error: "",
      finishedAt: nowIso(),
      handoffPending: true,
      lastRunId: taskLastRunId(task),
      report: [providerReport, `Source state: ${sourceSafetySummary(sourceSafety)}`].join("\n\n"),
      runId: "",
      sourceSafety,
      state,
      systemReportedAt: ""
    });
    return ensureSystemReport(runtime, session.sessionId, completed);
  }

  async function deleteConversation(runtime, session, task = {}) {
    const sessionId = session.sessionId;
    if (
      normalizeText(task.conversationDeletedAt) ||
      !normalizeText(task.conversationId) ||
      typeof terminalService?.deleteAgentConversation !== "function"
    ) {
      return;
    }
    try {
      const result = await terminalService.deleteAgentConversation(
        sessionId,
        providerInput(task),
        providerOptions(runtime, session, task)
      );
      if (result?.ok !== false && runtime?.store?.writeAgentTask) {
        await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          const current = typeof runtime.store.readAgentTask === "function"
            ? await runtime.store.readAgentTask(sessionId, task.id)
            : task;
          if (!current || normalizeText(current.conversationDeletedAt)) {
            return current;
          }
          return runtime.store.writeAgentTask(sessionId, {
            ...current,
            conversationDeletedAt: nowIso(),
            updatedAt: nowIso()
          });
        });
      }
    } catch (error) {
      vibe64SessionDebugLog("server.agentTask.cleanup.error", {
        error: vibe64SessionDebugError(error),
        sessionId,
        taskId: task.id
      });
    }
  }

  async function applyProviderResult(runtime, session, task = {}, result = {}) {
    const current = await runtime.store.readCurrentAgentTask(session.sessionId);
    if (!sameTaskTurn(current, task)) {
      return current;
    }
    const message = normalizeText(result.message || result.text || result.rawText);
    const outcome = normalizeVibe64AgentTaskResult(result.outcome) ||
      normalizeVibe64AgentTaskResult(result.rawText);
    const turns = message
      ? [...current.turns, taskTurn(current, "assistant", message)]
      : current.turns;
    const answered = await writeTask(runtime, session.sessionId, {
      ...current,
      error: message ? "" : "The assistant completed without returning a task response.",
      lastRunId: taskLastRunId(current),
      runId: "",
      state: VIBE64_AGENT_TASK_STATES.WAITING,
      turns
    });
    if (outcome?.kind !== VIBE64_AGENT_TASK_RESULT_KINDS.COMPLETE) {
      return answered;
    }
    return finalizeTask(runtime, session, answered, {
      report: outcome.report
    });
  }

  function waitKey(sessionId, task = {}) {
    return [sessionId, task.id, task.generation, task.runId].map(normalizeText).join(":");
  }

  function scheduleWait(runtime, session, task = {}) {
    if (!normalizeText(task.conversationId) || !normalizeText(task.runId)) {
      return null;
    }
    const key = waitKey(session.sessionId, task);
    if (waiters.has(key)) {
      return waiters.get(key);
    }
    const waiter = (async () => {
      let result;
      try {
        result = await terminalService.waitForAgentConversationTurn(
          session.sessionId,
          providerInput(task),
          providerOptions(runtime, session, task)
        );
      } catch (error) {
        result = {
          error: normalizeText(error?.message) || "The assistant task turn failed.",
          ok: false
        };
      }
      const exclusive = await runVibe64AgentWriteExclusive(runtime, session.sessionId, async () => {
        const currentSession = await runtime.getSession(session.sessionId);
        const currentTask = await runtime.store.readCurrentAgentTask(session.sessionId);
        if (!sameTaskTurn(currentTask, task)) {
          return currentTask;
        }
        if (result?.ok !== true) {
          return writeTask(runtime, session.sessionId, {
            ...currentTask,
            error: normalizeText(result?.error) || "Vibe64 lost the live task connection and is reconnecting.",
            state: VIBE64_AGENT_TASK_STATES.RUNNING
          });
        }
        return applyProviderResult(runtime, currentSession, currentTask, result);
      });
      if (exclusive.acquired) {
        const completedTask = exclusive.value;
        await publish(runtime, session.sessionId, "session-agent-task-updated");
        if (!vibe64AgentTaskIsActive(completedTask)) {
          await deleteConversation(runtime, session, completedTask);
        }
      }
      return exclusive.value;
    })().catch((error) => {
      vibe64SessionDebugLog("server.agentTask.wait.error", {
        error: vibe64SessionDebugError(error),
        sessionId: session.sessionId,
        taskId: task.id
      });
      return null;
    }).finally(() => {
      waiters.delete(key);
    });
    waiters.set(key, waiter);
    return waiter;
  }

  async function startTurn(runtime, session, task = {}, prompt = "") {
    let current = task;
    if (!normalizeText(current.conversationId)) {
      const created = await terminalService.createAgentConversation(
        session.sessionId,
        providerInput(current),
        providerOptions(runtime, session, current)
      );
      if (created?.ok !== true || !normalizeText(created.conversationId)) {
        throw new Error(created?.error || "The assistant task conversation could not be created.");
      }
      current = await writeTask(runtime, session.sessionId, {
        ...current,
        conversationId: normalizeText(created.conversationId)
      });
    }
    const started = await terminalService.startAgentConversationTurn(
      session.sessionId,
      providerInput(current, {
        message: prompt,
        promptLabel: current.label
      }),
      providerOptions(runtime, session, current)
    );
    if (started?.ok !== true || !normalizeText(started.runId)) {
      throw new Error(started?.error || "The assistant task turn could not be started.");
    }
    return writeTask(runtime, session.sessionId, {
      ...current,
      error: "",
      runId: normalizeText(started.runId),
      state: VIBE64_AGENT_TASK_STATES.RUNNING
    });
  }

  async function attemptStartTurn(runtime, session, task = {}, prompt = "") {
    try {
      return await startTurn(runtime, session, task, prompt);
    } catch (error) {
      return waitForUser(
        runtime,
        session.sessionId,
        task,
        normalizeText(error?.message) || "The assistant task turn could not start."
      );
    }
  }

  async function recoverStartingTurn(runtime, session, task = {}, prompt = "") {
    if (!normalizeText(task.conversationId)) {
      return attemptStartTurn(runtime, session, task, prompt);
    }
    const observed = await terminalService.readAgentConversation(
      session.sessionId,
      providerInput(task, {
        runId: ""
      }),
      providerOptions(runtime, session, task)
    );
    if (observed?.ok !== true) {
      return writeTask(runtime, session.sessionId, {
        ...task,
        error: normalizeText(observed?.error) || "Vibe64 is reconnecting to the focused task."
      });
    }
    const recoveredRunId = normalizeText(observed.runId);
    if (!recoveredRunId || recoveredRunId === normalizeText(task.lastRunId)) {
      return attemptStartTurn(runtime, session, task, prompt);
    }
    const recovered = await writeTask(runtime, session.sessionId, {
      ...task,
      error: "",
      runId: recoveredRunId,
      state: VIBE64_AGENT_TASK_STATES.RUNNING
    });
    const status = normalizeText(observed.status);
    if (providerTurnFailed(status)) {
      return waitAfterProviderFailure(runtime, session.sessionId, recovered, observed);
    }
    return status === "completed"
      ? applyProviderResult(runtime, session, recovered, observed)
      : recovered;
  }

  async function finishOperation(runtime, sessionId, result = {}, {
    accepted = false,
    reason = "session-agent-task-updated"
  } = {}) {
    if (result?.ok !== true) {
      return result;
    }
    await publish(runtime, sessionId, reason);
    if (result.task?.state === VIBE64_AGENT_TASK_STATES.RUNNING) {
      scheduleWait(runtime, result.session, result.task);
    } else if (!vibe64AgentTaskIsActive(result.task)) {
      await deleteConversation(runtime, result.session, result.task);
    }
    return {
      ...(accepted ? { accepted: true } : {}),
      ok: true,
      task: publicAgentTask(result.task)
    };
  }

  async function start({
    input = {},
    runtime,
    sessionId = ""
  } = {}) {
    const definitionId = normalizeText(input.taskId || input.definitionId);
    if (!definitionId) {
      return taskFailure("vibe64_agent_task_definition_required", "Choose a task to start.");
    }
    const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
      const session = await runtime.getSession(sessionId);
      if (vibe64AgentTaskIsActive(session.agentTask)) {
        return taskFailure(
          "vibe64_agent_task_active",
          "Finish or stop the current focused task before starting another one."
        );
      }
      if (mainConversationBusy(session)) {
        return taskFailure(
          "vibe64_main_agent_busy",
          "Wait for the main conversation to finish before starting a focused task."
        );
      }
      const item = taskMenuItem(session, definitionId);
      if (!item) {
        return taskFailure(
          "vibe64_agent_task_not_available",
          "That focused task is no longer available for this session."
        );
      }
      await prepareWriteTask({
        input,
        runtime,
        session,
        sessionId
      });
      const agentSettings = input.agentSettings;
      await terminalService.describeAgentProvider({
        agentSettings,
        session
      });
      const createdAt = nowIso();
      let task = await writeTask(runtime, sessionId, {
        agentSettings,
        conversationId: "",
        createdAt,
        definitionId,
        error: "",
        generation: 1,
        handoffPending: false,
        id: crypto.randomUUID(),
        label: normalizeText(item.label) || "Focused task",
        lastRunId: "",
        prompt: normalizeText(item.text),
        report: "",
        runId: "",
        state: VIBE64_AGENT_TASK_STATES.STARTING,
        turns: []
      });
      task = await writeTask(runtime, sessionId, {
        ...task,
        turns: [taskTurn(task, "user", task.label, task.prompt)]
      });
      task = await attemptStartTurn(runtime, session, task, task.prompt);
      return taskOperation(session, task);
    });
    return finishOperation(runtime, sessionId, exclusive.value, {
      reason: "session-agent-task-started"
    });
  }

  async function sendMessage({
    input = {},
    runtime,
    sessionId = ""
  } = {}) {
    const message = normalizeText(input.message || input.text);
    if (!message) {
      return taskFailure("vibe64_agent_task_message_required", "Enter a task message.");
    }
    const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
      const session = await runtime.getSession(sessionId);
      const current = session.agentTask;
      if (!vibe64AgentTaskIsActive(current)) {
        return taskFailure("vibe64_agent_task_not_active", "There is no active focused task.");
      }
      if (current.state !== VIBE64_AGENT_TASK_STATES.WAITING) {
        return taskFailure("vibe64_agent_task_running", "Wait for the current task turn to finish.");
      }
      const generation = Number(current.generation || 0) + 1;
      const lastTurn = current.turns.at(-1);
      const pendingTurn = current.error && lastTurn?.role === "user" && normalizeText(lastTurn.prompt)
        ? lastTurn
        : null;
      const prompt = pendingTurn
        ? [pendingTurn.prompt, `User retry note: ${message}`].join("\n\n")
        : message;
      let task = await writeTask(runtime, sessionId, {
        ...current,
        error: "",
        generation,
        state: VIBE64_AGENT_TASK_STATES.STARTING,
        turns: [...current.turns, taskTurn(current, "user", message, prompt)]
      });
      task = await attemptStartTurn(runtime, session, task, prompt);
      return taskOperation(session, task);
    });
    return finishOperation(runtime, sessionId, exclusive.value, {
      accepted: true,
      reason: "session-agent-task-message-accepted"
    });
  }

  async function finish({ runtime, sessionId = "" } = {}) {
    const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
      const session = await runtime.getSession(sessionId);
      const current = session.agentTask;
      if (!vibe64AgentTaskIsActive(current)) {
        return taskFailure("vibe64_agent_task_not_active", "There is no active focused task.");
      }
      if (current.state !== VIBE64_AGENT_TASK_STATES.WAITING) {
        return taskFailure("vibe64_agent_task_running", "Stop the running task before finishing it manually.");
      }
      const lastAssistant = [...current.turns].reverse()
        .find((turn) => turn.role === "assistant" && normalizeText(turn.text));
      return taskOperation(
        session,
        await finalizeTask(runtime, session, current, {
          report: normalizeText(lastAssistant?.text) || "The user marked the focused task complete."
        })
      );
    });
    return finishOperation(runtime, sessionId, exclusive.value, {
      reason: "session-agent-task-finished"
    });
  }

  async function stopTask(runtime, session, task = {}) {
    if (task.conversationId && task.runId) {
      const stopped = await terminalService.stopAgentConversation(
        session.sessionId,
        providerInput(task),
        providerOptions(runtime, session, task)
      );
      if (stopped?.ok === false) {
        return writeTask(runtime, session.sessionId, {
          ...task,
          error: normalizeText(stopped.error) || "The assistant task could not be stopped.",
          state: VIBE64_AGENT_TASK_STATES.RUNNING
        });
      }
    }
    return finalizeTask(runtime, session, task, {
      report: "The user stopped the focused task.",
      state: VIBE64_AGENT_TASK_STATES.STOPPED
    });
  }

  async function stop({ runtime, sessionId = "" } = {}) {
    const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
      const session = await runtime.getSession(sessionId);
      let task = session.agentTask;
      if (!vibe64AgentTaskIsActive(task)) {
        return taskFailure("vibe64_agent_task_not_active", "There is no active focused task.");
      }
      task = await writeTask(runtime, sessionId, {
        ...task,
        state: VIBE64_AGENT_TASK_STATES.STOPPING
      });
      return taskOperation(session, await stopTask(runtime, session, task));
    });
    return finishOperation(runtime, sessionId, exclusive.value, {
      reason: "session-agent-task-stopped"
    });
  }

  async function reconcileRunningTask(runtime, session, task = {}) {
    const sessionId = session.sessionId;
    if (!task.conversationId || !task.runId) {
      return waitForUser(
        runtime,
        sessionId,
        task,
        "The assistant task lost its provider turn and is ready to retry."
      );
    }
    const observed = await terminalService.readAgentConversation(
      sessionId,
      providerInput(task),
      providerOptions(runtime, session, task)
    );
    const status = normalizeText(observed?.status);
    if (observed?.ok !== true) {
      return writeTask(runtime, sessionId, {
        ...task,
        error: normalizeText(observed?.error) || "Vibe64 lost the live task connection and is reconnecting."
      });
    }
    if (providerTurnFailed(status)) {
      return waitAfterProviderFailure(runtime, sessionId, task, observed);
    }
    if (status === "completed") {
      return applyProviderResult(runtime, session, task, observed);
    }
    return task.error
      ? writeTask(runtime, sessionId, {
          ...task,
          error: ""
        })
      : task;
  }

  async function reconcileTask(runtime, session) {
    const sessionId = session.sessionId;
    const task = session.agentTask;
    if (!task) {
      return null;
    }
    if (!vibe64AgentTaskIsActive(task)) {
      return ensureSystemReport(runtime, sessionId, task);
    }
    if (task.state === VIBE64_AGENT_TASK_STATES.WAITING) {
      return task;
    }
    if (task.state === VIBE64_AGENT_TASK_STATES.STARTING) {
      const pendingTurn = [...task.turns].reverse().find((turn) => normalizeText(turn.prompt));
      try {
        return await recoverStartingTurn(runtime, session, task, pendingTurn?.prompt || task.prompt);
      } catch (error) {
        return writeTask(runtime, sessionId, {
          ...task,
          error: normalizeText(error?.message) || "Vibe64 is reconnecting to the focused task."
        });
      }
    }
    if (task.state === VIBE64_AGENT_TASK_STATES.STOPPING) {
      try {
        return await stopTask(runtime, session, task);
      } catch (error) {
        return writeTask(runtime, sessionId, {
          ...task,
          error: normalizeText(error?.message) || "Vibe64 is reconnecting before stopping the focused task."
        });
      }
    }
    return reconcileRunningTask(runtime, session, task);
  }

  async function reconcile({ runtime, sessionId = "" } = {}) {
    if (typeof runtime?.store?.readCurrentAgentTask !== "function") {
      return {
        ok: true,
        task: null
      };
    }
    const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
      const session = await runtime.getSession(sessionId);
      return taskOperation(session, await reconcileTask(runtime, session));
    });
    const result = exclusive.value;
    if (result?.ok === true && result.task) {
      if (vibe64AgentTaskIsActive(result.task) && result.task.state === VIBE64_AGENT_TASK_STATES.RUNNING) {
        scheduleWait(runtime, result.session, result.task);
      }
      if (!vibe64AgentTaskIsActive(result.task)) {
        void deleteConversation(runtime, result.session, result.task);
      }
    }
    return result;
  }

  async function runMainWriteExclusive(runtime, sessionId, operation) {
    return runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
      const session = await runtime.getSession(sessionId);
      if (vibe64AgentTaskIsActive(session.agentTask)) {
        return VIBE64_AGENT_TASK_ACTIVE_RESULT;
      }
      return operation(session);
    });
  }

  async function prepareMainMessage(runtime, sessionId, message = "", claimedTaskIds = []) {
    const claimed = new Set((Array.isArray(claimedTaskIds) ? claimedTaskIds : [])
      .map(normalizeText)
      .filter(Boolean));
    const history = typeof runtime?.store?.readAgentTasks === "function"
      ? await runtime.store.readAgentTasks(sessionId)
      : [];
    const tasks = history.filter((task) => (
      task.handoffPending === true &&
      normalizeText(task.report) &&
      !claimed.has(task.id)
    ));
    if (!tasks.length) {
      return {
        message,
        taskIds: []
      };
    }
    const reports = tasks.map((task) => [
      `Completed focused task: ${normalizeText(task.label) || task.id}`,
      normalizeText(task.report)
    ].join("\n"));
    return {
      message: [
        "Context from focused tasks completed since the last main-conversation turn:",
        reports.join("\n\n"),
        "Current user message:",
        message
      ].join("\n\n"),
      taskIds: tasks.map((task) => task.id)
    };
  }

  async function markHandoffsDelivered(runtime, sessionId, taskIds = []) {
    const ids = new Set((Array.isArray(taskIds) ? taskIds : []).map(normalizeText).filter(Boolean));
    if (!ids.size || typeof runtime?.store?.readAgentTasks !== "function") {
      return;
    }
    for (const task of await runtime.store.readAgentTasks(sessionId)) {
      if (!ids.has(task.id) || task.handoffPending !== true) {
        continue;
      }
      await runtime.store.writeAgentTask(sessionId, {
        ...task,
        handoffDeliveredAt: nowIso(),
        handoffPending: false,
        updatedAt: nowIso()
      });
    }
  }

  return Object.freeze({
    finish,
    markHandoffsDelivered,
    prepareMainMessage,
    reconcile,
    runMainWriteExclusive,
    sendMessage,
    start,
    stop
  });
}

export {
  createAgentTaskCoordinator,
  publicAgentTask
};
