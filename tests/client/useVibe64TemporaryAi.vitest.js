import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requests: [],
  responses: []
}));

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onBeforeUnmount() {},
    onMounted() {}
  };
});

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient() {
    return {
      async request(...args) {
        mocks.requests.push(args);
        const response = mocks.responses.shift();
        return typeof response === "function" ? response(...args) : response;
      }
    };
  }
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferredPromise() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function temporaryAi() {
  const { useVibe64TemporaryAi } = await import(
    "../../src/composables/useVibe64TemporaryAi.js"
  );
  return useVibe64TemporaryAi({
    sessionId: () => "session-1",
    sessionsApiPath: () => "/api/vibe64/sessions"
  });
}

async function temporaryAiWithDraft() {
  const { useVibe64TemporaryAi } = await import(
    "../../src/composables/useVibe64TemporaryAi.js"
  );
  const temporary = useVibe64TemporaryAi({
    sessionId: () => "session-1",
    sessionsApiPath: () => "/api/vibe64/sessions"
  });
  const task = temporary.openTask();
  temporary.updateDraft(task.id, "Explain this conflict.");
  return { task, temporary };
}

async function temporaryAiWithFinishedObserver(onTaskFinished, taskOptions = {}) {
  const { useVibe64TemporaryAi } = await import(
    "../../src/composables/useVibe64TemporaryAi.js"
  );
  const temporary = useVibe64TemporaryAi({
    onTaskFinished,
    sessionId: () => "session-1",
    sessionsApiPath: () => "/api/vibe64/sessions"
  });
  const task = temporary.openTask({ title: "Resolve Update", ...taskOptions });
  temporary.updateDraft(task.id, "Resolve this conflict safely.");
  return { task, temporary };
}

async function runningTemporaryAi() {
  const fixture = await temporaryAiWithDraft();
  mocks.responses.push(
    { ok: true, conversationId: "conversation-1" },
    { ok: true, runId: "turn-1", status: "inProgress" },
    { ok: true, status: "inProgress" }
  );
  await fixture.temporary.send(fixture.task.id);
  await flushPromises();
  return fixture;
}

