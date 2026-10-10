import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRenderer, nextTick, ref } from "vue";
import { EventEmitter } from "node:events";
import { routeLocationKey } from "vue-router";
import { provideConversationFixture } from "./helpers/conversationRuntimeFixture.js";
import { createTemporaryConversationFixture, temporaryRequestBody } from "./helpers/temporaryConversationFixture.js";

const mocks = vi.hoisted(() => ({
  transport: null,
  requests: [],
  responses: []
}));

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient: () => ({ request: (...args) => mocks.transport.request(...args) })
}));
vi.mock("@jskit-ai/assistant-core/client", async (importOriginal) => ({
  ...await importOriginal(), assistantHttpClient: { request: (...args) => mocks.transport.request(...args) }
}));
let createdId = "conversation-1";
const mountedApps = new Set();
const renderer = createRenderer({ createComment: () => ({}), insert() {}, nextSibling: () => null,
  parentNode: () => null, remove() {} });
async function mountTemporaryAi(options = {}) {
  const { useVibe64TemporaryAi } = await import("../../src/composables/useVibe64TemporaryAi.js");
  let temporary;
  const app = renderer.createApp({ setup() {
    temporary = useVibe64TemporaryAi({ sessionId: () => "session-1",
      sessionsApiPath: () => "/api/vibe64/sessions", ...options });
    return () => null;
  } });
  provideConversationFixture(app, mocks.transport.attach(new EventEmitter()));
  app.provide(routeLocationKey, { params: { slug: "project-a" } });
  app.runWithContext(() => app.mount({}));
  mountedApps.add(app);
  return temporary;
}

