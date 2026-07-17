import assert from "node:assert/strict";
import test from "node:test";

import {
  createAgentTaskCoordinator
} from "../../packages/vibe64-sessions/src/server/agentTaskCoordinator.js";

function deferred() {
  let resolve;
  const promise = new Promise((next) => {
    resolve = next;
  });
  return {
    promise,
    resolve
  };
}

function testRuntime() {
  const tasks = new Map();
  const systemMessages = [];
  const session = {
    adapter: {
      composerMenuItems: [{
        enabled: true,
        id: "core.sync_with_remote",
        kind: "task",
        label: "Sync code with GitHub",
        text: "Synchronize the repository safely.",
        visible: true
      }]
    },
    agentTask: null,
    metadata: {},
    sessionId: "task-session"
  };
  let locked = false;
  const store = {
    async readAgentTask(_sessionId, taskId) {
      return tasks.get(taskId) || null;
    },
    async readAgentTasks() {
      return [...tasks.values()];
    },
    async readCurrentAgentTask() {
      return session.agentTask;
    },
    async runSessionExclusive(_sessionId, _operationName, operation) {
      if (locked) {
        return {
          acquired: false,
          value: null
        };
      }
      locked = true;
      try {
        return {
          acquired: true,
          value: await operation()
        };
      } finally {
        locked = false;
      }
    },
    async writeAgentTask(_sessionId, task) {
      const record = structuredClone(task);
      tasks.set(record.id, record);
      if (session.agentTask?.id === record.id) {
        session.agentTask = record;
      }
      return record;
    },
    async writeConversationSystemMessage(_sessionId, message) {
      systemMessages.push(structuredClone(message));
      return message;
    },
    async writeCurrentAgentTask(_sessionId, task) {
      const record = structuredClone(task);
      tasks.set(record.id, record);
      session.agentTask = record;
      return record;
    }
  };
  return {
    async getSession() {
      return structuredClone(session);
    },
    session,
    store,
    systemMessages,
    tasks
  };
}

function focusedTask(overrides = {}) {
  return {
    agentSettings: {
      providerId: "codex"
    },
    conversationId: "",
    createdAt: "2026-07-16T01:00:00.000Z",
    definitionId: "core.sync_with_remote",
    error: "",
    generation: 1,
    handoffPending: false,
    id: "persisted-task",
    label: "Sync code with GitHub",
    lastRunId: "",
    prompt: "Synchronize the repository safely.",
    runId: "",
    state: "starting",
    turns: [{
      id: "0001",
      prompt: "Synchronize the repository safely.",
      role: "user",
      text: "Sync code with GitHub"
    }],
    ...overrides
  };
}

function terminalWithResults(results = [], {
  readResults = [],
  startResults = []
} = {}) {
  const calls = [];
  const queue = [...results];
  const reads = [...readResults];
  const starts = [...startResults];
  const turnInputs = [];
  return {
    calls,
    turnInputs,
    async createAgentConversation() {
      calls.push("create");
      return {
        conversationId: "conversation-1",
        ok: true
      };
    },
    async deleteAgentConversation() {
      calls.push("delete");
      return {
        ok: true
      };
    },
    describeAgentProvider() {
      calls.push("describe");
      return {
        providerId: "codex",
        transportId: "codex_app_server"
      };
    },
    async readAgentConversation() {
      calls.push("read");
      return reads.shift() || {
        ok: true,
        status: "inProgress"
      };
    },
    async startAgentConversationTurn(_sessionId, input) {
      calls.push("start");
      turnInputs.push(structuredClone(input));
      return starts.shift() || {
        ok: true,
        runId: `run-${calls.filter((call) => call === "start").length}`
      };
    },
    async stopAgentConversation() {
      calls.push("stop");
      return {
        ok: true
      };
    },
    async waitForAgentConversationTurn() {
      calls.push("wait");
      return queue.shift();
    }
  };
}

function coordinator(runtime, terminalService, options = {}) {
  return createAgentTaskCoordinator({
    inspectSourceSafety: async () => ({
      available: true,
      branch: "vibe64/task",
      changedFileCount: 1,
      hasUncommittedChanges: true,
      hasUnpushedCommits: false,
      head: "1234567890abcdef",
      unpushedCommitCount: 0
    }),
    publishSessionChanged: async () => null,
    terminalService,
    ...options
  });
}