describe("useVibe64TemporaryAi", () => {
  beforeEach(() => {
    mocks.requests.length = 0;
    mocks.responses.length = 0;
    vi.useFakeTimers();
  });

  it("keeps a repair visible and resumes progress when stopping it fails", async () => {
    const { task, temporary } = await runningTemporaryAi();
    mocks.responses.push({ ok: false, error: "Could not stop the AI." });
    await expect(temporary.closeTask(task.id)).rejects.toThrow("Could not stop the AI.");
    expect(temporary.activeTask.value).toMatchObject({ id: task.id, busy: true });
    expect(temporary.open.value).toBe(true);
    expect(mocks.requests.some(([, options]) => options.method === "DELETE")).toBe(false);
    mocks.responses.push({ ok: true, status: "inProgress", progressUpdates: [{ id: "later", text: "Still working." }] });
    await vi.advanceTimersByTimeAsync(650);
    expect(temporary.activeTask.value.messages.at(-1).progressUpdates).toEqual([{ id: "later", text: "Still working." }]);
  });

  it("keeps a stopped repair visible when deletion fails and allows retry", async () => {
    const { task, temporary } = await runningTemporaryAi();
    mocks.responses.push({ ok: true }, { ok: false, error: "Could not close the conversation." });
    await expect(temporary.closeTask(task.id)).rejects.toThrow("Could not close the conversation.");
    expect(temporary.activeTask.value).toMatchObject({ id: task.id, busy: false, status: "interrupted" });
    expect(temporary.open.value).toBe(true);
    mocks.responses.push({ ok: true });
    await temporary.closeTask(task.id);
    expect(temporary.tasks.value).toEqual([]);
    expect(temporary.open.value).toBe(false);
  });

  it("ignores a late completion after Stop instead of applying Update", async () => {
    const observer = vi.fn();
    const { task, temporary } = await temporaryAiWithFinishedObserver(observer, { recoveryOperation: "update" });
    const poll = deferredPromise();
    mocks.responses.push(
      { ok: true, conversationId: "conversation-1" },
      { ok: true, runId: "turn-1", status: "inProgress" },
      () => poll.promise
    );
    await temporary.send(task.id);
    mocks.responses.push({ ok: true });
    await temporary.stopTask(task.id);
    poll.resolve({ ok: true, status: "completed", outcome: { kind: "complete" }, message: "Repaired." });
    await flushPromises();
    expect(temporary.activeTask.value).toMatchObject({ busy: false, status: "interrupted" });
    expect(observer).not.toHaveBeenCalled();
  });

  it("does not discard a repair while its start request is pending", async () => {
    const { task, temporary } = await temporaryAiWithDraft();
    const start = deferredPromise();
    mocks.responses.push(() => start.promise);
    const sending = temporary.send(task.id);
    await expect(temporary.closeTask(task.id)).rejects.toThrow("still starting");
    expect(temporary.activeTask.value.id).toBe(task.id);
    mocks.responses.push(
      { ok: true, runId: "turn-1", status: "inProgress" },
      { ok: true, status: "inProgress" }
    );
    start.resolve({ ok: true, conversationId: "conversation-1" });
    await sending;
    await flushPromises();
    expect(temporary.activeTask.value).toMatchObject({ busy: true, runId: "turn-1" });
  });

  it("carries repair completion identity and blocks new AI edits while Update is checking", async () => {
    const observer = vi.fn();
    const { task, temporary } = await temporaryAiWithFinishedObserver(observer, { recoveryOperation: "update" });
    mocks.responses.push(
      { ok: true, conversationId: "conversation-1" },
      { ok: true, runId: "turn-1", status: "inProgress" },
      { ok: true, status: "completed", outcome: { kind: "complete" }, message: "Repaired." }
    );
    await temporary.send(task.id);
    await flushPromises();
    expect(observer).toHaveBeenCalledWith(expect.objectContaining({
      id: task.id, runId: "turn-1", sessionId: "session-1",
      recoveryOperation: "update", outcomeKind: "complete", status: "completed"
    }));
    temporary.reportRecoveryOutcome(task.id, { status: "checking" });
    temporary.updateDraft(task.id, "Try again.");
    const requestCount = mocks.requests.length;
    await expect(temporary.send(task.id)).resolves.toBe(false);
    expect(mocks.requests).toHaveLength(requestCount);
    temporary.reportRecoveryOutcome(task.id, { status: "failed", message: "Still conflicts." });
    mocks.responses.push(
      { ok: true, runId: "turn-2", status: "inProgress" },
      { ok: true, status: "completed", outcome: { kind: "continue" }, message: "Which version?" }
    );
    await expect(temporary.send(task.id)).resolves.toBe(true);
    await flushPromises();
    expect(temporary.activeTask.value.recoveryOutcome).toBe("failed");
    expect(mocks.requests.filter(([path]) => path.endsWith("/turns")).at(-1)[1].body.message)
      .toContain("Still conflicts.");
    expect(observer).toHaveBeenLastCalledWith(expect.objectContaining({ runId: "turn-2", outcomeKind: "continue" }));
  });

  it("reuses a completed Update repair even when the conflict diagnostic changes", async () => {
    const temporary = await temporaryAi();
    const input = { recoveryOperation: "update", policy: "workspace_write", message: "Repair eight conflicts." };
    mocks.responses.push(
      { ok: true, conversationId: "conversation-1" },
      { ok: true, runId: "turn-1", status: "inProgress" },
      { ok: true, status: "completed", outcome: { kind: "continue" } }
    );
    const first = await temporary.startTask({ ...input, dedupeKey: "eight-files" });
    await flushPromises();
    mocks.responses.push(
      { ok: true, runId: "turn-2", status: "inProgress" },
      { ok: true, status: "completed", outcome: { kind: "complete" } }
    );
    await expect(temporary.startTask({ ...input, message: "One conflict remains.", dedupeKey: "one-file" }))
      .resolves.toMatchObject({ reused: true, started: true, taskId: first.taskId });
    await flushPromises();
    expect(temporary.tasks.value).toHaveLength(1);
    expect(mocks.requests.filter(([path, options]) => path.endsWith("/temporary-conversations") && options.method === "POST"))
      .toHaveLength(1);
    expect(mocks.requests.filter(([path]) => path.endsWith("/turns")).at(-1)[0]).toContain("conversation-1");
    temporary.reportRecoveryOutcome(first.taskId, { status: "succeeded" });
    expect(temporary.updateRepairTask.value).toBeNull();
  });

  it.each(["draft", "attachment", "checking", "busy"])("preserves an existing repair with %s instead of opening another", async (state) => {
    const temporary = await temporaryAi();
    const task = temporary.openTask({ recoveryOperation: "update", policy: "workspace_write" });
    if (state === "draft") temporary.updateDraft(task.id, "Keep my question.");
    if (state === "attachment") temporary.updateAttachments(task.id, [{ attachmentId: "attachment-1" }]);
    if (state === "checking") temporary.reportRecoveryOutcome(task.id, { status: "checking" });
    if (state === "busy") temporary.tasks.value[0].busy = true;
    await expect(temporary.startTask({ recoveryOperation: "update", message: "Retry." }))
      .resolves.toMatchObject({ reused: true, started: false, taskId: task.id });
    expect(temporary.tasks.value).toHaveLength(1);
    expect(mocks.requests).toHaveLength(0);
    if (state === "draft") expect(temporary.activeTask.value.draft).toBe("Keep my question.");
    if (state === "attachment") expect(temporary.activeTask.value.attachments).toHaveLength(1);
  });

  it.each(["repeated", "limit"])("returns exact Update diagnostics to the same chat and pauses at the %s retry boundary", async (boundary) => {
    const temporary = await temporaryAi();
    const task = temporary.openTask({ recoveryOperation: "update", policy: "workspace_write" });
    Object.assign(temporary.tasks.value[0], { conversationId: "conversation-1", status: "completed", runId: "turn-1" });
    const attempts = boundary === "repeated" ? 1 : 3;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      mocks.responses.push(
        { ok: true, runId: `turn-${attempt + 2}`, status: "inProgress" },
        { ok: true, status: "completed", outcome: { kind: "complete" } }
      );
      temporary.reportRecoveryOutcome(task.id, {
        status: "failed", message: "Update did not succeed.",
        retryKey: `conflict-${attempt}`, retryMessage: `Exact remaining conflict: file-${attempt}.vue`
      });
      await flushPromises();
      const request = mocks.requests.filter(([path]) => path.endsWith("/turns")).at(-1);
      expect(request[0]).toContain("conversation-1");
      expect(request[1].body.message).toContain(`Exact remaining conflict: file-${attempt}.vue`);
      expect(temporary.activeTask.value.recoveryOutcome).toBe("failed");
    }
    const requestCount = mocks.requests.length;
    temporary.reportRecoveryOutcome(task.id, {
      status: "failed", message: "Still conflicts.",
      retryKey: boundary === "repeated" ? "conflict-0" : "conflict-3", retryMessage: "Latest failure."
    });
    await flushPromises();
    expect(mocks.requests).toHaveLength(requestCount);
    expect(temporary.activeTask.value).toMatchObject({ recoveryAutoPaused: true, busy: false });
    expect(temporary.tasks.value).toHaveLength(1);
  });

  it.each(["draft", "attachment", "stopped", "read-only", "repository-busy"])("does not auto-retry over %s", async (state) => {
    const { useVibe64TemporaryAi } = await import("../../src/composables/useVibe64TemporaryAi.js");
    const temporary = useVibe64TemporaryAi({ sessionId: () => "session-1", operationBusy: () => state === "repository-busy" });
    const task = temporary.openTask({ recoveryOperation: "update", policy: state === "read-only" ? "read" : "workspace_write" });
    if (state === "draft") temporary.updateDraft(task.id, "My decision.");
    if (state === "attachment") temporary.updateAttachments(task.id, [{ attachmentId: "attachment-1" }]);
    if (state === "stopped") temporary.tasks.value[0].status = "interrupted";
    temporary.reportRecoveryOutcome(task.id, {
      status: "failed", message: "Still conflicts.", retryKey: "one", retryMessage: "File still conflicts."
    });
    await flushPromises();
    expect(mocks.requests).toHaveLength(0);
    expect(temporary.activeTask.value.recoveryOutcome).toBe("failed");
    if (state === "repository-busy") {
      temporary.updateDraft(task.id, "Try again.");
      await expect(temporary.send(task.id)).resolves.toBe(false);
      await expect(temporary.closeTask(task.id)).rejects.toThrow("Wait for Update");
    }
  });

  it("opens and selects a recovery task synchronously before automatically sending it", async () => {
    const conversationRequest = deferredPromise();
    mocks.responses.push(
      () => conversationRequest.promise,
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        message: "The recovery is complete.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );
    const temporary = await temporaryAi();
    const previousTask = temporary.openTask({ title: "Earlier task" });
    temporary.closeWorkspace();

    const sending = temporary.startTask({
      completionMessage: "Repair finished. Vibe64 is verifying it.",
      dedupeKey: "workspace-preparation:session-1",
      displayMessage: "Fix workspace preparation.",
      failureMessage: "The AI stopped. Vibe64 is checking its edits.",
      message: "Inspect the full workspace diagnostic and repair the invalid contract.",
      nextStepMessage: "Vibe64 will verify the repair when the AI finishes.",
      policy: "workspace_write",
      recoveryNotice: "Temporary AI can edit this session in a separate temporary chat.",
      title: "Fix workspace preparation"
    });

    expect(temporary.open.value).toBe(true);
    expect(temporary.tasks.value).toHaveLength(2);
    expect(temporary.activeTask.value).toMatchObject({
      busy: true,
      completionMessage: "Repair finished. Vibe64 is verifying it.",
      dedupeKey: "workspace-preparation:session-1",
      draft: "",
      failureMessage: "The AI stopped. Vibe64 is checking its edits.",
      nextStepMessage: "Vibe64 will verify the repair when the AI finishes.",
      policy: "workspace_write",
      recoveryNotice: "Temporary AI can edit this session in a separate temporary chat.",
      status: "starting",
      title: "Fix workspace preparation"
    });
    expect(temporary.activeTask.value.id).not.toBe(previousTask.id);
    expect(mocks.requests).toHaveLength(1);

    conversationRequest.resolve({ conversationId: "conversation-1", ok: true });
    await expect(sending).resolves.toMatchObject({
      ok: true,
      reused: false,
      started: true,
      taskId: temporary.activeTask.value.id
    });
    await flushPromises();

    const turnRequests = mocks.requests.filter(([path]) => path.endsWith("/turns"));
    expect(turnRequests).toHaveLength(1);
    expect(turnRequests[0][1]).toMatchObject({
      body: {
        message: "Inspect the full workspace diagnostic and repair the invalid contract.",
        policy: "workspace_write",
        promptLabel: "Fix workspace preparation"
      },
      method: "POST"
    });
    expect(temporary.activeTask.value.messages[0]).toMatchObject({
      role: "user",
      text: "Fix workspace preparation."
    });
  });

  it("records an independent product recovery outcome without rewriting the AI result", async () => {
    const temporary = await temporaryAi();
    const task = temporary.openTask({
      recoveryNotice: "Temporary AI can edit this session.",
      title: "Fix workspace preparation"
    });

    expect(temporary.reportRecoveryOutcome(task.id, {
      message: "Workspace preparation succeeded.",
      status: "succeeded"
    })).toBe(true);
    expect(temporary.activeTask.value).toMatchObject({
      recoveryOutcome: "succeeded",
      recoveryOutcomeMessage: "Workspace preparation succeeded.",
      status: "ready"
    });
    expect(temporary.reportRecoveryOutcome(task.id, { status: "unknown" })).toBe(false);
    expect(temporary.reportRecoveryOutcome("missing", { status: "succeeded" })).toBe(false);
  });

  it("coalesces rapid recovery starts with the same dedupe key", async () => {
    const conversationRequest = deferredPromise();
    mocks.responses.push(
      () => conversationRequest.promise,
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        message: "The recovery is complete.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );
    const temporary = await temporaryAi();
    const task = {
      dedupeKey: "preview-identity:session-1",
      draft: "Fix preview identity.",
      policy: "workspace_write",
      title: "Fix preview identity"
    };

    const firstStart = temporary.startTask(task);
    const firstTaskId = temporary.activeTask.value.id;
    const duplicateStart = temporary.startTask(task);

    expect(temporary.open.value).toBe(true);
    expect(temporary.tasks.value).toHaveLength(1);
    expect(temporary.activeTask.value.id).toBe(firstTaskId);
    expect(mocks.requests).toHaveLength(1);
    await expect(duplicateStart).resolves.toEqual({
      ok: true,
      reused: true,
      started: false,
      taskId: firstTaskId
    });

    conversationRequest.resolve({ conversationId: "conversation-1", ok: true });
    await expect(firstStart).resolves.toEqual({
      ok: true,
      reused: false,
      started: true,
      taskId: firstTaskId
    });
    await flushPromises();

    expect(mocks.requests.filter(([path]) => path.endsWith("/temporary-conversations"))).toHaveLength(1);
    expect(mocks.requests.filter(([path]) => path.endsWith("/turns"))).toHaveLength(1);
    expect(temporary.tasks.value).toHaveLength(1);
    expect(temporary.activeTask.value.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("coalesces one busy repository recovery opened from chat and Dashboard", async () => {
    const conversationRequest = deferredPromise();
    mocks.responses.push(
      () => conversationRequest.promise,
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        message: "The recovery is complete.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );
    const temporary = await temporaryAi();
    const dedupeKey = [
      "repository-recovery",
      "session-1",
      "vibe64_session_update_conflict",
      "One file needs review."
    ].join("|");

    const chatStart = temporary.startTask({
      dedupeKey,
      message: "Resolve this update from chat.",
      policy: "workspace_write",
      title: "Resolve Update"
    });
    const firstTaskId = temporary.activeTask.value.id;
    const dashboardStart = temporary.startTask({
      dedupeKey,
      message: "Resolve this update from Dashboard.",
      policy: "workspace_write",
      title: "Resolve repository update"
    });

    await expect(dashboardStart).resolves.toEqual({
      ok: true,
      reused: true,
      started: false,
      taskId: firstTaskId
    });
    expect(temporary.tasks.value).toHaveLength(1);
    expect(temporary.activeTask.value).toMatchObject({
      id: firstTaskId,
      title: "Resolve Update"
    });
    expect(mocks.requests).toHaveLength(1);

    conversationRequest.resolve({ conversationId: "conversation-1", ok: true });
    await expect(chatStart).resolves.toMatchObject({
      ok: true,
      reused: false,
      started: true,
      taskId: firstTaskId
    });
    await flushPromises();

    expect(mocks.requests.filter(([path]) => path.endsWith("/temporary-conversations"))).toHaveLength(1);
    expect(mocks.requests.filter(([path]) => path.endsWith("/turns"))).toHaveLength(1);
    expect(temporary.activeTask.value.messages.filter((message) => message.role === "user")).toEqual([
      expect.objectContaining({ text: "Resolve this update from chat." })
    ]);
  });

  it("starts a fresh recovery task after the matching task completed", async () => {
    const recovery = {
      dedupeKey: "workspace-preparation:session-1",
      message: "Fix workspace preparation.",
      policy: "workspace_write",
      title: "Fix workspace preparation"
    };
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        message: "The first recovery is complete.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );
    const temporary = await temporaryAi();

    await expect(temporary.startTask(recovery)).resolves.toMatchObject({
      ok: true,
      reused: false,
      started: true
    });
    await flushPromises();
    const completedTaskId = temporary.activeTask.value.id;
    expect(temporary.activeTask.value.status).toBe("completed");

    mocks.responses.push(
      { conversationId: "conversation-2", ok: true },
      { conversationId: "conversation-2", ok: true, runId: "turn-2", status: "inProgress" },
      {
        conversationId: "conversation-2",
        message: "The second recovery is complete.",
        ok: true,
        runId: "turn-2",
        status: "completed"
      }
    );

    await expect(temporary.startTask(recovery)).resolves.toMatchObject({
      ok: true,
      reused: false,
      started: true
    });
    await flushPromises();

    expect(temporary.tasks.value).toHaveLength(2);
    expect(temporary.activeTask.value.id).not.toBe(completedTaskId);
    expect(temporary.activeTask.value.messages[0]).toMatchObject({
      role: "user",
      text: recovery.message
    });
    expect(mocks.requests.filter(([path]) => path.endsWith("/temporary-conversations"))).toHaveLength(2);
    expect(mocks.requests.filter(([path]) => path.endsWith("/turns"))).toHaveLength(2);
  });

  it("starts a fresh recovery task after the matching task was interrupted", async () => {
    const firstPoll = deferredPromise();
    const recovery = {
      dedupeKey: "save-conflict:session-1",
      message: "Resolve the Save conflict safely.",
      policy: "workspace_write",
      title: "Resolve Save conflict"
    };
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      () => firstPoll.promise,
      { ok: true }
    );
    const temporary = await temporaryAi();

    await expect(temporary.startTask(recovery)).resolves.toMatchObject({
      ok: true,
      started: true
    });
    const interruptedTaskId = temporary.activeTask.value.id;
    await expect(temporary.stopTask(interruptedTaskId)).resolves.toBe(true);
    expect(temporary.activeTask.value.status).toBe("interrupted");

    mocks.responses.push(
      { conversationId: "conversation-2", ok: true },
      { conversationId: "conversation-2", ok: true, runId: "turn-2", status: "inProgress" },
      {
        conversationId: "conversation-2",
        message: "The new recovery is complete.",
        ok: true,
        runId: "turn-2",
        status: "completed"
      }
    );

    await expect(temporary.startTask(recovery)).resolves.toMatchObject({
      ok: true,
      reused: false,
      started: true
    });
    await flushPromises();

    expect(temporary.tasks.value).toHaveLength(2);
    expect(temporary.activeTask.value.id).not.toBe(interruptedTaskId);
    expect(temporary.activeTask.value.messages[0]).toMatchObject({
      role: "user",
      text: recovery.message
    });
    expect(mocks.requests.filter(([path]) => path.endsWith("/temporary-conversations"))).toHaveLength(2);
    expect(mocks.requests.filter(([path]) => path.endsWith("/turns"))).toHaveLength(2);

    firstPoll.resolve({
      conversationId: "conversation-1",
      ok: true,
      runId: "turn-1",
      status: "interrupted"
    });
    await flushPromises();
  });

  it("starts a fresh recovery task after polling the matching task failed", async () => {
    const recovery = {
      dedupeKey: "update-conflict:session-1",
      message: "Resolve the Update conflict safely.",
      policy: "workspace_write",
      title: "Resolve Update"
    };
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        code: "vibe64_temporary_conversation_expired",
        conversationExpired: true,
        error: "This Temporary AI task ended when Vibe64 restarted.",
        ok: false
      }
    );
    const temporary = await temporaryAi();

    await expect(temporary.startTask(recovery)).resolves.toMatchObject({
      ok: true,
      started: true
    });
    await flushPromises();
    const failedTaskId = temporary.activeTask.value.id;
    expect(temporary.activeTask.value).toMatchObject({
      draft: "",
      pendingMessageId: "",
      status: "failed"
    });

    mocks.responses.push(
      { conversationId: "conversation-2", ok: true },
      { conversationId: "conversation-2", ok: true, runId: "turn-2", status: "inProgress" },
      {
        conversationId: "conversation-2",
        message: "The replacement recovery is complete.",
        ok: true,
        runId: "turn-2",
        status: "completed"
      }
    );

    await expect(temporary.startTask(recovery)).resolves.toMatchObject({
      ok: true,
      reused: false,
      started: true
    });
    await flushPromises();

    expect(temporary.tasks.value).toHaveLength(2);
    expect(temporary.activeTask.value.id).not.toBe(failedTaskId);
    expect(temporary.activeTask.value.messages[0]).toMatchObject({
      role: "user",
      text: recovery.message
    });
    expect(mocks.requests.filter(([path]) => path.endsWith("/temporary-conversations"))).toHaveLength(2);
    expect(mocks.requests.filter(([path]) => path.endsWith("/turns"))).toHaveLength(2);
  });

  it("keeps a failed recovery task visible with its draft and error so it can be retried", async () => {
    mocks.responses.push({
      error: "Temporary AI could not be started.",
      ok: false
    });
    const temporary = await temporaryAi();

    const result = await temporary.startTask({
      dedupeKey: "save-conflict:session-1",
      draft: "Resolve the Save conflict safely.",
      policy: "workspace_write",
      title: "Resolve Save conflict"
    });

    const failedTask = temporary.activeTask.value;
    expect(result).toEqual({
      ok: false,
      reused: false,
      started: false,
      taskId: failedTask.id
    });
    expect(temporary.open.value).toBe(true);
    expect(temporary.tasks.value).toHaveLength(1);
    expect(failedTask).toMatchObject({
      busy: false,
      draft: "Resolve the Save conflict safely.",
      error: "Temporary AI could not be started.",
      status: "failed"
    });
    expect(failedTask.pendingMessageId).toMatch(/^message_/u);

    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        message: "The Save conflict is resolved.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );

    await expect(temporary.send(failedTask.id)).resolves.toBe(true);
    await flushPromises();

    expect(temporary.open.value).toBe(true);
    expect(temporary.activeTask.value).toMatchObject({
      busy: false,
      error: "",
      status: "completed"
    });
    expect(temporary.activeTask.value.messages[0]).toMatchObject({
      role: "user",
      text: "Resolve the Save conflict safely."
    });
  });

  it("reuses the created conversation and message identity after an ambiguous turn failure", async () => {
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { error: "The turn request could not be confirmed.", ok: false }
    );
    const temporary = await temporaryAi();
    const recovery = {
      dedupeKey: "update-conflict:session-1",
      message: "Resolve the Update conflict safely.",
      policy: "workspace_write",
      title: "Resolve Update"
    };

    await expect(temporary.startTask(recovery)).resolves.toMatchObject({
      ok: false,
      reused: false,
      started: false
    });
    const failedTask = temporary.activeTask.value;
    const originalMessageId = failedTask.pendingMessageId;
    expect(failedTask).toMatchObject({
      conversationId: "conversation-1",
      draft: "Resolve the Update conflict safely.",
      status: "failed"
    });

    mocks.responses.push(
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        message: "The Update conflict is resolved.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );
    await expect(temporary.startTask(recovery)).resolves.toEqual({
      ok: true,
      reused: true,
      started: true,
      taskId: failedTask.id
    });
    await flushPromises();

    const conversationRequests = mocks.requests.filter(([path]) => (
      path.endsWith("/temporary-conversations")
    ));
    const turnRequests = mocks.requests.filter(([path]) => path.endsWith("/turns"));
    expect(conversationRequests).toHaveLength(1);
    expect(turnRequests).toHaveLength(2);
    expect(turnRequests[0][1].body.messageId).toBe(originalMessageId);
    expect(turnRequests[1][1].body.messageId).toBe(originalMessageId);
    expect(temporary.tasks.value).toHaveLength(1);
  });

  it("shows live progress and settles with the final answer", async () => {
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        ok: true,
        progressUpdates: [{ id: "progress:1", text: "Inspecting the conflict." }],
        runId: "turn-1",
        status: "inProgress"
      },
      {
        conversationId: "conversation-1",
        text: "The conflict can be resolved safely.",
        ok: true,
        progressUpdates: [{ id: "progress:1", text: "Inspecting the conflict." }],
        runId: "turn-1",
        status: "completed"
      }
    );
    const { task, temporary } = await temporaryAiWithDraft();
    temporary.updateAttachments(task.id, [{
      attachmentId: "attachment-1",
      fileName: "conflict.png",
      path: "/tmp/vibe64-attachments/session/conflict.png",
      size: 2048
    }]);

    await temporary.send(task.id);
    await flushPromises();
    expect(temporary.activeTask.value.messages[0]).toMatchObject({
      attachments: [{
        fileName: "conflict.png",
        size: 2048
      }],
      role: "user",
      text: "Explain this conflict."
    });
    expect(temporary.activeTask.value.messages.at(-1)).toMatchObject({
      progressUpdates: [{ id: "progress:1", text: "Inspecting the conflict." }],
      status: "inProgress"
    });

    await vi.advanceTimersByTimeAsync(650);
    await flushPromises();
    expect(temporary.activeTask.value).toMatchObject({
      busy: false,
      status: "completed"
    });
    expect(temporary.activeTask.value.messages.at(-1)).toMatchObject({
      status: "completed",
      text: "The conflict can be resolved safely."
    });
  });

  it("keeps a hidden task polling and restores the same result", async () => {
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        ok: true,
        progressUpdates: [{ id: "progress:1", text: "Still checking." }],
        runId: "turn-1",
        status: "inProgress"
      },
      {
        conversationId: "conversation-1",
        message: "Finished while Main chat was visible.",
        ok: true,
        progressUpdates: [{ id: "progress:1", text: "Still checking." }],
        runId: "turn-1",
        status: "completed"
      }
    );
    const { task, temporary } = await temporaryAiWithDraft();

    await temporary.send(task.id);
    await flushPromises();
    const hiddenTaskId = temporary.activeTaskId.value;
    temporary.closeWorkspace();

    expect(temporary.open.value).toBe(false);
    expect(temporary.tasks.value).toHaveLength(1);
    expect(temporary.activeTask.value).toMatchObject({
      busy: true,
      conversationId: "conversation-1",
      id: hiddenTaskId,
      runId: "turn-1"
    });
    expect(mocks.requests.some(([path, options]) => (
      path.includes("temporary-conversations") && options?.method === "DELETE"
    ))).toBe(false);

    await vi.advanceTimersByTimeAsync(650);
    await flushPromises();
    expect(temporary.open.value).toBe(false);
    expect(temporary.activeTask.value).toMatchObject({
      busy: false,
      id: hiddenTaskId,
      status: "completed"
    });

    const restoredTask = temporary.showWorkspace();
    expect(restoredTask.id).toBe(hiddenTaskId);
    expect(temporary.open.value).toBe(true);
    expect(temporary.activeTask.value.messages.at(-1)).toMatchObject({
      status: "completed",
      text: "Finished while Main chat was visible."
    });
  });

  it("reports a completed task exactly once for global user feedback", async () => {
    const onTaskFinished = vi.fn();
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        message: "The working files are ready for Vibe64 to retry.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );
    const { task, temporary } = await temporaryAiWithFinishedObserver(onTaskFinished, {
      completionMessage: "Repair complete. Retry Update.",
      failureMessage: "Repair stopped. Review the error."
    });

    await temporary.send(task.id);
    await flushPromises();

    expect(onTaskFinished).toHaveBeenCalledTimes(1);
    expect(onTaskFinished).toHaveBeenCalledWith(expect.objectContaining({
      completionMessage: "Repair complete. Retry Update.",
      error: "",
      failureMessage: "Repair stopped. Review the error.",
      id: task.id,
      status: "completed",
      title: "Resolve Update"
    }));
  });

  it("turns a poll failure into a visible finished state", async () => {
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        code: "vibe64_temporary_conversation_expired",
        conversationExpired: true,
        error: "This Temporary AI task ended when Vibe64 restarted.",
        ok: false
      }
    );
    const { task, temporary } = await temporaryAiWithDraft();

    await temporary.send(task.id);
    await flushPromises();

    expect(temporary.activeTask.value).toMatchObject({
      busy: false,
      conversationId: "",
      error: "This Temporary AI task ended when Vibe64 restarted.",
      runId: "",
      status: "failed"
    });
    expect(temporary.activeTask.value.messages.at(-1).status).toBe("failed");
  });

  it("reuses one message id after an ambiguous turn request failure", async () => {
    mocks.responses.push(
      { conversationId: "conversation-1", ok: true },
      () => {
        throw new Error("Network request failed.");
      },
      { conversationId: "conversation-1", ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: "conversation-1",
        message: "Recovered without another turn.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );
    const { task, temporary } = await temporaryAiWithDraft();

    await expect(temporary.send(task.id)).resolves.toBe(false);
    await expect(temporary.send(task.id)).resolves.toBe(true);
    await flushPromises();

    const turnRequests = mocks.requests.filter(([path]) => path.endsWith("/turns"));
    expect(turnRequests).toHaveLength(2);
    expect(turnRequests[0][1].body.messageId).toMatch(/^message_/u);
    expect(turnRequests[1][1].body.messageId).toBe(turnRequests[0][1].body.messageId);
  });
});