async function flushPromises() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function deferredPromise() {
  let resolve;
  const promise = new Promise((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function temporaryAi() { return mountTemporaryAi(); }
async function temporaryAiWithDraft() {
  const temporary = await mountTemporaryAi();
  const task = temporary.openTask();
  temporary.updateDraft(task.id, "Explain this conflict.");
  return { task, temporary };
}
async function temporaryAiWithFinishedObserver(onTaskFinished, taskOptions = {}) {
  const temporary = await mountTemporaryAi({ onTaskFinished });
  const task = temporary.openTask({ title: "Resolve Update", ...taskOptions });
  temporary.updateDraft(task.id, "Resolve this conflict safely.");
  return { task, temporary };
}

async function runningTemporaryAi() {
  const fixture = await temporaryAiWithDraft();
  mocks.responses.push(
    { ok: true, conversationId: createdId },
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
    createdId = "conversation-1";
    mocks.transport = createTemporaryConversationFixture({ created: id => { createdId = id; },
      async request(...args) {
        mocks.requests.push(args);
        if (args[1]?.method === "PATCH") return { ok: true };
        const response = mocks.responses.shift();
        return typeof response === "function" ? response(...args) : response;
      }
    });
  });
  afterEach(() => {
    for (const app of mountedApps) app.unmount();
    mountedApps.clear();
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("checks a restored unconfirmed request without changing its ID or the newer draft", async () => {
    const route = { messageId: "interrupted-1", status: "waiting", delivery: "uncertain", input: { message: "Original prompt.", displayMessage: "Original prompt." } };
    mocks.responses.push({ conversations: [{ conversationId: createdId, status: "uncertain", messages: [],
      draft: "Newer draft.", routingMetadata: { assistant_routing_request: JSON.stringify(route) } }] });
    const temporary = await mountTemporaryAi({ assistantReady: () => true });
    await flushPromises();
    const task = temporary.activeTask.value;
    expect(await temporary.cancelMessage(task.id, route.messageId)).toBe(false);
    expect(await temporary.editMessage(task.id, route.messageId)).toBe(false);
    mocks.responses.push({ ok: true, status: "completed", messages: [
      { id: route.messageId, role: "user", text: "Original prompt." }
    ], assistantRoutingRequest: { ...route, status: "complete", delivery: "accepted" } });
    expect(await temporary.send(task.id, { retryMessageId: route.messageId })).toBe(true);
    expect(mocks.requests.find(([path]) => path.includes("/deliveries/"))[0])
      .toContain(`/deliveries/${route.messageId}/inspect`);
    expect(mocks.requests.some(([path]) => path.endsWith("/messages"))).toBe(false);
    expect(temporary.activeTask.value.draft).toBe("Newer draft.");
    expect(temporary.activeTask.value.delivery.state.messages).toHaveLength(0);
  });

  it("ignores a late HTTP failure after the exact temporary message receipt arrives", async () => {
    const { task, temporary } = await temporaryAiWithDraft();
    mocks.responses.push({ ok: true, conversationId: createdId }, async (_url, options) => {
      mocks.transport.observe(task.id, { messageId: temporaryRequestBody(options).messageId,
        messages: [{ id: temporaryRequestBody(options).messageId, role: "user", text: temporaryRequestBody(options).message }],
        status: "inProgress" });
      mocks.transport.publishTranscript(task.id);
      temporary.updateDraft(task.id, "Keep my new draft.");
      throw new Error("Late HTTP failure.");
    });
    expect(await temporary.send(task.id)).toBe(true);
    expect(temporary.activeTask.value).toMatchObject({ draft: "Keep my new draft.", error: "", pendingMessageId: "" });
    expect(temporary.activeTask.value.delivery.state.messages).toHaveLength(0);
    await flushPromises();
    expect(temporary.activeTask.value).toMatchObject({ draft: "Keep my new draft.", error: "", pendingMessageId: "", status: "inProgress" });
    expect(temporary.activeTask.value.delivery.state.messages).toHaveLength(0);
  });

  it("keeps a provisional temporary row uncertain and explicitly checks the captured request without clearing a newer draft", async () => {
    const { task, temporary } = await temporaryAiWithDraft();
    const file = { attachmentId: "original-file", name: "Original" };
    temporary.updateAttachments(task.id, [file]);
    let original;
    const provisional = () => ({ id: original.messageId, role: "user", text: original.displayMessage, receipt: false });
    mocks.responses.push({ ok: true, conversationId: createdId }, async (_url, options) => {
      original = temporaryRequestBody(options);
      mocks.transport.observe(task.id, { messageId: original.messageId, messages: [provisional()], status: "failed" });
      mocks.transport.publishTranscript(task.id);
      temporary.updateDraft(task.id, "Keep the newer draft.");
      return { ok: false, delivered: false, status: "uncertain", readError: true, error: "Native history unavailable." };
    });
    expect(await temporary.send(task.id)).toBe(false);
    const current = temporary.activeTask.value;
    expect(current.delivery.find(original.messageId).status).toBe("uncertain");
    expect(current.delivery.turns([{ turnId: "saved", user: { ...provisional(), messageId: original.messageId } }])).toHaveLength(1);
    expect(current.attachments).toEqual([file]);
    expect(current.draft).toBe("Keep the newer draft.");
    for (const response of [
      { ok: false, error: "Native history unavailable." },
      { ok: true, delivered: false, status: "completed", messages: [provisional()] }
    ]) {
      mocks.responses.push(async (_url, options) => {
        expect(_url).toContain(`/deliveries/${original.messageId}/inspect`);
        expect(options).not.toHaveProperty("body");
        const captured = current.delivery.find(original.messageId).payload;
        expect(captured.message).toBe(original.message);
        expect(captured.attachmentIds).toEqual(original.attachmentIds);
        expect(captured.agentSettings).toEqual(original.agentSettings);
        Object.assign(temporary.activeTask.value, { busy: false, status: "failed" });
        return response;
      });
      expect(await temporary.send(task.id, { retryMessageId: original.messageId })).toBe(false);
      expect(current.delivery.find(original.messageId).status).toBe("uncertain");
      expect(temporary.activeTask.value.attachments).toEqual([file]);
      expect(temporary.activeTask.value.draft).toBe("Keep the newer draft.");
    }
    mocks.responses.push({ ok: true, delivered: true, status: "completed", messages: [
      { ...provisional(), receipt: undefined }
    ] });
    expect(await temporary.send(task.id, { retryMessageId: original.messageId })).toBe(true);
    expect(temporary.activeTask.value.delivery.state.messages).toHaveLength(0);
    expect(temporary.activeTask.value.attachments).toEqual([]);
    expect(temporary.activeTask.value.draft).toBe("Keep the newer draft.");
    expect(mocks.requests.filter(([path]) => path.endsWith("/messages")).map(([, options]) => options.body.messageId))
      .toEqual([original.messageId]);
    expect(mocks.requests.filter(([path]) => path.endsWith(`/deliveries/${original.messageId}/inspect`))).toHaveLength(3);
  });

  it("flags unseen replies while working and clears them only when that conversation is viewed", async () => {
    const { task, temporary } = await runningTemporaryAi();
    temporary.closeWorkspace();
    mocks.responses.push({ ok: true, status: "inProgress", text: "A new reply." });
    mocks.transport.notify();
    await vi.advanceTimersByTimeAsync(650);
    expect(temporary.hasUnreadMessages.value).toBe(true);
    expect(temporary.activeTask.value).toMatchObject({ busy: true, unread: true });

    const other = temporary.openTask();
    await nextTick();
    expect(temporary.hasUnreadMessages.value).toBe(true);
    temporary.closeWorkspace();
    temporary.showWorkspace();
    await nextTick();
    expect(temporary.activeTask.value.id).toBe(other.id);
    expect(temporary.hasUnreadMessages.value).toBe(true);

    temporary.selectTask(task.id);
    await nextTick();
    expect(temporary.hasUnreadMessages.value).toBe(false);
    temporary.closeWorkspace();
    mocks.responses.push(
      { ok: true, conversationId: "conversation-2" },
      { ok: true, status: "inProgress", text: "A new reply." }
    );
    mocks.transport.notify();
    await vi.advanceTimersByTimeAsync(650);
    expect(temporary.hasUnreadMessages.value).toBe(false);
    mocks.responses.push({ ok: true, status: "completed", text: "A new reply. Now complete." });
    mocks.transport.notify();
    await vi.advanceTimersByTimeAsync(650);
    expect(temporary.hasUnreadMessages.value).toBe(true);
    temporary.showWorkspace();
    await nextTick();
    expect(temporary.hasUnreadMessages.value).toBe(false);
  });

  it("does not flag visible replies or background reasoning and user messages", async () => {
    const { temporary } = await runningTemporaryAi();
    mocks.responses.push({ ok: true, status: "inProgress", text: "Visible reply." });
    mocks.transport.notify();
    await vi.advanceTimersByTimeAsync(650);
    expect(temporary.hasUnreadMessages.value).toBe(false);
    temporary.closeWorkspace();
    mocks.responses.push({
      ok: true,
      status: "inProgress",
      text: "Visible reply.",
      progressUpdates: [{ id: "progress-1", text: "Still working." }]
    });
    mocks.transport.notify();
    await vi.advanceTimersByTimeAsync(650);
    expect(temporary.hasUnreadMessages.value).toBe(false);
    mocks.responses.push({
      ok: true,
      status: "completed",
      messages: [...temporary.activeTask.value.messages, { id: "user-2", role: "user", text: "Another prompt." }]
    });
    mocks.transport.notify();
    await vi.advanceTimersByTimeAsync(650);
    expect(temporary.hasUnreadMessages.value).toBe(false);
  });

  it("retains unread replies while its session is inactive and removes them with a closed task", async () => {
    await import("../../src/composables/useVibe64TemporaryAi.js");
    const active = ref(false);
    const temporary = await mountTemporaryAi({
      active,
      sessionId: () => "session-1",
      sessionsApiPath: () => "/api/vibe64/sessions"
    });
    const task = temporary.openTask({ draft: "Check this." });
    mocks.responses.push(
      { ok: true, conversationId: createdId },
      { ok: true, runId: "turn-1", status: "inProgress" },
      { ok: true, status: "completed", text: "Ready for review." }
    );
    await temporary.send(task.id);
    await flushPromises();
    expect(temporary.hasUnreadMessages.value).toBe(true);
    active.value = true;
    await nextTick();
    expect(temporary.hasUnreadMessages.value).toBe(false);

    temporary.closeWorkspace();
    temporary.updateDraft(task.id, "One more check.");
    mocks.responses.push(
      { ok: true, runId: "turn-2", status: "inProgress" },
      { ok: true, status: "completed", text: "Checked again." }
    );
    await temporary.send(task.id);
    await flushPromises();
    expect(temporary.hasUnreadMessages.value).toBe(true);
    mocks.responses.push({ ok: true });
    await temporary.closeTask(task.id);
    expect(temporary.hasUnreadMessages.value).toBe(false);
  });

  it("keeps a repair visible and resumes progress when stopping it fails", async () => {
    const { task, temporary } = await runningTemporaryAi();
    mocks.responses.push({ ok: false, error: "Could not stop the AI." });
    await expect(temporary.closeTask(task.id)).rejects.toThrow("Could not stop the AI.");
    expect(temporary.activeTask.value).toMatchObject({ id: task.id, busy: true });
    expect(temporary.open.value).toBe(true);
    expect(mocks.requests.at(-1)[1].method).toBe("DELETE");
    mocks.responses.push({ ok: true, status: "inProgress", progressUpdates: [{ id: "later", text: "Still working." }] });
    mocks.transport.notify();
    await vi.advanceTimersByTimeAsync(650);
    expect(temporary.activeTask.value.messages.filter(message => message.role === "thinking")
      .map(({ id, text }) => ({ id, text }))).toEqual([
      { id: "fixture-native:turn-1:progress:later", text: "Still working." }
    ]);
  });

  it("keeps a stopped repair visible when deletion fails and allows retry", async () => {
    const { task, temporary } = await runningTemporaryAi();
    mocks.responses.push({ ok: true });
    await temporary.stopTask(task.id);
    mocks.responses.push({ ok: false, error: "Could not close the conversation." });
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
      { ok: true, conversationId: createdId },
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

  it("Close waits for pending creation and deletes it without sending a turn", async () => {
    const { task, temporary } = await temporaryAiWithDraft();
    const start = deferredPromise();
    mocks.responses.push(() => start.promise);
    const sending = temporary.send(task.id);
    const closing = temporary.closeTask(task.id);
    expect(temporary.activeTask.value.id).toBe(task.id);
    mocks.responses.push({ ok: true, deleted: true });
    start.resolve({ ok: true, conversationId: createdId });
    await closing;
    await expect(sending).resolves.toBe(false);
    expect(temporary.tasks.value).toEqual([]);
    expect(mocks.requests.some(([path]) => path.endsWith("/messages"))).toBe(false);
    expect(mocks.requests.at(-1)[1].method).toBe("DELETE");
  });

  it("carries repair completion identity and blocks new AI edits while Update is checking", async () => {
    const observer = vi.fn();
    const { task, temporary } = await temporaryAiWithFinishedObserver(observer, { recoveryOperation: "update" });
    mocks.responses.push(
      { ok: true, conversationId: createdId },
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
    expect(mocks.requests.filter(([path]) => path.endsWith("/messages")).at(-1)[1].body.text)
      .toContain("Still conflicts.");
    expect(observer).toHaveBeenLastCalledWith(expect.objectContaining({ runId: "turn-2", outcomeKind: "continue" }));
  });

  it("reuses a completed Update repair even when the conflict diagnostic changes", async () => {
    const temporary = await temporaryAi();
    const input = { recoveryOperation: "update", message: "Repair eight conflicts." };
    mocks.responses.push(
      { ok: true, conversationId: createdId },
      { ok: true, runId: "turn-1", status: "inProgress" },
      { ok: true, status: "completed", outcome: { kind: "continue" } }
    );
    const first = await temporary.startTask({ ...input, dedupeKey: "eight-files" });
    await flushPromises();
    expect(mocks.requests.find(([path, options]) => path.endsWith("/temporary-conversations") && options.method === "POST")[1].body.assistantRouting)
      .toEqual({ mode: "senior", review: false });
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
    expect(mocks.requests.filter(([path]) => path.endsWith("/messages")).at(-1)[0]).toContain(createdId);
    temporary.reportRecoveryOutcome(first.taskId, { status: "succeeded" });
    expect(temporary.updateRepairTask.value).toBeNull();
  });

  it.each(["draft", "attachment", "checking", "busy"])("preserves an existing repair with %s instead of opening another", async (state) => {
    const temporary = await temporaryAi();
    const task = temporary.openTask({ recoveryOperation: "update" });
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
    const task = temporary.openTask({ recoveryOperation: "update" });
    createdId = task.id;
    Object.assign(temporary.tasks.value[0], { conversationId: task.id, status: "completed", runId: "turn-1" });
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
      const request = mocks.requests.filter(([path]) => path.endsWith("/messages")).at(-1);
      expect(request[0]).toContain(createdId);
      expect(request[1].body.text).toContain(`Exact remaining conflict: file-${attempt}.vue`);
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

  it.each(["draft", "attachment", "stopped", "repository-busy"])("does not auto-retry over %s", async (state) => {
    await import("../../src/composables/useVibe64TemporaryAi.js");
    const temporary = await mountTemporaryAi({ sessionId: () => "session-1", operationBusy: () => state === "repository-busy" });
    const task = temporary.openTask({ recoveryOperation: "update" });
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
      { conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: createdId,
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
      recoveryNotice: "Temporary AI can edit this session in a separate temporary chat.",
      status: "starting",
      title: "Fix workspace preparation"
    });
    expect(temporary.activeTask.value.id).not.toBe(previousTask.id);
    expect(mocks.requests).toHaveLength(1);

    conversationRequest.resolve({ conversationId: createdId, ok: true });
    await expect(sending).resolves.toMatchObject({
      ok: true,
      reused: false,
      started: true,
      taskId: temporary.activeTask.value.id
    });
    await flushPromises();

    const turnRequests = mocks.requests.filter(([path]) => path.endsWith("/messages"));
    expect(turnRequests).toHaveLength(1);
    expect(turnRequests[0][1]).toMatchObject({
      body: {
        text: "Inspect the full workspace diagnostic and repair the invalid contract.",
        data: { promptLabel: "Fix workspace preparation" }
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
      { conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: createdId,
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

    conversationRequest.resolve({ conversationId: createdId, ok: true });
    await expect(firstStart).resolves.toEqual({
      ok: true,
      reused: false,
      started: true,
      taskId: firstTaskId
    });
    await flushPromises();

    expect(mocks.requests.filter(([path]) => path.endsWith("/temporary-conversations"))).toHaveLength(1);
    expect(mocks.requests.filter(([path]) => path.endsWith("/messages"))).toHaveLength(1);
    expect(temporary.tasks.value).toHaveLength(1);
    expect(temporary.activeTask.value.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("coalesces one busy repository recovery opened from chat and Dashboard", async () => {
    const conversationRequest = deferredPromise();
    mocks.responses.push(
      () => conversationRequest.promise,
      { conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: createdId,
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
      title: "Resolve Update"
    });
    const firstTaskId = temporary.activeTask.value.id;
    const dashboardStart = temporary.startTask({
      dedupeKey,
      message: "Resolve this update from Dashboard.",
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

    conversationRequest.resolve({ conversationId: createdId, ok: true });
    await expect(chatStart).resolves.toMatchObject({
      ok: true,
      reused: false,
      started: true,
      taskId: firstTaskId
    });
    await flushPromises();

    expect(mocks.requests.filter(([path]) => path.endsWith("/temporary-conversations"))).toHaveLength(1);
    expect(mocks.requests.filter(([path]) => path.endsWith("/messages"))).toHaveLength(1);
    expect(temporary.activeTask.value.messages.filter((message) => message.role === "user")).toEqual([
      expect.objectContaining({ text: "Resolve this update from chat." })
    ]);
  });

  it("starts a fresh recovery task after the matching task completed", async () => {
    const recovery = {
      dedupeKey: "workspace-preparation:session-1",
      message: "Fix workspace preparation.",
      title: "Fix workspace preparation"
    };
    mocks.responses.push(
      { conversationId: createdId, ok: true },
      { conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: createdId,
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
    expect(mocks.requests.filter(([path]) => path.endsWith("/messages"))).toHaveLength(2);
  });

  it("starts a fresh recovery task after the matching task was interrupted", async () => {
    const firstPoll = deferredPromise();
    const recovery = {
      dedupeKey: "save-conflict:session-1",
      message: "Resolve the Save conflict safely.",
      title: "Resolve Save conflict"
    };
    mocks.responses.push(
      { conversationId: createdId, ok: true },
      { conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress" },
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
    expect(mocks.requests.filter(([path]) => path.endsWith("/messages"))).toHaveLength(2);

    firstPoll.resolve({
      conversationId: createdId,
      ok: true,
      runId: "turn-1",
      status: "interrupted"
    });
    await flushPromises();
  });

  it("starts a fresh recovery task after the matching native turn failed", async () => {
    const recovery = {
      dedupeKey: "update-conflict:session-1",
      message: "Resolve the Update conflict safely.",
      title: "Resolve Update"
    };
    mocks.responses.push(
      { conversationId: createdId, ok: true },
      { conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress" },
      {
        error: "Native work stopped.",
        status: "failed",
        ok: true
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
    expect(mocks.requests.filter(([path]) => path.endsWith("/messages"))).toHaveLength(2);
  });

  it("keeps a failed recovery request in its delivery record for explicit Retry", async () => {
    mocks.responses.push({
      error: "Temporary AI could not be started.",
      ok: false
    });
    const temporary = await temporaryAi();

    const result = await temporary.startTask({
      dedupeKey: "save-conflict:session-1",
      draft: "Resolve the Save conflict safely.",
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
      draft: "",
      error: "Temporary AI could not be started.",
      status: "failed"
    });
    expect(failedTask.pendingMessageId).toMatch(/^message_/u);

    mocks.responses.push(
      { conversationId: createdId, ok: true },
      { conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: createdId,
        message: "The Save conflict is resolved.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );

    expect(failedTask.delivery.find(failedTask.pendingMessageId).payload.message).toBe("Resolve the Save conflict safely.");
    await expect(temporary.send(failedTask.id, { retryMessageId: failedTask.pendingMessageId })).resolves.toBe(true);
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

  it("restores a stopped Router draft and uses a fresh identity on the next Send", async () => {
    const finish = deferredPromise();
    mocks.responses.push(
      { conversationId: createdId, ok: true },
      async () => {
        await finish.promise;
        return { ok: false, error: "Routing cancelled.", code: "vibe64_assistant_routing_cancelled" };
      }
    );
    const { temporary, task } = await temporaryAiWithDraft();
    const sending = temporary.send(task.id);
    await flushPromises();
    const originalMessageId = temporary.activeTask.value.pendingMessageId;
    temporary.updateDraft(task.id, "Also explain the constraints.");
    finish.resolve();
    await expect(sending).resolves.toBe(false);
    expect(temporary.activeTask.value).toMatchObject({
      busy: false, status: "interrupted", pendingMessageId: "", error: "",
      draft: "Explain this conflict.\n\nAlso explain the constraints."
    });
    expect(temporary.activeTask.value.delivery.state.messages).toEqual([]);
    mocks.responses.push({ ok: true, status: "completed", messages: [] });
    await expect(temporary.send(task.id)).resolves.toBe(true);
    const sends = mocks.requests.filter(([path]) => path.endsWith("/messages"));
    expect(sends).toHaveLength(2);
    expect(sends[1][1].body.messageId).not.toBe(originalMessageId);
  });

  it("reuses the created conversation and message identity after an ambiguous turn failure", async () => {
    mocks.responses.push(
      { conversationId: createdId, ok: true },
      { error: "The turn request could not be confirmed.", ok: false }
    );
    const temporary = await temporaryAi();
    const recovery = {
      dedupeKey: "update-conflict:session-1",
      message: "Resolve the Update conflict safely.",
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
      conversationId: createdId,
      draft: "",
      status: "failed"
    });

    mocks.responses.push(
      { conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: createdId,
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
    const turnRequests = mocks.requests.filter(([path]) => path.endsWith("/messages"));
    expect(conversationRequests).toHaveLength(1);
    expect(turnRequests).toHaveLength(2);
    expect(turnRequests[0][1].body.messageId).toBe(originalMessageId);
    expect(turnRequests[1][1].body.messageId).toBe(originalMessageId);
    expect(temporary.tasks.value).toHaveLength(1);
  });

  it("shows live progress and settles with the final answer", async () => {
    mocks.responses.push(
      { conversationId: createdId, ok: true },
      (_url, options) => ({ conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress", messages: [
        // The server resolves the authorized upload into its authored receipt.
        { id: options.body.messageId, role: "user", text: options.body.data.displayMessage,
          attachments: [{ attachmentId: "attachment-1", fileName: "conflict.png", size: 2048 }] }
      ] }),
      {
        conversationId: createdId,
        ok: true,
        progressUpdates: [{ id: "progress:1", text: "Inspecting the conflict." }],
        runId: "turn-1",
        status: "inProgress"
      },
      {
        conversationId: createdId,
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
    expect(temporary.activeTask.value.messages.filter(message => message.role === "thinking")
      .map(({ id, text }) => ({ id, text }))).toEqual([
      { id: "fixture-native:turn-1:progress:progress:1", text: "Inspecting the conflict." }
    ]);
    expect(temporary.activeTask.value.status).toBe("inProgress");

    mocks.transport.notify();
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
      { conversationId: createdId, ok: true },
      { conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: createdId,
        ok: true,
        progressUpdates: [{ id: "progress:1", text: "Still checking." }],
        runId: "turn-1",
        status: "inProgress"
      },
      {
        conversationId: createdId,
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
      conversationId: createdId,
      id: hiddenTaskId,
      runId: "turn-1"
    });
    expect(mocks.requests.some(([path, options]) => (
      path.includes("temporary-conversations") && options?.method === "DELETE"
    ))).toBe(false);

    mocks.transport.notify();
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

  it("binds each repair completion to the conflict that turn reviewed", async () => {
    const finished = vi.fn();
    const { task, temporary } = await temporaryAiWithFinishedObserver(finished, {
      recoveryOperation: "update", recoveryConflictId: "conflict-1"
    });
    mocks.responses.push(
      { ok: true, conversationId: createdId },
      { ok: true, runId: "turn-1", status: "inProgress" },
      { ok: true, status: "completed", outcome: { kind: "complete" } }
    );
    await temporary.send(task.id);
    await flushPromises();
    expect(finished).toHaveBeenLastCalledWith(expect.objectContaining({
      outcomeKind: "complete", runConflictId: "conflict-1"
    }));
    temporary.reportRecoveryOutcome(task.id, {
      status: "failed", message: "A newer saved version needs review.", recoveryConflictId: "conflict-2"
    });
    expect(temporary.activeTask.value).toMatchObject({
      recoveryConflictId: "conflict-2", runConflictId: "conflict-1"
    });
    mocks.responses.push(
      { ok: true, runId: "turn-2", status: "inProgress" },
      { ok: true, status: "completed", outcome: { kind: "complete" } }
    );
    temporary.updateDraft(task.id, "Review the newer conflict.");
    await temporary.send(task.id);
    await flushPromises();
    expect(finished).toHaveBeenLastCalledWith(expect.objectContaining({
      outcomeKind: "complete", runConflictId: "conflict-2"
    }));
  });

  it("adds one system message after a verified repair and keeps it in the conversation", async () => {
    const { task, temporary } = await temporaryAiWithDraft();
    const message = "Session updated. Your changes were preserved. Nothing was published.";
    temporary.reportRecoveryOutcome(task.id, { status: "checking" });
    temporary.reportRecoveryOutcome(task.id, { status: "failed", message: "Still needs review." });
    expect(temporary.activeTask.value.messages).toHaveLength(0);

    temporary.reportRecoveryOutcome(task.id, { status: "succeeded", message });
    temporary.reportRecoveryOutcome(task.id, { status: "succeeded", message });
    expect(temporary.activeTask.value.messages).toEqual([
      { id: `recovery_${task.id}`, role: "system", text: message }
    ]);
    temporary.closeWorkspace();
    temporary.showWorkspace();
    expect(temporary.activeTask.value.messages).toHaveLength(1);
  });

  it("reports a completed task exactly once for global user feedback", async () => {
    const onTaskFinished = vi.fn();
    mocks.responses.push(
      { conversationId: createdId, ok: true },
      { conversationId: createdId, ok: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: createdId,
        message: "The working files are ready for Vibe64 to retry.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );
    const { task, temporary } = await temporaryAiWithFinishedObserver(onTaskFinished, {
      completionMessage: "Repair complete. Retry Update.",
      dedupeKey: "subsystem-map:session-1",
      failureMessage: "Repair stopped. Review the error."
    });

    await temporary.send(task.id);
    await flushPromises();

    expect(onTaskFinished).toHaveBeenCalledTimes(1);
    expect(onTaskFinished).toHaveBeenCalledWith(expect.objectContaining({
      completionMessage: "Repair complete. Retry Update.",
      dedupeKey: "subsystem-map:session-1",
      error: "",
      failureMessage: "Repair stopped. Review the error.",
      id: task.id,
      status: "completed",
      title: "Resolve Update"
    }));
  });

  it.each([
    { ok: false, status: "inProgress", error: "The stop is not yet confirmed." },
    { ok: true, status: "inProgress", error: "The stop is not yet confirmed." },
    () => { throw Object.assign(new Error("The stop is not yet confirmed."), { status: 503 }); }
  ])("keeps Stop and an explicitly retriable failed reply after an unconfirmed progress read (%#)", async (response) => {
    const { task, temporary } = await runningTemporaryAi();
    temporary.updateDraft(task.id, "Keep this reply.");
    mocks.responses.push(response);
    mocks.transport.notify();
    await vi.advanceTimersByTimeAsync(650);

    expect(temporary.activeTask.value).toMatchObject({
      busy: true,
      draft: "Keep this reply.",
      error: "The stop is not yet confirmed.",
      runId: "turn-1",
      status: "inProgress"
    });
    mocks.responses.push({ ok: false, error: "Reply delivery is unconfirmed." });
    await expect(temporary.send(task.id)).resolves.toBe(false);
    mocks.responses.push({ ok: true });
    await expect(temporary.stopTask(task.id)).resolves.toBe(true);
    expect(temporary.activeTask.value).toMatchObject({
      busy: false,
      draft: "",
      error: "",
      status: "interrupted"
    });
    expect(temporary.activeTask.value.delivery.state.messages.at(-1)).toMatchObject({
      status: "failed", payload: { message: "Keep this reply." }
    });
    const requests = mocks.requests.filter(([, options]) => options.method !== "PATCH").length;
    await vi.advanceTimersByTimeAsync(650);
    expect(mocks.requests.filter(([, options]) => options.method !== "PATCH")).toHaveLength(requests);
  });

  it("settles a confirmed failed turn without retrying progress or sending again", async () => {
    const { task, temporary } = await runningTemporaryAi();
    const authored = JSON.parse(JSON.stringify(temporary.activeTask.value.messages));
    mocks.responses.push({ ok: true, status: "failed", error: "Native work stopped." });
    mocks.transport.notify();
    await vi.advanceTimersByTimeAsync(650);
    expect(temporary.activeTask.value).toMatchObject({
      busy: false,
      error: "Native work stopped.",
      status: "failed"
    });
    expect(temporary.activeTask.value.binding.runtime.value.snapshot.value.presentation.status).toBe("failed");
    expect(temporary.activeTask.value.adapter.conversation.working).toBe(false);
    expect(temporary.activeTask.value.messages).toEqual(authored);
    expect(temporary.activeTask.value.messages.filter(message => message.role === "assistant")).toEqual([]);
    const requests = mocks.requests.length;
    await vi.advanceTimersByTimeAsync(650);
    expect(mocks.requests).toHaveLength(requests);
    await expect(temporary.stopTask(task.id)).resolves.toBe(false);
  });

  it("retains a durable conversation and Stop after native history read fails", async () => {
    const { task, temporary } = await runningTemporaryAi();
    const authored = JSON.parse(JSON.stringify(temporary.activeTask.value.messages));
    mocks.responses.push({
      error: "Native history unavailable.",
      ok: true,
      readError: true,
      runId: "turn-1",
      status: "inProgress"
    });
    mocks.transport.notify();
    await vi.advanceTimersByTimeAsync(650);

    expect(temporary.activeTask.value).toMatchObject({
      busy: true,
      conversationId: task.id,
      error: "Native history unavailable.",
      runId: "turn-1",
      status: "inProgress"
    });
    expect(temporary.activeTask.value.messages).toEqual(authored);
    expect(temporary.activeTask.value.messages.filter(message => message.role === "assistant")).toEqual([]);
    expect(temporary.activeTask.value.adapter.composer.canStop).toBe(true);
    const requests = mocks.requests.length;
    await vi.advanceTimersByTimeAsync(650);
    expect(mocks.requests).toHaveLength(requests);
    mocks.responses.push({ ok: true });
    await expect(temporary.stopTask(task.id)).resolves.toBe(true);
    expect(temporary.activeTask.value).toMatchObject({
      busy: false, conversationId: task.id, error: "", runId: "turn-1", status: "interrupted"
    });
    expect(mocks.requests.filter(([path]) => path.endsWith("/messages"))).toHaveLength(1);
  });

  it("reuses one message id after an ambiguous turn request failure", async () => {
    mocks.responses.push(
      { conversationId: createdId, ok: true },
      () => {
        throw new Error("Network request failed.");
      }
    );
    const { task, temporary } = await temporaryAiWithDraft();

    await expect(temporary.send(task.id)).resolves.toBe(false);
    await flushPromises();
    const retryMessageId = temporary.activeTask.value.pendingMessageId;
    mocks.responses.push(
      { conversationId: createdId, ok: true, delivered: true, runId: "turn-1", status: "inProgress" },
      {
        conversationId: createdId,
        message: "Recovered without another turn.",
        ok: true,
        runId: "turn-1",
        status: "completed"
      }
    );
    await expect(temporary.send(task.id, { retryMessageId })).resolves.toBe(true);
    await flushPromises();

    const turnRequests = mocks.requests.filter(([path]) => path.endsWith("/messages"));
    expect(turnRequests).toHaveLength(1);
    expect(turnRequests[0][1].body.messageId).toMatch(/^message_/u);
    const inspections = mocks.requests.filter(([path]) => path.includes("/deliveries/"));
    expect(inspections).toHaveLength(1);
    expect(inspections[0][0]).toContain(`/deliveries/${turnRequests[0][1].body.messageId}/inspect`);
    expect(inspections[0][1]).not.toHaveProperty("body");
  });
});