async function waitFor(predicate, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (predicate()) {
      return true;
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return false;
}

test("focused tasks use one provider-neutral conversation and block main writes", async () => {
  const runtime = testRuntime();
  const completion = deferred();
  const terminal = terminalWithResults([completion.promise]);
  const taskCoordinator = coordinator(runtime, terminal);

  const started = await taskCoordinator.start({
    input: {
      agentSettings: {
        providerId: "codex"
      },
      taskId: "core.sync_with_remote"
    },
    runtime,
    sessionId: "task-session"
  });

  assert.equal(started.ok, true);
  assert.equal(started.task.state, "running");
  assert.deepEqual(terminal.calls.slice(0, 4), ["describe", "create", "start", "wait"]);

  const mainWrite = await taskCoordinator.runMainWriteExclusive(
    runtime,
    "task-session",
    async () => ({ ok: true })
  );
  assert.equal(mainWrite.value.code, "vibe64_agent_task_active");

  const duplicate = await taskCoordinator.start({
    input: {
      taskId: "core.sync_with_remote"
    },
    runtime,
    sessionId: "task-session"
  });
  assert.equal(duplicate.code, "vibe64_agent_task_active");

  completion.resolve({
    message: "Repository synchronized.",
    ok: true,
    outcome: {
      kind: "complete",
      message: "Repository synchronized.",
      report: "Merged remote changes and pushed the task branch."
    }
  });
  assert.equal(await waitFor(() => runtime.session.agentTask?.state === "completed"), true);
  assert.equal(runtime.systemMessages.length, 1);
  assert.match(runtime.systemMessages[0].text, /Merged remote changes/u);
  assert.equal(runtime.session.agentTask.handoffPending, true);

  const handoff = await taskCoordinator.prepareMainMessage(runtime, "task-session", "What next?");
  assert.deepEqual(handoff.taskIds, [runtime.session.agentTask.id]);
  assert.match(handoff.message, /Current user message:\n\nWhat next\?/u);

  await taskCoordinator.markHandoffsDelivered(runtime, "task-session", handoff.taskIds);
  assert.equal(runtime.session.agentTask.handoffPending, false);
  assert.equal(terminal.calls.includes("delete"), true);
});

test("focused tasks remain in the same conversation for user follow-ups", async () => {
  const runtime = testRuntime();
  const terminal = terminalWithResults([
    {
      message: "Choose whether to merge the divergent branch.",
      ok: true,
      outcome: {
        kind: "continue",
        message: "Choose whether to merge the divergent branch.",
        report: ""
      }
    },
    {
      message: "Merged without rebasing.",
      ok: true,
      outcome: {
        kind: "complete",
        message: "Merged without rebasing.",
        report: "Merged the divergent branch with a normal merge."
      }
    }
  ]);
  const taskCoordinator = coordinator(runtime, terminal);

  await taskCoordinator.start({
    input: {
      taskId: "core.sync_with_remote"
    },
    runtime,
    sessionId: "task-session"
  });
  assert.equal(await waitFor(() => runtime.session.agentTask?.state === "waiting"), true);

  const followedUp = await taskCoordinator.sendMessage({
    input: {
      message: "Use a normal merge."
    },
    runtime,
    sessionId: "task-session"
  });
  assert.equal(followedUp.ok, true);
  assert.equal(await waitFor(() => runtime.session.agentTask?.state === "completed"), true);
  assert.equal(terminal.calls.filter((call) => call === "create").length, 1);
  assert.equal(terminal.calls.filter((call) => call === "start").length, 2);
});

test("focused task reconciliation resumes a persisted starting turn", async () => {
  const runtime = testRuntime();
  const pending = deferred();
  const terminal = terminalWithResults([pending.promise]);
  const taskCoordinator = coordinator(runtime, terminal);
  const task = focusedTask();
  await runtime.store.writeCurrentAgentTask("task-session", task);

  const reconciled = await taskCoordinator.reconcile({
    runtime,
    sessionId: "task-session"
  });

  assert.equal(reconciled.ok, true);
  assert.equal(runtime.session.agentTask.state, "running");
  assert.equal(runtime.session.agentTask.conversationId, "conversation-1");
  assert.equal(runtime.session.agentTask.runId, "run-1");
  assert.deepEqual(terminal.calls.slice(0, 3), ["create", "start", "wait"]);
});

test("focused task reconciliation adopts a provider turn accepted before process exit", async () => {
  const runtime = testRuntime();
  const pending = deferred();
  const terminal = terminalWithResults([pending.promise], {
    readResults: [{
      ok: true,
      runId: "run-2",
      status: "inProgress"
    }]
  });
  const taskCoordinator = coordinator(runtime, terminal);
  await runtime.store.writeCurrentAgentTask("task-session", focusedTask({
    conversationId: "conversation-1",
    generation: 2,
    lastRunId: "run-1"
  }));

  await taskCoordinator.reconcile({
    runtime,
    sessionId: "task-session"
  });

  assert.equal(runtime.session.agentTask.runId, "run-2");
  assert.equal(runtime.session.agentTask.state, "running");
  assert.deepEqual(terminal.calls, ["read", "wait"]);
});

test("focused task reconciliation does not unlock writes on a transient provider read failure", async () => {
  const runtime = testRuntime();
  const pending = deferred();
  const terminal = terminalWithResults([pending.promise], {
    readResults: [{
      error: "Temporary connection failure.",
      ok: false
    }]
  });
  const taskCoordinator = coordinator(runtime, terminal);
  await runtime.store.writeCurrentAgentTask("task-session", focusedTask({
    conversationId: "conversation-1",
    runId: "run-1",
    state: "running"
  }));

  await taskCoordinator.reconcile({
    runtime,
    sessionId: "task-session"
  });

  assert.equal(runtime.session.agentTask.runId, "run-1");
  assert.equal(runtime.session.agentTask.state, "running");
  assert.match(runtime.session.agentTask.error, /Temporary connection failure/u);
  assert.deepEqual(terminal.calls, ["read", "wait"]);
});

test("focused task reconciliation completes a persisted stop", async () => {
  const runtime = testRuntime();
  const terminal = terminalWithResults([]);
  const taskCoordinator = coordinator(runtime, terminal);
  await runtime.store.writeCurrentAgentTask("task-session", focusedTask({
    conversationId: "conversation-1",
    runId: "run-1",
    state: "stopping"
  }));

  await taskCoordinator.reconcile({
    runtime,
    sessionId: "task-session"
  });

  assert.equal(runtime.session.agentTask.state, "stopped");
  assert.equal(terminal.calls.includes("stop"), true);
  assert.equal(await waitFor(() => terminal.calls.includes("delete")), true);
});

test("focused task retries preserve the failed task prompt and add the user's note", async () => {
  const runtime = testRuntime();
  const pending = deferred();
  const terminal = terminalWithResults([pending.promise], {
    startResults: [{
      error: "Provider was unavailable.",
      ok: false
    }]
  });
  const taskCoordinator = coordinator(runtime, terminal);

  await taskCoordinator.start({
    input: {
      taskId: "core.sync_with_remote"
    },
    runtime,
    sessionId: "task-session"
  });
  await taskCoordinator.sendMessage({
    input: {
      message: "Please retry."
    },
    runtime,
    sessionId: "task-session"
  });

  assert.equal(terminal.turnInputs.length, 2);
  assert.match(terminal.turnInputs[1].message, /Synchronize the repository safely\./u);
  assert.match(terminal.turnInputs[1].message, /User retry note: Please retry\./u);
});

test("focused task starts accept only current server-defined tasks while main chat is free", async () => {
  const runtime = testRuntime();
  const terminal = terminalWithResults([]);
  const unavailable = coordinator(runtime, terminal);

  const unknown = await unavailable.start({
    input: {
      taskId: "browser.supplied_prompt"
    },
    runtime,
    sessionId: "task-session"
  });
  assert.equal(unknown.code, "vibe64_agent_task_not_available");
  assert.deepEqual(terminal.calls, []);

  const busy = coordinator(runtime, terminal, {
    mainConversationBusy: () => true
  });
  const blocked = await busy.start({
    input: {
      taskId: "core.sync_with_remote"
    },
    runtime,
    sessionId: "task-session"
  });
  assert.equal(blocked.code, "vibe64_main_agent_busy");
  assert.deepEqual(terminal.calls, []);
});
